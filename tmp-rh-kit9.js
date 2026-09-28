'use strict';
const fs = require('fs');
const s = fs.readFileSync('index.html', 'utf8');

function dump(label, needle, n){
  const i = s.indexOf(needle);
  console.log('\n==== '+label+' @'+i+' ====\n');
  if(i<0) return;
  console.log(s.slice(i, i+n));
}

dump('LOADKIT', 'function rhCtCarregarKit', 1800);
dump('LOADKIT2', 'rh_contratacao_documentos\'', 600);
dump('KITFROM', 'status_kit:', 400);
dump('RENDERMOD', 'function rhIaRenderModalCamera', 2500);
dump('RECEBER', 'function rhIaReceberCapturaArquivo', 1800);
dump('MODOCAM', '_rhIaCam.mode', 800);
