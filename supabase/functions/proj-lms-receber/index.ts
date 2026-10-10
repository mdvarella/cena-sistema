// ERP CENA — Edge Function: proj-lms-receber (Etapa 1.3 ENEL/LMS/WL)
// Recebe o LMS original (XLSX) de um projeto, guarda o arquivo no bucket privado proj-lms e registra a fonte
// imutável (sot_lms_importacoes RASCUNHO/ORIGINAL + sot_lms_linhas). Não confirma, não congela perfil de processo,
// não cria WL e não toca materiais, atividades, estoque nem programação.
//
// Deploy: supabase functions deploy proj-lms-receber   (verify_jwt = true em supabase/config.toml)
// Secrets padrão do Supabase: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
// Migration: 20261009193000_proj_lms_origem.sql.
//
// Chamada: POST ?projeto_id=<uuid>
//   Authorization: Bearer <JWT do usuário>
//   x-lms-nome: nome do arquivo (encodeURIComponent; não vai em URL nem em log)
//   Content-Type: tipo informado pelo navegador; corpo = bytes do .xlsx
//
// Dois clientes: o do usuário (JWT) só pergunta "pode?" (sot_lms_autorizar_recebimento → auth.uid() + cena_pode);
// o de serviço só grava (Storage + sot_lms_importacao_registrar), depois da resposta positiva.
// Ordem: autoriza → lê bytes (limite) → valida arquivo → SHA-256 dos bytes originais → parse A:N → Storage → registro.
// O parse vem antes do Storage para arquivo inválido nunca chegar ao bucket.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
// Cópia local de cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs: o bundler do Supabase não importa desse host
// e o npm só tem a 0.18.5 (vulnerável). Hash conferido em tests/proj-lms-receber-edge.test.mjs.
import * as XLSX from "../_shared/vendor/xlsx-0.20.3.mjs";
import {
  amostraPreview,
  LIMITES,
  PARSER_VERSION,
  parseLms,
  payloadRegistro,
  sha256Hex,
  validarArquivo,
  XLSX_MIME,
} from "../_shared/lms-parser.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-authorization, x-lms-nome",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BUCKET = "proj-lms";
const SEM_SESSAO = { auth: { persistSession: false, autoRefreshToken: false } };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HTTP_MOTIVO: Record<string, number> = {
  SEM_SESSAO: 401,
  USUARIO_ERP_INATIVO: 403,
  SEM_PERMISSAO: 403,
  CONTRATO_NAO_IDENTIFICADO: 403,
  PROJETO_INEXISTENTE: 404,
  PROJETO_EXCLUIDO: 409,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: cors });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "METODO_NAO_PERMITIDO" }, 405);
  }
  try {
    return await receber(req);
  } catch (e) {
    log("ERRO_INTERNO", { erro: (e as Error)?.name ?? "Error" });
    return json({ ok: false, error: "ERRO_INTERNO" }, 500);
  }
});

async function receber(req: Request): Promise<Response> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !supabaseAnon || !serviceKey) {
    return json({ ok: false, error: "NAO_CONFIGURADO" }, 503);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!/^Bearer \S+$/.test(authHeader)) {
    return json({ ok: false, error: "SEM_SESSAO" }, 401);
  }
  const userClient = createClient(supabaseUrl, supabaseAnon, {
    ...SEM_SESSAO,
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  const authUid = userData?.user?.id;
  if (userErr || !authUid) {
    return json({ ok: false, error: "SESSAO_INVALIDA" }, 401);
  }

  const projetoId = (new URL(req.url).searchParams.get("projeto_id") ?? "").trim().toLowerCase();
  if (!UUID.test(projetoId)) {
    return json({ ok: false, error: "PROJETO_INVALIDO" }, 400);
  }

  const { data: aut, error: autErr } = await userClient.rpc("sot_lms_autorizar_recebimento", { p_projeto_id: projetoId });
  if (autErr) {
    log("ERRO_AUTORIZACAO", { projeto_id: projetoId, auth_uid: authUid, codigo: autErr.code ?? null });
    return json({ ok: false, error: "ERRO_AUTORIZACAO" }, 500);
  }
  if (aut?.permitido !== true) {
    const motivo = typeof aut?.motivo === "string" ? aut.motivo : "SEM_PERMISSAO";
    log("NEGADO", { projeto_id: projetoId, auth_uid: authUid, motivo });
    return json({ ok: false, error: motivo }, HTTP_MOTIVO[motivo] ?? 403);
  }

  const corpo = await lerCorpo(req, LIMITES.arquivoBytes);
  if (corpo === null) {
    return json({ ok: false, error: "ARQUIVO_GRANDE_DEMAIS", limite_bytes: LIMITES.arquivoBytes }, 413);
  }
  const nomeInformado = decodificar(req.headers.get("x-lms-nome"));
  const val = await validarArquivo(corpo, nomeInformado, req.headers.get("content-type"));
  if (!val.ok) {
    log("ARQUIVO_RECUSADO", { projeto_id: projetoId, auth_uid: authUid, codigo: val.codigo, erro: val.erros[0]?.codigo });
    return json({ ok: false, error: val.codigo, erros: val.erros }, val.http);
  }
  const hash = await sha256Hex(corpo);
  const parse = parseLms(corpo, XLSX);
  if (!parse.ok) {
    log("FORMATO_RECUSADO", { projeto_id: projetoId, auth_uid: authUid, hash, erro: parse.erros[0]?.codigo });
    return json({ ok: false, error: parse.codigo, erros: parse.erros }, 422);
  }
  const payload = payloadRegistro(parse, {
    hash_sha256: hash,
    nome: val.nome,
    tamanho: corpo.length,
    mime_informado: val.mime_informado,
    mime_validado: val.mime_validado,
  });

  const admin = createClient(supabaseUrl, serviceKey, SEM_SESSAO);
  const caminho = `${projetoId}/${hash}.xlsx`;
  const up = await admin.storage.from(BUCKET).upload(caminho, corpo, { contentType: XLSX_MIME, upsert: false });
  const criadoAgora = !up.error;
  if (up.error && !jaExiste(up.error)) {
    log("STORAGE_FALHOU", { projeto_id: projetoId, auth_uid: authUid, hash });
    return json({ ok: false, error: "FALHA_STORAGE" }, 500);
  }

  const { data: reg, error: regErr } = await admin.rpc("sot_lms_importacao_registrar", {
    p_auth: authUid,
    p_projeto_id: projetoId,
    p_importacao: payload.p_importacao,
    p_linhas: payload.p_linhas,
  });
  if (regErr || !reg?.importacao_id) {
    // Só remove o objeto que esta requisição criou e que nenhuma importação usa (reenvio concorrente pode ter registrado).
    let compensacao = "NAO_NECESSARIA";
    if (criadoAgora) {
      const { data: existe, error: exErr } = await admin.from("sot_lms_importacoes").select("id")
        .eq("projeto_id", projetoId).eq("hash_sha256", hash).maybeSingle();
      if (exErr) compensacao = "PENDENTE";
      else if (existe) compensacao = "OBJETO_EM_USO";
      else compensacao = (await admin.storage.from(BUCKET).remove([caminho])).error ? "PENDENTE" : "OBJETO_REMOVIDO";
    }
    log("REGISTRO_FALHOU", { projeto_id: projetoId, auth_uid: authUid, hash, codigo: regErr?.code ?? null, compensacao });
    const [status, error] = regErr?.code === "P0002" ? [404, "PROJETO_INEXISTENTE"]
      : regErr?.code === "42501" ? [403, "SEM_PERMISSAO"]
      : regErr?.code === "22023" ? [422, "REGISTRO_INCONSISTENTE"]
      : [500, "FALHA_REGISTRO"];
    return json({ ok: false, error }, status);
  }

  // Objeto já existia: confere que continua lá (outra requisição pode ter compensado entre o upload e o registro).
  if (!criadoAgora) {
    const de = await admin.storage.from(BUCKET).upload(caminho, corpo, { contentType: XLSX_MIME, upsert: false });
    if (!de.error) log("OBJETO_RECRIADO", { projeto_id: projetoId, importacao_id: reg.importacao_id, hash });
    else if (!jaExiste(de.error)) log("OBJETO_NAO_CONFERIDO", { projeto_id: projetoId, importacao_id: reg.importacao_id, hash });
  }

  log(reg.reenvio ? "REENVIO" : "RECEBIDO", {
    projeto_id: projetoId,
    importacao_id: reg.importacao_id,
    auth_uid: authUid,
    hash,
    status: reg.status,
    linhas: reg.qtd_linhas,
  });
  return json({
    ok: true,
    reenvio: reg.reenvio === true,
    importacao_id: reg.importacao_id,
    projeto_id: projetoId,
    status: reg.status,
    tipo_importacao: reg.tipo_importacao,
    arquivo: {
      nome: reg.arquivo_nome_original,
      tamanho: reg.arquivo_tamanho,
      sha256: reg.hash_sha256,
      mime_validado: XLSX_MIME,
    },
    parser_version: reg.parser_version,
    worksheet: reg.worksheet,
    projeto_identificacao_raw: reg.projeto_identificacao_raw,
    qtd_linhas: reg.qtd_linhas,
    qtd_wls_distintas: reg.qtd_wls_distintas,
    resumo: reg.resumo,
    amostra: reg.parser_version === PARSER_VERSION ? amostraPreview(parse.linhas) : [],
    erros: [],
    avisos: reg.resumo?.alertas ?? {},
  }, 200);
}

async function lerCorpo(req: Request, limite: number): Promise<Uint8Array | null> {
  const declarado = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declarado) && declarado > limite) return null;
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limite) {
      await reader.cancel().catch(() => {});
      return null;
    }
    partes.push(value);
  }
  const out = new Uint8Array(total);
  let k = 0;
  for (const p of partes) { out.set(p, k); k += p.length; }
  return out;
}

function decodificar(v: string | null): string {
  try { return decodeURIComponent(v ?? ""); } catch { return ""; }
}

function jaExiste(e: { statusCode?: string | number; status?: number; message?: string }): boolean {
  return String(e?.statusCode ?? e?.status ?? "") === "409" || /already exists|duplicate/i.test(String(e?.message ?? ""));
}

// Sem conteúdo do arquivo, nome do arquivo, JWT ou chaves.
function log(evento: string, dados: Record<string, unknown>) {
  console.log(JSON.stringify({ fn: "proj-lms-receber", evento, ...dados }));
}

function json(obj: unknown, status: number) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
