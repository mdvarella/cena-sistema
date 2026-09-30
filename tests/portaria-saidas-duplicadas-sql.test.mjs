// PORTARIA — testes SQL da migration 20260930110000_portaria_saidas_duplicadas_abertas.sql
// PostgreSQL embutido (PGlite), esquema mínimo com ids em uuid e em text.
// Teste auxiliar: não substitui a conferência no Supabase real.
// Uso: PGLITE_PATH=<pasta com node_modules/@electric-sql/pglite> node tests/portaria-saidas-duplicadas-sql.test.mjs
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
  console.log('portaria-saidas-duplicadas-sql: SKIP (instale @electric-sql/pglite e defina PGLITE_PATH)');
  process.exit(0);
}

const SESSAO = 'sql:20260930110000_portaria_saidas_duplicadas_abertas';
const mig = fs.readFileSync(path.join(here, '..', 'supabase', 'migrations', '20260930110000_portaria_saidas_duplicadas_abertas.sql'), 'utf8');
const desfazer = mig.slice(mig.indexOf('-- Para desfazer')).split(/\r?\n/).slice(1)
  .map(l => l.replace(/^--\s?/, '')).join('\n').trim();
const PARES = [...mig.matchAll(/\['([0-9a-f-]{36})','([0-9a-f-]{36})'\]/g)].map(m => [m[1], m[2]]);
const OUTRA = '99999999-9999-4999-8999-999999999999';

const failed = [];
let total = 0;
function ok(name, cond, detail) { total++; if (!cond) failed.push(name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }

async function banco(tipo, extra) {
  const db = new PGlite();
  await db.exec(`
create table public.frotas_portaria_saidas (
  id ${tipo} primary key, placa text, modelo text, equipe_id ${tipo}, equipe text, status text, km_saida int, km_retorno int,
  data_saida timestamptz, data_retorno timestamptz, obs text, tipo_liberacao text, deleted_at timestamptz);
create table public.audit_log (
  id bigserial primary key, acao text, modulo text, descricao text, usuario_id text, usuario_nome text,
  usuario_perfil text, dados_extra jsonb, data_hora timestamptz, sessao_id text);`);
  const vals = [];
  PARES.forEach(([ab, ret], i) => {
    const eq = `'0000000${i % 10}-0000-4000-8000-${String(i).padStart(12, '0')}'`;
    const ts = `'2026-09-29T${String(7 + (i % 12)).padStart(2, '0')}:00:00-03:00'`;
    const placa = `'PLC${String(i).padStart(4, '0')}'`;
    // Metade: original aberta e cópia retornada; metade: cópia aberta e original retornada
    if (i % 2 === 0) {
      vals.push(`('${ab}',${placa},'FIORINO',${eq},'EQ${i}','Em campo',${1000 + i},null,${ts},null,null,'equipe',null)`);
      vals.push(`('${ret}',${placa},null,${eq},'EQ${i}','Retornado',${1000 + i},${1100 + i},${ts},'2026-09-29T18:00:00-03:00',null,null,null)`);
    } else {
      vals.push(`('${ab}',${placa},null,${eq},'EQ${i}','Em campo',${1000 + i},null,${ts},null,'obs antiga',null,null)`);
      vals.push(`('${ret}',${placa},'STRADA',${eq},'EQ${i}','Retornado',${1000 + i},${1100 + i},${ts},'2026-09-29T18:00:00-03:00',null,'equipe',null)`);
    }
  });
  vals.push(`('${OUTRA}','OUT0001','FIORINO','00000000-0000-4000-8000-000000000999','EQX','Em campo',5,null,'2026-09-29T07:00:00-03:00',null,null,'equipe',null)`);
  await db.exec(`insert into public.frotas_portaria_saidas values ${vals.join(',')};`);
  if (extra) await db.exec(extra);
  return db;
}
const n = async (db, sql) => Number((await db.query(sql)).rows[0].n);
const abertasAtivas = db => n(db, `select count(*) n from public.frotas_portaria_saidas where deleted_at is null and data_retorno is null`);
const audits = db => n(db, `select count(*) n from public.audit_log`);
async function aplicar(db) { try { await db.exec(mig); return null; } catch (e) { try { await db.exec('ROLLBACK'); } catch (_) {} return e.message; } }

ok('29 pares distintos na lista', PARES.length === 29 && new Set(PARES.flat()).size === 58, PARES.length);

for (const tipo of ['uuid', 'text']) {
  const T = '[' + tipo + '] ';
  {
    const db = await banco(tipo);
    ok(T + 'antes: 30 abertas', await abertasAtivas(db) === 30);
    const erro = await aplicar(db);
    ok(T + 'aplica sem erro', erro === null, erro);
    ok(T + 'sobra só a saída fora da lista aberta', await abertasAtivas(db) === 1);
    ok(T + 'cópias excluídas (soft delete)', await n(db, `select count(*) n from public.frotas_portaria_saidas where deleted_at is not null`) === 29);
    ok(T + 'nada apagado de verdade', await n(db, `select count(*) n from public.frotas_portaria_saidas`) === 59);
    ok(T + 'linhas retornadas continuam ativas com retorno', await n(db, `select count(*) n from public.frotas_portaria_saidas where deleted_at is null and data_retorno is not null`) === 29);
    const r0 = (await db.query(`select modelo, tipo_liberacao, km_retorno from public.frotas_portaria_saidas where id::text='${PARES[0][1]}'`)).rows[0];
    ok(T + 'retornada recebe modelo/tipo da gêmea', r0.modelo === 'FIORINO' && r0.tipo_liberacao === 'equipe' && r0.km_retorno === 1100, r0);
    const r1 = (await db.query(`select modelo, tipo_liberacao from public.frotas_portaria_saidas where id::text='${PARES[1][1]}'`)).rows[0];
    ok(T + 'retornada já completa não muda', r1.modelo === 'STRADA' && r1.tipo_liberacao === 'equipe', r1);
    const a1 = (await db.query(`select obs from public.frotas_portaria_saidas where id::text='${PARES[1][0]}'`)).rows[0];
    ok(T + 'nota na cópia preserva obs anterior', /^obs antiga \[Correção 30\/09\/2026: cópia duplicada/.test(a1.obs) && a1.obs.includes(PARES[1][1]), a1);
    const au = (await db.query(`select acao, dados_extra from public.audit_log where sessao_id='${SESSAO}'`)).rows;
    ok(T + 'auditoria com 29 pares', au.length === 1 && au[0].acao === 'PORTARIA_SAIDAS_DUPLICADAS' && au[0].dados_extra.registros_afetados === 29 && au[0].dados_extra.pares.length === 29, au[0] && au[0].dados_extra.registros_afetados);
    const erro2 = await aplicar(db);
    ok(T + 'reaplicar para (fail-closed)', erro2 && /nenhum par pendente/.test(erro2), erro2);
    ok(T + 'reaplicar não duplica auditoria', await audits(db) === 1);
    await db.exec(desfazer);
    ok(T + 'desfazer restaura as 29 cópias', await abertasAtivas(db) === 30);
    const d0 = (await db.query(`select modelo, tipo_liberacao from public.frotas_portaria_saidas where id::text='${PARES[0][1]}'`)).rows[0];
    const d1 = (await db.query(`select obs from public.frotas_portaria_saidas where id::text='${PARES[1][0]}'`)).rows[0];
    ok(T + 'desfazer restaura campos e obs', d0.modelo === null && d0.tipo_liberacao === null && d1.obs === 'obs antiga', [d0, d1]);
  }
  {
    // Porteiro já encerrou uma cópia à mão: par pulado, demais aplicados
    const db = await banco(tipo, `update public.frotas_portaria_saidas set data_retorno=now(), status='Retornado' where id::text='${PARES[3][0]}';`);
    const erro = await aplicar(db);
    ok(T + 'par já encerrado: aplica o resto', erro === null, erro);
    const au = (await db.query(`select dados_extra from public.audit_log`)).rows[0];
    ok(T + 'par já encerrado: pulado e registrado', au.dados_extra.registros_afetados === 28 && au.dados_extra.pulados.length === 1 && au.dados_extra.pulados[0].motivo === 'já encerrada', au.dados_extra.pulados);
    ok(T + 'par já encerrado: a cópia encerrada não é excluída', await n(db, `select count(*) n from public.frotas_portaria_saidas where id::text='${PARES[3][0]}' and deleted_at is null`) === 1);
  }
  {
    const db = await banco(tipo, `update public.frotas_portaria_saidas set placa='XXX9999' where id::text='${PARES[5][1]}';`);
    const erro = await aplicar(db);
    ok(T + 'placa diferente no par: para', erro && /não é da mesma equipe\/placa/.test(erro), erro);
    ok(T + 'placa diferente: nada alterado', await abertasAtivas(db) === 30 && await audits(db) === 0);
  }
  {
    const db = await banco(tipo, `update public.frotas_portaria_saidas set data_retorno=null, status='Em campo' where id::text='${PARES[7][1]}';`);
    const erro = await aplicar(db);
    ok(T + 'gêmea sem retorno: para', erro && /linha retornada não está mais retornada/.test(erro), erro);
    ok(T + 'gêmea sem retorno: nada alterado', await audits(db) === 0);
  }
  {
    const db = await banco(tipo, `delete from public.frotas_portaria_saidas where id::text='${PARES[9][0]}';`);
    const erro = await aplicar(db);
    ok(T + 'linha inexistente: para', erro && /não encontrado/.test(erro), erro);
  }
}

if (failed.length) { console.error('FALHOU ' + failed.length + '/' + total + ':\n - ' + failed.join('\n - ')); process.exit(1); }
console.log('portaria-saidas-duplicadas-sql: OK (' + total + ' verificações)');
