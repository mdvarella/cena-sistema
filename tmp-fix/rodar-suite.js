// Roda todos os tests/*.test.js|mjs em sequência e resume. Rodar na raiz do worktree.
// Testes de banco precisam de PGLITE_PATH (pasta com @electric-sql/pglite instalado); sem ele, saem como SKIP.
// Uso (PowerShell): $env:PGLITE_PATH="$env:TEMP\pglite-cena"; node tmp-fix/rodar-suite.js
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const dir = path.resolve('tests');
const arqs = fs.readdirSync(dir).filter(f => /\.test\.(m?js)$/.test(f)).sort();
let falhas = 0, pulados = 0;
const linhas = [];
for (const f of arqs) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(dir, f)], { encoding: 'utf8', timeout: 600000, maxBuffer: 64 * 1024 * 1024 });
  const saida = ((r.stdout || '') + (r.stderr || '')).trim().split(/\r?\n/).filter(Boolean);
  const ult = saida.slice(-1)[0] || '';
  const skip = /\bSKIP\b/.test(ult);
  const okr = r.status === 0;
  if (!okr) falhas++; if (skip) pulados++;
  linhas.push(`${okr ? (skip ? 'SKIP' : 'OK  ') : 'FAIL'} ${f} (${((Date.now() - t0) / 1000).toFixed(1)}s) ${ult.slice(0, 160)}`);
  if (!okr) linhas.push(saida.slice(-15).map(l => '      ' + l).join('\n'));
}
console.log(linhas.join('\n'));
console.log(`\nTOTAL: ${arqs.length} arquivos · ${arqs.length - falhas} passaram · ${falhas} falharam · ${pulados} pulados`);
