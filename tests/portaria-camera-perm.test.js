'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'portaria-camera.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const store = {};
const sandbox = {
  window: {},
  addEventListener: function () {},
  document: {
    readyState: 'complete',
    addEventListener: function () {},
    getElementById: function () { return null; },
    querySelectorAll: function () { return []; }
  },
  navigator: { userAgent: 'Android', maxTouchPoints: 1, mediaDevices: {} },
  localStorage: {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; }
  },
  sessionStorage: { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} },
  setTimeout: function (fn) { return 0; },
  MutationObserver: function () { this.observe = function () {}; }
};
sandbox.window = sandbox;
sandbox.global = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

const failed = [];
function ok(name, cond) {
  if (!cond) failed.push(name);
}

ok('export ler', typeof sandbox.portCamPermLer === 'function');
ok('export bloqueio', typeof sandbox.portCamPermEhBloqueio === 'function');
ok('NotAllowedError', sandbox.portCamPermEhBloqueio({ name: 'NotAllowedError' }));
ok('PermissionDeniedError', sandbox.portCamPermEhBloqueio({ name: 'PermissionDeniedError' }));
ok('constraint nao e bloqueio', !sandbox.portCamPermEhBloqueio({ name: 'OverconstrainedError' }));

sandbox.portCamPermSalvar('denied');
ok('recusou pergunta de novo', sandbox.portCamPermDevePedirFolha() === true);
ok('gravou denied', sandbox.portCamPermLer() === 'denied');

sandbox.portCamPermSalvar('granted');
ok('autorizou nao pergunta de novo', sandbox.portCamPermDevePedirFolha() === false);
ok('gravou granted', sandbox.portCamPermLer() === 'granted');

ok('folha no overlay', src.indexOf('Permitir câmera da Portaria') >= 0 || src.indexOf('Permitir c\u00e2mera da Portaria') >= 0 || src.indexOf('id="port-cam-perm"') >= 0);
ok('pedir de novo', src.indexOf('Pedir permissão de novo') >= 0 || src.indexOf('Pedir permiss') >= 0);
ok('versao 8.1.160', /numero: '8.1.160'/.test(html));
ok('cache camera', html.indexOf('portaria-camera.js?v=8.1.159') >= 0);

if (failed.length) {
  console.error('FAIL\n' + failed.join('\n'));
  process.exit(1);
}
console.log('ok portaria-camera-perm');
assert.ok(true);
