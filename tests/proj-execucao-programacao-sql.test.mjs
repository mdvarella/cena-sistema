// ETAPA 1.7b — testes SQL da migration 20261017100000_proj_execucao_programacao.sql
// (meta do dia ≤ saldo, leitura do dia para a tela, retirar projeto numa transação e proteção da composição contra
// retirada/exclusão com quantidade lançada — vale também para SQL direto e para o TMA). PGlite com a cadeia até a 1.7a.
// Uso: PGLITE_PATH=<pasta com @electric-sql/pglite> XLSX_PATH=<.../xlsx.mjs> node tests/proj-execucao-programacao-sql.test.mjs
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
  console.log('proj-execucao-programacao-sql: SKIP (defina PGLITE_PATH e XLSX_PATH)');
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
const mig17a = semNotify(ler('20261015120000_proj_execucao.sql'));

const migRaw = ler('20261017100000_proj_execucao_programacao.sql');
const mig = semNotify(migRaw);
const codigo = migRaw.slice(0, migRaw.indexOf('-- Validação')).replace(/--[^\n]*/g, '');
const desfazer = migRaw.slice(migRaw.indexOf('-- Para desfazer')).split('\n').slice(2)
  .map(l => l.replace(/^--\s?/, '')).join('\n').trim();

const failed = [];
let total = 0;
const ok = (n, c, d) => { total++; if (!c) failed.push(n + (d !== undefined ? ' — ' + JSON.stringify(d).slice(0, 500) : '')); };
const corpo = nome => { const i = codigo.indexOf('FUNCTION public.' + nome + '('); return codigo.slice(i, codigo.indexOf('\n$$;', i)); };
const corpo17a = nome => { const c = mig17a.replace(/--[^\n]*/g, ''); const i = c.indexOf('FUNCTION public.' + nome + '('); return c.slice(i, c.indexOf('\n$$;', i)); };

// ── Estáticos ───────────────────────────────────────────────────
const cl = codigo.trim();
ok('transação explícita: BEGIN; primeiro, COMMIT; último', cl.startsWith('BEGIN;') && cl.endsWith('COMMIT;') && !/\bROLLBACK\b/i.test(codigo));
ok('não liga o interruptor nem cria lançamento', !/proj_execucao_config/.test(codigo) && !/INSERT INTO public\.prog_proj_execucao_lancamentos/.test(codigo));
ok('nunca DELETE físico nem TRUNCATE', !/DELETE\s+FROM/i.test(codigo) && !/TRUNCATE\s+(TABLE\s+)?public\./i.test(codigo));
ok('nenhuma autoria fictícia (sem uuid zerado)', !/00000000-0000-0000-0000-000000000000/.test(codigo));
ok('permissão de exceção própria (não reutiliza a de estorno)', /PROJ_AUTORIZAR_EXCESSO_META/.test(corpo('fn_proj_execucao_definir_itens'))
  && !/PROJ_ESTORNAR_EXECUCAO/.test(corpo('fn_proj_execucao_definir_itens')));
const di = corpo('fn_proj_execucao_definir_itens');
ok('concorrência: trava as atividades (ordem por id) antes de conferir o saldo livre', /ORDER BY a\.id FOR UPDATE/.test(di)
  && di.indexOf('FOR UPDATE;\n') < di.indexOf('fn_proj_execucao_saldo_livre('));
ok('autor do cancelamento automático vem da sessão, não de parâmetro', /v_auth\s+uuid := auth\.uid\(\)/.test(corpo('fn_proj_execucao_cancelar_por_composicao'))
  && !/p_auth/.test(codigo));
ok('cancelamento automático só pelo gatilho (marca da transação)', /current_setting\('cena\.exec_comp_trg', true\)/.test(corpo('fn_proj_execucao_cancelar_por_composicao'))
  && /set_config\('cena\.exec_comp_trg', OLD\.id::text, true\)/.test(corpo('fn_proj_execucao_protege_composicao')));

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
async function novoBanco(com17b = true) {
  const db = new PGlite();
  await db.exec(BASE);
  for (const m of CADEIA) await db.exec(m);
  await db.exec(mig17a);
  if (com17b) await db.exec(mig);
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
const api = (db, sql, params, uid = UID.gestor, role = 'authenticated') => como(db, role, uid, async () => {
  try { return { r: (await db.query(sql, params)).rows[0].v }; } catch (e) { return { e: e.message }; }
});
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
const L = ident => lmsSint([
  ['1', 'WP', 'I', 'I-100', 'S-100', 'US3', 'SERVIÇO A', 4],
  ['1', 'WP', 'I', 'I-200', 'S-200', 'US3', 'SERVIÇO B', 2],
  ['2', 'WP', 'I', 'I-100', 'S-100', 'US3', 'SERVIÇO A', 3]], ident);
const registrar = (db, proj, pl) => como(db, 'service_role', null, async () =>
  (await db.query(`select public.sot_lms_importacao_registrar($1::uuid, $2::uuid, $3::jsonb, $4::jsonb) v`,
    [UID.gestor, proj, JSON.stringify(pl.p_importacao), JSON.stringify(pl.p_linhas)])).rows[0].v.importacao_id);
const confirmar = (db, imp, modo) => como(db, 'authenticated', UID.gestor, async () =>
  (await db.query(`select public.sot_lms_confirmar($1::uuid, $2, null) v`, [imp, modo])).rows[0].v);
const projeto = (db, id, nome) => db.query(`insert into public.sot_projetos (id, contrato_id, nome) values ($1, $2, $3)`, [id, C_ATIVO, nome]);
async function estruturado(db, id, nome) {
  await projeto(db, id, nome);
  const imp = await registrar(db, id, L(nome.replace(/\W/g, '')));
  await confirmar(db, imp, 'ESTRUTURA_NOVA');
  await como(db, 'authenticated', UID.gestor, () => db.query(`select public.fn_proj_lms_aplicar_estrutura_nova($1::uuid)`, [imp]));
  return id;
}
const ativ = async (db, proj, cod, wlCod) => (await db.query(`select a.id, a.wl_id from public.sot_atividades a
  join public.sot_wl w on w.id = a.wl_id where a.projeto_id = $1 and a.codigo = $2 and w.codigo = $3`, [proj, cod, wlCod])).rows[0];
const hoje = async db => (await db.query(`select to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD') d`)).rows[0].d;
const comp = async (db, equipe, data, projs, confirmada = true) => (await db.query(`insert into public.composicao_dia (equipe_id, data, projeto_ids, confirmada)
  values ($1, $2, $3, $4) returning id`, [equipe, data, JSON.stringify(projs), confirmada])).rows[0].id;
const criar = (db, c, p, uid = UID.gestor) => api(db, `select public.fn_proj_execucao_criar($1::uuid, $2::uuid) v`, [c, p], uid);
const itens = (db, e, lista, uid = UID.gestor) => api(db, `select public.fn_proj_execucao_definir_itens($1::uuid, $2::jsonb) v`, [e, JSON.stringify(lista)], uid);
const lancar = (db, item, q) => api(db, `select public.fn_proj_execucao_lancar($1::uuid, $2::numeric, 'DIARIO', null, '8.1.230') v`, [item, q], UID.encarregado);
const exec = async (db, id) => (await db.query(`select cancelada_em is not null c, motivo_cancelamento m, cancelada_por_auth p from public.prog_proj_execucoes where id = $1`, [id])).rows[0];
const itensAtivos = async (db, e) => (await db.query(`select count(*)::int n from public.prog_proj_execucao_itens where execucao_id = $1 and cancelado_em is null`, [e])).rows[0].n;
const projIds = async (db, c) => JSON.parse((await db.query(`select projeto_ids p from public.composicao_dia where id = $1`, [c])).rows[0].p);
const dia = (db, d, ids, uid = UID.gestor) => api(db, `select public.fn_proj_execucao_dia($1::date, $2::uuid[]) v`, [d, ids], uid);
const retirar = (db, c, p, motivo = 'replanejado', uid = UID.gestor) => api(db, `select public.fn_proj_execucao_retirar_projeto($1::uuid, $2::uuid, $3) v`, [c, p, motivo], uid);

// ── Aplicação ───────────────────────────────────────────────────
const db = await novoBanco(false);
let erro = await tentaExec(db, mig);
ok('aplica sobre a cadeia real (até a 1.7a)', erro === null, erro);
erro = await tentaExec(db, mig);
ok('reaplica sem erro (idempotente)', erro === null, erro);
const sem17a = await (async () => { const d = new PGlite(); await d.exec(BASE); for (const m of CADEIA) await d.exec(m); return tentaExec(d, mig); })();
ok('pré-condição: sem a 1.7a não aplica', /20261015120000_proj_execucao\.sql/.test(sem17a || ''), sem17a);
const fpriv = async (role, fn) => (await db.query(`select has_function_privilege($1, $2, 'EXECUTE') v`, [role, fn])).rows[0].v;
for (const fn of ['fn_proj_execucao_dia(date,uuid[])', 'fn_proj_execucao_retirar_projeto(uuid,uuid,text)', 'fn_proj_execucao_definir_itens(uuid,jsonb)', 'fn_proj_saldo_atividades(uuid)'])
  ok(`${fn}: só authenticated`, await fpriv('authenticated', 'public.' + fn) && !(await fpriv('anon', 'public.' + fn)) && !(await fpriv('service_role', 'public.' + fn)));
for (const fn of ['fn_proj_execucao_soma_atividade(uuid)', 'fn_proj_execucao_protege_composicao()', 'fn_proj_execucao_compromissos(uuid,date,uuid)', 'fn_proj_execucao_saldo_livre(uuid,date,uuid)'])
  ok(`${fn}: interna`, !(await fpriv('authenticated', 'public.' + fn)) && !(await fpriv('anon', 'public.' + fn)));
ok('interruptor continua INATIVO', (await db.query(`select public.fn_proj_execucao_estado() v`)).rows[0].v === 'INATIVO');
const pmEx = (await db.query(`select string_agg(perfil, ',' order by perfil) p from public.cena_permissoes_acao where acao = 'PROJ_AUTORIZAR_EXCESSO_META' and deleted_at is null and permitido`)).rows[0].p;
ok('PROJ_AUTORIZAR_EXCESSO_META: admin, coordenador, gestor', pmEx === 'admin,coordenador,gestor', pmEx);

// ── Cenário ─────────────────────────────────────────────────────
const PE = await estruturado(db, PJ(1), 'Estruturado');
await projeto(db, PJ(2), 'Legado');
await projeto(db, PJ(3), 'Em conciliação');
await confirmar(db, await registrar(db, PJ(3), L('CONC')), 'CONCILIACAO');
const A1 = await ativ(db, PE, 'I-100', '1'), A2 = await ativ(db, PE, 'I-200', '1'), A3 = await ativ(db, PE, 'I-100', '2');
const H = await hoje(db);
const dia2 = async n => (await db.query(`select to_char((now() at time zone 'America/Sao_Paulo')::date + $1::int, 'YYYY-MM-DD') d`, [n])).rows[0].d;
const AMANHA = await dia2(1), ONTEM = await dia2(-1);
const novaExec = async (eq, d, projs = [PE]) => { const c = await comp(db, eq, d, projs); return { c, e: (await criar(db, c, PE)).r.execucao_id }; };
const meta = (e, a, q, uid, just) => itens(db, e, [Object.assign({ wl_id: a.wl_id, atividade_id: a.id, qtd_programada: q }, just ? { excesso_justificativa: just } : {})], uid);
const saldoDe = async (a, uid = UID.gestor) => { const r = await saldo(db, PE, uid); return r.r && r.r.atividades.find(x => x.atividade_id === a.id); };
const saldo = (db_, p, uid = UID.gestor) => api(db_, `select public.fn_proj_saldo_atividades($1::uuid) v`, [p], uid);

const X1 = await novaExec('EQ1', H, [PE, PJ(2)]);
const X2 = await novaExec('EQ2', H);
const X3 = await novaExec('EQ3', AMANHA);
const XV = await novaExec('EQV', ONTEM);

// Metas em diferentes equipes (previsto I-100/WL1 = 4)
let r = await meta(X1.e, A1, 2, UID.supervisor);
ok('equipes: EQ1 meta 2 (livre 4)', r.r && r.r.incluidos === 1, r);
r = await meta(X2.e, A1, 2, UID.coordenador);
ok('equipes: EQ2 meta 2 (livre 2)', r.r && r.r.incluidos === 1, r);
r = await meta(X3.e, A1, 1, UID.supervisor);
ok('dias diferentes: EQ3 amanhã meta 1 recusada (livre 0 com metas de hoje)', /QTD_ACIMA_DO_SALDO.*saldo livre 0/.test(r.e || ''), r);
// Programação simultânea por dois usuários (sequencial no banco local; a trava FOR UPDATE está verificada acima)
const Y = await novaExec('EQY', AMANHA);
ok('simultânea: segundo usuário vê o saldo já comprometido pelo primeiro e é bloqueado', /QTD_ACIMA_DO_SALDO/.test((await meta(Y.e, A1, 0.5, UID.coordenador)).e || ''));
let s = await saldoDe(A1);
ok('saldo na tela: previsto 4, executado 0, comprometido 4, livre 0, com equipes e datas', s && Number(s.qtd_prevista) === 4 && Number(s.qtd_executada) === 0
  && Number(s.qtd_comprometida) === 4 && Number(s.saldo_livre) === 0 && s.compromissos.length === 2
  && s.compromissos.map(k => k.equipe_id).sort().join() === 'EQ1,EQ2' && s.compromissos.every(k => k.data === H), s);

// Programação vencida (ontem) não prende saldo
r = await meta(XV.e, A2, 2, UID.gestor);
ok('vencida: meta em programação de ontem gravada (histórico)', r.r && r.r.incluidos === 1, r);
s = await saldoDe(A2);
ok('vencida: não compromete saldo (livre 2 de 2)', Number(s.qtd_comprometida) === 0 && Number(s.saldo_livre) === 2 && s.compromissos.length === 0, s);
r = await meta(X3.e, A2, 2, UID.supervisor);
ok('vencida: saldo liberado pode ser programado de novo', r.r && r.r.incluidos === 1, r);

// Cancelamento libera o saldo
const itemDe = async (e, a) => (await db.query(`select id from public.prog_proj_execucao_itens where execucao_id = $1 and atividade_id = $2 and cancelado_em is null`, [e, a])).rows[0].id;
r = await api(db, `select public.fn_proj_execucao_cancelar_item($1::uuid, 'replanejado') v`, [await itemDe(X2.e, A1.id)]);
s = await saldoDe(A1);
ok('cancelamento: libera a meta (comprometido 2, livre 2)', r.r && Number(s.qtd_comprometida) === 2 && Number(s.saldo_livre) === 2, { r, s });
const canc = (await db.query(`select cancelado_por_auth p, cancelado_origem o from public.prog_proj_execucao_itens where execucao_id = $1 and atividade_id = $2`, [X2.e, A1.id])).rows[0];
ok('cancelamento pelo usuário registra o autor', canc.p === UID.gestor && canc.o === null, canc);

// Exceção de excesso
ok('excesso sem justificativa: bloqueado por padrão', /QTD_ACIMA_DO_SALDO/.test((await meta(X3.e, A1, 3, UID.gestor)).e || ''));
ok('excesso com justificativa sem permissão (supervisor): recusado', /EXCESSO_SEM_PERMISSAO/.test((await meta(X3.e, A1, 3, UID.supervisor, 'equipe extra')).e || ''));
r = await meta(X3.e, A1, 3, UID.gestor, 'reforço autorizado pela coordenação');
const exc = (await db.query(`select excesso_justificativa j, excesso_autorizado_por_auth p, excesso_saldo_livre l, criado_por_auth c, criado_em t
  from public.prog_proj_execucao_itens where execucao_id = $1 and atividade_id = $2 and cancelado_em is null`, [X3.e, A1.id])).rows[0];
ok('excesso com justificativa e permissão (gestor): gravado e auditado (quem, quando, saldo livre no momento)', r.r && r.r.excessos_autorizados === 1
  && exc.j === 'reforço autorizado pela coordenação' && exc.p === UID.gestor && Number(exc.l) === 2 && exc.c === UID.gestor && exc.t, { r, exc });
ok('excesso: CHECK impede justificativa sem autor', /prog_proj_execucao_itens_excesso_chk/.test(await tentaExec(db,
  `insert into public.prog_proj_execucao_itens (execucao_id, projeto_id, wl_id, atividade_id, qtd_programada, criado_por_auth, excesso_justificativa)
   values ('${X3.e}', '${PE}', '${A3.wl_id}', '${A3.id}', 1, '${UID.gestor}', 'x')`) || ''));

// Execução parcial (interruptor ligado só no teste) — sem dupla contagem
await db.exec(`update public.proj_execucao_config set ativo = true, versao_minima = '8.1.230', motivo = 'teste'`);
const I1 = await itemDe(X1.e, A1.id);
r = await lancar(db, I1, 1);
s = await saldoDe(A1);
// previsto 4; executado 1; aberto: EQ1 (2−1=1) + EQ3 amanhã (3) = 4 → livre 0
ok('parcial: executado 1 abate a meta da EQ1 (aberto 1) sem contar duas vezes', r.r && Number(s.qtd_executada) === 1 && Number(s.qtd_comprometida) === 4
  && Number(s.saldo_livre) === 0 && s.compromissos.find(k => k.equipe_id === 'EQ1').qtd_aberta == 1, { r, s });
r = await lancar(db, I1, 2);
s = await saldoDe(A1);
ok('parcial: executado acima da meta zera o aberto da EQ1 (nunca negativo)', Number(s.qtd_executada) === 3 && !s.compromissos.some(k => k.equipe_id === 'EQ1')
  && Number(s.qtd_comprometida) === 3 && Number(s.saldo_livre) === 0, s);

// Abertura do quadro e consultas não gravam
const snap = async () => (await db.query(`select (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.prog_proj_execucoes t) e,
  (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.prog_proj_execucao_itens t) i,
  (select count(*) from public.prog_proj_execucao_lancamentos)::int l, (select md5(coalesce(string_agg(t::text, '|' order by t.id), '')) from public.composicao_dia t) c`)).rows[0];
let antes = JSON.stringify(await snap());
await dia(db, H, [PE, PJ(2), PJ(3)]); await dia(db, AMANHA, [PE]); await saldo(db, PE); await saldo(db, PE, UID.encarregado);
await api(db, `select public.fn_proj_execucao_situacao($1::uuid) v`, [PE]);
ok('abrir o quadro / consultas: nada é gravado', JSON.stringify(await snap()) === antes);
r = await dia(db, H, [PE, PJ(2), PJ(3)], UID.supervisor);
ok('dia: estados WL (estruturado, legado, em conciliação) e itens com meta', r.r && r.r.estados[PE] === 'ESTRUTURADO' && r.r.estados[PJ(2)] === 'LEGADO_SEM_WL'
  && r.r.estados[PJ(3)] === 'EM_CONCILIACAO' && r.r.execucoes.find(x => x.execucao_id === X1.e).itens.length === 1, r);
ok('dia: encarregado (não programa) não lê', /SEM_PERMISSAO/.test((await dia(db, H, [PE], UID.encarregado)).e || ''));

// Retirada sem autenticação / autoria
const Z = await novaExec('EQZ', H);
await meta(Z.e, A3, 1, UID.gestor);
antes = JSON.stringify(await projIds(db, Z.c));
let e = await tela(db, `update public.composicao_dia set projeto_ids = '[]' where id = '${Z.c}'`, null, 'anon');
ok('sem autenticação (TMA em sessão legada): retirada de projeto programado recusada com orientação', /EXECUCAO_SEM_AUTORIA/.test(e || '') && /Programação de Projetos com login autenticado/.test(e || '')
  && JSON.stringify(await projIds(db, Z.c)) === antes && !(await exec(db, Z.e)).c, e);
ok('sem autenticação: exclusão (soft) da composição programada recusada', /EXECUCAO_SEM_AUTORIA/.test(await tela(db, `update public.composicao_dia set deleted_at = now() where id = '${Z.c}'`, null, 'anon') || ''));
e = await tela(db, `update public.composicao_dia set projeto_ids = '[]' where id = '${Z.c}'`, UID.supervisor, 'authenticated');
let ez = (await db.query(`select cancelada_por_auth p, cancelada_origem o, motivo_cancelamento m from public.prog_proj_execucoes where id = $1`, [Z.e])).rows[0];
ok('com login autenticado (TMA): retirada passa e o cancelamento registra o usuário', e === null && ez.p === UID.supervisor && ez.o === 'USUARIO'
  && /fora da Programação de Projetos/.test(ez.m), { e, ez });
const W = await novaExec('EQW', H);
e = await tentaExec(db, `update public.composicao_dia set projeto_ids = '[]' where id = '${W.c}'`);
const ew = (await db.query(`select cancelada_por_auth p, cancelada_origem o, motivo_cancelamento m from public.prog_proj_execucoes where id = $1`, [W.e])).rows[0];
ok('operação técnica (SQL direto): cancela com origem SISTEMA, sem autor fictício', e === null && ew.p === null && ew.o === 'SISTEMA' && /operação técnica \(papel postgres\)/.test(ew.m), { e, ew });
ok('nenhum cancelamento sem autor fora da origem SISTEMA', (await db.query(`select count(*)::int n from public.prog_proj_execucoes
  where cancelada_em is not null and cancelada_por_auth is null and coalesce(cancelada_origem, 'USUARIO') <> 'SISTEMA'`)).rows[0].n === 0);
ok('cancelamento automático não pode ser chamado pela API', /só pelo gatilho/.test((await api(db,
  `select public.fn_proj_execucao_cancelar_por_composicao($1::uuid, 'UPDATE', '[]', false, false, 'postgres')::text v`, [X1.c], UID.gestor)).e || '')
  && /só pelo gatilho/.test((await api(db, `select public.fn_proj_execucao_cancelar_por_composicao($1::uuid, 'UPDATE', '[]', false, false, 'postgres')::text v`, [X1.c], null, 'anon')).e || ''));
antes = JSON.stringify(await projIds(db, X1.c));
ok('com quantidade lançada: recusado até por SQL direto', /EXECUCAO_COM_LANCAMENTO/.test(await tentaExec(db, `update public.composicao_dia set projeto_ids = '[]' where id = '${X1.c}'`) || '')
  && JSON.stringify(await projIds(db, X1.c)) === antes);
ok('com quantidade lançada: retirar pela tela recusado', /EXECUCAO_COM_LANCAMENTO/.test((await retirar(db, X1.c, PE, 'tentativa')).e || ''));
r = await retirar(db, X1.c, PJ(2), 'legado saiu');
ok('legado na mesma composição: sai normalmente', r.r && r.r.execucoes_canceladas === 0 && JSON.stringify(await projIds(db, X1.c)) === JSON.stringify([PE]), r);
const R = await novaExec('EQR', H);
r = await retirar(db, R.c, PE, 'equipe remanejada', UID.coordenador);
const er = (await db.query(`select cancelada_por_auth p, cancelada_origem o, motivo_cancelamento m from public.prog_proj_execucoes where id = $1`, [R.e])).rows[0];
ok('retirar pela tela: motivo e autor registrados, projeto sai da composição', r.r && er.p === UID.coordenador && er.o === 'USUARIO' && er.m === 'equipe remanejada'
  && (await projIds(db, R.c)).length === 0, { r, er });
ok('retirar sem motivo recusado', /MOTIVO_OBRIGATORIO/.test((await retirar(db, X2.c, PE, ' ')).e || ''));

// TMA sem programação ativa: igual a hoje
const C9 = await comp(db, 'EQ9', H, [PJ(2)]);
ok('TMA sem programação: anon grava projeto_ids, exclui e altera como hoje', await tela(db, `update public.composicao_dia set projeto_ids = '[]' where id = '${C9}'`, null, 'anon') === null
  && await tela(db, `update public.composicao_dia set deleted_at = now() where id = '${C9}'`, null, 'anon') === null);
ok('outra coluna (colaboradores/confirmada) não aciona a proteção', await tela(db, `update public.composicao_dia set colaborador_ids = '["x"]', confirmada = false where id = '${Y.c}'`, null, 'anon') === null);
const C10 = await comp(db, 'EQ10', H, [PJ(2), PJ(3)]);
ok('legado e em conciliação: criar programação continua recusado', /PROJETO_NAO_ESTRUTURADO.*LEGADO_SEM_WL/.test((await api(db, `select public.fn_proj_execucao_criar($1::uuid, $2::uuid) v`, [C10, PJ(2)])).e || '')
  && /PROJETO_NAO_ESTRUTURADO.*EM_CONCILIACAO/.test((await api(db, `select public.fn_proj_execucao_criar($1::uuid, $2::uuid) v`, [C10, PJ(3)])).e || ''));

// ── Rollback ────────────────────────────────────────────────────
erro = await tentaExec(db, desfazer);
ok('rollback recusado quando já há exceção de meta ou cancelamento com origem', /rollback automático recusado/.test(erro || ''), erro);
const dbR = await novoBanco(true);
erro = await tentaExec(dbR, desfazer);
const restos = (await dbR.query(`select count(*)::int n from pg_proc where proname in ('fn_proj_execucao_dia', 'fn_proj_execucao_retirar_projeto', 'fn_proj_execucao_protege_composicao',
  'fn_proj_execucao_soma_atividade', 'fn_proj_execucao_compromissos', 'fn_proj_execucao_saldo_livre', 'fn_proj_execucao_cancelar_por_composicao', 'fn_proj_execucao_composicao_tem_ativa')`)).rows[0].n;
const trg = (await dbR.query(`select count(*)::int n from pg_trigger where tgname = 'proj_execucao_protege_composicao_trg'`)).rows[0].n;
const cols = (await dbR.query(`select count(*)::int n from information_schema.columns where table_name in ('prog_proj_execucao_itens', 'prog_proj_execucoes')
  and column_name in ('excesso_justificativa', 'excesso_autorizado_por_auth', 'excesso_saldo_livre', 'cancelado_origem', 'cancelada_origem')`)).rows[0].n;
ok('rollback sem uso: remove gatilho, funções e colunas novas', erro === null && restos === 0 && trg === 0 && cols === 0, { erro, restos, trg, cols });
const db17a = await novoBanco(false);
const src = async (d, n) => (await d.query(`select prosrc from pg_proc where proname = $1`, [n])).rows[0].prosrc;
for (const n of ['fn_proj_execucao_definir_itens', 'fn_proj_saldo_atividades', 'prog_proj_execucao_proteger'])
  ok(`rollback devolve ${n} da 1.7a (mesmo texto)`, await src(dbR, n) === await src(db17a, n));
const conDef = async (d, n) => (await d.query(`select pg_get_constraintdef(oid) v from pg_constraint where conname = $1`, [n])).rows[0].v;
ok('rollback devolve as regras de cancelamento da 1.7a', await conDef(dbR, 'prog_proj_execucoes_cancelamento_chk') === await conDef(db17a, 'prog_proj_execucoes_cancelamento_chk')
  && await conDef(dbR, 'prog_proj_execucao_itens_cancelamento_chk') === await conDef(db17a, 'prog_proj_execucao_itens_cancelamento_chk'));

if (failed.length) { console.error('proj-execucao-programacao-sql: FALHOU ' + failed.length + '/' + total + '\n  - ' + failed.join('\n  - ')); process.exit(1); }
console.log('proj-execucao-programacao-sql: OK (' + total + ' verificações)');
