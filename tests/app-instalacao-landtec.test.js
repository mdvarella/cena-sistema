'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const a = html.indexOf("var CENA_APP_LS = 'cena_app_instalacao'");
const b = html.indexOf('function pwaMostrarSeDisponivel(){ cenaAppSugerirInstalacao(); }');
if (a < 0 || b < 0) { console.error('bloco de instalação não encontrado'); process.exit(1); }
const bloco = html.slice(a, html.indexOf('\n', b));

const failed = [];
function ok(name, cond, detail) { if (!cond) failed.push(name + (detail ? ' — ' + detail : '')); }

function montar(opts) {
  opts = opts || {};
  const store = Object.assign({}, opts.store || {});
  const listeners = {};
  const timers = [];
  const body = { children: [], appendChild: function (el) { this.children.push(el); el.parentNode = this; }, removeChild: function (el) { this.children = this.children.filter(function (x) { return x !== el; }); } };
  const els = {};
  const doc = {
    body: body,
    createElement: function () { return { style: {}, setAttribute: function () {}, set id(v) { this._id = v; els[v] = this; }, get id() { return this._id; } }; },
    getElementById: function (id) { const el = els[id]; return el && body.children.indexOf(el) >= 0 ? el : (id !== 'cena-app-install' && els[id]) || null; }
  };
  const win = {
    _CENA_FILE_MODE: !!opts.fileMode,
    matchMedia: function () { return { matches: !!opts.standalone }; },
    addEventListener: function (ev, fn) { listeners[ev] = fn; }
  };
  const sb = {
    window: win,
    document: doc,
    navigator: { userAgent: opts.ua || 'Mozilla/5.0 (Linux; Android 14; SM-X200) Chrome/128 Mobile', maxTouchPoints: opts.touch || 5, standalone: false },
    localStorage: { getItem: function (k) { return store[k] || null; }, setItem: function (k, v) { store[k] = String(v); } },
    setTimeout: function (fn) { timers.push(fn); },
    progShowToast: function () {}
  };
  vm.createContext(sb);
  vm.runInContext(bloco, sb);
  return { sb: sb, store: store, listeners: listeners, timers: timers, body: body, rodar: function () { while (timers.length) timers.shift()(); } };
}

// Android sem instalar: mostra banner
(function () {
  const t = montar();
  t.sb.pwaMostrarSeDisponivel();
  t.rodar();
  ok('android: banner aparece', t.body.children.length === 1 && t.body.children[0].id === 'cena-app-install');
  ok('android: texto Landtec', /aplicativo da Landtec/.test(t.body.children[0].innerHTML));
  t.sb.cenaAppDispensar();
  ok('agora não: fecha', t.body.children.length === 0);
  ok('agora não: grava', t.store.cena_app_instalacao === 'dispensado');
  t.sb.pwaMostrarSeDisponivel(); t.rodar();
  ok('agora não: não pergunta de novo', t.body.children.length === 0);
})();

// Prompt nativo aceito
(async function () {
  const t = montar();
  let prevenido = false, promptou = false;
  t.listeners.beforeinstallprompt({ preventDefault: function () { prevenido = true; }, prompt: function () { promptou = true; }, userChoice: Promise.resolve({ outcome: 'accepted' }) });
  ok('beforeinstallprompt segurado', prevenido);
  t.sb.cenaAppSugerirInstalacao(); t.rodar();
  t.sb.cenaAppInstalar();
  await new Promise(function (r) { setImmediate(r); });
  ok('instalar chama prompt nativo', promptou);
  ok('aceito grava instalado', t.store.cena_app_instalacao === 'instalado');
  ok('aceito fecha banner', t.body.children.length === 0);
})().then(function () {
  // Sem prompt nativo (iOS): mostra instrução
  const ios = montar({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1' });
  ios.sb.cenaAppSugerirInstalacao(); ios.rodar();
  const txtEl = { innerHTML: '' }, acoesEl = { innerHTML: '' };
  const getOrig = ios.sb.document.getElementById;
  ios.sb.document.getElementById = function (id) { return id === 'cena-app-install-txt' ? txtEl : id === 'cena-app-install-acoes' ? acoesEl : getOrig(id); };
  ios.sb.cenaAppInstalar();
  ok('iOS: instrução Compartilhar', /Compartilhar/.test(txtEl.innerHTML) && /Tela de Início/.test(txtEl.innerHTML));
  ok('iOS: botão Entendi', /Entendi/.test(acoesEl.innerHTML));

  // Não sugere: desktop, já instalado, file://, já respondido
  const casos = [
    ['desktop', { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128', touch: 0 }],
    ['standalone', { standalone: true }],
    ['file', { fileMode: true }],
    ['já instalado', { store: { cena_app_instalacao: 'instalado' } }]
  ];
  casos.forEach(function (c) {
    const t = montar(c[1]);
    let prevenido = false;
    t.listeners.beforeinstallprompt({ preventDefault: function () { prevenido = true; } });
    t.sb.pwaMostrarSeDisponivel(); t.rodar();
    ok(c[0] + ': sem banner', t.body.children.length === 0);
    ok(c[0] + ': não bloqueia prompt do navegador', !prevenido);
  });

  ok('gancho pós-login existente', /if\(typeof pwaMostrarSeDisponivel === 'function'\) pwaMostrarSeDisponivel\(\);/.test(html));
  ok('sem registro de service worker', !/serviceWorker\.register\(/.test(html));
  ok('bloco no <head>', a < html.indexOf('</head>'));
  ok('versão 8.1.163 no changelog', /\{v:'8\.1\.163'/.test(html));

  if (failed.length) { console.error('FALHOU:\n- ' + failed.join('\n- ')); process.exit(1); }
  console.log('app-instalacao-landtec: OK');
}).catch(function (e) { console.error(e); process.exit(1); });
