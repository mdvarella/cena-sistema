// PORTARIA — testes SQL da migration 20261001100000_portaria_retornos_copias_excluidas_3009.sql
// PostgreSQL embutido (PGlite), esquema mínimo com ids em uuid e em text.
// Teste auxiliar: não substitui a conferência no Supabase real.
// Uso: PGLITE_PATH=<pasta com node_modules/@electric-sql/pglite> node tests/portaria-retornos-copias-excluidas-3009-sql.test.mjs
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
  console.log('portaria-retornos-copias-excluidas-3009-sql: SKIP (instale @electric-sql/pglite e defina PGLITE_PATH)');
  process.exit(0);
}

const ARQ = '20261001100000_portaria_retornos_copias_excluidas_3009';
const SESSAO = 'sql:' + ARQ;
const mig = fs.readFileSync(path.join(here, '..', 'supabase', 'migrations', ARQ + '.sql'), 'utf8');
const desfazer = mig.slice(mig.indexOf('-- Para desfazer')).split(/\r?\n/).slice(1)
  .map(l => l.replace(/^--\s?/, '')).join('\n').trim();
const PARES = [...mig.matchAll(/\('([0-9a-f-]{36})', '([0-9a-f-]{36})'\)/g)].map(m => ({ copia: m[1], viva: m[2] }));
const RESTAURAR = (mig.match(/v_restaurar text := '([0-9a-f-]{36})'/) || [])[1];
const IRMA_RTQ = 'eea376fa-074f-4938-a83f-9015bbbbca4a';
const EON121 = PARES.find(p => p.viva.startsWith('4d886cc2'));
const OUTRA = '99999999-9999-4999-8999-999999999999';

const failed = [];
let total = 0;
function ok(name, cond, detail) { total++; if (!cond) failed.push(name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }

async function banco(tipo, extra) {
  const db = new PGlite();
  await db.exec(`
create table public.frotas_portaria_saidas (
  id ${tipo} primary key, placa text, equipe_id ${tipo}, equipe text, status text, km_saida int, km_retorno int,
  data_saida timestamptz, data_retorno timestamptz, base_retorno text, obs_retorno text, retorno_registrado_por text,
  status_devolucao text, foto_carga_retorno_b64 text, foto_carga_retorno_ts timestamptz, obs text, deleted_at timestamptz);
create table public.audit_log (
  id bigserial primary key, acao text, modulo text, descricao text, usuario_id text, usuario_nome text,
  usuario_perfil text, dados_extra jsonb, data_hora timestamptz, sessao_id text);`);
  const vals = [];
  PARES.forEach((p, i) => {
    const eq = `'0000000${i % 10}-0000-4000-8000-${String(i).padStart(12, '0')}'`;
    const ts = `'2026-09-30T${String(7 + (i % 6)).padStart(2, '0')}:${String(10 + i).padStart(2, '0')}:00-03:00'`;
    const placa = `'PLC${String(i).padStart(4, '0')}'`;
    const obsViva = i === 3 ? `'[Correção 30/09/2026: placa registrada]'` : 'null';
    vals.push(`('${p.copia}',${placa},${eq},'EQ${i}','Retornado',${1000 + i},${1100 + i},${ts},'2026-09-30T17:00:00-03:00',null,null,'Portaria Coaquira 1',null,'data:image/jpeg;base64,FOTO${i}','2026-09-30T17:00:00-03:00','[Correção 30/09/2026: cópia duplicada]','2026-09-30T15:25:13-03:00')`);
    if (p === EON121) vals.push(`('${p.viva}',${placa},${eq},'EQ${i}','Retornado',${1000 + i},${1200 + i},${ts},'2026-10-01T05:17:48-03:00',null,null,'Porteiro noite',null,null,null,null,null)`);
    else vals.push(`('${p.viva}',${placa},${eq},'EQ${i}','Em campo',${1000 + i},null,${ts},null,null,null,null,null,null,null,${obsViva},null)`);
  });
  vals.push(`('${RESTAURAR}','RTQ7D65','00000000-0000-4000-8000-000000000177','EON177','Retornado',13,139217,'2026-09-30T12:04:47-03:00','2026-09-30T21:49:38-03:00',null,null,'Portaria Coaquira 1',null,null,null,'Equipe transferida','2026-10-01T07:35:21-03:00')`);
  vals.push(`('${IRMA_RTQ}','RTQ7D65','00000000-0000-4000-8000-000000000174','EJN174','Em campo',13,null,'2026-09-30T12:04:47-03:00',null,null,null,null,null,null,null,'[Correção 30/09/2026: cópia duplicada]','2026-09-30T15:25:13-03:00')`);
  vals.push(`('${OUTRA}','OUT0001','00000000-0000-4000-8000-000000000999','EQX','Em campo',5,null,'2026-09-30T21:48:00-03:00',null,null,null,null,null,null,null,null,null)`);
  await db.exec(`insert into public.frotas_portaria_saidas values ${vals.join(',')};`);
  if (extra) await db.exec(extra);
  return db;
}
const n = async (db, sql) => Number((await db.query(sql)).rows[0].n);
const linha = async (db, id) => (await db.query(`select * from public.frotas_portaria_saidas where id::text='${id}'`)).rows[0];
const emCampo = db => n(db, `select count(*) n from public.frotas_portaria_saidas where deleted_at is null and status='Em campo'`);
const audits = db => n(db, `select count(*) n from public.audit_log`);
const auditoria = async db => ((await db.query(`select dados_extra from public.audit_log where sessao_id='${SESSAO}'`)).rows[0] || {}).dados_extra;
async function aplicar(db) { try { await db.exec(mig); return null; } catch (e) { try { await db.exec('ROLLBACK'); } catch (_) {} return e.message; } }
const ms = d => (d ? new Date(d).getTime() : null);

ok('17 pares com ids distintos', PARES.length === 17 && new Set(PARES.flatMap(p => [p.copia, p.viva])).size === 34);
ok('EON121 TTJ1J13 na lista', !!EON121 && EON121.copia.startsWith('52eaebb2'));
ok('GGB8G11 na lista (545e35fc → 357c4c09)', PARES.some(p => p.copia.startsWith('545e35fc') && p.viva.startsWith('357c4c09')));
ok('restauração é a e05fe08c (RTQ7D65)', RESTAURAR === 'e05fe08c-b693-4146-b308-f85d7d75cd1d');
ok('restauração fora dos pares', !PARES.some(p => p.copia === RESTAURAR || p.viva === RESTAURAR));

for (const tipo of ['uuid', 'text']) {
  const T = '[' + tipo + '] ';
  {
    const db = await banco(tipo);
    ok(T + 'antes: 16 vivas em campo + 1 fora da lista', await emCampo(db) === 17);
    const erro = await aplicar(db);
    ok(T + 'aplica sem erro', erro === null, erro);
    ok(T + 'só a saída fora da lista continua em campo', await emCampo(db) === 1 && (await linha(db, OUTRA)).status === 'Em campo');
    const p0 = PARES[0];
    const v0 = await linha(db, p0.viva), c0 = await linha(db, p0.copia);
    ok(T + 'viva recebe o retorno da cópia', v0.status === 'Retornado' && v0.km_retorno === c0.km_retorno && ms(v0.data_retorno) === ms(c0.data_retorno)
      && v0.retorno_registrado_por === 'Portaria Coaquira 1' && v0.foto_carga_retorno_b64 === c0.foto_carga_retorno_b64 && ms(v0.foto_carga_retorno_ts) === ms(c0.foto_carga_retorno_ts), v0);
    ok(T + 'viva continua viva e com KM de saída intacto', v0.deleted_at === null && v0.km_saida === 1000);
    ok(T + 'nota na viva aponta a cópia', /^\[Correção 01\/10\/2026: retorno registrado pela portaria na cópia já excluída /.test(v0.obs) && v0.obs.includes(p0.copia), v0.obs);
    const v3 = await linha(db, PARES[3].viva);
    ok(T + 'obs anterior da viva preservada', v3.obs.startsWith('[Correção 30/09/2026: placa registrada] [Correção 01/10/2026'), v3.obs);
    ok(T + 'cópia continua excluída e intocada', c0.deleted_at !== null && c0.obs === '[Correção 30/09/2026: cópia duplicada]');
    const e = await linha(db, EON121.viva);
    ok(T + 'EON121: retorno de 01/10 05:17 não é sobrescrito', e.km_retorno === 1200 + PARES.indexOf(EON121) && e.retorno_registrado_por === 'Porteiro noite', e);
    const r = await linha(db, RESTAURAR);
    ok(T + 'RTQ7D65 restaurada com nota', r.deleted_at === null && r.status === 'Retornado' && /^Equipe transferida \[Correção 01\/10\/2026: saída restaurada/.test(r.obs), r);
    ok(T + 'irmã da RTQ7D65 continua excluída', (await linha(db, IRMA_RTQ)).deleted_at !== null);
    const au = await auditoria(db);
    ok(T + 'auditoria: 16 itens + restauração = 17 registros', au && au.itens.length === 16 && au.registros_afetados === 17 && au.restaurada && au.restaurada.id === RESTAURAR, au && au.registros_afetados);
    ok(T + 'auditoria: EON121 pulado com os dois retornos', au && au.pulados.length === 1 && au.pulados[0].motivo === 'saída viva já tem retorno' && au.pulados[0].viva === EON121.viva && au.pulados[0].copia_km_retorno != null, au && au.pulados);
    const erro2 = await aplicar(db);
    ok(T + 'reaplicar para (nada pendente)', erro2 && /nada pendente/.test(erro2), erro2);
    ok(T + 'reaplicar não duplica auditoria', await audits(db) === 1);
    await db.exec(desfazer);
    const d0 = await linha(db, p0.viva);
    ok(T + 'desfazer: viva volta em campo, sem retorno', d0.status === 'Em campo' && d0.km_retorno === null && d0.data_retorno === null && d0.retorno_registrado_por === null && d0.foto_carga_retorno_b64 === null && d0.obs === null, d0);
    ok(T + 'desfazer: obs anterior da viva volta', (await linha(db, PARES[3].viva)).obs === '[Correção 30/09/2026: placa registrada]');
    const dr = await linha(db, RESTAURAR);
    ok(T + 'desfazer: RTQ7D65 excluída de novo com obs original', dr.deleted_at !== null && ms(dr.deleted_at) === ms('2026-10-01T07:35:21-03:00') && dr.obs === 'Equipe transferida', dr);
    ok(T + 'desfazer: EON121 intocado', (await linha(db, EON121.viva)).retorno_registrado_por === 'Porteiro noite');
    ok(T + 'desfazer: 16 em campo de novo', await emCampo(db) === 17);
  }
  {
    const db = await banco(tipo);
    const soDo = mig.slice(mig.indexOf('DO $$'), mig.indexOf('END $$;') + 'END $$;'.length);
    let erro = null;
    try { await db.exec(soDo); } catch (e) { erro = e.message; }
    ok(T + 'só o bloco DO: aplica sem erro', erro === null, erro);
    ok(T + 'só o bloco DO: 16 retornos copiados', await emCampo(db) === 1);
  }
  {
    // Porteiro registrou o retorno na viva antes da migration: par pulado, retorno dele preservado
    const p = PARES[1];
    const db = await banco(tipo, `update public.frotas_portaria_saidas set status='Retornado', data_retorno='2026-10-01T09:00:00-03:00', km_retorno=7 where id::text='${p.viva}';`);
    const erro = await aplicar(db);
    ok(T + 'viva já retornada: aplica o resto', erro === null, erro);
    ok(T + 'viva já retornada: não sobrescreve', (await linha(db, p.viva)).km_retorno === 7);
    const au = await auditoria(db);
    ok(T + 'viva já retornada: 15 itens, 2 pulados', au.itens.length === 15 && au.pulados.length === 2, au.pulados);
  }
  {
    const p = PARES[2];
    const db = await banco(tipo, `update public.frotas_portaria_saidas set deleted_at=now() where id::text='${p.viva}';`);
    const erro = await aplicar(db);
    const au = await auditoria(db);
    ok(T + 'viva excluída: pulada', erro === null && au.pulados.some(x => x.viva === p.viva && x.motivo === 'saída viva foi excluída') && (await linha(db, p.viva)).data_retorno === null, erro || au.pulados);
  }
  {
    const p = PARES[4];
    const db = await banco(tipo, `update public.frotas_portaria_saidas set deleted_at=null where id::text='${p.copia}';`);
    const erro = await aplicar(db);
    const au = await auditoria(db);
    ok(T + 'cópia restaurada à mão: par pulado', erro === null && au.pulados.some(x => x.copia === p.copia && x.motivo === 'cópia não está mais excluída') && (await linha(db, p.viva)).status === 'Em campo', erro || au.pulados);
  }
  {
    const db = await banco(tipo, `update public.frotas_portaria_saidas set deleted_at=null where id::text='${IRMA_RTQ}';`);
    const erro = await aplicar(db);
    const au = await auditoria(db);
    ok(T + 'RTQ7D65 com saída viva equivalente: não restaura', erro === null && au.restaurada === null && au.pulados.some(x => x.motivo === 'já existe saída viva equivalente') && (await linha(db, RESTAURAR)).deleted_at !== null, erro || au);
  }
  {
    const db = await banco(tipo, `update public.frotas_portaria_saidas set km_saida=km_saida+1 where id::text='${PARES[5].copia}';`);
    const erro = await aplicar(db);
    ok(T + 'KM diferente: para', erro && /KM/.test(erro), erro);
    ok(T + 'KM diferente: nada alterado', await emCampo(db) === 17 && await audits(db) === 0 && (await linha(db, RESTAURAR)).deleted_at !== null);
  }
  {
    const db = await banco(tipo, `update public.frotas_portaria_saidas set equipe_id=null where id::text='${PARES[6].viva}';`);
    const erro = await aplicar(db);
    ok(T + 'equipe diferente: para sem alterar', erro && /mesma equipe/.test(erro) && await emCampo(db) === 17, erro);
  }
  {
    const db = await banco(tipo, `update public.frotas_portaria_saidas set data_retorno=null where id::text='${PARES[7].copia}';`);
    const erro = await aplicar(db);
    ok(T + 'cópia sem retorno: para sem alterar', erro && /sem retorno/.test(erro) && await emCampo(db) === 17, erro);
  }
  {
    const db = await banco(tipo, `delete from public.frotas_portaria_saidas where id::text='${PARES[8].viva}';`);
    const erro = await aplicar(db);
    ok(T + 'linha inexistente: para', erro && /33 de 34 linhas encontradas/.test(erro), erro);
    ok(T + 'linha inexistente: nada alterado', await audits(db) === 0 && await emCampo(db) === 16);
  }
  {
    const db = await banco(tipo, `update public.frotas_portaria_saidas set data_retorno=null where id::text='${RESTAURAR}';`);
    const erro = await aplicar(db);
    ok(T + 'RTQ7D65 sem retorno: para sem alterar', erro && /RTQ7D65\) sem retorno/.test(erro) && await emCampo(db) === 17, erro);
  }
}

if (failed.length) { console.error('FALHOU ' + failed.length + '/' + total + ':\n - ' + failed.join('\n - ')); process.exit(1); }
console.log('portaria-retornos-copias-excluidas-3009-sql: OK (' + total + ' verificações)');
