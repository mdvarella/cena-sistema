'use strict';
const fs = require('fs');
const s = fs.readFileSync('index.html', 'utf8');
function sliceFn(name, next, max) {
  const a = s.indexOf('function ' + name + '(');
  if (a < 0) return 'MISSING ' + name;
  let b = next ? s.indexOf('function ' + next + '(', a + 1) : a + (max || 6000);
  if (b < 0) b = a + (max || 6000);
  return s.slice(a, Math.min(b, a + (max || 7000)));
}
const out = [
  sliceFn('rhCtKitAcoesHtml', 'rhCtDocsEtapaHtml', 4000),
  sliceFn('rhIaAbrirCapturaCamera', 'rhIaRenderModalCamera', 5000),
  sliceFn('rhIaRenderModalCamera', 'rhIaCapLoad', 5000),
  sliceFn('rhCtItemFromRegra', 'rhCtAbrirCameraKit', 2500)
].join('\n\n=====\n\n');
fs.writeFileSync('tmp-rh-kit2.txt', out);
console.log(out.length);
['arquivos','arquivo_url','mode:\'unico\'','mode:\'multipagina\'','rhCtIaOnFiles'].forEach(k => {
  const i = s.indexOf(k);
  console.log(k, i);
});
