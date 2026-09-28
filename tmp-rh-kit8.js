'use strict';
const fs = require('fs');
const s = fs.readFileSync('index.html', 'utf8');

function dump(label, needle, n){
  const i = s.indexOf(needle);
  console.log('\n==== '+label+' @'+i+' ====\n');
  if(i<0) return;
  console.log(s.slice(i, i+n));
}

dump('KITJSON', 'kit_snapshot', 400);
dump('KITGER', '_rhCtAtual.kit', 400);
dump('CARREGKIT', 'function rhCarregarKit', 1500);
dump('CARREGKIT2', 'function rhCtCarregarDocumentos', 1500);
dump('LOADDOCS', 'rh_contratacao_documentos', 800);
dump('ANEXARFULL', 'async function rhCtAnexarKitArquivo', 2200);
dump('MODEMULTI', "mode:'multipagina'", 400);
dump('CAMERAMODE', 'function rhIaAbrirCapturaCamera', 1800);
