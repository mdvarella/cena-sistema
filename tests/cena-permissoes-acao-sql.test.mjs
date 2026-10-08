// ETAPA 1.1 — testes SQL da migration 20261007190000_cena_permissoes_acao.sql
// PostgreSQL embutido (PGlite) com os helpers reais de sessão (20261004190000_seguranca_usuarios_sistema.sql)
// e a função real cena_prog_pode_programar_projetos() (20261004200000_prog_projetos_agenda.sql).
// Teste auxiliar: não substitui a conferência no Supabase real.
// Uso: PGLITE_PATH=<pasta com node_modules/@electric-sql/pglite> node tests/cena-permissoes-acao-sql.test.mjs
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
  console.log('cena-permissoes-acao-sql: SKIP (instale @electric-sql/pglite e defina PGLITE_PATH)');
  process.exit(0);
}

const migDir = path.join(here, '..', 'supabase', 'migrations');
const semNotify = s => s.replace(/NOTIFY pgrst[^;]*;/g, '');
const ler = f => fs.readFileSync(path.join(migDir, f), 'utf8');
const migRaw = ler('20261007190000_cena_permissoes_acao.sql');
const mig = semNotify(migRaw);
const codigo = migRaw.slice(0, migRaw.indexOf('-- Validação')).replace(/--[^\n]*/g, '');
const desfazer = migRaw.slice(migRaw.indexOf('-- Para desfazer')).split(/\r?\n/).slice(1)
  .map(l => l.replace(/^--\s?/, '')).join('\n').trim();
const migSeg = semNotify(ler('20261004190000_seguranca_usuarios_sistema.sql'));
const migProg = ler('20261004200000_prog_projetos_agenda.sql');
const iniProg = migProg.indexOf('CREATE OR REPLACE FUNCTION public.cena_prog_pode_programar_projetos()');
const fimMarca = 'GRANT EXECUTE ON FUNCTION public.cena_prog_pode_programar_projetos() TO authenticated;';
const fnProg = migProg.slice(iniProg, migProg.indexOf(fimMarca) + fimMarca.length);

const failed = [];
let total = 0;
const ok = (n, c, d) => { total++; if (!c) failed.push(n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };

// ── Estáticos ───────────────────────────────────────────────────
ok('função real de PROJ_PROGRAMAR extraída', iniProg > 0 && fnProg.includes('RETURN coalesce(v_perfil'));
ok('migration recarrega o cache do PostgREST', /NOTIFY pgrst, 'reload schema';/.test(migRaw));
ok('27. nenhuma autorização por e-mail (auth.jwt/auth.email/email)', !/auth\.jwt\(\)|auth\.email\(\)|\bemail\b/i.test(codigo));
ok('sem GRANT para anon', !/^\s*GRANT\b[^;]*\banon\b/im.test(codigo));
ok('sem GRANT de escrita para authenticated', !/^\s*GRANT\s+(ALL|INSERT|UPDATE|DELETE)\b[^;]*\bauthenticated\b/im.test(codigo));
ok('sem policy USING (true)', !/USING\s*\(\s*true\s*\)/i.test(codigo));
ok('sem DELETE de dados', !/\bDELETE FROM\b/i.test(codigo));
ok('29. sem credencial/JWT/service key na migration',
  !/eyJ[A-Za-z0-9_-]{10,}|sb_secret_|SERVICE_ROLE_KEY|sk_live|password\s*=/i.test(migRaw));
ok('30. migration não referencia TMA / composicao_dia / equipes_disp / WhatsApp',
  !/\btma\b|progTma|composicao_dia|equipes_disp|whatsapp|plpt_/i.test(codigo));
ok('não altera usuarios_sistema / perfis_sistema / contratos',
  !/(ALTER TABLE|UPDATE|INSERT INTO)\s+public\.(usuarios_sistema|perfis_sistema|contratos)\b/i.test(codigo));
ok('não cadastra ALM_SAP_RESERVAR', !/ALM_SAP_RESERVAR/.test(codigo));
ok('não usa db reset / DROP TABLE fora do bloco de desfazer', !/\bDROP TABLE\b/i.test(codigo));
const codigoLimpo = codigo.trim();
ok('transação explícita: BEGIN; é o primeiro comando (antes das pré-condições)',
  codigoLimpo.startsWith('BEGIN;') && codigoLimpo.indexOf('BEGIN;') < codigoLimpo.indexOf('DO $$'));
ok('transação explícita: COMMIT; é o último comando, depois do NOTIFY',
  codigoLimpo.endsWith('COMMIT;') && codigoLimpo.indexOf("NOTIFY pgrst, 'reload schema';") < codigoLimpo.lastIndexOf('COMMIT;'));
ok('transação explícita: um único BEGIN; e um único COMMIT; de topo, sem ROLLBACK',
  (codigo.match(/^BEGIN;/gm) || []).length === 1 && (codigo.match(/^COMMIT;/gm) || []).length === 1 && !/\bROLLBACK\b/i.test(codigo));
ok('não percorre pg_policies nem apaga policy por nome dinâmico',
  !/pg_policies/i.test(codigo) && !/DROP POLICY\s+%I/i.test(codigo));
const dropsPolicy = [...codigo.matchAll(/DROP POLICY\s+(?:IF EXISTS\s+)?(\w+)\s+ON\s+public\.(\w+)/gi)].map(m => `${m[2]}.${m[1]}`).sort();
ok('DROP POLICY só das 3 policies desta migration', JSON.stringify(dropsPolicy) === JSON.stringify([
  'cena_acoes.cena_acoes_select_erp',
  'cena_permissoes_acao.cena_permissoes_acao_select_admin',
  'cena_permissoes_acao_eventos.cena_permissoes_acao_eventos_select_admin']), dropsPolicy);
ok('todo DROP POLICY é IF EXISTS', !/DROP POLICY\s+(?!IF EXISTS)/i.test(codigo));

// ── Banco ───────────────────────────────────────────────────────
const U = n => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PERFIS = ['admin', 'gestor', 'coordenador', 'supervisor', 'escritorio', 'administrativo', 'supervisor_tma',
  'equipe', 'encarregado', 'portaria', 'sesmt', 'almoxarife', 'dp', 'supervisor_frotas', 'diretoria', 'rh',
  'gerente_frotas', 'motorista'];
const UID = Object.fromEntries(PERFIS.map((p, i) => [p, U(i + 1)]));
const U_ADMIN_INATIVO = U(901);
const U_ADMIN_EXCLUIDO = U(902);
const U_SEM_CADASTRO = U(903);
const U_OUTRO_AUTH = U(904);
const U_ADMIN2 = U(905);
const C_ATIVO = 'c0000000-0000-4000-8000-000000000001';
const C_CANCELADO = 'c0000000-0000-4000-8000-000000000002';
const C_ENCERRADO = 'c0000000-0000-4000-8000-000000000003';
const C_ATIVO2 = 'c0000000-0000-4000-8000-000000000004';
const C_INEXISTENTE = 'c0000000-0000-4000-8000-0000000000ff';

const BASE = (opts = {}) => `
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
create table public.usuarios_sistema (id uuid primary key default gen_random_uuid(), nome text, email text unique,
  perfil text, ativo boolean default true, auth_user_id uuid, deleted_at timestamptz);
insert into public.usuarios_sistema (nome, email, perfil, auth_user_id) values
  ${PERFIS.map(p => `('${p}', '${p}@cena', '${p}', '${UID[p]}')`).join(',\n  ')},
  ('admin 2', 'admin2@cena', ' Admin ', '${U_ADMIN2}');
insert into public.usuarios_sistema (nome, email, perfil, auth_user_id, ativo) values ('ex-admin', 'ex@cena', 'admin', '${U_ADMIN_INATIVO}', false);
insert into public.usuarios_sistema (nome, email, perfil, auth_user_id, deleted_at) values ('excluído', 'del@cena', 'admin', '${U_ADMIN_EXCLUIDO}', now());
create table public.contratos (id uuid primary key default gen_random_uuid(), codigo text, nome text, status text${opts.contratoDeleted ? ', deleted_at timestamptz' : ''});
insert into public.contratos (id, codigo, nome, status) values
  ('${C_ATIVO}', '4600003971', 'RDSE', 'Ativo'),
  ('${C_CANCELADO}', '4600000001', 'Cancelado', 'Cancelado'),
  ('${C_ENCERRADO}', '4600000002', 'Encerrado', 'Encerrado'),
  ('${C_ATIVO2}', '4600000003', 'Outro', 'Ativo');
create table public.composicao_dia (id uuid primary key default gen_random_uuid(), equipe_id text, data date, projeto_ids text);
create table public.equipes_disp (id uuid primary key default gen_random_uuid(), equipe_id text, data date);
insert into public.composicao_dia (equipe_id, data) values ('EQ1', '2026-10-07');
insert into public.equipes_disp (equipe_id, data) values ('EQ1', '2026-10-07');
`;

async function novoBanco(opts = {}) {
  const db = new PGlite();
  await db.exec(BASE(opts));
  await db.exec(migSeg);
  if (!opts.semProg) await db.exec(opts.progAlterado ? fnProg.replace(",'escritorio')", ",'escritorio','equipe')") : fnProg);
  return db;
}
async function como(db, role, uid, fn, email) {
  await db.exec(`set role ${role}`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid || '']);
  await db.query(`select set_config('request.jwt.claims', $1, false)`,
    [uid || email ? JSON.stringify({ sub: uid || undefined, email: email || undefined, role }) : '']);
  try { return await fn(); } finally {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
    await db.query(`select set_config('request.jwt.claims', '', false)`);
  }
}
const tenta = async (db, sql, params) => { try { await db.query(sql, params); return null; } catch (e) { return e.message; } };
// Falha dentro do BEGIN explícito deixa a sessão em transação abortada: ROLLBACK como faria o SQL Editor ao descartar.
const tentaExec = async (db, sql) => {
  try { await db.exec(sql); return null; } catch (e) {
    try { await db.exec('ROLLBACK'); } catch (_) {}
    return e.message;
  }
};
const pode = (db, uid, acao, contrato) => como(db, 'authenticated', uid, async () =>
  (await db.query('select public.cena_pode($1, $2::uuid) v', [acao, contrato || null])).rows[0].v);

const MATRIZ = {
  PROJ_IMPORTAR_LMS: ['admin', 'gestor', 'coordenador', 'escritorio', 'administrativo'],
  PROJ_CONCILIAR_LMS: ['admin', 'gestor', 'coordenador', 'escritorio', 'administrativo'],
  PROJ_EDITAR_WL: ['admin', 'gestor', 'coordenador', 'escritorio', 'administrativo'],
  PROJ_REALIZAR_VIABILIDADE: ['admin', 'gestor', 'coordenador', 'supervisor'],
  PROJ_AVALIAR_CENA: ['admin', 'gestor', 'coordenador', 'escritorio'],
  PROJ_APROVAR_AVALIACAO_CENA: ['admin', 'gestor', 'coordenador'],
  PROJ_REGISTRAR_RETORNO_ENEL: ['admin', 'gestor', 'coordenador', 'escritorio', 'administrativo'],
  PROJ_PROGRAMAR: ['admin', 'diretoria', 'gestor', 'coordenador', 'supervisor', 'administrativo', 'escritorio'],
  PROJ_ALTERAR_PERFIL_PROCESSO: ['admin', 'gestor'],
};
const ACOES = Object.keys(MATRIZ);

let db = await novoBanco();
const tmaAntes = (await db.query(`
  select (select count(*) from public.composicao_dia)::int cd, (select count(*) from public.equipes_disp)::int ed,
         (select count(*) from pg_trigger where tgrelid in ('public.composicao_dia'::regclass, 'public.equipes_disp'::regclass))::int trg,
         (select count(*) from pg_policies where tablename in ('composicao_dia', 'equipes_disp'))::int pol,
         (select md5(string_agg(pg_get_functiondef(p.oid), '' order by p.oid)) from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname in
           ('cena_prog_pode_programar_projetos','cena_usuario_perfil_sessao','cena_usuarios_pode_administrar')) fns`)).rows[0];
const usuariosAntes = (await db.query(`select md5(string_agg(t::text, '' order by id)) h from public.usuarios_sistema t`)).rows[0].h;

let erro = await tentaExec(db, mig);
ok('aplica sem erro', erro === null, erro);
const contagem = async () => (await db.query(`select (select count(*) from public.cena_acoes)::int a,
  (select count(*) from public.cena_permissoes_acao)::int p, (select count(*) from public.cena_permissoes_acao_eventos)::int e`)).rows[0];
const c1 = await contagem();
erro = await tentaExec(db, mig);
ok('reaplica sem erro (idempotente)', erro === null, erro);
const c2 = await contagem();
ok('reaplicar não duplica ações, regras nem eventos', JSON.stringify(c1) === JSON.stringify(c2), [c1, c2]);
ok('9 ações cadastradas', c1.a === 9, c1);
const totalSeed = Object.values(MATRIZ).reduce((s, l) => s + l.length, 0);
ok('seed: uma regra por concessão aprovada', c1.p === totalSeed, [c1.p, totalSeed]);
ok('seed gera um evento CONCEDER por regra', c1.e === totalSeed, c1);

// ── 21. Matriz exatamente como aprovada (tabela) ────────────────
const seed = (await db.query(`select acao, perfil, contrato_id, permitido, deleted_at from public.cena_permissoes_acao order by acao, perfil`)).rows;
ok('seed: tudo global, permitido, vivo', seed.every(r => r.contrato_id === null && r.permitido === true && r.deleted_at === null));
const porAcao = {};
seed.forEach(r => { (porAcao[r.acao] ||= []).push(r.perfil); });
for (const a of ACOES) ok(`21. matriz exata (tabela) — ${a}`, JSON.stringify(porAcao[a] || []) === JSON.stringify([...MATRIZ[a]].sort()), porAcao[a]);
ok('seed sem perfis fora da matriz', Object.keys(porAcao).every(a => ACOES.includes(a)));

// ── 21/11/17. Matriz exata via cena_pode para cada perfil real ──
const divergencias = [];
for (const p of PERFIS) for (const a of ACOES) {
  const v = await pode(db, UID[p], a);
  if (v !== MATRIZ[a].includes(p)) divergencias.push(`${p}/${a}=${v}`);
}
ok('21. cena_pode reproduz a matriz para os 18 perfis × 9 ações', divergencias.length === 0, divergencias);
ok('11. supervisor_tma sem nenhuma ação', (await Promise.all(ACOES.map(a => pode(db, UID.supervisor_tma, a)))).every(v => v === false));
ok('11. equipe / encarregado / motorista sem nenhuma ação',
  (await Promise.all(['equipe', 'encarregado', 'motorista'].flatMap(p => ACOES.map(a => pode(db, UID[p], a))))).every(v => v === false));

// 17. PROJ_PROGRAMAR = cena_prog_pode_programar_projetos() para todos os usuários (inclusive inativo/excluído/sem cadastro)
const difProg = [];
for (const uid of [...Object.values(UID), U_ADMIN_INATIVO, U_ADMIN_EXCLUIDO, U_SEM_CADASTRO, U_ADMIN2, '']) {
  const r = await como(db, 'authenticated', uid, async () =>
    (await db.query(`select public.cena_pode('PROJ_PROGRAMAR') a, public.cena_prog_pode_programar_projetos() b`)).rows[0]);
  if (r.a !== r.b) difProg.push(`${uid}: cena_pode=${r.a} atual=${r.b}`);
}
ok('17. PROJ_PROGRAMAR idêntica a cena_prog_pode_programar_projetos() para todos', difProg.length === 0, difProg);
ok('17. PROJ_PROGRAMAR tem exatamente os 7 perfis', (porAcao.PROJ_PROGRAMAR || []).length === 7, porAcao.PROJ_PROGRAMAR);
ok('18. admin possui PROJ_ALTERAR_PERFIL_PROCESSO', await pode(db, UID.admin, 'PROJ_ALTERAR_PERFIL_PROCESSO') === true);
ok('19. gestor possui PROJ_ALTERAR_PERFIL_PROCESSO', await pode(db, UID.gestor, 'PROJ_ALTERAR_PERFIL_PROCESSO') === true);
ok('20. demais perfis sem PROJ_ALTERAR_PERFIL_PROCESSO',
  (await Promise.all(PERFIS.filter(p => !['admin', 'gestor'].includes(p)).map(p => pode(db, UID[p], 'PROJ_ALTERAR_PERFIL_PROCESSO')))).every(v => v === false));
ok('perfil com espaços/maiúsculas no cadastro (" Admin ") é normalizado como hoje', await pode(db, U_ADMIN2, 'PROJ_ALTERAR_PERFIL_PROCESSO') === true);

// ── 1/2/26. anon ────────────────────────────────────────────────
for (const t of ['cena_acoes', 'cena_permissoes_acao', 'cena_permissoes_acao_eventos']) {
  const e = await como(db, 'anon', '', () => tenta(db, `select * from public.${t}`));
  ok(`1. anon não lê ${t}`, /permission denied/.test(e || ''), e);
}
ok('2. anon não insere na matriz', /permission denied/.test(await como(db, 'anon', '',
  () => tenta(db, `insert into public.cena_permissoes_acao (perfil, acao, permitido) values ('equipe', 'PROJ_PROGRAMAR', true)`)) || ''));
ok('2. anon não altera a matriz', /permission denied/.test(await como(db, 'anon', '',
  () => tenta(db, `update public.cena_permissoes_acao set permitido = false`)) || ''));
ok('2. anon não apaga a matriz', /permission denied/.test(await como(db, 'anon', '',
  () => tenta(db, `delete from public.cena_permissoes_acao`)) || ''));
ok('2. anon não insere ação', /permission denied/.test(await como(db, 'anon', '',
  () => tenta(db, `insert into public.cena_acoes (codigo, modulo, descricao) values ('XYZ_TESTE', 'X', 'x')`)) || ''));
for (const f of ["public.cena_pode('PROJ_PROGRAMAR')",
  "public.cena_permissao_acao_conceder('equipe', 'PROJ_PROGRAMAR', 'x')",
  "public.cena_permissao_acao_negar('equipe', 'PROJ_PROGRAMAR', 'x')",
  "public.cena_permissao_acao_revogar('gestor', 'PROJ_PROGRAMAR', 'x')"]) {
  const e = await como(db, 'anon', UID.admin, () => tenta(db, `select ${f}`));
  ok(`26. anon não executa ${f.split('(')[0]}`, /permission denied/.test(e || ''), e);
}
const privs = (await db.query(`
  select p.proname, r.rolname, has_function_privilege(r.rolname, p.oid, 'EXECUTE') pode
  from pg_proc p cross join (values ('anon'), ('authenticated'), ('service_role')) r(rolname)
  where p.pronamespace = 'public'::regnamespace
    and (p.proname like 'cena_permiss%' or p.proname in ('cena_pode', 'cena_contrato_ativo'))`)).rows;
const publicos = (await db.query(`
  select p.proname from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where p.pronamespace = 'public'::regnamespace and a.grantee = 0
    and (p.proname like 'cena_permiss%' or p.proname in ('cena_pode', 'cena_contrato_ativo'))`)).rows;
ok('26. PUBLIC sem EXECUTE em nenhuma função nova', publicos.length === 0, publicos);
ok('26. anon sem EXECUTE em nenhuma função nova', privs.filter(r => r.rolname === 'anon' && r.pode).length === 0);
const expostas = ['cena_pode', 'cena_permissao_acao_conceder', 'cena_permissao_acao_negar', 'cena_permissao_acao_revogar'];
ok('authenticated executa só cena_pode e as 3 RPCs', JSON.stringify(privs.filter(r => r.rolname === 'authenticated' && r.pode).map(r => r.proname).sort()) === JSON.stringify([...expostas].sort()),
  privs.filter(r => r.rolname === 'authenticated' && r.pode).map(r => r.proname));
ok('service_role não executa cena_pode nem as RPCs', privs.filter(r => r.rolname === 'service_role' && r.pode).length === 0,
  privs.filter(r => r.rolname === 'service_role' && r.pode));

// ── 3–10. cena_pode fail-closed ─────────────────────────────────
ok('3. sem sessão (authenticated sem sub) → false', await pode(db, '', 'PROJ_PROGRAMAR') === false);
ok('3. dono/SQL Editor sem JWT → false', (await db.query(`select public.cena_pode('PROJ_PROGRAMAR') v`)).rows[0].v === false);
const eSr = await como(db, 'service_role', '', () => tenta(db, `select public.cena_pode('PROJ_PROGRAMAR')`));
ok('3. service_role não é confundido com administrador (sem EXECUTE)', /permission denied/.test(eSr || ''), eSr);
ok('4. Auth sem usuarios_sistema vinculado → false', await pode(db, U_SEM_CADASTRO, 'PROJ_PROGRAMAR') === false);
ok('5. usuário ERP inativo (admin) → false', await pode(db, U_ADMIN_INATIVO, 'PROJ_ALTERAR_PERFIL_PROCESSO') === false);
ok('6. usuário excluído (admin) → false', await pode(db, U_ADMIN_EXCLUIDO, 'PROJ_ALTERAR_PERFIL_PROCESSO') === false);
const vEmail = await como(db, 'authenticated', U_OUTRO_AUTH, async () =>
  (await db.query(`select public.cena_pode('PROJ_ALTERAR_PERFIL_PROCESSO') v`)).rows[0].v, 'admin@cena');
ok('7. mesmo e-mail do admin com outro auth.uid() → false', vEmail === false);
const eEmailAdm = await como(db, 'authenticated', U_OUTRO_AUTH,
  () => tenta(db, `select public.cena_permissao_acao_conceder('equipe', 'PROJ_PROGRAMAR', 'tentativa')`), 'admin@cena');
ok('7. mesmo e-mail do admin com outro auth.uid() não administra a matriz', /somente administrador/.test(eEmailAdm || ''), eEmailAdm);
ok('8. ação inexistente → false', await pode(db, UID.admin, 'PROJ_NAO_EXISTE') === false);
ok('8. ação nula → false', await pode(db, UID.admin, null) === false);
ok('8. código com caixa diferente não casa (proj_programar) → false', await pode(db, UID.admin, 'proj_programar') === false);
await db.exec(`insert into public.cena_acoes (codigo, modulo, descricao, ativo) values ('PROJ_TESTE_INATIVA', 'PROJETOS', 'teste', false), ('PROJ_TESTE_SEM_REGRA', 'PROJETOS', 'teste', true)`);
await db.exec(`insert into public.cena_permissoes_acao (perfil, acao, permitido, motivo) values ('admin', 'PROJ_TESTE_INATIVA', true, 'teste')`);
ok('9. ação inativa → false (mesmo com regra viva)', await pode(db, UID.admin, 'PROJ_TESTE_INATIVA') === false);
ok('10. ação sem concessão → false', await pode(db, UID.admin, 'PROJ_TESTE_SEM_REGRA') === false);
ok('12. concessão global → true', await pode(db, UID.escritorio, 'PROJ_IMPORTAR_LMS') === true);

// ── 22–25. Administração da matriz ──────────────────────────────
const rpc = (uid, sql, params) => como(db, 'authenticated', uid, () => tenta(db, sql, params));
let e = await rpc(UID.escritorio, `select public.cena_permissao_acao_conceder('equipe', 'PROJ_PROGRAMAR', 'tentativa')`);
ok('22. escritorio não altera a matriz', /somente administrador/.test(e || ''), e);
e = await rpc(UID.coordenador, `select public.cena_permissao_acao_negar('gestor', 'PROJ_PROGRAMAR', 'tentativa')`);
ok('22. coordenador não altera a matriz', /somente administrador/.test(e || ''), e);
e = await rpc(UID.supervisor_tma, `select public.cena_permissao_acao_revogar('gestor', 'PROJ_PROGRAMAR', 'tentativa')`);
ok('22. supervisor_tma não revoga', /somente administrador/.test(e || ''), e);
e = await rpc(U_ADMIN_INATIVO, `select public.cena_permissao_acao_conceder('equipe', 'PROJ_PROGRAMAR', 'tentativa')`);
ok('22. admin inativo não altera a matriz', /somente administrador/.test(e || ''), e);
e = await rpc('', `select public.cena_permissao_acao_conceder('equipe', 'PROJ_PROGRAMAR', 'tentativa')`);
ok('22. sem sessão não altera a matriz', /somente administrador/.test(e || ''), e);
for (const [n, sql] of [
  ['insere', `insert into public.cena_permissoes_acao (perfil, acao, permitido) values ('equipe', 'PROJ_PROGRAMAR', true)`],
  ['altera', `update public.cena_permissoes_acao set permitido = false`],
  ['apaga', `delete from public.cena_permissoes_acao`],
  ['grava evento', `insert into public.cena_permissoes_acao_eventos (permissao_id, operacao, perfil, acao) select id, 'CONCEDER', perfil, acao from public.cena_permissoes_acao limit 1`],
  ['altera ação', `update public.cena_acoes set ativo = false`]]) {
  e = await rpc(UID.admin, sql);
  ok(`admin logado não ${n} direto pela REST (só via RPC)`, /permission denied/.test(e || ''), e);
}

const eventosAntes = (await db.query('select count(*)::int n from public.cena_permissoes_acao_eventos')).rows[0].n;
e = await rpc(UID.admin, `select public.cena_permissao_acao_conceder('almoxarife', 'PROJ_IMPORTAR_LMS', 'Teste admin')`);
ok('23. admin concede', e === null, e);
ok('23. concessão do admin vale', await pode(db, UID.almoxarife, 'PROJ_IMPORTAR_LMS') === true);
e = await rpc(UID.gestor, `select public.cena_permissao_acao_negar('almoxarife', 'PROJ_IMPORTAR_LMS', 'Teste gestor nega')`);
ok('24. gestor nega', e === null, e);
ok('24. negação do gestor vale', await pode(db, UID.almoxarife, 'PROJ_IMPORTAR_LMS') === false);
e = await rpc(UID.gestor, `select public.cena_permissao_acao_revogar('almoxarife', 'PROJ_IMPORTAR_LMS', 'Teste gestor revoga')`);
ok('24. gestor revoga', e === null, e);
ok('revogada: volta à ausência de regra → false', await pode(db, UID.almoxarife, 'PROJ_IMPORTAR_LMS') === false);
const revSemRegra = await como(db, 'authenticated', UID.gestor, async () =>
  (await db.query(`select public.cena_permissao_acao_revogar('almoxarife', 'PROJ_IMPORTAR_LMS', 'de novo') v`)).rows[0].v);
ok('revogar sem regra viva → false, sem efeito', revSemRegra === false);
const idRepetido = await como(db, 'authenticated', UID.admin, async () => {
  const a = (await db.query(`select public.cena_permissao_acao_conceder('dp', 'PROJ_IMPORTAR_LMS', 'Primeira') v`)).rows[0].v;
  const b = (await db.query(`select public.cena_permissao_acao_conceder('dp', 'PROJ_IMPORTAR_LMS', 'Repetida') v`)).rows[0].v;
  return [a, b];
});
ok('conceder o que já está concedido não cria regra nova', idRepetido[0] === idRepetido[1], idRepetido);

const ev = (await db.query(`select operacao, perfil, acao, contrato_id, permitido_anterior, permitido_novo, motivo, por_auth, por_usuario_id
  from public.cena_permissoes_acao_eventos where id > (select max(id) - 4 from public.cena_permissoes_acao_eventos) order by id`)).rows;
const nEv = (await db.query('select count(*)::int n from public.cena_permissoes_acao_eventos')).rows[0].n;
ok('25. cada alteração gera evento (conceder, negar, revogar, conceder dp; repetição e revogação vazia não)', nEv - eventosAntes === 4, nEv - eventosAntes);
ok('25. evento CONCEDER: anterior nulo, novo true, autor admin, motivo',
  ev[0].operacao === 'CONCEDER' && ev[0].permitido_anterior === null && ev[0].permitido_novo === true
  && ev[0].por_auth === UID.admin && ev[0].motivo === 'Teste admin' && ev[0].por_usuario_id, ev[0]);
ok('25. evento NEGAR: true → false, autor gestor', ev[1].operacao === 'NEGAR' && ev[1].permitido_anterior === true
  && ev[1].permitido_novo === false && ev[1].por_auth === UID.gestor && ev[1].motivo === 'Teste gestor nega', ev[1]);
ok('25. evento REVOGAR: false → nulo, motivo', ev[2].operacao === 'REVOGAR' && ev[2].permitido_anterior === false
  && ev[2].permitido_novo === null && ev[2].motivo === 'Teste gestor revoga', ev[2]);
ok('25. eventos guardam perfil/ação/contrato', ev.slice(0, 3).every(x => x.perfil === 'almoxarife' && x.acao === 'PROJ_IMPORTAR_LMS' && x.contrato_id === null));
ok('25. eventos do seed sem autor (migration, sem sessão)',
  (await db.query(`select count(*)::int n from public.cena_permissoes_acao_eventos where por_auth is null and motivo like 'Matriz inicial%'`)).rows[0].n === totalSeed);
ok('25. eventos visíveis para admin', (await como(db, 'authenticated', UID.admin, async () =>
  (await db.query('select count(*)::int n from public.cena_permissoes_acao_eventos')).rows[0].n)) === nEv);
ok('eventos invisíveis para escritorio', (await como(db, 'authenticated', UID.escritorio, async () =>
  (await db.query('select count(*)::int n from public.cena_permissoes_acao_eventos')).rows[0].n)) === 0);
ok('matriz invisível para escritorio', (await como(db, 'authenticated', UID.escritorio, async () =>
  (await db.query('select count(*)::int n from public.cena_permissoes_acao')).rows[0].n)) === 0);
ok('matriz visível para gestor', (await como(db, 'authenticated', UID.gestor, async () =>
  (await db.query('select count(*)::int n from public.cena_permissoes_acao')).rows[0].n)) > 0);
ok('catálogo de ações visível para usuário ERP ativo', (await como(db, 'authenticated', UID.equipe, async () =>
  (await db.query('select count(*)::int n from public.cena_acoes')).rows[0].n)) >= 9);
ok('catálogo de ações invisível sem cadastro ERP', (await como(db, 'authenticated', U_SEM_CADASTRO, async () =>
  (await db.query('select count(*)::int n from public.cena_acoes')).rows[0].n)) === 0);

e = await tentaExec(db, `update public.cena_permissoes_acao_eventos set motivo = 'x'`);
ok('histórico imutável: UPDATE recusado até para o dono', /histórico não é alterado/.test(e || ''), e);
e = await tentaExec(db, `delete from public.cena_permissoes_acao_eventos`);
ok('histórico imutável: DELETE recusado até para o dono', /histórico não é alterado/.test(e || ''), e);
e = await tentaExec(db, `truncate public.cena_permissoes_acao_eventos`);
ok('histórico imutável: TRUNCATE recusado', e !== null, e);
e = await tentaExec(db, `delete from public.cena_permissoes_acao where perfil = 'dp'`);
ok('matriz: DELETE físico recusado até para o dono', /exclusão física não permitida/.test(e || ''), e);
e = await tentaExec(db, `update public.cena_permissoes_acao set perfil = 'equipe' where perfil = 'dp'`);
ok('matriz: chave da regra não muda', /não mudam/.test(e || ''), e);
e = await tentaExec(db, `update public.cena_permissoes_acao set deleted_at = null where perfil = 'almoxarife' and deleted_at is not null`);
ok('matriz: regra revogada não volta', /revogada não volta/.test(e || ''), e);

// gestor × perfis reservados (mesmo critério de usuarios_sistema)
e = await rpc(UID.gestor, `select public.cena_permissao_acao_negar('admin', 'PROJ_IMPORTAR_LMS', 'tentativa')`);
ok('gestor não altera regra do perfil admin', /somente admin altera regras do perfil admin/.test(e || ''), e);
e = await rpc(UID.gestor, `select public.cena_permissao_acao_revogar('diretoria', 'PROJ_PROGRAMAR', 'tentativa')`);
ok('gestor não altera regra do perfil diretoria', /somente admin/.test(e || ''), e);
ok('regra do admin intacta após tentativa do gestor', await pode(db, UID.admin, 'PROJ_IMPORTAR_LMS') === true);

// validações das RPCs
e = await rpc(UID.admin, `select public.cena_permissao_acao_conceder('equipe', 'PROJ_PROGRAMAR', '   ')`);
ok('motivo obrigatório', /motivo obrigatório/.test(e || ''), e);
e = await rpc(UID.admin, `select public.cena_permissao_acao_conceder('equipe; drop', 'PROJ_PROGRAMAR', 'x')`);
ok('perfil inválido recusado', /perfil inválido/.test(e || ''), e);
e = await rpc(UID.admin, `select public.cena_permissao_acao_conceder('equipe', 'PROJ_NAO_EXISTE', 'x')`);
ok('RPC: ação inexistente recusada', /ação inexistente/.test(e || ''), e);
e = await rpc(UID.admin, `select public.cena_permissao_acao_conceder('equipe', 'PROJ_TESTE_INATIVA', 'x')`);
ok('RPC: ação inativa recusada', /ação inexistente ou inativa/.test(e || ''), e);
e = await rpc(UID.admin, `select public.cena_permissao_acao_conceder('equipe', 'PROJ_PROGRAMAR', 'x', $1::uuid)`, [C_CANCELADO]);
ok('RPC: contrato cancelado recusado', /contrato inexistente ou não ativo/.test(e || ''), e);
e = await rpc(UID.admin, `select public.cena_permissao_acao_conceder('equipe', 'PROJ_PROGRAMAR', 'x', $1::uuid)`, [C_INEXISTENTE]);
ok('RPC: contrato inexistente recusado', /contrato inexistente/.test(e || ''), e);

// ── 13–16. Contrato ─────────────────────────────────────────────
ok('global vale em contrato ativo sem regra própria', await pode(db, UID.gestor, 'PROJ_IMPORTAR_LMS', C_ATIVO) === true);
e = await rpc(UID.admin, `select public.cena_permissao_acao_negar('gestor', 'PROJ_IMPORTAR_LMS', 'Contrato X sem importação', $1::uuid)`, [C_ATIVO]);
ok('13. regra de contrato (negar) criada', e === null, e);
ok('14. regra do contrato (false) vence a global (true)', await pode(db, UID.gestor, 'PROJ_IMPORTAR_LMS', C_ATIVO) === false);
ok('14. global continua valendo sem contrato', await pode(db, UID.gestor, 'PROJ_IMPORTAR_LMS') === true);
ok('14. global continua valendo em outro contrato', await pode(db, UID.gestor, 'PROJ_IMPORTAR_LMS', C_ATIVO2) === true);
e = await rpc(UID.gestor, `select public.cena_permissao_acao_conceder('supervisor', 'PROJ_IMPORTAR_LMS', 'Supervisor importa no contrato X', $1::uuid)`, [C_ATIVO]);
ok('13. regra de contrato (conceder) criada pelo gestor', e === null, e);
ok('13/14. regra do contrato (true) vence a ausência global', await pode(db, UID.supervisor, 'PROJ_IMPORTAR_LMS', C_ATIVO) === true);
ok('13. sem contrato, supervisor continua sem a ação', await pode(db, UID.supervisor, 'PROJ_IMPORTAR_LMS') === false);
ok('13. em outro contrato, supervisor continua sem a ação', await pode(db, UID.supervisor, 'PROJ_IMPORTAR_LMS', C_ATIVO2) === false);
ok('15. contrato inexistente → false (mesmo com global)', await pode(db, UID.admin, 'PROJ_IMPORTAR_LMS', C_INEXISTENTE) === false);
ok('15. contrato cancelado → false (mesmo com global)', await pode(db, UID.admin, 'PROJ_IMPORTAR_LMS', C_CANCELADO) === false);
ok('15. contrato encerrado → false (mesmo com global)', await pode(db, UID.admin, 'PROJ_IMPORTAR_LMS', C_ENCERRADO) === false);
e = await rpc(UID.gestor, `select public.cena_permissao_acao_revogar('supervisor', 'PROJ_IMPORTAR_LMS', 'Fim do teste', $1::uuid)`, [C_ATIVO]);
ok('16. revogar regra do contrato', e === null, e);
ok('16. regra revogada não concede', await pode(db, UID.supervisor, 'PROJ_IMPORTAR_LMS', C_ATIVO) === false);
await db.exec(`insert into public.cena_permissoes_acao (perfil, acao, permitido, motivo, deleted_at) values ('equipe', 'PROJ_EDITAR_WL', true, 'excluída', now())`);
ok('16. regra excluída (deleted_at) não concede', await pode(db, UID.equipe, 'PROJ_EDITAR_WL') === false);
await db.exec(`insert into public.cena_permissoes_acao (perfil, acao, permitido, motivo) values ('encarregado', 'PROJ_EDITAR_WL', false, 'negada')`);
ok('16. regra viva com permitido = false não concede', await pode(db, UID.encarregado, 'PROJ_EDITAR_WL') === false);
const dupGlobal = await tentaExec(db, `insert into public.cena_permissoes_acao (perfil, acao, permitido) values ('gestor', 'PROJ_PROGRAMAR', true)`);
ok('uma única regra global viva por perfil + ação', /duplicate key|unique/i.test(dupGlobal || ''), dupGlobal);
const dupCtr = await tentaExec(db, `insert into public.cena_permissoes_acao (perfil, acao, contrato_id, permitido) values ('gestor', 'PROJ_IMPORTAR_LMS', '${C_ATIVO}', true)`);
ok('uma única regra viva por perfil + ação + contrato', /duplicate key|unique/i.test(dupCtr || ''), dupCtr);

// reaplicar não ressuscita regra revogada
await como(db, 'authenticated', UID.admin, () => db.query(`select public.cena_permissao_acao_revogar('administrativo', 'PROJ_EDITAR_WL', 'Teste reaplicação')`));
erro = await tentaExec(db, mig);
ok('reaplicar depois de uso real: sem erro', erro === null, erro);
ok('reaplicar não recria regra revogada pelo administrador', await pode(db, UID.administrativo, 'PROJ_EDITAR_WL') === false);

// ── 28. search_path fixo em toda função SECURITY DEFINER nova ───
const defs = (await db.query(`
  select p.proname, p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '') cfg
  from pg_proc p where p.pronamespace = 'public'::regnamespace
    and (p.proname like 'cena_permiss%' or p.proname in ('cena_pode', 'cena_contrato_ativo'))`)).rows;
ok('28. 10 funções novas criadas', defs.length === 10, defs.map(d => d.proname));
ok('28. todas com search_path = public, pg_temp', defs.every(d => /search_path=public, pg_temp/.test(d.cfg)), defs);
const fPode = (await db.query(`select prosecdef, provolatile from pg_proc where proname = 'cena_pode'`)).rows[0];
ok('28. cena_pode é SECURITY DEFINER e STABLE', fPode.prosecdef === true && fPode.provolatile === 's', fPode);

// ── 11. RLS FORCE e policies ────────────────────────────────────
const rls = (await db.query(`select relname, relrowsecurity r, relforcerowsecurity f from pg_class
  where oid in ('public.cena_acoes'::regclass, 'public.cena_permissoes_acao'::regclass, 'public.cena_permissoes_acao_eventos'::regclass)`)).rows;
ok('RLS ENABLE + FORCE nas 3 tabelas', rls.length === 3 && rls.every(r => r.r && r.f), rls);
const pols = (await db.query(`select tablename, policyname, cmd, roles::text roles, qual from pg_policies
  where tablename in ('cena_acoes', 'cena_permissoes_acao', 'cena_permissoes_acao_eventos') order by 1`)).rows;
ok('só policies de SELECT para authenticated', pols.length === 3 && pols.every(p => p.cmd === 'SELECT' && p.roles === '{authenticated}'), pols);
const grants = (await db.query(`
  select c.relname, r.rolname, string_agg(x.p, ',' order by x.p) privs
  from pg_class c cross join (values ('anon'), ('authenticated'), ('service_role')) r(rolname)
  cross join lateral (select unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p) x
  where c.oid in ('public.cena_acoes'::regclass, 'public.cena_permissoes_acao'::regclass, 'public.cena_permissoes_acao_eventos'::regclass)
    and has_table_privilege(r.rolname, c.oid, x.p)
  group by 1, 2 order by 1, 2`)).rows;
ok('anon sem privilégio nas 3 tabelas', grants.every(g => g.rolname !== 'anon'), grants);
ok('authenticated e service_role só com SELECT', grants.every(g => g.privs === 'SELECT'), grants);
const seqAnon = (await db.query(`select has_sequence_privilege('anon', pg_get_serial_sequence('public.cena_permissoes_acao_eventos', 'id'), 'USAGE') v`)).rows[0].v;
ok('sequência do histórico sem acesso anon', seqAnon === false);

// ── 30. Não impacto na TMA nem nos helpers existentes ───────────
const tmaDepois = (await db.query(`
  select (select count(*) from public.composicao_dia)::int cd, (select count(*) from public.equipes_disp)::int ed,
         (select count(*) from pg_trigger where tgrelid in ('public.composicao_dia'::regclass, 'public.equipes_disp'::regclass))::int trg,
         (select count(*) from pg_policies where tablename in ('composicao_dia', 'equipes_disp'))::int pol,
         (select md5(string_agg(pg_get_functiondef(p.oid), '' order by p.oid)) from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname in
           ('cena_prog_pode_programar_projetos','cena_usuario_perfil_sessao','cena_usuarios_pode_administrar')) fns`)).rows[0];
ok('30. composicao_dia / equipes_disp: linhas, gatilhos e policies iguais', JSON.stringify(tmaAntes) === JSON.stringify(tmaDepois), [tmaAntes, tmaDepois]);
ok('cena_prog_pode_programar_projetos / helpers de sessão inalterados', tmaAntes.fns === tmaDepois.fns);
ok('usuarios_sistema inalterada', (await db.query(`select md5(string_agg(t::text, '' order by id)) h from public.usuarios_sistema t`)).rows[0].h === usuariosAntes);
ok('contratos sem gatilho novo', (await db.query(`select count(*)::int n from pg_trigger where tgrelid = 'public.contratos'::regclass and not tgisinternal`)).rows[0].n === 0);

// ── Desfazer ────────────────────────────────────────────────────
erro = await tentaExec(db, semNotify(desfazer));
ok('bloco de desfazer roda', erro === null, erro);
const sobra = (await db.query(`select count(*)::int n from pg_proc where pronamespace = 'public'::regnamespace
  and (proname like 'cena_permiss%' or proname in ('cena_pode', 'cena_contrato_ativo'))`)).rows[0].n
  + (await db.query(`select count(*)::int n from pg_class where relname in ('cena_acoes','cena_permissoes_acao','cena_permissoes_acao_eventos')`)).rows[0].n;
ok('desfazer remove tudo da etapa', sobra === 0, sobra);
ok('desfazer mantém a programação atual', (await como(db, 'authenticated', UID.escritorio, async () =>
  (await db.query('select public.cena_prog_pode_programar_projetos() v')).rows[0].v)) === true);
erro = await tentaExec(db, mig);
ok('reaplica depois de desfazer', erro === null, erro);
await db.close();

// ── contratos com deleted_at: excluído logicamente não autoriza ──
db = await novoBanco({ contratoDeleted: true });
erro = await tentaExec(db, mig);
ok('contratos com deleted_at: aplica', erro === null, erro);
await db.exec(`update public.contratos set deleted_at = now() where id = '${C_ATIVO2}'`);
ok('contratos com deleted_at: ativo sem exclusão autoriza', await pode(db, UID.gestor, 'PROJ_IMPORTAR_LMS', C_ATIVO) === true);
ok('contratos com deleted_at: status Ativo mas excluído → false', await pode(db, UID.gestor, 'PROJ_IMPORTAR_LMS', C_ATIVO2) === false);
await db.close();

// ── Fail-closed na aplicação ────────────────────────────────────
db = await novoBanco({ semProg: true });
erro = await tentaExec(db, mig);
ok('sem cena_prog_pode_programar_projetos: recusa', /20261004200000_prog_projetos_agenda/.test(erro || ''), erro);
ok('sem cena_prog_pode_programar_projetos: nada criado', (await db.query(`select to_regclass('public.cena_acoes') t`)).rows[0].t === null);
await db.close();

db = await novoBanco({ progAlterado: true });
erro = await tentaExec(db, mig);
ok('função de programação com outra lista: recusa', /não aceita exatamente/.test(erro || ''), erro);
ok('função de programação com outra lista: nada criado (transação única)', (await db.query(`select to_regclass('public.cena_acoes') t`)).rows[0].t === null);
await db.close();

db = new PGlite();
await db.exec(BASE().replace(/create table public\.contratos \(id uuid primary key/, 'create table public.contratos (id text primary key').replace(/'c0000000-[^']+'/g, m => m));
await db.exec(migSeg);
await db.exec(fnProg);
erro = await tentaExec(db, mig);
ok('contratos.id não uuid: recusa', /contratos\.id não é uuid/.test(erro || ''), erro);
await db.close();

// ── Transação explícita: falha intencional no meio não deixa nada da Etapa 1.1 ──
const FALHA = `\nDO $$ BEGIN RAISE EXCEPTION 'falha intencional de teste'; END $$;\n`;
const comFalhaAntes = marca => {
  const i = mig.indexOf(marca);
  if (i < 0) throw new Error('marca não encontrada na migration: ' + marca);
  return mig.slice(0, i) + FALHA + mig.slice(i);
};
const PONTOS_FALHA = [
  ['depois das tabelas', '-- ── 4. Contrato válido'],
  ['depois das funções e gatilhos', '-- ── 8. RLS e grants'],
  ['depois de RLS, policies e grants', '-- ── 9. Ações e matriz inicial'],
  ['depois do seed (antes do COMMIT)', '\nCOMMIT;'],
];
const objetosEtapa = async (db) => (await db.query(`
  select (select count(*) from pg_class where relnamespace = 'public'::regnamespace
            and relname in ('cena_acoes','cena_permissoes_acao','cena_permissoes_acao_eventos'))::int tabelas,
         (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
            and (proname like 'cena_permiss%' or proname in ('cena_pode', 'cena_contrato_ativo')))::int funcoes,
         (select count(*) from pg_trigger where tgname like 'trg_cena_permissoes%')::int gatilhos,
         (select count(*) from pg_policies where tablename in ('cena_acoes','cena_permissoes_acao','cena_permissoes_acao_eventos'))::int policies,
         (select count(*) from pg_class where relkind = 'i' and relname like 'cena_permissoes_acao%')::int indices`)).rows[0];
for (const [nome, marca] of PONTOS_FALHA) {
  db = await novoBanco();
  erro = await tentaExec(db, comFalhaAntes(marca));
  ok(`falha intencional ${nome}: migration aborta`, /falha intencional de teste/.test(erro || ''), erro);
  const o = await objetosEtapa(db);
  ok(`falha intencional ${nome}: nenhum objeto da Etapa 1.1 permanece`, Object.values(o).every(n => n === 0), o);
  erro = await tentaExec(db, mig);
  ok(`falha intencional ${nome}: depois aplica normalmente`, erro === null, erro);
  await db.close();
}

// Falha ao reaplicar sobre uma instalação existente: estado anterior intacto (policies inclusive)
db = await novoBanco();
erro = await tentaExec(db, mig);
ok('reaplicação com falha: instalação inicial ok', erro === null, erro);
const objInst = await objetosEtapa(db);
ok('controle: a contagem de objetos enxerga tabelas, funções, gatilhos, policies e índices instalados',
  objInst.tabelas === 3 && objInst.funcoes === 10 && objInst.gatilhos === 4 && objInst.policies === 3 && objInst.indices > 0, objInst);
await como(db, 'authenticated', UID.admin, () => db.query(`select public.cena_permissao_acao_conceder('rh', 'PROJ_EDITAR_WL', 'Antes da reaplicação')`));
const retrato = async () => JSON.stringify({
  objetos: await objetosEtapa(db),
  regras: (await db.query(`select perfil, acao, permitido, deleted_at is null viva from public.cena_permissoes_acao order by perfil, acao`)).rows,
  eventos: (await db.query(`select count(*)::int n from public.cena_permissoes_acao_eventos`)).rows[0].n,
  policies: (await db.query(`select tablename, policyname, cmd, roles::text, qual from pg_policies
    where tablename in ('cena_acoes','cena_permissoes_acao','cena_permissoes_acao_eventos') order by 1, 2`)).rows,
});
const antesReap = await retrato();
erro = await tentaExec(db, comFalhaAntes('\nCOMMIT;'));
ok('reaplicação com falha: aborta', /falha intencional de teste/.test(erro || ''), erro);
ok('reaplicação com falha: matriz, eventos, objetos e policies iguais aos de antes', await retrato() === antesReap);
ok('reaplicação com falha: cena_pode continua respondendo', await pode(db, UID.rh, 'PROJ_EDITAR_WL') === true
  && await pode(db, UID.equipe, 'PROJ_EDITAR_WL') === false);
await db.close();

// ── Policy fictícia de migration futura sobrevive à reaplicação ──
db = await novoBanco();
erro = await tentaExec(db, mig);
ok('policy futura: instalação inicial ok', erro === null, erro);
await db.exec(`
  create policy cena_acoes_futura_teste on public.cena_acoes for select to authenticated using (false);
  create policy cena_permissoes_acao_futura_teste on public.cena_permissoes_acao for select to authenticated using (false);
  create policy cena_permissoes_acao_eventos_futura_teste on public.cena_permissoes_acao_eventos for select to authenticated using (false);`);
const polsFuturas = async () => (await db.query(`select tablename, policyname, cmd, roles::text roles, qual from pg_policies
  where tablename in ('cena_acoes','cena_permissoes_acao','cena_permissoes_acao_eventos') order by 1, 2`)).rows;
const antesFut = await polsFuturas();
erro = await tentaExec(db, mig);
ok('policy futura: reaplicação sem erro', erro === null, erro);
const depoisFut = await polsFuturas();
ok('policy futura: as 3 policies fictícias continuam existindo após reaplicar',
  ['cena_acoes_futura_teste', 'cena_permissoes_acao_futura_teste', 'cena_permissoes_acao_eventos_futura_teste']
    .every(n => depoisFut.some(p => p.policyname === n && p.qual === 'false')), depoisFut);
ok('policy futura: policies próprias recriadas e nada mais mudou', JSON.stringify(antesFut) === JSON.stringify(depoisFut), [antesFut, depoisFut]);
ok('policy futura: total de 6 policies (3 próprias + 3 fictícias)', depoisFut.length === 6, depoisFut.length);
ok('policy futura: cena_pode inalterado', await pode(db, UID.gestor, 'PROJ_ALTERAR_PERFIL_PROCESSO') === true
  && await pode(db, UID.escritorio, 'PROJ_ALTERAR_PERFIL_PROCESSO') === false);
await db.close();

if (failed.length) {
  console.log(`cena-permissoes-acao-sql: FALHOU ${failed.length}/${total}`);
  failed.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log(`cena-permissoes-acao-sql: OK (${total} verificações)`);
