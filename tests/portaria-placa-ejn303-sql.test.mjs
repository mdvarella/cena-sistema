// PORTARIA — testes SQL da migration 20260930090000_portaria_placa_ejn303_30set.sql
// PostgreSQL embutido (PGlite), esquema mínimo com ids em uuid e em text.
// Teste auxiliar: não substitui a conferência no Supabase real.
// Uso: PGLITE_PATH=<pasta com node_modules/@electric-sql/pglite> node tests/portaria-placa-ejn303-sql.test.mjs
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
  console.log('portaria-placa-ejn303-sql: SKIP (instale @electric-sql/pglite e defina PGLITE_PATH)');
  process.exit(0);
}

const SESSAO = 'sql:20260930090000_portaria_placa_ejn303_30set';
const mig = fs.readFileSync(path.join(here, '..', 'supabase', 'migrations', '20260930090000_portaria_placa_ejn303_30set.sql'), 'utf8');
const desfazer = mig.slice(mig.indexOf('-- Para desfazer')).split(/\r?\n/).slice(1)
  .map(l => l.replace(/^--\s?/, '')).join('\n').trim();
const S1 = '545e35fc-90e0-45ff-a4fe-e06bbd0719d3';
const S2 = '357c4c09-e79e-4efa-bac5-57dbfe6090aa';
const OUTRA = '66666666-6666-4666-8666-666666666666';
const EQ = 'e1d505db-f808-493d-bd82-271b3291ecd0';

const failed = [];
let total = 0;
function ok(name, cond, detail) { total++; if (!cond) failed.push(name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }

async function banco(tipo, extra) {
  const db = new PGlite();
  await db.exec(`
create table public.frotas_veiculos (id uuid primary key, placa text, modelo text, deleted_at timestamptz);
create table public.frotas_portaria_saidas (
  id ${tipo} primary key, veiculo_id ${tipo}, placa text, modelo text, equipe_id ${tipo}, equipe text, status text,
  km_saida int, km_retorno int, data_saida timestamptz, data_retorno timestamptz, obs text, tipo_liberacao text, deleted_at timestamptz);
create table public.audit_log (
  id bigserial primary key, acao text, modulo text, descricao text, usuario_id text, usuario_nome text,
  usuario_perfil text, dados_extra jsonb, data_hora timestamptz, sessao_id text);
insert into public.frotas_veiculos values
  ('db0af9cf-2a4d-46b4-b6a4-1bcf52ea4920','GGB8G11','FIORINO',null),
  ('bee4bc73-9801-4a04-8555-33d052ebc2bb','DTF3B91','FIORINO',null);
insert into public.frotas_portaria_saidas (id,placa,modelo,equipe_id,equipe,status,km_saida,data_saida,obs,tipo_liberacao) values
  ('${S1}','DTF3B91','FIORINO','${EQ}','EJN303','Em campo',42513,'2026-09-30T07:26:15.511-03:00',null,'equipe'),
  ('${S2}','DTF3B91',null,'${EQ}','EJN303','Em campo',42513,'2026-09-30T07:26:15.511-03:00',null,null),
  ('${OUTRA}','DTF3B91','FIORINO','${EQ}','EJN303','Retornado',26000,'2026-09-28T07:00:00-03:00','outra obs','equipe');
`);
  if (extra) await db.exec(extra);
  return db;
}
const placas = async db => Object.fromEntries((await db.query(`select id::text id, placa from public.frotas_portaria_saidas`)).rows.map(r => [r.id, r.placa]));
const audits = async db => Number((await db.query(`select count(*) n from public.audit_log`)).rows[0].n);
async function aplicar(db) { try { await db.exec(mig); return null; } catch (e) { try { await db.exec('ROLLBACK'); } catch (_) {} return e.message; } }

for (const tipo of ['uuid', 'text']) {
  const T = '[' + tipo + '] ';
  {
    const db = await banco(tipo, `update public.frotas_portaria_saidas set obs='já tinha obs' where id::text='${S2}';`);
    const erro = await aplicar(db);
    ok(T + 'aplica sem erro', erro === null, erro);
    const p = await placas(db);
    ok(T + 'os 2 registros passam a GGB8G11', p[S1] === 'GGB8G11' && p[S2] === 'GGB8G11', p);
    ok(T + 'outra saída da equipe intacta', p[OUTRA] === 'DTF3B91');
    const r = (await db.query(`select id::text id, km_saida, status, modelo, obs from public.frotas_portaria_saidas where id::text in ('${S1}','${S2}') order by id`)).rows;
    ok(T + 'KM/status/modelo inalterados', r.every(x => x.km_saida === 42513 && x.status === 'Em campo') && r.find(x => x.id === S2).modelo === null, r);
    ok(T + 'nota de correção em obs (preserva obs anterior)', /^\[Correção 30\/09/.test(r.find(x => x.id === S1).obs) && /^já tinha obs \[Correção/.test(r.find(x => x.id === S2).obs), r);
    const a = (await db.query(`select acao, modulo, dados_extra from public.audit_log where sessao_id='${SESSAO}'`)).rows;
    ok(T + 'auditoria com antes/depois', a.length === 1 && a[0].acao === 'PORTARIA_CORRECAO_PLACA' && a[0].dados_extra.registros_afetados === 2
      && a[0].dados_extra.registros.length === 2 && a[0].dados_extra.registros.every(x => x.placa === 'DTF3B91'), a);
    const erro2 = await aplicar(db);
    ok(T + 'reaplicar para (fail-closed)', erro2 && /só 0 dos 2 registros/.test(erro2), erro2);
    ok(T + 'reaplicar não duplica auditoria', await audits(db) === 1);
    await db.exec(desfazer);
    const d = (await db.query(`select id::text id, placa, obs from public.frotas_portaria_saidas where id::text in ('${S1}','${S2}') order by id`)).rows;
    ok(T + 'desfazer restaura placa e obs dos 2', d.find(x => x.id === S1).placa === 'DTF3B91' && d.find(x => x.id === S1).obs === null
      && d.find(x => x.id === S2).placa === 'DTF3B91' && d.find(x => x.id === S2).obs === 'já tinha obs', d);
  }
  {
    // Retorno registrado antes de aplicar: a placa ainda deve ser corrigida.
    const db = await banco(tipo, `update public.frotas_portaria_saidas set status='Retornado', km_retorno=42600 where id::text='${S1}';`);
    const erro = await aplicar(db);
    ok(T + 'com retorno registrado: aplica', erro === null && (await placas(db))[S1] === 'GGB8G11', erro);
  }
  {
    const db = await banco(tipo, `update public.frotas_portaria_saidas set placa='GGB8G11' where id::text='${S2}';`);
    const erro = await aplicar(db);
    ok(T + 'um já corrigido à mão: para', erro && /só 1 dos 2 registros/.test(erro), erro);
    ok(T + 'um já corrigido: nada alterado', (await placas(db))[S1] === 'DTF3B91' && await audits(db) === 0);
  }
  {
    const db = await banco(tipo, `update public.frotas_portaria_saidas set km_saida=42514 where id::text='${S1}';`);
    const erro = await aplicar(db);
    ok(T + 'KM diferente: para', erro && /só 1 dos 2/.test(erro), erro);
  }
  {
    const db = await banco(tipo, `update public.frotas_portaria_saidas set deleted_at=now() where id::text='${S2}';`);
    const erro = await aplicar(db);
    ok(T + 'registro apagado: para', erro && /só 1 dos 2/.test(erro) && (await placas(db))[S1] === 'DTF3B91', erro);
  }
  {
    const db = await banco(tipo, `update public.frotas_veiculos set deleted_at=now() where placa='GGB8G11';`);
    const erro = await aplicar(db);
    ok(T + 'GGB8G11 fora do cadastro: para', erro && /GGB8G11 não encontrado/.test(erro) && (await placas(db))[S1] === 'DTF3B91', erro);
  }
}

if (failed.length) { console.error('FALHOU ' + failed.length + '/' + total + ':\n - ' + failed.join('\n - ')); process.exit(1); }
console.log('portaria-placa-ejn303-sql: OK (' + total + ' verificações)');
