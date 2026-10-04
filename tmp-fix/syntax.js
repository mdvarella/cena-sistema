const fs = require('fs');
const vm = require('vm');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
let m, n = 0, bad = 0;
while ((m = re.exec(html))) {
  const attrs = m[1] || '';
  if (/\bsrc=/.test(attrs) || /type=["'](?!text\/javascript|module)/.test(attrs)) continue;
  if (/type=["']module/.test(attrs)) continue;
  n++;
  try { new vm.Script(m[2], { filename: 'inline#' + n }); }
  catch (e) { bad++; console.log('ERRO inline#' + n + ':', e.message); }
}
console.log('scripts inline:', n, 'erros:', bad);
process.exit(bad ? 1 : 0);
