'use strict';
// SESMT 8.1.174 — abas ENEL / COMGÁS (Inspeções de Campo, NC, Planos de Ação) tinham sido cortadas junto com o fim do
// index.html na 8.1.108; restauradas da 8.1.107 com carga do banco e gravação conferida (id texto).
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
ok('dois blocos de script do módulo SSM', SSM.length === 2, SSM.length);
for (const mod of ['comgas', 'enel'])
  for (const aba of ['dashboard', 'inspecoes', 'checklist', 'nc', 'pa', 'cdi', 'rem']) {
    const n = (html.match(new RegExp('id="pg-' + mod + '-' + aba + '"', 'g')) || []).length;
    ok('página pg-' + mod + '-' + aba + ' presente uma vez', n === 1, n);
  }
ok('páginas com conteúdo real (lista de NCs e formulário REM)', /id="pg-comgas-nc"[\s\S]{0,4000}onclick="comgasNovaNC\(/.test(html) && /id="enel-rem-form"/.test(html));
const FUNCS = ['comgasShowTab', 'enelShowTab', 'comgasInit', 'enelInit', 'comgasRenderInspecoes', 'comgasRenderNCs', 'comgasRenderPA',
  'enelRenderInspecoes', 'enelRenderNCs', 'enelRenderPA', 'comgasAbrirNC', 'enelAbrirNC', 'inspCampoSalvarWizard', 'inspCampoCriarNcUnificada',
  'inspCampoCriarPaUnificado', 'inspCampoPenalidadeSeguranca', 'inspCampoPortfolioColaborador', 'renderGestorPainel',
  'ssmCarregarModulo', 'ssmInsert', 'ssmUpdate'];
for (const f of FUNCS) {
  const n = (html.match(new RegExp('\\n(?:async )?function ' + f + '\\s*\\(', 'g')) || []).length;
  ok('função ' + f + ' definida uma vez', n === 1, n);
}
const ssmTxt = SSM.join('\n');
ok('nenhuma gravação SSM silenciosa (.catch vazio)', !/sb(Insert|Update)\([^\n]*\.catch\(function\(\)\{\}\)/.test(ssmTxt));
ok('gravação só pelos helpers (1 sbInsert e 1 sbUpdate no módulo)', (ssmTxt.match(/sbInsert\(/g) || []).length === 1 && (ssmTxt.match(/sbUpdate\(/g) || []).length === 1);
ok('comgasInit não depende mais de #pg-comgas', !/getElementById\('pg-comgas'\)/.test(ssmTxt));
ok('sbUpdate: guarda de UUID respeita opts.idTexto', /if\(mSimples&&!isUUID\(mSimples\[1\]\)&&!opts\.idTexto\)/.test(html));

// ── sandbox com os dois blocos reais ────────────────────────────────────
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
    querySelectorAll: () => [], querySelector: () => null, appendChild() {}, setAttribute() {}, addEventListener() {}, remove() {}, focus() {}
  });
  const store = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; } }; };
  const ctx = {
    console: { log() {}, warn() {}, error() {} }, Math, Date, String, Object, Array, Promise, JSON, parseInt, parseFloat, isNaN, Number, Set, Map, RegExp,
    encodeURIComponent, setTimeout: (f) => { f(); return 0; }, clearTimeout() {},
    DEMO: false, window: {}, navigator: {}, location: { hash: '' },
    document: { getElementById: id => (opts.semEl && opts.semEl.includes(id) ? null : el(id)), querySelectorAll: () => [], createElement: () => el('_novo'), body: el('_body') },
    localStorage: store(), sessionStorage: store(),
    usuarioLogado: { nome: 'Teste SESMT', perfil: 'admin' }, _gestorContratos: [], contratos: [], equipes: [], equipes_disp: [], colaboradores: [], composicao_dia: [],
    escHtml: s => String(s == null ? '' : s), fmtD: s => String(s || ''), almContratoLabel: c => (c && c.nome) || '', dataHoje: () => '2026-09-30',
    auditLog() {}, closeModal() {}, confirm: () => true, alert() {},
    toasts: [], progShowToast(m, t) { ctx.toasts.push([m, t]); },
    fetches: [], inserts: [], updates: [],
    sbFetch(t, o) {
      ctx.fetches.push([t, o]);
      if (opts.fetchNulo && opts.fetchNulo.includes(t)) return Promise.resolve(null);
      return Promise.resolve(JSON.parse(JSON.stringify((opts.dados || {})[t] || [])));
    },
    sbInsert(t, row) {
      ctx.inserts.push([t, row]);
      if (opts.insertAtraso && ctx.inserts.length === 1) return new Promise(r => { ctx.liberarInsert = () => r([row]); });
      return Promise.resolve(opts.insertFalha ? null : [row]);
    },
    sbUpdate(t, data, filtro, o) { ctx.updates.push([t, data, filtro, o]); return Promise.resolve(!opts.updateFalha); },
    els,
  };
  vm.createContext(ctx);
  SSM.forEach((b, i) => vm.runInContext(b, ctx, { filename: 'ssm' + i }));
  return ctx;
}
const esperar = async (n) => { for (let i = 0; i < (n || 30); i++) await new Promise(r => setImmediate(r)); };
const val = (c, expr) => vm.runInContext(expr, c);
const COLS_PA = ['id', 'nc_id', 'acao', 'responsavel', 'prazo', 'prioridade', 'status', 'concluido_em', 'concluido_por', 'criado_em', 'criado_por'];
const COLS_NC = ['id', 'inspecao_id', 'gravidade', 'descricao', 'local', 'contrato', 'inspetor', 'observacao', 'fotos', 'status', 'criado_em', 'criado_por', 'colaborador_id'];

const DADOS = {
  comgas_inspecoes: [{ id: 'insp_1', tipo: 'campo_vistoria', data: '2026-07-10', obs_geral: JSON.stringify({ _insp_campo: 2, obs: 'ok', blocos: { documentos: {} }, membros: [], resultado: 'negativo', equipe_codigo: 'EQ1', modulo: 'comgas' }), status: 'pendente_gestor' }],
  comgas_ncs: [{ id: 'nc_1', inspecao_id: 'insp_1', gravidade: 'media', descricao: 'NC teste', status: 'aberta', criado_em: '2026-08-03T10:00:00Z' }],
  comgas_pa: [{ id: 'pa_1', nc_id: 'nc_1', acao: 'Corrigir', responsavel: 'Sup', prazo: '2026-10-10', prioridade: 'media', status: 'pendente' }],
  comgas_cdis: [], comgas_rems: [],
  enel_inspecoes: [], enel_ncs: [{ id: 'nc_e1', status: 'aberta' }], enel_pa: [], enel_cdis: [], enel_rems: [],
};

(async () => {
  // Abrir a aba NC carrega o módulo do banco (antes: comgasInit saía cedo e as listas ficavam vazias)
  let c = cenario({ dados: DADOS });
  val(c, "comgasShowTab('nc')");
  await esperar();
  const tabs = c.fetches.map(f => f[0]);
  ok('carga: 5 tabelas COMGÁS', JSON.stringify(tabs) === JSON.stringify(['comgas_inspecoes', 'comgas_ncs', 'comgas_pa', 'comgas_cdis', 'comgas_rems']), tabs);
  ok('carga: ignora excluídos (deleted_at=is.null)', c.fetches.every(f => (f[1].filters || []).includes('deleted_at=is.null')));
  ok('carga: arrays vindos do servidor', val(c, 'comgas_ncs.length') === 1 && val(c, 'comgas_pa.length') === 1 && val(c, "comgas_pa[0].id") === 'pa_1');
  ok('carga: vistoria desempacotada de obs_geral', val(c, 'comgas_inspecoes[0].equipe_codigo') === 'EQ1' && val(c, 'comgas_inspecoes[0].obs_geral') === 'ok');
  ok('aba NC visível e dashboard oculto', !c.els['pg-comgas-nc'].classList.contains('hidden') && c.els['pg-comgas-dashboard'].classList.contains('hidden'));
  ok('lista de NCs renderizada após a carga', /NC teste/.test(c.els['comgas-nc-lista'] ? c.els['comgas-nc-lista'].innerHTML : Object.values(c.els).map(e => e.innerHTML).join('')));
  ok('sem aviso de erro na carga', c.toasts.length === 0, c.toasts);

  val(c, "comgasShowTab('pa')");
  await esperar();
  ok('carga uma vez por sessão', c.fetches.length === 5, c.fetches.length);

  // Concluir PA grava de fato (id texto passava pelo sbUpdate e era descartado)
  val(c, "_comgasConcluirPA('pa_1')");
  await esperar();
  const u = c.updates[0] || [];
  ok('concluir PA: atualiza comgas_pa', c.updates.length === 1 && u[0] === 'comgas_pa', c.updates.length);
  ok('concluir PA: filtro por id texto e não excluído', u[2] === 'id=eq.pa_1&deleted_at=is.null', u[2]);
  ok('concluir PA: pede idTexto ao sbUpdate', u[3] && u[3].idTexto === true);
  ok('concluir PA: payload só com colunas reais e sem id', u[1] && !('id' in u[1]) && Object.keys(u[1]).every(k => COLS_PA.includes(k)) && u[1].status === 'concluido' && !!u[1].concluido_em, u[1]);
  ok('concluir PA: sucesso não recarrega nem avisa', c.fetches.length === 5 && c.toasts.length === 0);

  // Falha de gravação: avisa e recarrega do servidor (não fica o estado local fantasma)
  c = cenario({ dados: DADOS, updateFalha: true });
  val(c, "comgasShowTab('pa')");
  await esperar();
  val(c, "_comgasConcluirPA('pa_1')");
  await esperar();
  ok('falha update: aviso de erro', c.toasts.some(t => t[1] === 'erro' && /COMGÁS: não foi possível atualizar \(comgas_pa\)/.test(t[0])), c.toasts);
  ok('falha update: recarrega o módulo do banco', c.fetches.length === 10, c.fetches.length);
  ok('falha update: PA volta ao status do servidor', val(c, 'comgas_pa[0].status') === 'pendente');

  // Vistoria com NC: uma NC + um PA, gravados em ordem e só com colunas reais
  c = cenario({ dados: DADOS });
  val(c, "var _ins={id:'insp_9',equipe_codigo:'EQ9',local:'EQ9',contrato_label:'TMA',inspetor:'Insp',supervisor:'Sup'};"
    + "var _it=[{grupo:'EPI',item:'Luva',observacao:'rasgada'},{grupo:'Veículo',item:'Pneu',observacao:''}];"
    + "var _nc=inspCampoCriarNcUnificada(_ins,_it,inspCampoModuloCfg('enel')); inspCampoCriarPaUnificado('enel',_nc,_ins,_it);");
  await esperar();
  ok('vistoria: grava NC e depois PA', JSON.stringify(c.inserts.map(i => i[0])) === JSON.stringify(['enel_ncs', 'enel_pa']), c.inserts.map(i => i[0]));
  const ncRow = (c.inserts[0] || [])[1] || {}, paRow = (c.inserts[1] || [])[1] || {};
  ok('vistoria: NC só com colunas reais (itens_qtd fica local)', Object.keys(ncRow).every(k => COLS_NC.includes(k)) && !('itens_qtd' in ncRow), Object.keys(ncRow));
  ok('vistoria: PA vinculado à NC', paRow.nc_id === ncRow.id && /Tratar 2 não conformidade/.test(paRow.acao) && Object.keys(paRow).every(k => COLS_PA.includes(k)), paRow);
  ok('vistoria: NC e PA na lista local ENEL', val(c, 'enel_ncs.length') >= 1 && val(c, 'enel_pa.length') === 1);

  // Gravações em fila: a segunda só sai depois da primeira responder
  c = cenario({ dados: DADOS, insertAtraso: true });
  val(c, "ssmInsert('comgas_ncs',{id:'nc_a'}); ssmInsert('comgas_pa',{id:'pa_a',nc_id:'nc_a'});");
  await esperar();
  ok('fila: segunda gravação aguarda a primeira', c.inserts.length === 1, c.inserts.length);
  c.liberarInsert();
  await esperar();
  ok('fila: segunda gravação sai depois', c.inserts.length === 2 && c.inserts[1][0] === 'comgas_pa');

  // Falha de insert: aviso e recarga
  c = cenario({ dados: DADOS, insertFalha: true });
  val(c, "ssmInsert('enel_pa',{id:'epa_x',acao:'x',lixo:1})");
  await esperar();
  ok('falha insert: remove coluna inexistente antes de enviar', !('lixo' in c.inserts[0][1]));
  ok('falha insert: aviso ENEL e recarga', c.toasts.some(t => /ENEL: não foi possível gravar \(enel_pa\)/.test(t[0])) && c.fetches.filter(f => /^enel_/.test(f[0])).length === 5);

  // Carga com uma tabela indisponível: avisa, usa o que veio e não fica tentando em loop
  c = cenario({ dados: DADOS, fetchNulo: ['enel_pa'] });
  val(c, "enelShowTab('nc')");
  await esperar();
  ok('carga parcial: aviso cita planos de ação', c.toasts.some(t => t[1] === 'erro' && /ENEL: não foi possível carregar planos de ação/.test(t[0])), c.toasts);
  ok('carga parcial: NCs carregadas mesmo assim', val(c, 'enel_ncs.length') === 1);
  val(c, "enelShowTab('pa')");
  await esperar();
  ok('carga parcial: não repete a consulta em seguida', c.fetches.length === 5, c.fetches.length);

  // Painel do gestor carrega os dois módulos (antes mostrava "nenhuma pendente" sem consultar)
  c = cenario({ dados: DADOS });
  val(c, "document.getElementById('pg-gestor-painel').classList.remove('hidden'); renderGestorPainel()");
  await esperar();
  const mods = new Set(c.fetches.map(f => f[0].split('_')[0]));
  ok('gestor: consulta COMGÁS e ENEL', mods.has('comgas') && mods.has('enel'), [...mods]);
  ok('gestor: lista a vistoria pendente', /EQ1/.test(c.els['gestor-painel-wrap'].innerHTML));

  // Checklist em andamento não dispara recarga
  c = cenario({ dados: DADOS });
  val(c, "comgasShowTab('checklist')");
  await esperar();
  ok('checklist: não consulta o banco ao abrir', c.fetches.length === 0, c.fetches.length);

  // sbUpdate real: id texto só passa com idTexto; UUID segue igual
  const sbu = bloco(/\nasync function sbUpdate\(/) + '\n' + bloco(/\nfunction isUUID\(/);
  const urls = [];
  const cx = {
    console: { log() {}, warn() {}, error() {} }, JSON, String, Object, Array, Promise, DEMO: false, window: {},
    cenaAuthAuthorizedFetch: (url, o) => { urls.push([url, o.method]); return Promise.resolve({ ok: true }); },
    _auditAuto() {}, SB: { url: 'https://x.supabase.co' }, SB_AUTH_MSG_SESSAO: '', sbAuthShowSessaoIndisponivel() {},
  };
  vm.createContext(cx);
  vm.runInContext(sbu, cx);
  const r1 = await vm.runInContext("sbUpdate('comgas_pa',{status:'concluido'},'id=eq.pa_1&deleted_at=is.null',{idTexto:true})", cx);
  ok('sbUpdate idTexto: envia PATCH', r1 === true && urls.length === 1 && urls[0][0] === 'https://x.supabase.co/rest/v1/comgas_pa?id=eq.pa_1&deleted_at=is.null' && urls[0][1] === 'PATCH', urls);
  const r2 = await vm.runInContext("sbUpdate('comgas_pa',{status:'x'},'id=eq.pa_1')", cx);
  ok('sbUpdate sem idTexto: id não-UUID continua bloqueado', r2 === false && urls.length === 1);
  const r3 = await vm.runInContext("sbUpdate('estoque',{saldo:1},'id=eq.0b7c2a8e-1f2d-4c3b-9a8e-1234567890ab')", cx);
  ok('sbUpdate com UUID: inalterado', r3 === true && urls.length === 2);

  ok('versão: log 8.1.174', /\{v:'8\.1\.174'/.test(html));
  ok('versão: numero 8.1.x', /numero: '8\.1\.\d+'/.test(html));
  ok('versão: sw cena-8.1.x', /'cena-8\.1\.\d+'/.test(sw));

  if (failed.length) {
    console.error('FALHAS (' + failed.length + '/' + total + '):\n - ' + failed.join('\n - '));
    process.exit(1);
  }
  console.log('sesmt-ssm-restaurado: ' + total + ' verificações OK');
})().catch(e => { console.error(e); process.exit(1); });
