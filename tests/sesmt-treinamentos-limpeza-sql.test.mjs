// SESMT — testes SQL da migration 20260930130000_sesmt_treinamentos_copias_sem_colaborador.sql
// PostgreSQL embutido (PGlite), esquema mínimo com ids em uuid e em text.
// Teste auxiliar: não substitui a conferência no Supabase real.
// Uso: PGLITE_PATH=<pasta com node_modules/@electric-sql/pglite> node tests/sesmt-treinamentos-limpeza-sql.test.mjs
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
  console.log('sesmt-treinamentos-limpeza-sql: SKIP (instale @electric-sql/pglite e defina PGLITE_PATH)');
  process.exit(0);
}

const ARQ = '20260930130000_sesmt_treinamentos_copias_sem_colaborador';
const SESSAO = 'sql:' + ARQ;
const mig = fs.readFileSync(path.join(here, '..', 'supabase', 'migrations', ARQ + '.sql'), 'utf8');
const desfazer = mig.slice(mig.indexOf('-- Para desfazer')).split(/\r?\n/).slice(1)
  .map(l => l.replace(/^--\s?/, '')).join('\n').trim();
const COPIAS = [...mig.matchAll(/\['([0-9a-f-]{36})','([0-9a-f-]{36})'\]/g)].map(m => [m[1], m[2]]);
const blocoSem = mig.slice(mig.indexOf('v_sem_colab text[] := ARRAY['), mig.indexOf('v_esp_copias'));
const SEM = [...blocoSem.matchAll(/'([0-9a-f-]{36})'/g)].map(m => m[1]);
const MANTIDAS = [...new Set(COPIAS.map(p => p[0]))];
const OUTRA = '99999999-9999-4999-8999-999999999999';
const TOTAL = COPIAS.length + SEM.length;

const failed = [];
let total = 0;
function ok(name, cond, detail) { total++; if (!cond) failed.push(name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }

async function banco(tipo, extra) {
  const db = new PGlite();
  await db.exec(`
create table public.treinamentos (
  id ${tipo} primary key, funcionario_id ${tipo}, nr text, titulo text, validade date, epis_liberados text,
  criado_em timestamptz, deleted_at timestamptz, data date, instituicao text, resultado text, medico text, clinica text);
create table public.rh_sesmt_documento_vinculos (id bigserial primary key, treinamento_id ${tipo}, documento_id text, ativo boolean);
create table public.rh_colaborador_documentos (id bigserial primary key, referencia_modulo text, referencia_id text, ativo boolean);
create table public.audit_log (
  id bigserial primary key, acao text, modulo text, descricao text, usuario_id text, usuario_nome text,
  usuario_perfil text, dados_extra jsonb, data_hora timestamptz, sessao_id text);`);
  const vals = [];
  const func = i => `'0000000${i % 10}-0000-4000-8000-${String(i).padStart(12, '0')}'`;
  const linha = (id, i, criado, funcionario) =>
    `('${id}',${funcionario === null ? 'null' : func(i)},'NR${i}','Curso ${i}',${i % 3 ? `'2028-01-${String(1 + (i % 27)).padStart(2, '0')}'` : 'null'},null,'${criado}',null,${i % 2 ? `'2026-01-10'` : 'null'},${i % 4 ? `'Escola ${i}'` : 'null'},null,null,null)`;
  MANTIDAS.forEach((m, i) => vals.push(linha(m, i, '2026-06-03T10:00:00Z')));
  COPIAS.forEach(([m, c]) => vals.push(linha(c, MANTIDAS.indexOf(m), '2026-07-05T08:34:00Z')));
  SEM.forEach((s, j) => vals.push(`('${s}',null,'NR-35-REC','NR-35 Reciclagem','2027-06-15',null,'2026-06-24T16:00:00Z',null,null,null,null,null,null)`));
  vals.push(`('${OUTRA}',${func(777)},'NR10','NR-10','2028-02-02',null,'2026-01-01T00:00:00Z',null,'2026-02-02',null,null,null,null)`);
  await db.exec(`insert into public.treinamentos values ${vals.join(',')};`);
  if (extra) await db.exec(extra);
  return db;
}
const n = async (db, sql) => Number((await db.query(sql)).rows[0].n);
const ativos = db => n(db, `select count(*) n from public.treinamentos where deleted_at is null`);
const audits = db => n(db, `select count(*) n from public.audit_log`);
async function aplicar(db) { try { await db.exec(mig); return null; } catch (e) { try { await db.exec('ROLLBACK'); } catch (_) {} return e.message; } }

ok('listas: 25 cópias e 11 sem colaborador, ids distintos', COPIAS.length === 25 && SEM.length === 11 && new Set(COPIAS.map(p => p[1]).concat(SEM)).size === 36, [COPIAS.length, SEM.length]);
ok('listas: nenhuma linha mantida marcada para excluir', MANTIDAS.every(m => !COPIAS.some(p => p[1] === m) && !SEM.includes(m)));
const TOTAL_LINHAS = MANTIDAS.length + TOTAL + 1;

for (const tipo of ['uuid', 'text']) {
  const T = '[' + tipo + '] ';
  {
    const db = await banco(tipo);
    ok(T + 'antes: todas ativas', await ativos(db) === TOTAL_LINHAS);
    const erro = await aplicar(db);
    ok(T + 'aplica sem erro', erro === null, erro);
    ok(T + '36 excluídas (soft delete)', await n(db, `select count(*) n from public.treinamentos where deleted_at is not null`) === TOTAL);
    ok(T + 'linhas mantidas e a de fora continuam ativas', await ativos(db) === MANTIDAS.length + 1
      && await n(db, `select count(*) n from public.treinamentos where deleted_at is null and id::text='${OUTRA}'`) === 1);
    ok(T + 'nada apagado de verdade', await n(db, `select count(*) n from public.treinamentos`) === TOTAL_LINHAS);
    ok(T + 'sem colaborador ativo: zero', await n(db, `select count(*) n from public.treinamentos where deleted_at is null and funcionario_id is null`) === 0);
    const au = (await db.query(`select acao, modulo, dados_extra from public.audit_log where sessao_id='${SESSAO}'`)).rows;
    ok(T + 'auditoria com as 36 linhas e a mantida de cada cópia', au.length === 1 && au[0].acao === 'SESMT_TREINAMENTOS_LIMPEZA' && au[0].modulo === 'sesmt'
      && au[0].dados_extra.registros_afetados === 36 && au[0].dados_extra.excluidos.length === 36
      && au[0].dados_extra.excluidos.filter(e => e.tipo === 'copia').every(e => COPIAS.some(p => p[1] === e.id && p[0] === e.mantida)), au[0] && au[0].dados_extra.registros_afetados);
    const erro2 = await aplicar(db);
    ok(T + 'reaplicar para (fail-closed)', erro2 && /nada pendente/.test(erro2), erro2);
    ok(T + 'reaplicar não duplica auditoria', await audits(db) === 1);
    await db.exec(desfazer);
    ok(T + 'desfazer reativa as 36', await ativos(db) === TOTAL_LINHAS);
  }
  {
    const db = await banco(tipo, `update public.treinamentos set deleted_at=now() where id::text='${COPIAS[2][1]}';`);
    const erro = await aplicar(db);
    ok(T + 'cópia já excluída: aplica o resto', erro === null, erro);
    const au = (await db.query(`select dados_extra from public.audit_log`)).rows[0];
    ok(T + 'cópia já excluída: pulada e registrada', au.dados_extra.registros_afetados === 35 && au.dados_extra.pulados.length === 1 && au.dados_extra.pulados[0].motivo === 'já excluída', au.dados_extra.pulados);
  }
  {
    const db = await banco(tipo, `insert into public.rh_sesmt_documento_vinculos(treinamento_id, documento_id, ativo) values ('${COPIAS[4][1]}','doc-1',true), ('${SEM[0]}','doc-2',null), ('${COPIAS[6][1]}','doc-3',false);`);
    const erro = await aplicar(db);
    ok(T + 'vinculadas a documento: aplica o resto', erro === null, erro);
    const au = (await db.query(`select dados_extra from public.audit_log`)).rows[0];
    ok(T + 'vinculadas a documento: puladas (vínculo ativo ou sem flag)', au.dados_extra.registros_afetados === 34
      && au.dados_extra.pulados.filter(p => p.motivo === 'vinculado a documento').length === 2, au.dados_extra.pulados);
    ok(T + 'vinculadas continuam ativas; vínculo inativo não impede', await n(db, `select count(*) n from public.treinamentos where deleted_at is null and id::text in ('${COPIAS[4][1]}','${SEM[0]}')`) === 2
      && await n(db, `select count(*) n from public.treinamentos where deleted_at is not null and id::text='${COPIAS[6][1]}'`) === 1);
  }
  {
    const REF = '624ac667-2cb1-4264-9e81-d58368d939cf';
    const db = await banco(tipo, `insert into public.rh_colaborador_documentos(referencia_modulo, referencia_id, ativo) values ('sesmt_treinamentos','${REF}',true), ('rh_entrada_ia','${COPIAS[7][1]}',true);`);
    const erro = await aplicar(db);
    ok(T + 'referência em rh_colaborador_documentos: aplica o resto', erro === null, erro);
    const au = (await db.query(`select dados_extra from public.audit_log`)).rows[0];
    ok(T + 'cópia referenciada por documento: pulada (caso real de 30/09)', COPIAS.some(p => p[1] === REF) && au.dados_extra.registros_afetados === 35
      && au.dados_extra.pulados.length === 1 && au.dados_extra.pulados[0].id === REF, au.dados_extra.pulados);
    ok(T + 'cópia referenciada continua ativa; referência de outro módulo não impede',
      await n(db, `select count(*) n from public.treinamentos where deleted_at is null and id::text='${REF}'`) === 1
      && await n(db, `select count(*) n from public.treinamentos where deleted_at is not null and id::text='${COPIAS[7][1]}'`) === 1);
  }
  {
    const db = await banco(tipo, `update public.treinamentos set titulo='Outro curso' where id::text='${COPIAS[5][1]}';`);
    const erro = await aplicar(db);
    ok(T + 'cópia diferente da mantida: para', erro && /não é mais idêntica/.test(erro), erro);
    ok(T + 'cópia diferente: nada alterado', await ativos(db) === TOTAL_LINHAS && await audits(db) === 0);
  }
  {
    const db = await banco(tipo, `update public.treinamentos set validade='2030-01-01' where id::text='${COPIAS[8][1]}';`);
    const erro = await aplicar(db);
    ok(T + 'validade diferente: para', erro && /não é mais idêntica/.test(erro), erro);
  }
  {
    const db = await banco(tipo, `update public.treinamentos set deleted_at=now() where id::text='${COPIAS[1][0]}';`);
    const erro = await aplicar(db);
    ok(T + 'linha mantida excluída: para', erro && /deveria ficar está excluída/.test(erro), erro);
    ok(T + 'linha mantida excluída: nada alterado', await audits(db) === 0);
  }
  {
    const db = await banco(tipo, `update public.treinamentos set funcionario_id='00000000-0000-4000-8000-000000000123' where id::text='${SEM[3]}';`);
    const erro = await aplicar(db);
    ok(T + 'treinamento ganhou colaborador: para', erro && /agora tem colaborador/.test(erro), erro);
    ok(T + 'ganhou colaborador: nada alterado', await ativos(db) === TOTAL_LINHAS && await audits(db) === 0);
  }
  {
    const db = await banco(tipo, `delete from public.treinamentos where id::text='${COPIAS[9][1]}';`);
    const erro = await aplicar(db);
    ok(T + 'linha inexistente: para', erro && /não encontrado/.test(erro), erro);
  }
}

if (failed.length) { console.error('FALHOU ' + failed.length + '/' + total + ':\n - ' + failed.join('\n - ')); process.exit(1); }
console.log('sesmt-treinamentos-limpeza-sql: OK (' + total + ' verificações)');
