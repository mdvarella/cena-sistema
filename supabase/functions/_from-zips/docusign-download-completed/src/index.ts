// ERP CENA — docusign-download-completed
// Contingência manual/idempotente. Mesmo helper do webhook (envelope-completed).
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders, json } from "../_shared/docusign.ts";
import { finalizarEnvelopeDocusign } from "../_shared/finalizar-envelope-docusign.ts";

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
    const body = await req.json();
    const envelopeRowId = String(body.envelope_id || "");
    if (!envelopeRowId) return json({ ok: false, error: "envelope_id_obrigatorio" }, 400);

    const { data: env } = await admin.from("rh_documento_envelopes").select("*").eq("id", envelopeRowId).maybeSingle();
    if (!env?.provider_envelope_id) return json({ ok: false, error: "envelope_nao_encontrado" }, 404);

    const fin = await finalizarEnvelopeDocusign(admin, env);
    if (!fin.ok) {
      return json({
        ok: false,
        error: fin.error || "finalizar_failed",
        detail: fin.detail || null,
      }, fin.http || 500);
    }

    return json({
      ok: true,
      already: fin.already || false,
      arquivo_assinado_path: fin.arquivo_assinado_path,
      certificado_path: fin.certificado_path,
      hash: fin.hash,
      colaborador_id: fin.colaborador_id,
      precisa_arquivar_dossie: !!fin.precisa_arquivar_dossie,
      arquivado: !!fin.arquivado,
      dossie_documento_id: fin.dossie_documento_id || null,
      status_documento: fin.status_documento,
      certificado_pendente: fin.certificado_pendente || false,
    });
  } catch (e) {
    return json({ ok: false, error: "exception", message: e instanceof Error ? e.message : String(e) }, 500);
  }
});
