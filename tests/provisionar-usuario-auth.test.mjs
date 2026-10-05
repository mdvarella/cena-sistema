/**
 * Edge Function provisionar-usuario-auth — executa o index.ts real com Supabase simulado em memória.
 *   node tests/provisionar-usuario-auth.test.mjs
 *   node tests/provisionar-usuario-auth.test.mjs --alvo=tmp-fix/provisionar-usuario-auth.producao.ts
 */
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const argAlvo = process.argv.find((a) => a.startsWith("--alvo="));
const srcPath = argAlvo ? resolve(repo, argAlvo.slice(7)) : join(repo, "supabase/functions/provisionar-usuario-auth/index.ts");
const fonte = readFileSync(srcPath, "utf8");

let failed = 0;
function assert(name, cond) {
  if (cond) console.log("PASS", name);
  else { console.log("FAIL", name); failed++; }
}

const SERVICE = "service-role-key-SECRETA-nao-pode-vazar";
const ANON = "anon-key-publica";
const ENV = { SUPABASE_URL: "https://proj.supabase.co", SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE };

const U = {
  admin: "11111111-1111-4111-8111-111111111111",
  admin2: "22222222-2222-4222-8222-222222222222",
  comum: "33333333-3333-4333-8333-333333333333",
  adminInativo: "44444444-4444-4444-8444-444444444444",
  adminExcluido: "55555555-5555-4555-8555-555555555555",
  novo: "66666666-6666-4666-8666-666666666666",
  linked: "77777777-7777-4777-8777-777777777777",
  excluido: "88888888-8888-4888-8888-888888888888",
  pre: "99999999-9999-4999-8999-999999999999",
  upper: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  adminCaixa: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  semId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
};

function fresh() {
  const rows = [
    { id: U.admin, email: "admin@cena.com", perfil: "admin", ativo: true, deleted_at: null, auth_user_id: "auth-admin" },
    { id: U.admin2, email: "chefe@cena.com", perfil: "admin", ativo: true, deleted_at: null, auth_user_id: null },
    { id: U.comum, email: "comum@cena.com", perfil: "equipe", ativo: true, deleted_at: null, auth_user_id: "auth-comum" },
    { id: U.adminInativo, email: "inativo@cena.com", perfil: "admin", ativo: false, deleted_at: null, auth_user_id: "auth-inativo" },
    { id: U.adminExcluido, email: "excl@cena.com", perfil: "admin", ativo: true, deleted_at: "2026-01-01", auth_user_id: "auth-excl" },
    { id: U.adminCaixa, email: "caixa@cena.com", perfil: " Admin ", ativo: true, deleted_at: null, auth_user_id: "auth-caixa" },
    { id: U.novo, email: "novo@cena.com", perfil: "equipe", ativo: true, deleted_at: null, auth_user_id: null },
    { id: U.linked, email: "linked@cena.com", perfil: "equipe", ativo: true, deleted_at: null, auth_user_id: "auth-linked" },
    { id: U.excluido, email: "morto@cena.com", perfil: "equipe", ativo: true, deleted_at: "2026-02-02", auth_user_id: null },
    { id: U.pre, email: "pre@cena.com", perfil: "equipe", ativo: true, deleted_at: null, auth_user_id: null },
    { id: U.upper, email: "Upper@Cena.com", perfil: "equipe", ativo: true, deleted_at: null, auth_user_id: null },
  ];
  return {
    rows,
    authUsers: [
      { id: "auth-admin", email: "admin@cena.com" },
      { id: "auth-comum", email: "comum@cena.com" },
      { id: "auth-linked", email: "linked@cena.com" },
      { id: "auth-pre", email: "pre@cena.com" },
    ],
    tokens: {
      "tok-admin": { id: "auth-admin", email: "admin@cena.com" },
      "tok-caixa": { id: "auth-caixa", email: "caixa@cena.com" },
      "tok-semcad": { id: "auth-semcad", email: "ninguem@cena.com" },
      "tok-intruso": { id: "auth-intruso", email: "chefe@cena.com" },
      "tok-comum": { id: "auth-comum", email: "comum@cena.com" },
      "tok-inativo": { id: "auth-inativo", email: "inativo@cena.com" },
      "tok-excl": { id: "auth-excl", email: "excl@cena.com" },
    },
    db: [],
    authAdmin: [],
    signUp: 0,
    clients: [],
    nonServiceDb: 0,
    dbErro: null,
    aoCriar: null,
    seq: 0,
  };
}

let S = fresh();

function queryBuilder(table) {
  const q = { op: "select", patch: null, filtros: [], retorno: false };
  const run = (single) => {
    S.db.push({ table, op: q.op, patch: q.patch });
    if (S.dbErro && S.dbErro(q)) return Promise.resolve({ data: null, error: { message: "db indisponivel" } });
    const hit = S.rows.filter((r) => q.filtros.every((f) => f(r)));
    if (q.op === "update") {
      hit.forEach((r) => Object.assign(r, q.patch));
      return Promise.resolve({ data: q.retorno ? hit.map((r) => ({ id: r.id })) : null, error: null });
    }
    if (single) {
      if (hit.length > 1) return Promise.resolve({ data: null, error: { message: "multiplas linhas" } });
      return Promise.resolve({ data: hit[0] ? { ...hit[0] } : null, error: null });
    }
    return Promise.resolve({ data: hit.map((r) => ({ ...r })), error: null });
  };
  const b = {
    select() { if (q.op === "update") q.retorno = true; return b; },
    update(patch) { q.op = "update"; q.patch = patch; return b; },
    eq(col, val) { q.filtros.push((r) => r[col] === val); return b; },
    is(col, val) { q.filtros.push((r) => (r[col] ?? null) === val); return b; },
    maybeSingle() { return run(true); },
    then(ok, ko) { return run(false).then(ok, ko); },
  };
  return b;
}

globalThis.__cenaCreateClient = (url, key, opts) => {
  const header = opts?.global?.headers?.Authorization ?? null;
  S.clients.push({ key, header });
  const service = key === SERVICE;
  return {
    from(t) { if (!service) S.nonServiceDb++; return queryBuilder(t); },
    auth: {
      async getUser(jwt) {
        const tok = jwt ?? String(header ?? "").replace(/^Bearer /, "");
        const u = S.tokens[tok];
        return u ? { data: { user: { ...u } }, error: null } : { data: { user: null }, error: { message: "invalid JWT" } };
      },
      async signUp() { S.signUp++; return { data: null, error: { message: "signUp nao deveria ser chamado" } }; },
      admin: {
        async createUser(attrs) {
          if (!service) throw new Error("admin API sem service role");
          S.authAdmin.push({ fn: "createUser", attrs });
          if (S.authUsers.some((u) => u.email === attrs.email)) {
            return { data: { user: null }, error: { code: "email_exists", status: 422, message: "A user with this email address has already been registered" } };
          }
          const user = { id: "auth-novo-" + (++S.seq), email: attrs.email };
          S.authUsers.push(user);
          if (S.aoCriar) S.aoCriar();
          return { data: { user }, error: null };
        },
        async updateUserById(id, attrs) {
          if (!service) throw new Error("admin API sem service role");
          S.authAdmin.push({ fn: "updateUserById", id, attrs });
          return { data: { user: { id } }, error: null };
        },
        async listUsers() {
          S.authAdmin.push({ fn: "listUsers" });
          return { data: { users: S.authUsers.map((u) => ({ ...u })) }, error: null };
        },
      },
    },
  };
};

let handler = null;
globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h; } };

let codigo = fonte
  .replace(/^import \{ createClient \} from "[^"]+";$/m, "const createClient = globalThis.__cenaCreateClient;")
  .replace(/^import \{ serve \} from "[^"]+";$/m, "const serve = globalThis.Deno.serve;");
if (/^import /m.test(codigo)) throw new Error("import nao simulado em " + srcPath);
const tmp = join(tmpdir(), "prov-auth-" + process.pid + ".mts");
writeFileSync(tmp, codigo);
try { await import(pathToFileURL(tmp).href); } finally { rmSync(tmp, { force: true }); }
if (typeof handler !== "function") throw new Error("handler nao registrado");

const respostas = [];
async function chamar(tok, body, { method = "POST", authorization } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (authorization !== undefined) headers.Authorization = authorization;
  else if (tok) headers.Authorization = "Bearer " + tok;
  const init = { method, headers };
  if (method === "POST") init.body = typeof body === "string" ? body : JSON.stringify(body ?? {});
  const res = await handler(new Request("https://proj.supabase.co/functions/v1/provisionar-usuario-auth", init));
  const txt = await res.text();
  respostas.push(txt);
  let data = null;
  try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
  return { status: res.status, data, headers: res.headers };
}
const row = (id) => S.rows.find((r) => r.id === id);
const updates = () => S.db.filter((d) => d.op === "update");
const fns = (fn) => S.authAdmin.filter((c) => c.fn === fn);
const criarNovo = (extra) => ({ acao: "criar", usuario_id: U.novo, email: "novo@cena.com", senha: "123456", ...extra });

// 1. sem Authorization
S = fresh();
let r = await chamar(null, criarNovo());
assert("1 sem Authorization -> 401", r.status === 401 && r.data.error === "missing_authorization" && S.db.length === 0 && S.authAdmin.length === 0);
r = await chamar(null, criarNovo(), { authorization: "Basic abc" });
assert("1 Authorization nao-Bearer -> 401", r.status === 401);

// 2. JWT inválido
S = fresh();
r = await chamar("tok-falso", criarNovo());
assert("2 JWT invalido -> 401", r.status === 401 && r.data.error === "invalid_jwt" && S.db.length === 0 && S.authAdmin.length === 0);

// 3. autenticado sem cadastro vinculado
S = fresh();
r = await chamar("tok-semcad", criarNovo());
assert("3 autenticado sem usuarios_sistema vinculado -> 403", r.status === 403 && r.data.error === "forbidden");
assert("3 mensagem cita processo administrativo seguro", /processo administrativo seguro/.test(String(r.data.detail ?? r.data.message ?? "")));
assert("3 nada gravado nem provisionado", updates().length === 0 && S.authAdmin.length === 0);

// 4. e-mail de admin com outro auth_user_id
S = fresh();
r = await chamar("tok-intruso", criarNovo());
assert("4 e-mail de admin com outro auth_user_id -> 403", r.status === 403);
assert("4 sem auto-vinculo do admin por e-mail", row(U.admin2).auth_user_id === null && updates().length === 0);
assert("4 nenhuma conta criada/alterada", S.authAdmin.length === 0 && row(U.novo).auth_user_id === null);

// 5. não-admin / admin inativo / admin excluído
for (const [tok, nome] of [["tok-comum", "comum vinculado"], ["tok-inativo", "admin inativo"], ["tok-excl", "admin excluido"]]) {
  S = fresh();
  r = await chamar(tok, criarNovo());
  assert("5 " + nome + " -> 403", r.status === 403 && updates().length === 0 && S.authAdmin.length === 0);
}

// 6. admin real
S = fresh();
r = await chamar("tok-admin", criarNovo());
assert("6 admin real -> permitido", r.status === 200 && r.data.ok === true && r.data.requested_by === "auth-admin");
S = fresh();
r = await chamar("tok-caixa", criarNovo());
assert("6 perfil ' Admin ' normalizado -> permitido", r.status === 200);

// 7. criação usa admin.createUser
S = fresh();
r = await chamar("tok-admin", criarNovo());
const cu = fns("createUser");
assert("7 criar -> admin.createUser", cu.length === 1 && fns("updateUserById").length === 0);
assert("7 createUser com e-mail ERP, senha e email_confirm", cu[0]?.attrs.email === "novo@cena.com" && cu[0]?.attrs.password === "123456" && cu[0]?.attrs.email_confirm === true);
assert("7 vinculo gravado com a conta criada", /^auth-novo-/.test(r.data.auth_user_id) && row(U.novo).auth_user_id === r.data.auth_user_id);
S = fresh();
r = await chamar("tok-admin", { acao: "atualizar_senha", usuario_id: U.novo, email: "novo@cena.com", senha: "654321" });
assert("7 atualizar_senha sem conta Auth -> cria e vincula (compatibilidade)", r.status === 200 && fns("createUser").length === 1 && row(U.novo).auth_user_id === r.data.auth_user_id);

// 8. troca de senha usa admin.updateUserById
S = fresh();
r = await chamar("tok-admin", { acao: "atualizar_senha", usuario_id: U.linked, email: "linked@cena.com", senha: "abcdef" });
const up = fns("updateUserById");
assert("8 atualizar_senha -> admin.updateUserById na conta vinculada", r.status === 200 && up.length === 1 && up[0].id === "auth-linked" && fns("createUser").length === 0);
assert("8 updateUserById com senha e email_confirm", up[0]?.attrs.password === "abcdef" && up[0]?.attrs.email_confirm === true && up[0]?.attrs.email === "linked@cena.com");
assert("8 vinculo existente intacto", row(U.linked).auth_user_id === "auth-linked" && updates().length === 0);
S = fresh();
r = await chamar("tok-admin", { acao: "criar", usuario_id: U.linked, email: "linked@cena.com", senha: "abcdef" });
assert("8 criar em cadastro ja vinculado -> updateUserById", r.status === 200 && fns("updateUserById").length === 1 && fns("createUser").length === 0);

// Ação vincular e escolha de alvo pelo navegador
S = fresh();
r = await chamar("tok-admin", { acao: "vincular", usuario_id: U.novo, email: "novo@cena.com", auth_user_id: "auth-pre" });
assert("vincular com auth_user_id arbitrario -> 400 sem gravar", r.status === 400 && row(U.novo).auth_user_id === null && updates().length === 0);
S = fresh();
r = await chamar("tok-admin", { acao: "vincular", usuario_id: U.admin2, email: "chefe@cena.com" });
assert("vincular sem auth_user_id -> 400 sem gravar", r.status === 400 && row(U.admin2).auth_user_id === null);
S = fresh();
r = await chamar("tok-admin", criarNovo({ auth_user_id: "auth-pre" }));
assert("criar com auth_user_id no body -> 400", r.status === 400 && S.authAdmin.length === 0 && row(U.novo).auth_user_id === null);
S = fresh();
r = await chamar("tok-admin", criarNovo({ email: "atacante@evil.com" }));
assert("e-mail divergente do ERP -> 422 sem provisionar", r.status === 422 && r.data.error === "email_divergente" && S.authAdmin.length === 0);
S = fresh();
r = await chamar("tok-admin", { acao: "atualizar_senha", usuario_id: U.linked, email: "admin@cena.com", senha: "abcdef" });
assert("troca de senha com e-mail de outro cadastro -> 422", r.status === 422 && S.authAdmin.length === 0);
S = fresh();
r = await chamar("tok-admin", criarNovo({ email: "  Novo@Cena.COM " }));
assert("e-mail com caixa/espacos diferentes -> aceito, Auth recebe e-mail ERP", r.status === 200 && fns("createUser")[0]?.attrs.email === "novo@cena.com");
S = fresh();
r = await chamar("tok-admin", { acao: "criar", usuario_id: U.upper, email: "upper@cena.com", senha: "123456" });
assert("e-mail ERP com maiusculas -> Auth recebe minusculo", r.status === 200 && fns("createUser")[0]?.attrs.email === "upper@cena.com");

// Alvo
S = fresh();
r = await chamar("tok-admin", { acao: "criar", usuario_id: U.excluido, email: "morto@cena.com", senha: "123456" });
assert("alvo excluido -> 404", r.status === 404 && S.authAdmin.length === 0);
S = fresh();
r = await chamar("tok-admin", { acao: "criar", usuario_id: U.semId, email: "x@cena.com", senha: "123456" });
assert("alvo inexistente -> 404", r.status === 404 && S.authAdmin.length === 0);
S = fresh();
r = await chamar("tok-admin", { acao: "criar", usuario_id: "nao-e-uuid", email: "x@cena.com", senha: "123456" });
assert("usuario_id invalido -> 400", r.status === 400 && S.authAdmin.length === 0);
S = fresh();
r = await chamar("tok-admin", criarNovo({ senha: "123" }));
assert("senha curta -> 400", r.status === 400 && S.authAdmin.length === 0);

// Conta Auth pré-existente (signup público aberto)
S = fresh();
r = await chamar("tok-admin", { acao: "criar", usuario_id: U.pre, email: "pre@cena.com", senha: "123456" });
assert("conta Auth pre-existente -> 409", r.status === 409 && r.data.error === "conta_auth_preexistente");
assert("conta pre-existente nao vinculada nem alterada", row(U.pre).auth_user_id === null && fns("updateUserById").length === 0 && fns("listUsers").length === 0 && updates().length === 0);

// Corrida: cadastro vinculado entre a leitura e a gravação
S = fresh();
S.aoCriar = () => { row(U.novo).auth_user_id = "auth-outra-operacao"; };
r = await chamar("tok-admin", criarNovo());
assert("vinculo concorrente -> 409 sem sobrescrever", r.status === 409 && row(U.novo).auth_user_id === "auth-outra-operacao");

// Fail-closed
S = fresh();
S.dbErro = (q) => q.op === "select";
r = await chamar("tok-admin", criarNovo());
assert("erro de banco na autorizacao -> 500 sem provisionar", r.status === 500 && S.authAdmin.length === 0);
S = fresh();
const svc = ENV.SUPABASE_SERVICE_ROLE_KEY;
delete ENV.SUPABASE_SERVICE_ROLE_KEY;
r = await chamar("tok-admin", criarNovo());
ENV.SUPABASE_SERVICE_ROLE_KEY = svc;
assert("sem service role configurada -> 503", r.status === 503);
S = fresh();
r = await chamar("tok-admin", "{nao json");
assert("body invalido -> 400 sem provisionar", r.status === 400 && S.authAdmin.length === 0);
r = await chamar(null, null, { method: "OPTIONS" });
assert("OPTIONS -> 200 com CORS", r.status === 200 && r.headers.get("Access-Control-Allow-Origin") === "*");
r = await chamar("tok-admin", null, { method: "GET" });
assert("GET -> 405", r.status === 405);

// 9. sem auth.signUp
assert("9 nenhuma chamada a auth.signUp", S.signUp === 0 && !/\.signUp\s*\(/.test(fonte));

// 10. service role fora do navegador e das respostas
assert("10 service role nunca aparece nas respostas", respostas.length > 20 && respostas.every((t) => t.indexOf(SERVICE) < 0));
S = fresh();
await chamar("tok-admin", criarNovo());
const cliUser = S.clients.find((c) => c.key === ANON);
const cliSvc = S.clients.find((c) => c.key === SERVICE);
assert("10 JWT do usuario validado com anon key, service role sem o JWT do usuario", cliUser?.header === "Bearer tok-admin" && cliSvc && cliSvc.header === null && S.nonServiceDb === 0);
assert("10 service role lida so do ambiente da Edge", /Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)/.test(fonte) && !/eyJ[\w-]{10,}\.[\w-]{10,}/.test(fonte));
const html = readFileSync(join(repo, "index.html"), "utf8");
const jwts = html.match(/eyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]+/g) || [];
const roles = jwts.map((t) => { try { return JSON.parse(Buffer.from(t.split(".")[1], "base64url").toString()).role; } catch { return "?"; } });
assert("10 index.html sem JWT service_role", roles.length > 0 && roles.every((x) => x === "anon"));
assert("10 index.html sem SUPABASE_SERVICE_ROLE_KEY", html.indexOf("SUPABASE_SERVICE_ROLE_KEY") < 0);

console.log(failed ? "FALHAS: " + failed : "OK");
process.exit(failed ? 1 : 0);
