'use strict';
// 8.1.204 — Presença online e sino de aprovações iniciam também no login pelo formulário (fazerLogin),
// não só na recarga com sessão salva. Executa onlineInit/notifIniciar/cenaAuthStopAuthenticatedLoops reais.
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

// ── fazerLogin liga presença e sino ───────────────────────────────
const login = fn('fazerLogin');
const iUser = login.indexOf('usuarioLogado=user;');
const iOnline = login.indexOf('setTimeout(onlineInit, 1500);');
const iEquipe = login.indexOf("if(user.perfil==='equipe'){");
const iNotif = login.indexOf('notifIniciar();');
const iFiltro = login.indexOf('window._filtroContrato=null;\n    }\n');
ok('fazerLogin chama onlineInit', iOnline > 0);
ok('onlineInit depois de usuarioLogado=user', iUser > 0 && iOnline > iUser);
ok('onlineInit antes do desvio do perfil equipe (cobre tablets TMA)', iEquipe > 0 && iOnline < iEquipe);
ok('fazerLogin chama notifIniciar', iNotif > 0);
ok('notifIniciar depois do filtro de contratos', iFiltro > 0 && iNotif > iFiltro);

// ── recarga usa o mesmo notifIniciar, sem setInterval solto ───────
ok('setInterval(notifVerificar) só dentro de notifIniciar',
  html.split('setInterval(notifVerificar').length - 1 === 1 && fn('notifIniciar').includes('setInterval(notifVerificar'));
ok('recarga ainda chama onlineInit', /carregarDados\(\)\.then\(function\(\)\{[\s\S]{0,600}setTimeout\(onlineInit, 1500\);/.test(html));
ok('recarga chama notifIniciar', /setTimeout\(onlineInit, 1500\);\n\s*\/\/ Start notification check for approvers\n\s*notifIniciar\(\);/.test(html));

// ── execução real com timers falsos ───────────────────────────────
let seq = 0;
const ativos = new Map();
const timeouts = [];
const heartbeats = [];
const ctx = {
  console,
  DEMO: false,
  usuarioLogado: null,
  _sbAuthToken: null,
  _cenaAuthHadSession: false,
  _cenaAuthInvalid: false,
  _onlineInterval: null,
  _onlineUnloadBound: true,
  window: { addEventListener() {} },
  setInterval(f, ms) { const id = ++seq; ativos.set(id, { f, ms }); return id; },
  clearInterval(id) { ativos.delete(id); },
  setTimeout(f, ms) { timeouts.push({ f, ms }); return ++seq; },
  onlineHeartbeat() { heartbeats.push(1); },
  notifVerificar() {},
};
vm.createContext(ctx);
vm.runInContext([
  fn('onlineInit'),
  'var _notifInterval = null;',
  fn('notifIniciar'),
  fn('cenaAuthStopAuthenticatedLoops'),
].join('\n'), ctx);
const intervalos = (f) => [...ativos.values()].filter(v => v.f === f);

ctx.usuarioLogado = { id: 'u1', perfil: 'admin' };
vm.runInContext('notifIniciar(); notifIniciar();', ctx);
ok('notifIniciar duas vezes deixa um único intervalo', intervalos(ctx.notifVerificar).length === 1, intervalos(ctx.notifVerificar).length);
ok('intervalo do sino = 10 min', intervalos(ctx.notifVerificar)[0].ms === 600000);
ok('primeira verificação agendada', timeouts.some(t => t.f === ctx.notifVerificar && t.ms === 2000));

ctx.usuarioLogado = { id: 'u2', perfil: 'equipe' };
vm.runInContext('notifIniciar();', ctx);
ok('perfil sem aprovação não liga o sino', intervalos(ctx.notifVerificar).length === 0);

ctx.usuarioLogado = { id: 'u3', perfil: 'gestor' };
ctx._sbAuthToken = 'tok';
vm.runInContext('onlineInit(); onlineInit();', ctx);
ok('onlineInit com sessão envia heartbeat', heartbeats.length === 2);
ok('onlineInit duas vezes deixa um único intervalo', intervalos(ctx.onlineHeartbeat).length === 1, intervalos(ctx.onlineHeartbeat).length);
ok('intervalo da presença = 2 min', intervalos(ctx.onlineHeartbeat)[0].ms === 120000);

vm.runInContext('notifIniciar();', ctx);
vm.runInContext('cenaAuthStopAuthenticatedLoops();', ctx);
ok('logout para presença', intervalos(ctx.onlineHeartbeat).length === 0 && ctx._onlineInterval === null);
ok('logout para o sino', intervalos(ctx.notifVerificar).length === 0 && vm.runInContext('_notifInterval', ctx) === null);

heartbeats.length = 0;
ctx._sbAuthToken = null;
ctx._cenaAuthHadSession = false;
vm.runInContext('onlineInit();', ctx);
ok('sem sessão Auth não inicia presença', heartbeats.length === 0 && intervalos(ctx.onlineHeartbeat).length === 0);

// ── versão ────────────────────────────────────────────────────────
const num = (html.match(/numero: '([\d.]+)'/) || [])[1];
ok('versão 8.1.204', num === '8.1.204', num);
ok('changelog 8.1.204', html.includes("{v:'8.1.204'"));
ok('sw.js acompanha a versão', sw.includes("const SW_VERSION   = 'cena-" + num + "';"));

console.log('presenca-online-login: ' + (total - falhas) + '/' + total);
process.exit(falhas ? 1 : 0);
