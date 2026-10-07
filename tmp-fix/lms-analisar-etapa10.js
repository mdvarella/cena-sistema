'use strict';
// Etapa 1.0 — análise somente leitura do Modelo LMS.xlsx (não altera o arquivo).
const path = require('path');
const XLSX = require(path.join(process.env.TEMP, 'cena-lms-parse', 'node_modules', 'xlsx'));
const arq = process.argv[2];
const modo = process.argv[3] || 'abas';
const wb = XLSX.readFile(arq, { cellFormula: true, cellNF: true, cellStyles: false, sheetStubs: false });

if (modo === 'abas') {
  wb.SheetNames.forEach((n, i) => {
    const ws = wb.Sheets[n];
    const ref = ws['!ref'] || '';
    const merges = (ws['!merges'] || []).length;
    let formulas = 0, celulas = 0;
    Object.keys(ws).forEach(k => { if (k[0] === '!') return; celulas++; if (ws[k].f) formulas++; });
    const vis = wb.Workbook && wb.Workbook.Sheets && wb.Workbook.Sheets[i] ? wb.Workbook.Sheets[i].Hidden : 0;
    console.log(JSON.stringify({ i, nome: n, ref, celulas, formulas, merges, oculta: vis }));
  });
} else if (modo === 'topo') {
  const aba = process.argv[4];
  const n = Number(process.argv[5] || 40);
  const ws = wb.Sheets[aba];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: true, raw: true });
  aoa.slice(0, n).forEach((r, i) => {
    let ult = r.length - 1;
    while (ult >= 0 && (r[ult] === '' || r[ult] == null)) ult--;
    console.log(String(i + 1).padStart(4) + ' | ' + r.slice(0, ult + 1).map(v => (typeof v === 'string' ? JSON.stringify(v) : String(v))).join(' | '));
  });
  console.log('total linhas: ' + aoa.length);
} else if (modo === 'stats') {
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: true, raw: true });
  const cab = aoa[2].slice(0, 14).map(String);
  const conta = (o, k) => { o[k] = (o[k] || 0) + 1; };
  const tipo = v => v === '' ? 'vazio' : typeof v;
  const s = { cab, merges: (ws['!merges'] || []).map(m => XLSX.utils.encode_range(m)), linhasDados: 0, ultimaLinhaDados: 0, vazias: 0,
    wl: {}, wlTipo: {}, ctg: {}, ft: {}, codTipo: {}, codForma: {}, kitForma: {}, umd: {}, planTipo: {}, realTipo: {},
    planZeroRealPos: [], planPosRealZero: [], planDifReal: [], semCodigo: [], semQtd: [], ups: { tipo: {}, exemplos: [] }, vf: { tipo: {} }, vfp: { tipo: {} },
    estorno: {}, adicionais: {}, colsExtras: {}, dupWlCodFt: 0, dupWlCodFtKit: 0, dupExemplos: [], codEmVariasWl: 0, matVsServ: { material: 0, servico: 0, outro: 0 },
    servicoPrefixo: {}, kitPrefixoMaterial: {}, kitPrefixoServico: {} };
  const chave3 = {}, chave4 = {}, codWls = {};
  for (let i = 3; i < aoa.length; i++) {
    const r = aoa[i];
    const nucleo = r.slice(0, 14);
    if (nucleo.every(v => v === '' || v == null)) { s.vazias++; continue; }
    s.linhasDados++; s.ultimaLinhaDados = i + 1;
    const [wl, ctg, ft, cod, kit, umd, desc, plan, real, ups, vf, vfp, est, adi] = nucleo;
    conta(s.wl, String(wl)); conta(s.wlTipo, tipo(wl)); conta(s.ctg, String(ctg)); conta(s.ft, String(ft));
    conta(s.codTipo, tipo(cod)); conta(s.umd, String(umd)); conta(s.planTipo, tipo(plan)); conta(s.realTipo, tipo(real));
    const codS = String(cod).trim();
    const forma = codS === '' ? 'vazio' : /^\d+$/.test(codS) ? 'numerico(' + codS.length + ')' : /^[IR]-/.test(codS) ? 'servico ' + codS.slice(0, 2) : 'outro';
    conta(s.codForma, forma);
    const ehMat = /^\d+$/.test(codS), ehServ = /^[A-Z]-/.test(codS);
    s.matVsServ[ehMat ? 'material' : ehServ ? 'servico' : 'outro']++;
    if (ehServ) conta(s.servicoPrefixo, codS.split('-')[0] + '-' + codS.split('-')[1].replace(/\d+$/, ''));
    const kitS = String(kit).trim();
    const kp = kitS === '' ? 'vazio' : kitS.split('-')[0] + '-';
    conta(s.kitForma, kp);
    if (ehMat) conta(s.kitPrefixoMaterial, kp); if (ehServ) conta(s.kitPrefixoServico, kp);
    if (codS === '') s.semCodigo.push(i + 1);
    const p = typeof plan === 'number' ? plan : Number(String(plan).replace(/\./g, '').replace(',', '.')) || 0;
    const q = typeof real === 'number' ? real : Number(String(real).replace(/\./g, '').replace(',', '.')) || 0;
    if (plan === '' && real === '') s.semQtd.push(i + 1);
    if (p === 0 && q > 0) s.planZeroRealPos.push(i + 1);
    if (p > 0 && q === 0) s.planPosRealZero.push(i + 1);
    if (p !== q) s.planDifReal.push({ l: i + 1, plan, real });
    conta(s.ups.tipo, tipo(ups)); if (ups !== '' && s.ups.exemplos.length < 8) s.ups.exemplos.push(ups);
    conta(s.vf.tipo, tipo(vf)); conta(s.vfp.tipo, tipo(vfp));
    conta(s.estorno, est === '' ? 'vazio' : String(est)); conta(s.adicionais, adi === '' ? 'vazio' : String(adi));
    for (let c = 14; c < r.length; c++) if (r[c] !== '' && r[c] != null && c !== 17 && c !== 20) conta(s.colsExtras, XLSX.utils.encode_col(c));
    const k3 = [wl, codS.toUpperCase(), String(ft).toUpperCase()].join('|');
    const k4 = k3 + '|' + kitS.toUpperCase();
    if (chave3[k3]) s.dupWlCodFt++; chave3[k3] = (chave3[k3] || 0) + 1;
    if (chave4[k4]) { s.dupWlCodFtKit++; if (s.dupExemplos.length < 10) s.dupExemplos.push({ l: i + 1, k4, plan, real }); } chave4[k4] = (chave4[k4] || 0) + 1;
    (codWls[codS] = codWls[codS] || new Set()).add(String(wl));
  }
  s.codEmVariasWl = Object.values(codWls).filter(x => x.size > 1).length;
  s.codigosDistintos = Object.keys(codWls).length;
  s.wlDistintas = Object.keys(s.wl).length;
  s.planDifRealQtd = s.planDifReal.length; s.planDifReal = s.planDifReal.slice(0, 15);
  s.planZeroRealPosQtd = s.planZeroRealPos.length; s.planZeroRealPos = s.planZeroRealPos.slice(0, 15);
  s.planPosRealZeroQtd = s.planPosRealZero.length; s.planPosRealZero = s.planPosRealZero.slice(0, 15);
  s.semCodigoQtd = s.semCodigo.length; s.semCodigo = s.semCodigo.slice(0, 15);
  s.semQtdQtd = s.semQtd.length; s.semQtd = s.semQtd.slice(0, 15);
  const listaR = aoa.map(r => r[17]).filter(v => v !== '' && v != null).length;
  const listaU = aoa.map(r => r[20]).filter(v => v !== '' && v != null).length;
  s.colunaR_preenchidas = listaR; s.colunaU_preenchidas = listaU;
  if (Object.keys(s.wl).length > 60) { const w = s.wl; s.wl = { amostra: Object.keys(w).slice(0, 30), total: Object.keys(w).length }; }
  console.log(JSON.stringify(s, null, 1));
} else if (modo === 'celulas') {
  const aba = process.argv[4];
  const faixa = process.argv[5];
  const ws = wb.Sheets[aba];
  const r = XLSX.utils.decode_range(faixa);
  for (let R = r.s.r; R <= r.e.r; R++) {
    const lin = [];
    for (let C = r.s.c; C <= r.e.c; C++) {
      const a = XLSX.utils.encode_cell({ r: R, c: C });
      const c = ws[a];
      if (!c) continue;
      lin.push(a + '=' + c.t + ':' + JSON.stringify(c.v) + (c.f ? ' f[' + c.f.slice(0, 60) + ']' : '') + (c.z && c.z !== 'General' ? ' z[' + c.z + ']' : ''));
    }
    if (lin.length) console.log(lin.join('  '));
  }
}
