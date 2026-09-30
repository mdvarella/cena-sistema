'use strict';
// PORTARIA 8.1.173 — cada liberação gravava a saída duas vezes: duas passadas da fila offline rodavam juntas
// (timer 0 ms + chamada direta) e a segunda caía na tentativa "mini" sem id, criando cópia sem modelo/tipo.
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
  const re = /\n(?:async function |function |var |\/\*\*|\/\/|global\.)/g;
  re.lastIndex = ini + 5;
  const fim = re.exec(src);
  return src.slice(ini, fim ? fim.index : undefined);
}
const fnHtml = nome => blocoEm(html, new RegExp('\\n(?:async )?function ' + nome + '\\('));
const fnOff = nome => blocoEm(off, new RegExp('\\n(?:async )?function ' + nome + '\\('));
const esperar = ms => new Promise(r => setTimeout(r, ms));

// ─── 1. Fila offline: uma passada por vez ──────────────────────────────────
function ctxFila(eventos) {
  const ctx = {
    console, Promise, Math, String, Object, Array, JSON,
    document: { getElementById: () => null },
    PORT_OFF_RETRY: [0, 4000],
    _syncing: false, _syncDeNovo: false, _backoffIdx: 0,
    eventos,
    enviados: [], agendados: 0,
    portOffRenderIndicador() {},
    async portOffProbe() { await esperar(15); return true; },
    portOffSessaoOk: () => true,
    async portOffListEvents() { await esperar(5); return ctx.eventos.map(e => Object.assign({}, e)); },
    portOffOrdenarFila: l => l,
    async portOffSyncUm(ev) {
      ctx.enviados.push(ev.event_id);
      await esperar(30);
      const orig = ctx.eventos.find(e => e.event_id === ev.event_id);
      if (orig) orig.status_sync = 'SINCRONIZADO';
    },
    async portOffLimparCacheSincronizado() {},
    async portOffContagem() { return { pendente: ctx.eventos.filter(e => e.status_sync === 'PENDENTE').length, erro: 0 }; },
    portOffAgendarSync() { ctx.agendados++; },
  };
  vm.createContext(ctx);
  vm.runInContext(fnOff('portOffSyncPendentes'), ctx);
  return ctx;
}

async function testesFila() {
  const c = ctxFila([{ event_id: 'ev-saida-1', tipo_evento: 'SAIDA', status_sync: 'PENDENTE' }]);
  // Mesmo padrão de portOffRegistrarSaida: timer 0 ms (portOffAgendarSync) + chamada direta.
  await Promise.all([c.portOffSyncPendentes(), c.portOffSyncPendentes(), esperar(0).then(() => c.portOffSyncPendentes())]);
  await esperar(80);
  ok('fila: saída enviada uma única vez com chamadas simultâneas', c.enviados.length === 1 && c.enviados[0] === 'ev-saida-1', c.enviados);
  ok('fila: trava liberada ao final', c._syncing === false);
  ok('fila: pedido durante a passada reagenda', c.agendados >= 1, c.agendados);

  // Nova saída enfileirada durante a passada é enviada depois (não fica esquecida)
  const c2 = ctxFila([{ event_id: 'ev-a', tipo_evento: 'SAIDA', status_sync: 'PENDENTE' }]);
  c2.portOffAgendarSync = function () { c2.agendados++; setTimeout(() => c2.portOffSyncPendentes(), 0); };
  const p = c2.portOffSyncPendentes();
  await esperar(25);
  c2.eventos.push({ event_id: 'ev-b', tipo_evento: 'SAIDA', status_sync: 'PENDENTE' });
  c2.portOffSyncPendentes();
  await p;
  await esperar(150);
  ok('fila: evento que chegou durante a passada é enviado na seguinte', c2.enviados.join(',') === 'ev-a,ev-b', c2.enviados);

  // Sem internet: não trava a fila
  const c3 = ctxFila([{ event_id: 'ev-x', tipo_evento: 'SAIDA', status_sync: 'PENDENTE' }]);
  c3.portOffProbe = async () => false;
  await c3.portOffSyncPendentes();
  ok('fila: offline não envia e libera a trava', c3.enviados.length === 0 && c3._syncing === false);

  // Exceção inesperada não deixa a trava presa
  const c4 = ctxFila([]);
  c4.portOffListEvents = async () => { throw new Error('idb'); };
  try { await c4.portOffSyncPendentes(); } catch (e) { /* esperado */ }
  ok('fila: erro no IndexedDB libera a trava', c4._syncing === false);

  const corpo = fnOff('portOffSyncPendentes');
  const iTrava = corpo.indexOf('_syncing=true;');
  ok('fila: trava ligada antes do primeiro await', iTrava > 0 && iTrava < corpo.indexOf('await '));
}

// ─── 2. portInsertSaidaDB: nunca cria cópia ────────────────────────────────
function ctxInsert(opts) {
  const banco = [];
  const ctx = {
    console: { log() {}, warn() {}, error() {} }, Promise, Math, String, Object, Array, JSON,
    crypto: { randomUUID: () => 'aaaaaaaa-bbbb-4ccc-8ddd-' + String(banco.length + 100000000000).slice(-12) },
    DEMO: false,
    banco, inserts: [],
    async portUploadFotoSaida() { return null; },
    async portPatchFotoCampo() { return true; },
    async sbInsert(t, row) {
      ctx.inserts.push(Object.assign({}, row));
      const n = ctx.inserts.length;
      if (row.id && banco.some(b => b.id === row.id)) return null; // 409 chave duplicada
      const nova = Object.assign({ id: row.id || ('srv-' + n) }, row);
      if (opts.gravaMasPerdeResposta && opts.gravaMasPerdeResposta.includes(n)) { banco.push(nova); return null; }
      if (opts.recusa && opts.recusa.includes(n)) return null; // ex.: coluna inexistente
      banco.push(nova);
      return [nova];
    },
    async sbFetch(t, o) {
      if (opts.fetchFalha) return null;
      const id = (o.filters[0] || '').replace('id=eq.', '');
      return banco.filter(b => b.id === id);
    },
  };
  vm.createContext(ctx);
  vm.runInContext(['isUUID', 'gerarUUID', 'portPickCols', 'portFotoCampoSrc', 'portSaidaJaGravada', 'portInsertSaidaDB'].map(fnHtml).join('\n'), ctx);
  return ctx;
}
const ID = '11111111-2222-4333-8444-555555555555';
const saida = extra => Object.assign({ id: ID, placa: 'GGB8G11', modelo: 'FIORINO', tipo_liberacao: 'equipe', equipe: 'EJN303', equipe_id: '99999999-2222-4333-8444-555555555555', km_saida: 42513, data_saida: '2026-09-30T07:26:15-03:00', status: 'Em campo', motorista: 'X' }, extra || {});

async function testesInsert() {
  // Resposta da 1ª gravação perdida (timeout), mas a linha foi gravada
  let c = ctxInsert({ gravaMasPerdeResposta: [1] });
  let r = await c.portInsertSaidaDB(saida());
  ok('insert: resposta perdida → 1 linha só no banco', c.banco.length === 1, c.banco);
  ok('insert: resposta perdida → reconhece a linha gravada', r && r[0] && r[0].id === ID, r);
  ok('insert: resposta perdida → não tenta de novo', c.inserts.length === 1, c.inserts.length);

  // Segunda passada simultânea (antes da correção da fila): mesmo id → nunca cria cópia
  c = ctxInsert({});
  const s1 = saida(), s2 = saida();
  await Promise.all([c.portInsertSaidaDB(s1), c.portInsertSaidaDB(s2)]);
  ok('insert: duas gravações do mesmo evento → 1 linha', c.banco.length === 1, c.banco.map(b => b.id));
  ok('insert: nenhuma tentativa sem id', c.inserts.every(i => i.id === ID), c.inserts.map(i => i.id || null));

  // Colunas recusadas nas tentativas completas → tentativa reduzida mantém o id
  c = ctxInsert({ recusa: [1, 2] });
  r = await c.portInsertSaidaDB(saida());
  const mini = c.inserts[2];
  ok('insert: tentativa reduzida leva o id', mini && mini.id === ID && !('modelo' in mini), mini);
  ok('insert: tentativa reduzida grava 1 linha', c.banco.length === 1 && r[0].id === ID);

  // Consulta de existência falhando: a chave primária ainda impede a cópia
  c = ctxInsert({ gravaMasPerdeResposta: [1], fetchFalha: true });
  await c.portInsertSaidaDB(saida());
  ok('insert: sem conseguir conferir, continua 1 linha (PK)', c.banco.length === 1, c.banco.length);

  // Saída sem id válido ganha UUID antes de gravar
  c = ctxInsert({});
  const semId = saida({ id: 'tmp_123' });
  r = await c.portInsertSaidaDB(semId);
  ok('insert: id temporário vira UUID', /^[0-9a-f-]{36}$/.test(semId.id) && c.inserts[0].id === semId.id && r[0].id === semId.id, semId.id);

  const corpo = fnHtml('portInsertSaidaDB');
  ok('insert: lista reduzida inclui id', /var mini=portPickCols\(saida, \['id',/.test(corpo));
}

(async () => {
  await testesFila();
  await testesInsert();
  ok('versão: log 8.1.173', /\{v:'8\.1\.173'/.test(html));
  ok('versão: tag portaria-offline.js com a versão nova', html.includes('portaria-offline.js?v=8.1.173'));
  ok('versão: sw cena-8.1.x', /'cena-8\.1\.\d+'/.test(sw));
  if (failed.length) {
    console.error('FALHAS (' + failed.length + '/' + total + '):\n - ' + failed.join('\n - '));
    process.exit(1);
  }
  console.log('portaria-saida-duplicada: ' + total + ' verificações OK');
})().catch(e => { console.error(e); process.exit(1); });
