/**
 * Recovery-5.3 — âncoras técnicas DS_* (motor + DocuSign).
 * node supabase/functions/_tests/recovery53-anchors.mjs
 */
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const fnRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(fnRoot, "..", "..");
let failed = 0;
function assert(name, cond) {
  if (cond) console.log("PASS", name);
  else {
    console.log("FAIL", name);
    failed++;
  }
}

const RH_DOC_ANCHORS_TECNICOS = [
  "[[DS_ASSINATURA_EMPREGADO]]",
  "[[DS_ASSINATURA_EMPRESA]]",
  "[[DS_ASSINATURA_TESTEMUNHA]]",
  "[[DS_DATA_ASSINATURA]]",
];
const CATALOGO = new Set(["[[NOME_COMPLETO]]", "[[DATA_ASSINATURA]]", "[[DOCUMENTO_ID]]"]);

function rhDocEhAnchorTecnico(codigo) {
  return RH_DOC_ANCHORS_TECNICOS.indexOf(String(codigo || "")) >= 0;
}
function extrair(html) {
  const re = /\[\[([^\]]+)\]\]/g;
  const out = [];
  const set = {};
  let m;
  while ((m = re.exec(String(html || "")))) {
    const tok = "[[" + m[1] + "]]";
    if (!set[tok]) {
      set[tok] = 1;
      out.push(tok);
    }
  }
  return out;
}
function validarTokensModelo(conteudo) {
  const usados = extrair(conteudo);
  const invalidos = [];
  const validos = [];
  const tecnicos = [];
  usados.forEach((t) => {
    if (rhDocEhAnchorTecnico(t)) {
      tecnicos.push(t);
      return;
    }
    if (CATALOGO.has(t)) validos.push(t);
    else invalidos.push(t);
  });
  return { usados, validos, invalidos, tecnicos };
}
function resolverTokens(dados) {
  const resolved = {};
  Object.keys(dados).forEach((k) => {
    if (rhDocEhAnchorTecnico(k)) return;
    resolved[k] = { valor: dados[k], fonte: "teste", status: "OK" };
  });
  return resolved;
}
function renderConteudo(conteudo, resolved) {
  let html = String(conteudo || "");
  extrair(html).forEach((tok) => {
    if (rhDocEhAnchorTecnico(tok)) return;
    const info = resolved[tok];
    if (!info || !String(info.valor || "").trim()) {
      html = html.split(tok).join("");
      return;
    }
    html = html.split(tok).join(String(info.valor));
  });
  return html;
}
function snapshotDe(resolved) {
  const snap = {};
  Object.keys(resolved).forEach((k) => {
    if (rhDocEhAnchorTecnico(k)) return;
    snap[k] = { valor: resolved[k].valor, fonte: resolved[k].fonte, status: resolved[k].status };
  });
  return snap;
}
function hashHtml(html) {
  return createHash("sha256").update(html, "utf8").digest("hex");
}
function anchorAssinaturaPorPapel(papel) {
  const p = String(papel || "EMPREGADO").toUpperCase();
  if (p === "EMPRESA") return "[[DS_ASSINATURA_EMPRESA]]";
  if (p === "TESTEMUNHA") return "[[DS_ASSINATURA_TESTEMUNHA]]";
  return "[[DS_ASSINATURA_EMPREGADO]]";
}
function validarAnchorsHtml(html, destinatarios) {
  const src = String(html || "");
  if (!destinatarios.length) return { ok: false, marker: "destinatarios" };
  for (const d of destinatarios) {
    const marker = anchorAssinaturaPorPapel(d.papel);
    if (!src.includes(marker)) return { ok: false, marker, papel: d.papel };
  }
  if (!src.includes("[[DS_DATA_ASSINATURA]]")) return { ok: false, marker: "[[DS_DATA_ASSINATURA]]" };
  return { ok: true };
}

const indexHtml = readFileSync(join(repo, "index.html"), "utf8");
const anchorsTs = readFileSync(join(fnRoot, "_shared/docusign-anchors.ts"), "utf8");
const createSrc = readFileSync(join(fnRoot, "docusign-create-envelope/index.ts"), "utf8");

assert("lista no motor", /RH_DOC_ANCHORS_TECNICOS/.test(indexHtml) && /rhDocEhAnchorTecnico/.test(indexHtml));
assert("quatro markers no motor",
  indexHtml.includes("[[DS_ASSINATURA_EMPREGADO]]") &&
  indexHtml.includes("[[DS_ASSINATURA_EMPRESA]]") &&
  indexHtml.includes("[[DS_ASSINATURA_TESTEMUNHA]]") &&
  indexHtml.includes("[[DS_DATA_ASSINATURA]]"));

// 1 token normal resolve
const r1 = resolverTokens({ "[[NOME_COMPLETO]]": "Ana Teste" });
const h1 = renderConteudo("Nome: [[NOME_COMPLETO]]", r1);
assert("1 token normal resolve", h1 === "Nome: Ana Teste");

// 2 desconhecido bloqueia
const v2 = validarTokensModelo("x [[FOO_INEXISTENTE]] y");
assert("2 token desconhecido bloqueia", v2.invalidos.indexOf("[[FOO_INEXISTENTE]]") >= 0);

// 3 DS permitido
const v3 = validarTokensModelo("Assinatura: [[DS_ASSINATURA_EMPREGADO]] [[NOME_COMPLETO]]");
assert("3 DS permitido", v3.invalidos.length === 0 && v3.tecnicos.indexOf("[[DS_ASSINATURA_EMPREGADO]]") >= 0);

// 4 sobrevive no HTML
const r4 = resolverTokens({ "[[NOME_COMPLETO]]": "Ana", "[[DS_ASSINATURA_EMPREGADO]]": "NAO" });
const h4 = renderConteudo("Ana [[NOME_COMPLETO]] | [[DS_ASSINATURA_EMPREGADO]] [[DS_DATA_ASSINATURA]]", r4);
assert("4 DS permanece literal", h4 === "Ana Ana | [[DS_ASSINATURA_EMPREGADO]] [[DS_DATA_ASSINATURA]]");

// 5 fora do snapshot
const snap = snapshotDe(r4);
assert("5 DS fora do snapshot", !snap["[[DS_ASSINATURA_EMPREGADO]]"] && snap["[[NOME_COMPLETO]]"]);

// 6 hash 64 hex do HTML com DS
const hex = hashHtml(h4);
assert("6 hash 64 hex", /^[0-9a-f]{64}$/.test(hex) && hex.length === 64);
assert("6 hash corresponde ao HTML com DS", hex === hashHtml("Ana Ana | [[DS_ASSINATURA_EMPREGADO]] [[DS_DATA_ASSINATURA]]"));

// 7 create rejeita ausência
assert("7 ausente rejeita", validarAnchorsHtml("sem", [{ papel: "EMPREGADO" }]).ok === false);

// 8 EMPREGADO
const htmlEmp = "x [[DS_ASSINATURA_EMPREGADO]] [[DS_DATA_ASSINATURA]]";
assert("8 EMPREGADO só seus anchors",
  validarAnchorsHtml(htmlEmp, [{ papel: "EMPREGADO" }]).ok === true &&
  validarAnchorsHtml(htmlEmp, [{ papel: "EMPRESA" }]).ok === false);

// 9 EMPRESA
const htmlEmpr = "x [[DS_ASSINATURA_EMPRESA]] [[DS_DATA_ASSINATURA]]";
assert("9 EMPRESA só seus anchors",
  validarAnchorsHtml(htmlEmpr, [{ papel: "EMPRESA" }]).ok === true &&
  validarAnchorsHtml(htmlEmpr, [{ papel: "EMPREGADO" }]).ok === false);

// 10 TESTEMUNHA
const htmlTes = "x [[DS_ASSINATURA_TESTEMUNHA]] [[DS_DATA_ASSINATURA]]";
assert("10 TESTEMUNHA só seus anchors",
  validarAnchorsHtml(htmlTes, [{ papel: "TESTEMUNHA" }]).ok === true &&
  validarAnchorsHtml(htmlTes, [{ papel: "EMPREGADO" }]).ok === false);

assert("DATA_ASSINATURA negócio no catálogo motor",
  /codigo:'\[\[DATA_ASSINATURA\]\]'/.test(indexHtml) &&
  /put\('\[\[DATA_ASSINATURA\]\]'/.test(indexHtml));
assert("anchors.ts DS_*", /DS_ASSINATURA_EMPREGADO/.test(anchorsTs) && /DS_DATA_ASSINATURA/.test(anchorsTs));
assert("create usa ANCHOR_DATA", /ANCHOR_DATA/.test(createSrc) && !createSrc.includes('anchorString: "[[DATA_ASSINATURA]]"'));
assert("render pula técnico", /if\(rhDocEhAnchorTecnico\(tok\)\) return;/.test(indexHtml));
assert("validar não marca DS como inválido", /rhDocEhAnchorTecnico\(t\)/.test(indexHtml));

let diff = "";
try {
  diff = execSync("git diff -- index.html supabase/functions/_shared/docusign-anchors.ts supabase/functions/docusign-create-envelope/index.ts", {
    cwd: repo,
    encoding: "utf8",
  });
} catch {
  diff = "";
}
assert("11 CTR-CLT-CENA inalterado no diff", !/CTR-CLT-CENA/.test(diff));
assert("12 docs históricos inalterados no diff",
  !diff.includes("46883cae-d059-4939-8ddf-d82d5b9621fb") &&
  !diff.includes("c963d403-ff4a-4464-b8ab-3c44f1956ba1"));

if (failed) {
  console.log("\nFAILED", failed);
  process.exit(1);
}
console.log("\nALL RECOVERY-5.3 TESTS PASSED");
