// PORTARIA 8.1.179 — teste SQL da migration 20260930170000_realtime_portaria_programacao.sql
// PostgreSQL embutido (PGlite). Teste auxiliar: não substitui a conferência no Supabase real.
// Uso: PGLITE_PATH=<pasta com node_modules/@electric-sql/pglite> node tests/portaria-realtime-programacao-sql.test.mjs
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
  console.log('portaria-realtime-programacao-sql: SKIP (instale @electric-sql/pglite e defina PGLITE_PATH)');
  process.exit(0);
}

const ARQ = '20260930170000_realtime_portaria_programacao';
const mig = fs.readFileSync(path.join(here, '..', 'supabase', 'migrations', ARQ + '.sql'), 'utf8');
const desfazer = mig.slice(mig.indexOf('-- Para desfazer')).split(/\r?\n/).slice(1)
  .map(l => l.replace(/^--\s?/, '')).join('\n').trim();

const failed = [];
let total = 0;
function ok(name, cond, detail) { total++; if (!cond) failed.push(name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }

async function banco({ publicacao = true, tabelas = ['prog_veiculos_dia', 'composicao_dia'], jaNaPub = [] } = {}) {
  const db = new PGlite();
  await db.exec(`create table public.outra (id int primary key);`);
  for (const t of tabelas) await db.exec(`create table public.${t} (id uuid primary key, data date, placa text); insert into public.${t} values ('11111111-1111-4111-8111-111111111111', '2026-09-30', 'RTQ7D55');`);
  if (publicacao) await db.exec(`create publication supabase_realtime;`);
  if (publicacao) await db.exec(`alter publication supabase_realtime add table public.outra;`);
  for (const t of jaNaPub) await db.exec(`alter publication supabase_realtime add table public.${t};`);
  return db;
}
const naPub = async db => (await db.query(`select tablename from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' order by 1`)).rows.map(r => r.tablename);
const linhas = async (db, t) => (await db.query(`select id::text, data::text, placa from public.${t}`)).rows;

let db = await banco();
await db.exec(mig);
ok('inclui as duas tabelas e mantém a que já estava', JSON.stringify(await naPub(db)) === JSON.stringify(['composicao_dia', 'outra', 'prog_veiculos_dia']), await naPub(db));
ok('dados intocados (prog_veiculos_dia)', JSON.stringify(await linhas(db, 'prog_veiculos_dia')) === JSON.stringify([{ id: '11111111-1111-4111-8111-111111111111', data: '2026-09-30', placa: 'RTQ7D55' }]));
ok('dados intocados (composicao_dia)', (await linhas(db, 'composicao_dia')).length === 1);
let erro = null;
try { await db.exec(mig); } catch (e) { erro = e.message; }
ok('rodar de novo não falha (idempotente)', erro === null, erro);
ok('rodar de novo não duplica', (await naPub(db)).length === 3, await naPub(db));
await db.exec(desfazer);
ok('desfazer tira só as duas', JSON.stringify(await naPub(db)) === JSON.stringify(['outra']), await naPub(db));

db = await banco({ jaNaPub: ['composicao_dia'] });
await db.exec(mig);
ok('uma já publicada: inclui só a outra', JSON.stringify(await naPub(db)) === JSON.stringify(['composicao_dia', 'outra', 'prog_veiculos_dia']), await naPub(db));

db = await banco({ publicacao: false });
erro = null;
try { await db.exec(mig); } catch (e) { erro = e.message; }
ok('sem publicação: PARAR', /PARAR: publicação supabase_realtime não existe/.test(erro || ''), erro);
await db.exec('rollback');
ok('sem publicação: não cria publicação', (await db.query(`select count(*)::int n from pg_publication`)).rows[0].n === 0);

db = await banco({ tabelas: ['composicao_dia'] });
erro = null;
try { await db.exec(mig); } catch (e) { erro = e.message; }
ok('tabela faltando: PARAR com o nome', /PARAR: tabela\(s\) inexistente\(s\): prog_veiculos_dia/.test(erro || ''), erro);
await db.exec('rollback');
ok('tabela faltando: nada publicado', JSON.stringify(await naPub(db)) === JSON.stringify(['outra']), await naPub(db));

if (failed.length) { console.log('portaria-realtime-programacao-sql: FALHOU ' + failed.length + '/' + total); failed.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
console.log('portaria-realtime-programacao-sql: OK ' + total + ' checagens');
