'use strict';
// PORTARIA 8.1.182 — KM digitado com ponto de milhar ("32.942") era gravado só com os primeiros dígitos (32):
// o campo era type=number (ponto = decimal) e a gravação usava parseInt. Casos reais de 30/09 no tablet
// "Portaria Coaquira 1": STM6J35 32 (último 32.942), TJC9A62 25 (25.614), DZH7G12 64 (64.655), RTQ7D65 13 (139.124).
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
const consts = (html.match(/\nvar PORT_KM_MIN_PLAUSIVEL=[^\n]*/) || [''])[0];
ok('constantes do KM incompleto', /PORT_KM_MIN_PLAUSIVEL=1000, PORT_KM_REF_INCOMPLETO=10000;/.test(consts), consts);

const CODIGO = consts + '\n' + ['portKmLerValor', 'portKmIncompleto', 'portKmMsgIncompleto', 'portKmValidarAlertas', 'portKmValidarRetorno',
  'portKmTextoConfirmacao', 'portKmConfirmarDivergencia'].map(fn).join('\n');

function sandbox(o) {
  const ctx = {
    console, toasts: [], confirms: [],
    PORT_KM_SALTO_ALERTA: 2000, PORT_KM_CONF_BAIXA: 0.6,
    portKmSaidaAbertaSemRetorno: () => o.aberta || null,
    portKmUltimoRegistrado: () => o.ultimo || 0,
    portKmFaixaRetorno: s => ({ min: parseFloat(s && s.km_saida) || 0, max: o.max != null ? o.max : null, prox: null }),
    fmtDT: d => String(d),
  };
  ctx.progShowToast = (m, t) => ctx.toasts.push([m, t]);
  ctx.confirm = m => { ctx.confirms.push(m); return true; };
  vm.createContext(ctx);
  vm.runInContext(CODIGO, ctx);
  return ctx;
}

// Leitura do número
const L = sandbox({}).portKmLerValor;
const casos = [
  ['32.942', 32942], ['32,942', 32942], ['32942', 32942], [' 32942 ', 32942], ['1.391.242', 1391242], ['139.124', 139124],
  ['32942,5', 32942], ['32942.5', 32942], ['0', 0], ['', 0], [null, 0], ['abc', 0], ['32.94.2', 0], ['139.1242', 0], ['-5', 0],
  [32942, 32942], [32942.7, 32942],
];
casos.forEach(([e, esp]) => ok('ler ' + JSON.stringify(e) + ' = ' + esp, L(e) === esp, L(e)));

// Saída: casos reais
for (const [digitado, ultimo] of [['32', 32942], ['25', 25614], ['64', 64655], ['13', 139124], ['646', 64655]]) {
  const c = sandbox({ ultimo });
  const v = c.portKmValidarAlertas('PLACA', digitado, null);
  ok('saída ' + digitado + ' com última ' + ultimo + ' bloqueia', v.bloqueia === true && /incompleto/.test(v.msgBloqueio), v);
  ok('saída ' + digitado + ': não abre confirmação (bloqueio)', c.portKmConfirmarDivergencia(v, digitado, 'saída') === false && c.confirms.length === 0 && /incompleto/.test(c.toasts[0][0]), c.toasts);
}
{
  const c = sandbox({ ultimo: 32942 });
  const v = c.portKmValidarAlertas('PLACA', '32.990', null);
  ok('saída "32.990" lida como 32990, sem alerta', v.ok === true && !v.bloqueia, v);
  ok('gravação lê o mesmo valor que a validação', L('32.990') === 32990);
}
{
  const c = sandbox({ ultimo: 32942, aberta: { km_saida: 32900, equipe: 'EBN344', data_saida: 'x' } });
  const v = c.portKmValidarAlertas('PLACA', '32', null);
  ok('com saída aberta, a mensagem do toast é a do bloqueio (não a da saída aberta)', c.portKmConfirmarDivergencia(v, '32', 'saída') === false && /incompleto/.test(c.toasts[0][0]), c.toasts);
}
{
  const c = sandbox({ ultimo: 32942 });
  const v = c.portKmValidarAlertas('PLACA', '32.94', null);
  ok('"32.94" (vira 32) bloqueia', v.bloqueia && /incompleto/.test(v.msgBloqueio), v);
  const v2 = c.portKmValidarAlertas('PLACA', '139.1242', null);
  ok('texto inválido bloqueia com mensagem própria', v2.bloqueia && /KM inválido \(139\.1242\)/.test(v2.msgBloqueio), v2.msgBloqueio);
  const v3 = c.portKmValidarAlertas('PLACA', '', null);
  ok('vazio: "Informe o KM"', v3.bloqueia && v3.msgBloqueio === 'Informe o KM do odômetro.', v3.msgBloqueio);
}
{
  const c = sandbox({ ultimo: 1 });
  const v = c.portKmValidarAlertas('PLACA', '35', null);
  ok('base redefinida para 1: KM pequeno não é barrado como incompleto', !v.bloqueia, v);
  const c2 = sandbox({ ultimo: 0 });
  ok('placa sem histórico: não barra', !c2.portKmValidarAlertas('PLACA', '500', null).bloqueia);
  const c3 = sandbox({ ultimo: 32942 });
  const v3 = c3.portKmValidarAlertas('PLACA', '30000', null);
  ok('menor que a última mas com dígitos completos: só confirma', !v3.bloqueia && v3.msgs.some(m => /menor que a última KM/.test(m)), v3);
  ok('confirmação mostra o número inteiro que será gravado', c3.portKmConfirmarDivergencia(v3, '30.000', 'saída') === true && /KM informado: 30\.000/.test(c3.confirms[0]), c3.confirms[0]);
}

// Retorno
{
  const c = sandbox({ ultimo: 32942 });
  const v = c.portKmValidarRetorno({ placa: 'P', km_saida: 32942 }, '33');
  ok('retorno 33 com saída 32.942 bloqueia', v.bloqueia && /retorno incompleto/.test(v.msgBloqueio), v);
  const v2 = c.portKmValidarRetorno({ placa: 'P', km_saida: 32942 }, '33.020');
  ok('retorno "33.020" = 33020, ok', v2.ok && !v2.bloqueia, v2);
  const c2 = sandbox({ ultimo: 32 });
  const v3 = c2.portKmValidarRetorno({ placa: 'P', km_saida: 32 }, '33020');
  ok('retorno da saída gravada com 32 aceita o KM real', v3.ok && !v3.bloqueia, v3);
  const v4 = c2.portKmValidarRetorno({ placa: 'P', km_saida: 32 }, 'x');
  ok('retorno inválido bloqueia', v4.bloqueia && /inválido/.test(v4.msgBloqueio), v4);
}

// Campos e pontos de gravação
ok('widget de KM é texto com teclado numérico', /id="'\+inputId\+'" type="text" inputmode="numeric"/.test(html));
ok('KM de retorno é texto com teclado numérico', /id="ret-km" type="text" inputmode="numeric"/.test(html));
for (const id of ['ret-km', 'port-chk-km', 'rsv-lib-km', 'lib-eq-km']) {
  ok(id + ' lido com portKmLerValor', html.includes("portKmLerValor((document.getElementById('" + id + "')||{}).value)"));
  ok(id + ' sem parseInt', !new RegExp("parseInt\\(\\(+document\\.getElementById\\('" + id + "'\\)").test(html));
}
ok('versão 8.1.182 no log', html.includes("{v:'8.1.182'"));
const numAtual = (html.match(/numero:\s*'([\d.]+)'/) || [])[1];
ok('sw.js acompanha a versão atual', !!numAtual && sw.includes("SW_VERSION   = 'cena-" + numAtual + "'"), numAtual);

if (failed.length) { console.error('FALHOU ' + failed.length + '/' + total + ':\n - ' + failed.join('\n - ')); process.exit(1); }
console.log('portaria-km-digitos: OK ' + total + ' checagens');
