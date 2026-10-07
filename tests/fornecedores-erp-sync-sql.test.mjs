// SINCRONIZAÇÃO DE FORNECEDORES ERP — testes SQL da migration 20261006190000_fornecedores_erp_sync.sql
// PostgreSQL embutido (PGlite) com os privilégios padrão do Supabase. Não substitui a conferência no Supabase real.
// Uso: node tests/fornecedores-erp-sync-sql.test.mjs
//      (PGlite em PGLITE_PATH ou em %TEMP%\pglite-cena\node_modules\@electric-sql\pglite)
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
  console.log('fornecedores-erp-sync-sql: SKIP (instale @electric-sql/pglite e defina PGLITE_PATH)');
  process.exit(0);
}

const mig = fs.readFileSync(path.join(here, '..', 'supabase', 'migrations', '20261006190000_fornecedores_erp_sync.sql'), 'utf8');
const migCron = fs.readFileSync(path.join(here, '..', 'supabase', 'migrations', '20261006190100_fornecedores_erp_sync_cron.sql'), 'utf8');
const semNotify = s => s.replace(/NOTIFY pgrst[^;]*;/g, '');
const codigo = mig.slice(0, mig.indexOf('-- Validação')).replace(/--[^\n]*/g, '');
const desfazer = mig.slice(mig.indexOf('-- Para desfazer')).split(/\r?\n/).slice(1)
  .map(l => l.replace(/^--\s?/, '')).join('\n').trim();

const failed = [];
let total = 0;
const ok = (n, c, d) => { total++; if (!c) failed.push(n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };

// ── Estáticos ───────────────────────────────────────────────────
ok('migration recarrega o cache do PostgREST', /NOTIFY pgrst, 'reload schema';/.test(mig));
ok('sem GRANT para anon', !/GRANT[^;]*\banon\b/i.test(codigo));
ok('sem DELETE de dados', !/\bDELETE FROM\b/i.test(codigo));
ok('não altera policies existentes de fornecedores', !/POLICY[^;]*ON public\.fornecedores/i.test(codigo));
ok('não autoriza por e-mail do JWT', !/auth\.jwt\(\)|auth\.email\(\)/i.test(codigo));
ok('funções de sincronização são SECURITY INVOKER', (codigo.match(/CREATE OR REPLACE FUNCTION public\.fn_(erp_sync|fornecedores_erp)_\w+\([^)]*\)[\s\S]*?SECURITY INVOKER/g) || []).length === 6);
ok('cron lê os segredos do Vault na execução (nada fixo no arquivo)', /vault\.decrypted_secrets WHERE name = 'erp_sync_cron_secret'/.test(migCron) && !/x-cron-secret',\s*'[^']/.test(migCron));
ok('cron diário 06:00 UTC', /'0 6 \* \* \*'/.test(migCron));

const U_GESTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const U_EQUIPE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const U_ADMV = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const U_INATIVO = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
create table public.usuarios_sistema (id uuid primary key default gen_random_uuid(), perfil text, ativo boolean default true,
  auth_user_id uuid, deleted_at timestamptz);
insert into public.usuarios_sistema (perfil, auth_user_id) values ('gestor', '${U_GESTOR}'), ('equipe', '${U_EQUIPE}'), ('administrativo', '${U_ADMV}');
insert into public.usuarios_sistema (perfil, auth_user_id, ativo) values ('admin', '${U_INATIVO}', false);
create function public.cena_usuario_perfil_sessao() returns text language sql stable security definer set search_path = public, pg_temp as $$
  select nullif(lower(btrim(coalesce(us.perfil, ''))), '') from public.usuarios_sistema us
  where auth.uid() is not null and us.auth_user_id = auth.uid() and us.ativo is true and us.deleted_at is null limit 1 $$;
create function public.cena_usuario_erp_ativo() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.cena_usuario_perfil_sessao() is not null $$;
create table public.fornecedores (id uuid primary key default gen_random_uuid(), razao_social text not null, cnpj_cpf text,
  tipo text, contato text, telefone text, email text, status text default 'Ativo', deleted_at timestamptz);
insert into public.fornecedores (razao_social, cnpj_cpf, tipo, contato, status) values
  ('Manual Vinculável', '12.345.678/0001-90', 'Locadora', 'João', 'Ativo'),
  ('Dup Local A', '11111111000111', 'Fornecedor', '', 'Ativo'),
  ('Dup Local B', '11.111.111/0001-11', 'Fornecedor', '', 'Ativo'),
  ('Único p/ ERP duplicado', '22222222000122', 'Fornecedor', '', 'Ativo'),
  ('Mesmo Nome Sem Doc', '', 'Fornecedor', '', 'Ativo');
insert into public.fornecedores (razao_social, cnpj_cpf, tipo, contato, status, deleted_at) values
  ('Excluído', '33333333000133', 'Fornecedor', '', 'Ativo', now());
`);

let erro = null;
try { await db.exec(semNotify(mig)); } catch (e) { erro = e.message; }
ok('aplica sem erro', erro === null, erro);
try { await db.exec(semNotify(mig)); erro = null; } catch (e) { erro = e.message; }
ok('reaplica sem erro (idempotente)', erro === null, erro);

const one = async (sql, p) => (await db.query(sql, p || [])).rows[0];
const tenta = async (sql, p) => { try { await db.query(sql, p || []); return null; } catch (e) { return e; } };
async function como(role, uid, fn) {
  await db.exec(`set role ${role}`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid || '']);
  try { return await fn(); } finally { await db.exec(`reset role`); await db.query(`select set_config('request.jwt.claim.sub', '', false)`); }
}
const svc = fn => como('service_role', '', fn);
const h = c => c.repeat(64);
const item = (o) => Object.assign({ erp_parent_id: null, nome_fantasia: null, cnpj_cpf: '', doc_valido: false, cnpj_dup_erp: false,
  email: null, telefone: null, cidade: null, estado: null, ativo: true, erp_updated_at: null }, o);

const lote = [
  item({ erp_id: 101, razao_social: 'ERP Vinculável LTDA', nome_fantasia: 'Vinc', cnpj_cpf: '12345678000190', doc_valido: true, email: 'a@b.c', cidade: 'Osasco', estado: 'SP', erp_updated_at: '2026-10-01T10:00:00Z', hash: h('a') }),
  item({ erp_id: 102, razao_social: 'ERP Dup Local', cnpj_cpf: '11111111000111', doc_valido: true, hash: h('b') }),
  item({ erp_id: 103, razao_social: 'ERP Dup 1', cnpj_cpf: '22222222000122', doc_valido: true, cnpj_dup_erp: true, hash: h('c') }),
  item({ erp_id: 104, razao_social: 'ERP Dup 2', cnpj_cpf: '22222222000122', doc_valido: true, cnpj_dup_erp: true, hash: h('d') }),
  item({ erp_id: 105, razao_social: 'ERP Sem Documento', hash: h('e') }),
  item({ erp_id: 106, razao_social: '   ', hash: h('f') }),
  item({ erp_id: 107, razao_social: 'Mesmo Nome Sem Doc', hash: h('1') }),
  item({ erp_id: 108, razao_social: 'ERP Do Excluído', cnpj_cpf: '33333333000133', doc_valido: true, ativo: false, hash: h('2') }),
];

const iniciar = (modo = 'COMPLETA', disparo = 'CRON', auth = null) =>
  svc(() => one(`select public.fn_erp_sync_iniciar('suppliers', $1, $2, $3) r`, [modo, disparo, auth])).then(x => x.r);
const aplicar = (ex, itens, simular = false) =>
  svc(() => one(`select public.fn_fornecedores_erp_aplicar($1, $2::jsonb, $3) r`, [ex, JSON.stringify(itens), simular])).then(x => x.r);
const finalizar = (ex, status, modo, cont, wm, err = null) =>
  svc(() => db.query(`select public.fn_erp_sync_finalizar($1, $2, $3, $4::jsonb, $5, $6, null)`, [ex, status, modo, JSON.stringify(cont || {}), wm, err]));
const nErp = async () => Number((await one(`select count(*) n from public.fornecedores where origem = 'ERP'`)).n);

// ── Simulação: calcula e não grava ───────────────────────────────
let ini = await iniciar('SIMULACAO');
ok('iniciar devolve execução e marca d\'água vazia', ini && ini.execucao_id && ini.watermark_updated_at === null, ini);
const sim = await aplicar(ini.execucao_id, lote, true);
ok('simulação conta: 1 vínculo, 6 inserções, 1 ignorado, 3 conflitos', sim.vinculados === 1 && sim.inseridos === 6 && sim.ignorados === 1 && sim.conflitos === 3 && sim.simulado === true, sim);
ok('simulação não grava fornecedores', (await nErp()) === 0);
ok('simulação não grava conflitos', Number((await one(`select count(*) n from public.erp_sync_conflitos`)).n) === 0);
await finalizar(ini.execucao_id, 'OK', 'SIMULACAO', sim, '2026-10-01T10:00:00Z');
let est = await one(`select * from public.erp_sync_estado where recurso = 'suppliers'`);
ok('simulação não avança marca d\'água nem última completa', est.watermark_updated_at === null && est.ultima_completa_em === null && est.em_execucao_id === null, est);

// ── Carga real ──────────────────────────────────────────────────
ini = await iniciar('COMPLETA');
const eLock = await svc(() => tenta(`select public.fn_erp_sync_iniciar('suppliers', 'COMPLETA', 'CRON', null)`));
ok('segunda execução simultânea: recusa (55P03)', eLock && eLock.code === '55P03' && /ERP_SYNC_EM_EXECUCAO/.test(eLock.message), eLock && eLock.message);
const eExec = await svc(() => tenta(`select public.fn_fornecedores_erp_aplicar('99999999-9999-4999-8999-999999999999', '[]'::jsonb, false)`));
ok('execução que não detém a trava: recusa', eExec && /ERP_SYNC_EXECUCAO_INVALIDA/.test(eExec.message));
const real = await aplicar(ini.execucao_id, lote);
ok('carga real com os mesmos números da simulação', real.vinculados === 1 && real.inseridos === 6 && real.ignorados === 1 && real.conflitos === 3, real);
const f1 = await one(`select * from public.fornecedores where erp_id = 101`);
ok('vínculo por CNPJ mascarado: mesmo registro, origem ERP, dados do ERP', f1.razao_social === 'ERP Vinculável LTDA' && f1.cnpj_cpf === '12345678000190' && f1.origem === 'ERP' && f1.cidade === 'Osasco', f1);
ok('vínculo preserva campos locais (tipo, contato)', f1.tipo === 'Locadora' && f1.contato === 'João', f1);
ok('vínculo grava erp_updated_at e erp_sincronizado_em', f1.erp_updated_at !== null && f1.erp_sincronizado_em !== null);
const dupLocal = Number((await one(`select count(*) n from public.fornecedores where regexp_replace(cnpj_cpf, '\\D', '', 'g') = '11111111000111'`)).n);
ok('CNPJ repetido no cadastro local: não vincula, insere o do ERP', dupLocal === 3 && (await one(`select origem from public.fornecedores where erp_id = 102`)).origem === 'ERP');
const unico = await one(`select erp_id, origem from public.fornecedores where razao_social = 'Único p/ ERP duplicado'`);
ok('CNPJ repetido no ERP: registro local fica manual', unico.erp_id === null && unico.origem === 'MANUAL', unico);
const semDoc = await one(`select erp_id from public.fornecedores where razao_social = 'Mesmo Nome Sem Doc' and origem = 'MANUAL'`);
ok('nunca vincula por nome', semDoc && semDoc.erp_id === null && (await one(`select count(*) n from public.fornecedores where razao_social = 'Mesmo Nome Sem Doc'`)).n == 2);
const exc = await one(`select deleted_at, erp_id from public.fornecedores where razao_social = 'Excluído'`);
ok('registro excluído não é candidato a vínculo', exc.deleted_at !== null && exc.erp_id === null);
ok('inativo no ERP entra como Inativo', (await one(`select status from public.fornecedores where erp_id = 108`)).status === 'Inativo');
const confs = (await db.query(`select erp_id, motivo, fornecedor_id from public.erp_sync_conflitos order by erp_id`)).rows;
ok('conflitos registrados para revisão', confs.length === 3 && confs[0].motivo === 'CNPJ_DUPLICADO_LOCAL' && confs[1].motivo === 'CNPJ_DUPLICADO_ERP' && confs[2].motivo === 'CNPJ_DUPLICADO_ERP' && confs[1].fornecedor_id !== null, confs);

// Mesmo lote de novo: nada muda
const again = await aplicar(ini.execucao_id, lote);
ok('mesmo lote de novo: tudo inalterado, nada inserido', again.inalterados === 7 && again.inseridos === 0 && again.atualizados === 0 && again.vinculados === 0, again);
ok('conflito não duplica', Number((await one(`select count(*) n from public.erp_sync_conflitos`)).n) === 3);

// Alteração no ERP: hash diferente atualiza
const alterado = lote.map(x => x.erp_id === 101 ? Object.assign({}, x, { razao_social: 'ERP Vinculável Renomeada', hash: h('9') }) : x);
const upd = await aplicar(ini.execucao_id, alterado);
ok('hash diferente: atualiza só o alterado', upd.atualizados === 1 && upd.inalterados === 6, upd);
ok('atualização grava o novo nome', (await one(`select razao_social from public.fornecedores where erp_id = 101`)).razao_social === 'ERP Vinculável Renomeada');

const eLote = await svc(() => tenta(`select public.fn_fornecedores_erp_aplicar($1, $2::jsonb, false)`, [ini.execucao_id, JSON.stringify(Array.from({ length: 501 }, (_, i) => item({ erp_id: 9000 + i, razao_social: 'X', hash: h('3') })))]));
ok('lote acima de 500: recusa', eLote && /ERP_SYNC_LOTE_GRANDE/.test(eLote.message));

// ── Ausentes ────────────────────────────────────────────────────
const vistos = [101, 102, 103, 104, 105, 107, 108];
const eIncomp = await svc(() => tenta(`select public.fn_fornecedores_erp_marcar_ausentes($1, $2::int[], $3)`, [ini.execucao_id, '{101,102}', 7]));
ok('leitura incompleta (ids != total): recusa', eIncomp && /ERP_SYNC_LEITURA_INCOMPLETA/.test(eIncomp.message));
const nAus = (await svc(() => one(`select public.fn_fornecedores_erp_marcar_ausentes($1, $2::int[], $3) n`, [ini.execucao_id, '{' + vistos.filter(x => x !== 105).join(',') + '}', 6]))).n;
ok('fornecedor que sumiu do ERP é inativado', nAus === 1, nAus);
const aus = await one(`select status, erp_ausente_desde, deleted_at from public.fornecedores where erp_id = 105`);
ok('ausente: Inativo, data marcada, nunca apagado', aus.status === 'Inativo' && aus.erp_ausente_desde !== null && aus.deleted_at === null, aus);
const volta = await aplicar(ini.execucao_id, lote.filter(x => x.erp_id === 105));
ok('ausente que reaparece volta a Ativo', volta.atualizados === 1 && (await one(`select status, erp_ausente_desde from public.fornecedores where erp_id = 105`)).status === 'Ativo');

const muitos = Array.from({ length: 30 }, (_, i) => item({ erp_id: 500 + i, razao_social: 'Massa ' + i, hash: h('4') }));
await aplicar(ini.execucao_id, muitos);
const eLim = await svc(() => tenta(`select public.fn_fornecedores_erp_marcar_ausentes($1, $2::int[], $3)`, [ini.execucao_id, '{101,102,103,104,105,107,108}', 7]));
ok('ausentes acima do limite: recusa (protege contra ERP devolvendo lista parcial)', eLim && /ERP_SYNC_AUSENTES_ACIMA_DO_LIMITE/.test(eLim.message), eLim && eLim.message);
ok('recusa não inativou ninguém', Number((await one(`select count(*) n from public.fornecedores where erp_id >= 500 and status = 'Inativo'`)).n) === 0);

// ── Finalizar e marca d'água ────────────────────────────────────
await finalizar(ini.execucao_id, 'OK', 'COMPLETA', { lidos: 8, inseridos: 6, vinculados: 1 }, '2026-10-01T10:00:00Z');
est = await one(`select * from public.erp_sync_estado where recurso = 'suppliers'`);
ok('OK avança marca d\'água, grava última completa e libera a trava', est.watermark_updated_at !== null && est.ultima_completa_em !== null && est.em_execucao_id === null && est.ultima_execucao_id === ini.execucao_id, est);
const exRow = await one(`select status, modo, lidos, inseridos, vinculados, finalizado_em from public.erp_sync_execucoes where id = $1`, [ini.execucao_id]);
ok('execução registrada com contadores', exRow.status === 'OK' && exRow.modo === 'COMPLETA' && exRow.lidos === 8 && exRow.inseridos === 6 && exRow.finalizado_em !== null, exRow);
const eFin2 = await svc(() => tenta(`select public.fn_erp_sync_finalizar($1, 'OK', 'COMPLETA', '{}'::jsonb, null, null, null)`, [ini.execucao_id]));
ok('finalizar duas vezes: recusa', eFin2 && /ERP_SYNC_EXECUCAO_INVALIDA/.test(eFin2.message));

ini = await iniciar('INCREMENTAL');
ok('nova execução recebe a marca d\'água', ini.watermark_updated_at !== null, ini);
await finalizar(ini.execucao_id, 'OK', 'INCREMENTAL', {}, '2026-09-01T00:00:00Z');
est = await one(`select watermark_updated_at::text w from public.erp_sync_estado where recurso = 'suppliers'`);
ok('marca d\'água não volta para trás', /^2026-10-01/.test(est.w), est);

ini = await iniciar('INCREMENTAL');
await finalizar(ini.execucao_id, 'PARCIAL', 'COMPLETA', {}, '2026-12-01T00:00:00Z', 'pagina 3 falhou');
est = await one(`select watermark_updated_at::text w, em_execucao_id from public.erp_sync_estado where recurso = 'suppliers'`);
ok('PARCIAL não avança marca d\'água e libera a trava', /^2026-10-01/.test(est.w) && est.em_execucao_id === null, est);

const eManual = await svc(() => tenta(`select public.fn_erp_sync_iniciar('suppliers', 'INCREMENTAL', 'MANUAL', null)`));
ok('disparo manual sem usuário: recusa', eManual && /ERP_SYNC_MANUAL_SEM_USUARIO/.test(eManual.message));

await db.exec(`update public.erp_sync_estado set em_execucao_desde = now() - interval '20 minutes', em_execucao_id = gen_random_uuid()`);
await db.exec(`insert into public.erp_sync_execucoes (recurso, modo, disparo, status) values ('suppliers', 'COMPLETA', 'CRON', 'EM_EXECUCAO')`);
ini = await iniciar('COMPLETA');
ok('trava com mais de 15 min é considerada abandonada', !!ini.execucao_id);
ok('execução abandonada vira ERRO', Number((await one(`select count(*) n from public.erp_sync_execucoes where status = 'EM_EXECUCAO' and id <> $1`, [ini.execucao_id])).n) === 0);
await finalizar(ini.execucao_id, 'ERRO', 'COMPLETA', {}, null, 'teste');

// ── Navegador (authenticated / anon) ────────────────────────────
const idErp = (await one(`select id from public.fornecedores where erp_id = 101`)).id;
const idMan = (await one(`select id from public.fornecedores where razao_social = 'Dup Local A'`)).id;
const eRaz = await como('authenticated', U_GESTOR, () => tenta(`update public.fornecedores set razao_social = 'X' where id = $1`, [idErp]));
ok('navegador não altera razão social do ERP', eRaz && eRaz.code === '42501', eRaz && eRaz.message);
const eSt = await como('authenticated', U_GESTOR, () => tenta(`update public.fornecedores set status = 'Inativo' where id = $1`, [idErp]));
ok('navegador não altera status do ERP', eSt && eSt.code === '42501');
const eSoft = await como('authenticated', U_GESTOR, () => tenta(`update public.fornecedores set deleted_at = now() where id = $1`, [idErp]));
ok('navegador não exclui (soft) fornecedor do ERP', eSoft && eSoft.code === '42501');
const eDel = await como('authenticated', U_GESTOR, () => tenta(`delete from public.fornecedores where id = $1`, [idErp]));
ok('navegador não apaga fornecedor do ERP', eDel && eDel.code === '42501');
const okLocal = await como('authenticated', U_GESTOR, () => tenta(`update public.fornecedores set tipo = 'Prestador', contato = 'Maria' where id = $1`, [idErp]));
ok('navegador altera campos locais (tipo, contato) do ERP', okLocal === null, okLocal && okLocal.message);
const eForja = await como('authenticated', U_GESTOR, () => tenta(`update public.fornecedores set erp_id = 999, origem = 'ERP' where id = $1`, [idMan]));
ok('navegador não forja vínculo', eForja && eForja.code === '42501');
const eInsErp = await como('authenticated', U_GESTOR, () => tenta(`insert into public.fornecedores (razao_social, origem, erp_id) values ('Forjado', 'ERP', 998)`));
ok('navegador não insere como ERP', eInsErp && eInsErp.code === '42501');
const okMan = await como('authenticated', U_GESTOR, () => tenta(`update public.fornecedores set razao_social = 'Dup Local A editado' where id = $1`, [idMan]));
ok('cadastro manual continua editável', okMan === null, okMan && okMan.message);
const okIns = await como('authenticated', U_GESTOR, () => tenta(`insert into public.fornecedores (razao_social, cnpj_cpf, tipo, contato, status) values ('Novo manual', '', 'Fornecedor', '', 'Ativo')`));
ok('cadastro manual novo continua', okIns === null, okIns && okIns.message);
const eVinc = await tenta(`update public.fornecedores set erp_id = 777 where id = $1`, [idMan]);
ok('constraint: erp_id exige origem ERP', eVinc && eVinc.code === '23514');

for (const [fn, args] of [
  ['fn_fornecedores_erp_aplicar', `'99999999-9999-4999-8999-999999999999', '[]'::jsonb, false`],
  ['fn_erp_sync_iniciar', `'suppliers', 'COMPLETA', 'CRON', null`],
  ['fn_erp_sync_finalizar', `'99999999-9999-4999-8999-999999999999', 'OK', 'COMPLETA', '{}'::jsonb, null, null, null`],
  ['fn_fornecedores_erp_marcar_ausentes', `'99999999-9999-4999-8999-999999999999', '{1}'::int[], 1`],
]) {
  const eA = await como('authenticated', U_GESTOR, () => tenta(`select public.${fn}(${args})`));
  ok(`authenticated não executa ${fn}`, eA && eA.code === '42501', eA && eA.message);
  const eN = await como('anon', '', () => tenta(`select public.${fn}(${args})`));
  ok(`anon não executa ${fn}`, eN && eN.code === '42501');
}

const pode = async uid => (await como('authenticated', uid, () => one(`select public.cena_forn_pode_sincronizar_erp() p`))).p;
ok('gestor pode disparar', (await pode(U_GESTOR)) === true);
ok('administrativo pode disparar', (await pode(U_ADMV)) === true);
ok('equipe não pode disparar', (await pode(U_EQUIPE)) === false);
ok('usuário inativo não pode disparar', (await pode(U_INATIVO)) === false);
ok('sem login não pode disparar', (await pode('')) === false);

const vis = async (uid, t) => Number((await como('authenticated', uid, () => one(`select count(*) n from public.${t}`))).n);
ok('usuário ativo vê execuções', (await vis(U_EQUIPE, 'erp_sync_execucoes')) > 0);
ok('usuário inativo não vê execuções', (await vis(U_INATIVO, 'erp_sync_execucoes')) === 0);
ok('gestor vê conflitos', (await vis(U_GESTOR, 'erp_sync_conflitos')) === 3);
ok('equipe não vê conflitos', (await vis(U_EQUIPE, 'erp_sync_conflitos')) === 0);
const eEscr = await como('authenticated', U_GESTOR, () => tenta(`update public.erp_sync_estado set watermark_updated_at = null`));
ok('authenticated não escreve no estado', eEscr && eEscr.code === '42501');
for (const t of ['erp_sync_estado', 'erp_sync_execucoes', 'erp_sync_conflitos']) {
  const eAn = await como('anon', '', () => tenta(`select count(*) from public.${t}`));
  ok(`anon sem acesso a ${t}`, eAn && eAn.code === '42501');
}

// ── Desfazer ─────────────────────────────────────────────────────
erro = null;
try { await db.exec(semNotify(desfazer)); } catch (e) { erro = e.message; }
ok('desfazer roda', erro === null, erro);
ok('desfazer remove as tabelas', (await one(`select to_regclass('public.erp_sync_execucoes') r`)).r === null);
ok('desfazer remove o gatilho', Number((await one(`select count(*) n from pg_trigger where tgname = 'trg_fornecedores_erp_proteger'`)).n) === 0);
ok('desfazer mantém os fornecedores', Number((await one(`select count(*) n from public.fornecedores`)).n) > 30);

if (failed.length) { console.error('FALHOU ' + failed.length + '/' + total + ':\n - ' + failed.join('\n - ')); process.exit(1); }
console.log('fornecedores-erp-sync-sql: OK (' + total + ' verificações)');
