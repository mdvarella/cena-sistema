// ZapSign adapter — ZAPSIGN-CORE-2A. Secrets só via env. Nunca logar token.
import { sanitizarLog } from "./signature-core.ts";

export function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-supabase-authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json" },
  });
}

export const ZAPSIGN_PDF_MAX_BYTES = 10 * 1024 * 1024;

export type ZapSignEnvGet = (k: string) => string | undefined;

export function zapsignBaseUrl(envGet: ZapSignEnvGet = (k) => Deno.env.get(k)) {
  const raw = String(envGet("ZAPSIGN_BASE_URL") || "https://sandbox.zapsign.com.br").replace(/\/$/, "");
  return raw;
}

export function zapsignToken(envGet: ZapSignEnvGet = (k) => Deno.env.get(k)) {
  return String(envGet("ZAPSIGN_API_TOKEN") || "").trim();
}

export function zapsignHeaders(token: string) {
  return {
    Authorization: "Bearer " + token,
    "Content-Type": "application/json",
  };
}

export function bytesParaBase64Pdf(bytes: Uint8Array) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export type ZapSignSignerTecnico = {
  name: string;
  email: string;
  auth_mode: string;
};

/** Signatário técnico — 2A. Sem colaborador real. Sem envio automático. */
export function signerTecnicoSandbox(): ZapSignSignerTecnico {
  return {
    name: "CENA SANDBOX TECNICO",
    email: "sandbox.nao.enviar@invalid.local",
    auth_mode: "assinaturaTela",
  };
}

export function montarPayloadCreate(opts: {
  name: string;
  base64_pdf: string;
  external_id: string;
  signer: ZapSignSignerTecnico;
}) {
  return {
    name: String(opts.name || "CENA-DOC").slice(0, 255),
    base64_pdf: opts.base64_pdf,
    external_id: opts.external_id,
    lang: "pt-br",
    send_automatic_email: false,
    send_automatic_whatsapp: false,
    send_automatic: false,
    disable_signer_emails: true,
    signers: [opts.signer],
  };
}

export type ZapSignHttp = {
  ok: boolean;
  status: number;
  json: Record<string, unknown>;
};

export async function zapsignPostDocs(
  payload: Record<string, unknown>,
  opts?: { envGet?: ZapSignEnvGet; fetchImpl?: typeof fetch },
): Promise<ZapSignHttp> {
  const envGet = opts?.envGet || ((k: string) => Deno.env.get(k));
  const fetchImpl = opts?.fetchImpl || fetch;
  const token = zapsignToken(envGet);
  if (!token) return { ok: false, status: 503, json: { error: "zapsign_token_ausente" } };
  const url = zapsignBaseUrl(envGet) + "/api/v1/docs/";
  const r = await fetchImpl(url, {
    method: "POST",
    headers: zapsignHeaders(token),
    body: JSON.stringify(payload),
  });
  const json = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: r.ok, status: r.status, json: sanitizarLog(json) as Record<string, unknown> };
}

/** Recuperação pós-create sem token local. Sem retry automático de POST. */
export async function zapsignBuscarPorExternalId(
  externalId: string,
  opts?: { envGet?: ZapSignEnvGet; fetchImpl?: typeof fetch },
): Promise<{ ok: boolean; bloqueio?: string; doc_token?: string; json?: unknown }> {
  const envGet = opts?.envGet || ((k: string) => Deno.env.get(k));
  const fetchImpl = opts?.fetchImpl || fetch;
  const token = zapsignToken(envGet);
  if (!token) return { ok: false, bloqueio: "zapsign_token_ausente" };
  const url = zapsignBaseUrl(envGet) + "/api/v1/docs/?external_id=" + encodeURIComponent(externalId);
  const r = await fetchImpl(url, { headers: zapsignHeaders(token) });
  const json = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  const sane = sanitizarLog(json);
  if (!r.ok) {
    return { ok: false, bloqueio: "BLOQUEIO_RECUPERACAO_EXTERNAL_ID", json: sane };
  }
  const lista = Array.isArray(json) ? json : Array.isArray((json as { results?: unknown }).results)
    ? (json as { results: unknown[] }).results
    : json && typeof json === "object" && (json as { token?: string }).token
    ? [json]
    : [];
  const hit = lista.find((d) => {
    if (!d || typeof d !== "object") return false;
    const row = d as { external_id?: string; token?: string };
    return String(row.external_id || "") === String(externalId) && String(row.token || "");
  }) as { token?: string } | undefined;
  if (hit?.token) return { ok: true, doc_token: String(hit.token) };
  return { ok: false, bloqueio: "BLOQUEIO_RECUPERACAO_EXTERNAL_ID", json: sane };
}

export function extrairDocToken(json: Record<string, unknown>) {
  const t = json.token || json.doc_token || json.open_id;
  return t ? String(t) : "";
}
