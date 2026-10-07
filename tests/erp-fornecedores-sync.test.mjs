/**
 * Sincronização de fornecedores ERP — módulo compartilhado + Edge Function real com Supabase e ERP simulados.
 *   node tests/erp-fornecedores-sync.test.mjs
 * Sem rede, sem token real, sem banco.
 */
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const sharedPath = join(repo, "supabase/functions/_shared/erp-suppliers.ts");
const edgePath = join(repo, "supabase/functions/erp-fornecedores-sync/index.ts");
const M = await import(pathToFileURL(sharedPath).href);

let failed = 0;
let total = 0;
function assert(name, cond, extra) {
  total++;
  if (cond) return;
  console.log("FAIL", name, extra !== undefined ? JSON.stringify(extra) : "");
  failed++;
}

// ── 1. Módulo compartilhado ──────────────────────────────────────
assert("soDigitos", M.soDigitos("12.345.678/0001-90") === "12345678000190" && M.soDigitos(null) === "");
assert("docValido CNPJ 14", M.docValido("12345678000190"));
assert("docValido CPF 11", M.docValido("12345678901"));
assert("docValido recusa zerado", !M.docValido("00000000000000"));
assert("docValido recusa 13 dígitos", !M.docValido("1234567800019"));
assert("docValido recusa vazio", !M.docValido(""));

const RAW = {
  id: 2354, parent_supplier_id: null, name: "  ACME   Ltda ", trade_name: "Acme", cpf_cnpj: "65.839.392/0001-00",
  email: " Compras@ACME.com ", phone: null, mobile: "(11) 99999-0000", city: " Osasco ", state: "sp",
  is_active: true, bank_name: "Banco X", bank_account: "123", pix_key: "chave-pix", notes: "obs interna",
  created_at_humans: "há 2 meses", updated_at: "2026-10-01T12:00:00.000000Z",
};
const n1 = M.normalizarSupplier(RAW);
assert("normaliza razão social (espaços)", n1.razao_social === "ACME Ltda", n1);
assert("normaliza CNPJ só dígitos e válido", n1.cnpj_cpf === "65839392000100" && n1.doc_valido === true);
assert("e-mail minúsculo e sem espaços", n1.email === "compras@acme.com");
assert("telefone cai para o celular", n1.telefone === "(11) 99999-0000");
assert("cidade e UF", n1.cidade === "Osasco" && n1.estado === "SP");
assert("ativo", n1.ativo === true);
assert("updated_at ISO", n1.erp_updated_at === "2026-10-01T12:00:00.000Z", n1.erp_updated_at);
assert("só campos de cadastro e contato (sem banco, PIX, notas)",
  JSON.stringify(Object.keys(n1).sort()) === JSON.stringify(["ativo","cidade","cnpj_cpf","doc_valido","email","erp_id","erp_parent_id","erp_updated_at","estado","nome_fantasia","razao_social","telefone"]), Object.keys(n1));
assert("sem id: descarta", M.normalizarSupplier({ name: "X" }) === null);
assert("id inválido: descarta", M.normalizarSupplier({ id: "abc", name: "X" }) === null);
assert("sem nome e sem fantasia: descarta", M.normalizarSupplier({ id: 1, name: "  ", trade_name: "" }) === null);
assert("sem nome usa a fantasia", M.normalizarSupplier({ id: 1, name: "", trade_name: "Fantasia" }).razao_social === "Fantasia");
assert("is_active variantes", M.ativoErp(1) && M.ativoErp("1") && M.ativoErp("true") && !M.ativoErp(false) && !M.ativoErp(0) && !M.ativoErp(null));
assert("sem updated_at: null", M.normalizarSupplier({ id: 1, name: "X" }).erp_updated_at === null);

const hA = await M.hashFornecedor(n1);
const hB = await M.hashFornecedor(M.normalizarSupplier({ ...RAW, bank_account: "999", pix_key: "outra", notes: "x" }));
const hC = await M.hashFornecedor(M.normalizarSupplier({ ...RAW, name: "ACME Ltda Nova" }));
const hD = await M.hashFornecedor(M.normalizarSupplier({ ...RAW, updated_at: "2026-10-05T00:00:00Z" }));
assert("hash SHA-256 hex", /^[0-9a-f]{64}$/.test(hA));
assert("hash ignora campos não sincronizados (banco, PIX, notas)", hA === hB);
assert("hash muda quando o cadastro muda", hA !== hC);
assert("hash ignora updated_at sozinho", hA === hD);

const prep = await M.prepararItens([
  { id: 1, name: "A", cpf_cnpj: "11111111000111" },
  { id: 2, name: "B", cpf_cnpj: "11.111.111/0001-11" },
  { id: 3, name: "C", cpf_cnpj: "" },
  { id: 3, name: "C repetido", cpf_cnpj: "" },
  { id: 4, name: "" },
  { id: 5, name: "E", cpf_cnpj: "00000000000000" },
  { id: 6, name: "F", cpf_cnpj: "00000000000000" },
]);
assert("prepara: um por erp_id, inválido ignorado", prep.itens.length === 5 && prep.ignorados === 1, prep);
assert("prepara: CNPJ repetido no ERP marcado", prep.itens.filter((i) => i.cnpj_dup_erp).map((i) => i.erp_id).join() === "1,2");
assert("prepara: zerado não conta como repetido", !prep.itens.find((i) => i.erp_id === 5).cnpj_dup_erp);
assert("prepara: último registro do mesmo id vence", prep.itens.find((i) => i.erp_id === 3).razao_social === "C repetido");

const agora = Date.parse("2026-10-06T12:00:00Z");
const dia = 24 * 3600 * 1000;
assert("modo: simulação", M.escolherModo({ solicitado: "simulacao", watermark: "x", ultimaCompleta: "x", agora }) === "SIMULACAO");
assert("modo: completa pedida", M.escolherModo({ solicitado: "completa", watermark: "2026-10-05T00:00:00Z", ultimaCompleta: new Date(agora - dia).toISOString(), agora }) === "COMPLETA");
assert("modo: sem marca d'água -> completa", M.escolherModo({ solicitado: "auto", watermark: null, ultimaCompleta: new Date(agora - dia).toISOString(), agora }) === "COMPLETA");
assert("modo: sem completa anterior -> completa", M.escolherModo({ solicitado: "auto", watermark: "2026-10-05T00:00:00Z", ultimaCompleta: null, agora }) === "COMPLETA");
assert("modo: completa há 7 dias -> completa", M.escolherModo({ solicitado: "auto", watermark: "2026-10-05T00:00:00Z", ultimaCompleta: new Date(agora - 7 * dia).toISOString(), agora }) === "COMPLETA");
assert("modo: completa recente -> incremental", M.escolherModo({ solicitado: "auto", watermark: "2026-10-05T00:00:00Z", ultimaCompleta: new Date(agora - 2 * dia).toISOString(), agora }) === "INCREMENTAL");
assert("filtro incremental: marca d'água - 10 min, ISO UTC", M.filtroIncremental("2026-10-05T10:00:00.000Z").updated_since === "2026-10-05T09:50:00Z");
assert("maior updated_at", M.maiorUpdatedAt([{ erp_updated_at: "2026-10-01T00:00:00.000Z" }, { erp_updated_at: null }, { erp_updated_at: "2026-10-03T00:00:00.000Z" }]) === "2026-10-03T00:00:00.000Z");
assert("maior updated_at sem datas: null", M.maiorUpdatedAt([{ erp_updated_at: null }]) === null);
assert("ERP publica updated_at?", M.erpTemUpdatedAt([{ id: 1, updated_at: null }]) && !M.erpTemUpdatedAt([{ id: 1, last_updated_at_humans: "há 1 dia" }]));

// ── 2. Edge Function com Supabase e ERP simulados ────────────────
const TOKEN_ERP = "erp-token-SECRETO-nao-pode-vazar-123";
const SERVICE = "service-role-key-SECRETA";
const ANON = "anon-key-publica";
const CRON = "c".repeat(40);
const BASE_ENV = {
  SUPABASE_URL: "https://proj.supabase.co", SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE,
  ERP_CENABR_TOKEN: TOKEN_ERP, ERP_SYNC_CRON_SECRET: CRON,
};

function fornecedoresErp(n, comUpdated) {
  return Array.from({ length: n }, (_, i) => {
    const s = {
      id: i + 1, parent_supplier_id: null, name: "Fornecedor " + String(i + 1).padStart(4, "0"), trade_name: null,
      cpf_cnpj: i === 0 || i === 1 ? "99999999000199" : String(10000000000000 + i), email: null, phone: null, mobile: null,
      city: null, state: null, is_active: true, bank_account: "123-" + i, pix_key: "pix" + i, notes: null,
    };
    if (comUpdated) s.updated_at = new Date(Date.parse("2026-10-01T00:00:00Z") + i * 60000).toISOString();
    return s;
  });
}

let S;
function fresh(over = {}) {
  S = {
    env: { ...BASE_ENV },
    tokens: { "tok-gestor": "auth-gestor", "tok-equipe": "auth-equipe" },
    pode: { "auth-gestor": true, "auth-equipe": false },
    estado: { watermark_updated_at: null, ultima_completa_em: null, emExecucao: false },
    erp: fornecedoresErp(250, false),
    erpTotalExtra: 0,
    falhaPagina: {},
    erpStatus: null,
    rpcs: [],
    userRpcs: [],
    fetches: [],
    ausentesErro: null,
    ...over,
  };
}

globalThis.__cenaCreateClient = (url, key, opts) => {
  const header = opts?.global?.headers?.Authorization ?? null;
  const service = key === SERVICE;
  return {
    auth: {
      async getUser() {
        const uid = S.tokens[String(header ?? "").replace(/^Bearer /, "")];
        return uid ? { data: { user: { id: uid } }, error: null } : { data: { user: null }, error: { message: "invalid JWT" } };
      },
    },
    async rpc(fn, args) {
      if (!service) {
        S.userRpcs.push(fn);
        if (fn !== "cena_forn_pode_sincronizar_erp") return { data: null, error: { message: "nao permitido" } };
        const uid = S.tokens[String(header ?? "").replace(/^Bearer /, "")];
        return { data: S.pode[uid] === true, error: null };
      }
      S.rpcs.push({ fn, args: JSON.parse(JSON.stringify(args ?? {})) });
      if (fn === "fn_erp_sync_iniciar") {
        if (S.estado.emExecucao) return { data: null, error: { message: "ERP_SYNC_EM_EXECUCAO" } };
        S.estado.emExecucao = true;
        return { data: { execucao_id: "exec-1", watermark_updated_at: S.estado.watermark_updated_at, ultima_completa_em: S.estado.ultima_completa_em }, error: null };
      }
      if (fn === "fn_fornecedores_erp_aplicar") {
        return { data: { inseridos: args.p_itens.length, atualizados: 0, inalterados: 0, vinculados: 0, conflitos: 0, ignorados: 0, conflitos_lista: [] }, error: null };
      }
      if (fn === "fn_fornecedores_erp_marcar_ausentes") {
        if (S.ausentesErro) return { data: null, error: { message: S.ausentesErro } };
        return { data: 0, error: null };
      }
      if (fn === "fn_erp_sync_finalizar") {
        S.estado.emExecucao = false;
        if (args.p_status === "OK" && args.p_modo !== "SIMULACAO" && args.p_watermark_novo) S.estado.watermark_updated_at = args.p_watermark_novo;
        return { data: null, error: null };
      }
      return { data: null, error: { message: "rpc desconhecida " + fn } };
    },
  };
};

globalThis.fetch = async (url, init) => {
  const u = new URL(url);
  S.fetches.push({ url: u.toString(), auth: init?.headers?.Authorization });
  if (init?.headers?.Authorization !== "Bearer " + TOKEN_ERP) return new Response("{}", { status: 401 });
  if (S.erpStatus) return new Response("{}", { status: S.erpStatus });
  const page = Number(u.searchParams.get("page") || 1);
  const per = Math.min(100, Number(u.searchParams.get("per_page") || 15));
  const f = S.falhaPagina[page];
  if (f && f.vezes > 0) { f.vezes--; return new Response("{}", { status: f.status }); }
  let lista = S.erp;
  const since = u.searchParams.get("updated_since");
  if (since && lista.some((s) => "updated_at" in s)) lista = lista.filter((s) => Date.parse(s.updated_at) >= Date.parse(since));
  const last = Math.max(1, Math.ceil(lista.length / per));
  const data = lista.slice((page - 1) * per, page * per);
  return new Response(JSON.stringify({ data, links: {}, meta: { current_page: page, last_page: last, per_page: per, total: lista.length + S.erpTotalExtra } }), { status: 200, headers: { "Content-Type": "application/json" } });
};

let handler = null;
globalThis.Deno = { env: { get: (k) => S.env[k] }, serve: (h) => { handler = h; } };
const fonte = readFileSync(edgePath, "utf8");
const codigo = fonte
  .replace(/^import \{ createClient \} from "[^"]+";$/m, "const createClient = globalThis.__cenaCreateClient;")
  .replace(/from "\.\.\/_shared\/erp-suppliers\.ts";/, `from ${JSON.stringify(pathToFileURL(sharedPath).href)};`);
if (/from "https?:/.test(codigo)) throw new Error("import remoto não simulado");
const tmp = join(tmpdir(), "erp-forn-sync-" + process.pid + ".mts");
writeFileSync(tmp, codigo);
try { await import(pathToFileURL(tmp).href); } finally { rmSync(tmp, { force: true }); }
if (typeof handler !== "function") throw new Error("handler não registrado");

const respostas = [];
async function chamar({ tok, cron, body = { modo: "auto" }, method = "POST" } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (tok) headers.Authorization = "Bearer " + tok;
  if (cron !== undefined) headers["x-cron-secret"] = cron;
  const init = { method, headers };
  if (method === "POST") init.body = typeof body === "string" ? body : JSON.stringify(body);
  const res = await handler(new Request("https://proj.supabase.co/functions/v1/erp-fornecedores-sync", init));
  const txt = await res.text();
  respostas.push(txt);
  let data = null;
  try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
  return { status: res.status, data };
}
const rpc = (fn) => S.rpcs.filter((r) => r.fn === fn);
const fin = () => rpc("fn_erp_sync_finalizar")[0]?.args;

fresh();
let r = await chamar({ method: "OPTIONS" });
assert("OPTIONS 200", r.status === 200);
r = await chamar({ method: "GET" });
assert("GET 405", r.status === 405);

fresh(); S.env.ERP_CENABR_TOKEN = "";
r = await chamar({ cron: CRON });
assert("sem token do ERP configurado: 503", r.status === 503 && r.data.error === "erp_nao_configurado");

fresh();
r = await chamar({});
assert("sem Authorization e sem cron: 401", r.status === 401 && S.rpcs.length === 0 && S.fetches.length === 0);
r = await chamar({ tok: "tok-falso" });
assert("JWT inválido: 401", r.status === 401 && S.rpcs.length === 0);
r = await chamar({ tok: "tok-equipe" });
assert("perfil sem permissão: 403, nada lido nem gravado", r.status === 403 && S.rpcs.length === 0 && S.fetches.length === 0);
r = await chamar({ cron: "errado" });
assert("cron com segredo errado: 401", r.status === 401 && S.rpcs.length === 0);
r = await chamar({ cron: CRON, body: { modo: "simulacao" } });
assert("cron não roda simulação", r.status === 400);
r = await chamar({ tok: "tok-gestor", body: { modo: "tudo" } });
assert("modo inválido: 400", r.status === 400);
fresh(); S.env.ERP_SYNC_CRON_SECRET = "curto";
r = await chamar({ cron: "curto" });
assert("segredo do cron curto demais: 401", r.status === 401);

// Primeira execução pelo cron: completa, 3 páginas, 2 lotes, ausentes, sem marca d'água (ERP sem updated_at)
fresh();
r = await chamar({ cron: CRON });
assert("cron: 200 OK completa", r.status === 200 && r.data.ok && r.data.modo === "COMPLETA" && r.data.status === "OK", r.data);
assert("cron: iniciar com disparo CRON sem usuário", rpc("fn_erp_sync_iniciar")[0].args.p_disparo === "CRON" && rpc("fn_erp_sync_iniciar")[0].args.p_auth === null);
assert("lê 3 páginas de 100", S.fetches.length === 3 && S.fetches.every((f) => /per_page=100/.test(f.url)), S.fetches.map((f) => f.url));
assert("token do ERP só no cabeçalho para o ERP", S.fetches.every((f) => f.auth === "Bearer " + TOKEN_ERP && !f.url.includes(TOKEN_ERP)));
const lotes = rpc("fn_fornecedores_erp_aplicar");
assert("2 lotes (200 + 50)", lotes.length === 2 && lotes[0].args.p_itens.length === 200 && lotes[1].args.p_itens.length === 50);
assert("lote não simulado", lotes.every((l) => l.args.p_simular === false));
const it0 = lotes[0].args.p_itens[0];
assert("item enviado sem banco/PIX/notas", !("bank_account" in it0) && !("pix_key" in it0) && !("notes" in it0) && /^[0-9a-f]{64}$/.test(it0.hash), Object.keys(it0));
assert("CNPJ repetido no ERP marcado no item", lotes[0].args.p_itens.filter((i) => i.cnpj_dup_erp).length === 2);
const aus = rpc("fn_fornecedores_erp_marcar_ausentes");
assert("leitura completa inativa ausentes com os 250 IDs", aus.length === 1 && aus[0].args.p_ids_vistos.length === 250 && aus[0].args.p_total_erp === 250);
assert("finaliza OK sem marca d'água (ERP sem updated_at)", fin().p_status === "OK" && fin().p_modo === "COMPLETA" && fin().p_watermark_novo === null && fin().p_contadores.lidos === 250 && fin().p_contadores.inseridos === 250, fin());

// Manual com permissão: registra o usuário
fresh();
r = await chamar({ tok: "tok-gestor" });
assert("manual: 200 e disparo MANUAL com auth do usuário", r.status === 200 && rpc("fn_erp_sync_iniciar")[0].args.p_disparo === "MANUAL" && rpc("fn_erp_sync_iniciar")[0].args.p_auth === "auth-gestor");
assert("manual: cliente do usuário só checa a permissão", S.userRpcs.join() === "cena_forn_pode_sincronizar_erp");

// ERP com updated_at: completa grava a marca d'água; depois incremental lê só o que mudou
fresh({ erp: fornecedoresErp(250, true) });
r = await chamar({ cron: CRON });
assert("completa com updated_at grava a maior data como marca d'água", fin().p_watermark_novo === S.erp[249].updated_at, fin());
fresh({ erp: fornecedoresErp(250, true), estado: { watermark_updated_at: "2026-10-01T04:00:00.000Z", ultima_completa_em: new Date(Date.now() - 2 * 86400000).toISOString(), emExecucao: false } });
r = await chamar({ cron: CRON });
assert("incremental: 200 OK", r.status === 200 && r.data.modo === "INCREMENTAL" && r.data.status === "OK", r.data);
assert("incremental: updated_since = marca d'água - 10 min", S.fetches.length > 0 && S.fetches.every((f) => f.url.includes("updated_since=2026-10-01T03%3A50%3A00Z")), S.fetches.map((f) => f.url));
assert("incremental: lê só os alterados", fin().p_contadores.lidos === 250 - 230, fin().p_contadores);
assert("incremental: não inativa ausentes", rpc("fn_fornecedores_erp_marcar_ausentes").length === 0);
assert("incremental: avança marca d'água", fin().p_watermark_novo === S.erp[249].updated_at);

// Marca d'água existe mas o ERP deixou de publicar updated_at: volta para completa
fresh({ estado: { watermark_updated_at: "2026-10-01T04:00:00.000Z", ultima_completa_em: new Date(Date.now() - 86400000).toISOString(), emExecucao: false } });
r = await chamar({ cron: CRON });
assert("ERP sem updated_at: cai para completa e inativa ausentes", r.data.modo === "COMPLETA" && rpc("fn_fornecedores_erp_marcar_ausentes").length === 1 && S.fetches.some((f) => !f.url.includes("updated_since")), r.data);

// Completa semanal
fresh({ erp: fornecedoresErp(50, true), estado: { watermark_updated_at: "2026-10-01T04:00:00.000Z", ultima_completa_em: new Date(Date.now() - 8 * 86400000).toISOString(), emExecucao: false } });
r = await chamar({ cron: CRON });
assert("última completa há mais de 7 dias: completa", r.data.modo === "COMPLETA" && S.fetches.every((f) => !f.url.includes("updated_since")));

// Falha transitória: repete e conclui
fresh({ falhaPagina: { 2: { status: 503, vezes: 1 } } });
r = await chamar({ cron: CRON });
assert("falha transitória na página 2: repete e conclui OK", r.status === 200 && r.data.status === "OK" && S.fetches.filter((f) => /[?&]page=2/.test(f.url)).length === 2);

// Falha persistente: ERRO, nada de ausentes, trava liberada
fresh({ falhaPagina: { 3: { status: 500, vezes: 99 } } });
r = await chamar({ cron: CRON });
assert("falha persistente: 502 erp_indisponivel", r.status === 502 && r.data.error === "erp_indisponivel", r.data);
assert("falha persistente: nada gravado nem inativado", rpc("fn_fornecedores_erp_aplicar").length === 0 && rpc("fn_fornecedores_erp_marcar_ausentes").length === 0);
assert("falha persistente: finaliza ERRO sem marca d'água (libera a trava)", fin().p_status === "ERRO" && fin().p_watermark_novo === null && S.estado.emExecucao === false);

// ERP recusa o token: sem repetir, sem vazar
fresh({ erpStatus: 401 });
r = await chamar({ cron: CRON });
assert("ERP 401: não repete", r.status === 502 && S.fetches.length === 1);

// Leitura incompleta (ERP informa mais registros do que entregou)
fresh({ erpTotalExtra: 3 });
r = await chamar({ cron: CRON });
assert("leitura incompleta: PARCIAL, grava o que leu, não inativa", r.status === 200 && r.data.status === "PARCIAL" && rpc("fn_fornecedores_erp_aplicar").length === 2 && rpc("fn_fornecedores_erp_marcar_ausentes").length === 0, r.data);
assert("leitura incompleta: não avança marca d'água", fin().p_status === "PARCIAL" && fin().p_watermark_novo === null && /leitura incompleta/.test(fin().p_erro));

// Limite de ausentes recusado pelo banco
fresh({ ausentesErro: "ERP_SYNC_AUSENTES_ACIMA_DO_LIMITE: 300 ausentes de 400 vinculados (limite 40)" });
r = await chamar({ cron: CRON });
assert("limite de ausentes: PARCIAL com aviso", r.data.status === "PARCIAL" && /AUSENTES_ACIMA_DO_LIMITE/.test(r.data.aviso), r.data);

// Execução simultânea
fresh({ estado: { watermark_updated_at: null, ultima_completa_em: null, emExecucao: true } });
r = await chamar({ cron: CRON });
assert("execução simultânea: 409", r.status === 409 && r.data.error === "em_execucao" && S.fetches.length === 0);

// Simulação manual
fresh();
r = await chamar({ tok: "tok-gestor", body: { modo: "simulacao" } });
assert("simulação: lotes com p_simular, sem ausentes, finaliza SIMULACAO", r.status === 200 && r.data.modo === "SIMULACAO"
  && rpc("fn_fornecedores_erp_aplicar").every((l) => l.args.p_simular === true)
  && rpc("fn_fornecedores_erp_marcar_ausentes").length === 0 && fin().p_modo === "SIMULACAO", r.data);

// Nenhuma resposta expõe segredos
assert("nenhuma resposta contém o token do ERP, a service role ou o segredo do cron",
  respostas.every((t) => !t.includes(TOKEN_ERP) && !t.includes(SERVICE) && !t.includes(CRON)));

// ── 3. Estáticos da Edge ─────────────────────────────────────────
assert("Edge: service_role só depois da autorização", fonte.indexOf("createClient(supabaseUrl, serviceKey") > fonte.indexOf("cena_forn_pode_sincronizar_erp"));
assert("Edge: comparação do segredo em tempo constante", /function iguais\(/.test(fonte) && !/cronHeader\s*===\s*cronSecret/.test(fonte));
assert("config.toml: verify_jwt = false para o cron", /\[functions\.erp-fornecedores-sync\]\s*\r?\nverify_jwt = false/.test(readFileSync(join(repo, "supabase/config.toml"), "utf8")));

if (failed) { console.log(`erp-fornecedores-sync: FALHOU ${failed}/${total}`); process.exit(1); }
console.log(`erp-fornecedores-sync: OK (${total} verificações)`);
