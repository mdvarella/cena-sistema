'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function sliceFn(src, name, nextName) {
  const a = src.indexOf('function ' + name + '(');
  if (a < 0) throw new Error('missing ' + name);
  var b = src.indexOf('function ' + nextName + '(', a + 1);
  if (b < 0) throw new Error('missing next ' + nextName);
  return src.slice(a, b);
}

const sandbox = {
  _rhSelCandEntByCand: {}
};
vm.createContext(sandbox);
vm.runInContext(
  sliceFn(html, 'rhSelCandTestesRespondidos', 'rhSelCandidatosRenderLista'),
  sandbox
);

const failed = [];
function ok(name, cond, detail) {
  if (!cond) failed.push(name + (detail ? ' — ' + detail : ''));
}

sandbox._rhSelCandEntByCand['1'] = [{ status: 'CONCLUIDA', parecer: 'ok' }];
ok('alerta quando testes e entrevista', !!sandbox.rhSelCandAlertaRespostasHtml({
  status: 'TESTES_CONCLUIDOS', testes_concluidos_em: '2026-09-28'
}, '1'));

sandbox._rhSelCandEntByCand['2'] = [{ status: 'AGENDADA' }];
ok('sem alerta só testes', !sandbox.rhSelCandAlertaRespostasHtml({
  status: 'TESTES_CONCLUIDOS', testes_concluidos_em: '2026-09-28'
}, '2'));

sandbox._rhSelCandEntByCand['3'] = [{ status: 'CONCLUIDA' }];
ok('sem alerta só entrevista', !sandbox.rhSelCandAlertaRespostasHtml({
  status: 'TESTES_EM_ANDAMENTO'
}, '3'));

sandbox._rhSelCandEntByCand['4'] = [{ status: 'CONCLUIDA', parecer: 'ok' }];
ok('some alerta após integridade', !sandbox.rhSelCandAlertaRespostasHtml({
  status: 'INTEGRIDADE_EM_ANALISE', testes_concluidos_em: '2026-09-28', integridade_iniciada_em: '2026-09-28'
}, '4'));

const htmlAlerta = sandbox.rhSelCandAlertaRespostasHtml({
  status: 'ENTREVISTAS_CONCLUIDAS', testes_concluidos_em: '2026-09-28'
}, '1');
ok('texto Respostas enviadas', /Respostas enviadas/.test(htmlAlerta));
ok('amarelo', /#FDE68A/.test(htmlAlerta));

ok('lista usa col11', html.includes("'<td style=\"font-size:11px\">'+col11+'</td>'"));
ok('linha amarela', html.includes('alertaHtml?\' style="background:#FFF8EB"\':\'\''));
ok('versao 8.1.156', /numero: '8.1.156'/.test(html));

if (failed.length) {
  console.error('FAIL\n' + failed.join('\n'));
  process.exit(1);
}
console.log('ok ' + 8 + ' rh-sel-alerta-respostas');
assert.ok(true);
