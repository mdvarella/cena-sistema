'use strict';
const fs = require('fs');
const s = fs.readFileSync('index.html', 'utf8');
const needle = "sbFetch('rh_contratacao_documentos'";
let i=0, n=0;
while((i=s.indexOf(needle, i))>=0 && n<15){
  console.log('\n====', i, '====\n', s.slice(i-120, i+500));
  i+=needle.length; n++;
}
if(!n){
  const n2 = "sbSelect('rh_contratacao_documentos'";
  i=0;
  while((i=s.indexOf(n2, i))>=0 && n<10){
    console.log('\n==== sel', i, '====\n', s.slice(i-80, i+400));
    i+=n2.length; n++;
  }
}
const n3 = '_rhCtKit=';
i=6500000;
let c=0;
while((i=s.indexOf(n3, i))>=0 && i<7200000 && c<12){
  console.log('\n_rhCtKit=', i, s.slice(i, i+250).replace(/\n/g,' | '));
  i+=n3.length; c++;
}
