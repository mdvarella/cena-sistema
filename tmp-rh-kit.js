'use strict';
const fs = require('fs');
const s = fs.readFileSync('index.html', 'utf8');
function sliceFn(name, next) {
  const a = s.indexOf('function ' + name + '(');
  if (a < 0) return 'MISSING ' + name;
  let b = next ? s.indexOf('function ' + next + '(', a + 1) : a + 8000;
  if (b < 0) b = a + 8000;
  return s.slice(a, Math.min(b, a + 9000));
}
const out = [
  sliceFn('rhCtAbrirCameraKit', 'rhCtAnexarKitArquivo'),
  sliceFn('rhCtAnexarKitArquivo', 'rhCtIaKitItemPorTipo'),
  sliceFn('rhCtDocsEtapaHtml', 'rhCtPreviewDadosDocumento'),
  sliceFn('rhCtFindItem', 'rhCtKitAplicarArquivoNoTipo'),
  sliceFn('rhCtKitAplicarArquivoNoTipo', 'rhCtKitRepararArquivosPorIa')
].join('\n\n=====\n\n');
fs.writeFileSync('tmp-rh-kit.txt', out);
console.log('wrote', out.length);
const i = s.indexOf('function rhCtDocsEtapaHtml');
console.log('docs html has camera', /Camera|camera|Foto/.test(s.slice(i, i+12000)));
