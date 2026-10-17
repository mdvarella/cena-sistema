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
ok('nunca DELETE físico', !/DELETE\s+FROM/i.test(codigo) && !/TRUNCATE/i.test(codigo));
ok('definir_itens = corpo da 1.7a + só a checagem de saldo', (() => {
  const novo = corpo('fn_proj_execucao_definir_itens').replace(/\n\s*v_saldo\s+numeric;/, '')
    .replace(/\n      IF v_qtd IS NOT NULL THEN\n        SELECT coalesce\(a\.qtd_prevista[\s\S]*?\n      END IF;\n(?=      v_alvo := v_alvo \|\| jsonb_build_array)/, '\n');
  const semBrancas = s => s.split('\n').filter(l => l.trim() !== '').join('\n');
  return semBrancas(novo) === semBrancas(corpo17a('fn_proj_execucao_definir_itens'));
})());
ok('gatilho da composição só age com execução ativa (atalho no começo)', corpo('fn_proj_execucao_protege_composicao').indexOf('IF NOT EXISTS (SELECT 1 FROM public.prog_proj_execucoes e WHERE e.composicao_dia_id = OLD.id AND e.cancelada_em IS NULL)')
  < corpo('fn_proj_execucao_protege_composicao').indexOf('FOR v_exec IN'));
ok('gatilho não olha o papel de quem grava (vale para SQL direto)', !/current_user/.test(corpo('fn_proj_execucao_protege_composicao')));

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
for (const fn of ['fn_proj_execucao_dia(date,uuid[])', 'fn_proj_execucao_retirar_projeto(uuid,uuid,text)', 'fn_proj_execucao_definir_itens(uuid,jsonb)'])
  ok(`${fn}: só authenticated`, await fpriv('authenticated', 'public.' + fn) && !(await fpriv('anon', 'public.' + fn)) && !(await fpriv('service_role', 'public.' + fn)));
for (const fn of ['fn_proj_execucao_soma_atividade(uuid)', 'fn_proj_execucao_protege_composicao()'])
  ok(`${fn}: interna`, !(await fpriv('authenticated', 'public.' + fn)) && !(await fpriv('anon', 'public.' + fn)));
ok('interruptor continua INATIVO', (await db.query(`select public.fn_proj_execucao_estado() v`)).rows[0].v === 'INATIVO');

// ── Cenário ─────────────────────────────────────────────────────
const PE = await estruturado(db, PJ(1), 'Estruturado');
await projeto(db, PJ(2), 'Legado');
await projeto(db, PJ(3), 'Em conciliação');
await confirmar(db, await registrar(db, PJ(3), L('CONC')), 'CONCILIACAO');
const A1 = await ativ(db, PE, 'I-100', '1'), A2 = await ativ(db, PE, 'I-200', '1'), A3 = await ativ(db, PE, 'I-100', '2');
const H = await hoje(db);
const C1 = await comp(db, 'EQ1', H, [PE, PJ(2)]);
const C2 = await comp(db, 'EQ2', H, [PE]);
const C3 = await comp(db, 'EQ3', H, [PJ(2)]);
const E1 = (await criar(db, C1, PE)).r.execucao_id;
const E2 = (await criar(db, C2, PE)).r.execucao_id;

// ── Meta do dia ≤ saldo ─────────────────────────────────────────
ok('meta acima do saldo recusada (5 > previsto 4)', /QTD_ACIMA_DO_SALDO/.test((await itens(db, E1, [{ wl_id: A1.wl_id, atividade_id: A1.id, qtd_programada: 5 }])).e || ''));
ok('lote com meta acima do saldo não grava nada', await itensAtivos(db, E1) === 0);
let r = await itens(db, E1, [{ wl_id: A1.wl_id, atividade_id: A1.id, qtd_programada: 4 }, { wl_id: A2.wl_id, atividade_id: A2.id, qtd_programada: 2 }]);
ok('meta igual ao saldo aceita', r.r && r.r.incluidos === 2, r);
r = await itens(db, E2, [{ wl_id: A3.wl_id }]);
ok('WL inteira (sem meta) continua aceita', r.r && r.r.incluidos === 1, r);
const I_A1 = (await db.query(`select id from public.prog_proj_execucao_itens where execucao_id = $1 and atividade_id = $2`, [E1, A1.id])).rows[0].id;

// ── Leitura do dia ──────────────────────────────────────────────
r = await dia(db, H, [PE, PJ(2), PJ(3)], UID.supervisor);
ok('dia: estados WL dos projetos (estruturado, legado, em conciliação)', r.r && r.r.estados[PE] === 'ESTRUTURADO' && r.r.estados[PJ(2)] === 'LEGADO_SEM_WL'
  && r.r.estados[PJ(3)] === 'EM_CONCILIACAO', r);
const ex1 = r.r && r.r.execucoes.find(x => x.execucao_id === E1);
const it1 = ex1 && ex1.itens.find(i => i.atividade_id === A1.id);
ok('dia: execuções ativas com itens (WL, atividade, meta, lançado, previsto, executado, quem incluiu)', r.r && r.r.execucoes.length === 2 && ex1.itens.length === 2
  && it1.wl_codigo === '1' && it1.codigo === 'I-100' && Number(it1.qtd_programada) === 4 && Number(it1.qtd_lancada) === 0
  && Number(it1.qtd_prevista) === 4 && Number(it1.qtd_executada) === 0 && it1.criado_por === 'Usuário gestor' && ex1.criado_por === 'Usuário gestor', ex1);
ok('dia: encarregado (não programa) não lê', /SEM_PERMISSAO/.test((await dia(db, H, [PE], UID.encarregado)).e || ''));
ok('dia: sem sessão recusa', /SEM_SESSAO/.test((await dia(db, H, [PE], null)).e || ''));
ok('dia: anon não executa', /permission denied/.test((await api(db, `select public.fn_proj_execucao_dia($1::date) v`, [H], null, 'anon')).e || ''));

// ── Retirar projeto (uma transação) ─────────────────────────────
ok('retirar: sem motivo recusado', /MOTIVO_OBRIGATORIO/.test((await retirar(db, C2, PE, ' ')).e || ''));
ok('retirar: encarregado não retira', /SEM_PERMISSAO/.test((await retirar(db, C2, PE, 'x', UID.encarregado)).e || ''));
r = await retirar(db, C2, PE, 'equipe remanejada');
let e2 = await exec(db, E2);
ok('retirar: cancela execução e itens com o motivo e tira o projeto da composição', r.r && r.r.execucoes_canceladas === 1 && e2.c && e2.m === 'equipe remanejada'
  && e2.p === UID.gestor && await itensAtivos(db, E2) === 0 && (await projIds(db, C2)).length === 0, { r, e2 });
r = await retirar(db, C3, PJ(2), 'não vai mais');
ok('retirar: projeto legado (sem execução) só sai da composição', r.r && r.r.execucoes_canceladas === 0 && (await projIds(db, C3)).length === 0, r);

// ── Proteção da composição (TMA / SQL direto) ───────────────────
const C4 = await comp(db, 'EQ4', H, [PE]);
const E4 = (await criar(db, C4, PE)).r.execucao_id;
let e = await tela(db, `update public.composicao_dia set projeto_ids = '[]' where id = '${C4}'`, null, 'anon');
let e4 = await exec(db, E4);
ok('TMA (anon) retira projeto sem lançamento: passa e a execução é cancelada com motivo automático', e === null && e4.c
  && /fora da Programação de Projetos \(automático\)/.test(e4.m) && e4.p === '00000000-0000-0000-0000-000000000000', { e, e4 });
const C5 = await comp(db, 'EQ5', H, [PE]);
const E5 = (await criar(db, C5, PE)).r.execucao_id;
ok('outra coluna (colaboradores, confirmada) não mexe na execução', await tela(db, `update public.composicao_dia set colaborador_ids = '["x"]', confirmada = false where id = '${C5}'`, null, 'anon') === null
  && !(await exec(db, E5)).c);
e = await tela(db, `update public.composicao_dia set deleted_at = now() where id = '${C5}'`);
ok('composição excluída (soft) sem lançamento: execução cancelada', e === null && /excluída \(automático\)/.test((await exec(db, E5)).m), e);
const C6 = await comp(db, 'EQ6', H, [PE]);
const E6 = (await criar(db, C6, PE)).r.execucao_id;
ok('mudar equipe/data da composição: execução cancelada', await tentaExec(db, `update public.composicao_dia set equipe_id = 'EQ6B' where id = '${C6}'`) === null
  && /Equipe ou data/.test((await exec(db, E6)).m));
ok('composição sem execução: TMA grava como hoje', await tela(db, `update public.composicao_dia set projeto_ids = '["${PJ(2)}"]' where id = '${C3}'`, null, 'anon') === null);

// Com quantidade lançada (interruptor ligado só no teste)
await db.exec(`update public.proj_execucao_config set ativo = true, versao_minima = '8.1.230', motivo = 'teste'`);
r = await lancar(db, I_A1, 1);
ok('cenário: lançamento de 1 no item de EQ1', r.r && r.r.operacao === 'LANCADO', r);
const C7 = await comp(db, 'EQ7', H, [PE]);
const E7 = (await criar(db, C7, PE)).r.execucao_id;
ok('meta acima do saldo considera o executado (saldo 4 − 1 = 3): 3,5 recusado', /QTD_ACIMA_DO_SALDO/.test((await itens(db, E7, [{ wl_id: A1.wl_id, atividade_id: A1.id, qtd_programada: 3.5 }])).e || ''));
ok('meta 3 (= saldo) aceita', (await itens(db, E7, [{ wl_id: A1.wl_id, atividade_id: A1.id, qtd_programada: 3 }])).r);
const antes = JSON.stringify(await projIds(db, C1));
e = await tela(db, `update public.composicao_dia set projeto_ids = '["${PJ(2)}"]' where id = '${C1}'`, null, 'anon');
ok('TMA (anon) retira projeto com lançamento: recusado, nada muda', /EXECUCAO_COM_LANCAMENTO/.test(e || '') && JSON.stringify(await projIds(db, C1)) === antes && !(await exec(db, E1)).c, e);
e = await tentaExec(db, `update public.composicao_dia set projeto_ids = '[]' where id = '${C1}'`);
ok('SQL direto (dono) retira projeto com lançamento: recusado', /EXECUCAO_COM_LANCAMENTO/.test(e || ''), e);
ok('SQL direto exclui composição com lançamento: recusado', /EXECUCAO_COM_LANCAMENTO/.test(await tentaExec(db, `delete from public.composicao_dia where id = '${C1}'`) || ''));
ok('soft delete com lançamento: recusado', /EXECUCAO_COM_LANCAMENTO/.test(await tela(db, `update public.composicao_dia set deleted_at = now() where id = '${C1}'`) || ''));
r = await retirar(db, C1, PE, 'tentativa');
ok('retirar pela tela com lançamento: recusado e nada muda', /EXECUCAO_COM_LANCAMENTO/.test(r.e || '') && JSON.stringify(await projIds(db, C1)) === antes && !(await exec(db, E1)).c, r);
ok('retirar outro projeto (legado) da mesma composição continua possível', (await retirar(db, C1, PJ(2), 'legado saiu')).r
  && JSON.stringify(await projIds(db, C1)) === JSON.stringify([PE]));
ok('cancelar item com lançamento continua recusado', /ITEM_COM_LANCAMENTO/.test((await api(db, `select public.fn_proj_execucao_cancelar_item($1::uuid, 'x') v`, [I_A1])).e || ''));

// ── Rollback ────────────────────────────────────────────────────
const dbR = await novoBanco(true);
erro = await tentaExec(dbR, desfazer);
const restos = (await dbR.query(`select count(*)::int n from pg_proc where proname in ('fn_proj_execucao_dia', 'fn_proj_execucao_retirar_projeto', 'fn_proj_execucao_protege_composicao', 'fn_proj_execucao_soma_atividade')`)).rows[0].n;
const trg = (await dbR.query(`select count(*)::int n from pg_trigger where tgname = 'proj_execucao_protege_composicao_trg'`)).rows[0].n;
const src = async d => (await d.query(`select prosrc from pg_proc where proname = 'fn_proj_execucao_definir_itens'`)).rows[0].prosrc;
const db17a = await novoBanco(false);
ok('rollback remove gatilho e funções novas', erro === null && restos === 0 && trg === 0, { erro, restos, trg });
ok('rollback devolve a definir_itens da 1.7a (mesmo texto)', await src(dbR) === await src(db17a));

if (failed.length) { console.error('proj-execucao-programacao-sql: FALHOU ' + failed.length + '/' + total + '\n  - ' + failed.join('\n  - ')); process.exit(1); }
console.log('proj-execucao-programacao-sql: OK (' + total + ' verificações)');
