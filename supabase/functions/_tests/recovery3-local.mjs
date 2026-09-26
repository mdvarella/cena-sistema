/**
 * Testes locais Recovery-3 — sem API DocuSign.
 * node supabase/functions/_tests/recovery3-local.mjs
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;
function assert(name, cond) {
  if (cond) console.log("PASS", name);
  else {
    console.log("FAIL", name);
    failed++;
  }
}

const authSrc = readFileSync(join(root, "_shared/cena-rh-auth.ts"), "utf8");
const dsSrc = readFileSync(join(root, "_shared/docusign.ts"), "utf8");
const finSrc = readFileSync(join(root, "_shared/finalizar-envelope-docusign.ts"), "utf8");
const createSrc = readFileSync(join(root, "docusign-create-envelope/index.ts"), "utf8");
const statusSrc = readFileSync(join(root, "docusign-envelope-status/index.ts"), "utf8");
const hookSrc = readFileSync(join(root, "docusign-webhook/index.ts"), "utf8");

function perfilPodeGerenciarModelos(perfil) {
  const p = String(perfil || "").toLowerCase().trim();
  if (!p) return false;
  if (p === "admin" || p === "diretoria") return true;
  return ["admin", "gestor", "administrativo", "dp", "rh", "diretoria"].indexOf(p) >= 0;
}

function validarAnchorsHtml(html, destinatarios, opts) {
  const src = String(html || "");
  const exigirData = !opts || opts.exigirData !== false;
  for (const d of destinatarios) {
    const p = String(d.papel || "EMPREGADO").toUpperCase();
    const marker = p === "EMPRESA"
      ? "[[ASSINATURA_EMPRESA]]"
      : p === "TESTEMUNHA"
      ? "[[ASSINATURA_TESTEMUNHA]]"
      : "[[ASSINATURA_EMPREGADO]]";
    if (!src.includes(marker)) return { ok: false, marker };
  }
  if (exigirData && !src.includes("[[DATA_ASSINATURA]]")) return { ok: false, marker: "[[DATA_ASSINATURA]]" };
  return { ok: true };
}

function verifyHmacFailClosed(secret, body, header) {
  if (!secret) return { ok: false, error: "configuration_error" };
  if (!header) return { ok: false };
  const hex = createHmac("sha256", secret).update(body).digest("hex");
  const hdr = String(header).trim().toLowerCase().replace(/^sha256=/, "");
  if (hex === hdr) return { ok: true, format: "hex" };
  const b64 = createHmac("sha256", secret).update(body).digest("base64");
  if (b64 === header.trim()) return { ok: true, format: "base64" };
  return { ok: false };
}

// 1 HMAC secret ausente
assert("HMAC secret ausente rejeita", verifyHmacFailClosed("", "x", "aa").error === "configuration_error");
assert("HMAC header errado rejeita", verifyHmacFailClosed("s", "x", "00").ok === false);
assert("HMAC hex aceita", verifyHmacFailClosed("s", "x", createHmac("sha256", "s").update("x").digest("hex")).ok);
assert("HMAC base64 aceita", verifyHmacFailClosed("s", "x", createHmac("sha256", "s").update("x").digest("base64")).ok);
assert("código fail-closed", /configuration_error/.test(dsSrc) && /configuration_error/.test(hookSrc));

// 2-3 permissão
assert("portaria sem permissão", perfilPodeGerenciarModelos("portaria") === false);
assert("rh autorizado", perfilPodeGerenciarModelos("rh") === true);
assert("admin autorizado", perfilPodeGerenciarModelos("admin") === true);
assert("edges exigem permissão",
  /exigirPermissaoRhModelos/.test(createSrc) &&
  /exigirPermissaoRhModelos/.test(statusSrc) &&
  /exigirPermissaoRhModelos/.test(readFileSync(join(root, "docusign-download-completed/index.ts"), "utf8")));
assert("fonte usuarios_sistema.perfil", /usuarios_sistema/.test(authSrc) && /auth_user_id/.test(authSrc));

// 4 anchors
const htmlOk = "texto [[ASSINATURA_EMPREGADO]] [[DATA_ASSINATURA]]";
assert("anchor ausente rejeita", validarAnchorsHtml("sem marker", [{ papel: "EMPREGADO" }]).ok === false);
assert("anchor presente passa", validarAnchorsHtml(htmlOk, [{ papel: "EMPREGADO" }]).ok === true);
assert("create usa validarAnchorsHtml", /validarAnchorsHtml/.test(createSrc));
assert("ignoreIfNotPresent false", /anchorIgnoreIfNotPresent: "false"/.test(createSrc));

// 5 idempotência
assert("bloqueia envelope ativo", /envelope_ativo_existente/.test(createSrc));
assert("reusa pending", /pending-/.test(createSrc));

// 6 hash nunca sobrescrito
assert("finalizar não grava hash_sha256", !/hash_sha256:\s*arquivos\.hash/.test(finSrc));
assert("envelope grava hash_documento_final", /hash_documento_final:\s*arquivos\.hash/.test(finSrc));

// 7 completed → finalizar
assert("status chama finalizar se completed", /mapped\.finalize/.test(statusSrc) && /finalizarEnvelopeDocusign/.test(statusSrc));
assert("status não marca ASSINADO antes", /mapped\.doc !== "ASSINADO"/.test(statusSrc));
assert("webhook não marca ASSINADO antes", /mapped\.doc !== "ASSINADO"/.test(hookSrc));
assert("base_uri sem na4 fixo", !/na4\.docusign\.net/.test(dsSrc) && /dsResolveBaseUri/.test(dsSrc));

// 8 compensação órfão
assert("void compensatório", /compensated_void/.test(createSrc) && /voidedReason/.test(createSrc));
assert("registro local antes", /status: "ENVIANDO"/.test(createSrc));

// 9 _shared contratos
assert("aud hostname", /aud: dsAuthHost\(ambiente\)/.test(dsSrc));
assert("aud não usa URL no claim", !/aud: dsAuthBase\(ambiente\)/.test(dsSrc));
assert("diagnostico sem static token", /allowStatic: false/.test(dsSrc) || /allowStatic: false/.test(statusSrc));
assert("diagnostico implementado", /dsDiagnosticoConexao/.test(dsSrc) && /acao === "diagnostico"/.test(statusSrc));

if (failed) {
  console.log("\nFAILED", failed);
  process.exit(1);
}
console.log("\nALL LOCAL TESTS PASSED");
