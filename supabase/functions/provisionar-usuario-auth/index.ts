// ERP CENA — Edge Function: provisionar-usuario-auth
// Cria/atualiza a conta Supabase Auth de um cadastro usuarios_sistema e grava auth_user_id.
// Service role so no servidor: nunca vai para o navegador nem para a resposta.
//
// Deploy (gateway com verify_jwt=false por causa do OPTIONS do CORS; o JWT e validado aqui):
//   supabase functions deploy provisionar-usuario-auth --no-verify-jwt
//
// Body:
//   { "acao": "criar"|"atualizar_senha",
//     "usuario_id": "<uuid usuarios_sistema>",
//     "email": "<e-mail do cadastro ERP>",
//     "senha": "..." }   // minimo 6
//
// Authorization: Bearer <JWT de admin ativo com usuarios_sistema.auth_user_id = id do JWT>
//
// - Quem chama e identificado so por auth_user_id; e-mail do JWT nao autoriza nada.
// - Conta sem cadastro admin vinculado recebe 403; vinculo de admin e feito fora daqui.
// - O e-mail gravado no Auth e o do cadastro ERP; o do body so precisa conferir.
// - Cadastro sem auth_user_id: cria a conta e vincula. Se ja existir conta Auth com o
//   e-mail, nao vincula nem altera essa conta (pode ter sido criada pelo signup publico).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ACOES = ["criar", "atualizar_senha"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEM_SESSAO = { auth: { persistSession: false, autoRefreshToken: false } };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: cors });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "metodo_nao_permitido" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const authHeader = req.headers.get("Authorization") ?? "";

    if (!/^Bearer \S+$/.test(authHeader)) {
      return json({ ok: false, error: "missing_authorization" }, 401);
    }
    if (!supabaseUrl || !supabaseAnon || !serviceKey) {
      return json({ ok: false, error: "service_role_not_configured" }, 503);
    }

    const userClient = createClient(supabaseUrl, supabaseAnon, {
      ...SEM_SESSAO,
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    const caller = userData?.user;
    if (userErr || !caller?.id) {
      return json({ ok: false, error: "invalid_jwt", detail: userErr?.message ?? null }, 401);
    }

    const admin = createClient(supabaseUrl, serviceKey, SEM_SESSAO);

    const { data: callerRow, error: callerErr } = await admin
      .from("usuarios_sistema")
      .select("id,perfil")
      .eq("auth_user_id", caller.id)
      .eq("ativo", true)
      .is("deleted_at", null)
      .maybeSingle();
    if (callerErr) {
      return json({ ok: false, error: "erro_autorizacao" }, 500);
    }
    if (!callerRow) {
      return json({
        ok: false,
        error: "forbidden",
        detail: "Esta conta não está vinculada a um cadastro ERP de administrador ativo. " +
          "O vínculo deve ser feito pelo processo administrativo seguro.",
      }, 403);
    }
    if (String(callerRow.perfil ?? "").trim().toLowerCase() !== "admin") {
      return json({ ok: false, error: "forbidden", detail: "Somente administrador pode provisionar contas Auth." }, 403);
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return json({ ok: false, error: "body_invalido" }, 400);
    }
    const acao = String(body.acao ?? "");
    if (acao === "vincular") {
      return json({
        ok: false,
        error: "acao_invalida",
        detail: "A ação vincular foi desativada. O vínculo só acontece quando esta função cria a conta Auth.",
      }, 400);
    }
    if (!ACOES.includes(acao)) {
      return json({ ok: false, error: "acao_invalida" }, 400);
    }
    if (body.auth_user_id != null) {
      return json({ ok: false, error: "auth_user_id_nao_aceito" }, 400);
    }
    const usuarioId = String(body.usuario_id ?? "").trim();
    const emailBody = normEmail(body.email);
    const senha = body.senha != null ? String(body.senha) : "";
    if (!UUID_RE.test(usuarioId) || !emailBody) {
      return json({ ok: false, error: "usuario_id_e_email_obrigatorios" }, 400);
    }
    if (senha.length < 6) {
      return json({ ok: false, error: "senha_minima_6" }, 400);
    }

    const { data: alvo, error: alvoErr } = await admin
      .from("usuarios_sistema")
      .select("id,email,auth_user_id")
      .eq("id", usuarioId)
      .is("deleted_at", null)
      .maybeSingle();
    if (alvoErr) {
      return json({ ok: false, error: "erro_leitura_cadastro" }, 500);
    }
    if (!alvo) {
      return json({ ok: false, error: "usuario_nao_encontrado" }, 404);
    }

    const emailErp = normEmail(alvo.email);
    if (!emailErp.includes("@")) {
      return json({ ok: false, error: "email_erp_invalido", detail: "Corrija o e-mail do cadastro ERP antes de provisionar." }, 422);
    }
    if (emailBody !== emailErp) {
      return json({ ok: false, error: "email_divergente", detail: "O e-mail enviado não é o do cadastro ERP." }, 422);
    }

    let authUserId = alvo.auth_user_id ? String(alvo.auth_user_id) : "";

    if (authUserId) {
      const { error: updAuthErr } = await admin.auth.admin.updateUserById(authUserId, {
        email: emailErp,
        password: senha,
        email_confirm: true,
      });
      if (updAuthErr) {
        return json({ ok: false, error: "auth_update_failed", detail: updAuthErr.message }, 400);
      }
    } else {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: emailErp,
        password: senha,
        email_confirm: true,
      });
      if (createErr) {
        if (contaJaExiste(createErr)) {
          return json({
            ok: false,
            error: "conta_auth_preexistente",
            detail: "Já há uma conta Auth com o e-mail deste cadastro. Ela não foi vinculada nem alterada; " +
              "confira a conta e faça o vínculo pelo processo administrativo seguro.",
          }, 409);
        }
        return json({ ok: false, error: "auth_create_failed", detail: createErr.message }, 400);
      }
      authUserId = created?.user?.id ?? "";
      if (!authUserId) {
        return json({ ok: false, error: "auth_user_id_missing" }, 500);
      }

      const { data: vinculados, error: linkErr } = await admin
        .from("usuarios_sistema")
        .update({ auth_user_id: authUserId })
        .eq("id", usuarioId)
        .is("auth_user_id", null)
        .is("deleted_at", null)
        .select("id");
      if (linkErr) {
        return json({ ok: false, error: "link_failed", detail: linkErr.message, auth_user_id: authUserId }, 500);
      }
      if (!vinculados || vinculados.length !== 1) {
        return json({
          ok: false,
          error: "link_conflito",
          detail: "O cadastro mudou durante o provisionamento; a conta Auth criada ficou sem vínculo.",
          auth_user_id: authUserId,
        }, 409);
      }
    }

    return json({
      ok: true,
      acao,
      auth_user_id: authUserId,
      usuario_id: usuarioId,
      email: emailErp,
      requested_by: caller.id,
    });
  } catch (e) {
    return json({ ok: false, error: "exception", detail: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function normEmail(v: unknown) {
  return String(v ?? "").trim().toLowerCase();
}

function contaJaExiste(err: { code?: string; message?: string }) {
  return err.code === "email_exists" || /already (been )?registered|already exists/i.test(err.message ?? "");
}

function json(obj: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
