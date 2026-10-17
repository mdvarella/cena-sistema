'use strict';
// ETAPA 1.7b — Programação de Projetos com WL (tela):
// B1 execução criada só com a composição salva (id real), por qualquer caminho, idempotente; B2 janela das WLs abre ao
// incluir e pode fechar sem programar, com alerta "sem WL programada"; meta ≤ saldo também na tela; retirada sempre com
// motivo e pela função do banco quando há execução; B4 sem login autenticado nada da execução é gravado;
// projeto legado/em conciliação igual a antes; TMA, Diário e Portaria intactos (funções idênticas à main).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const raiz = path.join(__dirname, '..');
const norm = s => s.replace(/\r\n/g, '\n');
const html = norm(fs.readFileSync(path.join(raiz, 'index.html'), 'utf8'));
const BASE = process.env.PP_EXEC_BASE || 'da87584';
const htmlBase = norm(execFileSync('git', ['show', BASE + ':index.html'], { cwd: raiz, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
const failed = [];
let total = 0;
function ok(name, cond, detail) { total++; if (!cond) failed.push(name + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 400) : '')); }
function fnEm(h, nome) {
  const m = new RegExp('\\n(?:async )?function ' + nome + '\\(').exec(h);
  if (!m) throw new Error('função não encontrada: ' + nome);
  const re = /\n(?:async function |function |var |\/\/ ═|\/\/ ──|\/\*\*)/g;
  re.lastIndex = m.index + 12;
  const f = re.exec(h);
  return h.slice(m.index + 1, f ? f.index : undefined);
}
const fn = n => fnEm(html, n);
const semComent = s => s.replace(/\/\/[^\n]*/g, '');
const tick = () => new Promise(r => setImmediate(r));
const ticks = async (n = 12) => { for (let i = 0; i < n; i++) await tick(); };

// ── Isolamento: TMA, Diário e Portaria idênticos à main ─────────
const nomesBase = [...htmlBase.matchAll(/\nfunction ((?:prog(?!Proj|Projeto|Agenda)\w*|plpt\w*|db\w*|port\w*|_plpt\w*|sot\w*))\(/g)].map(m => m[1]);
const difs = [...new Set(nomesBase)].filter(n => { try { return fnEm(htmlBase, n) !== fn(n); } catch (e) { return true; } });
ok('TMA (prog*), Diário (plpt*/db*), Portaria (port*) e SOT idênticos à main (' + BASE + ')', difs.length === 0 && nomesBase.length > 500, { difs: difs.slice(0, 10), n: nomesBase.length });
const ppMudadas = ['ppEqRemoverProjeto', 'ppEqSelecionarProjetos', 'ppFilaColocarNaEquipe', '_progProjRenderQuadroInterno', 'progProjetoCoreRenderEquipeRow'];
const ppDifs = [...htmlBase.matchAll(/\nfunction ((?:pp|_?progProj|progProjetoCore)\w*)\(/g)].map(m => m[1]).filter(n => fnEm(htmlBase, n) !== fn(n));
ok('na Programação de Projetos só mudaram os 5 pontos de entrada', JSON.stringify(ppDifs.sort()) === JSON.stringify(ppMudadas.slice().sort()), ppDifs);

const NOVAS = ['ppExecRpc', 'ppExecCompReal', 'ppExecProjetosDoDia', 'ppExecDaEquipe', 'ppExecEstado', 'ppExecGarantirDia',
  'ppExecAposIncluir', 'ppExecPrecisaRetirarPorFuncao', 'ppExecRetirarProjetos', 'ppExecResumoWls', 'ppExecChipProjetoHtml', 'ppExecNum', 'ppExecFmt',
  'ppExecQuando', 'ppExecAbrirWls', 'ppExecRenderModalWls', 'ppExecCompromissosHtml', 'ppExecMarcarWl', 'ppExecColetarItens', 'ppExecSalvarWls', 'ppExecRetirarItem'];
const codigoNovo = NOVAS.map(fn).join('\n');
ok('ES5 nas funções novas e alteradas', !/\blet\s|\bconst\s|=>|`/.test(semComent(codigoNovo + ppMudadas.map(fn).join('\n'))));
ok('execução só por função do banco (nenhuma escrita direta nas tabelas novas)', !/prog_proj_execuc/.test(codigoNovo.replace(/fn_proj_execucao_\w+/g, '')));
ok('nenhum lançamento de quantidade executada na 1.7b', !/fn_proj_execucao_lancar|fn_proj_execucao_estornar|qtd_executada\s*[:=]/.test(codigoNovo));
ok('não liga o interruptor', !/proj_execucao_config/.test(codigoNovo));

// ── Sandbox ─────────────────────────────────────────────────────
const VARS = ['PP_EXEC_MSG_SEM_AUTH', '_ppExec', 'PP_EXEC_ERROS'];
const varsSrc = VARS.map(v => { const i = html.indexOf('\nvar ' + v + ' = '); const f = html.indexOf(';\n', i); return html.slice(i + 1, f + 1); }).join('\n');
const PE = 'pe-estr', PL = 'pl-leg', PC = 'pc-conc';
function sandbox(o) {
  o = o || {};
  const calls = [];
  const ctx = {
    console: { log() {}, warn() {}, error() {} }, Promise, JSON, Object, Array, String, Number, Math, isFinite, Date, isNaN, setTimeout: (f) => f(),
    DEMO: false, SB: { url: 'https://x', key: 'k' }, _sbAuthToken: o.semAuth ? null : 'jwt',
    cenaAuthGetValidToken: () => Promise.resolve(o.semAuth ? null : 'jwt'), sbAuthJwtIsAuthenticated: t => !!t,
    dataHojeLocal: () => '2026-10-17', progProjGetData: () => o.data || '2026-10-17', progProjGetCid: () => 'c1',
    composicao_dia: o.comps || [], equipes: [{ id: 'eq1', nome_equipe: 'EQ 1' }],
    progProjGetProjetos: () => [{ id: PE, nome: 'TESTE 1' }, { id: PL, nome: 'LEGADO' }, { id: PC, nome: 'VARGINHA' }],
    progFindCompDia: (eq, d) => (ctx.composicao_dia || []).find(c => c.equipe_id === eq && c.data === d) || null,
    progProjetoCoreListaProjetos: t => { try { const a = typeof t === 'string' ? JSON.parse(t || '[]') : (t || []); return a.map(String); } catch (e) { return []; } },
    escHtml: s => String(s == null ? '' : s), fmtD: d => d,
    toasts: [], progShowToast(m, t) { ctx.toasts.push([m, t || '']); },
    renders: 0, progProjRenderQuadro() { ctx.renders++; },
    alerts: [], alert(m) { ctx.alerts.push(m); }, prompts: [], prompt(m) { ctx.prompts.push(m); return o.motivo === undefined ? 'motivo x' : o.motivo; },
    ppFilaSincronizarProjeto() { return Promise.resolve(); }, ppFilaInvalidar() {}, setModal(h) { ctx.modal = h; }, closeModal() { ctx.modal = null; },
    document: { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null },
    calls,
    fetch: (url, opt) => {
      const fnName = url.split('/rpc/')[1]; const p = JSON.parse(opt.body);
      calls.push([fnName, p, opt.headers.Authorization]);
      const resp = (o.rpc && o.rpc[fnName]) ? o.rpc[fnName](p, calls) : { status: 200, body: {} };
      return Promise.resolve({ ok: resp.status === 200, status: resp.status, text: () => Promise.resolve(JSON.stringify(resp.body)) });
    }
  };
  vm.createContext(ctx);
  vm.runInContext(varsSrc + '\n' + codigoNovo, ctx);
  return ctx;
}
const DIA_OK = (estados, execucoes) => ({ status: 200, body: { data: '2026-10-17', estados, execucoes: execucoes || [] } });
const ESTADOS = { [PE]: 'ESTRUTURADO', [PL]: 'LEGADO_SEM_WL', [PC]: 'EM_CONCILIACAO' };
const compReal = (projs, extra) => Object.assign({ id: 'comp-1', equipe_id: 'eq1', data: '2026-10-17', projeto_ids: JSON.stringify(projs) }, extra || {});

(async () => {
  // Erros do banco viram mensagem e código
  let c = sandbox({ rpc: { x: () => ({ status: 400, body: { message: 'QTD_ACIMA_DO_SALDO: meta 5 maior que o saldo 4 da atividade' } }) } });
  let r = await c.ppExecRpc('x', {});
  ok('rpc: código do banco traduzido', r.ok === false && r.codigo === 'QTD_ACIMA_DO_SALDO' && /saldo/.test(r.error), r);
  c = sandbox({ semAuth: true });
  r = await c.ppExecRpc('fn_proj_execucao_criar', {});
  ok('B4: sem login autenticado nenhuma chamada sai e a orientação é clara', r.ok === false && r.semAuth && c.calls.length === 0 && /login autenticado/.test(r.error), r);

  // Abrir o quadro não grava: só lê o dia, mesmo com projeto estruturado em composição salva sem programação
  c = sandbox({ comps: [compReal([PE, PL])], rpc: { fn_proj_execucao_dia: () => DIA_OK(ESTADOS) } });
  c.ppExecGarantirDia('2026-10-17');
  await ticks(20);
  c.ppExecGarantirDia('2026-10-17');
  await ticks(10);
  ok('abrir o quadro: só a leitura do dia (nenhuma gravação)', c.calls.length === 1 && c.calls[0][0] === 'fn_proj_execucao_dia'
    && c.calls[0][1].p_projeto_ids.join() === [PE, PL].join(), c.calls.map(x => x[0]));
  ok('abrir o quadro: não existe mais criação automática', !/fn_proj_execucao_criar/.test(fn('ppExecGarantirDia')) && !/ppExecCriarFaltantes/.test(html));
  c.composicao_dia.push(compReal([PE], { id: 'comp-2', equipe_id: 'eq2' }));
  c.composicao_dia[0].projeto_ids = JSON.stringify([PE, PL, 'novo-pid']);
  c.ppExecGarantirDia('2026-10-17');
  await ticks(10);
  ok('projeto novo no dia (Auto Escalar/TMA): só relê, não cria', c.calls.length === 2 && c.calls.every(x => x[0] === 'fn_proj_execucao_dia'), c.calls.map(x => x[0]));
  // Etiqueta no card
  c = sandbox({ comps: [compReal([PE, PL, PC])] });
  c._ppExec.data = '2026-10-17'; c._ppExec.carregado = true; c._ppExec.estados = ESTADOS;
  c._ppExec.execucoes = [{ execucao_id: 'e1', projeto_id: PE, equipe_id: 'eq1', composicao_dia_id: 'comp-1', itens: [] }];
  c._ppExec.execucoes = [];
  let h0 = c.ppExecChipProjetoHtml('eq1', PE, { nome: 'TESTE 1' }, '2026-10-17');
  ok('sem programação (Auto Escalar/TMA): alerta + clique para programar', /sem WL programada — clique para programar/.test(h0) && /ppExecAbrirWls\('eq1','pe-estr'\)/.test(h0), h0);
  c._ppExec.execucoes = [{ execucao_id: 'e1', projeto_id: PE, equipe_id: 'eq1', composicao_dia_id: 'comp-1', itens: [] }];
  let h = c.ppExecChipProjetoHtml('eq1', PE, { nome: 'TESTE 1' }, '2026-10-17');
  ok('B2: estruturado sem WL programada mostra o alerta', /sem WL programada/.test(h) && /ppExecAbrirWls\('eq1','pe-estr'\)/.test(h), h);
  c._ppExec.execucoes[0].itens = [{ wl_codigo: '1' }, { wl_codigo: '1' }, { wl_codigo: '2' }];
  h = c.ppExecChipProjetoHtml('eq1', PE, { nome: 'TESTE 1' }, '2026-10-17');
  ok('etiqueta resume WLs e atividades programadas', /WL 1, 2 · 3 ativ\./.test(h), h);
  h = c.ppExecChipProjetoHtml('eq1', PL, { nome: 'LEGADO' }, '2026-10-17');
  ok('legado: etiqueta como antes (+ "Sem WL"), sem abrir WLs', /LEGADO/.test(h) && /Sem WL/.test(h) && !/ppExecAbrirWls/.test(h) && /ppEqRemoverProjeto\('eq1','pl-leg'\)/.test(h), h);
  ok('em conciliação: "Sem WL", sem abrir WLs', /Sem WL/.test(c.ppExecChipProjetoHtml('eq1', PC, { nome: 'V' }, '2026-10-17')) && !/ppExecAbrirWls/.test(c.ppExecChipProjetoHtml('eq1', PC, { nome: 'V' }, '2026-10-17')));
  c._ppExec.semAuth = true;
  ok('B4: sem login autenticado a etiqueta orienta e não promete programação', /login autenticado/.test(c.ppExecChipProjetoHtml('eq1', PE, { nome: 'T' }, '2026-10-17')));

  // Retirada
  c = sandbox({ comps: [compReal([PE, PL])], rpc: {
    fn_proj_execucao_retirar_projeto: p => ({ status: 200, body: { operacao: 'PROJETO_RETIRADO', projeto_ids: [PL] } }),
    fn_proj_execucao_dia: () => DIA_OK(ESTADOS) } });
  c._ppExec.data = '2026-10-17'; c._ppExec.carregado = true; c._ppExec.estados = ESTADOS;
  c._ppExec.execucoes = [{ execucao_id: 'e1', projeto_id: PE, equipe_id: 'eq1', composicao_dia_id: 'comp-1', itens: [{ qtd_lancada: 0 }] }];
  ok('retirada: estruturado com execução vai pela função do banco; legado não', c.ppExecPrecisaRetirarPorFuncao('eq1', '2026-10-17', PE) === true
    && c.ppExecPrecisaRetirarPorFuncao('eq1', '2026-10-17', PL) === false);
  let okR = await c.ppExecRetirarProjetos('eq1', '2026-10-17', [PE]);
  const ret = c.calls.find(x => x[0] === 'fn_proj_execucao_retirar_projeto');
  ok('retirada: pede motivo e grava numa chamada (composição + cancelamento)', okR === true && c.prompts.length === 1 && ret && ret[1].p_motivo === 'motivo x'
    && ret[1].p_composicao_dia_id === 'comp-1' && c.composicao_dia[0].projeto_ids === JSON.stringify([PL]), { okR, ret });
  c = sandbox({ comps: [compReal([PE])], motivo: '   ' });
  c._ppExec.data = '2026-10-17'; c._ppExec.estados = ESTADOS; c._ppExec.execucoes = [{ projeto_id: PE, composicao_dia_id: 'comp-1', itens: [] }];
  okR = await c.ppExecRetirarProjetos('eq1', '2026-10-17', [PE]);
  ok('retirada sem motivo: nada é chamado', okR === false && c.calls.length === 0 && /motivo/i.test(c.toasts[0][0]));
  c = sandbox({ comps: [compReal([PE])] });
  c._ppExec.data = '2026-10-17'; c._ppExec.estados = ESTADOS; c._ppExec.execucoes = [{ projeto_id: PE, composicao_dia_id: 'comp-1', itens: [{ qtd_lancada: 2 }] }];
  okR = await c.ppExecRetirarProjetos('eq1', '2026-10-17', [PE]);
  ok('retirada com quantidade lançada: bloqueada na tela, nada chamado', okR === false && c.calls.length === 0 && /lançada/.test(c.alerts[0]));
  c = sandbox({ comps: [compReal([PE])], semAuth: true });
  c._ppExec.data = '2026-10-17'; c._ppExec.estados = ESTADOS; c._ppExec.semAuth = true; c._ppExec.execucoes = [{ projeto_id: PE, composicao_dia_id: 'comp-1', itens: [] }];
  okR = await c.ppExecRetirarProjetos('eq1', '2026-10-17', [PE]);
  ok('B4: retirada sem login autenticado não grava nada', okR === false && c.calls.length === 0 && /login autenticado/.test(c.alerts[0]));

  // Depois de incluir (fila / janela): só com composição salva; cria e abre as WLs
  c = sandbox({ comps: [compReal([PE])], rpc: {
    fn_proj_execucao_dia: () => DIA_OK(ESTADOS),
    fn_proj_execucao_criar: () => ({ status: 200, body: { operacao: 'CRIADA', execucao_id: 'e9' } }),
    fn_proj_saldo_atividades: () => ({ status: 200, body: { atividades: [] } }) } });
  let abriu = [];
  c.ppExecAbrirWls = (eq, pid) => abriu.push([eq, pid]);
  await c.ppExecAposIncluir('eq1', '2026-10-17', [PE], { abrir: true });
  await ticks(10);
  ok('incluir: lê o dia antes, cria a execução e abre a janela das WLs', c.calls[0][0] === 'fn_proj_execucao_dia' && c.calls.some(x => x[0] === 'fn_proj_execucao_criar')
    && abriu.length === 1 && abriu[0][1] === PE, { calls: c.calls.map(x => x[0]), abriu });
  c = sandbox({ comps: [compReal([PL])], rpc: { fn_proj_execucao_dia: () => DIA_OK(ESTADOS) } });
  c.ppExecAbrirWls = (eq, pid) => abriu.push(['x', pid]);
  await c.ppExecAposIncluir('eq1', '2026-10-17', [PL], { abrir: true });
  ok('incluir legado: nada da execução', !c.calls.some(x => x[0] === 'fn_proj_execucao_criar'));
  c = sandbox({ comps: [compReal([PE], { id: 'local_x', _local: true })], rpc: { fn_proj_execucao_dia: () => DIA_OK(ESTADOS) } });
  await c.ppExecAposIncluir('eq1', '2026-10-17', [PE], { abrir: true });
  ok('incluir sem composição salva: não cria execução', !c.calls.some(x => x[0] === 'fn_proj_execucao_criar'));
  c = sandbox({ comps: [compReal([PE])], rpc: { fn_proj_execucao_dia: () => DIA_OK(ESTADOS),
    fn_proj_execucao_criar: () => ({ status: 400, body: { message: 'PROJETO_FORA_DA_COMPOSICAO: x' } }) } });
  await c.ppExecAposIncluir('eq1', '2026-10-17', [PE], { abrir: true });
  await ticks(5);
  ok('incluir: falha na criação avisa e não abre a janela', c.toasts.some(t => t[1] === 'erro' && /não foi criada/.test(t[0])));

  // Janela das WLs: previsto, executado, saldo, meta e quem programou
  c = sandbox({ comps: [compReal([PE])] });
  c.ppExecRenderModalWls('eq1', PE, '2026-10-17', { execucao_id: 'e1', itens: [{ item_id: 'i1', atividade_id: 'a1', wl_id: 'w1', qtd_programada: 2, qtd_lancada: 0, criado_por: 'Fulano', criado_em: '2026-10-17T10:00:00Z' }] },
    [{ atividade_id: 'a1', wl_id: 'w1', wl_codigo: '1', codigo: 'I-100', descricao: 'SERV A', unidade: 'US3', qtd_prevista: 4, qtd_executada: 0, saldo: 4 },
     { atividade_id: 'a2', wl_id: 'w1', wl_codigo: '1', codigo: 'I-200', descricao: 'SERV B', unidade: 'US3', qtd_prevista: 2, qtd_executada: 0, saldo: 2,
       qtd_comprometida: 1.5, saldo_livre: 0.5, compromissos: [{ equipe_id: 'eq1', data: '2026-10-18', qtd_aberta: 1.5 }] }]);
  ok('janela: colunas previsto, executado, comprometido, livre e meta do dia', /Previsto/.test(c.modal) && /Executado/.test(c.modal) && /Comprometido/.test(c.modal)
    && />Livre</.test(c.modal) && /Meta do dia/.test(c.modal));
  ok('janela: meta limitada ao saldo livre no campo', /max="0.5" class="pp-exec-meta" data-at="a2"/.test(c.modal), c.modal.match(/max="[^"]*" class="pp-exec-meta" data-at="a2"/));
  ok('janela: mostra equipe e data onde o saldo está comprometido', /comprometido: EQ 1 \(2026-10-18\) 1,5/.test(c.modal), c.modal.match(/comprometido:[^<]*/));
  ok('janela: atividade já programada mostra quem e quando, e Retirar', /programada por Fulano em/.test(c.modal) && /ppExecRetirarItem\('eq1','pe-estr','i1'\)/.test(c.modal));
  ok('janela: pode fechar sem programar', /Fechar sem programar/.test(c.modal));
  ok('janela: meta não é execução (texto)', /Meta não é execução/.test(c.modal));

  // Coleta dos itens (DOM falso)
  function dom(els) {
    return {
      getElementById: () => null,
      querySelectorAll: sel => els.filter(e => e.match(sel)),
      querySelector: sel => els.find(e => e.match(sel)) || null
    };
  }
  function el(cls, attrs, extra) {
    const a = Object.assign({}, attrs);
    return Object.assign({ cls, checked: false, disabled: false, value: '',
      getAttribute: k => a[k] === undefined ? null : a[k], setAttribute: (k, v) => { a[k] = v; }, removeAttribute: k => { delete a[k]; },
      match(sel) {
        if (sel.indexOf('.' + cls) < 0) return false;
        const m = [...sel.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)];
        return m.every(x => x[2] === undefined ? a[x[1]] !== undefined : String(a[x[1]]) === x[2]);
      } }, extra || {});
  }
  c = sandbox();
  c.document = dom([el('pp-exec-wl', { 'data-wl': 'w1' }, { checked: true }),
    el('pp-exec-at', { 'data-wl': 'w1', 'data-at': 'a1', 'data-livre': '4' }, { checked: true }),
    el('pp-exec-at', { 'data-wl': 'w1', 'data-at': 'a2', 'data-livre': '2' }, { checked: true }),
    el('pp-exec-meta', { 'data-at': 'a1' }), el('pp-exec-meta', { 'data-at': 'a2' })]);
  let col = c.ppExecColetarItens();
  ok('coleta: WL inteira sem meta vira um item só da WL', !col.erro && col.itens.length === 1 && col.itens[0].wl_id === 'w1' && !col.itens[0].atividade_id, col);
  c.document = dom([el('pp-exec-wl', { 'data-wl': 'w1' }, { checked: true }),
    el('pp-exec-at', { 'data-wl': 'w1', 'data-at': 'a1', 'data-livre': '4' }, { checked: true }),
    el('pp-exec-at', { 'data-wl': 'w1', 'data-at': 'a2', 'data-livre': '2' }, { checked: false }),
    el('pp-exec-meta', { 'data-at': 'a1' }, { value: '3' }), el('pp-exec-meta', { 'data-at': 'a2' })]);
  col = c.ppExecColetarItens();
  ok('coleta: com meta vai por atividade (meta 3 ≤ saldo 4)', !col.erro && col.itens.length === 1 && col.itens[0].atividade_id === 'a1' && col.itens[0].qtd_programada === 3, col);
  c.document = dom([el('pp-exec-at', { 'data-wl': 'w1', 'data-at': 'a2', 'data-livre': '2' }, { checked: true }), el('pp-exec-meta', { 'data-at': 'a2' }, { value: '2,5' })]);
  col = c.ppExecColetarItens();
  ok('coleta: meta acima do saldo livre não passa calada (marca exceção para pedir justificativa)', !col.erro && col.itens[0]._excesso && col.itens[0]._excesso.livre === 2, col);
  c.document = dom([el('pp-exec-at', { 'data-wl': 'w1', 'data-at': 'a2', 'data-livre': '2' }, { checked: true }), el('pp-exec-meta', { 'data-at': 'a2' }, { value: '-1' })]);
  ok('coleta: meta negativa recusada', /inválida/.test(c.ppExecColetarItens().erro || ''));
  c.document = dom([el('pp-exec-wl', { 'data-wl': 'w1' }, { checked: true }),
    el('pp-exec-at', { 'data-wl': 'w1', 'data-at': 'a1', 'data-livre': '4' }, { checked: true, disabled: true }),
    el('pp-exec-at', { 'data-wl': 'w1', 'data-at': 'a2', 'data-livre': '2' }, { checked: true }), el('pp-exec-meta', { 'data-at': 'a2' })]);
  col = c.ppExecColetarItens();
  ok('coleta: WL com atividade já programada inclui só as novas (sem repetir)', !col.erro && col.itens.length === 1 && col.itens[0].atividade_id === 'a2', col);

  // Salvar com excesso: pede justificativa; sem ela nada é enviado
  for (const just of ['reforço aprovado', null]) {
    c = sandbox({ rpc: { fn_proj_execucao_definir_itens: () => ({ status: 200, body: { incluidos: 1 } }), fn_proj_execucao_dia: () => DIA_OK(ESTADOS) } });
    c.prompt = () => just;
    const errEl = { textContent: '', style: {} };
    c.document = dom([el('pp-exec-at', { 'data-wl': 'w1', 'data-at': 'a2', 'data-livre': '0.5' }, { checked: true }), el('pp-exec-meta', { 'data-at': 'a2' }, { value: '1' })]);
    c.document.getElementById = id => id === 'pp-exec-erro' ? errEl : null;
    c.ppExecSalvarWls('eq1', PE, '2026-10-17', 'e1', { disabled: false, textContent: '' });
    await ticks(10);
    const env = c.calls.find(x => x[0] === 'fn_proj_execucao_definir_itens');
    if (just) ok('excesso com justificativa: enviada ao banco junto com a meta', env && env[1].p_itens[0].excesso_justificativa === 'reforço aprovado'
      && env[1].p_itens[0].qtd_programada === 1 && !('_excesso' in env[1].p_itens[0]), env);
    else ok('excesso sem justificativa: nada é enviado e a tela explica', !env && /saldo livre/.test(errEl.textContent), errEl.textContent);
  }
  // Pontos de entrada (estático)
  ok('fila: depois de salvar a composição cria a execução e abre as WLs', /ppExecAposIncluir\(eqId, data, \[pid\], \{abrir:true\}\)/.test(fn('ppFilaColocarNaEquipe'))
    && fn('ppFilaColocarNaEquipe').indexOf('ppExecAposIncluir') > fn('ppFilaColocarNaEquipe').indexOf('if(!ok){'));
  ok('janela de projetos: retirada de estruturado com execução exige motivo e vai pela função; inclusão abre WLs',
    /ppExecPrecisaRetirarPorFuncao/.test(fn('ppEqSelecionarProjetos')) && /ppExecRetirarProjetos\(eqId, data, remExec, motivoRem\)/.test(fn('ppEqSelecionarProjetos'))
    && /ppExecAposIncluir\(eqId, data, add, \{abrir:true\}\)/.test(fn('ppEqSelecionarProjetos')));
  ok('✕ do card: estruturado com execução vai pela função; demais como antes', /ppExecPrecisaRetirarPorFuncao\(eqId, data, projetoId\)/.test(fn('ppEqRemoverProjeto'))
    && /progProjetoCoreAlterarProjetosEquipe\(eqId, data, \{remove:\[projetoId\]\}\)/.test(fn('ppEqRemoverProjeto')));
  ok('quadro: carrega o dia da execução (uma vez por data)', /ppExecGarantirDia\(data\)/.test(fn('_progProjRenderQuadroInterno')));
  ok('card: etiqueta nova com reserva do texto antigo', /ppExecChipProjetoHtml\(eq\.id, pid, p, data\)/.test(fn('progProjetoCoreRenderEquipeRow')));
  ok('equipe confirmada: programar WLs não mexe na confirmação', !/confirmada/.test(fn('ppExecSalvarWls') + fn('ppExecAbrirWls') + fn('ppExecRetirarItem')));

  if (failed.length) { console.error('FALHOU ' + failed.length + '/' + total + ':\n- ' + failed.join('\n- ')); process.exit(1); }
  console.log('prog-projetos-execucao-wl-ui: OK (' + total + ' verificações, base ' + BASE + ')');
})().catch(e => { console.error(e); process.exit(1); });
