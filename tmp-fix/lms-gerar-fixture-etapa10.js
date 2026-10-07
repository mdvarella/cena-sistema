'use strict';
// Etapa 1.0 — gera a cópia anonimizada do Modelo LMS.xlsx e o resumo esperado. Não altera o arquivo original.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const XLSX = require(path.join(process.env.TEMP, 'cena-lms-parse', 'node_modules', 'xlsx'));

const origem = process.argv[2];
const destDir = path.join(__dirname, '..', 'tests', 'fixtures', 'lms');
const wb = XLSX.readFile(origem, { cellNF: true, cellDates: false });
if (wb.SheetNames.length !== 1 || wb.SheetNames[0] !== 'Planilha1') throw new Error('layout inesperado: ' + wb.SheetNames.join(','));
const ws = wb.Sheets.Planilha1;

const D1 = ws.D1 && String(ws.D1.v);
if (!/^[A-Z]{3}\/[A-Z]\.[A-Z]{3}\.\d{2}\.\d{5}$/.test(D1 || '')) throw new Error('D1 inesperado: ' + D1);
ws.D1 = { t: 's', v: D1.replace(/\.\d{2}\.\d{5}$/, '.00.00001') };

let nR = 0, nU = 0;
const ref = XLSX.utils.decode_range(ws['!ref']);
for (let R = ref.s.r; R <= ref.e.r; R++) {
  for (const C of [17, 20]) {
    const a = XLSX.utils.encode_cell({ r: R, c: C });
    const c = ws[a];
    if (!c || c.v === '' || c.v == null) continue;
    if (C === 17) { nR++; ws[a] = { t: 's', v: 'PESSOA ANONIMA ' + String(nR).padStart(3, '0') }; }
    else { nU++; ws[a] = { t: 's', v: 'PESSOA ANONIMA ' + String(nU).padStart(3, '0') + ' R:' + String(nU).padStart(6, '0') }; }
  }
}
for (const k of Object.keys(ws)) {
  if (k[0] === '!') continue;
  const C = XLSX.utils.decode_cell(k).c;
  if (C > 13 && C !== 17 && C !== 20 && ws[k].v !== '' && ws[k].v != null) throw new Error('célula inesperada fora da tabela: ' + k);
}

fs.mkdirSync(destDir, { recursive: true });
const saida = path.join(destDir, 'modelo-lms-anonimizado.xlsx');
XLSX.writeFile(wb, saida, { bookType: 'xlsx' });

const aoa = XLSX.utils.sheet_to_json(XLSX.readFile(saida).Sheets.Planilha1, { header: 1, defval: '', blankrows: true, raw: true });
const num = v => typeof v === 'number' ? v : (String(v).trim() === '' ? null : Number(String(v).replace(/\./g, '').replace(',', '.')));
const linhas = [];
aoa.forEach((r, i) => {
  if (i < 3) return;
  const n = r.slice(0, 14);
  if (n.every(v => v === '' || v == null)) return;
  linhas.push({ linha: i + 1, wl: String(n[0]), ctg: n[1], ft: n[2], cod: n[3], kit: n[4], umd: n[5], plan: num(n[7]), real: num(n[8]), ups: num(n[9]), vf: num(n[10]), vfp: num(n[11]) });
});
const reais = linhas.filter(l => String(l.cod).trim() !== '');
const fantasma = linhas.filter(l => String(l.cod).trim() === '').map(l => l.linha);
const porWl = {};
reais.forEach(l => {
  const k = l.wl;
  const t = /^[IR]-/.test(String(l.cod)) ? 'servico' : 'material';
  porWl[k] = porWl[k] || { material_I: 0, material_R: 0, servico_I: 0, servico_R: 0, ups_total_real: 0 };
  porWl[k][t + '_' + l.ft]++;
  if (l.vf != null) porWl[k].ups_total_real = Math.round((porWl[k].ups_total_real + l.vf) * 1e6) / 1e6;
});
const k3 = {}, k4 = {};
let dup3 = 0, dup4 = 0;
reais.forEach(l => {
  const a = [l.wl, String(l.cod).toUpperCase(), l.ft].join('|'), b = a + '|' + String(l.kit).toUpperCase();
  if (k3[a]) dup3++; k3[a] = 1;
  if (k4[b]) dup4++; k4[b] = 1;
});
const resumo = {
  origem: 'Modelo LMS.xlsx (anonimizado)', aba: 'Planilha1', linha_cabecalho: 3, definicao_projeto_celula: 'D1',
  colunas: aoa[2].slice(0, 14),
  linhas_reais: reais.length, linhas_fantasma: fantasma,
  wls: Object.keys(porWl).length, por_wl: porWl,
  materiais: reais.filter(l => !/^[IR]-/.test(String(l.cod))).length,
  materiais_ft_R: reais.filter(l => !/^[IR]-/.test(String(l.cod)) && l.ft === 'R').length,
  servicos: reais.filter(l => /^[IR]-/.test(String(l.cod))).length,
  duplicados_wl_codigo_ft: dup3, duplicados_wl_codigo_ft_kit: dup4,
  plan_diferente_de_real: reais.filter(l => l.plan !== l.real).length,
};
fs.writeFileSync(path.join(destDir, 'modelo-lms-esperado.json'), JSON.stringify(resumo, null, 1) + '\n');
const sha = crypto.createHash('sha256').update(fs.readFileSync(saida)).digest('hex');
console.log(JSON.stringify({ saida, sha256: sha, anonimizadas_R: nR, anonimizadas_U: nU, linhas_reais: reais.length, fantasma, dup3, dup4 }));
