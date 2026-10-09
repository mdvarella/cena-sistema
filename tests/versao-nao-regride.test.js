'use strict';
// Versão nunca regride: a pasta/branch de trabalho não pode estar abaixo da origin/main nem de uma origin/release-*.
// Pega o caso "publicou/abriu a 8.1.210 depois de já existir a 8.1.213 em outra branch".
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const raiz = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(raiz, 'sw.js'), 'utf8');
const failed = [];
let total = 0;
function ok(name, cond, detail) { total++; if (!cond) failed.push(name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }

const versaoApp = s => (s.match(/var APP_VERSAO = \{\s*numero:\s*'(\d+\.\d+\.\d+)'/) || [])[1] || null;
const versaoSw = s => (s.match(/const SW_VERSION\s*=\s*'cena-(\d+\.\d+\.\d+)'/) || [])[1] || null;
const comparar = (a, b) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

const app = versaoApp(html);
const swv = versaoSw(sw);
ok('APP_VERSAO.numero encontrado', !!app);
ok('SW_VERSION encontrado', !!swv);
ok('APP_VERSAO.numero = SW_VERSION', app === swv, { app, sw: swv });

function git(args) {
  try { return execFileSync('git', args, { cwd: raiz, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }); }
  catch (_) { return null; }
}

const refs = (git(['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin/main', 'refs/remotes/origin/release-*']) || '')
  .split(/\r?\n/).map(s => s.trim()).filter(Boolean);
let comparadas = 0;
if (app) {
  for (const ref of refs) {
    const swRef = git(['show', ref + ':sw.js']);
    const v = swRef && versaoSw(swRef);
    if (!v) continue;
    comparadas++;
    ok(`versão local ${app} >= ${ref} (${v})`, comparar(app, v) >= 0,
      `esta pasta está ABAIXO de ${ref}: traga ${ref} para cá (merge) antes de commitar ou publicar`);
  }
}

if (failed.length) {
  console.log(`versao-nao-regride: FALHOU ${failed.length}/${total}`);
  for (const f of failed) console.log('  - ' + f);
  process.exit(1);
}
console.log(refs.length && comparadas
  ? `versao-nao-regride: OK (${total} verificações; ${app} comparada com ${comparadas} ref(s) do origin)`
  : `versao-nao-regride: OK (${total} verificações; SKIP comparação com origin — sem git ou sem origin/main local)`);
