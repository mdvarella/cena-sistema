// ERP CENA — Edge Function: provisionar-usuario-auth
// Fase 2B: cria/atualiza usuario no Supabase Auth e vincula auth_user_id.
// Service role so no servidor. Nunca expoe segredos.
//
// Deploy (obrigatorio apos mudar CORS / verify_jwt):
//   supabase functions deploy provisionar-usuario-auth --no-verify-jwt
//
// Body:
//   { "acao": "criar"|"atualizar_senha"|"vincular",
//     "usuario_id": "<uuid usuarios_sistema>",
//     "email": "...",
//     "senha": "..." }   // obrigatoria em criar / atualizar_senha
//
// Authorization: Bearer <JWT do admin autenticado>
// JWT e validado DENTRO da function (gateway verify_jwt=false por causa do CORS OPTIONS).

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: cors });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const authHeader = req.headers.get("Authorization") ?? "";

    if (!authHeader.startsWith("Bearer ")) {
      return json({ ok: false, error: "missing_authorization" }, 401);
    }
    if (!serviceKey) {
      return json({ ok: false, error: "service_role_not_configured" }, 503);
    }

    const userClient = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ ok: false, error: "invalid_jwt", detail: userErr?.message ?? null }, 401);
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const caller = userData.user;

    // Admin: auth_user_id = caller.id OU (transicao) email Auth = admin ativo
    const { data: byAuth } = await admin
      .from("usuarios_sistema")
      .select("id,email,perfil,ativo,auth_user_id,deleted_at")
      .eq("auth_user_id", caller.id)
      .is("deleted_at", null)
      .maybeSingle();

    let callerRow = byAuth;
    if (!callerRow && caller.email) {
      const { data: byEmail } = await admin
        .from("usuarios_sistema")
        .select("id,email,perfil,ativo,auth_user_id,deleted_at")
        .eq("email", caller.email)
        .is("deleted_at", null)
        .maybeSingle();
      callerRow = byEmail;
    }

    if (!callerRow || callerRow.perfil !== "admin" || callerRow.ativo === false) {
      return json({ ok: false, error: "forbidden", message: "Somente admin autenticado pode provisionar Auth." }, 403);
    }

    // Auto-vinculo do proprio admin na transicao
    if (!callerRow.auth_user_id) {
      await admin
        .from("usuarios_sistema")
        .update({ auth_user_id: caller.id })
        .eq("id", callerRow.id);
    }

    const body = await req.json().catch(() => ({}));
    const acao = String(body.acao || "");
    const usuarioId = String(body.usuario_id || "");
    const email = String(body.email || "").trim().toLowerCase();
    const senha = body.senha != null ? String(body.senha) : "";

    if (!["criar", "atualizar_senha", "vincular"].includes(acao)) {
      return json({ ok: false, error: "acao_invalida" }, 400);
    }
    if (!usuarioId || !email) {
      return json({ ok: false, error: "usuario_id_e_email_obrigatorios" }, 400);
    }
    if ((acao === "criar" || acao === "atualizar_senha") && senha.length < 6) {
      return json({ ok: false, error: "senha_minima_6" }, 400);
    }

    const { data: alvo, error: alvoErr } = await admin
      .from("usuarios_sistema")
      .select("id,email,auth_user_id,ativo,deleted_at")
      .eq("id", usuarioId)
      .maybeSingle();

    if (alvoErr || !alvo || alvo.deleted_at) {
      return json({ ok: false, error: "usuario_nao_encontrado" }, 404);
    }

    if (acao === "vincular") {
      const authId = String(body.auth_user_id || caller.id);
      const { error: updErr } = await admin
        .from("usuarios_sistema")
        .update({ auth_user_id: authId })
        .eq("id", usuarioId);
      if (updErr) {
        return json({ ok: false, error: "update_failed", detail: updErr.message }, 500);
      }
      return json({ ok: true, auth_user_id: authId, acao: "vincular" });
    }

    let authUserId = alvo.auth_user_id as string | null;

    if (authUserId) {
      const { error: updAuthErr } = await admin.auth.admin.updateUserById(authUserId, {
        email,
        password: senha,
        email_confirm: true,
      });
      if (updAuthErr) {
        return json({ ok: false, error: "auth_update_failed", detail: updAuthErr.message }, 400);
      }
    } else {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password: senha,
        email_confirm: true,
      });

      if (createErr) {
        const msg = (createErr.message || "").toLowerCase();
        if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
          const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
          const found = (listed.data?.users || []).find(
            (u) => (u.email || "").toLowerCase() === email,
          );
          if (!found) {
            return json({ ok: false, error: "email_exists_lookup_failed", detail: createErr.message }, 400);
          }
          authUserId = found.id;
          const { error: updErr2 } = await admin.auth.admin.updateUserById(authUserId, {
            password: senha,
            email_confirm: true,
          });
          if (updErr2) {
            return json({ ok: false, error: "auth_update_failed", detail: updErr2.message }, 400);
          }
        } else {
          return json({ ok: false, error: "auth_create_failed", detail: createErr.message }, 400);
        }
      } else {
        authUserId = created.user?.id ?? null;
      }

      if (!authUserId) {
        return json({ ok: false, error: "auth_user_id_missing" }, 500);
      }

      const { error: linkErr } = await admin
        .from("usuarios_sistema")
        .update({ auth_user_id: authUserId })
        .eq("id", usuarioId);
      if (linkErr) {
        return json({ ok: false, error: "link_failed", detail: linkErr.message, auth_user_id: authUserId }, 500);
      }
    }

    return json({
      ok: true,
      acao,
      auth_user_id: authUserId,
      usuario_id: usuarioId,
      requested_by: caller.id,
    });
  } catch (e) {
    return json({ ok: false, error: "exception", detail: String(e) }, 500);
  }
});

function json(obj: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
