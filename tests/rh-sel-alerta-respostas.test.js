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

function alerta(c, cid) {
  return sandbox.rhSelCandAlertaRespostasHtml(c, cid || '1');
}

ok('Mauricio: ID + testes em andamento', !!alerta({
  status: 'TESTES_EM_ANDAMENTO',
  identificacao_concluida_em: '2026-09-28',
  testes_iniciados_em: '2026-09-28'
}));

ok('alerta com testes concluídos sem entrevista', !!alerta({
  status: 'TESTES_CONCLUIDOS',
  identificacao_concluida_em: '2026-09-28',
  testes_concluidos_em: '2026-09-28'
}));

ok('sem alerta só convite sem ID/testes', !alerta({
  status: 'CONVITE_EMITIDO'
}));

ok('sem alerta só identificação', !alerta({
  status: 'IDENTIFICACAO_CONCLUIDA',
  identificacao_concluida_em: '2026-09-28'
}));

ok('some alerta após encaminhar', !alerta({
  status: 'ENCAMINHADO_ADMISSAO',
  identificacao_concluida_em: '2026-09-28',
  testes_concluidos_em: '2026-09-28'
}));

ok('some alerta após integridade', !alerta({
  status: 'INTEGRIDADE_EM_ANALISE',
  identificacao_concluida_em: '2026-09-28',
  testes_concluidos_em: '2026-09-28',
  integridade_iniciada_em: '2026-09-28'
}));

const htmlAlerta = alerta({
  status: 'TESTES_EM_ANDAMENTO',
  identificacao_concluida_em: '2026-09-28',
  testes_iniciados_em: '2026-09-28'
});
ok('texto Respostas enviadas', /Respostas enviadas/.test(htmlAlerta));
ok('amarelo', /#FDE68A/.test(htmlAlerta));
ok('lista usa col11', html.includes("'<td style=\"font-size:11px\">'+col11+'</td>'"));
ok('versao 8.1.157', /numero: '8.1.157'/.test(html));

if (failed.length) {
  console.error('FAIL\n' + failed.join('\n'));
  process.exit(1);
}
console.log('ok rh-sel-alerta-respostas');
assert.ok(true);
