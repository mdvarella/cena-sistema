// PORTARIA — testes SQL da migration 20260930190000_portaria_saidas_duplicadas_abertas_2909.sql
// PostgreSQL embutido (PGlite), esquema mínimo com ids em uuid e em text.
// Teste auxiliar: não substitui a conferência no Supabase real.
// Uso: PGLITE_PATH=<pasta com node_modules/@electric-sql/pglite> node tests/portaria-saidas-duplicadas-2909-sql.test.mjs
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
  console.log('portaria-saidas-duplicadas-2909-sql: SKIP (instale @electric-sql/pglite e defina PGLITE_PATH)');
  process.exit(0);
}

const ARQ = '20260930190000_portaria_saidas_duplicadas_abertas_2909';
const SESSAO = 'sql:' + ARQ;
const mig = fs.readFileSync(path.join(here, '..', 'supabase', 'migrations', ARQ + '.sql'), 'utf8');
const desfazer = mig.slice(mig.indexOf('-- Para desfazer')).split(/\r?\n/).slice(1)
  .map(l => l.replace(/^--\s?/, '')).join('\n').trim();
const LINHAS = [...mig.matchAll(/\((\d+), '([0-9a-f-]{36})', (true|false)\s*\)/g)].map(m => ({ g: +m[1], id: m[2], completa: m[3] === 'true' }));
const GRUPOS = [...new Set(LINHAS.map(l => l.g))];
const completa = g => LINHAS.find(l => l.g === g && l.completa).id;
const copia = g => LINHAS.find(l => l.g === g && !l.completa).id;
const EJN173 = { completa: '5fce3b43-7942-41a1-aa0b-b1f435012a9d', copia: '3d82895a-e63b-4ca4-b66c-7082cf4bd42a' };

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
    const eq = `'0000000${g}-0000-4000-8000-00000000000${g}'`;
    const ts = `'2026-09-29T0${6 + g}:00:00-03:00'`;
    vals.push(`('${completa(g)}','PLC${g}','VW/DELIVERY',${eq},'EQ${g}','Em campo',${100 + g},null,${ts},null,null,'equipe','MOT ${g}','FOTO${g}',null)`);
    vals.push(`('${copia(g)}','PLC${g}',null,${eq},'EQ${g}','Em campo',${100 + g},null,${ts},null,null,null,null,null,null)`);
  }
  await db.exec(`insert into public.frotas_portaria_saidas values ${vals.join(',')};`);
  if (extra) await db.exec(extra);
  return db;
}
const n = async (db, sql) => Number((await db.query(sql)).rows[0].n);
const linha = async (db, id) => (await db.query(`select * from public.frotas_portaria_saidas where id::text='${id}'`)).rows[0];
async function aplicar(db) { try { await db.exec(mig); return null; } catch (e) { try { await db.exec('ROLLBACK'); } catch (_) {} return e.message; } }

ok('3 pares, 6 linhas, EJN173 na lista', GRUPOS.length === 3 && LINHAS.length === 6 && LINHAS.some(l => l.id === EJN173.completa && l.completa) && LINHAS.some(l => l.id === EJN173.copia && !l.completa));
ok('esperados ajustados para 3/6', /v_esperado_grupos int := 3;/.test(mig) && /v_esperado_linhas int := 6;/.test(mig));
ok('sessão e ação próprias', mig.includes("'" + SESSAO + "'") && mig.includes("'PORTARIA_SAIDAS_DUPLICADAS_2909_ABERTAS'") && !mig.includes('sql:20260930180000'));

for (const tipo of ['uuid', 'text']) {
  const T = '[' + tipo + '] ';
  {
    const db = await banco(tipo);
    const erro = await aplicar(db);
    ok(T + 'aplica sem erro', erro === null, erro);
    ok(T + 'as 3 cópias excluídas', (await Promise.all(GRUPOS.map(g => linha(db, copia(g))))).every(r => r.deleted_at !== null));
    ok(T + 'as 3 originais continuam abertas (retorno fica para o porteiro)', (await Promise.all(GRUPOS.map(g => linha(db, completa(g))))).every(r => r.deleted_at === null && r.data_retorno === null && r.status === 'Em campo'));
    ok(T + 'nada apagado de verdade', await n(db, 'select count(*) n from public.frotas_portaria_saidas') === 6);
    const au = (await db.query(`select acao, dados_extra from public.audit_log where sessao_id='${SESSAO}'`)).rows;
    ok(T + 'auditoria com 3 cópias', au.length === 1 && au[0].dados_extra.registros_afetados === 3, au[0] && au[0].dados_extra);
    const erro2 = await aplicar(db);
    ok(T + 'reaplicar para', erro2 && /nenhuma cópia pendente/.test(erro2), erro2);
    await db.exec(desfazer);
    ok(T + 'desfazer restaura as cópias', await n(db, 'select count(*) n from public.frotas_portaria_saidas where deleted_at is null') === 6);
  }
  {
    // SQL Editor rodando só o bloco DO (sem BEGIN/COMMIT nem conexão compartilhada)
    const db = await banco(tipo);
    const soDo = mig.slice(mig.indexOf('DO $$'), mig.indexOf('END $$;') + 'END $$;'.length);
    let erro = null;
    try { await db.exec(soDo); } catch (e) { erro = e.message; }
    ok(T + 'só o bloco DO: aplica sem erro', erro === null, erro);
    ok(T + 'só o bloco DO: 3 cópias excluídas', await n(db, 'select count(*) n from public.frotas_portaria_saidas where deleted_at is not null') === 3);
    let erro2 = null;
    try { await db.exec(soDo); } catch (e) { erro2 = e.message; }
    ok(T + 'só o bloco DO duas vezes na mesma sessão: segunda para', erro2 && /nenhuma cópia pendente/.test(erro2), erro2);
  }
  {
    // Porteiro fechou a cópia antes da migration: ela fica e recebe os campos da original, que sai
    const g = GRUPOS[2];
    const db = await banco(tipo, `update public.frotas_portaria_saidas set data_retorno='2026-09-30T15:00:00-03:00', status='Retornado' where id::text='${copia(g)}';`);
    const erro = await aplicar(db);
    ok(T + 'retorno na cópia: aplica', erro === null, erro);
    const c = await linha(db, copia(g));
    ok(T + 'retorno na cópia: fica e recebe modelo/tipo/quem_saiu/foto', c.deleted_at === null && c.modelo === 'VW/DELIVERY' && c.tipo_liberacao === 'equipe' && c.quem_saiu === 'MOT ' + g && c.foto_carga_saida_b64 === 'FOTO' + g, c);
    ok(T + 'retorno na cópia: original aberta excluída', (await linha(db, completa(g))).deleted_at !== null);
  }
  {
    const db = await banco(tipo, `update public.frotas_portaria_saidas set km_saida=999 where id::text='${copia(GRUPOS[0])}';`);
    const erro = await aplicar(db);
    ok(T + 'KM diferente: para sem alterar', erro && /KM/.test(erro) && await n(db, 'select count(*) n from public.frotas_portaria_saidas where deleted_at is not null') === 0, erro);
  }
}

if (failed.length) { console.error('FALHOU ' + failed.length + '/' + total + ':\n - ' + failed.join('\n - ')); process.exit(1); }
console.log('portaria-saidas-duplicadas-2909-sql: OK (' + total + ' verificações)');
