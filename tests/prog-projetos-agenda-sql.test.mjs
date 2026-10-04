// PROGRAMAÇÃO DE PROJETOS — testes SQL da migration 20261004200000_prog_projetos_agenda.sql
// PostgreSQL embutido (PGlite), esquema mínimo com os tipos reais (sot_projetos.id uuid, contrato_id text).
// Teste auxiliar: não substitui a conferência no Supabase real.
// Uso: PGLITE_PATH=<pasta com node_modules/@electric-sql/pglite> node tests/prog-projetos-agenda-sql.test.mjs
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
  console.log('prog-projetos-agenda-sql: SKIP (instale @electric-sql/pglite e defina PGLITE_PATH)');
  process.exit(0);
}

const mig = fs.readFileSync(path.join(here, '..', 'supabase', 'migrations', '20261004200000_prog_projetos_agenda.sql'), 'utf8');
const semNotify = s => s.replace(/NOTIFY pgrst[^;]*;/g, '');
const codigo = mig.slice(0, mig.indexOf('-- Validação')).replace(/--[^\n]*/g, '');
const desfazer = mig.slice(mig.indexOf('-- Para desfazer')).split(/\r?\n/).slice(1)
  .map(l => l.replace(/^--\s?/, '')).join('\n').trim();

const failed = [];
let total = 0;
const ok = (n, c, d) => { total++; if (!c) failed.push(n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };

ok('migration recarrega o cache do PostgREST', /NOTIFY pgrst, 'reload schema';/.test(mig));
ok('não mexe em composicao_dia / plpt / equipes_disp / TMA', !/composicao_dia|plpt_|equipes_disp|progTma/i.test(codigo));
ok('sem DELETE / UPDATE de dados existentes', !/\b(DELETE FROM|UPDATE public\.)/i.test(codigo));
ok('sem GRANT para anon', !/GRANT[^;]*\banon\b/i.test(mig));

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const PDEL = '33333333-3333-4333-8333-333333333333';
const U_GESTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const U_EQUIPE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const U_ESCR = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const U_INATIVO = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const CTR = 'c0000000-0000-4000-8000-000000000001';
const CTR2 = 'c0000000-0000-4000-8000-000000000002';
const EQ = 'e0000000-0000-4000-8000-000000000001';

const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
create table public.usuarios_sistema (id uuid primary key default gen_random_uuid(), nome text, email text, perfil text,
  ativo boolean default true, auth_user_id uuid, deleted_at timestamptz);
create table public.sot_projetos (id uuid primary key, contrato_id text, nome text, codigo_cliente text, deleted_at timestamptz);
insert into public.usuarios_sistema (nome, email, perfil, auth_user_id) values
  ('Gestor', 'gestor@cena', 'gestor', '${U_GESTOR}'),
  ('Eletricista', 'eq@cena', 'equipe', '${U_EQUIPE}'),
  ('Escritório', 'esc@cena', 'escritorio', '${U_ESCR}');
insert into public.usuarios_sistema (nome, email, perfil, auth_user_id, ativo) values ('Ex-gestor', 'ex@cena', 'gestor', '${U_INATIVO}', false);
insert into public.sot_projetos (id, contrato_id, nome, codigo_cliente) values
  ('${P1}', '${CTR}', 'Obra 1', 'DAC/S.SUL.22.00031'),
  ('${P2}', '${CTR2}', 'Obra 2', 'XYZ');
insert into public.sot_projetos (id, contrato_id, nome, deleted_at) values ('${PDEL}', '${CTR}', 'Apagado', now());
`);

let erro = null;
try { await db.exec(semNotify(mig)); } catch (e) { erro = e.message; }
ok('aplica sem erro', erro === null, erro);
try { await db.exec(semNotify(mig)); erro = null; } catch (e) { erro = e.message; }
ok('reaplica sem erro (idempotente)', erro === null, erro);

const one = async (sql, p) => (await db.query(sql, p || [])).rows[0];
const tenta = async (sql, p) => { try { await db.query(sql, p || []); return null; } catch (e) { return e; } };
const hoje = (await one(`select (now() at time zone 'America/Sao_Paulo')::date::text d`)).d;
const amanha = (await one(`select ((now() at time zone 'America/Sao_Paulo')::date + 1)::text d`)).d;
const depois = (await one(`select ((now() at time zone 'America/Sao_Paulo')::date + 5)::text d`)).d;
const ontem = (await one(`select ((now() at time zone 'America/Sao_Paulo')::date - 1)::text d`)).d;

// ── Regras como superusuário (gatilho + constraints) ─────────────
const r1 = await one(`insert into public.prog_projetos_agenda (projeto_id, data, criado_por) values ($1, $2, 'Gestor') returning *`, [P1, amanha]);
ok('grava projeto + data sem equipe (AGUARDANDO_EQUIPE)', r1 && r1.status === 'AGUARDANDO_EQUIPE' && r1.equipe_id === null, r1);
ok('contrato preenchido pelo projeto', r1.contrato_id === CTR, r1.contrato_id);
ok('origem padrão jornada', r1.origem === 'jornada');
const eDup = await tenta(`insert into public.prog_projetos_agenda (projeto_id, data) values ($1, $2)`, [P1, amanha]);
ok('mesmo projeto + mesma data: recusa (23505)', eDup && eDup.code === '23505', eDup && eDup.message);
ok('mesmo projeto em outra data: grava (várias datas pendentes)', await tenta(`insert into public.prog_projetos_agenda (projeto_id, data, origem) values ($1, $2, 'programacao')`, [P1, depois]) === null);
const eCtr = await tenta(`insert into public.prog_projetos_agenda (projeto_id, contrato_id, data) values ($1, $2, $3)`, [P1, CTR2, hoje]);
ok('contrato diferente do projeto: recusa', eCtr && eCtr.code === '23514' && /não é o do projeto/.test(eCtr.message), eCtr && eCtr.message);
const eOntem = await tenta(`insert into public.prog_projetos_agenda (projeto_id, data) values ($1, $2)`, [P2, ontem]);
ok('data passada: recusa', eOntem && eOntem.code === '23514' && /já passou/.test(eOntem.message));
ok('hoje: grava', await tenta(`insert into public.prog_projetos_agenda (projeto_id, data) values ($1, $2)`, [P2, hoje]) === null);
const eDel = await tenta(`insert into public.prog_projetos_agenda (projeto_id, data) values ($1, $2)`, [PDEL, amanha]);
ok('projeto excluído: recusa', eDel && eDel.code === '23503');
const eSem = await tenta(`insert into public.prog_projetos_agenda (projeto_id, data) values ($1, $2)`, ['44444444-4444-4444-8444-444444444444', amanha]);
ok('projeto inexistente: recusa', eSem && (eSem.code === '23503'));
const eAloc = await tenta(`insert into public.prog_projetos_agenda (projeto_id, data, status, equipe_id) values ($1, $2, 'ALOCADO', $3)`, [P2, depois, EQ]);
ok('agendamento novo não nasce ALOCADO', eAloc && eAloc.code === '23514');
const eOrig = await tenta(`insert into public.prog_projetos_agenda (projeto_id, data, origem) values ($1, $2, 'portaria')`, [P2, amanha]);
ok('origem fora da lista: recusa', eOrig && eOrig.code === '23514');

const eAlocSem = await tenta(`update public.prog_projetos_agenda set status = 'ALOCADO' where id = $1`, [r1.id]);
ok('ALOCADO sem equipe: recusa', eAlocSem && eAlocSem.code === '23514');
const rAl = await one(`update public.prog_projetos_agenda set status = 'ALOCADO', equipe_id = $2 where id = $1 returning *`, [r1.id, EQ]);
ok('ALOCADO com equipe grava alocado_em', rAl.status === 'ALOCADO' && rAl.equipe_id === EQ && rAl.alocado_em !== null);
const rVolta = await one(`update public.prog_projetos_agenda set status = 'AGUARDANDO_EQUIPE' where id = $1 returning *`, [r1.id]);
ok('volta para AGUARDANDO limpa equipe e alocado_em', rVolta.status === 'AGUARDANDO_EQUIPE' && rVolta.equipe_id === null && rVolta.alocado_em === null, rVolta);
const eData = await tenta(`update public.prog_projetos_agenda set data = $2 where id = $1`, [r1.id, depois]);
ok('trocar a data por UPDATE: recusa (cancela e cria outro)', eData && eData.code === '23514' && /não mudam/.test(eData.message));
const eProj = await tenta(`update public.prog_projetos_agenda set projeto_id = $2 where id = $1`, [r1.id, P2]);
ok('trocar o projeto: recusa', eProj && eProj.code === '23514');
const rCanc = await one(`update public.prog_projetos_agenda set status = 'CANCELADO', cancelado_por = 'Gestor' where id = $1 returning *`, [r1.id]);
ok('cancelar grava cancelado_em', rCanc.status === 'CANCELADO' && rCanc.cancelado_em !== null);
ok('depois de cancelar, a mesma data aceita novo agendamento', await tenta(`insert into public.prog_projetos_agenda (projeto_id, data) values ($1, $2)`, [P1, amanha]) === null);
const eReab = await tenta(`update public.prog_projetos_agenda set status = 'AGUARDANDO_EQUIPE' where id = $1`, [r1.id]);
ok('cancelado não volta para a fila', eReab && eReab.code === '23514');

// ── RLS ─────────────────────────────────────────────────────────
async function comoUsuario(uid, email, fn) {
  await db.exec(`set role authenticated`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)`, [uid || '', JSON.stringify({ email: email || '' })]);
  try { return await fn(); } finally { await db.exec(`reset role`); await db.query(`select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '', false)`); }
}
const nVis = async () => Number((await one(`select count(*) n from public.prog_projetos_agenda`)).n);
const totalLinhas = Number((await one(`select count(*) n from public.prog_projetos_agenda`)).n);

const visGestor = await comoUsuario(U_GESTOR, 'gestor@cena', nVis);
ok('gestor vê a fila inteira', visGestor === totalLinhas, { visGestor, totalLinhas });
const insGestor = await comoUsuario(U_GESTOR, 'gestor@cena', () => tenta(`insert into public.prog_projetos_agenda (projeto_id, data, criado_por) values ($1, $2, 'Gestor')`, [P2, amanha]));
ok('gestor agenda', insGestor === null, insGestor && insGestor.message);
const autor = await one(`select criado_por_auth from public.prog_projetos_agenda where projeto_id = $1 and data = $2`, [P2, amanha]);
ok('criado_por_auth vem do login (não do payload)', autor && autor.criado_por_auth === U_GESTOR, autor);
const forjado = await comoUsuario(U_GESTOR, 'gestor@cena', () => tenta(`insert into public.prog_projetos_agenda (projeto_id, data, criado_por_auth) values ($1, $2, $3)`, [P2, depois, U_ESCR]));
const autorF = await one(`select criado_por_auth from public.prog_projetos_agenda where projeto_id = $1 and data = $2`, [P2, depois]);
ok('criado_por_auth forjado é substituído', forjado === null && autorF.criado_por_auth === U_GESTOR, autorF);
const updGestor = await comoUsuario(U_GESTOR, 'gestor@cena', () => tenta(`update public.prog_projetos_agenda set status = 'ALOCADO', equipe_id = $1 where projeto_id = $2 and data = $3`, [EQ, P2, amanha]));
ok('gestor aloca', updGestor === null);
const visEsc = await comoUsuario(U_ESCR, 'esc@cena', nVis);
ok('escritório vê a fila', visEsc > 0);
const visEquipe = await comoUsuario(U_EQUIPE, 'eq@cena', nVis);
ok('perfil equipe não vê nada', visEquipe === 0);
const insEquipe = await comoUsuario(U_EQUIPE, 'eq@cena', () => tenta(`insert into public.prog_projetos_agenda (projeto_id, data) values ($1, $2)`, [P2, depois]));
ok('perfil equipe não agenda', insEquipe && insEquipe.code === '42501', insEquipe && insEquipe.message);
const visInativo = await comoUsuario(U_INATIVO, 'ex@cena', nVis);
ok('usuário inativo não vê nada', visInativo === 0);
const visSemLogin = await comoUsuario('', '', nVis);
ok('sem auth.uid() não vê nada', visSemLogin === 0);
const delGestor = await comoUsuario(U_GESTOR, 'gestor@cena', () => tenta(`delete from public.prog_projetos_agenda where projeto_id = $1`, [P2]));
ok('sem DELETE para authenticated (cancelamento é lógico)', delGestor && delGestor.code === '42501');
await db.exec(`set role anon`);
const eAnon = await tenta(`select count(*) from public.prog_projetos_agenda`);
await db.exec(`reset role`);
ok('anon sem acesso', eAnon && eAnon.code === '42501');

// ── Desfazer ─────────────────────────────────────────────────────
erro = null;
try { await db.exec(semNotify(desfazer)); } catch (e) { erro = e.message; }
ok('desfazer roda', erro === null, erro);
ok('desfazer remove a tabela', (await one(`select to_regclass('public.prog_projetos_agenda') r`)).r === null);
ok('desfazer remove as funções', Number((await one(`select count(*) n from pg_proc where proname in ('cena_prog_pode_programar_projetos','cena_prog_projetos_agenda_validar')`)).n) === 0);

if (failed.length) { console.error('FALHOU ' + failed.length + '/' + total + ':\n - ' + failed.join('\n - ')); process.exit(1); }
console.log('prog-projetos-agenda-sql: OK (' + total + ' verificações)');
