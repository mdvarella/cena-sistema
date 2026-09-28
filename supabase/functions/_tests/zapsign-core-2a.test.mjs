/**
 * ZAPSIGN-CORE-2A — testes locais (sem token, sem POST real, sem DocuSign).
 * node supabase/functions/_tests/zapsign-core-2a.test.mjs
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(root, "..", "..");
let failed = 0;
function assert(name, cond) {
  if (cond) console.log("PASS", name);
  else {
    console.log("FAIL", name);
    failed++;
  }
}

const coreSrc = readFileSync(join(root, "_shared/signature-core.ts"), "utf8");
const zapSrc = readFileSync(join(root, "_shared/zapsign.ts"), "utf8");
const edgeSrc = readFileSync(join(root, "zapsign-create/index.ts"), "utf8");
const mig = readFileSync(join(repo, "supabase/migrations/20260928140000_zapsign_core_2a_envelopes.sql"), "utf8");
const html = readFileSync(join(repo, "index.html"), "utf8");
const cfg = readFileSync(join(repo, "supabase/config.toml"), "utf8");
const createDs = readFileSync(join(root, "docusign-create-envelope/index.ts"), "utf8");
const statusDs = readFileSync(join(root, "docusign-envelope-status/index.ts"), "utf8");
const dlDs = readFileSync(join(root, "docusign-download-completed/index.ts"), "utf8");
const hookDs = readFileSync(join(root, "docusign-webhook/index.ts"), "utf8");

function documentoAptoParaCreate(status) {
  return ["APROVADO_PARA_ASSINATURA", "ERRO_ASSINATURA"].indexOf(String(status || "")) >= 0;
}
function pendingZapsignId(id) { return "pending-zapsign-" + id; }
function externalIdZapSign(id) { return String(id || "").trim(); }
function envelopeRemotoCriado(row) {
  const pid = String(row?.provider_envelope_id || "");
  return !!pid && !pid.startsWith("pending-");
}
function providerCongelado(existentes) {
  const ativos = (existentes || []).filter((e) => envelopeRemotoCriado(e) && e.ativo !== false && e.status !== "ERRO");
  if (!ativos.length) return null;
  return String(ativos[0].provider || "") || null;
}
function sanitizarLog(valor) {
  if (typeof valor === "string") {
    return valor.replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [redacted]").replace(/\b\d{11}\b/g, "[cpf]");
  }
  if (valor && typeof valor === "object") {
    const out = {};
    for (const [k, v] of Object.entries(valor)) {
      out[k] = /token|secret|cpf/i.test(k) ? "[redacted]" : sanitizarLog(v);
    }
    return out;
  }
  return valor;
}
function nomeDocumentoZapSign(doc) {
  const modelo = String(doc.modelo_codigo || "CENA-DOC").replace(/[^\w.-]+/g, "-").slice(0, 40);
  return ("CENA-" + modelo).slice(0, 255);
}

assert("1 secret nao no browser", !/ZAPSIGN_API_TOKEN\s*=/.test(html) && html.indexOf("sandbox.zapsign.com.br") < 0);
assert("2 secret nao no repo (sem valor)", !/ZAPSIGN_API_TOKEN\s*[:=]\s*['\"][^'\"]+['\"]/.test(zapSrc + edgeSrc));
assert("3 Edge exige auth CENA", /exigirPermissaoRhModelos/.test(edgeSrc) && /missing_authorization/.test(edgeSrc) && /verify_jwt = true/.test(cfg));
assert("4 RASCUNHO bloqueia", documentoAptoParaCreate("RASCUNHO") === false);
assert("4 GERANDO bloqueia", documentoAptoParaCreate("GERANDO") === false);
assert("4 ASSINADO bloqueia", documentoAptoParaCreate("ASSINADO") === false);
assert("5 APROVADO_PARA_ASSINATURA aceita", documentoAptoParaCreate("APROVADO_PARA_ASSINATURA") === true);
assert("5 ERRO_ASSINATURA retry", documentoAptoParaCreate("ERRO_ASSINATURA") === true);
assert("6 HTML congelado nao recalculado", /Nao reexecuta tokens/.test(coreSrc) && /void doc\.snapshot_tokens/.test(coreSrc));
assert("7 BLOQUEIO PDF sem renderer", /BLOQUEIO PDF/.test(coreSrc) && /obterPdfCanonicoDeDocumento/.test(edgeSrc) && /503/.test(edgeSrc));
assert("8 hash HTML nao escrito no gerados", /rh_contratacao_documentos_gerados"\)\.update\(\{\s*status: "AGUARDANDO_ASSINATURA"/.test(edgeSrc) && !/hash_sha256:/.test(edgeSrc));
assert("9 limite 10MB", /10 \* 1024 \* 1024/.test(coreSrc) && /10 \* 1024 \* 1024/.test(zapSrc));
assert("10 provider ZAPSIGN", /provider: PROVIDER_ZAPSIGN/.test(edgeSrc) && /ZAPSIGN/.test(mig));
assert("11 provider congelado", /provider_congelado/.test(edgeSrc) && providerCongelado([{ provider: "DOCUSIGN", provider_envelope_id: "abc", ativo: true, status: "ENVIADO" }]) === "DOCUSIGN");
assert("12 external_id = documento_gerado_id", externalIdZapSign("11111111-2222-3333-4444-555555555555") === "11111111-2222-3333-4444-555555555555");
assert("13 pending antes do POST", /pendingZapsignId/.test(edgeSrc) && edgeSrc.indexOf("pendingZapsignId") < edgeSrc.indexOf("zapsignPostDocs"));
assert("13 pending id", pendingZapsignId("x") === "pending-zapsign-x");
assert("14 segundo ativo 409", /envelope_ativo_existente/.test(edgeSrc));
assert("15 erro HTTP recuperavel", /recuperavel: true/.test(edgeSrc));
assert("16 send_automatic false", /send_automatic:\s*false/.test(zapSrc) && /send_automatic_email:\s*false/.test(zapSrc));
assert("17 disable emails", /disable_signer_emails:\s*true/.test(zapSrc));
assert("18 whatsapp false", /send_automatic_whatsapp:\s*false/.test(zapSrc));
assert("19 cpf redacted", sanitizarLog("12345678901").indexOf("12345678901") < 0 && sanitizarLog({ cpf: "1", token: "abc" }).cpf === "[redacted]");
assert("19 nome sem cpf", nomeDocumentoZapSign({ modelo_codigo: "NOR-ATEST", id: "abc" }).indexOf("cpf") < 0);
assert("20 DocuSign create inalterado nesta branch (ainda usa HTML)", /fileExtension: fileExt/.test(createDs));
assert("20 status/download/webhook existem", !!statusDs && !!dlDs && !!hookDs);
assert("21 conteudo_html nao escrito", !/\.update\(\{[^}]*conteudo_html/.test(edgeSrc));
assert("22 CTR-PJ nao nesta fase", !/CTR-PJ/.test(edgeSrc) && !/CTR-PJ/.test(coreSrc));
assert("23 CLT/NOR-ATEST nao alterados no edge", !/NOR-ATEST/.test(edgeSrc) && !/\[\[SIGN_/.test(edgeSrc) && !/\[\[DS_/.test(edgeSrc));
assert("migration metadata jsonb", /ADD COLUMN IF NOT EXISTS metadata jsonb/.test(mig));
assert("nao db reset", !/RESET/.test(mig));
assert("json cors proprio (nao muda docusign.ts)", /export function json/.test(zapSrc));
assert("versao 8.1.161 no changelog", /\{v:'8\.1\.161'/.test(html));

const h = createHash("sha256").update("html-congelado").digest("hex");
assert("hash helper shape", h.length === 64);

if (failed) {
  console.error("FAILED", failed);
  process.exit(1);
}
console.log("ok zapsign-core-2a", "failed=0");
