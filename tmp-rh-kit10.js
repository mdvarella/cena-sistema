'use strict';
const fs = require('fs');
const s = fs.readFileSync('index.html', 'utf8');

function dump(label, needle, n){
  const i = s.indexOf(needle);
  console.log('\n==== '+label+' @'+i+' ====\n');
  if(i<0) return;
  console.log(s.slice(i, i+n));
}

dump('CAMBTNS', "onclick=\"_rhIaCam.mode='frente_verso'", 900);
dump('KITROWS', '_rhCtKit=docs', 900);
dump('KITROWS2', '_rhCtKit = docs', 900);
dump('KITROWS3', 'arquivo_url:d.arquivo_url', 900);
dump('KITROWS4', 'it.arquivo_url=row', 400);
dump('FROMROW', 'function rhCtKitFromRows', 1500);
dump('FROMROW2', 'function rhKitFromDb', 800);
dump('ABRIRREST', 'Abrir em nova aba', 900);
