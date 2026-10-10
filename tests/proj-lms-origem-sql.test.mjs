// ETAPA 1.3 — testes SQL da migration 20261009193000_proj_lms_origem.sql
// PGlite com os helpers reais de sessão (20261004190000), a Etapa 1.1 real (20261007190000) e a Etapa 1.2 real
// (20261009173000). Storage simulado só com storage.buckets/objects (o Storage real é validado no Supabase).
// Linhas gravadas = saída real do parser sobre a fixture anonimizada.
// Uso: PGLITE_PATH=<pasta com @electric-sql/pglite> XLSX_PATH=<.../xlsx.mjs> node tests/proj-lms-origem-sql.test.mjs
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
  console.log('proj-lms-origem-sql: SKIP (defina PGLITE_PATH e XLSX_PATH)');
  process.exit(0);
}
const P = await import(pathToFileURL(process.env.LMS_PARSER_PATH || path.join(raiz, 'supabase', 'functions', '_shared', 'lms-parser.ts')).href);

const migDir = path.join(raiz, 'supabase', 'migrations');
const semNotify = s => s.replace(/NOTIFY pgrst[^;]*;/g, '');
const ler = f => fs.readFileSync(path.join(migDir, f), 'utf8');
const migFile = process.env.LMS_MIG_PATH || path.join(migDir, '20261009193000_proj_lms_origem.sql');
const migRaw = fs.readFileSync(migFile, 'utf8');
const mig = semNotify(migRaw);
const codigo = migRaw.slice(0, migRaw.indexOf('-- Validação')).replace(/--[^\n]*/g, '');
const desfazer = migRaw.slice(migRaw.indexOf('-- Para desfazer')).split(/\r?\n/).slice(1)
  .map(l => l.replace(/^--\s?/, '')).join('\n').trim();
const migSeg = semNotify(ler('20261004190000_seguranca_usuarios_sistema.sql'));
const mig11 = semNotify(ler('20261007190000_cena_permissoes_acao.sql'));
const mig12 = semNotify(ler('20261009173000_proj_perfil_processo.sql'));
const migProg = ler('20261004200000_prog_projetos_agenda.sql');
const iniProg = migProg.indexOf('CREATE OR REPLACE FUNCTION public.cena_prog_pode_programar_projetos()');
const fimMarca = 'GRANT EXECUTE ON FUNCTION public.cena_prog_pode_programar_projetos() TO authenticated;';
const fnProg = migProg.slice(iniProg, migProg.indexOf(fimMarca) + fimMarca.length);

const failed = [];
let total = 0;
const ok = (n, c, d) => { total++; if (!c) failed.push(n + (d !== undefined ? ' — ' + JSON.stringify(d).slice(0, 400) : '')); };

// ── Estáticos ───────────────────────────────────────────────────
const codigoLimpo = codigo.trim();
ok('transação explícita: BEGIN; primeiro, COMMIT; último, depois do NOTIFY', codigoLimpo.startsWith('BEGIN;') && codigoLimpo.endsWith('COMMIT;')
  && codigoLimpo.indexOf("NOTIFY pgrst, 'reload schema';") < codigoLimpo.lastIndexOf('COMMIT;')
  && (codigo.match(/^BEGIN;/gm) || []).length === 1 && (codigo.match(/^COMMIT;/gm) || []).length === 1 && !/\bROLLBACK\b/i.test(codigo));
ok('desfazer também é transacional', /^BEGIN;/.test(desfazer) && /COMMIT;$/.test(desfazer));
ok('nenhuma autorização por e-mail', !/auth\.jwt\(\)|auth\.email\(\)|\bemail\b/i.test(codigo));
ok('sem GRANT para anon nem PUBLIC', !/^\s*GRANT\b[^;]*\banon\b/im.test(codigo) && !/^\s*GRANT\b[^;]*\bTO\s+PUBLIC\b/im.test(codigo));
ok('nenhum GRANT de tabela para authenticated', !/^\s*GRANT\s+[^;]*\bON\s+TABLE\b[^;]*\bauthenticated\b/im.test(codigo));
ok('service_role: só SELECT em sot_lms_importacoes', (codigo.match(/^\s*GRANT\s+[^;]*\bON\s+TABLE\b[^;]*;/gim) || []).join('|')
  .replace(/\s+/g, ' ').trim() === 'GRANT SELECT ON TABLE public.sot_lms_importacoes TO service_role;');
ok('nenhuma policy (nem em storage.objects): leitura só por RPC, Storage só pela Edge', !/CREATE POLICY|DROP POLICY/i.test(codigo));
ok('sem USING (true) / ALL true', !/(USING|WITH CHECK)\s*\(\s*true\s*\)/i.test(codigo));
ok('bucket privado: public = false no INSERT e no conflito', /VALUES \('proj-lms', 'proj-lms', false,/.test(codigo)
  && /ON CONFLICT \(id\) DO UPDATE SET\s+public = false/.test(codigo) && !/public\s*=\s*true/i.test(codigo));
ok('sem DELETE de dados nem DROP TABLE fora do desfazer', !/\bDELETE FROM\b/i.test(codigo) && !/\bDROP TABLE\b/i.test(codigo));
ok('sem credencial/JWT/service key', !/eyJ[A-Za-z0-9_-]{10,}|sb_secret_|SERVICE_ROLE_KEY|sk_live|password\s*=/i.test(migRaw));
ok('não referencia TMA / composicao_dia / equipes_disp / Portaria / RH / Frotas / fornecedores',
  !/\btma\b|progTma|composicao_dia|equipes_disp|portaria|frota|fornecedor|\brh_/i.test(codigo));
ok('não cria sot_wl nem wl_id/lms_linha_id; não toca sot_materiais/sot_atividades', !/sot_wl\b|\bwl_id\b|lms_linha_id|sot_materiais|sot_atividades/i.test(codigo));
ok('não implementa conciliação nem estados estruturais', !/conciliac|VINCULAR|CRIAR_NOVO|MANTER_LEGADO|REJEITAR|LEGADO_SEM_WL|EM_CONCILIACAO|ESTRUTURADO|CONFIRMAD/i.test(codigo));
ok('não congela perfil no upload nem semeia perfil/contrato', !/cena_projeto_processo_congelar|sot_projeto_processo_gravar|cena_processo_perfis\s*\(|cena_contrato_processo_perfil\b|'(ENEL[A-Z_]*|RDSE[A-Z_ ]*|RDSC[A-Z_]*)'/i.test(codigo));
ok('não altera sot_projetos / contratos / usuarios_sistema / matriz 1.1 / processo 1.2',
  !/(ALTER TABLE|UPDATE|INSERT INTO|DELETE FROM|TRUNCATE)\s+(public\.)?(sot_projetos|contratos|usuarios_sistema|cena_acoes|cena_permissoes_acao|sot_projeto_processo|cena_processo_perfis)\b/i.test(codigo));
ok('não cria permissão nova', !/INSERT INTO public\.cena_(acoes|permissoes_acao)\b/i.test(codigo));
ok('sem FK física para sot_projetos; FK linhas → importações', !/REFERENCES\s+public\.sot_projetos/i.test(codigo)
  && /importacao_id\s+uuid NOT NULL REFERENCES public\.sot_lms_importacoes \(id\)/.test(codigo));
ok('sem gatilho em tabela legada', !/ON\s+public\.(sot_projetos|sot_materiais|sot_atividades|contratos|usuarios_sistema)\b/i.test(codigo));
ok('sem CAST direto de contrato_id para uuid', !/contrato_id::uuid|contrato_id\)::uuid/i.test(codigo));
ok('autorização só por cena_pode(PROJ_IMPORTAR_LMS, ...)', (codigo.match(/cena_pode\('PROJ_IMPORTAR_LMS'/g) || []).length === 1
  && !/cena_pode\('(?!PROJ_IMPORTAR_LMS')/.test(codigo));
const uniques = [...codigo.matchAll(/UNIQUE\s*\(([^)]*)\)/g)].map(m => m[1].replace(/\s+/g, ' ').trim()).sort();
ok('unicidade só por importação+linha/ordem, projeto+hash e caminho (nunca código/WL/FT/KIT)',
  JSON.stringify(uniques) === JSON.stringify(['importacao_id, linha_excel', 'importacao_id, ordem', 'projeto_id, hash_sha256', 'storage_bucket, storage_path']), uniques);
ok('nenhum GROUP BY / sum() / DISTINCT ON sobre linhas', !/GROUP BY|\bsum\s*\(|DISTINCT ON/i.test(codigo));
ok('fn_proj_codigo_norm IMMUTABLE STRICT PARALLEL SAFE',
  /FUNCTION public\.fn_proj_codigo_norm\(p_codigo text\)\s+RETURNS text\s+LANGUAGE sql\s+IMMUTABLE\s+STRICT\s+PARALLEL SAFE/.test(codigo));
ok('status/tipo só RASCUNHO/ORIGINAL', /CHECK \(status IN \('RASCUNHO'\)\)/.test(codigo) && /CHECK \(tipo_importacao IN \('ORIGINAL'\)\)/.test(codigo));
ok('caminho no Storage derivado de projeto + hash (sem nome/e-mail/RE)', /storage_path = projeto_id::text \|\| '\/' \|\| hash_sha256 \|\| '\.xlsx'/.test(codigo));
ok('registro: trava por projeto+hash (advisory)', /pg_advisory_xact_lock\(hashtextextended\('sot_lms_importacao\|'/.test(codigo));
ok('SECURITY DEFINER sempre com search_path fixo', (codigo.match(/^SECURITY DEFINER/gm) || []).length === 4
  && (codigo.match(/^SECURITY DEFINER\s+SET search_path = public, pg_temp/gm) || []).length === 4);

// ── Banco ───────────────────────────────────────────────────────
const U = n => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PERFIS = ['admin', 'gestor', 'coordenador', 'supervisor', 'escritorio', 'administrativo', 'equipe', 'diretoria'];
const UID = Object.fromEntries(PERFIS.map((p, i) => [p, U(i + 1)]));
const U_INATIVO = U(901), U_EXCLUIDO = U(902), U_SEM_CADASTRO = U(903);
const C_ATIVO = 'c0000000-0000-4000-8000-000000000001';
const C_ATIVO2 = 'c0000000-0000-4000-8000-000000000004';
const C_INEXISTENTE = 'c0000000-0000-4000-8000-0000000000ff';
const PJ = n => `b0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const P_RDSE = PJ(1), P_RDSE2 = PJ(2), P_OUTRO = PJ(3), P_SEM_CONTRATO = PJ(4), P_TEXTO = PJ(6), P_CTR_INEXISTENTE = PJ(7);
const P_EXCLUIDO = PJ(8), P_VAZIO = PJ(9), P_INEXISTENTE = PJ(99);

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
${opts.semStorage ? '' : `create schema storage;
create table storage.buckets (id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id), name text);
grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.buckets, storage.objects to anon, authenticated, service_role;`}
create table public.usuarios_sistema (id uuid primary key default gen_random_uuid(), nome text, email text unique,
  perfil text, ativo boolean default true, auth_user_id uuid, deleted_at timestamptz);
insert into public.usuarios_sistema (nome, email, perfil, auth_user_id) values
  ${PERFIS.map(p => `('${p}', '${p}@cena', '${p}', '${UID[p]}')`).join(',\n  ')};
insert into public.usuarios_sistema (nome, email, perfil, auth_user_id, ativo) values ('ex-admin', 'ex@cena', 'admin', '${U_INATIVO}', false);
insert into public.usuarios_sistema (nome, email, perfil, auth_user_id, deleted_at) values ('del-gestor', 'del@cena', 'gestor', '${U_EXCLUIDO}', now());
create table public.contratos (id uuid primary key default gen_random_uuid(), codigo text, nome text, cliente text, status text);
insert into public.contratos (id, codigo, nome, cliente, status) values
  ('${C_ATIVO}', '4600003971', 'RDSE', 'ENEL', 'Ativo'), ('${C_ATIVO2}', '4600000003', 'Outro', 'OUTRO', 'Ativo');
create table public.sot_projetos (id uuid primary key, contrato_id text, nome text, status text, deleted_at timestamptz);
insert into public.sot_projetos (id, contrato_id, nome, status, deleted_at) values
  ('${P_RDSE}', '${C_ATIVO}', 'Projeto RDSE 1', 'Em execução', null),
  ('${P_RDSE2}', '${C_ATIVO}', 'Projeto RDSE 2', 'Recebido', null),
  ('${P_OUTRO}', '${C_ATIVO2}', 'Outro', 'Recebido', null),
  ('${P_SEM_CONTRATO}', null, 'Sem contrato', 'Recebido', null),
  ('${P_VAZIO}', '  ', 'Contrato vazio', 'Recebido', null),
  ('${P_TEXTO}', 'RDSE', 'Contrato texto legado', 'Recebido', null),
  ('${P_CTR_INEXISTENTE}', '${C_INEXISTENTE}', 'Contrato inexistente', 'Recebido', null),
  ('${P_EXCLUIDO}', '${C_ATIVO}', 'Excluído', 'Recebido', now());
create table public.sot_materiais (id uuid primary key default gen_random_uuid(), projeto_id uuid, codigo text, qtd_prevista numeric);
create table public.sot_atividades (id uuid primary key default gen_random_uuid(), projeto_id uuid, codigo text, qtd_prevista numeric);
insert into public.sot_materiais (projeto_id, codigo, qtd_prevista) values ('${P_RDSE}', '324894', 6);
insert into public.sot_atividades (projeto_id, codigo, qtd_prevista) values ('${P_RDSE}', 'I-AHO234', 1);
create table public.composicao_dia (id uuid primary key default gen_random_uuid(), equipe_id text, data date, projeto_ids text);
create table public.equipes_disp (id uuid primary key default gen_random_uuid(), equipe_id text, data date);
insert into public.composicao_dia (equipe_id, data, projeto_ids) values ('EQ1', '2026-10-09', '${P_RDSE}');
insert into public.equipes_disp (equipe_id, data) values ('EQ1', '2026-10-09');
`;

async function novoBanco(opts = {}) {
  const db = new PGlite();
  await db.exec(BASE(opts));
  await db.exec(migSeg);
  await db.exec(fnProg);
  await db.exec(mig11);
  if (!opts.sem12) await db.exec(mig12);
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
const tenta = async (db, sql, params) => { try { await db.query(sql, params); return null; } catch (e) { return e.message; } };
const tentaExec = async (db, sql) => {
  try { await db.exec(sql); return null; } catch (e) { try { await db.exec('ROLLBACK'); } catch (_) {} return e.message; }
};

// Fixture → payload real do parser
const fixture = new Uint8Array(fs.readFileSync(path.join(raiz, 'tests', 'fixtures', 'lms', 'modelo-lms-anonimizado.xlsx')));
const esperado = JSON.parse(fs.readFileSync(path.join(raiz, 'tests', 'fixtures', 'lms', 'modelo-lms-esperado.json'), 'utf8'));
const hashFix = createHash('sha256').update(fixture).digest('hex');
const parse = P.parseLms(fixture, XLSX);
const arquivoFix = { hash_sha256: hashFix, nome: 'Modelo LMS.xlsx', tamanho: fixture.length, mime_informado: P.XLSX_MIME, mime_validado: P.XLSX_MIME };
const payloadFix = P.payloadRegistro(parse, arquivoFix);
const clone = o => JSON.parse(JSON.stringify(o));

// Planilha sintética pequena (Plan=0/Real>0, código texto com zeros, serviço, KIT diferente)
function planilha(linhas) {
  const aoa = [['Definição de projeto:', null, null, 'DMP/A.OES.00.00002'], [], esperado.colunas, ...linhas];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Planilha1');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
}
const sint = planilha([
  ['1', 'WP', 'I', 324894, 'NK-AMAR-RC', 'M', 'FIO', 0, 6, null, null, null, null, null],
  ['1', 'WP', 'I', ' 000123 ', 'NK-X', 'UN', 'PECA', 2, 2, null, null, null, null, null],
  ['2', 'WP', 'R', 'R-AHO234', 'S-AHO234', 'US3', 'SERV', 1, 1, '0,2616', 0.2616, 0.2616, null, null],
  ['2', 'WP', 'R', 'R-AHO234', 'S-AHO234', 'US3', 'SERV', 1, 1, '0,2616', 0.2616, 0.2616, null, null],
]);
const parseSint = P.parseLms(sint, XLSX);
const hashSint = createHash('sha256').update(sint).digest('hex');
const payloadSint = P.payloadRegistro(parseSint, { ...arquivoFix, hash_sha256: hashSint, nome: 'sint.xlsx', tamanho: sint.length });

let db = await novoBanco();
const retrato = async () => (await db.query(`
  select (select md5(string_agg(t::text, '' order by t.id)) from public.sot_projetos t) proj,
         (select md5(string_agg(t::text, '' order by t.id)) from public.sot_materiais t) mat,
         (select md5(string_agg(t::text, '' order by t.id)) from public.sot_atividades t) atv,
         (select md5(string_agg(t::text, '' order by t.id)) from public.composicao_dia t) cd,
         (select md5(string_agg(t::text, '' order by t.id)) from public.equipes_disp t) ed,
         (select md5(string_agg(t::text, '' order by t.id)) from public.contratos t) ctr,
         (select md5(string_agg(t::text, '' order by t.id)) from public.usuarios_sistema t) usr,
         (select md5(string_agg(t::text, '' order by t.codigo)) from public.cena_acoes t) acoes,
         (select md5(string_agg(t::text, '' order by t.id)) from public.cena_permissoes_acao t) matriz,
         (select count(*) from public.sot_projeto_processo)::int processos,
         (select count(*) from public.cena_processo_perfis)::int perfis,
         (select count(*) from pg_trigger where tgrelid in ('public.sot_projetos'::regclass, 'public.sot_materiais'::regclass,
            'public.sot_atividades'::regclass, 'public.composicao_dia'::regclass, 'public.equipes_disp'::regclass))::int trg,
         (select count(*) from information_schema.columns where table_name in ('sot_materiais', 'sot_atividades', 'sot_projetos'))::int cols,
         (select count(*) from pg_class where relname = 'sot_wl')::int sot_wl`)).rows[0];
const antes = await retrato();

let erro = await tentaExec(db, mig);
ok('aplica sem erro', erro === null, erro);
erro = await tentaExec(db, mig);
ok('reaplica sem erro (idempotente)', erro === null, erro);
ok('aplicar não muda legado, matriz 1.1 nem processo 1.2', JSON.stringify(await retrato()) === JSON.stringify(antes));

const rls = (await db.query(`select relname, relrowsecurity r, relforcerowsecurity f from pg_class
  where relname in ('sot_lms_importacoes', 'sot_lms_linhas', 'sot_lms_importacao_eventos') order by 1`)).rows;
ok('RLS ENABLE + FORCE nas 3 tabelas', rls.length === 3 && rls.every(x => x.r && x.f), rls);
ok('nenhuma policy nas tabelas LMS', (await db.query(`select count(*)::int n from pg_policies where tablename like 'sot_lms%'`)).rows[0].n === 0);
const priv = async (role, tab, p) => (await db.query(`select has_table_privilege($1, $2, $3) v`, [role, 'public.' + tab, p])).rows[0].v;
let privs = [];
for (const role of ['anon', 'authenticated', 'service_role']) for (const tab of ['sot_lms_importacoes', 'sot_lms_linhas', 'sot_lms_importacao_eventos'])
  for (const p of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) if (await priv(role, tab, p)) privs.push(`${role}:${tab}:${p}`);
ok('grants de tabela: só service_role SELECT em sot_lms_importacoes', JSON.stringify(privs) === JSON.stringify(['service_role:sot_lms_importacoes:SELECT']), privs);
const fpriv = async (role, fn) => (await db.query(`select has_function_privilege($1, $2, 'EXECUTE') v`, [role, fn])).rows[0].v;
const FN = {
  reg: 'public.sot_lms_importacao_registrar(uuid, uuid, jsonb, jsonb)', aut: 'public.sot_lms_autorizar_recebimento(uuid)',
  con: 'public.sot_lms_importacao_consultar(uuid, integer, integer)', interna: 'public.sot_lms_autorizar(uuid)',
  confere: 'public.sot_lms_linha_confere(public.sot_lms_linhas)', celula: 'public.sot_lms_celula_confere(jsonb, text, numeric, boolean)',
  trg1: 'public.sot_lms_exigir_registro()', trg2: 'public.sot_lms_importacoes_proteger()', trg3: 'public.sot_lms_imutavel()',
};
ok('anon não executa nenhuma função LMS', !(await Promise.all(Object.values(FN).map(f => fpriv('anon', f)))).some(Boolean)
  && !(await fpriv('anon', 'public.fn_proj_codigo_norm(text)')));
ok('authenticated: só autorizar_recebimento e consultar (nunca registrar)', await fpriv('authenticated', FN.aut) && await fpriv('authenticated', FN.con)
  && !(await fpriv('authenticated', FN.reg)) && !(await fpriv('authenticated', FN.interna)) && !(await fpriv('authenticated', FN.confere)));
ok('service_role: só registrar (não decide autorização do usuário)', await fpriv('service_role', FN.reg) && !(await fpriv('service_role', FN.aut))
  && !(await fpriv('service_role', FN.interna)) && !(await fpriv('service_role', FN.con)));
ok('funções de gatilho/internas sem EXECUTE para ninguém', !(await Promise.all(['anon', 'authenticated', 'service_role']
  .flatMap(r => [FN.trg1, FN.trg2, FN.trg3, FN.celula, FN.interna].map(f => fpriv(r, f))))).some(Boolean));
const vol = (await db.query(`select proname, provolatile v, proisstrict s, proparallel p from pg_proc
  where proname in ('fn_proj_codigo_norm', 'fn_proj_texto_norm') order by 1`)).rows;
ok('fn_proj_codigo_norm/fn_proj_texto_norm: IMMUTABLE STRICT PARALLEL SAFE', vol.length === 2 && vol.every(x => x.v === 'i' && x.s && x.p === 's'), vol);
const bucket = (await db.query(`select * from storage.buckets where id = 'proj-lms'`)).rows[0];
ok('bucket proj-lms privado, 12 MiB, só MIME XLSX', bucket && bucket.public === false && Number(bucket.file_size_limit) === 12582912
  && JSON.stringify(bucket.allowed_mime_types) === JSON.stringify([P.XLSX_MIME]), bucket);
await db.exec(`update storage.buckets set public = true where id = 'proj-lms'`);
await tentaExec(db, mig);
ok('reaplicar força o bucket de volta a privado', (await db.query(`select public from storage.buckets where id = 'proj-lms'`)).rows[0].public === false);

// Normalização SQL = JS (paridade)
const amostras = [' 000123 ', '000000', '0', '   ', '', ' I-AHO01 ', 'i-aho01', '00A1', '\u00a0123\t', '\n0042\r', '324894', 'ação', '12 34',
  '-0012', 'nk-amar-rc', 'S-aho234', '0000000000000000000001', 'ÿ', 'ß', 'ǆ', '\u2003x\u2003', 'x\u00a0', 'abc DEF', '0 0'];
for (let i = 0; i < 200; i++) amostras.push(Array.from({ length: 1 + (i % 7) }, (_, k) => ' 0aZz-9\t\u00a0é'[(i * 7 + k * 3) % 13]).join(''));
const sqlNorm = (await db.query(`select x, public.fn_proj_codigo_norm(x) c, public.fn_proj_texto_norm(x) t from unnest($1::text[]) x`, [amostras])).rows;
const div = sqlNorm.filter(r => r.c !== P.codigoNorm(r.x) || r.t !== P.textoNorm(r.x));
ok(`fn_proj_codigo_norm/texto_norm = parser JS em ${amostras.length} entradas`, div.length === 0, div.slice(0, 3));
ok('fn_proj_codigo_norm(NULL) = NULL', (await db.query(`select public.fn_proj_codigo_norm(null) v`)).rows[0].v === null);

// ── Autorização (cliente do usuário) ────────────────────────────
const autorizar = (uid, proj, role = 'authenticated') => como(db, role, uid, async () => {
  try { return (await db.query(`select public.sot_lms_autorizar_recebimento($1::uuid) v`, [proj])).rows[0].v; } catch (e) { return { e: e.message }; }
});
const mot = async (uid, proj, role) => { const r = await autorizar(uid, proj, role); return r.e ? 'ERRO:' + r.e : (r.permitido ? 'OK' : r.motivo); };
ok('anon não chama a autorização', (await mot(null, P_RDSE, 'anon')).startsWith('ERRO:permission denied'));
ok('authenticated sem JWT (sem auth.uid) → SEM_SESSAO', await mot(null, P_RDSE) === 'SEM_SESSAO');
ok('usuário sem cadastro ERP → USUARIO_ERP_INATIVO', await mot(U_SEM_CADASTRO, P_RDSE) === 'USUARIO_ERP_INATIVO');
ok('usuário inativo → USUARIO_ERP_INATIVO', await mot(U_INATIVO, P_RDSE) === 'USUARIO_ERP_INATIVO');
ok('usuário excluído (deleted_at) → USUARIO_ERP_INATIVO', await mot(U_EXCLUIDO, P_RDSE) === 'USUARIO_ERP_INATIVO');
for (const p of ['supervisor', 'equipe', 'diretoria']) ok(`${p} sem PROJ_IMPORTAR_LMS → SEM_PERMISSAO`, await mot(UID[p], P_RDSE) === 'SEM_PERMISSAO');
for (const p of ['admin', 'gestor', 'coordenador', 'escritorio', 'administrativo']) ok(`${p} com PROJ_IMPORTAR_LMS → OK`, await mot(UID[p], P_RDSE) === 'OK');
ok('projeto inexistente → PROJETO_INEXISTENTE', await mot(UID.gestor, P_INEXISTENTE) === 'PROJETO_INEXISTENTE');
ok('projeto nulo → PROJETO_INEXISTENTE', await mot(UID.gestor, null) === 'PROJETO_INEXISTENTE');
ok('projeto excluído → PROJETO_EXCLUIDO', await mot(UID.gestor, P_EXCLUIDO) === 'PROJETO_EXCLUIDO');
ok('contrato texto legado ("RDSE") → CONTRATO_NAO_IDENTIFICADO (sem cair na global)', await mot(UID.admin, P_TEXTO) === 'CONTRATO_NAO_IDENTIFICADO');
ok('contrato uuid inexistente → CONTRATO_NAO_IDENTIFICADO', await mot(UID.admin, P_CTR_INEXISTENTE) === 'CONTRATO_NAO_IDENTIFICADO');
ok('projeto sem contrato → regra global (gestor OK, supervisor não)', await mot(UID.gestor, P_SEM_CONTRATO) === 'OK' && await mot(UID.supervisor, P_SEM_CONTRATO) === 'SEM_PERMISSAO');
ok('contrato só com espaços = sem contrato', await mot(UID.gestor, P_VAZIO) === 'OK');
let neg = await como(db, 'authenticated', UID.admin, () => tenta(db,
  `select public.cena_permissao_acao_negar('gestor', 'PROJ_IMPORTAR_LMS', 'Contrato 2 sem LMS pelo gestor', $1::uuid)`, [C_ATIVO2]));
ok('negação por contrato (Etapa 1.1) vale: gestor bloqueado no contrato 2, liberado no 1', neg === null && await mot(UID.gestor, P_OUTRO) === 'SEM_PERMISSAO'
  && await mot(UID.gestor, P_RDSE) === 'OK', neg);
neg = await como(db, 'authenticated', UID.admin, () => tenta(db,
  `select public.cena_permissao_acao_conceder('supervisor', 'PROJ_IMPORTAR_LMS', 'Supervisor do contrato 1', $1::uuid)`, [C_ATIVO]));
ok('concessão por contrato vale só no contrato', neg === null && await mot(UID.supervisor, P_RDSE) === 'OK' && await mot(UID.supervisor, P_OUTRO) === 'SEM_PERMISSAO', neg);
const respAut = await autorizar(UID.gestor, P_RDSE);
ok('autorização não devolve dados do projeto/contrato', JSON.stringify(Object.keys(respAut).sort()) === '["motivo","permitido"]', respAut);

// ── Registro (service_role) ─────────────────────────────────────
const registrar = (auth, proj, pl, role = 'service_role', uid = null) => como(db, role, uid, async () => {
  try {
    return { r: (await db.query(`select public.sot_lms_importacao_registrar($1::uuid, $2::uuid, $3::jsonb, $4::jsonb) v`,
      [auth, proj, pl.p_importacao === null ? null : JSON.stringify(pl.p_importacao), pl.p_linhas === null ? null : JSON.stringify(pl.p_linhas)])).rows[0].v };
  } catch (e) { return { e: e.message, code: e.code }; }
});
const contar = async () => (await db.query(`select (select count(*) from public.sot_lms_importacoes)::int imp,
  (select count(*) from public.sot_lms_linhas)::int lin, (select count(*) from public.sot_lms_importacao_eventos)::int ev`)).rows[0];

let r = await registrar(UID.gestor, P_RDSE, payloadFix, 'authenticated', UID.gestor);
ok('authenticated não chama o registro (nem com sessão válida)', r.e && /permission denied/.test(r.e), r);
r = await registrar(UID.gestor, P_RDSE, payloadFix, 'anon');
ok('anon não chama o registro', r.e && /permission denied/.test(r.e), r);
ok('nada gravado pelas tentativas negadas', JSON.stringify(await contar()) === '{"imp":0,"lin":0,"ev":0}');

r = await registrar(U_INATIVO, P_RDSE, payloadFix);
ok('registro revalida: usuário inativo → 42501', r.code === '42501', r);
r = await registrar(U_SEM_CADASTRO, P_RDSE, payloadFix);
ok('registro revalida: sem cadastro ERP → 42501', r.code === '42501', r);
r = await registrar(UID.gestor, P_INEXISTENTE, payloadFix);
ok('registro revalida: projeto inexistente → P0002', r.code === 'P0002', r);
r = await registrar(UID.gestor, P_EXCLUIDO, payloadFix);
ok('registro revalida: projeto excluído → 42501', r.code === '42501', r);
r = await registrar(UID.admin, P_TEXTO, payloadFix);
ok('registro revalida: contrato não identificado → 42501', r.code === '42501', r);
ok('nada gravado pelas recusas', JSON.stringify(await contar()) === '{"imp":0,"lin":0,"ev":0}');

r = await registrar(UID.gestor, P_RDSE, payloadFix);
ok('fixture registrada', r.r && r.r.reenvio === false && r.r.status === 'RASCUNHO' && r.r.tipo_importacao === 'ORIGINAL' && r.r.qtd_linhas === esperado.linhas_reais, r);
const impId = r.r?.importacao_id;
const imp = (await db.query(`select * from public.sot_lms_importacoes where id = $1`, [impId])).rows[0];
const usrGestor = (await db.query(`select id::text v from public.usuarios_sistema where auth_user_id = $1`, [UID.gestor])).rows[0].v;
ok('importação: hash, caminho, bucket, tamanho, nome, MIME, parser, worksheet, D1, autoria', imp && imp.hash_sha256 === hashFix
  && imp.storage_bucket === 'proj-lms' && imp.storage_path === `${P_RDSE}/${hashFix}.xlsx` && Number(imp.arquivo_tamanho) === fixture.length
  && imp.arquivo_nome_original === 'Modelo LMS.xlsx' && imp.mime_validado === P.XLSX_MIME && imp.parser_version === '1'
  && imp.worksheet === 'Planilha1' && imp.projeto_identificacao_raw === 'DMP/A.OES.00.00001' && imp.criado_por_auth === UID.gestor
  && imp.criado_por_usuario_id === usrGestor && imp.contrato_id_projeto === C_ATIVO && imp.qtd_wls_distintas === esperado.wls, imp);
const lins = (await db.query(`select * from public.sot_lms_linhas where importacao_id = $1 order by ordem`, [impId])).rows;
ok('200 linhas, ordem 1..n, linha_excel preservada', lins.length === esperado.linhas_reais && lins.every((l, i) => l.ordem === i + 1
  && l.linha_excel === parse.linhas[i].linha_excel) && !lins.some(l => esperado.linhas_fantasma.includes(l.linha_excel)));
const CAMPOS = ['wl_raw', 'ctg_raw', 'ft_raw', 'codigo_raw', 'codigo_norm', 'kit_raw', 'umd_raw', 'descricao_raw', 'qtd_plan_raw', 'qtd_real_raw',
  'valor_ups_item_raw', 'valor_final_raw', 'valor_final_plan_raw', 'estorno_raw', 'adicionais_raw'];
const NUM = ['qtd_plan', 'lms_qtd_real_informada', 'valor_ups_item', 'valor_final', 'valor_final_plan'];
const difs = [];
lins.forEach((l, i) => {
  const p = parse.linhas[i];
  for (const c of CAMPOS) if (l[c] !== p[c]) difs.push([l.linha_excel, c, l[c], p[c]]);
  for (const c of NUM) if ((l[c] === null ? null : Number(l[c])) !== p[c]) difs.push([l.linha_excel, c, l[c], p[c]]);
  if (JSON.stringify(l.linha_raw) !== JSON.stringify(p.linha_raw) && JSON.stringify(Object.keys(l.linha_raw).sort()) !== JSON.stringify(Object.keys(p.linha_raw).sort())) difs.push([l.linha_excel, 'linha_raw']);
  if (JSON.stringify(l.alertas) !== JSON.stringify(p.alertas)) difs.push([l.linha_excel, 'alertas']);
});
ok('cada linha gravada = linha do parser (WL, CTG, FT, código raw/norm, KIT, UMD, descrição, Plan, Real, valores, Estorno, Adicionais, alertas)', difs.length === 0, difs.slice(0, 5));
ok('WL/CTG/FT/KIT/UMD _norm calculados pelo banco', lins.every(l => l.wl_norm === P.textoNorm(l.wl_raw) && l.ft_norm === P.textoNorm(l.ft_raw)
  && l.kit_norm === P.textoNorm(l.kit_raw) && l.umd_norm === P.textoNorm(l.umd_raw) && l.ctg_norm === P.textoNorm(l.ctg_raw)));
ok('FT=R: todos os materiais preservados', lins.filter(l => /^[0-9]+$/.test(l.codigo_norm || '') && l.ft_norm === 'R').length === esperado.materiais_ft_R);
const porCodigo = (await db.query(`select codigo_norm, count(*)::int n from public.sot_lms_linhas where importacao_id = $1 group by 1`, [impId])).rows;
const porCodigoParser = parse.linhas.reduce((m, l) => (m[l.codigo_norm] = (m[l.codigo_norm] || 0) + 1, m), {});
ok('nenhuma agregação: contagem por código = linhas do XLSX', porCodigo.every(x => porCodigoParser[x.codigo_norm] === x.n) && porCodigo.length === Object.keys(porCodigoParser).length);
ok('KIT preservado: mesmo WL+código+FT com KIT diferente = linhas distintas', lins.filter(l => l.linha_excel >= 25 && l.linha_excel <= 27)
  .map(l => l.kit_raw).filter((v, i, a) => a.indexOf(v) === i).length === 3);
const ev = (await db.query(`select tipo_evento, por_auth, detalhe from public.sot_lms_importacao_eventos where importacao_id = $1 order by id`, [impId])).rows;
ok('evento CRIADA com autoria', ev.length === 1 && ev[0].tipo_evento === 'CRIADA' && ev[0].por_auth === UID.gestor && ev[0].detalhe.qtd_linhas === 200, ev);

r = await registrar(UID.coordenador, P_RDSE, payloadFix);
ok('reenvio dos mesmos bytes: mesma importação, sem linhas novas', r.r && r.r.reenvio === true && r.r.importacao_id === impId, r);
r = await registrar(UID.coordenador, P_RDSE, { p_importacao: payloadFix.p_importacao, p_linhas: null });
ok('reenvio aceita sem linhas (idempotência por projeto + hash)', r.r && r.r.reenvio === true && r.r.importacao_id === impId, r);
const outroNome = clone(payloadFix); outroNome.p_importacao.arquivo_nome_original = 'outro nome.xlsx';
r = await registrar(UID.gestor, P_RDSE, outroNome);
ok('mesmos bytes com outro nome = reenvio (nome não identifica arquivo)', r.r && r.r.reenvio === true && r.r.importacao_id === impId, r);
let c = await contar();
ok('reenvios: 1 importação, 200 linhas, eventos CRIADA + 3 REENVIO', c.imp === 1 && c.lin === 200 && c.ev === 4, c);
r = await registrar(UID.gestor, P_RDSE2, payloadFix);
ok('mesmo arquivo em outro projeto = outra importação', r.r && r.r.reenvio === false && r.r.importacao_id !== impId, r);

// Planilha sintética: Plan=0/Real>0, código com zeros, linhas repetidas
r = await registrar(UID.gestor, P_RDSE, payloadSint);
ok('sintética registrada (outro hash, mesmo projeto)', r.r && r.r.reenvio === false && r.r.qtd_linhas === 4, r);
const ls = (await db.query(`select * from public.sot_lms_linhas where importacao_id = $1 order by ordem`, [r.r?.importacao_id])).rows;
ok('Plan=0/Real>0: qtd_plan continua 0, Real em lms_qtd_real_informada, alerta', Number(ls[0].qtd_plan) === 0 && Number(ls[0].lms_qtd_real_informada) === 6
  && ls[0].alertas.includes('PLAN_ZERO_REAL_POSITIVO'));
ok('código texto " 000123 ": raw preservado, norm 123 (banco)', ls[1].codigo_raw === ' 000123 ' && ls[1].codigo_norm === '123');
ok('linhas idênticas repetidas: as duas gravadas', ls[2].linha_excel === 6 && ls[3].linha_excel === 7 && ls[2].alertas.includes('LINHA_REPETIDA'));
ok('decimal pt-BR: raw "0,2616" e valor 0.2616', ls[2].valor_ups_item_raw === '0,2616' && Number(ls[2].valor_ups_item) === 0.2616);

// Adulterações (tudo ou nada)
const c0 = await contar();
const adulterar = async (nome, fn, codigo = '22023') => {
  const pl = clone(payloadSint);
  pl.p_importacao.hash_sha256 = createHash('sha256').update(nome).digest('hex');
  fn(pl);
  const x = await registrar(UID.gestor, P_RDSE, pl);
  ok(`recusa: ${nome}`, x.e && (codigo === null || x.code === codigo), x);
};
await adulterar('Quant. Real no lugar de Quant. Plan', pl => { pl.p_linhas[0].qtd_plan = pl.p_linhas[0].lms_qtd_real_informada; });
await adulterar('Plan copiado para Real', pl => { pl.p_linhas[0].lms_qtd_real_informada = pl.p_linhas[0].qtd_plan; });
await adulterar('wl_raw diferente da célula', pl => { pl.p_linhas[1].wl_raw = '9'; });
await adulterar('KIT removido', pl => { pl.p_linhas[0].kit_raw = null; });
await adulterar('código raw trocado pelo normalizado', pl => { pl.p_linhas[1].codigo_raw = '123'; pl.p_linhas[1].codigo_norm = '123'; });
await adulterar('codigo_norm do parser divergente do banco', pl => { pl.p_linhas[1].codigo_norm = '000123'; });
await adulterar('célula fora de A:N em linha_raw (coluna O)', pl => { pl.p_linhas[0].linha_raw.O = { t: 's', v: 'PESSOA' }; }, null);
await adulterar('quantidade de linhas diferente', pl => { pl.p_importacao.qtd_linhas = 5; });
await adulterar('linha_excel duplicada', pl => { pl.p_linhas[3].linha_excel = pl.p_linhas[2].linha_excel; }, null);
await adulterar('ordem fora da sequência do Excel', pl => { pl.p_linhas[0].ordem = 2; pl.p_linhas[1].ordem = 1; });
await adulterar('WLs distintas não conferem', pl => { pl.p_importacao.qtd_wls_distintas = 7; }, null);
await adulterar('status CONFIRMADO no payload não tem efeito: sempre RASCUNHO', pl => { pl.p_importacao.status = 'CONFIRMADO'; pl.p_importacao.qtd_linhas = 99; });
await adulterar('hash inválido', pl => { pl.p_importacao.hash_sha256 = 'abc'; });
await adulterar('sem linhas', pl => { pl.p_linhas = null; });
await adulterar('nome sem .xlsx', pl => { pl.p_importacao.arquivo_nome_original = 'a.xlsm'; }, null);
await adulterar('arquivo acima de 12 MiB', pl => { pl.p_importacao.arquivo_tamanho = 12582913; }, null);
await adulterar('MIME validado diferente de XLSX', pl => { pl.p_importacao.mime_validado = 'text/csv'; }, null);
ok('recusas não deixam importação/linhas/eventos pela metade', JSON.stringify(await contar()) === JSON.stringify(c0), await contar());

// ── Imutabilidade ───────────────────────────────────────────────
const linhaId = lins[0].id;
const comoDono = (sql, p) => tenta(db, sql, p);
ok('dono: UPDATE em linha bloqueado', /não é alterada/.test(await comoDono(`update public.sot_lms_linhas set qtd_plan = 999 where id = $1`, [linhaId]) || ''));
ok('dono: DELETE em linha bloqueado', /não é alterada/.test(await comoDono(`delete from public.sot_lms_linhas where id = $1`, [linhaId]) || ''));
ok('dono: TRUNCATE linhas bloqueado', /não é alterada/.test(await tentaExec(db, `truncate public.sot_lms_linhas cascade`) || ''));
ok('dono: UPDATE do conteúdo da importação bloqueado', /não é reescrita/.test(await comoDono(`update public.sot_lms_importacoes set hash_sha256 = repeat('0', 64) where id = $1`, [impId]) || ''));
ok('dono: troca de status sem função controlada bloqueada', /função controlada|status_chk/.test(await comoDono(`update public.sot_lms_importacoes set status = 'RASCUNHO2' where id = $1`, [impId]) || ''));
ok('dono: DELETE de importação bloqueado', /não é apagada/.test(await comoDono(`delete from public.sot_lms_importacoes where id = $1`, [impId]) || ''));
ok('dono: TRUNCATE importações bloqueado', /não é alterada/.test(await tentaExec(db, `truncate public.sot_lms_importacoes cascade`) || ''));
ok('dono: UPDATE/DELETE em eventos bloqueado', /não é alterada/.test(await comoDono(`update public.sot_lms_importacao_eventos set tipo_evento = 'REENVIO'`) || '')
  && /não é alterada/.test(await comoDono(`delete from public.sot_lms_importacao_eventos`) || ''));
ok('dono: INSERT direto de linha (fora do registro) bloqueado', /só por sot_lms_importacao_registrar/.test(await comoDono(
  `insert into public.sot_lms_linhas (importacao_id, linha_excel, ordem, linha_raw) values ($1, 9999, 9999, '{}')`, [impId]) || ''));
ok('dono: INSERT direto de importação bloqueado', /só por sot_lms_importacao_registrar/.test(await comoDono(
  `insert into public.sot_lms_importacoes (id, projeto_id, tipo_importacao, status, hash_sha256, arquivo_nome_original, arquivo_tamanho, mime_validado,
   storage_bucket, storage_path, parser_version, worksheet, qtd_linhas, qtd_wls_distintas, resumo, criado_por_auth)
   values (gen_random_uuid(), $1::uuid, 'ORIGINAL', 'RASCUNHO', repeat('a', 64), 'x.xlsx', 1, '${P.XLSX_MIME}', 'proj-lms', $1::text || '/' || repeat('a', 64) || '.xlsx', '1', 'Planilha1', 1, 0, '{}', $2::uuid)`,
  [P_RDSE, UID.gestor]) || ''));
for (const [role, uid] of [['authenticated', UID.admin], ['anon', null], ['service_role', null]]) {
  const res = await como(db, role, uid, async () => ({
    sel: role === 'service_role' ? null : await tenta(db, `select * from public.sot_lms_linhas limit 1`),
    selImp: role === 'service_role' ? null : await tenta(db, `select * from public.sot_lms_importacoes limit 1`),
    upd: await tenta(db, `update public.sot_lms_linhas set qtd_plan = 1`),
    del: await tenta(db, `delete from public.sot_lms_linhas`),
    updImp: await tenta(db, `update public.sot_lms_importacoes set status = 'RASCUNHO'`),
    delImp: await tenta(db, `delete from public.sot_lms_importacoes`),
    ins: await tenta(db, `insert into public.sot_lms_importacao_eventos (importacao_id, tipo_evento, por_auth) values ($1, 'CRIADA', $2)`, [impId, U(1)]),
    trunc: await tenta(db, `truncate public.sot_lms_importacao_eventos`),
  }));
  const negados = Object.entries(res).filter(([, v]) => v !== null).every(([, v]) => /permission denied/.test(v));
  ok(`${role}: sem SELECT direto (exceto service_role em importações), sem UPDATE/DELETE/INSERT/TRUNCATE`, negados, res);
}
ok('service_role lê importações (checagem de existência na compensação), não lê linhas',
  await como(db, 'service_role', null, async () => (await tenta(db, `select id from public.sot_lms_importacoes limit 1`)) === null
    && /permission denied/.test(await tenta(db, `select id from public.sot_lms_linhas limit 1`) || '')));
c = await contar();
const lin0 = (await db.query(`select qtd_plan, codigo_raw from public.sot_lms_linhas where id = $1`, [linhaId])).rows[0];
ok('fonte intacta depois de todas as tentativas', Number(lin0.qtd_plan) === Number(lins[0].qtd_plan) && lin0.codigo_raw === lins[0].codigo_raw);

// ── Consulta paginada ───────────────────────────────────────────
const consultar = (uid, id, off, lim, role = 'authenticated') => como(db, role, uid, async () => {
  try { return { r: (await db.query(`select public.sot_lms_importacao_consultar($1::uuid, $2, $3) v`, [id, off, lim])).rows[0].v }; } catch (e) { return { e: e.message, code: e.code }; }
});
r = await consultar(UID.gestor, impId, 10, 20);
ok('consulta paginada: 20 linhas a partir da 11ª, sem linha_raw', r.r && r.r.linhas.length === 20 && r.r.linhas[0].ordem === 11
  && !('linha_raw' in r.r.linhas[0]) && r.r.importacao.qtd_linhas === 200 && !('storage_path' in r.r.importacao), r.e);
r = await consultar(UID.gestor, impId, 0, 100000);
ok('limite máximo 500 por página', r.r && r.r.limite === 500 && r.r.linhas.length === 200);
r = await consultar(UID.equipe, impId, 0, 10);
ok('consulta sem PROJ_IMPORTAR_LMS negada', r.code === '42501', r);
r = await consultar(null, impId, 0, 10);
ok('consulta sem sessão negada', r.code === '42501', r);
r = await consultar(null, impId, 0, 10, 'anon');
ok('anon não consulta', r.e && /permission denied/.test(r.e), r);
r = await consultar(UID.gestor, PJ(12345), 0, 10);
ok('importação inexistente → P0002', r.code === 'P0002', r);

// Legado intacto
const semMatriz = ({ matriz, ...resto }) => JSON.stringify(resto);
ok('depois de registros/recusas: sot_projetos, sot_materiais, sot_atividades, TMA, contratos, usuários e processo 1.2 intactos; sem sot_wl',
  semMatriz(await retrato()) === semMatriz(antes), { antes, depois: await retrato() });

// ── Desfazer e reaplicar ────────────────────────────────────────
db = await novoBanco();
erro = await tentaExec(db, mig);
erro = erro || await tentaExec(db, desfazer);
ok('desfazer roda sem erro (banco sem importações)', erro === null, erro);
const sobra = (await db.query(`select (select count(*) from pg_class where relname like 'sot_lms%')::int t,
  (select count(*) from pg_proc where proname like 'sot_lms%' or proname like 'fn_proj_%')::int f,
  (select count(*) from storage.buckets where id = 'proj-lms')::int b`)).rows[0];
ok('desfazer remove tabelas, funções e bucket', sobra.t === 0 && sobra.f === 0 && sobra.b === 0, sobra);
ok('reaplica depois de desfazer', (await tentaExec(db, mig)) === null);

// ── Pré-condições ───────────────────────────────────────────────
db = await novoBanco({ sem12: true });
erro = await tentaExec(db, mig);
ok('sem a Etapa 1.2: falha inteira e não cria nada', /20261009173000/.test(erro || '')
  && (await db.query(`select count(*)::int n from pg_class where relname like 'sot_lms%'`)).rows[0].n === 0, erro);
db = await novoBanco({ semStorage: true });
erro = await tentaExec(db, mig);
ok('sem Storage: falha inteira', /storage\.buckets/.test(erro || '') && (await db.query(`select count(*)::int n from pg_class where relname like 'sot_lms%'`)).rows[0].n === 0, erro);
db = await novoBanco();
await db.exec(`alter table public.cena_acoes disable trigger user; update public.cena_acoes set ativo = false where codigo = 'PROJ_IMPORTAR_LMS'`);
erro = await tentaExec(db, mig);
ok('PROJ_IMPORTAR_LMS inativa: falha (não cria permissão nova)', /PROJ_IMPORTAR_LMS/.test(erro || ''), erro);
db = await novoBanco();
await db.exec(`create role semprivilegio login; grant all on schema public to semprivilegio; grant usage on schema storage, auth to semprivilegio;
  grant select on public.cena_acoes to semprivilegio; set role semprivilegio`);
erro = await tentaExec(db, mig);
await db.exec('reset role');
ok('sem BYPASSRLS: falha', /BYPASSRLS/.test(erro || ''), erro);

if (failed.length) {
  console.log(`proj-lms-origem-sql: FALHOU ${failed.length}/${total}`);
  for (const f of failed) console.log('  - ' + f);
  process.exit(1);
}
console.log(`proj-lms-origem-sql: OK (${total} verificações)`);
