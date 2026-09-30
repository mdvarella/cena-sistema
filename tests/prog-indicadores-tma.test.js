'use strict';
// PROGRAMAÇÃO 8.1.169 — indicadores do quadro TMA: Total equipes (presentes no ponto ÷ 2), Programadas (salvas com 2 ativos),
// Em Campo, Logadas, Retornaram, Folga (de folga e escalados), Escalados e Aproveitamento (regra antiga).
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
const vr = nome => bloco(new RegExp('\\nvar ' + nome + '\\s*='));

const codigo = vr('_progResumoPresenca') + '\n'
  + ['progResumoPresentes', 'progResumoValorHtml', 'progResumoTotal', 'progResumoAtualizarTotal', 'progRenderResumo'].map(fn).join('\n');

const DIA = '2026-09-29';
function contexto() {
  const els = {};
  const ctx = {
    console, Math, Object, Array, String, JSON,
    BLOQ_STATUS: ['ferias', 'afastado', 'treinamento', 'falta', 'faltou', 'integracao', 'patio', 'verificar', 'fraude', 'demitido', 'inapto'],
    _progStatus: { c2: 'folga', c4: 'falta', c10: 'demitido' },
    _calDados: { [DIA]: 'azul' }, CAL_CORES_2026: {},
    colaboradores: [
      { id: 'c1', re: '1' }, { id: 'c2', re: '2' }, { id: 'c3', re: '3' }, { id: 'c4', re: '4' },
      { id: 'c5', re: '5', cor_escala: 'azul' }, { id: 'c6', re: '6' }, { id: 'c7', re: '7' }, { id: 'c8', re: '8' },
      { id: 'c9' }, { id: 'c10', re: '10' }
    ],
    composicao_dia: [
      { equipe_id: 'A', data: DIA, colaborador_ids: ['c1', 'c2'], confirmada: true },
      { equipe_id: 'B', data: DIA, colaborador_ids: '["c3","c4"]', confirmada: true },
      { equipe_id: 'C', data: DIA, colaborador_ids: ['c5', 'c6'], confirmada: false },
      { equipe_id: 'E', data: DIA + 'T00:00:00', colaborador_ids: ['c7', 'c8'], confirmada: true },
      { equipe_id: 'D', data: DIA, colaborador_ids: ['c1', 'c9'], confirmada: true, deleted_at: '2026-09-29T08:00:00Z' },
      { equipe_id: 'A', data: '2026-09-28', colaborador_ids: ['c9', 'c10'], confirmada: true }
    ],
    batidas: { '1': true, '2': true, '3': true, '5': true, '7': true, '10': true },
    pontoCacheGet(re, data) { return data === DIA && ctx.batidas[re] ? { entrada: '07:00' } : undefined; },
    _pontoTemEntrada(p) { return !!(p && p.entrada); },
    parseColabIds(v) { if (Array.isArray(v)) return v; try { return JSON.parse(v || '[]'); } catch (e) { return []; } },
    progMinColaboradoresEquipe() { return 2; },
    portaria: { A: 'em_campo', E: 'retornou', F: 'em_campo' },
    progTmaStatusPortaria(eqId) { return { status: ctx.portaria[eqId] || 'aguardando' }; },
    sessoes: { A: { login_ts: 1 }, E: { login_ts: 1, logout_ts: 2 }, B: { login_ts: null } },
    progTmaSessaoEquipe(eqId) { return ctx.sessoes[eqId] || null; },
    escHtml: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
    document: { getElementById(id) { return els[id] || null; } },
    els
  };
  vm.createContext(ctx);
  vm.runInContext(codigo, ctx);
  return ctx;
}
function cards(h) {
  const out = {};
  const re = /white-space:nowrap">([^<]+)<\/div><div(?: id="([^"]+)")?><div style="font-size:18px;font-weight:700;color:[^"]+">([^<]+)<\/div>(?:<div style="font-size:9px;color:#888;margin-top:2px;white-space:nowrap">([^<]+)<\/div>)?/g;
  let m;
  while ((m = re.exec(h))) out[m[1]] = { v: m[3], id: m[2] || '', sub: m[4] || '' };
  return out;
}

const ctx = contexto();
const ativas = ['A', 'B', 'C', 'D', 'E'].map(id => ({ id }));
const todas = ativas.concat([{ id: 'F' }]);
const cols = ctx.colaboradores;
const h = ctx.progRenderResumo(ativas, DIA, cols, todas);
const c = cards(h);

ok('8 cards', Object.keys(c).length === 8, Object.keys(c));
ok('sem Hora Extra / Completas / Incompletas / Não prog.', !c['⏰ Hora Extra'] && !c['Completas'] && !c['Incompletas'] && !c['Não prog.'] && !/Hora Extra/.test(h));
ok('Total equipes = presentes no ponto ÷ 2 (5 presentes → 2)', c['Total equipes'] && c['Total equipes'].v === '2', c['Total equipes']);
ok('Total equipes mostra quantos presentes', c['Total equipes'] && c['Total equipes'].sub === '5 presentes', c['Total equipes']);
ok('presentes: sem RE e demitido não contam', ctx.progResumoPresentes(DIA, cols) === 5);
ok('presentes: outro dia = 0', ctx.progResumoPresentes('2026-09-30', cols) === 0);
ok('Programadas = salvas com 2 ativos (A, E; B tem falta)', c['✓ Programadas'] && c['✓ Programadas'].v === '2', c['✓ Programadas']);
ok('Em Campo = saída aberta na portaria (A e F, inclusive equipe em folga)', c['🟢 Em Campo'] && c['🟢 Em Campo'].v === '2', c['🟢 Em Campo']);
ok('Logadas = login no dia, mesmo encerrada (A, E)', c['📱 Logadas'] && c['📱 Logadas'].v === '2', c['📱 Logadas']);
ok('Retornaram = saíram e voltaram (E)', c['🔵 Retornaram'] && c['🔵 Retornaram'].v === '1', c['🔵 Retornaram']);
ok('Escalados = colaboradores escalados no dia (sem composição excluída nem de outro dia)', c['👷 Escalados'] && c['👷 Escalados'].v === '8', c['👷 Escalados']);
ok('Folga = de folga (manual ou calendário) e escalados (c2, c5)', c['🏖 Folga'] && c['🏖 Folga'].v === '2', c['🏖 Folga']);
ok('Aproveitamento mantido: (3 salvas + 1 completa) / 5 = 80%', c['Aproveitamento'] && c['Aproveitamento'].v === '80%', c['Aproveitamento']);
ok('card Total equipes tem id para atualizar', c['Total equipes'] && c['Total equipes'].id === 'prog-res-total-eq');
ok('cards com explicação (title)', /title="Colaboradores de campo com batida de entrada no ponto no dia, divididos por 2"/.test(h) && /title="Equipes que iniciaram o app no dia, mesmo que já tenham encerrado"/.test(h));

{
  const el = { innerHTML: '' };
  ctx.els['prog-res-total-eq'] = el;
  ctx.batidas['8'] = true;
  ctx.progResumoAtualizarTotal();
  ok('ponto chegou depois: card atualiza (6 presentes → 3)', /font-weight:700;color:#555">3<\/div>/.test(el.innerHTML) && /6 presentes/.test(el.innerHTML), el.innerHTML);
}
{
  const ctx2 = contexto();
  const h2 = ctx2.progRenderResumo([], DIA, [], []);
  const c2 = cards(h2);
  ok('sem equipes: aproveitamento 0% e totais 0', c2['Aproveitamento'].v === '0%' && c2['Total equipes'].v === '0' && c2['Total equipes'].sub === '0 presentes');
  ctx2.progResumoAtualizarTotal();
}

const q = fn('progRenderQuadro');
ok('quadro passa base de presença do contrato e todas as equipes', /progRenderResumo\(ativas, data, colsContrato, eqs\)/.test(q));
ok('quadro: cálculo antigo de folga não escalada removido', !/nFolgaReal/.test(q));
ok('quadro: atualiza Total equipes quando o ponto carrega', /_progRefreshBadgesPonto\(\)\{\n.*progCarregarBadgesPonto\(\);\n.*progResumoAtualizarTotal\(\)/.test(q));
ok('badges: consulta individual de ponto atualiza Total equipes', /pontoConsultar\(re, data, function\(ponto\)\{\n\s*if\(ponto && typeof progResumoAtualizarTotal==='function'\) progResumoAtualizarTotal\(\);/.test(fn('progCarregarBadgesPonto')));
ok('versão 8.1.169 no changelog', /\{v:'8\.1\.169'/.test(html));
ok('sw.js versionado', /'cena-8\.1\.\d+'/.test(sw));

if (failed.length) { console.error('FALHOU ' + failed.length + '/' + total + ':\n - ' + failed.join('\n - ')); process.exit(1); }
console.log('prog-indicadores-tma: ' + total + ' verificações OK');
