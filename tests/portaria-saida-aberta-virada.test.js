'use strict';
// Portaria — saída aberta de QUALQUER dia bloqueia nova saída do mesmo veículo (caso TUH1I44, 15/10/2026):
// a EON192 saiu às 22:06 de 14/10 (turno da noite) e o retorno não foi registrado; às 11:29 de 15/10 a EJN173 saiu com
// o mesmo veículo porque a trava só olhava saídas abertas do dia de hoje.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const failed = [];
let total = 0;
function ok(name, cond, detail) { total++; if (!cond) failed.push(name + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 400) : '')); }
function fn(nome) {
  const m = new RegExp('\\n(?:async )?function ' + nome + '\\(').exec(html);
  if (!m) throw new Error('função não encontrada: ' + nome);
  const re = /\n(?:async function |function |var |\/\/ ═|\/\/ ──|\/\*\*)/g;
  re.lastIndex = m.index + 12;
  const f = re.exec(html);
  return html.slice(m.index + 1, f ? f.index : undefined);
}
const semComent = s => s.replace(/\/\/[^\n]*/g, '');

const codigo = fn('portSaidaAbertaQualquerDia') + '\n' + fn('portMsgSaidaAberta');
ok('ES5 nas funções novas', !/\blet\s|\bconst\s|=>|`/.test(semComent(codigo)));

const ctx = { frt_portaria: [], portNormPlaca: p => String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, ''), String, Date, isNaN };
vm.createContext(ctx);
vm.runInContext(codigo, ctx);

const EON192 = { id: 'd5ec', placa: 'TUH1I44', equipe: 'EON192', equipe_id: 'eq-eon192', status: 'Em campo', data_saida: '2026-10-15T01:06:34.730Z' };
ctx.frt_portaria = [EON192, { id: 'x', placa: 'TTP2G93', equipe: 'EBN143', equipe_id: 'eq-b', status: 'Em campo', data_saida: '2026-10-15T14:00:00Z' }];
let a = ctx.portSaidaAbertaQualquerDia('TUH1I44', 'eq-ejn173');
ok('caso TUH1I44: saída da noite anterior sem retorno bloqueia a EJN173', a && a.id === 'd5ec', a);
ok('placa em outro formato também (TUH-1I44)', ctx.portSaidaAbertaQualquerDia('tuh-1i44', null) === EON192);
ok('mesma equipe com saída aberta de outro dia bloqueia', ctx.portSaidaAbertaQualquerDia('ZZZ0Z00', 'eq-eon192') === EON192);
ok('outra placa e outra equipe não bloqueia', ctx.portSaidaAbertaQualquerDia('ABC1D23', 'eq-c') === null);
const msg = ctx.portMsgSaidaAberta(EON192, 'TUH1I44');
ok('mensagem diz o veículo, a equipe e pede o retorno com KM', /TUH1I44/.test(msg) && /EON192/.test(msg) && /Registre o retorno/.test(msg) && /KM/.test(msg), msg);

ctx.frt_portaria = [Object.assign({}, EON192, { status: 'Retornado', data_retorno: '2026-10-15T12:00:00Z' })];
ok('retorno registrado libera', ctx.portSaidaAbertaQualquerDia('TUH1I44', 'eq-ejn173') === null);
ctx.frt_portaria = [Object.assign({}, EON192, { deleted_at: '2026-10-15T12:00:00Z' })];
ok('saída excluída não bloqueia', ctx.portSaidaAbertaQualquerDia('TUH1I44', null) === null);
ctx.frt_portaria = [Object.assign({}, EON192, { data_retorno: '2026-10-15T12:00:00Z' })];
ok('com data de retorno (status ainda não atualizado) não bloqueia', ctx.portSaidaAbertaQualquerDia('TUH1I44', null) === null);
ctx.frt_portaria = [Object.assign({}, EON192, { id: 'nova', data_saida: '2026-10-16T01:00:00Z' }), EON192];
ok('com duas abertas, aponta a mais antiga', ctx.portSaidaAbertaQualquerDia('TUH1I44', null).id === 'd5ec');

// Uso nas liberações
const lib = fn('portAbrirLiberacaoEquipe');
ok('liberação de equipe usa a trava de qualquer dia', /var _jaEmCampo = portSaidaAbertaQualquerDia\(placa, eqId\);/.test(lib)
  && /portMsgSaidaAberta\(_jaEmCampo, placa\)/.test(lib));
ok('liberação de equipe não restringe mais ao dia de hoje', !/status==='Em campo' &&[\s\S]{0,200}portDiaLocal\(p\.data_saida\)===dataHojeLocal\(\)/.test(lib));
ok('liberação de equipe relê as saídas da placa ao abrir', /portRefrescarSaidasPlaca\(placa\)/.test(lib));
const rsv = fn('portLiberarReservaDireto');
ok('liberação de reserva também usa a trava de qualquer dia', /portSaidaAbertaQualquerDia\(placa, null\)/.test(rsv));

if (failed.length) { console.error('FALHOU ' + failed.length + '/' + total + ':\n- ' + failed.join('\n- ')); process.exit(1); }
console.log('portaria-saida-aberta-virada: OK (' + total + ' verificações)');
