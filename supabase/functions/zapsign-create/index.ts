// ERP CENA — zapsign-create (ZAPSIGN-CORE-2A SANDBOX)
// Não altera Edges DocuSign. Sem e-mail/WhatsApp/webhook.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { json } from "../_shared/zapsign.ts";
import { exigirPermissaoRhModelos, registrarAuditLog } from "../_shared/cena-rh-auth.ts";
import {
  PROVIDER_ZAPSIGN,
  documentoAptoParaCreate,
  envelopeAtivo,
  envelopeRemotoCriado,
  externalIdZapSign,
  metadataAssinaturaSegura,
  nomeDocumentoZapSign,
  obterPdfCanonicoDeDocumento,
  pendingZapsignId,
  pdfRespeitaLimite,
  providerCongelado,
  sanitizarLog,
  sha256HexBytes,
} from "../_shared/signature-core.ts";
import {
  bytesParaBase64Pdf,
  extrairDocToken,
  montarPayloadCreate,
  signerTecnicoSandbox,
  zapsignBuscarPorExternalId,
  zapsignPostDocs,
  zapsignToken,
} from "../_shared/zapsign.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true }, 200);
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

    const body = await req.json().catch(() => ({}));
    const docId = String((body as { documento_gerado_id?: string }).documento_gerado_id || "");
    if (!docId) return json({ ok: false, error: "documento_gerado_id_obrigatorio" }, 400);

    const { data: doc, error: docErr } = await admin
      .from("rh_contratacao_documentos_gerados")
      .select("id,status,conteudo_html,snapshot_tokens,hash_sha256,arquivo_path,formato,modelo_codigo,versao,contratacao_id,colaborador_id,provider_assinatura")
      .eq("id", docId)
      .maybeSingle();
    if (docErr || !doc) return json({ ok: false, error: "documento_nao_encontrado" }, 404);
    if (!documentoAptoParaCreate(String(doc.status))) {
      return json({ ok: false, error: "status_nao_permite_envio", status: doc.status }, 409);
    }

    const { data: existentes } = await admin
      .from("rh_documento_envelopes")
      .select("id,provider,provider_envelope_id,status,ativo,metadata")
      .eq("documento_gerado_id", docId)
      .eq("ativo", true);

    const congelado = providerCongelado(existentes || []);
    if (congelado && congelado !== PROVIDER_ZAPSIGN) {
      return json({
        ok: false,
        error: "provider_congelado",
        provider: congelado,
        message: "Envelope já criado em outro provider. Fallback só antes do create.",
      }, 409);
    }

    const ativosRemotos = (existentes || []).filter((e) =>
      envelopeAtivo(e) && envelopeRemotoCriado(e) && String(e.provider) === PROVIDER_ZAPSIGN
    );
    if (ativosRemotos.length) {
      return json({
        ok: false,
        error: "envelope_ativo_existente",
        message: "Já existe envelope ZapSign ativo.",
        envelope: ativosRemotos[0],
      }, 409);
    }

    const pendingId = pendingZapsignId(docId);
    let envRow = (existentes || []).find((e) =>
      String(e.provider) === PROVIDER_ZAPSIGN && String(e.provider_envelope_id || "").startsWith("pending-")
    ) || null;

    const externalId = externalIdZapSign(docId);
    if (!envRow) {
      const ins = await admin.from("rh_documento_envelopes").insert({
        documento_gerado_id: docId,
        contratacao_id: doc.contratacao_id || null,
        colaborador_id: doc.colaborador_id || null,
        provider: PROVIDER_ZAPSIGN,
        provider_envelope_id: pendingId,
        status: "ENVIANDO",
        ambiente: "DEMO",
        canal_envio: "MANUAL",
        destinatarios_snapshot: [signerTecnicoSandbox()],
        enviado_por: perm.usuarioNome,
        ultimo_evento_em: new Date().toISOString(),
        ativo: true,
        metadata: metadataAssinaturaSegura({
          provider: PROVIDER_ZAPSIGN,
          external_id: externalId,
          sandbox: true,
        }),
      }).select("*").maybeSingle();
      if (ins.error || !ins.data) {
        await registrarAuditLog(admin, "ERRO_ZAPSIGN", "Falha ao preparar envelope pending", who, {
          documento_gerado_id: docId,
        });
        return json({ ok: false, error: "persist_envelope_failed", detail: ins.error?.message }, 500);
      }
      envRow = ins.data;
    }

    const pdf = await obterPdfCanonicoDeDocumento(doc);
    if (!pdf.ok) {
      await admin.from("rh_documento_envelopes").update({
        status: "ERRO",
        erro_codigo: "BLOQUEIO_PDF",
        erro_detalhe: pdf.message.slice(0, 300),
        metadata: metadataAssinaturaSegura({
          provider: PROVIDER_ZAPSIGN,
          external_id: externalId,
          sandbox: true,
          bloqueio: "BLOQUEIO_PDF",
        }),
      }).eq("id", envRow.id);
      await registrarAuditLog(admin, "ERRO_ZAPSIGN", "BLOQUEIO PDF — renderer canônico ausente", who, {
        documento_gerado_id: docId,
      });
      return json({
        ok: false,
        error: "BLOQUEIO_PDF",
        message: pdf.message,
        envelope_id: envRow.id,
        hash_sha256_html: doc.hash_sha256 || null,
      }, 503);
    }
    if (!pdfRespeitaLimite(pdf.bytes)) {
      return json({ ok: false, error: "pdf_excede_limite" }, 400);
    }

    const pdfHash = pdf.pdf_input_hash || await sha256HexBytes(pdf.bytes);
    if (!zapsignToken()) {
      return json({ ok: false, error: "zapsign_token_ausente" }, 503);
    }

    const payload = montarPayloadCreate({
      name: nomeDocumentoZapSign(doc),
      base64_pdf: bytesParaBase64Pdf(pdf.bytes),
      external_id: externalId,
      signer: signerTecnicoSandbox(),
    });

    const posted = await zapsignPostDocs(payload as unknown as Record<string, unknown>);
    if (!posted.ok) {
      await admin.from("rh_documento_envelopes").update({
        status: "ERRO",
        erro_codigo: "zapsign_create_failed",
        erro_detalhe: String(posted.status).slice(0, 80),
        metadata: metadataAssinaturaSegura({
          provider: PROVIDER_ZAPSIGN,
          external_id: externalId,
          pdf_input_hash: pdfHash,
          sandbox: true,
          http_status: posted.status,
          erro: "zapsign_create_failed",
        }),
      }).eq("id", envRow.id);
      await registrarAuditLog(admin, "ERRO_ZAPSIGN", "HTTP ZapSign recuperável", who, {
        documento_gerado_id: docId,
        http_status: posted.status,
      });
      return json({
        ok: false,
        error: "zapsign_create_failed",
        http_status: posted.status,
        recuperavel: true,
      }, 502);
    }

    const docToken = extrairDocToken(posted.json);
    if (!docToken) {
      const rec = await zapsignBuscarPorExternalId(externalId);
      if (!rec.ok || !rec.doc_token) {
        await admin.from("rh_documento_envelopes").update({
          status: "ERRO",
          erro_codigo: "BLOQUEIO_RECUPERACAO_EXTERNAL_ID",
          erro_detalhe: "create remoto sem doc_token local",
          metadata: metadataAssinaturaSegura({
            provider: PROVIDER_ZAPSIGN,
            external_id: externalId,
            pdf_input_hash: pdfHash,
            sandbox: true,
            bloqueio: "BLOQUEIO_RECUPERACAO_EXTERNAL_ID",
          }),
        }).eq("id", envRow.id);
        return json({
          ok: false,
          error: "BLOQUEIO_RECUPERACAO_EXTERNAL_ID",
          message: "ZapSign pode ter criado o documento. Não repetir POST. Recuperar por external_id em fase posterior.",
          external_id: externalId,
        }, 409);
      }
    }

    const tokenFinal = docToken || "";
    const upd = await admin.from("rh_documento_envelopes").update({
      provider_envelope_id: tokenFinal,
      status: "ENVIADO",
      enviado_em: new Date().toISOString(),
      ultimo_evento_em: new Date().toISOString(),
      erro_codigo: null,
      erro_detalhe: null,
      metadata: metadataAssinaturaSegura({
        provider: PROVIDER_ZAPSIGN,
        external_id: externalId,
        pdf_input_hash: pdfHash,
        sandbox: true,
        origem_pdf: pdf.origem,
        doc_token_presente: true,
      }),
    }).eq("id", envRow.id).select("*").maybeSingle();

    if (upd.error || !upd.data) {
      await registrarAuditLog(admin, "ERRO_ZAPSIGN", "Create remoto ok; persistência falhou — não repetir POST", who, {
        documento_gerado_id: docId,
      });
      return json({
        ok: false,
        error: "persist_envelope_failed",
        bloqueio: "nao_repetir_post",
        external_id: externalId,
      }, 500);
    }

    await admin.from("rh_contratacao_documentos_gerados").update({
      status: "AGUARDANDO_ASSINATURA",
      provider_assinatura: PROVIDER_ZAPSIGN,
      envelope_id: envRow.id,
    }).eq("id", docId);

    await registrarAuditLog(admin, "ENVIOU_ZAPSIGN", "Create sandbox ZapSign", who, {
      documento_gerado_id: docId,
      envelope_id: envRow.id,
    });

    return json({
      ok: true,
      provider: PROVIDER_ZAPSIGN,
      ambiente: "SANDBOX",
      external_id: externalId,
      provider_envelope_id: tokenFinal,
      envelope: sanitizarLog(upd.data),
      hash_sha256_html: doc.hash_sha256 || null,
      pdf_input_hash: pdfHash,
    });
  } catch (e) {
    return json({
      ok: false,
      error: "exception",
      message: e instanceof Error ? e.message : "erro",
    }, 500);
  }
});
