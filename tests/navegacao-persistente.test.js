'use strict';
// 8.1.199 — Navegação persistente: ?page=pg-<tela>, pushState/replaceState, popstate, sessionStorage e permissões.
// Executa showMain/showSub reais + bloco cenaNav* do index.html com histórico, URL e sessionStorage falsos.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
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
function bloco(ini, fim) {
  const n = html.split(ini).length - 1;
  if (n !== 1) throw new Error('início de bloco ' + ini + ': ' + n);
  const a = html.indexOf(ini);
  const b = html.indexOf(fim, a);
  if (b < 0) throw new Error('fim de bloco ' + fim);
  return html.slice(a, b + fim.length);
}

const CODIGO = [
  bloco('var PERFIS_FROTAS_BLOQ = {', '\n};\n'),
  bloco('var PERFIS_MODULO_ALLOW = {', '\n};\n'),
  bloco('var MAIN_CONFIG = {', '\n};\n'),
  bloco('var SIDEBAR_GROUPS = {', '\n};\n'),
  ['perfilEhDpRh', 'perfilDpRhFiltrarSidebar', 'perfilFrotasModuloBloqueado', 'perfilModuloBloqueado',
    'sidebarItensDoGrupo', 'sidebarGruposDoPerfil', 'showMain', 'showSub'].map(fn).join('\n'),
  bloco('// ── Navegação persistente:', "window.addEventListener('popstate', cenaNavAoVoltar);"),
].join('\n');

function botao(id, oculto) {
  return { id, oculto, classList: { add() {}, remove() {} } };
}
function novoHistorico(url) {
  return { entradas: [{ state: null, url }], idx: 0 };
}

/**
 * opts: perfil, url (inicial), sessao (store compartilhado), hist (histórico compartilhado p/ simular F5),
 *       ocultos (botões mn-* escondidos por CSS), t (relógio inicial).
 */
function sandbox(opts) {
  opts = opts || {};
  const relogio = { t: opts.t || 1000000 };
  const hist = opts.hist || novoHistorico(opts.url || 'https://erp.test/');
  const loc = { pathname: '/', search: '', hash: '' };
  Object.defineProperty(loc, 'href', { get: () => 'https://erp.test' + loc.pathname + loc.search + loc.hash });
  function aplicar(url) {
    const u = new URL(url, loc.href);
    loc.pathname = u.pathname; loc.search = u.search; loc.hash = u.hash;
  }
  aplicar(hist.entradas[hist.idx].url);
  const ouvintes = {};
  const c = {
    console: { log() {}, warn() {}, error: console.error },
    Object, Array, String, JSON, URL, URLSearchParams,
    Date: { now: () => relogio.t },
    location: loc,
    paginas: [], toasts: [], ops: [],
    usuarioLogado: opts.perfil === null ? null : { id: 'u1', perfil: opts.perfil || 'admin', nome: 'Teste' },
    _mainAtual: 'dashboard', _subAtual: {},
    sessionStorage: {
      getItem: k => (Object.prototype.hasOwnProperty.call(opts.sessao || {}, k) ? opts.sessao[k] : null),
      setItem: (k, v) => { if (opts.sessao) opts.sessao[k] = String(v); },
    },
    document: {
      getElementById: id => (/^mn-[a-z-]+$/.test(id) ? botao(id, (opts.ocultos || []).indexOf(id) >= 0) : null),
      querySelectorAll: () => [],
    },
    progShowToast(msg, tipo) { c.toasts.push({ msg, tipo }); },
    sidebarMostrarItens() {}, _renderSubNav() {}, ocultarPaginasSESMTAlmoxarifado() {},
    showPageDiario() { c.paginas.push('diario'); }, plrInit() {},
    showPage(id) { c.paginas.push(id); c.cenaNavRegistrar(id); },
  };
  const history = {
    pushState(state, _t, url) {
      hist.entradas = hist.entradas.slice(0, hist.idx + 1);
      hist.entradas.push({ state, url }); hist.idx++; aplicar(url); c.ops.push('push');
    },
    replaceState(state, _t, url) {
      hist.entradas[hist.idx] = { state, url }; aplicar(url); c.ops.push('replace');
    },
  };
  c.history = history;
  c.window = {
    history,
    addEventListener(tipo, f) { ouvintes[tipo] = f; },
    getComputedStyle: el => ({ display: el.oculto ? 'none' : 'block' }),
  };
  c.hist = hist;
  c.relogio = relogio;
  c.voltar = function (passos) {
    hist.idx += passos;
    const e = hist.entradas[hist.idx];
    aplicar(e.url);
    if (ouvintes.popstate) ouvintes.popstate({ state: e.state });
  };
  c.mudarHash = function (h) {
    hist.entradas = hist.entradas.slice(0, hist.idx + 1);
    const url = loc.pathname + loc.search + h;
    hist.entradas.push({ state: null, url }); hist.idx++; aplicar(url);
    if (ouvintes.popstate) ouvintes.popstate({ state: null });
  };
  c.ouvintes = ouvintes;
  vm.createContext(c);
  vm.runInContext(CODIGO, c);
  return c;
}
function avancar(c, ms) { c.relogio.t += (ms || 2000); }
function bootAdmin(c) { if (!c.cenaNavRestaurarInicial()) c.showMain('dashboard'); }
function qs(c) { return new URLSearchParams(c.location.search); }

// ── Estático ─────────────────────────────────────────────────────
{
  const sp = fn('showPage');
  ok('showPage registra a tela no fim', /_autoRefresh\.iniciar\(pageId\);\n  cenaNavRegistrar\(pageId\);\n\}$/.test(sp));
  ok('showPage com negação de acesso retorna antes de registrar (rh-)', /rhModuloPermitido[\s\S]*?showMain\('dashboard'\); return;/.test(sp));
  const smi = fn('sidebarMostrarItens');
  ok('menu lateral usa o mesmo filtro de perfil da navegação', smi.indexOf('var grupos = sidebarGruposDoPerfil(main);') >= 0
    && smi.indexOf("perfil==='almoxarife'") < 0);
  ok('popstate ligado uma vez', html.split("window.addEventListener('popstate', cenaNavAoVoltar);").length === 2);
  ok('nenhum window.onpopstate sobrescrito', !/window\.onpopstate\s*=/.test(html));
  ok('login restaura antes da tela do perfil', /\} else if\(cenaNavRestaurarInicial\(\)\)\{\n      console\.log\('\[LOGIN\]/.test(html));
  ok('login encarregado restaura ou vai ao campo', html.indexOf("      if(!cenaNavRestaurarInicial()) showMain('campo');\n    } else if(cenaNavRestaurarInicial()){") >= 0);
  ok('sessão (F5) restaura antes da tela do perfil', /\}else if\(cenaNavRestaurarInicial\(\)\)\{\n        console\.log\('\[INIT\] tela restaurada/.test(html));
  ok('sessão encarregado restaura após resolver equipe',
    html.indexOf("resolveEquipeUsuario().then(function(){ if(!cenaNavRestaurarInicial()) showMain('campo'); });") >= 0);
  ok('sessão: restauração vem antes do ramo da portaria',
    html.indexOf("}else if(cenaNavRestaurarInicial()){\n        console.log('[INIT] tela restaurada") < html.indexOf("console.log('[INIT] portaria → frotas-portaria');"));
  ok('versão 8.1.199', /numero: '8\.1\.199'/.test(html) && html.indexOf("{v:'8.1.199'") >= 0);
  ok('SW 8.1.199', sw.indexOf("const SW_VERSION   = 'cena-8.1.199';") >= 0);
}

// ── Aba nova sem URL → tela inicial do perfil; replaceState no boot ──
{
  const sessao = {};
  const c = sandbox({ sessao });
  bootAdmin(c);
  ok('boot sem URL: dashboard', c.paginas.join() === 'dashboard', c.paginas);
  ok('boot usa replaceState (não cria entrada)', c.ops.join() === 'replace' && c.hist.entradas.length === 1, c.ops);
  ok('boot grava ?page=pg-dashboard', qs(c).get('page') === 'pg-dashboard', c.location.search);
  ok('boot grava sessionStorage.lastPage', sessao.lastPage === 'pg-dashboard' && sessao.lastMain === 'dashboard', sessao);
  ok('estado do histórico tem página e módulo', JSON.stringify(c.hist.entradas[0].state) === JSON.stringify({ cenaNav: 1, page: 'pg-dashboard', main: 'dashboard' }));
}

// ── Critério: Frotas > subpágina + F5 volta para a mesma tela ─────
{
  const sessao = {};
  const c = sandbox({ sessao });
  bootAdmin(c);
  avancar(c); c.showMain('frotas');
  avancar(c); c.showSub('frotas-integracoes');
  ok('navegação do usuário usa pushState', c.ops.join() === 'replace,push,push', c.ops);
  ok('URL com ?page=pg-frotas-integracoes', qs(c).get('page') === 'pg-frotas-integracoes', c.location.search);
  ok('3 entradas no histórico', c.hist.entradas.length === 3 && c.hist.idx === 2);

  const f5 = sandbox({ sessao, hist: c.hist, t: c.relogio.t + 5000 });
  bootAdmin(f5);
  ok('F5: reabre Frotas > Integrações', f5.paginas[f5.paginas.length - 1] === 'frotas-integracoes' && f5._mainAtual === 'frotas', f5.paginas);
  ok('F5: não abre a tela inicial antes', f5.paginas.indexOf('dashboard') < 0, f5.paginas);
  ok('F5: sem entrada nova no histórico', f5.hist.entradas.length === 3 && f5.ops.every(o => o === 'replace'), f5.ops);
  ok('F5: URL mantida', qs(f5).get('page') === 'pg-frotas-integracoes');
}

// ── Critério: Almoxarifado → RH → Voltar retorna ao Almoxarifado ──
{
  const c = sandbox({ sessao: {} });
  bootAdmin(c);
  avancar(c); c.showMain('almoxarifado');
  const pgAlm = c.paginas[c.paginas.length - 1];
  avancar(c); c.showMain('rh');
  ok('RH aberto', c._mainAtual === 'rh' && c.paginas[c.paginas.length - 1] === 'rh-dashboard', c.paginas);
  const opsAntes = c.ops.length;
  c.voltar(-1);
  ok('Voltar: Almoxarifado de novo', c._mainAtual === 'almoxarifado' && c.paginas[c.paginas.length - 1] === pgAlm, c.paginas);
  ok('Voltar: sem push (sem laço)', c.ops.slice(opsAntes).indexOf('push') < 0 && c.hist.entradas.length === 3, c.ops.slice(opsAntes));
  ok('Voltar: URL do Almoxarifado', qs(c).get('page') === 'pg-' + pgAlm);
  c.voltar(1);
  ok('Avançar: RH de novo', c._mainAtual === 'rh' && c.paginas[c.paginas.length - 1] === 'rh-dashboard' && c.hist.entradas.length === 3);
  // Critério: um Voltar depois de navegar não sai do sistema
  c.voltar(-1); c.voltar(-1);
  ok('Voltar até a 1ª tela continua no ERP (dashboard)', c.hist.idx === 0 && c.paginas[c.paginas.length - 1] === 'dashboard'
    && c.hist.entradas[0].state && c.hist.entradas[0].state.cenaNav === 1);
}

// ── Critério: URL ?page=pg-x em nova aba (sessionStorage vazio) ───
{
  const c = sandbox({ sessao: {}, url: 'https://erp.test/?page=pg-rh-vagas' });
  bootAdmin(c);
  ok('nova aba: abre rh-vagas pelo link', c.paginas.join() === 'rh-vagas' && c._mainAtual === 'rh', c.paginas);
  ok('nova aba: só replaceState', c.ops.every(o => o === 'replace') && c.hist.entradas.length === 1);
  ok('nova aba: sem toast de erro', c.toasts.length === 0, c.toasts);
}

// ── Página do submenu "Em Campo" dentro de Operacional ────────────
{
  const c = sandbox({ sessao: {}, url: 'https://erp.test/?page=pg-campo-apr' });
  bootAdmin(c);
  ok('campo-apr restaurada mesmo com reset de sub do showMain', c.paginas[c.paginas.length - 1] === 'campo-apr' && c._mainAtual === 'operacional', c.paginas);
  ok('redirecionamento interno não cria entrada', c.hist.entradas.length === 1);
}

// ── Sem URL válida → última tela da aba ───────────────────────────
{
  const c = sandbox({ sessao: { lastPage: 'pg-frotas-veiculos', lastMain: 'frotas' } });
  bootAdmin(c);
  ok('sem ?page=: usa sessionStorage.lastPage', c.paginas.join() === 'frotas-veiculos', c.paginas);
  ok('sem ?page=: URL passa a ter a tela', qs(c).get('page') === 'pg-frotas-veiculos');
}
{
  const c = sandbox({ sessao: { lastPage: 'pg-frotas-veiculos', lastMain: 'frotas' }, url: 'https://erp.test/?page=pg-nao-existe' });
  bootAdmin(c);
  ok('?page= inexistente: cai na última tela da aba', c.paginas.join() === 'frotas-veiculos', c.paginas);
  ok('?page= inexistente: aviso de acesso negado', c.toasts.length === 1 && /Acesso negado/.test(c.toasts[0].msg) && c.toasts[0].tipo === 'erro', c.toasts);
}
{
  const c = sandbox({ sessao: {}, url: 'https://erp.test/?page=pg-%3Cscript%3E' });
  bootAdmin(c);
  ok('chave maliciosa rejeitada → tela inicial', c.paginas.join() === 'dashboard' && qs(c).get('page') === 'pg-dashboard', c.paginas);
  ok('cenaNavLerChave valida formato', c.cenaNavLerChave('pg-frotas-veiculos') === 'frotas-veiculos' && c.cenaNavLerChave('obras-movSAP') === 'obras-movSAP'
    && c.cenaNavLerChave('pg-<x>') === null && c.cenaNavLerChave('') === null && c.cenaNavLerChave(null) === null && c.cenaNavLerChave('pg-a/b') === null);
}

// ── Permissões (fail-closed) ──────────────────────────────────────
{
  const c = sandbox({ perfil: 'almoxarife', sessao: {}, url: 'https://erp.test/?page=pg-rh-vagas' });
  ok('almoxarife: RH pelo link negado', c.cenaNavRestaurarInicial() === false, c.paginas);
  ok('almoxarife: nenhuma tela aberta pelo link', c.paginas.length === 0);
  ok('almoxarife: aviso de acesso negado', c.toasts.length === 1 && /Acesso negado/.test(c.toasts[0].msg));
}
{
  const c = sandbox({ perfil: 'almoxarife', sessao: { lastPage: 'pg-sesmt-estoque', lastMain: 'almoxarifado' }, url: 'https://erp.test/?page=pg-rh-vagas' });
  ok('almoxarife: link negado cai na última tela permitida', c.cenaNavRestaurarInicial() === true && c.paginas.join() === 'sesmt-estoque' && c._mainAtual === 'almoxarifado', c.paginas);
}
{
  const c = sandbox({ perfil: 'almoxarife', sessao: {}, url: 'https://erp.test/?page=pg-alm-requisicao' });
  ok('almoxarife: Requisição CENA permitida (menu filtrado de Operacional/Almox)', c.cenaNavRestaurarInicial() === true && c.paginas[c.paginas.length - 1] === 'alm-requisicao', c.paginas);
}
{
  const c = sandbox({ perfil: 'almoxarife', sessao: {}, url: 'https://erp.test/?page=pg-obras-projetos' });
  ok('almoxarife: Projetos de Obras fora do menu → negado', c.cenaNavRestaurarInicial() === false && c.paginas.length === 0, c.paginas);
}
{
  const c = sandbox({ perfil: 'supervisor', sessao: {}, url: 'https://erp.test/?page=pg-verbas', ocultos: ['mn-movimentacao'] });
  ok('módulo escondido por CSS do perfil → negado', c.cenaNavRestaurarInicial() === false && c.paginas.length === 0);
}
{
  const c = sandbox({ perfil: 'dp', sessao: {}, url: 'https://erp.test/?page=pg-obras-projetos' });
  ok('DP: Projetos de Obras negado', c.cenaNavRestaurarInicial() === false && c.paginas.length === 0);
  const d = sandbox({ perfil: 'dp', sessao: {}, url: 'https://erp.test/?page=pg-gestao-ponto' });
  ok('DP: Gestão de Ponto permitida', d.cenaNavRestaurarInicial() === true && d.paginas[d.paginas.length - 1] === 'gestao-ponto' && d._mainAtual === 'operacional', d.paginas);
  const e = sandbox({ perfil: 'dp', sessao: {}, url: 'https://erp.test/?page=pg-operacional-prod' });
  ok('DP: Produção (Operacional fora do filtro) negada', e.cenaNavRestaurarInicial() === false && e.paginas.length === 0);
}
{
  const c = sandbox({ perfil: 'portaria', sessao: { lastPage: 'pg-frotas-dashboard', lastMain: 'frotas' }, url: 'https://erp.test/?page=pg-frotas-dashboard' });
  ok('portaria: não restaura (tela fixa do perfil)', c.cenaNavRestaurarInicial() === false && c.paginas.length === 0);
  ok('portaria: resolve só frotas-portaria', c.cenaNavResolverMain('frotas-portaria') === 'frotas' && c.cenaNavResolverMain('frotas-dashboard') === null);
}
{
  const c = sandbox({ perfil: 'equipe', sessao: {}, url: 'https://erp.test/?page=pg-dashboard' });
  ok('equipe: navegação persistente desligada', c.cenaNavAtiva() === false && c.cenaNavRestaurarInicial() === false);
  c.showPage('dashboard');
  ok('equipe: showPage não mexe no histórico', c.ops.length === 0);
}
{
  const c = sandbox({ perfil: null, sessao: {} });
  c.showPage('dashboard');
  ok('sem login: nada no histórico', c.ops.length === 0);
}

// ── Popstate para tela que não é mais permitida ───────────────────
{
  const c = sandbox({ perfil: 'supervisor', sessao: {} });
  bootAdmin(c);
  c.hist.entradas.unshift({ state: { cenaNav: 1, page: 'pg-verbas', main: 'movimentacao' }, url: '/?page=pg-verbas' });
  c.hist.idx = 1;
  c.document.getElementById = id => (/^mn-[a-z-]+$/.test(id) ? botao(id, id === 'mn-movimentacao') : null);
  const n = c.paginas.length;
  c.voltar(-1);
  ok('popstate sem permissão: não abre a tela', c.paginas.length === n && c._mainAtual === 'dashboard', c.paginas);
  ok('popstate sem permissão: aviso', c.toasts.some(t => /Acesso negado/.test(t.msg)));
  ok('popstate sem permissão: URL volta para a tela atual', qs(c).get('page') === 'pg-dashboard');
}

// ── Anti-laço e redirecionamentos ─────────────────────────────────
{
  const c = sandbox({ sessao: {} });
  bootAdmin(c);
  avancar(c); c.showPage('frotas-veiculos');
  c.relogio.t += 120; c.showPage('frotas-documentos');
  ok('redirecionamento encadeado (<400ms) vira 1 entrada', c.hist.entradas.length === 2 && qs(c).get('page') === 'pg-frotas-documentos', c.ops);
  avancar(c); c.showPage('frotas-documentos');
  ok('re-render da mesma tela não cria entrada', c.hist.entradas.length === 2, c.ops);
  avancar(c); c.showSub('frotas-multas');
  ok('Multas → Documentos (mesma tela) não cria entrada', c.hist.entradas.length === 2);
}
{
  const c = sandbox({ sessao: {}, url: 'https://erp.test/?page=pg-dashboard' });
  bootAdmin(c);
  c.relogio.t += 300; c.showPage('frotas-portaria');
  ok('troca dentro da janela do boot não cria entrada', c.hist.entradas.length === 1 && qs(c).get('page') === 'pg-frotas-portaria');
}
{
  const c = sandbox({ sessao: {} });
  bootAdmin(c);
  avancar(c); c.showMain('frotas');
  const n = c.paginas.length;
  c.mudarHash('#ativo=abc');
  ok('popstate só de hash (#ativo=) na mesma tela: ignorado', c.paginas.length === n && c.location.hash === '#ativo=abc');
}

// ── Outros parâmetros da URL preservados ──────────────────────────
{
  const c = sandbox({ sessao: {}, url: 'https://erp.test/?u=123#ativo=xyz' });
  bootAdmin(c);
  ok('boot mantém ?u= e o hash (#ativo=)', qs(c).get('u') === '123' && qs(c).get('page') === 'pg-dashboard' && c.location.hash === '#ativo=xyz', c.location.href);
  avancar(c); c.showMain('frotas');
  ok('navegação mantém ?u= e não carrega o hash antigo', qs(c).get('u') === '123' && c.location.hash === '' && qs(c).get('page') === 'pg-frotas-dashboard', c.location.href);
}

// ── Portal do candidato: não mexe na URL ──────────────────────────
{
  const c = sandbox({ sessao: {}, url: 'https://erp.test/?candidato=abc.def' });
  c.rhPortalParseToken = function () { return new URLSearchParams(c.location.search).get('candidato') ? { public_id: 'abc' } : null; };
  ok('portal do candidato: navegação desligada', c.cenaNavAtiva() === false);
  c.showPage('dashboard');
  ok('portal do candidato: URL intacta', c.ops.length === 0 && c.location.search === '?candidato=abc.def');
}

console.log((falhas ? '✗ ' : '✓ ') + 'navegacao-persistente: ' + (total - falhas) + '/' + total + ' OK');
if (falhas) process.exit(1);
