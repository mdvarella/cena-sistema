// CENA SIGNATURE CORE — ZAPSIGN-CORE-2A (mínimo).
// Não substitui docusign.ts. Não recalcula tokens DOC-CORE.

export const PROVIDER_ZAPSIGN = "ZAPSIGN";
export const PROVIDER_DOCUSIGN = "DOCUSIGN";
export const PDF_MAX_BYTES = 10 * 1024 * 1024;

export const STATUS_DOC_APTOS = ["APROVADO_PARA_ASSINATURA", "ERRO_ASSINATURA"] as const;
export const STATUS_DOC_BLOQUEADOS = [
  "RASCUNHO",
  "GERANDO",
  "ERRO",
  "ARQUIVADO",
  "ARQUIVADO_DOSSIE",
  "ASSINADO",
  "CANCELADO",
] as const;

export const STATUS_ENVELOPE_INATIVO = [
  "CANCELADO",
  "VOIDED",
  "EXPIRED",
  "DECLINED",
  "COMPLETED",
  "ERRO",
] as const;

export function pendingZapsignId(documentoGeradoId: string) {
  return "pending-zapsign-" + String(documentoGeradoId || "");
}

export function externalIdZapSign(documentoGeradoId: string) {
  return String(documentoGeradoId || "").trim();
}

export function documentoAptoParaCreate(status: string | null | undefined) {
  const st = String(status || "");
  return STATUS_DOC_APTOS.indexOf(st as (typeof STATUS_DOC_APTOS)[number]) >= 0;
}

export function envelopeAtivo(row: { status?: string; provider_envelope_id?: string; ativo?: boolean } | null) {
  if (!row || row.ativo === false) return false;
  const st = String(row.status || "");
  if (STATUS_ENVELOPE_INATIVO.indexOf(st as (typeof STATUS_ENVELOPE_INATIVO)[number]) >= 0) return false;
  return true;
}

export function envelopeRemotoCriado(row: { provider_envelope_id?: string } | null) {
  const pid = String(row?.provider_envelope_id || "");
  return !!pid && !pid.startsWith("pending-");
}

export function providerCongelado(existentes: Array<{ provider?: string; status?: string; provider_envelope_id?: string; ativo?: boolean }>) {
  const ativos = (existentes || []).filter((e) => envelopeAtivo(e) && envelopeRemotoCriado(e));
  if (!ativos.length) return null;
  return String(ativos[0].provider || "") || null;
}

export function nomeDocumentoZapSign(doc: { modelo_codigo?: string; versao?: string | number; id?: string }) {
  const modelo = String(doc.modelo_codigo || "CENA-DOC").replace(/[^\w.-]+/g, "-").slice(0, 40);
  const ver = String(doc.versao || "v").replace(/[^\w.-]+/g, "").slice(0, 12);
  const id = String(doc.id || "").replace(/[^a-fA-F0-9-]/g, "").slice(0, 8);
  return ("CENA-" + modelo + "-" + ver + (id ? "-" + id : "")).slice(0, 255);
}

export function sanitizarLog(valor: unknown): unknown {
  if (valor == null) return valor;
  if (typeof valor === "string") {
    let s = valor;
    s = s.replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [redacted]");
    s = s.replace(/\b\d{11}\b/g, "[cpf]");
    s = s.replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[cpf]");
    if (/token|secret|api[_-]?key/i.test(s) && s.length > 12) return "[redacted]";
    return s;
  }
  if (Array.isArray(valor)) return valor.map(sanitizarLog);
  if (typeof valor === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
      if (/token|secret|authorization|password|cpf/i.test(k)) out[k] = "[redacted]";
      else out[k] = sanitizarLog(v);
    }
    return out;
  }
  return valor;
}

export async function sha256HexBytes(bytes: Uint8Array | ArrayBuffer) {
  const buf = bytes instanceof ArrayBuffer ? bytes : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const dig = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(dig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type PdfCanonicoOk = {
  ok: true;
  bytes: Uint8Array;
  origem: string;
  pdf_input_hash: string;
};

export type PdfCanonicoFail = {
  ok: false;
  error: "BLOQUEIO_PDF";
  message: string;
};

/**
 * ZapSign exige PDF. O DOC-CORE congela HTML (hash_sha256).
 * Não há renderer canônico HTML congelado → PDF no repositório (sem html2pdf/jsPDF/puppeteer/Edge de PDF).
 * arquivo_path .pdf do DocuSign é opcional e não prova derivação do HTML congelado.
 * Nao reexecuta tokens / cadastro / cargo / empresa.
 */
export async function obterPdfCanonicoDeDocumento(doc: {
  conteudo_html?: string | null;
  arquivo_path?: string | null;
  formato?: string | null;
  snapshot_tokens?: unknown;
}): Promise<PdfCanonicoOk | PdfCanonicoFail> {
  void doc.snapshot_tokens;
  const html = String(doc.conteudo_html || "");
  if (!html) {
    return {
      ok: false,
      error: "BLOQUEIO_PDF",
      message: "Documento sem conteudo_html congelado. ZapSign não pode ser chamado.",
    };
  }
  return {
    ok: false,
    error: "BLOQUEIO_PDF",
    message:
      "BLOQUEIO PDF — DEFINIR RENDERER CANÔNICO. HTML congelado existe; não há gerador confiável de PDF a partir dele. Não chamar ZapSign.",
  };
}

export function pdfRespeitaLimite(bytes: Uint8Array) {
  return bytes.byteLength > 0 && bytes.byteLength <= PDF_MAX_BYTES;
}

export function metadataAssinaturaSegura(meta: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  const allow = [
    "provider",
    "external_id",
    "pdf_input_hash",
    "sandbox",
    "origem_pdf",
    "http_status",
    "erro",
    "bloqueio",
    "doc_token_presente",
  ];
  for (const k of allow) {
    if (meta[k] !== undefined) out[k] = meta[k];
  }
  out.provider = PROVIDER_ZAPSIGN;
  return out;
}
