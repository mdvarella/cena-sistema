// PORTARIA — testes SQL da migration 20261003204500_portaria_saidas_duplicadas_0210.sql
// PostgreSQL embutido (PGlite), esquema mínimo com ids em uuid e em text.
// Teste auxiliar: não substitui a conferência no Supabase real.
// Uso: PGLITE_PATH=<pasta com node_modules/@electric-sql/pglite> node tests/portaria-saidas-duplicadas-0210-sql.test.mjs
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
  console.log('portaria-saidas-duplicadas-0210-sql: SKIP (instale @electric-sql/pglite e defina PGLITE_PATH)');
  process.exit(0);
}

const ARQ = '20261003204500_portaria_saidas_duplicadas_0210';
const SESSAO = 'sql:' + ARQ;
const mig = fs.readFileSync(path.join(here, '..', 'supabase', 'migrations', ARQ + '.sql'), 'utf8');
const desfazer = mig.slice(mig.indexOf('-- Para desfazer')).split(/\r?\n/).slice(1)
  .map(l => l.replace(/^--\s?/, '')).join('\n').trim();
const LINHAS = [...mig.matchAll(/\((\d+), '([0-9a-f-]{36})', (true|false)\s*\)/g)].map(m => ({ g: +m[1], id: m[2], completa: m[3] === 'true' }));
const GRUPOS = [...new Set(LINHAS.map(l => l.g))];
const completa = g => LINHAS.find(l => l.g === g && l.completa).id;
const copia = g => LINHAS.find(l => l.g === g && !l.completa).id;
const FTM = { completa: '3aba7825-87ef-4284-8eea-ea80e7f5b269', copia: '27a3ffcb-e7db-4583-a8ef-930b0fbcc5a6' };
const COM_RETORNO = [2, 3, 4, 5, 6];

const failed = [];
let total = 0;
function ok(name, cond, detail) { total++; if (!cond) failed.push(name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }

async function banco(tipo, extra, retornos) {
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
    const ts = `'2026-10-02T0${7 + (g > 2 ? 1 : 0)}:${10 + g}:00-03:00'`;
    vals.push(`('${completa(g)}','PLC${g}','VW/DELIVERY',${eq},'EQ${g}','Em campo',${100 + g},null,${ts},null,null,'equipe','MOT ${g}','FOTO${g}',null)`);
    vals.push(`('${copia(g)}','PLC${g}',null,${eq},'EQ${g}','Em campo',${100 + g},null,${ts},null,null,null,null,null,null)`);
  }
  await db.exec(`insert into public.frotas_portaria_saidas values ${vals.join(',')};`);
  if (retornos !== false) await db.exec(COM_RETORNO.map(g => `update public.frotas_portaria_saidas set data_retorno='2026-10-02T16:${30 + g}:00-03:00', status='Retornado', km_retorno=${200 + g} where id::text='${copia(g)}';`).join('\n'));
  if (extra) await db.exec(extra);
  return db;
}
const n = async (db, sql) => Number((await db.query(sql)).rows[0].n);
const linha = async (db, id) => (await db.query(`select * from public.frotas_portaria_saidas where id::text='${id}'`)).rows[0];
async function aplicar(db) { try { await db.exec(mig); return null; } catch (e) { try { await db.exec('ROLLBACK'); } catch (_) {} return e.message; } }

ok('6 pares, 12 linhas, FTM9D41 na lista', GRUPOS.length === 6 && LINHAS.length === 12 && LINHAS.some(l => l.id === FTM.completa && l.completa) && LINHAS.some(l => l.id === FTM.copia && !l.completa));
ok('ids sem repetição', new Set(LINHAS.map(l => l.id)).size === 12);
ok('esperados ajustados para 6/12', /v_esperado_grupos int := 6;/.test(mig) && /v_esperado_linhas int := 12;/.test(mig));
ok('sessão e ação próprias', mig.includes("'" + SESSAO + "'") && mig.includes("'PORTARIA_SAIDAS_DUPLICADAS_0210'") && !mig.includes('sql:20260930190000') && !mig.includes('_port_dup_2909'));

for (const tipo of ['uuid', 'text']) {
  const T = '[' + tipo + '] ';
  {
    const db = await banco(tipo);
    const erro = await aplicar(db);
    ok(T + 'aplica sem erro', erro === null, erro);
    for (const g of COM_RETORNO) {
      const c = await linha(db, copia(g)), o = await linha(db, completa(g));
      ok(T + 'grupo ' + g + ': linha com retorno fica e recebe modelo/tipo/quem_saiu/foto', c.deleted_at === null && c.status === 'Retornado' && c.data_retorno !== null
        && c.modelo === 'VW/DELIVERY' && c.tipo_liberacao === 'equipe' && c.quem_saiu === 'MOT ' + g && c.foto_carga_saida_b64 === 'FOTO' + g, c);
      ok(T + 'grupo ' + g + ': completa aberta excluída com nota da linha mantida', o.deleted_at !== null && o.obs.includes('[Correção 03/10/2026') && o.obs.includes(copia(g)), o.obs);
    }
    ok(T + 'FTM9D41: cópia excluída, completa continua aberta', (await linha(db, FTM.copia)).deleted_at !== null
      && (await linha(db, FTM.completa)).deleted_at === null && (await linha(db, FTM.completa)).status === 'Em campo');
    ok(T + 'nada apagado de verdade', await n(db, 'select count(*) n from public.frotas_portaria_saidas') === 12);
    ok(T + 'fica 1 linha viva por par', await n(db, 'select count(*) n from public.frotas_portaria_saidas where deleted_at is null') === 6);
    const au = (await db.query(`select acao, dados_extra from public.audit_log where sessao_id='${SESSAO}'`)).rows;
    ok(T + 'auditoria com 6 cópias e estado para desfazer', au.length === 1 && au[0].acao === 'PORTARIA_SAIDAS_DUPLICADAS_0210' && au[0].dados_extra.registros_afetados === 6
      && au[0].dados_extra.grupos.length === 6, au[0] && au[0].dados_extra);
    const erro2 = await aplicar(db);
    ok(T + 'reaplicar para', erro2 && /nenhuma cópia pendente/.test(erro2), erro2);
    await db.exec(desfazer);
    ok(T + 'desfazer restaura as cópias', await n(db, 'select count(*) n from public.frotas_portaria_saidas where deleted_at is null') === 12);
    ok(T + 'desfazer devolve os campos da linha mantida', (await linha(db, copia(2))).modelo === null && (await linha(db, copia(2))).tipo_liberacao === null
      && (await linha(db, completa(2))).obs === null);
  }
  {
    // SQL Editor rodando só o bloco DO (sem BEGIN/COMMIT nem conexão compartilhada)
    const db = await banco(tipo);
    const soDo = mig.slice(mig.indexOf('DO $$'), mig.indexOf('END $$;') + 'END $$;'.length);
    let erro = null;
    try { await db.exec(soDo); } catch (e) { erro = e.message; }
    ok(T + 'só o bloco DO: aplica sem erro', erro === null, erro);
    ok(T + 'só o bloco DO: 6 linhas excluídas', await n(db, 'select count(*) n from public.frotas_portaria_saidas where deleted_at is not null') === 6);
    let erro2 = null;
    try { await db.exec(soDo); } catch (e) { erro2 = e.message; }
    ok(T + 'só o bloco DO duas vezes na mesma sessão: segunda para', erro2 && /nenhuma cópia pendente/.test(erro2), erro2);
  }
  {
    // Porteiro fechou a FTM9D41 na linha completa antes da migration: ela fica, a cópia sai
    const db = await banco(tipo, `update public.frotas_portaria_saidas set data_retorno='2026-10-03T07:00:00-03:00', status='Retornado' where id::text='${FTM.completa}';`);
    const erro = await aplicar(db);
    ok(T + 'FTM9D41 fechada antes: aplica', erro === null, erro);
    ok(T + 'FTM9D41 fechada antes: completa fica, cópia sai', (await linha(db, FTM.completa)).deleted_at === null && (await linha(db, FTM.copia)).deleted_at !== null);
  }
  {
    // As duas linhas de um par com retorno: grupo pulado, nada dele muda
    const db = await banco(tipo, `update public.frotas_portaria_saidas set data_retorno='2026-10-02T18:00:00-03:00', status='Retornado' where id::text='${completa(4)}';`);
    const erro = await aplicar(db);
    const au = ((await db.query(`select dados_extra from public.audit_log where sessao_id='${SESSAO}'`)).rows[0] || {}).dados_extra || { pulados: [] };
    ok(T + 'duas linhas com retorno: aplica nos outros e pula o grupo', erro === null && (await linha(db, completa(4))).deleted_at === null && (await linha(db, copia(4))).deleted_at === null
      && au.pulados.some(p => p.grupo === 4 && /mais de uma linha com retorno/.test(p.motivo)) && au.registros_afetados === 5, { erro, au });
  }
  {
    // Linha da lista sumiu do banco: para tudo
    const db = await banco(tipo, `delete from public.frotas_portaria_saidas where id::text='${copia(6)}';`);
    const erro = await aplicar(db);
    ok(T + 'linha ausente: para sem alterar', erro && /11 de 12 linhas/.test(erro) && await n(db, 'select count(*) n from public.frotas_portaria_saidas where deleted_at is not null') === 0, erro);
  }
  {
    const db = await banco(tipo, `update public.frotas_portaria_saidas set km_saida=999 where id::text='${copia(GRUPOS[0])}';`);
    const erro = await aplicar(db);
    ok(T + 'KM diferente: para sem alterar', erro && /KM/.test(erro) && await n(db, 'select count(*) n from public.frotas_portaria_saidas where deleted_at is not null') === 0, erro);
  }
}

if (failed.length) { console.error('FALHOU ' + failed.length + '/' + total + ':\n - ' + failed.join('\n - ')); process.exit(1); }
console.log('portaria-saidas-duplicadas-0210-sql: OK (' + total + ' verificações)');
