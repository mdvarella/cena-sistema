// PROJETOS (SOT) — testes SQL da migration 20261001140000_sot_itens_somente_descritivo.sql
// PostgreSQL embutido (PGlite), esquema mínimo com as colunas reais usadas pela regra.
// Teste auxiliar: não substitui a conferência no Supabase real.
// Uso: PGLITE_PATH=<pasta com node_modules/@electric-sql/pglite> node tests/sot-itens-descritivo-sql.test.mjs
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
  console.log('sot-itens-descritivo-sql: SKIP (instale @electric-sql/pglite e defina PGLITE_PATH)');
  process.exit(0);
}

const mig = fs.readFileSync(path.join(here, '..', 'supabase', 'migrations', '20261001140000_sot_itens_somente_descritivo.sql'), 'utf8');
const desfazer = mig.slice(mig.indexOf('-- Para desfazer')).split(/\r?\n/).slice(1)
  .map(l => l.replace(/^--\s?/, '')).join('\n').trim();
const PID = '20002920-9d52-4b6d-878d-9870da3fb62a';

const failed = [];
let total = 0;
function ok(name, cond, detail) { total++; if (!cond) failed.push(name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }
async function tenta(db, sql, params) { try { await db.query(sql, params || []); return null; } catch (e) { return e; } }
const n = async (db, sql) => Number((await db.query(sql)).rows[0].n);

ok('sem DELETE/UPDATE de dados', !/\b(DELETE FROM|UPDATE public\.)/i.test(mig.slice(0, mig.indexOf('-- Validação'))));

const db = new PGlite();
await db.exec(`
create table public.sot_atividades (
  id uuid primary key default gen_random_uuid(), projeto_id uuid, codigo text, descricao text, unidade text,
  qtd_prevista numeric, valor_unitario numeric, valor_total numeric, qtd_executada numeric default 0, qtd_medida numeric default 0,
  qtd_faturada numeric default 0, ordem_exec int, etapa text, status text, observacoes text, servico_id uuid,
  criado_em timestamptz default now(), qtd_viabilizada numeric default 0, deleted_at timestamptz);
create table public.sot_materiais (
  id uuid primary key default gen_random_uuid(), projeto_id uuid, codigo_sap text, descricao text, unidade text,
  qtd_projetada numeric, qtd_viabilizada numeric default 0, qtd_requisitada numeric default 0, qtd_entregue numeric default 0,
  qtd_aplicada numeric default 0, qtd_devolvida numeric default 0, qtd_processada_sap numeric default 0, observacao text,
  criado_em timestamptz default now(), deleted_at timestamptz);
insert into public.sot_atividades (projeto_id, codigo, descricao, qtd_prevista, valor_unitario, qtd_executada, servico_id)
  values ('${PID}', 'I-0325508', 'MO antiga', 2, 100, 1, gen_random_uuid());
insert into public.sot_materiais (projeto_id, codigo_sap, descricao, qtd_projetada, qtd_aplicada)
  values ('${PID}', '949740', 'Material antigo', 2, 1);`);

let erro = null;
try { await db.exec(mig); } catch (e) { erro = e.message; }
ok('aplica sem erro', erro === null, erro);
try { await db.exec(mig); erro = null; } catch (e) { erro = e.message; }
ok('reaplica sem erro', erro === null, erro);
ok('linhas antigas ficam operacionais (false)', await n(db, `select count(*) n from public.sot_atividades where somente_descritivo`) === 0
  && await n(db, `select count(*) n from public.sot_materiais where somente_descritivo`) === 0);
ok('linhas antigas continuam aceitando lançamento', await tenta(db, `update public.sot_atividades set qtd_executada = 2`) === null
  && await tenta(db, `update public.sot_materiais set qtd_entregue = 2`) === null);

const insAt = (extra) => tenta(db, `insert into public.sot_atividades (projeto_id, codigo, descricao, qtd_prevista, somente_descritivo${extra ? ', ' + extra[0] : ''})
  values ($1, 'R-AHO816', 'MO outra empresa', 3, true${extra ? ', ' + extra[1] : ''})`, [PID]);
ok('serviço descritivo com quantidade prevista grava', await insAt() === null);
for (const [col, v] of [['qtd_executada', '1'], ['qtd_medida', '1'], ['qtd_faturada', '1'], ['qtd_viabilizada', '1'], ['valor_unitario', '10'], ['valor_total', '10'], ['servico_id', 'gen_random_uuid()']]) {
  const e = await insAt([col, v]);
  ok('serviço descritivo com ' + col + ': recusa (23514)', e && e.code === '23514' && /sot_atividades_descritivo_sem_operacao/.test(e.message), e && e.message);
}
const eExec = await tenta(db, `update public.sot_atividades set qtd_executada = 1 where somente_descritivo`);
ok('lançar execução em serviço descritivo: recusa', eExec && eExec.code === '23514');
ok('somar quantidade prevista do descritivo: grava', await tenta(db, `update public.sot_atividades set qtd_prevista = qtd_prevista + 1 where somente_descritivo`) === null);

const insMat = (extra) => tenta(db, `insert into public.sot_materiais (projeto_id, codigo_sap, descricao, qtd_projetada, somente_descritivo${extra ? ', ' + extra[0] : ''})
  values ($1, '337326', 'Material outra empresa', 6, true${extra ? ', ' + extra[1] : ''})`, [PID]);
ok('material descritivo com quantidade projetada grava', await insMat() === null);
for (const col of ['qtd_viabilizada', 'qtd_requisitada', 'qtd_entregue', 'qtd_aplicada', 'qtd_devolvida', 'qtd_processada_sap']) {
  const e = await insMat([col, '1']);
  ok('material descritivo com ' + col + ': recusa (23514)', e && e.code === '23514' && /sot_materiais_descritivo_sem_operacao/.test(e.message), e && e.message);
}
const eEnt = await tenta(db, `update public.sot_materiais set qtd_entregue = 5 where somente_descritivo`);
ok('lançar entrega em material descritivo: recusa', eEnt && eEnt.code === '23514');
ok('excluir material descritivo (deleted_at): grava', await tenta(db, `update public.sot_materiais set deleted_at = now() where somente_descritivo`) === null);
const eVira = await tenta(db, `update public.sot_atividades set somente_descritivo = true where codigo = 'I-0325508'`);
ok('marcar como descritivo item já executado: recusa', eVira && eVira.code === '23514');

await db.exec(desfazer);
ok('desfazer: colunas removidas', await n(db, `select count(*) n from information_schema.columns where column_name = 'somente_descritivo'`) === 0);
ok('desfazer: constraints removidas', await n(db, `select count(*) n from pg_constraint where conname like '%descritivo_sem_operacao'`) === 0);

if (failed.length) { console.error('FALHOU ' + failed.length + '/' + total + ':\n - ' + failed.join('\n - ')); process.exit(1); }
console.log('sot-itens-descritivo-sql: OK (' + total + ' verificações)');
