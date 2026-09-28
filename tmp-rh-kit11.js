'use strict';
const fs = require('fs');
const s = fs.readFileSync('index.html', 'utf8');

const idx = s.indexOf("Frente/Verso");
console.log('Frente/Verso', idx);
console.log(s.slice(idx, idx+800));

const keys = [
  'sbSelect(\'rh_contratacao_documentos\'',
  'sbSelect("rh_contratacao_documentos"',
  "rh_contratacao_documentos",
];
keys.forEach(k => {
  let i = 0, n=0;
  while((i=s.indexOf(k, i))>=0 && n<8){
    if(i>6000000) console.log('\n---', k, i, '\n', s.slice(i-80, i+400));
    i+=k.length; n++;
  }
});
