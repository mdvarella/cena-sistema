'use strict';
// PORTARIA 8.1.181 — a deduplicação da memória fundia saídas de DIAS diferentes com a mesma equipe, placa e hora
// (30/09: EON121 08:14 fundida com a de 24/09 08:14, EIN134 08:13 com a de 24/09 08:13; a de 24/09, retornada,
// vencia e a de hoje sumia → equipe aparecia em "Programados não saíram").
process.env.TZ = 'America/Sao_Paulo';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const sw = fs.readFileSync(path.join(raiz, 'sw.js'), 'utf8');
const failed = [];
let total = 0;
function ok(name, cond, detail) { total++; if (!cond) failed.push(name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }

function todasPort() {
  const nomes = new Set();
  const re = /\nfunction (port\w*)\(/g;
  const blocos = [];
  let m;
  while ((m = re.exec(html))) {
    if (nomes.has(m[1])) continue;
    nomes.add(m[1]);
    const ini = m.index + 1;
    const r2 = /\n(?:async function |function |var |let |const |\/\*\*|\/\/|<\/script>)/g;
    r2.lastIndex = ini + 5;
    const f = r2.exec(html);
    blocos.push(html.slice(ini, f ? f.index : undefined));
  }
  return blocos;
}
const BLOCOS = todasPort();

function ctx(frt) {
  const c = {
    console: { log() {}, warn() {} }, Object, String, Number, Array, Date, isNaN, parseInt, parseFloat, Math, JSON, RegExp,
    DEMO: false, window: {}, document: { getElementById: () => null },
    equipes_disp: [{ id: 'e-121', codigo: 'EON121' }, { id: 'e-134', codigo: 'EIN134' }], equipes: [],
    frt_portaria: frt || [],
    dataHojeLocal: () => '2026-09-30',
  };
  vm.createContext(c);
  for (const b of BLOCOS) { try { vm.runInContext(b, c); } catch (e) { /* bloco que depende de estado de topo */ } }
  return c;
}
const S = (id, data_saida, extra) => Object.assign({ id, equipe_id: 'e-121', equipe: 'EON121', placa: 'TTJ1J13', status: 'Em campo', data_retorno: null, deleted_at: null, data_saida }, extra || {});

let c = ctx();
// ─── portSaidaMesmoMinuto ───
ok('mesma hora, dias diferentes (-03:00): não é o mesmo minuto', c.portSaidaMesmoMinuto(S('a', '2026-09-30T08:14:32.254-03:00'), S('b', '2026-09-24T08:14:43.953-03:00')) === false);
ok('mesma hora, dias diferentes (UTC do PostgREST): não é o mesmo minuto', c.portSaidaMesmoMinuto(S('a', '2026-09-30T11:14:32.254+00:00'), S('b', '2026-09-24T11:14:43.953+00:00')) === false);
ok('hora local gravada como UTC, mesmo dia: continua casando', c.portSaidaMesmoMinuto(S('a', '2026-09-30T08:14:00+00:00'), S('b', '2026-09-30T08:14:00-03:00')) === true);
ok('hora local gravada como UTC, dias diferentes: não casa', c.portSaidaMesmoMinuto(S('a', '2026-09-30T08:14:00+00:00'), S('b', '2026-09-24T08:14:00-03:00')) === false);
ok('mesmo instante em formatos diferentes: casa', c.portSaidaMesmoMinuto(S('a', '2026-09-30T08:14:32.254-03:00'), S('b', '2026-09-30T11:14:32.254+00:00')) === true);
ok('diferença de 90 s: casa', c.portSaidaMesmoMinuto(S('a', '2026-09-30T08:14:00-03:00'), S('b', '2026-09-30T08:15:30-03:00')) === true);
ok('diferença de 5 min: não casa', c.portSaidaMesmoMinuto(S('a', '2026-09-30T08:14:00-03:00'), S('b', '2026-09-30T08:19:00-03:00')) === false);

// ─── Caso EON121: 24/09 retornada + 30/09 gravada em dobro ───
// Formato devolvido pelo banco (fuso da sessão -03:00)
const ant = S('58bd2efa', '2026-09-24T08:14:43.953-03:00', { status: 'Retornado', data_retorno: '2026-09-24T17:00:00-03:00' });
const h1 = S('52eaebb2', '2026-09-30T08:14:32.254-03:00');
const h2 = S('4d886cc2', '2026-09-30T08:14:32.254-03:00');
c = ctx([]);
c.portMesclarSaidas([ant, h1, h2].map(x => Object.assign({}, x)));
const hoje = c.frt_portaria.filter(p => String(p.data_saida).startsWith('2026-09-30'));
ok('EON121: saída de hoje continua na memória', hoje.length === 1 && hoje[0].status === 'Em campo' && !hoje[0].data_retorno, hoje);
ok('EON121: cópia do mesmo instante fundida numa só', c.frt_portaria.length === 2, c.frt_portaria.map(p => p.id));
ok('EON121: 24/09 continua retornada e separada', c.frt_portaria.some(p => p.id === '58bd2efa' && p.status === 'Retornado'));

// ordem inversa (hoje chega antes)
c = ctx([]);
c.portMesclarSaidas([h1, ant].map(x => Object.assign({}, x)));
ok('ordem inversa: as duas ficam', c.frt_portaria.length === 2 && c.frt_portaria.some(p => p.id === '52eaebb2' && p.status === 'Em campo'));

// memória já com a de 24/09 e a de hoje chegando do banco
c = ctx([Object.assign({}, ant)]);
c.portMesclarSaidas([Object.assign({}, h1)]);
ok('memória com 24/09 + hoje do banco: hoje entra como nova', c.frt_portaria.length === 2 && c.frt_portaria.some(p => p.id === '52eaebb2' && p.status === 'Em campo'));

// EIN134 (sem cópia)
c = ctx([]);
c.portMesclarSaidas([
  { id: '40677b21', equipe_id: 'e-134', equipe: 'EIN134', placa: 'TTP2G92', status: 'Retornado', data_saida: '2026-09-24T08:13:42.942-03:00', data_retorno: '2026-09-24T17:00:00-03:00' },
  { id: 'a301a075', equipe_id: 'e-134', equipe: 'EIN134', placa: 'TTP2G92', status: 'Em campo', data_saida: '2026-09-30T08:13:15.935-03:00', data_retorno: null },
]);
ok('EIN134: saída de hoje continua em campo', c.frt_portaria.some(p => p.id === 'a301a075' && p.status === 'Em campo'));

ok('versão 8.1.181 no log', html.includes("{v:'8.1.181'"));
var numAtual = (html.match(/numero:\s*'([\d.]+)'/) || [])[1];
ok('sw.js acompanha a versão atual', !!numAtual && sw.includes("SW_VERSION   = 'cena-" + numAtual + "'"), numAtual);

if (failed.length) { console.log('portaria-dedup-mesmo-dia: FALHOU ' + failed.length + '/' + total); failed.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
console.log('portaria-dedup-mesmo-dia: OK ' + total + ' checagens');
