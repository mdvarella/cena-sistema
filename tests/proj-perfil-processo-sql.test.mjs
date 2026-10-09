// ETAPA 1.2 — testes SQL da migration 20261009173000_proj_perfil_processo.sql
// PostgreSQL embutido (PGlite) com os helpers reais de sessão (20261004190000), a função real de programação
// (20261004200000) e a Etapa 1.1 real (20261007190000, cena_pode e matriz aprovada).
// Teste auxiliar: não substitui a conferência no Supabase real (concorrência entre conexões não é reproduzível aqui).
// Uso: PGLITE_PATH=<pasta com node_modules/@electric-sql/pglite> node tests/proj-perfil-processo-sql.test.mjs
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
  console.log('proj-perfil-processo-sql: SKIP (instale @electric-sql/pglite e defina PGLITE_PATH)');
  process.exit(0);
}

const migDir = path.join(here, '..', 'supabase', 'migrations');
const semNotify = s => s.replace(/NOTIFY pgrst[^;]*;/g, '');
const ler = f => fs.readFileSync(path.join(migDir, f), 'utf8');
const migRaw = ler('20261009173000_proj_perfil_processo.sql');
const mig = semNotify(migRaw);
const codigo = migRaw.slice(0, migRaw.indexOf('-- Validação')).replace(/--[^\n]*/g, '');
const desfazer = migRaw.slice(migRaw.indexOf('-- Para desfazer')).split(/\r?\n/).slice(1)
  .map(l => l.replace(/^--\s?/, '')).join('\n').trim();
const migSeg = semNotify(ler('20261004190000_seguranca_usuarios_sistema.sql'));
const mig11 = semNotify(ler('20261007190000_cena_permissoes_acao.sql'));
const migProg = ler('20261004200000_prog_projetos_agenda.sql');
const iniProg = migProg.indexOf('CREATE OR REPLACE FUNCTION public.cena_prog_pode_programar_projetos()');
const fimMarca = 'GRANT EXECUTE ON FUNCTION public.cena_prog_pode_programar_projetos() TO authenticated;';
const fnProg = migProg.slice(iniProg, migProg.indexOf(fimMarca) + fimMarca.length);

const failed = [];
let total = 0;
const ok = (n, c, d) => { total++; if (!c) failed.push(n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };

// ── Estáticos ───────────────────────────────────────────────────
const TABELAS = ['cena_processo_perfis', 'cena_processo_perfis_eventos', 'cena_contrato_processo_perfil',
  'sot_projeto_processo', 'sot_projeto_processo_eventos'];
const RPCS = ['cena_projeto_processo_efetivo', 'cena_projeto_processo_congelar', 'cena_projeto_processo_alterar',
  'cena_contrato_processo_perfil_definir', 'cena_contrato_processo_perfil_revogar',
  'cena_processo_perfil_criar_versao', 'cena_processo_perfil_administrar'];
const INTERNAS = ['sot_projeto_processo_contexto', 'sot_projeto_processo_contrato_uuid', 'sot_projeto_processo_sugestao',
  'cena_processo_perfis_proteger', 'cena_processo_perfis_auditar', 'cena_contrato_processo_perfil_proteger',
  'sot_projeto_processo_proteger', 'sot_projeto_processo_auditar', 'cena_processo_historico_imutavel',
  'cena_processo_perfil_exigir', 'cena_processo_exigir_sessao', 'sot_projeto_processo_autorizar',
  'sot_projeto_processo_gravar', 'cena_processo_perfil_exigir_admin'];
const FUNCOES = [...INTERNAS, ...RPCS];
const inLista = l => l.map(x => `'${x}'`).join(',');

ok('migration recarrega o cache do PostgREST', /NOTIFY pgrst, 'reload schema';/.test(migRaw));
const codigoLimpo = codigo.trim();
ok('transação explícita: BEGIN; é o primeiro comando', codigoLimpo.startsWith('BEGIN;'));
ok('transação explícita: COMMIT; é o último, depois do NOTIFY',
  codigoLimpo.endsWith('COMMIT;') && codigoLimpo.indexOf("NOTIFY pgrst, 'reload schema';") < codigoLimpo.lastIndexOf('COMMIT;'));
ok('um único BEGIN; e um único COMMIT; de topo, sem ROLLBACK',
  (codigo.match(/^BEGIN;/gm) || []).length === 1 && (codigo.match(/^COMMIT;/gm) || []).length === 1 && !/\bROLLBACK\b/i.test(codigo));
ok('desfazer também é transacional', /^BEGIN;/.test(desfazer) && /COMMIT;$/.test(desfazer));
ok('nenhuma autorização por e-mail', !/auth\.jwt\(\)|auth\.email\(\)|\bemail\b/i.test(codigo));
ok('sem GRANT para anon', !/^\s*GRANT\b[^;]*\banon\b/im.test(codigo));
ok('sem GRANT de escrita em tabela para authenticated', !/^\s*GRANT\s+(ALL|INSERT|UPDATE|DELETE|TRUNCATE)\b[^;]*\bauthenticated\b/im.test(codigo));
ok('sem GRANT para PUBLIC', !/^\s*GRANT\b[^;]*\bTO\s+PUBLIC\b/im.test(codigo));
ok('sem policy USING (true) / WITH CHECK (true)', !/(USING|WITH CHECK)\s*\(\s*true\s*\)/i.test(codigo));
ok('sem policy FOR ALL nem de escrita', !/CREATE POLICY[^;]*FOR\s+(ALL|INSERT|UPDATE|DELETE)\b/i.test(codigo));
ok('sem DELETE de dados', !/\bDELETE FROM\b/i.test(codigo));
ok('sem DROP TABLE fora do bloco de desfazer', !/\bDROP TABLE\b/i.test(codigo));
ok('sem credencial/JWT/service key', !/eyJ[A-Za-z0-9_-]{10,}|sb_secret_|SERVICE_ROLE_KEY|sk_live|password\s*=/i.test(migRaw));
ok('não referencia TMA / composicao_dia / equipes_disp / Portaria / fornecedores / RH / Storage',
  !/\btma\b|progTma|composicao_dia|equipes_disp|portaria|fornecedor|\brh_|storage\./i.test(codigo));
ok('não implementa LMS/WL (sem sot_wl, sot_lms_*, wl_id)', !/sot_wl|sot_lms|wl_id/i.test(codigo));
ok('não altera sot_projetos / contratos / usuarios_sistema / matriz da Etapa 1.1',
  !/(ALTER TABLE|UPDATE|INSERT INTO|DELETE FROM|TRUNCATE)\s+(public\.)?(sot_projetos|contratos|usuarios_sistema|cena_acoes|cena_permissoes_acao)\b/i.test(codigo));
ok('não cria permissão nova (cena_acoes / cena_permissoes_acao intocadas)', !/INSERT INTO public\.cena_(acoes|permissoes_acao)\b/i.test(codigo));
ok('sem FK física para sot_projetos', !/REFERENCES\s+public\.sot_projetos/i.test(codigo));
ok('sem gatilho em sot_projetos / sot_materiais / sot_atividades',
  !/ON\s+public\.(sot_projetos|sot_materiais|sot_atividades)\b/i.test(codigo));
ok('sem CAST direto de sot_projetos.contrato_id para uuid', !/contrato_id::uuid|contrato_id\)::uuid/i.test(codigo));
ok('sem backfill: um único INSERT em sot_projeto_processo (dentro de sot_projeto_processo_gravar)',
  (codigo.match(/INSERT INTO public\.sot_projeto_processo\s*\(/g) || []).length === 1);
ok('sem semear contrato → perfil', (codigo.match(/INSERT INTO public\.cena_contrato_processo_perfil\b/g) || []).length === 1
  && !/INSERT INTO public\.cena_contrato_processo_perfil[\s\S]{0,200}VALUES\s*\(\s*'/i.test(codigo));
ok('não semeia perfil ENEL / EQUATORIAL / RDSE / RDSC', !/'(ENEL[A-Z_]*|EQUATORIAL_PLPT|RDSE[A-Z_]*|RDSC[A-Z_]*)'/.test(codigo));
ok('não percorre pg_policies nem apaga policy por nome dinâmico', !/pg_policies/i.test(codigo) && !/DROP POLICY\s+%I/i.test(codigo));
const dropsPolicy = [...codigo.matchAll(/DROP POLICY\s+(?:IF EXISTS\s+)?(\w+)\s+ON\s+public\.(\w+)/gi)].map(m => `${m[2]}.${m[1]}`).sort();
ok('DROP POLICY só das 5 policies desta migration', JSON.stringify(dropsPolicy) === JSON.stringify([
  'cena_contrato_processo_perfil.cena_contrato_processo_perfil_select_erp',
  'cena_processo_perfis.cena_processo_perfis_select_erp',
  'cena_processo_perfis_eventos.cena_processo_perfis_eventos_select_admin',
  'sot_projeto_processo.sot_projeto_processo_select_erp',
  'sot_projeto_processo_eventos.sot_projeto_processo_eventos_select_admin']), dropsPolicy);
ok('todo DROP POLICY é IF EXISTS', !/DROP POLICY\s+(?!IF EXISTS)/i.test(codigo));
ok('autorização só por cena_pode(PROJ_ALTERAR_PERFIL_PROCESSO, ...) — 4 pontos (projeto, sugestão x2, catálogo)',
  (codigo.match(/cena_pode\('PROJ_ALTERAR_PERFIL_PROCESSO'/g) || []).length === 4
  && !/cena_pode\('(?!PROJ_ALTERAR_PERFIL_PROCESSO')/.test(codigo));
ok('trava por projeto (advisory) e FOR UPDATE na linha congelada',
  /pg_advisory_xact_lock\(hashtextextended\('sot_projeto_processo\|'/.test(codigo)
  && /FROM public\.sot_projeto_processo WHERE projeto_id = p_projeto_id FOR UPDATE/.test(codigo));
ok('um processo por projeto: UNIQUE (projeto_id)', /CONSTRAINT sot_projeto_processo_projeto_key UNIQUE \(projeto_id\)/.test(codigo));
ok('catálogo: UNIQUE (codigo_perfil, versao)', /UNIQUE \(codigo_perfil, versao\)/.test(codigo));

// ── Banco ───────────────────────────────────────────────────────
const U = n => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PERFIS = ['admin', 'gestor', 'coordenador', 'supervisor', 'escritorio', 'administrativo', 'supervisor_tma',
  'equipe', 'encarregado', 'diretoria'];
const UID = Object.fromEntries(PERFIS.map((p, i) => [p, U(i + 1)]));
const U_ADMIN_INATIVO = U(901);
const U_SEM_CADASTRO = U(903);
const C_ATIVO = 'c0000000-0000-4000-8000-000000000001';
const C_CANCELADO = 'c0000000-0000-4000-8000-000000000002';
const C_ATIVO2 = 'c0000000-0000-4000-8000-000000000004';
const C_INEXISTENTE = 'c0000000-0000-4000-8000-0000000000ff';
const P = n => `b0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const P_RDSE = P(1), P_RDSE2 = P(2), P_OUTRO = P(3), P_SEM_CONTRATO = P(4), P_CANCELADO = P(5);
const P_TEXTO = P(6), P_CTR_INEXISTENTE = P(7), P_EXCLUIDO = P(8), P_VAZIO = P(9), P_INEXISTENTE = P(99);

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
  ${PERFIS.map(p => `('${p}', '${p}@cena', '${p}', '${UID[p]}')`).join(',\n  ')};
insert into public.usuarios_sistema (nome, email, perfil, auth_user_id, ativo) values ('ex-admin', 'ex@cena', 'admin', '${U_ADMIN_INATIVO}', false);
create table public.contratos (id uuid primary key default gen_random_uuid(), codigo text, nome text, cliente text, status text);
insert into public.contratos (id, codigo, nome, cliente, status) values
  ('${C_ATIVO}', '4600003971', 'RDSE', 'ENEL', 'Ativo'),
  ('${C_CANCELADO}', '4600000001', 'Cancelado', 'ENEL', 'Cancelado'),
  ('${C_ATIVO2}', '4600000003', 'Outro', 'OUTRO', 'Ativo');
create table public.sot_projetos (id ${opts.idTexto ? 'text' : 'uuid'} primary key, contrato_id text, nome text,
  status text${opts.semDeletedAt ? '' : ', deleted_at timestamptz'});
insert into public.sot_projetos (id, contrato_id, nome, status) values
  ('${P_RDSE}', '${C_ATIVO}', 'Projeto RDSE 1', 'Em execução'),
  ('${P_RDSE2}', '${C_ATIVO}', 'Projeto RDSE 2', 'Recebido'),
  ('${P_OUTRO}', '${C_ATIVO2}', 'Outro', 'Recebido'),
  ('${P_SEM_CONTRATO}', null, 'Sem contrato', 'Recebido'),
  ('${P_VAZIO}', '  ', 'Contrato vazio', 'Recebido'),
  ('${P_CANCELADO}', '${C_CANCELADO}', 'Cancelado', 'Recebido'),
  ('${P_TEXTO}', 'RDSE', 'Contrato texto legado', 'Recebido'),
  ('${P_CTR_INEXISTENTE}', '${C_INEXISTENTE}', 'Contrato inexistente', 'Recebido');
${opts.semDeletedAt ? '' : `insert into public.sot_projetos (id, contrato_id, nome, status, deleted_at) values ('${P_EXCLUIDO}', '${C_ATIVO}', 'Excluído', 'Recebido', now());`}
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
  if (!opts.sem11) await db.exec(mig11);
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
  try { await db.exec(sql); return null; } catch (e) {
    try { await db.exec('ROLLBACK'); } catch (_) {}
    return e.message;
  }
};
const comSessao = async (db, uid, fn) => {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid || '']);
  try { return await fn(); } finally { await db.query(`select set_config('request.jwt.claim.sub', '', false)`); }
};

let db = await novoBanco();
const rpc = (uid, sql, params) => como(db, 'authenticated', uid, async () => {
  try { return { r: (await db.query(sql, params)).rows[0].v }; } catch (err) { return { e: err.message }; }
});
const congelar = (uid, proj, cod, ver, just) =>
  rpc(uid, `select public.cena_projeto_processo_congelar($1::uuid, $2, $3, $4) v`, [proj, cod, ver, just]);
const alterar = (uid, proj, aCod, aVer, cod, ver, just) =>
  rpc(uid, `select public.cena_projeto_processo_alterar($1::uuid, $2, $3, $4, $5, $6) v`, [proj, aCod, aVer, cod, ver, just]);
const criarVersao = (uid, cod, ver, nome, desc, req, just) =>
  rpc(uid, `select public.cena_processo_perfil_criar_versao($1, $2, $3, $4, $5::jsonb, $6) v`,
    [cod, ver, nome, desc, req === null ? null : JSON.stringify(req), just]);
const administrar = (uid, cod, ver, nome, desc, ativo, just) =>
  rpc(uid, `select public.cena_processo_perfil_administrar($1, $2, $3, $4, $5::boolean, $6) v`, [cod, ver, nome, desc, ativo, just]);
const sugerir = (uid, ctr, cod, ver, just) =>
  rpc(uid, `select public.cena_contrato_processo_perfil_definir($1::uuid, $2, $3, $4) v`, [ctr, cod, ver, just]);
const revogarSug = (uid, ctr, just) =>
  rpc(uid, `select public.cena_contrato_processo_perfil_revogar($1::uuid, $2) v`, [ctr, just]);
const efetivo = (uid, proj) => como(db, 'authenticated', uid, async () =>
  (await db.query(`select * from public.cena_projeto_processo_efetivo($1::uuid)`, [proj])).rows);
const linhaProjeto = async proj => (await db.query(`select * from public.sot_projeto_processo where projeto_id = $1`, [proj])).rows;
const eventosProjeto = async proj => (await db.query(`select * from public.sot_projeto_processo_eventos where projeto_id = $1 order by id`, [proj])).rows;
const usrId = async uid => (await db.query(`select id::text v from public.usuarios_sistema where auth_user_id = $1`, [uid])).rows[0].v;

const retratoLegado = async () => (await db.query(`
  select (select md5(string_agg(t::text, '' order by t.id)) from public.sot_projetos t) proj,
         (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'sot_projetos')::int cols,
         (select count(*) from pg_trigger where tgrelid = 'public.sot_projetos'::regclass and not tgisinternal)::int trg_proj,
         (select count(*) from pg_policies where tablename = 'sot_projetos')::int pol_proj,
         (select count(*) from pg_constraint where conrelid = 'public.sot_projetos'::regclass)::int con_proj,
         (select md5(string_agg(t::text, '' order by t.id)) from public.composicao_dia t) cd,
         (select md5(string_agg(t::text, '' order by t.id)) from public.equipes_disp t) ed,
         (select count(*) from pg_trigger where tgrelid in ('public.composicao_dia'::regclass, 'public.equipes_disp'::regclass))::int trg_tma,
         (select count(*) from pg_policies where tablename in ('composicao_dia', 'equipes_disp'))::int pol_tma,
         (select md5(string_agg(t::text, '' order by t.id)) from public.contratos t) ctr,
         (select md5(string_agg(t::text, '' order by t.id)) from public.usuarios_sistema t) usr,
         (select md5(string_agg(t::text, '' order by t.codigo)) from public.cena_acoes t) acoes,
         (select md5(string_agg(pg_get_functiondef(p.oid), '' order by p.proname)) from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname in
           ('cena_pode', 'cena_prog_pode_programar_projetos', 'cena_usuario_perfil_sessao', 'cena_usuarios_pode_administrar')) fns`)).rows[0];
const legadoAntes = await retratoLegado();
const matrizAntes = (await db.query(`select md5(string_agg(t::text, '' order by t.id)) h from public.cena_permissoes_acao t`)).rows[0].h;

let erro = await tentaExec(db, mig);
ok('aplica sem erro', erro === null, erro);
const contagem = async () => (await db.query(`select
  (select count(*) from public.cena_processo_perfis)::int perfis,
  (select count(*) from public.cena_processo_perfis_eventos)::int perfis_ev,
  (select count(*) from public.cena_contrato_processo_perfil)::int contratos,
  (select count(*) from public.sot_projeto_processo)::int projetos,
  (select count(*) from public.sot_projeto_processo_eventos)::int projetos_ev`)).rows[0];
const c1 = await contagem();
erro = await tentaExec(db, mig);
ok('reaplica sem erro (idempotente)', erro === null, erro);
ok('reaplicar não duplica perfis, eventos nem sugestões', JSON.stringify(c1) === JSON.stringify(await contagem()), c1);
ok('seed: só BASE_PROJETOS v1', c1.perfis === 1, c1);
const base = (await db.query(`select codigo_perfil, versao, ativo, requisitos, justificativa, id from public.cena_processo_perfis`)).rows[0];
ok('seed: BASE_PROJETOS v1 ativo, requisitos vazios, com id e justificativa', base.codigo_perfil === 'BASE_PROJETOS' && base.versao === 1
  && base.ativo === true && JSON.stringify(base.requisitos) === '{}' && /^[0-9a-f-]{36}$/.test(base.id) && base.justificativa.length > 0, base);
ok('seed: 1 evento CRIAR no catálogo', c1.perfis_ev === 1, c1);
ok('nenhum contrato mapeado (sem seed contrato → perfil)', c1.contratos === 0, c1);
ok('C: sem backfill — nenhum projeto com processo congelado', c1.projetos === 0 && c1.projetos_ev === 0, c1);
ok('migration não muda sot_projetos, TMA, contratos, usuários, ações nem cena_pode',
  JSON.stringify(legadoAntes) === JSON.stringify(await retratoLegado()), [legadoAntes, await retratoLegado()]);

// ── Estrutura: tabelas, RLS, policies, grants ───────────────────
const rls = (await db.query(`select relname, relrowsecurity r, relforcerowsecurity f from pg_class
  where relnamespace = 'public'::regnamespace and relname in (${inLista(TABELAS)})`)).rows;
ok('5 tabelas criadas', rls.length === 5, rls.map(r => r.relname));
ok('RLS ENABLE + FORCE nas 5 tabelas', rls.every(r => r.r && r.f), rls);
const pols = (await db.query(`select tablename, policyname, cmd, roles::text roles from pg_policies
  where tablename in (${inLista(TABELAS)}) order by 1`)).rows;
ok('só policies de SELECT para authenticated (5)', pols.length === 5 && pols.every(p => p.cmd === 'SELECT' && p.roles === '{authenticated}'), pols);
const grants = (await db.query(`
  select c.relname, r.rolname, string_agg(x.p, ',' order by x.p) privs
  from pg_class c cross join (values ('anon'), ('authenticated'), ('service_role'), ('public')) r(rolname)
  cross join lateral (select unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p) x
  where c.relnamespace = 'public'::regnamespace and c.relname in (${inLista(TABELAS)})
    and has_table_privilege(r.rolname, c.oid, x.p)
  group by 1, 2 order by 1, 2`)).rows;
ok('anon e PUBLIC sem privilégio nas 5 tabelas', grants.every(g => g.rolname !== 'anon' && g.rolname !== 'public'), grants);
ok('authenticated e service_role só com SELECT', grants.every(g => g.privs === 'SELECT'), grants);
const seqs = (await db.query(`select has_sequence_privilege('anon', pg_get_serial_sequence('public.sot_projeto_processo_eventos', 'id'), 'USAGE') a,
  has_sequence_privilege('authenticated', pg_get_serial_sequence('public.cena_processo_perfis_eventos', 'id'), 'USAGE') b`)).rows[0];
ok('sequências dos históricos sem acesso anon/authenticated', seqs.a === false && seqs.b === false, seqs);
const uniq = (await db.query(`select conname from pg_constraint where conrelid = 'public.sot_projeto_processo'::regclass and contype = 'u'`)).rows;
ok('M: constraint UNIQUE (projeto_id) instalada', uniq.some(u => u.conname === 'sot_projeto_processo_projeto_key'), uniq);
const fkProj = (await db.query(`select count(*)::int n from pg_constraint where contype = 'f' and confrelid = 'public.sot_projetos'::regclass`)).rows[0].n;
ok('nenhuma FK aponta para sot_projetos', fkProj === 0, fkProj);
const fns = (await db.query(`select p.proname, p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '') cfg,
    has_function_privilege('anon', p.oid, 'EXECUTE') anon_x, has_function_privilege('authenticated', p.oid, 'EXECUTE') auth_x,
    has_function_privilege('service_role', p.oid, 'EXECUTE') srv_x
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (${inLista(FUNCOES)})`)).rows;
ok('21 funções criadas', fns.length === 21, fns.map(f => f.proname));
ok('todas com search_path = public, pg_temp', fns.every(f => /search_path=public, pg_temp/.test(f.cfg)), fns.filter(f => !/search_path=public, pg_temp/.test(f.cfg)));
ok('gatilhos de proteção são SECURITY INVOKER (current_user = quem chama)',
  ['sot_projeto_processo_proteger', 'cena_processo_perfis_proteger', 'cena_contrato_processo_perfil_proteger', 'cena_processo_historico_imutavel']
    .every(n => fns.find(f => f.proname === n)?.prosecdef === false));
ok('demais funções são SECURITY DEFINER (leem tabelas com RLS FORCE)',
  fns.filter(f => !['sot_projeto_processo_proteger', 'cena_processo_perfis_proteger', 'cena_contrato_processo_perfil_proteger',
    'cena_processo_historico_imutavel'].includes(f.proname)).every(f => f.prosecdef === true));
ok('A: anon não executa nenhuma função da etapa', fns.every(f => f.anon_x === false), fns.filter(f => f.anon_x).map(f => f.proname));
ok('authenticated executa só as 7 RPCs', fns.filter(f => f.auth_x).map(f => f.proname).sort().join() === [...RPCS].sort().join(),
  fns.filter(f => f.auth_x).map(f => f.proname));
ok('service_role não executa nenhuma função da etapa', fns.every(f => f.srv_x === false), fns.filter(f => f.srv_x).map(f => f.proname));

// ── A. anon ─────────────────────────────────────────────────────
for (const t of TABELAS) {
  let e = await como(db, 'anon', null, () => tenta(db, `select * from public.${t}`));
  ok(`A: anon não lê ${t}`, /permission denied/i.test(e || ''), e);
  e = await como(db, 'anon', null, () => tenta(db, `delete from public.${t}`));
  ok(`A: anon não apaga ${t}`, /permission denied/i.test(e || ''), e);
}
let e = await como(db, 'anon', null, () => tenta(db, `insert into public.sot_projeto_processo (projeto_id, perfil_codigo, perfil_versao, origem_congelamento, justificativa, congelado_por_auth, criado_por_auth) values ('${P_RDSE}', 'BASE_PROJETOS', 1, 'GESTOR', 'x', '${UID.admin}', '${UID.admin}')`));
ok('A: anon não cria processo', /permission denied/i.test(e || ''), e);
e = await como(db, 'anon', null, () => tenta(db, `update public.cena_processo_perfis set nome = 'x'`));
ok('A: anon não altera catálogo', /permission denied/i.test(e || ''), e);
for (const [f, args] of [
  ['cena_projeto_processo_efetivo', `'${P_RDSE}'::uuid`],
  ['cena_projeto_processo_congelar', `'${P_RDSE}'::uuid, 'BASE_PROJETOS', 1, 'x'`],
  ['cena_projeto_processo_alterar', `'${P_RDSE}'::uuid, 'BASE_PROJETOS', 1, 'BASE_PROJETOS', 1, 'x'`],
  ['cena_contrato_processo_perfil_definir', `'${C_ATIVO}'::uuid, 'BASE_PROJETOS', 1, 'x'`],
  ['cena_contrato_processo_perfil_revogar', `'${C_ATIVO}'::uuid, 'x'`],
  ['cena_processo_perfil_criar_versao', `'PERFIL_X', 1, 'x', 'x', '{}'::jsonb, 'x'`],
  ['cena_processo_perfil_administrar', `'BASE_PROJETOS', 1, 'x', null, null, 'x'`],
]) {
  e = await como(db, 'anon', null, () => tenta(db, `select public.${f}(${args})`));
  ok(`A: anon não executa ${f}`, /permission denied/i.test(e || ''), e);
}

// ── B. authenticated sem usuário ERP ativo ──────────────────────
for (const [nome, uid] of [['sem sessão', null], ['auth sem cadastro', U_SEM_CADASTRO], ['usuário inativo', U_ADMIN_INATIVO]]) {
  e = await como(db, 'authenticated', uid, () => tenta(db, `select * from public.cena_projeto_processo_efetivo($1::uuid)`, [P_RDSE]));
  ok(`B: ${nome} — perfil efetivo recusado`, /sem sessão/.test(e || ''), e);
  let r = await congelar(uid, P_RDSE, 'BASE_PROJETOS', 1, 'Decisão do gestor');
  ok(`B: ${nome} — congelar recusado`, /sem sessão/.test(r.e || ''), r);
  r = await criarVersao(uid, 'PERFIL_X', 1, 'x', 'x', {}, 'x');
  ok(`B: ${nome} — criar versão recusado`, /sem sessão/.test(r.e || ''), r);
  r = await sugerir(uid, C_ATIVO, 'BASE_PROJETOS', 1, 'x');
  ok(`B: ${nome} — sugestão recusada`, /sem sessão/.test(r.e || ''), r);
}
const conta = (uid, t) => como(db, 'authenticated', uid, async () => (await db.query(`select count(*)::int n from public.${t}`)).rows[0].n);
ok('B: auth sem cadastro e usuário inativo não leem nada',
  (await conta(U_SEM_CADASTRO, 'cena_processo_perfis')) === 0 && (await conta(U_ADMIN_INATIVO, 'cena_processo_perfis')) === 0);

// ── C. Projeto legado ───────────────────────────────────────────
let ef = await efetivo(UID.equipe, P_RDSE);
ok('C: projeto sem linha → BASE_PROJETOS derivado (sem versão, sem requisitos, sem sugestão)',
  ef.length === 1 && ef[0].congelado === false && ef[0].perfil_codigo === 'BASE_PROJETOS' && ef[0].perfil_versao === null
  && ef[0].origem === 'SEM_REGISTRO_BASE_PROJETOS' && ef[0].requisitos === null && ef[0].congelado_em === null
  && ef[0].sugerido_perfil_codigo === null && ef[0].sugerido_perfil_versao === null, ef);
ok('C: projeto inexistente → nenhuma linha', (await efetivo(UID.equipe, P_INEXISTENTE)).length === 0);
ok('C: projeto com contrato texto legado → BASE_PROJETOS, sem erro', (await efetivo(UID.equipe, P_TEXTO))[0]?.congelado === false);
ok('C: consultar o perfil não cria linha', (await contagem()).projetos === 0);

// ── Escrita direta pelo frontend ────────────────────────────────
for (const [t, sql] of [
  ['sot_projeto_processo', `insert into public.sot_projeto_processo (projeto_id, perfil_codigo, perfil_versao, origem_congelamento, justificativa, congelado_por_auth, criado_por_auth) values ('${P_RDSE}', 'BASE_PROJETOS', 1, 'GESTOR', 'x', '${UID.admin}', '${UID.admin}')`],
  ['sot_projeto_processo (update)', `update public.sot_projeto_processo set perfil_versao = 2`],
  ['sot_projeto_processo (delete)', `delete from public.sot_projeto_processo`],
  ['cena_processo_perfis', `insert into public.cena_processo_perfis (codigo_perfil, versao, nome, descricao, justificativa) values ('PERFIL_X', 1, 'x', 'x', 'x')`],
  ['cena_processo_perfis (update)', `update public.cena_processo_perfis set requisitos = '{"x":1}'`],
  ['cena_contrato_processo_perfil', `insert into public.cena_contrato_processo_perfil (contrato_id, perfil_codigo, perfil_versao, justificativa, definido_por_auth) values ('${C_ATIVO}', 'BASE_PROJETOS', 1, 'x', '${UID.admin}')`],
  ['sot_projeto_processo_eventos', `insert into public.sot_projeto_processo_eventos (projeto_id, tipo_evento, origem, perfil_codigo_anterior, perfil_codigo_novo, perfil_versao_novo, justificativa, por_auth) values ('${P_RDSE}', 'CONGELAR', 'GESTOR', 'BASE_PROJETOS', 'BASE_PROJETOS', 1, 'x', '${UID.admin}')`],
]) {
  e = await como(db, 'authenticated', UID.admin, () => tenta(db, sql));
  ok(`authenticated (admin) não grava direto em ${t}`, /permission denied/i.test(e || ''), e);
}
for (const [f, args] of [
  ['sot_projeto_processo_contexto', `'${P_RDSE}'::uuid`],
  ['sot_projeto_processo_contrato_uuid', `'${C_ATIVO}'`],
  ['sot_projeto_processo_sugestao', `'${C_ATIVO}'`],
  ['cena_processo_perfil_exigir', `'BASE_PROJETOS', 1`],
  ['cena_processo_exigir_sessao', ``],
  ['sot_projeto_processo_autorizar', `'${P_RDSE}'::uuid`],
  ['sot_projeto_processo_gravar', `'${P_RDSE}'::uuid, 'CONGELAR', 'BASE_PROJETOS', 1, 'GESTOR', 'x'`],
  ['cena_processo_perfil_exigir_admin', ``],
]) {
  e = await como(db, 'authenticated', UID.admin, () => tenta(db, `select public.${f}(${args})`));
  ok(`authenticated não executa função interna ${f}`, /permission denied/i.test(e || ''), e);
}

// ── J. Perfil novo (catálogo pela regra global de PROJ_ALTERAR_PERFIL_PROCESSO) ──
let r = await criarVersao(UID.coordenador, 'PERFIL_TESTE', 1, 'Perfil de teste', 'Só para o teste', { exige: 'teste' }, 'Teste');
ok('J: sem PROJ_ALTERAR_PERFIL_PROCESSO não cria versão', /catálogo exige PROJ_ALTERAR_PERFIL_PROCESSO global/.test(r.e || ''), r);
r = await criarVersao(UID.admin, 'PERFIL_TESTE', 2, 'Perfil de teste', 'Só para o teste', { exige: 'teste' }, 'Teste');
ok('J: primeira versão tem de ser 1', /próxima versão de PERFIL_TESTE é 1/.test(r.e || ''), r);
r = await criarVersao(UID.admin, 'PERFIL_TESTE', 1, 'Perfil de teste', 'Só para o teste', { exige: 'teste' }, '  ');
ok('J: criar versão exige justificativa', /justificativa obrigatória/.test(r.e || ''), r);
r = await criarVersao(UID.admin, 'perfil teste', 1, 'x', 'x', {}, 'x');
ok('J: código inválido recusado', /código inválido/.test(r.e || ''), r);
r = await criarVersao(UID.admin, 'PERFIL_TESTE', 1, 'x', 'x', ['lista'], 'x');
ok('J: requisitos não-objeto recusados', /requisitos devem ser objeto/.test(r.e || ''), r);
r = await criarVersao(UID.admin, 'BASE_PROJETOS', 2, 'Base 2', 'x', { a: 1 }, 'x');
ok('J: BASE_PROJETOS não recebe nova versão', /BASE_PROJETOS representa o fluxo atual/.test(r.e || ''), r);
r = await criarVersao(UID.admin, 'PERFIL_TESTE', 1, 'Perfil de teste', 'Só para o teste', { exige: 'teste' }, 'Criação do perfil de teste');
ok('J: admin cria PERFIL_TESTE v1', /^[0-9a-f-]{36}$/.test(r.r || ''), r);
const idV1 = r.r;
r = await criarVersao(UID.admin, 'PERFIL_TESTE', 1, 'Perfil de teste', 'Só para o teste', { exige: 'teste' }, 'Duplo clique');
ok('J: repetir a criação com o mesmo conteúdo devolve a mesma versão (idempotente)', r.r === idV1, r);
r = await criarVersao(UID.admin, 'PERFIL_TESTE', 1, 'Perfil de teste', 'Só para o teste', { exige: 'outra' }, 'Conteúdo diferente');
ok('J: mesma versão com outro conteúdo recusada', /já existe com outro conteúdo/.test(r.e || ''), r);
const autoriaV1 = (await db.query(`select criado_por_auth, atualizado_por_auth from public.cena_processo_perfis where id = $1`, [idV1])).rows[0];
ok('J: autoria da versão = auth.uid() de quem criou', autoriaV1.criado_por_auth === UID.admin && autoriaV1.atualizado_por_auth === UID.admin, autoriaV1);

// ── D. Contrato com sugestão ────────────────────────────────────
r = await sugerir(UID.equipe, C_ATIVO, 'PERFIL_TESTE', 1, 'Tentativa');
ok('D: sugestão sem permissão recusada', /sem permissão/.test(r.e || ''), r);
r = await sugerir(UID.admin, C_ATIVO, 'PERFIL_TESTE', 1, ' ');
ok('D: sugestão exige justificativa', /justificativa obrigatória/.test(r.e || ''), r);
r = await sugerir(UID.admin, C_CANCELADO, 'PERFIL_TESTE', 1, 'Contrato cancelado');
ok('D: sugestão em contrato não ativo recusada', /sem permissão/.test(r.e || ''), r);
r = await sugerir(UID.admin, C_ATIVO, 'PERFIL_TESTE', 1, 'Contrato sugere o perfil de teste');
ok('D: admin define a sugestão do contrato', /^[0-9a-f-]{36}$/.test(r.r || ''), r);
const sugId = r.r;
r = await sugerir(UID.admin, C_ATIVO, 'PERFIL_TESTE', 1, 'Repetido');
ok('D: sugestão igual devolve a vigente', r.r === sugId, r);
ef = await efetivo(UID.equipe, P_RDSE2);
ok('D: projeto do contrato mostra a sugestão, mas o efetivo continua BASE_PROJETOS derivado',
  ef[0].congelado === false && ef[0].perfil_codigo === 'BASE_PROJETOS' && ef[0].perfil_versao === null
  && ef[0].sugerido_perfil_codigo === 'PERFIL_TESTE' && ef[0].sugerido_perfil_versao === 1, ef);
ok('D: sugestão não congela projeto automaticamente', (await contagem()).projetos === 0 && (await contagem()).projetos_ev === 0);
ef = await efetivo(UID.equipe, P_OUTRO);
ok('D: projeto de contrato sem sugestão: sugerido vazio', ef[0].sugerido_perfil_codigo === null, ef);

// ── H. Usuário sem permissão / entradas inválidas ───────────────
for (const p of ['coordenador', 'supervisor', 'escritorio', 'administrativo', 'supervisor_tma', 'equipe', 'encarregado', 'diretoria']) {
  r = await congelar(UID[p], P_RDSE, 'PERFIL_TESTE', 1, 'Decisão do gestor');
  ok(`H: congelar sem PROJ_ALTERAR_PERFIL_PROCESSO recusado — ${p}`, /sem permissão PROJ_ALTERAR_PERFIL_PROCESSO/.test(r.e || ''), r);
}
r = await congelar(UID.admin, P_RDSE, 'PERFIL_TESTE', 1, '');
ok('H: justificativa vazia recusada', /justificativa obrigatória/.test(r.e || ''), r);
r = await congelar(UID.admin, P_RDSE, 'PERFIL_TESTE', 1, null);
ok('H: justificativa nula recusada', /justificativa obrigatória/.test(r.e || ''), r);
r = await congelar(UID.admin, P_RDSE, 'PERFIL_INEXISTENTE', 1, 'Decisão do gestor');
ok('H: perfil inexistente recusado', /perfil de processo inexistente/.test(r.e || ''), r);
r = await congelar(UID.admin, P_RDSE, 'PERFIL_TESTE', 7, 'Decisão do gestor');
ok('H: versão inexistente recusada', /versão 7 inexistente/.test(r.e || ''), r);
r = await congelar(UID.admin, P_RDSE, 'PERFIL_TESTE', null, 'Decisão do gestor');
ok('H: versão nula recusada', /código e versão obrigatórios/.test(r.e || ''), r);
r = await congelar(UID.admin, P_INEXISTENTE, 'PERFIL_TESTE', 1, 'Decisão do gestor');
ok('H: projeto inexistente recusado', /projeto inexistente/.test(r.e || ''), r);
r = await congelar(UID.admin, null, 'PERFIL_TESTE', 1, 'Decisão do gestor');
ok('H: projeto nulo recusado', /projeto obrigatório/.test(r.e || ''), r);
ok('H: nada gravado pelas tentativas recusadas', (await contagem()).projetos === 0 && (await contagem()).projetos_ev === 0);

// ── E. Congelamento ─────────────────────────────────────────────
r = await congelar(UID.admin, P_RDSE, 'PERFIL_TESTE', 1, 'Gestor definiu o processo');
ok('E: admin congela', r.r && r.r.operacao === 'CONGELAR' && r.r.perfil_codigo === 'PERFIL_TESTE' && r.r.perfil_versao === 1, r);
let linha = (await linhaProjeto(P_RDSE))[0];
ok('E: linha congelada com versão correta, origem GESTOR, autoria = auth.uid() do admin',
  linha && linha.perfil_codigo === 'PERFIL_TESTE' && linha.perfil_versao === 1 && linha.origem_congelamento === 'GESTOR'
  && linha.criado_por_auth === UID.admin && linha.congelado_por_auth === UID.admin
  && linha.justificativa === 'Gestor definiu o processo' && /^[0-9a-f-]{36}$/.test(linha.id), linha);
let evs = await eventosProjeto(P_RDSE);
ok('E: evento CONGELAR: BASE_PROJETOS (derivado) → PERFIL_TESTE v1, justificativa, auth, usuário, contrato e sugestão',
  evs.length === 1 && evs[0].tipo_evento === 'CONGELAR' && evs[0].origem === 'GESTOR'
  && evs[0].perfil_codigo_anterior === 'BASE_PROJETOS' && evs[0].perfil_versao_anterior === null
  && evs[0].perfil_codigo_novo === 'PERFIL_TESTE' && evs[0].perfil_versao_novo === 1
  && evs[0].justificativa === 'Gestor definiu o processo' && evs[0].por_auth === UID.admin
  && evs[0].por_usuario_id === await usrId(UID.admin) && evs[0].contrato_id_projeto === C_ATIVO
  && evs[0].metadados.anterior_derivado === true && evs[0].metadados.sugestao_contrato?.perfil_codigo === 'PERFIL_TESTE'
  && evs[0].registrado_em instanceof Date, evs);
ef = await efetivo(UID.equipe, P_RDSE);
ok('E: perfil efetivo = congelado (com requisitos da versão) e sugestão em coluna separada',
  ef.length === 1 && ef[0].congelado === true && ef[0].perfil_codigo === 'PERFIL_TESTE' && ef[0].perfil_versao === 1
  && ef[0].origem === 'GESTOR' && JSON.stringify(ef[0].requisitos) === '{"exige":"teste"}'
  && ef[0].sugerido_perfil_codigo === 'PERFIL_TESTE', ef);
ef = await efetivo(UID.equipe, P_RDSE2);
ok('E: outro projeto do mesmo contrato continua derivado', ef[0].congelado === false, ef);

// ── F/M. Duplicidade e idempotência ─────────────────────────────
r = await congelar(UID.admin, P_RDSE, 'PERFIL_TESTE', 1, 'Duplo clique');
ok('F: segundo congelamento igual → SEM_MUDANCA', r.r && r.r.operacao === 'SEM_MUDANCA', r);
r = await congelar(UID.gestor, P_RDSE, 'BASE_PROJETOS', 1, 'Outra aba com outro perfil');
ok('F: congelar de novo com outro perfil recusado (exige alterar)', /já congelado em PERFIL_TESTE v1/.test(r.e || ''), r);
ok('F: continua 1 linha e 1 evento', (await linhaProjeto(P_RDSE)).length === 1 && (await eventosProjeto(P_RDSE)).length === 1);
e = await comSessao(db, UID.admin, () => tenta(db, `insert into public.sot_projeto_processo (projeto_id, perfil_codigo, perfil_versao, origem_congelamento, justificativa, congelado_por_auth, criado_por_auth)
  values ('${P_RDSE}', 'BASE_PROJETOS', 1, 'GESTOR', 'segunda linha', '${UID.admin}', '${UID.admin}')`));
ok('M: segunda linha do mesmo projeto recusada pelo banco (UNIQUE)', /duplicate key|unique/i.test(e || ''), e);

// ── G. Mudança de perfil ────────────────────────────────────────
r = await criarVersao(UID.gestor, 'PERFIL_TESTE', 2, 'Perfil de teste', 'Versão 2', { exige: 'teste', extra: true }, 'Nova regra do processo');
ok('J: gestor cria PERFIL_TESTE v2', /^[0-9a-f-]{36}$/.test(r.r || ''), r);
r = await criarVersao(UID.gestor, 'PERFIL_TESTE', 4, 'x', 'x', {}, 'Pulando versão');
ok('J: não pula número de versão', /próxima versão de PERFIL_TESTE é 3/.test(r.e || ''), r);
for (const p of ['coordenador', 'escritorio', 'equipe']) {
  r = await alterar(UID[p], P_RDSE, 'PERFIL_TESTE', 1, 'PERFIL_TESTE', 2, 'Tentativa');
  ok(`H: alterar sem PROJ_ALTERAR_PERFIL_PROCESSO recusado — ${p}`, /sem permissão/.test(r.e || ''), r);
}
r = await alterar(UID.gestor, P_RDSE, 'PERFIL_TESTE', 1, 'PERFIL_TESTE', 2, '   ');
ok('G: alterar exige justificativa', /justificativa obrigatória/.test(r.e || ''), r);
r = await alterar(UID.gestor, P_RDSE, null, null, 'PERFIL_TESTE', 2, 'Sem informar o atual');
ok('G: alterar exige o perfil atual visto pelo usuário', /informe o perfil e a versão atuais/.test(r.e || ''), r);
r = await alterar(UID.gestor, P_RDSE2, 'BASE_PROJETOS', 1, 'PERFIL_TESTE', 2, 'Projeto não congelado');
ok('G: alterar projeto não congelado recusado (usar congelar)', /use cena_projeto_processo_congelar/.test(r.e || ''), r);
ok('G: tentativas recusadas não gravam evento', (await eventosProjeto(P_RDSE)).length === 1);
r = await alterar(UID.gestor, P_RDSE, 'PERFIL_TESTE', 1, 'PERFIL_TESTE', 2, 'Projeto passa para a versão 2');
ok('G: gestor altera para PERFIL_TESTE v2', r.r && r.r.operacao === 'ALTERAR' && r.r.perfil_versao === 2, r);
evs = await eventosProjeto(P_RDSE);
ok('G: evento ALTERAR completo: PERFIL_TESTE v1 → v2, justificativa, auth do gestor',
  evs.length === 2 && evs[1].tipo_evento === 'ALTERAR' && evs[1].perfil_codigo_anterior === 'PERFIL_TESTE'
  && evs[1].perfil_versao_anterior === 1 && evs[1].perfil_codigo_novo === 'PERFIL_TESTE' && evs[1].perfil_versao_novo === 2
  && evs[1].por_auth === UID.gestor && evs[1].justificativa === 'Projeto passa para a versão 2'
  && evs[1].metadados.anterior_derivado === false, evs[1]);
linha = (await linhaProjeto(P_RDSE))[0];
ok('G: alteração preserva o congelamento original e registra quem alterou', linha.criado_por_auth === UID.admin
  && linha.congelado_por_auth === UID.gestor && linha.perfil_versao === 2, linha);
r = await alterar(UID.admin, P_RDSE, 'PERFIL_TESTE', 1, 'BASE_PROJETOS', 1, 'Aba antiga ainda via a v1');
ok('M: alteração com perfil atual desatualizado (outra aba) recusada', /processo do projeto mudou \(agora PERFIL_TESTE v2\)/.test(r.e || ''), r);
r = await alterar(UID.admin, P_RDSE, 'PERFIL_TESTE', 2, 'PERFIL_TESTE', 2, 'Mesmo perfil');
ok('G: alterar para o mesmo perfil → SEM_MUDANCA sem evento', r.r && r.r.operacao === 'SEM_MUDANCA' && (await eventosProjeto(P_RDSE)).length === 2, r);

// ── Escopo por contrato (cena_pode com o contrato do projeto) ───
r = await congelar(UID.gestor, P_OUTRO, 'BASE_PROJETOS', 1, 'Gestor congela no base');
ok('gestor congela outro projeto no BASE_PROJETOS v1', r.r && r.r.operacao === 'CONGELAR', r);
e = await como(db, 'authenticated', UID.admin, () => tenta(db,
  `select public.cena_permissao_acao_negar('gestor', 'PROJ_ALTERAR_PERFIL_PROCESSO', 'Sem troca de perfil no contrato 2', $1::uuid)`, [C_ATIVO2]));
ok('regra de contrato negando o gestor criada (Etapa 1.1)', e === null, e);
r = await alterar(UID.gestor, P_OUTRO, 'BASE_PROJETOS', 1, 'PERFIL_TESTE', 2, 'Tentativa no contrato 2');
ok('H: gestor negado no contrato do projeto → recusado', /sem permissão/.test(r.e || ''), r);
r = await criarVersao(UID.gestor, 'PERFIL_TESTE', 3, 'Perfil de teste', 'Versão 3', { v: 3 }, 'Gestor segue com a regra global');
ok('J: negação só no contrato não tira o catálogo (regra global)', /^[0-9a-f-]{36}$/.test(r.r || ''), r);
e = await como(db, 'authenticated', UID.admin, () => tenta(db,
  `select public.cena_permissao_acao_conceder('coordenador', 'PROJ_ALTERAR_PERFIL_PROCESSO', 'Coordenador do contrato 1', $1::uuid)`, [C_ATIVO]));
ok('regra de contrato concedendo ao coordenador criada (Etapa 1.1)', e === null, e);
r = await congelar(UID.coordenador, P_RDSE2, 'PERFIL_TESTE', 2, 'Coordenador do contrato congela');
ok('permissão por contrato: coordenador congela projeto do contrato 1', r.r && r.r.operacao === 'CONGELAR', r);
r = await criarVersao(UID.coordenador, 'PERFIL_TESTE', 4, 'x', 'x', {}, 'Coordenador tenta o catálogo');
ok('J: permissão só de contrato não administra o catálogo', /catálogo exige PROJ_ALTERAR_PERFIL_PROCESSO global/.test(r.e || ''), r);

// ── Contrato do projeto: fail-closed ────────────────────────────
r = await congelar(UID.admin, P_SEM_CONTRATO, 'BASE_PROJETOS', 1, 'Projeto sem contrato');
ok('projeto sem contrato: vale a regra global (admin permitido)', r.r && r.r.operacao === 'CONGELAR', r);
r = await congelar(UID.admin, P_VAZIO, 'BASE_PROJETOS', 1, 'Projeto com contrato em branco');
ok('projeto com contrato em branco: tratado como sem contrato', r.r && r.r.operacao === 'CONGELAR', r);
r = await congelar(UID.admin, P_CANCELADO, 'BASE_PROJETOS', 1, 'Contrato cancelado');
ok('projeto de contrato cancelado → recusado', /sem permissão/.test(r.e || ''), r);
r = await congelar(UID.admin, P_TEXTO, 'BASE_PROJETOS', 1, 'Contrato em texto legado');
ok('projeto com contrato texto que não é contratos.id → recusado sem erro de CAST', /contrato do projeto não identificado/.test(r.e || ''), r);
r = await congelar(UID.admin, P_CTR_INEXISTENTE, 'BASE_PROJETOS', 1, 'Contrato inexistente');
ok('projeto com contrato inexistente → recusado', /contrato do projeto não identificado/.test(r.e || ''), r);
r = await congelar(UID.admin, P_EXCLUIDO, 'BASE_PROJETOS', 1, 'Projeto excluído');
ok('projeto excluído (deleted_at) → recusado', /projeto excluído/.test(r.e || ''), r);

// ── K. Contrato alterado não mexe em projetos congelados ────────
const retratoCongelados = async () => JSON.stringify({
  linhas: (await db.query(`select * from public.sot_projeto_processo order by projeto_id`)).rows,
  eventos: (await db.query(`select id from public.sot_projeto_processo_eventos order by id`)).rows });
const antesSug = await retratoCongelados();
r = await sugerir(UID.admin, C_ATIVO, 'PERFIL_TESTE', 3, 'Contrato passa a sugerir a versão 3');
ok('K: contrato passa a sugerir PERFIL_TESTE v3 (substitui a vigente)', /^[0-9a-f-]{36}$/.test(r.r || '') && r.r !== sugId, r);
ok('K: projetos congelados e histórico inalterados', antesSug === await retratoCongelados());
ef = await efetivo(UID.equipe, P_RDSE);
ok('K: projeto congelado continua na v2; sugestão nova só aparece em sugerido_*',
  ef[0].congelado === true && ef[0].perfil_versao === 2 && ef[0].sugerido_perfil_versao === 3, ef);
await db.exec(`insert into public.sot_projetos (id, contrato_id, nome) values ('${P(10)}', '${C_ATIVO}', 'Projeto novo')`);
ef = await efetivo(UID.equipe, P(10));
ok('K: projeto novo do contrato também não é congelado pela sugestão', ef[0].congelado === false && ef[0].sugerido_perfil_versao === 3, ef);
const hist = (await db.query(`select revogado_em is not null revogada, justificativa_revogacao from public.cena_contrato_processo_perfil
  where contrato_id = $1 order by definido_em, revogado_em nulls last`, [C_ATIVO])).rows;
ok('K: histórico da sugestão preservado (revogada + vigente)', hist.length === 2 && hist[0].revogada
  && /^Substituída: /.test(hist[0].justificativa_revogacao) && !hist[1].revogada, hist);
r = await revogarSug(UID.gestor, C_ATIVO, 'Fim da sugestão');
ok('K: gestor revoga a sugestão', r.r === true, r);
r = await revogarSug(UID.gestor, C_ATIVO, 'De novo');
ok('K: revogar sem vigente → false', r.r === false, r);
ok('K: revogar não mexe em projetos congelados', antesSug === await retratoCongelados());
e = await tenta(db, `delete from public.cena_contrato_processo_perfil`);
ok('sugestão: DELETE recusado (inclusive dono)', /não é apagada/.test(e || ''), e);
e = await tenta(db, `update public.cena_contrato_processo_perfil set justificativa_revogacao = 'reescrito' where revogado_em is not null`);
ok('sugestão revogada não muda', /revogada não muda/.test(e || ''), e);
r = await sugerir(UID.admin, C_ATIVO, 'PERFIL_TESTE', 2, 'Nova sugestão');
e = await tenta(db, `update public.cena_contrato_processo_perfil set perfil_versao = 1 where revogado_em is null`);
ok('sugestão vigente: só revogação é permitida', /só é permitido revogar/.test(e || ''), e);
e = await tenta(db, `insert into public.cena_contrato_processo_perfil (contrato_id, perfil_codigo, perfil_versao, justificativa, definido_por_auth)
  values ('${C_ATIVO}', 'BASE_PROJETOS', 1, 'segunda vigente', '${UID.admin}')`);
ok('uma única sugestão vigente por contrato', /duplicate key|unique/i.test(e || ''), e);

// ── L. Estrutura WL futura não muda o perfil ────────────────────
const antesWl = await retratoCongelados();
await db.exec(`alter table public.sot_projetos add column estrutura_wl text`);
await db.exec(`update public.sot_projetos set estrutura_wl = 'ESTRUTURADO' where id in ('${P_RDSE}', '${P_TEXTO}', '${P(10)}')`);
ef = await efetivo(UID.equipe, P(10));
ok('L: projeto legado ESTRUTURADO em WL continua BASE_PROJETOS derivado', ef[0].congelado === false
  && ef[0].perfil_codigo === 'BASE_PROJETOS' && ef[0].perfil_versao === null, ef);
ef = await efetivo(UID.equipe, P_RDSE);
ok('L: projeto congelado ESTRUTURADO em WL continua no perfil congelado', ef[0].congelado === true && ef[0].perfil_versao === 2, ef);
ok('L: estrutura WL não cria nem altera processo nem histórico', antesWl === await retratoCongelados());
await db.exec(`alter table public.sot_projetos drop column estrutura_wl`);

// ── Proteções para todos (inclusive dono / SQL Editor) ──────────
e = await tenta(db, `delete from public.sot_projeto_processo where projeto_id = '${P_RDSE}'`);
ok('dono: DELETE do processo congelado recusado', /não é apagado/.test(e || ''), e);
e = await tenta(db, `truncate public.sot_projeto_processo`);
ok('dono: TRUNCATE do processo congelado recusado', /não é apagado|truncate a table referenced/i.test(e || ''), e);
e = await tenta(db, `update public.sot_projeto_processo set perfil_codigo = 'BASE_PROJETOS', perfil_versao = 1 where projeto_id = '${P_RDSE}'`);
ok('dono sem sessão: UPDATE direto recusado', /sessão autenticada/.test(e || ''), e);
e = await tenta(db, `insert into public.sot_projeto_processo (projeto_id, perfil_codigo, perfil_versao, origem_congelamento, justificativa, congelado_por_auth, criado_por_auth)
  values ('${P(10)}', 'BASE_PROJETOS', 1, 'GESTOR', 'backfill', '${UID.admin}', '${UID.admin}')`);
ok('dono sem sessão: INSERT direto (backfill) recusado', /sessão autenticada/.test(e || ''), e);
e = await comSessao(db, UID.admin, () => tenta(db, `update public.sot_projeto_processo set criado_por_auth = '${UID.gestor}' where projeto_id = '${P_RDSE}'`));
ok('congelamento original não muda', /congelamento original não mudam/.test(e || ''), e);
e = await comSessao(db, UID.admin, () => tenta(db, `update public.sot_projeto_processo set congelado_por_auth = '${UID.gestor}' where projeto_id = '${P_RDSE}'`));
ok('autoria da alteração = usuário da sessão', /autoria deve ser o usuário da sessão/.test(e || ''), e);
for (const t of ['sot_projeto_processo_eventos', 'cena_processo_perfis_eventos']) {
  e = await tenta(db, `update public.${t} set justificativa = 'reescrito'`);
  ok(`histórico ${t}: UPDATE recusado (append-only)`, /histórico não é alterado/.test(e || ''), e);
  e = await tenta(db, `delete from public.${t}`);
  ok(`histórico ${t}: DELETE recusado`, /histórico não é alterado/.test(e || ''), e);
  e = await tenta(db, `truncate public.${t}`);
  ok(`histórico ${t}: TRUNCATE recusado`, /histórico não é alterado/.test(e || ''), e);
}

// ── I. Versão utilizada: requisitos imutáveis; campos administrativos com histórico ──
e = await tenta(db, `update public.cena_processo_perfis set requisitos = '{"exige":"outra coisa"}' where codigo_perfil = 'PERFIL_TESTE' and versao = 2`);
ok('I: versão usada — requisitos não mudam (nem pelo dono)', /requisitos de uma versão não mudam/.test(e || ''), e);
e = await tenta(db, `update public.cena_processo_perfis set requisitos = '{"x":1}' where codigo_perfil = 'BASE_PROJETOS'`);
ok('I: versão semeada — requisitos não mudam', /requisitos de uma versão não mudam/.test(e || ''), e);
e = await tenta(db, `update public.cena_processo_perfis set versao = 9 where codigo_perfil = 'PERFIL_TESTE' and versao = 3`);
ok('I: número da versão não muda', /não mudam/.test(e || ''), e);
e = await tenta(db, `update public.cena_processo_perfis set codigo_perfil = 'OUTRO_CODIGO' where codigo_perfil = 'PERFIL_TESTE' and versao = 3`);
ok('I: código do perfil não muda', /não mudam/.test(e || ''), e);
e = await tenta(db, `delete from public.cena_processo_perfis where codigo_perfil = 'PERFIL_TESTE'`);
ok('I: DELETE de versão recusado', /não é apagada/.test(e || ''), e);
e = await tenta(db, `truncate public.cena_processo_perfis`);
ok('I: TRUNCATE do catálogo recusado', /não é apagada|truncate/i.test(e || ''), e);
ok('I: requisitos da versão usada intactos', JSON.stringify((await db.query(`select requisitos from public.cena_processo_perfis
  where codigo_perfil = 'PERFIL_TESTE' and versao = 2`)).rows[0].requisitos) === '{"exige":"teste","extra":true}');
r = await administrar(UID.coordenador, 'PERFIL_TESTE', 2, 'Novo nome', null, null, 'Tentativa');
ok('I: administrar sem permissão global recusado', /catálogo exige PROJ_ALTERAR_PERFIL_PROCESSO global/.test(r.e || ''), r);
r = await administrar(UID.admin, 'PERFIL_TESTE', 2, 'Novo nome', null, null, ' ');
ok('I: administrar exige justificativa', /justificativa obrigatória/.test(r.e || ''), r);
r = await administrar(UID.admin, 'PERFIL_TESTE', 2, null, 'Descrição revisada', null, 'Texto de exibição');
ok('I: descrição (administrativa) pode mudar', r.r === true, r);
r = await administrar(UID.admin, 'PERFIL_TESTE', 2, null, 'Descrição revisada', null, 'Mesmo texto');
ok('I: administrar sem mudança → false, sem evento', r.r === false, r);
r = await administrar(UID.admin, 'PERFIL_TESTE', 1, null, null, false, 'Versão 1 substituída pela 2');
ok('I: versão pode ser desativada', r.r === true, r);
r = await administrar(UID.admin, 'BASE_PROJETOS', 1, null, null, false, 'Tentativa');
ok('I: BASE_PROJETOS não é desativado', /BASE_PROJETOS não é desativado/.test(r.e || ''), r);
r = await administrar(UID.admin, 'PERFIL_TESTE', 9, 'x', null, null, 'Versão inexistente');
ok('I: administrar versão inexistente recusado', /versão 9 inexistente/.test(r.e || ''), r);
const evCat = (await db.query(`select tipo_evento, justificativa, antes->>'descricao' antes_desc, depois->>'descricao' depois_desc, por_auth
  from public.cena_processo_perfis_eventos where codigo_perfil = 'PERFIL_TESTE' order by id`)).rows;
ok('I: histórico do catálogo: CRIAR v1, v2, v3, ALTERAR_TEXTO (antes/depois), DESATIVAR, com justificativa e autoria',
  evCat.map(x => x.tipo_evento).join() === 'CRIAR,CRIAR,CRIAR,ALTERAR_TEXTO,DESATIVAR' && evCat[3].antes_desc === 'Versão 2'
  && evCat[3].depois_desc === 'Descrição revisada' && evCat[3].justificativa === 'Texto de exibição' && evCat[3].por_auth === UID.admin
  && evCat[4].justificativa === 'Versão 1 substituída pela 2', evCat);
r = await congelar(UID.admin, P(10), 'PERFIL_TESTE', 1, 'Usar versão inativa');
ok('I: versão inativa não é usada em congelamento novo', /versão 1 inativa/.test(r.e || ''), r);
r = await sugerir(UID.admin, C_ATIVO, 'PERFIL_TESTE', 1, 'Sugerir versão inativa');
ok('I: versão inativa não é usada em sugestão nova', /inativa/.test(r.e || ''), r);
r = await administrar(UID.admin, 'PERFIL_TESTE', 2, null, null, false, 'Desativa a v2');
ef = await efetivo(UID.equipe, P_RDSE);
ok('I: desativar a versão usada não muda o projeto congelado nela', r.r === true && ef[0].congelado === true
  && ef[0].perfil_versao === 2 && JSON.stringify(ef[0].requisitos) === '{"exige":"teste","extra":true}', [r, ef]);

// ── Visibilidade (RLS) ──────────────────────────────────────────
ok('usuário ERP ativo lê processos congelados', await conta(UID.equipe, 'sot_projeto_processo') > 0);
ok('usuário ERP ativo lê o catálogo', await conta(UID.equipe, 'cena_processo_perfis') === 4);
ok('usuário ERP ativo lê as sugestões', await conta(UID.equipe, 'cena_contrato_processo_perfil') > 0);
ok('histórico do projeto: só administrador lê', await conta(UID.equipe, 'sot_projeto_processo_eventos') === 0
  && await conta(UID.admin, 'sot_projeto_processo_eventos') > 0);
ok('histórico do catálogo: só administrador lê', await conta(UID.equipe, 'cena_processo_perfis_eventos') === 0
  && await conta(UID.gestor, 'cena_processo_perfis_eventos') > 0);
ok('usuário inativo não lê nada', await conta(U_ADMIN_INATIVO, 'sot_projeto_processo') === 0
  && await conta(U_ADMIN_INATIVO, 'cena_contrato_processo_perfil') === 0);

// ── Nenhuma alteração em sot_projetos / TMA / contratos / usuários / Etapa 1.1 ──
const legadoDepois = await retratoLegado();
ok('sot_projetos: linhas originais intactas',
  (await db.query(`select md5(string_agg(t::text, '' order by t.id)) h from public.sot_projetos t where t.id <> '${P(10)}'`)).rows[0].h === legadoAntes.proj);
ok('sot_projetos: sem coluna, gatilho, policy ou constraint nova',
  legadoDepois.cols === legadoAntes.cols && legadoDepois.trg_proj === 0 && legadoDepois.pol_proj === legadoAntes.pol_proj
  && legadoDepois.con_proj === legadoAntes.con_proj, legadoDepois);
ok('TMA: composicao_dia / equipes_disp com linhas, gatilhos e policies iguais',
  legadoDepois.cd === legadoAntes.cd && legadoDepois.ed === legadoAntes.ed && legadoDepois.trg_tma === legadoAntes.trg_tma
  && legadoDepois.pol_tma === legadoAntes.pol_tma, [legadoAntes, legadoDepois]);
ok('contratos, usuarios_sistema, cena_acoes, cena_pode e helpers inalterados',
  legadoDepois.ctr === legadoAntes.ctr && legadoDepois.usr === legadoAntes.usr && legadoDepois.acoes === legadoAntes.acoes
  && legadoDepois.fns === legadoAntes.fns, [legadoAntes, legadoDepois]);
ok('contratos sem gatilho novo', (await db.query(`select count(*)::int n from pg_trigger where tgrelid = 'public.contratos'::regclass and not tgisinternal`)).rows[0].n === 0);
ok('nenhuma ação nova em cena_acoes', (await db.query(`select count(*)::int n from public.cena_acoes`)).rows[0].n === 9);
const matrizSeed = (await db.query(`select md5(string_agg(t::text, '' order by t.id)) h from public.cena_permissoes_acao t
  where t.motivo like 'Matriz inicial%'`)).rows[0].h;
ok('matriz da Etapa 1.1: linhas semeadas intactas (só as regras criadas pelo próprio teste são novas)', matrizSeed === matrizAntes, [matrizSeed, matrizAntes]);

// ── Reaplicar depois de uso real ────────────────────────────────
const antesReap = JSON.stringify({ c: await contagem(), l: await retratoCongelados() });
erro = await tentaExec(db, mig);
ok('reaplicar depois de uso real: sem erro', erro === null, erro);
ok('reaplicar não mexe em processos, histórico, catálogo nem sugestões', antesReap === JSON.stringify({ c: await contagem(), l: await retratoCongelados() }));

// ── Desfazer ────────────────────────────────────────────────────
erro = await tentaExec(db, semNotify(desfazer));
ok('bloco de desfazer roda', erro === null, erro);
const sobra = (await db.query(`select (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in (${inLista(FUNCOES)}))::int
  + (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname in (${inLista(TABELAS)}))::int n`)).rows[0].n;
ok('desfazer remove tudo da etapa', sobra === 0, sobra);
ok('desfazer mantém cena_pode da Etapa 1.1', (await como(db, 'authenticated', UID.gestor, async () =>
  (await db.query(`select public.cena_pode('PROJ_ALTERAR_PERFIL_PROCESSO') v`)).rows[0].v)) === true);
ok('desfazer não mexe em sot_projetos nem TMA', (await retratoLegado()).cd === legadoAntes.cd
  && (await retratoLegado()).cols === legadoAntes.cols);
erro = await tentaExec(db, mig);
ok('reaplica depois de desfazer', erro === null, erro);
await db.close();

// ── sot_projetos sem deleted_at ─────────────────────────────────
db = await novoBanco({ semDeletedAt: true });
erro = await tentaExec(db, mig);
ok('sot_projetos sem deleted_at: aplica', erro === null, erro);
r = await congelar(UID.admin, P_RDSE, 'BASE_PROJETOS', 1, 'Sem deleted_at');
ok('sot_projetos sem deleted_at: congela', r.r && r.r.operacao === 'CONGELAR', r);
ef = await efetivo(UID.equipe, P_RDSE2);
ok('sot_projetos sem deleted_at: BASE_PROJETOS derivado', ef[0].congelado === false, ef);
await db.close();

// ── Fail-closed na aplicação ────────────────────────────────────
db = await novoBanco({ sem11: true });
erro = await tentaExec(db, mig);
ok('sem a Etapa 1.1: recusa', /20261007190000_cena_permissoes_acao/.test(erro || ''), erro);
ok('sem a Etapa 1.1: nada criado', (await db.query(`select to_regclass('public.sot_projeto_processo') t`)).rows[0].t === null);
await db.close();

db = await novoBanco({ idTexto: true });
erro = await tentaExec(db, mig);
ok('sot_projetos.id não uuid: recusa', /sot_projetos\.id não é uuid/.test(erro || ''), erro);
ok('sot_projetos.id não uuid: nada criado', (await db.query(`select to_regclass('public.cena_processo_perfis') t`)).rows[0].t === null);
await db.close();

db = await novoBanco();
await db.exec(`update public.cena_acoes set ativo = false where codigo = 'PROJ_ALTERAR_PERFIL_PROCESSO'`);
erro = await tentaExec(db, mig);
ok('ação PROJ_ALTERAR_PERFIL_PROCESSO inativa: recusa', /PROJ_ALTERAR_PERFIL_PROCESSO ausente ou inativa/.test(erro || ''), erro);
ok('ação inativa: nada criado', (await db.query(`select to_regclass('public.cena_processo_perfis') t`)).rows[0].t === null);
await db.close();

// ── Transação explícita: falha no meio não deixa nada da Etapa 1.2 ──
const FALHA = `\nDO $$ BEGIN RAISE EXCEPTION 'falha intencional de teste'; END $$;\n`;
const comFalhaAntes = marca => {
  const i = mig.indexOf(marca);
  if (i < 0) throw new Error('marca não encontrada na migration: ' + marca);
  return mig.slice(0, i) + FALHA + mig.slice(i);
};
const objetosEtapa = async (db) => (await db.query(`
  select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname in (${inLista(TABELAS)}))::int tabelas,
         (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in (${inLista(FUNCOES)}))::int funcoes,
         (select count(*) from pg_trigger where tgname like 'trg_cena_processo%' or tgname like 'trg_sot_projeto_processo%'
            or tgname like 'trg_cena_contrato_processo%')::int gatilhos,
         (select count(*) from pg_policies where tablename in (${inLista(TABELAS)}))::int policies`)).rows[0];
for (const [nome, marca] of [
  ['depois das tabelas', '-- ── 4. Projeto real'],
  ['depois dos gatilhos', '-- ── 8. Funções internas'],
  ['depois das RPCs', '-- ── 12. RLS e grants'],
  ['depois de RLS e grants', '-- ── 13. Perfil semeado'],
  ['depois do seed (antes do COMMIT)', '\nCOMMIT;'],
]) {
  db = await novoBanco();
  erro = await tentaExec(db, comFalhaAntes(marca));
  ok(`falha intencional ${nome}: migration aborta`, /falha intencional de teste/.test(erro || ''), erro);
  const o = await objetosEtapa(db);
  ok(`falha intencional ${nome}: nenhum objeto da Etapa 1.2 permanece`, Object.values(o).every(n => n === 0), o);
  erro = await tentaExec(db, mig);
  ok(`falha intencional ${nome}: depois aplica normalmente`, erro === null, erro);
  await db.close();
}

db = await novoBanco();
erro = await tentaExec(db, mig);
const objInst = await objetosEtapa(db);
ok('controle: contagem enxerga tabelas, funções, gatilhos e policies instalados',
  objInst.tabelas === 5 && objInst.funcoes === 21 && objInst.gatilhos === 12 && objInst.policies === 5, objInst);
r = await congelar(UID.admin, P_RDSE, 'BASE_PROJETOS', 1, 'Antes da reaplicação com falha');
const retrato = async () => JSON.stringify({ o: await objetosEtapa(db), c: await contagem(),
  pol: (await db.query(`select tablename, policyname, cmd, roles::text, qual from pg_policies where tablename in (${inLista(TABELAS)}) order by 1, 2`)).rows });
const antesFalha = await retrato();
erro = await tentaExec(db, comFalhaAntes('\nCOMMIT;'));
ok('reaplicação com falha: aborta', /falha intencional de teste/.test(erro || ''), erro);
ok('reaplicação com falha: estado anterior intacto', await retrato() === antesFalha);
ef = await efetivo(UID.equipe, P_RDSE);
ok('reaplicação com falha: processo congelado continua respondendo', ef[0].congelado === true, ef);

// ── Policy fictícia de migration futura sobrevive à reaplicação ──
await db.exec(TABELAS.map(t => `create policy ${t}_futura_teste on public.${t} for select to authenticated using (false);`).join('\n'));
erro = await tentaExec(db, mig);
ok('policy futura: reaplicação sem erro', erro === null, erro);
const polsFut = (await db.query(`select policyname, qual from pg_policies where tablename in (${inLista(TABELAS)})`)).rows;
ok('policy futura: as 5 policies fictícias continuam (total 10)', polsFut.length === 10
  && TABELAS.every(t => polsFut.some(p => p.policyname === `${t}_futura_teste` && p.qual === 'false')), polsFut);
await db.close();

if (failed.length) {
  console.log(`proj-perfil-processo-sql: FALHOU ${failed.length}/${total}`);
  failed.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log(`proj-perfil-processo-sql: OK (${total} verificações)`);
