// ETAPA 1.4 — testes SQL da migration 20261011200000_proj_wl_estrutura.sql (WL oficial, unicidade, proteção estrutural)
// PGlite com a cadeia real: sessão + fnProg + 1.1 + 1.2 + 1.3 recebimento + confirmação + listagem + bloqueio binário
// de sot_materiais + esta etapa. sot_atividades/sot_materiais/sot_projetos reproduzem a estrutura real de produção
// (constraint única, valor_total gerada, FK em cascata, CHECK de descritivo, RLS "Acesso total", grants de anon).
// Uso: PGLITE_PATH=<pasta com @electric-sql/pglite> XLSX_PATH=<.../xlsx.mjs> node tests/proj-wl-estrutura-sql.test.mjs
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
  console.log('proj-wl-estrutura-sql: SKIP (defina PGLITE_PATH e XLSX_PATH)');
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
const migList = semNotify(ler('20261011120000_proj_lms_rascunhos_listar.sql'));
const migBin = semNotify(ler('20261001130000_sot_materiais_bloqueia_texto_binario.sql'));

const migRaw = ler('20261011200000_proj_wl_estrutura.sql');
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
ok('transação explícita: BEGIN; primeiro, COMMIT; último, sem ROLLBACK',
  codigoLimpo.startsWith('BEGIN;') && codigoLimpo.endsWith('COMMIT;')
  && (codigo.match(/^BEGIN;/gm) || []).length === 1 && (codigo.match(/^COMMIT;/gm) || []).length === 1 && !/\bROLLBACK\b/i.test(codigo));
ok('desfazer é transacional', /^BEGIN;/.test(desfazer) && /COMMIT;$/.test(desfazer));
ok('nenhuma autorização por e-mail', !/auth\.jwt\(\)|auth\.email\(\)|\bemail\b/i.test(codigo));
const codigoSemComentarioTabela = codigo.replace(/COMMENT ON[^;]*;/g, '');
ok('não toca programação/composicao_dia/estoque/almoxarifado/medição/TMA/croqui',
  !/composicao_dia|equipes_disp|prog_projetos_agenda|alm_|estoque|sot_med|\btma\b|portaria|frota|croqui|wl_distribuicao|plano_execucao/i.test(codigoSemComentarioTabela));
ok('não apaga nem altera linha existente de atividades/materiais',
  !/DELETE\s+FROM\s+public\.sot_(atividades|materiais)|UPDATE\s+public\.sot_(atividades|materiais)/i.test(codigo));
const grantsAnon = codigo.match(/^\s*GRANT\b[^;]*\bTO\b[^;]*\banon\b[^;]*;/gim) || [];
ok('anon só recebe EXECUTE nas duas normalizações puras (índices); nada para PUBLIC/service_role',
  grantsAnon.length === 2 && grantsAnon.every(g => /GRANT EXECUTE ON FUNCTION public\.fn_proj_(codigo|texto)_norm\(text\) TO anon;/.test(g))
  && !/^\s*GRANT\b[^;]*\bTO\b[^;]*\b(PUBLIC|service_role)\b/im.test(codigo));
// Condição do dono para o GRANT a anon: as duas normalizações continuam puras (SQL IMMUTABLE STRICT, sem tabela).
const corpoNorm = nome => { const m = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${nome}\\([\\s\\S]*?\\$\\$;`).exec(mig13); return m ? m[0] : ''; };
ok('fn_proj_texto_norm / fn_proj_codigo_norm puras: LANGUAGE sql IMMUTABLE STRICT, sem leitura de tabela nem escrita',
  ['fn_proj_texto_norm', 'fn_proj_codigo_norm'].every(n => {
    const c = corpoNorm(n);
    return /LANGUAGE sql\s+IMMUTABLE\s+STRICT/.test(c) && !/\b(INSERT|UPDATE|DELETE)\b/i.test(c)
      && !/\bFROM\s+(public\.)?(?!\()[a-z_]/i.test(c.replace(/FROM \(SELECT public\.fn_proj_texto_norm\(p_codigo\) AS t\) n/, ''));
  }));
ok('a 1.4 não redefine as normalizações (semântica congelada da 1.3)', !/FUNCTION public\.fn_proj_(codigo|texto)_norm\(\w+ text\)/.test(codigo));
ok('CHECK novo não chama função (avaliado com o privilégio de quem grava, inclusive anon)',
  /sot_atividades_wl_chk CHECK \(\s*\(wl_id IS NULL OR coalesce\(codigo, ''\) ~/.test(codigo) && /sot_materiais_wl_chk CHECK \(\s*\(wl_id IS NULL OR coalesce\(codigo_sap, ''\) ~/.test(codigo));
ok('sot_wl só SELECT para authenticated',
  true
  && /GRANT SELECT ON TABLE public\.sot_wl TO authenticated;/.test(codigo)
  && !/GRANT\s+(INSERT|UPDATE|DELETE|ALL)[^;]*sot_wl/i.test(codigo));
const secdef = (codigo.match(/^SECURITY DEFINER/gm) || []).length;
ok('SECURITY DEFINER sempre com search_path fixo',
  secdef >= 2 && secdef === (codigo.match(/^SECURITY DEFINER\s+SET search_path = public, pg_temp/gm) || []).length);
ok('aplicar autoriza por sot_lms_autorizar_confirmacao (PROJ_CONFIRMAR_LMS, D9)',
  /FUNCTION public\.fn_proj_lms_aplicar_estrutura_nova[\s\S]*sot_lms_autorizar_confirmacao\(v_imp\.projeto_id\)/.test(codigo));
ok('KIT na chave com WL (D1)', (codigo.match(/coalesce\(public\.fn_proj_texto_norm\(kit\), ''\)\)\s+WHERE wl_id IS NOT NULL AND deleted_at IS NULL/g) || []).length === 2);
ok('regra legada recriada como índice parcial (D2)',
  /CREATE UNIQUE INDEX IF NOT EXISTS sot_atividades_projeto_codigo_legado_uidx\s+ON public\.sot_atividades \(projeto_id, codigo\) WHERE wl_id IS NULL;/.test(codigo));
ok('pré-condição relê a constraint legada', /pg_get_constraintdef[\s\S]*'UNIQUE \(projeto_id, codigo\)'/.test(codigo));

// ── Banco ───────────────────────────────────────────────────────
const U = n => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PERFIS = ['admin', 'gestor', 'coordenador', 'supervisor', 'escritorio', 'administrativo', 'equipe', 'diretoria'];
const UID = Object.fromEntries(PERFIS.map((p, i) => [p, U(i + 1)]));
const U_INATIVO = U(901);
const C_ATIVO = 'c0000000-0000-4000-8000-000000000001';
const PJ = n => `b0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const P_EN = PJ(1), P_LEG = PJ(2), P_CONC = PJ(3), P_RASC = PJ(4), P_OUTRO = PJ(5), P_DEL = PJ(6), P_SINT = PJ(7), P_DUP = PJ(8), P_EXC = PJ(9);

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
insert into public.sot_projetos (id, contrato_id, nome, codigo_cliente, deleted_at) values
  ('${P_EN}', '${C_ATIVO}', 'Estrutura nova', 'EN-1', null), ('${P_LEG}', '${C_ATIVO}', 'Com legado', 'LEG-1', null),
  ('${P_CONC}', '${C_ATIVO}', 'Conciliação', 'CC-1', null), ('${P_RASC}', '${C_ATIVO}', 'Só rascunho', 'RS-1', null),
  ('${P_OUTRO}', '${C_ATIVO}', 'Legado de outra obra', 'OUT-1', null), ('${P_DEL}', '${C_ATIVO}', 'Legado a apagar', 'DEL-1', null),
  ('${P_SINT}', '${C_ATIVO}', 'Sintético', 'SI-1', null), ('${P_DUP}', '${C_ATIVO}', 'Duplicado', 'DU-1', null),
  ('${P_EXC}', '${C_ATIVO}', 'Excluído', 'EX-1', now());
create table public.sot_atividades (
  id uuid primary key default gen_random_uuid(), projeto_id uuid references public.sot_projetos(id) on delete cascade,
  codigo text, descricao text not null, unidade text, qtd_prevista numeric(14,3) default 0, valor_unitario numeric(14,4) default 0,
  valor_total numeric(14,2) generated always as (qtd_prevista * valor_unitario) stored,
  qtd_executada numeric(14,3) default 0, qtd_medida numeric(14,3) default 0, qtd_faturada numeric(14,3) default 0,
  ordem_exec integer default 0, etapa text, status text default 'pendente', observacoes text, servico_id text,
  criado_em timestamptz default now(), qtd_viabilizada numeric default 0, deleted_at timestamptz, obs_viabilidade text,
  obs_execucao text, somente_descritivo boolean not null default false,
  constraint sot_atividades_projeto_codigo_unique unique (projeto_id, codigo),
  constraint sot_atividades_descritivo_sem_operacao check ((not somente_descritivo) or ((coalesce(qtd_executada,0) = 0)
    and (coalesce(qtd_medida,0) = 0) and (coalesce(qtd_faturada,0) = 0) and (coalesce(qtd_viabilizada,0) = 0)
    and (coalesce(valor_unitario,0) = 0) and (coalesce(valor_total,0) = 0) and (servico_id is null))));
create index idx_sot_atividades_projeto on public.sot_atividades (projeto_id);
create table public.sot_materiais (
  id uuid primary key default gen_random_uuid(), projeto_id uuid references public.sot_projetos(id) on delete cascade,
  codigo_sap text, descricao text not null, unidade text, qtd_projetada numeric(14,3) default 0,
  qtd_viabilizada numeric(14,3) default 0, qtd_requisitada numeric(14,3) default 0, qtd_entregue numeric(14,3) default 0,
  qtd_aplicada numeric(14,3) default 0, qtd_devolvida numeric(14,3) default 0, qtd_processada_sap numeric(14,3) default 0,
  observacao text, criado_em timestamptz default now(), deleted_at timestamptz, somente_descritivo boolean not null default false,
  constraint sot_materiais_descritivo_sem_operacao check ((not somente_descritivo) or ((coalesce(qtd_viabilizada,0) = 0)
    and (coalesce(qtd_requisitada,0) = 0) and (coalesce(qtd_entregue,0) = 0) and (coalesce(qtd_aplicada,0) = 0)
    and (coalesce(qtd_devolvida,0) = 0) and (coalesce(qtd_processada_sap,0) = 0))));
create index idx_sot_materiais_projeto on public.sot_materiais (projeto_id);
create table public.sot_materiais_historico (id uuid primary key default gen_random_uuid(),
  material_id uuid references public.sot_materiais(id) on delete set null, projeto_id uuid, qtd_aplicada numeric not null default 0);
create table public.servicos_contrato (id uuid primary key default gen_random_uuid(), contrato_id text, codigo text, descricao text, deleted_at timestamptz);
alter table public.sot_projetos enable row level security; alter table public.sot_atividades enable row level security;
alter table public.sot_materiais enable row level security;
create policy "Acesso total" on public.sot_projetos for all to anon, authenticated using (true) with check (true);
create policy "Acesso total" on public.sot_atividades for all to anon, authenticated using (true) with check (true);
create policy "Acesso total" on public.sot_materiais for all to anon, authenticated using (true) with check (true);
insert into public.sot_atividades (projeto_id, codigo, descricao, unidade, qtd_prevista, valor_unitario) values
  ('${P_LEG}', 'X1', 'Atividade legado', 'UN', 2, 10), ('${P_OUTRO}', '5020000092', 'Serviço A', 'UN', 3, 5),
  ('${P_OUTRO}', '5020000093', 'Serviço B', 'UN', 4, 6), ('${P_DEL}', 'D1', 'A apagar', 'UN', 1, 1);
insert into public.sot_materiais (projeto_id, codigo_sap, descricao, unidade, qtd_projetada, deleted_at) values
  ('${P_LEG}', '123', 'Material legado de teste', 'UN', 5, null), ('${P_OUTRO}', '324894', 'Fio', 'M', 10, null),
  ('${P_OUTRO}', '324894', 'Fio (duplicado legado)', 'M', 10, null), ('${P_OUTRO}', '999', 'Excluído', 'UN', 1, now());
create table public.composicao_dia (id uuid primary key default gen_random_uuid(), equipe_id text, data date, projeto_ids text);
create table public.equipes_disp (id uuid primary key default gen_random_uuid(), equipe_id text, data date);
`;

const CADEIA = [migSeg, fnProg, mig11, mig12, mig13, migConf, migList, migBin];
async function novoBanco(migWl = mig) {
  const db = new PGlite();
  await db.exec(BASE);
  for (const m of CADEIA) await db.exec(m);
  if (migWl) await db.exec(migWl);
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
const tenta = async (db, sql, params) => { try { await db.query(sql, params || []); return null; } catch (e) { return { m: e.message, c: e.code }; } };
const tentaExec = async (db, sql) => { try { await db.exec(sql); return null; } catch (e) { try { await db.exec('ROLLBACK'); } catch (_) {} return e.message; } };

// Fixture real e arquivos sintéticos
const fixture = new Uint8Array(fs.readFileSync(path.join(raiz, 'tests', 'fixtures', 'lms', 'modelo-lms-anonimizado.xlsx')));
const esp = JSON.parse(fs.readFileSync(path.join(raiz, 'tests', 'fixtures', 'lms', 'modelo-lms-esperado.json'), 'utf8'));
const arquivoBase = { nome: 'Modelo LMS.xlsx', mime_informado: P.XLSX_MIME, mime_validado: P.XLSX_MIME };
const payloadDe = (bytes, nome) => P.payloadRegistro(P.parseLms(bytes, XLSX),
  { ...arquivoBase, hash_sha256: createHash('sha256').update(bytes).digest('hex'), nome, tamanho: bytes.length });
const payloadFix = payloadDe(fixture, 'Modelo LMS.xlsx');
const sint = (linhas) => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Definição de projeto:', null, null, 'DMP/X'], [], esp.colunas, ...linhas]), 'Planilha1');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
};
const linha = (wl, ft, cod, kit, desc, plan) => [wl, 'WP', ft, cod, kit, 'UN', desc, plan, plan, null, null, null, null, null];
const payloadNaoClass = payloadDe(sint([linha('1', 'I', '324894', 'NK', 'Fio', 1), linha('1', 'I', 'ABC123', 'NK', 'Código estranho', 1)]), 'sint.xlsx');
const payloadDup = payloadDe(sint([linha('1', 'I', '324894', 'NK', 'Fio', 1), linha('1', 'I', '324894', 'NK', 'Fio', 1)]), 'dup.xlsx');

const registrar = (db, proj, pl = payloadFix) => como(db, 'service_role', null, async () =>
  (await db.query(`select public.sot_lms_importacao_registrar($1::uuid, $2::uuid, $3::jsonb, $4::jsonb) v`,
    [UID.gestor, proj, JSON.stringify(pl.p_importacao), JSON.stringify(pl.p_linhas)])).rows[0].v.importacao_id);
const confirmar = (db, uid, imp, modo) => como(db, 'authenticated', uid, async () => {
  try { return { r: (await db.query(`select public.sot_lms_confirmar($1::uuid, $2, null) v`, [imp, modo])).rows[0].v }; }
  catch (e) { return { e: e.message, code: e.code }; }
});
const aplicar = (db, uid, imp, role = 'authenticated') => como(db, role, uid, async () => {
  try { return { r: (await db.query(`select public.fn_proj_lms_aplicar_estrutura_nova($1::uuid) v`, [imp])).rows[0].v }; }
  catch (e) { return { e: e.message, code: e.code }; }
});
const estado = async (db, proj) => (await db.query(`select public.sot_lms_estado_wl_calc($1::uuid) v`, [proj])).rows[0].v;
// md5 só das colunas originais (as colunas novas da 1.4 mudariam o texto da linha mesmo nulas).
const NOVAS = `- 'wl_id' - 'lms_linha_id' - 'ctg' - 'ft' - 'kit'`;
const md5Proj = async (db, proj) => (await db.query(`select
  (select md5(coalesce(string_agg((to_jsonb(t) ${NOVAS})::text, '|' order by t.id), '')) from public.sot_atividades t where t.projeto_id = $1) a,
  (select md5(coalesce(string_agg((to_jsonb(t) ${NOVAS})::text, '|' order by t.id), '')) from public.sot_materiais t where t.projeto_id = $1) m`, [proj])).rows[0];
const conta = async (db, sql, p) => (await db.query(sql, p || [])).rows[0].n;

// Banco "pré-1.4" com os casos de produção, para provar compatibilidade
const dbp = await novoBanco(null);
const impP_EN = await registrar(dbp, P_EN);
const impP_LEG = await registrar(dbp, P_LEG);
await confirmar(dbp, UID.gestor, impP_EN, 'ESTRUTURA_NOVA');
await confirmar(dbp, UID.gestor, impP_LEG, 'ESTRUTURA_NOVA');
const impP_CONC = await registrar(dbp, P_CONC);
await confirmar(dbp, UID.gestor, impP_CONC, 'CONCILIACAO');
const antesP = { en: await estado(dbp, P_EN), conc: await estado(dbp, P_CONC), leg: await md5Proj(dbp, P_LEG), out: await md5Proj(dbp, P_OUTRO),
  nAtiv: await conta(dbp, `select count(*)::int n from public.sot_atividades`), nMat: await conta(dbp, `select count(*)::int n from public.sot_materiais`) };
let erro = await tentaExec(dbp, mig);
ok('aplica sobre a base de produção (EN confirmada sem WL + CONCILIACAO + legado)', erro === null, erro);
ok('compat: ESTRUTURA_NOVA confirmada sem WL vira ESTRUTURA_PENDENTE; CONCILIACAO segue EM_CONCILIACAO',
  antesP.en === 'ESTRUTURADO' && await estado(dbp, P_EN) === 'ESTRUTURA_PENDENTE' && antesP.conc === 'EM_CONCILIACAO'
  && await estado(dbp, P_CONC) === 'EM_CONCILIACAO', { antes: antesP.en, depois: await estado(dbp, P_EN) });
ok('compat: nenhuma linha de atividades/materiais criada, alterada ou removida pela migration',
  JSON.stringify(await md5Proj(dbp, P_LEG)) === JSON.stringify(antesP.leg) && JSON.stringify(await md5Proj(dbp, P_OUTRO)) === JSON.stringify(antesP.out)
  && await conta(dbp, `select count(*)::int n from public.sot_atividades`) === antesP.nAtiv
  && await conta(dbp, `select count(*)::int n from public.sot_materiais`) === antesP.nMat);
ok('compat: colunas novas nulas e 0 WL', await conta(dbp, `select ((select count(*) from public.sot_atividades where wl_id is not null or lms_linha_id is not null or ctg is not null or ft is not null or kit is not null)
  + (select count(*) from public.sot_materiais where wl_id is not null or lms_linha_id is not null or ctg is not null or ft is not null or kit is not null)
  + (select count(*) from public.sot_wl))::int n`) === 0);
erro = await tentaExec(dbp, mig);
ok('reaplica sem erro (idempotente)', erro === null, erro);
ok('constraint legada removida e índice parcial no lugar',
  await conta(dbp, `select count(*)::int n from pg_constraint where conname = 'sot_atividades_projeto_codigo_unique'`) === 0
  && /\(projeto_id, codigo\) WHERE \(wl_id IS NULL\)/.test((await dbp.query(`select indexdef v from pg_indexes where indexname = 'sot_atividades_projeto_codigo_legado_uidx'`)).rows[0].v));

// Catálogo: um serviço do LMS casa 1 vez; outro aparece 2 vezes (ambíguo → sem servico_id)
const linhasServ = payloadFix.p_linhas.filter(l => /^[IR]-/.test(l.codigo_norm || ''));
const codCasa = linhasServ[0].codigo_raw;
const codAmbiguo = linhasServ.find(l => l.codigo_norm !== linhasServ[0].codigo_norm).codigo_raw;
await dbp.query(`insert into public.servicos_contrato (contrato_id, codigo, descricao) values ($1, $2, 'casa'), ($1, $3, 'amb1'), ($1, $3, 'amb2'), ('outro', $2, 'outro contrato')`,
  [C_ATIVO, codCasa, codAmbiguo]);

// Esperado calculado pelo banco a partir das linhas gravadas (independente da função)
const espL = (await dbp.query(`select count(distinct wl_norm)::int wls, count(*) filter (where codigo_norm ~ '^[IR]-')::int serv,
  count(*) filter (where codigo_norm ~ '^[0-9]+$' and ft_norm = 'R')::int mat_r,
  count(*) filter (where codigo_norm ~ '^[0-9]+$' and coalesce(ft_norm, '') <> 'R')::int mat_i
  from public.sot_lms_linhas where importacao_id = $1`, [impP_EN])).rows[0];
ok('fixture tem serviços, materiais de instalação e de retirada', espL.serv > 0 && espL.mat_i > 0 && espL.mat_r > 0 && espL.wls > 1, espL);

// ── Grants ──────────────────────────────────────────────────────
const fpriv = async (role, fn) => (await dbp.query(`select has_function_privilege($1, $2, 'EXECUTE') v`, [role, fn])).rows[0].v;
const FN_AP = 'public.fn_proj_lms_aplicar_estrutura_nova(uuid)';
ok('aplicar: EXECUTE só para authenticated', await fpriv('authenticated', FN_AP) && !(await fpriv('anon', FN_AP)) && !(await fpriv('service_role', FN_AP)));
ok('funções de gatilho e estado sem EXECUTE para anon/authenticated', !(await Promise.all(['anon', 'authenticated'].flatMap(r =>
  ['public.fn_proj_protege_linha_estruturada()', 'public.fn_proj_protege_projeto_estruturado()', 'public.sot_wl_proteger()',
   'public.sot_lms_estado_wl_calc(uuid)'].map(f => fpriv(r, f))))).some(Boolean));
const tpriv = async (role, p) => (await dbp.query(`select has_table_privilege($1, 'public.sot_wl', $2) v`, [role, p])).rows[0].v;
ok('sot_wl: authenticated só SELECT; anon nada', await tpriv('authenticated', 'SELECT') && !(await tpriv('authenticated', 'INSERT'))
  && !(await tpriv('authenticated', 'UPDATE')) && !(await tpriv('authenticated', 'DELETE')) && !(await tpriv('anon', 'SELECT')));
ok('sot_wl: RLS ENABLE + FORCE', (await dbp.query(`select relrowsecurity and relforcerowsecurity v from pg_class where oid = 'public.sot_wl'::regclass`)).rows[0].v);

// ── Recusas antes da aplicação ──────────────────────────────────
let r = await aplicar(dbp, null, impP_EN, 'anon');
ok('anon não executa', r.e && /permission denied/.test(r.e), r);
r = await aplicar(dbp, null, impP_EN);
ok('sem sessão → 42501', r.code === '42501', r);
r = await aplicar(dbp, U_INATIVO, impP_EN);
ok('usuário ERP inativo → 42501', r.code === '42501', r);
r = await aplicar(dbp, UID.supervisor, impP_EN);
ok('supervisor (sem PROJ_CONFIRMAR_LMS) → SEM_PERMISSAO', r.e && /SEM_PERMISSAO/.test(r.e), r);
r = await aplicar(dbp, UID.administrativo, impP_EN);
ok('administrativo (só PROJ_IMPORTAR_LMS) → SEM_PERMISSAO (D9)', r.e && /SEM_PERMISSAO/.test(r.e), r);
r = await aplicar(dbp, UID.gestor, PJ(99));
ok('importação inexistente → P0002', r.code === 'P0002', r);
r = await aplicar(dbp, UID.gestor, impP_CONC);
ok('CONCILIACAO não recebe estrutura nova', r.e && /IMPORTACAO_NAO_ELEGIVEL/.test(r.e), r);
const impRasc = await registrar(dbp, P_RASC);
r = await aplicar(dbp, UID.gestor, impRasc);
ok('RASCUNHO não recebe estrutura', r.e && /IMPORTACAO_NAO_ELEGIVEL/.test(r.e), r);
const legAntes = await md5Proj(dbp, P_LEG);
r = await aplicar(dbp, UID.gestor, impP_LEG);
ok('D7: projeto com legado ativo → PROJETO_COM_LEGADO (atividades 1, materiais 1)', r.e && /PROJETO_COM_LEGADO \(atividades 1, materiais 1\)/.test(r.e), r);
ok('D7: nada criado e legado intacto (sem remoção automática)', JSON.stringify(await md5Proj(dbp, P_LEG)) === JSON.stringify(legAntes)
  && await conta(dbp, `select count(*)::int n from public.sot_wl where projeto_id = $1`, [P_LEG]) === 0 && await estado(dbp, P_LEG) === 'ESTRUTURA_PENDENTE');
const impSint = await registrar(dbp, P_SINT, payloadNaoClass);
await confirmar(dbp, UID.gestor, impSint, 'ESTRUTURA_NOVA');
r = await aplicar(dbp, UID.gestor, impSint);
ok('D3: código fora do padrão → LINHA_NAO_CLASSIFICADA com a linha', r.e && /LINHA_NAO_CLASSIFICADA \(linhas 5\)/.test(r.e), r);
ok('D3: recusa não deixa WL nem linha', await conta(dbp, `select ((select count(*) from public.sot_wl where projeto_id = $1)
  + (select count(*) from public.sot_materiais where projeto_id = $1))::int n`, [P_SINT]) === 0);
const impDup = await registrar(dbp, P_DUP, payloadDup);
await confirmar(dbp, UID.gestor, impDup, 'ESTRUTURA_NOVA');
r = await aplicar(dbp, UID.gestor, impDup);
ok('chave WL+código+FT+KIT repetida no arquivo → LINHAS_REPETIDAS_NA_CHAVE', r.e && /LINHAS_REPETIDAS_NA_CHAVE \(linhas 4,5\)/.test(r.e), r);

// ── Aplicação (fixture real) ────────────────────────────────────
const outroAntes = await md5Proj(dbp, P_OUTRO);
ok('antes de aplicar: ESTRUTURA_PENDENTE', await estado(dbp, P_EN) === 'ESTRUTURA_PENDENTE');
r = await aplicar(dbp, UID.gestor, impP_EN);
ok('aplica: operacao ESTRUTURA_APLICADA e estado ESTRUTURADO', r.r && r.r.operacao === 'ESTRUTURA_APLICADA' && r.r.estado_wl === 'ESTRUTURADO', r);
ok('contagens = linhas do LMS (WLs, serviços, materiais I e R)', r.r && r.r.wls === espL.wls && r.r.atividades === espL.serv
  && r.r.materiais_operacionais === espL.mat_i && r.r.materiais_retirada_descritivos === espL.mat_r, { r: r.r, espL });
ok('cada linha do LMS virou exatamente uma linha ligada à sua WL', await conta(dbp, `select count(*)::int n from public.sot_lms_linhas l
  where l.importacao_id = $1 and (select count(*) from (select lms_linha_id, wl_id from public.sot_atividades union all select lms_linha_id, wl_id from public.sot_materiais) x
    join public.sot_wl w on w.id = x.wl_id where x.lms_linha_id = l.id and w.codigo_norm = l.wl_norm) = 1`, [impP_EN]) === esp.linhas_reais);
const wlOrd = (await dbp.query(`select array_agg(codigo_norm order by ordem) v from public.sot_wl where projeto_id = $1`, [P_EN])).rows[0].v;
ok('WLs com ordem numérica', JSON.stringify(wlOrd) === JSON.stringify([...wlOrd].sort((a, b) => (/^\d+$/.test(a) && /^\d+$/.test(b) ? Number(a) - Number(b) : a < b ? -1 : 1))), wlOrd);
ok('WLs: origem LMS, importação, autoria', await conta(dbp, `select count(*)::int n from public.sot_wl where projeto_id = $1 and origem = 'LMS'
  and importacao_id = $2 and criado_por_auth = $3`, [P_EN, impP_EN, UID.gestor]) === espL.wls);
const ativChk = (await dbp.query(`select bool_and(a.codigo = btrim(l.codigo_raw) and a.descricao = btrim(l.descricao_raw) and a.qtd_prevista = l.qtd_plan
    and a.valor_unitario = coalesce(round(l.valor_ups_item, 4), 0) and a.valor_total = round(a.qtd_prevista * a.valor_unitario, 2)
    and a.ordem_exec = l.ordem and a.ft = btrim(l.ft_raw) and a.ctg is not distinct from nullif(btrim(coalesce(l.ctg_raw, '')), '')
    and a.kit is not distinct from nullif(btrim(coalesce(l.kit_raw, '')), '') and not a.somente_descritivo and a.status = 'pendente') v
  from public.sot_atividades a join public.sot_lms_linhas l on l.id = a.lms_linha_id where a.projeto_id = $1`, [P_EN])).rows[0].v;
ok('atividades: código, descrição, Quant. Plan, valor UPS (D6), valor_total gerado, ordem, CTG/FT/KIT', ativChk === true);
const sid = (await dbp.query(`select a.codigo, a.servico_id from public.sot_atividades a where a.projeto_id = $1 and a.codigo in ($2, $3)`, [P_EN, codCasa, codAmbiguo])).rows;
const sidCasa = (await dbp.query(`select id::text v from public.servicos_contrato where codigo = $1 and contrato_id = $2`, [codCasa, C_ATIVO])).rows[0].v;
ok('servico_id: casa 1 serviço do contrato; ambíguo fica nulo; outro contrato ignorado',
  sid.filter(x => x.codigo === codCasa).every(x => x.servico_id === sidCasa) && sid.filter(x => x.codigo === codAmbiguo).every(x => x.servico_id === null), sid);
const matChk = (await dbp.query(`select bool_and(m.codigo_sap = btrim(l.codigo_raw) and m.qtd_projetada = l.qtd_plan
    and m.somente_descritivo = (l.ft_norm = 'R') and (m.observacao is not null) = (l.ft_norm = 'R')
    and m.qtd_requisitada = 0 and m.qtd_entregue = 0 and m.qtd_aplicada = 0 and m.qtd_viabilizada = 0) v
  from public.sot_materiais m join public.sot_lms_linhas l on l.id = m.lms_linha_id where m.projeto_id = $1`, [P_EN])).rows[0].v;
ok('D4: materiais FT=R = somente_descritivo e marcados na observação; FT=I operacionais; nada requisitado/entregue', matChk === true);
ok('mesmo serviço em WLs diferentes coube (regra legada não bloqueia mais)', await conta(dbp, `select count(*)::int n from (select codigo from public.sot_atividades
  where projeto_id = $1 group by codigo having count(distinct wl_id) > 1) x`, [P_EN]) > 0);
ok('linhas que só diferem pelo KIT coexistem (D1)', await conta(dbp, `select count(*)::int n from (select 1 from public.sot_materiais where projeto_id = $1
  group by wl_id, public.fn_proj_codigo_norm(codigo_sap), coalesce(public.fn_proj_texto_norm(ft), '') having count(*) > 1) x`, [P_EN]) > 0);
const imp = (await dbp.query(`select estrutura_aplicada_em is not null a, estrutura_aplicada_por_auth::text p from public.sot_lms_importacoes where id = $1`, [impP_EN])).rows[0];
ok('importação marcada como aplicada pelo autor', imp.a && imp.p === UID.gestor, imp);
const ev = (await dbp.query(`select count(*)::int n, max(detalhe::text) d from public.sot_lms_importacao_eventos where importacao_id = $1 and tipo_evento = 'ESTRUTURA_APLICADA'`, [impP_EN])).rows[0];
ok('evento ESTRUTURA_APLICADA com contagens', ev.n === 1 && /"wls": *\d+/.test(ev.d) && /materiais_retirada_descritivos/.test(ev.d), ev);
r = await aplicar(dbp, UID.gestor, impP_EN);
ok('idempotência: segunda chamada → JA_APLICADA sem duplicar', r.r && r.r.operacao === 'JA_APLICADA'
  && await conta(dbp, `select count(*)::int n from public.sot_wl where projeto_id = $1`, [P_EN]) === espL.wls
  && await conta(dbp, `select count(*)::int n from public.sot_lms_importacao_eventos where importacao_id = $1 and tipo_evento = 'ESTRUTURA_APLICADA'`, [impP_EN]) === 1, r);
ok('legado de outra obra intacto', JSON.stringify(await md5Proj(dbp, P_OUTRO)) === JSON.stringify(outroAntes));
ok('nada em composicao_dia/equipes_disp', await conta(dbp, `select ((select count(*) from public.composicao_dia) + (select count(*) from public.equipes_disp))::int n`) === 0);
const novaConf = await registrar(dbp, P_EXC === P_EXC ? PJ(10) : PJ(10)).catch(() => null);
ok('confirmar ESTRUTURA_NOVA depois da 1.4 devolve ESTRUTURA_PENDENTE', await (async () => {
  await dbp.query(`insert into public.sot_projetos (id, contrato_id, nome) values ($1, $2, 'novo')`, [PJ(11), C_ATIVO]);
  const i = await registrar(dbp, PJ(11));
  const c = await confirmar(dbp, UID.gestor, i, 'ESTRUTURA_NOVA');
  return c.r && c.r.estado_wl === 'ESTRUTURA_PENDENTE';
})());
void novaConf;

// ── Proteção estrutural (D10) ───────────────────────────────────
const ativEN = (await dbp.query(`select id::text, codigo, descricao, unidade, qtd_prevista from public.sot_atividades where projeto_id = $1 order by ordem_exec limit 1`, [P_EN])).rows[0];
const matI = (await dbp.query(`select id::text, codigo_sap from public.sot_materiais where projeto_id = $1 and not somente_descritivo limit 1`, [P_EN])).rows[0].id;
const matR = (await dbp.query(`select id::text from public.sot_materiais where projeto_id = $1 and somente_descritivo limit 1`, [P_EN])).rows[0].id;
const legAtiv = (await dbp.query(`select id::text from public.sot_atividades where projeto_id = $1 limit 1`, [P_OUTRO])).rows[0].id;
const legMat = (await dbp.query(`select id::text from public.sot_materiais where projeto_id = $1 and deleted_at is null limit 1`, [P_OUTRO])).rows[0].id;
const comoAuth = (sql, p, role = 'authenticated') => como(dbp, role, UID.gestor, () => tenta(dbp, sql, p));
const wlQualquer = (await dbp.query(`select id::text v from public.sot_wl where projeto_id = $1 limit 1`, [P_EN])).rows[0].v;
for (const role of ['authenticated', 'anon']) {
  const rt = (n) => `[${role}] ${n}`;
  ok(rt('operacional em atividade estruturada passa (executada, viabilizada, medida, status, etapa, ordem, observações)'),
    await comoAuth(`update public.sot_atividades set qtd_executada = 1, qtd_viabilizada = 1, qtd_medida = 1, qtd_faturada = 0, status = 'em execução',
      etapa = 'E1', ordem_exec = 99, observacoes = 'ok', obs_execucao = 'ok', obs_viabilidade = 'ok', valor_unitario = valor_unitario where id = $1`, [ativEN.id], role) === null);
  ok(rt('regravar a linha inteira com os mesmos valores passa (tela de edição)'),
    await comoAuth(`update public.sot_atividades set codigo = $2, descricao = $3, unidade = $4, qtd_prevista = $5::numeric, observacoes = 'editado' where id = $1`,
      [ativEN.id, ativEN.codigo, ativEN.descricao, ativEN.unidade, String(ativEN.qtd_prevista)], role) === null);
  for (const [campo, valor] of [['descricao', `'outra'`], ['codigo', `'I-OUTRO'`], ['qtd_prevista', '999'], ['unidade', `'KG'`], ['somente_descritivo', 'true'], ['wl_id', 'null']]) {
    const e = await comoAuth(`update public.sot_atividades set ${campo} = ${valor} where id = $1`, [ativEN.id], role);
    ok(rt(`atividade estruturada: mudar ${campo} recusado`), e && /LINHA_ESTRUTURADA_CAMPO_PROTEGIDO|sot_atividades_wl_chk/.test(e.m), e);
  }
  let e = await comoAuth(`update public.sot_atividades set deleted_at = now() where id = $1`, [ativEN.id], role);
  ok(rt('atividade estruturada: soft-delete recusado'), e && /LINHA_ESTRUTURADA_CAMPO_PROTEGIDO: deleted_at/.test(e.m), e);
  e = await comoAuth(`delete from public.sot_atividades where id = $1`, [ativEN.id], role);
  ok(rt('atividade estruturada: DELETE físico recusado'), e && /LINHA_ESTRUTURADA_SEM_EXCLUSAO/.test(e.m), e);
  ok(rt('material FT=I: entregue/aplicada/requisitada/devolvida/viabilizada/SAP passam'),
    await comoAuth(`update public.sot_materiais set qtd_entregue = 1, qtd_aplicada = 1, qtd_requisitada = 1, qtd_devolvida = 0, qtd_viabilizada = 1,
      qtd_processada_sap = 0 where id = $1`, [matI], role) === null);
  // observação de material: anon já é recusado HOJE pelo gatilho anti-binário (sem EXECUTE em cena_sot_texto_binario);
  // a paridade antes × depois cobre isso. authenticated passa.
  if (role === 'authenticated') ok(rt('material FT=I: observação passa'),
    await comoAuth(`update public.sot_materiais set observacao = 'obs' where id = $1`, [matI], role) === null);
  e = await comoAuth(`update public.sot_materiais set codigo_sap = '111' where id = $1`, [matI], role);
  // anon: o gatilho anti-binário (já existente) recusa antes por falta de EXECUTE — recusado de qualquer forma.
  ok(rt('material estruturado: mudar código recusado'), e && /LINHA_ESTRUTURADA_CAMPO_PROTEGIDO: codigo_sap|cena_sot_texto_binario/.test(e.m), e);
  e = await comoAuth(`update public.sot_materiais set qtd_projetada = 1 where id = $1`, [matI], role);
  ok(rt('material estruturado: mudar quantidade projetada recusado (soma do importador antigo)'), e && /qtd_projetada/.test(e.m), e);
  e = await comoAuth(`update public.sot_materiais set deleted_at = now() where id = $1`, [matI], role);
  ok(rt('material estruturado: soft-delete recusado'), e && /deleted_at/.test(e.m), e);
  e = await comoAuth(`delete from public.sot_materiais where id = $1`, [matI], role);
  ok(rt('material estruturado: DELETE físico (fallback do sbDelete) recusado'), e && /LINHA_ESTRUTURADA_SEM_EXCLUSAO/.test(e.m), e);
  for (const col of ['qtd_requisitada', 'qtd_entregue', 'qtd_aplicada', 'qtd_viabilizada', 'qtd_devolvida', 'qtd_processada_sap']) {
    e = await comoAuth(`update public.sot_materiais set ${col} = 1 where id = $1`, [matR], role);
    ok(rt(`D4: retirada (FT=R) não recebe ${col}`), e && /sot_materiais_descritivo_sem_operacao/.test(e.m), e);
  }
  e = await comoAuth(`insert into public.sot_atividades (projeto_id, codigo, descricao, wl_id, lms_linha_id)
    select $1, 'I-NOVO', 'x', wl_id, lms_linha_id from public.sot_atividades where id = $2`, [P_EN, ativEN.id], role);
  ok(rt('INSERT com wl_id/lms_linha_id recusado'), e && /WL_SO_POR_FUNCAO/.test(e.m), e);
  e = await comoAuth(`insert into public.sot_materiais (projeto_id, codigo_sap, descricao, kit) values ($1, '1', 'x', 'NK')`, [P_OUTRO], role);
  ok(rt('INSERT com ctg/ft/kit recusado'), e && /WL_SO_POR_FUNCAO: kit|cena_sot_texto_binario/.test(e.m), e);
  e = await comoAuth(`update public.sot_atividades set wl_id = $2::uuid where id = $1`, [legAtiv, wlQualquer], role);
  ok(rt('linha legada não recebe WL pela tela'), e && /WL_SO_POR_FUNCAO: wl_id/.test(e.m), e);
  ok(rt('linha legada: editar campo estrutural numérico/atividade continua livre'),
    await comoAuth(`update public.sot_atividades set descricao = descricao || '.', qtd_prevista = qtd_prevista + 1 where id = $1`, [legAtiv], role) === null
    && await comoAuth(`update public.sot_materiais set qtd_projetada = qtd_projetada + 1 where id = $1`, [legMat], role) === null);
}
ok('legado: INSERT normal (_sotLancarPendentes / novo material / atividade automática) continua',
  await comoAuth(`insert into public.sot_atividades (projeto_id, codigo, descricao, unidade, qtd_prevista, servico_id, somente_descritivo, status)
    values ($1, '5029999999', 'nova', 'UN', 0, null, false, 'pendente')`, [P_OUTRO]) === null
  && await comoAuth(`insert into public.sot_materiais (projeto_id, codigo_sap, descricao, unidade, qtd_projetada) values ($1, '324894', 'Fio 3', 'M', 1)`, [P_OUTRO]) === null);
let e2 = await comoAuth(`insert into public.sot_atividades (projeto_id, codigo, descricao) values ($1, '5020000092', 'duplicada')`, [P_OUTRO]);
ok('legado: (projeto, código) duplicado continua recusado', e2 && /sot_atividades_projeto_codigo_legado_uidx/.test(e2.m), e2);
await dbp.query(`insert into public.sot_atividades (projeto_id, codigo, descricao, deleted_at) values ($1, 'DEL-1', 'excluída', now())`, [P_OUTRO]);
e2 = await comoAuth(`insert into public.sot_atividades (projeto_id, codigo, descricao) values ($1, 'DEL-1', 'reusa código')`, [P_OUTRO]);
ok('legado: regra continua contando linha excluída (igual à constraint original)', e2 && /legado_uidx/.test(e2.m), e2);
ok('legado: soft-delete e DELETE físico continuam livres',
  await comoAuth(`update public.sot_materiais set deleted_at = now() where id = $1`, [legMat]) === null
  && await comoAuth(`delete from public.sot_atividades where id = $1`, [legAtiv]) === null);
e2 = await comoAuth(`delete from public.sot_projetos where id = $1`, [P_EN]);
ok('exclusão de projeto com estrutura recusada (cascata)', e2 && /PROJETO_ESTRUTURADO_SEM_EXCLUSAO/.test(e2.m), e2);
ok('exclusão de projeto legado continua (cascata apaga as linhas legadas)',
  await comoAuth(`delete from public.sot_projetos where id = $1`, [P_DEL]) === null
  && await conta(dbp, `select count(*)::int n from public.sot_atividades where projeto_id = $1`, [P_DEL]) === 0);
for (const t of ['sot_atividades', 'sot_materiais']) {
  e2 = await comoAuth(`truncate public.${t} cascade`, []);
  ok(`TRUNCATE ${t} por authenticated recusado com estrutura`, e2 && /TRUNCATE recusado|LINHA_ESTRUTURADA_SEM_EXCLUSAO/.test(e2.m), e2);
}
ok('backend (dono / função SECURITY DEFINER) não é bloqueado pelo gatilho',
  await tenta(dbp, `update public.sot_atividades set observacoes = 'dono' where id = $1`, [ativEN.id]) === null);
e2 = await tenta(dbp, `delete from public.sot_wl where projeto_id = $1`, [P_EN]);
ok('sot_wl: nem o dono apaga WL', e2 && /WL_SO_POR_FUNCAO/.test(e2.m), e2);
e2 = await tenta(dbp, `update public.sot_wl set codigo = 'X' where projeto_id = $1`, [P_EN]);
ok('sot_wl: WL não é reescrita', e2 && /WL_SO_POR_FUNCAO/.test(e2.m), e2);
e2 = await como(dbp, 'authenticated', UID.gestor, () => tenta(dbp, `insert into public.sot_wl (projeto_id, codigo, origem, ordem, criado_por_auth) values ($1, '9', 'MANUAL', 1, $2)`, [P_OUTRO, UID.gestor]));
ok('sot_wl: authenticated não insere', e2 && /permission denied/.test(e2.m), e2);
ok('sot_wl: authenticated lê', (await como(dbp, 'authenticated', UID.gestor, () => dbp.query(`select count(*)::int n from public.sot_wl where projeto_id = $1`, [P_EN]))).rows[0].n === espL.wls);
e2 = await tenta(dbp, `update public.sot_lms_importacoes set estrutura_aplicada_em = null, estrutura_aplicada_por_auth = null where id = $1`, [impP_EN]);
ok('marca de estrutura aplicada só muda por função controlada', e2 && /função controlada/.test(e2.m), e2);

// ── Paridade do legado: mesmos comandos das telas, antes × depois da 1.4, como anon e authenticated ──
const LEGADO_CMDS = [
  ['PLPT/lançamento: executada', `update public.sot_atividades set qtd_executada = 1, status = 'em execução' where projeto_id = '${P_OUTRO}' and codigo = '5020000092'`],
  ['edição de atividade (regrava tudo)', `update public.sot_atividades set codigo = codigo, descricao = 'Serviço A2', unidade = 'UN', qtd_prevista = 9, valor_unitario = 7, etapa = 'E', ordem_exec = 2, observacoes = 'o' where projeto_id = '${P_OUTRO}' and codigo = '5020000092'`],
  ['almoxarifado: entregue', `update public.sot_materiais set qtd_entregue = 2 where projeto_id = '${P_OUTRO}' and codigo_sap = '324894'`],
  ['edição de material (texto)', `update public.sot_materiais set codigo_sap = '324894', descricao = 'Fio editado', unidade = 'M', qtd_projetada = 11, observacao = 'x' where projeto_id = '${P_OUTRO}' and codigo_sap = '324894'`],
  ['sotConfirmarImportacao: soma na quantidade', `update public.sot_materiais set qtd_projetada = qtd_projetada + 1 where projeto_id = '${P_OUTRO}' and codigo_sap = '324894'`],
  ['_sotLancarPendentes: nova atividade', `insert into public.sot_atividades (projeto_id, codigo, descricao, unidade, qtd_prevista, valor_unitario, ordem_exec, status, somente_descritivo) values ('${P_OUTRO}', '5021111111', 'nova', 'UN', 1, 1, 1, 'pendente', false)`],
  ['novo material', `insert into public.sot_materiais (projeto_id, codigo_sap, descricao, unidade, qtd_projetada) values ('${P_OUTRO}', '777', 'novo', 'UN', 1)`],
  ['atividade duplicada (regra legada)', `insert into public.sot_atividades (projeto_id, codigo, descricao) values ('${P_OUTRO}', '5020000093', 'dup')`],
  ['sbDelete soft (material)', `update public.sot_materiais set deleted_at = now() where projeto_id = '${P_OUTRO}' and codigo_sap = '999'`],
  ['sbDelete físico (atividade)', `delete from public.sot_atividades where projeto_id = '${P_OUTRO}' and codigo = '5020000093'`],
  ['excluir projeto legado (cascata)', `delete from public.sot_projetos where id = '${P_DEL}'`]
];
const resultadoLegado = async (dbx, role) => {
  const out = [];
  for (const [nome, sql] of LEGADO_CMDS) {
    const e = await como(dbx, role, role === 'anon' ? null : UID.gestor, () => tenta(dbx, sql));
    out.push(nome + ': ' + (e ? 'ERRO ' + e.c : 'ok'));
  }
  return out;
};
for (const role of ['authenticated', 'anon']) {
  const pre = await resultadoLegado(await novoBanco(null), role);
  const pos = await resultadoLegado(await novoBanco(), role);
  ok(`paridade do legado (${role}): 1.4 não muda nenhum resultado das telas`, JSON.stringify(pre) === JSON.stringify(pos), { pre, pos });
  if (role === 'authenticated') ok('paridade (authenticated): fluxos legados passam e a duplicata continua recusada',
    pos.filter(x => /ERRO/.test(x)).length === 1 && /atividade duplicada.*ERRO 23505/.test(pos.join('|')), pos);
}

// ── Rollback ────────────────────────────────────────────────────
erro = await tentaExec(dbp, desfazer);
ok('rollback aborta quando já existe estrutura aplicada', erro && /ROLLBACK ABORTADO/.test(erro), erro);
const dbr = await novoBanco();
const impR = await registrar(dbr, P_EN);
await confirmar(dbr, UID.gestor, impR, 'ESTRUTURA_NOVA');
erro = await tentaExec(dbr, desfazer);
ok('rollback sem estrutura aplicada roda', erro === null, erro);
ok('rollback recria a constraint original com o mesmo nome e definição',
  (await dbr.query(`select pg_get_constraintdef(oid) v from pg_constraint where conname = 'sot_atividades_projeto_codigo_unique'`)).rows[0]?.v === 'UNIQUE (projeto_id, codigo)');
const restoRb = (await dbr.query(`select (select count(*) from information_schema.tables where table_name = 'sot_wl')::int t,
    (select count(*) from information_schema.columns where table_name in ('sot_atividades', 'sot_materiais', 'sot_lms_importacoes')
       and column_name in ('wl_id', 'lms_linha_id', 'ctg', 'ft', 'kit', 'estrutura_aplicada_em', 'estrutura_aplicada_por_auth'))::int c,
    (select count(*) from pg_trigger where tgname in ('trg_sot_atividades_protege_estrutura', 'trg_sot_materiais_protege_estrutura',
       'trg_sot_atividades_protege_truncate', 'trg_sot_materiais_protege_truncate', 'trg_sot_projetos_protege_estrutura'))::int g,
    has_function_privilege('anon', 'public.fn_proj_codigo_norm(text)', 'EXECUTE') a`)).rows[0];
ok('rollback remove sot_wl, colunas, gatilhos e o EXECUTE de anon; estado volta à regra da confirmação',
  restoRb.t === 0 && restoRb.c === 0 && restoRb.g === 0 && restoRb.a === false && await estado(dbr, P_EN) === 'ESTRUTURADO',
  { ...restoRb, estado: await estado(dbr, P_EN) });
erro = await tentaExec(dbr, mig);
ok('migration reaplica depois do rollback', erro === null && await estado(dbr, P_EN) === 'ESTRUTURA_PENDENTE', erro);

// ── Mutação — sabotagens que os testes precisam detectar ────────
const mut = async (nome, transform, prova) => {
  const s = transform(mig);
  if (s === mig) { ok(`${nome} (sabotagem não alterou o código)`, false); return; }
  let det = false, err = null;
  try {
    const d = await novoBanco(s);
    const i = await registrar(d, P_EN);
    await confirmar(d, UID.gestor, i, 'ESTRUTURA_NOVA');
    det = await prova(d, i);
  } catch (e) { err = e.message; }
  ok(nome, det === true, err);
};
const idAtiv = async d => (await d.query(`select id::text from public.sot_atividades where projeto_id = $1 and wl_id is not null limit 1`, [P_EN])).rows[0].id;
await mut('M1 sem comparação de campo estrutural → descrição de linha WL mudaria', s => s.replace(
  /FOREACH v_col IN ARRAY v_estrut LOOP[\s\S]*?END LOOP;/, ''), async (d, i) => {
  await aplicar(d, UID.gestor, i); const a = await idAtiv(d);
  return (await como(d, 'authenticated', UID.gestor, () => tenta(d, `update public.sot_atividades set descricao = 'x' where id = $1`, [a]))) === null; });
await mut('M2 DELETE liberado → linha WL seria apagada', s => s.replace(
  "IF TG_OP = 'DELETE' THEN\n    RAISE EXCEPTION '%: linha estruturada", "IF TG_OP = 'DELETE' THEN\n    RETURN OLD;\n    RAISE EXCEPTION '%: linha estruturada"), async (d, i) => {
  await aplicar(d, UID.gestor, i); const a = await idAtiv(d);
  return (await como(d, 'authenticated', UID.gestor, () => tenta(d, `delete from public.sot_atividades where id = $1`, [a]))) === null; });
await mut('M3 sem KIT na chave → LMS real não aplica', s => s.replace(
  /\(projeto_id, wl_id, public\.fn_proj_codigo_norm\(codigo_sap\),\s*coalesce\(public\.fn_proj_texto_norm\(ft\), ''\), coalesce\(public\.fn_proj_texto_norm\(kit\), ''\)\)/,
  "(projeto_id, wl_id, public.fn_proj_codigo_norm(codigo_sap), coalesce(public.fn_proj_texto_norm(ft), ''))"), async (d, i) => {
  const x = await aplicar(d, UID.gestor, i); return !!(x.e && /duplicate key|unique/i.test(x.e)); });
await mut('M4 sem checagem de legado → projeto com legado receberia estrutura', s => s.replace(
  'IF v_leg_ativ > 0 OR v_leg_mat > 0 THEN', 'IF false THEN'), async (d) => {
  const i2 = await registrar(d, P_LEG); await confirmar(d, UID.gestor, i2, 'ESTRUTURA_NOVA');
  const x = await aplicar(d, UID.gestor, i2); return !!(x.r && x.r.operacao === 'ESTRUTURA_APLICADA'); });
await mut('M5 FT=R operacional → retirada entraria em requisição', s => s.replace(
  "coalesce(l.ft_norm = 'R', false)", 'false'), async (d, i) => {
  await aplicar(d, UID.gestor, i);
  return (await conta(d, `select count(*)::int n from public.sot_materiais where projeto_id = $1 and ft = 'R' and not somente_descritivo`, [P_EN])) > 0; });
await mut('M6 autorização trocada por PROJ_IMPORTAR_LMS → administrativo aplicaria', s => s.replace(
  'v_motivo := public.sot_lms_autorizar_confirmacao(v_imp.projeto_id);', 'v_motivo := public.sot_lms_autorizar(v_imp.projeto_id);'), async (d, i) => {
  const x = await aplicar(d, UID.administrativo, i); return !!(x.r && x.r.operacao === 'ESTRUTURA_APLICADA'); });
await mut('M7 sem gatilho em sot_projetos → cascata apagaria a estrutura', s => s.replace(
  /CREATE TRIGGER trg_sot_projetos_protege_estrutura[^;]*;/, ''), async (d, i) => {
  await aplicar(d, UID.gestor, i);
  const e = await como(d, 'authenticated', UID.gestor, () => tenta(d, `delete from public.sot_projetos where id = $1`, [P_EN]));
  return e === null && (await conta(d, `select count(*)::int n from public.sot_atividades where projeto_id = $1`, [P_EN])) === 0; });
await mut('M8 campo operacional na lista protegida → executado seria bloqueado', s => s.replace(
  "v_estrut := ARRAY['projeto_id', 'codigo', ", "v_estrut := ARRAY['qtd_executada', 'projeto_id', 'codigo', "), async (d, i) => {
  await aplicar(d, UID.gestor, i); const a = await idAtiv(d);
  return (await como(d, 'authenticated', UID.gestor, () => tenta(d, `update public.sot_atividades set qtd_executada = 1 where id = $1`, [a]))) !== null; });
await mut('M9 sem ESTRUTURA_PENDENTE → confirmada sem WL pareceria ESTRUTURADO', s => s.replace(
  "IF v_modo = 'ESTRUTURA_NOVA' AND v_estrutura IS NULL THEN", 'IF false THEN'), async (d) => (await estado(d, P_EN)) === 'ESTRUTURADO');
await mut('M10 sem regra legada → (projeto, código) duplicado passaria', s => s.replace(
  /CREATE UNIQUE INDEX IF NOT EXISTS sot_atividades_projeto_codigo_legado_uidx[^;]*;/, ''), async (d) =>
  (await como(d, 'authenticated', UID.gestor, () => tenta(d, `insert into public.sot_atividades (projeto_id, codigo, descricao) values ($1, '5020000092', 'dup')`, [P_OUTRO]))) === null);
await mut('M11 sem idempotência nem trava de WL existente → segunda aplicação falharia/duplicaria', s => s.replace(
  'IF v_imp.estrutura_aplicada_em IS NOT NULL THEN', 'IF false THEN').replace(
  'IF EXISTS (SELECT 1 FROM public.sot_wl w WHERE w.projeto_id = v_imp.projeto_id AND w.cancelada_em IS NULL) THEN', 'IF false THEN'), async (d, i) => {
  await aplicar(d, UID.gestor, i); const x = await aplicar(d, UID.gestor, i); return !(x.r && x.r.operacao === 'JA_APLICADA'); });

if (failed.length) {
  console.log(`proj-wl-estrutura-sql: FALHOU ${failed.length}/${total}`);
  for (const f of failed) console.log('  - ' + f);
  process.exit(1);
}
console.log(`proj-wl-estrutura-sql: OK (${total} verificações)`);
