'use strict';
const fs = require('fs');
const s = fs.readFileSync('index.html', 'utf8');

function dump(label, needle, n){
  const i = s.indexOf(needle);
  console.log('\n==== '+label+' @'+i+' ====\n');
  if(i<0) return;
  console.log(s.slice(i, i+n));
}

dump('APP', 'var APP_VERSAO', 120);
dump('ITEMFROM', 'function rhCtItemFromRegra', 1400);
dump('MONTAR', 'function rhMontarKit(', 2200);
dump('ABRIRARQ', 'function rhKitAbrirArquivo', 1600);
dump('ANEXARKIT', 'function rhCtAnexarKitArquivo', 1800);
dump('ANEXARKITINP', 'function rhCtAnexarKit(', 900);
dump('CAMKIT', 'function rhCtAbrirCameraKit', 1100);
dump('ACOES', 'function rhCtKitAcoesHtml', 2200);
dump('IAHTML', "rh-contratacao-docs-inteligente", 2500);
dump('IAONFILES', 'function rhCtIaOnFiles', 500);
dump('SW', 'CACHE_NAME', 200);
