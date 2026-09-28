'use strict';
const fs = require('fs');
const s = fs.readFileSync('index.html', 'utf8');
const a = s.indexOf('function rhCtKitAcoesHtml');
console.log(s.slice(a+2400, a+3200));
