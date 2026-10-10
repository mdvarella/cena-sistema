// SEGURANÇA — testes SQL da migration 20261009150000_seg_documentos_rh_sesmt_frotas.sql
// PostgreSQL embutido (PGlite) com o estado de produção conferido no Supabase em 09/10/2026:
// RLS ativo sem FORCE, policies FOR ALL USING (true) para anon/authenticated/PUBLIC e GRANT S/I/U/D para anon e authenticated.
// Executa SELECT / INSERT / UPDATE / DELETE reais por perfil, antes e depois da migration, e confere o rollback.
// Não substitui a validação no Supabase real (PostgREST, Storage, Edges, dono das funções).
// Uso: node tests/seg-documentos-rh-sesmt-frotas-sql.test.mjs
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
  console.log('seg-documentos-rh-sesmt-frotas-sql: SKIP (instale @electric-sql/pglite e defina PGLITE_PATH)');
  process.exit(0);
}

const migDir = path.join(here, '..', 'supabase', 'migrations');
const mig = fs.readFileSync(path.join(migDir, '20261009150000_seg_documentos_rh_sesmt_frotas.sql'), 'utf8');
const migSeg = fs.readFileSync(path.join(migDir, '20261004190000_seguranca_usuarios_sistema.sql'), 'utf8');
const codigo = mig.slice(0, mig.indexOf('-- Validação')).replace(/--[^\n]*/g, '');
const desfazer = mig.slice(mig.indexOf('-- Para desfazer')).split(/\r?\n/).slice(2)
  .map(l => l.replace(/^--\s?/, '')).join('\n').trim();

const failed = [];
let total = 0;
const ok = (n, c, d) => { total++; if (!c) failed.push(n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };

// ── Texto da migration ──────────────────────────────────────────────────
ok('transacional (BEGIN/COMMIT)', /^BEGIN;/m.test(codigo) && /^COMMIT;/m.test(codigo));
ok('rollback transacional (BEGIN/COMMIT)', /^BEGIN;/m.test(desfazer) && /COMMIT;$/.test(desfazer));
ok('sem USING (true) / WITH CHECK (true)', !/USING\s*\(\s*true\s*\)|WITH CHECK\s*\(\s*true\s*\)/i.test(codigo));
ok('sem FOR ALL', !/\bFOR ALL\b/i.test(codigo));
ok('sem GRANT para anon', !/^\s*GRANT\b[^;]*\banon\b/im.test(codigo) && !/'GRANT[^']*\banon\b/i.test(codigo));
ok('sem GRANT ALL para authenticated', !/GRANT\s+ALL\b[^;]*\bauthenticated\b/i.test(codigo));
ok('não autoriza por e-mail', !/auth\.jwt\(\)|email/i.test(codigo));
ok('usa auth.uid() via cena_usuario_perfil_sessao (20261004190000)', /cena_usuario_perfil_sessao\(\)/.test(codigo));
ok('não ativa FORCE ROW LEVEL SECURITY', !/FORCE ROW LEVEL SECURITY/i.test(codigo));
ok('sem SECURITY DEFINER nas funções novas', !/SECURITY DEFINER/i.test(codigo));
ok('não altera dados', !/\b(DELETE FROM|UPDATE public\.|TRUNCATE public)/i.test(codigo));
ok('não toca TMA / Portaria / ENEL-WL / Programação',
  !/progTma|equipes_disp|composicao_dia|frotas_portaria|portaria_|sot_projetos|sot_lms|wl_|cena_permiss|prog_projetos|prog_veiculos/i.test(codigo));
ok('não altera cena_rh_pode_dados_pj', !/cena_rh_pode_dados_pj/.test(codigo));
ok('não mexe em storage', !/storage\./i.test(codigo));

// ── Estado de produção (09/10/2026) ─────────────────────────────────────
const TABELAS = ['frotas_motorista_documentos', 'rh_colaborador_documentos', 'rh_contratacao_documentos', 'rh_contratacoes',
  'rh_documento_ia_itens', 'rh_documento_ia_lotes', 'rh_remuneracao_pisos', 'sesmt_documentos_colab'];
const OPS = ['select', 'insert', 'update', 'delete'];
const POLICIES_PROD = [
  ['frotas_motorista_documentos', 'fmd_all', 'public'],
  ['rh_colaborador_documentos', 'rh_fase3_anon_all', 'anon'], ['rh_colaborador_documentos', 'rh_fase3_authenticated_all', 'authenticated'],
  ['rh_contratacao_documentos', 'rh_c1_anon_all', 'anon'], ['rh_contratacao_documentos', 'rh_c1_authenticated_all', 'authenticated'],
  ['rh_contratacoes', 'rh_c1_anon_all', 'anon'], ['rh_contratacoes', 'rh_c1_authenticated_all', 'authenticated'],
  ['rh_documento_ia_itens', 'rh_ia2_anon_all', 'anon'], ['rh_documento_ia_itens', 'rh_ia2_authenticated_all', 'authenticated'],
  ['rh_documento_ia_lotes', 'rh_ia2_anon_all', 'anon'], ['rh_documento_ia_lotes', 'rh_ia2_authenticated_all', 'authenticated'],
  ['rh_remuneracao_pisos', 'rh_c12_anon_all', 'anon'], ['rh_remuneracao_pisos', 'rh_c12_authenticated_all', 'authenticated'],
  ['sesmt_documentos_colab', 'Acesso total', 'anon, authenticated'], ['sesmt_documentos_colab', 'cena_anon_all', 'anon'],
];
const helpersSeg = [...migSeg.matchAll(/CREATE OR REPLACE FUNCTION public\.cena_usuario_(perfil_sessao|id_sessao|erp_ativo)\(\)[\s\S]*?\$\$;/g)].map(m => m[0]);
ok('helpers reais de 20261004190000 extraídos (perfil_sessao, id_sessao, erp_ativo)', helpersSeg.length === 3, helpersSeg.length);

// Perfis reais em usuarios_sistema (06/10/2026) + os do código sem usuários + um perfil fora das listas.
const PERFIS = ['admin', 'diretoria', 'gestor', 'administrativo', 'dp', 'rh', 'sesmt', 'gerente_frotas', 'supervisor_frotas',
  'portaria', 'coordenador', 'supervisor', 'supervisor_tma', 'escritorio', 'encarregado', 'equipe', 'almoxarife', 'coordenador_tma'];
const uidDe = i => 'a0000000-0000-4000-8000-' + String(i + 1).padStart(12, '0');
const U_INATIVO = 'b0000000-0000-4000-8000-000000000001';
const U_SEM_ERP = 'f0000000-0000-4000-8000-0000000000ff';
const ID_SEMENTE = 'c0000000-0000-4000-8000-000000000001';
const COLAB = 'd0000000-0000-4000-8000-000000000001';

function estadoProducao({ semHelpers = false, policyExtra = false, funcaoSegExistente = false, serviceRoleParcial = false } = {}) {
  let s = `
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
create table public.usuarios_sistema (
  id uuid primary key default gen_random_uuid(), nome text not null, email text, perfil text,
  ativo boolean default true, auth_user_id uuid, deleted_at timestamptz);
alter table public.usuarios_sistema enable row level security;
revoke all on public.usuarios_sistema from anon, authenticated;
`;
  PERFIS.forEach((p, i) => { s += `insert into public.usuarios_sistema (nome, email, perfil, auth_user_id) values ('U ${p}', '${p}@cena', '${p}', '${uidDe(i)}');\n`; });
  s += `insert into public.usuarios_sistema (nome, email, perfil, auth_user_id, ativo) values ('Ex-RH', 'ex-rh@cena', 'rh', '${U_INATIVO}', false);\n`;
  if (!semHelpers) {
    s += helpersSeg.join('\n') + `
revoke all on function public.cena_usuario_perfil_sessao() from public, anon;
revoke all on function public.cena_usuario_id_sessao() from public, anon;
revoke all on function public.cena_usuario_erp_ativo() from public, anon;
grant execute on function public.cena_usuario_perfil_sessao() to authenticated;
grant execute on function public.cena_usuario_id_sessao() to authenticated;
grant execute on function public.cena_usuario_erp_ativo() to authenticated;
create function public.cena_rh_pode_dados_pj() returns boolean language sql stable security definer set search_path to 'public', 'pg_temp' as $f$
  select coalesce(public.cena_usuario_perfil_sessao() in ('admin','diretoria','dp','rh','gestor','administrativo'), false)
$f$;
revoke all on function public.cena_rh_pode_dados_pj() from public, anon;
grant execute on function public.cena_rh_pode_dados_pj() to authenticated;
`;
  }
  for (const t of TABELAS) {
    const extra = t === 'sesmt_documentos_colab' ? ', colaborador_id uuid, doc_id text, entregue boolean, unique (colaborador_id, doc_id)' : '';
    s += `create table public.${t} (id uuid primary key default gen_random_uuid(), obs text, atualizado_em timestamptz default now()${extra});
alter table public.${t} enable row level security;
grant select, insert, update, delete on public.${t} to anon, authenticated;
grant ${serviceRoleParcial ? 'select, insert, update, delete' : 'all'} on public.${t} to service_role;
insert into public.${t} (id, obs) values ('${ID_SEMENTE}', 'semente');
`;
  }
  s += `update public.sesmt_documentos_colab set colaborador_id = '${COLAB}', doc_id = 'rg', entregue = false;\n`;
  for (const [t, nome, roles] of POLICIES_PROD) {
    s += `create policy "${nome}" on public.${t} for all to ${roles} using (true) with check (true);\n`;
  }
  if (policyExtra) s += `create policy leitura_extra on public.rh_contratacoes for select to authenticated using (true);\n`;
  if (funcaoSegExistente) s += `create function public.cena_seg_qualquer() returns boolean language sql as $f$ select true $f$;\n`;
  return s;
}

const ATORES = [
  { nome: 'anon', role: 'anon', uid: '' },
  { nome: 'auth sem usuário ERP', role: 'authenticated', uid: U_SEM_ERP },
  { nome: 'rh inativo', role: 'authenticated', uid: U_INATIVO },
  ...PERFIS.map((p, i) => ({ nome: p, role: 'authenticated', uid: uidDe(i), perfil: p })),
  { nome: 'service_role', role: 'service_role', uid: '' },
];
const ator = n => ATORES.find(a => a.nome === n);

async function como(db, a, fn) {
  await db.exec('begin');
  try {
    await db.exec(`set local role ${a.role}`);
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [a.uid]);
    return await fn();
  } catch (e) {
    return false;
  } finally {
    await db.exec('rollback');
  }
}
const tentar = (db, a, t, op) => como(db, a, async () => {
  if (op === 'select') return (await db.query(`select count(*)::int n from public.${t}`)).rows[0].n > 0;
  if (op === 'insert') return (await db.query(`insert into public.${t} (obs) values ('teste') returning id`)).rows.length === 1;
  if (op === 'update') return (await db.query(`update public.${t} set obs = 'alterado' where id = $1`, [ID_SEMENTE])).affectedRows === 1;
  if (op === 'delete') return (await db.query(`delete from public.${t} where id = $1`, [ID_SEMENTE])).affectedRows === 1;
});

// Matriz aprovada pelo gestor em 09/10/2026 (a mesma do cabeçalho da migration).
const G_RH = ['admin', 'diretoria', 'gestor', 'administrativo', 'dp', 'rh'];
const OPERACIONAIS = ['coordenador', 'supervisor', 'supervisor_tma', 'escritorio', 'encarregado'];
const REGRA = {
  rh_contratacoes:           { ler: G_RH, editar: G_RH, apaga: false },
  rh_contratacao_documentos: { ler: G_RH, editar: G_RH, apaga: true },
  rh_remuneracao_pisos:      { ler: G_RH, editar: ['admin', 'diretoria', 'dp', 'rh'], apaga: false },
  rh_colaborador_documentos: { ler: [...G_RH, 'sesmt'], editar: [...G_RH, 'sesmt'], apaga: false },
  rh_documento_ia_lotes:     { ler: [...G_RH, 'sesmt'], editar: [...G_RH, 'sesmt'], apaga: false },
  rh_documento_ia_itens:     { ler: [...G_RH, 'sesmt'], editar: [...G_RH, 'sesmt'], apaga: false },
  sesmt_documentos_colab:    { ler: [...G_RH, 'sesmt', ...OPERACIONAIS], editar: [...G_RH, 'sesmt', ...OPERACIONAIS], apaga: false },
  frotas_motorista_documentos: {
    ler: [...G_RH, 'sesmt', 'gerente_frotas', 'supervisor_frotas', 'coordenador', 'supervisor', 'supervisor_tma', 'escritorio', 'encarregado', 'portaria'],
    editar: ['admin', 'diretoria', 'gestor', 'gerente_frotas', 'supervisor_frotas', 'administrativo', 'dp', 'rh'], apaga: false },
};
function esperadoDepois(a, t, op) {
  if (a.role === 'service_role') return true;
  if (!a.perfil) return false;
  const r = REGRA[t];
  if (op === 'select') return r.ler.includes(a.perfil);
  if (op === 'delete') return r.apaga && r.editar.includes(a.perfil);
  return r.editar.includes(a.perfil);
}

async function matriz(db) {
  const m = {};
  for (const a of ATORES) for (const t of TABELAS) for (const op of OPS) m[a.nome + '|' + t + '|' + op] = await tentar(db, a, t, op);
  return m;
}
const FP_SQL = `select json_build_object(
  'pol', (select json_agg(concat_ws('|', tablename, policyname, permissive, roles::text, cmd, qual, with_check) order by tablename, policyname)
            from pg_policies where schemaname = 'public' and tablename = any($1)),
  'acl', (select json_agg(x order by x) from (
            select c.relname || ':' || pg_get_userbyid(a.grantee) || ':' || a.privilege_type || ':' || a.is_grantable x
              from pg_class c cross join lateral aclexplode(c.relacl) a
             where c.relnamespace = 'public'::regnamespace and c.relname = any($1)) s),
  'rls', (select json_agg(relname || ':' || relrowsecurity || ':' || relforcerowsecurity order by relname)
            from pg_class where relnamespace = 'public'::regnamespace and relname = any($1)),
  'fn',  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'cena\\_seg\\_%'),
  'snap', to_regclass('public.cena_seg_snapshot_20261009') is not null)::text f`;
const catalogo = async db => (await db.query(FP_SQL, [TABELAS])).rows[0].f;
async function aplicar(db, sql) {
  try { await db.exec(sql); return null; } catch (e) { await db.exec('rollback').catch(() => {}); return e; }
}

// ── ANTES: reproduz a vulnerabilidade ───────────────────────────────────
const db = new PGlite();
await db.exec(estadoProducao());
const catAntes = await catalogo(db);
const antes = await matriz(db);
for (const t of TABELAS) for (const op of OPS) {
  ok(`ANTES: anon faz ${op.toUpperCase()} em ${t}`, antes[`anon|${t}|${op}`] === true);
  ok(`ANTES: authenticated sem usuário ERP faz ${op.toUpperCase()} em ${t}`, antes[`auth sem usuário ERP|${t}|${op}`] === true);
}
ok('ANTES: gerente_frotas lê remuneração', antes['gerente_frotas|rh_remuneracao_pisos|select'] === true);
ok('ANTES: supervisor_frotas lê fila da Entrada Inteligente', antes['supervisor_frotas|rh_documento_ia_itens|select'] === true);
ok('ANTES: portaria altera CNH', antes['portaria|frotas_motorista_documentos|update'] === true);
ok('ANTES: equipe altera contratação', antes['equipe|rh_contratacoes|update'] === true);
ok('ANTES: rh inativo exclui documento do Dossiê', antes['rh inativo|rh_colaborador_documentos|delete'] === true);

// ── Aplicar ─────────────────────────────────────────────────────────────
const erro = await aplicar(db, mig);
ok('migration aplica sem erro', !erro, erro && erro.message);

// ── DEPOIS: matriz completa por perfil, tabela e comando ────────────────
const depois = await matriz(db);
const divergencias = [];
for (const a of ATORES) for (const t of TABELAS) for (const op of OPS) {
  const k = a.nome + '|' + t + '|' + op;
  const esp = esperadoDepois(a, t, op);
  total++;
  if (depois[k] !== esp) divergencias.push(`${k}: obtido ${depois[k]}, esperado ${esp}`);
}
if (divergencias.length) failed.push('DEPOIS: matriz divergente (' + divergencias.length + '): ' + divergencias.slice(0, 15).join('; '));

const pode = (a, t, op) => depois[`${a}|${t}|${op}`] === true;
const nenhum = (a, t) => OPS.every(op => !pode(a, t, op));
const leSoLe = (a, t) => pode(a, t, 'select') && !pode(a, t, 'insert') && !pode(a, t, 'update') && !pode(a, t, 'delete');
const editaSemApagar = (a, t) => pode(a, t, 'select') && pode(a, t, 'insert') && pode(a, t, 'update') && !pode(a, t, 'delete');

for (const t of TABELAS) {
  ok(`anon sem SELECT/INSERT/UPDATE/DELETE em ${t}`, nenhum('anon', t));
  ok(`authenticated sem usuário ERP sem acesso a ${t}`, nenhum('auth sem usuário ERP', t));
  ok(`usuário inativo sem acesso a ${t}`, nenhum('rh inativo', t));
  ok(`perfil fora das listas (coordenador_tma) sem acesso a ${t}`, nenhum('coordenador_tma', t));
  ok(`equipe sem acesso a ${t}`, nenhum('equipe', t));
  ok(`almoxarife sem acesso a ${t}`, nenhum('almoxarife', t));
  ok(`service_role (Edges) mantém acesso total a ${t}`, OPS.every(op => pode('service_role', t, op)));
}
// Quem grava também precisa ver a linha (upsert, PATCH com filtro, return=representation).
for (const a of ATORES) for (const t of TABELAS) {
  if (pode(a.nome, t, 'insert') || pode(a.nome, t, 'update')) ok(`${a.nome} grava em ${t} e também lê`, pode(a.nome, t, 'select'));
}

// Portaria / Programação: consultam a CNH, não alteram.
for (const p of ['portaria', 'coordenador', 'supervisor', 'supervisor_tma', 'escritorio'])
  ok(`${p} consulta CNH e não insere, altera nem apaga`, leSoLe(p, 'frotas_motorista_documentos'));
// Frotas autorizado edita documentos de motorista; fica fora de RH e SESMT.
for (const p of ['gerente_frotas', 'supervisor_frotas']) {
  ok(`${p} edita documentos de motorista (sem DELETE)`, editaSemApagar(p, 'frotas_motorista_documentos'));
  for (const t of TABELAS.filter(x => x !== 'frotas_motorista_documentos')) ok(`${p} sem acesso a ${t}`, nenhum(p, t));
}
// Perfil operacional comum não edita documento de motorista.
ok('encarregado consulta CNH e não edita', leSoLe('encarregado', 'frotas_motorista_documentos'));
ok('equipe não lê nem edita CNH', nenhum('equipe', 'frotas_motorista_documentos'));
// SESMT: só o necessário.
ok('sesmt edita checklist SESMT (Evolução)', editaSemApagar('sesmt', 'sesmt_documentos_colab'));
ok('sesmt usa a Entrada Inteligente (lotes e itens)', editaSemApagar('sesmt', 'rh_documento_ia_lotes') && editaSemApagar('sesmt', 'rh_documento_ia_itens'));
ok('sesmt grava no Dossiê pela Entrada Inteligente (sem DELETE)', editaSemApagar('sesmt', 'rh_colaborador_documentos'));
ok('sesmt consulta CNH sem editar', leSoLe('sesmt', 'frotas_motorista_documentos'));
ok('sesmt sem remuneração e sem contratação', ['rh_remuneracao_pisos', 'rh_contratacoes', 'rh_contratacao_documentos'].every(t => nenhum('sesmt', t)));
for (const p of OPERACIONAIS) {
  ok(`${p} edita checklist SESMT (Evolução, sem DELETE)`, editaSemApagar(p, 'sesmt_documentos_colab'));
  ok(`${p} não edita CNH`, leSoLe(p, 'frotas_motorista_documentos'));
  ok(`${p} não lê Dossiê RH geral`, nenhum(p, 'rh_colaborador_documentos'));
  ok(`${p} sem remuneração, contratação e Entrada Inteligente`,
    ['rh_remuneracao_pisos', 'rh_contratacoes', 'rh_contratacao_documentos', 'rh_documento_ia_lotes', 'rh_documento_ia_itens'].every(t => nenhum(p, t)));
}
ok('portaria não edita CNH', leSoLe('portaria', 'frotas_motorista_documentos'));
ok('sesmt não edita CNH', leSoLe('sesmt', 'frotas_motorista_documentos'));
ok('portaria sem checklist SESMT e sem Dossiê', nenhum('portaria', 'sesmt_documentos_colab') && nenhum('portaria', 'rh_colaborador_documentos'));
ok('perfis de Frotas não leem Dossiê RH geral', nenhum('gerente_frotas', 'rh_colaborador_documentos') && nenhum('supervisor_frotas', 'rh_colaborador_documentos'));
// RH / DP: fluxos legítimos preservados.
for (const p of ['rh', 'dp']) {
  ok(`${p} mantém contratação, Dossiê e Entrada Inteligente`,
    ['rh_contratacoes', 'rh_colaborador_documentos', 'rh_documento_ia_lotes', 'rh_documento_ia_itens'].every(t => editaSemApagar(p, t)));
  ok(`${p} grava e exclui itens do checklist da contratação (rhPersistirKitSnapshot)`,
    ['select', 'insert', 'update', 'delete'].every(op => pode(p, 'rh_contratacao_documentos', op)));
  ok(`${p} edita pisos (sem DELETE)`, editaSemApagar(p, 'rh_remuneracao_pisos'));
  ok(`${p} edita CNH pela Entrada Inteligente`, editaSemApagar(p, 'frotas_motorista_documentos'));
  ok(`${p} marca checklist SESMT pelo Dossiê`, editaSemApagar(p, 'sesmt_documentos_colab'));
}
// Remuneração: gestor e administrativo só leem.
ok('gestor lê remuneração e não altera', leSoLe('gestor', 'rh_remuneracao_pisos'));
ok('administrativo lê remuneração e não altera', leSoLe('administrativo', 'rh_remuneracao_pisos'));
for (const p of ['dp', 'rh', 'admin', 'diretoria']) ok(`${p} altera remuneração (sem DELETE)`, editaSemApagar(p, 'rh_remuneracao_pisos'));
ok('nenhum perfil apaga piso', ATORES.filter(a => a.role === 'authenticated').every(a => !pode(a.nome, 'rh_remuneracao_pisos', 'delete')));

// Upsert real do checklist SESMT (evolToggleDoc / rhAtualizarChecklistSesmt: on_conflict=colaborador_id,doc_id).
const upsert = a => como(db, a, async () => (await db.query(
  `insert into public.sesmt_documentos_colab (colaborador_id, doc_id, entregue) values ($1, 'rg', true)
   on conflict (colaborador_id, doc_id) do update set entregue = excluded.entregue returning entregue`, [COLAB])).rows[0]?.entregue === true);
ok('sesmt faz upsert do checklist (Evolução)', await upsert(ator('sesmt')) === true);
ok('dp faz upsert do checklist (Dossiê RH)', await upsert(ator('dp')) === true);
for (const p of OPERACIONAIS) ok(`${p} faz upsert do checklist (Evolução)`, await upsert(ator(p)) === true);
ok('portaria não faz upsert do checklist', await upsert(ator('portaria')) === false);
ok('gerente_frotas não faz upsert do checklist', await upsert(ator('gerente_frotas')) === false);
ok('anon não faz upsert do checklist', await upsert(ator('anon')) === false);

// ── Estrutura depois ────────────────────────────────────────────────────
const one = async (sql, p) => (await db.query(sql, p || [])).rows[0];
const pol = await one(`select count(*)::int n, count(*) filter (where qual = 'true' or with_check = 'true' or cmd = 'ALL')::int abertas,
  count(*) filter (where 'anon' = any(roles) or 'public' = any(roles))::int anon
  from pg_policies where schemaname = 'public' and tablename = any($1)`, [TABELAS]);
ok('25 policies (SELECT, INSERT, UPDATE nas 8 + DELETE em rh_contratacao_documentos)', pol.n === 25, pol);
ok('nenhuma policy aberta, FOR ALL ou para anon/PUBLIC', pol.abertas === 0 && pol.anon === 0, pol);
const force = await one(`select count(*) filter (where relrowsecurity)::int rls, count(*) filter (where relforcerowsecurity)::int force
  from pg_class where relnamespace = 'public'::regnamespace and relname = any($1)`, [TABELAS]);
ok('RLS ativo nas 8, sem FORCE', force.rls === 8 && force.force === 0, force);
const fn = await one(`select count(*)::int n, bool_or(has_function_privilege('anon', p.oid, 'EXECUTE')) anon_exec, bool_or(p.prosecdef) definer
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'cena\\_seg\\_%'`);
ok('13 funções cena_seg_*, SECURITY INVOKER, sem EXECUTE para anon', fn.n === 13 && fn.anon_exec === false && fn.definer === false, fn);
const snap = await one(`select count(*) filter (where tipo = 'policy')::int pol, count(*) filter (where tipo = 'grant')::int gr,
  count(*) filter (where tipo = 'rls')::int rls from public.cena_seg_snapshot_20261009`);
ok('snapshot: 15 policies, 24 grants (anon/authenticated/service_role × 8), 8 estados de RLS', snap.pol === 15 && snap.gr === 24 && snap.rls === 8, snap);
ok('snapshot inacessível a authenticated', await tentar(db, ator('admin'), 'cena_seg_snapshot_20261009', 'select') === false);

// ── Idempotente ─────────────────────────────────────────────────────────
const erro2 = await aplicar(db, mig);
ok('segunda execução sem erro', !erro2, erro2 && erro2.message);
const snap2 = await one(`select count(*)::int n from public.cena_seg_snapshot_20261009`);
ok('segunda execução não duplica o snapshot', snap2.n === 47, snap2);
const depois2 = await matriz(db);
ok('segunda execução mantém a mesma matriz', Object.keys(depois).every(k => depois[k] === depois2[k]));

// ── Rollback: volta exatamente ao estado anterior ───────────────────────
const erroRb = await aplicar(db, desfazer);
ok('rollback executa', !erroRb, erroRb && erroRb.message);
const catRb = await catalogo(db);
ok('rollback restaura exatamente policies, ACL das 8 tabelas, RLS/FORCE; remove funções cena_seg_* e snapshot', catRb === catAntes,
  catRb === catAntes ? undefined : { antes: catAntes.slice(0, 300), depois: catRb.slice(0, 300) });
const rb = await matriz(db);
ok('rollback restaura a mesma matriz de acesso de antes', Object.keys(antes).every(k => antes[k] === rb[k]),
  Object.keys(antes).filter(k => antes[k] !== rb[k]).slice(0, 5));
const erroRb2 = await aplicar(db, desfazer);
ok('rollback sem snapshot aborta', !!erroRb2 && /snapshot ausente/.test(erroRb2.message), erroRb2 && erroRb2.message);
ok('rollback abortado não muda nada', (await catalogo(db)) === catAntes);
const erro3 = await aplicar(db, mig);
const depois3 = await matriz(db);
ok('reaplicar depois do rollback volta à matriz segura', !erro3 && Object.keys(depois).every(k => depois[k] === depois3[k]), erro3 && erro3.message);

const dbSr = new PGlite();
await dbSr.exec(estadoProducao({ serviceRoleParcial: true }));
const catSr = await catalogo(dbSr);
const erroSr = (await aplicar(dbSr, mig)) || (await aplicar(dbSr, desfazer));
ok('rollback restaura grants parciais da service_role (sem TRUNCATE/REFERENCES/TRIGGER)', !erroSr && (await catalogo(dbSr)) === catSr, erroSr && erroSr.message);

// ── Pré-condições: falha inteira, nada muda ─────────────────────────────
async function abortaSemMudar(nome, opts, padrao) {
  const d = new PGlite();
  await d.exec(estadoProducao(opts));
  const c0 = await catalogo(d);
  const e = await aplicar(d, mig);
  ok(`${nome}: migration para com erro`, !!e && padrao.test(e.message), e && e.message);
  ok(`${nome}: nada muda (catálogo igual)`, (await catalogo(d)) === c0);
}
await abortaSemMudar('policy não conferida em produção', { policyExtra: true }, /fora do estado conferido/);
await abortaSemMudar('função cena_seg_* pré-existente', { funcaoSegExistente: true }, /cena_seg_\* fora desta migration/);
await abortaSemMudar('sem a migration 20261004190000', { semHelpers: true }, /20261004190000/);

if (failed.length) {
  console.log('seg-documentos-rh-sesmt-frotas-sql: FALHOU ' + failed.length + '/' + total);
  failed.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('seg-documentos-rh-sesmt-frotas-sql: OK (' + total + ' verificações)');
