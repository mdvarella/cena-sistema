'use strict';
// 8.1.210 — Programação de Projetos: caminhão compartilhado (2 equipes) e carreta. Executa as funções reais do index.html.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execSync } = require('child_process');

const raiz = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const sw = fs.readFileSync(path.join(raiz, 'sw.js'), 'utf8');
let falhas = 0, total = 0;
function ok(nome, cond, extra) {
  total++;
  if (!cond) { falhas++; console.error('FALHOU: ' + nome + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); }
}
function fnDe(src, nome) {
  const re = new RegExp('\\n(?:async )?function ' + nome + '\\(');
  const n = src.split(re).length - 1;
  if (n !== 1) throw new Error('definição de ' + nome + ': ' + n);
  const ini = src.search(re) + 1;
  return src.slice(ini, src.indexOf('\n}\n', ini) + 2);
}
const fn = nome => fnDe(html, nome);

// ── Sandbox ───────────────────────────────────────────────────────
const ctx = {
  console: { log() {}, warn() {}, error() {} },
  window: {},
  DEMO: false,
  usuarioLogado: { nome: 'Teste' },
  _progVeiculos: {},
  equipes: [],
  equipes_disp: [],
  frt_veiculos: [],
  alertas: [], confirmas: [], respostaConfirm: true,
  escHtml: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
  isUUID: id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
  campos: {},
};
ctx.alert = m => ctx.alertas.push(m);
ctx.confirm = m => { ctx.confirmas.push(m); return ctx.respostaConfirm; };
ctx.document = { getElementById: id => (id in ctx.campos ? { value: ctx.campos[id] } : null) };
ctx.progProjetoCoreFindEquipe = id => ctx.equipes.find(e => e.id === id) || null;
vm.createContext(ctx);
vm.runInContext([
  'var PROG_CARRETA_TIPOS = {carreta_cabos:"Carreta de cabos", compressor:"Compressor"};',
  fn('progVeiculoKey'), fn('turnsoSeSobrepoe'), fn('progVeicConflitos'), fn('progVeicRowDoSlot'),
  fn('progVeicNormPlaca'), fn('progVeicPlacaValida'), fn('progVeicObjDaLinha'), fn('progVeicNomeEquipe'),
  fn('progVeicEqDaChave'), fn('progVeicEhSegundoDoPar'), fn('progVeicAvaliarCompart'), fn('progVeicAplicarCompartLocal'),
  fn('progVeicExtrasHtml'), fn('progVeicCarretasFrota'), fn('progVeicExtrasModalHtml'), fn('progVeicExtrasLerModal'),
  fn('progVeicMsgErroBanco'), fn('progSalvarVeiculoNoBanco'),
].join('\n'), ctx);

const D = '2026-10-06';
function reset() {
  ctx._progVeiculos = {};
  ctx.equipes = [
    { id: 'EQA', nome_equipe: 'DAC-01', hora_inicio: '07:00', hora_fim: '16:00' },
    { id: 'EQB', nome_equipe: 'DAC-02', hora_inicio: '07:00', hora_fim: '16:00' },
    { id: 'EQC', nome_equipe: 'DAC-03', hora_inicio: '08:00', hora_fim: '17:00' },
    { id: 'EQN', nome_equipe: 'DAC-NOITE', hora_inicio: '19:00', hora_fim: '04:00' },
  ];
  ctx.frt_veiculos = [
    { id: '11111111-1111-4111-8111-111111111111', placa: 'FZK4D46', modelo: 'CARRETINHA', tipo: '', status: 'Disponível', ativo: true },
    { id: '22222222-2222-4222-8222-222222222222', placa: 'CUN4E33', modelo: 'CARRETINHA DUPLA', tipo: 'Outro', status: 'Disponível', ativo: true },
    { id: '33333333-3333-4333-8333-333333333333', placa: 'EWA3587', modelo: 'CARRETINHA', tipo: 'Outro', status: 'Vendido', ativo: true },
    { id: '44444444-4444-4444-8444-444444444444', placa: 'EEQ8E47', modelo: 'VW/EXPRESS DRC 4X2', tipo: 'Caminhão', status: 'Disponível', ativo: true },
  ];
  ctx.alertas = []; ctx.confirmas = []; ctx.respostaConfirm = true; ctx.campos = {};
  ctx.window = {};
}
const K = eq => eq + '_' + D;
const C = () => vm.runInContext('_progVeiculos', ctx);
function setV(eq, obj) { vm.runInContext('_progVeiculos', ctx)[K(eq)] = obj; }
function sync() { vm.runInContext('_progVeiculos = this._progVeiculos; equipes = this.equipes; frt_veiculos = this.frt_veiculos; window = this.window;', ctx); }

// ── Placa ─────────────────────────────────────────────────────────
reset(); sync();
ok('normaliza placa', ctx.progVeicNormPlaca(' fzk-4d46 ') === 'FZK4D46');
ok('placa Mercosul válida', ctx.progVeicPlacaValida('FZK4D46'));
ok('placa antiga válida', ctx.progVeicPlacaValida('EWA-3587'));
ok('placa inválida', !ctx.progVeicPlacaValida('123') && !ctx.progVeicPlacaValida('ABCD123') && !ctx.progVeicPlacaValida(''));

// ── Linha do banco → memória ──────────────────────────────────────
let o = ctx.progVeicObjDaLinha({ veiculo_id: 'v', placa: 'ABC1D23', modelo: 'M', justificativa: '', alterado_por: 'x' });
ok('linha sem extras não cria campos', !('compartilhado_com_equipe_id' in o) && !('carreta_tipo' in o) && o.placa === 'ABC1D23' && o.id === 'v');
o = ctx.progVeicObjDaLinha({ veiculo_id: 'v', placa: 'ABC1D23', compartilhado_com_equipe_id: 'EQB', carreta_tipo: 'compressor', carreta_placa: 'FZK4D46', carreta_veiculo_id: null });
ok('linha com extras', o.compartilhado_com_equipe_id === 'EQB' && o.carreta_tipo === 'compressor' && o.carreta_placa === 'FZK4D46');

// ── Avaliação do compartilhamento ─────────────────────────────────
reset(); setV('EQA', { placa: 'ABC1D23', modelo: 'Express' }); sync();
let r = ctx.progVeicAvaliarCompart('EQB', D, 'abc-1d23', ctx.equipes[1]);
ok('placa com 1 equipe no mesmo horário → pode compartilhar', r.parceiro === 'EQA' && !r.bloqueio && r.parceiroNome === 'DAC-01' && !r.jaCompartilhado, r);
r = ctx.progVeicAvaliarCompart('EQN', D, 'ABC1D23', ctx.equipes[3]);
ok('turno que não se sobrepõe → livre (sem compartilhar)', !r.parceiro && !r.bloqueio && r.outras.length === 0, r);
r = ctx.progVeicAvaliarCompart('EQB', D, 'XYZ9A88', ctx.equipes[1]);
ok('placa livre', !r.parceiro && !r.bloqueio);
r = ctx.progVeicAvaliarCompart('EQA', D, 'ABC1D23', ctx.equipes[0]);
ok('a própria equipe não conta', !r.parceiro && !r.bloqueio);
setV('EQA', { placa: 'ABC1D23', compartilhado_com_equipe_id: 'EQB' }); setV('EQB', { placa: 'ABC1D23', compartilhado_com_equipe_id: 'EQA' }); sync();
r = ctx.progVeicAvaliarCompart('EQB', D, 'ABC1D23', ctx.equipes[1]);
ok('já compartilhado com esta equipe', r.parceiro === 'EQA' && r.jaCompartilhado, r);
r = ctx.progVeicAvaliarCompart('EQC', D, 'ABC1D23', ctx.equipes[2]);
ok('3ª equipe bloqueada', !r.parceiro && /máximo 2/.test(r.bloqueio), r);
reset(); setV('EQA', { placa: 'ABC1D23', compartilhado_com_equipe_id: 'EQN' }); sync();
r = ctx.progVeicAvaliarCompart('EQB', D, 'ABC1D23', ctx.equipes[1]);
ok('parceiro já compartilha com outra → bloqueado', !r.parceiro && /já compartilhado entre DAC-01 e DAC-NOITE/.test(r.bloqueio), r);
reset(); setV('EQA', { placa: 'ABC1D23' }); setV('EQC', { placa: 'ABC1D23' }); sync();
r = ctx.progVeicAvaliarCompart('EQB', D, 'ABC1D23', ctx.equipes[1]);
ok('2 outras equipes no horário → bloqueado', !r.parceiro && /DAC-01 e DAC-03|DAC-03 e DAC-01/.test(r.bloqueio), r);
reset(); setV('EQA', { placa: 'ABC1D23' }); vm.runInContext('_progVeiculos', ctx)['EQA_' + D + '_b'] = { placa: 'ABC1D23' };
vm.runInContext('_progVeiculos', ctx)['EQC_2026-10-07'] = { placa: 'ABC1D23' }; sync();
r = ctx.progVeicAvaliarCompart('EQB', D, 'ABC1D23', ctx.equipes[1]);
ok('ignora slot 2 e outro dia', r.parceiro === 'EQA' && r.outras.length === 1, r);

// ── Duplicidade ───────────────────────────────────────────────────
reset(); setV('EQA', { placa: 'ABC1D23', compartilhado_com_equipe_id: 'EQB' }); setV('EQB', { placa: 'ABC1D23', compartilhado_com_equipe_id: 'EQA' }); sync();
ok('par compartilhado não é duplicado', !ctx.progVeicConflitos(D)['ABC1D23'], ctx.progVeicConflitos(D));
setV('EQC', { placa: 'ABC1D23' }); sync();
ok('3ª equipe com a mesma placa volta a ser duplicado', ctx.progVeicConflitos(D)['ABC1D23'] === 2, ctx.progVeicConflitos(D));
reset(); setV('EQA', { placa: 'ABC1D23' }); setV('EQB', { placa: 'ABC1D23' }); sync();
ok('mesma placa sem compartilhar continua duplicado', ctx.progVeicConflitos(D)['ABC1D23'] === 2);
reset(); setV('EQA', { placa: 'ABC1D23' }); setV('EQB', { placa: 'ABC1D23', compartilhado_com_equipe_id: 'EQA' }); sync();
ok('vínculo de um lado só continua duplicado', ctx.progVeicConflitos(D)['ABC1D23'] === 2);
reset(); setV('EQA', { placa: 'ABC1D23', compartilhado_com_equipe_id: 'EQB' }); setV('EQB', { placa: 'XYZ9A88', compartilhado_com_equipe_id: 'EQA' }); sync();
ok('vínculo com placas diferentes não esconde nada', !ctx.progVeicConflitos(D)['ABC1D23'] && !ctx.progVeicConflitos(D)['XYZ9A88']);

// ── Memória espelha o banco ───────────────────────────────────────
reset(); setV('EQA', { placa: 'ABC1D23' }); setV('EQB', { placa: 'ABC1D23', compartilhado_com_equipe_id: 'EQA' }); setV('EQC', { placa: 'Q', compartilhado_com_equipe_id: 'EQB' }); sync();
ctx.progVeicAplicarCompartLocal('EQB', D, 'EQA');
ok('novo parceiro aponta de volta', C()[K('EQA')].compartilhado_com_equipe_id === 'EQB');
ok('quem apontava para a equipe e não é o parceiro é desfeito', !C()[K('EQC')].compartilhado_com_equipe_id);
ctx.progVeicAplicarCompartLocal('EQB', D, null);
ok('desfazer limpa o parceiro', !C()[K('EQA')].compartilhado_com_equipe_id);

// ── Modal: leitura e validação ────────────────────────────────────
function ler(eq, placa, campos, vAtual) {
  ctx.alertas = []; ctx.confirmas = []; ctx.campos = campos || {};
  return ctx.progVeicExtrasLerModal(eq, D, placa, ctx.equipes.find(e => e.id === eq), vAtual || null);
}
reset(); setV('EQA', { placa: 'ABC1D23' }); sync();
let x = ler('EQB', 'ABC1D23', { 'pv-carreta-tipo': '' });
ok('compartilhar: pergunta e grava parceiro', x && x.campos.compartilhado_com_equipe_id === 'EQA' && ctx.confirmas.length === 1 && /DAC-01/.test(ctx.confirmas[0]), x);
ok('sem carreta: campos nulos', x.campos.carreta_tipo === null && x.campos.carreta_placa === null && x.campos.carreta_veiculo_id === null);
ctx.respostaConfirm = false;
x = ler('EQB', 'ABC1D23', {});
ok('não confirmar compartilhamento: nada é gravado', x === null);
ctx.respostaConfirm = true;
x = ler('EQB', 'ABC1D23', {}, { placa: 'ABC1D23', compartilhado_com_equipe_id: 'EQA' });
ok('já compartilhado: não pergunta de novo', x && x.campos.compartilhado_com_equipe_id === 'EQA' && ctx.confirmas.length === 0);
x = ler('EQB', 'XYZ9A88', {}, { placa: 'ABC1D23', compartilhado_com_equipe_id: 'EQA' });
ok('trocar para placa livre: compartilhamento sai', x && x.campos.compartilhado_com_equipe_id === null && x.parceiroAnterior === 'EQA');
setV('EQA', { placa: 'ABC1D23', compartilhado_com_equipe_id: 'EQC' }); setV('EQC', { placa: 'ABC1D23', compartilhado_com_equipe_id: 'EQA' }); sync();
x = ler('EQB', 'ABC1D23', {});
ok('3ª equipe: alerta e nada é gravado', x === null && /máximo 2/.test(ctx.alertas[0] || ''), ctx.alertas);

reset(); sync();
x = ler('EQA', 'ABC1D23', { 'pv-carreta-tipo': 'carreta_cabos', 'pv-carreta-placa': 'fzk-4d46' });
ok('carreta de cabos da frota: placa normalizada e id da frota', x && x.campos.carreta_tipo === 'carreta_cabos' && x.campos.carreta_placa === 'FZK4D46'
  && x.campos.carreta_veiculo_id === '11111111-1111-4111-8111-111111111111', x);
x = ler('EQA', 'ABC1D23', { 'pv-carreta-tipo': 'compressor', 'pv-carreta-placa': 'QWE1R23' });
ok('compressor digitado: sem id da frota', x && x.campos.carreta_tipo === 'compressor' && x.campos.carreta_placa === 'QWE1R23' && x.campos.carreta_veiculo_id === null, x);
x = ler('EQA', 'ABC1D23', { 'pv-carreta-tipo': 'compressor', 'pv-carreta-placa': '' });
ok('carreta sem placa bloqueia', x === null && /placa do compressor/.test(ctx.alertas[0] || ''), ctx.alertas);
x = ler('EQA', 'ABC1D23', { 'pv-carreta-tipo': 'carreta_cabos', 'pv-carreta-placa': '12' });
ok('placa da carreta inválida bloqueia', x === null && /inválida/.test(ctx.alertas[0] || ''));
x = ler('EQA', 'ABC1D23', { 'pv-carreta-tipo': 'carreta_cabos', 'pv-carreta-placa': 'abc1d23' });
ok('carreta igual ao caminhão bloqueia', x === null && /diferente/.test(ctx.alertas[0] || ''));
x = ler('EQA', 'ABC1D23', { 'pv-carreta-tipo': 'gerador', 'pv-carreta-placa': 'FZK4D46' });
ok('tipo de carreta inválido bloqueia', x === null && /inválido/.test(ctx.alertas[0] || ''));
setV('EQC', { placa: 'ZZZ1Z11', carreta_tipo: 'carreta_cabos', carreta_placa: 'FZK4D46' }); sync();
ctx.respostaConfirm = false;
x = ler('EQA', 'ABC1D23', { 'pv-carreta-tipo': 'carreta_cabos', 'pv-carreta-placa': 'FZK4D46' });
ok('carreta já com outra equipe: pergunta; não confirmar cancela', x === null && /já está com DAC-03/.test(ctx.confirmas[0] || ''), ctx.confirmas);
ctx.respostaConfirm = true;
x = ler('EQA', 'ABC1D23', { 'pv-carreta-tipo': 'carreta_cabos', 'pv-carreta-placa': 'FZK4D46' });
ok('carreta já com outra equipe: confirmar grava', x && x.campos.carreta_placa === 'FZK4D46');

// ── Modal: HTML ───────────────────────────────────────────────────
reset(); sync();
let h = ctx.progVeicExtrasModalHtml('EQA', D, { placa: 'ABC1D23', carreta_tipo: 'compressor', carreta_placa: 'CUN4E33', compartilhado_com_equipe_id: 'EQB' });
ok('lista carretinhas ativas da frota', /FZK4D46/.test(h) && /CUN4E33/.test(h));
ok('não lista carretinha vendida nem caminhão', !/EWA3587/.test(h) && !/EEQ8E47/.test(h));
ok('pré-seleciona tipo e placa atuais', /value="compressor" selected/.test(h) && /value="CUN4E33" selected/.test(h) && /id="pv-carreta-box" style="display:grid/.test(h));
ok('mostra com quem compartilha', /Compartilhado com <b>DAC-02<\/b>/.test(h));
h = ctx.progVeicExtrasModalHtml('EQA', D, null);
ok('sem carreta: caixa da placa escondida', /id="pv-carreta-box" style="display:none/.test(h) && /<option value="">Não<\/option>/.test(h));

// ── Célula ────────────────────────────────────────────────────────
h = ctx.progVeicExtrasHtml({ placa: 'ABC1D23', compartilhado_com_equipe_id: 'EQB', carreta_tipo: 'carreta_cabos', carreta_placa: 'FZK4D46' });
ok('célula mostra 🤝 e 🚛', /🤝 Compartilhado com DAC-02/.test(h) && /🚛 Carreta de cabos/.test(h) && /FZK4D46/.test(h));
ok('célula sem extras vazia', ctx.progVeicExtrasHtml({ placa: 'ABC1D23' }) === '');

// ── Gravação no banco ─────────────────────────────────────────────
let chamadas;
function prepBanco(existente, falhar) {
  chamadas = [];
  ctx.progFetchVeiculosDiaEquipeAll = () => Promise.resolve(existente ? [existente] : []);
  ctx.sbUpdate = (t, p, f) => { chamadas.push({ op: 'update', p: Object.assign({}, p), f }); if (falhar) { ctx.window._sbLastUpdateErr = falhar; return Promise.resolve(false); } return Promise.resolve(true); };
  ctx.sbUpsert = (t, p) => { chamadas.push({ op: 'upsert', p: Object.assign({}, p) }); if (falhar) { ctx.window._sbLastUpsertErr = falhar; return Promise.resolve(null); } return Promise.resolve([p]); };
  sync();
}
(async () => {
  reset();
  prepBanco({ id: 'r1', placa: 'ABC1D23', slot: 1 });
  let okS = await ctx.progSalvarVeiculoNoBanco('EQB', D, { _extras: true, id: null, placa: 'abc-1d23', modelo: 'M', compartilhado_com_equipe_id: 'EQA', carreta_tipo: 'compressor', carreta_placa: 'qwe-1r23', carreta_veiculo_id: null }, 1);
  let p = chamadas[0] && chamadas[0].p;
  ok('salva com extras', okS && p.compartilhado_com_equipe_id === 'EQA' && p.carreta_tipo === 'compressor' && p.carreta_placa === 'QWE1R23' && p.carreta_veiculo_id === null, p);

  prepBanco({ id: 'r1', placa: 'ABC1D23', slot: 1 });
  okS = await ctx.progSalvarVeiculoNoBanco('EQB', D, { _extras: true, placa: 'ABC1D23', modelo: 'M', compartilhado_com_equipe_id: null, carreta_tipo: null, carreta_placa: 'FZK4D46' }, 1);
  p = chamadas[0].p;
  ok('extras vazios gravam null (desfaz)', okS && p.compartilhado_com_equipe_id === null && p.carreta_tipo === null && p.carreta_placa === null && p.carreta_veiculo_id === null, p);

  prepBanco({ id: 'r1', placa: 'ABC1D23', slot: 1 });
  await ctx.progSalvarVeiculoNoBanco('EQB', D, { placa: 'ABC1D23', modelo: 'M', compartilhado_com_equipe_id: 'EQA', carreta_tipo: 'compressor' }, 1);
  p = chamadas[0].p;
  ok('sem _extras (TMA e outros fluxos) não envia campos novos', !('compartilhado_com_equipe_id' in p) && !('carreta_tipo' in p) && !('carreta_placa' in p) && !('carreta_veiculo_id' in p), p);

  prepBanco({ id: 'r1', placa: 'ABC1D23', slot: 1, compartilhado_com_equipe_id: 'EQA' });
  await ctx.progSalvarVeiculoNoBanco('EQB', D, { placa: 'XYZ9A88', modelo: 'M' }, 1);
  p = chamadas[0].p;
  ok('sem _extras trocando a placa de equipe compartilhada: desfaz o vínculo', p.compartilhado_com_equipe_id === null && p.placa === 'XYZ9A88' && !('carreta_tipo' in p), p);

  prepBanco({ id: 'r1', placa: 'ABC-1D23', slot: 1, compartilhado_com_equipe_id: 'EQA' });
  await ctx.progSalvarVeiculoNoBanco('EQB', D, { placa: 'ABC1D23', modelo: 'M' }, 1);
  p = chamadas[0].p;
  ok('sem _extras mesma placa: vínculo mantido (não envia)', !('compartilhado_com_equipe_id' in p), p);

  prepBanco({ id: 'r2', placa: 'MOT1A11', slot: 2 });
  await ctx.progSalvarVeiculoNoBanco('EQB', D, { _extras: true, placa: 'MOT1A11', compartilhado_com_equipe_id: 'EQA', carreta_tipo: 'compressor', carreta_placa: 'QWE1R23' }, 2);
  p = chamadas[0].p;
  ok('slot 2 (Moto Dupla) nunca envia extras', !('compartilhado_com_equipe_id' in p) && !('carreta_tipo' in p), p);

  prepBanco(null);
  okS = await ctx.progSalvarVeiculoNoBanco('EQB', D, { _extras: true, placa: 'ABC1D23', compartilhado_com_equipe_id: 'EQA', carreta_tipo: null }, 1);
  p = chamadas[0];
  ok('linha nova: upsert com extras', okS && p.op === 'upsert' && p.p.compartilhado_com_equipe_id === 'EQA' && p.p.equipe_id === 'EQB', p);

  const errTrigger = JSON.stringify({ code: '23514', message: 'A equipe EQA já compartilha o veículo ABC1D23 com a equipe EQC.' });
  prepBanco({ id: 'r1', placa: 'ABC1D23', slot: 1 }, errTrigger);
  okS = await ctx.progSalvarVeiculoNoBanco('EQB', D, { _extras: true, placa: 'ABC1D23', compartilhado_com_equipe_id: 'EQA' }, 1);
  ok('recusa do banco: falha e mensagem da regra', okS === false && /já compartilha/.test(ctx.window._progVeicUltimoErro), ctx.window._progVeicUltimoErro);

  prepBanco({ id: 'r1', placa: 'ABC1D23', slot: 1 }, JSON.stringify({ message: 'new row for relation "prog_veiculos_dia" violates check constraint "prog_veiculos_dia_carreta_placa_chk"' }));
  okS = await ctx.progSalvarVeiculoNoBanco('EQB', D, { _extras: true, placa: 'ABC1D23', carreta_tipo: 'compressor', carreta_placa: 'X' }, 1);
  ok('recusa por regra de placa: mensagem traduzida', okS === false && ctx.window._progVeicUltimoErro === 'Placa da carreta inválida.', ctx.window._progVeicUltimoErro);

  prepBanco({ id: 'r1', placa: 'ABC1D23', slot: 1 }, JSON.stringify({ message: 'JWT expired' }));
  await ctx.progSalvarVeiculoNoBanco('EQB', D, { _extras: true, placa: 'ABC1D23' }, 1);
  ok('erro técnico: sem mensagem (usa a genérica)', ctx.window._progVeicUltimoErro === '', ctx.window._progVeicUltimoErro);

  prepBanco({ id: 'r1', placa: 'ABC1D23', slot: 1 });
  ctx.window._sbLastUpsertErr = 'antigo'; sync();
  await ctx.progSalvarVeiculoNoBanco('EQB', D, { _extras: true, placa: 'ABC1D23' }, 1);
  ok('erro anterior é limpo antes de gravar', ctx.window._sbLastUpsertErr === '' && ctx.window._progVeicUltimoErro === '');

  // ── Ligação no index.html ──────────────────────────────────────────
  const modal = fn('progAbrirSelecionarVeiculo');
  ok('modal: extras só em Projetos e fora da Moto 2', /var _pvExtras = _pvEhProj && slot!=='b'/.test(modal) && /!\(equipes_disp\|\|\[\]\)\.some/.test(modal));
  ok('modal: verifica colunas antes de mostrar', /progVeicExtrasVerificar\(\)\.then/.test(modal));
  ok('modal: grava no banco antes da memória', /progSalvarVeiculoNoBanco\(eqId, data, Object\.assign\(\{_extras:true\}, _veicPayload\), 1\)\.then\(function\(okX\)\{\s*return okX \? progSetVeiculo/.test(modal));
  ok('modal: mostra mensagem do banco', /window\._progVeicUltimoErro\|\|'Erro ao salvar veículo no banco/.test(modal));
  ok('modal: TMA mantém a checagem de conflito antiga', /if\(!_extrasSel\) Object\.keys\(_progVeiculos\)\.forEach/.test(modal) && /if\(!_cmp\) Object\.keys\(_progVeiculos\)\.forEach/.test(modal));
  ok('carregamento TMA e Projetos usam os campos novos', (html.match(/=\s*progVeicObjDaLinha\(r\);/g) || []).length === 2);
  ok('remover avisa e desfaz compartilhamento', /O compartilhamento com '\+progVeicNomeEquipe\(_parcRem\)\+' será desfeito/.test(fn('progRemoverVeiculo')));
  ok('sbUpsert guarda o erro', /window\._sbLastUpsertErr=resUp\.text/.test(html));
  ok('migration versionada existe', fs.existsSync(path.join(raiz, 'supabase', 'migrations', '20261005170000_prog_veiculos_compartilhado_carreta.sql')));

  // ── Escopo: TMA e Portaria intactas ─────────────────────────────
  let base = '';
  try { base = execSync('git show HEAD:index.html', { cwd: raiz, maxBuffer: 64 * 1024 * 1024 }).toString('utf8').replace(/\r\n/g, '\n'); } catch (e) { base = ''; }
  if (base) {
    const nomes = new Set();
    const reN = /\nfunction ((?:progTma|port)\w*)\(/g;
    let m;
    while ((m = reN.exec(base))) nomes.add(m[1]);
    let iguais = 0, difs = [];
    nomes.forEach(n => {
      let a, b;
      try { a = fnDe(base, n); b = fnDe(html, n); } catch (e) { return; }
      if (a === b) iguais++; else difs.push(n);
    });
    ok('funções progTma* e port* (Portaria) sem alteração', difs.length === 0 && iguais > 50, { difs, iguais });
  }

  // ── Versão ──────────────────────────────────────────────────────
  const patch = (re, s) => { const m = re.exec(s); return m ? Number(m[1]) : -1; };
  ok('APP_VERSAO >= 8.1.210 com o log da 8.1.210', patch(/numero: '8\.1\.(\d+)'/, html) >= 210 && /\{v:'8\.1\.210'/.test(html));
  ok('scripts ?v= sem 8.1.209', html.split('?v=8.1.209"').length - 1 === 0);
  ok('SW_VERSION >= 8.1.210', patch(/const SW_VERSION\s+= 'cena-8\.1\.(\d+)'/, sw) >= 210);

  console.log(`prog-veic-compart-carreta: ${total - falhas}/${total} ok`);
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
