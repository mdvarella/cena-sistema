// ERP CENA — docusign-create-envelope
// Cria envelope DocuSign a partir de documento GERADO/APROVADO (RH-2C/2D).
// Deploy: supabase functions deploy docusign-create-envelope --no-verify-jwt
// Auth: JWT usuário (Bearer). Service role só no servidor.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  accountId,
  corsHeaders,
  dsAccessToken,
  dsBaseUri,
  json,
  smsEnabledConfig,
  type DsEnv,
} from "../_shared/docusign.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders() });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ ok: false, error: "missing_authorization" }, 401);
    }
    if (!serviceKey) return json({ ok: false, error: "service_role_not_configured" }, 503);

    const userClient = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ ok: false, error: "invalid_session" }, 401);
    }
    const admin = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const docId = String(body.documento_gerado_id || "");
    const canal = String(body.canal_envio || "EMAIL");
    const ambiente = (String(body.ambiente || Deno.env.get("DOCUSIGN_AMBIENTE") || "DEMO").toUpperCase() ===
      "PRODUCAO"
      ? "PRODUCAO"
      : "DEMO") as DsEnv;
    const destinatarios = Array.isArray(body.destinatarios) ? body.destinatarios : [];
    const mensagem = String(body.mensagem || "").slice(0, 500);

    if (!docId) return json({ ok: false, error: "documento_gerado_id_obrigatorio" }, 400);
    if (!["EMAIL", "SMS", "EMAIL_SMS"].includes(canal)) {
      return json({ ok: false, error: "canal_invalido" }, 400);
    }
    if ((canal === "SMS" || canal === "EMAIL_SMS") && !smsEnabledConfig()) {
      return json({
        ok: false,
        error: "sms_indisponivel",
        message: "Envio por SMS não disponível nesta conta DocuSign.",
      }, 400);
    }

    const { data: doc, error: docErr } = await admin
      .from("rh_contratacao_documentos_gerados")
      .select("*")
      .eq("id", docId)
      .maybeSingle();
    if (docErr || !doc) return json({ ok: false, error: "documento_nao_encontrado" }, 404);
    if (!["APROVADO_PARA_ASSINATURA", "ERRO_ASSINATURA"].includes(String(doc.status))) {
      return json({ ok: false, error: "status_nao_permite_envio", status: doc.status }, 409);
    }

    // Idempotência: envelope ativo existente
    const { data: existentes } = await admin
      .from("rh_documento_envelopes")
      .select("id,provider_envelope_id,status")
      .eq("documento_gerado_id", docId)
      .eq("ativo", true)
      .not("status", "in", "(CANCELADO,VOIDED,EXPIRED,DECLINED,COMPLETED,ERRO)");
    if (existentes && existentes.length) {
      return json({
        ok: false,
        error: "envelope_ativo_existente",
        message: "Documento já enviado para assinatura.",
        envelope: existentes[0],
      }, 409);
    }

    for (const d of destinatarios) {
      if (canal === "EMAIL" || canal === "EMAIL_SMS") {
        if (!String(d.email || "").trim()) {
          return json({ ok: false, error: "email_obrigatorio" }, 400);
        }
      }
      if (canal === "SMS" || canal === "EMAIL_SMS") {
        if (!String(d.telefone || "").replace(/\D/g, "")) {
          return json({ ok: false, error: "telefone_obrigatorio" }, 400);
        }
      }
    }
    if (!destinatarios.length) {
      return json({ ok: false, error: "destinatarios_obrigatorios" }, 400);
    }

    await admin.from("rh_contratacao_documentos_gerados").update({
      status: "ENVIANDO_DOCUSIGN",
      provider_assinatura: "DOCUSIGN",
    }).eq("id", docId);

    const html = String(doc.conteudo_html || "");
    if (!html && !doc.arquivo_path) {
      await admin.from("rh_contratacao_documentos_gerados").update({ status: "ERRO_ASSINATURA" }).eq("id", docId);
      return json({ ok: false, error: "documento_sem_conteudo" }, 400);
    }

    // Artefato: HTML (DocuSign pode converter em contas habilitadas). Preferir PDF se arquivo_path terminar .pdf.
    let documentBase64 = btoa(unescape(encodeURIComponent(html || "<html><body>Documento CENA</body></html>")));
    let fileExt = "html";
    let mime = "text/html";
    if (doc.arquivo_path && String(doc.arquivo_path).toLowerCase().endsWith(".pdf")) {
      const path = String(doc.arquivo_path).replace(/^\/+/, "");
      const dl = await admin.storage.from("cena-docs").download(path);
      if (dl.data) {
        const buf = await dl.data.arrayBuffer();
        documentBase64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
        fileExt = "pdf";
        mime = "application/pdf";
      }
    }

    const token = await dsAccessToken(ambiente);
    const acc = accountId();
    const base = dsBaseUri(ambiente);

    const signers = destinatarios.map((d: Record<string, string>, i: number) => {
      const signer: Record<string, unknown> = {
        email: String(d.email || "noreply@invalid.local"),
        name: String(d.nome || "Assinante"),
        recipientId: String(i + 1),
        routingOrder: String(d.ordem || i + 1),
        tabs: {
          signHereTabs: [
            {
              anchorString: d.papel === "EMPRESA"
                ? "[[ASSINATURA_EMPRESA]]"
                : d.papel === "TESTEMUNHA"
                ? "[[ASSINATURA_TESTEMUNHA]]"
                : "[[ASSINATURA_EMPREGADO]]",
              anchorUnits: "pixels",
              anchorXOffset: "0",
              anchorYOffset: "0",
              anchorIgnoreIfNotPresent: "true",
            },
          ],
          dateSignedTabs: [
            {
              anchorString: "[[DATA_ASSINATURA]]",
              anchorUnits: "pixels",
              anchorIgnoreIfNotPresent: "true",
            },
          ],
        },
      };
      if ((canal === "SMS" || canal === "EMAIL_SMS") && d.telefone) {
        signer.additionalNotifications = [
          {
            secondaryDeliveryMethod: "SMS",
            phoneNumber: {
              countryCode: String(d.pais || "55"),
              number: String(d.telefone).replace(/\D/g, ""),
            },
          },
        ];
      }
      return signer;
    });

    const envelopeDef = {
      emailSubject: String(body.assunto || ("Assinatura: " + (doc.tipo_documento || doc.modelo_codigo))),
      emailBlurb: mensagem || "Documento enviado pelo ERP CENA para assinatura digital.",
      status: "sent",
      documents: [
        {
          documentBase64,
          name: String(doc.arquivo_nome || (doc.modelo_codigo + "." + fileExt)),
          fileExtension: fileExt,
          documentId: "1",
        },
      ],
      recipients: { signers },
    };

    const r = await fetch(`${base}/restapi/v2.1/accounts/${acc}/envelopes`, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(envelopeDef),
    });
    const resp = await r.json().catch(() => ({}));
    if (!r.ok) {
      await admin.from("rh_contratacao_documentos_gerados").update({
        status: "ERRO_ASSINATURA",
      }).eq("id", docId);
      return json({
        ok: false,
        error: "docusign_create_failed",
        detail: resp.message || resp.errorCode || r.status,
        mime,
      }, 502);
    }

    const envelopeIdDs = String(resp.envelopeId || "");
    const { data: envRow, error: envErr } = await admin.from("rh_documento_envelopes").insert({
      documento_gerado_id: docId,
      contratacao_id: doc.contratacao_id || null,
      colaborador_id: doc.colaborador_id || null,
      provider: "DOCUSIGN",
      provider_envelope_id: envelopeIdDs,
      status: "ENVIADO",
      ambiente,
      canal_envio: canal,
      destinatarios_snapshot: destinatarios,
      enviado_em: new Date().toISOString(),
      enviado_por: userData.user.email || userData.user.id,
      ultimo_evento_em: new Date().toISOString(),
      ativo: true,
    }).select("*").maybeSingle();

    if (envErr || !envRow) {
      return json({ ok: false, error: "persist_envelope_failed", detail: envErr?.message }, 500);
    }

    await admin.from("rh_contratacao_documentos_gerados").update({
      status: "AGUARDANDO_ASSINATURA",
      envelope_id: envRow.id,
      provider_assinatura: "DOCUSIGN",
      canal_assinatura: "DOCUSIGN",
    }).eq("id", docId);

    return json({
      ok: true,
      envelope: envRow,
      provider_envelope_id: envelopeIdDs,
    });
  } catch (e) {
    return json({
      ok: false,
      error: "exception",
      message: e instanceof Error ? e.message : String(e),
    }, 500);
  }
});
