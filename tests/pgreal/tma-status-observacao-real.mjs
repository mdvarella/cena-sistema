// TMA — status/observação do dia em PostgreSQL REAL isolado (servidor temporário local, nunca produção).
// Reproduz o caso CLEBER (22/10/2026) com dados fictícios: linha do dia excluída (deleted_at) ocupando o UNIQUE
// (colaborador_id,data). Executa o SQL que o PostgREST gera para cada gravação do front e RELÊ o banco como a tela
// faz ao Atualizar (data=eq.X & deleted_at=is.null).
// Uso: PG_BIN=<pasta pgsql\bin> node tests/pgreal/tma-status-observacao-real.mjs  (fora da suíte automática)
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, spawnSync } from 'child_process';

const BIN = process.env.PG_BIN;
if (!BIN || !fs.existsSync(path.join(BIN, 'pg_ctl.exe')) && !fs.existsSync(path.join(BIN, 'pg_ctl'))) {
  console.log('tma-status-observacao-real: SKIP (defina PG_BIN com a pasta bin do PostgreSQL)'); process.exit(0);
}
const exe = n => path.join(BIN, process.platform === 'win32' ? n + '.exe' : n);
const PORTA = process.env.PG_PORTA || '55433';
const dados = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-status-'));
const env = Object.assign({}, process.env, { PGHOST: '127.0.0.1', PGPORT: PORTA, PGUSER: 'postgres', PGCLIENTENCODING: 'UTF8', PGOPTIONS: '-c client_min_messages=warning' });
const failed = [];
let total = 0;
const ok = (n, c, d) => { total++; if (!c) failed.push(n + (d !== undefined ? ' — ' + JSON.stringify(d).slice(0, 500) : '')); };
function psql(sql) {
  const r = spawnSync(exe('psql'), ['-d', 'teste', '-X', '-q', '-t', '-A', '-F', '|', '-v', 'ON_ERROR_STOP=1'], { input: sql, env, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
function psqlBg(sql) {
  return new Promise(resolve => {
    const p = spawn(exe('psql'), ['-d', 'teste', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1'], { env });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { err += d; });
    p.on('close', code => resolve({ code, out: out.trim(), err: err.trim() }));
    p.stdin.end(sql);
  });
}
const lit = v => v === null || v === undefined ? 'NULL' : "'" + String(v).replace(/'/g, "''") + "'";

// SQL equivalente ao POST do PostgREST com Prefer resolution=merge-duplicates: só as colunas do corpo entram no
// INSERT e no DO UPDATE SET (coluna ausente NÃO é tocada). onConflict é passado como o front passa.
function upsertPostgrest(linhas, onConflict) {
  const cols = Object.keys(linhas[0]);
  const vals = linhas.map(l => '(' + cols.map(c => lit(l[c]) + (c === 'data' || c === 'data_retorno' ? '::date' : c === 'deleted_at' ? '::timestamptz' : '')).join(', ') + ')').join(',\n');
  const alvo = onConflict.split(',').map(c => '"' + c.trim() + '"').join(', ');
  return `insert into public.prog_status_diario (${cols.join(', ')}) values ${vals}
    on conflict (${alvo}) do update set ${cols.map(c => c + ' = excluded.' + c).join(', ')}
    returning status, coalesce(obs,''), (deleted_at is null);`;
}
const releitura = (colab, dia) => psql(`select status || '|' || coalesce(obs,'') from public.prog_status_diario where colaborador_id='${colab}' and data='${dia}' and deleted_at is null;`).out;
const linhasDoDia = (colab, dia) => Number(psql(`select count(*) from public.prog_status_diario where colaborador_id='${colab}' and data='${dia}';`).out);

const DIA = '2026-10-22';
const CLEBER = 'teste-cleber-0001', NOVO = 'teste-novo-0002', OUTRO = 'teste-outro-0003', DUPLO = 'teste-duplo-0004';
let servidor = false;
try {
  let r = spawnSync(exe('initdb'), ['-D', dados, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--locale=C'], { env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('initdb: ' + r.stderr);
  r = spawnSync(exe('pg_ctl'), ['-D', dados, '-o', `-p ${PORTA} -c listen_addresses=127.0.0.1 -c timezone=America/Sao_Paulo`, '-l', path.join(dados, 'log.txt'), '-w', 'start'], { env, stdio: 'ignore' });
  if (r.status !== 0) throw new Error('pg_ctl start falhou');
  servidor = true;
  r = spawnSync(exe('psql'), ['-d', 'postgres', '-X', '-q', '-c', 'create database teste'], { env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('create database: ' + r.stderr);
  // Estrutura idêntica à de produção (information_schema de 22/10/2026): colunas, defaults e UNIQUE (colaborador_id,data).
  r = psql(`create table public.prog_status_diario (
      id uuid primary key default gen_random_uuid(), colaborador_id text not null, data date not null,
      status text not null default 'disponivel', data_retorno date, registrado_por text, criado_em timestamptz default now(),
      deleted_at timestamptz, obs text, created_at timestamptz default now(), updated_at timestamptz default now(),
      constraint prog_status_diario_colaborador_id_data_key unique (colaborador_id, data));`);
  ok('estrutura de produção criada', r.code === 0, r.err);
  ok('PostgreSQL real 17', /^17\./.test(psql('show server_version').out), psql('show server_version').out);

  // ── Cenário CLEBER: treinamento do dia criado na véspera, depois excluído (soft delete do sbDelete) ──
  psql(`insert into public.prog_status_diario (colaborador_id, data, status, data_retorno, registrado_por, criado_em)
        values ('${CLEBER}', '${DIA}', 'treinamento', '${DIA}', 'GESTOR TESTE', '2026-10-21 17:39-03');
        update public.prog_status_diario set deleted_at = '2026-10-22 08:14:42-03' where colaborador_id='${CLEBER}' and data='${DIA}';`);
  ok('cleber: linha do dia excluída não aparece na releitura', releitura(CLEBER, DIA) === '');
  const obs = 'Colaborador na base — veículo quebrado (teste)';
  const linhaObs = { colaborador_id: CLEBER, data: DIA, status: 'observacao', data_retorno: null, obs, registrado_por: 'SUPERVISOR TESTE' };

  // Causa 1 — gravação individual antiga: on_conflict com o NOME da regra → o banco recusa (42703)
  r = psql(upsertPostgrest([linhaObs], 'prog_status_diario_colaborador_id_data_key'));
  ok('causa 1: on_conflict pelo nome da regra é recusado pelo banco (coluna inexistente)', r.code !== 0 && /does not exist|não existe/i.test(r.err), r.err);
  ok('causa 1: nada gravado', releitura(CLEBER, DIA) === '');
  // Causa 2 — lote antigo: colunas certas, mas sem deleted_at → grava NA LINHA EXCLUÍDA, que continua excluída
  r = psql(upsertPostgrest([linhaObs], 'colaborador_id,data'));
  ok('causa 2: o lote "dá certo" (sem erro)', r.code === 0, r.err);
  ok('causa 2: a observação entrou na linha, mas ela continua excluída', /^observacao\|.*\|f$/.test(r.out), r.out);
  ok('causa 2: depois de Atualizar a observação some (reproduz o caso)', releitura(CLEBER, DIA) === '');
  ok('causa 2: sem duplicar a linha', linhasDoDia(CLEBER, DIA) === 1);
  // Correção — gravação individual nova: colunas certas + deleted_at nulo → reativa a linha
  r = psql(upsertPostgrest([Object.assign({}, linhaObs, { deleted_at: null })], 'colaborador_id,data'));
  ok('correção: grava e devolve a linha visível', r.code === 0 && /^observacao\|.*\|t$/.test(r.out), r.out + r.err);
  ok('correção: depois de Atualizar a observação continua (persistência)', releitura(CLEBER, DIA) === 'observacao|' + obs, releitura(CLEBER, DIA));
  ok('correção: continua uma única linha no dia (sem duplicidade)', linhasDoDia(CLEBER, DIA) === 1);
  ok('correção: preserva id e criação originais da linha', psql(`select to_char(criado_em at time zone 'America/Sao_Paulo','DD/MM HH24:MI') from public.prog_status_diario where colaborador_id='${CLEBER}'`).out === '21/10 17:39');

  // ── Observação nova (sem linha no dia) ──
  r = psql(upsertPostgrest([{ colaborador_id: NOVO, data: DIA, status: 'observacao', data_retorno: null, obs: 'nova', registrado_por: 'SUP', deleted_at: null }], 'colaborador_id,data'));
  ok('observação nova: grava e relê', r.code === 0 && releitura(NOVO, DIA) === 'observacao|nova');
  // ── Alteração de observação existente ──
  psql(upsertPostgrest([{ colaborador_id: NOVO, data: DIA, status: 'observacao', data_retorno: null, obs: 'texto alterado', registrado_por: 'SUP2', deleted_at: null }], 'colaborador_id,data'));
  ok('alteração: relê o texto novo', releitura(NOVO, DIA) === 'observacao|texto alterado');
  ok('alteração: uma linha só', linhasDoDia(NOVO, DIA) === 1);
  // ── Exclusão e novo lançamento ──
  psql(`update public.prog_status_diario set deleted_at = now() where colaborador_id='${NOVO}' and data='${DIA}';`);
  ok('exclusão: some da releitura', releitura(NOVO, DIA) === '');
  psql(upsertPostgrest([{ colaborador_id: NOVO, data: DIA, status: 'observacao', data_retorno: null, obs: 'depois da exclusão', registrado_por: 'SUP3', deleted_at: null }], 'colaborador_id,data'));
  ok('novo lançamento após exclusão: volta a aparecer', releitura(NOVO, DIA) === 'observacao|depois da exclusão');
  // ── Lote (outros colaboradores) não ressuscita exclusão feita por outro usuário ──
  psql(`insert into public.prog_status_diario (colaborador_id, data, status, deleted_at) values ('${OUTRO}', '${DIA}', 'falta', now());`);
  r = psql(upsertPostgrest([
    { colaborador_id: OUTRO, data: DIA, status: 'falta', data_retorno: null, obs: null, registrado_por: 'OUTRA ABA' },
    { colaborador_id: NOVO, data: DIA, status: 'observacao', data_retorno: null, obs: 'depois da exclusão', registrado_por: 'SUP3' },
  ], 'colaborador_id,data'));
  ok('lote: grava sem erro', r.code === 0, r.err);
  ok('lote: a falta excluída por outro usuário continua excluída', releitura(OUTRO, DIA) === '');
  ok('lote: observação reativada continua visível', releitura(NOVO, DIA) === 'observacao|depois da exclusão');
  // ── Concorrência: duas gravações simultâneas do mesmo colaborador/dia ──
  const s1 = upsertPostgrest([{ colaborador_id: DUPLO, data: DIA, status: 'observacao', data_retorno: null, obs: 'A', registrado_por: 'X', deleted_at: null }], 'colaborador_id,data');
  const s2 = upsertPostgrest([{ colaborador_id: DUPLO, data: DIA, status: 'observacao', data_retorno: null, obs: 'B', registrado_por: 'Y', deleted_at: null }], 'colaborador_id,data');
  const [c1, c2] = await Promise.all([psqlBg(s1), psqlBg(s2)]);
  ok('concorrência: as duas gravações terminam sem erro', c1.code === 0 && c2.code === 0, [c1.err, c2.err]);
  ok('concorrência: uma única linha, visível', linhasDoDia(DUPLO, DIA) === 1 && /^observacao\|[AB]$/.test(releitura(DUPLO, DIA)), releitura(DUPLO, DIA));
  // ── P1/P2: histórico do treinamento e consulta de persistentes (equivale a
  //    status=in.(…)&data=lte.D&deleted_at=is.null&or=(data_retorno.is.null,data_retorno.gt.D)&order=data.desc,id.desc) ──
  const T = 'teste-treino-0005';
  psql(`insert into public.prog_status_diario (colaborador_id, data, status, data_retorno, registrado_por)
        values ('${T}', '${DIA}', 'treinamento', '2026-10-23', 'GESTOR');
        insert into public.prog_status_diario (colaborador_id, data, status, data_retorno)
        select 'dem-' || (g % 150), date '2026-10-01' + (g / 150), 'demitido', null from generate_series(0, 3199) g
        on conflict (colaborador_id, data) do nothing;
        insert into public.prog_status_diario (colaborador_id, data, status, data_retorno) values ('fer-antiga', '2026-09-20', 'ferias', '2026-10-30');`);
  const pers = d => `select colaborador_id from public.prog_status_diario
     where status in ('ferias','afastado','treinamento','demitido','inapto') and data <= '${d}' and deleted_at is null
       and (data_retorno is null or data_retorno > '${d}')`;
  ok('P2: em 22/10 o treinamento (retorno 23/10) é persistente ativo', psql(pers(DIA) + ` and colaborador_id='${T}';`).out === T);
  ok('P2: em 23/10 não é mais (retorno = 1º dia de volta)', psql(pers('2026-10-23') + ` and colaborador_id='${T}';`).out === '');
  ok('P1: a linha de 22/10 continua no histórico (consulta do dia)', releitura(T, DIA) === 'treinamento|');
  ok('P2: férias de 20/09 aparece em 22/10 mesmo entre centenas de linhas', psql(pers(DIA) + ` and colaborador_id='fer-antiga';`).out === 'fer-antiga');
  const totalPers = Number(psql(`select count(*) from (${pers(DIA)}) x;`).out);
  let paginado = 0, off = 0, rep = 0;
  const vistos = new Set();
  for (;;) {
    const r = psql(`select id from (${pers(DIA).replace('select colaborador_id', 'select id, data')}) x order by data desc, id desc limit 1000 offset ${off};`).out;
    const ids = r ? r.split('\n') : [];
    ids.forEach(i => { if (vistos.has(i)) rep++; vistos.add(i); });
    paginado += ids.length;
    if (ids.length < 1000) break;
    off += 1000;
  }
  ok('P2: paginação (1000 por página, data desc, id desc) lê todas as linhas, sem repetir nem pular', totalPers > 1000 && paginado === totalPers && rep === 0, { totalPers, paginado, rep });
} catch (e) {
  failed.push('exceção: ' + (e && e.message || e));
} finally {
  if (servidor) spawnSync(exe('pg_ctl'), ['-D', dados, '-m', 'fast', '-w', 'stop'], { env, stdio: 'ignore' });
  try { fs.rmSync(dados, { recursive: true, force: true }); } catch (_) {}
}
if (failed.length) { console.error('FALHOU ' + failed.length + '/' + total + ':\n- ' + failed.join('\n- ')); process.exit(1); }
console.log('tma-status-observacao-real: OK (' + total + ' verificações, PostgreSQL real)');
