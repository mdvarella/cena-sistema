'use strict';
const fs = require('fs');
const s = fs.readFileSync('index.html', 'utf8');
const v = s.indexOf('var APP_VERSAO');
console.log(s.slice(v, v+180));
