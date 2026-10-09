'use strict';
// Frotas 8.1.213 — atalho Entrada Inteligente no menu e no Dashboard de Frotas (mesma lógica do SESMT 8.1.152).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const sw = fs.readFileSync(path.join(raiz, 'sw.js'), 'utf8');
const failed = [];
let total = 0;
function ok(name, cond, detail) { total++; if (!cond) failed.push(name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }

function trecho(inicio, fim) {
  const i = html.indexOf(inicio);
  if (i < 0) throw new Error('não encontrado: ' + inicio);
  const f = html.indexOf(fim, i);
  return html.slice(i, f < 0 ? undefined : f);
}

// ── menu ────────────────────────────────────────────────────────────────
const subsFrotas = trecho("  frotas: {label:'🚗 Frotas', subs:[", '  ]},');
ok('MAIN_CONFIG.frotas tem Entrada Inteligente', /\{id:'rh-entrada-ia',\s+label:'🤖 Entrada Inteligente'\}/.test(subsFrotas));
const gruposFrotas = trecho('    frotas: [\n', '\n  ],');
const gestao = gruposFrotas.slice(0, gruposFrotas.indexOf("{label:'Operação'"));
ok('SIDEBAR_GROUPS.frotas (Gestão) tem Entrada Inteligente', /\{id:'rh-entrada-ia',\s+icon:'🤖', label:'Entrada Inteligente'\}/.test(gestao));
ok('SESMT mantém o atalho no menu', /\{id:'sesmt-dashboard',\s+icon:'📊', label:'Dashboard SESMT'\},\n\s+\{id:'rh-entrada-ia'/.test(html));

// ── botão no Dashboard de Frotas ────────────────────────────────────────
const dash = trecho('<div id="pg-frotas-dashboard"', '<div id="frt-dash-metricas"');
const btns = dash.match(/<button[^>]*frotas-btn-entrada-ia[^>]*>[^<]*<\/button>/g) || [];
ok('Dashboard de Frotas tem um botão Entrada Inteligente', btns.length === 1, btns.length);
ok('botão abre rh-entrada-ia pelos fluxos normais (showSub/showPage)',
  btns[0] && /showSub\('rh-entrada-ia'\)/.test(btns[0]) && /showPage\('rh-entrada-ia'\)/.test(btns[0]) && /🤖 Entrada Inteligente/.test(btns[0]));
ok('CSS dos perfis de Frotas não esconde a tela da Entrada Inteligente',
  !/body\.perfil-(gerente|supervisor)_frotas #pg-rh-entrada-ia/.test(html));

// ── permissão (função real do index.html) ───────────────────────────────
const fnPerm = trecho('function rhPermKeyPagina(pageId){', '\nfunction rhInit') ;
const fnModulo = fnPerm.slice(fnPerm.indexOf('function rhModuloPermitido('));
ok('rhModuloPermitido encontrado', /function rhModuloPermitido\(pageId\)/.test(fnModulo));
const fimModulo = (() => { let d = 0, i = fnModulo.indexOf('{'); for (; i < fnModulo.length; i++) { if (fnModulo[i] === '{') d++; else if (fnModulo[i] === '}' && --d === 0) return i + 1; } return -1; })();
const codigo = fnPerm.slice(0, fnPerm.indexOf('function rhModuloPermitido(')) + fnModulo.slice(0, fimModulo);

function pode(perfil, pageId, bloqueadas) {
  const ctx = {
    usuarioLogado: { perfil },
    perfilAcessoTotal: () => perfil === 'admin' || perfil === 'diretoria',
    permTemAcesso: id => !(bloqueadas || []).includes(id),
  };
  vm.createContext(ctx);
  vm.runInContext(codigo + '\n;this.__r = rhModuloPermitido(' + JSON.stringify(pageId) + ');', ctx);
  return ctx.__r;
}

for (const p of ['gerente_frotas', 'supervisor_frotas', 'sesmt']) {
  ok(`${p} abre a Entrada Inteligente`, pode(p, 'rh-entrada-ia') === true);
  ok(`${p} bloqueado se rh-entrada-ia estiver negada`, pode(p, 'rh-entrada-ia', ['rh-entrada-ia']) === false);
  ok(`${p} continua sem acesso ao Dossiê`, pode(p, 'rh-dossie') === false);
  ok(`${p} continua sem acesso a Documentos do RH`, pode(p, 'rh-documentos') === false);
}
for (const p of ['portaria', 'equipe', 'almoxarife', 'supervisor', 'coordenador', 'gerente_frotas_x', '']) {
  ok(`perfil "${p}" segue sem a Entrada Inteligente`, pode(p, 'rh-entrada-ia') === false);
}
ok('admin segue com acesso', pode('admin', 'rh-entrada-ia') === true);
ok('rh segue com acesso', pode('rh', 'rh-entrada-ia') === true);

// ── versão ──────────────────────────────────────────────────────────────
const numero = (html.match(/numero: '(8\.1\.\d+)'/) || [])[1];
ok('APP_VERSAO >= 8.1.213 com o log da 8.1.213', +(numero || '0.0.0').split('.')[2] >= 213 && /\{v:'8\.1\.213'/.test(html), numero);
ok('sw acompanha a versão do app', sw.includes("SW_VERSION   = 'cena-" + numero + "'"), numero);

if (failed.length) {
  console.error('frotas-entrada-ia-atalho: FALHOU ' + failed.length + '/' + total);
  failed.forEach(f => console.error('  - ' + f));
  process.exit(1);
}
console.log('frotas-entrada-ia-atalho: OK (' + total + ' verificações)');
