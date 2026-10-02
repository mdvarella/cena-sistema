'use strict';
// PORTARIA 8.1.187 — retorno gravado em cópia de saída já excluída no banco.
// 30/09: a migration excluiu as cópias abertas às 15:25; o tablet seguiu com a cópia no cache e registrou 16 retornos
// nelas (PATCH por id sem conferir deleted_at, 204 sem linha contava como gravado). A saída viva ficou "Em campo".
// 01/10 07:35: a deduplicação do app excluiu no banco a saída viva com retorno (RTQ7D65) porque a cópia velha venceu.
process.env.TZ = 'America/Sao_Paulo';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const off = fs.readFileSync(path.join(raiz, 'portaria-offline.js'), 'utf8').replace(/\r\n/g, '\n');
const sw = fs.readFileSync(path.join(raiz, 'sw.js'), 'utf8');
const failed = [];
let total = 0;
function ok(name, cond, detail) { total++; if (!cond) failed.push(name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }

function blocoEm(src, inicioRe) {
  const m = inicioRe.exec(src);
  if (!m) throw new Error('não encontrado: ' + inicioRe);
  const ini = m.index + 1;
  const re = /\n(?:async function |function |var |\/\*\*|\/\/|global\.|<\/script>)/g;
  re.lastIndex = ini + 5;
  const fim = re.exec(src);
  return src.slice(ini, fim ? fim.index : undefined);
}
const fnHtml = nome => blocoEm(html, new RegExp('\\n(?:async )?function ' + nome + '\\('));
const fnOff = nome => blocoEm(off, new RegExp('\\n(?:async )?function ' + nome + '\\('));
const esperar = ms => new Promise(r => setTimeout(r, ms));

// ─── Banco falso do PostgREST (frotas_portaria_saidas) ───
function filtrar(rows, filtros) {
  return rows.filter(r => filtros.every(f => {
    const [col, resto] = [f.slice(0, f.indexOf('=')), f.slice(f.indexOf('=') + 1)];
    const op = resto.slice(0, resto.indexOf('.')), val = decodeURIComponent(resto.slice(resto.indexOf('.') + 1));
    const v = r[col];
    if (op === 'eq') return String(v) === val;
    if (op === 'is') return val === 'null' ? (v == null) : true;
    if (op === 'in') return val.replace(/^\(|\)$/g, '').split(',').includes(String(v));
    if (op === 'gte') return new Date(v).getTime() >= new Date(val).getTime();
    if (op === 'lte') return new Date(v).getTime() <= new Date(val).getTime();
    if (op === 'lt') return new Date(v).getTime() < new Date(val).getTime();
    if (op === 'gt') return new Date(v).getTime() > new Date(val).getTime();
    throw new Error('filtro não suportado: ' + f);
  }));
}
function bancoFalso(linhas, opts) {
  opts = opts || {};
  const b = { linhas: linhas.map(l => Object.assign({}, l)), patches: [], fetches: [] };
  b.sbFetch = async (t, o) => {
    b.fetches.push(o.filters.slice());
    if (opts.fetchFalha && opts.fetchFalha(o)) return null;
    return filtrar(b.linhas, o.filters).map(r => Object.assign({}, r));
  };
  b.sbUpdate = async (t, data, filtro, o) => {
    b.patches.push({ data: Object.assign({}, data), filtro, opts: o });
    const mSimples = filtro.match(/^id=eq\.(.+)$/); // mesma trava do sbUpdate real
    if (mSimples && !isUUID(mSimples[1])) return false;
    if (opts.patchFalha) return false;
    const alvo = filtrar(b.linhas, filtro.split('&'));
    if (!opts.patchSemLinha) alvo.forEach(r => Object.assign(r, data));
    if (o && o.linhas) return opts.patchSemLinha ? [] : alvo.map(r => ({ id: r.id }));
    return true;
  };
  return b;
}

const EQ = 'e1d505db-f808-493d-bd82-271b3291ecd0';
const COPIA = '545e35fc-90e0-45ff-a4fe-e06bbd0719d3';
const VIVA = '357c4c09-e79e-4efa-bac5-57dbfe6090aa';
const OUTRA = '11111111-2222-4333-8444-555555555555';
const SAIDA_TS = '2026-09-30T07:26:15.511-03:00';
const L = (id, extra) => Object.assign({ id, placa: 'GGB8G11', equipe: 'EJN303', equipe_id: EQ, status: 'Em campo', km_saida: 42513, km_retorno: null, data_saida: SAIDA_TS, data_retorno: null, deleted_at: null }, extra || {});
const isUUID = s => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));

// ─── 1. Fila offline: portOffSyncRetorno ───
function ctxRetorno(banco, frt) {
  const ctx = {
    console: { log() {}, warn() {}, error() {} }, Promise, Math, String, Object, Array, JSON, Date, isNaN, encodeURIComponent,
    frt_portaria: frt || [],
    isUUID, sbFetch: banco.sbFetch, sbUpdate: banco.sbUpdate,
    async portOffGetEvent() { return null; },
    async portOffFetchPorEventId() { return null; },
    async portOffRestaurarFotos() { return {}; },
    async portOffApagarFotos() {},
    portOffColunaAusente: () => true,
    portOffMarcarMemoriaConflito(sid) { ctx.conflito = sid; },
  };
  vm.createContext(ctx);
  vm.runInContext(['portOffSaidaVivaEquivalente', 'portOffTrocarIdMemoria', 'portOffSyncRetorno'].map(fnOff).join('\n'), ctx);
  return ctx;
}
const evRet = sid => ({ event_id: 'ev-ret-1', tipo_evento: 'RETORNO', status_sync: 'SINCRONIZANDO', payload: { saida_id: sid, placa: 'GGB8G11', km_retorno: 42600, data_retorno: '2026-09-30T17:46:13.354-03:00', retorno_registrado_por: 'Portaria Coaquira 1', fotos: {} } });
async function rodar(ctx, ev) { try { await ctx.portOffSyncRetorno(ev); return null; } catch (e) { return e.message; } }

async function testesFila() {
  // Caso normal: saída viva e aberta
  let b = bancoFalso([L(VIVA)]);
  let c = ctxRetorno(b, [L(VIVA, { status: 'Retornado', _sync_status: 'PENDENTE' })]);
  let ev = evRet(VIVA);
  let erro = await rodar(c, ev);
  ok('fila: saída viva → sincroniza', erro === null && ev.status_sync === 'SINCRONIZADO', erro);
  ok('fila: PATCH só em linha viva e sem retorno, pedindo as linhas', b.patches.length === 1 && b.patches[0].filtro === 'deleted_at=is.null&data_retorno=is.null&id=eq.' + VIVA && b.patches[0].opts && b.patches[0].opts.linhas === true, b.patches);
  ok('fila: banco recebe o retorno', b.linhas[0].status === 'Retornado' && b.linhas[0].km_retorno === 42600);
  ok('fila: memória marcada sincronizada', c.frt_portaria[0]._sync_status === 'SINCRONIZADO');

  // GGB8G11 30/09: tablet com a cópia excluída → grava na viva equivalente
  b = bancoFalso([L(COPIA, { deleted_at: '2026-09-30T07:56:21-03:00' }), L(VIVA)]);
  c = ctxRetorno(b, [L(COPIA, { status: 'Retornado', _sync_status: 'PENDENTE' })]);
  ev = evRet(COPIA);
  erro = await rodar(c, ev);
  const viva = b.linhas.find(r => r.id === VIVA), copia = b.linhas.find(r => r.id === COPIA);
  ok('cópia excluída: sincroniza na viva', erro === null && ev.status_sync === 'SINCRONIZADO', erro);
  ok('cópia excluída: retorno vai para a viva', viva.status === 'Retornado' && viva.km_retorno === 42600 && viva.data_retorno === ev.payload.data_retorno, viva);
  ok('cópia excluída: cópia não é tocada', copia.status === 'Em campo' && copia.km_retorno === null);
  ok('cópia excluída: nenhum PATCH na cópia', b.patches.every(p => !p.filtro.includes(COPIA)), b.patches.map(p => p.filtro));
  ok('cópia excluída: evento passa a apontar a viva e guarda a excluída', ev.payload.saida_id === VIVA && ev.payload.saida_id_excluida === COPIA, ev.payload);
  ok('cópia excluída: memória troca o id para a viva', c.frt_portaria.length === 1 && c.frt_portaria[0].id === VIVA && c.frt_portaria[0]._sync_status === 'SINCRONIZADO', c.frt_portaria);
  ok('cópia excluída: busca da equivalente por placa, viva e ±2 min', b.fetches.some(f => f.includes('placa=eq.GGB8G11') && f.includes('deleted_at=is.null') && f.some(x => x.startsWith('data_saida=gte.')) && f.some(x => x.startsWith('data_saida=lte.'))), b.fetches);

  // Memória com a viva e a cópia: a cópia sai, a viva fica
  b = bancoFalso([L(COPIA, { deleted_at: '2026-09-30T15:25:13-03:00' }), L(VIVA)]);
  c = ctxRetorno(b, [L(COPIA, { status: 'Retornado', _sync_status: 'PENDENTE' }), L(VIVA)]);
  erro = await rodar(c, evRet(COPIA));
  ok('cópia + viva na memória: fica só a viva retornada', erro === null && c.frt_portaria.length === 1 && c.frt_portaria[0].id === VIVA && c.frt_portaria[0].status === 'Retornado', c.frt_portaria);

  // Sem equivalente: nada gravado, erro visível
  b = bancoFalso([L(COPIA, { deleted_at: '2026-09-30T15:25:13-03:00' })]);
  c = ctxRetorno(b, []);
  ev = evRet(COPIA);
  erro = await rodar(c, ev);
  ok('sem viva equivalente: erro, nada gravado', erro && /excluída no servidor \(nenhuma saída equivalente\)/.test(erro) && b.patches.length === 0, erro);

  // Duas equivalentes: não escolhe sozinho
  b = bancoFalso([L(COPIA, { deleted_at: '2026-09-30T15:25:13-03:00' }), L(VIVA), L(OUTRA, { data_saida: '2026-09-30T07:27:00-03:00' })]);
  erro = await rodar(ctxRetorno(b, []), evRet(COPIA));
  ok('duas equivalentes: erro, nada gravado', erro && /mais de uma saída equivalente/.test(erro) && b.patches.length === 0, erro);

  // Equivalente de outra equipe: não serve
  b = bancoFalso([L(COPIA, { deleted_at: '2026-09-30T15:25:13-03:00' }), L(VIVA, { equipe_id: '738bd447-981d-41d7-ac8b-e7649c4a5d0d' })]);
  erro = await rodar(ctxRetorno(b, []), evRet(COPIA));
  ok('viva de outra equipe: erro, nada gravado', erro && /nenhuma saída equivalente/.test(erro) && b.patches.length === 0, erro);

  // Equivalente fora da janela de 2 min: não serve
  b = bancoFalso([L(COPIA, { deleted_at: '2026-09-30T15:25:13-03:00' }), L(VIVA, { data_saida: '2026-09-30T07:30:00-03:00' })]);
  erro = await rodar(ctxRetorno(b, []), evRet(COPIA));
  ok('viva 4 min depois: não é equivalente', erro && /nenhuma saída equivalente/.test(erro) && b.patches.length === 0, erro);

  // Equivalente já retornada: conflito, nada gravado
  b = bancoFalso([L(COPIA, { deleted_at: '2026-09-30T15:25:13-03:00' }), L(VIVA, { status: 'Retornado', data_retorno: '2026-10-01T05:17:48-03:00', km_retorno: 1 })]);
  c = ctxRetorno(b, []);
  ev = evRet(COPIA);
  erro = await rodar(c, ev);
  ok('viva já retornada: CONFLITO sem gravar', erro === null && ev.status_sync === 'CONFLITO' && b.patches.length === 0 && c.conflito === VIVA, { erro, st: ev.status_sync });

  // Leitura da equivalente falhou: tenta depois, nada gravado
  b = bancoFalso([L(COPIA, { deleted_at: '2026-09-30T15:25:13-03:00' }), L(VIVA)], { fetchFalha: o => o.filters.some(f => f.startsWith('placa=')) });
  erro = await rodar(ctxRetorno(b, []), evRet(COPIA));
  ok('leitura da equivalente falhou: erro, nada gravado', erro && /leitura falhou/.test(erro) && b.patches.length === 0, erro);

  // PATCH 2xx sem linha alterada (ex.: excluída entre a leitura e o PATCH): não conta como gravado
  b = bancoFalso([L(VIVA)], { patchSemLinha: true });
  c = ctxRetorno(b, []);
  ev = evRet(VIVA);
  erro = await rodar(c, ev);
  ok('PATCH sem linha: não sincroniza', erro && /não alterou nenhuma saída/.test(erro) && ev.status_sync !== 'SINCRONIZADO', erro);

  b = bancoFalso([L(VIVA)], { patchSemLinha: true });
  const origFetch = b.sbFetch;
  let leituras = 0;
  b.sbFetch = async (t, o) => { leituras++; const r = await origFetch(t, o); if (leituras > 1) r.forEach(x => { x.deleted_at = '2026-10-01T10:00:00Z'; }); return r; };
  erro = await rodar(ctxRetorno(b, []), evRet(VIVA));
  ok('PATCH sem linha e saída excluída no meio: erro para tentar de novo', erro && /excluída no servidor durante o envio/.test(erro), erro);

  b = bancoFalso([L(VIVA)], { patchSemLinha: true });
  const f2 = b.sbFetch;
  let l2 = 0;
  b.sbFetch = async (t, o) => { l2++; const r = await f2(t, o); if (l2 > 1) r.forEach(x => { x.data_retorno = '2026-09-30T18:00:00-03:00'; x.status = 'Retornado'; }); return r; };
  ev = evRet(VIVA);
  erro = await rodar(ctxRetorno(b, []), ev);
  ok('PATCH sem linha e retorno de outro tablet: CONFLITO', erro === null && ev.status_sync === 'CONFLITO', { erro, st: ev.status_sync });

  b = bancoFalso([L(VIVA)], { patchFalha: true });
  ev = evRet(VIVA);
  erro = await rodar(ctxRetorno(b, []), ev);
  ok('PATCH recusado 3x: erro', erro && /não confirmou o retorno/.test(erro) && b.patches.length === 3 && b.patches.every(p => p.filtro === 'deleted_at=is.null&data_retorno=is.null&id=eq.' + VIVA), erro);
}

// ─── 2. sbUpdate com opts.linhas ───
async function testesSbUpdate() {
  const chamadas = [];
  let resposta = { ok: true, status: 200, json: [{ id: VIVA }], text: '' };
  const ctx = {
    console: { log() {}, warn() {}, error() {} }, JSON, Object, Array, String, window: {},
    DEMO: false, SB: { url: 'https://x.supabase.co' }, isUUID,
    _auditAuto() { ctx.audit = (ctx.audit || 0) + 1; },
    async cenaAuthAuthorizedFetch(url, fo) { chamadas.push({ url, prefer: fo.headers.Prefer }); return resposta; },
  };
  vm.createContext(ctx);
  vm.runInContext(fnHtml('sbUpdate'), ctx);
  const filtro = 'deleted_at=is.null&data_retorno=is.null&id=eq.' + VIVA;
  let r = await ctx.sbUpdate('frotas_portaria_saidas', { status: 'Retornado' }, filtro, { linhas: true });
  ok('sbUpdate linhas: devolve as linhas alteradas', Array.isArray(r) && r.length === 1 && r[0].id === VIVA, r);
  ok('sbUpdate linhas: pede representation só do id', chamadas[0] && chamadas[0].prefer === 'return=representation' && chamadas[0].url.endsWith('&id=eq.' + VIVA + '&select=id'), chamadas[0]);
  r = await ctx.sbUpdate('frotas_portaria_saidas', { status: 'Retornado' }, 'id=eq.' + VIVA + '&deleted_at=is.null', { linhas: true });
  ok('sbUpdate: filtro começando com id=eq. e com mais condições continua recusado (por isso o id vai por último)', r === false && chamadas.length === 1, chamadas.length);
  resposta = { ok: true, status: 200, json: [], text: '[]' };
  ctx.audit = 0;
  r = await ctx.sbUpdate('frotas_portaria_saidas', { status: 'Retornado' }, filtro, { linhas: true });
  ok('sbUpdate linhas: nenhuma linha → [] e sem auditoria', Array.isArray(r) && r.length === 0 && ctx.audit === 0, r);
  resposta = { ok: true, status: 204, json: null, text: '' };
  r = await ctx.sbUpdate('frotas_portaria_saidas', { status: 'Retornado' }, 'id=eq.' + VIVA);
  ok('sbUpdate sem opção: continua minimal e true', r === true && chamadas[2] && chamadas[2].prefer === 'return=minimal' && !chamadas[2].url.includes('select=id'), chamadas[2]);
  resposta = { ok: false, status: 400, json: null, text: 'erro' };
  r = await ctx.sbUpdate('frotas_portaria_saidas', { status: 'Retornado' }, 'id=eq.' + VIVA, { linhas: true });
  ok('sbUpdate linhas: erro HTTP → false', r === false);
}

// ─── 3. Funções da Portaria no index.html (todas as port*) ───
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
function ctxPort(frt, banco) {
  const c = {
    console: { log() {}, warn() {}, error() {} }, Object, String, Number, Array, Date, isNaN, parseInt, parseFloat, Math, JSON, RegExp, Promise,
    DEMO: false, window: {}, document: { getElementById: () => null, hidden: false },
    equipes_disp: [{ id: EQ, codigo: 'EJN303' }], equipes: [], composicao_dia: [],
    frt_portaria: frt || [],
    dataHojeLocal: () => '2026-09-30',
    isUUID,
    sbFetch: banco.sbFetch, sbUpdate: banco.sbUpdate,
    portEstaEmCampo: p => !!p && !p.deleted_at && p.status !== 'Cancelado' && p.status !== 'Retornado' && !p.data_retorno && p.status === 'Em campo',
    portOffIsOnline: () => true,
  };
  vm.createContext(c);
  vm.runInContext('var PORT_CONFERIR_SAIDAS_MS = 60000; var _portSaidasExcluidasServidor = {}; var _portConferirSaidas = { emCurso:null, ultima:0 }; var _portClonesSuprimidos={};', c);
  for (const b of BLOCOS) { try { vm.runInContext(b, c); } catch (e) { /* bloco que depende de estado de topo */ } }
  c.portEstaEmCampo = p => !!p && !p.deleted_at && p.status !== 'Cancelado' && p.status !== 'Retornado' && !p.data_retorno && p.status === 'Em campo';
  return c;
}

async function testesDedup() {
  // Vencedora viva no servidor e cópia aberta: exclui a cópia com filtro protegido
  let b = bancoFalso([L(VIVA), L(COPIA)]);
  let c = ctxPort([], b);
  c.portSuprimirCloneSaida(L(COPIA), L(VIVA));
  await esperar(10);
  ok('dedup: vencedora viva → exclui a cópia só se aberta', b.patches.length === 1 && b.patches[0].filtro === 'deleted_at=is.null&data_retorno=is.null&id=eq.' + COPIA && !!b.linhas.find(r => r.id === COPIA).deleted_at, b.patches);

  // RTQ7D65: a vencedora da memória é a cópia já excluída no servidor → não exclui a viva
  b = bancoFalso([L(VIVA, { status: 'Retornado', data_retorno: '2026-09-30T21:49:38-03:00' }), L(COPIA, { deleted_at: '2026-09-30T15:25:13-03:00' })]);
  c = ctxPort([], b);
  c.portSuprimirCloneSaida(L(VIVA), L(COPIA));
  await esperar(10);
  ok('dedup: vencedora excluída no servidor → nada excluído', b.patches.length === 0 && b.linhas.find(r => r.id === VIVA).deleted_at === null, b.patches);

  // Cópia com retorno no servidor nunca é excluída (filtro data_retorno=is.null)
  b = bancoFalso([L(VIVA), L(COPIA, { status: 'Retornado', data_retorno: '2026-09-30T17:00:00-03:00' })]);
  c = ctxPort([], b);
  c.portSuprimirCloneSaida(L(COPIA), L(VIVA));
  await esperar(10);
  ok('dedup: cópia com retorno no servidor continua viva', b.linhas.find(r => r.id === COPIA).deleted_at === null, b.linhas);

  // Sem vencedora identificável: não toca no banco
  b = bancoFalso([L(COPIA)]);
  c = ctxPort([], b);
  c.portSuprimirCloneSaida(L(COPIA), null);
  c.portSuprimirCloneSaida(L(OUTRA), { id: 'tmp_1' });
  await esperar(10);
  ok('dedup: sem vencedora com UUID → nada no banco', b.patches.length === 0 && b.fetches.length === 0);

  // portDedupSaidasMemoria passa a vencedora
  b = bancoFalso([L(VIVA), L(COPIA)]);
  c = ctxPort([L(VIVA, { tipo_liberacao: 'equipe' }), L(COPIA)], b);
  c.portDedupSaidasMemoria();
  await esperar(10);
  ok('dedup memória: funde numa só', c.frt_portaria.length === 1, c.frt_portaria.map(p => p.id));
  ok('dedup memória: confere a vencedora antes de excluir', b.fetches.length === 1 && b.fetches[0].includes('id=eq.' + c.frt_portaria[0].id), b.fetches);
}

async function testesConferencia() {
  const PEND = '22222222-3333-4444-8555-666666666666';
  const RET = '33333333-4444-4555-8666-777777777777';
  const b = bancoFalso([
    L(COPIA, { deleted_at: '2026-09-30T15:25:13-03:00' }),
    L(RET, { placa: 'TTD8A68', data_saida: '2026-09-30T12:00:21-03:00', status: 'Retornado', data_retorno: '2026-09-30T21:07:34-03:00', km_retorno: 33398, retorno_registrado_por: 'Portaria Coaquira 1' }),
  ]);
  const c = ctxPort([
    L(COPIA),
    L(RET, { placa: 'TTD8A68', data_saida: '2026-09-30T12:00:21-03:00' }),
    L(PEND, { placa: 'NOVA001', _sync_status: 'PENDENTE' }),
    L('local-1', { placa: 'LOC0001' }),
  ], b);
  const r = await c.portConferirSaidasMemoria({ forcar: true });
  ok('conferência: cópia excluída sai da memória', !c.frt_portaria.some(p => p.id === COPIA) && r.excluidas === 1, r);
  ok('conferência: retorno do servidor entra na memória', (() => { const p = c.frt_portaria.find(x => x.id === RET); return p && p.status === 'Retornado' && p.km_retorno === 33398 && p.data_retorno === '2026-09-30T21:07:34-03:00'; })() && r.atualizadas === 1, c.frt_portaria);
  ok('conferência: saída pendente do tablet não é consultada nem removida', c.frt_portaria.some(p => p.id === PEND) && !b.fetches.some(f => f.join().includes(PEND)));
  ok('conferência: id local (não UUID) fica', c.frt_portaria.some(p => p.id === 'local-1'));
  ok('conferência: uma leitura por id=in', b.fetches.length === 1 && b.fetches[0][0].startsWith('id=in.('), b.fetches);
  c.portMesclarSaidas([L(COPIA)]);
  ok('conferência: cópia excluída não volta pelo cache', !c.frt_portaria.some(p => p.id === COPIA));
  const r2 = await c.portConferirSaidasMemoria();
  ok('conferência: sem forçar respeita o intervalo', r2.excluidas === 0 && b.fetches.length === 1);

  // Leitura falhou: nada muda
  const b2 = bancoFalso([L(COPIA, { deleted_at: 'x' })], { fetchFalha: () => true });
  const c2 = ctxPort([L(COPIA)], b2);
  const r3 = await c2.portConferirSaidasMemoria({ forcar: true });
  ok('conferência: leitura falhou → memória intacta', c2.frt_portaria.length === 1 && r3.excluidas === 0);
  // Não encontrada no servidor (pode ser saída ainda não enviada): fica
  const b3 = bancoFalso([]);
  const c3 = ctxPort([L(COPIA)], b3);
  await c3.portConferirSaidasMemoria({ forcar: true });
  ok('conferência: não encontrada no servidor → fica', c3.frt_portaria.length === 1);
}

async function testesCenario() {
  // Tablet reabre com a cópia velha no cache; o servidor só devolve a viva.
  const b = bancoFalso([L(COPIA, { deleted_at: '2026-09-30T15:25:13-03:00' }), L(VIVA, { tipo_liberacao: 'equipe' })]);
  const c = ctxPort([L(COPIA)], b);
  c.portMesclarSaidas(b.linhas.filter(r => !r.deleted_at).map(r => Object.assign({}, r)));
  await esperar(10);
  ok('cenário: deduplicação não exclui a viva no banco', b.linhas.find(r => r.id === VIVA).deleted_at === null, b.linhas);
  await c.portConferirSaidasMemoria({ forcar: true });
  c.portMesclarSaidas(b.linhas.filter(r => !r.deleted_at).map(r => Object.assign({}, r)));
  const mem = c.frt_portaria.filter(p => p.placa === 'GGB8G11');
  ok('cenário: depois da conferência a memória fica só com a viva', mem.length === 1 && mem[0].id === VIVA, mem.map(p => p.id));
}

async function testesEnsure() {
  // portEnsureDadosPortariaDia: cópia excluída na memória → conferência remove e relê o dia
  const b = bancoFalso([L(COPIA, { deleted_at: '2026-09-30T15:25:13-03:00' }), L(VIVA, { tipo_liberacao: 'equipe' })]);
  const c = ctxPort([L(COPIA)], b);
  c.portOffSnapshotCache = () => { c.snapshot = c.frt_portaria.map(p => p.id); };
  let erro = null;
  try { await c.portEnsureDadosPortariaDia('2026-09-30'); } catch (e) { erro = e.message; }
  const mem = c.frt_portaria.filter(p => p.placa === 'GGB8G11');
  ok('carga do dia: termina sem erro', erro === null, erro);
  ok('carga do dia: memória com a viva, sem a cópia', mem.length === 1 && mem[0].id === VIVA, mem.map(p => p.id));
  ok('carga do dia: cache gravado depois da conferência (sem a cópia)', Array.isArray(c.snapshot) && !c.snapshot.includes(COPIA), c.snapshot);
}

(async () => {
  await testesFila();
  await testesSbUpdate();
  await testesDedup();
  await testesConferencia();
  await testesCenario();
  await testesEnsure();
  ok('polling da Portaria chama a conferência', /portConferirSaidasMemoria\(\)\.then\(portAposConferirSaidas\)/.test(fnHtml('portSyncProgRodar')));
  ok('carga do dia confere antes do cache do tablet', /portConferirSaidasMemoria\(\{forcar:true\}\)[\s\S]*portOffSnapshotCache/.test(fnHtml('portEnsureDadosPortariaDia')));
  ok('retorno sem fila offline: filtro protegido', /'deleted_at=is\.null&data_retorno=is\.null&id=eq\.'\+idDb,\{linhas:true\}/.test(fnHtml('portAbrirVistoriaRetorno')));
  ok('versão: log 8.1.187', html.includes("{v:'8.1.187'"));
  ok('versão: tag portaria-offline.js a partir de 8.1.187', +((html.match(/portaria-offline\.js\?v=8\.1\.(\d+)/) || [])[1] || 0) >= 187);
  const numAtual = (html.match(/numero:\s*'([\d.]+)'/) || [])[1];
  ok('versão: sw.js acompanha', !!numAtual && sw.includes("SW_VERSION   = 'cena-" + numAtual + "'"), numAtual);
  if (failed.length) {
    console.error('FALHAS (' + failed.length + '/' + total + '):\n - ' + failed.join('\n - '));
    process.exit(1);
  }
  console.log('portaria-retorno-copia-excluida: ' + total + ' verificações OK');
})().catch(e => { console.error(e); process.exit(1); });
