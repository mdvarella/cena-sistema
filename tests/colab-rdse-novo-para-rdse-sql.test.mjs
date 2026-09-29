// COLABORADORES — testes SQL da migration 20260929200000_colab_rdse_novo_para_rdse.sql
// PostgreSQL embutido (PGlite), esquema mínimo. Teste auxiliar: não substitui a conferência no Supabase real.
// Uso: PGLITE_PATH=<pasta com node_modules/@electric-sql/pglite> node tests/colab-rdse-novo-para-rdse-sql.test.mjs
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
  console.log('colab-rdse-novo-para-rdse-sql: SKIP (instale @electric-sql/pglite e defina PGLITE_PATH)');
  process.exit(0);
}

const mig = fs.readFileSync(path.join(here, '..', 'supabase', 'migrations', '20260929200000_colab_rdse_novo_para_rdse.sql'), 'utf8');
const NOVO = 'c403dac6-753f-4f35-8113-21a12ccfeb27';
const RDSE = '3925df4e-7e39-498d-8c96-891a7f4d415c';
const OUTRO = '11111111-1111-4111-8111-111111111111';
const lista = mig.slice(mig.indexOf('ARRAY['), mig.indexOf(']::uuid[]'));
const IDS = [...lista.matchAll(/'([0-9a-f-]{36})'/g)].map(m => m[1]);
const desfazer = mig.slice(mig.indexOf('-- Para desfazer')).split('\n').slice(1)
  .map(l => l.replace(/^--\s?/, '')).join('\n').trim();

const failed = [];
let total = 0;
function ok(name, cond, detail) { total++; if (!cond) failed.push(name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }

const SCHEMA = `
create table public.contratos (id uuid primary key, nome text, deleted_at timestamptz);
create table public.colaboradores (id uuid primary key, re text, nome text, contrato_id uuid, ativo boolean default true);
create table public.audit_log (
  id bigserial primary key, acao text, modulo text, descricao text, usuario_id text, usuario_nome text,
  usuario_perfil text, dados_extra jsonb, data_hora timestamptz, sessao_id text);
insert into public.contratos values ('${NOVO}','RDSE NOVO',null), ('${RDSE}','RDSE',null), ('${OUTRO}','OUTRO',null);
`;
async function banco(extra) {
  const db = new PGlite();
  await db.exec(SCHEMA);
  const vals = IDS.map((id, i) => `('${id}','${1800 + i}','COLAB ${i}','${NOVO}')`).join(',');
  await db.exec(`insert into public.colaboradores (id,re,nome,contrato_id) values ${vals};
    insert into public.colaboradores (id,re,nome,contrato_id) values
      ('22222222-2222-4222-8222-222222222222','9001','JA NO RDSE','${RDSE}'),
      ('33333333-3333-4333-8333-333333333333','9002','OUTRO CONTRATO','${OUTRO}');`);
  if (extra) await db.exec(extra);
  return db;
}
const n = async (db, sql) => Number((await db.query(sql)).rows[0].n);
async function aplicar(db) { try { await db.exec(mig); return null; } catch (e) { try { await db.exec('ROLLBACK'); } catch (_) {} return e.message; } }

ok('lista com 24 ids distintos', IDS.length === 24 && new Set(IDS).size === 24, IDS.length);

{
  const db = await banco();
  const erro = await aplicar(db);
  ok('aplica sem erro', erro === null, erro);
  ok('RDSE NOVO fica sem colaboradores', await n(db, `select count(*) n from public.colaboradores where contrato_id='${NOVO}'`) === 0);
  ok('os 24 vão para o RDSE', await n(db, `select count(*) n from public.colaboradores where contrato_id='${RDSE}' and id in (${IDS.map(i => `'${i}'`).join(',')})`) === 24);
  ok('RDSE com 25 (24 + o que já estava)', await n(db, `select count(*) n from public.colaboradores where contrato_id='${RDSE}'`) === 25);
  ok('outro contrato intacto', await n(db, `select count(*) n from public.colaboradores where contrato_id='${OUTRO}'`) === 1);
  const a = (await db.query(`select acao, modulo, dados_extra from public.audit_log where sessao_id='sql:20260929200000_colab_rdse_novo_para_rdse'`)).rows;
  ok('1 registro de auditoria', a.length === 1, a.length);
  ok('auditoria com os 24 ids e os contratos', a[0] && a[0].acao === 'COLAB_MIGRACAO_CONTRATO' && a[0].dados_extra.registros_afetados === 24
    && a[0].dados_extra.colaborador_ids.length === 24 && a[0].dados_extra.contrato_origem_id === NOVO && a[0].dados_extra.contrato_destino_id === RDSE, a[0]);

  const erro2 = await aplicar(db);
  ok('reaplicar para (fail-closed)', erro2 && /PARAR: só 0 dos 24/.test(erro2), erro2);
  ok('reaplicar não duplica auditoria', await n(db, `select count(*) n from public.audit_log`) === 1);

  await db.exec(desfazer);
  ok('roteiro de desfazer devolve os 24 ao RDSE NOVO', await n(db, `select count(*) n from public.colaboradores where contrato_id='${NOVO}'`) === 24);
  ok('desfazer não mexe no que já era do RDSE', await n(db, `select count(*) n from public.colaboradores where contrato_id='${RDSE}'`) === 1);
}
{
  const db = await banco(`insert into public.colaboradores (id,re,nome,contrato_id) values ('44444444-4444-4444-8444-444444444444','9003','NOVO FORA DA LISTA','${NOVO}');`);
  const erro = await aplicar(db);
  ok('colaborador fora da lista no RDSE NOVO: para', erro && /fora da lista conferida/.test(erro), erro);
  ok('colaborador fora da lista: nada alterado', await n(db, `select count(*) n from public.colaboradores where contrato_id='${NOVO}'`) === 25
    && await n(db, `select count(*) n from public.audit_log`) === 0);
}
{
  const db = await banco(`update public.colaboradores set contrato_id='${OUTRO}' where id='${IDS[3]}';`);
  const erro = await aplicar(db);
  ok('um da lista já saiu do RDSE NOVO: para', erro && /só 23 dos 24/.test(erro), erro);
  ok('um da lista já saiu: nada alterado', await n(db, `select count(*) n from public.colaboradores where contrato_id='${NOVO}'`) === 23
    && await n(db, `select count(*) n from public.audit_log`) === 0);
}
{
  const db = await banco(`update public.contratos set deleted_at=now() where id='${RDSE}';`);
  const erro = await aplicar(db);
  ok('contrato de destino excluído: para', erro && /destino RDSE não encontrado/.test(erro), erro);
  ok('destino excluído: nada alterado', await n(db, `select count(*) n from public.colaboradores where contrato_id='${NOVO}'`) === 24);
}

if (failed.length) { console.error('FALHOU ' + failed.length + '/' + total + ':\n - ' + failed.join('\n - ')); process.exit(1); }
console.log('colab-rdse-novo-para-rdse-sql: OK (' + total + ' verificações)');
