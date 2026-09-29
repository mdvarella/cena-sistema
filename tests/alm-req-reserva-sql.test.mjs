// ALMOXARIFADO-CENA — testes SQL da migration 20260928190000_alm_req_reserva_atomica.sql
// PostgreSQL embutido (PGlite), esquema mínimo com as colunas reais das tabelas. Teste auxiliar:
// não substitui o teste controlado no Supabase real.
// Uso: PGLITE_PATH=<pasta com node_modules/@electric-sql/pglite> node tests/alm-req-reserva-sql.test.mjs
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
  console.log('alm-req-reserva-sql: SKIP (instale @electric-sql/pglite e defina PGLITE_PATH)');
  process.exit(0);
}

const mig = fs.readFileSync(path.join(here, '..', 'supabase', 'migrations', '20260928190000_alm_req_reserva_atomica.sql'), 'utf8');

// CHECKs sem 'entregue' (como o banco real antes da migration) para provar a ampliação.
const SCHEMA = `
create role anon; create role authenticated;
create table filiais(id uuid primary key default gen_random_uuid(), nome text);
create table depositos(id uuid primary key default gen_random_uuid(), nome text, filial_id uuid references filiais(id));
create table contratos(id uuid primary key default gen_random_uuid(), nome text);
create table itens_catalogo(id uuid primary key default gen_random_uuid(), nome text, codigo text, sku text);
create table estoque(id uuid primary key default gen_random_uuid(), nome text, codigo text, sku text, tipo text,
  saldo int4 default 0, filial_id uuid references filiais(id), deposito_id uuid references depositos(id), contrato_id uuid);
create table movimentacoes_itens(id uuid primary key default gen_random_uuid(), item_id uuid references itens_catalogo(id),
  tipo_mov text, quantidade numeric, deposito_id uuid, filial_id uuid, contrato_id uuid, data_mov date,
  responsavel_id uuid, registrado_por_id uuid, motivo text, obs text, status text, colaborador_id text, equipe_id text);
create table alm_requisicoes(id uuid primary key default gen_random_uuid(), numero text unique, deposito_id text,
  contrato_id text, dest_base_id text, dest_base_nome text, dest_deposito_id text, dest_deposito_nome text,
  status text constraint alm_requisicoes_status_check check (status in ('rascunho','solicitada','aprovada','recusada','separacao',
    'parcialmente_atendida','separada','atendida','recebida','cancelada')),
  aprovado_por text, aprovado_em timestamptz, cancelado_por text, cancelado_em timestamptz,
  atendido_por text, atendido_em timestamptz, recebido_por text, recebido_em timestamptz);
create table alm_requisicao_itens(id uuid primary key default gen_random_uuid(), requisicao_id uuid references alm_requisicoes(id),
  item_id text, item_codigo text, item_descricao text, quantidade_solicitada numeric, quantidade_aprovada numeric,
  quantidade_atendida numeric default 0, colaborador_id text, equipe_id text,
  status text constraint alm_requisicao_itens_status_check check (status in ('rascunho','solicitado','aprovado','separacao','separado',
    'parcial','atendido','recebido','cancelado','recusado')));
create table alm_requisicao_eventos(id uuid primary key default gen_random_uuid(), requisicao_id uuid references alm_requisicoes(id),
  evento text constraint alm_requisicao_eventos_evento_check check (evento in ('criada','enviada','aprovada','recusada','cancelada','retroagida','salva')),
  descricao text, usuario text, dados_json jsonb, criado_em timestamptz default now());
create table alm_movimentos(id uuid primary key default gen_random_uuid(), tipo text, status text, quantidade numeric, item_codigo text);
`;

const db = new PGlite();
await db.exec(SCHEMA);
await db.exec(mig.replace(/NOTIFY pgrst[^;]*;/g, ''));
await db.exec(mig.replace(/NOTIFY pgrst[^;]*;/g, ''));

const failed = [];
let total = 0;
const ok = (n, c, d) => { total++; if (!c) failed.push(n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const one = async (sql, p) => (await db.query(sql, p || [])).rows[0];
const rpc = async (fn, args) => {
  const keys = Object.keys(args);
  return (await one(`select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`, keys.map(k => args[k]))).r;
};

const fil = (await one(`insert into filiais(nome) values ('LAPA') returning id`)).id;
const dep = (await one(`insert into depositos(nome, filial_id) values ('ALMOX LAPA', $1) returning id`, [fil])).id;
const dep2 = (await one(`insert into depositos(nome, filial_id) values ('ALMOX EMBU', $1) returning id`, [fil])).id;
const ctr = (await one(`insert into contratos(nome) values ('CTR') returning id`)).id;
const oc = (await one(`insert into itens_catalogo(nome, codigo, sku) values ('OCULOS DE PROTEÇÃO SPECTRA 2000 CA 6136', '', '') returning id`)).id;
const estOc = (await one(`insert into estoque(nome, saldo, filial_id, deposito_id) values ('OCULOS DE PROTEÇÃO SPECTRA 2000 CA 6136',60,$1,$2) returning id`, [fil, dep])).id;
await db.query(`insert into estoque(nome, saldo, filial_id, deposito_id) values ('OCULOS DE PROTEÇÃO SPECTRA 2000 CA 6136',500,$1,$2)`, [fil, dep2]);
await db.query(`insert into alm_movimentos(tipo, status, quantidade, item_codigo) values ('reserva','reservado',999,'SPECTRA')`);

let n = 0;
async function novaReq(qtd, status) {
  n++;
  const r = (await one(`insert into alm_requisicoes(numero, deposito_id, contrato_id, dest_deposito_id, status)
    values ($1, $2, $3, 'DEST', $4) returning id`, ['REQ-T' + n, String(dep), String(ctr), status || 'solicitada'])).id;
  const it = (await one(`insert into alm_requisicao_itens(requisicao_id, item_id, item_codigo, item_descricao, quantidade_solicitada, status)
    values ($1, $2, '', 'OCULOS DE PROTEÇÃO SPECTRA 2000 CA 6136', $3, 'solicitado') returning id`, [r, String(oc), qtd])).id;
  return { r, it };
}
const saldo = async () => (await one(`select saldo from estoque where id = $1`, [estOc])).saldo;
const reservado = async () => Number((await one(`select public.fn_alm_req_reservado($1, $2, '', 'OCULOS DE PROTEÇÃO SPECTRA 2000 CA 6136', null, null) as v`, [String(dep), String(oc)])).v);
const status = async (id) => (await one(`select status from alm_requisicoes where id = $1`, [id])).status;
const saidas = async () => Number((await one(`select count(*) as c from movimentacoes_itens where tipo_mov='entrega'`)).c);
const iniciarSep = async (id) => db.query(`update alm_requisicoes set status='separacao' where id=$1`, [id]);

// Migration: estrutura
ok('coluna quantidade_separada criada', !!(await one(`select 1 as x from information_schema.columns where table_name='alm_requisicao_itens' and column_name='quantidade_separada'`)));
const chk = (await one(`select pg_get_constraintdef(oid) as d from pg_constraint where conname='alm_requisicoes_status_check'`)).d;
ok('CHECK cabeçalho aceita entregue e mantém os antigos', /entregue/.test(chk) && /atendida/.test(chk) && /rascunho/.test(chk), chk);
ok('CHECK itens aceita entregue e mantém parcial', /entregue/.test((await one(`select pg_get_constraintdef(oid) as d from pg_constraint where conname='alm_requisicao_itens_status_check'`)).d));
ok('CHECK eventos aceita status', /'status'/.test((await one(`select pg_get_constraintdef(oid) as d from pg_constraint where conname='alm_requisicao_eventos_evento_check'`)).d));

// Aprovação: reserva sem baixar, tudo ou nada
const reqs = [];
for (let i = 0; i < 11; i++) reqs.push(await novaReq(1));
for (const q of reqs) { const r = await rpc('fn_alm_req_aprovar', { p_requisicao_id: q.r, p_usuario: 'Aprovador' }); ok('aprova ' + q.r, r.ok === true, r); }
ok('aprovação não baixa físico (60)', (await saldo()) === 60);
ok('11 reservados', (await reservado()) === 11);
let r = await rpc('fn_alm_req_aprovar', { p_requisicao_id: reqs[0].r });
ok('reaprovar idempotente', r.ok && r.idempotente && (await reservado()) === 11, r);
const grande = await novaReq(50);
r = await rpc('fn_alm_req_aprovar', { p_requisicao_id: grande.r });
ok('sem disponível: bloqueia com faltante', r.ok === false && r.codigo === 'SALDO_INSUFICIENTE' && Number(r.itens[0].faltante) === 1 && Number(r.itens[0].disponivel) === 49, r);
ok('sem disponível: continua solicitada e sem reserva', (await status(grande.r)) === 'solicitada' && (await reservado()) === 11);
let erro = '';
try { await db.query(`update alm_requisicoes set status='aprovada' where id=$1`, [grande.r]); } catch (e) { erro = e.message; }
ok('trigger bloqueia aprovação direta', /ALM_REQ_RESERVA/.test(erro), erro);

// TESTE A / D — 10 separadas + 1 aprovada: físico 60, reservado 11, disponível 49
for (let i = 0; i < 10; i++) {
  await iniciarSep(reqs[i].r);
  r = await rpc('fn_alm_req_separar_item', { p_requisicao_id: reqs[i].r, p_item_req_id: reqs[i].it, p_quantidade: 1, p_chave: 'sep-' + i });
  ok('separa ' + i, r.ok === true && r.status === 'separada', r);
}
ok('A/D físico continua 60', (await saldo()) === 60);
ok('A reservado 11 (separadas continuam reservadas)', (await reservado()) === 11);
ok('A disponível 49', 60 - (await reservado()) === 49);
ok('D nenhuma saída física na separação', (await saidas()) === 0);
r = await rpc('fn_alm_req_separar_item', { p_requisicao_id: reqs[0].r, p_item_req_id: reqs[0].it, p_quantidade: 1, p_chave: 'sep-0' });
ok('separar 2x mesma chave: idempotente', r.ok && r.idempotente && Number((await one(`select quantidade_separada as q from alm_requisicao_itens where id=$1`, [reqs[0].it])).q) === 1, r);
erro = '';
try { await db.query(`update alm_requisicoes set status='entregue' where id=$1`, [reqs[0].r]); } catch (e) { erro = e.message; }
ok('trigger bloqueia entregue direto', /ALM_REQ_RESERVA/.test(erro), erro);

// TESTE B — entregar 1 separada: físico 59, reservado 10, disponível 49, 1 saída
r = await rpc('fn_alm_req_entregar_item', { p_requisicao_id: reqs[0].r, p_item_req_id: reqs[0].it, p_quantidade: 1, p_chave: 'ent-0', p_usuario: 'Almox', p_obs: 'Requisição CENA REQ-T1' });
ok('B entrega', r.ok === true && r.status === 'entregue', r);
ok('B físico 59', (await saldo()) === 59);
ok('B reservado 10', (await reservado()) === 10);
ok('B disponível 49', 59 - (await reservado()) === 49);
ok('B uma saída física', (await saidas()) === 1);

// TESTE E — duplo clique entregar
r = await rpc('fn_alm_req_entregar_item', { p_requisicao_id: reqs[0].r, p_item_req_id: reqs[0].it, p_quantidade: 1, p_chave: 'ent-0' });
ok('E repetição idempotente', r.ok && r.idempotente, r);
r = await rpc('fn_alm_req_entregar_item', { p_requisicao_id: reqs[0].r, p_item_req_id: reqs[0].it, p_quantidade: 1, p_chave: 'ent-0b' });
ok('E nova chave após entregue: bloqueia', r.ok === false, r);
ok('E uma única baixa', (await saldo()) === 59 && (await saidas()) === 1);

// Entregar sem estar separada
r = await rpc('fn_alm_req_entregar_item', { p_requisicao_id: reqs[10].r, p_item_req_id: reqs[10].it, p_quantidade: 1, p_chave: 'ent-x' });
ok('não entrega requisição só aprovada', r.ok === false && r.codigo === 'STATUS_INVALIDO' && (await saldo()) === 59, r);

// TESTE C — confirmar recebimento
r = await rpc('fn_alm_req_confirmar_recebimento', { p_requisicao_id: reqs[1].r, p_usuario: 'Destino' });
ok('C não confirma requisição só separada', r.ok === false && r.codigo === 'NAO_ENTREGUE', r);
r = await rpc('fn_alm_req_confirmar_recebimento', { p_requisicao_id: reqs[0].r, p_usuario: 'Destino' });
ok('C confirma entregue', r.ok === true && r.status === 'recebida', r);
r = await rpc('fn_alm_req_confirmar_recebimento', { p_requisicao_id: reqs[0].r, p_usuario: 'Destino' });
ok('C confirmar 2x idempotente', r.ok && r.idempotente, r);
ok('C físico 59 / reservado 10 / 1 saída', (await saldo()) === 59 && (await reservado()) === 10 && (await saidas()) === 1);
ok('C registra quem/quando', !!(await one(`select recebido_por, recebido_em from alm_requisicoes where id=$1 and recebido_por='Destino' and recebido_em is not null`, [reqs[0].r])));

// TESTE F — cancelar separada antes da entrega
r = await rpc('fn_alm_req_cancelar', { p_requisicao_id: reqs[1].r, p_usuario: 'Almox' });
ok('F exige motivo', r.ok === false && r.codigo === 'SEM_MOTIVO', r);
r = await rpc('fn_alm_req_cancelar', { p_requisicao_id: reqs[1].r, p_usuario: 'Almox', p_motivo: 'Desistência' });
ok('F cancela e libera', r.ok && r.status === 'cancelada' && (await reservado()) === 9, r);
ok('F físico não muda', (await saldo()) === 59 && (await saidas()) === 1);

// TESTE G — cancelar depois de entregue
r = await rpc('fn_alm_req_cancelar', { p_requisicao_id: reqs[0].r, p_usuario: 'Almox', p_motivo: 'x' });
ok('G recebida: não cancela (devolução)', r.ok === false && r.codigo === 'JA_ENTREGUE', r);
r = await rpc('fn_alm_req_entregar_item', { p_requisicao_id: reqs[2].r, p_item_req_id: reqs[2].it, p_quantidade: 1, p_chave: 'ent-2' });
r = await rpc('fn_alm_req_cancelar', { p_requisicao_id: reqs[2].r, p_usuario: 'Almox', p_motivo: 'x' });
ok('G entregue: não cancela (devolução)', r.ok === false && r.codigo === 'JA_ENTREGUE' && (await saldo()) === 58, r);

// Reserva alheia e divergência física
const p2 = await novaReq(3);
await db.query(`update estoque set saldo = 11 where id=$1`, [estOc]);
await rpc('fn_alm_req_aprovar', { p_requisicao_id: p2.r }).then(x => ok('aprova 3 com físico 11 e 8 reservados', x.ok === true, x));
await db.query(`update estoque set saldo = 9 where id=$1`, [estOc]);
await iniciarSep(p2.r);
r = await rpc('fn_alm_req_separar_item', { p_requisicao_id: p2.r, p_item_req_id: p2.it, p_quantidade: 3, p_chave: 'p2-s' });
ok('separação não usa reserva alheia (físico 9, outras 8 → 1)', r.ok === false && r.codigo === 'SALDO_FISICO_INSUFICIENTE' && Number(r.permitido) === 1 && !/zerad/i.test(r.msg), r);
r = await rpc('fn_alm_req_separar_item', { p_requisicao_id: p2.r, p_item_req_id: p2.it, p_quantidade: 0.5, p_chave: 'p2-f' });
ok('separação fracionada recusada', r.ok === false && ['QTD_FRACIONADA', 'SALDO_FISICO_INSUFICIENTE'].includes(r.codigo), r);

// Entrega parcial + cancelamento do restante
await db.query(`update estoque set saldo = 20 where id=$1`, [estOc]);
r = await rpc('fn_alm_req_separar_item', { p_requisicao_id: p2.r, p_item_req_id: p2.it, p_quantidade: 3, p_chave: 'p2-s2' });
ok('separa 3', r.ok && r.status === 'separada', r);
r = await rpc('fn_alm_req_entregar_item', { p_requisicao_id: p2.r, p_item_req_id: p2.it, p_quantidade: 1, p_chave: 'p2-e1' });
ok('entrega parcial 1 de 3', r.ok && r.status === 'parcialmente_atendida' && (await saldo()) === 19, r);
const resAntes = await reservado();
r = await rpc('fn_alm_req_cancelar', { p_requisicao_id: p2.r, p_usuario: 'Almox', p_motivo: 'Sobrou' });
ok('cancela restante (2) após entrega parcial', r.ok && r.parcial && r.status === 'entregue' && (await reservado()) === resAntes - 2 && (await saldo()) === 19, r);

// Histórico da regra antiga: separada com baixa já feita não vira reserva
const leg = (await one(`insert into alm_requisicoes(numero, deposito_id, contrato_id, dest_deposito_id, status, aprovado_em)
  values ('REQ-LEG', $1, $2, 'DEST', 'separada', now()) returning id`, [String(dep), String(ctr)])).id;
const legIt = (await one(`insert into alm_requisicao_itens(requisicao_id, item_id, item_codigo, item_descricao, quantidade_solicitada, quantidade_aprovada, quantidade_atendida, status)
  values ($1, $2, '', 'OCULOS DE PROTEÇÃO SPECTRA 2000 CA 6136', 1, 1, 1, 'separado') returning id`, [leg, String(oc)])).id;
const legInc = (await one(`insert into alm_requisicoes(numero, deposito_id, contrato_id, dest_deposito_id, status, aprovado_em)
  values ('REQ-LEG-INC', $1, $2, 'DEST', 'separada', now()) returning id`, [String(dep), String(ctr)])).id;
await db.query(`insert into alm_requisicao_itens(requisicao_id, item_id, item_codigo, item_descricao, quantidade_solicitada, quantidade_aprovada, quantidade_atendida, status)
  values ($1, $2, '', 'OCULOS DE PROTEÇÃO SPECTRA 2000 CA 6136', 2, 2, 0, 'aprovado')`, [legInc, String(oc)]);
const resLeg = await reservado();
ok('legado separada com baixa não reserva (sem dupla redução)', resLeg === resAntes - 2, { resLeg, resAntes });
r = await rpc('fn_alm_req_entregar_item', { p_requisicao_id: leg, p_item_req_id: legIt, p_quantidade: 1, p_chave: 'leg-e' });
ok('legado: entregar não baixa de novo', r.ok === false && r.codigo === 'NADA_SEPARADO_A_ENTREGAR' && /regra antiga/.test(r.msg) && (await saldo()) === 19, r);
r = await rpc('fn_alm_req_cancelar', { p_requisicao_id: leg, p_usuario: 'x', p_motivo: 'x' });
ok('legado: cancelar bloqueado (devolução)', r.ok === false && r.codigo === 'JA_ENTREGUE', r);
r = await rpc('fn_alm_req_confirmar_recebimento', { p_requisicao_id: leg, p_usuario: 'Destino' });
ok('legado: recebimento confirma sem baixa', r.ok && r.legado === true && (await saldo()) === 19, r);

// Escopo
const fisDep = Number((await one(`select public.fn_alm_req_saldo_fisico($1,'OCULOS DE PROTEÇÃO SPECTRA 2000 CA 6136','',null) as v`, [String(dep)])).v);
ok('físico só do depósito origem', fisDep === 19, fisDep);
ok('alm_movimentos intocado', Number((await one(`select count(*) as c from alm_movimentos`)).c) === 1);
ok('eventos distinguem reserva/separação/saída/recebimento/liberação',
  Number((await one(`select count(distinct dados_json->>'tipo') as c from alm_requisicao_eventos where dados_json->>'tipo' in ('reserva','separacao','saida_fisica','recebimento','liberacao_reserva')`)).c) === 5);

if (failed.length) { console.error('FALHOU:\n- ' + failed.join('\n- ')); process.exit(1); }
console.log('alm-req-reserva-sql: OK (' + total + ' verificações)');
