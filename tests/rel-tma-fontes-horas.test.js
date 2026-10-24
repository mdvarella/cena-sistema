'use strict';
// Relatório TMA "Horas Logadas e Faturamento por Equipe" — fontes do cálculo (Ponto, Portaria, Diário, Escala, Comparar).
// Executa as funções REAIS do index.html (e as da versão publicada 8.1.226 para a regressão do Ponto) contra um banco
// em memória com a semântica de leitura do PostgREST (filtros eq/gte/lte/lt/is, ordem, offset/limit). Dados fictícios.
process.env.TZ = 'America/Sao_Paulo';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execSync } = require('child_process');

const raiz = path.join(__dirname, '..');
const norm = s => s.replace(/\r\n/g, '\n');
const html = norm(fs.readFileSync(path.join(raiz, 'index.html'), 'utf8'));
let base = null;
try { base = norm(execSync('git show ' + (process.env.REL_FONTES_BASE || 'd79e8ea') + ':index.html', { cwd: raiz, maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8')); } catch (e) { base = null; }
let falhas = 0, total = 0;
function ok(nome, cond, extra) { total++; if (!cond) { falhas++; console.error('FALHOU: ' + nome + (extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 500) : '')); } }
function fnDe(src, nome) {
  const re = new RegExp('\\n(?:async )?function ' + nome + '\\(');
  const n = src.split(re).length - 1;
  if (n !== 1) throw new Error('definição de ' + nome + ': ' + n);
  const ini = src.search(re) + 1;
  return src.slice(ini, src.indexOf('\n}\n', ini) + 2);
}
const temFn = (src, nome) => new RegExp('\\n(?:async )?function ' + nome + '\\(').test(src);
const espera = ms => new Promise(r => setTimeout(r, ms));

// ── Dados fictícios ─────────────────────────────────────────────────────────────
const CID = '04277076-baa5-4ea4-85dc-bddf55541e68';
const D1 = '2026-09-14', D2 = '2026-09-15', D3 = '2026-09-16', HOJE = '2026-10-24';
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const E = { E1: id(1), E2: id(2), E3: id(3), E4: id(4), E5: id(5), E6: id(6) };
const equipes = [
  { id: E.E1, codigo: 'EBN101', tipo_id: 't1', contrato_id: CID, turno_tipo: 'Manhã', status: 'Ativo' },
  { id: E.E2, codigo: 'EBN102', tipo_id: 't1', contrato_id: CID, turno_tipo: 'Manhã', status: 'Ativo' },
  { id: E.E3, codigo: 'EON201', tipo_id: 't1', contrato_id: CID, turno_tipo: 'Noite 1', status: 'Ativo' },
  { id: E.E4, codigo: 'MOT301', tipo_id: 't2', contrato_id: CID, turno_tipo: 'Manhã', status: 'Ativo' },
  { id: E.E5, codigo: 'CES401', tipo_id: 't3', contrato_id: CID, turno_tipo: 'Manhã', status: 'Ativo' },
  { id: E.E6, codigo: 'XYZ601', tipo_id: null, contrato_id: CID, turno_tipo: 'Manhã', status: 'Ativo' },
];
const tipos = [{ id: 't1', nome: 'FIORINO' }, { id: 't2', nome: 'MOTO DUPLA' }, { id: 't3', nome: 'CESTO AÉREO' }];
const servicosLinhas = [
  { id: 's1', contrato_id: CID, tipo_disp: 'FIORINO', descricao: '', valor_hora: 254.34, deleted_at: null },
  { id: 's2', contrato_id: CID, tipo_disp: 'MOTO DUPLA', descricao: '', valor_hora: 243.39, deleted_at: null },
  { id: 's3', contrato_id: CID, tipo_disp: 'CESTO AÉREO', descricao: '', valor_hora: 338.76, deleted_at: null },
];
const C = { c1: id(101), c2: id(102), c3: id(103), c4a: id(104), c4b: id(105), c5: id(106), c6: id(107) };
const colabs = [
  { id: C.c1, nome: 'COLAB UM', re: '9001' }, { id: C.c2, nome: 'COLAB DOIS', re: '9002' }, { id: C.c3, nome: 'COLAB TRES', re: '9003' },
  { id: C.c4a, nome: 'COLAB QUATRO A', re: '9004' }, { id: C.c4b, nome: 'COLAB QUATRO B', re: '9005' }, { id: C.c5, nome: 'COLAB CINCO', re: '9006' },
  { id: C.c6, nome: 'COLAB SEIS', re: '9007' },
];
const membros = { [E.E1]: [C.c1], [E.E2]: [C.c2], [E.E3]: [C.c3], [E.E4]: [C.c4a, C.c4b], [E.E5]: [C.c5], [E.E6]: [C.c6] };
let seq = 1;
const comp = (eq, data, confirmada) => ({ id: id(5000 + seq++), equipe_id: eq, data, colaborador_ids: membros[eq], confirmada: confirmada !== false, deleted_at: null });
const comps = [
  comp(E.E1, D1), comp(E.E1, D2), comp(E.E1, D3), comp(E.E2, D1), comp(E.E2, D2), comp(E.E2, D3),
  comp(E.E3, D1), comp(E.E3, D2), comp(E.E4, D1), comp(E.E4, D2), comp(E.E5, D1), comp(E.E5, HOJE),
  comp(E.E6, D1), comp(E.E6, D2), comp(E.E1, HOJE, false),
];
const iso = (dia, hhmm) => new Date(dia + 'T' + hhmm + ':00-03:00').toISOString();
const ms = (dia, hhmm) => new Date(dia + 'T' + hhmm + ':00-03:00').getTime();
const D = (dia, n) => { const x = new Date(dia + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
let ps = 1;
const saida = (eq, placa, ds, hs, dr, hr, extra) => Object.assign({ id: id(7000 + ps++), equipe_id: eq, placa, data_saida: iso(ds, hs), data_retorno: dr ? iso(dr, hr) : null, status: dr ? 'Retornado' : 'Em campo', tipo_encerramento: null, obs_retorno: null, retorno_horario_conhecido: null, deleted_at: null }, extra || {});
const portaria = [
  saida(E.E1, 'AAA1A11', D1, '07:30', D1, '17:00'),                                                     // P1 simples 9h30 → 8h30
  saida(E.E2, 'BBB2B22', D1, '07:40', D1, '23:59', { obs_retorno: '[Encerramento administrativo] saída antiga sem retorno', retorno_horario_conhecido: false, tipo_encerramento: 'ENCERRAMENTO_ADMINISTRATIVO' }), // P2 adm
  saida(E.E1, 'AAA1A11', D2, '07:00', D2, '11:00'), saida(E.E1, 'AAA1A11', D2, '13:00', D2, '16:00'),   // P3 duas válidas 7h → 6h
  saida(E.E2, 'BBB2B22', D2, '08:00', D2, '12:00'), saida(E.E2, 'CCC3C33', D2, '10:00', D2, '14:00'),   // sobrepostas: união 6h, sem almoço
  saida(E.E1, 'AAA1A11', D3, '08:00', D3, '17:00'), saida(E.E1, 'AAA1A11', D3, '08:03', D3, '18:30'),   // duplicado com retornos divergentes
  saida(E.E2, 'BBB2B22', D3, '08:00', D3, '17:00'), saida(E.E2, 'BBB2B22', D3, '08:02', D3, '17:05'),   // duplicado coerente: união 9h05 → 8h05
  saida(E.E3, 'DDD4D44', D1, '20:00', D(D1, 1), '05:00'),                                               // noturna 9h → 8h, no dia D1
  saida(E.E4, 'EEE5E55', D1, '07:00', D(D1, 1), '08:00'),                                               // 25h → conferir
  saida(E.E5, 'FFF6F66', HOJE, '07:00', null),                                                          // em campo (hoje)
  saida(E.E5, 'FFF6F66', D1, '07:10', null),                                                            // sem retorno (passado)
  saida(E.E3, 'DDD4D44', D3, '01:00', D3, '06:00'),                                                     // madrugada de D3 → turno noturno de D2 (5h, sem almoço)
  saida(E.E4, 'EEE5E55', D2, '08:00', D2, '17:00'), saida(E.E4, 'EEE5E56', D2, '18:00', null),         // parcial: válida 9h → 8h + sem retorno
  saida(E.E6, 'GGG7G77', D2, '08:00', D2, '17:00'),                                                     // sem tipo
  saida(E.E4, 'EEE5E55', D3, '08:00', D3, '17:00'),                                                     // sem programação (fora do cálculo)
];
let ss = 1;
const sess = (eq, data, l, o, alm, ret, mf, extra) => Object.assign({ id: id(8000 + ss++), equipe_id: eq, data, login_ts: l, logout_ts: o, almoco_ts: alm, retorno_ts: ret, minutos_faturados: mf, deleted_at: null }, extra || {});
const sessoes = [
  sess(E.E1, D1, ms(D1, '07:30'), ms(D1, '17:00'), ms(D1, '12:00'), ms(D1, '13:00'), 510),             // S1 8h30
  sess(E.E2, D1, ms(D1, '08:00'), ms(D1, '16:00'), null, null, 480),                                    // S2 sem almoço → 8h
  sess(E.E1, D2, ms(D2, '07:00'), ms(D2, '16:00'), ms(D2, '12:00'), null, 0),                           // S3 almoço incompleto
  sess(E.E2, D2, ms(D2, '08:00'), ms(D2, '17:00'), ms(D2, '12:00'), ms(D2, '13:00'), 480),             // S4 duplicada idêntica
  sess(E.E2, D2, ms(D2, '08:00'), ms(D2, '17:00'), ms(D2, '12:00'), ms(D2, '13:00'), 480),
  sess(E.E1, D3, ms(D3, '08:00'), ms(D3, '12:00'), null, null, 240), sess(E.E1, D3, ms(D3, '11:00'), ms(D3, '17:00'), null, null, 360), // simultâneas: união 9h
  sess(E.E2, D3, ms(D3, '08:00'), null, null, null, 0),                                                 // sem logout
  sess(E.E3, D1, ms(D1, '20:00'), ms(D(D1, 1), '05:00'), null, null, 540),                              // noturna 9h
  sess(E.E4, D1, ms(D1, '07:00'), ms(D(D1, 1), '08:00'), null, null, 0),                                // 25h → conferir
  sess(E.E5, D1, ms(D1, '08:00'), ms(D1, '17:00'), ms(D1, '12:00'), ms(D1, '13:00'), 540),             // app gravou o bruto
];
const sessoesPlpt = [sess(E.E4, D2, ms(D2, '09:00'), ms(D2, '15:00'), null, null, 360)];
const ponto = [];
const pr = (re, data, entrada, saida, marc) => ponto.push({ id: id(9000 + ponto.length + 1), re, data, status: 'P', entrada, saida, entrada_ajustada: null, saida_ajustada: null, intervalo_saida: null, intervalo_retorno: null, todas_marcacoes: marc || [], consultado_em: '2026-09-20T10:00:00Z' });
pr('9001', D1, '07:25', '17:05'); pr('9001', D2, '07:00', '16:10'); pr('9001', D3, '08:00', '17:00');
pr('9002', D1, '08:00', '16:00'); pr('9002', D2, '08:00', '14:00'); pr('9002', D3, '08:00', '17:05');
pr('9003', D1, '20:00', ''); pr('9003', D(D1, 1), '', '05:00', [{ tipo: 'Saída', hora: '05:00' }]);
pr('9004', D1, '07:00', '17:00'); pr('9005', D1, '07:10', '17:00'); pr('9004', D2, '08:00', '17:00');
pr('9006', D1, '08:00', '17:00'); pr('9007', D1, '08:00', '17:00'); pr('9007', D2, '08:00', '17:00');
// volume: 2.500 linhas de outros REs para forçar várias páginas
for (let i = 0; i < 2500; i++) pr(String(20000 + i), [D1, D2, D3][i % 3], '07:00', '16:00');

// ── Banco em memória ───────────────────────────────────────────────────────────
function criarBanco(extra) {
  extra = extra || {};
  const t = {
    composicao_dia: comps, ponto_registros: ponto, frotas_portaria_saidas: portaria, sessoes_disponibilidade: sessoes.concat(extra.sessoes || []),
    plpt_sessoes: sessoesPlpt, servicos_contrato: servicosLinhas, prog_veiculos_dia: [],
  };
  const b = { regra: () => 'ok', reqs: [] };
  const casa = (l, k, expr) => {
    const i = expr.indexOf('.'), op = expr.slice(0, i), v = decodeURIComponent(expr.slice(i + 1));
    const x = l[k] == null ? null : String(l[k]);
    const cmp = (x !== null && /T/.test(v) && /T/.test(x)) ? [new Date(x).getTime(), new Date(v).getTime()] : [x, v];
    if (op === 'eq') return x === v;
    if (op === 'gte') return x !== null && cmp[0] >= cmp[1];
    if (op === 'lte') return x !== null && cmp[0] <= cmp[1];
    if (op === 'lt') return x !== null && cmp[0] < cmp[1];
    if (op === 'is') return v === 'null' ? l[k] == null : String(l[k]) === v;
    return true;
  };
  b.ler = (url) => {
    const u = new URL(url); const tab = u.pathname.replace('/rest/v1/', ''); const q = u.searchParams;
    b.reqs.push({ tab, url });
    const modo = b.regra({ tab, url });
    if (modo !== 'ok') return modo;
    let rows = (t[tab] || []).filter(l => [...q].every(([k, v]) => ['select', 'order', 'limit', 'offset'].includes(k) || casa(l, k, v)));
    const ord = (q.get('order') || '').split(',').filter(Boolean).map(o => o.split('.'));
    rows = rows.slice().sort((x, y) => { for (const [c, d] of ord) { const a = x[c] == null ? '' : String(x[c]), bb = y[c] == null ? '' : String(y[c]); if (a !== bb) return (a < bb ? -1 : 1) * (d === 'desc' ? -1 : 1); } return 0; });
    const off = Number(q.get('offset') || 0), lim = q.get('limit') ? Number(q.get('limit')) : rows.length;
    return JSON.parse(JSON.stringify(rows.slice(off, off + lim)));
  };
  return b;
}

// ── Sandbox ────────────────────────────────────────────────────────────────────
const FUNCS = ['relTmaCid', 'relTmaListarDatas', 'relTmaEqMatchTipo', 'relTmaTipoNomeEq', 'relTmaCodigoEq', 'relTmaHoraParaMin', 'relTmaFmtHhMm', 'relTmaMinToDecimal',
  'relTmaFmtMoeda', 'relTmaAddDiasISO', 'relTmaPontoEntradaSaida', 'relTmaPontoSaidaDiaSeguinte', 'relTmaResolverIntervaloPonto', 'relTmaFetchPontoPeriodo',
  'relTmaCalcFatPontoDia', 'relTmaValorHoraTipo', 'relTmaEnsureServicosTma', 'relTmaCompEstaProgramada', 'relTmaQtdEsperadaIntegrantes', 'relTmaFetchPeriodoSessoes',
  'portEncAdm', 'progStatusComPrazo',
  'relTmaFatPontoGerar', 'relTmaFatPontoVerDetalhe', 'relTmaFatPontoExcel', 'relTmaFatPontoStatusCor', 'relTmaFatPontoFmtSaida', 'relTmaFatPontoFmtSaidaTxt'];
function criarCtx(src, banco, opts) {
  opts = opts || {};
  const el = {};
  const campo = (k, v) => { el[k] = { value: v, innerHTML: '', style: {}, disabled: false }; };
  const ctx = {
    console: { log() {}, warn() {}, error() {} }, DEMO: false, Promise, Object, Array, String, JSON, Date, Number, Math, RegExp, URL, parseInt, isNaN, Error,
    setTimeout: (f, t) => setTimeout(f, t >= 20000 ? (opts.prazo || 2000) : t), clearTimeout,
    _TMA_CID: CID, equipes_disp: equipes, tipos_equipe: tipos, colaboradores: colabs,
    servicos: opts.servicosVazio ? [] : JSON.parse(JSON.stringify(servicosLinhas)),
    _relTmaFatPontoCache: null, toasts: [], xls: [],
    fmtD: d => String(d || '').split('-').reverse().join('/'),
    escHtml: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    progShowToast: (m, t) => ctx.toasts.push({ m: String(m), t }),
    dataHojeLocal: () => HOJE,
    parseJsonField: (v, d) => { if (v == null) return d; if (typeof v === 'string') { try { return JSON.parse(v); } catch (e) { return d; } } return v; },
    parseColabIds: v => (Array.isArray(v) ? v : []),
    pontoReNorm: re => String(re || '').replace(/^0+/, ''),
    exportarXLS: (nome, cab, linhas, titulo) => ctx.xls.push({ nome, cab, linhas, titulo }),
    SB: { url: 'https://banco.teste' },
  };
  ctx.document = { getElementById: k => el[k] || null, querySelector: () => null };
  ctx.el = el; ctx.campo = campo;
  // sbFetch / sbFetchAll com a mesma semântica dos wrappers (null em falha; sbFetchAll devolve parcial calado)
  ctx.sbFetch = (tab, o) => {
    o = o || {};
    let url = 'https://banco.teste/rest/v1/' + tab + '?select=' + (o.select || '*');
    (o.filters || []).forEach(f => { url += '&' + f; });
    if (o.order) url += '&order=' + o.order;
    url += '&limit=' + (o.limit || 1000);
    const r = banco.ler(url);
    if (r === 'timeout') return new Promise(() => {});
    if (r === 'rede' || r === 'erro') return Promise.resolve(null);
    if (r === 'inesperada') return Promise.resolve({ message: 'objeto' });
    return Promise.resolve(r);
  };
  ctx.sbFetchAll = async (tab, o) => {
    o = o || {}; let all = [], off = 0;
    for (;;) {
      let url = 'https://banco.teste/rest/v1/' + tab + '?select=*';
      (o.filters || []).forEach(f => { url += '&' + f; });
      url += '&order=' + (o.order || 'id.asc') + '&limit=1000&offset=' + off;
      const r = banco.ler(url);
      if (!Array.isArray(r) || !r.length) break;
      all = all.concat(r); if (r.length < 1000) break; off += 1000;
    }
    return all;
  };
  vm.createContext(ctx);
  const nomes = FUNCS.filter(n => temFn(src, n));
  let codigo = 'var REL_TMA_ALMOCO_MIN=60;\nvar _relTmaFatPontoCache=null;\n' + nomes.map(n => fnDe(src, n)).join('\n');
  const iniBloco = src.indexOf('// ── Horas Logadas e Faturamento — fontes do cálculo');
  if (iniBloco >= 0) codigo += '\n' + src.slice(iniBloco, src.indexOf('\nfunction renderRelatorio(', iniBloco));
  vm.runInContext(codigo, ctx);
  ['tma-fat-ini', 'tma-fat-fim', 'tma-fat-eq', 'tma-fat-tipo', 'tma-fat-status', 'tma-fat-visao', 'tma-fat-fonte'].forEach(k => campo(k, ''));
  campo('tma-fat-resultado', ''); campo('btn-fat-ponto-excel', ''); campo('tma-fat-desc', ''); campo('tma-fat-detalhe-eq', '');
  return ctx;
}
async function gerar(ctx, cfg) {
  ctx.el['tma-fat-ini'].value = cfg.ini || D1; ctx.el['tma-fat-fim'].value = cfg.fim || D3;
  ctx.el['tma-fat-eq'].value = cfg.eq || ''; ctx.el['tma-fat-tipo'].value = cfg.tipo || '';
  ctx.el['tma-fat-status'].value = cfg.status || ''; ctx.el['tma-fat-visao'].value = cfg.visao || 'detalhe';
  ctx.el['tma-fat-fonte'].value = cfg.fonte || 'ponto';
  ctx.el['tma-fat-resultado'].innerHTML = '';
  await ctx.relTmaFatPontoGerar();
  return ctx._relTmaFatPontoCache;
}
const linha = (cache, eq, data) => (cache.detalhes || []).find(r => r.equipe_id === eq && r.data === data);
const NOVAS_CHAVES = ['fonte', 'natureza', 'almoco_txt', 'almoco_criterio', 'minutos_conferir'];
const semNovas = r => { const o = Object.assign({}, r); NOVAS_CHAVES.forEach(k => delete o[k]); return o; };

(async () => {
  // ═══ 1. Ponto: idêntico à versão publicada (8.1.226) ═══
  if (!base) ok('commit base d79e8ea disponível', false);
  else {
    for (const visao of ['detalhe', 'total']) {
      const cb = criarCtx(base, criarBanco()); const cn = criarCtx(html, criarBanco());
      const a = await gerar(cb, { visao }); const b = await gerar(cn, { visao, fonte: 'ponto' });
      ok('Ponto [' + visao + ']: mesmas linhas da 8.1.226 (mesmos campos e valores)', JSON.stringify(a.detalhes) === JSON.stringify(b.detalhes.map(semNovas)), { a: a.detalhes.length, b: b.detalhes.length });
      ok('Ponto [' + visao + ']: mesmos totais por equipe', JSON.stringify(a.totais.map(t => [t.codigo, t.dias, t.min_log, t.valor, t.pend])) === JSON.stringify(b.totais.map(t => [t.codigo, t.dias, t.min_log, t.valor, t.pend])));
      ok('Ponto [' + visao + ']: mesmo total de horas e valor', a.totMin === b.totMin && a.totVal === b.totVal, [a.totMin, b.totMin, a.totVal, b.totVal]);
      const tabela = h => (h.match(/<table[\s\S]*<\/table>/) || [''])[0];
      ok('Ponto [' + visao + ']: tabela da tela idêntica', tabela(cb.el['tma-fat-resultado'].innerHTML) === tabela(cn.el['tma-fat-resultado'].innerHTML));
      ok('Ponto [' + visao + ']: tela informa fonte e valor/hora vigente', /Fonte: <b>Ponto dos colaboradores<\/b>/.test(cn.el['tma-fat-resultado'].innerHTML) && /sem histórico de preços/.test(cn.el['tma-fat-resultado'].innerHTML));
      cb.relTmaFatPontoExcel(); cn.relTmaFatPontoExcel();
      ok('Ponto [' + visao + ']: Excel com as mesmas colunas e linhas', JSON.stringify(cb.xls[0].cab) === JSON.stringify(cn.xls[0].cab) && JSON.stringify(cb.xls[0].linhas) === JSON.stringify(cn.xls[0].linhas) && cb.xls[0].nome === cn.xls[0].nome);
      ok('Ponto [' + visao + ']: título do Excel informa o valor/hora vigente', /sem histórico de preços/.test(cn.xls[0].titulo));
    }
    const bp = criarBanco(); const cn = criarCtx(html, bp);
    await gerar(cn, { fonte: 'ponto' });
    ok('Ponto: >1.000 linhas por janela lidas em todas as páginas (offset 1000 pedido)', bp.reqs.some(r => r.tab === 'ponto_registros' && /offset=1000/.test(r.url)) && cn._relTmaFatPontoCache.detalhes.length === 13, cn._relTmaFatPontoCache.detalhes.length);
  }

  // ═══ 2. Portaria ═══
  {
    const ctx = criarCtx(html, criarBanco());
    const c = await gerar(ctx, { fonte: 'portaria', fim: HOJE });
    const r = (eq, d) => linha(c, eq, d);
    let x = r(E.E1, D1);
    ok('Portaria: saída e retorno físico (9h30 brutas, 1h almoço por critério, 8h30)', x.status === 'Calculado' && x.minutos_brutos === 570 && x.minutos_almoco === 60 && x.minutos_logados === 510 && x.valor_dia === Math.round(8.5 * 254.34 * 100) / 100, x);
    ok('Portaria: almoço identificado como critério estimativo', x.almoco_criterio === 'estimativo' && /critério/.test(x.almoco_txt));
    x = r(E.E2, D1);
    ok('Portaria: encerramento administrativo não vira retorno (23:59 convencional ignorado)', x.status === 'Sem retorno físico (encerramento administrativo)' && !x.minutos_logados && !x.valor_dia, x);
    x = r(E.E5, HOJE);
    ok('Portaria: equipe ainda em campo (hoje)', x.status === 'Em campo' && !x.minutos_logados, x);
    x = r(E.E5, D1);
    ok('Portaria: saída sem retorno em dia passado = pendência', x.status === 'Sem retorno registrado' && !x.minutos_logados, x);
    x = r(E.E1, D2);
    ok('Portaria: múltiplas saídas somadas (4h + 3h = 7h), 1h de almoço por dia (não por intervalo) = 6h', x.status === 'Calculado' && x.minutos_brutos === 420 && x.minutos_almoco === 60 && x.minutos_logados === 360, x);
    x = r(E.E2, D2);
    ok('Portaria: sobrepostas pela união (08–14h = 6h), sem almoço por não passar de 6h', x.minutos_brutos === 360 && x.minutos_almoco === 0 && x.minutos_logados === 360 && x.obs.some(o => /sobrepostas/.test(o)), x);
    x = r(E.E1, D3);
    ok('Portaria: duplicado com retornos divergentes = pendente de conferência, sem escolher horário', x.status === 'Pendente de conferência' && !x.minutos_logados && !x.valor_dia && x.minutos_conferir > 0 && x.obs.some(o => /divergentes/.test(o)), x);
    x = r(E.E2, D3);
    ok('Portaria: duplicado coerente contado uma vez (08:00–17:05 = 9h05 → 8h05)', x.status === 'Calculado' && x.minutos_brutos === 545 && x.minutos_logados === 485 && x.obs.some(o => /duplicado/.test(o)), x);
    x = r(E.E3, D1);
    ok('Portaria: noturna atravessando a meia-noite fica no dia da saída (20h–05h = 9h → 8h)', x.status === 'Calculado' && x.minutos_brutos === 540 && x.minutos_logados === 480 && x.saida_data === D2, x);
    x = r(E.E3, D2);
    ok('Portaria: saída de madrugada vai para o turno noturno programado no dia anterior (5h, sem almoço)', x && x.status === 'Calculado' && x.minutos_logados === 300 && x.obs.some(o => /madrugada/.test(o)), x);
    x = r(E.E4, D1);
    ok('Portaria: duração > 16h sinalizada, preservada e fora do faturável', x.status === 'Duração superior a 16h — conferir' && x.minutos_conferir === 1500 && !x.minutos_logados && !x.valor_dia, x);
    x = r(E.E4, D2);
    ok('Portaria: parcial (válida + sem retorno) calcula só a válida e marca conferir', x.status === 'Calculado parcial — conferir' && x.minutos_logados === 480 && x.valor_dia === Math.round(8 * 243.39 * 100) / 100, x);
    x = r(E.E6, D2);
    ok('Portaria: equipe sem tipo = pendência, sem valor', x.status === 'Sem tipo de equipe' && !x.valor_dia, x);
    x = r(E.E6, D1);
    ok('Portaria: sem saída', x.status === 'Sem saída na Portaria', x);
    ok('Portaria: registro sem programação informado e fora do cálculo', c.info.semProgPortaria === 1 && !linha(c, E.E4, D3));
    ok('Portaria: equipe não confirmada fica fora', !linha(c, E.E1, HOJE));
    // conferência dos totais contra a origem (cálculo independente)
    // horas registradas (inclui a equipe sem tipo: horas valem, valor fica pendente — mesmo comportamento do Ponto)
    const esperado = 510 + 360 + 360 + 485 + 480 + 300 + 480 + 480;
    ok('Portaria: total de horas = soma independente dos casos válidos', c.totMin === esperado, [c.totMin, esperado]);
    const valorEsp = Math.round(8.5 * 254.34 * 100) / 100 + Math.round(6 * 254.34 * 100) / 100 * 2 + Math.round((485 / 60) * 254.34 * 100) / 100
      + Math.round(8 * 254.34 * 100) / 100 + Math.round(5 * 254.34 * 100) / 100 + Math.round(8 * 243.39 * 100) / 100;
    ok('Portaria: total de valor = soma independente (equipe sem tipo fora do valor)', Math.abs(c.totVal - valorEsp) < 0.05, [c.totVal, valorEsp]);
    ok('Portaria: "a conferir" separado do faturável', c.totConf === 1500 + linha(c, E.E1, D3).minutos_conferir);
    ctx.relTmaFatPontoExcel();
    const xl = ctx.xls[0];
    ok('Portaria: Excel detalhe com fonte, natureza, critério do almoço, a conferir e aviso de valor/hora',
      xl.cab[0] === 'Fonte' && xl.cab.includes('Critério do almoço') && xl.cab.includes('A conferir (fora do faturável)') && /sem histórico de preços/.test(xl.titulo) && xl.linhas.every(l => l[0] === 'Portaria (saídas e retornos)'), xl.cab);
    // filtros preservados
    const ctx2 = criarCtx(html, criarBanco());
    const c2 = await gerar(ctx2, { fonte: 'portaria', eq: E.E1 });
    ok('Portaria: filtro de equipe preservado', c2.detalhes.every(r => r.equipe_id === E.E1) && c2.detalhes.length === 3);
    const c3 = await gerar(criarCtx(html, criarBanco()), { fonte: 'portaria', tipo: 'MOTO' });
    ok('Portaria: filtro de tipo preservado', c3.detalhes.length === 2 && c3.detalhes.every(r => r.equipe_id === E.E4), c3.detalhes.map(r => r.codigo));
    const c4 = await gerar(criarCtx(html, criarBanco()), { fonte: 'portaria', status: 'Calculado' });
    ok('Portaria: filtro de status preservado', c4.detalhes.length && c4.detalhes.every(r => r.status === 'Calculado'));
    const ctx5 = criarCtx(html, criarBanco());
    const c5 = await gerar(ctx5, { fonte: 'portaria', visao: 'total' });
    ok('Portaria: visão total por equipe com coluna "A conferir"', c5.totais.length === 6 && /<th>A conferir<\/th>/.test(ctx5.el['tma-fat-resultado'].innerHTML), c5.totais.length);
  }

  // ═══ 3. Diário de Bordo ═══
  {
    const ctx = criarCtx(html, criarBanco());
    const c = await gerar(ctx, { fonte: 'diario' });
    const r = (eq, d) => linha(c, eq, d);
    let x = r(E.E1, D1);
    ok('Diário: almoço completo descontado uma vez (9h30 − 1h = 8h30)', x.status === 'Calculado' && x.minutos_brutos === 570 && x.minutos_almoco === 60 && x.minutos_logados === 510, x);
    x = r(E.E2, D1);
    ok('Diário: sem almoço registrado não presume desconto ("Almoço não registrado")', x.minutos_logados === 480 && x.minutos_almoco === 0 && x.almoco_txt === 'Almoço não registrado' && x.obs.some(o => /Almoço não registrado/.test(o)), x);
    x = r(E.E1, D2);
    ok('Diário: almoço incompleto não inventa 55 min — pendente de conferência', x.status === 'Pendente de conferência' && !x.minutos_logados && x.minutos_conferir === 540, x);
    x = r(E.E2, D2);
    ok('Diário: sessões duplicadas idênticas contadas uma vez (8h)', x.minutos_logados === 480 && x.obs.some(o => /duplicada/.test(o)), x);
    x = r(E.E1, D3);
    ok('Diário: sessões simultâneas pela união (08–17h = 9h)', x.minutos_brutos === 540 && x.minutos_logados === 540 && x.obs.some(o => /simultâneas/.test(o)), x);
    x = r(E.E2, D3);
    ok('Diário: sem logout em dia passado', x.status === 'Sem logout' && !x.minutos_logados, x);
    x = r(E.E3, D1);
    ok('Diário: noturna atravessando a meia-noite (9h no dia operacional)', x.minutos_logados === 540 && x.saida_data === D2, x);
    x = r(E.E4, D1);
    ok('Diário: duração > 16h fora do faturável e sinalizada', x.status === 'Duração superior a 16h — conferir' && x.minutos_conferir === 1500 && !x.valor_dia, x);
    x = r(E.E5, D1);
    ok('Diário: app gravou minutos diferentes — usa os horários e avisa', x.minutos_logados === 480 && x.obs.some(o => /App gravou/.test(o)), x);
    x = r(E.E4, D2);
    ok('Diário: sessões do PLPT também contam (6h)', x.minutos_logados === 360, x);
    x = r(E.E6, D1);
    ok('Diário: sem sessões = "Sem registro no Diário" (não usa a escala)', x.status === 'Sem registro no Diário' && !x.minutos_logados, x);
    ok('Diário: total = soma independente', c.totMin === 510 + 480 + 480 + 540 + 540 + 480 + 360, c.totMin);
  }

  // ═══ 4. Escala normal ═══
  {
    const ctx = criarCtx(html, criarBanco());
    const c = await gerar(ctx, { fonte: 'escala' });
    ok('Escala: 8h por equipe programada', c.detalhes.length === 13 && c.detalhes.filter(r => r.status === 'Estimativa pela escala').every(r => r.minutos_logados === 480));
    ok('Escala: identificada como estimativa (natureza e aviso na tela)', c.detalhes.every(r => r.natureza === 'Estimativa') && /não comprova presença/.test(ctx.el['tma-fat-resultado'].innerHTML) && /Horas estimadas/.test(ctx.el['tma-fat-resultado'].innerHTML));
    const x = linha(c, E.E4, D1);
    ok('Escala: valor = 8h × valor/hora do tipo', x.valor_dia === Math.round(8 * 243.39 * 100) / 100, x.valor_dia);
    ok('Escala: equipe sem tipo = pendência sem valor', linha(c, E.E6, D1).status === 'Sem tipo de equipe' && !linha(c, E.E6, D1).valor_dia);
    ctx.relTmaFatPontoExcel();
    ok('Escala: Excel marca natureza "Estimativa" e o aviso', ctx.xls[0].linhas.every(l => l[1] === 'Estimativa') && /estimativa/.test(ctx.xls[0].titulo));
  }

  // ═══ 5. Comparar fontes ═══
  {
    const ctx = criarCtx(html, criarBanco());
    const c = await gerar(ctx, { fonte: 'comparar' });
    const row = c.detalhes.find(r => r.equipe_id === E.E1 && r.data === D1);
    ok('Comparar: as quatro fontes lado a lado, cada uma com sua origem', row.ponto.fonte === 'ponto' && row.portaria.fonte === 'portaria' && row.diario.fonte === 'diario' && row.escala.fonte === 'escala');
    ok('Comparar: horas de cada fonte preservadas (Ponto 8h40, Portaria 8h30, Diário 8h30, Escala 8h)', row.ponto.minutos_logados === 520 && row.portaria.minutos_logados === 510 && row.diario.minutos_logados === 510 && row.escala.minutos_logados === 480, [row.ponto.minutos_logados, row.portaria.minutos_logados, row.diario.minutos_logados]);
    ok('Comparar: diferenças contra as 8h previstas e entre fontes', row.cmp.dif.ponto === 40 && row.cmp.dif.portaria === 30 && row.cmp.spread === 10 && !row.cmp.divergente, row.cmp);
    const row2 = c.detalhes.find(r => r.equipe_id === E.E1 && r.data === D2);
    ok('Comparar: fonte sem dado não é preenchida por outra (Diário pendente fica sem horas)', row2.diario.status === 'Pendente de conferência' && row2.cmp.dif.diario === null && row2.diario.minutos_logados == null);
    const row3 = c.detalhes.find(r => r.equipe_id === E.E2 && r.data === D2);
    ok('Comparar: divergência > 1h destacada (Ponto 5h × Portaria 6h × Diário 8h)', row3.cmp.divergente && row3.cmp.spread === 180, row3.cmp);
    ok('Comparar: valores de cada fonte presentes', row.ponto.valor_dia > 0 && row.portaria.valor_dia > 0 && row.diario.valor_dia > 0 && row.escala.valor_dia > 0);
    ok('Comparar: tela mostra pendências por fonte e aviso de valor/hora', /Diário: Pendente de conferência/.test(ctx.el['tma-fat-resultado'].innerHTML) && /sem histórico de preços/.test(ctx.el['tma-fat-resultado'].innerHTML));
    ctx.relTmaFatPontoExcel();
    const xl = ctx.xls[0];
    ok('Comparar: Excel com as 4 fontes (horas, valor, status, natureza), diferenças e pendências',
      xl.cab.includes('Ponto — horas') && xl.cab.includes('Portaria — valor completo') && xl.cab.includes('Portaria — valor parcial (a conferir)') && xl.cab.includes('Diário — status') && xl.cab.includes('Escala — natureza') && xl.cab.includes('Maior − menor (registradas)') && xl.linhas.filter(l => !/^TOTAL /.test(l[0])).length === c.detalhes.length, xl.cab);
    const ct = await gerar(criarCtx(html, criarBanco()), { fonte: 'comparar', visao: 'total' });
    ok('Comparar: visão total por equipe', ct.detalhes.length === 13 && ct.totais.ponto.min > 0);
  }

  // ═══ 6. Falhas de leitura: nada parcial ═══
  const CASOS = [
    ['Ponto: falha na 2ª página', 'ponto', r => r.tab === 'ponto_registros' && /offset=1000/.test(r.url) ? 'rede' : 'ok'],
    ['Ponto: resposta inesperada', 'ponto', r => r.tab === 'ponto_registros' && /offset=0/.test(r.url) ? 'inesperada' : 'ok'],
    ['Portaria: prazo esgotado', 'portaria', r => r.tab === 'frotas_portaria_saidas' ? 'timeout' : 'ok'],
    ['Diário: falha no PLPT', 'diario', r => r.tab === 'plpt_sessoes' ? 'erro' : 'ok'],
    ['Programação: falha', 'escala', r => r.tab === 'composicao_dia' ? 'rede' : 'ok'],
    ['Comparar: falha só no Diário', 'comparar', r => r.tab === 'sessoes_disponibilidade' ? 'erro' : 'ok'],
  ];
  for (const [nome, fonte, regra] of CASOS) {
    const banco = criarBanco(); banco.regra = regra;
    const ctx = criarCtx(html, banco, { prazo: 60 });
    await gerar(ctx, { fonte });
    const h = ctx.el['tma-fat-resultado'].innerHTML;
    ok('[' + nome + '] relatório não gerado, sem tabela parcial', /Relatório não gerado/.test(h) && !/<table/.test(h) && ctx._relTmaFatPontoCache === null, h.slice(0, 160));
    ok('[' + nome + '] mensagem diz a fonte e permite nova tentativa', /onclick="relTmaFatPontoGerar\(\)"/.test(h) && /Tentar de novo/.test(h));
    ok('[' + nome + '] Excel não exporta resultado parcial', (ctx.relTmaFatPontoExcel(), ctx.xls.length === 0));
    banco.regra = () => 'ok';
    await gerar(ctx, { fonte });
    ok('[' + nome + '] nova tentativa gera o relatório', !!ctx._relTmaFatPontoCache && /<table/.test(ctx.el['tma-fat-resultado'].innerHTML));
  }

  // ═══ 7. Valor/hora: tabela servicos_contrato, sem palpite ═══
  {
    const banco = criarBanco();
    const ctx = criarCtx(html, banco, { servicosVazio: true });
    const c = await gerar(ctx, { fonte: 'escala' });
    ok('Valor/hora: lê servicos_contrato (não mais a tabela inexistente "servicos")', banco.reqs.some(r => r.tab === 'servicos_contrato') && !banco.reqs.some(r => r.tab === 'servicos') && linha(c, E.E1, D1).valor_hora === 254.34);
    const b2 = criarBanco(); b2.regra = r => r.tab === 'servicos_contrato' ? 'rede' : 'ok';
    const c2x = criarCtx(html, b2, { servicosVazio: true });
    await gerar(c2x, { fonte: 'escala' });
    ok('Valor/hora: falha na leitura dos serviços não vira zero — relatório não gerado', /Relatório não gerado/.test(c2x.el['tma-fat-resultado'].innerHTML) && /serviços/.test(c2x.el['tma-fat-resultado'].innerHTML));
    const c3x = criarCtx(html, criarBanco());
    c3x.servicos.push({ id: 's9', contrato_id: CID, tipo_disp: 'FIORINO', descricao: 'FIORINO extra', valor_hora: 199.99, deleted_at: null });
    const c3 = await gerar(c3x, { fonte: 'escala' });
    ok('Valor/hora: dois valores possíveis = "Valor/hora ambíguo", sem valor', linha(c3, E.E1, D1).status === 'Valor/hora ambíguo' && !linha(c3, E.E1, D1).valor_dia, linha(c3, E.E1, D1));
  }

  // ═══ 8. Troca de fonte na tela ═══
  {
    const ctx = criarCtx(html, criarBanco());
    ctx.el['tma-fat-fonte'].value = 'portaria'; ctx.relTmaFatFonteMudou();
    ok('Tela: fonte Portaria troca a explicação e os status', /intervalos <b>reais/.test(ctx.el['tma-fat-desc'].innerHTML) && /Sem retorno físico/.test(ctx.el['tma-fat-status'].innerHTML) && /sem histórico de preços/.test(ctx.el['tma-fat-desc'].innerHTML));
    ctx.el['tma-fat-fonte'].value = 'comparar'; ctx.relTmaFatFonteMudou();
    ok('Tela: em Comparar o filtro de status fica desabilitado', ctx.el['tma-fat-status'].disabled === true);
  }

  // ═══ 10. Correções A (valor parcial separado) e B (Comparar = fonte isolada) ═══
  {
    const moedaNum = s => s ? Number(String(s).replace(/[^\d,]/g, '').replace(',', '.')) : 0;
    const r2 = v => Math.round(v * 100) / 100;
    const vF = m => r2((m / 60) * 254.34);
    const relTmaFmt = m => criarCtx(html, criarBanco()).relTmaFmtHhMm(m);
    const somaCol = (xl, nomeCol) => r2(xl.linhas.reduce((s, l) => s + moedaNum(l[xl.cab.indexOf(nomeCol)]), 0));
    // Portaria: completo, parcial e sem valor no mesmo período (cálculo independente)
    const ctx = criarCtx(html, criarBanco());
    const c = await gerar(ctx, { fonte: 'portaria', visao: 'detalhe' });
    const compEsp = r2(vF(510) + vF(360) + vF(360) + vF(485) + vF(480) + vF(300));
    const parcEsp = r2(8 * 243.39);
    ok('A1: Portaria — valor completo = soma independente dos dias sem pendência', Math.abs(c.resumo.valCompleto - compEsp) < 0.02, [c.resumo.valCompleto, compEsp]);
    ok('A1: Portaria — valor parcial separado (MOT301 15/09, R$ 1.947,12)', c.resumo.valParcial === parcEsp && c.resumo.diasParciais === 1, [c.resumo.valParcial, c.resumo.diasParciais]);
    ok('A1: total potencial = completo + parcial (sem duplicar)', Math.abs(c.resumo.valPotencial - r2(compEsp + parcEsp)) < 0.02 && Math.abs(c.totVal - c.resumo.valPotencial) < 0.01, [c.resumo.valPotencial, c.totVal]);
    const h = ctx.el['tma-fat-resultado'].innerHTML;
    ok('A1: tela com "Valor completo", "Valor parcial — a conferir" e "Total potencial (não consolidado)", sem "Faturamento est."',
      /Valor completo/.test(h) && /Valor parcial — a conferir/.test(h) && /Total potencial \(não consolidado\)/.test(h) && !/Faturamento est\./.test(h) && /não é faturamento consolidado/.test(h));
    const lp = linha(c, E.E4, D2);
    ok('A1: linha parcial continua identificada como parcial', lp.status === 'Calculado parcial — conferir' && lp.parcial === true);
    ok('A2: por dia — linha parcial só na coluna "Valor parcial (a conferir)"', /<th>Valor completo<\/th><th>Valor parcial \(a conferir\)<\/th>/.test(h) && h.indexOf('<td style="font-weight:600;color:#085041">—</td><td style="font-weight:600;color:#854F0B">R$ 1.947,12</td>') > 0);
    ctx.relTmaFatPontoExcel();
    const xd = ctx.xls[0];
    const ld = xd.linhas.find(l => l[3] === 'MOT301' && l[2] === '15/09/2026');
    ok('A2: Excel detalhe — parcial em coluna própria com situação "Parcial — a conferir"', ld[xd.cab.indexOf('Valor completo')] === '' && moedaNum(ld[xd.cab.indexOf('Valor parcial (a conferir)')]) === parcEsp && ld[xd.cab.indexOf('Situação do valor')] === 'Parcial — a conferir', ld);
    ok('A3: Excel detalhe — somas iguais às da tela (completo e parcial)', somaCol(xd, 'Valor completo') === c.resumo.valCompleto && somaCol(xd, 'Valor parcial (a conferir)') === c.resumo.valParcial, [somaCol(xd, 'Valor completo'), somaCol(xd, 'Valor parcial (a conferir)')]);
    // visão total por equipe
    const ctxT = criarCtx(html, criarBanco());
    const ct = await gerar(ctxT, { fonte: 'portaria', visao: 'total' });
    const mot = ct.totais.find(t => t.codigo === 'MOT301'), ebn = ct.totais.find(t => t.codigo === 'EBN101'), xyz = ct.totais.find(t => t.codigo === 'XYZ601');
    ok('A2: por equipe — MOT301 só parcial, EBN101 só completo', mot.res.valParcial === parcEsp && mot.res.valCompleto === 0 && ebn.res.valParcial === 0 && ebn.res.valCompleto === r2(vF(510) + vF(360)), [mot.res, ebn.res]);
    const hT = ctxT.el['tma-fat-resultado'].innerHTML;
    ok('A2: tabela por equipe com Horas sem valor/hora, Valor completo, Valor parcial e Total potencial', /<th>Horas sem valor\/hora<\/th><th>Valor completo<\/th><th>Valor parcial \(a conferir\)<\/th><th>Total potencial<\/th>/.test(hT));
    ctxT.relTmaFatPontoExcel();
    const xt = ctxT.xls[0];
    ok('A3: Excel total — somas iguais às da tela', somaCol(xt, 'Valor completo') === ct.resumo.valCompleto && somaCol(xt, 'Valor parcial (a conferir)') === ct.resumo.valParcial && somaCol(xt, 'Total potencial (não consolidado)') === ct.resumo.valPotencial,
      [somaCol(xt, 'Valor completo'), somaCol(xt, 'Valor parcial (a conferir)'), somaCol(xt, 'Total potencial (não consolidado)'), ct.resumo]);
    const hd = xt.linhas.reduce((s, l) => s + moedaNum(l[xt.cab.indexOf('Horas decimal')]), 0);
    ok('A3: Excel total — horas decimais iguais às da tela', Math.abs(hd - ct.totMin / 60) < 0.05 * xt.linhas.length, [hd, ct.totMin / 60]);
    // B5: equipe sem tipo — horas no total, à parte como "sem valor/hora", sem valor inventado
    ok('B5: sem tipo — horas no total da fonte e em "Horas sem valor/hora", valor zero não contado como válido',
      xyz.min_log === 480 && xyz.res.minSemValor === 480 && xyz.res.valPotencial === 0 && ct.resumo.minSemValor === 480 && ct.totMin === 510 + 360 + 360 + 485 + 480 + 300 + 480 + 480, [xyz, ct.resumo.minSemValor]);
    ok('B5: sem tipo — card "Horas sem valor/hora" na tela', /Horas sem valor\/hora<\/div><div[^>]*>8h00/.test(hT) || /Horas sem valor\/hora[\s\S]{0,120}8h00/.test(hT), hT.slice(0, 0));
    const l6 = xd.linhas.find(l => l[3] === 'XYZ601' && l[2] === '15/09/2026');
    ok('B5: sem tipo — pendência identificada no Excel (situação e observação)', l6[xd.cab.indexOf('Situação do valor')] === 'Sem valor/hora (pendente)' && /Sem tipo de equipe/.test(l6[xd.cab.indexOf('Observações')]) && l6[xd.cab.indexOf('Valor completo')] === '', l6);
    // B6: tipo sem valor/hora (MOTO DUPLA removido do cadastro) — inclusive no dia parcial
    const ctx6 = criarCtx(html, criarBanco());
    ctx6.servicos = ctx6.servicos.filter(s => s.tipo_disp !== 'MOTO DUPLA');
    const c6 = await gerar(ctx6, { fonte: 'portaria' });
    const x6 = linha(c6, E.E4, D2);
    ok('B6: sem valor/hora — horas preservadas, sem valor, parcial ainda identificado', x6.status === 'Sem valor hora cadastrado' && x6.minutos_logados === 480 && !x6.valor_dia && x6.parcial === true && x6.obs.some(o => /dia com cálculo parcial/.test(o)), x6);
    ok('B6: sem valor/hora — fora do valor parcial e somado em "Horas sem valor/hora"', c6.resumo.valParcial === 0 && c6.resumo.minSemValor === 480 + 480 && c6.totMin === c.totMin, [c6.resumo, c6.totMin]);
    // B7: pendentes sem cálculo ficam fora de qualquer valor
    const pendentes = c.detalhes.filter(r => !(r.minutos_logados > 0));
    ok('B7: registros pendentes sem cálculo fora dos valores e das horas sem valor', pendentes.length >= 5 && pendentes.every(r => !r.valor_dia && ctx.relTmaFatSituacaoValor(r) === 'sem_calculo') && linha(c, E.E1, D3).status === 'Pendente de conferência', pendentes.map(r => r.status));
    // B8: sem duplicidade — cada linha em exatamente um balde
    const baldes = c.detalhes.reduce((o, r) => { const s = ctx.relTmaFatSituacaoValor(r); o[s] = (o[s] || 0) + 1; return o; }, {});
    ok('B8: cada linha em uma só situação e soma linha a linha = completo + parcial', Object.values(baldes).reduce((a, b) => a + b, 0) === c.detalhes.length && Math.abs(c.detalhes.reduce((s, r) => s + Number(r.valor_dia || 0), 0) - (c.resumo.valCompleto + c.resumo.valParcial)) < 0.01, baldes);
    // Diário com dia parcial (sessão extra sem logout em 16/09)
    const bD = criarBanco({ sessoes: [sess(E.E1, D3, ms(D3, '18:00'), null, null, null, 0)] });
    const cD = await gerar(criarCtx(html, bD), { fonte: 'diario' });
    const xD = linha(cD, E.E1, D3);
    ok('A1: Diário — dia parcial separado do completo', xD.parcial === true && cD.resumo.valParcial === xD.valor_dia && xD.valor_dia > 0 && cD.resumo.valPotencial === r2(cD.resumo.valCompleto + cD.resumo.valParcial), [xD.status, xD.valor_dia, cD.resumo]);
    // B4: fonte isolada × Comparar — horas idênticas, com e sem filtros
    for (const cfg of [{}, { eq: E.E6 }, { tipo: 'FIORINO' }, { eq: E.E4 }]) {
      const cc = await gerar(criarCtx(html, criarBanco()), Object.assign({ fonte: 'comparar' }, cfg));
      for (const f of ['ponto', 'portaria', 'diario', 'escala']) {
        const ci = await gerar(criarCtx(html, criarBanco()), Object.assign({ fonte: f }, cfg));
        const porLinha = ci.detalhes.every(r => { const rc = cc.detalhes.find(x => x.equipe_id === r.equipe_id && x.data === r.data); return rc && rc[f].minutos_logados === r.minutos_logados; });
        ok('B4: ' + f + ' ' + JSON.stringify(cfg) + ' — Comparar com as mesmas horas da fonte isolada (total e por linha)', cc.totais[f].min === ci.totMin && porLinha && cc.totais[f].minSemValor === ci.resumo.minSemValor && cc.totais[f].valor === ci.resumo.valPotencial, [f, cc.totais[f].min, ci.totMin]);
      }
    }
    const ctxC = criarCtx(html, criarBanco());
    const cc = await gerar(ctxC, { fonte: 'comparar' });
    const hC = ctxC.el['tma-fat-resultado'].innerHTML;
    const somaTodas = f => cc.detalhes.reduce((s, r) => s + (r[f].minutos_logados || 0), 0);
    const somaCalc = f => cc.detalhes.reduce((s, r) => s + (r[f].valor_dia > 0 ? r[f].minutos_logados : 0), 0);
    ok('B4: caso do achado — horas da equipe sem tipo agora entram no total do Comparar (Ponto e Escala)',
      cc.totais.ponto.min === somaTodas('ponto') && cc.totais.ponto.min - somaCalc('ponto') === cc.totais.ponto.minSemValor && cc.totais.ponto.minSemValor > 0
      && cc.totais.escala.min === 13 * 480 && cc.totais.escala.minSemValor === 2 * 480, [cc.totais.ponto, cc.totais.escala]);
    const r6 = cc.detalhes.find(r => r.equipe_id === E.E6 && r.data === D1);
    ok('B5: Comparar — horas sem tipo aparecem na célula com "sem valor/hora"', r6.ponto.minutos_logados > 0 && r6.cmp.dif.ponto !== null && /sem valor\/hora/.test(hC));
    ok('A1: Comparar — Portaria com completo, parcial e potencial separados', cc.totais.portaria.valParcial === parcEsp && Math.abs(cc.totais.portaria.valCompleto - compEsp) < 0.02 && /Parcial — a conferir R\$ 1\.947,12/.test(hC));
    const somaFontes = ['ponto', 'portaria', 'diario', 'escala'].reduce((s, f) => s + cc.totais[f].min, 0);
    ok('B8: Comparar não soma as quatro fontes entre si', hC.indexOf(relTmaFmt(somaFontes)) < 0 && !/TOTAL GERAL/i.test(hC) && /não são somadas entre si/.test(hC), relTmaFmt(somaFontes));
    ctxC.relTmaFatPontoExcel();
    const xc = ctxC.xls[0];
    const totRows = xc.linhas.filter(l => /^TOTAL /.test(l[0]));
    ok('A3/B4: Excel do Comparar — um total por fonte (nunca somadas), iguais à tela', totRows.length === 4 && ['ponto', 'portaria', 'diario', 'escala'].every((f, i) => {
      const l = totRows[i], n = ctxC.REL_TMA_FAT_FONTES[f].curto;
      return l[xc.cab.indexOf(n + ' — horas')] === relTmaFmt(cc.totais[f].min) && moedaNum(l[xc.cab.indexOf(n + ' — valor parcial (a conferir)')]) === cc.totais[f].valParcial;
    }), totRows.map(l => l.filter(Boolean)));
    const lx6 = xc.linhas.find(l => l[1] === 'XYZ601' && l[0] === '14/09/2026');
    ok('B5: Excel do Comparar — horas sem valor com situação "Sem valor/hora (pendente)"', lx6[xc.cab.indexOf('Ponto — horas')] !== '' && lx6[xc.cab.indexOf('Ponto — situação do valor')] === 'Sem valor/hora (pendente)', lx6);
    // A9: Escala identificada como estimativa
    const ctxE = criarCtx(html, criarBanco());
    await gerar(ctxE, { fonte: 'escala' });
    ctxE.relTmaFatPontoExcel();
    const xe = ctxE.xls[0];
    ok('A9: Escala — situação "Estimativa" no Excel e "(estimativa)" no Comparar', xe.linhas.filter(l => l[xe.cab.indexOf('Situação do valor')] === 'Estimativa').length === 11 && /Escala \(estimativa\)/.test(hC));
    // A10: Ponto isolado sem nenhuma coluna ou card novo
    const ctxP = criarCtx(html, criarBanco());
    await gerar(ctxP, { fonte: 'ponto', visao: 'total' });
    const hP = ctxP.el['tma-fat-resultado'].innerHTML;
    ok('A10: Ponto sem colunas/cards de parcial ou potencial', !/Valor parcial|Total potencial|Horas sem valor\/hora|Valor completo/.test(hP) && /Faturamento est\./.test(hP));
  }

  // ═══ 9. Estático ═══
  ok('HTML: filtro "Fonte do cálculo" com Ponto como padrão', /<select class="inp" id="tma-fat-fonte"[^>]*onchange="relTmaFatFonteMudou\(\)">\s*<option value="ponto" selected>/.test(html));
  if (base) {
    const igual = n => fnDe(base, n) === fnDe(html, n);
    ok('Regra do Ponto e funções auxiliares inalteradas', ['relTmaCalcFatPontoDia', 'relTmaResolverIntervaloPonto', 'relTmaPontoEntradaSaida', 'relTmaPontoSaidaDiaSeguinte', 'relTmaValorHoraTipo', 'relTmaCompEstaProgramada'].every(igual));
    ok('Outros relatórios TMA inalterados (Tempo logado, S/N, leitura compartilhada)', ['relTmaHorasLogadas', 'relTmaSaidaSN', 'relTmaFetchPeriodoSessoes', 'relTmaMinutosSessao'].every(igual));
  }
  const iniB = html.indexOf('// ── Horas Logadas e Faturamento — fontes do cálculo');
  ok('ES5 no bloco novo', !/\blet\s|\bconst\s|=>|`/.test(html.slice(iniB, html.indexOf('\nfunction renderRelatorio(', iniB)).replace(/\/\/[^\n]*/g, '')));
  ok('Sem gravação: o bloco novo não chama sbInsert/sbUpdate/sbUpsert/sbDelete', !/sb(Insert|Update|Upsert|Delete)\(/.test(html.slice(iniB, html.indexOf('\nfunction renderRelatorio(', iniB))));

  if (falhas) { console.error('rel-tma-fontes-horas: FALHOU ' + falhas + '/' + total); process.exit(1); }
  console.log('rel-tma-fontes-horas: ' + total + ' verificações OK');
})().catch(e => { console.error(e); process.exit(1); });
