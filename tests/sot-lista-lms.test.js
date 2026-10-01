'use strict';
// SOT 8.1.189 — Lista de Materiais e Serviços: planilha LMS lida só pela aba LMS; lançamento grava no projeto certo.
// Executa as funções reais do index.html em sandbox (DOM, SheetJS, sbFetch/sbInsert falsos).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const sw = fs.readFileSync(path.join(raiz, 'sw.js'), 'utf8');
const failed = [];
let total = 0;
function ok(name, cond, detail) { total++; if (!cond) failed.push(name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }

function fn(nome) {
  const re = new RegExp('\\n(?:async )?function ' + nome + '\\(');
  const n = html.split(re).length - 1;
  if (n !== 1) throw new Error('definição de ' + nome + ': ' + n);
  const ini = html.search(re) + 1;
  return html.slice(ini, html.indexOf('\n}\n', ini) + 2);
}
const vr = nome => { const i = html.indexOf('\nvar ' + nome + ' ') + 1; if (i < 1) throw new Error('var ' + nome); return html.slice(i, html.indexOf('\n', i)); };
const codigo = ['SOT_LMS_ABA_RE', 'SOT_LMS_EXTRACAO_RE', 'SOT_LMS_CONFERENCIA_MIN'].map(vr)
  .concat(['sotLmsNum', 'sotLmsNormCodProjeto', 'sotLmsNormCodMaterial', 'sotLmsExtrair', 'sotLmsLerPlanilha', 'sotLmsAplicar',
    '_sotPendentesDoModal', 'sotParseContratosIds', 'sotFiltrarMatsContrato', 'sotBuildListaAlmSAP', 'sotCarregarCatalogoAlmSAP',
    '_sotCatalogoAlmSAPContrato', '_sotLancarPendentes', 'sotSalvarProjeto', 'sotListaHandleFile'].map(fn)).join('\n');

const PID = '20002920-9d52-4b6d-878d-9870da3fb62a';
const CID = '3925df4e-7e39-498d-8c96-891a7f4d415c';
const NOVO_ID = '7a1c0e55-0000-4000-8000-000000000001';

// Aba LMS no formato da concessionária (cabeçalho na linha 15)
function lms(itens) {
  const l = [['GRI-EDBR-WKI-GRI-0160', '', '', '', 'LISTA DE MATERIAIS E SERVIÇOS'], ['Definição de projeto', '', '', 'DAC/S.NOR.26.00087'],
    ['RESUMO DE VALORES'], ['INVESTIMENTO', '', 99.25]];
  l.push(['PEP', 'FT', 'Código', 'Descrição', '', '', '', '', 'Quan. Plan', 'Quan. Real', 'Quan.UPS', 'Total R$']);
  itens.forEach(i => l.push(['INV', i[0], i[1], i[2], '', '', '', '', i[3], i[4] === undefined ? i[3] : i[4], i[5] || '', '']));
  l.push(['', '', '', '', '', '', '', '', '', '']);
  return l;
}
const ITENS = [
  ['I', 336822, 'CONEC,TERM,TORQ,BI', 6],
  ['I', 336839, 'PROTET BORR GRAMPO', 4],
  ['I', 336822, 'CONEC,TERM,TORQ,BI', 2],          // repetido: soma
  ['I', 348140, 'CABO XLPE 240', '1.250,5'],       // texto pt-BR
  ['I', 348165, 'TERMINAL', '', 3],                // sem Plan: usa Real
  ['R', 336839, 'PROTET BORR GRAMPO', 4],          // retirada de material: não entra
  ['I', 355521, 'SEM QTD', 0, 0],                  // sem quantidade: ignorado
  ['I', 'I-0336822', 'MO INSTAL CONECTOR', 6, 6, 1.2],
  ['R', 'R-0336839', 'MO RETIR PROTETOR', 4, 4, 0.8],
  ['I', 'I-AHO999', 'MO SEM CADASTRO', 1],
];
const EXTRACAO_205 = [['Definição do projeto', 'Worklocation', 'Material'], ['DAC/S.NOR.26.00087', 1, 336822], ['DAC/S.NOR.26.00087', 1, 336839],
  ['DAC/S.NOR.26.00087', 1, 348140]];
const EXTRACAO_RESB = [['Definição do projeto', 'Material'], ['DAC/S.NOR.26.00087', '000000000000348165']];

function sandbox(opts) {
  opts = opts || {};
  const els = {};
  const el = (id, value) => (els[id] = { id, value: value == null ? '' : value, isConnected: true, style: {}, innerHTML: '', textContent: '' });
  ['sot-lista-drop', 'sot-lista-status', 'sot-lista-ia-btn', 'sot-lista-b64', 'sot-lista-mime'].forEach(id => el(id));
  el('sot-p-codigo', opts.codigo == null ? 'DAC/S.NOR-26.00087' : opts.codigo);
  const c = {
    console, Promise, Math, Number, String, Object, Array, JSON, isFinite, setTimeout,
    DEMO: false, window: {}, toasts: [], inserts: [], fetches: [], abriu: [], renders: 0,
    document: { getElementById: id => els[id] || null },
    progShowToast(msg, tipo) { c.toasts.push({ msg, tipo: tipo || 'ok' }); },
    isUUID: s => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s)),
    sbFetch: async (t, o) => { c.fetches.push({ t, o }); if (opts.fetchFalha) return null; return (opts.atuais || {})[t] || []; },
    sbInsert: async (t, d) => { c.inserts.push({ t, d }); if ((opts.insertFalha || []).includes(t)) return null; return (Array.isArray(d) ? d : [d]).map((x, i) => Object.assign({ id: (t === 'sot_projetos' ? NOVO_ID : t + '-' + i) }, x)); },
    sbUpdate: async () => true,
    // catálogo sem vínculo com o contrato não serve; Almoxarifado SAP = Estoque SAP do contrato + materiais_sap
    catalogo_materiais: [{ codigo_sap: '348140', descricao: 'CABO SEM CONTRATO', unidade: 'KG' }],
    alm_movimentos: [{}], almCalcularSaldo() { c.saldoCalculado = (c.saldoCalculado || 0) + 1; },
    alm_estoque: opts.almEstoque || [
      { material_id: 'm1', contrato_id: CID, codigo_sap: '336822', material_desc: 'CONECTOR SAP', unidade: 'PC', saldo: 10 },
      { material_id: 'm2', contrato_id: 'outro', codigo_sap: '348140', material_desc: 'CABO OUTRO CONTRATO', unidade: 'M', saldo: 5 },
    ],
    mat_sap: [{ id: 'ms1', contrato_id: CID, codigo_sap: '000348165', descricao: 'TERMINAL SAP', unidade: 'CJ' }],
    servicos: [
      { id: 'sv1', contrato_id: CID, codigo: 'I-0336822', descricao: 'MO INSTAL CONECTOR', unidade: 'UN', qtd_ups: 0.2, valor_ups: 216.54, valor_hora: 0 },
      { id: 'sv2', contrato_id: CID, codigo: 'R-0336839', descricao: 'MO RETIR PROTETOR', unidade: 'UN', qtd_ups: 0.1, valor_ups: 0, valor_hora: 50 },
      { id: 'sv3', contrato_id: 'outro', codigo: 'I-AHO999', descricao: 'OUTRO CONTRATO', valor_ups: 1 },
    ],
    clientes: [{ id: 'cli1', razao_social: 'ENEL' }], tipos_servico_cad: [{ id: 'ts1', nome: 'Enterramento' }],
    sot_projetos: [{ id: 'antigo-1' }, { id: 'antigo-2' }], usuarioLogado: { nome: 'Teste' },
    _sotProjetoAtual: null,
    alert(m) { c.alerta = m; }, closeModal() { c.fechou = (c.fechou || 0) + 1; },
    sotAbrirProjeto(id) { c.abriu.push(id); }, sotRenderMetricas() {}, sotRenderProjetos() { c.renders++; },
    FileReader: class { readAsDataURL() { this.onload({ target: { result: 'data:x;base64,QUJD' } }); } },
  };
  vm.createContext(c);
  vm.runInContext(codigo, c);
  c.els = els;
  return c;
}
function XL(abas) {
  const lidas = [];
  return {
    lidas,
    read(b64, o) { if (o.bookSheets) return { SheetNames: Object.keys(abas) }; lidas.push(o.sheets); const S = {}; o.sheets.forEach(n => { S[n] = { aoa: abas[n] }; }); return { Sheets: S }; },
    utils: { sheet_to_json: ws => ws.aoa },
  };
}
const esperar = () => new Promise(r => setTimeout(r, 0));

(async () => {
  // ── extração ──
  const s = sandbox();
  const r = s.sotLmsExtrair('LMS - F', lms(ITENS), [{ nome: 'Extração_205', linhas: EXTRACAO_205 }, { nome: 'Extração_RESB', linhas: EXTRACAO_RESB }]);
  ok('sem erro', r.erro === '', r.erro);
  ok('materiais: só FT I, repetidos somados', JSON.stringify(r.materiais.map(m => [m.codigo, m.qtd])) === JSON.stringify([['336822', 8], ['336839', 4], ['348140', 1250.5], ['348165', 3]]), r.materiais);
  ok('serviços: I e R, código como na planilha', JSON.stringify(r.servicos.map(x => [x.codigo, x.qtd])) === JSON.stringify([['I-0336822', 6], ['R-0336839', 4], ['I-AHO999', 1]]), r.servicos);
  ok('retirada de material contada', r.retiradaMateriais === 1);
  ok('linha sem quantidade ignorada', r.semQtd === 1 && !r.materiais.some(m => m.codigo === '355521'));
  ok('projeto vem da extração SAP', r.projeto === 'DAC/S.NOR.26.00087');
  ok('conferência com zeros à esquerda da RESB', r.conferencia && r.conferencia.batem === 4 && r.conferencia.total === 4, r.conferencia);
  ok('descrição e origem no item', r.materiais[0].nome === 'CONEC,TERM,TORQ,BI' && r.materiais[0].obs === 'Planilha LMS — aba LMS - F');

  const velha = s.sotLmsExtrair('LMS - F', lms([['I', 321291, 'ISOLADOR', 12], ['I', 321322, 'ISOLAD PORCEL', 12], ['I', 336822, 'CONEC', 1]]),
    [{ nome: 'Extração_205', linhas: EXTRACAO_205 }]);
  ok('LMS desatualizada (1 de 3): recusa', /só 1 de 3 materiais aparecem na Extração_205\/RESB/.test(velha.erro) && /Atualizar Tudo/.test(velha.erro), velha.erro);
  const meio = s.sotLmsExtrair('LMS - F', lms([['I', 336822, 'A', 1], ['I', 999, 'B', 1]]), [{ nome: 'Extração_205', linhas: EXTRACAO_205 }]);
  ok('metade conferida: aceita', meio.erro === '' && meio.conferencia.batem === 1, meio.erro);
  const semEx = s.sotLmsExtrair('LMS - F', lms([['I', 321291, 'ISOLADOR', 12]]), []);
  ok('sem abas de extração: aceita sem conferência', semEx.erro === '' && semEx.conferencia === null && semEx.projeto === '');
  ok('sem cabeçalho: recusa', /sem a linha de cabeçalho/.test(s.sotLmsExtrair('LMS', [['a', 'b'], [1, 2]], []).erro));
  ok('sem itens: recusa', /sem itens com quantidade/.test(s.sotLmsExtrair('LMS', lms([['I', 1, 'x', 0, 0]]), []).erro));
  ok('número pt-BR', s.sotLmsNum('1.234,5') === 1234.5 && s.sotLmsNum(1.672) === 1.672 && s.sotLmsNum('x') === 0 && s.sotLmsNum('') === 0);

  // ── leitura da planilha ──
  const xl = XL({ 'Extração_205': EXTRACAO_205, 'Extração_RESB': EXTRACAO_RESB, 'Inventário WL Comp.': [['lixo']], 'LMS - F': lms(ITENS), 'DINAMICALMS2': [['PEP']], 'TABELA MARA': [['x']] });
  const lida = s.sotLmsLerPlanilha(xl, 'QUJD');
  ok('lê só a aba LMS e as extrações (não as 3 primeiras, nem DINAMICALMS2/TABELA MARA)', JSON.stringify(xl.lidas) === JSON.stringify([['LMS - F', 'Extração_205', 'Extração_RESB']]), xl.lidas);
  ok('leitura: mesmo resultado da extração', lida.aba === 'LMS - F' && lida.materiais.length === 4 && lida.servicos.length === 3);
  ok('planilha sem aba LMS: null (segue a análise com IA)', s.sotLmsLerPlanilha(XL({ Plan1: [['a']] }), 'QUJD') === null);

  // ── aplicar no modal ──
  {
    const c = sandbox();
    ok('aplicar: aceita', c.sotLmsAplicar(lida, c.els['sot-lista-status']) === true);
    ok('aplicar: pendentes preparados e presos ao modal', c.window._sotPendingMateriais.length === 4 && c.window._sotPendingServicos.length === 3 && c.window._sotPendingModalRef === c.els['sot-lista-drop']);
    ok('aplicar: status mostra aba, conferência e retirada', /Aba "LMS - F": 4 material\(is\) e 3 serviço\(s\).*4\/4 materiais conferidos.*1 material\(is\) de retirada/.test(c.els['sot-lista-status'].textContent), c.els['sot-lista-status'].textContent);
  }
  {
    const c = sandbox({ codigo: 'DAC/S.NOR-25.00228' });
    ok('projeto diferente do aberto: recusa', c.sotLmsAplicar(lida, c.els['sot-lista-status']) === false && c.window._sotPendingMateriais === null
      && /A planilha é do projeto DAC\/S\.NOR\.26\.00087 e este projeto é DAC\/S\.NOR-25\.00228/.test(c.toasts[0].msg), c.toasts);
  }
  {
    const c = sandbox({ codigo: '' });
    c.sotLmsAplicar(lida, c.els['sot-lista-status']);
    ok('código vazio: preenche com o da extração', c.els['sot-p-codigo'].value === 'DAC/S.NOR.26.00087');
  }
  {
    const c = sandbox();
    c.sotLmsAplicar(velha, c.els['sot-lista-status']);
    ok('LMS desatualizada: nada pendente e aviso de erro', c.window._sotPendingMateriais === null && c.toasts[0].tipo === 'erro' && /Nada foi preparado/.test(c.els['sot-lista-status'].textContent));
  }

  // ── pendentes presos ao modal ──
  {
    const c = sandbox();
    c.sotLmsAplicar(lida, null);
    c.els['sot-lista-drop'].isConnected = false;
    ok('modal fechado: lista descartada', c._sotPendentesDoModal() === null && c.window._sotPendingMateriais === null);
    c.sotLmsAplicar(lida, null);
    c.els['sot-lista-drop'] = { isConnected: true };
    ok('outro modal aberto: lista descartada', c._sotPendentesDoModal() === null);
    c.sotLmsAplicar(lida, null);
    c.sotListaHandleFile({ name: 'outra.xlsx', type: '' });
    ok('arquivo novo descarta a análise anterior', c._sotPendentesDoModal() === null);
  }

  // ── lançar ──
  {
    const c = sandbox({ atuais: { sot_materiais: [{ codigo_sap: '336839' }], sot_atividades: [{ codigo: 'r-0336839' }] } });
    c._sotProjetoAtual = PID;
    await c._sotLancarPendentes(PID, CID, { materiais: lida.materiais, servicos: lida.servicos });
    const im = c.inserts.find(i => i.t === 'sot_materiais'), is = c.inserts.find(i => i.t === 'sot_atividades');
    ok('lançar: um lote por tabela', c.inserts.length === 2 && Array.isArray(im.d) && Array.isArray(is.d));
    ok('materiais: colunas reais de sot_materiais', im.d.every(m => m.projeto_id === PID && 'codigo_sap' in m && 'descricao' in m && 'qtd_projetada' in m && m.qtd_requisitada === 0
      && !('codigo' in m) && !('nome' in m) && !('quantidade' in m) && !('status' in m) && !('catalogo_id' in m)), im.d[0]);
    ok('materiais: já existente não duplica', JSON.stringify(im.d.map(m => m.codigo_sap)) === JSON.stringify(['336822', '348140', '000348165']), im.d.map(m => m.codigo_sap));
    ok('materiais: descrição e unidade do Almoxarifado SAP do contrato', im.d[0].descricao === 'CONECTOR SAP' && im.d[0].unidade === 'PC' && im.d[0].qtd_projetada === 8
      && im.d[0].observacao === 'Planilha LMS — aba LMS - F', im.d[0]);
    ok('materiais: código com zeros à esquerda no SAP encontrado', im.d[2].descricao === 'TERMINAL SAP' && im.d[2].unidade === 'CJ' && im.d[2].qtd_projetada === 3, im.d[2]);
    ok('materiais: SAP de outro contrato e catálogo sem vínculo não são usados', im.d[1].descricao === 'CABO XLPE 240' && im.d[1].unidade === 'UN'
      && im.d[1].observacao === 'Planilha LMS — aba LMS - F · sem cadastro no Almoxarifado SAP do contrato', im.d[1]);
    ok('serviços: colunas reais de sot_atividades', is.d.every(a => a.projeto_id === PID && 'qtd_prevista' in a && a.status === 'pendente' && !('nome' in a) && !('quantidade' in a) && !('tipo_servico_id' in a) && !('valor_total' in a)), is.d[0]);
    ok('serviços: já existente (maiúsc./minúsc.) não duplica', JSON.stringify(is.d.map(a => a.codigo)) === JSON.stringify(['I-0336822', 'I-AHO999']), is.d.map(a => a.codigo));
    ok('serviços: ligados ao cadastro do contrato com valor UPS', is.d[0].servico_id === 'sv1' && is.d[0].valor_unitario === 216.54 && is.d[0].qtd_prevista === 6);
    ok('serviços: cadastro de outro contrato não é usado', is.d[1].servico_id === null && is.d[1].valor_unitario === 0
      && /sem cadastro na lista de serviços do contrato$/.test(is.d[1].observacoes) && !/sem cadastro/.test(is.d[0].observacoes), is.d.map(a => a.observacoes));
    ok('serviços: ordem continua após os existentes', is.d[0].ordem_exec === 2 && is.d[1].ordem_exec === 3);
    const t = c.toasts[c.toasts.length - 1];
    ok('aviso: lançados, mantidos e sem cadastro', t.tipo === 'ok' && /Lançados no projeto: 3 material\(is\) e 2 serviço\(s\)/.test(t.msg) && /2 já existiam/.test(t.msg) && /1 serviço\(s\) sem cadastro no contrato \(sem valor\): I-AHO999/.test(t.msg)
      && /1 material\(is\) sem cadastro no Almoxarifado SAP do contrato: 348140/.test(t.msg), t.msg);
    ok('projeto aberto é recarregado', c.abriu.includes(PID));
  }
  {
    const c = sandbox();
    await c._sotLancarPendentes(PID, CID, { materiais: [], servicos: [{ codigo: 'R-0336839', nome: 'MO RETIR', qtd: 2 }] });
    const is = c.inserts.find(i => i.t === 'sot_atividades');
    ok('serviço sem UPS usa valor hora', is.d[0].valor_unitario === 50 && is.d[0].servico_id === 'sv2');
    ok('só serviços: aviso não cita 0 materiais', !/material/.test(c.toasts[0].msg), c.toasts[0].msg);
    ok('só serviços: catálogo SAP não é carregado', !c.saldoCalculado);
  }
  {
    const c = sandbox({ fetchFalha: true });
    await c._sotLancarPendentes(PID, CID, { materiais: lida.materiais, servicos: [] });
    ok('leitura da lista atual falhou: nada gravado', c.inserts.length === 0 && /nada foi lançado/.test(c.toasts[0].msg) && c.toasts[0].tipo === 'erro');
  }
  {
    const c = sandbox({ insertFalha: ['sot_atividades'] });
    await c._sotLancarPendentes(PID, CID, { materiais: lida.materiais, servicos: lida.servicos });
    ok('erro ao gravar serviços: avisa', c.toasts[0].tipo === 'erro' && /Erro ao gravar os serviços/.test(c.toasts[0].msg) && /4 material\(is\)/.test(c.toasts[0].msg), c.toasts[0].msg);
  }
  {
    const c = sandbox();
    await c._sotLancarPendentes('sp123', CID, { materiais: lida.materiais, servicos: [] });
    ok('id local (sem banco): não grava', c.inserts.length === 0 && c.toasts[0].tipo === 'erro');
  }
  {
    // IA genérica (sem LMS): campos codigo/nome/qtd/unidade continuam aceitos
    const c = sandbox();
    await c._sotLancarPendentes(PID, CID, { materiais: [{ codigo: '', nome: 'Cabo 35mm²', qtd: 100, unidade: 'm' }], servicos: [{ tipo_id: 'ts1', nome: 'Instalação de poste', qtd: 5 }] });
    const im = c.inserts.find(i => i.t === 'sot_materiais'), is = c.inserts.find(i => i.t === 'sot_atividades');
    ok('IA genérica: material sem código grava com descrição', im.d[0].descricao === 'Cabo 35mm²' && im.d[0].unidade === 'm' && im.d[0].qtd_projetada === 100 && im.d[0].observacao === 'Lançado pela IA · sem cadastro no Almoxarifado SAP do contrato', im.d[0]);
    ok('IA genérica: serviço sem código grava sem cadastro', is.d[0].descricao === 'Instalação de poste' && is.d[0].servico_id === null && !('tipo_id' in is.d[0]));
  }

  // ── salvar projeto ──
  {
    const c = sandbox();
    Object.assign(c.els, {
      'sot-p-nome': { value: 'AC - Alteração de Carga' }, 'sot-p-cliente-id': { value: 'cli1' }, 'sot-p-tipo-id': { value: 'ts1' }, 'sot-p-cont': { value: CID },
    });
    c.sotLmsAplicar(lida, null);
    c.sotSalvarProjeto(null);
    await esperar(); await esperar(); await esperar(); await esperar();
    const ins = c.inserts.filter(i => i.t !== 'sot_projetos' && i.t !== 'sot_projetos_historico');
    ok('projeto novo: lista lançada no id devolvido pelo insert', ins.length === 2 && ins.every(i => i.d.every(x => x.projeto_id === NOVO_ID)), ins.map(i => ({ t: i.t, n: i.d.length, ids: [...new Set(i.d.map(x => x.projeto_id))] })));
    ok('projeto novo: nunca no projeto mais antigo da lista', !ins.some(i => i.d.some(x => /antigo/.test(x.projeto_id))));
  }
  {
    const c = sandbox({ insertFalha: ['sot_projetos'] });
    Object.assign(c.els, { 'sot-p-nome': { value: 'X' }, 'sot-p-cliente-id': { value: 'cli1' }, 'sot-p-tipo-id': { value: 'ts1' }, 'sot-p-cont': { value: CID } });
    c.sotLmsAplicar(lida, null);
    c.sotSalvarProjeto(null);
    await esperar(); await esperar();
    ok('projeto não gravado: lista não lançada e aviso', c.inserts.every(i => i.t === 'sot_projetos') && c.toasts.some(t => /lista de materiais e serviços não foi lançada/.test(t.msg)));
  }
  {
    const c = sandbox();
    Object.assign(c.els, { 'sot-p-nome': { value: 'X' }, 'sot-p-cliente-id': { value: 'cli1' }, 'sot-p-tipo-id': { value: 'ts1' }, 'sot-p-cont': { value: CID } });
    c.sot_projetos.push({ id: PID, status: 'Recebido' });
    c.sotLmsAplicar(lida, null);
    c.sotSalvarProjeto(PID);
    await esperar(); await esperar(); await esperar();
    const ins = c.inserts;
    ok('editar projeto: lista lançada no próprio projeto', ins.length === 2 && ins.every(i => i.d.every(x => x.projeto_id === PID)), ins.map(i => i.t));
  }
  {
    const c = sandbox();
    Object.assign(c.els, { 'sot-p-nome': { value: '' } });
    c.sotLmsAplicar(lida, null);
    c.sotSalvarProjeto(PID);
    ok('validação falhou (sem nome): lista continua pendente', c.alerta && c.window._sotPendingMateriais && c.window._sotPendingMateriais.length === 4);
  }

  // ── estático ──
  ok('sem _editandoProjetoId nem "último projeto da lista"', !/_editandoProjetoId/.test(html) && !/sot_projetos\[sot_projetos\.length-1\]/.test(html));
  ok('upload aceita .xlsb', html.includes('accept=".pdf,.xlsx,.xls,.xlsb,.xlsm,.doc,.docx,.png,.jpg,.jpeg"'));
  ok('sotAnalisarListaIA usa a leitura LMS antes da IA', /lms = sotLmsLerPlanilha\(XLSX, b64\);[\s\S]{0,400}sotLmsAplicar\(lms, st\);[\s\S]{0,200}return;[\s\S]{0,200}Convertendo Excel para texto/.test(fn('sotAnalisarListaIA')));
  ok('versão 8.1.189 no log', /\{v:'8\.1\.189'/.test(html));
  const num = /numero: '(8\.1\.\d+)'/.exec(html)[1];
  ok('sw.js na versão atual', sw.includes("'cena-" + num + "'"), num);

  if (failed.length) { console.error('FALHOU ' + failed.length + '/' + total + ':\n - ' + failed.join('\n - ')); process.exit(1); }
  console.log('sot-lista-lms: ' + total + ' verificações OK');
})().catch(e => { console.error(e); process.exit(1); });
