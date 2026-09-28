'use strict';
const fs = require('fs');
const s = fs.readFileSync('index.html', 'utf8');
const a = s.indexOf('function rhCtKitAcoesHtml');
const b = s.indexOf('function rhKitFlush');
// flush is BEFORE acoes? check
console.log('flush', s.indexOf('function rhKitFlush'), 'acoes', a);
const next = s.indexOf('\nfunction ', a+10);
console.log('next after acoes', next, s.slice(next, next+80));
console.log('\n==== ACOES TAIL ====\n');
console.log(s.slice(a, next).slice(-900));

const p = s.indexOf('if(old.arquivo_url) it.arquivo_url=old.arquivo_url;');
console.log('\n==== MERGE ====\n', s.slice(p, p+700));

const v = s.indexOf("var APP_VERSAO");
console.log('\n==== VER ====\n', s.slice(v, v+650));
