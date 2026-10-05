const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const dir = path.join(__dirname, '..', 'tests');
const env = Object.assign({}, process.env, { PGLITE_PATH: 'C:\\Users\\Marcos\\AppData\\Local\\Temp\\alm-hist\\pg' });
const files = fs.readdirSync(dir).filter(f => /\.test\.(js|mjs)$/.test(f)).sort();
const falhas = [];
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(dir, f)], { env, encoding: 'utf8', timeout: 300000 });
  if (r.status !== 0) falhas.push(f + '\n' + String(r.stdout || '').slice(-1500) + String(r.stderr || '').slice(-1500));
}
console.log('testes:', files.length, 'falhas:', falhas.length);
falhas.forEach(f => console.log('---- ' + f));
process.exit(falhas.length ? 1 : 0);
