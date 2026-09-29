'use strict';
// ALMOXARIFADO-CENA — frontend do fluxo Aprovada → Em separação → Separada → Entregue → Recebimento confirmado:
// reserva = aprovado − entregue, separar sem baixa, entregar pelo banco, recebimento só depois da entrega,
// fail-closed sem a migration, sem UPDATE direto de estoque/status pela tela.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
const failed = [];
let total = 0;
function ok(name, cond, detail) { total++; if (!cond) failed.push(name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }

function fn(nome) {
  const m = new RegExp('\\n(?:async )?function ' + nome + '\\(').exec(html);
  if (!m) throw new Error('função não encontrada: ' + nome);
  const ini = m.index + 1;
  const re = /\n(?:async function |function |var |\/\*\*)/g;
  re.lastIndex = ini + 5;
  const fim = re.exec(html);
  return html.slice(ini, fim ? fim.index : undefined);
}
function linhaVar(nome) {
  const i = html.indexOf('\nvar ' + nome + '=');
  if (i < 0) throw new Error('var não encontrada: ' + nome);
  return html.slice(i + 1, html.indexOf('\n', i + 1));
}

const NOMES = ['almMatchEstoqueRef', 'almReqDedupLista', 'almReqItemTemTagEntrega', 'almReqItemTotalmenteAtendido',
  'almReqItemBloqueiaNovaBaixa', 'almReqItemQtdReservada', 'almReqStEhReservaAberta', 'almReqItemQtdSeparada',
  'almReqItemEncerrado', 'almReqItemPendenteSeparar', 'almReqItemPendenteEntrega', 'almReqItensDe',
  'almReqEhLegadoBaixado', 'almReqTemSeparadoAEntregar', 'almReqPodeReceber', 'almReqReserva',
  'almReqReservaEstoque', 'almReqSaldo', 'almReqDisponivel', 'almReqReservaPropria', 'almReqColsEstoqueHtml',
  'almReqAvisoDbPendente', 'almReqRpcReserva', 'almReqMostrarFaltaSaldo', 'almReqAplicarMovsLocais',
  'almReqAssinaturaItens', 'almReqAprovar', 'almReqCancelar', 'almReqCancelarComReserva',
  'almReqHeaderStatusPorItens', 'almReqAtenderItem', 'almReqEntregarItem', 'almReqEntregarTodos',
  'almReqConfirmarRecebimento', 'almReqEntregaTagGet', 'almReqEntregaTagSet', 'almReqItemAguardaEntrega'];
const codigo = linhaVar('ALM_REQ_MSG_DB_PENDENTE') + '\n' + linhaVar('ALM_REQ_MSG_LEGADO_RECEB') + '\n' + NOMES.map(fn).join('\n');

function montar(opts) {
  opts = opts || {};
  const chamadas = { sbUpdate: [], sbInsert: [], entrega: 0, entrada: [], alert: [], toast: [], fetch: [], overlay: 0, gravarItens: 0 };
  let nResp = 0;
  const sb = {
    console: { error: function () {}, warn: function () {}, log: function () {} },
    DEMO: false,
    SB: { url: 'https://x.supabase.co', key: 'anon' },
    _sbAuthToken: null,
    usuarioLogado: { id: 'u1', nome: 'Almox', email: 'almox@cena' },
    itens_catalogo: [{ id: 'cat-luva', nome: 'Luva vaqueta', codigo: 'LUV-01', sku: '' }],
    depositos: [{ id: 'dep1', filial_id: 'fil1', nome: 'ALMOX LAPA' }, { id: 'dep2', filial_id: 'fil1', nome: 'ALMOX EMBU' },
      { id: 'dep9', filial_id: 'fil2', nome: 'OBRA' }],
    estoque: opts.estoque || [
      { id: 'e1', nome: 'Luva vaqueta', codigo: '', saldo: 7, deposito_id: 'dep1', filial_id: 'fil1' },
      { id: 'e2', nome: 'LUVA VAQUETA', codigo: '', saldo: 3, deposito_id: null, filial_id: 'fil1' },
      { id: 'e3', nome: 'Luva vaqueta', codigo: 'LUV-01', saldo: 50, deposito_id: 'dep2', filial_id: 'fil1' }
    ],
    movimentacoes_itens: [],
    _almReq: { lista: [], itens: {}, eventos: {}, draft: null },
    document: {
      getElementById: function (id) { return (opts.inputs || {})[id] || null; },
      createElement: function () { return { style: {}, remove: function () {} }; },
      body: { appendChild: function () { chamadas.overlay++; } }
    },
    setTimeout: function () {},
    confirm: function (m) { chamadas.confirm = (chamadas.confirm || []).concat([m]); return opts.confirma !== false; },
    prompt: function () { return opts.motivo === undefined ? 'Obra suspensa' : opts.motivo; },
    alert: function (m) { chamadas.alert.push(m); },
    progShowToast: function (m, t) { chamadas.toast.push([m, t]); },
    closeModal: function () {}, almReqModal: function () {}, almReqRender: function () {}, almReqRenderAlertas: function () {},
    almReqCarregar: async function () {}, almReqAbrir: function () {}, almReqLerCabecalho: function () {},
    almReqDirigirPasso: function () {}, almReqExigeColab: function () { return false; },
    almReqSyncListaDraft: function () {}, almReqLogEvento: async function () {},
    almReqUsuarioNome: function () { return 'Almox'; }, almReqUserPodeDep: function () { return true; },
    almReqIrEntregarColab: function () {},
    almReqGravarItens: async function () { chamadas.gravarItens++; return true; },
    almRegistrarEntregaPatrimonio: async function () { chamadas.entrega++; return { ok: true }; },
    almRegistrarEntradaPatrimonio: async function (p) { chamadas.entrada.push(p); return { ok: true }; },
    sbUpdate: async function (t, p) { chamadas.sbUpdate.push([t, p]); return true; },
    sbInsert: async function (t, p) { chamadas.sbInsert.push([t, p]); return [{}]; },
    dataHoje: function () { return '2026-09-28'; },
    _escapeHtml: function (s) { return String(s); },
    fetch: async function (url, init) {
      chamadas.fetch.push([url, JSON.parse(init.body)]);
      if (opts.fetchThrow) throw new Error('offline');
      const lista = Array.isArray(opts.resposta) ? opts.resposta : [opts.resposta];
      const r = lista[Math.min(nResp++, lista.length - 1)] || { status: 404, body: { code: 'PGRST202', message: 'Could not find the function' } };
      return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async function () { return typeof r.body === 'string' ? r.body : JSON.stringify(r.body); } };
    }
  };
  vm.createContext(sb);
  vm.runInContext(codigo, sb);
  return { sb: sb, ch: chamadas };
}

function req(id, status, apr, sep, atd, itemStatus, extra) {
  return Object.assign({
    id: id, numero: 'REQ-' + id, status: status, deposito_id: 'dep1', deposito_nome: 'ALMOX LAPA', contrato_id: 'ctr1',
    dest_base_id: 'b2', dest_deposito_id: 'dep9', dest_deposito_nome: 'OBRA',
    itens: [{ id: 'it-' + id, item_id: 'cat-luva', item_codigo: 'LUV-01', item_descricao: 'Luva vaqueta',
      quantidade_solicitada: apr, quantidade_aprovada: apr, quantidade_separada: sep, quantidade_atendida: atd || 0,
      status: itemStatus || 'separacao' }]
  }, extra || {});
}
function carregar(t, reqs) {
  t.sb._almReq.lista = reqs;
  t.sb._almReq.itens = {};
  reqs.forEach(function (r) { t.sb._almReq.itens[r.id] = r.itens; });
}
const MSG = 'Atualização do controle de estoque pendente.\nEsta operação está temporariamente indisponível até a atualização do banco ser concluída.';
const MSG_LEGADO = 'Esta requisição possui saída registrada pela regra anterior.\nConfirme o recebimento somente se o material foi efetivamente recebido.';

(async function () {
  // Saldo físico: mesma regra da baixa (nome/código/sku + legado sem depósito da filial; ignora outro depósito)
  let t = montar();
  ok('saldo físico dep1 = 7 + 3 legado', t.sb.almReqSaldo('cat-luva', 'LUV-01', 'dep1', 'Luva vaqueta') === 10);
  ok('saldo físico não soma outro depósito', t.sb.almReqSaldo('cat-luva', 'LUV-01', 'dep2') === 53);

  // Colunas da separação: disponível geral 0, mas reservado p/ esta requisição 10
  let d = req('r1', 'separacao', 10, null, 0);
  carregar(t, [d]);
  const cols = t.sb.almReqColsEstoqueHtml(d.itens[0], 'dep1', d, true);
  const cels = cols.match(/<td[^>]*>([^<]*)/g).map(function (c) { return c.replace(/<td[^>]*>/, ''); });
  ok('colunas: físico 10 / reservado 10 / disponível 0 / esta 10', cels.join('|') === '10|10|0|10', cels);
  ok('reserva excluindo a própria requisição', t.sb.almReqReservaEstoque('cat-luva', 'LUV-01', 'dep1', 'Luva vaqueta', 'r1') === 0);

  // TESTE A (tela) — físico 60, 10 separadas + 1 aprovada → reservado 11, disponível 49
  const est60 = [{ id: 'e1', nome: 'Luva vaqueta', codigo: 'LUV-01', saldo: 60, deposito_id: 'dep1', filial_id: 'fil1' }];
  t = montar({ estoque: est60 });
  const reqsA = [];
  for (let i = 0; i < 10; i++) reqsA.push(req('s' + i, 'separada', 1, 1, 0, 'separado'));
  reqsA.push(req('a1', 'aprovada', 1, null, 0, 'aprovado'));
  carregar(t, reqsA);
  ok('A: reservado 11 (separada continua reservada)', t.sb.almReqReservaEstoque('cat-luva', 'LUV-01', 'dep1', 'Luva vaqueta') === 11);
  ok('A: disponível 49', t.sb.almReqDisponivel('cat-luva', 'LUV-01', 'dep1', 'Luva vaqueta') === 49);
  // TESTE B (tela) — após entregar 1: físico 59, reservado 10, disponível 49
  reqsA[0].status = 'entregue'; reqsA[0].itens[0].status = 'entregue'; reqsA[0].itens[0].quantidade_atendida = 1;
  t.sb.estoque[0].saldo = 59;
  ok('B: reservado 10', t.sb.almReqReservaEstoque('cat-luva', 'LUV-01', 'dep1', 'Luva vaqueta') === 10);
  ok('B: disponível 49', t.sb.almReqDisponivel('cat-luva', 'LUV-01', 'dep1', 'Luva vaqueta') === 49);
  // TESTE C (tela) — recebimento não muda nada
  reqsA[0].status = 'recebida'; reqsA[0].itens[0].status = 'recebido';
  ok('C: reservado continua 10', t.sb.almReqReservaEstoque('cat-luva', 'LUV-01', 'dep1', 'Luva vaqueta') === 10);

  // Histórico da regra antiga: separada com baixa já feita não entra na reserva
  t = montar({ estoque: est60 });
  const leg = req('L1', 'separada', 1, undefined, 1, 'separado');
  delete leg.itens[0].quantidade_separada;
  const legInc = req('L2', 'separada', 2, null, 0, 'aprovado');
  carregar(t, [leg, legInc]);
  ok('legado: separada antiga não reserva', t.sb.almReqReservaEstoque('cat-luva', 'LUV-01', 'dep1', 'Luva vaqueta') === 0);
  ok('legado: identificado como saída já feita', t.sb.almReqEhLegadoBaixado(leg) === true && t.sb.almReqEhLegadoBaixado(legInc) === false);
  ok('legado: nada a entregar', t.sb.almReqItemPendenteEntrega(leg.itens[0]) === 0);
  ok('legado: pode confirmar recebimento', t.sb.almReqPodeReceber(leg) === true);

  // Nunca Confirmar recebimento para SEPARADA nova
  const sepNova = req('N1', 'separada', 3, 3, 0, 'separado');
  ok('separada nova: não pode receber', t.sb.almReqPodeReceber(sepNova) === false);
  ok('separada nova: tem o que entregar', t.sb.almReqTemSeparadoAEntregar(sepNova) === true && t.sb.almReqItemPendenteEntrega(sepNova.itens[0]) === 3);
  ok('entregue: pode receber', t.sb.almReqPodeReceber(req('E1', 'entregue', 3, 3, 3, 'entregue')) === true);
  ok('status por itens: separado → separada', t.sb.almReqHeaderStatusPorItens(sepNova.itens) === 'separada');
  ok('status por itens: entregue parcial → parcialmente_atendida',
    t.sb.almReqHeaderStatusPorItens([{ quantidade_aprovada: 3, quantidade_separada: 3, quantidade_atendida: 1, status: 'separado' }]) === 'parcialmente_atendida');
  ok('status por itens: tudo entregue → entregue',
    t.sb.almReqHeaderStatusPorItens([{ quantidade_aprovada: 3, quantidade_separada: 3, quantidade_atendida: 3, status: 'entregue' }]) === 'entregue');

  // Fail-closed: RPC ausente
  t = montar();
  t.sb._almReq.draft = { id: 'req2', numero: 'REQ-2', status: 'solicitada', deposito_id: 'dep1', itens: [] };
  t.sb._almReq.itens.req2 = [];
  await t.sb.almReqAprovar();
  ok('aprovar sem migration: mensagem exata', t.ch.alert[0] === MSG, t.ch.alert);
  ok('aprovar sem migration: nenhum UPDATE', t.ch.sbUpdate.length === 0, t.ch.sbUpdate);

  t = montar({ inputs: { 'arq-atd-0': { value: '4' } } });
  t.sb._almReq.draft = req('r1', 'separacao', 10, null, 0);
  await t.sb.almReqAtenderItem(0);
  ok('separar sem migration: mensagem exata, nada gravado', t.ch.alert[0] === MSG && t.ch.sbUpdate.length === 0 && t.ch.entrega === 0);

  t = montar({ inputs: { 'arq-ent-0': { value: '2' } } });
  t.sb._almReq.draft = req('r1', 'separada', 10, 10, 0, 'separado');
  await t.sb.almReqEntregarItem(0);
  ok('entregar sem migration: mensagem exata, sem baixa antiga', t.ch.alert[0] === MSG && t.ch.entrega === 0 && t.ch.sbUpdate.length === 0);
  ok('entregar sem migration: saldo local intacto', t.sb.estoque[0].saldo === 7);

  t = montar();
  t.sb._almReq.draft = req('r1', 'entregue', 10, 10, 10, 'entregue');
  await t.sb.almReqConfirmarRecebimento();
  ok('receber sem migration: bloqueia sem entrada nem UPDATE', t.ch.alert[0] === MSG && t.ch.entrada.length === 0 && t.ch.sbUpdate.length === 0);

  t = montar({ resposta: { status: 400, body: { code: '42883', message: 'function does not exist' } } });
  t.sb._almReq.draft = req('r1', 'separada', 10, 10, 0, 'separado');
  await t.sb.almReqCancelar();
  ok('cancelar separada sem migration: bloqueia', t.ch.alert[0] === MSG && t.ch.sbUpdate.length === 0);

  // TESTE D (tela) — separar: só o banco, sem baixa
  t = montar({ inputs: { 'arq-atd-0': { value: '4' } }, resposta: { status: 200, body: { ok: true, status: 'separacao', item_status: 'separacao', quantidade_separada: 4, reserva_item: 10 } } });
  t.sb._almReq.draft = req('r1', 'separacao', 10, null, 0);
  await t.sb.almReqAtenderItem(0);
  let body = t.ch.fetch[0][1];
  ok('separar chama fn_alm_req_separar_item', /\/rpc\/fn_alm_req_separar_item$/.test(t.ch.fetch[0][0]));
  ok('separar envia item, quantidade e chave (sem data/obs de movimento)', body.p_item_req_id === 'it-r1' && body.p_quantidade === 4 && !!body.p_chave
    && !('p_data_mov' in body) && !('p_obs' in body), body);
  ok('separar: quantidade separada vem do banco; atendida intacta', t.sb._almReq.draft.itens[0].quantidade_separada === 4 && t.sb._almReq.draft.itens[0].quantidade_atendida === 0);
  ok('separar: sem baixa local, sem movimentação, sem UPDATE', t.sb.estoque[0].saldo === 7 && t.sb.movimentacoes_itens.length === 0 && t.ch.sbUpdate.length === 0 && t.ch.entrega === 0);

  t = montar({ inputs: { 'arq-atd-0': { value: '11' } } });
  t.sb._almReq.draft = req('r1', 'separacao', 10, null, 0);
  await t.sb.almReqAtenderItem(0);
  ok('separar acima da reserva: bloqueia sem chamar o banco', t.ch.fetch.length === 0);
  t = montar({ inputs: { 'arq-atd-0': { value: '1.5' } } });
  t.sb._almReq.draft = req('r1', 'separacao', 10, null, 0);
  await t.sb.almReqAtenderItem(0);
  ok('separar fracionado: bloqueia sem chamar o banco', t.ch.fetch.length === 0 && /inteira/.test((t.ch.toast[0] || [])[0]));

  // TESTE B/E (tela) — entregar pelo banco, idempotente
  t = montar({ inputs: { 'arq-ent-0': { value: '4' } }, resposta: { status: 200, body: { ok: true, status: 'parcialmente_atendida', item_status: 'separado', quantidade_atendida: 4, reserva_restante: 6, movimentos: [{ mov_id: 'm1', estoque_id: 'e1', quantidade: 4 }] } } });
  t.sb._almReq.draft = req('r1', 'separada', 10, 10, 0, 'separado');
  await t.sb.almReqEntregarItem(0);
  body = t.ch.fetch[0][1];
  ok('entregar chama fn_alm_req_entregar_item', /\/rpc\/fn_alm_req_entregar_item$/.test(t.ch.fetch[0][0]));
  ok('entregar envia item, quantidade e chave', body.p_item_req_id === 'it-r1' && body.p_quantidade === 4 && !!body.p_chave, body);
  ok('entregar: estado vem do banco', t.sb._almReq.draft.itens[0].quantidade_atendida === 4 && t.sb._almReq.draft.status === 'parcialmente_atendida');
  ok('entregar: saldo local reflete o movimento do banco', t.sb.estoque[0].saldo === 3 && t.sb.movimentacoes_itens.length === 1
    && t.sb.movimentacoes_itens[0].motivo === 'Entrega requisição CENA');
  ok('entregar: sem UPDATE direto nem baixa antiga', t.ch.sbUpdate.length === 0 && t.ch.entrega === 0);
  ok('entregar: chave liberada após sucesso', !t.sb._almReq.chaveEnt['it-r1']);

  t = montar({ fetchThrow: true, inputs: { 'arq-ent-0': { value: '4' } } });
  t.sb._almReq.draft = req('r1', 'separada', 10, 10, 0, 'separado');
  await t.sb.almReqEntregarItem(0);
  const chave1 = t.sb._almReq.chaveEnt && t.sb._almReq.chaveEnt['it-r1'];
  ok('entregar sem rede: guarda a chave', !!chave1 && t.ch.entrega === 0);
  await t.sb.almReqEntregarItem(0);
  ok('entregar retry reaproveita a mesma chave (duplo clique = uma baixa)', t.ch.fetch[1][1].p_chave === chave1);

  t = montar({ inputs: { 'arq-ent-0': { value: '1' } } });
  t.sb._almReq.draft = req('r1', 'separacao', 10, 10, 0, 'separado');
  await t.sb.almReqEntregarItem(0);
  ok('entregar em separação: bloqueia sem chamar o banco', t.ch.fetch.length === 0);
  t = montar({ inputs: { 'arq-ent-0': { value: '1' } } });
  t.sb._almReq.draft = leg;
  await t.sb.almReqEntregarItem(0);
  ok('entregar separada antiga: bloqueia sem nova baixa', t.ch.fetch.length === 0 && t.ch.entrega === 0);

  // Entregar todos: um RPC por item separado pendente
  t = montar({ resposta: [
    { status: 200, body: { ok: true, status: 'parcialmente_atendida', item_status: 'entregue', quantidade_atendida: 3, movimentos: [] } },
    { status: 200, body: { ok: true, status: 'entregue', item_status: 'entregue', quantidade_atendida: 2, movimentos: [] } }] });
  const d2 = req('r2', 'separada', 3, 3, 0, 'separado');
  d2.itens.push({ id: 'it-b', item_id: 'cat-luva', item_descricao: 'Luva vaqueta', quantidade_aprovada: 2, quantidade_separada: 2, quantidade_atendida: 0, status: 'separado' });
  t.sb._almReq.draft = d2;
  await t.sb.almReqEntregarTodos();
  ok('entregar todos: 2 RPCs com as quantidades separadas', t.ch.fetch.length === 2 && t.ch.fetch[0][1].p_quantidade === 3 && t.ch.fetch[1][1].p_quantidade === 2
    && t.ch.fetch[0][1].p_chave !== t.ch.fetch[1][1].p_chave);
  ok('entregar todos: termina Entregue', d2.status === 'entregue');

  // TESTE C (tela) — recebimento
  t = montar();
  t.sb._almReq.draft = req('r1', 'separada', 10, 10, 0, 'separado');
  await t.sb.almReqConfirmarRecebimento();
  ok('receber separada: bloqueado sem chamar o banco', t.ch.fetch.length === 0 && /ainda não foi entregue/.test((t.ch.toast[0] || [])[0]));

  t = montar({ resposta: { status: 200, body: { ok: true, status: 'recebida', legado: false, itens: [{ item_req_id: 'it-r1', item_id: 'cat-luva', quantidade: 10 }] } } });
  t.sb._almReq.draft = req('r1', 'entregue', 10, 10, 10, 'entregue');
  await t.sb.almReqConfirmarRecebimento();
  ok('receber: chama fn_alm_req_confirmar_recebimento', /\/rpc\/fn_alm_req_confirmar_recebimento$/.test(t.ch.fetch[0][0]));
  ok('receber: sem UPDATE de status nem baixa', !t.ch.sbUpdate.some(function (u) { return u[0] === 'alm_requisicoes' || u[0] === 'estoque'; }) && t.ch.entrega === 0);
  ok('receber: status recebida', t.sb._almReq.draft.status === 'recebida' && t.sb._almReq.draft.itens[0].status === 'recebido');
  ok('receber: entrada no destino só depois do banco confirmar', t.ch.entrada.length === 1 && t.ch.entrada[0].deposito_id === 'dep9' && t.ch.entrada[0].quantidade === 10);
  ok('receber: entrada identificada como transferência por recebimento', /Transferência requisição CENA — entrada por recebimento/.test(t.ch.entrada[0].motivo)
    && t.ch.entrada[0].origem_tipo === 'transferencia_requisicao' && /receb:it-r1/.test(t.ch.entrada[0].obs), t.ch.entrada[0]);
  ok('receber: entregue sem aviso de legado', !(t.ch.confirm || []).length);

  t = montar({ resposta: { status: 200, body: { ok: true, status: 'recebida', legado: false, itens: [{ item_req_id: 'it-r1', item_id: 'cat-luva', quantidade: 10 }] } } });
  t.sb.movimentacoes_itens.push({ id: 'mx', tipo_mov: 'entrada', obs: 'Entrada por recebimento REQ-r1 · origem X · receb:it-r1' });
  t.sb._almReq.draft = req('r1', 'entregue', 10, 10, 10, 'entregue');
  await t.sb.almReqConfirmarRecebimento();
  ok('receber: não repete entrada já lançada para o item', t.ch.entrada.length === 0);

  // Separada antiga: recebimento só com confirmação consciente, sem nova baixa
  t = montar({ confirma: false });
  t.sb._almReq.draft = leg;
  await t.sb.almReqConfirmarRecebimento();
  ok('legado: aviso exato e nada feito se não confirmar', (t.ch.confirm || [])[0] && t.ch.confirm[0].indexOf(MSG_LEGADO) === 0 && t.ch.fetch.length === 0 && t.ch.entrada.length === 0);
  t = montar({ resposta: { status: 200, body: { ok: true, status: 'recebida', legado: true, itens: [{ item_req_id: 'it-L1', item_id: 'cat-luva', quantidade: 1 }] } } });
  t.sb._almReq.draft = JSON.parse(JSON.stringify(leg));
  await t.sb.almReqConfirmarRecebimento();
  ok('legado confirmado: só RPC de recebimento, sem baixa', t.ch.fetch.length === 1 && /confirmar_recebimento/.test(t.ch.fetch[0][0]) && t.ch.entrega === 0);

  t = montar({ resposta: { status: 200, body: { ok: true, idempotente: true, status: 'recebida', msg: 'Recebimento já estava confirmado.' } } });
  t.sb._almReq.draft = req('r1', 'entregue', 10, 10, 10, 'entregue');
  await t.sb.almReqConfirmarRecebimento();
  ok('receber 2x: sem nova entrada nem baixa', t.ch.entrada.length === 0 && t.ch.entrega === 0);

  t = montar({ resposta: { status: 200, body: { ok: false, codigo: 'NAO_ENTREGUE', msg: 'Só é possível confirmar o recebimento depois da entrega (saída física).' } } });
  t.sb._almReq.draft = req('r1', 'entregue', 10, 10, 10, 'entregue');
  await t.sb.almReqConfirmarRecebimento();
  ok('receber recusado pelo banco: sem entrada', t.ch.entrada.length === 0 && t.sb._almReq.draft.status === 'entregue');

  // Estáticos
  const entregar = fn('almReqEntregarItem');
  const iDemo = entregar.indexOf('if(DEMO){'), iElse = entregar.indexOf('} else {', iDemo);
  const usoEntrega = entregar.indexOf('almRegistrarEntregaPatrimonio(');
  ok('entregar: baixa antiga só no modo DEMO', usoEntrega > iDemo && usoEntrega < iElse);
  ok('separar: nunca chama a baixa', !/almRegistrarEntregaPatrimonio\(/.test(fn('almReqAtenderItem')));
  ['almReqAprovar', 'almReqAtenderItem', 'almReqEntregarItem', 'almReqConfirmarRecebimento', 'almReqCancelarComReserva'].forEach(function (n) {
    ok(n + ' sem UPDATE em estoque', !/sbUpdate\('estoque'/.test(fn(n)));
    ok(n + ' sem UPDATE direto de status da requisição', !/sbUpdate\('alm_requisicoes'/.test(fn(n)));
  });
  const receber = fn('almReqConfirmarRecebimento');
  ok('receber: RPC antes da entrada no destino', receber.indexOf('fn_alm_req_confirmar_recebimento') < receber.indexOf('almRegistrarEntradaPatrimonio('));
  ok('grade: Reservado p/ esta requisição', /<th>Reservado p\/ esta requisição<\/th>/.test(html));
  ok('botão Iniciar separação', />Iniciar separação<\/button>/.test(html));
  ok('rótulos Entregue / Recebimento confirmado', /entregue:'Entregue'/.test(html) && /recebida:'Recebimento confirmado'/.test(html));
  ok('painel de recebimento só com almReqPodeReceber', /if\(!corrigindo && almReqPodeReceber\(d\)\)\{\n    var destOkRec/.test(html));
  ok('versão 8.1.164 no changelog', /\{v:'8\.1\.164'/.test(html) && /'cena-8\.1\.\d+'/.test(sw));
  const mig = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260928190000_alm_req_reserva_atomica.sql'), 'utf8');
  const migSemComentario = mig.replace(/--[^\n]*/g, '');
  ok('migration não toca alm_movimentos', !/alm_movimentos/.test(migSemComentario));
  ok('migration sem DROP TABLE/DROP COLUMN/ALTER COLUMN/DELETE/TRUNCATE', !/\bDROP TABLE\b|\bDROP COLUMN\b|\bALTER COLUMN\b|\bDELETE FROM\b|\bTRUNCATE\b/i.test(migSemComentario));
  ok('migration: única coluna nova é quantidade_separada', (migSemComentario.match(/ADD COLUMN/gi) || []).length === 1 && /ADD COLUMN IF NOT EXISTS quantidade_separada numeric/.test(migSemComentario));
  ok('separar no banco não mexe em estoque/movimentos', (function () {
    const i = migSemComentario.indexOf('FUNCTION public.fn_alm_req_separar_item');
    const f = migSemComentario.slice(i, migSemComentario.indexOf('$$;', i));
    return !/UPDATE public\.estoque|INSERT INTO public\.movimentacoes_itens|quantidade_atendida\s*=/.test(f);
  })());
  ok('recebimento no banco não mexe em estoque/movimentos', (function () {
    const i = migSemComentario.indexOf('FUNCTION public.fn_alm_req_confirmar_recebimento');
    const f = migSemComentario.slice(i, migSemComentario.indexOf('$$;', i));
    return !/UPDATE public\.estoque|INSERT INTO public\.movimentacoes_itens|quantidade_atendida\s*=/.test(f);
  })());

  if (failed.length) { console.error('FALHOU:\n- ' + failed.join('\n- ')); process.exit(1); }
  console.log('alm-req-reserva-ui: OK (' + total + ' verificações)');
})().catch(function (e) { console.error(e); process.exit(1); });
