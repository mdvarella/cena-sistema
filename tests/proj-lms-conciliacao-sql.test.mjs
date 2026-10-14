// ETAPA 1.6a — testes SQL da migration 20261012200000_proj_lms_conciliacao.sql
// (prévia somente leitura + aplicar conciliação por substituição controlada + regra de criação compartilhada com a
// estrutura nova da 1.4). PGlite com a cadeia real: sessão + fnProg + 1.1 + 1.2 + 1.3 + bloqueio binário + 1.4 + 1.5b-1 + esta.
// Uso: PGLITE_PATH=<pasta com @electric-sql/pglite> XLSX_PATH=<.../xlsx.mjs> node tests/proj-lms-conciliacao-sql.test.mjs
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
  console.log('proj-lms-conciliacao-sql: SKIP (defina PGLITE_PATH e XLSX_PATH)');
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
const mig14Raw = ler('20261011200000_proj_wl_estrutura.sql');
const CADEIA = [semNotify(ler('20261004190000_seguranca_usuarios_sistema.sql')), fnProg,
  semNotify(ler('20261007190000_cena_permissoes_acao.sql')), semNotify(ler('20261009173000_proj_perfil_processo.sql')),
  semNotify(ler('20261009193000_proj_lms_origem.sql')), semNotify(ler('20261010120000_proj_lms_confirmacao.sql')),
  semNotify(ler('20261011120000_proj_lms_rascunhos_listar.sql')), semNotify(ler('20261001130000_sot_materiais_bloqueia_texto_binario.sql')),
  semNotify(mig14Raw), semNotify(ler('20261012100000_proj_lms_leitura_wl.sql'))];

const migRaw = ler('20261012200000_proj_lms_conciliacao.sql').replace(/\r\n/g, '\n');
const mig = semNotify(migRaw);
const codigo = migRaw.slice(0, migRaw.indexOf('-- Validação')).replace(/--[^\n]*/g, '');
const desfazer = migRaw.slice(migRaw.indexOf('-- Para desfazer')).split('\n').slice(2)
  .map(l => l.replace(/^--\s?/, '')).join('\n').trim();

const failed = [];
let total = 0;
const ok = (n, c, d) => { total++; if (!c) failed.push(n + (d !== undefined ? ' — ' + JSON.stringify(d).slice(0, 500) : '')); };
const corpo = nome => { const i = codigo.indexOf('FUNCTION public.' + nome + '('); return codigo.slice(i, codigo.indexOf('\n$$;', i)); };

// ── Estáticos ───────────────────────────────────────────────────
const cl = codigo.trim();
ok('transação explícita: BEGIN; primeiro, COMMIT; último', cl.startsWith('BEGIN;') && cl.endsWith('COMMIT;') && !/\bROLLBACK\b/i.test(codigo));
ok('nunca DELETE físico em atividades/materiais', !/DELETE\s+FROM\s+public\.sot_(atividades|materiais)/i.test(codigo) && !/TRUNCATE\s+(TABLE\s+)?public\.sot_/i.test(codigo));
ok('3 funções SECURITY DEFINER com search_path fixo (estrutura nova, prévia, aplicar)',
  (codigo.match(/^SECURITY DEFINER\s+SET search_path = public, pg_temp/gm) || []).length === 3
  && /FUNCTION public\.sot_lms_conciliacao_previa\(p_importacao_id uuid\)\s+RETURNS jsonb\s+LANGUAGE plpgsql\s+STABLE\s+SECURITY DEFINER/.test(codigo));
ok('internas sem SECURITY DEFINER', ['fn_proj_lms_linhas_problemas', 'fn_proj_lms_validar_linhas', 'fn_proj_lms_criar_estrutura',
  'fn_proj_lms_conciliacao_analise'].every(n => !/SECURITY DEFINER/.test(corpo(n))));
ok('grants: prévia/aplicar/estrutura nova só para authenticated; internas e tabela sem grant',
  (codigo.match(/REVOKE ALL ON FUNCTION[^;]*FROM PUBLIC, anon, service_role;/g) || []).length === 3
  && (codigo.match(/GRANT EXECUTE ON FUNCTION[^;]*TO authenticated;/g) || []).length === 3
  && (codigo.match(/REVOKE ALL ON FUNCTION[^;]*FROM PUBLIC, anon, authenticated, service_role;/g) || []).length === 5
  && /REVOKE ALL ON TABLE public\.sot_lms_conciliacao FROM PUBLIC, anon, authenticated, service_role;/.test(codigo)
  && !/^\s*GRANT\b[^;]*\bTO\b[^;]*\b(anon|PUBLIC|service_role)\b/im.test(codigo));
ok('aplicar exige PROJ_CONFIRMAR_LMS (autorização da confirmação); PROJ_CONCILIAR_LMS só em comentário',
  /sot_lms_autorizar_confirmacao\(v_imp\.projeto_id\)/.test(corpo('fn_proj_lms_aplicar_conciliacao'))
  && !/sot_lms_autorizar\(/.test(corpo('fn_proj_lms_aplicar_conciliacao')) && !/PROJ_CONCILIAR_LMS/.test(codigo) && /PROJ_CONCILIAR_LMS/.test(migRaw)
  && !/cena_pode\(/.test(codigo));
ok('regra de criação única: INSERT de WL/atividade/material só em fn_proj_lms_criar_estrutura',
  ['INSERT INTO public.sot_wl ', 'INSERT INTO public.sot_atividades ', 'INSERT INTO public.sot_materiais '].every(t =>
    (codigo.split(t).length - 1) === 1 && corpo('fn_proj_lms_criar_estrutura').includes(t)));
ok('estrutura nova e conciliação usam a regra compartilhada', ['fn_proj_lms_aplicar_estrutura_nova', 'fn_proj_lms_aplicar_conciliacao'].every(n =>
  /fn_proj_lms_validar_linhas\(v_imp\.id, '[^']+'\)/.test(corpo(n)) && /fn_proj_lms_criar_estrutura\(v_imp\.id\)/.test(corpo(n))));
ok('aplicar revalida sob lock (advisory + FOR UPDATE na importação e nos itens antigos)',
  /pg_advisory_xact_lock\(hashtextextended\('sot_lms_confirmar\|'/.test(corpo('fn_proj_lms_aplicar_conciliacao'))
  && (corpo('fn_proj_lms_aplicar_conciliacao').match(/FOR UPDATE/g) || []).length === 3
  && corpo('fn_proj_lms_aplicar_conciliacao').indexOf('fn_proj_lms_conciliacao_analise') > corpo('fn_proj_lms_aplicar_conciliacao').indexOf('pg_advisory_xact_lock'));
// rollback restaura o texto ORIGINAL da 1.4
const orig14 = (() => { const i = mig14Raw.replace(/\r\n/g, '\n').indexOf('CREATE OR REPLACE FUNCTION public.fn_proj_lms_aplicar_estrutura_nova(');
  const s = mig14Raw.replace(/\r\n/g, '\n'); return s.slice(i, s.indexOf('\n$$;', i) + 4); })();
ok('rollback contém o texto original da função da 1.4, byte a byte', desfazer.includes(orig14));
ok('rollback transacional e recusa se houver conciliação aplicada', /^BEGIN;/.test(desfazer) && /COMMIT;$/.test(desfazer)
  && /rollback automático recusado/.test(desfazer));

// ── Banco ───────────────────────────────────────────────────────
const U = n => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PERFIS = ['admin', 'gestor', 'coordenador', 'supervisor', 'escritorio', 'administrativo', 'equipe', 'diretoria'];
const UID = Object.fromEntries(PERFIS.map((p, i) => [p, U(i + 1)]));
const U_INATIVO = U(901);
const C_ATIVO = 'c0000000-0000-4000-8000-000000000001';
const PJ = n => `b0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

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
-- tabelas de movimento (mesmos tipos de produção)
create table public.sot_medicoes (id uuid primary key default gen_random_uuid(), projeto_id uuid, numero int, status text);
create table public.sot_med_itens (id uuid primary key default gen_random_uuid(), medicao_id text, projeto_id text, atividade_id text, codigo text, qtd_medida numeric);
create table public.plpt_requisicoes_materiais (id uuid primary key default gen_random_uuid(), projeto_id uuid, status text, itens jsonb, deleted_at timestamptz);
create table public.sot_adicionais (id uuid primary key default gen_random_uuid(), projeto_id uuid, tipo text, catalog_id uuid, descricao text, deleted_at timestamptz);
create table public.sot_atividades_historico (id uuid primary key default gen_random_uuid(), atividade_id uuid, dados jsonb);
create table public.sot_materiais_historico (id uuid primary key default gen_random_uuid(), material_id uuid, dados jsonb);
`;

async function novoBanco(comMig = true) {
  const db = new PGlite();
  await db.exec(BASE);
  for (const m of CADEIA) await db.exec(m);
  if (comMig) await db.exec(mig);
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

// LMS: fixture real (200 linhas, 12 WLs) e sintéticos
const esp = JSON.parse(fs.readFileSync(path.join(raiz, 'tests', 'fixtures', 'lms', 'modelo-lms-esperado.json'), 'utf8'));
const fixture = new Uint8Array(fs.readFileSync(path.join(raiz, 'tests', 'fixtures', 'lms', 'modelo-lms-anonimizado.xlsx')));
const payloadDe = (bytes, nome) => P.payloadRegistro(P.parseLms(bytes, XLSX), { hash_sha256: createHash('sha256').update(bytes).digest('hex'),
  nome, tamanho: bytes.length, mime_informado: P.XLSX_MIME, mime_validado: P.XLSX_MIME });
const lmsSint = (linhas, ident = 'SINT') => {
  const aoa = [['Definição de projeto:', null, null, ident], [], esp.colunas,
    ...linhas.map(l => [l[0], l[1], l[2], l[3], l[4], l[5], l[6], l[7], null, null, null, null, null, null])];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Planilha1');
  return payloadDe(new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' })), ident + '.xlsx');
};
const PL_FIX = payloadDe(fixture, 'Modelo LMS.xlsx');
// L1: serviço I-100 em 2 WLs; material 555 com FT I e R na WL 1; material 777 na WL 2
const L1 = lmsSint([
  ['1', 'WP', 'I', 'I-100', 'S-100', 'US3', 'SERVIÇO A', 1],
  ['2', 'WP', 'I', 'I-100', 'S-100', 'US3', 'SERVIÇO A', 1],
  ['1', 'WP', 'I', '555', 'K-1', 'M', 'CABO', 3],
  ['1', 'WP', 'R', '555', 'K-1', 'M', 'CABO', 2],
  ['2', 'WS', 'I', '777', 'M-777', 'PC', 'PLACA', 4]], 'L1');
const L_RUIM = lmsSint([['1', 'WP', 'I', 'ABC', 'K', 'UN', 'SEM CLASSE', 1], ['1', 'WP', 'I', '555', 'K-1', 'M', 'CABO', 3]], 'RUIM');
const L_SEMWL = lmsSint([[null, 'WP', 'I', '555', 'K-1', 'M', 'CABO', 3]], 'SEMWL');
const L_REP = lmsSint([['1', 'WP', 'I', '555', 'K-1', 'M', 'CABO', 3], ['1', 'WP', 'I', '555', 'K-1', 'M', 'CABO', 3]], 'REP');
const LEG_BATE = { ativ: [['I-100', 'US3', 2]], mat: [['555', 'M', 5], ['777', 'PC', 4]] };

const projeto = (db, id, nome) => db.query(`insert into public.sot_projetos (id, contrato_id, nome) values ($1, $2, $3)`, [id, C_ATIVO, nome]);
async function legado(db, proj, leg) {
  const ids = { ativ: [], mat: [] };
  for (const [cod, un, q] of (leg.ativ || [])) ids.ativ.push((await db.query(`insert into public.sot_atividades (projeto_id, codigo, descricao, unidade, qtd_prevista)
    values ($1, $2, $3, $4, $5) returning id`, [proj, cod, 'ANTIGO ' + (cod || '-'), un, q])).rows[0].id);
  for (const [cod, un, q] of (leg.mat || [])) ids.mat.push((await db.query(`insert into public.sot_materiais (projeto_id, codigo_sap, descricao, unidade, qtd_projetada)
    values ($1, $2, $3, $4, $5) returning id`, [proj, cod, 'ANTIGO ' + (cod || '-'), un, q])).rows[0].id);
  return ids;
}
const registrar = (db, proj, pl) => como(db, 'service_role', null, async () =>
  (await db.query(`select public.sot_lms_importacao_registrar($1::uuid, $2::uuid, $3::jsonb, $4::jsonb) v`,
    [UID.gestor, proj, JSON.stringify(pl.p_importacao), JSON.stringify(pl.p_linhas)])).rows[0].v.importacao_id);
const confirmar = (db, imp, modo) => como(db, 'authenticated', UID.gestor, async () =>
  (await db.query(`select public.sot_lms_confirmar($1::uuid, $2, null) v`, [imp, modo])).rows[0].v);
async function cenario(db, proj, nome, pl, modo, leg) {
  await projeto(db, proj, nome);
  const ids = leg ? await legado(db, proj, leg) : { ativ: [], mat: [] };
  const imp = await registrar(db, proj, pl);
  await confirmar(db, imp, modo);
  return { imp, ids };
}
const chamar = (db, fn, imp, uid = UID.gestor, role = 'authenticated') => como(db, role, uid, async () => {
  try { return { r: (await db.query(`select public.${fn}($1::uuid) v`, [imp])).rows[0].v }; }
  catch (e) { return { e: e.message, code: e.code }; }
});
const previa = (db, imp, uid, role) => chamar(db, 'sot_lms_conciliacao_previa', imp, uid, role);
const conciliar = (db, imp, uid, role) => chamar(db, 'fn_proj_lms_aplicar_conciliacao', imp, uid, role);
const estruturaNova = (db, imp, uid, role) => chamar(db, 'fn_proj_lms_aplicar_estrutura_nova', imp, uid, role);
const calc = async (db, proj) => (await db.query(`select public.sot_lms_estado_wl_calc($1::uuid) v`, [proj])).rows[0].v;
const item = (pv, tipo, cod) => ((pv.r && pv.r.itens) || []).find(i => i.tipo === tipo && i.codigo === cod);
const snap = async db => (await db.query(`select
  (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.sot_lms_importacoes t) i,
  (select count(*) from public.sot_lms_importacao_eventos)::int e, (select count(*) from public.sot_wl)::int w,
  (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.sot_atividades t) a,
  (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.sot_materiais t) m,
  (select count(*) from public.sot_lms_conciliacao)::int c`)).rows[0];
// Estrutura normalizada do projeto (sem ids): para paridade entre caminhos
const estrutura = async (db, proj) => (await db.query(`select json_build_object(
  'wls', (select json_agg(json_build_object('c', w.codigo, 'o', w.ordem, 'orig', w.origem) order by w.ordem) from public.sot_wl w where w.projeto_id = $1),
  'ativ', (select json_agg(json_build_object('cod', a.codigo, 'd', a.descricao, 'u', a.unidade, 'q', a.qtd_prevista, 'v', a.valor_unitario,
     's', a.servico_id, 'o', a.ordem_exec, 'wl', w.codigo, 'ctg', a.ctg, 'ft', a.ft, 'kit', a.kit, 'lx', l.linha_excel) order by l.ordem)
     from public.sot_atividades a join public.sot_wl w on w.id = a.wl_id join public.sot_lms_linhas l on l.id = a.lms_linha_id
     where a.projeto_id = $1 and a.deleted_at is null),
  'mat', (select json_agg(json_build_object('cod', m.codigo_sap, 'd', m.descricao, 'u', m.unidade, 'q', m.qtd_projetada, 'desc', m.somente_descritivo,
     'obs', m.observacao, 'wl', w.codigo, 'ctg', m.ctg, 'ft', m.ft, 'kit', m.kit, 'lx', l.linha_excel) order by l.ordem)
     from public.sot_materiais m join public.sot_wl w on w.id = m.wl_id join public.sot_lms_linhas l on l.id = m.lms_linha_id
     where m.projeto_id = $1 and m.deleted_at is null)) v`, [proj])).rows[0].v;
const semIds = r => { const c = Object.assign({}, r || {}); delete c.importacao_id; delete c.projeto_id; return c; };

// ── Aplicação da migration ──────────────────────────────────────
const db = await novoBanco(false);
let erro = await tentaExec(db, mig);
ok('aplica sobre a cadeia real (1.3, 1.4, 1.5b-1)', erro === null, erro);
erro = await tentaExec(db, mig);
ok('reaplica sem erro (idempotente)', erro === null, erro);
const semMov = await (async () => { const d = new PGlite(); await d.exec(BASE.replace(/create table public\.sot_med_itens[^;]*;/, '')); for (const m of CADEIA) await d.exec(m);
  return tentaExec(d, mig); })();
ok('pré-condição: sem tabela de movimento a migration não aplica', /tabelas de movimento ausentes/.test(semMov || ''), semMov);

const fpriv = async (role, fn) => (await db.query(`select has_function_privilege($1, $2, 'EXECUTE') v`, [role, fn])).rows[0].v;
for (const fn of ['public.sot_lms_conciliacao_previa(uuid)', 'public.fn_proj_lms_aplicar_conciliacao(uuid)', 'public.fn_proj_lms_aplicar_estrutura_nova(uuid)']) {
  ok(`${fn}: só authenticated executa`, await fpriv('authenticated', fn) && !(await fpriv('anon', fn)) && !(await fpriv('service_role', fn)));
}
for (const fn of ['public.fn_proj_lms_linhas_problemas(uuid)', 'public.fn_proj_lms_validar_linhas(uuid,text)', 'public.fn_proj_lms_criar_estrutura(uuid)',
  'public.fn_proj_lms_conciliacao_analise(uuid)']) {
  ok(`${fn}: interna, ninguém executa pela API`, !(await fpriv('authenticated', fn)) && !(await fpriv('anon', fn)) && !(await fpriv('service_role', fn)));
}
const meta = (await db.query(`select proname, prosecdef, provolatile, proconfig::text cfg from pg_proc
  where proname in ('sot_lms_conciliacao_previa', 'fn_proj_lms_aplicar_conciliacao', 'fn_proj_lms_aplicar_estrutura_nova')`)).rows;
ok('no banco: DEFINER + search_path fixo; prévia STABLE', meta.length === 3 && meta.every(m => m.prosecdef && /search_path=public, pg_temp/.test(m.cfg))
  && meta.find(m => m.proname === 'sot_lms_conciliacao_previa').provolatile === 's', meta);
const tabPriv = (await db.query(`select has_table_privilege('authenticated', 'public.sot_lms_conciliacao', 'SELECT') a,
  has_table_privilege('anon', 'public.sot_lms_conciliacao', 'SELECT') b, has_table_privilege('service_role', 'public.sot_lms_conciliacao', 'INSERT') c`)).rows[0];
ok('tabela de conciliação sem acesso direto (authenticated, anon, service_role)', !tabPriv.a && !tabPriv.b && !tabPriv.c, tabPriv);

// ── Cenários ────────────────────────────────────────────────────
const S = {};
S.bate = await cenario(db, PJ(1), 'Bate', L1, 'CONCILIACAO', LEG_BATE);
S.dup = await cenario(db, PJ(2), 'Duplicado', L1, 'CONCILIACAO', { ativ: [['I-100', 'US3', 2]], mat: [['555', 'M', 2], ['555', 'M', 3], ['777', 'PC', 4]] });
S.un = await cenario(db, PJ(3), 'Unidade', L1, 'CONCILIACAO', { ativ: [['I-100', 'UN', 2]], mat: [['555', 'M', 5], ['777', 'PC', 4]] });
S.qtd = await cenario(db, PJ(4), 'Quantidade', L1, 'CONCILIACAO', { ativ: [['I-100', 'US3', 2]], mat: [['555', 'M', 6], ['777', 'PC', 4]] });
S.soleg = await cenario(db, PJ(5), 'Só legado', L1, 'CONCILIACAO', { ativ: [['I-100', 'US3', 2]], mat: [['555', 'M', 5], ['777', 'PC', 4], ['999', 'UN', 1]] });
S.solms = await cenario(db, PJ(6), 'Só LMS', L1, 'CONCILIACAO', { ativ: [['I-100', 'US3', 2]], mat: [['555', 'M', 5]] });
S.semcod = await cenario(db, PJ(7), 'Sem código', L1, 'CONCILIACAO', { ativ: [['I-100', 'US3', 2]], mat: [['555', 'M', 5], ['777', 'PC', 4], [null, 'UN', 1]] });
S.tipo = await cenario(db, PJ(8), 'Tipo', L1, 'CONCILIACAO', { ativ: [['I-100', 'US3', 2], ['888', 'UN', 1]], mat: [['555', 'M', 5], ['777', 'PC', 4]] });
S.mov = await cenario(db, PJ(9), 'Movimento', L1, 'CONCILIACAO', LEG_BATE);
// espelho do ETD VARGINHA: unidade UN no legado × US3/M no LMS + medição de teste ligada à atividade
S.varg = await cenario(db, PJ(10), 'Espelho VARGINHA', L1, 'CONCILIACAO', { ativ: [['I-100', 'UN', 2]], mat: [['555', 'UN', 5], ['777', 'PC', 4]] });
await db.query(`insert into public.sot_med_itens (medicao_id, projeto_id, atividade_id, codigo, qtd_medida) values ('med1', $1, $2, 'I-100', 16)`,
  [PJ(10), S.varg.ids.ativ[0]]);
S.zero = await cenario(db, PJ(11), 'Sem legado (DFdfSDF)', PL_FIX, 'CONCILIACAO');
S.novaFix = await cenario(db, PJ(12), 'Estrutura nova fixture', PL_FIX, 'ESTRUTURA_NOVA');
S.novaL1 = await cenario(db, PJ(13), 'Estrutura nova L1', L1, 'ESTRUTURA_NOVA');
S.ruim = await cenario(db, PJ(14), 'Linha ruim', L_RUIM, 'CONCILIACAO', { mat: [['555', 'M', 3]] });

// prévia não grava nada
let antes = await snap(db);
for (const k of Object.keys(S)) await previa(db, S[k].imp);
ok('prévias não gravam nada', JSON.stringify(await snap(db)) === JSON.stringify(antes));

// ── Prévia: batimento ───────────────────────────────────────────
let pv = await previa(db, S.bate.imp);
ok('bate: pode_aplicar, sem bloqueios, 3 códigos BATE', pv.r && pv.r.pode_aplicar === true && pv.r.bloqueios.length === 0
  && pv.r.resumo.por_situacao.BATE === 3 && pv.r.resumo.legado_itens === 3 && pv.r.estado === 'EM_CONCILIACAO', pv);
let it = item(pv, 'ATIVIDADE', 'I-100');
ok('bate: soma por código agrega WLs (I-100: 2 linhas em 2 WLs = 2)', it && Number(it.qtd_legado) === 2 && Number(it.qtd_lms) === 2 && it.lms.length === 2
  && it.unidade_legado === 'US3' && it.unidade_lms === 'US3', it);
it = item(pv, 'MATERIAL', '555');
ok('bate: soma por código agrega FT I + R (555: 3 + 2 = 5)', it && Number(it.qtd_lms) === 5 && it.lms.map(l => l.ft).join() === 'I,R', it);
pv = await previa(db, S.dup.imp);
ok('bate com itens antigos repetidos (555: 2 + 3 = 5)', pv.r && pv.r.pode_aplicar === true && item(pv, 'MATERIAL', '555').legado.length === 2, pv);
pv = await previa(db, S.un.imp);
ok('unidade diferente bloqueia (UN × US3)', pv.r && pv.r.pode_aplicar === false && JSON.stringify(pv.r.bloqueios) === '["UNIDADE_DIFERENTE"]'
  && item(pv, 'ATIVIDADE', 'I-100').situacao === 'UNIDADE_DIFERENTE', pv.r && pv.r.bloqueios);
pv = await previa(db, S.qtd.imp);
ok('quantidade diferente bloqueia (6 × 5)', pv.r && JSON.stringify(pv.r.bloqueios) === '["QTD_DIFERENTE"]' && item(pv, 'MATERIAL', '555').situacao === 'QTD_DIFERENTE', pv.r && pv.r.bloqueios);
pv = await previa(db, S.soleg.imp);
ok('código só no legado bloqueia', pv.r && JSON.stringify(pv.r.bloqueios) === '["SO_NO_LEGADO"]' && item(pv, 'MATERIAL', '999').situacao === 'SO_NO_LEGADO');
pv = await previa(db, S.solms.imp);
ok('código só no LMS bloqueia', pv.r && JSON.stringify(pv.r.bloqueios) === '["SO_NO_LMS"]' && item(pv, 'MATERIAL', '777').situacao === 'SO_NO_LMS');
pv = await previa(db, S.semcod.imp);
ok('item antigo sem código bloqueia', pv.r && JSON.stringify(pv.r.bloqueios) === '["SEM_CODIGO"]', pv.r && pv.r.bloqueios);
pv = await previa(db, S.tipo.imp);
ok('tipo trocado (atividade com código de material) bloqueia', pv.r && JSON.stringify(pv.r.bloqueios) === '["TIPO_DIFERENTE"]', pv.r && pv.r.bloqueios);
pv = await previa(db, S.ruim.imp);
ok('linha do LMS fora do padrão bloqueia na prévia', pv.r && pv.r.bloqueios.includes('LINHA_NAO_CLASSIFICADA') && pv.r.linhas_problema.nao_classificada === '4', pv.r);

// ── Prévia: movimento (cada motivo bloqueia) ────────────────────
const aMov = S.mov.ids.ativ[0], mMov = S.mov.ids.mat[0];
const casos = [
  ['atividade qtd_viabilizada', `update public.sot_atividades set qtd_viabilizada = 1 where id = '${aMov}'`, `update public.sot_atividades set qtd_viabilizada = 0 where id = '${aMov}'`, 'ATIVIDADE', 'I-100', 'QTD_VIABILIZADA'],
  ['atividade qtd_executada', `update public.sot_atividades set qtd_executada = 1 where id = '${aMov}'`, `update public.sot_atividades set qtd_executada = 0 where id = '${aMov}'`, 'ATIVIDADE', 'I-100', 'QTD_EXECUTADA'],
  ['atividade qtd_medida', `update public.sot_atividades set qtd_medida = 1 where id = '${aMov}'`, `update public.sot_atividades set qtd_medida = 0 where id = '${aMov}'`, 'ATIVIDADE', 'I-100', 'QTD_MEDIDA'],
  ['atividade qtd_faturada', `update public.sot_atividades set qtd_faturada = 1 where id = '${aMov}'`, `update public.sot_atividades set qtd_faturada = 0 where id = '${aMov}'`, 'ATIVIDADE', 'I-100', 'QTD_FATURADA'],
  ['atividade em item de medição', `insert into public.sot_med_itens (medicao_id, atividade_id) values ('m9', '${aMov}')`, `delete from public.sot_med_itens where medicao_id = 'm9'`, 'ATIVIDADE', 'I-100', 'MEDICAO'],
  ['atividade com histórico', `insert into public.sot_atividades_historico (atividade_id) values ('${aMov}')`, `delete from public.sot_atividades_historico`, 'ATIVIDADE', 'I-100', 'HISTORICO'],
  ...['qtd_viabilizada', 'qtd_requisitada', 'qtd_entregue', 'qtd_aplicada', 'qtd_devolvida', 'qtd_processada_sap'].map(c =>
    ['material ' + c, `update public.sot_materiais set ${c} = 1 where id = '${mMov}'`, `update public.sot_materiais set ${c} = 0 where id = '${mMov}'`, 'MATERIAL', '555', c.toUpperCase()]),
  ['material em requisição (JSON array)', `insert into public.plpt_requisicoes_materiais (projeto_id, status, itens) values ('${PJ(9)}', 'Em campo', '[{"mat_id":"${mMov}","qtd_req":1}]')`,
    `delete from public.plpt_requisicoes_materiais`, 'MATERIAL', '555', 'REQUISICAO'],
  ['material em requisição (JSON gravado como texto)', `insert into public.plpt_requisicoes_materiais (projeto_id, status, itens) values ('${PJ(9)}', 'Aguardando aprovação', to_jsonb('[{"mat_id":"${mMov}"}]'::text))`,
    `delete from public.plpt_requisicoes_materiais`, 'MATERIAL', '555', 'REQUISICAO'],
  ['material em adicional', `insert into public.sot_adicionais (projeto_id, tipo, catalog_id) values ('${PJ(9)}', 'material', '${mMov}')`, `delete from public.sot_adicionais`, 'MATERIAL', '555', 'ADICIONAL'],
  ['material com histórico', `insert into public.sot_materiais_historico (material_id) values ('${mMov}')`, `delete from public.sot_materiais_historico`, 'MATERIAL', '555', 'HISTORICO']
];
for (const [nome, sujar, limpar, tipo, cod, motivo] of casos) {
  await db.exec(sujar);
  pv = await previa(db, S.mov.imp);
  it = item(pv, tipo, cod);
  ok('movimento bloqueia: ' + nome, pv.r && pv.r.pode_aplicar === false && JSON.stringify(pv.r.bloqueios) === '["COM_MOVIMENTO"]'
    && it && it.situacao === 'COM_MOVIMENTO' && it.legado.some(l => (l.movimento || []).includes(motivo)), { b: pv.r && pv.r.bloqueios, it });
  await db.exec(limpar);
}
await db.exec(`insert into public.plpt_requisicoes_materiais (projeto_id, status, itens, deleted_at) values ('${PJ(9)}', 'Excluída', '[{"mat_id":"${mMov}"}]', now())`);
pv = await previa(db, S.mov.imp);
ok('requisição excluída não conta como movimento; projeto limpo volta a poder aplicar', pv.r && pv.r.pode_aplicar === true, pv.r && pv.r.bloqueios);
await db.exec(`delete from public.plpt_requisicoes_materiais`);

// ── Espelho do ETD VARGINHA ─────────────────────────────────────
pv = await previa(db, S.varg.imp);
ok('VARGINHA: prévia bloqueada por UNIDADE_DIFERENTE e COM_MOVIMENTO', pv.r && pv.r.pode_aplicar === false
  && JSON.stringify(pv.r.bloqueios) === '["COM_MOVIMENTO","UNIDADE_DIFERENTE"]', pv.r && pv.r.bloqueios);
ok('VARGINHA: atividade com unidade diferente também mostra o movimento (medição)', (() => { const x = item(pv, 'ATIVIDADE', 'I-100');
  return x && x.situacao === 'UNIDADE_DIFERENTE' && x.com_movimento === true && x.legado[0].movimento.includes('MEDICAO'); })());
antes = await snap(db);
let r = await conciliar(db, S.varg.imp);
ok('VARGINHA: aplicar recusa com o motivo e não grava nada', r.code === '55000'
  && /CONCILIACAO_BLOQUEADA \(COM_MOVIMENTO 1, UNIDADE_DIFERENTE 2\)/.test(r.e) && JSON.stringify(await snap(db)) === JSON.stringify(antes), r);

// ── Aplicar: recusas ────────────────────────────────────────────
for (const [nome, k, re] of [['unidade', 'un', /UNIDADE_DIFERENTE 1/], ['quantidade', 'qtd', /QTD_DIFERENTE 1/], ['só legado', 'soleg', /SO_NO_LEGADO 1/],
  ['só LMS', 'solms', /SO_NO_LMS 1/], ['sem código', 'semcod', /SEM_CODIGO 1/], ['tipo', 'tipo', /TIPO_DIFERENTE 1/]]) {
  antes = await snap(db);
  r = await conciliar(db, S[k].imp);
  ok('aplicar recusa (' + nome + ') sem gravar', r.code === '55000' && /CONCILIACAO_BLOQUEADA/.test(r.e) && re.test(r.e)
    && JSON.stringify(await snap(db)) === JSON.stringify(antes), r);
}
r = await conciliar(db, S.ruim.imp);
ok('aplicar recusa linha fora do padrão com a mensagem da 1.4', r.code === '55000' && r.e === 'Conciliação: LINHA_NAO_CLASSIFICADA (linhas 4)', r);
r = await conciliar(db, S.novaL1.imp);
ok('aplicar recusa importação ESTRUTURA_NOVA', r.code === '55000' && /IMPORTACAO_NAO_ELEGIVEL \(tipo ORIGINAL, status CONFIRMADA, modo ESTRUTURA_NOVA\)/.test(r.e), r);
pv = await previa(db, S.novaL1.imp);
ok('prévia de importação ESTRUTURA_NOVA: não elegível', pv.r && pv.r.pode_aplicar === false && JSON.stringify(pv.r.bloqueios) === '["IMPORTACAO_NAO_ELEGIVEL"]');
await db.exec(`update public.sot_atividades set qtd_executada = 1 where id = '${aMov}'`);
r = await conciliar(db, S.mov.imp);
ok('aplicar recusa item com movimento (revalida, não confia na prévia)', r.code === '55000' && /COM_MOVIMENTO 1/.test(r.e), r);
await db.exec(`update public.sot_atividades set qtd_executada = 0 where id = '${aMov}'`);

// ── Projeto que já tem WL ativa vinda de OUTRA importação (PROJETO_JA_TEM_WL) ──
// Cenário montado pelo dono do banco: legado que bate + ORIGINAL L1 confirmada em CONCILIACAO + um RASCUNHO de outro
// arquivo com uma WL ativa ligada a ele. Contraponto: WL cancelada não bloqueia.
const L_OUTRA = lmsSint([['9', 'WP', 'I', '555', 'K-9', 'M', 'CABO', 5]], 'OUTRA');
async function comWlDeOutra(proj, nome, cancelada) {
  await projeto(db, proj, nome);
  await legado(db, proj, LEG_BATE);
  const outra = await registrar(db, proj, L_OUTRA);
  const imp = await registrar(db, proj, L1);
  await confirmar(db, imp, 'CONCILIACAO');
  await db.query(`insert into public.sot_wl (projeto_id, codigo, origem, importacao_id, ordem, criado_por_auth,
      cancelada_em, cancelada_por_auth, motivo_cancelamento) values ($1, '9', 'LMS', $2, 1, $3, $4, $5, $6)`,
    [proj, outra, UID.gestor, cancelada ? new Date().toISOString() : null, cancelada ? UID.gestor : null, cancelada ? 'teste' : null]);
  return { imp, outra };
}
const jaWl = await comWlDeOutra(PJ(15), 'Já tem WL', false);
ok('cenário: WL ativa vinda de outra importação (RASCUNHO) no mesmo projeto', (await db.query(`select count(*)::int n from public.sot_wl
  where projeto_id = $1 and importacao_id = $2 and cancelada_em is null`, [PJ(15), jaWl.outra])).rows[0].n === 1
  && (await db.query(`select status from public.sot_lms_importacoes where id = $1`, [jaWl.outra])).rows[0].status === 'RASCUNHO');
antes = await snap(db);
pv = await previa(db, jaWl.imp);
ok('projeto com WL de outra importação: prévia bloqueia com PROJETO_JA_TEM_WL', pv.r && pv.r.pode_aplicar === false
  && JSON.stringify(pv.r.bloqueios) === '["PROJETO_JA_TEM_WL"]' && pv.r.resumo.por_situacao.BATE === 3, pv.r && { b: pv.r.bloqueios, s: pv.r.resumo });
r = await conciliar(db, jaWl.imp);
ok('projeto com WL de outra importação: aplicar recusa com PROJETO_JA_TEM_WL', r.code === '55000' && r.e === 'Conciliação: PROJETO_JA_TEM_WL', r);
ok('projeto com WL de outra importação: nada é gravado (prévia + tentativa de aplicar)', JSON.stringify(await snap(db)) === JSON.stringify(antes)
  && (await db.query(`select count(*)::int n from public.sot_atividades where projeto_id = $1 and deleted_at is not null`, [PJ(15)])).rows[0].n === 0
  && (await db.query(`select count(*)::int n from public.sot_wl where projeto_id = $1`, [PJ(15)])).rows[0].n === 1
  && (await calc(db, PJ(15))) === 'EM_CONCILIACAO');
const wlCanc = await comWlDeOutra(PJ(16), 'WL cancelada', true);
pv = await previa(db, wlCanc.imp);
ok('WL cancelada de outra importação não bloqueia a prévia', pv.r && pv.r.pode_aplicar === true && pv.r.bloqueios.length === 0, pv.r && pv.r.bloqueios);

// ── Permissão ───────────────────────────────────────────────────
pv = await previa(db, S.bate.imp, UID.administrativo);
ok('prévia com só PROJ_IMPORTAR_LMS (administrativo): lê, pode_aplicar = false', pv.r && pv.r.pode_aplicar === false && pv.r.bloqueios.length === 0, pv);
for (const [nome, uid, role, re] of [['supervisor', UID.supervisor, 'authenticated', /acesso negado \(SEM_PERMISSAO\)/], ['inativo', U_INATIVO, 'authenticated', /USUARIO_ERP_INATIVO/],
  ['sem sessão', null, 'authenticated', /sem sessão/]]) {
  pv = await previa(db, S.bate.imp, uid, role);
  ok('prévia negada: ' + nome, pv.code === '42501' && re.test(pv.e), pv);
}
pv = await previa(db, S.bate.imp, null, 'anon');
ok('prévia: anon não executa', pv.e && /permission denied/.test(pv.e), pv);
pv = await previa(db, S.bate.imp, null, 'service_role');
ok('prévia: service_role não executa', pv.e && /permission denied/.test(pv.e), pv);
for (const [nome, uid, role, re] of [['administrativo (sem PROJ_CONFIRMAR_LMS)', UID.administrativo, 'authenticated', /Conciliação: SEM_PERMISSAO/],
  ['supervisor', UID.supervisor, 'authenticated', /SEM_PERMISSAO/], ['inativo', U_INATIVO, 'authenticated', /USUARIO_ERP_INATIVO|inexistente ou inativo/],
  ['sem sessão', null, 'authenticated', /sem sessão/]]) {
  antes = await snap(db);
  r = await conciliar(db, S.bate.imp, uid, role);
  ok('aplicar negado: ' + nome, r.code === '42501' && re.test(r.e) && JSON.stringify(await snap(db)) === JSON.stringify(antes), r);
}
r = await conciliar(db, S.bate.imp, null, 'anon');
ok('aplicar: anon não executa', r.e && /permission denied/.test(r.e), r);
r = await como(db, 'authenticated', UID.gestor, async () => { try { await db.query(`select * from public.sot_lms_conciliacao`); return null; } catch (e) { return e.message; } });
ok('authenticated não lê a tabela de conciliação direto', /permission denied/.test(r || ''), r);
r = await como(db, 'authenticated', UID.gestor, async () => { try { await db.query(`select public.fn_proj_lms_criar_estrutura($1::uuid)`, [S.solms.imp]); return null; } catch (e) { return e.message; } });
ok('authenticated não chama a criação de estrutura direto', /permission denied/.test(r || ''), r);

// ── Aplicar: sucesso ────────────────────────────────────────────
const linhaAntes = (await db.query(`select to_jsonb(a) j from public.sot_atividades a where id = $1`, [S.bate.ids.ativ[0]])).rows[0].j;
const nAtivAntes = (await db.query(`select count(*)::int n from public.sot_atividades`)).rows[0].n;
const nMatAntes = (await db.query(`select count(*)::int n from public.sot_materiais`)).rows[0].n;
r = await conciliar(db, S.bate.imp);
ok('aplica: CONCILIACAO_APLICADA com as contagens', r.r && r.r.operacao === 'CONCILIACAO_APLICADA' && r.r.wls === 2 && r.r.atividades === 2
  && r.r.materiais_operacionais === 2 && r.r.materiais_retirada_descritivos === 1 && r.r.itens_antigos_substituidos === 3 && r.r.estado_wl === 'ESTRUTURADO', r);
ok('nenhuma linha apagada fisicamente (só inclusões)', (await db.query(`select count(*)::int n from public.sot_atividades`)).rows[0].n === nAtivAntes + 2
  && (await db.query(`select count(*)::int n from public.sot_materiais`)).rows[0].n === nMatAntes + 3);
const antigos = (await db.query(`select id, deleted_at from public.sot_atividades where id = any($1::uuid[]) union all
  select id, deleted_at from public.sot_materiais where id = any($2::uuid[])`, [S.bate.ids.ativ, S.bate.ids.mat])).rows;
ok('itens antigos ficam com deleted_at (inativos), não apagados', antigos.length === 3 && antigos.every(x => x.deleted_at !== null));
const regs = (await db.query(`select * from public.sot_lms_conciliacao where importacao_id = $1 order by legado_tipo, codigo_norm`, [S.bate.imp])).rows;
ok('registro: uma linha por item antigo, decisão SUBSTITUIDO', regs.length === 3 && regs.every(x => x.decisao === 'SUBSTITUIDO' && x.aplicado_por_auth === UID.gestor
  && x.projeto_id === PJ(1)), regs.map(x => [x.legado_tipo, x.codigo_norm]));
const regA = regs.find(x => x.legado_tipo === 'ATIVIDADE');
const retratoOk = JSON.stringify(Object.assign({}, regA.retrato)) === JSON.stringify(linhaAntes);
ok('registro: retrato idêntico ao item antigo antes da baixa', retratoOk, { retrato: regA.retrato, antes: linhaAntes });
const novosI100 = (await db.query(`select a.id from public.sot_atividades a join public.sot_lms_linhas l on l.id = a.lms_linha_id
  where a.projeto_id = $1 and l.codigo_norm = 'I-100' order by l.ordem`, [PJ(1)])).rows.map(x => x.id);
ok('registro: liga às 2 linhas do LMS e às 2 atividades novas (uma por WL)', regA.lms_linha_ids.length === 2
  && JSON.stringify(regA.novos_ids) === JSON.stringify(novosI100), regA);
const reg555 = regs.find(x => x.codigo_norm === '555');
ok('registro do material 555: FT I e FT R (operacional + descritivo)', reg555.lms_linha_ids.length === 2 && reg555.novos_ids.length === 2);
ok('estado passa a ESTRUTURADO; importação marcada', (await calc(db, PJ(1))) === 'ESTRUTURADO'
  && (await db.query(`select conciliacao_aplicada_em is not null m, conciliacao_aplicada_por_auth p from public.sot_lms_importacoes where id = $1`, [S.bate.imp])).rows[0].p === UID.gestor);
const ev = (await db.query(`select detalhe from public.sot_lms_importacao_eventos where importacao_id = $1 and tipo_evento = 'CONCILIACAO_APLICADA'`, [S.bate.imp])).rows;
ok('evento CONCILIACAO_APLICADA com as contagens', ev.length === 1 && ev[0].detalhe.atividades_antigas_substituidas === 1 && ev[0].detalhe.materiais_antigos_substituidos === 2
  && ev[0].detalhe.wls === 2, ev);
ok('retirada FT=R virou só descritivo', (await db.query(`select bool_and(somente_descritivo = (ft = 'R')) v from public.sot_materiais where projeto_id = $1 and deleted_at is null`, [PJ(1)])).rows[0].v === true);

// idempotência
antes = await snap(db);
r = await conciliar(db, S.bate.imp);
ok('reaplicar: JA_APLICADA sem duplicar nada', r.r && r.r.operacao === 'JA_APLICADA' && r.r.wls === 2 && r.r.itens_antigos_substituidos === 3
  && JSON.stringify(await snap(db)) === JSON.stringify(antes), r);
pv = await previa(db, S.bate.imp);
ok('prévia depois de aplicada: aplicada, JA_APLICADA, 3 substituídos', pv.r && pv.r.aplicada === true && pv.r.pode_aplicar === false
  && JSON.stringify(pv.r.bloqueios) === '["JA_APLICADA"]' && pv.r.itens_substituidos === 3, pv);
r = await estruturaNova(db, S.bate.imp);
ok('estrutura nova não roda sobre importação de conciliação', r.code === '55000' && /IMPORTACAO_NAO_ELEGIVEL/.test(r.e), r);
r = await como(db, 'postgres', null, async () => { try { await db.query(`update public.sot_lms_conciliacao set decisao = 'SUBSTITUIDO'`); return null; } catch (e) { return e.message; } });
ok('registro de conciliação não é alterado (nem pelo dono)', /não é alterado nem apagado/.test(r || ''), r);
r = await tentaExec(db, `delete from public.sot_lms_conciliacao`);
ok('registro de conciliação não é apagado', /não é alterado nem apagado/.test(r || ''), r);
r = await tentaExec(db, `truncate public.sot_lms_conciliacao`);
ok('registro de conciliação não sofre TRUNCATE', /não é alterado nem apagado/.test(r || ''), r);

// itens antigos repetidos
r = await conciliar(db, S.dup.imp);
const regsDup = (await db.query(`select * from public.sot_lms_conciliacao where importacao_id = $1 and codigo_norm = '555'`, [S.dup.imp])).rows;
ok('itens antigos repetidos: os dois registrados com as mesmas linhas do LMS', r.r && r.r.itens_antigos_substituidos === 4 && regsDup.length === 2
  && JSON.stringify(regsDup[0].lms_linha_ids) === JSON.stringify(regsDup[1].lms_linha_ids), r);

// projeto sem legado (TESTE 1 — DFdfSDF)
pv = await previa(db, S.zero.imp);
ok('sem legado: prévia sem batimento, pode aplicar', pv.r && pv.r.pode_aplicar === true && pv.r.resumo.legado_itens === 0
  && Object.keys(pv.r.resumo.por_situacao).join() === 'SEM_LEGADO', pv.r && pv.r.resumo);
r = await conciliar(db, S.zero.imp);
const rNova = await estruturaNova(db, S.novaFix.imp);
ok('sem legado: concilia com as mesmas contagens da estrutura nova', r.r && rNova.r && r.r.itens_antigos_substituidos === 0
  && ['wls', 'atividades', 'materiais_operacionais', 'materiais_retirada_descritivos'].every(k => r.r[k] === rNova.r[k]), { r, rNova });

// ── Paridade (G7) ───────────────────────────────────────────────
ok('paridade: conciliação (sem legado) = estrutura nova, fixture de 200 linhas', JSON.stringify(await estrutura(db, PJ(11))) === JSON.stringify(await estrutura(db, PJ(12))));
const rNovaL1 = await estruturaNova(db, S.novaL1.imp);
ok('paridade: conciliação com legado = estrutura nova do mesmo LMS', rNovaL1.r && rNovaL1.r.operacao === 'ESTRUTURA_APLICADA'
  && JSON.stringify(await estrutura(db, PJ(1))) === JSON.stringify(await estrutura(db, PJ(13))), rNovaL1);

// estrutura nova reescrita × função original da 1.4 (banco sem esta migration)
const dbOld = await novoBanco(false);
const dbNew = await novoBanco(true);
const resultados = {};
for (const [nomeDb, d] of [['old', dbOld], ['new', dbNew]]) {
  const out = {};
  const ok1 = await cenario(d, PJ(1), 'Fixture', PL_FIX, 'ESTRUTURA_NOVA');
  out.sucesso = semIds((await estruturaNova(d, ok1.imp)).r);
  out.estrutura = await estrutura(d, PJ(1));
  out.evento = (await d.query(`select tipo_evento, detalhe - 'projeto_id' d from public.sot_lms_importacao_eventos where importacao_id = $1 and tipo_evento = 'ESTRUTURA_APLICADA'`, [ok1.imp])).rows;
  out.ja = semIds((await estruturaNova(d, ok1.imp)).r);
  const rec = async (proj, nome, pl, modo, leg, uid) => { const c = await cenario(d, proj, nome, pl, modo, leg); const x = await estruturaNova(d, c.imp, uid); return [x.code, x.e]; };
  out.legado = await rec(PJ(2), 'Legado', L1, 'ESTRUTURA_NOVA', LEG_BATE);
  out.naoClass = await rec(PJ(3), 'Não classificada', L_RUIM, 'ESTRUTURA_NOVA');
  out.semWl = await rec(PJ(4), 'Sem WL', L_SEMWL, 'ESTRUTURA_NOVA');
  out.repetidas = await rec(PJ(5), 'Repetidas', L_REP, 'ESTRUTURA_NOVA');
  out.naoElegivel = await rec(PJ(6), 'Conciliação', L1, 'CONCILIACAO');
  out.semPermissao = await rec(PJ(7), 'Sem permissão', L1, 'ESTRUTURA_NOVA', null, UID.administrativo);
  out.semSessao = (await estruturaNova(d, ok1.imp, null)).e;
  resultados[nomeDb] = out;
}
for (const k of Object.keys(resultados.old)) {
  ok('estrutura nova reescrita = 1.4 original: ' + k, JSON.stringify(resultados.old[k]) === JSON.stringify(resultados.new[k]),
    { old: JSON.stringify(resultados.old[k]).slice(0, 200), new: JSON.stringify(resultados.new[k]).slice(0, 200) });
}
ok('cenários da 1.4 exercitados (todas as recusas)', resultados.new.legado[1] && /PROJETO_COM_LEGADO/.test(resultados.new.legado[1])
  && /LINHA_NAO_CLASSIFICADA/.test(resultados.new.naoClass[1]) && /LINHA_SEM_WL_OU_DESCRICAO/.test(resultados.new.semWl[1])
  && /LINHAS_REPETIDAS_NA_CHAVE/.test(resultados.new.repetidas[1]) && /IMPORTACAO_NAO_ELEGIVEL/.test(resultados.new.naoElegivel[1])
  && /SEM_PERMISSAO/.test(resultados.new.semPermissao[1]) && resultados.new.ja.operacao === 'JA_APLICADA', resultados.new);

// ── Rollback ────────────────────────────────────────────────────
erro = await tentaExec(db, desfazer);
ok('rollback recusado quando há conciliação aplicada', /rollback automático recusado/.test(erro || ''), erro);
const dbR = await novoBanco(true);
erro = await tentaExec(dbR, desfazer);
const restos = (await dbR.query(`select count(*)::int n from pg_proc where proname in ('sot_lms_conciliacao_previa', 'fn_proj_lms_aplicar_conciliacao',
  'fn_proj_lms_linhas_problemas', 'fn_proj_lms_validar_linhas', 'fn_proj_lms_criar_estrutura', 'fn_proj_lms_conciliacao_analise', 'sot_lms_conciliacao_proteger')`)).rows[0].n;
const srcR = (await dbR.query(`select prosrc from pg_proc where proname = 'fn_proj_lms_aplicar_estrutura_nova'`)).rows[0].prosrc;
const srcOld = (await dbOld.query(`select prosrc from pg_proc where proname = 'fn_proj_lms_aplicar_estrutura_nova'`)).rows[0].prosrc;
ok('rollback sem conciliação: remove tudo da 1.6a e restaura a função da 1.4 (mesmo texto)', erro === null && restos === 0 && srcR === srcOld
  && (await dbR.query(`select to_regclass('public.sot_lms_conciliacao') t`)).rows[0].t === null, { erro, restos });
const cR = await cenario(dbR, PJ(1), 'Depois do rollback', PL_FIX, 'ESTRUTURA_NOVA');
r = await estruturaNova(dbR, cR.imp);
ok('depois do rollback a estrutura nova continua funcionando', r.r && r.r.operacao === 'ESTRUTURA_APLICADA', r);
erro = await tentaExec(dbR, `insert into public.sot_lms_importacao_eventos (importacao_id, tipo_evento, por_auth, por_usuario_id)
  values ('${cR.imp}', 'CONCILIACAO_APLICADA', '${UID.gestor}', 'x')`);
ok('depois do rollback o evento CONCILIACAO_APLICADA volta a ser recusado (CHECK de tipo)', /sot_lms_importacao_eventos_tipo_chk/.test(erro || ''), erro);

// ── Mutação ─────────────────────────────────────────────────────
const mut = async (nome, transform, preparar, prova) => {
  const s = transform(mig);
  if (s === mig) { ok(nome + ' (sabotagem não alterou o código)', false); return; }
  let det = false, err = null;
  try {
    const d = await novoBanco(false);
    await d.exec(s);
    const c = await preparar(d);
    det = await prova(d, c);
  } catch (e) { err = e.message; }
  ok(nome, det === true, err);
};
const aplicou = async (d, c, uid) => { const x = await conciliar(d, c.imp, uid); return !!(x.r && x.r.operacao === 'CONCILIACAO_APLICADA'); };
await mut('M1 sem checagem de movimento → atividade medida seria substituída', s => s.replace('bool_or(cardinality(mov) > 0) AS com_mov', 'false AS com_mov'),
  async d => { const c = await cenario(d, PJ(1), 'M1', L1, 'CONCILIACAO', LEG_BATE);
    await d.query(`insert into public.sot_med_itens (medicao_id, atividade_id) values ('m', $1)`, [c.ids.ativ[0]]); return c; }, aplicou);
await mut('M2 sem checagem de unidade → UN × US3 passaria', s => s.replace(' OR j.g_un <> j.s_un', ''),
  d => cenario(d, PJ(1), 'M2', L1, 'CONCILIACAO', { ativ: [['I-100', 'UN', 2]], mat: [['555', 'M', 5], ['777', 'PC', 4]] }), aplicou);
await mut('M3 sem checagem de soma → 6 × 5 passaria', s => s.replace(' OR j.g_soma <> j.s_soma', ''),
  d => cenario(d, PJ(1), 'M3', L1, 'CONCILIACAO', { ativ: [['I-100', 'US3', 2]], mat: [['555', 'M', 6], ['777', 'PC', 4]] }), aplicou);
await mut('M4 sem autorização → administrativo aplicaria', s => s.replace("RAISE EXCEPTION 'Conciliação: %', v_motivo USING ERRCODE = '42501';", 'NULL;'),
  d => cenario(d, PJ(1), 'M4', L1, 'CONCILIACAO', LEG_BATE), (d, c) => aplicou(d, c, UID.administrativo));
await mut('M5 DELETE físico no lugar da baixa → teste de contagem detecta', s => s.replace(
  'UPDATE public.sot_atividades SET deleted_at = now()\n   WHERE projeto_id', 'DELETE FROM public.sot_atividades\n   WHERE projeto_id'),
  d => cenario(d, PJ(1), 'M5', L1, 'CONCILIACAO', LEG_BATE), async (d, c) => { await conciliar(d, c.imp);
    return (await d.query(`select count(*)::int n from public.sot_atividades where id = $1`, [c.ids.ativ[0]])).rows[0].n === 0; });

if (failed.length) {
  console.log(`proj-lms-conciliacao-sql: FALHOU ${failed.length}/${total}`);
  for (const f of failed) console.log('  - ' + f);
  process.exit(1);
}
console.log(`proj-lms-conciliacao-sql: OK (${total} verificações)`);
