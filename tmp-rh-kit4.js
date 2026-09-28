'use strict';
const fs = require('fs');
const s = fs.readFileSync('index.html', 'utf8');
function sliceFn(name, next, max) {
  const a = s.indexOf('function ' + name + '(');
  if (a < 0) return 'MISSING ' + name;
  let b = next ? s.indexOf('function ' + next + '(', a + 1) : a + (max || 4000);
  if (b < 0) b = a + (max || 4000);
  return s.slice(a, Math.min(b, a + (max || 5000)));
}
console.log(sliceFn('rhIaFinalizarGrupoCamera', 'rhIaReceberCapturaArquivo', 4000));
console.log('\n==== ADICIONAR ====\n');
console.log(sliceFn('rhIaAdicionarArquivos', 'rhIaValidarArquivo', 2500));
console.log('\n==== SELECAO ====\n');
const i = s.indexOf('function rhCtIaSelecaoHtml');
console.log(i < 0 ? 'no selecao' : s.slice(i, i+1800));
