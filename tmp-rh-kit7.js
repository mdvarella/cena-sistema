'use strict';
const fs = require('fs');
const s = fs.readFileSync('index.html', 'utf8');

function dump(label, needle, n){
  const i = s.indexOf(needle);
  console.log('\n==== '+label+' @'+i+' ====\n');
  if(i<0) return;
  console.log(s.slice(i, i+n));
}

const m = s.indexOf('function rhMontarKit(');
const prevMerge = s.indexOf('prev[', m);
console.log('\n==== PREV MERGE from first prev[ after montar ====\n');
// find the restore loop
const restore = s.indexOf('Object.keys(prev)', m);
const restore2 = s.indexOf('for(var k in prev)', m);
const restore3 = s.indexOf('_rhCtKit.forEach', m);
console.log('Object.keys', restore, 'for in', restore2, 'forEach kit', restore3);
console.log(s.slice(m+1800, m+4500));

dump('ANEXARREST', 'it.arquivo_url=url;\n      it.arquivo_nome=file.name', 900);
dump('PERSIST', 'function rhPersistirKitSnapshot', 1600);
dump('IAWRAP', "id=\"rh-contratacao-docs-inteligente\"", 2200);
dump('IAWRAP2', "id='rh-contratacao-docs-inteligente'", 2200);
dump('SELFILES', "Selecionar arquivos", 900);
