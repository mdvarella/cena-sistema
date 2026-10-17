// ETAPA 1.7a — testes SQL da migration 20261015120000_proj_execucao.sql
// (execução por projeto/equipe/dia, itens por WL+atividade, lançamentos só inclusão com estorno, travas contra os caminhos
// antigos inertes com o interruptor desligado e fail-closed quando inconsistente). PGlite com a cadeia real até a 1.6a.
// Uso: PGLITE_PATH=<pasta com @electric-sql/pglite> XLSX_PATH=<.../xlsx.mjs> node tests/proj-execucao-sql.test.mjs
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
  console.log('proj-execucao-sql: SKIP (defina PGLITE_PATH e XLSX_PATH)');
  process.exit(0);
}
const P = await import(pathToFileURL(process.env.LMS_PARSER_PATH || path.join(raiz, 'supabase', 'functions', '_shared', 'lms-parser.ts')).href);

const migDir = path.join(raiz, 'supabase', 'migrations');
const semNotify = s => s.replace(/NOTIFY pgrst[^;]*;/g, '');
const ler = f => fs.readFileSync(path.join(migDir, f), 'utf8').replace(/\r\n/g, '\n');
const migProg = ler('20261004200000_prog_projetos_agenda.sql');
const iniProg = migProg.indexOf('CREATE OR REPLACE FUNCTION public.cena_prog_pode_programar_projetos()');
const fimMarca = 'GRANT EXECUTE ON FUNCTION public.cena_prog_pode_programar_projetos() TO authenticated;';
const fnProg = migProg.slice(iniProg, migProg.indexOf(fimMarca) + fimMarca.length);
const CADEIA = [semNotify(ler('20261004190000_seguranca_usuarios_sistema.sql')), fnProg,
  semNotify(ler('20261007190000_cena_permissoes_acao.sql')), semNotify(ler('20261009173000_proj_perfil_processo.sql')),
  semNotify(ler('20261009193000_proj_lms_origem.sql')), semNotify(ler('20261010120000_proj_lms_confirmacao.sql')),
  semNotify(ler('20261011120000_proj_lms_rascunhos_listar.sql')), semNotify(ler('20261001130000_sot_materiais_bloqueia_texto_binario.sql')),
  semNotify(ler('20261011200000_proj_wl_estrutura.sql')), semNotify(ler('20261012100000_proj_lms_leitura_wl.sql')),
  semNotify(ler('20261012200000_proj_lms_conciliacao.sql'))];

const migRaw = ler('20261015120000_proj_execucao.sql');
const mig = semNotify(migRaw);
const codigo = migRaw.slice(0, migRaw.indexOf('-- Validação')).replace(/--[^\n]*/g, '');
const desfazer = migRaw.slice(migRaw.indexOf('-- Para desfazer')).split('\n').slice(1)
  .map(l => l.replace(/^--\s?/, '')).join('\n').trim();

const failed = [];
let total = 0;
const ok = (n, c, d) => { total++; if (!c) failed.push(n + (d !== undefined ? ' — ' + JSON.stringify(d).slice(0, 500) : '')); };
const corpo = nome => { const i = codigo.indexOf('FUNCTION public.' + nome + '('); return codigo.slice(i, codigo.indexOf('\n$$;', i)); };

// ── Estáticos ───────────────────────────────────────────────────
const cl = codigo.trim();
ok('transação explícita: BEGIN; primeiro, COMMIT; último', cl.startsWith('BEGIN;') && cl.endsWith('COMMIT;') && !/\bROLLBACK\b/i.test(codigo));
ok('não altera a conciliação da 1.6a nem a estrutura da 1.4', !/FUNCTION public\.(fn_proj_lms_aplicar_conciliacao|fn_proj_lms_aplicar_estrutura_nova|fn_proj_protege_linha_estruturada|sot_lms_estado_wl_calc)\(/.test(codigo));
ok('não cria função de ativação (ligar é a 1.7d)', !/UPDATE public\.proj_execucao_config/i.test(codigo) && !/fn_proj_execucao_ativar/.test(codigo));
ok('nunca DELETE físico de atividade/material/execução', !/DELETE\s+FROM/i.test(codigo) && !/TRUNCATE\s+(TABLE\s+)?public\./i.test(codigo));
ok('não toca composicao_dia (só leitura)', !/(UPDATE|INSERT INTO|ALTER TABLE)\s+public\.composicao_dia/i.test(codigo) && !/ON public\.composicao_dia/i.test(codigo));
ok('qtd_executada só é gravada pela soma oficial', (codigo.match(/SET qtd_executada/g) || []).length === 1 && /SET qtd_executada = v_soma/.test(corpo('fn_proj_execucao_recalcular')));
ok('medição não entra na soma (D1)', !/qtd_medida|sot_med_itens/.test(codigo));
ok('fuso de "hoje" = America/Sao_Paulo (A7)', /now\(\) AT TIME ZONE 'America\/Sao_Paulo'/.test(corpo('fn_proj_execucao_lancar')));
ok('trava antiga é SECURITY INVOKER e age só para anon/authenticated', /SECURITY INVOKER/.test(corpo('fn_proj_execucao_protege_executado'))
  && /current_user NOT IN \('anon', 'authenticated'\)/.test(corpo('fn_proj_execucao_protege_executado')));
ok('trava olha a atividade antes do interruptor (legado nunca é afetado)', corpo('fn_proj_execucao_trava_atividade').indexOf('v_wl IS NULL')
  < corpo('fn_proj_execucao_trava_atividade').indexOf('fn_proj_execucao_estado()'));

// ── Banco ───────────────────────────────────────────────────────
const U = n => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PERFIS = ['admin', 'gestor', 'coordenador', 'supervisor', 'encarregado', 'escritorio', 'administrativo', 'equipe'];
const UID = Object.fromEntries(PERFIS.map((p, i) => [p, U(i + 1)]));
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
  ${PERFIS.map(p => `('Usuário ${p}', '${p}@cena', '${p}', '${UID[p]}')`).join(',\n  ')};
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
  observacao text, criado_em timestamptz default now(), deleted_at timestamptz, somente_descritivo boolean not null default false);
create table public.servicos_contrato (id uuid primary key default gen_random_uuid(), contrato_id text, codigo text, descricao text, deleted_at timestamptz);
create table public.composicao_dia (id uuid primary key default gen_random_uuid(), equipe_id text, data date, projeto_ids text,
  colaborador_ids jsonb, confirmada boolean default false, deleted_at timestamptz, unique (equipe_id, data));
create table public.prog_projetos_agenda (id uuid primary key default gen_random_uuid(), projeto_id uuid, contrato_id text, data date,
  status text, equipe_id text, deleted_at timestamptz);
create table public.sot_medicoes (id uuid primary key default gen_random_uuid(), projeto_id uuid, numero int, status text);
create table public.sot_med_itens (id uuid primary key default gen_random_uuid(), medicao_id text, projeto_id text, atividade_id text, codigo text, qtd_medida numeric);
create table public.plpt_requisicoes_materiais (id uuid primary key default gen_random_uuid(), projeto_id uuid, status text, itens jsonb, deleted_at timestamptz);
create table public.sot_adicionais (id uuid primary key default gen_random_uuid(), projeto_id uuid, tipo text, catalog_id uuid, descricao text, deleted_at timestamptz);
create table public.sot_atividades_historico (id uuid primary key default gen_random_uuid(), atividade_id uuid, projeto_id uuid,
  qtd_lancada numeric, status_novo text, data_execucao date, usuario text);
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
// chamada à API como um perfil; devolve {r} ou {e}
const api = (db, sql, params, uid = UID.gestor, role = 'authenticated') => como(db, role, uid, async () => {
  try { return { r: (await db.query(sql, params)).rows[0].v }; } catch (e) { return { e: e.message }; }
});
// escrita "pela tela" (PostgREST): UPDATE/INSERT direto como anon/authenticated
const tela = (db, sql, uid = UID.gestor, role = 'authenticated') => como(db, role, uid, async () => {
  try { await db.query(sql); return null; } catch (e) { return e.message; }
});

const payloadDe = (bytes, nome) => P.payloadRegistro(P.parseLms(bytes, XLSX), { hash_sha256: createHash('sha256').update(bytes).digest('hex'),
  nome, tamanho: bytes.length, mime_informado: P.XLSX_MIME, mime_validado: P.XLSX_MIME });
const esp = JSON.parse(fs.readFileSync(path.join(raiz, 'tests', 'fixtures', 'lms', 'modelo-lms-esperado.json'), 'utf8'));
const lmsSint = (linhas, ident) => {
  const aoa = [['Definição de projeto:', null, null, ident], [], esp.colunas,
    ...linhas.map(l => [l[0], l[1], l[2], l[3], l[4], l[5], l[6], l[7], null, null, null, null, null, null])];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Planilha1');
  return payloadDe(new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' })), ident + '.xlsx');
};
// WL 1: serviços I-100 e I-200 + material; WL 2: serviço I-100
const L = ident => lmsSint([
  ['1', 'WP', 'I', 'I-100', 'S-100', 'US3', 'SERVIÇO A', 4],
  ['1', 'WP', 'I', 'I-200', 'S-200', 'US3', 'SERVIÇO B', 2],
  ['2', 'WP', 'I', 'I-100', 'S-100', 'US3', 'SERVIÇO A', 3],
  ['1', 'WP', 'I', '555', 'K-1', 'M', 'CABO', 3]], ident);

const registrar = (db, proj, pl) => como(db, 'service_role', null, async () =>
  (await db.query(`select public.sot_lms_importacao_registrar($1::uuid, $2::uuid, $3::jsonb, $4::jsonb) v`,
    [UID.gestor, proj, JSON.stringify(pl.p_importacao), JSON.stringify(pl.p_linhas)])).rows[0].v.importacao_id);
const confirmar = (db, imp, modo) => como(db, 'authenticated', UID.gestor, async () =>
  (await db.query(`select public.sot_lms_confirmar($1::uuid, $2, null) v`, [imp, modo])).rows[0].v);
const estruturaNova = (db, imp) => como(db, 'authenticated', UID.gestor, async () =>
  (await db.query(`select public.fn_proj_lms_aplicar_estrutura_nova($1::uuid) v`, [imp])).rows[0].v);
const projeto = (db, id, nome) => db.query(`insert into public.sot_projetos (id, contrato_id, nome) values ($1, $2, $3)`, [id, C_ATIVO, nome]);
async function estruturado(db, id, nome) {
  await projeto(db, id, nome);
  const imp = await registrar(db, id, L(nome.replace(/\W/g, '')));
  await confirmar(db, imp, 'ESTRUTURA_NOVA');
  await estruturaNova(db, imp);
  return id;
}
const ativ = async (db, proj, cod, wlCod) => (await db.query(`select a.id, a.wl_id from public.sot_atividades a
  left join public.sot_wl w on w.id = a.wl_id where a.projeto_id = $1 and a.codigo = $2 and a.deleted_at is null
  and (($3::text is null and a.wl_id is null) or w.codigo = $3)`, [proj, cod, wlCod])).rows[0];
const wlDe = async (db, proj, cod) => (await db.query(`select id from public.sot_wl where projeto_id = $1 and codigo = $2`, [proj, cod])).rows[0].id;
const hoje = async db => (await db.query(`select to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD') d`)).rows[0].d;
const diaMais = async (db, n) => (await db.query(`select to_char((now() at time zone 'America/Sao_Paulo')::date + $1::int, 'YYYY-MM-DD') d`, [n])).rows[0].d;
const comp = async (db, equipe, data, projs, confirmada = true) => (await db.query(`insert into public.composicao_dia (equipe_id, data, projeto_ids, confirmada)
  values ($1, $2, $3, $4) returning id`, [equipe, data, JSON.stringify(projs), confirmada])).rows[0].id;
const executado = async (db, id) => Number((await db.query(`select qtd_executada q from public.sot_atividades where id = $1`, [id])).rows[0].q);
const ligar = (db, versao = '8.1.230') => db.exec(`update public.proj_execucao_config set ativo = true, versao_minima = '${versao}', motivo = 'teste'`);
const desligar = db => db.exec(`update public.proj_execucao_config set ativo = false, motivo = 'teste'`);

const criar = (db, c, p, uid, agenda = null) => api(db, `select public.fn_proj_execucao_criar($1::uuid, $2::uuid, $3::uuid, 'orientação') v`, [c, p, agenda], uid);
const itens = (db, e, lista, uid) => api(db, `select public.fn_proj_execucao_definir_itens($1::uuid, $2::jsonb) v`, [e, JSON.stringify(lista)], uid);
const lancar = (db, item, q, uid = UID.encarregado, o = {}) => api(db, `select public.fn_proj_execucao_lancar($1::uuid, $2::numeric, $3, $4, $5) v`,
  [item, q, o.origem || 'DIARIO', o.just || null, o.versao === undefined ? '8.1.230' : o.versao], uid);
const estornar = (db, l, uid = UID.gestor, motivo = 'erro de digitação') => api(db, `select public.fn_proj_execucao_estornar($1::uuid, $2, 'SOT', '8.1.230') v`, [l, motivo], uid);
const situacao = (db, p, uid = UID.gestor) => api(db, `select public.fn_proj_execucao_situacao($1::uuid) v`, [p], uid);
const saldo = (db, p, uid = UID.gestor) => api(db, `select public.fn_proj_saldo_atividades($1::uuid) v`, [p], uid);

// ── Aplicação ───────────────────────────────────────────────────
const db = await novoBanco(false);
let erro = await tentaExec(db, mig);
ok('aplica sobre a cadeia real (até a 1.6a)', erro === null, erro);
erro = await tentaExec(db, mig);
ok('reaplica sem erro (idempotente)', erro === null, erro);
const semAgenda = await (async () => { const d = new PGlite(); await d.exec(BASE.replace(/create table public\.prog_projetos_agenda[^;]*;/, ''));
  for (const m of CADEIA) await d.exec(m); return tentaExec(d, mig); })();
ok('pré-condição: sem a agenda a migration não aplica', /prog_projetos_agenda não existe/.test(semAgenda || ''), semAgenda);

const cfg = (await db.query(`select ativo, versao_minima from public.proj_execucao_config`)).rows;
ok('interruptor criado DESLIGADO, uma linha', cfg.length === 1 && cfg[0].ativo === false && cfg[0].versao_minima === null, cfg);
const perms = (await db.query(`select acao, string_agg(perfil, ',' order by perfil) p from public.cena_permissoes_acao
  where acao in ('PROJ_LANCAR_EXECUCAO', 'PROJ_ESTORNAR_EXECUCAO') and contrato_id is null and deleted_at is null and permitido group by acao`)).rows;
const pm = Object.fromEntries(perms.map(r => [r.acao, r.p]));
ok('A2: lançar = admin, coordenador, encarregado, gestor, supervisor', pm.PROJ_LANCAR_EXECUCAO === 'admin,coordenador,encarregado,gestor,supervisor', pm);
ok('A2: estornar = admin, coordenador, gestor', pm.PROJ_ESTORNAR_EXECUCAO === 'admin,coordenador,gestor', pm);

const fpriv = async (role, fn) => (await db.query(`select has_function_privilege($1, $2, 'EXECUTE') v`, [role, fn])).rows[0].v;
const PUBLICAS = ['fn_proj_execucao_criar(uuid,uuid,uuid,text)', 'fn_proj_execucao_definir_itens(uuid,jsonb)', 'fn_proj_execucao_cancelar_item(uuid,text)',
  'fn_proj_execucao_cancelar(uuid,text)', 'fn_proj_execucao_lancar(uuid,numeric,text,text,text)', 'fn_proj_execucao_estornar(uuid,text,text,text)',
  'fn_proj_saldo_atividades(uuid)', 'fn_proj_execucao_situacao(uuid,text,date)'];
for (const fn of PUBLICAS) ok(`${fn}: só authenticated`, await fpriv('authenticated', 'public.' + fn) && !(await fpriv('anon', 'public.' + fn)) && !(await fpriv('service_role', 'public.' + fn)));
const INTERNAS = ['fn_proj_execucao_versao_ok(text,text)', 'fn_proj_execucao_estado()', 'fn_proj_execucao_contrato(uuid)', 'fn_proj_execucao_projeto_na_composicao(text,uuid)',
  'fn_proj_execucao_atividade_estruturada(uuid)', 'fn_proj_execucao_recalcular(uuid)', 'fn_proj_execucao_liquido(uuid,uuid)', 'fn_proj_execucao_consistencia()',
  'fn_proj_execucao_pode_ler(uuid)'];
for (const fn of INTERNAS) ok(`${fn}: interna`, !(await fpriv('authenticated', 'public.' + fn)) && !(await fpriv('anon', 'public.' + fn)) && !(await fpriv('service_role', 'public.' + fn)));
ok('interruptor e trava: anon + authenticated (telas legadas)', await fpriv('anon', 'public.fn_proj_execucao_interruptor()') && await fpriv('authenticated', 'public.fn_proj_execucao_interruptor()')
  && await fpriv('anon', 'public.fn_proj_execucao_trava_atividade(uuid)') && await fpriv('authenticated', 'public.fn_proj_execucao_trava_atividade(uuid)')
  && !(await fpriv('service_role', 'public.fn_proj_execucao_interruptor()')));
const TABELAS = ['prog_proj_execucoes', 'prog_proj_execucao_itens', 'prog_proj_execucao_lancamentos', 'proj_execucao_config', 'proj_execucao_config_eventos'];
for (const t of TABELAS) {
  const p = (await db.query(`select has_table_privilege('authenticated', $1, 'SELECT') a, has_table_privilege('anon', $1, 'SELECT') b,
    has_table_privilege('service_role', $1, 'INSERT') c, relforcerowsecurity f from pg_class where oid = $1::regclass`, ['public.' + t])).rows[0];
  ok(`${t}: sem acesso direto e RLS FORCE`, !p.a && !p.b && !p.c && p.f, p);
}
let r = await api(db, `select public.fn_proj_execucao_interruptor() v`, [], null, 'anon');
ok('interruptor legível por sessão legada (anon): INATIVO', r.r && r.r.estado === 'INATIVO', r);

// ── Cenário ─────────────────────────────────────────────────────
const PE = await estruturado(db, PJ(1), 'Estruturado A');
const PE2 = await estruturado(db, PJ(2), 'Estruturado B');
await projeto(db, PJ(3), 'Legado');
await db.query(`insert into public.sot_atividades (projeto_id, codigo, descricao, unidade, qtd_prevista) values ($1, 'L-1', 'LEGADO', 'UN', 5)`, [PJ(3)]);
await projeto(db, PJ(4), 'Em conciliação');
await db.query(`insert into public.sot_atividades (projeto_id, codigo, descricao, unidade, qtd_prevista) values ($1, 'I-100', 'ANTIGO', 'US3', 7)`, [PJ(4)]);
await confirmar(db, await registrar(db, PJ(4), L('CONC')), 'CONCILIACAO');
// atividade SEM WL dentro do projeto estruturado (caso TESTE 1): criada pelo dono, fora das telas
await db.query(`insert into public.sot_atividades (projeto_id, codigo, descricao, unidade, qtd_prevista) values ($1, 'X-1', 'SEM WL', 'UN', 2)`, [PE]);
const A1 = await ativ(db, PE, 'I-100', '1'), A2 = await ativ(db, PE, 'I-200', '1'), A3 = await ativ(db, PE, 'I-100', '2');
const AX = await ativ(db, PE, 'X-1', null), AL = await ativ(db, PJ(3), 'L-1', null), AC = await ativ(db, PJ(4), 'I-100', null);
const W1 = await wlDe(db, PE, '1'), W2 = await wlDe(db, PE, '2'), W1b = await wlDe(db, PE2, '1');
ok('cenário: projeto estruturado com 2 WLs e 3 atividades por WL', A1 && A2 && A3 && A1.wl_id === W1 && A3.wl_id === W2 && AX && !AX.wl_id, { A1, A2, A3, AX });
const H = await hoje(db), AMANHA = await diaMais(db, 1), M3 = await diaMais(db, -3), M8 = await diaMais(db, -8);
const C_HOJE = await comp(db, 'EQ1', H, [PE, PJ(3)]);
const C_EQ2 = await comp(db, 'EQ2', M3, [PE]);
const C_RASC = await comp(db, 'EQ3', H, [PE], false);
const C_FUT = await comp(db, 'EQ1', AMANHA, [PE]);
const C_VELHA = await comp(db, 'EQ1', M8, [PE]);
const C_OUTRO = await comp(db, 'EQ4', H, [PJ(3)]);

// ── Criar execução ──────────────────────────────────────────────
r = await criar(db, C_HOJE, PE, UID.supervisor);
ok('criar: supervisor programa (cena_prog_pode_programar_projetos)', r.r && r.r.operacao === 'CRIADA', r);
const E1 = r.r && r.r.execucao_id;
r = await criar(db, C_HOJE, PE, UID.gestor);
ok('criar de novo devolve a mesma execução (idempotente)', r.r && r.r.operacao === 'EXISTENTE' && r.r.execucao_id === E1, r);
ok('criar: encarregado não programa', /SEM_PERMISSAO/.test((await criar(db, C_EQ2, PE, UID.encarregado)).e || ''));
ok('criar: sem sessão recusa', /SEM_SESSAO/.test((await criar(db, C_EQ2, PE, null)).e || ''));
ok('criar: anon não executa', /permission denied/.test((await api(db, `select public.fn_proj_execucao_criar($1::uuid, $2::uuid) v`, [C_EQ2, PE], null, 'anon')).e || ''));
ok('criar: projeto legado recusado', /PROJETO_NAO_ESTRUTURADO.*LEGADO_SEM_WL/.test((await criar(db, C_HOJE, PJ(3))).e || ''));
await db.query(`update public.composicao_dia set projeto_ids = $2 where id = $1`, [C_EQ2, JSON.stringify([PE, PJ(4)])]);
ok('criar: projeto em conciliação recusado', /PROJETO_NAO_ESTRUTURADO.*EM_CONCILIACAO/.test((await criar(db, C_EQ2, PJ(4))).e || ''));
ok('criar: projeto fora da composição recusado', /PROJETO_FORA_DA_COMPOSICAO/.test((await criar(db, C_OUTRO, PE)).e || ''));
await db.query(`update public.composicao_dia set deleted_at = now() where id = $1`, [C_OUTRO]);
ok('criar: composição excluída recusada', /COMPOSICAO_INEXISTENTE/.test((await criar(db, C_OUTRO, PJ(3))).e || ''));
const AG_OUTRA = (await db.query(`insert into public.prog_projetos_agenda (projeto_id, data, status) values ($1, $2, 'ALOCADO') returning id`, [PE, M3])).rows[0].id;
ok('criar: agenda de outra data recusada', /AGENDA_INVALIDA/.test((await criar(db, C_FUT, PE, UID.gestor, AG_OUTRA)).e || ''));
r = await criar(db, C_EQ2, PE, UID.gestor, AG_OUTRA);
ok('criar: agenda do mesmo projeto e data aceita', r.r && r.r.operacao === 'CRIADA', r);
const E2 = r.r && r.r.execucao_id;
const E_RASC = (await criar(db, C_RASC, PE)).r.execucao_id;
const E_FUT = (await criar(db, C_FUT, PE)).r.execucao_id;
const E_VELHA = (await criar(db, C_VELHA, PE)).r.execucao_id;
const ex1 = (await db.query(`select equipe_id, to_char(data, 'YYYY-MM-DD') data, contrato_id, criado_por_auth from public.prog_proj_execucoes where id = $1`, [E1])).rows[0];
ok('execução copia equipe, data e contrato; registra quem criou', ex1.equipe_id === 'EQ1' && ex1.data === H && ex1.contrato_id === C_ATIVO && ex1.criado_por_auth === UID.supervisor, ex1);

// ── Itens ───────────────────────────────────────────────────────
r = await itens(db, E1, [{ wl_id: W1 }, { wl_id: W2, atividade_id: A3.id, qtd_programada: 2 }]);
ok('itens: WL inteira expande por atividade + atividade de outra WL (várias WLs no mesmo dia)', r.r && r.r.incluidos === 3, r);
r = await itens(db, E1, [{ wl_id: W1 }]);
ok('itens: repetir não duplica', r.r && r.r.incluidos === 0 && r.r.ja_existentes === 2, r);
ok('itens: atividade de outra WL recusada', /ATIVIDADE_INVALIDA/.test((await itens(db, E1, [{ wl_id: W1, atividade_id: A3.id }])).e || ''));
ok('itens: atividade sem WL recusada', /ATIVIDADE_INVALIDA/.test((await itens(db, E1, [{ wl_id: W1, atividade_id: AX.id }])).e || ''));
ok('itens: WL de outro projeto recusada', /WL_INVALIDA/.test((await itens(db, E1, [{ wl_id: W1b }])).e || ''));
ok('itens: meta negativa recusada', /QTD_INVALIDA/.test((await itens(db, E1, [{ wl_id: W1, atividade_id: A1.id, qtd_programada: -1 }])).e || ''));
ok('itens: meta para WL inteira recusada', /QTD_WL_INTEIRA/.test((await itens(db, E1, [{ wl_id: W1, qtd_programada: 1 }])).e || ''));
ok('itens: lista vazia recusada', /ITENS_VAZIOS/.test((await itens(db, E1, [])).e || ''));
ok('itens: lote com um item ruim não grava nada (atômico)', /ATIVIDADE_INVALIDA/.test((await itens(db, E2, [{ wl_id: W2 }, { wl_id: W1, atividade_id: A3.id }])).e || '')
  && (await db.query(`select count(*)::int n from public.prog_proj_execucao_itens where execucao_id = $1`, [E2])).rows[0].n === 0);
r = await itens(db, E2, [{ wl_id: W1, atividade_id: A1.id, qtd_programada: 1 }]);
ok('itens: mesma WL em outra equipe/dia (várias equipes por WL)', r.r && r.r.incluidos === 1, r);
await itens(db, E_RASC, [{ wl_id: W1, atividade_id: A1.id }]);
await itens(db, E_FUT, [{ wl_id: W1, atividade_id: A1.id }]);
await itens(db, E_VELHA, [{ wl_id: W1, atividade_id: A1.id }]);
const item = async (e, a) => (await db.query(`select id from public.prog_proj_execucao_itens where execucao_id = $1 and atividade_id = $2 and cancelado_em is null`, [e, a])).rows[0].id;
const I1 = await item(E1, A1.id), I2 = await item(E1, A2.id), I3 = await item(E1, A3.id), I_E2 = await item(E2, A1.id);
const I_RASC = await item(E_RASC, A1.id), I_FUT = await item(E_FUT, A1.id), I_VELHA = await item(E_VELHA, A1.id);

// ── Interruptor DESLIGADO: nada muda para as telas; lançamento recusado ──
ok('desligado: lançar recusado (EXECUCAO_DESLIGADA)', /EXECUCAO_DESLIGADA/.test((await lancar(db, I1, 1)).e || ''));
ok('desligado: tela altera executado de atividade estruturada como hoje', await tela(db, `update public.sot_atividades set qtd_executada = 9 where id = '${A1.id}'`) === null
  && await executado(db, A1.id) === 9);
ok('desligado: sessão legada (anon) também', await tela(db, `update public.sot_atividades set qtd_executada = 0 where id = '${A1.id}'`, null, 'anon') === null);
ok('desligado: histórico de atividade estruturada aceito como hoje', await tela(db, `insert into public.sot_atividades_historico (atividade_id, qtd_lancada) values ('${A1.id}', 1)`) === null);

// ── Ligado ──────────────────────────────────────────────────────
await db.exec(`delete from public.sot_atividades_historico`);
await ligar(db);
r = await api(db, `select public.fn_proj_execucao_interruptor() v`, [], null, 'anon');
ok('ligado: interruptor ATIVO com versão mínima', r.r && r.r.estado === 'ATIVO' && r.r.versao_minima === '8.1.230', r);
ok('ligar gera evento do interruptor', (await db.query(`select count(*)::int n from public.proj_execucao_config_eventos where ativo_novo`)).rows[0].n === 1);

r = await lancar(db, I1, 3);
ok('lançar: encarregado lança 3 (DIARIO)', r.r && r.r.operacao === 'LANCADO' && Number(r.r.qtd_executada) === 3 && r.r.excedente === false && r.r.retroativo === false, r);
const L1 = r.r && r.r.lancamento_id;
ok('lançar: executado da atividade = soma dos lançamentos', await executado(db, A1.id) === 3);
r = await lancar(db, I_E2, 2, UID.supervisor, { origem: 'SOT' });
ok('lançar: outra equipe 3 dias atrás soma no mesmo saldo (5)', r.r && Number(r.r.qtd_executada) === 5 && r.r.excedente === true, r);
const L2 = r.r && r.r.lancamento_id;
const lr = (await db.query(`select tipo, equipe_id, to_char(data_execucao, 'YYYY-MM-DD') d, por_auth, por_nome, origem, wl_id, atividade_id, versao_cliente
  from public.prog_proj_execucao_lancamentos where id = $1`, [L1])).rows[0];
ok('lançamento identifica atividade, WL, equipe, data, usuário, nome, origem e versão', lr.tipo === 'LANCAMENTO' && lr.equipe_id === 'EQ1' && lr.d === H
  && lr.por_auth === UID.encarregado && lr.por_nome === 'Usuário encarregado' && lr.origem === 'DIARIO' && lr.wl_id === W1 && lr.atividade_id === A1.id
  && lr.versao_cliente === '8.1.230', lr);
ok('lançar: escritório sem PROJ_LANCAR_EXECUCAO recusado', /SEM_PERMISSAO/.test((await lancar(db, I1, 1, UID.escritorio)).e || ''));
ok('lançar: sem sessão recusa', /SEM_SESSAO/.test((await lancar(db, I1, 1, null)).e || ''));
ok('lançar: anon não executa (função)', /permission denied/.test((await api(db, `select public.fn_proj_execucao_lancar($1::uuid, 1, 'DIARIO', null, '8.1.230') v`, [I1], null, 'anon')).e || ''));
ok('lançar: versão abaixo da mínima recusada', /VERSAO_DESATUALIZADA/.test((await lancar(db, I1, 1, UID.encarregado, { versao: '8.1.229' })).e || ''));
ok('lançar: sem versão recusada', /VERSAO_DESATUALIZADA/.test((await lancar(db, I1, 1, UID.encarregado, { versao: null })).e || ''));
ok('lançar: versão maior aceita (8.1.1000 > 8.1.230)', (await lancar(db, I2, 0.5, UID.encarregado, { versao: '8.1.1000' })).r);
ok('lançar: quantidade zero/negativa recusada', /QTD_INVALIDA/.test((await lancar(db, I1, 0)).e || '') && /QTD_INVALIDA/.test((await lancar(db, I1, -1)).e || ''));
ok('lançar: mais de 3 casas recusado', /QTD_INVALIDA/.test((await lancar(db, I1, 1.0001)).e || ''));
ok('lançar: origem inválida recusada', /ORIGEM_INVALIDA/.test((await lancar(db, I1, 1, UID.encarregado, { origem: 'SALDO_INICIAL' })).e || ''));
ok('lançar: equipe não confirmada recusada', /COMPOSICAO_NAO_CONFIRMADA/.test((await lancar(db, I_RASC, 1)).e || ''));
ok('lançar: dia futuro recusado', /DATA_FUTURA/.test((await lancar(db, I_FUT, 1)).e || ''));
ok('lançar: 8 dias atrás sem gestão recusado', /RETROATIVO_EXIGE_GESTAO/.test((await lancar(db, I_VELHA, 1)).e || ''));
ok('lançar: 8 dias atrás com gestão sem justificativa recusado', /JUSTIFICATIVA_OBRIGATORIA/.test((await lancar(db, I_VELHA, 1, UID.gestor)).e || ''));
r = await lancar(db, I_VELHA, 1, UID.gestor, { just: 'esquecido no fechamento' });
ok('lançar: 8 dias atrás com gestão e justificativa aceito', r.r && r.r.retroativo === true
  && (await db.query(`select justificativa_retroativo j from public.prog_proj_execucao_lancamentos where id = $1`, [r.r.lancamento_id])).rows[0].j === 'esquecido no fechamento', r);
const L_VELHA = r.r && r.r.lancamento_id;
await db.query(`update public.composicao_dia set projeto_ids = '[]' where id = $1`, [C_EQ2]);
ok('lançar: projeto retirado da equipe/dia recusado', /PROJETO_FORA_DA_COMPOSICAO/.test((await lancar(db, I_E2, 1)).e || ''));
await db.query(`update public.composicao_dia set projeto_ids = $2 where id = $1`, [C_EQ2, JSON.stringify([PE])]);

// ── Travas dos caminhos antigos (ligado) ────────────────────────
let e = await tela(db, `update public.sot_atividades set qtd_executada = 99 where id = '${A1.id}'`);
ok('ligado: tela não altera executado de atividade estruturada', /EXECUTADO_SO_POR_LANCAMENTO/.test(e || '') && await executado(db, A1.id) === 6, e);
e = await tela(db, `update public.sot_atividades set qtd_executada = 99 where id = '${A1.id}'`, null, 'anon');
ok('ligado: sessão legada (anon) também não altera', /EXECUTADO_SO_POR_LANCAMENTO/.test(e || ''), e);
ok('ligado: regravar o mesmo valor passa (diário regrava viabilizada + executada)', await tela(db, `update public.sot_atividades set qtd_executada = 6, qtd_viabilizada = 4 where id = '${A1.id}'`) === null);
ok('ligado: viabilizada e status continuam livres', await tela(db, `update public.sot_atividades set qtd_viabilizada = 5, status = 'em_execucao' where id = '${A1.id}'`) === null);
ok('ligado: atividade sem WL no projeto estruturado segue livre', await tela(db, `update public.sot_atividades set qtd_executada = 1 where id = '${AX.id}'`) === null);
ok('ligado: projeto legado segue livre', await tela(db, `update public.sot_atividades set qtd_executada = 2 where id = '${AL.id}'`, null, 'anon') === null);
ok('ligado: projeto em conciliação segue livre', await tela(db, `update public.sot_atividades set qtd_executada = 3 where id = '${AC.id}'`) === null);
e = await tela(db, `insert into public.sot_atividades_historico (atividade_id, qtd_lancada) values ('${A1.id}', 1)`);
ok('ligado: histórico de atividade estruturada recusado', /EXECUTADO_SO_POR_LANCAMENTO/.test(e || ''), e);
ok('ligado: histórico de legado/sem WL aceito', await tela(db, `insert into public.sot_atividades_historico (atividade_id, qtd_lancada) values ('${AL.id}', 1)`, null, 'anon') === null
  && await tela(db, `insert into public.sot_atividades_historico (atividade_id, qtd_lancada) values ('${AX.id}', 1)`) === null);
ok('ligado: dono (SQL Editor) não é travado', await tentaExec(db, `update public.sot_atividades set qtd_executada = 6 where id = '${A1.id}'`) === null);

// ── Estorno ─────────────────────────────────────────────────────
ok('estornar: encarregado sem PROJ_ESTORNAR_EXECUCAO recusado', /SEM_PERMISSAO/.test((await estornar(db, L1, UID.encarregado)).e || ''));
ok('estornar: sem motivo recusado', /MOTIVO_OBRIGATORIO/.test((await estornar(db, L1, UID.gestor, '  ')).e || ''));
r = await estornar(db, L1);
ok('estornar: gestor estorna o lançamento inteiro (6 − 3 = 3)', r.r && r.r.operacao === 'ESTORNADO' && Number(r.r.qtd_executada) === 3 && await executado(db, A1.id) === 3, r);
const EST = r.r && r.r.estorno_id;
ok('estornar duas vezes recusado', /JA_ESTORNADO/.test((await estornar(db, L1)).e || ''));
ok('estorno de estorno recusado', /ESTORNO_DE_ESTORNO/.test((await estornar(db, EST)).e || ''));
const er = (await db.query(`select tipo, qtd, estorna_id, motivo, equipe_id, por_auth from public.prog_proj_execucao_lancamentos where id = $1`, [EST])).rows[0];
ok('estorno registra original, motivo, equipe e quem estornou', er.tipo === 'ESTORNO' && Number(er.qtd) === 3 && er.estorna_id === L1 && er.motivo === 'erro de digitação'
  && er.equipe_id === 'EQ1' && er.por_auth === UID.gestor, er);

// ── Cancelamentos (D5: nada apaga histórico) ────────────────────
ok('cancelar item com lançamento líquido recusado', /ITEM_COM_LANCAMENTO/.test((await api(db, `select public.fn_proj_execucao_cancelar_item($1::uuid, 'mudou') v`, [I_E2])).e || ''));
ok('cancelar execução com lançamento líquido recusado', /EXECUCAO_COM_LANCAMENTO/.test((await api(db, `select public.fn_proj_execucao_cancelar($1::uuid, 'mudou') v`, [E2])).e || ''));
ok('cancelar item sem motivo recusado', /MOTIVO_OBRIGATORIO/.test((await api(db, `select public.fn_proj_execucao_cancelar_item($1::uuid, '') v`, [I3])).e || ''));
r = await api(db, `select public.fn_proj_execucao_cancelar_item($1::uuid, 'não vai dar tempo') v`, [I1]);
ok('cancelar item com lançamento estornado (líquido zero) aceito', r.r && r.r.operacao === 'ITEM_CANCELADO', r);
ok('lançamentos do item cancelado continuam lá', (await db.query(`select count(*)::int n from public.prog_proj_execucao_lancamentos where item_id = $1`, [I1])).rows[0].n === 2);
r = await api(db, `select public.fn_proj_execucao_cancelar($1::uuid, 'chuva') v`, [E_RASC]);
ok('cancelar execução sem lançamento aceito (cancela os itens)', r.r && r.r.itens_cancelados === 1, r);
ok('lançar em item de execução cancelada recusado', /ITEM_INVALIDO/.test((await lancar(db, I_RASC, 1)).e || ''));
r = await criar(db, C_RASC, PE);
ok('depois de cancelar, a mesma equipe/dia pode ser programada de novo', r.r && r.r.operacao === 'CRIADA' && r.r.execucao_id !== E_RASC, r);

// ── Integridade (vale até para o dono) ──────────────────────────
ok('lançamento não é alterado', /não é alterado/.test(await tentaExec(db, `update public.prog_proj_execucao_lancamentos set qtd = 1 where id = '${L2}'`) || ''));
ok('lançamento não é apagado', /exclusão não permitida/.test(await tentaExec(db, `delete from public.prog_proj_execucao_lancamentos where id = '${L2}'`) || ''));
ok('execução não é apagada', /exclusão não permitida/.test(await tentaExec(db, `delete from public.prog_proj_execucoes where id = '${E1}'`) || ''));
ok('item não é apagado; TRUNCATE recusado', /exclusão não permitida/.test(await tentaExec(db, `delete from public.prog_proj_execucao_itens where id = '${I2}'`) || '')
  && /exclusão não permitida/.test(await tentaExec(db, `truncate public.prog_proj_execucao_lancamentos cascade`) || ''));
ok('execução: só o cancelamento muda', /só o cancelamento/.test(await tentaExec(db, `update public.prog_proj_execucoes set data = data + 1 where id = '${E1}'`) || ''));
ok('item cancelado não muda', /item cancelado não muda/.test(await tentaExec(db, `update public.prog_proj_execucao_itens set motivo_cancelamento = 'x' where id = '${I1}'`) || ''));
ok('interruptor não é apagado', /não permitido/.test(await tentaExec(db, `delete from public.proj_execucao_config`) || ''));

// ── Leitura ─────────────────────────────────────────────────────
r = await saldo(db, PE, UID.encarregado);
const sA1 = r.r && r.r.atividades.find(a => a.atividade_id === A1.id);
ok('saldo: encarregado (pode lançar) lê; I-100/WL1 previsto 4, executado 3, saldo 1', sA1 && Number(sA1.qtd_prevista) === 4 && Number(sA1.qtd_executada) === 3
  && Number(sA1.saldo) === 1 && sA1.excedente === false && sA1.campo_diverge === false && sA1.wl_codigo === '1', r);
ok('saldo: atividade sem WL fica fora', r.r && !r.r.atividades.some(a => a.atividade_id === AX.id));
ok('saldo: equipe (sem permissão) não lê', /SEM_PERMISSAO/.test((await saldo(db, PE, UID.equipe)).e || ''));
r = await situacao(db, PE);
const sit = r.r ? Object.fromEntries(r.r.map(x => [x.execucao_id, x.situacao])) : {};
ok('situação: EM_EXECUCAO, CONCLUIDA (meta atingida), PROGRAMADA e CANCELADA', sit[E1] === 'EM_EXECUCAO' && sit[E2] === 'CONCLUIDA'
  && sit[E_FUT] === 'PROGRAMADA' && sit[E_RASC] === 'CANCELADA', sit);
r = await api(db, `select public.fn_proj_execucao_situacao(null, 'EQ1', $1::date) v`, [H]);
ok('situação por equipe + data', r.r && r.r.length === 1 && r.r[0].execucao_id === E1 && r.r[0].itens.length === 3, r);
ok('situação sem filtro recusada', /PARAMETRO_OBRIGATORIO/.test((await api(db, `select public.fn_proj_execucao_situacao() v`, [])).e || ''));

// ── Consistência e fail-closed ──────────────────────────────────
r = await como(db, 'postgres', null, async () => (await db.query(`select public.fn_proj_execucao_consistencia() v`)).rows[0].v);
ok('consistência: tudo bate', Array.isArray(r) && r.length === 0, r);
await tentaExec(db, `update public.sot_atividades set qtd_executada = 50 where id = '${A2.id}'`);
r = (await db.query(`select public.fn_proj_execucao_consistencia() v`)).rows[0].v;
ok('consistência acusa executado diferente da soma', r.length === 1 && r[0].atividade_id === A2.id && Number(r[0].soma_lancamentos) === 0.5, r);
await tentaExec(db, `update public.sot_atividades set qtd_executada = 0.5 where id = '${A2.id}'`);

await db.exec(`update public.proj_execucao_config set versao_minima = null`);
r = await api(db, `select public.fn_proj_execucao_interruptor() v`, [], null, 'anon');
ok('ligado sem versão mínima = INCONSISTENTE', r.r && r.r.estado === 'INCONSISTENTE', r);
ok('INCONSISTENTE: lançar recusado', /EXECUCAO_DESLIGADA/.test((await lancar(db, I2, 1)).e || ''));
ok('INCONSISTENTE: tela continua travada para estruturada', /EXECUTADO_SO_POR_LANCAMENTO/.test(await tela(db, `update public.sot_atividades set qtd_executada = 1 where id = '${A2.id}'`) || ''));
await db.exec(`alter table public.proj_execucao_config disable trigger user; delete from public.proj_execucao_config;`);
r = await api(db, `select public.fn_proj_execucao_interruptor() v`, [], null, 'anon');
ok('interruptor ausente = INCONSISTENTE', r.r && r.r.estado === 'INCONSISTENTE', r);
ok('ausente: estruturada travada, lançar recusado', /EXECUTADO_SO_POR_LANCAMENTO/.test(await tela(db, `update public.sot_atividades set qtd_executada = 1 where id = '${A2.id}'`) || '')
  && /EXECUCAO_DESLIGADA/.test((await lancar(db, I2, 1)).e || ''));
ok('ausente: legado e sem WL continuam livres', await tela(db, `update public.sot_atividades set qtd_executada = 4 where id = '${AL.id}'`, null, 'anon') === null
  && await tela(db, `update public.sot_atividades set qtd_executada = 2 where id = '${AX.id}'`) === null);
await db.exec(`insert into public.proj_execucao_config (id, ativo, versao_minima) values (true, false, null); alter table public.proj_execucao_config enable trigger user;`);
await desligar(db);
// lançamentos: I1 (3), I_E2 (2), I2 (0,5), retroativo (1) e o estorno de I1 = 5
e = await tela(db, `update public.sot_atividades set qtd_executada = 0.5 where id = '${A2.id}'`);
const nLanc = (await db.query(`select count(*)::int n from public.prog_proj_execucao_lancamentos`)).rows[0].n;
ok('desligado de novo: tela volta a gravar; lançamentos preservados', e === null && nLanc === 5, { e, nLanc });

// ── Rollback ────────────────────────────────────────────────────
erro = await tentaExec(db, desfazer);
ok('rollback recusado quando há execução registrada', /rollback automático recusado/.test(erro || ''), erro);
const dbR = await novoBanco(true);
erro = await tentaExec(dbR, desfazer);
const restos = (await dbR.query(`select count(*)::int n from pg_proc where proname like 'fn_proj_execucao%' or proname in ('fn_proj_saldo_atividades',
  'prog_proj_execucao_proteger', 'proj_execucao_config_proteger')`)).rows[0].n;
const tabs = (await dbR.query(`select count(*)::int n from pg_class where relname in ('prog_proj_execucoes', 'prog_proj_execucao_itens',
  'prog_proj_execucao_lancamentos', 'proj_execucao_config', 'proj_execucao_config_eventos') and relkind = 'r'`)).rows[0].n;
const trg = (await dbR.query(`select count(*)::int n from pg_trigger where tgname like 'proj_execucao_protege%'`)).rows[0].n;
ok('rollback sem execução: remove funções, tabelas e gatilhos; desativa as ações', erro === null && restos === 0 && tabs === 0 && trg === 0
  && (await dbR.query(`select count(*)::int n from public.cena_acoes where codigo in ('PROJ_LANCAR_EXECUCAO', 'PROJ_ESTORNAR_EXECUCAO') and ativo`)).rows[0].n === 0,
  { erro, restos, tabs, trg });

if (failed.length) { console.error('proj-execucao-sql: FALHOU ' + failed.length + '/' + total + '\n  - ' + failed.join('\n  - ')); process.exit(1); }
console.log('proj-execucao-sql: OK (' + total + ' verificações)');
