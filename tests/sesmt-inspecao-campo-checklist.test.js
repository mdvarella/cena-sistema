'use strict';
// SESMT 8.1.176 — Inspeção de Campo: contrato sem pré-seleção (sortarOpts), endereço por GPS, checklist novo
// (Documentos / Veículo / EPCs / Canteiro / Colaborador) e foto obrigatória em NC de Veículo e Canteiro.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const sw = fs.readFileSync(path.join(raiz, 'sw.js'), 'utf8');
const failed = [];
let total = 0;
function ok(name, cond, detail) { total++; if (!cond) failed.push(name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }

const blocos = [];
{ const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g; let m; while ((m = re.exec(html))) blocos.push(m[1]); }
const SSM = blocos.filter(b => /function comgasShowTab\(|function enelShowTab\(/.test(b));
function bloco(inicioRe) {
  const m = inicioRe.exec(html);
  if (!m) throw new Error('não encontrado: ' + inicioRe);
  const ini = m.index + 1;
  const re = /\n(?:async function |function |var |\/\*\*|\/\/)/g;
  re.lastIndex = ini + 5;
  const fim = re.exec(html);
  return html.slice(ini, fim ? fim.index : undefined);
}

// ── estrutura ───────────────────────────────────────────────────────────
ok('coluna fotos gravada em comgas_ncs e enel_ncs (existe no banco)',
  /'comgas_ncs':\[[^\]]*'fotos'/.test(html) && /'enel_ncs':\[[^\]]*'fotos'/.test(html));
ok('sw: Nominatim fora do cache', /'nominatim\.openstreetmap\.org'/.test(sw));
const numero = (html.match(/numero: '(8\.1\.\d+)'/) || [])[1];
ok('sw acompanha a versão do app', sw.includes("SW_VERSION   = 'cena-" + numero + "'"), numero);
ok('miniatura de foto das NCs COMGÁS com HTML válido', !/cursor:pointeronclick/.test(html) && /onclick="comgasVerFoto\(this\.src\)" title="Ver foto"/.test(html));

// ── sortarOpts com seleção como no Chrome (remover uma opção seleciona a primeira restante) ──
function fakeSelect(defs, multiple) {
  const sel = { multiple: !!multiple, options: [] };
  const mk = d => {
    const o = { value: d.v, text: d.t, _sel: !!d.s };
    Object.defineProperty(o, 'selected', {
      get() { return o._sel; },
      set(x) { o._sel = !!x; if (x && !sel.multiple) sel.options.forEach(p => { if (p !== o) p._sel = false; }); },
    });
    return o;
  };
  const fix = () => { if (!sel.multiple && sel.options.length && !sel.options.some(o => o._sel)) sel.options[0]._sel = true; };
  sel.options = defs.map(mk);
  fix();
  sel.remove = i => { sel.options.splice(i, 1); fix(); };
  sel.appendChild = o => { sel.options.push(o); if (o._sel && !sel.multiple) sel.options.forEach(p => { if (p !== o) p._sel = false; }); fix(); };
  Object.defineProperty(sel, 'value', {
    get() { const o = sel.options.find(x => x._sel); return o ? o.value : ''; },
    set(v) { const o = sel.options.find(x => x.value === v); if (o) o.selected = true; },
  });
  return sel;
}
{
  const antigo = `function sortarOpts(selectEl, manterPrimeiro){
  if(!selectEl) return;
  var valorAtual = selectEl.value;
  var opts = Array.from(selectEl.options);
  var inicio = (manterPrimeiro!==false && opts.length && !opts[0].value) ? 1 : 0;
  var fixos  = opts.slice(0, inicio);
  var paraOrdenar = opts.slice(inicio);
  paraOrdenar.sort(function(a,b){ return (a.text||'').localeCompare((b.text||''), 'pt-BR', {sensitivity:'base'}); });
  while(selectEl.options.length) selectEl.remove(0);
  fixos.concat(paraOrdenar).forEach(function(o){ selectEl.appendChild(o); });
  if(valorAtual && Array.from(selectEl.options).some(function(o){ return o.value===valorAtual; })){ selectEl.value = valorAtual; }
}`;
  const cOld = vm.createContext({ Array }); vm.runInContext(antigo, cOld);
  const cNew = vm.createContext({ Array }); vm.runInContext(bloco(/\nfunction sortarOpts\(/), cNew);
  const contratos = () => [{ v: '', t: 'Selecione o contrato...' }, { v: '2', t: 'TMA OESTE' }, { v: '1', t: 'ENEL SUL' }, { v: '3', t: 'COMGÁS LESTE' }];
  let s = fakeSelect(contratos()); cOld.sortarOpts(s, true);
  ok('modelo reproduz o defeito antigo (placeholder virava a última opção)', s.value === '2', s.value);
  s = fakeSelect(contratos()); cNew.sortarOpts(s, true);
  ok('sortarOpts: "Selecione o contrato..." continua selecionado', s.value === '' && s.options[0].text === 'Selecione o contrato...', s.value);
  ok('sortarOpts: continua ordenando', s.options.map(o => o.text).join('|') === 'Selecione o contrato...|COMGÁS LESTE|ENEL SUL|TMA OESTE');
  s = fakeSelect([{ v: '', t: 'Selecione' }, { v: 'z', t: 'Zeta' }, { v: 'a', t: 'Alfa', s: true }]); cNew.sortarOpts(s, true);
  ok('sortarOpts: opção escolhida é mantida', s.value === 'a', s.value);
  s = fakeSelect([{ v: 'b', t: 'Beta' }, { v: 'a', t: 'Alfa' }]); cNew.sortarOpts(s, true);
  ok('sortarOpts: sem placeholder mantém a opção padrão', s.value === 'b', s.value);
  s = fakeSelect([{ v: 'c', t: 'C', s: true }, { v: 'a', t: 'A' }, { v: 'b', t: 'B', s: true }], true); cNew.sortarOpts(s, true);
  ok('sortarOpts: múltipla mantém as marcadas', s.options.filter(o => o.selected).map(o => o.value).join(',') === 'b,c');
}

// ── sandbox do módulo SSM real ──────────────────────────────────────────
function classList(inicial) {
  const s = new Set(inicial || []);
  return { add: c => s.add(c), remove: c => s.delete(c), contains: c => s.has(c), toggle: c => (s.has(c) ? s.delete(c) : s.add(c)) };
}
function cenario(opts) {
  opts = opts || {};
  const els = {};
  const el = id => els[id] || (els[id] = {
    id, innerHTML: '', value: '', textContent: '', style: {}, dataset: {}, options: [], files: [],
    classList: classList(/^pg-/.test(id) ? ['hidden'] : []),
    querySelectorAll: () => [], querySelector: () => null, appendChild() {}, setAttribute() {}, addEventListener() {}, remove() {}, focus() {},
  });
  const store = () => { const m = {}; return { m, getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; } }; };
  const ctx = {
    console: { log() {}, warn() {}, error() {} }, Math, Date, String, Object, Array, Promise, JSON, parseInt, parseFloat, isNaN, isFinite, Number, Set, Map, RegExp, Error,
    encodeURIComponent, setTimeout: (f) => { f(); return 0; }, clearTimeout() {},
    DEMO: false, window: { innerWidth: 400 }, navigator: {}, location: { hash: '' },
    document: { getElementById: id => (ctx.semEl.includes(id) ? null : el(id)), querySelectorAll: () => [], createElement: () => el('_novo'), body: el('_body') },
    semEl: [],
    localStorage: store(), sessionStorage: store(),
    usuarioLogado: { nome: 'Teste SESMT', perfil: 'admin' }, _gestorContratos: [],
    contratos: [{ id: 'k1', nome: 'TMA OESTE', status: 'Ativo' }], equipes: [{ id: 'e1', codigo: 'EQ1', contrato_id: 'k1' }], equipes_disp: [{ id: 'd1' }],
    colaboradores: [{ id: 'c1', nome: 'Fulano', contrato_id: 'k1', equipe_id: 'e1' }], composicao_dia: [{ data: '2026-09-30', equipe_id: 'e1', colaborador_ids: ['c1'] }],
    escHtml: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
    fmtD: s => String(s || ''), almContratoLabel: c => (c && c.nome) || '', dataHoje: () => '2026-09-30', dataHojeLocal: () => '2026-09-30',
    _compDataStr: s => String(s || '').slice(0, 10), parseJsonField: (v, d) => v || d, _mergeComposicaoDia() {},
    auditLog() {}, closeModal() {}, confirm: () => true,
    alerts: [], alert(m) { ctx.alerts.push(m); },
    modal: '', setModal(h) { ctx.modal = h; },
    toasts: [], progShowToast(m, t) { ctx.toasts.push([m, t]); },
    fetches: [], inserts: [], updates: [], uploads: [],
    sbFetch(t, o) { ctx.fetches.push([t, o]); return Promise.resolve([]); },
    sbInsert(t, row) { ctx.inserts.push([t, row]); return Promise.resolve([row]); },
    sbUpdate(t, data, filtro, o) { ctx.updates.push([t, data, filtro, o]); return Promise.resolve(true); },
    sbUpload(file, caminho) { ctx.uploads.push(caminho); return opts.upload ? opts.upload(caminho) : Promise.resolve('https://x.supabase.co/storage/v1/object/public/cena-docs/' + caminho); },
    fetch: opts.fetch || (() => Promise.reject(new Error('sem rede'))),
    els,
  };
  vm.createContext(ctx);
  SSM.forEach((b, i) => vm.runInContext(b, ctx, { filename: 'ssm' + i }));
  return ctx;
}
const esperar = async (n) => { for (let i = 0; i < (n || 30); i++) await new Promise(r => setImmediate(r)); };
const val = (c, expr) => vm.runInContext(expr, c);
const E = (c, id) => c.document.getElementById(id);
function metaBase(c, extra) {
  c.metaTmp = Object.assign({
    modulo: 'comgas', prefix: 'ic-cg', id: 'insp_t1', contrato_id: 'k1', contrato_label: 'TMA OESTE', equipe_id: 'e1', equipe_codigo: 'EQ1',
    data: '2026-09-30', inspetor: 'Teste', local: 'Rua A, 10', supervisor: 'Sup', placa: 'ABC1D23',
    membros: [{ id: 'c1', nome: 'Fulano', re: '1' }], abaAtiva: 'documentos', ckVersao: val(c, 'INSP_CAMPO_CK_VERSAO'), rascunho: {},
  }, extra || {});
  val(c, '_inspCampoMeta = metaTmp');
}
const NOMINATIM = { display_name: '1578, Avenida Paulista, Morro dos Ingleses, Bela Vista, São Paulo, Região Sudeste, 01310-200, Brasil',
  address: { house_number: '1578', road: 'Avenida Paulista', suburb: 'Morro dos Ingleses', city: 'São Paulo', state: 'São Paulo', 'ISO3166-2-lvl4': 'BR-SP', postcode: '01310-200' } };

(async () => {
  // ── checklist novo ──
  let c = cenario();
  const B = JSON.parse(JSON.stringify(val(c, 'INSP_CAMPO_BLOCOS')));
  ok('Documentos: só APR, Permissão de trabalho, PET, Ordem de Serviço e HAR',
    JSON.stringify(B.documentos.itens) === JSON.stringify(['APR elaborada e assinada?', 'Permissão de trabalho em vigor?', 'PET emitida e assinada?', 'Ordem de Serviço disponível?', 'HAR válida?']), B.documentos.itens);
  ok('Veículo: sem "EPIs obrigatórios", com ensaio elétrico e acústico',
    !B.veiculo.itens.some(i => /EPIs obrigat/.test(i)) && B.veiculo.itens.includes('Ensaio elétrico em dia?') && B.veiculo.itens.includes('Ensaio acústico em dia?') && B.veiculo.itens.length === 9, B.veiculo.itens);
  ok('EPCs: 20 itens na ordem pedida', B.epcs.itens.length === 20 && B.epcs.itens[0] === 'Bastão isolante' && B.epcs.itens[17] === 'Guarda-corpo'
    && B.epcs.itens[18] === 'Kit Ambiental' && B.epcs.itens[19] === 'Kit Rota de Fuga' && B.epcs.itens.includes('Detector multigases'), B.epcs.itens);
  ok('Colaborador: sem luvas adequadas, com Kit Trabalho em Altura',
    !B.colaborador.itens.some(i => /Luvas adequadas|Cinto para/.test(i)) && B.colaborador.itens.includes('Kit Trabalho em Altura (se aplicável)?'), B.colaborador.itens);
  const EPIS = ['Detector de tensão de capacete', 'Protetor auricular', 'Balaclava antichama', 'Protetor facial para arco elétrico', 'Luva isolante de borracha', 'Luva de cobertura',
    'Luva de vaqueta', 'Manga isolante de borracha', 'Cinturão paraquedista', 'Talabarte / dispositivo de conexão adequado', 'Trava-quedas', 'Máscara respiratória PFF2', 'Protetor solar'];
  ok('Colaborador: 13 EPIs novos', EPIS.every(e => B.colaborador.itens.includes(e)), EPIS.filter(e => !B.colaborador.itens.includes(e)));
  ok('foto em NC em todos os blocos menos Documentos', B.veiculo.fotoNc === true && B.canteiro.fotoNc === true && B.epcs.fotoNc === true && B.colaborador.fotoNc === true && !B.documentos.fotoNc);
  ok('ordem dos blocos', JSON.stringify(val(c, 'INSP_CAMPO_BLOCOS_ORDEM')) === '["documentos","veiculo","epcs","canteiro"]');
  const prefixos = Object.keys(B).filter(k => B[k].prefixo).map(k => B[k].prefixo);
  ok('prefixos distintos por bloco', new Set(prefixos).size === 4, prefixos);

  // ── render: área de foto ──
  metaBase(c);
  let h = val(c, "inspCampoRenderChecklistItems('ic_veic', INSP_CAMPO_BLOCOS.veiculo.itens, [{status:'NC'}], true)");
  ok('Veículo: item NC mostra área de foto com câmera', /id="ic_veic_0_fotos" style="display:block/.test(h) && /capture="environment"/.test(h) && /Foto obrigatória para NC/.test(h));
  ok('Veículo: item sem NC deixa a área oculta', /id="ic_veic_1_fotos" style="display:none/.test(h));
  h = val(c, "inspCampoRenderChecklistItems('ic_doc', INSP_CAMPO_BLOCOS.documentos.itens, [{status:'NC'}], false)");
  ok('Documentos: sem área de foto', !/_fotos"/.test(h));
  E(c, 'ic_veic_2_s').value = 'NC';
  val(c, "inspCampoAtualizarFotoArea('ic_veic_2')");
  ok('trocar para NC exibe a área', E(c, 'ic_veic_2_fotos').style.display === 'block');
  E(c, 'ic_veic_2_s').value = 'C';
  val(c, "inspCampoAtualizarFotoArea('ic_veic_2')");
  ok('sair de NC oculta a área', E(c, 'ic_veic_2_fotos').style.display === 'none');
  val(c, 'inspCampoRenderWizard()');
  const form = E(c, 'comgas-checklist-form').innerHTML;
  const pos = ['📄 Documentos', '🚗 Veículo', '🛡️ EPCs', '🏗️ Canteiro', '👷 Fulano'].map(t => form.indexOf(t));
  ok('wizard: blocos na ordem, com EPCs', pos.every((p, i) => p >= 0 && (i === 0 || p > pos[i - 1])), pos);
  ok('wizard: aviso de foto em Veículo, EPCs, Canteiro e no colaborador', (form.match(/NC exige foto/g) || []).length === 4);
  ok('wizard: colaborador com área de foto', /id="ic_col_c1_0_fotos"/.test(form) && !/id="ic_doc_0_fotos"/.test(form));
  ok('wizard: local no cabeçalho', /<b>Local:<\/b> Rua A, 10/.test(form));

  // ── salvar: foto obrigatória ──
  c = cenario(); metaBase(c);
  E(c, 'ic_veic_4_s').value = 'NC';
  val(c, 'inspCampoSalvarWizard()');
  ok('NC no Veículo sem foto: não grava', c.inserts.length === 0 && val(c, 'comgas_inspecoes.length') === 0 && !!val(c, '_inspCampoMeta'));
  ok('NC no Veículo sem foto: avisa o item', c.alerts.length === 1 && /Foto obrigatória/.test(c.alerts[0]) && c.alerts[0].includes('Veículo — Ensaio elétrico em dia?'), c.alerts);

  c = cenario(); metaBase(c);
  E(c, 'ic_cant_0_s').value = 'NC';
  val(c, 'inspCampoSalvarWizard()');
  ok('NC no Canteiro sem foto: não grava', c.inserts.length === 0 && c.alerts[0] && c.alerts[0].includes('Canteiro — Layout'), c.alerts);

  c = cenario(); metaBase(c);
  E(c, 'ic_epc_9_s').value = 'NC';
  val(c, 'inspCampoSalvarWizard()');
  ok('NC em EPC sem foto: não grava', c.inserts.length === 0 && c.alerts[0] && c.alerts[0].includes('EPCs — Detector multigases'), c.alerts);

  c = cenario(); metaBase(c);
  E(c, 'ic_col_c1_7_s').value = 'NC';
  val(c, 'inspCampoSalvarWizard()');
  ok('NC no colaborador sem foto: não grava', c.inserts.length === 0 && c.alerts[0] && c.alerts[0].includes('Colaborador — Fulano — Balaclava antichama'), c.alerts);

  c = cenario(); metaBase(c);
  E(c, 'ic_doc_2_s').value = 'NC';
  val(c, 'inspCampoSalvarWizard()');
  await esperar();
  ok('NC em Documentos sem foto: grava', c.alerts.length === 0 && c.inserts.map(i => i[0]).join() === 'comgas_inspecoes,comgas_ncs,comgas_pa', [c.alerts, c.inserts.map(i => i[0])]);

  c = cenario(); metaBase(c);
  val(c, '_inspCampoFotosEnviando = 1');
  val(c, 'inspCampoSalvarWizard()');
  ok('foto ainda enviando: não grava', c.inserts.length === 0 && /Aguarde o envio/.test(c.alerts[0] || ''));

  c = cenario(); 
  metaBase(c, { geo: { lat: -23.56, lng: -46.65, precisao_m: 12, capturado_em: '2026-09-30T14:00:00Z', endereco_gps: 'Rua A, 10', local_editado: false } });
  const URL1 = 'https://x.supabase.co/storage/v1/object/public/cena-docs/evidencias/inspecao_campo/comgas/insp_t1/ic_veic_4_1.jpg';
  const URL2 = 'https://x.supabase.co/storage/v1/object/public/cena-docs/evidencias/inspecao_campo/comgas/insp_t1/ic_epc_9_1.jpg';
  const URL3 = 'https://x.supabase.co/storage/v1/object/public/cena-docs/evidencias/inspecao_campo/comgas/insp_t1/ic_col_c1_7_1.jpg';
  val(c, "_inspCampoMeta.rascunho['ic_veic_4'] = {status:'NC', fotos:['" + URL1 + "']}");
  val(c, "_inspCampoMeta.rascunho['ic_epc_9'] = {status:'NC', fotos:['" + URL2 + "']}");
  val(c, "_inspCampoMeta.rascunho['ic_col_c1_7'] = {status:'NC', fotos:['" + URL3 + "']}");
  E(c, 'ic_veic_4_s').value = 'NC'; E(c, 'ic_veic_4_obs').value = 'Laudo vencido';
  E(c, 'ic_epc_9_s').value = 'NC';
  E(c, 'ic_col_c1_7_s').value = 'NC';
  E(c, 'ic_doc_0_s').value = 'C';
  val(c, 'inspCampoSalvarWizard()');
  await esperar();
  const tabs = c.inserts.map(i => i[0]);
  ok('com foto: grava inspeção, NC e plano', JSON.stringify(tabs) === '["comgas_inspecoes","comgas_ncs","comgas_pa"]' && c.alerts.length === 0, [tabs, c.alerts]);
  const insp = (c.inserts.find(i => i[0] === 'comgas_inspecoes') || [])[1] || {};
  const og = JSON.parse(insp.obs_geral || '{}');
  ok('inspeção: EPCs e fotos no checklist gravado', og.blocos && og.blocos.epcs && og.blocos.epcs.nao_conformes === 1
    && JSON.stringify(og.blocos.veiculo.respostas[4].fotos) === JSON.stringify([URL1]) && og.blocos.veiculo.sem_foto === undefined, og.blocos && og.blocos.veiculo && og.blocos.veiculo.respostas[4]);
  ok('inspeção: GPS gravado em obs_geral', og.geo && og.geo.lat === -23.56 && og.geo.precisao_m === 12);
  ok('inspeção: 3 NCs contadas', insp.nao_conformes === 3 && insp.conformes === 1, [insp.nao_conformes, insp.conformes]);
  const nc = (c.inserts.find(i => i[0] === 'comgas_ncs') || [])[1] || {};
  ok('NC: coluna fotos com as fotos de Veículo, EPC e colaborador', JSON.stringify(nc.fotos) === JSON.stringify([URL1, URL2, URL3]), nc.fotos);
  const itens = JSON.parse(nc.observacao || '{}').itens || [];
  ok('NC: cada item com a sua foto', itens.length === 3 && JSON.stringify(itens[0].fotos) === JSON.stringify([URL1]) && itens[0].grupo === 'Veículo'
    && itens[1].grupo === 'EPCs' && JSON.stringify(itens[1].fotos) === JSON.stringify([URL2])
    && itens[2].item === 'Balaclava antichama' && JSON.stringify(itens[2].fotos) === JSON.stringify([URL3]), itens);
  c.inspRow = JSON.parse(JSON.stringify(insp)); c.ncRow = JSON.parse(JSON.stringify(nc));
  val(c, 'comgas_inspecoes = [inspCampoUnpackObsGeral(inspRow)]; comgas_ncs = [ncRow];');
  ok('NC: item mostra a miniatura', /<img src="https:\/\/x\.supabase\.co/.test(val(c, 'inspCampoNcItensHtml(comgas_ncs[0])')));
  const vis = val(c, '_inspCampoChecklistHtml(comgas_inspecoes[0])');
  ok('visualização: seção EPCs e miniatura da foto', /🛡️ EPCs/.test(vis) && vis.includes(URL1));
  val(c, "inspCampoVerInspecao('comgas','insp_t1')");
  ok('visualização: local com link do GPS', /<b>Local:<\/b> Rua A, 10 · <a href="https:\/\/www\.openstreetmap\.org\/\?mlat=-23\.56&mlon=-46\.65/.test(c.modal));

  // ── envio de foto ──
  c = cenario(); metaBase(c);
  val(c, 'inspCampoComprimirFoto = function(){ return Promise.resolve({type:"image/jpeg"}); }');
  c.inp = { files: [{ name: 'a.jpg' }], value: 'C:\\fakepath\\a.jpg' };
  await val(c, "inspCampoFotoSelecionada(inp, 'ic_veic_4')");
  ok('foto enviada: guardada no rascunho', val(c, "JSON.stringify(_inspCampoMeta.rascunho['ic_veic_4'].fotos)") === JSON.stringify(['https://x.supabase.co/storage/v1/object/public/cena-docs/' + c.uploads[0]]));
  ok('foto enviada: caminho da vistoria', /^evidencias\/inspecao_campo\/comgas\/insp_t1\/ic_veic_4_\d+\.jpg$/.test(c.uploads[0] || ''), c.uploads);
  ok('foto enviada: contador zerado e rascunho salvo', val(c, '_inspCampoFotosEnviando') === 0 && /ic_veic_4/.test(c.sessionStorage.m.insp_campo_wizard_state || ''));
  val(c, "inspCampoFotoRemover('ic_veic_4', 0)");
  ok('remover foto', val(c, "_inspCampoMeta.rascunho['ic_veic_4'].fotos.length") === 0);

  c = cenario({ upload: () => Promise.resolve('data:image/jpeg;base64,AAAA') }); metaBase(c);
  val(c, 'inspCampoComprimirFoto = function(){ return Promise.resolve({type:"image/jpeg"}); }');
  c.inp = { files: [{ name: 'a.jpg' }], value: '' };
  await val(c, "inspCampoFotoSelecionada(inp, 'ic_veic_4')");
  ok('upload recusado (base64 de reserva): foto não conta', !val(c, "_inspCampoMeta.rascunho['ic_veic_4']") && c.toasts.some(t => t[1] === 'erro' && /não foi enviada/.test(t[0])), c.toasts);

  c = cenario(); metaBase(c);
  val(c, 'inspCampoComprimirFoto = function(){ return Promise.reject(new Error("x")); }');
  c.inp = { files: [{ name: 'a.jpg' }], value: '' };
  await val(c, "inspCampoFotoSelecionada(inp, 'ic_veic_4')");
  ok('falha ao ler a imagem: sem foto e contador zerado', !val(c, "_inspCampoMeta.rascunho['ic_veic_4']") && val(c, '_inspCampoFotosEnviando') === 0 && c.toasts.length === 1);

  c = cenario({ upload: () => { val(c, '_inspCampoMeta = null'); return Promise.resolve('https://x/y.jpg'); } }); metaBase(c);
  val(c, 'inspCampoComprimirFoto = function(){ return Promise.resolve({type:"image/jpeg"}); }');
  c.inp = { files: [{ name: 'a.jpg' }], value: '' };
  await val(c, "inspCampoFotoSelecionada(inp, 'ic_veic_4')");
  ok('vistoria fechada durante o envio: nada muda', val(c, '_inspCampoMeta') === null && val(c, '_inspCampoFotosEnviando') === 0);

  // ── GPS ──
  c = cenario();
  ok('endereço formatado', val(c, 'inspCampoFormatarEndereco(' + JSON.stringify(NOMINATIM) + ')') === 'Avenida Paulista, 1578 - Morro dos Ingleses - São Paulo/SP - CEP 01310-200');
  ok('sem partes usa display_name', val(c, "inspCampoFormatarEndereco({display_name:'Algum lugar', address:{}})") === 'Algum lugar');
  ok('sem resposta: vazio', val(c, 'inspCampoFormatarEndereco(null)') === '');

  const geoOk = { getCurrentPosition: (ok_) => ok_({ coords: { latitude: -23.5614, longitude: -46.6559, accuracy: 8.4 } }) };
  const fetchOk = (u) => { c.urls.push(u); return Promise.resolve({ ok: true, json: () => Promise.resolve(NOMINATIM) }); };
  c = cenario({ fetch: u => fetchOk(u) }); c.urls = []; c.navigator.geolocation = geoOk;
  await val(c, "inspCampoCapturarEndereco('ic-cg', true)");
  ok('GPS: preenche o endereço', E(c, 'ic-cg-local').value === 'Avenida Paulista, 1578 - Morro dos Ingleses - São Paulo/SP - CEP 01310-200', E(c, 'ic-cg-local').value);
  ok('GPS: consulta com lat/lon do aparelho', /nominatim\.openstreetmap\.org\/reverse\?.*&lat=-23\.5614&lon=-46\.6559/.test(c.urls[0] || ''), c.urls);
  ok('GPS: status com precisão', /±8 m/.test(E(c, 'ic-cg-geo-status').textContent) && E(c, 'ic-cg-geo-status').style.color === '#3B6D11');
  ok('GPS: coordenadas guardadas', val(c, "_inspCampoGeo['ic-cg'].lat") === -23.5614 && val(c, "_inspCampoGeo['ic-cg'].precisao_m") === 8);
  let gm = JSON.parse(JSON.stringify(val(c, "inspCampoGeoParaMeta('ic-cg', 'Avenida Paulista, 1578 - Morro dos Ingleses - São Paulo/SP - CEP 01310-200')")));
  ok('meta: endereço do GPS sem edição', gm.local_editado === false && gm.endereco_gps.startsWith('Avenida Paulista'), gm);
  gm = JSON.parse(JSON.stringify(val(c, "inspCampoGeoParaMeta('ic-cg', 'Frente 3')")));
  ok('meta: endereço editado', gm.local_editado === true, gm);

  c = cenario({ fetch: u => fetchOk(u) }); c.urls = []; c.navigator.geolocation = geoOk;
  E(c, 'ic-cg-local').value = 'Frente 3';
  val(c, "inspCampoLocalDigitado('ic-cg')");
  await val(c, "inspCampoCapturarEndereco('ic-cg', true)");
  ok('GPS automático não apaga o que foi digitado', E(c, 'ic-cg-local').value === 'Frente 3');
  await val(c, "inspCampoCapturarEndereco('ic-cg', false)");
  ok('botão 📍 GPS substitui pelo endereço', E(c, 'ic-cg-local').value.startsWith('Avenida Paulista'));

  c = cenario(); c.navigator.geolocation = { getCurrentPosition: (a, erro) => erro({ code: 1 }) };
  await val(c, "inspCampoCapturarEndereco('ic-cg', true)");
  ok('permissão negada: avisa e não inventa endereço', E(c, 'ic-cg-local').value === '' && /não permitida/.test(E(c, 'ic-cg-geo-status').textContent) && !val(c, "_inspCampoGeo['ic-cg']"));

  c = cenario(); c.navigator.geolocation = geoOk;
  await val(c, "inspCampoCapturarEndereco('ic-cg', true)");
  ok('sem endereço (falha de rede): guarda coordenadas e pede para digitar', E(c, 'ic-cg-local').value === '' && /não foi encontrado/.test(E(c, 'ic-cg-geo-status').textContent)
    && val(c, "_inspCampoGeo['ic-cg'].lat") === -23.5614);

  c = cenario({ fetch: u => fetchOk(u) }); c.urls = []; c.navigator.geolocation = geoOk; c.semEl = ['ic-cg-local'];
  await val(c, "inspCampoCapturarEndereco('ic-cg', true)");
  ok('modal fechada: não consulta endereço', c.urls.length === 0);

  c = cenario();
  await val(c, "inspCampoCapturarEndereco('ic-cg', true)");
  ok('aparelho sem localização (automático): silencioso', E(c, 'ic-cg-geo-status').textContent === '');

  const row = val(c, "inspCampoInspToDbRow({id:'i1', data:'2026-09-30', obs_geral:'x', blocos:{}, geo:{lat:1, lng:2, precisao_m:3}})");
  const volta = val(c, 'inspCampoUnpackObsGeral(' + JSON.stringify(JSON.parse(JSON.stringify(row))) + ')');
  ok('geo sobrevive a gravar e carregar', volta.geo && volta.geo.lat === 1 && volta.obs_geral === 'x');
  ok('local sem GPS: sem link', !/openstreetmap/.test(val(c, "inspCampoLocalHtml({local:'Rua <b>'})")) && /Rua &lt;b>/.test(val(c, "inspCampoLocalHtml({local:'Rua <b>'})")));

  // ── modal Nova Inspeção ──
  c = cenario(); c.geoCalls = 0; c.navigator.geolocation = { getCurrentPosition() { c.geoCalls++; } };
  val(c, "inspCampoNovaInspecao('comgas')");
  await esperar();
  ok('modal: contrato começa em "Selecione o contrato..."', /<option value="">Selecione o contrato\.\.\.<\/option><option value="k1">TMA OESTE<\/option>/.test(c.modal), c.modal.slice(0, 300));
  ok('modal: campo de endereço com 📍 GPS', /id="ic-cg-local"/.test(c.modal) && /inspCampoCapturarEndereco\('ic-cg',false\)/.test(c.modal) && /id="ic-cg-geo-status"/.test(c.modal));
  ok('modal: busca a localização ao abrir', c.geoCalls === 1, c.geoCalls);

  // ── rascunho de checklist anterior ──
  c = cenario();
  c.sessionStorage.setItem('insp_campo_wizard_state', JSON.stringify({ meta: { modulo: 'comgas', id: 'insp_old', membros: [] }, rascunho: { ic_veic_4: { status: 'NC' } } }));
  c.sessionStorage.setItem('insp_campo_rascunho_insp_old', 'x');
  val(c, "inspCampoRestaurarSessao('comgas')");
  ok('rascunho do checklist anterior: descartado com aviso', val(c, '_inspCampoMeta') === null && !c.sessionStorage.m.insp_campo_wizard_state
    && !c.sessionStorage.m.insp_campo_rascunho_insp_old && c.toasts.some(t => t[1] === 'erro'), c.toasts);
  c = cenario();
  c.sessionStorage.setItem('insp_campo_wizard_state', JSON.stringify({ meta: { modulo: 'comgas', id: 'insp_new', membros: [], equipe_codigo: 'EQ1', ckVersao: val(c, 'INSP_CAMPO_CK_VERSAO') }, rascunho: {} }));
  val(c, "inspCampoRestaurarSessao('comgas')");
  ok('rascunho da versão atual: restaurado', val(c, '_inspCampoMeta && _inspCampoMeta.id') === 'insp_new');

  if (failed.length) { console.error('FALHOU ' + failed.length + '/' + total + ':\n - ' + failed.join('\n - ')); process.exit(1); }
  console.log('sesmt-inspecao-campo-checklist: OK (' + total + ' verificações)');
})().catch(e => { console.error(e); process.exit(1); });
