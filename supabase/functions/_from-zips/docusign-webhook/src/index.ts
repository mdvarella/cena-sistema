// ERP CENA — docusign-webhook (DocuSign Connect)
// HMAC no rawBody. recipient-completed ≠ conclusão. envelope-completed fecha sozinho.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, json, verifyConnectHmac } from "../_shared/docusign.ts";
import { finalizarEnvelopeDocusign } from "../_shared/finalizar-envelope-docusign.ts";

type Mapped = {
  env: string | null;
  doc: string | null;
  finalize: boolean;
  recipientOnly: boolean;
};

function eventName(t: string) {
  return String(t || "").toLowerCase().trim();
}

function mapEvent(t: string): Mapped | null {
  const s = eventName(t);
  if (s === "envelope-completed") {
    return { env: "COMPLETED", doc: "ASSINADO", finalize: true, recipientOnly: false };
  }
  if (s === "recipient-completed") {
    return { env: "PARCIAL", doc: "PARCIALMENTE_ASSINADO", finalize: false, recipientOnly: true };
  }
  if (s.includes("declined")) return { env: "DECLINED", doc: "RECUSADO", finalize: false, recipientOnly: false };
  if (s.includes("voided")) return { env: "VOIDED", doc: "CANCELADO", finalize: false, recipientOnly: false };
  if (s.includes("expired")) return { env: "EXPIRED", doc: "EXPIRADO", finalize: false, recipientOnly: false };
  if (s.includes("delivered")) return { env: "ENTREGUE", doc: "AGUARDANDO_ASSINATURA", finalize: false, recipientOnly: false };
  if (s.includes("sent") && !s.includes("resent")) {
    return { env: "ENVIADO", doc: "AGUARDANDO_ASSINATURA", finalize: false, recipientOnly: false };
  }
  return null;
}

function isDuplicateErr(err: { message?: string; code?: string } | null) {
  if (!err) return false;
  if (String(err.code || "") === "23505") return true;
  return String(err.message || "").toLowerCase().includes("duplicate");
}

const ENV_TERMINAL = ["COMPLETED", "DECLINED", "VOIDED", "EXPIRED", "CANCELADO"];
const DOC_TERMINAL = ["ASSINADO", "ARQUIVADO_DOSSIE", "RECUSADO", "EXPIRADO", "CANCELADO"];
const ENV_RANK: Record<string, number> = {
  CRIADO: 1,
  ENVIANDO: 2,
  ENVIADO: 3,
  ENTREGUE: 3,
  AGUARDANDO: 3,
  PARCIAL: 4,
  COMPLETED: 5,
  DECLINED: 5,
  VOIDED: 5,
  EXPIRED: 5,
  CANCELADO: 5,
  ERRO: 2,
};
const DOC_RANK: Record<string, number> = {
  ENVIANDO_DOCUSIGN: 1,
  ENVIADO_DOCUSIGN: 2,
  AGUARDANDO_ASSINATURA: 3,
  PARCIALMENTE_ASSINADO: 4,
  ASSINADO: 5,
  ARQUIVADO_DOSSIE: 6,
};

function podeAvancarEnvelope(atual: string, proximo: string | null) {
  if (!proximo) return false;
  if (atual === proximo) return true;
  if (ENV_TERMINAL.includes(atual) && !["DECLINED", "VOIDED", "EXPIRED", "CANCELADO"].includes(proximo)) {
    return false;
  }
  const ra = ENV_RANK[atual] || 0;
  const rp = ENV_RANK[proximo] || 0;
  if (ra && rp && rp < ra) return false;
  return true;
}

function podeAvancarDoc(atual: string, proximo: string | null) {
  if (!proximo) return false;
  if (atual === proximo) return false;
  if (DOC_TERMINAL.includes(atual) && !["RECUSADO", "EXPIRADO", "CANCELADO"].includes(proximo)) {
    return false;
  }
  const ra = DOC_RANK[atual] || 0;
  const rp = DOC_RANK[proximo] || 0;
  if (ra && rp && rp < ra) return false;
  return true;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders() });
  try {
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    if (!serviceKey) return json({ ok: false, error: "service_role_not_configured" }, 503);
    const admin = createClient(supabaseUrl, serviceKey);

    const raw = await req.text();
    const sig = req.headers.get("X-DocuSign-Signature-1") || req.headers.get("x-docusign-signature-1");
    const ver = await verifyConnectHmac(raw, sig);
    if (!ver.ok) return json({ ok: false, error: "invalid_hmac" }, 401);

    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(raw);
    } catch {
      return json({ ok: false, error: "invalid_json" }, 400);
    }

    const envelopeIdDs = String(
      (payload.data as Record<string, unknown>)?.envelopeId ||
        payload.envelopeId ||
        (payload.EnvelopeStatus as Record<string, unknown>)?.EnvelopeID ||
        "",
    );
    const eventType = String(
      payload.event || payload.eventType || (payload.EnvelopeStatus as Record<string, unknown>)?.Status || "",
    );
    const providerEventId = String(
      payload.generation || payload.messageId || `${envelopeIdDs}:${eventType}:${payload.generatedDateTime || ""}`,
    );

    if (!envelopeIdDs) return json({ ok: false, error: "envelopeId_ausente" }, 400);

    const { data: env } = await admin
      .from("rh_documento_envelopes")
      .select("*")
      .eq("provider_envelope_id", envelopeIdDs)
      .eq("ativo", true)
      .order("criado_em", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!env) return json({ ok: true, ignored: true, reason: "envelope_desconhecido" });

    const { error: dupErr } = await admin.from("rh_documento_envelope_eventos").insert({
      envelope_id: env.id,
      provider_event_id: providerEventId.slice(0, 200),
      event_type: eventType || "unknown",
      payload_resumo: {
        event: eventType,
        envelopeId: envelopeIdDs,
      },
    });
    const duplicateEvent = isDuplicateErr(dupErr);
    if (dupErr && !duplicateEvent) {
      return json({ ok: false, error: "evento_persist_failed", detail: dupErr.message }, 500);
    }

    const mapped = mapEvent(eventType);
    const agora = new Date().toISOString();

    if (mapped) {
      const envPatch: Record<string, unknown> = { ultimo_evento_em: agora };
      if (mapped.recipientOnly) {
        if (podeAvancarEnvelope(String(env.status || ""), mapped.env)) {
          envPatch.status = mapped.env;
        }
      } else if (podeAvancarEnvelope(String(env.status || ""), mapped.env) && mapped.env) {
        envPatch.status = mapped.env;
        if (mapped.env === "COMPLETED") envPatch.concluido_em = agora;
        if (mapped.env === "DECLINED") envPatch.recusado_em = agora;
        if (mapped.env === "EXPIRED") envPatch.expirado_em = agora;
        if (mapped.env === "VOIDED") envPatch.cancelado_em = agora;
      }
      await admin.from("rh_documento_envelopes").update(envPatch).eq("id", env.id);

      if (mapped.doc) {
        const { data: docAtual } = await admin
          .from("rh_contratacao_documentos_gerados")
          .select("id,status")
          .eq("id", env.documento_gerado_id)
          .maybeSingle();
        if (docAtual && podeAvancarDoc(String(docAtual.status || ""), mapped.doc)) {
          const docPatch: Record<string, unknown> = {
            status: mapped.doc,
            provider_assinatura: "DOCUSIGN",
          };
          if (mapped.doc === "ASSINADO") {
            docPatch.assinado_em = agora;
            docPatch.canal_assinatura = "DOCUSIGN";
          }
          if (mapped.doc === "RECUSADO") docPatch.recusado_em = agora;
          await admin.from("rh_contratacao_documentos_gerados").update(docPatch).eq("id", env.documento_gerado_id);
        }
      }
    }

    if (mapped?.finalize) {
      const fin = await finalizarEnvelopeDocusign(admin, env);
      if (!fin.ok) {
        return json({
          ok: false,
          error: fin.error || "finalizar_failed",
          detail: fin.detail || null,
          envelope_id: env.id,
          event: eventType,
          duplicate: duplicateEvent,
        }, fin.http || 502);
      }
      return json({
        ok: true,
        envelope_id: env.id,
        event: eventType,
        mapped,
        finalized: true,
        duplicate: duplicateEvent,
        arquivado: fin.arquivado,
        status_documento: fin.status_documento,
        certificado_pendente: fin.certificado_pendente || false,
      });
    }

    if (duplicateEvent) return json({ ok: true, duplicate: true, envelope_id: env.id, event: eventType });

    return json({ ok: true, envelope_id: env.id, event: eventType, mapped });
  } catch (e) {
    return json({ ok: false, error: "exception", message: e instanceof Error ? e.message : String(e) }, 500);
  }
});
