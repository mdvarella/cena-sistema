// ERP CENA — DocuSign helpers (Edge only). Secrets via Deno.env — never frontend.
// Recovery-3: aud = hostname; HMAC fail-closed; aceita hex (create/status) e Base64 (webhook).

export type DsEnv = "DEMO" | "PRODUCAO";

export function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-supabase-authorization, x-docusign-signature-1",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json" },
  });
}

/** Host OAuth sem protocolo — claim `aud` (docs oficiais). */
export function dsAuthHost(ambiente: DsEnv) {
  return ambiente === "PRODUCAO" ? "account.docusign.com" : "account-d.docusign.com";
}

/** URL base OAuth (token / userinfo / consent). */
export function dsAuthBase(ambiente: DsEnv) {
  return "https://" + dsAuthHost(ambiente);
}

export function dsBaseUri(ambiente: DsEnv) {
  const custom = Deno.env.get("DOCUSIGN_BASE_URI");
  if (custom) return custom.replace(/\/$/, "");
  if (ambiente === "DEMO") return "https://demo.docusign.net";
  return "";
}

/** Preferência: DOCUSIGN_BASE_URI → userinfo.base_uri da conta → DEMO fixo. Produção não assume na4. */
export async function dsResolveBaseUri(ambiente: DsEnv, token: string): Promise<string> {
  const configured = dsBaseUri(ambiente);
  if (configured) return configured;
  const r = await fetch(`${dsAuthBase(ambiente)}/oauth/userinfo`, {
    headers: { Authorization: "Bearer " + token },
  });
  const info = await r.json().catch(() => ({}));
  const expected = Deno.env.get("DOCUSIGN_ACCOUNT_ID") || "";
  const accounts = Array.isArray(info.accounts) ? info.accounts : [];
  const match = accounts.find((a: { account_id?: string; base_uri?: string }) =>
    String(a.account_id || "") === expected
  ) || accounts[0];
  const uri = match?.base_uri ? String(match.base_uri).replace(/\/$/, "") : "";
  if (uri) return uri;
  if (ambiente === "DEMO") return "https://demo.docusign.net";
  throw new Error("base_uri_indisponivel");
}

export async function dsAccessToken(
  ambiente: DsEnv,
  opts?: { allowStatic?: boolean },
): Promise<string> {
  const integrationKey = Deno.env.get("DOCUSIGN_INTEGRATION_KEY") || "";
  const userId = Deno.env.get("DOCUSIGN_USER_ID") || "";
  const privateKeyPem = Deno.env.get("DOCUSIGN_PRIVATE_KEY") || "";
  if (!integrationKey || !userId || !privateKeyPem) {
    throw new Error(
      "DocuSign secrets ausentes: DOCUSIGN_INTEGRATION_KEY, DOCUSIGN_USER_ID, DOCUSIGN_PRIVATE_KEY",
    );
  }

  const allowStatic = opts?.allowStatic === true;
  if (allowStatic) {
    const staticTok = Deno.env.get("DOCUSIGN_ACCESS_TOKEN");
    if (staticTok) return staticTok;
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: integrationKey,
    sub: userId,
    aud: dsAuthHost(ambiente),
    iat: now,
    exp: now + 3600,
    scope: "signature impersonation",
  };
  const enc = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  const data = `${enc(header)}.${enc(payload)}`;
  const key = await importPkcs8(privateKeyPem);
  const sig = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    new TextEncoder().encode(data),
  );
  const assertion = `${data}.${btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "")}`;

  const r = await fetch(`${dsAuthBase(ambiente)}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) {
    throw new Error("DocuSign OAuth falhou: " + (j.error || r.status));
  }
  return j.access_token as string;
}

async function importPkcs8(pem: string) {
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    raw,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

export function accountId() {
  const id = Deno.env.get("DOCUSIGN_ACCOUNT_ID") || "";
  if (!id) throw new Error("DOCUSIGN_ACCOUNT_ID ausente");
  return id;
}

export function smsEnabledConfig() {
  return String(Deno.env.get("DOCUSIGN_SMS_ENABLED") || "").toLowerCase() === "true";
}

export const BUCKET_RH_ASSINADOS = "cena-rh-assinados";
export const DOSSIE_REF_ASSINATURA = "RH-ASSINATURA-DIGITAL";
export const SIGNED_URL_TTL_SEC = 90;

export async function sha256Hex(bytes: ArrayBuffer) {
  const dig = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(dig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export type HmacResult = {
  ok: boolean;
  skipped: boolean;
  error?: string;
  format?: "hex" | "base64";
};

/** Fail-closed. Aceita hex (export create/status) e Base64 (export webhook). */
export async function verifyConnectHmac(
  rawBody: string,
  headerSig: string | null,
  envGet?: (k: string) => string,
): Promise<HmacResult> {
  const get = envGet || ((k: string) => Deno.env.get(k) || "");
  const secret = get("DOCUSIGN_CONNECT_SECRET") || "";
  if (!secret) return { ok: false, skipped: false, error: "configuration_error" };
  if (!headerSig) return { ok: false, skipped: false };

  const raw = new TextEncoder().encode(rawBody);
  const keySign = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", keySign, raw);
  const hex = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const hdr = String(headerSig).trim();
  const hdrHex = hdr.toLowerCase().replace(/^sha256=/i, "");
  if (hex.toLowerCase() === hdrHex) return { ok: true, skipped: false, format: "hex" };

  try {
    const keyV = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const signature = Uint8Array.from(atob(hdr), (c) => c.charCodeAt(0));
    const ok = await crypto.subtle.verify("HMAC", keyV, signature, raw);
    if (ok) return { ok: true, skipped: false, format: "base64" };
  } catch {
    /* formato não-base64 */
  }
  return { ok: false, skipped: false };
}

export type DiagnosticoDs = {
  oauth_ok: boolean;
  account_ok: boolean;
  account_id_match: boolean;
  base_uri: string | null;
  ambiente: DsEnv;
  timestamp: string;
  error?: string;
};

/** Teste oficial: JWT Grant → userinfo. Sem envelope. Sem token no retorno. */
export async function dsDiagnosticoConexao(ambiente: DsEnv): Promise<DiagnosticoDs> {
  const out: DiagnosticoDs = {
    oauth_ok: false,
    account_ok: false,
    account_id_match: false,
    base_uri: null,
    ambiente,
    timestamp: new Date().toISOString(),
  };
  try {
    const token = await dsAccessToken(ambiente, { allowStatic: false });
    out.oauth_ok = true;
    const r = await fetch(`${dsAuthBase(ambiente)}/oauth/userinfo`, {
      headers: { Authorization: "Bearer " + token },
    });
    const info = await r.json().catch(() => ({}));
    if (!r.ok) {
      out.error = "userinfo_failed";
      return out;
    }
    const expected = accountId();
    const accounts = Array.isArray(info.accounts) ? info.accounts : [];
    const match = accounts.find((a: { account_id?: string; base_uri?: string }) =>
      String(a.account_id || "") === expected
    ) || accounts[0];
    if (match) {
      out.account_ok = true;
      out.account_id_match = String(match.account_id || "") === expected;
      out.base_uri = match.base_uri ? String(match.base_uri).replace(/\/$/, "") : null;
    }
    return out;
  } catch (e) {
    out.error = e instanceof Error ? e.message : "diagnostico_failed";
    if (out.error.indexOf("secrets") >= 0 || out.error.toLowerCase().indexOf("token") >= 0) {
      out.error = "oauth_config_or_grant_failed";
    }
    return out;
  }
}
