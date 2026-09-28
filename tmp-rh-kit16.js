'use strict';
const fs = require('fs');
const s = fs.readFileSync('index.html', 'utf8');
const a = s.indexOf('async function rhKitAbrirArquivo');
const a2 = s.indexOf('function rhKitAbrirArquivo');
console.log('async', a, 'fn', a2);
const start = a>=0?a:a2;
const nxt = s.indexOf('\nasync function rhKitValidar', start);
console.log('validar', nxt);
console.log(s.slice(start, nxt));

const l = s.indexOf('function rhCtLerIa');
const l2 = s.indexOf('async function rhCtLerIa');
console.log('\nler', l, l2);
const ls = l2>=0?l2:l;
console.log(s.slice(ls, ls+900));
