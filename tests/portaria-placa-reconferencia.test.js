'use strict';
// PORTARIA 8.1.171 — liberação de saída gravava a placa carregada na abertura da vistoria mesmo quando a programação
// trocou o veículo segundos antes (caso EJN303 30/09: programação GGB8G11, portaria DTF3B91).
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

const EQ = 'eq-303';
const DIA = '2026-09-30';
const norm = s => String(s || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

// ─── 1. portReconferirPlacaProgramada ───────────────────────────────────────
function ctxReconf(opts) {
  const ctx = {
    console, Object, String, Number, Promise, Array,
    DEMO: false,
    _progVeiculos: opts.mem || {},
    composicao_dia: opts.comps || [],
    portDiaISO: d => String(d || '').split('T')[0],
    fetches: [],
    sbFetch(tabela, o) {
      ctx.fetches.push([tabela, o]);
      if (opts.falha && opts.falha[tabela]) return Promise.resolve(null);
      if (opts.erro) return Promise.reject(new Error('rede'));
      return Promise.resolve((opts.banco[tabela] || []).map(r => Object.assign({}, r)));
    },
  };
  vm.createContext(ctx);
  vm.runInContext(fn('portReconferirPlacaProgramada'), ctx);
  return ctx;
}

async function testesReconferir() {
  // programação trocou DTF3B91 → GGB8G11 no servidor; memória do tablet ainda com DTF3B91
  let c = ctxReconf({
    mem: { [EQ + '_' + DIA]: { placa: 'DTF3B91', modelo: 'STRADA' } },
    comps: [{ id: 'c1', equipe_id: EQ, data: DIA + 'T00:00:00', placa: 'DTF3B91', modelo: 'STRADA' }],
    banco: {
      prog_veiculos_dia: [{ equipe_id: EQ, data: DIA, slot: 1, placa: 'GGB8G11', modelo: 'FIORINO', veiculo_id: 'v-ggb' },
        { equipe_id: EQ, data: DIA, slot: 2, placa: 'ZZZ9Z99', modelo: 'CARRETA', veiculo_id: 'v-zzz' }],
      composicao_dia: [{ id: 'c1', equipe_id: EQ, data: DIA, placa: 'GGB8G11', veiculo_id: 'v-ggb', modelo: 'FIORINO' }],
    },
  });
  let r = await c.portReconferirPlacaProgramada(EQ, DIA);
  ok('reconf: ok', r.ok === true, r);
  ok('reconf: placa do servidor (slot 1) vence memória', r.placa === 'GGB8G11', r);
  ok('reconf: modelo do servidor', r.modelo === 'FIORINO', r);
  ok('reconf: memória _progVeiculos atualizada', c._progVeiculos[EQ + '_' + DIA].placa === 'GGB8G11' && c._progVeiculos[EQ + '_' + DIA].veiculo_id === 'v-ggb');
  ok('reconf: memória composicao_dia atualizada', c.composicao_dia[0].placa === 'GGB8G11' && c.composicao_dia[0].veiculo_id === 'v-ggb');
  ok('reconf: consulta prog_veiculos_dia sem apagados', c.fetches.some(f => f[0] === 'prog_veiculos_dia' && f[1].filters.includes('deleted_at=is.null') && f[1].filters.includes('equipe_id=eq.' + EQ) && f[1].filters.includes('data=eq.' + DIA)));
  ok('reconf: consulta composicao_dia com campos reais', c.fetches.some(f => f[0] === 'composicao_dia' && f[1].select === 'id,equipe_id,data,placa,veiculo_id,modelo'));

  // só slot 2 → não é o veículo principal; cai para composicao_dia
  c = ctxReconf({
    banco: {
      prog_veiculos_dia: [{ equipe_id: EQ, data: DIA, slot: 2, placa: 'ZZZ9Z99' }],
      composicao_dia: [{ id: 'c1', equipe_id: EQ, data: DIA, placa: 'GGB8G11', modelo: 'FIORINO' }],
    },
  });
  r = await c.portReconferirPlacaProgramada(EQ, DIA);
  ok('reconf: slot 2 ignorado, fallback composicao_dia', r.ok && r.placa === 'GGB8G11', r);

  // programação sem veículo no servidor → placa '' e memória limpa
  c = ctxReconf({
    mem: { [EQ + '_' + DIA]: { placa: 'DTF3B91' } },
    comps: [{ id: 'c1', equipe_id: EQ, data: DIA, placa: 'DTF3B91' }],
    banco: { prog_veiculos_dia: [], composicao_dia: [{ id: 'c1', equipe_id: EQ, data: DIA, placa: null }] },
  });
  r = await c.portReconferirPlacaProgramada(EQ, DIA);
  ok('reconf: sem veículo → ok com placa vazia', r.ok === true && r.placa === '', r);
  ok('reconf: sem veículo → memória limpa', !c._progVeiculos[EQ + '_' + DIA] && c.composicao_dia[0].placa === null);

  // falha de leitura → ok:false (nunca assume a placa da memória como conferida)
  for (const t of ['prog_veiculos_dia', 'composicao_dia']) {
    c = ctxReconf({ mem: { [EQ + '_' + DIA]: { placa: 'DTF3B91' } }, banco: {}, falha: { [t]: true } });
    r = await c.portReconferirPlacaProgramada(EQ, DIA);
    ok('reconf: falha em ' + t + ' → ok:false', r.ok === false, r);
    ok('reconf: falha em ' + t + ' → memória intacta', c._progVeiculos[EQ + '_' + DIA].placa === 'DTF3B91');
  }
  c = ctxReconf({ banco: {}, erro: true });
  r = await c.portReconferirPlacaProgramada(EQ, DIA);
  ok('reconf: exceção de rede → ok:false', r.ok === false, r);
  c = ctxReconf({ banco: {} });
  c.DEMO = true;
  r = await c.portReconferirPlacaProgramada(EQ, DIA);
  ok('reconf: DEMO → ok:false sem fetch', r.ok === false && c.fetches.length === 0);
}

// ─── 2. Decisão no clique de Liberar (handler extraído de portAbrirLiberacaoEquipe) ─
const corpoLib = fn('portAbrirLiberacaoEquipe');
const iThen = corpoLib.indexOf('portReconferirPlacaProgramada(eqId, data).then(function(r){');
const iFimThen = corpoLib.indexOf('\n      });\n    };\n  },50);\n}', iThen);
const iProsseguir = corpoLib.indexOf('function _prosseguir(){');
ok('lib: reconferência presente no clique', iThen > 0 && iFimThen > iThen);
ok('lib: gravação isolada em _prosseguir (antes da reconferência)', iProsseguir > 0 && iProsseguir < iThen);
const trechoProsseguir = corpoLib.slice(iProsseguir, iThen);
ok('lib: insert da saída só dentro de _prosseguir', trechoProsseguir.includes('portInsertSaidaDB') && trechoProsseguir.includes('portOffRegistrarSaida')
  && corpoLib.slice(iThen).indexOf('portInsertSaidaDB') < 0 && corpoLib.slice(0, iProsseguir).indexOf('portInsertSaidaDB') < 0);
ok('lib: saída grava a variável placa', /placa\s*:\s*placa\b/.test(trechoProsseguir) || /placa:placa/.test(trechoProsseguir));
ok('lib: placaAbertura guardada na abertura', /var placaAbertura = placa;/.test(corpoLib));
ok('lib: modal com ids de placa e aviso', corpoLib.includes('id="lib-eq-placa"') && corpoLib.includes('id="lib-eq-placa-aviso"'));
ok('lib: _portCnhExcecao zerado dentro de _prosseguir', trechoProsseguir.includes('_portCnhExcecao=null;'));

const codigoThen = corpoLib.slice(iThen, iFimThen + '\n      });'.length);
function simularClique(opts) {
  const els = { 'lib-eq-placa': { innerHTML: 'DTF3B91' }, 'lib-eq-placa-aviso': { innerHTML: '' } };
  const ctx = {
    console, String, Object, Array,
    window: {},
    eqId: EQ, data: DIA,
    placa: opts.placa, modelo: opts.modelo || 'STRADA', placaAbertura: opts.placaAbertura !== undefined ? opts.placaAbertura : opts.placa,
    btn: { disabled: true, textContent: '⏳ Conferindo programação...' }, _lblConf: '✅ Liberar',
    frt_veiculos: [{ placa: 'GGB8G11', modelo: 'FIORINO' }, { placa: 'DTF3B91', modelo: 'STRADA' }],
    document: { getElementById: id => els[id] || null },
    escHtml: s => String(s),
    portNormPlaca: norm,
    refrescos: [], portRefrescarSaidasPlaca(p) { ctx.refrescos.push(p); },
    toasts: [], progShowToast(m, t) { ctx.toasts.push([m, t || '']); },
    confirms: [], confirm(m) { ctx.confirms.push(m); return !!opts.confirm; },
    gravacoes: [], _prosseguir() { ctx.gravacoes.push({ placa: ctx.placa, modelo: ctx.modelo }); },
    portReconferirPlacaProgramada() { return { then(cb) { cb(opts.r); } }; },
    els,
  };
  vm.createContext(ctx);
  vm.runInContext(codigoThen, ctx);
  return ctx;
}

function testesClique() {
  // Caso EJN303: vistoria aberta com DTF3B91, programação já está com GGB8G11
  let c = simularClique({ placa: 'DTF3B91', r: { ok: true, placa: 'GGB8G11', modelo: '' } });
  ok('clique: troca detectada → NÃO grava', c.gravacoes.length === 0, c.gravacoes);
  ok('clique: placa atualizada para a programada', c.placa === 'GGB8G11');
  ok('clique: modelo recuperado do cadastro', c.modelo === 'FIORINO', c.modelo);
  ok('clique: aviso vermelho com antes/agora', /DTF3B91/.test(c.els['lib-eq-placa-aviso'].innerHTML) && /GGB8G11/.test(c.els['lib-eq-placa-aviso'].innerHTML));
  ok('clique: placa do topo do modal atualizada', /GGB8G11/.test(c.els['lib-eq-placa'].innerHTML));
  ok('clique: contexto de KM passa a ser a nova placa', c.window._portKmPlacaCtx === 'GGB8G11' && c.refrescos.includes('GGB8G11'));
  ok('clique: toast de erro', c.toasts.some(t => t[1] === 'erro' && /GGB8G11/.test(t[0])));
  ok('clique: botão reabilitado', c.btn.disabled === false && c.btn.textContent === '✅ Liberar');

  // Segundo clique: vistoria já com GGB8G11, servidor confirma → grava GGB8G11
  c = simularClique({ placa: 'GGB8G11', placaAbertura: 'DTF3B91', r: { ok: true, placa: 'GGB8G11', modelo: 'FIORINO' } });
  ok('clique 2: grava com a placa programada', c.gravacoes.length === 1 && c.gravacoes[0].placa === 'GGB8G11', c.gravacoes);

  // Mesma placa (formatos diferentes) → grava direto
  c = simularClique({ placa: 'GGB-8G11', r: { ok: true, placa: 'ggb8g11' } });
  ok('clique: placa igual normalizada → grava sem aviso', c.gravacoes.length === 1 && c.els['lib-eq-placa-aviso'].innerHTML === '' && c.confirms.length === 0);

  // Programação retirou o veículo depois da abertura → bloqueia, inclusive no segundo clique
  c = simularClique({ placa: 'DTF3B91', r: { ok: true, placa: '' } });
  ok('clique: programação sem veículo → não grava', c.gravacoes.length === 0 && c.placa === '');
  c = simularClique({ placa: '', placaAbertura: 'DTF3B91', r: { ok: true, placa: '' } });
  ok('clique 2: sem veículo continua bloqueado', c.gravacoes.length === 0 && c.toasts.some(t => /sem veículo/.test(t[0])));
  // Equipe que abriu sem veículo e continua sem → comportamento anterior (permitido)
  c = simularClique({ placa: '', placaAbertura: '', r: { ok: true, placa: '' } });
  ok('clique: sempre sem veículo → mantém comportamento anterior', c.gravacoes.length === 1);

  // Sem conexão → exige confirmação explícita
  c = simularClique({ placa: 'DTF3B91', r: { ok: false }, confirm: false });
  ok('offline: recusa → não grava', c.gravacoes.length === 0 && c.confirms.length === 1 && /DTF3B91/.test(c.confirms[0]));
  c = simularClique({ placa: 'DTF3B91', r: { ok: false }, confirm: true });
  ok('offline: confirma → grava', c.gravacoes.length === 1 && c.gravacoes[0].placa === 'DTF3B91');
}

// ─── 3. Programação: divergência de placa na coluna de operação ─────────────
function htmlOperacao(portaria, placaProg) {
  const ctx = {
    String, Object,
    escHtml: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    progTmaDiaISO: d => String(d).split('T')[0],
    progTmaPlacaProg: () => placaProg,
    progTmaFmtHora: () => '',
    progTmaOsVisual: () => ({ cor: '#888', icon: '', label: '' }),
    PROG_TMA_OS_ATIVA: [],
    progTmaGetOperacaoEquipe: () => ({ portaria, diario: {}, ordem: null, osConcluidas: 0 }),
  };
  vm.createContext(ctx);
  vm.runInContext(fn('progTmaHtmlOperacao'), ctx);
  return ctx.progTmaHtmlOperacao(EQ, DIA);
}
function testesProgramacao() {
  const reg = { placa: 'DTF-3B91', data_saida: DIA + 'T07:26:15-03:00' };
  let h = htmlOperacao({ status: 'em_campo', label: 'Em Campo', hora: '07:26', registro: reg }, 'GGB8G11');
  ok('prog: em campo com placa divergente → alerta', /⚠ Saiu com DTF-3B91 · prog\. GGB8G11/.test(h), h);
  h = htmlOperacao({ status: 'retornou', label: 'Retornou', hora: '17:00', registro: reg }, 'GGB8G11');
  ok('prog: retornou com placa divergente → alerta', /Saiu com DTF-3B91/.test(h));
  h = htmlOperacao({ status: 'em_campo', label: 'Em Campo', hora: '07:26', registro: { placa: 'ggb 8g11' } }, 'GGB8G11');
  ok('prog: mesma placa normalizada → sem alerta', !/Saiu com/.test(h));
  h = htmlOperacao({ status: 'aguardando', label: 'Aguardando Portaria', hora: '', registro: null }, 'GGB8G11');
  ok('prog: sem saída → sem alerta', !/Saiu com/.test(h));
  h = htmlOperacao({ status: 'em_campo', label: 'Em Campo', hora: '07:26', registro: reg }, '');
  ok('prog: sem placa programada → sem alerta', !/Saiu com/.test(h));
}

// ─── 4. Versão ──────────────────────────────────────────────────────────────
function testesVersao() {
  ok('versão: log 8.1.171', /\{v:'8\.1\.171'/.test(html));
  ok('versão: sw cena-8.1.x', /'cena-8\.1\.\d+'/.test(sw));
}

(async () => {
  await testesReconferir();
  testesClique();
  testesProgramacao();
  testesVersao();
  if (failed.length) {
    console.error('FALHAS (' + failed.length + '/' + total + '):\n - ' + failed.join('\n - '));
    process.exit(1);
  }
  console.log('portaria-placa-reconferencia: ' + total + ' verificações OK');
})().catch(e => { console.error(e); process.exit(1); });
