// Importar lista (colar do Excel) no projeto: serviços + materiais, parser TAB/pt-BR, gravação nas colunas reais.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
let falhas = 0, total = 0;
function ok(nome, cond, extra) {
  total++;
  if (!cond) { falhas++; console.error('FALHOU: ' + nome + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); }
}
function fn(nome) {
  const re = new RegExp('\\n(?:async )?function ' + nome + '\\(');
  const n = html.split(re).length - 1;
  if (n !== 1) throw new Error('definição de ' + nome + ': ' + n);
  const ini = html.search(re) + 1;
  return html.slice(ini, html.indexOf('\n}\n', ini) + 2);
}
const vr = nome => { const i = html.indexOf('\nvar ' + nome + ' ') + 1; if (i < 1) throw new Error('var ' + nome); return html.slice(i, html.indexOf('\n', i)); };
const codigo = [vr('SOT_IMP_NUM_RE')].concat(['sotLmsNum', 'sotLmsNormCodMaterial', 'sotTextoBinario', 'sotParseContratosIds', 'sotFiltrarMatsContrato',
  'sotBuildListaAlmSAP', 'sotCarregarCatalogoAlmSAP', '_sotCatalogoAlmSAPContrato', 'sotImportarAtividades', '_sotSplitCamposLinha',
  '_sotLinhaEhCabecalhoImport', '_sotExtrairCodQtdLinha', 'sotParsarLinhasImportacao', '_sotChaveMatImport', '_sotClassificarImportacao',
  '_sotValorServ', 'sotPreviewImportacao', 'sotConfirmarImportacao', '_escapeHtml'].map(fn)).join('\n');

const PID = '20002920-9d52-4b6d-878d-9870da3fb62a';
const CID = '3925df4e-7e39-498d-8c96-891a7f4d415c';

function sandbox(opts) {
  opts = opts || {};
  const els = {};
  const c = {
    console, Promise, Math, Number, String, Object, Array, JSON, isFinite, setTimeout, RegExp,
    DEMO: false, window: {}, toasts: [], inserts: [], updates: [], abriu: [], fechou: 0,
    document: { getElementById: id => els[id] || null },
    setModal(h) { c.modal = h; ['sot-imp-texto', 'sot-imp-preview', 'sot-imp-btn'].forEach(id => { els[id] = { id, value: '', style: {}, innerHTML: '', textContent: '✅ Importar', disabled: false, focus() {} }; }); },
    closeModal() { c.fechou++; },
    alert(m) { c.alerta = m; },
    progShowToast(msg, tipo) { c.toasts.push({ msg, tipo: tipo || 'ok' }); },
    fmtMoeda: v => Number(v).toFixed(2),
    isUUID: s => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s)),
    sbFetch: async (t, o) => { if (opts.fetchFalha) return null; return JSON.parse(JSON.stringify((opts.atuais || {})[t] || [])); },
    sbInsert: async (t, d) => { c.inserts.push({ t, d }); if ((opts.insertFalha || []).includes(t)) return null; return d.map((x, i) => Object.assign({ id: t + '-' + i }, x)); },
    sbUpdate: async (t, d, f, o) => { c.updates.push({ t, d, f, o }); if (opts.updateFalha) return []; return [{ id: f.slice(6) }]; },
    sotAbrirProjeto(id) { c.abriu.push(id); },
    sot_projetos: [{ id: PID, contrato_id: CID, modalidade: 'UPS' }],
    sot_atividades: opts.localAt || [], sot_materiais_proj: opts.localMat || [],
    servicos: [
      { id: 'sv1', contrato_id: CID, codigo: 'I-0325508', descricao: 'MO INSTAL FECHO', unidade: 'UN', valor_ups: 100, valor_hora: 0 },
      { id: 'sv2', contrato_id: CID, codigo: 'R-AHO813', descricao: 'MO RETIRA CRUZETA', unidade: 'UN', valor_ups: 0, valor_hora: 40 },
      { id: 'sv3', contrato_id: CID, codigo: 'GS83.389', descricao: 'PASS LADRILHO', unidade: 'M2', valor_ups: 10 },
      { id: 'sv4', contrato_id: 'outro', codigo: 'I-AHO812', descricao: 'OUTRO CONTRATO', valor_ups: 5 },
    ],
    catalogo_materiais: [], mat_sap: [],
    alm_movimentos: [{}], almCalcularSaldo() {},
    alm_estoque: [
      { material_id: 'm1', contrato_id: CID, codigo_sap: '949740', material_desc: 'ARRUELA SAP', unidade: 'PC', saldo: 3 },
      { material_id: 'm2', contrato_id: CID, codigo_sap: '963362', material_desc: 'SAPATILHA SAP', unidade: 'PC', saldo: 1 },
      { material_id: 'm3', contrato_id: 'outro', codigo_sap: '321291', material_desc: 'ISOLADOR OUTRO', unidade: 'PC', saldo: 1 },
      { material_id: 'm4', contrato_id: CID, codigo_sap: 'R-AHO816', material_desc: 'R-RETI CRUZETA (lançado como material)', unidade: 'PC', saldo: 3 },
    ],
  };
  vm.createContext(c);
  vm.runInContext(codigo, c);
  c.els = els;
  return c;
}
const esperar = () => new Promise(r => setTimeout(r, 0));

// Colado da aba LMS (pt-BR): Código, Descrição, 4 colunas vazias, Quan. Plan, Quan. Real
const COLADO = [
  'Código\tDescrição\t\t\t\t\tQuan. Plan\tQuan. Real',
  '949740\tARRUELA,QUADRADA,AC, 38X3X18MM,D41003\t\t\t\t\t1,67\t1,67',
  '963362\tSAPATILHA,AZ,ELEMENT PREFORMADOS,D510.02\t\t\t\t\t2,00\t2,00',
  'R-AHO813\tR-RETI CRUZETA SIM OU DPL PASSANTE C/ LV\t\t\t\t\t2,00\t2,00',
  'R-AHO816\tR-RETI CRUZETA SIM OU DPL ENCABEÇ C/ LV\t\t\t\t\t3,00\t3,00',
  '321291\tISOLADOR POLIMERICO\t\t\t\t\t12,00\t12,00',
  '321291\tISOLADOR POLIMERICO\t\t\t\t\t12,00\t12,00',
  'I-0325508\tMO INSTAL FECHO\t\t\t\t\t\t4,00',
  '348140\tCABO XLPE\t\t\t\t\t1.250,50\t1.250,50',
  'OPE\tI\tGS83.389\tPASS LADRILHO\t\t\t\t\t5,00\t5,00',
  '',
].join('\n');

(async () => {
  // ── parser ──
  {
    const c = sandbox();
    c.sotImportarAtividades(PID);
    c.els['sot-imp-texto'].value = COLADO;
    const it = c.sotParsarLinhasImportacao();
    const m = Object.fromEntries(it.map(x => [x.codigo, x]));
    ok('cabeçalho ignorado, códigos na ordem colada', JSON.stringify(it.map(x => x.codigo)) === JSON.stringify(['949740', '963362', 'R-AHO813', 'R-AHO816', '321291', 'I-0325508', '348140', 'GS83.389']), it.map(x => x.codigo));
    ok('decimal pt-BR 1,67 (não 67)', m['949740'].qtd === 1.67, m['949740']);
    ok('descrição com vírgulas fica inteira', m['949740'].descricao === 'ARRUELA,QUADRADA,AC, 38X3X18MM,D41003', m['949740'].descricao);
    ok('repetido somado', m['321291'].qtd === 24, m['321291']);
    ok('Plan vazio: usa Real', m['I-0325508'].qtd === 4, m['I-0325508']);
    ok('milhar pt-BR', m['348140'].qtd === 1250.5, m['348140']);
    ok('colunas PEP/FT antes do código', m['GS83.389'] && m['GS83.389'].qtd === 5 && m['GS83.389'].descricao === 'PASS LADRILHO', m['GS83.389']);
    ok('formato antigo CÓDIGO;QTD', JSON.stringify(c._sotExtrairCodQtdLinha(c._sotSplitCamposLinha('5020100055 ; 10'))) === JSON.stringify({ codigo: '5020100055', qtd: 10, descricao: '' }));
    ok('formato antigo CÓDIGO;DESCRIÇÃO;QTD', c._sotExtrairCodQtdLinha(c._sotSplitCamposLinha('i-0325508;MO INSTAL, FECHO;3,5')).qtd === 3.5);
    ok('CSV com vírgula e aspas', c._sotExtrairCodQtdLinha(c._sotSplitCamposLinha('949740,"ARRUELA,QUADRADA",2')).descricao === 'ARRUELA,QUADRADA');
    ok('descrição com número no meio não vira quantidade', c._sotExtrairCodQtdLinha(c._sotSplitCamposLinha('949740\tARRUELA 38X3X18MM\t\t2,00')).qtd === 2);
    ok('sem quantidade: ignorada', c._sotExtrairCodQtdLinha(c._sotSplitCamposLinha('949740\tARRUELA\t\t0,00')) === null);
  }

  // ── prévia ──
  {
    const c = sandbox({ localMat: [{ projeto_id: PID, codigo_sap: '963362' }], localAt: [{ projeto_id: PID, codigo: 'r-aho813' }] });
    c.sotImportarAtividades(PID);
    await esperar(); await esperar();
    c.els['sot-imp-texto'].value = COLADO;
    c.sotPreviewImportacao(PID);
    const h = c.els['sot-imp-preview'].innerHTML;
    ok('modal: título serviços e materiais', /Importar lista — serviços e materiais/.test(c.modal));
    ok('prévia: conta serviços e materiais encontrados', /3 serviço\(s\) e 2 material\(is\) encontrados/.test(h), h.slice(0, 400));
    ok('prévia: sem cadastro (R-AHO816, 321291 de outro contrato, 348140)', /⚠ 3 sem cadastro/.test(h));
    ok('prévia: já lançados serão somados', /🔁 2 serão somados/.test(h));
    ok('prévia: material mostra descrição do SAP', /ARRUELA SAP/.test(h) && /Material/.test(h));
    ok('prévia: sem cadastro mostra descrição colada', /⚠ sem cadastro — ISOLADOR POLIMERICO/.test(h));
    ok('prévia: não carregando após o catálogo', !/carregando Almoxarifado/.test(h));
    c.els['sot-imp-texto'].value = '949740\t<img src=x>\t2';
    c.sotPreviewImportacao(PID);
    ok('prévia: HTML colado é escapado', !/<img/.test(c.els['sot-imp-preview'].innerHTML));
  }

  // ── gravar ──
  {
    const c = sandbox({ atuais: { sot_materiais: [{ id: 'mat-ex', codigo_sap: '963362', qtd_projetada: 1 }], sot_atividades: [{ id: 'at-ex', codigo: 'r-aho813', qtd_prevista: 1 }] } });
    c.sotImportarAtividades(PID);
    c.els['sot-imp-texto'].value = COLADO;
    await c.sotConfirmarImportacao(PID);
    const im = c.inserts.find(i => i.t === 'sot_materiais'), is = c.inserts.find(i => i.t === 'sot_atividades');
    ok('um lote por tabela', c.inserts.length === 2);
    ok('materiais: colunas reais', im.d.every(m => m.projeto_id === PID && 'codigo_sap' in m && 'qtd_projetada' in m && !('codigo' in m) && !('qtd_ups' in m)), im.d[0]);
    ok('materiais: novos (existente somado)', JSON.stringify(im.d.map(m => [m.codigo_sap, m.qtd_projetada])) === JSON.stringify([['949740', 1.67], ['321291', 24], ['348140', 1250.5]]), im.d.map(m => [m.codigo_sap, m.qtd_projetada]));
    ok('materiais: descrição e unidade do SAP', im.d[0].descricao === 'ARRUELA SAP' && im.d[0].unidade === 'PC' && im.d[0].observacao === 'Importado da lista colada');
    ok('materiais: SAP de outro contrato não serve; sem cadastro marcado', im.d[1].descricao === 'ISOLADOR POLIMERICO' && /sem cadastro no Almoxarifado SAP do contrato$/.test(im.d[1].observacao), im.d[1]);
    ok('serviços: colunas reais (sem qtd_ups/valor_ups)', is.d.every(a => a.projeto_id === PID && 'qtd_prevista' in a && 'valor_unitario' in a && !('qtd_ups' in a) && !('valor_ups' in a) && !('id' in a) && a.status === 'pendente'), is.d[0]);
    ok('serviços: novos (existente somado)', JSON.stringify(is.d.map(a => a.codigo)) === JSON.stringify(['R-AHO816', 'I-0325508', 'GS83.389']), is.d.map(a => a.codigo));
    ok('serviços: cadastro do contrato com valor', is.d[1].servico_id === 'sv1' && is.d[1].valor_unitario === 100 && is.d[1].descricao === 'MO INSTAL FECHO');
    ok('I-/R- no Almoxarifado SAP continua serviço (não vira material)', !im.d.some(m => /AHO/.test(m.codigo_sap)) && is.d[0].codigo === 'R-AHO816');
    ok('serviços: sem cadastro sem valor e marcado', is.d[0].servico_id === null && is.d[0].valor_unitario === 0 && /sem cadastro na lista de serviços do contrato$/.test(is.d[0].observacoes));
    ok('serviços: ordem após os existentes', is.d[0].ordem_exec === 2 && is.d[2].ordem_exec === 4);
    ok('somas: material e serviço existentes, conferindo linha', c.updates.length === 2
      && c.updates.some(u => u.t === 'sot_materiais' && u.d.qtd_projetada === 3 && u.f === 'id=eq.mat-ex' && u.o.linhas)
      && c.updates.some(u => u.t === 'sot_atividades' && u.d.qtd_prevista === 3 && u.f === 'id=eq.at-ex'), c.updates);
    const t = c.toasts[c.toasts.length - 1];
    ok('aviso: importados, somados e sem cadastro', t.tipo === 'ok' && /Importados: 3 material\(is\) e 3 serviço\(s\)/.test(t.msg) && /2 já existiam/.test(t.msg)
      && /2 material\(is\) sem cadastro no Almoxarifado SAP: 321291, 348140/.test(t.msg) && /1 serviço\(s\) sem cadastro no contrato \(sem valor\): R-AHO816/.test(t.msg), t.msg);
    ok('fecha e recarrega o projeto do banco', c.fechou === 1 && c.abriu[0] === PID);
  }
  {
    const c = sandbox({ fetchFalha: true });
    c.sotImportarAtividades(PID);
    c.els['sot-imp-texto'].value = COLADO;
    await c.sotConfirmarImportacao(PID);
    ok('leitura da lista atual falhou: nada gravado', c.inserts.length === 0 && c.updates.length === 0 && c.toasts[0].tipo === 'erro' && !c.els['sot-imp-btn'].disabled && c.fechou === 0);
  }
  {
    const c = sandbox({ insertFalha: ['sot_atividades'], updateFalha: true, atuais: { sot_materiais: [{ id: 'mat-ex', codigo_sap: '963362', qtd_projetada: 1 }] } });
    c.sotImportarAtividades(PID);
    c.els['sot-imp-texto'].value = COLADO;
    await c.sotConfirmarImportacao(PID);
    ok('erro ao gravar serviços e soma: avisa', c.toasts[0].tipo === 'erro' && /os serviços e 1 soma\(s\) de quantidade/.test(c.toasts[0].msg), c.toasts[0].msg);
  }
  {
    const c = sandbox();
    c.sotImportarAtividades('sa123');
    c.els['sot-imp-texto'].value = COLADO;
    await c.sotConfirmarImportacao('sa123');
    ok('projeto sem id do banco: não grava', c.inserts.length === 0 && c.toasts[0].tipo === 'erro');
  }
  {
    const c = sandbox();
    c.sotImportarAtividades(PID);
    c.els['sot-imp-texto'].value = '949740\tAR\u0001RUELA\t2';
    await c.sotConfirmarImportacao(PID);
    ok('conteúdo binário: recusa tudo', c.inserts.length === 0 && /binário/.test(c.toasts[0].msg));
  }
  {
    const c = sandbox();
    c.sotImportarAtividades(PID);
    c.els['sot-imp-btn'].disabled = true;
    c.els['sot-imp-texto'].value = COLADO;
    await c.sotConfirmarImportacao(PID);
    ok('clique duplo: segunda chamada ignorada', c.inserts.length === 0);
  }

  if (falhas) { console.error('sot-importar-lista-colada: ' + falhas + ' de ' + total + ' falharam'); process.exit(1); }
  console.log('sot-importar-lista-colada: ' + total + ' verificações OK');
})().catch(e => { console.error(e); process.exit(1); });
