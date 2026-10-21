// PORTARIA 8.1.225 — teste em PostgreSQL REAL isolado (servidor temporário local, nunca produção).
// Cobre o que o PGlite não faz: sessões concorrentes (retorno físico × encerramento administrativo, dois encerramentos
// ao mesmo tempo, tablet antigo gravando direto durante o encerramento) e reaplicação + rollback no servidor real.
// Uso: PG_BIN=<pasta pgsql\bin> node tests/pgreal/portaria-encerramento-real.mjs
// Não faz parte da suíte automática (precisa dos binários do PostgreSQL).
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.join(here, '..', '..');
const BIN = process.env.PG_BIN;
if (!BIN || !fs.existsSync(path.join(BIN, 'pg_ctl.exe')) && !fs.existsSync(path.join(BIN, 'pg_ctl'))) {
  console.log('portaria-encerramento-real: SKIP (defina PG_BIN com a pasta bin do PostgreSQL)'); process.exit(0);
}
const exe = n => path.join(BIN, process.platform === 'win32' ? n + '.exe' : n);
const PORTA = process.env.PG_PORTA || '55432';
const dados = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-enc-'));
const env = Object.assign({}, process.env, { PGHOST: '127.0.0.1', PGPORT: PORTA, PGUSER: 'postgres', PGCLIENTENCODING: 'UTF8', PGOPTIONS: '-c client_min_messages=warning' });

const failed = [];
let total = 0;
const ok = (n, c, d) => { total++; if (!c) failed.push(n + (d !== undefined ? ' — ' + JSON.stringify(d).slice(0, 700) : '')); };
const migDir = path.join(raiz, 'supabase', 'migrations');
const ler = f => fs.readFileSync(path.join(migDir, f), 'utf8').replace(/\r\n/g, '\n');
const semNotify = s => s.replace(/NOTIFY pgrst[^;]*;/g, '');
const migRaw = ler('20261020120000_portaria_encerramento_administrativo.sql');
const mig = semNotify(migRaw);
const desfazer = migRaw.slice(migRaw.indexOf('-- Para desfazer')).split('\n').slice(1).map(l => l.replace(/^--\s?/, '')).join('\n').replace(/NOTIFY pgrst[^;]*;/g, '').trim();
const migProg = ler('20261004200000_prog_projetos_agenda.sql');
const fnProg = migProg.slice(migProg.indexOf('CREATE OR REPLACE FUNCTION public.cena_prog_pode_programar_projetos()'),
  migProg.indexOf('GRANT EXECUTE ON FUNCTION public.cena_prog_pode_programar_projetos() TO authenticated;') + 'GRANT EXECUTE ON FUNCTION public.cena_prog_pode_programar_projetos() TO authenticated;'.length);
const fixture = fs.readFileSync(path.join(raiz, 'tests', 'fixtures', 'portaria', 'frotas-portaria-saidas-base.sql'), 'utf8');

const U = n => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const PERFIS = ['admin', 'gestor', 'coordenador', 'diretoria', 'supervisor', 'portaria'];
const UID = Object.fromEntries(PERFIS.map((p, i) => [p, U(i + 1)]));
const S = n => `d0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const C1 = 'c0000000-0000-4000-8000-000000000001';
const BASE = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
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
insert into public.contratos (id, codigo, nome, cliente, status) values ('${C1}', '1', 'TMA OESTE', 'ENEL', 'Ativo');
`;
const linhas = [];
for (let i = 1; i <= 12; i++) linhas.push(`('${S(i)}', 'PLC${i}', 'EQ${i}', 'e${i}', '${C1}', now() - interval '2 days', ${1000 * i}, 'Em campo')`);
const CENARIO = `insert into public.frotas_portaria_saidas (id, placa, equipe, equipe_id, contrato_id, data_saida, km_saida, status) values\n${linhas.join(',\n')};
insert into public.frotas_portaria_saidas (id, placa, equipe, equipe_id, contrato_id, data_saida, km_saida, km_retorno, data_retorno, status, obs_retorno, retorno_registrado_por) values
  ('${S(50)}', 'LEG1', 'EQL', 'el', '${C1}', '2026-09-10 07:00-03', 500, null, '2026-09-10 23:59:59-03', 'Retornado', '[Encerramento administrativo] Saída antiga sem retorno registrado', 'Marcos Varella');
insert into public.audit_log (acao, modulo, descricao, usuario_nome, dados_extra, data_hora) values
  ('editar', 'sistema', 'Alterou frotas_portaria_saidas [id=eq.${S(50)}]: status=Retornado', 'Marcos Varella',
   to_jsonb('{"dados":{"obs_retorno":"[Encerramento administrativo] Saída antiga sem retorno registrado"}}'::text), '2026-10-01 10:15:00-03');`;

function psql(db, sql, extra = []) {
  const r = spawnSync(exe('psql'), ['-d', db, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', ...extra], { input: sql, env, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
function psqlBg(db, sql) {
  return new Promise(resolve => {
    const p = spawn(exe('psql'), ['-d', db, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1'], { env });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { err += d; });
    p.on('close', code => resolve({ code, out: out.trim(), err: err.trim() }));
    p.stdin.end(sql);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const como = (uid, corpo) => `set role authenticated; do $$ begin perform set_config('request.jwt.claim.sub', '${uid}', false); end $$;\n${corpo}`;
const val = (db, q) => psql(db, q).out;

let servidor = false;
try {
  let r = spawnSync(exe('initdb'), ['-D', dados, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--locale=C'], { env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('initdb: ' + r.stderr);
  // stdio ignorado: no Windows o servidor herda os handles e um pipe lido pelo Node nunca fecha (o start trava).
  r = spawnSync(exe('pg_ctl'), ['-D', dados, '-o', `-p ${PORTA} -c listen_addresses=127.0.0.1 -c timezone=America/Sao_Paulo`, '-l', path.join(dados, 'log.txt'), '-w', 'start'], { env, stdio: 'ignore' });
  if (r.status !== 0) throw new Error('pg_ctl start falhou (veja ' + path.join(dados, 'log.txt') + ')');
  servidor = true;
  const versao = val('postgres', 'show server_version');
  ok('servidor PostgreSQL real 17 isolado', /^17\./.test(versao), versao);

  const DB = 'cenaenc';
  psql('postgres', `drop database if exists ${DB}; create database ${DB};`);
  for (const [nome, sql] of [['base', BASE], ['seguranca', semNotify(ler('20261004190000_seguranca_usuarios_sistema.sql'))], ['prog', fnProg],
    ['permissoes', semNotify(ler('20261007190000_cena_permissoes_acao.sql'))], ['fixture', fixture], ['cenario', CENARIO]]) {
    const x = psql(DB, sql);
    if (x.code !== 0) throw new Error('montagem ' + nome + ': ' + x.err.slice(0, 600));
  }
  const assin = `select md5(string_agg(id::text||'|'||coalesce(status,'')||'|'||coalesce(data_retorno::text,'')||'|'||coalesce(km_retorno::text,'')||'|'||coalesce(obs_retorno,''), ',' order by id)) from public.frotas_portaria_saidas`;
  const antes = val(DB, assin);
  let x = psql(DB, mig);
  ok('migration aplicada no servidor real', x.code === 0, x.err);
  ok('campos originais idênticos depois da migration', val(DB, assin) === antes);
  ok('histórico identificado com data/autor da auditoria', val(DB, `select tipo_encerramento||'|'||encerramento_origem||'|'||to_char(encerrado_em at time zone 'UTC','YYYY-MM-DD HH24:MI')||'|'||encerrado_por from public.frotas_portaria_saidas where id='${S(50)}'`)
    === 'ENCERRAMENTO_ADMINISTRATIVO|LEGADO_23_59|2026-10-01 13:15|Marcos Varella');
  x = psql(DB, mig);
  ok('reaplicar no servidor real: sem erro e sem mudança', x.code === 0 && val(DB, assin) === antes, x.err);

  const ENC = (id, uid, segura = 0) => como(uid, `begin; select public.fn_portaria_encerrar_saida_admin('${id}', 'Encerramento concorrente de teste no servidor real.', null);${segura ? ` select pg_sleep(${segura});` : ''} commit;`);
  const RET_NOVO = (id, segura = 0) => como(UID.portaria, `begin; update public.frotas_portaria_saidas set status='Retornado', data_retorno=now(), km_retorno=km_saida+50
     where id='${id}' and deleted_at is null and data_retorno is null and status='Em campo' returning id;${segura ? ` select pg_sleep(${segura});` : ''} commit;`);
  const RET_ANTIGO = (id, segura = 0) => como(UID.portaria, `begin; update public.frotas_portaria_saidas set status='Retornado', data_retorno=now(), km_retorno=km_saida+50
     where id='${id}' and deleted_at is null and data_retorno is null returning id;${segura ? ` select pg_sleep(${segura});` : ''} commit;`);
  const linha = id => val(DB, `select status||'|'||coalesce(tipo_encerramento,'-')||'|'||coalesce(data_retorno::text,'NULO')||'|'||coalesce(km_retorno::text,'NULO') from public.frotas_portaria_saidas where id='${id}'`);

  // T1: encerramento segura a linha; retorno físico (com a trava status=Em campo) chega no meio → 0 linhas, nada sobrescrito
  let a = psqlBg(DB, ENC(S(1), UID.gestor, 2)); await sleep(500);
  let b = psqlBg(DB, RET_NOVO(S(1)));
  let [ra, rb] = await Promise.all([a, b]);
  ok('T1 encerramento primeiro: encerrado sem horário/KM; retorno com trava não grava nada', ra.code === 0 && rb.code === 0 && rb.out === '' && /^Retornado\|ENCERRAMENTO_ADMINISTRATIVO\|NULO\|NULO$/.test(linha(S(1))), { ra, rb, l: linha(S(1)) });

  // T2: retorno físico segura a linha; encerramento chega no meio → espera e recusa JA_RETORNADA
  a = psqlBg(DB, RET_NOVO(S(2), 2)); await sleep(500);
  b = psqlBg(DB, ENC(S(2), UID.gestor));
  [ra, rb] = await Promise.all([a, b]);
  ok('T2 retorno físico primeiro: retorno real fica; encerramento recusado (JA_RETORNADA)', ra.code === 0 && rb.code !== 0 && /JA_RETORNADA/.test(rb.err)
    && /^Retornado\|RETORNO_FISICO\|[^N]/.test(linha(S(2))), { ra, rb, l: linha(S(2)) });

  // T3: dois gestores encerram ao mesmo tempo → um encerra, o outro recebe idempotente; uma auditoria só
  a = psqlBg(DB, ENC(S(3), UID.gestor, 2)); await sleep(500);
  b = psqlBg(DB, como(UID.coordenador, `select public.fn_portaria_encerrar_saida_admin('${S(3)}', 'Segundo gestor encerrando ao mesmo tempo.', null)->>'idempotente';`));
  [ra, rb] = await Promise.all([a, b]);
  ok('T3 dois encerramentos simultâneos: um encerra, o outro é idempotente, sem duplicar auditoria', ra.code === 0 && rb.code === 0 && rb.out === 'true'
    && val(DB, `select count(*) from public.audit_log where acao='encerrar_admin' and dados_extra->>'id'='${S(3)}'`) === '1', { ra, rb });

  // T4: tablet antigo (sem a trava status) grava retorno durante o encerramento → banco recusa, encerramento intacto
  a = psqlBg(DB, ENC(S(4), UID.gestor, 2)); await sleep(500);
  b = psqlBg(DB, RET_ANTIGO(S(4)));
  [ra, rb] = await Promise.all([a, b]);
  ok('T4 tablet antigo durante o encerramento: banco recusa (ENCERRAMENTO_PROTEGIDO), encerramento intacto', ra.code === 0 && rb.code !== 0 && /ENCERRAMENTO_PROTEGIDO/.test(rb.err)
    && /^Retornado\|ENCERRAMENTO_ADMINISTRATIVO\|NULO\|NULO$/.test(linha(S(4))), { ra, rb, l: linha(S(4)) });

  // T5: tablet antigo encerrando com 23:59:59 ao mesmo tempo que a função nova → um só vence, sem estado misto
  a = psqlBg(DB, ENC(S(5), UID.gestor, 2)); await sleep(500);
  b = psqlBg(DB, como(UID.gestor, `update public.frotas_portaria_saidas set status='Retornado', data_retorno=(current_date::text||'T23:59:59')::timestamptz,
     obs_retorno='[Encerramento administrativo] tablet antigo', retorno_registrado_por='Gestor Antigo' where id='${S(5)}' and data_retorno is null returning id;`));
  [ra, rb] = await Promise.all([a, b]);
  ok('T5 encerramento novo × tablet antigo encerrando: a função vence, o antigo é recusado', ra.code === 0 && rb.code !== 0 && /ENCERRAMENTO_PROTEGIDO/.test(rb.err)
    && /^Retornado\|ENCERRAMENTO_ADMINISTRATIVO\|NULO\|NULO$/.test(linha(S(5))), { ra, rb, l: linha(S(5)) });

  // T6: conciliação offline enquanto um gestor tenta encerrar de novo → conversão vence, sem perder o encerramento original
  psql(DB, ENC(S(6), UID.gestor));
  a = psqlBg(DB, como(UID.portaria, `begin; select public.fn_portaria_converter_retorno_fisico('${S(6)}', now() - interval '1 day', 6100, 'OFFLINE_SINCRONIZADO', null, 'ev-t6', '{"placa":"PLC6"}'); select pg_sleep(2); commit;`));
  await sleep(500);
  b = psqlBg(DB, como(UID.gestor, `select public.fn_portaria_encerrar_saida_admin('${S(6)}', 'Tentando encerrar durante a conciliação.', null)->>'ok';`));
  [ra, rb] = await Promise.all([a, b]);
  ok('T6 conciliação × novo encerramento: retorno real fica, encerramento original preservado', ra.code === 0 && (rb.code !== 0 && /JA_RETORNADA/.test(rb.err))
    && /^Retornado\|RETORNO_FISICO\|[^N].*\|6100$/.test(linha(S(6))) && val(DB, `select encerrado_por from public.frotas_portaria_saidas where id='${S(6)}'`) === 'Usuário gestor', { ra, rb, l: linha(S(6)) });

  // Permissão e autoria no servidor real
  x = psql(DB, como(UID.supervisor, `select public.fn_portaria_encerrar_saida_admin('${S(7)}', 'Supervisor sem permissão tentando.', null);`));
  ok('supervisor sem permissão: recusa', x.code !== 0 && /SEM_PERMISSAO/.test(x.err), x.err);
  x = psql(DB, `set role anon; select public.fn_portaria_encerrar_saida_admin('${S(7)}', 'Anônimo tentando encerrar saída.', null);`);
  ok('anônimo: sem acesso à função', x.code !== 0 && /permission denied/.test(x.err), x.err);
  x = psql(DB, como(UID.diretoria, `select public.fn_portaria_encerrar_saida_admin('${S(7)}', 'Diretoria encerrando com permissão.', '{"km_observado": 7123}')->>'ok';`));
  ok('diretoria: encerra; KM do pátio só como evidência', x.out === 'true' && val(DB, `select coalesce(km_retorno::text,'NULO')||'|'||(encerramento_evidencia->>'km_observado')||'|'||encerrado_por_auth from public.frotas_portaria_saidas where id='${S(7)}'`)
    === `NULO|7123|${UID.diretoria}`, x);

  // Rollback e reaplicação no servidor real
  const statusAntes = val(DB, `select string_agg(id::text||':'||status, ',' order by id) from public.frotas_portaria_saidas`);
  x = psql(DB, desfazer);
  ok('rollback no servidor real: sem erro', x.code === 0, x.err);
  ok('rollback: nenhuma saída volta a ficar em campo', val(DB, `select string_agg(id::text||':'||status, ',' order by id) from public.frotas_portaria_saidas`) === statusAntes);
  ok('rollback: dados do encerramento guardados no backup', Number(val(DB, `select count(*) from public.frotas_portaria_saidas_encerramento_bkp`)) >= 7);
  x = psql(DB, mig);
  ok('reaplicar depois do rollback: sem erro e encerramentos restaurados', x.code === 0 && /^Retornado\|ENCERRAMENTO_ADMINISTRATIVO\|NULO\|NULO$/.test(linha(S(1)))
    && val(DB, `select encerramento_origem from public.frotas_portaria_saidas where id='${S(1)}'`) === 'FUNCAO', x.err);
} catch (e) {
  failed.push('execução: ' + e.message);
} finally {
  if (servidor) spawnSync(exe('pg_ctl'), ['-D', dados, '-m', 'fast', '-w', 'stop'], { env, stdio: 'ignore' });
  try { fs.rmSync(dados, { recursive: true, force: true }); } catch (_) {}
}
if (failed.length) { console.error('FALHOU ' + failed.length + '/' + total + ':\n- ' + failed.join('\n- ')); process.exit(1); }
console.log('portaria-encerramento-real: OK (' + total + ' verificações, PostgreSQL real)');
