'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function sliceFn(src, name, nextName) {
  const a = src.indexOf('function ' + name + '(');
  if (a < 0) throw new Error('missing ' + name);
  var b = nextName ? src.indexOf('function ' + nextName + '(', a + 1) : src.length;
  if (b < 0) throw new Error('missing next ' + nextName);
  return src.slice(a, b);
}

const sandbox = {
  console,
  filiais: [{ id: 'f-embu', nome: 'CENA 07 - EMBU', codigo: '07' }, { id: 'f-lapa', nome: 'CENA 01 - LAPA', codigo: '01' }],
  contratos: [{ id: 'c1', filial_id: 'f-embu' }],
  _portAtiva: { filial_id: 'f-embu', nome: 'Portaria Embu' },
  usuarioLogado: { filial_id: 'f-embu' },
  document: { getElementById: function () { return null; } },
  escHtml: function (s) { return String(s || ''); }
};
vm.createContext(sandbox);
vm.runInContext(
  sliceFn(html, 'eqNomeBase', 'openNovaEquipeDisp') +
  sliceFn(html, 'portEqPassaFiltroPort', 'portSaidaEquipeDia'),
  sandbox
);

const eqLapa = { id: '1', codigo: 'EJN101', nome: 'LAPA', contrato_id: 'c1', filial_id: 'f-lapa', status: 'Ativo' };
const eqEmbu = { id: '2', codigo: 'EON124', nome: 'EMBU', contrato_id: 'c1', filial_id: 'f-embu', status: 'Ativo' };
const eqPrefix = { id: '3', codigo: 'EBN196', nome: '', contrato_id: 'c1', status: 'Ativo' };

assert.strictEqual(sandbox.eqNomeBase(eqLapa), 'LAPA');
assert.strictEqual(sandbox.eqNomeBase(eqEmbu), 'EMBU');
assert.strictEqual(sandbox.eqNomeBase(eqPrefix), 'LAPA');
assert.ok(sandbox.eqBadgeBaseHtml(eqLapa, false).indexOf('Base LAPA') >= 0);
assert.ok(sandbox.eqBadgeBaseHtml(eqEmbu, true).indexOf('Outra base') >= 0);

assert.strictEqual(sandbox.portEqPassaFiltroPort(eqLapa, '', 'f-embu'), true, 'outra filial não pode ser escondida');
assert.strictEqual(sandbox.portEqPassaFiltroPort(eqEmbu, '', 'f-embu'), true);
assert.strictEqual(sandbox.portEqPassaFiltroPort({ status: 'Inativo' }, '', 'f-embu'), false);

assert.strictEqual(sandbox.portBaseDaPortaria('f-embu'), 'EMBU');
assert.strictEqual(sandbox.portEqOutraBase(eqLapa, 'f-embu'), true);
assert.strictEqual(sandbox.portEqOutraBase(eqEmbu, 'f-embu'), false);

const grupos = sandbox.portAgruparItensPorBase(
  [{ eq: eqLapa }, { eq: eqEmbu }],
  'f-embu'
);
assert.strictEqual(grupos[0].base, 'EMBU');
assert.strictEqual(grupos[0].outra, false);
assert.strictEqual(grupos[1].base, 'LAPA');
assert.strictEqual(grupos[1].outra, true);

const htmlChips = sandbox.portHtmlChipsPorBase(
  [{ eq: eqLapa }, { eq: eqEmbu }],
  function (i, cor, icon, outra) {
    return '<chip data-cod="' + i.eq.codigo + '" data-outra="' + outra + '"></chip>';
  },
  '#3B6D11',
  '🟢',
  'f-embu'
);
assert.ok(htmlChips.indexOf('outra base') >= 0);
assert.ok(htmlChips.indexOf('EJN101') >= 0);
assert.ok(htmlChips.indexOf('EON124') >= 0);

assert.ok(html.indexOf('Liberar ✅') >= 0);
assert.ok(html.indexOf('eqBadgeBaseHtml(eq,false)') >= 0);
assert.ok(html.indexOf("id=\"ned-nome\"") >= 0);

console.log('portaria-base-equipe.test.js OK');
