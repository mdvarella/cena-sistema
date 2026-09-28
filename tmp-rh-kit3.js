'use strict';
const fs = require('fs');
const s = fs.readFileSync('index.html', 'utf8');
function sliceFn(name, next, max) {
  const a = s.indexOf('function ' + name + '(');
  if (a < 0) return 'MISSING ' + name;
  let b = next ? s.indexOf('function ' + next + '(', a + 1) : a + (max || 5000);
  if (b < 0) b = a + (max || 5000);
  return s.slice(a, Math.min(b, a + (max || 6000)));
}
fs.writeFileSync('tmp-rh-kit3.txt', [
  sliceFn('rhCtAnexarKit', 'rhCtAbrirCameraKit', 2500),
  sliceFn('rhCtIaOnFiles', 'rhCtIaEnviarStaging', 2500),
  sliceFn('rhIaUsarFoto', 'rhIaFinalizarGrupoCamera', 2500),
  sliceFn('rhIaFinalizarGrupoCamera', 'rhIaReceberCapturaArquivo', 3500),
  sliceFn('rhIaReceberCapturaArquivo', 'rhIaListarCameras', 2500)
].join('\n\n=====\n\n'));
console.log('ok');
