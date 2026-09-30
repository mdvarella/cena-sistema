'use strict';
// PORTARIA 8.1.180 — saída gravada em outra equipe aparecia na equipe que tinha a mesma placa programada
// (caso 30/09: EBN143 saiu 07:27 com TTD8A69; a EON124, que usou TTD8A69 em 29/09 e hoje tem TTO2J56,
// aparecia "em campo" com essa saída e ficava sem o botão Liberar).
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

function bloco(inicioRe) {
  const m = inicioRe.exec(html);
  if (!m) throw new Error('não encontrado: ' + inicioRe);
  const ini = m.index + 1;
  const re = /\n(?:async function |function |var |\/\*\*|\/\/)/g;
  re.lastIndex = ini + 5;
  const fim = re.exec(html);
  return html.slice(ini, fim ? fim.index : undefined);
}
const fn = nome => bloco(new RegExp('\\n(?:async )?function ' + nome + '\\('));

const FUNCS = ['portDiaISO', 'portDiaLocal', 'portDiaOntemDe', 'portHoraLocalSaida', 'portEhViradaNoite', 'portSaidaDoTurno', 'portNormPlaca',
  'portBuscarEquipe', 'portMatchSaidaEquipe', 'portSaidaDeOutraEquipe', 'portEstaEmCampo', 'portSaidaDaEquipe', 'portSaidaEquipeDia',
  'portSaidaAbertaEquipe', 'portQuadroEquipesTurno', 'portTodasEquipesDisp', 'portEqPassaFiltroPort', 'portChaveEquipe', 'portDiasViradaPortaria'];
const CODIGO = FUNCS.map(fn).join('\n');

const HOJE = '2026-09-30';
const ONTEM = '2026-09-29';
const EQS = [
  { id: 'e-eon124', codigo: 'EON124', contrato_id: 'c1' },
  { id: 'e-ebn143', codigo: 'EBN143', contrato_id: 'c1' },
  { id: 'e-ein135', codigo: 'EIN135', contrato_id: 'c1' },
];
const byCod = c => EQS.find(e => e.codigo === c);

function ctx(opts) {
  const comps = opts.comps || [];
  const c = {
    console, Object, String, Number, Array, Date, isNaN, parseInt, Math, JSON,
    equipes_disp: EQS, equipes: [],
    frt_portaria: opts.saidas || [],
    composicao_dia: comps,
    _progVeiculos: {},
    dataHojeLocal: () => HOJE,
    _diasAtras: n => (n === 1 ? ONTEM : HOJE),
    portNomeEquipe: (eq, fb) => (eq && eq.codigo) || fb || '',
    portFindCompProgramada: (eqId, d) => comps.find(x => String(x.equipe_id) === String(eqId) && String(x.data).slice(0, 10) === d) || null,
    portCompsProgramadasDia: d => comps.filter(x => String(x.data).slice(0, 10) === d),
    portPlacaProgramada: (eqId, d) => { const x = comps.find(y => String(y.equipe_id) === String(eqId) && String(y.data).slice(0, 10) === d); return x ? x.placa : ''; },
  };
  vm.createContext(c);
  vm.runInContext(CODIGO, c);
  return c;
}
const saida = (id, extra) => Object.assign({ id, status: 'Em campo', data_retorno: null, deleted_at: null, data_saida: HOJE + 'T07:27:26.681-03:00' }, extra);
const compsCaso = () => [
  { id: 'k1', equipe_id: 'e-eon124', data: ONTEM, placa: 'TTD8A69', confirmada: true },
  { id: 'k2', equipe_id: 'e-eon124', data: HOJE, placa: 'TTO2J56', confirmada: true },
  { id: 'k3', equipe_id: 'e-ebn143', data: HOJE, placa: 'TTD8A69', confirmada: true },
];
const sEbn143 = () => saida('s-ebn143', { equipe_id: 'e-ebn143', equipe: 'EBN143', placa: 'TTD8A69', km_saida: 127438, motorista: 'DAVID DA SILVA' });

// ─── 1. Caso EON124 × EBN143 ───
let c = ctx({ comps: compsCaso(), saidas: [sEbn143()] });
const eon = byCod('EON124'), ebn = byCod('EBN143');
ok('EON124: saída da EBN143 não é saída aberta da EON124', c.portSaidaAbertaEquipe(eon, HOJE) === null);
ok('EON124: nem saída do dia', c.portSaidaEquipeDia(eon, HOJE, HOJE) === null);
ok('EON124: nem portSaidaDaEquipe', c.portSaidaDaEquipe(eon, HOJE) === null);
ok('EBN143: continua com a própria saída', (c.portSaidaAbertaEquipe(ebn, HOJE) || {}).id === 's-ebn143');
let q = c.portQuadroEquipesTurno(HOJE, '', '');
const cods = arr => arr.map(i => i.eq.codigo).sort();
ok('quadro: EBN143 em campo', JSON.stringify(cods(q.eqsEmCampo)) === JSON.stringify(['EBN143']), cods(q.eqsEmCampo));
ok('quadro: EON124 não saiu (fica com Liberar)', JSON.stringify(cods(q.eqsNaoSairam)) === JSON.stringify(['EON124']), cods(q.eqsNaoSairam));

// ─── 2. Saída de outra equipe só pelo código (sem equipe_id) também não casa ───
c = ctx({ comps: compsCaso(), saidas: [saida('s-cod', { equipe_id: null, equipe: 'EIN135', placa: 'TTO2J56' })] });
ok('código de outra equipe conhecida: não casa pela placa', c.portSaidaAbertaEquipe(eon, HOJE) === null && c.portSaidaEquipeDia(eon, HOJE, HOJE) === null && c.portSaidaDaEquipe(eon, HOJE) === null);

// ─── 3. Saída sem equipe (registro antigo/avulso) continua casando pela placa do dia ───
c = ctx({ comps: compsCaso(), saidas: [saida('s-sem', { equipe_id: null, equipe: '', placa: 'TTO2J56' })] });
ok('sem equipe: casa pela placa programada de hoje', (c.portSaidaAbertaEquipe(eon, HOJE) || {}).id === 's-sem');
ok('sem equipe: portSaidaDaEquipe também', (c.portSaidaDaEquipe(eon, HOJE) || {}).id === 's-sem');
c = ctx({ comps: compsCaso(), saidas: [saida('s-txt', { equipe_id: null, equipe: 'VISITA TÉCNICA', placa: 'TTO2J56' })] });
ok('texto que não é equipe: casa pela placa', (c.portSaidaAbertaEquipe(eon, HOJE) || {}).id === 's-txt');
c = ctx({ comps: compsCaso(), saidas: [saida('s-null', { equipe_id: null, equipe: 'null', placa: 'TTO2J56' })] });
ok('equipe "null": casa pela placa', (c.portSaidaAbertaEquipe(eon, HOJE) || {}).id === 's-null');

// ─── 4. Placa de ontem só vale para saída de ontem (virada da noite) ───
c = ctx({ comps: compsCaso(), saidas: [saida('s-hoje-velha', { equipe_id: null, equipe: '', placa: 'TTD8A69' })] });
ok('placa de ontem não identifica saída de hoje', c.portSaidaAbertaEquipe(eon, HOJE) === null);
c = ctx({ comps: compsCaso(), saidas: [saida('s-virada', { equipe_id: null, equipe: '', placa: 'TTD8A69', data_saida: ONTEM + 'T21:10:00-03:00' })] });
ok('placa de ontem identifica saída de ontem 21h ainda em campo (virada)', (c.portSaidaAbertaEquipe(eon, HOJE) || {}).id === 's-virada');
c = ctx({ comps: compsCaso(), saidas: [saida('s-virada-outra', { equipe_id: 'e-ein135', equipe: 'EIN135', placa: 'TTD8A69', data_saida: ONTEM + 'T21:10:00-03:00' })] });
ok('virada de outra equipe: não casa', c.portSaidaAbertaEquipe(eon, HOJE) === null);

// ─── 5. Saída da própria equipe com placa diferente continua da equipe (aviso de placa divergente) ───
c = ctx({ comps: compsCaso(), saidas: [saida('s-propria', { equipe_id: 'e-eon124', equipe: 'EON124', placa: 'ABC1D23' })] });
ok('própria equipe com outra placa: casa pelo id', (c.portSaidaAbertaEquipe(eon, HOJE) || {}).id === 's-propria');
c = ctx({ comps: compsCaso(), saidas: [saida('s-propria-cod', { equipe_id: null, equipe: 'EON124', placa: 'ABC1D23' })] });
ok('própria equipe só pelo código: casa', (c.portSaidaAbertaEquipe(eon, HOJE) || {}).id === 's-propria-cod');

// ─── 6. Retornada de outra equipe com a mesma placa não vira registro do dia ───
c = ctx({ comps: compsCaso(), saidas: [saida('s-ret', { equipe_id: 'e-ein135', equipe: 'EIN135', placa: 'TTO2J56', status: 'Retornado', data_retorno: HOJE + 'T12:00:00-03:00' })] });
ok('retornada de outra equipe: não casa em portSaidaDaEquipe', c.portSaidaDaEquipe(eon, HOJE) === null);

// ─── 7. portSaidaDeOutraEquipe ───
c = ctx({ comps: [], saidas: [] });
ok('outra: equipe_id diferente', c.portSaidaDeOutraEquipe({ equipe_id: 'e-ebn143' }, eon) === true);
ok('outra: mesmo equipe_id', c.portSaidaDeOutraEquipe({ equipe_id: 'e-eon124' }, eon) === false);
ok('outra: código de outra equipe', c.portSaidaDeOutraEquipe({ equipe: 'EBN143' }, eon) === true);
ok('outra: sem equipe', c.portSaidaDeOutraEquipe({ equipe: '' }, eon) === false);
ok('outra: texto desconhecido', c.portSaidaDeOutraEquipe({ equipe: 'VISITA' }, eon) === false);

ok('versão 8.1.180', /numero:\s*'8\.1\.180'/.test(html));
ok('sw.js 8.1.180', sw.includes("SW_VERSION   = 'cena-8.1.180'"));

if (failed.length) { console.log('portaria-saida-outra-equipe: FALHOU ' + failed.length + '/' + total); failed.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
console.log('portaria-saida-outra-equipe: OK ' + total + ' checagens');
