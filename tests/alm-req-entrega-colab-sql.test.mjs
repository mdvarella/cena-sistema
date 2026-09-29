// ALMOXARIFADO-CENA 8.1.165 — testes SQL: transferir e depois entregar ao colaborador
// (20260928190000 + 20260929120000). PGlite, esquema mínimo com os tipos reais relevantes.
// Teste auxiliar: não substitui o teste controlado no Supabase real.
// Uso: PGLITE_PATH=<pasta com node_modules/@electric-sql/pglite> node tests/alm-req-entrega-colab-sql.test.mjs
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
  console.log('alm-req-entrega-colab-sql: SKIP (instale @electric-sql/pglite e defina PGLITE_PATH)');
  process.exit(0);
}

const migDir = path.join(here, '..', 'supabase', 'migrations');
const semNotify = s => s.replace(/NOTIFY pgrst[^;]*;/g, '');
const mig1 = semNotify(fs.readFileSync(path.join(migDir, '20260928190000_alm_req_reserva_atomica.sql'), 'utf8'));
const mig2 = semNotify(fs.readFileSync(path.join(migDir, '20260929120000_alm_req_entrega_colaborador.sql'), 'utf8'));

const SCHEMA = `
create role anon; create role authenticated;
create table filiais(id uuid primary key default gen_random_uuid(), nome text);
create table depositos(id uuid primary key default gen_random_uuid(), nome text, filial_id uuid references filiais(id));
create table itens_catalogo(id uuid primary key default gen_random_uuid(), nome text, codigo text, sku text);
create table estoque(id uuid primary key default gen_random_uuid(), nome text, codigo text, sku text,
  saldo int4 default 0, filial_id uuid references filiais(id), deposito_id uuid references depositos(id), deleted_at timestamptz);
create table movimentacoes_itens(id uuid primary key default gen_random_uuid(), item_id uuid references itens_catalogo(id),
  tipo_mov text, quantidade int4, deposito_id uuid, filial_id uuid, contrato_id uuid, data_mov date,
  responsavel_id uuid, registrado_por_id uuid, motivo text, obs text, status text, colaborador_id uuid, equipe_id uuid);
create table alm_requisicoes(id uuid primary key default gen_random_uuid(), numero text unique,
  deposito_id text, deposito_nome text, contrato_id text, dest_base_id text, dest_base_nome text,
  dest_deposito_id text, dest_deposito_nome text,
  status text constraint alm_req_status_chk check (status in ('rascunho','solicitada','aprovada','recusada','separacao',
    'parcialmente_atendida','separada','atendida','recebida','cancelada')),
  aprovado_por text, aprovado_em timestamptz, cancelado_por text, cancelado_em timestamptz,
  atendido_por text, atendido_em timestamptz, recebido_por text, recebido_em timestamptz);
create table alm_requisicao_itens(id uuid primary key default gen_random_uuid(), requisicao_id uuid references alm_requisicoes(id),
  tipo_item text not null default 'EPI', item_id text, item_codigo text, item_descricao text,
  quantidade_solicitada numeric, quantidade_aprovada numeric, quantidade_atendida numeric not null default 0,
  entrega_individual boolean not null default false, colaborador_id text, colaborador_re text, colaborador_nome text, equipe_id text,
  observacao text,
  status text constraint alm_req_item_status_chk check (status in ('rascunho','solicitado','aprovado','separacao','separado',
    'parcial','atendido','recebido','cancelado','recusado')));
create table alm_requisicao_eventos(id uuid primary key default gen_random_uuid(), requisicao_id uuid references alm_requisicoes(id),
  evento text constraint alm_req_evt_tipo_chk check (evento in ('criada','salva','enviada','aprovada','recusada','cancelada','status')),
  descricao text, usuario text, dados_json jsonb, criado_em timestamptz default now());
create table alm_movimentos(id uuid primary key default gen_random_uuid(), tipo text, quantidade numeric);
`;

const db = new PGlite();
await db.exec(SCHEMA);
await db.exec(mig1);
await db.exec(mig2);
await db.exec(mig2);

const failed = [];
let total = 0;
const ok = (n, c, d) => { total++; if (!c) failed.push(n + (d !== undefined ? ' — ' + JSON.stringify(d) : '')); };
const one = async (sql, p) => (await db.query(sql, p || [])).rows[0];
const rpc = async (fn, args) => {
  const keys = Object.keys(args);
  return (await one(`select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`, keys.map(k => args[k]))).r;
};

const fil = (await one(`insert into filiais(nome) values ('CAMACAM') returning id`)).id;
const ORIG = String((await one(`insert into depositos(nome, filial_id) values ('Matriz', $1) returning id`, [fil])).id);
const DEST = String((await one(`insert into depositos(nome, filial_id) values ('CAMACAM CENA', $1) returning id`, [fil])).id);
const CTR = '11111111-1111-4111-8111-111111111111';
const COLAB = '22222222-2222-4222-8222-222222222222';
const CALCA = 'CALCA NR-10 CINZA GG';
const LUVA = 'LUVA VAQUETA';
const calca = String((await one(`insert into itens_catalogo(nome, codigo) values ($1, 'C1') returning id`, [CALCA])).id);
const luva = String((await one(`insert into itens_catalogo(nome, codigo) values ($1, 'L1') returning id`, [LUVA])).id);
const estCalcaOrig = (await one(`insert into estoque(nome, codigo, saldo, filial_id, deposito_id) values ($1,'C1',10,$2,$3) returning id`, [CALCA, fil, ORIG])).id;
await db.query(`insert into estoque(nome, codigo, saldo, filial_id, deposito_id) values ($1,'L1',10,$2,$3)`, [LUVA, fil, ORIG]);
await db.query(`insert into alm_movimentos(tipo, quantidade) values ('sap', 5)`);

let n = 0;
async function novaReq(origem, destino, itens) {
  n++;
  const r = (await one(`insert into alm_requisicoes(numero, deposito_id, deposito_nome, contrato_id, dest_deposito_id, dest_deposito_nome, status)
    values ($1,$2,$3,$4,$5,$6,'solicitada') returning id`,
    ['REQ-C' + n, origem, origem === ORIG ? 'Matriz' : 'CAMACAM CENA', CTR, destino, destino === ORIG ? 'Matriz' : 'CAMACAM CENA'])).id;
  const ids = [];
  for (const it of itens) {
    ids.push((await one(`insert into alm_requisicao_itens(requisicao_id, tipo_item, item_id, item_codigo, item_descricao, quantidade_solicitada,
      entrega_individual, colaborador_id, colaborador_nome, colaborador_re, status)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'solicitado') returning id`,
      [r, it.tipo || 'VESTIMENTA', it.item, it.cod, it.nome, it.qtd, it.colab !== false, it.colab === false ? null : COLAB,
       it.colab === false ? null : 'ARTEMUS TESTE', it.colab === false ? null : '673'])).id);
  }
  return { r, ids };
}
async function atePosEntrega(q, qtds) {
  let x = await rpc('fn_alm_req_aprovar', { p_requisicao_id: q.r, p_usuario: 'Aprov' });
  if (!x.ok) return x;
  await db.query(`update alm_requisicoes set status='separacao' where id=$1`, [q.r]);
  for (let i = 0; i < q.ids.length; i++) {
    x = await rpc('fn_alm_req_separar_item', { p_requisicao_id: q.r, p_item_req_id: q.ids[i], p_quantidade: qtds[i], p_chave: 'sep-' + q.ids[i] });
    if (!x.ok) return x;
  }
  for (let i = 0; i < q.ids.length; i++) {
    x = await rpc('fn_alm_req_entregar_item', { p_requisicao_id: q.r, p_item_req_id: q.ids[i], p_quantidade: qtds[i], p_chave: 'ent-' + q.ids[i], p_usuario: 'Almox' });
    if (!x.ok) return x;
  }
  return x;
}
const entradaDestino = async (nome, cod, qtd) => {
  const row = await one(`select id from estoque where deposito_id=$1 and nome=$2`, [DEST, nome]);
  if (row) await db.query(`update estoque set saldo = saldo + $2 where id=$1`, [row.id, qtd]);
  else await db.query(`insert into estoque(nome, codigo, saldo, filial_id, deposito_id) values ($1,$2,$3,$4,$5)`, [nome, cod, qtd, fil, DEST]);
};
const saldoDep = async (dep, nome) => Number((await one(`select coalesce(sum(saldo),0) as s from estoque where deposito_id=$1 and nome=$2`, [dep, nome])).s);
const reservadoDep = async (dep, item, cod, nome) => Number((await one(`select public.fn_alm_req_reservado($1,$2,$3,$4,null,null) as v`, [dep, item, cod, nome])).v);
const entregueColab = async id => (await one(`select quantidade_entregue_colab as q from alm_requisicao_itens where id=$1`, [id])).q;
const movs = async (where, p) => (await db.query(`select * from movimentacoes_itens where ${where} order by ctid`, p || [])).rows;

// Estrutura
ok('coluna quantidade_entregue_colab', !!(await one(`select 1 as x from information_schema.columns where table_name='alm_requisicao_itens' and column_name='quantidade_entregue_colab'`)));
ok('função fn_alm_req_entregar_colaborador', !!(await one(`select 1 as x from pg_proc where proname='fn_alm_req_entregar_colaborador'`)));
ok('trigger guarda entrega ao colaborador', !!(await one(`select 1 as x from pg_trigger where tgname='trg_alm_req_guarda_entrega_colab'`)));

// 1) Transferência Matriz → CAMACAM com colaborador: saída na origem sem colaborador
const t1 = await novaReq(ORIG, DEST, [{ item: calca, cod: 'C1', nome: CALCA, qtd: 2 }]);
let r = await atePosEntrega(t1, [2]);
ok('T1 entregue (transferência)', r.ok && r.status === 'entregue' && r.transferencia === true, r);
ok('T1 origem baixou uma vez (10→8)', (await saldoDep(ORIG, CALCA)) === 8);
let m = await movs(`item_id=$1`, [calca]);
ok('T1 uma saída na origem, sem colaborador, motivo transferência',
  m.length === 1 && m[0].tipo_mov === 'entrega' && m[0].deposito_id === ORIG && m[0].colaborador_id === null
  && m[0].motivo === 'Transferência requisição CENA — saída' && /transferência para CAMACAM CENA/.test(m[0].obs), m);
ok('T1 evento saída marca transferência', !!(await one(`select 1 as x from alm_requisicao_eventos where requisicao_id=$1 and dados_json->>'tipo'='saida_fisica' and dados_json->>'saida_transferencia'='true'`, [t1.r])));

// 2) Recebimento: item fica pendente de entrega no destino e reservado lá
r = await rpc('fn_alm_req_confirmar_recebimento', { p_requisicao_id: t1.r, p_usuario: 'Destino' });
ok('T1 recebida com pendência de entrega ao colaborador', r.ok && r.status === 'recebida' && r.itens[0].entrega_colaborador_pendente === true, r);
ok('T1 quantidade_entregue_colab = 0', Number(await entregueColab(t1.ids[0])) === 0);
await entradaDestino(CALCA, 'C1', 2);
ok('T1 destino físico 2', (await saldoDep(DEST, CALCA)) === 2);
ok('T1 destino reservado 2 (aguardando colaborador)', (await reservadoDep(DEST, calca, 'C1', CALCA)) === 2);
ok('T1 origem sem reserva residual', (await reservadoDep(ORIG, calca, 'C1', CALCA)) === 0);
r = await rpc('fn_alm_req_confirmar_recebimento', { p_requisicao_id: t1.r, p_usuario: 'Destino' });
ok('T1 recebimento 2x idempotente e sem mudar pendência', r.ok && r.idempotente && Number(await entregueColab(t1.ids[0])) === 0, r);

// 3) Outra requisição saindo do destino não consome o que é do colaborador
const t2 = await novaReq(DEST, ORIG, [{ item: calca, cod: 'C1', nome: CALCA, qtd: 1, colab: false }]);
r = await rpc('fn_alm_req_aprovar', { p_requisicao_id: t2.r });
ok('T2 aprovação no destino bloqueada: disponível 0', r.ok === false && r.codigo === 'SALDO_INSUFICIENTE' && Number(r.itens[0].disponivel) === 0, r);

// 4) Entrega ao colaborador na assinatura
r = await rpc('fn_alm_req_entregar_colaborador', { p_requisicao_id: t1.r, p_item_req_ids: [t1.ids[0]], p_chave: 'colab:F1', p_ficha_id: 'F1', p_usuario: 'Almox' });
ok('T1 entrega ao colaborador ok', r.ok === true && Number(r.quantidade_total) === 2, r);
ok('T1 destino baixou (2→0)', (await saldoDep(DEST, CALCA)) === 0);
ok('T1 origem não baixou de novo (8)', (await saldoDep(ORIG, CALCA)) === 8);
ok('T1 reserva do destino consumida', (await reservadoDep(DEST, calca, 'C1', CALCA)) === 0);
ok('T1 quantidade_entregue_colab = 2', Number(await entregueColab(t1.ids[0])) === 2);
m = await movs(`item_id=$1 and deposito_id=$2`, [calca, DEST]);
ok('T1 uma movimentação no destino no nome do colaborador',
  m.length === 1 && m[0].tipo_mov === 'entrega' && m[0].colaborador_id === COLAB && m[0].status === 'Em uso'
  && m[0].motivo === 'Entrega ao colaborador — requisição CENA' && /ficha:F1/.test(m[0].obs) && Number(m[0].quantidade) === 2, m);
ok('T1 evento entrega_colaborador', !!(await one(`select 1 as x from alm_requisicao_eventos where requisicao_id=$1 and dados_json->>'tipo'='entrega_colaborador' and dados_json->>'ficha_id'='F1'`, [t1.r])));
r = await rpc('fn_alm_req_entregar_colaborador', { p_requisicao_id: t1.r, p_item_req_ids: [t1.ids[0]], p_chave: 'colab:F1', p_ficha_id: 'F1' });
ok('T1 assinatura repetida idempotente', r.ok && r.idempotente, r);
r = await rpc('fn_alm_req_entregar_colaborador', { p_requisicao_id: t1.r, p_item_req_ids: [t1.ids[0]], p_chave: 'colab:F1-outra', p_ficha_id: 'F1' });
ok('T1 outra chave: nada a baixar', r.ok && r.sem_baixa && r.ignorados[0].motivo === 'ja_entregue', r);
ok('T1 sem movimentação extra', (await movs(`item_id=$1 and deposito_id=$2`, [calca, DEST])).length === 1 && (await saldoDep(DEST, CALCA)) === 0);

// 5) Sem saldo no destino: bloqueia e não baixa nada
const t3 = await novaReq(ORIG, DEST, [{ item: calca, cod: 'C1', nome: CALCA, qtd: 1 }]);
await atePosEntrega(t3, [1]);
await rpc('fn_alm_req_confirmar_recebimento', { p_requisicao_id: t3.r, p_usuario: 'Destino' });
r = await rpc('fn_alm_req_entregar_colaborador', { p_requisicao_id: t3.r, p_item_req_ids: [t3.ids[0]], p_chave: 'colab:F3', p_ficha_id: 'F3' });
ok('T3 sem saldo no destino: bloqueia', r.ok === false && r.codigo === 'SALDO_DESTINO_INSUFICIENTE' && /Nada foi baixado/.test(r.msg) && Number(r.falta.saldo_fisico) === 0, r);
ok('T3 nada alterado', Number(await entregueColab(t3.ids[0])) === 0 && (await movs(`item_id=$1 and deposito_id=$2`, [calca, DEST])).length === 1);
ok('T3 sem evento de entrega', !(await one(`select 1 as x from alm_requisicao_eventos where requisicao_id=$1 and dados_json->>'tipo'='entrega_colaborador'`, [t3.r])));

// 6) Tudo ou nada: dois itens, um sem saldo no destino
const t4 = await novaReq(ORIG, DEST, [{ item: luva, cod: 'L1', nome: LUVA, qtd: 1, tipo: 'EPI' }, { item: calca, cod: 'C1', nome: CALCA, qtd: 1 }]);
r = await atePosEntrega(t4, [1, 1]);
ok('T4 entregue', r.ok, r);
await rpc('fn_alm_req_confirmar_recebimento', { p_requisicao_id: t4.r, p_usuario: 'Destino' });
await entradaDestino(LUVA, 'L1', 1);
await entradaDestino(CALCA, 'C1', 1);
r = await rpc('fn_alm_req_entregar_colaborador', { p_requisicao_id: t4.r, p_item_req_ids: t4.ids, p_chave: 'colab:F4', p_ficha_id: 'F4' });
ok('T4 calça sem saldo livre (reservada p/ T3): bloqueia a ficha inteira', r.ok === false && r.codigo === 'SALDO_DESTINO_INSUFICIENTE', r);
ok('T4 luva não foi baixada (tudo ou nada)', (await saldoDep(DEST, LUVA)) === 1 && Number(await entregueColab(t4.ids[0])) === 0);
await entradaDestino(CALCA, 'C1', 1);
r = await rpc('fn_alm_req_entregar_colaborador', { p_requisicao_id: t4.r, p_item_req_ids: t4.ids, p_chave: 'colab:F4b', p_ficha_id: 'F4' });
ok('T4 com saldo: baixa os dois', r.ok && Number(r.quantidade_total) === 2 && (await saldoDep(DEST, LUVA)) === 0, r);
ok('T4 calça do destino fica 1 (reservada p/ T3)', (await saldoDep(DEST, CALCA)) === 1 && (await reservadoDep(DEST, calca, 'C1', CALCA)) === 1);
r = await rpc('fn_alm_req_entregar_colaborador', { p_requisicao_id: t3.r, p_item_req_ids: [t3.ids[0]], p_chave: 'colab:F3b', p_ficha_id: 'F3' });
ok('T3 agora entrega com o saldo reservado para ele', r.ok && (await saldoDep(DEST, CALCA)) === 0 && (await reservadoDep(DEST, calca, 'C1', CALCA)) === 0, r);

// 7) Regra anterior (saída já no nome do colaborador, sem marca de transferência): ficha só documenta
const leg = await novaReq(ORIG, DEST, [{ item: calca, cod: 'C1', nome: CALCA, qtd: 1 }]);
await rpc('fn_alm_req_aprovar', { p_requisicao_id: leg.r });
await db.query(`update alm_requisicoes set status='separacao' where id=$1`, [leg.r]);
await rpc('fn_alm_req_separar_item', { p_requisicao_id: leg.r, p_item_req_id: leg.ids[0], p_quantidade: 1, p_chave: 'sep-leg' });
await rpc('fn_alm_req_entregar_item', { p_requisicao_id: leg.r, p_item_req_id: leg.ids[0], p_quantidade: 1, p_chave: 'ent-leg' });
await db.query(`update alm_requisicao_eventos set dados_json = dados_json - 'saida_transferencia' where requisicao_id=$1 and dados_json->>'tipo'='saida_fisica'`, [leg.r]);
await rpc('fn_alm_req_confirmar_recebimento', { p_requisicao_id: leg.r, p_usuario: 'Destino' });
ok('legado: quantidade_entregue_colab continua NULL', (await entregueColab(leg.ids[0])) === null);
await entradaDestino(CALCA, 'C1', 1);
ok('legado: não reserva no destino', (await reservadoDep(DEST, calca, 'C1', CALCA)) === 0);
const saldoAntesLeg = await saldoDep(DEST, CALCA);
r = await rpc('fn_alm_req_entregar_colaborador', { p_requisicao_id: leg.r, p_item_req_ids: [leg.ids[0]], p_chave: 'colab:FL', p_ficha_id: 'FL' });
ok('legado: assinatura sem baixa (regra anterior)', r.ok && r.sem_baixa && r.ignorados[0].motivo === 'regra_anterior' && (await saldoDep(DEST, CALCA)) === saldoAntesLeg, r);

// 8) Mesmo depósito com colaborador: saída direta no nome dele, sem pendência no destino
const mesmo = await novaReq(ORIG, ORIG, [{ item: calca, cod: 'C1', nome: CALCA, qtd: 1 }]);
r = await atePosEntrega(mesmo, [1]);
ok('mesmo depósito: entregue sem transferência', r.ok && r.transferencia === false, r);
m = await movs(`item_id=$1 and obs like $2`, [calca, '%' + 'REQ-C' + n + '%']);
ok('mesmo depósito: saída no nome do colaborador', m.length === 1 && m[0].colaborador_id === COLAB && m[0].motivo === 'Entrega requisição CENA', m);
await rpc('fn_alm_req_confirmar_recebimento', { p_requisicao_id: mesmo.r, p_usuario: 'Destino' });
ok('mesmo depósito: sem pendência de entrega no destino', (await entregueColab(mesmo.ids[0])) === null);

// 9) Item sem colaborador em transferência: não fica pendente
const semColab = await novaReq(ORIG, DEST, [{ item: luva, cod: 'L1', nome: LUVA, qtd: 1, tipo: 'MATERIAL', colab: false }]);
await atePosEntrega(semColab, [1]);
await rpc('fn_alm_req_confirmar_recebimento', { p_requisicao_id: semColab.r, p_usuario: 'Destino' });
ok('sem colaborador: não fica pendente', (await entregueColab(semColab.ids[0])) === null);

// 10) Proteções
let erro = '';
try { await db.query(`update alm_requisicao_itens set quantidade_entregue_colab = 5 where id=$1`, [t3.ids[0]]); } catch (e) { erro = e.message; }
ok('trigger bloqueia alteração direta da entrega ao colaborador', /ALM_REQ_RESERVA/.test(erro), erro);
const t5 = await novaReq(ORIG, DEST, [{ item: calca, cod: 'C1', nome: CALCA, qtd: 1 }]);
r = await rpc('fn_alm_req_entregar_colaborador', { p_requisicao_id: t5.r, p_item_req_ids: [t5.ids[0]], p_chave: 'colab:F5' });
ok('não entrega ao colaborador antes do recebimento', r.ok === false && r.codigo === 'STATUS_INVALIDO', r);
r = await rpc('fn_alm_req_entregar_colaborador', { p_requisicao_id: t5.r, p_item_req_ids: [t5.ids[0]], p_chave: '' });
ok('exige chave', r.ok === false && r.codigo === 'SEM_CHAVE', r);
ok('alm_movimentos intocado', Number((await one(`select count(*) as c from alm_movimentos`)).c) === 1);
ok('estoque origem só baixou nas entregas (10 − 2 − 1 − 1 − 1 − 1 = 4)', (await saldoDep(ORIG, CALCA)) === 4, await saldoDep(ORIG, CALCA));
ok('estoque nunca negativo', !(await one(`select 1 as x from estoque where saldo < 0`)));

if (failed.length) { console.error('FALHOU:\n- ' + failed.join('\n- ')); process.exit(1); }
console.log('alm-req-entrega-colab-sql: OK (' + total + ' verificações)');
