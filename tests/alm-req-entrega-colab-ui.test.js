'use strict';
// ALMOXARIFADO-CENA 8.1.165 — frontend de "transferir e depois entregar ao colaborador":
// reserva no destino até a entrega, baixa no destino na assinatura da ficha (tudo ou nada, fail-closed),
// fichas da regra anterior só documentam, saída de transferência sem colaborador.
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

const NOMES = ['almMatchEstoqueRef', 'almReqDedupLista', 'almReqItemQtdReservada', 'almReqStEhReservaAberta',
  'almReqItemPendenteColab', 'almReqReservaEstoque', 'almReqReserva', 'almReqSaldo', 'almReqDisponivel',
  'almReqAvisoDbPendente', 'almReqRpcReserva', 'almReqAplicarMovsLocais', 'almReqItensDe', 'almReqEhLegadoBaixado',
  'almReqPodeReceber', 'almReqConfirmarRecebimento', 'almReqEntregaTagGet', 'almReqEntregaTagSet',
  'almReqItemAguardaEntrega', 'almReqFilaKey', 'almReqFilaEntregas', 'almReqItensDaFicha', 'almReqBaixarEntregaColab',
  'almReqConfirmarAssinaturaFicha'];
const codigo = linhaVar('ALM_REQ_MSG_DB_PENDENTE') + '\n' + linhaVar('ALM_REQ_MSG_LEGADO_RECEB') + '\n' + NOMES.map(fn).join('\n');

function montar(opts) {
  opts = opts || {};
  const ch = { fetch: [], alert: [], toast: [], assinou: [], marcou: [], entrada: [], sbUpdate: [] };
  let nResp = 0;
  const sb = {
    console: { error: function () {}, warn: function () {}, log: function () {} },
    DEMO: false,
    SB: { url: 'https://x.supabase.co', key: 'anon' },
    _sbAuthToken: null,
    usuarioLogado: { id: 'u1', nome: 'Almox', email: 'almox@cena' },
    itens_catalogo: [{ id: 'cat-calca', nome: 'Calça NR-10 GG', codigo: 'CAL-01', sku: '' }],
    depositos: [{ id: 'orig', filial_id: 'fil1', nome: 'Matriz' }, { id: 'dest', filial_id: 'fil1', nome: 'CAMACAM CENA' }],
    estoque: opts.estoque || [
      { id: 'eo', nome: 'Calça NR-10 GG', codigo: 'CAL-01', saldo: 8, deposito_id: 'orig', filial_id: 'fil1' },
      { id: 'ed', nome: 'Calça NR-10 GG', codigo: 'CAL-01', saldo: 2, deposito_id: 'dest', filial_id: 'fil1' }
    ],
    movimentacoes_itens: [],
    _almReq: { lista: [], itens: {}, eventos: {}, draft: null },
    document: { getElementById: function () { return null; }, createElement: function () { return { style: {}, remove: function () {} }; }, body: { appendChild: function () {} } },
    setTimeout: function () {},
    confirm: function () { return true; },
    alert: function (m) { ch.alert.push(m); },
    progShowToast: function (m, t) { ch.toast.push([m, t]); },
    closeModal: function () {}, renderNR6: function () {}, almReqRenderFilaEntrega: function () {},
    almReqModal: function () {}, almReqRenderAlertas: function () {}, almReqCarregar: async function () {}, almReqAbrir: function () {},
    almReqLerCabecalho: function () {}, almReqDirigirPasso: function () {}, almReqSyncListaDraft: function () {},
    almReqLogEvento: async function () {}, almReqUsuarioNome: function () { return 'Almox'; }, almReqUserPodeDep: function () { return true; },
    almReqIrEntregarColab: function () {},
    almReqExigeColab: function (it) { return (it.tipo_item === 'EPI' || it.tipo_item === 'VESTIMENTA') && it.entrega_individual !== false; },
    almRegistrarEntradaPatrimonio: async function (p) { ch.entrada.push(p); return { ok: true }; },
    sbUpdate: async function (t, p) { ch.sbUpdate.push([t, p]); return true; },
    almReqGarantirEpisDaFicha: async function () { return []; },
    aplicarAssinaturaEpis: function () {},
    aplicarAssinaturaFicha: function (fi) { ch.assinou.push(fi.id); },
    almReqMarcarFilaAssinada: async function (fi) { ch.marcou.push(fi.id); },
    dataHoje: function () { return '2026-09-29'; },
    _escapeHtml: function (s) { return String(s); },
    fetch: async function (url, init) {
      ch.fetch.push([url, JSON.parse(init.body)]);
      const lista = Array.isArray(opts.resposta) ? opts.resposta : [opts.resposta];
      const r = lista[Math.min(nResp++, lista.length - 1)] || { status: 404, body: { code: 'PGRST202', message: 'Could not find the function' } };
      return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async function () { return JSON.stringify(r.body); } };
    }
  };
  vm.createContext(sb);
  vm.runInContext(codigo, sb);
  return { sb: sb, ch: ch };
}
function reqTransf(entregueColab, extra) {
  return Object.assign({
    id: 'r1', numero: 'REQ-CENA-000900', status: 'recebida', deposito_id: 'orig', deposito_nome: 'Matriz', contrato_id: 'ctr1',
    dest_base_id: 'b2', dest_deposito_id: 'dest', dest_deposito_nome: 'CAMACAM CENA',
    itens: [{ id: 'it1', tipo_item: 'VESTIMENTA', entrega_individual: true, item_id: 'cat-calca', item_codigo: 'CAL-01',
      item_descricao: 'Calça NR-10 GG', quantidade_solicitada: 2, quantidade_aprovada: 2, quantidade_separada: 2, quantidade_atendida: 2,
      quantidade_entregue_colab: entregueColab, colaborador_id: 'c1', colaborador_nome: 'ARTEMUS', colaborador_re: '673',
      status: 'recebido', observacao: '[ENTREGA:FICHA:F1]' }]
  }, extra || {});
}
function carregar(t, reqs) {
  t.sb._almReq.lista = reqs;
  t.sb._almReq.itens = {};
  reqs.forEach(function (r) { t.sb._almReq.itens[r.id] = r.itens; });
}
const MSG = 'Atualização do controle de estoque pendente.\nEsta operação está temporariamente indisponível até a atualização do banco ser concluída.';
const FICHA = { id: 'F1', colaborador_nome: 'ARTEMUS' };

(async function () {
  // Reserva no destino até a entrega ao colaborador
  let t = montar();
  let d = reqTransf(0);
  carregar(t, [d]);
  ok('destino: recebido aguardando colaborador fica reservado', t.sb.almReqReservaEstoque('cat-calca', 'CAL-01', 'dest', 'Calça NR-10 GG') === 2);
  ok('destino: disponível 0', t.sb.almReqDisponivel('cat-calca', 'CAL-01', 'dest', 'Calça NR-10 GG') === 0);
  ok('origem: sem reserva residual', t.sb.almReqReservaEstoque('cat-calca', 'CAL-01', 'orig', 'Calça NR-10 GG') === 0);
  ok('destino: exclui a própria requisição', t.sb.almReqReservaEstoque('cat-calca', 'CAL-01', 'dest', 'Calça NR-10 GG', 'r1') === 0);
  d.itens[0].quantidade_entregue_colab = 2;
  ok('destino: entregue ao colaborador libera a reserva', t.sb.almReqReservaEstoque('cat-calca', 'CAL-01', 'dest', 'Calça NR-10 GG') === 0);
  d.itens[0].quantidade_entregue_colab = null;
  ok('destino: regra anterior (NULL) não reserva', t.sb.almReqReservaEstoque('cat-calca', 'CAL-01', 'dest', 'Calça NR-10 GG') === 0);
  const mesmo = reqTransf(0, { id: 'r2', dest_deposito_id: 'orig', dest_deposito_nome: 'Matriz' });
  mesmo.itens[0].id = 'it2';
  carregar(t, [mesmo]);
  ok('mesmo depósito: sem reserva de destino', t.sb.almReqReservaEstoque('cat-calca', 'CAL-01', 'orig', 'Calça NR-10 GG') === 0);

  // Assinatura com baixa no destino
  t = montar({ resposta: { status: 200, body: { ok: true, quantidade_total: 2, itens: [{ item_req_id: 'it1', quantidade: 2, movimentos: [{ mov_id: 'm9', estoque_id: 'ed', quantidade: 2 }] }] } } });
  d = reqTransf(0);
  carregar(t, [d]);
  await t.sb.almReqConfirmarAssinaturaFicha(Object.assign({}, FICHA), 'b64');
  let body = t.ch.fetch[0] && t.ch.fetch[0][1];
  ok('assinatura chama fn_alm_req_entregar_colaborador', t.ch.fetch.length === 1 && /\/rpc\/fn_alm_req_entregar_colaborador$/.test(t.ch.fetch[0][0]));
  ok('assinatura envia requisição, itens, chave da ficha e ficha', body && body.p_requisicao_id === 'r1' && JSON.stringify(body.p_item_req_ids) === '["it1"]'
    && body.p_chave === 'colab:F1' && body.p_ficha_id === 'F1' && body.p_usuario_id === 'u1', body);
  ok('assinatura aplicada depois da baixa', t.ch.assinou.join() === 'F1' && t.ch.marcou.join() === 'F1');
  ok('baixa local no destino (2→0) e origem intacta', t.sb.estoque[1].saldo === 0 && t.sb.estoque[0].saldo === 8);
  ok('movimentação local no nome do colaborador', t.sb.movimentacoes_itens.length === 1 && t.sb.movimentacoes_itens[0].colaborador_id === 'c1'
    && t.sb.movimentacoes_itens[0].deposito_id === 'dest' && t.sb.movimentacoes_itens[0].motivo === 'Entrega ao colaborador — requisição CENA', t.sb.movimentacoes_itens);
  ok('quantidade_entregue_colab local = 2', d.itens[0].quantidade_entregue_colab === 2);
  ok('trava de assinatura liberada', t.sb._almReq.assinando === false);

  // Sem saldo no destino: bloqueia e não assina
  const msgSaldo = 'Saldo insuficiente em CAMACAM CENA para Calça NR-10 GG: físico 0, reservado para outras 0, necessário 2. Nada foi baixado e a ficha não foi assinada.';
  t = montar({ resposta: { status: 200, body: { ok: false, codigo: 'SALDO_DESTINO_INSUFICIENTE', msg: msgSaldo } } });
  d = reqTransf(0);
  carregar(t, [d]);
  await t.sb.almReqConfirmarAssinaturaFicha(Object.assign({}, FICHA), 'b64');
  ok('sem saldo: não assina nem marca a fila', t.ch.assinou.length === 0 && t.ch.marcou.length === 0);
  ok('sem saldo: mensagem do banco', t.ch.alert[0] === msgSaldo && t.ch.toast.some(function (x) { return x[0] === msgSaldo && x[1] === 'erro'; }));
  ok('sem saldo: nada baixado localmente', t.sb.estoque[1].saldo === 2 && t.sb.movimentacoes_itens.length === 0 && d.itens[0].quantidade_entregue_colab === 0);

  // Migration ausente: fail-closed
  t = montar();
  d = reqTransf(0);
  carregar(t, [d]);
  await t.sb.almReqConfirmarAssinaturaFicha(Object.assign({}, FICHA), 'b64');
  ok('sem migration: aviso exato e não assina', t.ch.alert[0] === MSG && t.ch.assinou.length === 0);

  t = montar({ resposta: { status: 500, body: { message: 'boom' } } });
  d = reqTransf(0);
  carregar(t, [d]);
  await t.sb.almReqConfirmarAssinaturaFicha(Object.assign({}, FICHA), 'b64');
  ok('erro do banco: não assina', t.ch.assinou.length === 0 && t.ch.alert.length === 1);

  // Regra anterior / mesmo depósito: só documenta
  t = montar();
  d = reqTransf(null);
  carregar(t, [d]);
  await t.sb.almReqConfirmarAssinaturaFicha(Object.assign({}, FICHA), 'b64');
  ok('regra anterior: assina sem chamar o banco e sem baixa', t.ch.fetch.length === 0 && t.ch.assinou.join() === 'F1' && t.sb.estoque[1].saldo === 2);

  // Assinatura reenviada: idempotente
  t = montar({ resposta: { status: 200, body: { ok: true, idempotente: true, msg: 'Esta entrega ao colaborador já foi registrada.' } } });
  d = reqTransf(0);
  carregar(t, [d]);
  await t.sb.almReqConfirmarAssinaturaFicha(Object.assign({}, FICHA), 'b64');
  ok('idempotente: assina sem nova baixa local', t.ch.assinou.join() === 'F1' && t.sb.estoque[1].saldo === 2 && d.itens[0].quantidade_entregue_colab === 2);

  // Duplo clique
  t = montar({ resposta: { status: 200, body: { ok: true, itens: [] } } });
  d = reqTransf(0);
  carregar(t, [d]);
  t.sb._almReq.assinando = true;
  await t.sb.almReqConfirmarAssinaturaFicha(Object.assign({}, FICHA), 'b64');
  ok('assinatura em andamento: ignora o segundo clique', t.ch.fetch.length === 0 && t.ch.assinou.length === 0);

  // Ficha identificada pela chave da fila (sem tag FICHA)
  t = montar({ resposta: { status: 200, body: { ok: true, itens: [{ item_req_id: 'it1', quantidade: 2, movimentos: [] }] } } });
  d = reqTransf(0);
  d.itens[0].observacao = '[ENTREGA:PENDENTE]';
  carregar(t, [d]);
  await t.sb.almReqConfirmarAssinaturaFicha({ id: 'F2', _reqKey: 'r1|c1' }, 'b64');
  ok('ficha pela chave da fila: baixa os itens do colaborador', t.ch.fetch.length === 1 && t.ch.fetch[0][1].p_chave === 'colab:F2');

  // Recebimento: marca pendência local para a assinatura chamar o banco sem recarregar
  t = montar({ resposta: { status: 200, body: { ok: true, status: 'recebida', legado: false,
    itens: [{ item_req_id: 'it1', item_id: 'cat-calca', quantidade: 2, entrega_colaborador_pendente: true }] } } });
  d = reqTransf(undefined, { status: 'entregue' });
  delete d.itens[0].quantidade_entregue_colab;
  d.itens[0].status = 'entregue'; d.itens[0].observacao = null;
  t.sb._almReq.draft = d;
  await t.sb.almReqConfirmarRecebimento();
  ok('recebimento: item fica aguardando colaborador (0)', d.itens[0].quantidade_entregue_colab === 0);
  ok('recebimento: entrada no destino', t.ch.entrada.length === 1 && t.ch.entrada[0].deposito_id === 'dest' && t.ch.entrada[0].quantidade === 2);
  ok('recebimento: avisa que a baixa é na assinatura', t.ch.toast.some(function (x) { return /baixa o estoque do destino na assinatura/.test(x[0]); }));

  t = montar({ resposta: { status: 200, body: { ok: true, status: 'recebida', legado: false, itens: [{ item_req_id: 'it1', item_id: 'cat-calca', quantidade: 2 }] } } });
  d = reqTransf(undefined, { status: 'entregue' });
  delete d.itens[0].quantidade_entregue_colab;
  d.itens[0].status = 'entregue'; d.itens[0].observacao = null;
  t.sb._almReq.draft = d;
  await t.sb.almReqConfirmarRecebimento();
  ok('recebimento regra anterior: sem pendência de baixa', d.itens[0].quantidade_entregue_colab === undefined);

  // Saída local de transferência
  t = montar();
  d = reqTransf(null, { status: 'entregue' });
  t.sb.almReqAplicarMovsLocais(d, d.itens[0], { transferencia: true, movimentos: [{ mov_id: 'm1', estoque_id: 'eo', quantidade: 2 }] }, 'Requisição CENA REQ-CENA-000900');
  let mv = t.sb.movimentacoes_itens[0];
  ok('saída de transferência: sem colaborador, motivo transferência', mv.colaborador_id === null && mv.motivo === 'Transferência requisição CENA — saída'
    && /transferência para CAMACAM CENA/.test(mv.obs) && t.sb.estoque[0].saldo === 6, mv);
  t = montar();
  t.sb.almReqAplicarMovsLocais(d, d.itens[0], { transferencia: false, movimentos: [{ mov_id: 'm2', estoque_id: 'eo', quantidade: 1 }] }, 'x');
  mv = t.sb.movimentacoes_itens[0];
  ok('saída no mesmo depósito: no nome do colaborador', mv.colaborador_id === 'c1' && mv.motivo === 'Entrega requisição CENA', mv);

  // Fila: depósito onde o material está
  t = montar();
  d = reqTransf(0);
  carregar(t, [d]);
  const fila = t.sb.almReqFilaEntregas();
  ok('fila mostra o depósito destino', fila.length === 1 && fila[0].deposito_nome === 'CAMACAM CENA', fila);

  // Estáticos
  ok('fila/modal não afirmam mais que o estoque já foi baixado', !/Estoque já baixado no depósito\. Gere/.test(html) && !/Estoque do depósito já foi baixado\./.test(html));
  const assin = fn('almReqConfirmarAssinaturaFicha');
  ok('assinatura: baixa antes de aplicar a assinatura', assin.indexOf('almReqBaixarEntregaColab(') >= 0 && assin.indexOf('almReqBaixarEntregaColab(') < assin.indexOf('aplicarAssinaturaFicha('));
  ok('baixa ao colaborador sem UPDATE direto', !/sbUpdate\(|sbInsert\(/.test(fn('almReqBaixarEntregaColab')));
  ok('versão 8.1.165', /numero: '8\.1\.165'/.test(html) && /\{v:'8\.1\.165'/.test(html));
  ok('sw 8.1.165', /'cena-8\.1\.165'/.test(sw));
  const mig = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260929120000_alm_req_entrega_colaborador.sql'), 'utf8');
  const migSem = mig.replace(/--[^\n]*/g, '');
  ok('migration não toca alm_movimentos', !/alm_movimentos/.test(migSem));
  ok('migration sem DROP TABLE/DROP COLUMN/ALTER COLUMN/DELETE/TRUNCATE', !/\bDROP TABLE\b|\bDROP COLUMN\b|\bALTER COLUMN\b|\bDELETE FROM\b|\bTRUNCATE\b/i.test(migSem));
  ok('migration: única coluna nova é quantidade_entregue_colab', (migSem.match(/ADD COLUMN/gi) || []).length === 1 && /ADD COLUMN IF NOT EXISTS quantidade_entregue_colab numeric/.test(migSem));
  ok('migration: não recalcula histórico (sem UPDATE em massa fora das funções)', (function () {
    const fora = migSem.replace(/\$\$[\s\S]*?\$\$/g, '');
    return !/\bUPDATE\s+(public\.)?\w+\s+SET\b/i.test(fora) && !/\bINSERT INTO\b/i.test(fora);
  })());
  ok('recebimento no banco não mexe em estoque/movimentos', (function () {
    const i = migSem.indexOf('FUNCTION public.fn_alm_req_confirmar_recebimento');
    const f = migSem.slice(i, migSem.indexOf('$$;', i));
    return !/UPDATE public\.estoque|INSERT INTO public\.movimentacoes_itens/.test(f);
  })());

  if (failed.length) { console.error('FALHOU:\n- ' + failed.join('\n- ')); process.exit(1); }
  console.log('alm-req-entrega-colab-ui: OK (' + total + ' verificações)');
})().catch(function (e) { console.error(e); process.exit(1); });
