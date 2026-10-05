'use strict';
// 8.1.206 — "Sair" zera o sistema: #pg-app escondido de fato, sessão Supabase encerrada (apagada do storage
// mesmo sem rede) e recarga sem ?page=. Executa fazerLogout/cenaAuthEncerrarSessaoSupabase reais.
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

// ── CSS ───────────────────────────────────────────────────────────
ok('#pg-app.hidden esconde com !important', html.includes('#pg-app.hidden{display:none!important;}'));
ok('#pg-app.hidden vem depois de #pg-app{display:flex}',
  html.indexOf('#pg-app.hidden{display:none!important;}') > html.indexOf('#pg-app{display:flex;'));
ok('body.cena-saindo bloqueia cliques', html.includes('body.cena-saindo{pointer-events:none;'));

// ── chamadas ──────────────────────────────────────────────────────
ok('sessão expirada repassa o aviso ao logout', fn('cenaAuthHandleUnauthorized').includes('fazerLogout({msg:msg});'));
ok('boot mostra o aviso de saída no login',
  /sessionStorage\.getItem\(CENA_LOGOUT_MSG_KEY\)[\s\S]{0,260}login-err[\s\S]{0,120}classList\.remove\('hidden'\)/.test(html));
ok('fazerLogout não chama signOut solto', !fn('fazerLogout').includes('auth.signOut()'));

// ── execução real ─────────────────────────────────────────────────
function el(id) {
  return { id, style: { display: '', cssText: '' }, innerHTML: '', textContent: '',
    _cls: new Set(), classList: null };
}
function montar({ signOut }) {
  const els = {};
  ['pg-app', 'pg-login', 'modal-area', 'bloco-metricas', 'nav-main', 'gestor-bar', 'btn-voltar-painel'].forEach(id => {
    const e = el(id);
    e.classList = { add: c => e._cls.add(c), remove: c => e._cls.delete(c), contains: c => e._cls.has(c) };
    els[id] = e;
  });
  els['pg-app'].style.cssText = 'padding:0!important;margin:0!important;display:block!important';
  els['pg-login']._cls.add('hidden');
  els['modal-area'].innerHTML = '<div>modal aberto</div>';
  const bodyCls = new Set(['perfil-equipe']);
  const ls = new Map([['sb-qxexyghcennllrmjqafg-auth-token', '{}'], ['sb-qxexyghcennllrmjqafg-auth-token-code-verifier', 'v'], ['cena_user', '{}'], ['cena_cache_veiculos', 'x']]);
  const ss = new Map([['lastPage', 'pg-cadastros'], ['lastMain', 'cadastros'], ['_cena_sessao', 'sess_1']]);
  const timeouts = [];
  const log = [];
  const ctx = {
    console, Promise, String,
    DEMO: false,
    usuarioLogado: { id: 'u1', perfil: 'equipe' },
    _cenaAuthInvalid: false, _sbAuthToken: 'tok', _cenaAuthHadSession: true,
    _dbEquipe: {}, _dbSessao: {}, _dbOrdemAtual: {}, _dbPlaca: 'X', _gestorContAtivo: 'c', _gestorContratos: ['c'],
    window: { _dbTimerInterval: null, _filtroContrato: 'c' },
    auditLog(acao) { log.push('audit:' + acao); },
    cenaAuthStopAuthenticatedLoops() { log.push('loops'); },
    onlineOffline() { log.push('offline'); },
    limparClassesPerfilBody() {},
    clearInterval() {},
    setTimeout(f, ms) { timeouts.push({ f, ms }); return timeouts.length; },
    document: {
      getElementById: id => els[id] || null,
      body: { classList: { add: c => bodyCls.add(c), remove: c => bodyCls.delete(c) } },
    },
    localStorage: {
      get length() { return ls.size; },
      key: i => [...ls.keys()][i] ?? null,
      getItem: k => (ls.has(k) ? ls.get(k) : null),
      removeItem: k => { log.push('ls-remove:' + k); ls.delete(k); },
      setItem: (k, v) => ls.set(k, String(v)),
    },
    sessionStorage: {
      getItem: k => (ss.has(k) ? ss.get(k) : null),
      removeItem: k => ss.delete(k),
      setItem: (k, v) => ss.set(k, String(v)),
    },
    location: { pathname: '/index.html', replace(u) { log.push('replace:' + u); } },
    supabaseClient: {
      auth: {
        stopAutoRefresh() { log.push('stopAutoRefresh'); },
        signOut() { log.push('signOut'); return signOut(ls); },
      },
    },
  };
  ctx.window.window = ctx.window;
  vm.createContext(ctx);
  vm.runInContext([
    'var _cenaSaindo = false;',
    "var CENA_LOGOUT_MSG_KEY = 'cena_logout_msg';",
    fn('cenaAuthRemoverSessaoLocal'),
    fn('cenaAuthEncerrarSessaoSupabase'),
    fn('fazerLogout'),
  ].join('\n'), ctx);
  return { ctx, els, bodyCls, ls, ss, timeouts, log };
}
const tick = () => new Promise(r => setImmediate(r));
async function drenar() { for (let i = 0; i < 10; i++) await tick(); }

(async () => {
  // signOut normal: apaga o storage como o supabase-js faz
  {
    const t = montar({ signOut: async ls => { ls.delete('sb-qxexyghcennllrmjqafg-auth-token'); return { error: null }; } });
    vm.runInContext('fazerLogout();', t.ctx);
    ok('esconde #pg-app na hora', t.els['pg-app']._cls.has('hidden'));
    ok('limpa display:block!important inline do perfil equipe', t.els['pg-app'].style.cssText === '');
    ok('fecha modais', t.els['modal-area'].innerHTML === '');
    ok('mostra login', !t.els['pg-login']._cls.has('hidden'));
    ok('body sem-login e cena-saindo', t.bodyCls.has('sem-login') && t.bodyCls.has('cena-saindo') && !t.bodyCls.has('perfil-equipe'));
    ok('apaga a última tela da aba', !t.ss.has('lastPage') && !t.ss.has('lastMain'));
    ok('nova sessão de auditoria após sair', !t.ss.has('_cena_sessao'));
    ok('sem aviso quando é o botão Sair', !t.ss.has('cena_logout_msg'));
    ok('usuarioLogado null', t.ctx.usuarioLogado === null);
    ok('cena_user removido', !t.ls.has('cena_user'));
    ok('não recarrega antes do signOut terminar', !t.log.some(x => x.startsWith('replace:')));
    vm.runInContext('fazerLogout();', t.ctx);
    ok('segundo clique não repete o logout', t.log.filter(x => x === 'audit:logout').length === 1);
    await drenar();
    ok('signOut chamado uma vez', t.log.filter(x => x === 'signOut').length === 1);
    ok('autoRefresh parado antes do signOut', t.log.indexOf('stopAutoRefresh') >= 0 && t.log.indexOf('stopAutoRefresh') < t.log.indexOf('signOut'));
    ok('code-verifier também apagado', !t.ls.has('sb-qxexyghcennllrmjqafg-auth-token-code-verifier'));
    ok('outros caches preservados', t.ls.get('cena_cache_veiculos') === 'x');
    ok('recarrega sem ?page=', t.log.includes('replace:/index.html'), t.log);
    ok('recarga só depois de apagar a sessão',
      t.log.indexOf('replace:/index.html') > t.log.indexOf('signOut'));
  }

  // sem rede: signOut devolve erro e NÃO apaga a sessão (comportamento do supabase-js v2)
  {
    const t = montar({ signOut: async () => ({ error: { message: 'Failed to fetch' } }) });
    vm.runInContext("fazerLogout({msg:'Sessão expirada'});", t.ctx);
    ok('aviso guardado para a tela de login', t.ss.get('cena_logout_msg') === 'Sessão expirada');
    await drenar();
    ok('offline: sessão Supabase apagada do storage', !t.ls.has('sb-qxexyghcennllrmjqafg-auth-token'), [...t.ls.keys()]);
    ok('offline: recarrega', t.log.includes('replace:/index.html'));
  }

  // signOut travado: o timeout de 4 s libera a saída
  {
    const t = montar({ signOut: () => new Promise(() => {}) });
    vm.runInContext('fazerLogout();', t.ctx);
    await drenar();
    ok('travado: ainda não recarregou', !t.log.some(x => x.startsWith('replace:')));
    const to = t.timeouts.find(x => x.ms === 4000);
    ok('timeout de 4 s agendado', !!to);
    if (to) to.f();
    await drenar();
    ok('travado: sessão apagada após o timeout', !t.ls.has('sb-qxexyghcennllrmjqafg-auth-token'));
    ok('travado: recarrega após o timeout', t.log.includes('replace:/index.html'));
  }

  // signOut lança exceção
  {
    const t = montar({ signOut: () => { throw new Error('boom'); } });
    vm.runInContext('fazerLogout();', t.ctx);
    await drenar();
    ok('exceção: sessão apagada e recarga', !t.ls.has('sb-qxexyghcennllrmjqafg-auth-token') && t.log.includes('replace:/index.html'));
  }

  // ── versão ──────────────────────────────────────────────────────
  const num = (html.match(/numero: '([\d.]+)'/) || [])[1];
  ok('versão >= 8.1.206', Number(String(num).split('.')[2]) >= 206, num);
  ok('changelog 8.1.206', html.includes("{v:'8.1.206'"));
  ok('sw.js acompanha a versão', sw.includes("const SW_VERSION   = 'cena-" + num + "';"));
  ok('scripts ?v= acompanham a versão', !html.includes('?v=8.1.205"') && html.split('?v=' + num + '"').length - 1 === 7);

  console.log('logout-zera-sistema: ' + (total - falhas) + '/' + total);
  process.exit(falhas ? 1 : 0);
})();
