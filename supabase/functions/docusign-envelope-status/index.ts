// ERP CENA — docusign-envelope-status (Recovery-3)
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  accountId,
  corsHeaders,
  dsAccessToken,
  dsResolveBaseUri,
  dsDiagnosticoConexao,
  json,
  type DsEnv,
} from "../_shared/docusign.ts";
import { exigirPermissaoRhModelos, registrarAuditLog } from "../_shared/cena-rh-auth.ts";
import { finalizarEnvelopeDocusign } from "../_shared/finalizar-envelope-docusign.ts";

function mapStatus(ds: string) {
  const s = String(ds || "").toLowerCase();
  if (s === "completed") return { env: "COMPLETED", doc: "ASSINADO", finalize: true };
  if (s === "declined") return { env: "DECLINED", doc: "RECUSADO", finalize: false };
  if (s === "voided") return { env: "VOIDED", doc: "CANCELADO", finalize: false };
  if (s === "sent" || s === "delivered") return { env: "AGUARDANDO", doc: "AGUARDANDO_ASSINATURA", finalize: false };
  if (s.includes("partial")) return { env: "PARCIAL", doc: "PARCIALMENTE_ASSINADO", finalize: false };
  return { env: "AGUARDANDO", doc: "AGUARDANDO_ASSINATURA", finalize: false };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders() });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ ok: false, error: "missing_authorization" }, 401);
    const userClient = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return json({ ok: false, error: "invalid_session" }, 401);
    const admin = createClient(supabaseUrl, serviceKey);
    const perm = await exigirPermissaoRhModelos(admin, userData.user);
    if (!perm.ok) return json({ ok: false, error: perm.error }, perm.http);
    const who = { usuarioId: perm.usuarioId, usuarioNome: perm.usuarioNome, perfil: perm.perfil };

    const body = await req.json();
    const acao = String(body.acao || "status");

    if (acao === "diagnostico") {
      const ambiente = (String(body.ambiente || Deno.env.get("DOCUSIGN_AMBIENTE") || "DEMO").toUpperCase() ===
        "PRODUCAO"
        ? "PRODUCAO"
        : "DEMO") as DsEnv;
      const diag = await dsDiagnosticoConexao(ambiente);
      return json({ ok: diag.oauth_ok && diag.account_ok, ...diag });
    }

    const id = String(body.envelope_id || body.documento_gerado_id || "");
    if (!id) return json({ ok: false, error: "id_obrigatorio" }, 400);

    let q = admin.from("rh_documento_envelopes").select("*").eq("ativo", true);
    if (body.envelope_id) q = q.eq("id", body.envelope_id);
    else q = q.eq("documento_gerado_id", body.documento_gerado_id);
    const { data: env } = await q.maybeSingle();
    if (!env?.provider_envelope_id || String(env.provider_envelope_id).startsWith("pending-")) {
      return json({ ok: false, error: "envelope_nao_encontrado" }, 404);
    }

    const ambiente = (env.ambiente === "PRODUCAO" ? "PRODUCAO" : "DEMO") as DsEnv;
    const token = await dsAccessToken(ambiente, { allowStatic: false });
    const apiHost = await dsResolveBaseUri(ambiente, token);
    const base = `${apiHost}/restapi/v2.1/accounts/${accountId()}/envelopes/${env.provider_envelope_id}`;

    if (acao === "void") {
      const motivo = String(body.motivo || "").trim();
      if (!motivo) return json({ ok: false, error: "motivo_obrigatorio" }, 400);
      const vr = await fetch(base, {
        method: "PUT",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ status: "voided", voidedReason: motivo.slice(0, 200) }),
      });
      const vj = await vr.json().catch(() => ({}));
      if (!vr.ok) return json({ ok: false, error: "docusign_void_failed", detail: vj }, 502);
      await admin.from("rh_documento_envelopes").update({
        status: "VOIDED",
        cancelado_em: new Date().toISOString(),
        cancelado_motivo: motivo,
        ultimo_evento_em: new Date().toISOString(),
        ativo: false,
      }).eq("id", env.id);
      await admin.from("rh_contratacao_documentos_gerados").update({
        status: "CANCELADO",
        cancelado_em: new Date().toISOString(),
        cancelado_motivo: motivo,
        cancelado_por: perm.usuarioNome,
      }).eq("id", env.documento_gerado_id);
      await registrarAuditLog(admin, "CANCELOU_ENVELOPE", "Cancelou envelope DocuSign", who, {
        envelope_id: env.id,
      });
      return json({ ok: true, acao: "void", envelope_id: env.id });
    }

    if (acao === "resend") {
      const rr = await fetch(`${base}/recipients`, {
        method: "PUT",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({
          signers: (Array.isArray(env.destinatarios_snapshot) ? env.destinatarios_snapshot : []).map(
            (d: Record<string, string>, i: number) => ({
              recipientId: String(i + 1),
              email: d.email,
              name: d.nome || d.name,
              resend: "true",
            }),
          ),
        }),
      });
      const rj = await rr.json().catch(() => ({}));
      if (!rr.ok) return json({ ok: false, error: "docusign_resend_failed", detail: rj }, 502);
      await admin.from("rh_documento_envelopes").update({
        ultimo_evento_em: new Date().toISOString(),
        tentativas: Number(env.tentativas || 0) + 1,
      }).eq("id", env.id);
      await registrarAuditLog(admin, "REENVIOU_NOTIFICACAO", "Reenviou convite DocuSign", who, {
        envelope_id: env.id,
      });
      return json({ ok: true, acao: "resend", envelope_id: env.id });
    }

    const r = await fetch(base, { headers: { Authorization: "Bearer " + token } });
    const info = await r.json();
    if (!r.ok) return json({ ok: false, error: "docusign_status_failed", detail: info }, 502);

    const mapped = mapStatus(info.status);
    await admin.from("rh_documento_envelopes").update({
      status: mapped.env,
      ultimo_evento_em: new Date().toISOString(),
      concluido_em: mapped.env === "COMPLETED" ? new Date().toISOString() : env.concluido_em,
      recusado_em: mapped.env === "DECLINED" ? new Date().toISOString() : env.recusado_em,
    }).eq("id", env.id);

    if (mapped.finalize) {
      const fin = await finalizarEnvelopeDocusign(admin, env);
      await registrarAuditLog(admin, "FINALIZOU_DOCUSIGN", "Finalizou envelope completed", who, {
        envelope_id: env.id,
        ok: fin.ok,
      });
      if (!fin.ok) {
        return json({
          ok: false,
          error: fin.error || "finalizar_failed",
          detail: fin.detail || null,
          docusign_status: info.status,
          mapped,
        }, fin.http || 502);
      }
      return json({
        ok: true,
        docusign_status: info.status,
        mapped,
        envelope_id: env.id,
        finalized: true,
        hash: fin.hash,
        status_documento: fin.status_documento,
        precisa_arquivar_dossie: fin.precisa_arquivar_dossie,
        arquivado: fin.arquivado,
      });
    }

    if (mapped.doc && mapped.doc !== "ASSINADO") {
      await admin.from("rh_contratacao_documentos_gerados").update({
        status: mapped.doc,
        canal_assinatura: "DOCUSIGN",
        provider_assinatura: "DOCUSIGN",
      }).eq("id", env.documento_gerado_id);
    }

    return json({ ok: true, docusign_status: info.status, mapped, envelope_id: env.id });
  } catch (e) {
    return json({ ok: false, error: "exception", message: e instanceof Error ? e.message : String(e) }, 500);
  }
});
