// PROJETOS (SOT) — testes SQL da migration 20261001130000_sot_materiais_bloqueia_texto_binario.sql
// PostgreSQL embutido (PGlite), esquema mínimo com ids em uuid e em text.
// Teste auxiliar: não substitui a conferência no Supabase real.
// Uso: PGLITE_PATH=<pasta com node_modules/@electric-sql/pglite> node tests/sot-materiais-bloqueia-binario-sql.test.mjs
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
  console.log('sot-materiais-bloqueia-binario-sql: SKIP (instale @electric-sql/pglite e defina PGLITE_PATH)');
  process.exit(0);
}

const mig = fs.readFileSync(path.join(here, '..', 'supabase', 'migrations', '20261001130000_sot_materiais_bloqueia_texto_binario.sql'), 'utf8');
const desfazer = mig.slice(mig.indexOf('-- Para desfazer')).split(/\r?\n/).slice(1)
  .map(l => l.replace(/^--\s?/, '')).join('\n').trim();
const PID = '20002920-9d52-4b6d-878d-9870da3fb62a';

const failed = [];
let total = 0;
function ok(name, cond, detail) { total++; if (!cond) failed.push(name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }

async function banco(tipo) {
  const db = new PGlite();
  const novoId = tipo === 'uuid' ? 'gen_random_uuid()' : 'gen_random_uuid()::text';
  await db.exec(`
create role anon; create role authenticated;
create table public.sot_materiais (
  id ${tipo} primary key default ${novoId}, projeto_id ${tipo}, codigo_sap text, descricao text, unidade text,
  qtd_projetada numeric, qtd_requisitada numeric default 0, observacao text, criado_em timestamptz default now(), deleted_at timestamptz);
insert into public.sot_materiais (id, projeto_id, codigo_sap, descricao, unidade, qtd_projetada, deleted_at)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '${PID}', '!' || chr(65533) || '|', 'bin' || chr(1), 'UN', 1, '2026-10-01T12:00:00-03:00');`);
  return db;
}
async function tenta(db, sql, params) { try { await db.query(sql, params || []); return null; } catch (e) { return e; } }
const ins = (db, cod, desc, un, obs) => tenta(db,
  `insert into public.sot_materiais (projeto_id, codigo_sap, descricao, unidade, observacao, qtd_projetada) values ($1,$2,$3,$4,$5,1)`,
  [PID, cod, desc, un || 'UN', obs || null]);
const n = async (db, sql) => Number((await db.query(sql)).rows[0].n);

ok('trigger só em INSERT e UPDATE das colunas de texto', /BEFORE INSERT OR UPDATE OF codigo_sap, descricao, unidade, observacao ON public\.sot_materiais/.test(mig));
ok('sem DELETE/UPDATE de dados', !/\b(DELETE FROM|UPDATE public\.)/i.test(mig.slice(0, mig.indexOf('-- Validação'))));

for (const tipo of ['uuid', 'text']) {
  const T = '[' + tipo + '] ';
  const db = await banco(tipo);
  let erro = null;
  try { await db.exec(mig); } catch (e) { erro = e.message; }
  ok(T + 'aplica sem erro', erro === null, erro);
  try { await db.exec(mig); erro = null; } catch (e) { erro = e.message; }
  ok(T + 'reaplica sem erro', erro === null, erro);

  ok(T + 'material normal com acento, ² e tab grava', await ins(db, '4500001234', 'Cabo XLPE 95mm² — isolação\t1kV', 'm') === null);
  ok(T + 'material com observação e unidade normais grava', await ins(db, '6801234', 'Poste concreto 11m', 'UN', 'Entrega até 15h; cliente: ç ã õ') === null);
  const e1 = await ins(db, '!' + '\uFFFD' + '|', 'lixo', 'UN');
  ok(T + 'U+FFFD no código: recusa', e1 && /caracteres inválidos/.test(e1.message) && e1.code === '22021', e1 && e1.message);
  ok(T + 'controle na descrição: recusa', !!(await ins(db, '1', 'abc\u0001def', 'UN')));
  ok(T + 'C1 (U+0085) na unidade: recusa', !!(await ins(db, '1', 'abc', 'U\u0085')));
  ok(T + 'DEL na observação: recusa', !!(await ins(db, '1', 'abc', 'UN', 'x\u007Fy')));
  ok(T + 'só materiais válidos gravados', await n(db, `select count(*) n from public.sot_materiais where deleted_at is null`) === 2);

  const e2 = await tenta(db, `update public.sot_materiais set descricao = 'abc' || chr(65533) where codigo_sap = '6801234'`);
  ok(T + 'editar descrição para binário: recusa', e2 && /caracteres inválidos/.test(e2.message));
  ok(T + 'editar descrição normal: grava', await tenta(db, `update public.sot_materiais set descricao = 'Poste 12m' where codigo_sap = '6801234'`) === null);
  ok(T + 'linha binária antiga: restaurar/excluir (deleted_at) passa',
    await tenta(db, `update public.sot_materiais set deleted_at = null where id::text = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'`) === null
    && await tenta(db, `update public.sot_materiais set deleted_at = now() where id::text = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'`) === null);
  ok(T + 'linha binária antiga: lançar quantidade passa',
    await tenta(db, `update public.sot_materiais set qtd_requisitada = 0 where id::text = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'`) === null);

  await db.exec(desfazer);
  ok(T + 'desfazer: trigger removido', await n(db, `select count(*) n from pg_trigger where tgname = 'trg_sot_materiais_bloqueia_binario'`) === 0);
  ok(T + 'desfazer: grava de novo sem bloqueio', await ins(db, '1', 'abc\u0001', 'UN') === null);
}

if (failed.length) { console.error('FALHOU ' + failed.length + '/' + total + ':\n - ' + failed.join('\n - ')); process.exit(1); }
console.log('sot-materiais-bloqueia-binario-sql: OK (' + total + ' verificações)');
