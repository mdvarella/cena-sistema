'use strict';
const fs = require('fs');
const s = fs.readFileSync('index.html', 'utf8');

function dump(needle, n) {
  const i = s.indexOf(needle);
  console.log('\n########', needle, i, '########');
  if (i < 0) return;
  console.log(s.slice(i, i + n));
}

dump('id="rh-contratacao-docs-inteligente"', 2500);
dump('function rhIaRender', 400);

let i = 0, c = 0;
while ((i = s.indexOf('function rhIa', i)) >= 0 && c < 80) {
  console.log(s.slice(i, s.indexOf('(', i) + 1));
  i += 12; c++;
}
console.log('--- rhCt foto ---');
i = 0; c = 0;
while ((i = s.indexOf('function rhCt', i)) >= 0 && c < 120) {
  const n = s.slice(i, s.indexOf('(', i) + 1);
  if (/Foto|Cam|Doc|Item|Captur|Arquivo|Anexo/i.test(n)) console.log(n);
  i += 12; c++;
}
