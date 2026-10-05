// 8.1.208 — Programação TMA e Projetos: VW Delivery Express aceita motorista com CNH B (mínimo B).
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

// 1. Regra compartilhada
trocar(html, 'cnhCompatibilidadeVeiculo',
`// ─── COMPATIBILIDADE CNH x VEÍCULO ──────────────────────────────
// Retorna: 'ok' | 'bloqueado' | 'justificativa'
function cnhCompatibilidadeVeiculo(cnhCat, tipoVeiculo){
  if(!tipoVeiculo) return 'ok'; // sem veículo definido, não bloquear
  var cnh = (cnhCat||'').toUpperCase().trim();
  var tipo = (tipoVeiculo||'').toLowerCase();
`,
`// ─── COMPATIBILIDADE CNH x VEÍCULO ──────────────────────────────
/** VW Delivery Express (PBT 3,5 t) pode ser dirigido com CNH B; os demais Delivery (4.160, 9.170, 11.180…) seguem a regra de caminhão. */
function cnhVeiculoEhDeliveryExpress(veic){
  if(!veic) return false;
  var txt = typeof veic==='string' ? veic
    : [veic.tipo, veic.tipo_operacional, veic.modelo].map(function(x){ return String(x||''); }).join(' ');
  return /delivery\\s*express/i.test(txt);
}
// Retorna: 'ok' | 'bloqueado' | 'justificativa'
function cnhCompatibilidadeVeiculo(cnhCat, tipoVeiculo, veic){
  var cnh = (cnhCat||'').toUpperCase().trim();
  if(cnhVeiculoEhDeliveryExpress(veic) || cnhVeiculoEhDeliveryExpress(tipoVeiculo||'')){
    return /[BCDE]/.test(cnh) ? 'ok' : 'bloqueado'; // mínimo B; só A ou sem CNH não
  }
  if(!tipoVeiculo) return 'ok'; // sem veículo definido, não bloquear
  var tipo = (tipoVeiculo||'').toLowerCase();
`);

// 2. TMA — menu do colaborador (caixa "Motorista do dia")
trocar(html, 'TMA menu slot',
`      ? cnhCompatibilidadeVeiculo(cnh, tipoVeic)
      : 'ok';`,
`      ? cnhCompatibilidadeVeiculo(cnh, tipoVeic, veic)
      : 'ok';`);

// 3. TMA — gravação do motorista
trocar(html, 'progDefinirMotorista',
`      if(fv) tipo = fv.tipo||'';
    }

    var compat = cnhCompatibilidadeVeiculo(cnh, tipo);
`,
`      if(fv) tipo = fv.tipo||'';
    }
    var veicCad = veic && veic.id ? ((frt_veiculos||[]).find(function(v){return v.id===veic.id;})||veic) : veic;

    var compat = cnhCompatibilidadeVeiculo(cnh, tipo, veicCad);
`);

// 4. Projetos — menu do colaborador
trocar(html, 'Projetos menu slot',
`    var veicKey = Object.keys(CNH_COMPAT).find(function(k){ return tipoVeic.includes(k); });
    var compat = !veic ? true : (veicKey ? CNH_COMPAT[veicKey].indexOf(cnh)>=0 : !!cnh);`,
`    var veicKey = Object.keys(CNH_COMPAT).find(function(k){ return tipoVeic.includes(k); });
    var ehDeliveryExpress = cnhVeiculoEhDeliveryExpress(veic);
    if(ehDeliveryExpress) veicKey = 'delivery express';
    var compat = !veic ? true
      : ehDeliveryExpress ? cnhCompatibilidadeVeiculo(cnh, tipoVeic, veic)!=='bloqueado'
      : (veicKey ? CNH_COMPAT[veicKey].indexOf(cnh)>=0 : !!cnh);`);

// 5. Projetos — gravação do motorista
trocar(html, 'progProjetoCoreDefinirMotorista',
`    var compat = veic ? cnhCompatibilidadeVeiculo(cnh, tipo) : 'ok';`,
`    var veicCad = veic && veic.id ? ((frt_veiculos||[]).find(function(v){return v.id===veic.id;})||veic) : veic;
    var compat = veic ? cnhCompatibilidadeVeiculo(cnh, tipo, veicCad) : 'ok';`);

// 6. Versão
trocar(html, 'APP_VERSAO',
`  numero: '8.1.207',
  data:   '05/10/2026',
  build:  '20261005-1205',
  log: [
`,
`  numero: '8.1.208',
  data:   '05/10/2026',
  build:  '20261005-1540',
  log: [
    {v:'8.1.208', d:'05/10/2026', itens:[
      'Programação de Equipes TMA e Programação de Projetos: veículo VW Delivery Express (reconhecido por "Delivery Express" no tipo, tipo operacional ou modelo do cadastro da frota) aceita motorista do dia com CNH B ou superior; só categoria A ou sem CNH continua bloqueado. Os demais caminhões, inclusive os outros Delivery (4.160, 9.170, 11.180), continuam exigindo C ou superior. Sem SQL.',
    ]},
`);

trocar(html, 'script ?v=', '?v=8.1.207"', '?v=8.1.208"', 7);
trocar(sw, 'SW_VERSION', "const SW_VERSION   = 'cena-8.1.207';", "const SW_VERSION   = 'cena-8.1.208';");

salvar(ARQ, html);
salvar(ARQ_SW, sw);
console.log('gravado: ' + ARQ + ' (' + (html.crlf ? 'CRLF' : 'LF') + '), ' + ARQ_SW + ' (' + (sw.crlf ? 'CRLF' : 'LF') + ')');
