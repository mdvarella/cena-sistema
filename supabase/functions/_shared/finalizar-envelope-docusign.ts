// ERP CENA — fecha envelope DocuSign (PDF + certificado + hash + Dossiê).
// Server-side only. Sem secrets no retorno. Idempotente.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  accountId,
  BUCKET_RH_ASSINADOS,
  DOSSIE_REF_ASSINATURA,
  dsAccessToken,
  dsResolveBaseUri,
  sha256Hex,
  type DsEnv,
} from "./docusign.ts";
import { registrarAuditLog } from "./cena-rh-auth.ts";

export type FinalizarEnvelopeResult = {
  ok: boolean;
  already?: boolean;
  arquivo_assinado_path?: string | null;
  certificado_path?: string | null;
  hash?: string | null;
  colaborador_id?: string | null;
  precisa_arquivar_dossie?: boolean;
  arquivado?: boolean;
  dossie_documento_id?: string | null;
  status_documento?: string;
  certificado_pendente?: boolean;
  error?: string;
  detail?: string;
  http?: number;
};

type Admin = SupabaseClient;

function categoriaDossie(origemContexto: string | null | undefined) {
  const o = String(origemContexto || "").toUpperCase();
  if (o === "DESLIGAMENTO") return "DESLIGAMENTO";
  if (o === "EVENTUAL") return "EVENTUAL";
  return "ADMISSIONAL";
}

async function resolverColaboradorId(admin: Admin, env: Record<string, unknown>) {
  let colabId = env.colaborador_id ? String(env.colaborador_id) : "";
  if (colabId) return colabId;
  const docId = env.documento_gerado_id ? String(env.documento_gerado_id) : "";
  if (docId) {
    const { data: doc } = await admin
      .from("rh_contratacao_documentos_gerados")
      .select("colaborador_id")
      .eq("id", docId)
      .maybeSingle();
    if (doc?.colaborador_id) return String(doc.colaborador_id);
  }
  if (env.contratacao_id) {
    const { data: ct } = await admin
      .from("rh_contratacoes")
      .select("colaborador_id")
      .eq("id", String(env.contratacao_id))
      .maybeSingle();
    if (ct?.colaborador_id) return String(ct.colaborador_id);
  }
  return "";
}

async function baixarEPersistirArquivos(
  admin: Admin,
  env: Record<string, unknown>,
): Promise<
  | { ok: true; pdfPath: string; certPath: string | null; hash: string; certPendente: boolean; certDetalhe: string | null }
  | { ok: false; error: string; detail: string; http: number }
> {
  const hashExistente = env.hash_documento_final ? String(env.hash_documento_final) : "";
  const pdfExistente = env.arquivo_assinado_path ? String(env.arquivo_assinado_path) : "";
  if (hashExistente && pdfExistente) {
    return {
      ok: true,
      pdfPath: pdfExistente,
      certPath: env.certificado_path ? String(env.certificado_path) : null,
      hash: hashExistente,
      certPendente: !env.certificado_path,
      certDetalhe: env.certificado_path ? null : "certificado_ausente_ja_consolidado",
    };
  }

  const ambiente = (env.ambiente === "PRODUCAO" ? "PRODUCAO" : "DEMO") as DsEnv;
  const token = await dsAccessToken(ambiente, { allowStatic: false });
  const apiHost = await dsResolveBaseUri(ambiente, token);
  const base = `${apiHost}/restapi/v2.1/accounts/${accountId()}/envelopes/${env.provider_envelope_id}`;

  const pdfRes = await fetch(`${base}/documents/combined`, {
    headers: { Authorization: "Bearer " + token, Accept: "application/pdf" },
  });
  if (!pdfRes.ok) {
    return {
      ok: false,
      error: "download_pdf_failed",
      detail: "HTTP " + pdfRes.status,
      http: 502,
    };
  }
  const pdfBuf = await pdfRes.arrayBuffer();
  const hash = await sha256Hex(pdfBuf);

  const certRes = await fetch(`${base}/documents/certificate`, {
    headers: { Authorization: "Bearer " + token, Accept: "application/pdf" },
  });
  let certBuf: ArrayBuffer | null = null;
  let certPendente = false;
  let certDetalhe: string | null = null;
  if (certRes.ok) certBuf = await certRes.arrayBuffer();
  else {
    certPendente = true;
    certDetalhe = "download_certificado HTTP " + certRes.status;
  }

  const colab = env.colaborador_id || "sem-colaborador";
  const pdfPath = `rh/docusign/${colab}/${env.id}/assinado.pdf`;
  const certPath = `rh/docusign/${colab}/${env.id}/certificado.pdf`;

  const upPdf = await admin.storage.from(BUCKET_RH_ASSINADOS).upload(pdfPath, new Uint8Array(pdfBuf), {
    contentType: "application/pdf",
    upsert: true,
  });
  if (upPdf.error) {
    return {
      ok: false,
      error: "storage_pdf_failed",
      detail: upPdf.error.message,
      http: 500,
    };
  }

  let certPathFinal: string | null = null;
  if (certBuf) {
    const upCert = await admin.storage.from(BUCKET_RH_ASSINADOS).upload(certPath, new Uint8Array(certBuf), {
      contentType: "application/pdf",
      upsert: true,
    });
    if (upCert.error) {
      certPendente = true;
      certDetalhe = "storage_certificado_failed";
    } else {
      certPathFinal = certPath;
    }
  }

  return { ok: true, pdfPath, certPath: certPathFinal, hash, certPendente, certDetalhe };
}

async function garantirDossie(
  admin: Admin,
  env: Record<string, unknown>,
  doc: Record<string, unknown>,
  arquivos: { pdfPath: string; certPath: string | null; hash: string },
  colabId: string,
): Promise<
  | { ok: true; dossieId: string; reused: boolean }
  | { ok: false; error: string; detail: string; http: number }
> {
  const docId = String(doc.id || env.documento_gerado_id || "");
  const { data: existentes, error: busErr } = await admin
    .from("rh_colaborador_documentos")
    .select("id")
    .eq("referencia_modulo", DOSSIE_REF_ASSINATURA)
    .eq("referencia_id", docId)
    .eq("ativo", true)
    .limit(1);
  if (busErr) {
    return { ok: false, error: "dossie_busca_failed", detail: busErr.message, http: 500 };
  }
  if (existentes && existentes[0]?.id) {
    await admin.from("rh_colaborador_documentos").update({ arquivo_url: null }).eq("id", existentes[0].id);
    return { ok: true, dossieId: String(existentes[0].id), reused: true };
  }
  const { data: porRef } = await admin
    .from("rh_colaborador_documentos")
    .select("id")
    .eq("referencia_id", docId)
    .eq("ativo", true)
    .limit(1);
  if (porRef && porRef[0]?.id) {
    await admin.from("rh_colaborador_documentos").update({ arquivo_url: null }).eq("id", porRef[0].id);
    return { ok: true, dossieId: String(porRef[0].id), reused: true };
  }

  const { data: col } = await admin
    .from("colaboradores")
    .select("*")
    .eq("id", colabId)
    .maybeSingle();
  if (!col?.id) {
    return { ok: false, error: "colaborador_nao_encontrado", detail: colabId, http: 409 };
  }

  let contratoNome: string | null = null;
  if (col.contrato_id) {
    const { data: contrato } = await admin
      .from("contratos")
      .select("nome,codigo")
      .eq("id", col.contrato_id)
      .maybeSingle();
    contratoNome = (contrato?.nome || contrato?.codigo || null) as string | null;
  }

  const agora = new Date().toISOString();
  const obs = [
    "DocuSign",
    String(doc.modelo_codigo || ""),
    doc.modelo_versao != null ? "v" + doc.modelo_versao : "",
    "hash " + arquivos.hash,
    arquivos.certPath ? "cert " + arquivos.certPath : "cert pendente",
  ].filter(Boolean).join(" · ");

  const payload = {
    colaborador_id: colabId,
    colaborador_re: col.re || null,
    cpf: col.cpf || col.bro || null,
    contrato_id: col.contrato_id || null,
    contrato_nome: contratoNome,
    base_id: col.filial_id || col.base_id || null,
    base_nome: col.base_nome || null,
    categoria: categoriaDossie(doc.origem_contexto as string),
    tipo_documento: doc.tipo_documento_codigo || doc.tipo_documento || "DOCUMENTO",
    numero_documento: null,
    data_emissao: agora.slice(0, 10),
    data_validade: null,
    data_vencimento: null,
    status: "Válido",
    obrigatorio: false,
    arquivo_url: null,
    arquivo_nome: String(doc.modelo_codigo || "documento") + "_assinado.pdf",
    arquivo_tipo: "application/pdf",
    arquivo_tamanho: null,
    origem: "RH-2D / DOCUSIGN",
    referencia_modulo: DOSSIE_REF_ASSINATURA,
    referencia_id: docId,
    versao: 1,
    substitui_documento_id: null,
    ativo: true,
    observacao: obs,
    validado_por: "RH-2D / DOCUSIGN",
    validado_em: agora,
    criado_por: "RH-2D / DOCUSIGN",
  };

  const { data: saved, error: insErr } = await admin
    .from("rh_colaborador_documentos")
    .insert(payload)
    .select("id")
    .maybeSingle();
  if (insErr || !saved?.id) {
    return {
      ok: false,
      error: "dossie_insert_failed",
      detail: insErr?.message || "sem_id",
      http: 500,
    };
  }
  return { ok: true, dossieId: String(saved.id), reused: false };
}

/** PDF obrigatório. Certificado: pendência explícita, sem inventar. Não marca ARQUIVADO sem Dossiê. */
export async function finalizarEnvelopeDocusign(
  admin: Admin,
  envEntrada: Record<string, unknown>,
): Promise<FinalizarEnvelopeResult> {
  const { data: envFresh } = await admin
    .from("rh_documento_envelopes")
    .select("*")
    .eq("id", String(envEntrada.id))
    .maybeSingle();
  const env = (envFresh || envEntrada) as Record<string, unknown>;
  if (!env?.id || !env.provider_envelope_id) {
    return { ok: false, error: "envelope_nao_encontrado", http: 404 };
  }

  const { data: doc } = await admin
    .from("rh_contratacao_documentos_gerados")
    .select("*")
    .eq("id", String(env.documento_gerado_id))
    .maybeSingle();
  if (!doc) return { ok: false, error: "documento_nao_encontrado", http: 404 };

  const jaArquivado = String(doc.status) === "ARQUIVADO_DOSSIE" && doc.dossie_documento_id
    && env.arquivo_assinado_path && env.hash_documento_final;
  if (jaArquivado) {
    return {
      ok: true,
      already: true,
      arquivo_assinado_path: String(env.arquivo_assinado_path),
      certificado_path: env.certificado_path ? String(env.certificado_path) : null,
      hash: String(env.hash_documento_final),
      colaborador_id: env.colaborador_id ? String(env.colaborador_id) : null,
      precisa_arquivar_dossie: false,
      arquivado: true,
      dossie_documento_id: String(doc.dossie_documento_id),
      status_documento: "ARQUIVADO_DOSSIE",
    };
  }

  let arquivos: {
    pdfPath: string;
    certPath: string | null;
    hash: string;
    certPendente: boolean;
    certDetalhe: string | null;
  };
  try {
    const got = await baixarEPersistirArquivos(admin, env);
    if (!got.ok) {
      await admin.from("rh_documento_envelopes").update({
        erro_codigo: got.error,
        erro_detalhe: got.detail,
        ultimo_evento_em: new Date().toISOString(),
      }).eq("id", env.id);
      return { ok: false, error: got.error, detail: got.detail, http: got.http };
    }
    arquivos = got;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await admin.from("rh_documento_envelopes").update({
      erro_codigo: "download_exception",
      erro_detalhe: msg.slice(0, 300),
      ultimo_evento_em: new Date().toISOString(),
    }).eq("id", env.id);
    return { ok: false, error: "download_exception", detail: msg, http: 502 };
  }

  const agora = new Date().toISOString();
  const avisoCert = arquivos.certPendente
    ? ("Certificado de conclusão pendente. " + (arquivos.certDetalhe || "")).trim()
    : null;

  await admin.from("rh_documento_envelopes").update({
    status: "COMPLETED",
    arquivo_assinado_path: arquivos.pdfPath,
    certificado_path: arquivos.certPath,
    hash_documento_final: arquivos.hash,
    concluido_em: env.concluido_em || agora,
    ultimo_evento_em: agora,
    erro_codigo: arquivos.certPendente ? "CERTIFICADO_PENDENTE" : null,
    erro_detalhe: avisoCert,
  }).eq("id", env.id);

  const docJaArquivado = String(doc.status) === "ARQUIVADO_DOSSIE";
  if (!docJaArquivado) {
    // DOC-CORE: não tocar hash_sha256 (HTML gerado) nem arquivo_path da geração.
    await admin.from("rh_contratacao_documentos_gerados").update({
      status: "ASSINADO",
      assinado_em: doc.assinado_em || agora,
      canal_assinatura: "DOCUSIGN",
      provider_assinatura: "DOCUSIGN",
      aviso_operacional: avisoCert,
    }).eq("id", doc.id);
  }

  const colabId = await resolverColaboradorId(admin, { ...env, colaborador_id: env.colaborador_id || doc.colaborador_id });
  if (colabId && !env.colaborador_id) {
    await admin.from("rh_documento_envelopes").update({ colaborador_id: colabId }).eq("id", env.id);
  }

  if (!colabId) {
    return {
      ok: true,
      arquivo_assinado_path: arquivos.pdfPath,
      certificado_path: arquivos.certPath,
      hash: arquivos.hash,
      colaborador_id: null,
      precisa_arquivar_dossie: true,
      arquivado: false,
      certificado_pendente: arquivos.certPendente,
      status_documento: docJaArquivado ? "ARQUIVADO_DOSSIE" : "ASSINADO",
    };
  }

  const dossie = await garantirDossie(admin, env, doc, arquivos, colabId);
  if (!dossie.ok) {
    await admin.from("rh_documento_envelopes").update({
      erro_codigo: dossie.error,
      erro_detalhe: dossie.detail,
      ultimo_evento_em: new Date().toISOString(),
    }).eq("id", env.id);
    return {
      ok: false,
      error: dossie.error,
      detail: dossie.detail,
      http: dossie.http,
      arquivo_assinado_path: arquivos.pdfPath,
      certificado_path: arquivos.certPath,
      hash: arquivos.hash,
      colaborador_id: colabId,
      precisa_arquivar_dossie: true,
      status_documento: "ASSINADO",
    };
  }

  await admin.from("rh_contratacao_documentos_gerados").update({
    status: "ARQUIVADO_DOSSIE",
    dossie_documento_id: dossie.dossieId,
    arquivado_dossie_em: agora,
    arquivado_dossie_por: "RH-2D / DOCUSIGN",
    provider_assinatura: "DOCUSIGN",
    canal_assinatura: "DOCUSIGN",
    aviso_operacional: avisoCert,
  }).eq("id", doc.id);

  await registrarAuditLog(admin, "ARQUIVOU_DOCUMENTO_DOSSIE", "Arquivou documento assinado no Dossiê", {
    usuarioNome: "RH-2D / DOCUSIGN",
    perfil: "sistema",
  }, { documento_gerado_id: doc.id, dossie_documento_id: dossie.dossieId });

  if (arquivos.certPendente) {
    await admin.from("rh_documento_envelopes").update({
      erro_codigo: "CERTIFICADO_PENDENTE",
      erro_detalhe: avisoCert,
    }).eq("id", env.id);
  } else {
    await admin.from("rh_documento_envelopes").update({
      erro_codigo: null,
      erro_detalhe: null,
    }).eq("id", env.id);
  }

  return {
    ok: true,
    already: dossie.reused && !!env.hash_documento_final,
    arquivo_assinado_path: arquivos.pdfPath,
    certificado_path: arquivos.certPath,
    hash: arquivos.hash,
    colaborador_id: colabId,
    precisa_arquivar_dossie: false,
    arquivado: true,
    dossie_documento_id: dossie.dossieId,
    status_documento: "ARQUIVADO_DOSSIE",
    certificado_pendente: arquivos.certPendente,
  };
}
