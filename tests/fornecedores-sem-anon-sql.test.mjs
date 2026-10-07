// FORNECEDORES SEM ACESSO ANON — testes SQL da migration 20261006185900_fornecedores_sem_acesso_anon.sql
// PostgreSQL embutido (PGlite) com as policies que existem hoje em produção. Não substitui a conferência no Supabase real.
// Uso: node tests/fornecedores-sem-anon-sql.test.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';

const here = path.dirname(fileURLToPath(import.meta.url));
let PGlite;
try {
  const dir = process.env.PGLITE_PATH || path.join(process.env.TEMP || '/tmp', 'pglite-cena');
  const req = createRequire(path.join(dir, 'package.json'));
  ({ PGlite } = await import(pathToFileURL(req.resolve('@electric-sql/pglite')).href));
} catch (e) {
  console.log('fornecedores-sem-anon-sql: SKIP (instale @electric-sql/pglite e defina PGLITE_PATH)');
  process.exit(0);
}

const migDir = path.join(here, '..', 'supabase', 'migrations');
const semNotify = s => s.replace(/NOTIFY pgrst[^;]*;/g, '');
const mig = semNotify(fs.readFileSync(path.join(migDir, '20261006185900_fornecedores_sem_acesso_anon.sql'), 'utf8'));
const migSync = semNotify(fs.readFileSync(path.join(migDir, '20261006190000_fornecedores_erp_sync.sql'), 'utf8'));

const failed = [];
let total = 0;
const ok = (n, c, d) => { total++; if (!c) failed.push(n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };

const U = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BASE = `
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
create table public.usuarios_sistema (id uuid primary key default gen_random_uuid(), perfil text, ativo boolean default true,
  auth_user_id uuid, deleted_at timestamptz);
insert into public.usuarios_sistema (perfil, auth_user_id) values ('gestor', '${U}');
create function public.cena_usuario_perfil_sessao() returns text language sql stable security definer set search_path = public, pg_temp as $$
  select nullif(lower(btrim(coalesce(us.perfil, ''))), '') from public.usuarios_sistema us
  where auth.uid() is not null and us.auth_user_id = auth.uid() and us.ativo is true and us.deleted_at is null limit 1 $$;
create function public.cena_usuario_erp_ativo() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.cena_usuario_perfil_sessao() is not null $$;
create table public.fornecedores (id uuid primary key default gen_random_uuid(), razao_social text not null, cnpj_cpf text,
  tipo text, contato text, telefone text, email text, status text default 'Ativo', deleted_at timestamptz);
insert into public.fornecedores (razao_social, cnpj_cpf) values ('Fornecedor A', '12345678000190');
alter table public.fornecedores enable row level security;
create policy "Acesso total" on public.fornecedores for all to anon, authenticated using (true) with check (true);
create policy fase2d_anon_all on public.fornecedores for all to anon using (true) with check (true);
`;
const POLICY_AUTH = `create policy fase2d_authenticated_all on public.fornecedores for all to authenticated using (true) with check (true);`;

async function novoBanco(extra) {
  const db = new PGlite();
  await db.exec(BASE + extra);
  return db;
}
async function como(db, role, uid, fn) {
  await db.exec(`set role ${role}`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid || '']);
  try { return await fn(); } finally { await db.exec('reset role'); await db.query(`select set_config('request.jwt.claim.sub', '', false)`); }
}
const tenta = async (db, sql) => { try { await db.exec(sql); return null; } catch (e) { return e.message; } };

// ── Estáticos ───────────────────────────────────────────────────
ok('não autoriza por e-mail', !/auth\.jwt\(\)|auth\.email\(\)/i.test(mig));
ok('sem GRANT para anon fora do bloco de desfazer', !/^GRANT[^;]*\banon\b/im.test(mig));
ok('sem DELETE de dados', !/\bDELETE FROM\b/i.test(mig));

// ── Estado de hoje: anon lê ─────────────────────────────────────
let db = await novoBanco(POLICY_AUTH);
const anonAntes = await como(db, 'anon', '', () => db.query('select count(*)::int n from public.fornecedores'));
ok('antes: anon lê fornecedores (estado atual de produção)', anonAntes.rows[0].n === 1);

// ── Aplicar ─────────────────────────────────────────────────────
let erro = await tenta(db, mig);
ok('aplica sem erro', erro === null, erro);
erro = await tenta(db, mig);
ok('reaplica sem erro (idempotente)', erro === null, erro);

const pols = (await db.query(`select policyname, roles::text r from pg_policies where tablename = 'fornecedores' order by 1`)).rows;
ok('sobra só a policy de authenticated', pols.length === 1 && pols[0].policyname === 'fase2d_authenticated_all', pols);

const anonSel = await como(db, 'anon', '', () => tenta(db, 'select * from public.fornecedores'));
ok('anon não lê', /permission denied/.test(anonSel || ''), anonSel);
const anonIns = await como(db, 'anon', '', () => tenta(db, `insert into public.fornecedores (razao_social) values ('x')`));
ok('anon não grava', /permission denied/.test(anonIns || ''), anonIns);
const anonUpd = await como(db, 'anon', '', () => tenta(db, `update public.fornecedores set contato = 'x'`));
ok('anon não altera', /permission denied/.test(anonUpd || ''), anonUpd);

const authLe = await como(db, 'authenticated', U, () => db.query('select count(*)::int n from public.fornecedores'));
ok('authenticated continua lendo', authLe.rows[0].n === 1);
const authIns = await como(db, 'authenticated', U, () => tenta(db, `insert into public.fornecedores (razao_social) values ('Novo')`));
ok('authenticated continua gravando', authIns === null, authIns);
const authUpd = await como(db, 'authenticated', U, () => tenta(db, `update public.fornecedores set contato = 'Ana' where razao_social = 'Novo'`));
ok('authenticated continua editando', authUpd === null, authUpd);

erro = await tenta(db, migSync);
ok('migration da sincronização aplica depois', erro === null, erro);
const authDepois = await como(db, 'authenticated', U, () => db.query('select count(*)::int n from public.fornecedores'));
ok('authenticated lê depois da sincronização instalada', authDepois.rows[0].n === 2);
await db.close();

// ── Fail-closed: sem policy própria de authenticated não remove nada ──
db = await novoBanco('');
erro = await tenta(db, mig);
ok('sem policy de authenticated: recusa', /sem outra policy ALL para authenticated/.test(erro || ''), erro);
const polsFc = (await db.query(`select count(*)::int n from pg_policies where tablename = 'fornecedores'`)).rows[0].n;
ok('sem policy de authenticated: nada removido', polsFc === 2, polsFc);
await db.close();

// ── Fail-closed: outra policy para anon não prevista ──
db = await novoBanco(POLICY_AUTH + `create policy outra_publica on public.fornecedores for select to public using (true);`);
erro = await tenta(db, mig);
ok('outra policy para public: recusa e lista o nome', /outra_publica/.test(erro || ''), erro);
await db.close();

if (failed.length) {
  console.log(`fornecedores-sem-anon-sql: FALHOU ${failed.length}/${total}`);
  failed.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log(`fornecedores-sem-anon-sql: OK (${total} verificações)`);
