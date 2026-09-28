'use strict';
const fs = require('fs');
const s = fs.readFileSync('index.html', 'utf8');
const keys = [
  'rh-contratacao-docs-inteligente',
  'rh-contratacao-wrap',
  'rhIa',
  'Tirar Foto',
  'portFoto',
  'camera'
];
keys.forEach(k => {
  const i = s.indexOf(k);
  console.log(k, i);
});
let i = 0, n = 0;
while ((i = s.indexOf('function rh', i)) >= 0 && n < 400) {
  const name = s.slice(i, Math.min(s.indexOf('(', i) + 1, i + 80));
  if (/Foto|Cam|Ia|Doc|Intelig|Captur|Preview/i.test(name)) console.log(name);
  i += 10; n++;
}
