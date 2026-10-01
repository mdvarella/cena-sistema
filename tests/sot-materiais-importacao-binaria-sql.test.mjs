// PROJETOS (SOT) — testes SQL da migration 20261001120000_sot_materiais_importacao_binaria_20002920.sql
// PostgreSQL embutido (PGlite), esquema mínimo com ids em uuid e em text.
// Teste auxiliar: não substitui a conferência no Supabase real.
// Uso: PGLITE_PATH=<pasta com node_modules/@electric-sql/pglite> node tests/sot-materiais-importacao-binaria-sql.test.mjs
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
  console.log('sot-materiais-importacao-binaria-sql: SKIP (instale @electric-sql/pglite e defina PGLITE_PATH)');
  process.exit(0);
}

const ARQ = '20261001120000_sot_materiais_importacao_binaria_20002920';
const SESSAO = 'sql:' + ARQ;
const mig = fs.readFileSync(path.join(here, '..', 'supabase', 'migrations', ARQ + '.sql'), 'utf8');
const desfazer = mig.slice(mig.indexOf('-- Para desfazer')).split(/\r?\n/).slice(1)
  .map(l => l.replace(/^--\s?/, '')).join('\n').trim();
const PID = '20002920-9d52-4b6d-878d-9870da3fb62a';
const OUTRO = '11111111-1111-4111-8111-111111111111';

const failed = [];
let total = 0;
function ok(name, cond, detail) { total++; if (!cond) failed.push(name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }

async function banco(tipo, extra) {
  const db = new PGlite();
  const novoId = tipo === 'uuid' ? 'gen_random_uuid()' : 'gen_random_uuid()::text';
  await db.exec(`
create table public.sot_projetos (id ${tipo} primary key, codigo_cliente text, nome text, deleted_at timestamptz);
create table public.sot_materiais (
  id ${tipo} primary key default ${novoId}, projeto_id ${tipo}, codigo_sap text, descricao text, unidade text,
  qtd_projetada numeric, qtd_viabilizada numeric, qtd_requisitada numeric, qtd_entregue numeric, qtd_aplicada numeric,
  qtd_devolvida numeric, qtd_processada_sap numeric, observacao text, criado_em timestamptz default now(), deleted_at timestamptz);
create table public.audit_log (
  id bigserial primary key, acao text, modulo text, descricao text, usuario_id text, usuario_nome text,
  usuario_perfil text, dados_extra jsonb, data_hora timestamptz, sessao_id text);
insert into public.sot_projetos values ('${PID}', 'DAC/S.NOR-25.00228', 'AC - Alteração de Carga', null),
  ('${OUTRO}', 'OUTRO-1', 'Outro projeto', null);
-- importação binária: 1245 linhas entre 07:36:02 e 07:36:11
insert into public.sot_materiais (projeto_id, codigo_sap, descricao, unidade, qtd_projetada, qtd_viabilizada, qtd_requisitada,
  qtd_entregue, qtd_aplicada, qtd_devolvida, qtd_processada_sap, criado_em)
select '${PID}', 'lixo' || g, 'bin' || g, 'UN', 1, 0, 0, 0, 0, 0, 0,
       '2026-10-01T07:36:02.5-03:00'::timestamptz + (g * interval '7 milliseconds')
  from generate_series(1, 1245) g;
-- materiais legítimos fora da janela (mesmo projeto) e de outro projeto na mesma janela
insert into public.sot_materiais (projeto_id, codigo_sap, descricao, unidade, qtd_projetada, qtd_viabilizada, qtd_requisitada,
  qtd_entregue, qtd_aplicada, qtd_devolvida, qtd_processada_sap, criado_em) values
  ('${PID}', '6801234', 'CABO BOM', 'M', 10, 0, 0, 0, 0, 0, 0, '2026-10-01T07:36:01-03:00'),
  ('${PID}', '6801235', 'CONECTOR BOM', 'UN', 4, 0, 2, 0, 0, 0, 0, '2026-10-01T09:00:00-03:00'),
  ('${OUTRO}', '6809999', 'OUTRO PROJETO', 'UN', 3, 0, 0, 0, 0, 0, 0, '2026-10-01T07:36:05-03:00');`);
  if (extra) await db.exec(extra);
  return db;
}
const n = async (db, sql) => Number((await db.query(sql)).rows[0].n);
const vivosLixo = db => n(db, `select count(*) n from public.sot_materiais where projeto_id::text='${PID}' and codigo_sap like 'lixo%' and deleted_at is null`);
const vivosBons = db => n(db, `select count(*) n from public.sot_materiais where codigo_sap not like 'lixo%' and deleted_at is null`);
const audits = db => n(db, `select count(*) n from public.audit_log`);
const auditoria = async db => ((await db.query(`select * from public.audit_log where sessao_id='${SESSAO}'`)).rows[0] || {});
async function aplicar(db) { try { await db.exec(mig); return null; } catch (e) { try { await db.exec('ROLLBACK'); } catch (_) {} return e.message; } }

ok('migration usa o projeto e o código certos', mig.includes(`'${PID}'`) && mig.includes("'DAC/S.NOR-25.00228'"));
ok('janela 07:36:02 → 07:36:12 e 1245 esperados', /v_ini timestamptz := '2026-10-01T07:36:02-03:00'/.test(mig)
  && /v_fim timestamptz := '2026-10-01T07:36:12-03:00'/.test(mig) && /v_esperado int := 1245;/.test(mig));
ok('não apaga linhas de verdade (só deleted_at)', !/\bDELETE\s+FROM\b/i.test(mig.slice(0, mig.indexOf('-- Validação'))));
ok('não toca em sot_atividades nem no projeto', !/UPDATE public\.(sot_atividades|sot_projetos)/.test(mig));

for (const tipo of ['uuid', 'text']) {
  const T = '[' + tipo + '] ';
  {
    const db = await banco(tipo);
    ok(T + 'antes: 1245 da importação + 3 legítimos', await vivosLixo(db) === 1245 && await vivosBons(db) === 3);
    const erro = await aplicar(db);
    ok(T + 'aplica sem erro', erro === null, erro);
    ok(T + 'importação inteira excluída', await vivosLixo(db) === 0);
    ok(T + 'legítimos intactos (fora da janela e outro projeto)', await vivosBons(db) === 3);
    ok(T + 'exclusão suave: linhas continuam no banco', await n(db, `select count(*) n from public.sot_materiais`) === 1248);
    const au = await auditoria(db);
    ok(T + 'auditoria com os 1245 ids', au.acao === 'SOT_MATERIAIS_IMPORTACAO_BINARIA_20002920' && au.dados_extra.ids.length === 1245
      && au.dados_extra.registros_afetados === 1245 && au.dados_extra.ja_excluidos === 0, au.dados_extra && au.dados_extra.registros_afetados);
    ok(T + 'auditoria: 2 materiais do projeto continuam', au.dados_extra.materiais_vivos_restantes === 2);
    const erro2 = await aplicar(db);
    ok(T + 'reaplicar para (nada pendente)', erro2 && /nada pendente/.test(erro2), erro2);
    ok(T + 'reaplicar não duplica auditoria', await audits(db) === 1);
    await db.exec(desfazer);
    ok(T + 'desfazer: 1245 voltam', await vivosLixo(db) === 1245 && await vivosBons(db) === 3);
  }
  {
    const db = await banco(tipo);
    const soDo = mig.slice(mig.indexOf('DO $$'), mig.indexOf('END $$;') + 'END $$;'.length);
    let erro = null;
    try { await db.exec(soDo); } catch (e) { erro = e.message; }
    ok(T + 'só o bloco DO: aplica sem erro', erro === null && await vivosLixo(db) === 0, erro);
  }
  {
    // usuário já excluiu alguns pela tela: o resto é excluído e o desfazer não ressuscita os dele
    const db = await banco(tipo, `update public.sot_materiais set deleted_at='2026-10-01T09:10:00-03:00' where codigo_sap in ('lixo1','lixo2','lixo3');`);
    const erro = await aplicar(db);
    const au = await auditoria(db);
    ok(T + 'parcialmente excluída: exclui o resto', erro === null && await vivosLixo(db) === 0 && au.dados_extra.registros_afetados === 1242
      && au.dados_extra.ja_excluidos === 3, erro || au.dados_extra);
    await db.exec(desfazer);
    ok(T + 'parcialmente excluída: desfazer devolve só os 1242', await vivosLixo(db) === 1242);
  }
  {
    const db = await banco(tipo, `update public.sot_materiais set qtd_requisitada=1 where codigo_sap='lixo500';`);
    const erro = await aplicar(db);
    ok(T + 'material com quantidade movimentada: para', erro && /quantidade movimentada/.test(erro), erro);
    ok(T + 'material com quantidade movimentada: nada alterado', await vivosLixo(db) === 1245 && await audits(db) === 0);
  }
  {
    const db = await banco(tipo, `update public.sot_materiais set qtd_viabilizada=2 where codigo_sap='lixo7';`);
    const erro = await aplicar(db);
    ok(T + 'material viabilizado: para', erro && /quantidade movimentada/.test(erro) && await vivosLixo(db) === 1245, erro);
  }
  {
    const db = await banco(tipo, `insert into public.sot_materiais (projeto_id, codigo_sap, descricao, unidade, qtd_projetada, criado_em)
      values ('${PID}', '6800001', 'MANUAL', 'UN', 1, '2026-10-01T07:36:11.9-03:00');`);
    const erro = await aplicar(db);
    ok(T + 'linha a mais na janela: para', erro && /1246 materiais/.test(erro), erro);
    ok(T + 'linha a mais na janela: nada alterado', await vivosLixo(db) === 1245 && await audits(db) === 0);
  }
  {
    const db = await banco(tipo, `delete from public.sot_materiais where codigo_sap='lixo10';`);
    const erro = await aplicar(db);
    ok(T + 'linha a menos na janela: para', erro && /1244 materiais/.test(erro) && await vivosLixo(db) === 1244, erro);
  }
  {
    const db = await banco(tipo, `update public.sot_projetos set deleted_at=now() where id::text='${PID}';`);
    const erro = await aplicar(db);
    ok(T + 'projeto excluído: para', erro && /está excluído/.test(erro) && await vivosLixo(db) === 1245, erro);
  }
  {
    const db = await banco(tipo, `update public.sot_projetos set codigo_cliente='OUTRO' where id::text='${PID}';`);
    const erro = await aplicar(db);
    ok(T + 'código do projeto diferente: para', erro && /esperado DAC\/S\.NOR-25\.00228/.test(erro) && await vivosLixo(db) === 1245, erro);
  }
  {
    const db = await banco(tipo, `delete from public.sot_projetos where id::text='${PID}';`);
    const erro = await aplicar(db);
    ok(T + 'projeto inexistente: para', erro && /não encontrado/.test(erro) && await vivosLixo(db) === 1245, erro);
  }
}

if (failed.length) { console.error('FALHOU ' + failed.length + '/' + total + ':\n - ' + failed.join('\n - ')); process.exit(1); }
console.log('sot-materiais-importacao-binaria-sql: OK (' + total + ' verificações)');
