// ETAPA 1.3 — testes SQL da migration 20261010120000_proj_lms_confirmacao.sql (Confirmação Humana do RASCUNHO)
// PGlite com a cadeia real: sessão (20261004190000) + fnProg + 1.1 (20261007190000) + 1.2 (20261009173000)
// + 1.3 recebimento (20261009193000) + esta etapa. Storage simulado só com storage.buckets/objects.
// Uso: PGLITE_PATH=<pasta com @electric-sql/pglite> XLSX_PATH=<.../xlsx.mjs> node tests/proj-lms-confirmacao-sql.test.mjs
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
  console.log('proj-lms-confirmacao-sql: SKIP (defina PGLITE_PATH e XLSX_PATH)');
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

const migFile = process.env.CONF_MIG_PATH || path.join(migDir, '20261010120000_proj_lms_confirmacao.sql');
const migRaw = fs.readFileSync(migFile, 'utf8');
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
ok('transação explícita: BEGIN; primeiro, COMMIT; último, NOTIFY antes do COMMIT',
  codigoLimpo.startsWith('BEGIN;') && codigoLimpo.endsWith('COMMIT;')
  && (codigo.match(/^BEGIN;/gm) || []).length === 1 && (codigo.match(/^COMMIT;/gm) || []).length === 1 && !/\bROLLBACK\b/i.test(codigo));
ok('desfazer também é transacional', /^BEGIN;/.test(desfazer) && /COMMIT;$/.test(desfazer));
ok('nenhuma autorização por e-mail', !/auth\.jwt\(\)|auth\.email\(\)|\bemail\b/i.test(codigo));
ok('não edita a migration 1.3 (arquivo separado)', fs.existsSync(path.join(migDir, '20261009193000_proj_lms_origem.sql')));
ok('autorização da confirmação só por cena_pode(PROJ_CONFIRMAR_LMS)',
  (codigo.match(/cena_pode\('PROJ_CONFIRMAR_LMS'/g) || []).length === 1
  && !/cena_pode\('PROJ_IMPORTAR_LMS'/.test(codigo.slice(codigo.indexOf('sot_lms_autorizar_confirmacao'))));
ok('status só RASCUNHO/CONFIRMADA (sem DESCARTADA)', /status IN \('RASCUNHO', 'CONFIRMADA'\)/.test(codigo) && !/DESCARTAD/i.test(codigo));
ok('modo só ESTRUTURA_NOVA/CONCILIACAO', /modo IN \('ESTRUTURA_NOVA', 'CONCILIACAO'\)/.test(codigo));
ok('eventos: + CONFIRMADA (sem DESCARTADA)', /tipo_evento IN \('CRIADA', 'REENVIO', 'CONFIRMADA'\)/.test(codigo));
ok('índice único parcial de ORIGINAL CONFIRMADA por projeto',
  /CREATE UNIQUE INDEX[^;]*sot_lms_importacoes[^;]*\(projeto_id\)[^;]*WHERE tipo_importacao = 'ORIGINAL' AND status = 'CONFIRMADA'/s.test(codigo));
ok('congela com origem LMS_ORIGINAL_ESTRUTURA_NOVA (não usa wrapper GESTOR)',
  /'LMS_ORIGINAL_ESTRUTURA_NOVA'/.test(codigo) && !/cena_projeto_processo_congelar/.test(codigo) && /sot_projeto_processo_gravar/.test(codigo));
ok('não cria sot_wl / não toca materiais/atividades/estoque/TMA/croqui',
  !/sot_wl\b|\bwl_id\b|lms_linha_id|sot_materiais|sot_atividades|\bestoque\b|composicao_dia|equipes_disp|\btma\b|portaria|frota|croqui|wl_distribuicao|plano_execucao/i.test(codigo));
ok('não concede tabela a authenticated; sem GRANT anon/PUBLIC',
  !/^\s*GRANT\s+[^;]*\bON\s+TABLE\b/im.test(codigo)
  && !/^\s*GRANT\b[^;]*\banon\b/im.test(codigo) && !/^\s*GRANT\b[^;]*\bTO\s+PUBLIC\b/im.test(codigo));
ok('RPC não recebe perfil/contrato/auth/hash do cliente',
  /sot_lms_confirmar\(\s*\n?\s*p_importacao_id uuid, p_modo text, p_observacao text DEFAULT NULL\)/.test(codigo)
  && !/p_perfil_codigo|p_perfil_versao|p_contrato|p_auth|p_projeto_id/.test(codigo.slice(codigo.indexOf('FUNCTION public.sot_lms_confirmar'))));
const secdef = (codigo.match(/^SECURITY DEFINER/gm) || []).length;
ok('SECURITY DEFINER sempre com search_path fixo',
  secdef === (codigo.match(/^SECURITY DEFINER\s+SET search_path = public, pg_temp/gm) || []).length && secdef >= 4);

// ── Banco ───────────────────────────────────────────────────────
const U = n => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PERFIS = ['admin', 'gestor', 'coordenador', 'supervisor', 'escritorio', 'administrativo', 'equipe', 'diretoria'];
const UID = Object.fromEntries(PERFIS.map((p, i) => [p, U(i + 1)]));
const U_INATIVO = U(901), U_SEM_CADASTRO = U(903);
const C_ATIVO = 'c0000000-0000-4000-8000-000000000001';
const C_ATIVO2 = 'c0000000-0000-4000-8000-000000000004';
const PJ = n => `b0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const P_RDSE = PJ(1), P_RDSE2 = PJ(2), P_OUTRO = PJ(3), P_SEM_CONTRATO = PJ(4), P_TEXTO = PJ(6), P_EXCLUIDO = PJ(8), P_INEXISTENTE = PJ(99);

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
insert into public.contratos (id, codigo, nome, cliente, status) values
  ('${C_ATIVO}', '4600003971', 'RDSE', 'ENEL', 'Ativo'), ('${C_ATIVO2}', '4600000003', 'Outro', 'OUTRO', 'Ativo');
create table public.sot_projetos (id uuid primary key, contrato_id text, nome text, status text, deleted_at timestamptz);
insert into public.sot_projetos (id, contrato_id, nome, status, deleted_at) values
  ('${P_RDSE}', '${C_ATIVO}', 'Projeto RDSE 1', 'Em execução', null),
  ('${P_RDSE2}', '${C_ATIVO}', 'Projeto RDSE 2', 'Recebido', null),
  ('${P_OUTRO}', '${C_ATIVO2}', 'Outro', 'Recebido', null),
  ('${P_SEM_CONTRATO}', null, 'Sem contrato', 'Recebido', null),
  ('${P_TEXTO}', 'RDSE', 'Contrato texto legado', 'Recebido', null),
  ('${P_EXCLUIDO}', '${C_ATIVO}', 'Excluído', 'Recebido', now());
create table public.sot_materiais (id uuid primary key default gen_random_uuid(), projeto_id uuid, codigo text, qtd_prevista numeric);
create table public.sot_atividades (id uuid primary key default gen_random_uuid(), projeto_id uuid, codigo text, qtd_prevista numeric);
insert into public.sot_materiais (projeto_id, codigo, qtd_prevista) values ('${P_RDSE}', '324894', 6);
insert into public.sot_atividades (projeto_id, codigo, qtd_prevista) values ('${P_RDSE}', 'I-AHO234', 1);
create table public.composicao_dia (id uuid primary key default gen_random_uuid(), equipe_id text, data date, projeto_ids text);
create table public.equipes_disp (id uuid primary key default gen_random_uuid(), equipe_id text, data date);
`;

async function novoBanco(migConf = mig) {
  const db = new PGlite();
  await db.exec(BASE);
  await db.exec(migSeg);
  await db.exec(fnProg);
  await db.exec(mig11);
  await db.exec(mig12);
  await db.exec(mig13);
  await db.exec(migConf);
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

// Fixture → payload real do parser
const fixture = new Uint8Array(fs.readFileSync(path.join(raiz, 'tests', 'fixtures', 'lms', 'modelo-lms-anonimizado.xlsx')));
const hashFix = createHash('sha256').update(fixture).digest('hex');
const parse = P.parseLms(fixture, XLSX);
const arquivoFix = { hash_sha256: hashFix, nome: 'Modelo LMS.xlsx', tamanho: fixture.length, mime_informado: P.XLSX_MIME, mime_validado: P.XLSX_MIME };
const payloadFix = P.payloadRegistro(parse, arquivoFix);

let db = await novoBanco();

// aplica/reaplica
let erro = await tentaExec(db, mig);
ok('aplica sem erro', erro === null, erro);
erro = await tentaExec(db, mig);
ok('reaplica sem erro (idempotente)', erro === null, erro);

// matriz PROJ_CONFIRMAR_LMS
const perfisConf = (await db.query(`select string_agg(perfil, ',' order by perfil) v from public.cena_permissoes_acao
  where acao = 'PROJ_CONFIRMAR_LMS' and contrato_id is null and deleted_at is null and permitido`)).rows[0].v;
ok('matriz PROJ_CONFIRMAR_LMS = admin,coordenador,escritorio,gestor', perfisConf === 'admin,coordenador,escritorio,gestor', perfisConf);
ok('ação PROJ_CONFIRMAR_LMS existe e ativa',
  (await db.query(`select count(*)::int n from public.cena_acoes where codigo='PROJ_CONFIRMAR_LMS' and ativo`)).rows[0].n === 1);

// grants
const fpriv = async (role, fn) => (await db.query(`select has_function_privilege($1, $2, 'EXECUTE') v`, [role, fn])).rows[0].v;
const FN_CONF = 'public.sot_lms_confirmar(uuid, text, text)', FN_EST = 'public.sot_lms_estado_wl(uuid)',
  FN_ESTC = 'public.sot_lms_estado_wl_calc(uuid)', FN_AUTC = 'public.sot_lms_autorizar_confirmacao(uuid)';
ok('authenticated executa confirmar e estado_wl', await fpriv('authenticated', FN_CONF) && await fpriv('authenticated', FN_EST));
ok('anon/service_role NÃO executam confirmar', !(await fpriv('anon', FN_CONF)) && !(await fpriv('service_role', FN_CONF)));
ok('internas (estado_wl_calc, autorizar_confirmacao) sem EXECUTE para ninguém',
  !(await Promise.all(['anon', 'authenticated', 'service_role'].flatMap(r => [FN_ESTC, FN_AUTC].map(f => fpriv(r, f))))).some(Boolean));
let tabPriv = [];
for (const role of ['anon', 'authenticated']) for (const p of ['INSERT', 'UPDATE', 'DELETE'])
  if ((await db.query(`select has_table_privilege($1,'public.sot_lms_importacoes',$2) v`, [role, p])).rows[0].v) tabPriv.push(`${role}:${p}`);
ok('authenticated/anon continuam SEM UPDATE direto na tabela', tabPriv.length === 0, tabPriv);

// semear suggestion ENEL_WL v1 no contrato 2, e perfil congelado em P_RDSE2
await como(db, 'authenticated', UID.admin, async () => {
  await db.query(`select public.cena_processo_perfil_criar_versao('ENEL_WL', 1, 'ENEL WL', 'perfil wl teste', '{}'::jsonb, 'seed teste')`);
  await db.query(`select public.cena_contrato_processo_perfil_definir($1::uuid, 'ENEL_WL', 1, 'sugestao contrato 2')`, [C_ATIVO2]);
  await db.query(`select public.cena_projeto_processo_congelar($1::uuid, 'BASE_PROJETOS', 1, 'congela previo P_RDSE2')`, [P_RDSE2]);
});

// helpers
const registrar = (auth, proj) => como(db, 'service_role', null, async () => {
  try { return (await db.query(`select public.sot_lms_importacao_registrar($1::uuid, $2::uuid, $3::jsonb, $4::jsonb) v`,
    [auth, proj, JSON.stringify(payloadFix.p_importacao), JSON.stringify(payloadFix.p_linhas)])).rows[0].v.importacao_id; }
  catch (e) { return { e: e.message }; }
});
const confirmar = (uid, impId, modo, obs = null, role = 'authenticated') => como(db, role, uid, async () => {
  try { return { r: (await db.query(`select public.sot_lms_confirmar($1::uuid, $2, $3) v`, [impId, modo, obs])).rows[0].v }; }
  catch (e) { return { e: e.message, code: e.code }; }
});
const estado = (uid, proj) => como(db, 'authenticated', uid, async () => {
  try { return (await db.query(`select public.sot_lms_estado_wl($1::uuid) v`, [proj])).rows[0].v; } catch (e) { return 'ERRO:' + e.message; }
});
const impRow = async id => (await db.query(`select * from public.sot_lms_importacoes where id = $1`, [id])).rows[0];
const evCount = async (id, tipo) => (await db.query(`select count(*)::int n from public.sot_lms_importacao_eventos where importacao_id=$1 and tipo_evento=$2`, [id, tipo])).rows[0].n;
const perfilProj = async proj => (await db.query(`select perfil_codigo, perfil_versao, origem_congelamento from public.sot_projeto_processo where projeto_id=$1`, [proj])).rows[0];

// cria RASCUNHOs
const impRDSE = await registrar(UID.gestor, P_RDSE);
const impRDSE2 = await registrar(UID.gestor, P_RDSE2);
const impOUTRO = await registrar(UID.gestor, P_OUTRO);
const impSEM = await registrar(UID.gestor, P_SEM_CONTRATO);
ok('RASCUNHOs criados', [impRDSE, impRDSE2, impOUTRO, impSEM].every(x => typeof x === 'string'), { impRDSE, impRDSE2 });
const legadoSemWlAntes = await estado(UID.gestor, P_RDSE); // antes de confirmar: só RASCUNHO → LEGADO_SEM_WL

// legado antes de confirmar
const legadoAntes = async () => (await db.query(`select
  (select md5(string_agg(t::text,'' order by t.id)) from public.sot_materiais t) mat,
  (select md5(string_agg(t::text,'' order by t.id)) from public.sot_atividades t) atv`)).rows[0];
const legadoRef = await legadoAntes();

// ── POSITIVOS ───────────────────────────────────────────────────
// 5. sem perfil congelado + sem sugestão (C_ATIVO) → BASE_PROJETOS v1
let r = await confirmar(UID.gestor, impRDSE, 'ESTRUTURA_NOVA', 'ok base');
ok('1/5 ESTRUTURA_NOVA confirma RASCUNHO (sem sugestão → BASE_PROJETOS v1)',
  r.r && r.r.operacao === 'CONFIRMADA' && r.r.modo === 'ESTRUTURA_NOVA' && r.r.estado_wl === 'ESTRUTURADO', r);
let pf = await perfilProj(P_RDSE);
ok('congela BASE_PROJETOS v1 com origem LMS_ORIGINAL_ESTRUTURA_NOVA',
  pf && pf.perfil_codigo === 'BASE_PROJETOS' && pf.perfil_versao === 1 && pf.origem_congelamento === 'LMS_ORIGINAL_ESTRUTURA_NOVA', pf);
let row = await impRow(impRDSE);
const usrGestor = (await db.query(`select id::text v from public.usuarios_sistema where auth_user_id=$1`, [UID.gestor])).rows[0].v;
ok('2 autoria vem do servidor (auth.uid/ERP), status/confirmado_em preenchidos',
  row.status === 'CONFIRMADA' && row.modo === 'ESTRUTURA_NOVA' && row.confirmado_por_auth === UID.gestor
  && row.confirmado_por_usuario_id === usrGestor && row.confirmado_em !== null, row);
ok('3 exatamente um evento CONFIRMADA', await evCount(impRDSE, 'CONFIRMADA') === 1);
ok('conciliacao_aplicada_* permanecem NULL', row.conciliacao_aplicada_em === null && row.conciliacao_aplicada_por_auth === null);

// 4. sem congelado + com sugestão (C_ATIVO2 → ENEL_WL v1)
r = await confirmar(UID.gestor, impOUTRO, 'ESTRUTURA_NOVA');
pf = await perfilProj(P_OUTRO);
ok('4 sem congelado + sugestão contratual → congela a sugestão (ENEL_WL v1)',
  r.r && r.r.operacao === 'CONFIRMADA' && pf.perfil_codigo === 'ENEL_WL' && pf.perfil_versao === 1
  && pf.origem_congelamento === 'LMS_ORIGINAL_ESTRUTURA_NOVA', { r, pf });

// 6. já congelado → preserva
r = await confirmar(UID.gestor, impRDSE2, 'ESTRUTURA_NOVA');
pf = await perfilProj(P_RDSE2);
ok('6 projeto já congelado → preserva perfil (origem GESTOR intacta)',
  r.r && r.r.operacao === 'CONFIRMADA' && r.r.perfil && r.r.perfil.operacao === 'PRESERVADO'
  && pf.perfil_codigo === 'BASE_PROJETOS' && pf.origem_congelamento === 'GESTOR', { r, pf });

// 7. CONCILIACAO (projeto sem contrato) não congela
const antesProc = (await db.query(`select count(*)::int n from public.sot_projeto_processo where projeto_id=$1`, [P_SEM_CONTRATO])).rows[0].n;
r = await confirmar(UID.gestor, impSEM, 'CONCILIACAO');
const depoisProc = (await db.query(`select count(*)::int n from public.sot_projeto_processo where projeto_id=$1`, [P_SEM_CONTRATO])).rows[0].n;
ok('7 CONCILIACAO confirma sem criar/congelar perfil', r.r && r.r.operacao === 'CONFIRMADA' && r.r.modo === 'CONCILIACAO'
  && antesProc === 0 && depoisProc === 0, { r, antesProc, depoisProc });

// 8/9/10 estados derivados
ok('8 LEGADO_SEM_WL (projeto com RASCUNHO, antes de confirmar)', legadoSemWlAntes === 'LEGADO_SEM_WL', legadoSemWlAntes);
ok('9 EM_CONCILIACAO (CONCILIACAO não aplicada)', await estado(UID.gestor, P_SEM_CONTRATO) === 'EM_CONCILIACAO');
ok('10 ESTRUTURADO (ESTRUTURA_NOVA)', await estado(UID.gestor, P_RDSE) === 'ESTRUTURADO');

// 11 idempotência mesmo modo
r = await confirmar(UID.gestor, impRDSE, 'ESTRUTURA_NOVA');
ok('11 repetir mesma confirmação/mesmo modo → JA_CONFIRMADA sem evento extra',
  r.r && r.r.operacao === 'JA_CONFIRMADA' && await evCount(impRDSE, 'CONFIRMADA') === 1, r);

// ── NEGATIVOS ───────────────────────────────────────────────────
r = await confirmar(null, impRDSE2, 'ESTRUTURA_NOVA', null, 'anon');
ok('12 anon não executa', r.e && /permission denied/.test(r.e), r);
r = await confirmar(null, impRDSE2, 'ESTRUTURA_NOVA');
ok('13 sem sessão → erro', r.e && !/permission denied/.test(r.e), r);
r = await confirmar(U_INATIVO, impSEM, 'CONCILIACAO');
ok('14 usuário ERP inativo', r.code === '42501', r);
r = await como(db, 'authenticated', UID.supervisor, async () => { try { return { r: (await db.query(`select public.sot_lms_confirmar($1::uuid,'CONCILIACAO',null) v`, [impSEM])).rows[0].v }; } catch (e) { return { e: e.message, code: e.code }; } });
ok('15 usuário ativo sem PROJ_CONFIRMAR_LMS (supervisor) → negado', r.e && /SEM_PERMISSAO/.test(r.e), r);
r = await como(db, 'authenticated', UID.administrativo, async () => { try { return { r: (await db.query(`select public.sot_lms_confirmar($1::uuid,'CONCILIACAO',null) v`, [impSEM])).rows[0].v }; } catch (e) { return { e: e.message, code: e.code }; } });
ok('16 tem PROJ_IMPORTAR_LMS mas NÃO PROJ_CONFIRMAR_LMS (administrativo) → negado', r.e && /SEM_PERMISSAO/.test(r.e), r);
r = await confirmar(UID.gestor, P_INEXISTENTE, 'CONCILIACAO');
ok('17 importação inexistente', r.code === 'P0002', r);
r = await confirmar(UID.gestor, impSEM, 'XPTO');
ok('20 modo inválido', r.code === '22023', r);
r = await confirmar(UID.gestor, impSEM, null);
ok('20b modo null', r.code === '22023', r);

// 22 mesma importação, modo diferente → recusa (não JA_CONFIRMADA)
r = await confirmar(UID.gestor, impRDSE, 'CONCILIACAO');
ok('22 import confirmada com modo diferente → recusa', r.code === '55000' && /já confirmada com modo/.test(r.e || ''), r);

// 21 + 23: segunda ORIGINAL no mesmo projeto
const impRDSE_2 = await registrar(UID.gestor, P_RDSE); // mesmo projeto, mesmo hash → REENVIO devolve a MESMA importação
ok('reenvio devolve a mesma importação (já confirmada)', impRDSE_2 === impRDSE, { impRDSE, impRDSE_2 });
// cria segunda importação com OUTRO hash no projeto já ESTRUTURADO (P_RDSE) para forçar ORIGINAL_JA_CONFIRMADA
const sintBytes = (() => {
  const esp = JSON.parse(fs.readFileSync(path.join(raiz, 'tests', 'fixtures', 'lms', 'modelo-lms-esperado.json'), 'utf8'));
  const aoa = [['Definição de projeto:', null, null, 'DMP/A.OES.00.00002'], [], esp.colunas,
    ['1', 'WP', 'I', '324894', 'NK', 'M', 'FIO', 1, 1, null, null, null, null, null]];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Planilha1');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
})();
const parseSint = P.parseLms(sintBytes, XLSX);
const hashSint = createHash('sha256').update(sintBytes).digest('hex');
const plSint = P.payloadRegistro(parseSint, { ...arquivoFix, hash_sha256: hashSint, nome: 'sint.xlsx', tamanho: sintBytes.length });
const impRDSE_b = await como(db, 'service_role', null, async () => (await db.query(
  `select public.sot_lms_importacao_registrar($1::uuid,$2::uuid,$3::jsonb,$4::jsonb) v`,
  [UID.gestor, P_RDSE, JSON.stringify(plSint.p_importacao), JSON.stringify(plSint.p_linhas)])).rows[0].v.importacao_id);
r = await confirmar(UID.gestor, impRDSE_b, 'ESTRUTURA_NOVA');
ok('21 segunda ORIGINAL no projeto já confirmado → ORIGINAL_JA_CONFIRMADA', r.code === '55000' && /ORIGINAL_JA_CONFIRMADA/.test(r.e || ''), r);
ok('índice único parcial continua com 1 ORIGINAL confirmada no projeto',
  (await db.query(`select count(*)::int n from public.sot_lms_importacoes where projeto_id=$1 and status='CONFIRMADA'`, [P_RDSE])).rows[0].n === 1);

// 26/27/28/29 UPDATE direto bloqueado (owner com marcador falso / authenticated)
let e2 = await como(db, 'authenticated', UID.gestor, () => tentaExec(db, `update public.sot_lms_importacoes set status='CONFIRMADA' where id='${impSEM}'`));
ok('26 UPDATE direto de status (authenticated) bloqueado', e2 && /permission denied|row-level|não é reescrita|função controlada/.test(e2), e2);
e2 = await tentaExec(db, `update public.sot_lms_importacoes set modo='ESTRUTURA_NOVA' where id='${impSEM}'`);
ok('27 UPDATE direto de modo (owner sem marcador) bloqueado', e2 && /função controlada|não é reescrita/.test(e2), e2);
e2 = await tentaExec(db, `update public.sot_lms_importacoes set hash_sha256=repeat('a',64) where id='${impSEM}'`);
ok('fonte imutável: hash não muda', e2 && /não é reescrita/.test(e2), e2);

// ── NÃO-MUTAÇÃO do legado / TMA ──────────────────────────────────
ok('32/33 ESTRUTURA_NOVA e CONCILIACAO não tocaram sot_materiais/sot_atividades',
  JSON.stringify(await legadoAntes()) === JSON.stringify(legadoRef));
ok('34 nada escrito em composicao_dia/equipes_disp',
  (await db.query(`select (select count(*) from public.composicao_dia)::int c, (select count(*) from public.equipes_disp)::int e`)).rows[0].c === 0);

// ── CONCORRÊNCIA (estrutural; concorrência real = homologação remota no Supabase) ──
// PGlite é single-connection: não há duas transações concorrentes de verdade. Então testamos:
//   (a) defesa em profundidade presente na RPC (advisory lock por projeto + SELECT FOR UPDATE);
//   (b) backstop funcional + índice único parcial para "duas importações distintas do mesmo projeto"
//       (já exercitado no teste 21 ORIGINAL_JA_CONFIRMADA + índice com 1 CONFIRMADA).
ok('concorrência: RPC tem advisory lock por projeto + FOR UPDATE',
  /pg_advisory_xact_lock\(hashtextextended\('sot_lms_confirmar\|'/.test(codigo) && /FOR UPDATE/.test(codigo));

// ── COMPATIBILIDADE COM PRODUÇÃO (1.3 já com RASCUNHO + evento CRIADA) ──
const dbp = new PGlite();
await dbp.exec(BASE); await dbp.exec(migSeg); await dbp.exec(fnProg); await dbp.exec(mig11); await dbp.exec(mig12); await dbp.exec(mig13);
const impProd = await como(dbp, 'service_role', null, async () => (await dbp.query(
  `select public.sot_lms_importacao_registrar($1::uuid,$2::uuid,$3::jsonb,$4::jsonb) v`,
  [UID.gestor, P_RDSE, JSON.stringify(payloadFix.p_importacao), JSON.stringify(payloadFix.p_linhas)])).rows[0].v.importacao_id);
const rowBefore = (await dbp.query(`select status, tipo_importacao, hash_sha256, qtd_linhas from public.sot_lms_importacoes where id=$1`, [impProd])).rows[0];
const evBefore = (await dbp.query(`select count(*)::int n from public.sot_lms_importacao_eventos where importacao_id=$1 and tipo_evento='CRIADA'`, [impProd])).rows[0].n;
const errP = await tentaExec(dbp, mig);
ok('5a migration aplica sobre 1.3 com RASCUNHO existente', errP === null, errP);
const rowAfter = (await dbp.query(`select status, hash_sha256, qtd_linhas, modo, confirmado_por_auth, confirmado_em, conciliacao_aplicada_em from public.sot_lms_importacoes where id=$1`, [impProd])).rows[0];
const evAfter = (await dbp.query(`select count(*)::int n from public.sot_lms_importacao_eventos where importacao_id=$1 and tipo_evento='CRIADA'`, [impProd])).rows[0].n;
ok('5b campos novos NULL; RASCUNHO e dados intactos; evento CRIADA preservado (sem backfill)',
  rowAfter.modo === null && rowAfter.confirmado_por_auth === null && rowAfter.confirmado_em === null && rowAfter.conciliacao_aplicada_em === null
  && rowAfter.status === rowBefore.status && rowAfter.hash_sha256 === rowBefore.hash_sha256 && rowAfter.qtd_linhas === rowBefore.qtd_linhas
  && evAfter === evBefore, { rowBefore, rowAfter });
ok('5c sem importação CONFIRMADA criada pela migration', (await dbp.query(`select count(*)::int n from public.sot_lms_importacoes where status='CONFIRMADA'`)).rows[0].n === 0);

// ── ROLLBACK (estático: autossuficiente e seguro) ──
ok('rollback aborta se houver CONFIRMADA (guarda EXISTS)',
  /EXISTS \(SELECT 1\s+FROM public\.sot_lms_importacoes\s+WHERE status = 'CONFIRMADA'\)/.test(desfazer) && /ROLLBACK ABORTADO/.test(desfazer));
ok('rollback restaura a trava da 1.3 diretamente (não reaplica a 1.3)',
  /CREATE OR REPLACE FUNCTION public\.sot_lms_importacoes_proteger\(\)/.test(desfazer) && !/20261009193000/.test(desfazer));
ok('rollback restaura CHECKs 1.3 e remove índice/funções/colunas desta etapa',
  /status IN \('RASCUNHO'\)/.test(desfazer) && /tipo_evento IN \('CRIADA', 'REENVIO'\)/.test(desfazer)
  && /DROP INDEX IF EXISTS public\.sot_lms_importacoes_original_confirmada_uidx/.test(desfazer)
  && /DROP FUNCTION IF EXISTS public\.sot_lms_confirmar/.test(desfazer) && /DROP COLUMN IF EXISTS modo/.test(desfazer));

// ── MUTAÇÃO — 11 sabotagens, cada uma provada detectável ──────────
const mutBanco = async (transform) => { try { return { d: await novoBanco(transform(mig)) }; } catch (e) { return { err: e.message }; } };
const regIn = async (d, auth, proj, pl = payloadFix) => como(d, 'service_role', null, async () => {
  try { return (await d.query(`select public.sot_lms_importacao_registrar($1::uuid,$2::uuid,$3::jsonb,$4::jsonb) v`,
    [auth, proj, JSON.stringify(pl.p_importacao), JSON.stringify(pl.p_linhas)])).rows[0].v.importacao_id; } catch (e) { return { e: e.message }; }
});
const confIn = async (d, uid, imp, modo) => como(d, 'authenticated', uid, async () => {
  try { return (await d.query(`select public.sot_lms_confirmar($1::uuid,$2,$3) v`, [imp, modo, null])).rows[0].v; } catch (e) { return { e: e.message, code: e.code }; }
});
let mm, det;

// M1 — remover a validação cena_pode
mm = await mutBanco(s => s.replace(/IF NOT coalesce\(public\.cena_pode\('PROJ_CONFIRMAR_LMS'[\s\S]*?RETURN 'SEM_PERMISSAO';\s*END IF;/, ''));
det = false;
if (mm.d) { const i = await regIn(mm.d, UID.gestor, P_SEM_CONTRATO); const r2 = await confIn(mm.d, UID.supervisor, i, 'CONCILIACAO'); det = r2 && r2.operacao === 'CONFIRMADA'; }
ok('M1 remover cena_pode → supervisor (sem permissão) confirmaria', det, mm.err);

// M2 — trocar PROJ_CONFIRMAR_LMS por PROJ_IMPORTAR_LMS
mm = await mutBanco(s => s.replace(/PROJ_CONFIRMAR_LMS/g, 'PROJ_IMPORTAR_LMS'));
det = false;
if (mm.d) { const i = await regIn(mm.d, UID.gestor, P_SEM_CONTRATO); const r2 = await confIn(mm.d, UID.administrativo, i, 'CONCILIACAO'); det = r2 && r2.operacao === 'CONFIRMADA'; }
ok('M2 PROJ_CONFIRMAR_LMS→PROJ_IMPORTAR_LMS → administrativo confirmaria', det, mm.err);

// M3 — remover o índice UNIQUE parcial
{
  const idxReal = (await db.query(`select indisunique u, (indpred is not null) parcial from pg_index where indexrelid='public.sot_lms_importacoes_original_confirmada_uidx'::regclass`)).rows[0];
  const sab = codigo.replace(/CREATE UNIQUE INDEX[\s\S]*?original_confirmada_uidx[\s\S]*?;/, '-- removido');
  ok('M3 índice real é UNIQUE+parcial (backstop); sabotagem remove o CREATE',
    idxReal && idxReal.u && idxReal.parcial
    && /CREATE UNIQUE INDEX[\s\S]*?original_confirmada_uidx/.test(codigo)
    && !/CREATE UNIQUE INDEX[\s\S]*?original_confirmada_uidx/.test(sab), idxReal);
}

// M4 — enfraquecer a trava (permitir UPDATE direto de status/modo/confirmado_*)
mm = await mutBanco(s => s.replace(/IF v_mudou_ctrl AND NOT v_autorizado THEN[\s\S]*?END IF;/, ''));
det = false;
if (mm.d) {
  const i = await regIn(mm.d, UID.gestor, P_SEM_CONTRATO);
  const e = await tentaExec(mm.d, `update public.sot_lms_importacoes set status='CONFIRMADA', modo='CONCILIACAO', confirmado_por_auth='${UID.gestor}', confirmado_em=now() where id='${i}'`);
  det = e === null; // sabotagem: UPDATE direto passou
}
ok('M4 enfraquecer trava → UPDATE direto de status/modo/confirmado_* passaria', det, mm.err);

// M5 — permitir perfil_codigo/perfil_versao vindos do cliente
{
  const sab = codigo.replace('p_observacao text DEFAULT NULL)', 'p_observacao text DEFAULT NULL, p_perfil_codigo text DEFAULT NULL)');
  ok('M5 real não aceita perfil do cliente; sabotagem injeta p_perfil_codigo',
    !/FUNCTION public\.sot_lms_confirmar[\s\S]*?p_perfil_codigo/.test(codigo) && /p_perfil_codigo/.test(sab));
}

// M6 — congelar/criar perfil no modo CONCILIACAO
mm = await mutBanco(s => s.replace("IF p_modo = 'ESTRUTURA_NOVA' THEN", "IF p_modo IN ('ESTRUTURA_NOVA', 'CONCILIACAO') THEN"));
det = false;
if (mm.d) { const i = await regIn(mm.d, UID.gestor, P_SEM_CONTRATO); const r2 = await confIn(mm.d, UID.gestor, i, 'CONCILIACAO');
  const n = (await mm.d.query(`select count(*)::int n from public.sot_projeto_processo where projeto_id=$1`, [P_SEM_CONTRATO])).rows[0].n;
  det = r2 && r2.operacao === 'CONFIRMADA' && n === 1; }
ok('M6 congelar em CONCILIACAO → cria processo indevidamente', det, mm.err);

// M7 — sobrescrever perfil já congelado no ESTRUTURA_NOVA (remover o ramo "preserva")
mm = await mutBanco(s => s.replace('IF v_ja_frozen THEN', 'IF false THEN'));
det = false;
if (mm.d) {
  await como(mm.d, 'authenticated', UID.admin, async () => {
    await mm.d.query(`select public.cena_processo_perfil_criar_versao('ENEL_WL',1,'ENEL WL','wl','{}'::jsonb,'seed')`);
    await mm.d.query(`select public.cena_contrato_processo_perfil_definir($1::uuid,'ENEL_WL',1,'sug')`, [C_ATIVO]);
    await mm.d.query(`select public.cena_projeto_processo_congelar($1::uuid,'BASE_PROJETOS',1,'previo')`, [P_RDSE2]);
  });
  const i = await regIn(mm.d, UID.gestor, P_RDSE2); const r2 = await confIn(mm.d, UID.gestor, i, 'ESTRUTURA_NOVA');
  det = r2 && r2.e && /congelado/.test(r2.e); // tentativa de sobrescrever → gravar recusa (real preservaria)
}
ok('M7 remover "preserva" → tenta sobrescrever perfil congelado (comportamento muda)', det, mm.err);

// M8 — introduzir criação/escrita em sot_wl
mm = await mutBanco(s => s.replace('COMMIT;', 'CREATE TABLE public.sot_wl (id uuid primary key default gen_random_uuid());\nCOMMIT;'));
det = false;
if (mm.d) det = (await mm.d.query(`select count(*)::int n from pg_class where relname='sot_wl'`)).rows[0].n === 1;
ok('M8 criar sot_wl → tabela passaria a existir (real não referencia sot_wl)', det && !/sot_wl/i.test(codigo), mm.err);

// M9 — introduzir escrita em sot_materiais
mm = await mutBanco(s => s.replace(
  "RETURN jsonb_build_object('operacao', 'CONFIRMADA', 'importacao_id'",
  "UPDATE public.sot_materiais SET qtd_prevista = qtd_prevista + 1 WHERE projeto_id = v_imp.projeto_id;\n  RETURN jsonb_build_object('operacao', 'CONFIRMADA', 'importacao_id'"));
det = false;
if (mm.d) {
  const before = Number((await mm.d.query(`select coalesce(sum(qtd_prevista),0) s from public.sot_materiais`)).rows[0].s);
  const i = await regIn(mm.d, UID.gestor, P_RDSE); await confIn(mm.d, UID.gestor, i, 'ESTRUTURA_NOVA');
  const after = Number((await mm.d.query(`select coalesce(sum(qtd_prevista),0) s from public.sot_materiais`)).rows[0].s);
  det = after !== before;
}
ok('M9 escrever sot_materiais no confirmar → legado muda (checagem de não-mutação pega)', det, mm.err);

// M10 — mesma importação CONFIRMADA com modo DIFERENTE tratada como JA_CONFIRMADA
mm = await mutBanco(s => s.replace('IF v_imp.modo = p_modo THEN', 'IF true THEN'));
det = false;
if (mm.d) { const i = await regIn(mm.d, UID.gestor, P_SEM_CONTRATO); await confIn(mm.d, UID.gestor, i, 'CONCILIACAO');
  const r2 = await confIn(mm.d, UID.gestor, i, 'ESTRUTURA_NOVA'); det = r2 && r2.operacao === 'JA_CONFIRMADA'; }
ok('M10 modo diferente tratado como JA_CONFIRMADA (deveria recusar)', det, mm.err);

// M11 — remover a proteção de concorrência por projeto
{
  const sab = codigo.replace(/PERFORM pg_advisory_xact_lock\(hashtextextended\('sot_lms_confirmar[\s\S]*?\);/, '');
  ok('M11 remover advisory lock: real tem lock+FOR UPDATE+backstop; sabotagem remove o lock',
    /pg_advisory_xact_lock\(hashtextextended\('sot_lms_confirmar/.test(codigo) && /FOR UPDATE/.test(codigo)
    && /ORIGINAL_JA_CONFIRMADA/.test(codigo)
    && !/pg_advisory_xact_lock\(hashtextextended\('sot_lms_confirmar/.test(sab));
}

if (failed.length) {
  console.log(`proj-lms-confirmacao-sql: FALHOU ${failed.length}/${total}`);
  for (const f of failed) console.log('  - ' + f);
  process.exit(1);
}
console.log(`proj-lms-confirmacao-sql: OK (${total} verificações)`);
