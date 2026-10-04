// SECURITY GATE — testes SQL da migration 20261004190000_seguranca_usuarios_sistema.sql
// PostgreSQL embutido (PGlite). Estado inicial imita a produção auditada em 04/10/2026:
// anon com ALL em usuarios_sistema, policy permissiva, funções autorizando por e-mail do JWT.
// Teste auxiliar: não substitui a conferência no Supabase real.
// Uso: PGLITE_PATH=<pasta com node_modules/@electric-sql/pglite> node tests/seguranca-usuarios-sistema-sql.test.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';

const here = path.dirname(fileURLToPath(import.meta.url));
let PGlite;
try {
  const base = process.env.PGLITE_PATH ? path.join(process.env.PGLITE_PATH, 'package.json') : import.meta.url;
  const req = createRequire(base);
  ({ PGlite } = await import(pathToFileURL(req.resolve('@electric-sql/pglite')).href));
} catch (e) {
  console.log('seguranca-usuarios-sistema-sql: SKIP (instale @electric-sql/pglite e defina PGLITE_PATH)');
  process.exit(0);
}

const mig = fs.readFileSync(path.join(here, '..', 'supabase', 'migrations', '20261004190000_seguranca_usuarios_sistema.sql'), 'utf8');
const semNotify = s => s.replace(/NOTIFY pgrst[^;]*;/g, '');
const codigo = mig.slice(0, mig.indexOf('-- Validação')).replace(/--[^\n]*/g, '');
const desfazer = mig.slice(mig.indexOf('-- Para desfazer')).split(/\r?\n/).slice(1)
  .map(l => l.replace(/^--\s?/, '')).join('\n').trim();

const failed = [];
let total = 0;
const ok = (n, c, d) => { total++; if (!c) failed.push(n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };

ok('migration recarrega o cache do PostgREST', /NOTIFY pgrst, 'reload schema';/.test(mig));
ok('sem DELETE / UPDATE de dados', !/\b(DELETE FROM|UPDATE public\.)/i.test(codigo));
ok('sem GRANT para anon', !/^\s*GRANT\b[^;]*\banon\b/im.test(codigo));
ok('sem GRANT ALL para authenticated', !/^\s*GRANT\s+ALL\b[^;]*\bauthenticated\b/im.test(codigo));
ok('nenhuma função nova autoriza por e-mail do JWT', !/auth\.jwt\(\)/i.test(codigo));
ok('não mexe em TMA / PLPT / Programação', !/progTma|plpt_|equipes_disp|composicao_dia|prog_projetos_agenda/i.test(codigo));

const U_ADMIN = 'a0000000-0000-4000-8000-00000000000a';
const U_GESTOR = 'a0000000-0000-4000-8000-00000000000b';
const U_EQUIPE = 'a0000000-0000-4000-8000-00000000000c';
const U_INATIVO = 'a0000000-0000-4000-8000-00000000000d';
const U_INTRUSO = 'f0000000-0000-4000-8000-0000000000ff';
const U_NOVO = 'a0000000-0000-4000-8000-00000000000e';

const PRE_ESTADO = `
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
create table public.usuarios_sistema (
  id uuid primary key default gen_random_uuid(), nome text not null, email text unique, senha_hash text,
  perfil text, ativo boolean default true, auth_user_id uuid, deleted_at timestamptz,
  contrato_id text, equipe_id text, equipe_codigo text, filial_id uuid,
  responde_estoque boolean, depositos_responsavel text, criado_em timestamptz default now(),
  ultimo_acesso timestamptz, auth_migrado_em timestamptz, auth_migrado_por text);
alter table public.usuarios_sistema enable row level security;
create policy acesso_total on public.usuarios_sistema for all to public using (true) with check (true);
grant all on public.usuarios_sistema to anon, authenticated, service_role;
create view public.v_usuarios_nomes as select id, nome from public.usuarios_sistema;
insert into public.usuarios_sistema (nome, email, perfil, auth_user_id, senha_hash) values
  ('Admin', 'admin@cena', 'admin', '${U_ADMIN}', 'x'),
  ('Gestor', 'gestor@cena', 'gestor', '${U_GESTOR}', 'x'),
  ('Eletricista', '490@cena', 'equipe', '${U_EQUIPE}', 'x');
insert into public.usuarios_sistema (nome, email, perfil, auth_user_id, ativo) values ('Ex-admin', 'ex@cena', 'admin', '${U_INATIVO}', false);
insert into public.usuarios_sistema (nome, email, perfil) values ('Novo sem Auth', 'novo@cena', 'supervisor');

create function public.cena_rh_pode_dados_pj() returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_email text; v_perfil text;
begin
  if auth.uid() is null then return false; end if;
  v_email := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
  select lower(btrim(coalesce(us.perfil, ''))) into v_perfil from public.usuarios_sistema us
  where us.ativo is true and us.deleted_at is null
    and (us.auth_user_id = auth.uid() or (v_email <> '' and lower(btrim(us.email)) = v_email))
  order by case when us.auth_user_id = auth.uid() then 0 else 1 end limit 1;
  return v_perfil in ('admin','diretoria','dp','rh','gestor','administrativo');
end; $$;
grant execute on function public.cena_rh_pode_dados_pj() to authenticated;

create function public.cena_rfid_usuario_sessao() returns public.usuarios_sistema language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_us public.usuarios_sistema%rowtype; v_email text;
begin
  if auth.uid() is null then return null; end if;
  select * into v_us from public.usuarios_sistema us where us.auth_user_id = auth.uid() and us.ativo is true and us.deleted_at is null limit 1;
  if v_us.id is not null then return v_us; end if;
  v_email := lower(btrim(coalesce(auth.jwt() ->> 'email', '')));
  if v_email = '' then return null; end if;
  select * into v_us from public.usuarios_sistema us where lower(btrim(us.email)) = v_email and us.ativo is true and us.deleted_at is null
  order by case when us.auth_user_id = auth.uid() then 0 when us.auth_user_id is null then 1 else 2 end limit 1;
  return v_us;
end; $$;
create function public.cena_rfid_pode_cadastrar() returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_us public.usuarios_sistema%rowtype;
begin
  v_us := public.cena_rfid_usuario_sessao();
  return v_us.id is not null and lower(btrim(coalesce(v_us.perfil, ''))) in ('admin','diretoria','dp','rh','gestor');
end; $$;
grant execute on function public.cena_rfid_pode_cadastrar() to authenticated;
`;

const db = new PGlite();
await db.exec(PRE_ESTADO);

const one = async (sql, p) => (await db.query(sql, p || [])).rows[0];
const tenta = async (sql, p) => { try { await db.query(sql, p || []); return null; } catch (e) { return e; } };
async function como(role, uid, email, fn) {
  await db.exec(`set role ${role}`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)`,
    [uid || '', JSON.stringify({ email: email || '', role })]);
  try { return await fn(); } finally {
    await db.exec(`reset role`);
    await db.query(`select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '', false)`);
  }
}
const anon = fn => como('anon', '', '', fn);
const auth = (uid, email, fn) => como('authenticated', uid, email, fn);
const perfilDe = async email => (await one(`select perfil, auth_user_id, ativo, nome from public.usuarios_sistema where email = $1`, [email]));
const negado = e => e && e.code === '42501';

// ── Antes: a falha existe (o teste detecta o problema real) ──────────────
const antesAnon = await anon(() => one(`select count(*)::int n from public.usuarios_sistema`));
ok('ANTES: anon lê usuarios_sistema (reproduz a produção)', antesAnon.n === 5, antesAnon);
const antesEmail = await auth(U_INTRUSO, 'gestor@cena', () => one(`select public.cena_rh_pode_dados_pj() v, public.cena_rfid_pode_cadastrar() r`));
ok('ANTES: conta Auth qualquer com e-mail de gestor ganha permissão (fallback por e-mail)', antesEmail.v === true && antesEmail.r === true, antesEmail);

// ── Aplicar ──────────────────────────────────────────────────────────────
let erro = null;
try { await db.exec(semNotify(mig)); } catch (e) { erro = e.message; }
ok('aplica sem erro', erro === null, erro);
const snap1 = Number((await one(`select count(*) n from public.cena_seg_snapshot_20261004`)).n);
try { await db.exec(semNotify(mig)); erro = null; } catch (e) { erro = e.message; }
ok('reaplica sem erro (idempotente)', erro === null, erro);
const snap2 = Number((await one(`select count(*) n from public.cena_seg_snapshot_20261004`)).n);
ok('reaplicar não sobrescreve o snapshot do estado original', snap1 > 0 && snap1 === snap2, { snap1, snap2 });
ok('snapshot guardou a policy antiga', !!(await one(`select 1 x from public.cena_seg_snapshot_20261004 where tipo = 'policy' and nome = 'acesso_total'`)));
ok('snapshot guardou o grant antigo do anon', !!(await one(`select 1 x from public.cena_seg_snapshot_20261004 where tipo = 'grant' and nome = 'anon'`)));
const nTrig = Number((await one(`select count(*) n from pg_trigger where tgname = 'trg_cena_usuarios_sistema_proteger'`)).n);
ok('um gatilho só depois de 2 execuções', nTrig === 1, nTrig);
const pols = (await db.query(`select policyname from pg_policies where tablename = 'usuarios_sistema' order by 1`)).rows.map(r => r.policyname);
ok('exatamente 3 policies, sem a permissiva antiga', JSON.stringify(pols) === JSON.stringify(['usuarios_sistema_insert_admin', 'usuarios_sistema_select_erp', 'usuarios_sistema_update_admin']), pols);
const rls = await one(`select relrowsecurity e, relforcerowsecurity f from pg_class where oid = 'public.usuarios_sistema'::regclass`);
ok('RLS ligada (sem FORCE, para as funções do dono lerem)', rls.e === true && rls.f === false, rls);
const priv = await one(`select
  has_table_privilege('anon','public.usuarios_sistema','SELECT') a_s, has_table_privilege('anon','public.usuarios_sistema','INSERT') a_i,
  has_table_privilege('anon','public.usuarios_sistema','UPDATE') a_u, has_table_privilege('anon','public.usuarios_sistema','DELETE') a_d,
  has_table_privilege('authenticated','public.usuarios_sistema','DELETE') u_d, has_table_privilege('authenticated','public.usuarios_sistema','TRUNCATE') u_t`);
ok('anon sem SELECT/INSERT/UPDATE/DELETE', !priv.a_s && !priv.a_i && !priv.a_u && !priv.a_d, priv);
ok('authenticated sem DELETE/TRUNCATE', !priv.u_d && !priv.u_t, priv);

// 1–3. anon
ok('1. anon SELECT → negado', negado(await anon(() => tenta(`select * from public.usuarios_sistema`))));
ok('2. anon INSERT → negado', negado(await anon(() => tenta(`insert into public.usuarios_sistema (nome, email, perfil) values ('x','x@x','admin')`))));
ok('3. anon UPDATE → negado', negado(await anon(() => tenta(`update public.usuarios_sistema set perfil = 'admin'`))));
ok('anon não executa os helpers', negado(await anon(() => tenta(`select public.cena_usuario_perfil_sessao()`))));

// 4–7. usuário comum (equipe)
const e4 = await auth(U_EQUIPE, '490@cena', () => tenta(`insert into public.usuarios_sistema (nome, email, perfil) values ('Eu admin','fake@x','admin')`));
ok('4. comum insere perfil admin → negado', negado(e4), e4 && e4.message);
await auth(U_EQUIPE, '490@cena', () => tenta(`update public.usuarios_sistema set perfil = 'admin' where auth_user_id = $1`, [U_EQUIPE]));
ok('5. comum muda o próprio perfil → negado (nada muda)', (await perfilDe('490@cena')).perfil === 'equipe');
await auth(U_EQUIPE, '490@cena', () => tenta(`update public.usuarios_sistema set auth_user_id = $1 where email = 'gestor@cena'`, [U_EQUIPE]));
ok('6. comum grava o próprio UID na linha do gestor → negado', (await perfilDe('gestor@cena')).auth_user_id === U_GESTOR);
await auth(U_EQUIPE, '490@cena', () => tenta(`update public.usuarios_sistema set nome = 'hack' where email = 'admin@cena'`));
ok('7. comum altera outro usuário → negado', (await perfilDe('admin@cena')).nome === 'Admin');
const leEquipe = await auth(U_EQUIPE, '490@cena', () => one(`select count(*)::int n from public.usuarios_sistema where email = '490@cena'`));
ok('usuário ERP ativo continua lendo o próprio cadastro (login)', leEquipe.n === 1, leEquipe);
const listaEquipe = await auth(U_EQUIPE, '490@cena', () => one(`select count(*)::int n from public.usuarios_sistema`));
ok('usuário ERP ativo continua lendo a lista (telas que listam usuários)', listaEquipe.n === 5, listaEquipe);

// 8. caminho administrativo
const eAdmIns = await auth(U_ADMIN, 'admin@cena', () => tenta(`insert into public.usuarios_sistema (nome, email, perfil) values ('Contratado','c1@cena','equipe')`));
ok('8a. admin cria usuário', eAdmIns === null, eAdmIns && eAdmIns.message);
const eAdmUpd = await auth(U_ADMIN, 'admin@cena', () => tenta(`update public.usuarios_sistema set perfil = 'supervisor', contrato_id = 'c1' where email = 'c1@cena'`));
ok('8b. admin muda perfil de outro', eAdmUpd === null && (await perfilDe('c1@cena')).perfil === 'supervisor', eAdmUpd && eAdmUpd.message);
const eAdmPromo = await auth(U_ADMIN, 'admin@cena', () => tenta(`update public.usuarios_sistema set perfil = 'admin' where email = 'c1@cena'`));
ok('8c. admin concede admin', eAdmPromo === null && (await perfilDe('c1@cena')).perfil === 'admin');
await auth(U_ADMIN, 'admin@cena', () => tenta(`update public.usuarios_sistema set perfil = 'equipe' where email = 'c1@cena'`));
const eGesUpd = await auth(U_GESTOR, 'gestor@cena', () => tenta(`update public.usuarios_sistema set contrato_id = 'c9' where email = 'c1@cena'`));
ok('8d. gestor edita usuário comum', eGesUpd === null, eGesUpd && eGesUpd.message);
const eGesPromo = await auth(U_GESTOR, 'gestor@cena', () => tenta(`update public.usuarios_sistema set perfil = 'admin' where email = 'c1@cena'`));
ok('8e. gestor promove a admin → negado', negado(eGesPromo) && (await perfilDe('c1@cena')).perfil === 'equipe', eGesPromo && eGesPromo.message);
const eGesAdm = await auth(U_GESTOR, 'gestor@cena', () => tenta(`update public.usuarios_sistema set ativo = false where email = 'admin@cena'`));
ok('8f. gestor desativa admin → negado', negado(eGesAdm));
const eGesInsAdm = await auth(U_GESTOR, 'gestor@cena', () => tenta(`insert into public.usuarios_sistema (nome, email, perfil) values ('Outro','o@cena','admin')`));
ok('8g. gestor cria admin → negado', negado(eGesInsAdm));
const eSelf = await auth(U_ADMIN, 'admin@cena', () => tenta(`update public.usuarios_sistema set perfil = 'diretoria' where email = 'admin@cena'`));
ok('8h. ninguém muda o próprio perfil (nem admin)', negado(eSelf));
const eSelfNome = await auth(U_ADMIN, 'admin@cena', () => tenta(`update public.usuarios_sistema set nome = 'Admin', perfil = 'admin', ativo = true where email = 'admin@cena'`));
ok('8i. admin salva o próprio cadastro sem mudar perfil/status (tela Editar)', eSelfNome === null, eSelfNome && eSelfNome.message);
const eAdmUid = await auth(U_ADMIN, 'admin@cena', () => tenta(`update public.usuarios_sistema set auth_user_id = $1 where email = 'novo@cena'`, [U_INTRUSO]));
ok('8j. nem admin vincula auth_user_id pelo navegador', negado(eAdmUid));
const eAdmInsUid = await auth(U_ADMIN, 'admin@cena', () => tenta(`insert into public.usuarios_sistema (nome, email, perfil, auth_user_id) values ('Y','y@cena','equipe',$1)`, [U_INTRUSO]));
ok('8k. INSERT com auth_user_id pelo navegador → negado', negado(eAdmInsUid));
const eSrv = await como('service_role', '', '', () => tenta(`update public.usuarios_sistema set auth_user_id = $1 where email = 'novo@cena'`, [U_NOVO]));
ok('8l. provisionamento no servidor (service_role) vincula auth_user_id', eSrv === null && (await perfilDe('novo@cena')).auth_user_id === U_NOVO, eSrv && eSrv.message);
const eSoft = await auth(U_ADMIN, 'admin@cena', () => tenta(`update public.usuarios_sistema set deleted_at = now(), ativo = false where email = 'c1@cena'`));
ok('8m. exclusão lógica por admin continua funcionando', eSoft === null);
const eDel = await auth(U_ADMIN, 'admin@cena', () => tenta(`delete from public.usuarios_sistema where email = 'c1@cena'`));
ok('8n. DELETE físico negado até para admin', negado(eDel));

// 9–12. autorização só por auth_user_id
const intruso = await auth(U_INTRUSO, 'intruso@x', () => one(`select (select count(*)::int from public.usuarios_sistema) n, public.cena_usuario_erp_ativo() erp, public.cena_usuarios_pode_administrar() adm`));
ok('9. conta Auth sem cadastro ERP → sem privilégio e sem leitura', intruso.n === 0 && intruso.erp === false && intruso.adm === false, intruso);
const e9 = await auth(U_INTRUSO, 'intruso@x', () => tenta(`insert into public.usuarios_sistema (nome, email, perfil) values ('Z','z@x','equipe')`));
ok('9b. conta Auth sem cadastro ERP não cria cadastro', negado(e9));
const mesmoEmail = await auth(U_INTRUSO, 'gestor@cena', () => one(`select (select count(*)::int from public.usuarios_sistema) n, public.cena_usuarios_pode_administrar() adm,
  public.cena_rh_pode_dados_pj() rh, public.cena_rfid_pode_cadastrar() rfid`));
ok('10. e-mail de gestor sem o auth_user_id dele → sem privilégio (helpers, RH PJ, RFID)',
  mesmoEmail.n === 0 && mesmoEmail.adm === false && mesmoEmail.rh === false && mesmoEmail.rfid === false, mesmoEmail);
const pendente = await auth(U_INTRUSO, 'novo@cena', () => one(`select public.cena_rfid_pode_cadastrar() r`));
ok('10b. e-mail de cadastro ainda sem vínculo não é "reivindicável"', pendente.r === false, pendente);
const certo = await auth(U_GESTOR, 'qualquer@x', () => one(`select public.cena_usuarios_pode_administrar() adm, public.cena_rh_pode_dados_pj() rh, public.cena_rfid_pode_cadastrar() rfid`));
ok('11. auth_user_id correto + perfil permitido → autorizado (e-mail do JWT irrelevante)', certo.adm && certo.rh && certo.rfid, certo);
const errado = await auth(U_EQUIPE, '490@cena', () => one(`select public.cena_usuarios_pode_administrar() adm, public.cena_rh_pode_dados_pj() rh, public.cena_rfid_pode_cadastrar() rfid`));
ok('12. perfil não permitido → negado', !errado.adm && !errado.rh && !errado.rfid, errado);
const inativo = await auth(U_INATIVO, 'ex@cena', () => one(`select (select count(*)::int from public.usuarios_sistema) n, public.cena_usuarios_pode_administrar() adm`));
ok('admin inativo → sem leitura e sem privilégio', inativo.n === 0 && inativo.adm === false, inativo);

// ── Falha de pré-condição não aplica nada (transação única) ──────────────
const db2 = new PGlite();
await db2.exec(PRE_ESTADO);
await db2.exec(`insert into public.usuarios_sistema (nome, email, perfil, auth_user_id) values ('Duplicado','dup@cena','equipe','${U_ADMIN}')`);
let erro2 = null;
try { await db2.exec(semNotify(mig)); } catch (e) { erro2 = e.message; }
ok('auth_user_id repetido: migration recusa', erro2 && /auth_user_id repetido/.test(erro2), erro2);
const nada = (await db2.query(`select to_regprocedure('public.cena_usuario_perfil_sessao()') f, to_regclass('public.cena_seg_snapshot_20261004') t`)).rows[0];
ok('... e não deixa nada pela metade', nada.f === null && nada.t === null, nada);

// ── Desfazer ─────────────────────────────────────────────────────────────
erro = null;
try { await db.exec(semNotify(desfazer)); } catch (e) { erro = e.message; }
ok('desfazer roda', erro === null, erro);
const polsD = (await db.query(`select policyname from pg_policies where tablename = 'usuarios_sistema' order by 1`)).rows.map(r => r.policyname);
ok('desfazer devolve a policy original', JSON.stringify(polsD) === JSON.stringify(['acesso_total']), polsD);
const depoisAnon = await anon(() => one(`select count(*)::int n from public.usuarios_sistema`));
ok('desfazer devolve o grant original do anon', depoisAnon.n > 0, depoisAnon);
const depoisEmail = await auth(U_INTRUSO, 'gestor@cena', () => one(`select public.cena_rh_pode_dados_pj() v`));
ok('desfazer devolve as funções originais', depoisEmail.v === true, depoisEmail);
const restos = await one(`select
  (select count(*) from pg_proc where proname in ('cena_usuario_perfil_sessao','cena_usuario_id_sessao','cena_usuario_erp_ativo','cena_usuarios_pode_administrar','cena_usuarios_sistema_proteger'))::int f,
  (select count(*) from pg_trigger where tgname = 'trg_cena_usuarios_sistema_proteger')::int t,
  to_regclass('public.usuarios_sistema_auth_user_id_uidx') i, to_regclass('public.cena_seg_snapshot_20261004') s`);
ok('desfazer remove funções, gatilho, índice e snapshot', restos.f === 0 && restos.t === 0 && restos.i === null && restos.s === null, restos);
ok('desfazer não apaga usuários', Number((await one(`select count(*) n from public.usuarios_sistema`)).n) === 6);

if (failed.length) { console.error('FALHOU ' + failed.length + '/' + total + ':\n - ' + failed.join('\n - ')); process.exit(1); }
console.log('seguranca-usuarios-sistema-sql: OK (' + total + ' verificações)');
