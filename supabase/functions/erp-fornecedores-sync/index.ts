// ERP CENA — Edge Function: erp-fornecedores-sync
// Sincroniza o cadastro de fornecedores do ERP CENA (/suppliers) para public.fornecedores.
// O token do ERP fica só no servidor: nunca vai para o navegador nem para a resposta.
//
// Deploy (o cron chama sem JWT; a autorização é feita aqui):
//   supabase functions deploy erp-fornecedores-sync --no-verify-jwt
// Secrets: ERP_CENABR_TOKEN, ERP_SYNC_CRON_SECRET (mínimo 32 caracteres); opcional ERP_CENABR_URL.
// Migrations: 20261006190000_fornecedores_erp_sync.sql e 20261006190100_fornecedores_erp_sync_cron.sql.
//
// Disparo:
//   cron   -> header x-cron-secret = ERP_SYNC_CRON_SECRET; body {"modo":"auto"|"completa"}
//   manual -> Authorization: Bearer <JWT>; cena_forn_pode_sincronizar_erp() = true;
//             body {"modo":"auto"|"completa"|"simulacao"}
//
// Modos: INCREMENTAL (updated_since = marca d'água - 10 min) quando o ERP publica updated_at e houve
// leitura completa nos últimos 7 dias; senão COMPLETA (todas as páginas). SIMULACAO lê tudo e não grava.
// Leitura completa só inativa ausentes se todos os IDs do ERP foram lidos; senão termina PARCIAL.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  ERP_URL_PADRAO,
  ErroErp,
  erpTemUpdatedAt,
  escolherModo,
  filtroIncremental,
  lerSuppliers,
  maiorUpdatedAt,
  prepararItens,
  type FornecedorErpItem,
  type LeituraErp,
  type ModoSync,
} from "../_shared/erp-suppliers.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODOS = ["auto", "completa", "simulacao"] as const;
type ModoPedido = typeof MODOS[number];
const LOTE = 200;
const MAX_CONFLITOS_RESUMO = 200;
const SEM_SESSAO = { auth: { persistSession: false, autoRefreshToken: false } };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: cors });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "metodo_nao_permitido" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const erpToken = Deno.env.get("ERP_CENABR_TOKEN") ?? "";
  const erpUrl = (Deno.env.get("ERP_CENABR_URL") ?? "").trim() || ERP_URL_PADRAO;
  const cronSecret = Deno.env.get("ERP_SYNC_CRON_SECRET") ?? "";

  if (!supabaseUrl || !supabaseAnon || !serviceKey) {
    return json({ ok: false, error: "service_role_not_configured" }, 503);
  }
  if (!erpToken || !/^https:\/\//.test(erpUrl)) {
    return json({ ok: false, error: "erp_nao_configurado", detail: "Configure o secret ERP_CENABR_TOKEN." }, 503);
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ ok: false, error: "body_invalido" }, 400);
  }
  const modoPedido = String((body as Record<string, unknown>).modo ?? "auto") as ModoPedido;
  if (!MODOS.includes(modoPedido)) {
    return json({ ok: false, error: "modo_invalido" }, 400);
  }

  let disparo: "CRON" | "MANUAL";
  let authId: string | null = null;
  const cronHeader = req.headers.get("x-cron-secret");
  if (cronHeader !== null) {
    if (cronSecret.length < 32 || !iguais(cronHeader, cronSecret)) {
      return json({ ok: false, error: "cron_nao_autorizado" }, 401);
    }
    if (modoPedido === "simulacao") {
      return json({ ok: false, error: "modo_invalido", detail: "Simulação só por disparo manual." }, 400);
    }
    disparo = "CRON";
  } else {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!/^Bearer \S+$/.test(authHeader)) {
      return json({ ok: false, error: "missing_authorization" }, 401);
    }
    const userClient = createClient(supabaseUrl, supabaseAnon, {
      ...SEM_SESSAO,
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user?.id) {
      return json({ ok: false, error: "invalid_jwt" }, 401);
    }
    const { data: pode, error: podeErr } = await userClient.rpc("cena_forn_pode_sincronizar_erp");
    if (podeErr) {
      return json({ ok: false, error: "erro_autorizacao" }, 500);
    }
    if (pode !== true) {
      return json({
        ok: false,
        error: "forbidden",
        detail: "Sincronizar fornecedores do ERP é permitido para admin, diretoria, gestor e administrativo.",
      }, 403);
    }
    disparo = "MANUAL";
    authId = userData.user.id;
  }

  const admin = createClient(supabaseUrl, serviceKey, SEM_SESSAO);
  const modoInicial: ModoSync = modoPedido === "simulacao" ? "SIMULACAO" : modoPedido === "completa" ? "COMPLETA" : "INCREMENTAL";
  const { data: ini, error: iniErr } = await admin.rpc("fn_erp_sync_iniciar", {
    p_recurso: "suppliers",
    p_modo: modoInicial,
    p_disparo: disparo,
    p_auth: authId,
  });
  if (iniErr || !ini?.execucao_id) {
    if (/ERP_SYNC_EM_EXECUCAO/.test(String(iniErr?.message ?? ""))) {
      return json({ ok: false, error: "em_execucao", detail: "Já existe uma sincronização em andamento." }, 409);
    }
    return json({ ok: false, error: "erro_iniciar" }, 500);
  }
  const execucaoId = String(ini.execucao_id);

  const cont = {
    paginas: 0, lidos: 0, inseridos: 0, atualizados: 0, inalterados: 0,
    vinculados: 0, inativados: 0, conflitos: 0, ignorados: 0,
  };
  const conflitos: unknown[] = [];
  let modo: ModoSync = escolherModo({
    solicitado: modoPedido,
    watermark: ini.watermark_updated_at ?? null,
    ultimaCompleta: ini.ultima_completa_em ?? null,
    agora: Date.now(),
  });

  try {
    let leitura: LeituraErp;
    if (modo === "INCREMENTAL") {
      leitura = await lerSuppliers({ baseUrl: erpUrl, token: erpToken, filtros: filtroIncremental(ini.watermark_updated_at) });
      if (leitura.itens.length && !erpTemUpdatedAt(leitura.itens)) {
        modo = "COMPLETA";
        leitura = await lerSuppliers({ baseUrl: erpUrl, token: erpToken });
      }
    } else {
      leitura = await lerSuppliers({ baseUrl: erpUrl, token: erpToken });
    }
    cont.paginas = leitura.paginas;
    cont.lidos = leitura.itens.length;

    const { itens, ignorados } = await prepararItens(leitura.itens);
    cont.ignorados = ignorados;

    for (let i = 0; i < itens.length; i += LOTE) {
      const lote: FornecedorErpItem[] = itens.slice(i, i + LOTE);
      const { data: r, error } = await admin.rpc("fn_fornecedores_erp_aplicar", {
        p_execucao: execucaoId,
        p_itens: lote,
        p_simular: modo === "SIMULACAO",
      });
      if (error || !r) throw new Error("falha ao gravar lote: " + String(error?.message ?? "sem resposta"));
      cont.inseridos += Number(r.inseridos) || 0;
      cont.atualizados += Number(r.atualizados) || 0;
      cont.inalterados += Number(r.inalterados) || 0;
      cont.vinculados += Number(r.vinculados) || 0;
      cont.conflitos += Number(r.conflitos) || 0;
      cont.ignorados += Number(r.ignorados) || 0;
      if (Array.isArray(r.conflitos_lista)) conflitos.push(...r.conflitos_lista.slice(0, Math.max(0, MAX_CONFLITOS_RESUMO - conflitos.length)));
    }

    let status: "OK" | "PARCIAL" = "OK";
    let aviso: string | null = null;
    if (modo !== "INCREMENTAL" && !leitura.completo) {
      status = "PARCIAL";
      aviso = `leitura incompleta: ${leitura.idsUnicos} IDs únicos de ${leitura.total} informados pelo ERP; ausentes não foram inativados`;
    } else if (modo === "COMPLETA") {
      const ids = itens.map((x) => x.erp_id);
      const { data: n, error } = await admin.rpc("fn_fornecedores_erp_marcar_ausentes", {
        p_execucao: execucaoId,
        p_ids_vistos: ids,
        p_total_erp: ids.length,
      });
      if (error) {
        status = "PARCIAL";
        aviso = "ausentes não foram inativados: " + limpar(String(error.message ?? ""), erpToken);
      } else {
        cont.inativados = Number(n) || 0;
      }
    }

    const watermark = status === "OK" ? maiorUpdatedAt(itens) : null;
    const resumo = { conflitos, total_erp: leitura.total, ids_unicos: leitura.idsUnicos };
    const { error: finErr } = await admin.rpc("fn_erp_sync_finalizar", {
      p_execucao: execucaoId,
      p_status: status,
      p_modo: modo,
      p_contadores: cont,
      p_watermark_novo: watermark,
      p_erro: aviso,
      p_resumo: resumo,
    });
    if (finErr) throw new Error("falha ao finalizar: " + String(finErr.message ?? ""));

    return json({ ok: true, execucao_id: execucaoId, modo, status, aviso, contadores: cont, conflitos });
  } catch (e) {
    const msg = limpar(String((e as Error)?.message ?? e), erpToken).slice(0, 500);
    await admin.rpc("fn_erp_sync_finalizar", {
      p_execucao: execucaoId,
      p_status: "ERRO",
      p_modo: modo,
      p_contadores: cont,
      p_watermark_novo: null,
      p_erro: msg,
      p_resumo: null,
    }).then(() => null, () => null);
    const ehErp = e instanceof ErroErp;
    return json({ ok: false, error: ehErp ? "erp_indisponivel" : "erro_sincronizacao", detail: msg, execucao_id: execucaoId }, ehErp ? 502 : 500);
  }
});

function iguais(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let dif = ea.length ^ eb.length;
  const n = Math.max(ea.length, eb.length);
  for (let i = 0; i < n; i++) dif |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return dif === 0;
}

function limpar(msg: string, token: string): string {
  let s = msg;
  if (token) s = s.split(token).join("[redacted]");
  return s.replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [redacted]");
}

function json(obj: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
