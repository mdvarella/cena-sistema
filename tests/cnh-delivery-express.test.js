'use strict';
// 8.1.208 — VW Delivery Express aceita motorista com CNH B (TMA e Projetos). Executa as funções reais do index.html.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
let falhas = 0, total = 0;
function ok(nome, cond, extra) {
  total++;
  if (!cond) { falhas++; console.error('FALHOU: ' + nome + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); }
}
function fn(nome) {
  const re = new RegExp('\\n(?:async )?function ' + nome + '\\(');
  const n = html.split(re).length - 1;
  if (n !== 1) throw new Error('definição de ' + nome + ': ' + n);
  const ini = html.search(re) + 1;
  return html.slice(ini, html.indexOf('\n}\n', ini) + 2);
}

const ctx = { console };
vm.createContext(ctx);
vm.runInContext(fn('cnhVeiculoEhDeliveryExpress') + fn('cnhCompatibilidadeVeiculo'), ctx);
const compat = (cnh, tipo, veic) => ctx.cnhCompatibilidadeVeiculo(cnh, tipo, veic);

// ── reconhecimento ────────────────────────────────────────────────
const DX_MODELO = { tipo: 'Caminhão', modelo: 'VW Delivery Express' };
const DX_TIPO = { tipo: 'Delivery Express', modelo: '' };
const DX_OPER = { tipo: '', tipo_operacional: 'Caminhão Delivery  Express', modelo: '' };
ok('reconhece pelo modelo', ctx.cnhVeiculoEhDeliveryExpress(DX_MODELO));
ok('reconhece pelo tipo', ctx.cnhVeiculoEhDeliveryExpress(DX_TIPO));
ok('reconhece pelo tipo operacional (espaços extras)', ctx.cnhVeiculoEhDeliveryExpress(DX_OPER));
ok('reconhece texto', ctx.cnhVeiculoEhDeliveryExpress('caminhão delivery express'));
ok('Delivery 9.170 não é Express', !ctx.cnhVeiculoEhDeliveryExpress({ tipo: 'Caminhão', modelo: 'VW Delivery 9.170' }));
ok('Delivery 11.180 não é Express', !ctx.cnhVeiculoEhDeliveryExpress({ tipo: 'Caminhão', modelo: 'Delivery 11.180' }));
ok('sem veículo', !ctx.cnhVeiculoEhDeliveryExpress(null));

// ── Delivery Express: mínimo B ────────────────────────────────────
['B', 'AB', 'C', 'AC', 'D', 'AD', 'E', 'AE', 'b'].forEach(c =>
  ok('Delivery Express + CNH ' + c + ' = ok', compat(c, 'caminhão', DX_MODELO) === 'ok', compat(c, 'caminhão', DX_MODELO)));
['A', '', 'Não', '-'].forEach(c =>
  ok('Delivery Express + CNH "' + c + '" = bloqueado', compat(c, 'caminhão', DX_MODELO) === 'bloqueado', compat(c, 'caminhão', DX_MODELO)));
ok('Delivery Express pelo texto do tipo (sem objeto)', compat('B', 'delivery express') === 'ok');
ok('Delivery Express com tipo vazio ainda exige B', compat('A', '', DX_MODELO) === 'bloqueado' && compat('B', '', DX_MODELO) === 'ok');

// ── regras antigas intactas ───────────────────────────────────────
ok('caminhão comum + B = bloqueado', compat('B', 'caminhão', { tipo: 'Caminhão', modelo: 'Atego 1719' }) === 'bloqueado');
ok('Delivery 9.170 + B = bloqueado', compat('B', 'caminhão', { tipo: 'Caminhão', modelo: 'VW Delivery 9.170' }) === 'bloqueado');
ok('caminhão + C = ok', compat('C', 'caminhão') === 'ok');
ok('cesto + B = bloqueado', compat('B', 'cesto aéreo') === 'bloqueado');
ok('moto + B = bloqueado', compat('B', 'moto') === 'bloqueado');
ok('moto + AB = ok', compat('AB', 'moto') === 'ok');
ok('caminhonete + B = ok', compat('B', 'caminhonete') === 'ok');
ok('caminhonete + D = justificativa', compat('D', 'caminhonete') === 'justificativa');
ok('sem tipo e sem veículo = ok', compat('', '') === 'ok');

// ── chamadas passam o cadastro do veículo ─────────────────────────
ok('TMA menu passa veic', html.includes('? cnhCompatibilidadeVeiculo(cnh, tipoVeic, veic)'));
ok('progDefinirMotorista passa cadastro', fn('progDefinirMotorista').includes('cnhCompatibilidadeVeiculo(cnh, tipo, veicCad)'));
ok('Projetos gravação passa cadastro', fn('progProjetoCoreDefinirMotorista').includes('cnhCompatibilidadeVeiculo(cnh, tipo, veicCad)'));
const slotPP = fn('progProjetoCoreMenuSlot');
ok('Projetos menu usa a regra compartilhada para Delivery Express',
  slotPP.includes('ehDeliveryExpress ? cnhCompatibilidadeVeiculo(cnh, tipoVeic, veic)!==\'bloqueado\''));
ok('nenhuma chamada sem o cadastro do veículo', !/cnhCompatibilidadeVeiculo\(cnh, tipo\)/.test(html) && !/cnhCompatibilidadeVeiculo\(cnh, tipoVeic\)/.test(html));

// ── gravação real do motorista (TMA e Projetos) ───────────────────
function rodarDefinir(nomeFn, cnhCat, veicCad) {
  const toasts = [];
  const comp = { id: 'c1', equipe_id: 'e1', data: '2026-10-06', colaborador_ids: '["m1"]', motorista_id: null };
  const chk = { checked: true };
  const c = {
    console, toasts,
    composicao_dia: [comp],
    colaboradores: [{ id: 'm1', nome: 'MOTORISTA TESTE', cnh_categoria: cnhCat }],
    frt_veiculos: [veicCad],
    progGetData: () => '2026-10-06',
    progProjGetData: () => '2026-10-06',
    progFindCompDia: () => comp,
    progGetVeiculo: () => ({ id: veicCad.id, placa: 'ABC1D23', modelo: '' }),
    progShowToast: m => toasts.push(m),
    prompt: () => null,
    fmdAvaliarCnh: () => null,
    document: { querySelector: () => chk, getElementById: () => chk },
    sbUpdate: () => Promise.resolve(), sbFetch: () => Promise.resolve([]),
    setTimeout: () => 0,
  };
  vm.createContext(c);
  vm.runInContext(fn('cnhVeiculoEhDeliveryExpress') + fn('cnhCompatibilidadeVeiculo') + fn(nomeFn), c);
  try { vm.runInContext(nomeFn + "('m1','e1',true);", c); } catch (e) { /* passos após a validação dependem do restante da tela */ }
  return { bloqueou: toasts.some(t => t.indexOf('🚫') === 0), chk };
}
const VEIC_DX = { id: 'v1', tipo: 'Caminhão', modelo: 'VW Delivery Express', placa: 'ABC1D23' };
const VEIC_ATEGO = { id: 'v2', tipo: 'Caminhão', modelo: 'Atego 1719', placa: 'ABC1D23' };
for (const f of ['progDefinirMotorista', 'progProjetoCoreDefinirMotorista']) {
  let r = rodarDefinir(f, 'B', VEIC_DX);
  ok(f + ': CNH B no Delivery Express não bloqueia', !r.bloqueou && r.chk.checked === true);
  r = rodarDefinir(f, 'A', VEIC_DX);
  ok(f + ': CNH A no Delivery Express bloqueia', r.bloqueou && r.chk.checked === false);
  r = rodarDefinir(f, 'B', VEIC_ATEGO);
  ok(f + ': CNH B em caminhão comum continua bloqueada', r.bloqueou);
}

// ── versão ────────────────────────────────────────────────────────
const num = (html.match(/numero: '([\d.]+)'/) || [])[1];
ok('versão >= 8.1.208', Number(String(num).split('.')[2]) >= 208, num);
ok('changelog 8.1.208', html.includes("{v:'8.1.208'"));
ok('sw.js acompanha a versão', sw.includes("const SW_VERSION   = 'cena-" + num + "';"));

console.log('cnh-delivery-express: ' + (total - falhas) + '/' + total);
process.exit(falhas ? 1 : 0);
