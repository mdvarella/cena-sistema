// ERP CENA — DocuSign helpers (Edge only). Secrets via Deno.env — never frontend.

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

export function dsBaseUri(ambiente: DsEnv) {
  const custom = Deno.env.get("DOCUSIGN_BASE_URI");
  if (custom) return custom.replace(/\/$/, "");
  return ambiente === "PRODUCAO"
    ? "https://na4.docusign.net"
    : "https://demo.docusign.net";
}

export function dsAuthBase(ambiente: DsEnv) {
  return ambiente === "PRODUCAO"
    ? "https://account.docusign.com"
    : "https://account-d.docusign.com";
}

/** JWT Grant (service integration). Requires DOCUSIGN_PRIVATE_KEY (PEM) + INTEGRATION_KEY + USER_ID. */
export async function dsAccessToken(ambiente: DsEnv): Promise<string> {
  const integrationKey = Deno.env.get("DOCUSIGN_INTEGRATION_KEY") || "";
  const userId = Deno.env.get("DOCUSIGN_USER_ID") || "";
  const privateKeyPem = Deno.env.get("DOCUSIGN_PRIVATE_KEY") || "";
  if (!integrationKey || !userId || !privateKeyPem) {
    throw new Error(
      "DocuSign secrets ausentes: DOCUSIGN_INTEGRATION_KEY, DOCUSIGN_USER_ID, DOCUSIGN_PRIVATE_KEY",
    );
  }

  // Prefer pre-issued token for smoke tests
  const staticTok = Deno.env.get("DOCUSIGN_ACCESS_TOKEN");
  if (staticTok) return staticTok;

  // Minimal JWT assertion using WebCrypto (RS256)
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: integrationKey,
    sub: userId,
    aud: dsAuthBase(ambiente),
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

export async function sha256Hex(bytes: ArrayBuffer) {
  const dig = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(dig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** HMAC validation for Connect (optional DOCUSIGN_CONNECT_SECRET). */
export async function verifyConnectHmac(rawBody: string, headerSig: string | null) {
  const secret = Deno.env.get("DOCUSIGN_CONNECT_SECRET") || "";
  if (!secret) return { ok: true, skipped: true };
  if (!headerSig) return { ok: false, skipped: false };
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const ok = hex.toLowerCase() === String(headerSig).toLowerCase().replace(/^sha256=/i, "");
  return { ok, skipped: false };
}
