'use strict';
// Ambiente vm compartilhado pelos testes da Etapa 1.5b-2 (WL na medição, seletores, PLPT, validação e Jornada).
// Roda as funções de QUALQUER versão do index.html (atual ou a de antes, via git) com os mesmos dados: projeto legado
// (sem WL) e projeto com WL (espelho do TESTE 1 — das123). Não acessa rede nem banco: sbFetch/sbInsert/sbUpdate são stubs.
const vm = require('vm');

const FUNCOES = [
  'parseJsonField', 'sotCalcReservaMat', 'sotSplitReservaQtd',
  'sotRenderMedicaoBody', 'sotAdicionarItensMedicao',
  'sotRenderTabReserva', 'sotEnviarRequisicao', 'sotAbrirModalAdicionalReserva', 'sotLiberarRequisicoesAdicional',
  'plptMateriaisRetiradosMap', 'plptMatRetiradoQtd', 'plptProjetoFaseExecucao', 'plptRequisicoesEmCampo',
  'plptTemRequisicaoPendente', 'plptQtdEntregueItem', 'plptFmtTs', 'plptBuildAbaCampo', 'plptEnviarReservaInline',
  'plptGerarDePara', 'plptLancarMaterial', 'plptLancarAtividade', 'plptLancarViabilidadeAtividade',
  'nrmAtualizarMateriais', 'sotRenderListaValidacoes', 'sotValidarLancamento'
];

function fnTexto(html, nome) {
  const m = new RegExp('\\n(?:async )?function ' + nome + '\\(').exec(html);
  if (!m) throw new Error('função não encontrada: ' + nome);
  const re = /\n(?:async function |function |var |\/\/ ═)/g;
  re.lastIndex = m.index + 12;
  const f = re.exec(html);
  return html.slice(m.index + 1, f ? f.index : undefined);
}

function blocoWl(html) {
  const i = html.indexOf('// ETAPA 1.5a — WL oficial nas telas do projeto');
  const f = html.indexOf('\nfunction renderProjetosPorContrato(', i);
  if (i < 0 || f < 0) throw new Error('bloco 1.5a não encontrado');
  return html.slice(i, f);
}

// ── Dados ───────────────────────────────────────────────────────
const PL = 'proj-legado';
const PW = 'proj-wl';
const W1 = 'wl-0001', W2 = 'wl-0002';
const WLS = [{ id: W1, projeto_id: PW, codigo: '1', ordem: 1 }, { id: W2, projeto_id: PW, codigo: '2', ordem: 2 }];

function dados() {
  return {
    projetos: [
      { id: PL, nome: 'Obra legado', codigo_cliente: 'LEG-1', contrato_id: 'c1', modalidade: 'Preço unitário' },
      { id: PW, nome: 'TESTE 1', codigo_cliente: 'das123', contrato_id: 'c1', modalidade: 'Preço unitário' }
    ],
    atividades: [
      { id: 'a1', projeto_id: PL, codigo: '100', descricao: 'POSTE', unidade: 'UN', qtd_prevista: 4, qtd_viabilizada: 4, qtd_executada: 2, valor_unitario: 10 },
      { id: 'a2', projeto_id: PL, codigo: '100', descricao: 'POSTE (2)', unidade: 'UN', qtd_prevista: 1, qtd_viabilizada: 0, qtd_executada: 0, valor_unitario: 10 },
      { id: 'a3', projeto_id: PL, codigo: '200', descricao: 'CABO', unidade: 'M', qtd_prevista: 30, qtd_viabilizada: 30, qtd_executada: 30, valor_unitario: 2 },
      // projeto com WL: mesma linha de código em duas WLs; a da WL 2 vem antes para conferir a ordenação
      { id: 'w2a', projeto_id: PW, codigo: 'I-654321', descricao: 'SERVIÇO', unidade: 'UN', qtd_prevista: 1, qtd_executada: 0, valor_unitario: 5, wl_id: W2, ft: 'I', kit: 'S-654321', lms_linha_id: 'l2' },
      { id: 'w1a', projeto_id: PW, codigo: 'I-654321', descricao: 'SERVIÇO', unidade: 'UN', qtd_prevista: 1, qtd_executada: 1, valor_unitario: 5, wl_id: W1, ft: 'I', kit: 'S-654321', lms_linha_id: 'l1' },
      { id: 'w1b', projeto_id: PW, codigo: 'I-777', descricao: 'ÚNICO', unidade: 'UN', qtd_prevista: 2, qtd_executada: 0, valor_unitario: 5, wl_id: W1, ft: 'I', kit: 'S-777', lms_linha_id: 'l3' }
    ],
    materiais: [
      { id: 'm1', projeto_id: PL, codigo_sap: '324894', descricao: 'FIO AL', unidade: 'M', qtd_projetada: 10, qtd_viabilizada: 10, qtd_aplicada: 2 },
      { id: 'm2', projeto_id: PL, codigo_sap: '324894', descricao: 'FIO AL', unidade: 'M', qtd_projetada: 5, qtd_viabilizada: 0, qtd_aplicada: 0 },
      { id: 'm3', projeto_id: PL, codigo_sap: '999', descricao: 'ALCA', unidade: 'PC', qtd_projetada: 3, qtd_viabilizada: 3, qtd_aplicada: 0 },
      { id: 'mw2', projeto_id: PW, codigo_sap: '324894', descricao: 'FIO AL', unidade: 'M', qtd_projetada: 6, qtd_viabilizada: 6, qtd_aplicada: 0, wl_id: W2, ft: 'I', kit: 'NK-AMAR', lms_linha_id: 'l5', somente_descritivo: false },
      { id: 'mw1', projeto_id: PW, codigo_sap: '324894', descricao: 'FIO AL', unidade: 'M', qtd_projetada: 4, qtd_viabilizada: 4, qtd_aplicada: 0, wl_id: W1, ft: 'I', kit: 'NK-AMAR', lms_linha_id: 'l4', somente_descritivo: false },
      { id: 'mwr', projeto_id: PW, codigo_sap: '324894', descricao: 'FIO AL RETIRADO', unidade: 'M', qtd_projetada: 2, wl_id: W1, ft: 'R', kit: 'NK-AMAR', lms_linha_id: 'l6', somente_descritivo: true }
    ]
  };
}

function elemento(id) {
  const ls = {};
  return {
    id, innerHTML: '', value: '', checked: false, disabled: false, textContent: '', style: {}, dataset: {},
    options: [], selectedIndex: 0,
    classList: { contains: () => false, add() {}, remove() {} },
    addEventListener(t, f) { ls[t] = f; }, remove() { this.removido = true; },
    getAttribute() { return null; }
  };
}

// html = conteúdo do index.html (atual ou antigo); jornadaSrc = jornada-actions.js correspondente.
function montar(html, jornadaSrc, cfg) {
  cfg = cfg || {};
  const d = dados();
  const log = { modal: [], toast: [], insert: [], update: [], fetch: [], persistir: [], confirm: [] };
  const els = {};
  const el = id => els[id] || (els[id] = elemento(id));
  const sb = {
    console: { error() {}, warn() {}, log() {} },
    window: {}, DEMO: !!cfg.demo, SB: { url: 'https://x', key: 'k' },
    Promise, JSON, Math, Date, String, Number, Object, Array, isNaN, parseFloat, parseInt, encodeURIComponent, setTimeout: (f) => { if (cfg.rodarTimeouts) f(); return 0; },
    usuarioLogado: { id: 'u1', nome: 'Gestor', perfil: 'gestor' },
    sot_projetos: d.projetos,
    sot_atividades: d.atividades.slice(),
    sot_atividades_desc: [], sot_materiais_desc: [],
    sot_materiais_proj: d.materiais.slice(),
    sot_materiais: d.materiais.slice(),
    sot_medicoes: [], sot_med_itens: [], catalogo_materiais: [],
    MED_STATUS: { rascunho: { label: 'Rascunho' } },
    PLPT_REQ_STATUS_ATIVOS: ['Aguardando aprovação', 'Aprovada', 'Separação', 'Aguardando confirmação almox', 'Em campo', 'Aguardando devolução'],
    _plptDiario: { projetoAtivo: null, sessao: null },
    _dbEquipe: { id: 'eq1', codigo: 'EQ-1' }, _dbSessao: null, _sotProjetoAtual: null,
    escHtml: v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    _escapeHtml: v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    fmtMoeda: v => Number(v || 0).toFixed(2), fmtD: v => String(v || ''),
    dataHoje: () => '2026-10-12', dataHojeLocal: () => '2026-10-12',
    isUUID: v => /^[0-9a-f]{8}-/i.test(String(v)),
    setModal: h => log.modal.push(h), closeModal() {},
    confirm: m => { log.confirm.push(m); return cfg.confirmar !== false; },
    prompt: () => 'motivo',
    progShowToast: (m, t) => log.toast.push((t || 'ok') + ':' + m),
    rsvEquipesOptsHtml: () => '<option value="eq1">EQ-1</option>',
    sotCarregarHistoricoRequisicoes() {}, sotAtualizarAbaAtual() {}, sotRenderTabMedicao() {}, sotToggleMedicao() {},
    sotRecalcTotalMedicao() {}, plptSalvarRelatorioObras() {}, renderDiarioPlpt() {}, _plptRenderProjetoDetalhe() {},
    sotPersistirRequisicaoMateriais: (pid, itens, ctx, meta) => log.persistir.push({ pid, itens: JSON.parse(JSON.stringify(itens)), meta }),
    _semId: o => { const c = Object.assign({}, o); delete c.id; return c; },
    projLmsRpc: () => Promise.resolve({ ok: false, status: 404 }),
    sbFetch: (t, o) => { log.fetch.push({ t, f: (o && o.filters) || [] }); return Promise.resolve(cfg.sbFetch ? cfg.sbFetch(t, o) : []); },
    sbInsert: (t, p) => { log.insert.push({ t, p: JSON.parse(JSON.stringify(p)) }); return Promise.resolve([{ id: 'novo-' + log.insert.length }]); },
    sbUpdate: (t, p, f) => { log.update.push({ t, p: JSON.parse(JSON.stringify(p)), f }); return Promise.resolve(true); },
    document: { getElementById: id => els[id] || null, querySelector: () => null }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(blocoWl(html), sb);
  vm.runInContext(FUNCOES.map(n => fnTexto(html, n)).join('\n'), sb);
  if (jornadaSrc) vm.runInContext(jornadaSrc, sb);
  if (cfg.wlCtx !== false) {
    vm.runInContext('_sotWlCtx = ' + JSON.stringify({ projetoId: PW, estado: 'ESTRUTURADO', estadoOk: true, wls: { [W1]: WLS[0], [W2]: WLS[1] }, wlsLista: WLS }) + ';', sb);
  }
  return { sb, log, els, el, d };
}

module.exports = { montar, fnTexto, blocoWl, FUNCOES, PL, PW, W1, W2, WLS, dados };
