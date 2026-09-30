'use strict';
// PROGRAMAÇÃO 8.1.172 — botão Sync Ponto dava erro: lotes de 15 matrículas (~10 s cada na API) passavam do limite
// de ~230 s do Azure; o navegador recebia erro enquanto a API seguia gravando em ponto_registros.
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
const codigo = ['progSyncPonto', 'progSyncPontoConferirFalhas', 'progSyncPontoMsgFinal', 'pontoReNorm'].map(fn).join('\n');

const DIA = '2026-09-30';
const CID = 'c-tma';

function cenario(opts) {
  const els = { 'btn-sync-ponto': { textContent: '🔄 Sync Ponto', disabled: false }, 'sync-ponto-hora': { textContent: '' } };
  const ctx = {
    console: { log() {}, warn() {} }, Math, Date, String, Object, Array, Promise, JSON, parseInt,
    DEMO: false, window: {},
    document: { getElementById: id => els[id] || null },
    contratos: [{ id: CID, codigo: 'TMA' }],
    colaboradores: [],
    _progStatus: {},
    progGetData: () => DIA,
    progSyncPontoColetarMatriculas: () => ({ contratoId: CID, matriculas: opts.mats }),
    setTimeout: f => { f(); return 0; },
    _autoRefresh: { pausar() {}, retomar() {} },
    toasts: [], progShowToast(m) { ctx.toasts.push(m); },
    lotes: [],
    pontoFetchApi(p, o) {
      const body = JSON.parse(o.body);
      ctx.lotes.push(body.matriculas);
      const n = ctx.lotes.length;
      if (opts.falhaLote && opts.falhaLote.includes(n)) {
        const e = new Error('Falha na API de ponto (erro de servidor ou rede) — verifique /health no Azure');
        return Promise.reject(e);
      }
      return Promise.resolve({ sincronizados: body.matriculas.length, erros: 0 });
    },
    sbConsultas: [],
    sbFetch(t, o) {
      ctx.sbConsultas.push([t, o]);
      if (opts.sbFalha) return Promise.resolve(null);
      return Promise.resolve((opts.gravadasBanco || []).map(re => ({ re, consultado_em: '2026-09-30T11:00:00Z' })));
    },
    pontoInvalidarCache() {},
    progCarregarPontoDoSupabase(d, cb) { cb(); },
    pontoCacheGet: () => null,
    progRenderQuadro() {},
    progCarregarBadgesPonto() {},
    sbDelete: () => Promise.resolve(),
    els,
  };
  vm.createContext(ctx);
  vm.runInContext(codigo, ctx);
  return ctx;
}
const esperar = () => new Promise(r => setImmediate(r));
async function rodar(opts) {
  const c = cenario(opts);
  c.progSyncPonto();
  for (let i = 0; i < 50 && c.window._progSyncPontoAtivo; i++) await esperar();
  return c;
}
const mats = n => Array.from({ length: n }, (_, i) => String(1000 + i));

(async () => {
  // Tudo certo: 12 matrículas → 3 lotes (5+5+2)
  let c = await rodar({ mats: mats(12) });
  ok('lotes de no máximo 5', c.lotes.length === 3 && c.lotes.every(l => l.length <= 5) && c.lotes.flat().length === 12, c.lotes.map(l => l.length));
  ok('sucesso: sem conferência no banco', c.sbConsultas.length === 0);
  const fim = c.toasts[c.toasts.length - 1];
  ok('sucesso: mensagem ✅ com 12/12 e contrato', /^✅ Ponto sincronizado — 2026-09-30 \(12\/12\) \[TMA\]$/.test(fim), fim);
  ok('sucesso: botão liberado', c.els['btn-sync-ponto'].disabled === false && c.els['btn-sync-ponto'].textContent === '🔄 Sync Ponto' && !c.window._progSyncPontoAtivo);

  // Lote 2 com erro no navegador, mas a API gravou 3 das 5 matrículas
  c = await rodar({ mats: mats(12), falhaLote: [2], gravadasBanco: ['1005', '1006', '0001007', '1003'] });
  const q = c.sbConsultas[0];
  ok('erro: confere ponto_registros do dia desde o início do sync', c.sbConsultas.length === 1 && q[0] === 'ponto_registros'
    && q[1].filters.includes('data=eq.' + DIA) && q[1].filters.some(f => /^consultado_em=gte\.\d{4}-\d{2}-\d{2}T/.test(f)), q);
  const fim2 = c.toasts[c.toasts.length - 1];
  ok('erro: gravadas pela API contam como sincronizadas (RE normalizado)', /\(10\/12\)/.test(fim2), fim2);
  ok('erro: só as não gravadas ficam sem sincronizar, com motivo', /^⚠ .*\| 2 sem sincronizar — Falha na API de ponto/.test(fim2), fim2);
  ok('erro: matrícula de lote bem-sucedido não é contada duas vezes', !/\(11\/12\)|\(13\/12\)/.test(fim2));

  // Erro e banco inacessível → todas do lote ficam como não sincronizadas (não assume sucesso)
  c = await rodar({ mats: mats(7), falhaLote: [1], sbFalha: true });
  const fim3 = c.toasts[c.toasts.length - 1];
  ok('banco inacessível: lote com erro fica sem sincronizar', /\(2\/7\)/.test(fim3) && /5 sem sincronizar/.test(fim3), fim3);
  ok('banco inacessível: botão liberado', !c.window._progSyncPontoAtivo && c.els['btn-sync-ponto'].disabled === false);

  // Todos os lotes falharam e nada gravado
  c = await rodar({ mats: mats(6), falhaLote: [1, 2], gravadasBanco: [] });
  const fim4 = c.toasts[c.toasts.length - 1];
  ok('tudo falhou: 0/6 e 6 sem sincronizar', /^⚠ Ponto sincronizado — 2026-09-30 \(0\/6\)/.test(fim4) && /6 sem sincronizar/.test(fim4), fim4);

  // Agendador (todos=true) usa o mesmo caminho sem rótulo de contrato
  c = cenario({ mats: mats(3) });
  c.progSyncPonto({ todos: true, automatico: true });
  for (let i = 0; i < 50 && c.window._progSyncPontoAtivo; i++) await esperar();
  ok('agendador: mensagem sem rótulo de contrato', /^✅ Ponto sincronizado — 2026-09-30 \(3\/3\)$/.test(c.toasts[c.toasts.length - 1]), c.toasts);

  ok('versão: log 8.1.172', /\{v:'8\.1\.172'/.test(html));
  ok('versão: sw cena-8.1.x', /'cena-8\.1\.\d+'/.test(sw));

  if (failed.length) {
    console.error('FALHAS (' + failed.length + '/' + total + '):\n - ' + failed.join('\n - '));
    process.exit(1);
  }
  console.log('prog-sync-ponto-lotes: ' + total + ' verificações OK');
})().catch(e => { console.error(e); process.exit(1); });
