// 8.1.209 — Programação TMA e Projetos: veículo com "4x2" no modelo/tipo aceita CNH B (exceto cesto aéreo e munck).
import fs from 'node:fs';

const ARQ = 'index.html';
const ARQ_SW = 'sw.js';

function carregar(arq) {
  const bruto = fs.readFileSync(arq, 'utf8');
  const crlf = bruto.includes('\r\n');
  return { crlf, txt: crlf ? bruto.replace(/\r\n/g, '\n') : bruto };
}
function salvar(arq, { crlf, txt }) {
  fs.writeFileSync(arq, crlf ? txt.replace(/\n/g, '\r\n') : txt, 'utf8');
}
function trocar(doc, nome, de, para, esperado = 1) {
  const n = doc.txt.split(de).length - 1;
  if (n !== esperado) throw new Error(`${nome}: esperado ${esperado} ocorrência(s), achou ${n}`);
  doc.txt = doc.txt.split(de).join(para);
  console.log('ok  ' + nome + (esperado > 1 ? ` (${n}x)` : ''));
}

const html = carregar(ARQ);
const sw = carregar(ARQ_SW);

trocar(html, 'regra compartilhada',
`  return /delivery\\s*express/i.test(txt);
}
// Retorna: 'ok' | 'bloqueado' | 'justificativa'
function cnhCompatibilidadeVeiculo(cnhCat, tipoVeiculo, veic){
  var cnh = (cnhCat||'').toUpperCase().trim();
  if(cnhVeiculoEhDeliveryExpress(veic) || cnhVeiculoEhDeliveryExpress(tipoVeiculo||'')){
    return /[BCDE]/.test(cnh) ? 'ok' : 'bloqueado'; // mínimo B; só A ou sem CNH não
  }`,
`  return /delivery\\s*express/i.test(txt);
}
/** Veículo que aceita motorista com CNH B: Delivery Express ou "4x2" no tipo/tipo operacional/modelo, exceto cesto aéreo e munck. */
function cnhVeiculoAceitaCnhB(veic){
  if(!veic) return false;
  if(cnhVeiculoEhDeliveryExpress(veic)) return true;
  var txt = typeof veic==='string' ? veic
    : [veic.tipo, veic.tipo_operacional, veic.modelo].map(function(x){ return String(x||''); }).join(' ');
  if(/cesto|munck|munk/i.test(txt)) return false;
  return /(^|[^0-9])4\\s*x\\s*2([^0-9]|$)/i.test(txt);
}
// Retorna: 'ok' | 'bloqueado' | 'justificativa'
function cnhCompatibilidadeVeiculo(cnhCat, tipoVeiculo, veic){
  var cnh = (cnhCat||'').toUpperCase().trim();
  if(cnhVeiculoAceitaCnhB(veic) || cnhVeiculoAceitaCnhB(tipoVeiculo||'')){
    return /[BCDE]/.test(cnh) ? 'ok' : 'bloqueado'; // mínimo B; só A ou sem CNH não
  }`);

trocar(html, 'Projetos menu slot',
`    var ehDeliveryExpress = cnhVeiculoEhDeliveryExpress(veic);
    if(ehDeliveryExpress) veicKey = 'delivery express';
    var compat = !veic ? true
      : ehDeliveryExpress ? cnhCompatibilidadeVeiculo(cnh, tipoVeic, veic)!=='bloqueado'`,
`    var aceitaCnhB = cnhVeiculoAceitaCnhB(veic);
    if(aceitaCnhB) veicKey = cnhVeiculoEhDeliveryExpress(veic) ? 'delivery express' : '4x2';
    var compat = !veic ? true
      : aceitaCnhB ? cnhCompatibilidadeVeiculo(cnh, tipoVeic, veic)!=='bloqueado'`);

trocar(html, 'APP_VERSAO',
`  numero: '8.1.208',
  data:   '05/10/2026',
  build:  '20261005-1540',
  log: [
`,
`  numero: '8.1.209',
  data:   '05/10/2026',
  build:  '20261005-1555',
  log: [
    {v:'8.1.209', d:'05/10/2026', itens:[
      'Programação de Equipes TMA e Programação de Projetos: veículo com "4x2" no modelo, tipo ou tipo operacional do cadastro da frota também aceita motorista do dia com CNH B ou superior (só A ou sem CNH bloqueia). Cesto aéreo e munck continuam exigindo C ou superior mesmo sendo 4x2. Sem SQL.',
    ]},
`);

trocar(html, 'script ?v=', '?v=8.1.208"', '?v=8.1.209"', 7);
trocar(sw, 'SW_VERSION', "const SW_VERSION   = 'cena-8.1.208';", "const SW_VERSION   = 'cena-8.1.209';");

salvar(ARQ, html);
salvar(ARQ_SW, sw);
console.log('gravado: ' + ARQ + ' (' + (html.crlf ? 'CRLF' : 'LF') + '), ' + ARQ_SW + ' (' + (sw.crlf ? 'CRLF' : 'LF') + ')');
