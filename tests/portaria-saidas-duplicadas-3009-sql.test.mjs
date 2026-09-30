// PORTARIA — testes SQL da migration 20260930180000_portaria_saidas_duplicadas_3009.sql
// PostgreSQL embutido (PGlite), esquema mínimo com ids em uuid e em text.
// Teste auxiliar: não substitui a conferência no Supabase real.
// Uso: PGLITE_PATH=<pasta com node_modules/@electric-sql/pglite> node tests/portaria-saidas-duplicadas-3009-sql.test.mjs
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
  console.log('portaria-saidas-duplicadas-3009-sql: SKIP (instale @electric-sql/pglite e defina PGLITE_PATH)');
  process.exit(0);
}

const ARQ = '20260930180000_portaria_saidas_duplicadas_3009';
const SESSAO = 'sql:' + ARQ;
const mig = fs.readFileSync(path.join(here, '..', 'supabase', 'migrations', ARQ + '.sql'), 'utf8');
const desfazer = mig.slice(mig.indexOf('-- Para desfazer')).split(/\r?\n/).slice(1)
  .map(l => l.replace(/^--\s?/, '')).join('\n').trim();
const LINHAS = [...mig.matchAll(/\((\d+), '([0-9a-f-]{36})', (true|false)\s*\)/g)].map(m => ({ g: +m[1], id: m[2], completa: m[3] === 'true' }));
const GRUPOS = [...new Set(LINHAS.map(l => l.g))];
const doGrupo = g => LINHAS.filter(l => l.g === g);
const completa = g => doGrupo(g).find(l => l.completa).id;
const copias = g => doGrupo(g).filter(l => !l.completa).map(l => l.id);
const G3 = GRUPOS.find(g => doGrupo(g).length === 3);
const OUTRA = '99999999-9999-4999-8999-999999999999';

const failed = [];
let total = 0;
function ok(name, cond, detail) { total++; if (!cond) failed.push(name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }

async function banco(tipo, extra) {
  const db = new PGlite();
  await db.exec(`
create table public.frotas_portaria_saidas (
  id ${tipo} primary key, placa text, modelo text, equipe_id ${tipo}, equipe text, status text, km_saida int, km_retorno int,
  data_saida timestamptz, data_retorno timestamptz, obs text, tipo_liberacao text, quem_saiu text, foto_carga_saida_b64 text,
  deleted_at timestamptz);
create table public.audit_log (
  id bigserial primary key, acao text, modulo text, descricao text, usuario_id text, usuario_nome text,
  usuario_perfil text, dados_extra jsonb, data_hora timestamptz, sessao_id text);`);
  const vals = [];
  for (const g of GRUPOS) {
    const eq = `'0000000${g % 10}-0000-4000-8000-${String(g).padStart(12, '0')}'`;
    const ts = `'2026-09-30T${String(7 + (g % 12)).padStart(2, '0')}:00:00-03:00'`;
    const placa = `'PLC${String(g).padStart(4, '0')}'`;
    for (const l of doGrupo(g)) {
      if (l.completa) vals.push(`('${l.id}',${placa},'VW/DELIVERY',${eq},'EQ${g}','Em campo',${1000 + g},null,${ts},null,null,'equipe','MOTORISTA ${g}','FOTO${g}',null)`);
      else vals.push(`('${l.id}',${placa},null,${eq},'EQ${g}','Em campo',${1000 + g},null,${ts},null,null,null,null,null,null)`);
    }
  }
  vals.push(`('${OUTRA}','OUT0001','FIORINO','00000000-0000-4000-8000-000000000999','EQX','Em campo',5,null,'2026-09-30T07:00:00-03:00',null,null,'equipe','X','F',null)`);
  await db.exec(`insert into public.frotas_portaria_saidas values ${vals.join(',')};`);
  if (extra) await db.exec(extra);
  return db;
}
const n = async (db, sql) => Number((await db.query(sql)).rows[0].n);
const ativas = db => n(db, `select count(*) n from public.frotas_portaria_saidas where deleted_at is null`);
const excluidas = db => n(db, `select count(*) n from public.frotas_portaria_saidas where deleted_at is not null`);
const audits = db => n(db, `select count(*) n from public.audit_log`);
const linha = async (db, id) => (await db.query(`select * from public.frotas_portaria_saidas where id::text='${id}'`)).rows[0];
async function aplicar(db) { try { await db.exec(mig); return null; } catch (e) { try { await db.exec('ROLLBACK'); } catch (_) {} return e.message; } }
const retorno = id => `update public.frotas_portaria_saidas set data_retorno='2026-09-30T18:00:00-03:00', status='Retornado', km_retorno=km_saida+50 where id::text='${id}';`;

ok('21 grupos, 43 linhas, 22 cópias, ids distintos', GRUPOS.length === 21 && LINHAS.length === 43 && LINHAS.filter(l => !l.completa).length === 22 && new Set(LINHAS.map(l => l.id)).size === 43);
ok('EBN143 na lista (fbbbddfa completa, 5da4ff78 cópia)', LINHAS.some(l => l.id.startsWith('fbbbddfa') && l.completa) && LINHAS.some(l => l.id.startsWith('5da4ff78') && !l.completa));
ok('um grupo com 3 linhas (EBN141)', G3 && doGrupo(G3).length === 3);

for (const tipo of ['uuid', 'text']) {
  const T = '[' + tipo + '] ';
  {
    // Situação atual: tudo aberto
    const db = await banco(tipo);
    ok(T + 'antes: 44 ativas', await ativas(db) === 44);
    const erro = await aplicar(db);
    ok(T + 'aplica sem erro', erro === null, erro);
    ok(T + '22 cópias excluídas (soft delete)', await excluidas(db) === 22);
    ok(T + 'ficam 21 completas + a saída fora da lista', await ativas(db) === 22);
    ok(T + 'nada apagado de verdade', await n(db, `select count(*) n from public.frotas_portaria_saidas`) === 44);
    ok(T + 'todas as completas ficaram', (await Promise.all(GRUPOS.map(g => linha(db, completa(g))))).every(r => r.deleted_at === null));
    ok(T + 'saída fora da lista intocada', (await linha(db, OUTRA)).deleted_at === null);
    const c0 = await linha(db, copias(GRUPOS[0])[0]);
    ok(T + 'nota na cópia aponta a mantida', /^\[Correção 30\/09\/2026: cópia duplicada/.test(c0.obs) && c0.obs.includes(completa(GRUPOS[0])), c0.obs);
    ok(T + 'status/KM da cópia não mudam', c0.status === 'Em campo' && c0.km_saida === 1000 + GRUPOS[0] && c0.data_retorno === null);
    const au = (await db.query(`select acao, dados_extra from public.audit_log where sessao_id='${SESSAO}'`)).rows;
    ok(T + 'auditoria com 22 cópias em 21 grupos', au.length === 1 && au[0].acao === 'PORTARIA_SAIDAS_DUPLICADAS_3009' && au[0].dados_extra.registros_afetados === 22 && au[0].dados_extra.grupos.length === 21, au[0] && au[0].dados_extra.registros_afetados);
    const erro2 = await aplicar(db);
    ok(T + 'reaplicar para (fail-closed)', erro2 && /nenhuma cópia pendente/.test(erro2), erro2);
    ok(T + 'reaplicar não duplica auditoria', await audits(db) === 1);
    await db.exec(desfazer);
    ok(T + 'desfazer restaura as 22 cópias', await ativas(db) === 44 && await excluidas(db) === 0);
    ok(T + 'desfazer restaura obs', (await linha(db, copias(GRUPOS[0])[0])).obs === null);
    ok(T + 'desfazer não mexe nas completas', (await linha(db, completa(GRUPOS[0]))).modelo === 'VW/DELIVERY');
  }
  {
    // Porteiro registrou o retorno na CÓPIA incompleta: ela fica, a completa aberta sai e empresta os campos
    const g = GRUPOS[0];
    const db = await banco(tipo, retorno(copias(g)[0]));
    const erro = await aplicar(db);
    ok(T + 'retorno na cópia: aplica', erro === null, erro);
    const mant = await linha(db, copias(g)[0]);
    const comp = await linha(db, completa(g));
    ok(T + 'retorno na cópia: ela fica com retorno', mant.deleted_at === null && mant.data_retorno !== null);
    ok(T + 'retorno na cópia: recebe modelo/tipo/quem_saiu/foto da completa', mant.modelo === 'VW/DELIVERY' && mant.tipo_liberacao === 'equipe' && mant.quem_saiu === 'MOTORISTA ' + g && mant.foto_carga_saida_b64 === 'FOTO' + g, mant);
    ok(T + 'retorno na cópia: completa aberta excluída com nota', comp.deleted_at !== null && comp.obs.includes(copias(g)[0]));
    ok(T + 'retorno na cópia: total 22 excluídas', await excluidas(db) === 22);
    await db.exec(desfazer);
    const d = await linha(db, copias(g)[0]);
    ok(T + 'desfazer: campos da cópia voltam vazios, retorno fica', d.modelo === null && d.tipo_liberacao === null && d.quem_saiu === null && d.foto_carga_saida_b64 === null && d.data_retorno !== null, d);
    ok(T + 'desfazer: completa restaurada', (await linha(db, completa(g))).deleted_at === null);
  }
  {
    // EBN141 (3 linhas): retorno numa das cópias → completa e a outra cópia saem
    const [c1, c2] = copias(G3);
    const db = await banco(tipo, retorno(c2));
    const erro = await aplicar(db);
    ok(T + 'trio com retorno numa cópia: aplica', erro === null, erro);
    ok(T + 'trio: fica só a cópia com retorno', (await linha(db, c2)).deleted_at === null && (await linha(db, c1)).deleted_at !== null && (await linha(db, completa(G3))).deleted_at !== null);
  }
  {
    // Retorno registrado na completa: caminho normal
    const g = GRUPOS[1];
    const db = await banco(tipo, retorno(completa(g)));
    await aplicar(db);
    ok(T + 'retorno na completa: completa fica, cópia sai', (await linha(db, completa(g))).deleted_at === null && (await linha(db, copias(g)[0])).deleted_at !== null);
  }
  {
    // Duas linhas com retorno no mesmo grupo: pula o grupo (precisa de conferência manual)
    const g = GRUPOS[2];
    const db = await banco(tipo, retorno(completa(g)) + retorno(copias(g)[0]));
    const erro = await aplicar(db);
    ok(T + 'dois retornos: aplica o resto', erro === null, erro);
    const au = ((await db.query(`select dados_extra from public.audit_log`)).rows[0] || {}).dados_extra || { pulados: [] };
    ok(T + 'dois retornos: grupo pulado e registrado', au.registros_afetados === 21 && au.pulados.length === 1 && au.pulados[0].motivo === 'mais de uma linha com retorno', au.pulados);
    ok(T + 'dois retornos: nenhuma das duas excluída', (await linha(db, completa(g))).deleted_at === null && (await linha(db, copias(g)[0])).deleted_at === null);
  }
  {
    // Cópia já excluída à mão: grupo pulado como já resolvido
    const g = GRUPOS[3];
    const db = await banco(tipo, `update public.frotas_portaria_saidas set deleted_at=now(), obs='manual' where id::text='${copias(g)[0]}';`);
    const erro = await aplicar(db);
    ok(T + 'já resolvido: aplica o resto', erro === null, erro);
    const au = ((await db.query(`select dados_extra from public.audit_log`)).rows[0] || {}).dados_extra || { pulados: [] };
    ok(T + 'já resolvido: pulado', au.registros_afetados === 21 && au.pulados.length === 1 && au.pulados[0].motivo === 'já resolvido', au.pulados);
    ok(T + 'já resolvido: obs manual preservada', (await linha(db, copias(g)[0])).obs === 'manual');
  }
  {
    // Completa excluída à mão e nenhuma com retorno: não escolhe outra sozinha
    const g = GRUPOS[4];
    const db = await banco(tipo, `update public.frotas_portaria_saidas set deleted_at=now() where id::text='${completa(g)}';`);
    const erro = await aplicar(db);
    ok(T + 'completa excluída: aplica o resto', erro === null, erro);
    const au = ((await db.query(`select dados_extra from public.audit_log`)).rows[0] || {}).dados_extra || { pulados: [] };
    ok(T + 'completa excluída: grupo pulado', au.pulados.length === 1 && au.pulados[0].motivo === 'linha completa já excluída' && (await linha(db, copias(g)[0])).deleted_at === null, au.pulados);
  }
  {
    const db = await banco(tipo, `update public.frotas_portaria_saidas set placa='XXX9999' where id::text='${copias(GRUPOS[5])[0]}';`);
    const erro = await aplicar(db);
    ok(T + 'placa diferente: para', erro && /não é da mesma equipe\/placa/.test(erro), erro);
    ok(T + 'placa diferente: nada alterado', await excluidas(db) === 0 && await audits(db) === 0);
  }
  {
    const db = await banco(tipo, `update public.frotas_portaria_saidas set km_saida=km_saida+1 where id::text='${copias(GRUPOS[6])[0]}';`);
    const erro = await aplicar(db);
    ok(T + 'KM diferente: para', erro && /KM/.test(erro), erro);
    ok(T + 'KM diferente: nada alterado', await excluidas(db) === 0 && await audits(db) === 0);
  }
  {
    const db = await banco(tipo, `delete from public.frotas_portaria_saidas where id::text='${copias(GRUPOS[7])[0]}';`);
    const erro = await aplicar(db);
    ok(T + 'linha inexistente: para', erro && /42 de 43 linhas encontradas/.test(erro), erro);
    ok(T + 'linha inexistente: nada alterado', await excluidas(db) === 0 && await audits(db) === 0);
  }
}

if (failed.length) { console.error('FALHOU ' + failed.length + '/' + total + ':\n - ' + failed.join('\n - ')); process.exit(1); }
console.log('portaria-saidas-duplicadas-3009-sql: OK (' + total + ' verificações)');
