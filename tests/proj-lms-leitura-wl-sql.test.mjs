// ETAPA 1.5b-1 — testes SQL da migration 20261012100000_proj_lms_leitura_wl.sql
// (sot_lms_original_do_projeto + sot_lms_estado_wl_lote, ambas somente leitura)
// PGlite com a cadeia real: sessão + fnProg + 1.1 + 1.2 + 1.3 (origem, confirmação, listagem) + bloqueio binário + 1.4 + esta.
// Uso: PGLITE_PATH=<pasta com @electric-sql/pglite> XLSX_PATH=<.../xlsx.mjs> node tests/proj-lms-leitura-wl-sql.test.mjs
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
  console.log('proj-lms-leitura-wl-sql: SKIP (defina PGLITE_PATH e XLSX_PATH)');
  process.exit(0);
}
const P = await import(pathToFileURL(process.env.LMS_PARSER_PATH || path.join(raiz, 'supabase', 'functions', '_shared', 'lms-parser.ts')).href);

const migDir = path.join(raiz, 'supabase', 'migrations');
const semNotify = s => s.replace(/NOTIFY pgrst[^;]*;/g, '');
const ler = f => fs.readFileSync(path.join(migDir, f), 'utf8');
const migProg = ler('20261004200000_prog_projetos_agenda.sql');
const iniProg = migProg.indexOf('CREATE OR REPLACE FUNCTION public.cena_prog_pode_programar_projetos()');
const fimMarca = 'GRANT EXECUTE ON FUNCTION public.cena_prog_pode_programar_projetos() TO authenticated;';
const fnProg = migProg.slice(iniProg, migProg.indexOf(fimMarca) + fimMarca.length);
const CADEIA = [semNotify(ler('20261004190000_seguranca_usuarios_sistema.sql')), fnProg,
  semNotify(ler('20261007190000_cena_permissoes_acao.sql')), semNotify(ler('20261009173000_proj_perfil_processo.sql')),
  semNotify(ler('20261009193000_proj_lms_origem.sql')), semNotify(ler('20261010120000_proj_lms_confirmacao.sql')),
  semNotify(ler('20261011120000_proj_lms_rascunhos_listar.sql')), semNotify(ler('20261001130000_sot_materiais_bloqueia_texto_binario.sql')),
  semNotify(ler('20261011200000_proj_wl_estrutura.sql'))];

const migRaw = ler('20261012100000_proj_lms_leitura_wl.sql');
const mig = semNotify(migRaw);
const codigo = migRaw.slice(0, migRaw.indexOf('-- Validação')).replace(/--[^\n]*/g, '');
const desfazer = migRaw.slice(migRaw.indexOf('-- Para desfazer')).split(/\r?\n/).slice(1)
  .map(l => l.replace(/^--\s?/, '')).join('\n').trim();

const failed = [];
let total = 0;
const ok = (n, c, d) => { total++; if (!c) failed.push(n + (d !== undefined ? ' — ' + JSON.stringify(d).slice(0, 400) : '')); };

// ── Estáticos ───────────────────────────────────────────────────
const cl = codigo.trim();
ok('transação explícita: BEGIN; primeiro, COMMIT; último', cl.startsWith('BEGIN;') && cl.endsWith('COMMIT;') && !/\bROLLBACK\b/i.test(codigo));
ok('desfazer transacional e só remove as duas funções', /^BEGIN;/.test(desfazer) && /COMMIT;$/.test(desfazer)
  && (desfazer.match(/DROP /g) || []).length === 2 && /DROP FUNCTION IF EXISTS public\.sot_lms_original_do_projeto\(uuid\)/.test(desfazer));
ok('somente leitura: sem INSERT/UPDATE/DELETE/ALTER/CREATE TABLE/INDEX/TRIGGER/set_config',
  !/\b(INSERT|UPDATE|DELETE|TRUNCATE)\b|ALTER TABLE|CREATE (UNIQUE )?INDEX|CREATE TABLE|CREATE TRIGGER|set_config/i.test(codigo));
ok('não toca lançamentos do campo, medição, materiais/atividades, programação, TMA',
  !/sot_lancamentos_campo|sot_med_itens|sot_medicoes|sot_atividades|sot_materiais|composicao_dia|\btma\b/i.test(codigo));
ok('não expõe storage/bucket/caminho/autoria/hash', !/storage_|bucket|\bpath\b|criado_por|confirmado_por|hash_sha256|por_auth/i.test(codigo));
ok('nenhuma autorização por e-mail', !/auth\.jwt\(\)|auth\.email\(\)|\bemail\b/i.test(codigo));
const nDef = (codigo.match(/^SECURITY DEFINER/gm) || []).length;
ok('2 funções SECURITY DEFINER + STABLE + search_path fixo',
  nDef === 2 && (codigo.match(/^STABLE\s+SECURITY DEFINER\s+SET search_path = public, pg_temp/gm) || []).length === 2);
ok('grants só para authenticated; revoke de PUBLIC, anon, service_role',
  (codigo.match(/REVOKE ALL ON FUNCTION[^;]*FROM PUBLIC, anon, service_role;/g) || []).length === 2
  && (codigo.match(/GRANT EXECUTE ON FUNCTION[^;]*TO authenticated;/g) || []).length === 2
  && !/^\s*GRANT\b[^;]*\bTO\b[^;]*\b(anon|PUBLIC|service_role)\b/im.test(codigo));
ok('reusa autorização e regra canônica (sem cena_pode direto nem regra duplicada)',
  /sot_lms_autorizar\(/.test(codigo) && /sot_lms_autorizar_confirmacao\(/.test(codigo) && /sot_lms_estado_wl_calc\(/.test(codigo)
  && !/cena_pode\(/.test(codigo) && !/'EM_CONCILIACAO'|'ESTRUTURADO'|'LEGADO_SEM_WL'/.test(codigo.replace("'estado', public.sot_lms_estado_wl_calc", '')));

// ── Banco ───────────────────────────────────────────────────────
const U = n => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PERFIS = ['admin', 'gestor', 'coordenador', 'supervisor', 'escritorio', 'administrativo', 'equipe', 'diretoria'];
const UID = Object.fromEntries(PERFIS.map((p, i) => [p, U(i + 1)]));
const U_INATIVO = U(901);
const C_ATIVO = 'c0000000-0000-4000-8000-000000000001';
const PJ = n => `b0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const P_PEND = PJ(1), P_APL = PJ(2), P_CONC = PJ(3), P_RASC = PJ(4), P_LEG = PJ(5), P_TEXTO = PJ(6), P_EXC = PJ(7), P_INEX = PJ(99);

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
create table public.sot_projetos (id uuid primary key default gen_random_uuid(), contrato_id text, nome text not null, codigo_cliente text,
  status text default 'Recebido', criado_em timestamptz default now(), deleted_at timestamptz);
insert into public.sot_projetos (id, contrato_id, nome, deleted_at) values
  ('${P_PEND}', '${C_ATIVO}', 'Pendente', null), ('${P_APL}', '${C_ATIVO}', 'Aplicado', null), ('${P_CONC}', '${C_ATIVO}', 'Conciliação', null),
  ('${P_RASC}', '${C_ATIVO}', 'Rascunho', null), ('${P_LEG}', '${C_ATIVO}', 'Legado', null), ('${P_TEXTO}', 'RDSE', 'Contrato texto', null),
  ('${P_EXC}', '${C_ATIVO}', 'Excluído', now());
create table public.sot_atividades (
  id uuid primary key default gen_random_uuid(), projeto_id uuid references public.sot_projetos(id) on delete cascade,
  codigo text, descricao text not null, unidade text, qtd_prevista numeric(14,3) default 0, valor_unitario numeric(14,4) default 0,
  valor_total numeric(14,2) generated always as (qtd_prevista * valor_unitario) stored,
  qtd_executada numeric(14,3) default 0, qtd_medida numeric(14,3) default 0, qtd_faturada numeric(14,3) default 0,
  ordem_exec integer default 0, etapa text, status text default 'pendente', observacoes text, servico_id text,
  criado_em timestamptz default now(), qtd_viabilizada numeric default 0, deleted_at timestamptz, obs_viabilidade text,
  obs_execucao text, somente_descritivo boolean not null default false,
  constraint sot_atividades_projeto_codigo_unique unique (projeto_id, codigo));
create table public.sot_materiais (
  id uuid primary key default gen_random_uuid(), projeto_id uuid references public.sot_projetos(id) on delete cascade,
  codigo_sap text, descricao text not null, unidade text, qtd_projetada numeric(14,3) default 0,
  qtd_viabilizada numeric(14,3) default 0, qtd_requisitada numeric(14,3) default 0, qtd_entregue numeric(14,3) default 0,
  qtd_aplicada numeric(14,3) default 0, qtd_devolvida numeric(14,3) default 0, qtd_processada_sap numeric(14,3) default 0,
  observacao text, criado_em timestamptz default now(), deleted_at timestamptz, somente_descritivo boolean not null default false,
  constraint sot_materiais_descritivo_sem_operacao check ((not somente_descritivo) or ((coalesce(qtd_viabilizada,0) = 0)
    and (coalesce(qtd_requisitada,0) = 0) and (coalesce(qtd_entregue,0) = 0) and (coalesce(qtd_aplicada,0) = 0)
    and (coalesce(qtd_devolvida,0) = 0) and (coalesce(qtd_processada_sap,0) = 0))));
create table public.servicos_contrato (id uuid primary key default gen_random_uuid(), contrato_id text, codigo text, descricao text, deleted_at timestamptz);
create table public.composicao_dia (id uuid primary key default gen_random_uuid(), equipe_id text, data date, projeto_ids text);
`;

async function novoBanco(migLeitura = mig) {
  const db = new PGlite();
  await db.exec(BASE);
  for (const m of CADEIA) await db.exec(m);
  if (migLeitura) await db.exec(migLeitura);
  return db;
}
async function como(db, role, uid, fn) {
  await db.exec(`set role ${role}`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid || '']);
  try { return await fn(); } finally {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  }
}
const tentaExec = async (db, sql) => { try { await db.exec(sql); return null; } catch (e) { try { await db.exec('ROLLBACK'); } catch (_) {} return e.message; } };

const fixture = new Uint8Array(fs.readFileSync(path.join(raiz, 'tests', 'fixtures', 'lms', 'modelo-lms-anonimizado.xlsx')));
const payloadFix = P.payloadRegistro(P.parseLms(fixture, XLSX), { hash_sha256: createHash('sha256').update(fixture).digest('hex'),
  nome: 'Modelo LMS.xlsx', tamanho: fixture.length, mime_informado: P.XLSX_MIME, mime_validado: P.XLSX_MIME });
const registrar = (db, proj) => como(db, 'service_role', null, async () =>
  (await db.query(`select public.sot_lms_importacao_registrar($1::uuid, $2::uuid, $3::jsonb, $4::jsonb) v`,
    [UID.gestor, proj, JSON.stringify(payloadFix.p_importacao), JSON.stringify(payloadFix.p_linhas)])).rows[0].v.importacao_id);
const confirmar = (db, imp, modo) => como(db, 'authenticated', UID.gestor, async () =>
  (await db.query(`select public.sot_lms_confirmar($1::uuid, $2, null) v`, [imp, modo])).rows[0].v);
const aplicar = (db, imp) => como(db, 'authenticated', UID.gestor, async () =>
  (await db.query(`select public.fn_proj_lms_aplicar_estrutura_nova($1::uuid) v`, [imp])).rows[0].v);
const orig = (db, uid, proj, role = 'authenticated') => como(db, role, uid, async () => {
  try { return { r: (await db.query(`select public.sot_lms_original_do_projeto($1::uuid) v`, [proj])).rows[0].v }; }
  catch (e) { return { e: e.message, code: e.code }; }
});
const lote = (db, uid, ids, role = 'authenticated') => como(db, role, uid, async () => {
  try { return { r: (await db.query(`select public.sot_lms_estado_wl_lote($1::uuid[]) v`, [ids])).rows[0].v }; }
  catch (e) { return { e: e.message, code: e.code }; }
});
const calc = async (db, proj) => (await db.query(`select public.sot_lms_estado_wl_calc($1::uuid) v`, [proj])).rows[0].v;

const db = await novoBanco(null);
const impPend = await registrar(db, P_PEND); await confirmar(db, impPend, 'ESTRUTURA_NOVA');
const impApl = await registrar(db, P_APL); await confirmar(db, impApl, 'ESTRUTURA_NOVA'); await aplicar(db, impApl);
const impConc = await registrar(db, P_CONC); await confirmar(db, impConc, 'CONCILIACAO');
await registrar(db, P_RASC);
let erro = await tentaExec(db, mig);
ok('aplica sobre a cadeia real com 1.4', erro === null, erro);
erro = await tentaExec(db, mig);
ok('reaplica sem erro (idempotente)', erro === null, erro);

const fpriv = async (role, fn) => (await db.query(`select has_function_privilege($1, $2, 'EXECUTE') v`, [role, fn])).rows[0].v;
for (const fn of ['public.sot_lms_original_do_projeto(uuid)', 'public.sot_lms_estado_wl_lote(uuid[])']) {
  ok(`${fn}: só authenticated executa`, await fpriv('authenticated', fn) && !(await fpriv('anon', fn)) && !(await fpriv('service_role', fn)));
}
const meta = (await db.query(`select bool_and(prosecdef) d, bool_and(provolatile = 's') s, bool_and(proconfig::text like '%search_path=public, pg_temp%') p
  from pg_proc where proname in ('sot_lms_original_do_projeto', 'sot_lms_estado_wl_lote')`)).rows[0];
ok('no banco: SECURITY DEFINER, STABLE, search_path fixo', meta.d && meta.s && meta.p, meta);

// ── sot_lms_original_do_projeto ─────────────────────────────────
let r = await orig(db, UID.gestor, P_PEND);
ok('pendente: existe, ESTRUTURA_NOVA, ESTRUTURA_PENDENTE, pode_aplicar (gestor)', r.r && r.r.existe === true && r.r.importacao_id === impPend
  && r.r.modo === 'ESTRUTURA_NOVA' && r.r.estado === 'ESTRUTURA_PENDENTE' && r.r.pode_aplicar === true && r.r.estrutura_aplicada_em === null
  && r.r.qtd_linhas === payloadFix.p_importacao.qtd_linhas && r.r.arquivo_nome_original === 'Modelo LMS.xlsx', r);
const chaves = Object.keys(r.r || {}).sort();
ok('não expõe storage/bucket/caminho/autoria/hash', JSON.stringify(chaves) === JSON.stringify(['arquivo_nome_original', 'confirmado_em', 'estado',
  'estrutura_aplicada_em', 'existe', 'importacao_id', 'modo', 'pode_aplicar', 'projeto_id', 'qtd_linhas', 'qtd_wls_distintas', 'status']), chaves);
r = await orig(db, UID.administrativo, P_PEND);
ok('pendente com só PROJ_IMPORTAR_LMS (administrativo): lê, mas pode_aplicar = false', r.r && r.r.existe && r.r.pode_aplicar === false, r);
r = await orig(db, UID.gestor, P_APL);
ok('aplicado: ESTRUTURADO, estrutura_aplicada_em preenchida, pode_aplicar = false', r.r && r.r.estado === 'ESTRUTURADO'
  && r.r.estrutura_aplicada_em !== null && r.r.pode_aplicar === false, r);
r = await orig(db, UID.gestor, P_CONC);
ok('CONCILIACAO: EM_CONCILIACAO e pode_aplicar = false', r.r && r.r.modo === 'CONCILIACAO' && r.r.estado === 'EM_CONCILIACAO' && r.r.pode_aplicar === false, r);
r = await orig(db, UID.gestor, P_RASC);
ok('só RASCUNHO: existe = false, LEGADO_SEM_WL', r.r && r.r.existe === false && r.r.estado === 'LEGADO_SEM_WL' && r.r.pode_aplicar === false && !r.r.importacao_id, r);
r = await orig(db, UID.gestor, P_LEG);
ok('legado sem importação: existe = false', r.r && r.r.existe === false && r.r.estado === 'LEGADO_SEM_WL', r);
r = await orig(db, UID.supervisor, P_PEND);
ok('supervisor (sem IMPORTAR nem CONFIRMAR): acesso negado 42501', r.code === '42501' && /acesso negado \(SEM_PERMISSAO\)/.test(r.e), r);
r = await orig(db, UID.gestor, P_TEXTO);
ok('contrato texto não identificado: negado', r.code === '42501' && /CONTRATO_NAO_IDENTIFICADO/.test(r.e), r);
r = await orig(db, UID.gestor, P_EXC);
ok('projeto excluído: negado', r.code === '42501' && /PROJETO_EXCLUIDO/.test(r.e), r);
r = await orig(db, UID.gestor, P_INEX);
ok('projeto inexistente: negado', r.code === '42501' && /PROJETO_INEXISTENTE/.test(r.e), r);
r = await orig(db, null, P_PEND);
ok('sem sessão: 42501', r.code === '42501' && /sem sessão/.test(r.e), r);
r = await orig(db, U_INATIVO, P_PEND);
ok('usuário ERP inativo: 42501', r.code === '42501' && /USUARIO_ERP_INATIVO/.test(r.e), r);
r = await orig(db, null, P_PEND, 'anon');
ok('anon não executa', r.e && /permission denied/.test(r.e), r);

// ── sot_lms_estado_wl_lote ──────────────────────────────────────
const TODOS = [P_PEND, P_APL, P_CONC, P_RASC, P_LEG, P_TEXTO, P_EXC, P_INEX];
r = await lote(db, UID.gestor, TODOS.concat([P_PEND, null]));
const esperado = {};
for (const p of [P_PEND, P_APL, P_CONC, P_RASC, P_LEG]) esperado[p] = await calc(db, p);
ok('lote (gestor): só legíveis, mesma regra canônica, sem duplicados', r.r && JSON.stringify(r.r) === JSON.stringify(
  Object.fromEntries(Object.keys(esperado).sort().map(k => [k, esperado[k]]))) || (r.r && Object.keys(r.r).length === 5
  && Object.keys(esperado).every(k => r.r[k] === esperado[k])), { r, esperado });
ok('lote: estados corretos', r.r && r.r[P_PEND] === 'ESTRUTURA_PENDENTE' && r.r[P_APL] === 'ESTRUTURADO' && r.r[P_CONC] === 'EM_CONCILIACAO'
  && r.r[P_RASC] === 'LEGADO_SEM_WL' && r.r[P_LEG] === 'LEGADO_SEM_WL', r);
ok('lote: excluído, contrato texto e inexistente ficam de fora (sem revelar)', r.r && !(P_TEXTO in r.r) && !(P_EXC in r.r) && !(P_INEX in r.r));
r = await lote(db, UID.administrativo, [P_PEND, P_APL]);
ok('lote (administrativo, só IMPORTAR): lê', r.r && Object.keys(r.r).length === 2);
r = await lote(db, UID.supervisor, TODOS);
ok('lote (supervisor sem permissão): objeto vazio', r.r && Object.keys(r.r).length === 0, r);
r = await lote(db, UID.gestor, []);
ok('lote vazio: objeto vazio', r.r && Object.keys(r.r).length === 0, r);
const muitos = Array.from({ length: 501 }, (_, i) => `d0000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
r = await lote(db, UID.gestor, muitos);
ok('lote: mais de 500 ids → 22023', r.code === '22023', r);
r = await lote(db, UID.gestor, muitos.slice(0, 500));
ok('lote: 500 ids aceito', r.r && typeof r.r === 'object', r);
r = await lote(db, null, [P_PEND]);
ok('lote sem sessão: 42501', r.code === '42501', r);
r = await lote(db, U_INATIVO, [P_PEND]);
ok('lote com usuário inativo: 42501', r.code === '42501', r);
r = await lote(db, null, [P_PEND], 'anon');
ok('lote: anon não executa', r.e && /permission denied/.test(r.e), r);

// Nada foi gravado pelas leituras
const snap = async () => (await db.query(`select
  (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.sot_lms_importacoes t) i,
  (select count(*) from public.sot_lms_importacao_eventos)::int e, (select count(*) from public.sot_wl)::int w,
  (select count(*) from public.sot_atividades)::int a, (select count(*) from public.sot_materiais)::int m`)).rows[0];
const antes = await snap();
await orig(db, UID.gestor, P_PEND); await lote(db, UID.gestor, TODOS); await orig(db, UID.administrativo, P_APL);
ok('as leituras não gravam nada', JSON.stringify(await snap()) === JSON.stringify(antes));

// Rollback
erro = await tentaExec(db, desfazer);
ok('rollback remove só as duas funções', erro === null
  && (await db.query(`select count(*)::int n from pg_proc where proname in ('sot_lms_original_do_projeto', 'sot_lms_estado_wl_lote')`)).rows[0].n === 0
  && (await calc(db, P_PEND)) === 'ESTRUTURA_PENDENTE', erro);

// ── Mutação ─────────────────────────────────────────────────────
const mut = async (nome, transform, prova) => {
  const s = transform(mig);
  if (s === mig) { ok(nome + ' (sabotagem não alterou o código)', false); return; }
  let det = false, err = null;
  try {
    const d = await novoBanco(null);
    const i = await registrar(d, P_PEND); await confirmar(d, i, 'ESTRUTURA_NOVA');
    await d.exec(s);
    det = await prova(d, i);
  } catch (e) { err = e.message; }
  ok(nome, det === true, err);
};
await mut('M1 sem autorização na função 1 → supervisor leria', s => s.replace(
  /IF v_ler <> 'OK' AND v_conf <> 'OK' THEN[\s\S]*?END IF;/, ''), async (d) => {
  const x = await orig(d, UID.supervisor, P_PEND); return !!(x.r && x.r.existe); });
await mut('M2 pode_aplicar sem PROJ_CONFIRMAR_LMS → administrativo veria o botão', s => s.replace(
  "'pode_aplicar', (v_conf = 'OK' AND", "'pode_aplicar', (true AND"), async (d) => {
  const x = await orig(d, UID.administrativo, P_PEND); return !!(x.r && x.r.pode_aplicar === true); });
await mut('M3 lote sem filtro de permissão → supervisor receberia estados', s => s.replace(
  "IF public.sot_lms_autorizar(v_id) = 'OK' OR public.sot_lms_autorizar_confirmacao(v_id) = 'OK' THEN", 'IF true THEN'), async (d) => {
  const x = await lote(d, UID.supervisor, [P_PEND]); return !!(x.r && Object.keys(x.r).length === 1); });
await mut('M4 sem teto → 501 ids aceitos', s => s.replace('> 500 THEN', '> 100000 THEN'), async (d) => {
  const x = await lote(d, UID.gestor, muitos); return !!x.r; });
await mut('M5 expor caminho do Storage → teste de chaves detecta', s => s.replace(
  "'arquivo_nome_original', v_imp.arquivo_nome_original,", "'arquivo_nome_original', v_imp.arquivo_nome_original, 'storage_path', 'x',"), async (d) => {
  const x = await orig(d, UID.gestor, P_PEND); return !!(x.r && 'storage_path' in x.r); });

if (failed.length) {
  console.log(`proj-lms-leitura-wl-sql: FALHOU ${failed.length}/${total}`);
  for (const f of failed) console.log('  - ' + f);
  process.exit(1);
}
console.log(`proj-lms-leitura-wl-sql: OK (${total} verificações)`);
