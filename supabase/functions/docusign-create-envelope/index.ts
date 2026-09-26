// ERP CENA — docusign-create-envelope (Recovery-3)
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  accountId,
  corsHeaders,
  dsAccessToken,
  dsResolveBaseUri,
  json,
  smsEnabledConfig,
  type DsEnv,
} from "../_shared/docusign.ts";
import { exigirPermissaoRhModelos, registrarAuditLog } from "../_shared/cena-rh-auth.ts";
import { validarAnchorsHtml, anchorAssinaturaPorPapel } from "../_shared/docusign-anchors.ts";

function pendingProviderId(docId: string) {
  return "pending-" + docId;
}

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
    const perm = await exigirPermissaoRhModelos(admin, userData.user);
    if (!perm.ok) return json({ ok: false, error: perm.error }, perm.http);
    const who = { usuarioId: perm.usuarioId, usuarioNome: perm.usuarioNome, perfil: perm.perfil };

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

    const { data: existentes } = await admin
      .from("rh_documento_envelopes")
      .select("id,provider_envelope_id,status")
      .eq("documento_gerado_id", docId)
      .eq("ativo", true)
      .not("status", "in", "(CANCELADO,VOIDED,EXPIRED,DECLINED,COMPLETED,ERRO)");
    const ativos = (existentes || []).filter((e) => {
      const pid = String(e.provider_envelope_id || "");
      return pid && !pid.startsWith("pending-");
    });
    if (ativos.length) {
      return json({
        ok: false,
        error: "envelope_ativo_existente",
        message: "Documento já enviado para assinatura.",
        envelope: ativos[0],
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

    const html = String(doc.conteudo_html || "");
    const anchors = validarAnchorsHtml(html, destinatarios, { exigirData: true });
    if (!anchors.ok) {
      return json({
        ok: false,
        error: anchors.error,
        marker: anchors.marker,
        papel: anchors.papel || null,
        modelo_codigo: doc.modelo_codigo || null,
        documento_gerado_id: docId,
        message: "Marcador de assinatura ausente no HTML gerado: " + anchors.marker,
      }, 400);
    }

    if (!html && !doc.arquivo_path) {
      await admin.from("rh_contratacao_documentos_gerados").update({ status: "ERRO_ASSINATURA" }).eq("id", docId);
      return json({ ok: false, error: "documento_sem_conteudo" }, 400);
    }

    const pendingId = pendingProviderId(docId);
    let envRow = (existentes || []).find((e) => String(e.provider_envelope_id || "").startsWith("pending-")) || null;
    if (!envRow) {
      const ins = await admin.from("rh_documento_envelopes").insert({
        documento_gerado_id: docId,
        contratacao_id: doc.contratacao_id || null,
        colaborador_id: doc.colaborador_id || null,
        provider: "DOCUSIGN",
        provider_envelope_id: pendingId,
        status: "ENVIANDO",
        ambiente,
        canal_envio: canal,
        destinatarios_snapshot: destinatarios,
        enviado_por: perm.usuarioNome,
        ultimo_evento_em: new Date().toISOString(),
        ativo: true,
      }).select("*").maybeSingle();
      if (ins.error || !ins.data) {
        await registrarAuditLog(admin, "ERRO_DOCUSIGN", "Falha ao preparar envelope local", who, {
          documento_gerado_id: docId,
        });
        return json({ ok: false, error: "persist_envelope_failed", detail: ins.error?.message }, 500);
      }
      envRow = ins.data;
    }

    await admin.from("rh_contratacao_documentos_gerados").update({
      status: "ENVIANDO_DOCUSIGN",
      provider_assinatura: "DOCUSIGN",
      envelope_id: envRow.id,
    }).eq("id", docId);

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

    const token = await dsAccessToken(ambiente, { allowStatic: false });
    const acc = accountId();
    const base = await dsResolveBaseUri(ambiente, token);

    const signers = destinatarios.map((d: Record<string, string>, i: number) => {
      const signer: Record<string, unknown> = {
        email: String(d.email || "noreply@invalid.local"),
        name: String(d.nome || "Assinante"),
        recipientId: String(i + 1),
        routingOrder: String(d.ordem || i + 1),
        tabs: {
          signHereTabs: [
            {
              anchorString: anchorAssinaturaPorPapel(d.papel),
              anchorUnits: "pixels",
              anchorXOffset: "0",
              anchorYOffset: "0",
              anchorIgnoreIfNotPresent: "false",
            },
          ],
          dateSignedTabs: [
            {
              anchorString: "[[DATA_ASSINATURA]]",
              anchorUnits: "pixels",
              anchorIgnoreIfNotPresent: "false",
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
      await admin.from("rh_documento_envelopes").update({
        status: "ERRO",
        ativo: false,
        erro_codigo: "docusign_create_failed",
        erro_detalhe: String(resp.message || resp.errorCode || r.status).slice(0, 300),
      }).eq("id", envRow.id);
      await admin.from("rh_contratacao_documentos_gerados").update({
        status: "ERRO_ASSINATURA",
      }).eq("id", docId);
      await registrarAuditLog(admin, "ERRO_DOCUSIGN", "DocuSign recusou create-envelope", who, {
        documento_gerado_id: docId,
      });
      return json({
        ok: false,
        error: "docusign_create_failed",
        detail: resp.message || resp.errorCode || r.status,
        mime,
      }, 502);
    }

    const envelopeIdDs = String(resp.envelopeId || "");
    const upd = await admin.from("rh_documento_envelopes").update({
      provider_envelope_id: envelopeIdDs,
      status: "ENVIADO",
      enviado_em: new Date().toISOString(),
      ultimo_evento_em: new Date().toISOString(),
      erro_codigo: null,
      erro_detalhe: null,
    }).eq("id", envRow.id).select("*").maybeSingle();

    if (upd.error || !upd.data) {
      let voided = false;
      try {
        const vr = await fetch(`${base}/restapi/v2.1/accounts/${acc}/envelopes/${envelopeIdDs}`, {
          method: "PUT",
          headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
          body: JSON.stringify({ status: "voided", voidedReason: "CENA persist_envelope_failed" }),
        });
        voided = vr.ok;
      } catch {
        voided = false;
      }
      await admin.from("rh_documento_envelopes").update({
        status: "ERRO",
        ativo: false,
        erro_codigo: "persist_envelope_failed",
        erro_detalhe: "create_ok persist_fail void=" + String(voided),
      }).eq("id", envRow.id);
      await admin.from("rh_contratacao_documentos_gerados").update({ status: "ERRO_ASSINATURA" }).eq("id", docId);
      await registrarAuditLog(admin, "ERRO_DOCUSIGN", "Persistência falhou após create; void compensatório", who, {
        documento_gerado_id: docId,
        voided,
      });
      return json({
        ok: false,
        error: "persist_envelope_failed",
        compensated_void: voided,
      }, 500);
    }

    await admin.from("rh_contratacao_documentos_gerados").update({
      status: "AGUARDANDO_ASSINATURA",
      envelope_id: envRow.id,
      provider_assinatura: "DOCUSIGN",
      canal_assinatura: "DOCUSIGN",
    }).eq("id", docId);

    await registrarAuditLog(admin, "ENVIOU_DOCUSIGN", "Enviou documento para DocuSign", who, {
      documento_gerado_id: docId,
      envelope_id: envRow.id,
    });

    return json({
      ok: true,
      envelope: upd.data,
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
