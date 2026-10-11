// ETAPA 1.3 — testes SQL da migration 20261011120000_proj_lms_rascunhos_listar.sql (listagem dos RASCUNHOS)
// PGlite com a cadeia real: sessão + fnProg + 1.1 + 1.2 + 1.3 recebimento + 1.3 confirmação + esta etapa.
// Uso: PGLITE_PATH=<pasta com @electric-sql/pglite> XLSX_PATH=<.../xlsx.mjs> node tests/proj-lms-rascunhos-listar-sql.test.mjs
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';

const here = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.join(here, '..');
let PGlite, XLSX;
try {
  const dir = process.env.PGLITE_PATH || path.join(process.env.TEMP || '/tmp', 'pglite-cena');
  const req = createRequire(path.join(dir, 'package.json'));
  ({ PGlite } = await import(pathToFileURL(req.resolve('@electric-sql/pglite')).href));
  XLSX = await import(pathToFileURL(process.env.XLSX_PATH || path.join(raiz, 'supabase', 'functions', '_shared', 'vendor', 'xlsx-0.20.3.mjs')).href);
} catch {
  console.log('proj-lms-rascunhos-listar-sql: SKIP (defina PGLITE_PATH e XLSX_PATH)');
  process.exit(0);
}
const P = await import(pathToFileURL(process.env.LMS_PARSER_PATH || path.join(raiz, 'supabase', 'functions', '_shared', 'lms-parser.ts')).href);

const migDir = path.join(raiz, 'supabase', 'migrations');
const semNotify = s => s.replace(/NOTIFY pgrst[^;]*;/g, '');
const ler = f => fs.readFileSync(path.join(migDir, f), 'utf8');
const migSeg = semNotify(ler('20261004190000_seguranca_usuarios_sistema.sql'));
const mig11 = semNotify(ler('20261007190000_cena_permissoes_acao.sql'));
const mig12 = semNotify(ler('20261009173000_proj_perfil_processo.sql'));
const mig13 = semNotify(ler('20261009193000_proj_lms_origem.sql'));
const migConf = semNotify(ler('20261010120000_proj_lms_confirmacao.sql'));

const migRaw = ler('20261011120000_proj_lms_rascunhos_listar.sql');
const mig = semNotify(migRaw);
const codigo = migRaw.slice(0, migRaw.indexOf('-- Validação')).replace(/--[^\n]*/g, '');
const desfazer = migRaw.slice(migRaw.indexOf('-- Para desfazer')).split(/\r?\n/).slice(1)
  .map(l => l.replace(/^--\s?/, '')).join('\n').trim();

const migProg = ler('20261004200000_prog_projetos_agenda.sql');
const iniProg = migProg.indexOf('CREATE OR REPLACE FUNCTION public.cena_prog_pode_programar_projetos()');
const fimMarca = 'GRANT EXECUTE ON FUNCTION public.cena_prog_pode_programar_projetos() TO authenticated;';
const fnProg = migProg.slice(iniProg, migProg.indexOf(fimMarca) + fimMarca.length);

const failed = [];
let total = 0;
const ok = (n, c, d) => { total++; if (!c) failed.push(n + (d !== undefined ? ' — ' + JSON.stringify(d).slice(0, 400) : '')); };

// ── Estáticos ───────────────────────────────────────────────────
const codigoLimpo = codigo.trim();
ok('transação explícita: BEGIN; primeiro, COMMIT; último',
  codigoLimpo.startsWith('BEGIN;') && codigoLimpo.endsWith('COMMIT;') && !/\bROLLBACK\b/i.test(codigo));
ok('desfazer é transacional e só remove a função', /^BEGIN;/.test(desfazer) && /COMMIT;$/.test(desfazer)
  && (desfazer.match(/DROP /g) || []).length === 1 && /DROP FUNCTION IF EXISTS public\.sot_lms_rascunhos_listar\(\)/.test(desfazer));
ok('somente leitura: sem INSERT/UPDATE/DELETE/ALTER/CREATE TABLE/INDEX/TRIGGER/set_config',
  !/\b(INSERT|UPDATE|DELETE|TRUNCATE)\b|ALTER TABLE|CREATE (UNIQUE )?INDEX|CREATE TABLE|CREATE TRIGGER|set_config/i.test(codigo));
ok('não cria WL / não toca materiais/atividades/estoque/TMA',
  !/sot_wl\b|sot_materiais|sot_atividades|\bestoque\b|composicao_dia|equipes_disp|\btma\b|croqui/i.test(codigo));
ok('nenhuma autorização por e-mail', !/auth\.jwt\(\)|auth\.email\(\)|\bemail\b/i.test(codigo));
ok('RPC sem parâmetros do cliente', /FUNCTION public\.sot_lms_rascunhos_listar\(\)/.test(codigo));
ok('SECURITY DEFINER com search_path fixo', /SECURITY DEFINER\s+SET search_path = public, pg_temp/.test(codigo));
ok('sem GRANT para anon/PUBLIC/service_role; sem GRANT de tabela',
  !/^\s*GRANT\b[^;]*\bTO\b[^;]*\b(anon|PUBLIC|service_role)\b/im.test(codigo) && !/^\s*GRANT\s+[^;]*\bON\s+TABLE\b/im.test(codigo));
ok('visibilidade reusa sot_lms_autorizar e sot_lms_autorizar_confirmacao (sem regra duplicada)',
  /sot_lms_autorizar\(i\.projeto_id\)/.test(codigo) && /sot_lms_autorizar_confirmacao\(i\.projeto_id\)/.test(codigo)
  && !/cena_pode\(/.test(codigo));
ok('só RASCUNHO', /WHERE i\.status = 'RASCUNHO'/.test(codigo));

// ── Banco ───────────────────────────────────────────────────────
const U = n => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PERFIS = ['admin', 'gestor', 'coordenador', 'supervisor', 'escritorio', 'administrativo', 'equipe', 'diretoria'];
const UID = Object.fromEntries(PERFIS.map((p, i) => [p, U(i + 1)]));
const U_INATIVO = U(901);
const C_ATIVO = 'c0000000-0000-4000-8000-000000000001';
const PJ = n => `b0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const P_RDSE = PJ(1), P_RDSE2 = PJ(2), P_SEM_CONTRATO = PJ(4), P_TEXTO = PJ(6);

const BASE = `
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
create schema storage;
create table storage.buckets (id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text);
grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.buckets, storage.objects to anon, authenticated, service_role;
create table public.usuarios_sistema (id uuid primary key default gen_random_uuid(), nome text, email text unique,
  perfil text, ativo boolean default true, auth_user_id uuid, deleted_at timestamptz);
insert into public.usuarios_sistema (nome, email, perfil, auth_user_id) values
  ${PERFIS.map(p => `('${p}', '${p}@cena', '${p}', '${UID[p]}')`).join(',\n  ')};
insert into public.usuarios_sistema (nome, email, perfil, auth_user_id, ativo) values ('ex-admin', 'ex@cena', 'admin', '${U_INATIVO}', false);
create table public.contratos (id uuid primary key default gen_random_uuid(), codigo text, nome text, cliente text, status text);
insert into public.contratos (id, codigo, nome, cliente, status) values ('${C_ATIVO}', '4600003971', 'RDSE', 'ENEL', 'Ativo');
create table public.sot_projetos (id uuid primary key, contrato_id text, nome text, codigo_cliente text, status text, deleted_at timestamptz);
insert into public.sot_projetos (id, contrato_id, nome, codigo_cliente, status, deleted_at) values
  ('${P_RDSE}', '${C_ATIVO}', 'Projeto RDSE 1', 'OBR-001', 'Em execução', null),
  ('${P_RDSE2}', '${C_ATIVO}', 'Projeto RDSE 2', null, 'Recebido', null),
  ('${P_SEM_CONTRATO}', null, 'Sem contrato', null, 'Recebido', null),
  ('${P_TEXTO}', 'RDSE', 'Contrato texto legado', null, 'Recebido', null);
create table public.sot_materiais (id uuid primary key default gen_random_uuid(), projeto_id uuid, codigo text, qtd_prevista numeric);
create table public.sot_atividades (id uuid primary key default gen_random_uuid(), projeto_id uuid, codigo text, qtd_prevista numeric);
`;

const db = new PGlite();
await db.exec(BASE); await db.exec(migSeg); await db.exec(fnProg); await db.exec(mig11); await db.exec(mig12);
await db.exec(mig13); await db.exec(migConf);

const tentaExec = async (sql) => { try { await db.exec(sql); return null; } catch (e) { try { await db.exec('ROLLBACK'); } catch (_) {} return e.message; } };
async function como(role, uid, fn) {
  await db.exec(`set role ${role}`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid || '']);
  try { return await fn(); } finally {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  }
}

let erro = await tentaExec(mig);
ok('aplica sem erro', erro === null, erro);
erro = await tentaExec(mig);
ok('reaplica sem erro (idempotente)', erro === null, erro);

const fpriv = async (role) => (await db.query(`select has_function_privilege($1, 'public.sot_lms_rascunhos_listar()', 'EXECUTE') v`, [role])).rows[0].v;
ok('authenticated executa; anon/service_role não', await fpriv('authenticated') && !(await fpriv('anon')) && !(await fpriv('service_role')));

// fixtures: RASCUNHOs em 4 projetos (um com contrato em texto → não autorizado para ninguém)
const fixture = new Uint8Array(fs.readFileSync(path.join(raiz, 'tests', 'fixtures', 'lms', 'modelo-lms-anonimizado.xlsx')));
const hashFix = createHash('sha256').update(fixture).digest('hex');
const payloadFix = P.payloadRegistro(P.parseLms(fixture, XLSX),
  { hash_sha256: hashFix, nome: 'Modelo LMS.xlsx', tamanho: fixture.length, mime_informado: P.XLSX_MIME, mime_validado: P.XLSX_MIME });
const registrar = (proj) => como('service_role', null, async () =>
  (await db.query(`select public.sot_lms_importacao_registrar($1::uuid, $2::uuid, $3::jsonb, $4::jsonb) v`,
    [UID.gestor, proj, JSON.stringify(payloadFix.p_importacao), JSON.stringify(payloadFix.p_linhas)])).rows[0].v.importacao_id);
const imp1 = await registrar(P_RDSE);
const imp2 = await registrar(P_RDSE2);
const impSem = await registrar(P_SEM_CONTRATO);
const impTexto = await registrar(P_TEXTO).catch(e => ({ e: e.message }));

const listar = (uid, role = 'authenticated') => como(role, uid, async () => {
  try { return { r: (await db.query(`select public.sot_lms_rascunhos_listar() v`)).rows[0].v }; }
  catch (e) { return { e: e.message, code: e.code }; }
});
const ids = r => (r.r || []).map(x => x.id).sort();

let r = await listar(UID.gestor);
ok('gestor vê os RASCUNHOS autorizados', JSON.stringify(ids(r)) === JSON.stringify([imp1, imp2, impSem].sort()), r);
const it1 = (r.r || []).find(x => x.id === imp1) || {};
ok('item traz dados mínimos (projeto nome/código, tipo, hash, qtd, criado_em, status)',
  it1.projeto_id === P_RDSE && it1.projeto_nome === 'Projeto RDSE 1' && it1.projeto_codigo === 'OBR-001'
  && it1.tipo_importacao === 'ORIGINAL' && it1.status === 'RASCUNHO' && it1.hash_sha256 === hashFix
  && it1.qtd_linhas === payloadFix.p_importacao.qtd_linhas && !!it1.criado_em, it1);
ok('gestor: pode_confirmar = true', (r.r || []).every(x => x.pode_confirmar === true), r.r);
ok('projeto com contrato texto não identificado não aparece', !(r.r || []).some(x => x.projeto_id === P_TEXTO), impTexto);

r = await listar(UID.administrativo);
ok('administrativo (só PROJ_IMPORTAR_LMS) vê, mas pode_confirmar = false',
  ids(r).length === 3 && (r.r || []).every(x => x.pode_confirmar === false), r);

r = await listar(UID.supervisor);
ok('supervisor (sem IMPORTAR nem CONFIRMAR) recebe lista vazia', Array.isArray(r.r) && r.r.length === 0, r);

r = await listar(null);
ok('sem sessão → erro 42501', r.code === '42501', r);
r = await listar(U_INATIVO);
ok('usuário ERP inativo → erro 42501', r.code === '42501', r);
r = await listar(null, 'anon');
ok('anon não executa', r.e && /permission denied/.test(r.e), r);

// após confirmar, o item sai da lista
const conf = await como('authenticated', UID.gestor, async () =>
  (await db.query(`select public.sot_lms_confirmar($1::uuid, 'CONCILIACAO', null) v`, [impSem])).rows[0].v);
r = await listar(UID.gestor);
ok('após confirmar, a importação CONFIRMADA sai da lista',
  conf.operacao === 'CONFIRMADA' && JSON.stringify(ids(r)) === JSON.stringify([imp1, imp2].sort()), { conf, r });

// listar não escreve nada
const snap = async () => (await db.query(`select
  (select md5(string_agg(t::text,'' order by t.id)) from public.sot_lms_importacoes t) imp,
  (select count(*) from public.sot_lms_importacao_eventos)::int ev,
  (select count(*) from public.sot_projeto_processo)::int proc`)).rows[0];
const antes = await snap();
await listar(UID.gestor); await listar(UID.administrativo);
ok('listar não altera importações/eventos/perfil', JSON.stringify(await snap()) === JSON.stringify(antes));

// mutação: remover o filtro de autorização → supervisor passaria a ver
{
  const d2 = new PGlite();
  await d2.exec(BASE); await d2.exec(migSeg); await d2.exec(fnProg); await d2.exec(mig11); await d2.exec(mig12);
  await d2.exec(mig13); await d2.exec(migConf);
  await d2.exec(mig.replace("AND (a.ler = 'OK' OR a.conf = 'OK')", ''));
  await d2.exec(`set role service_role`);
  await d2.query(`select public.sot_lms_importacao_registrar($1::uuid, $2::uuid, $3::jsonb, $4::jsonb)`,
    [UID.gestor, P_RDSE, JSON.stringify(payloadFix.p_importacao), JSON.stringify(payloadFix.p_linhas)]);
  await d2.exec('reset role');
  await d2.exec(`set role authenticated`);
  await d2.query(`select set_config('request.jwt.claim.sub', $1, false)`, [UID.supervisor]);
  const v = (await d2.query(`select public.sot_lms_rascunhos_listar() v`)).rows[0].v;
  await d2.exec('reset role');
  ok('M1 remover filtro de autorização → supervisor veria RASCUNHO (teste detecta)', Array.isArray(v) && v.length === 1, v);
}

if (failed.length) {
  console.log(`proj-lms-rascunhos-listar-sql: FALHOU ${failed.length}/${total}`);
  for (const f of failed) console.log('  - ' + f);
  process.exit(1);
}
console.log(`proj-lms-rascunhos-listar-sql: OK (${total} verificações)`);
