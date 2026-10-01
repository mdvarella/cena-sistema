'use strict';
// SOT 8.1.188 — Importar materiais recusa arquivo binário (ex.: .xlsx lido como texto quando o leitor de planilha não carregou).
// Executa as funções reais do index.html em sandbox (DOM, FileReader, XLSX e sbInsert falsos).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const sw = fs.readFileSync(path.join(raiz, 'sw.js'), 'utf8');
const failed = [];
let total = 0;
function ok(name, cond, detail) { total++; if (!cond) failed.push(name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }

function fn(nome) {
  const re = new RegExp('\\n(?:async )?function ' + nome + '\\(');
  const partes = html.split(re);
  if (partes.length !== 2) throw new Error('definição de ' + nome + ': ' + (partes.length - 1));
  const ini = html.search(re) + 1;
  const fim = html.indexOf('\n}\n', ini);
  return html.slice(ini, fim + 2);
}
const FUNCS = ['sotTextoBinario', 'sotDecodificarTextoArquivo', '_sotCarregarArqMat', 'sotLmsNum', 'sotProcessarImportacaoMat'];
const codigo = FUNCS.map(fn).join('\n');

function sandbox(opts) {
  opts = opts || {};
  const els = { 'imp-mat-txt': { value: opts.texto || '' } };
  const c = {
    console, TextDecoder, Promise, Date, parseFloat, String, Object,
    DEMO: false,
    sot_materiais_proj: [],
    toasts: [], inserts: [], fechou: 0, atualizou: 0,
    document: { getElementById: id => els[id] || null },
    progShowToast(msg, tipo) { c.toasts.push({ msg, tipo: tipo || 'ok' }); },
    sbInsert(t, p) { c.inserts.push({ t, p }); return Promise.resolve([{ id: 'x' + c.inserts.length }]); },
    closeModal() { c.fechou++; },
    sotAtualizarAbaAtual() { c.atualizou++; },
    sot_projetos: [{ id: 'p1', contrato_id: 'c1' }], lancou: [],
    _sotLancarPendentes: async (pid, cid, pend) => { c.lancou.push({ pid, cid, pend }); },
    FileReader: class { readAsDataURL(f) { setTimeout(() => this.onload({ target: { result: 'data:x;base64,' + Buffer.from(f._bytes).toString('base64') } }), 0); } },
  };
  if (opts.xlsx) c.XLSX = opts.xlsx;
  vm.createContext(c);
  vm.runInContext(codigo, c);
  c.els = els;
  return c;
}
const arquivo = (nome, bytes) => ({ name: nome, _bytes: bytes, arrayBuffer: async () => Uint8Array.from(bytes).buffer });
const input = f => ({ files: [f], value: 'C:\\fakepath\\' + f.name });
const ZIP = [0x50, 0x4B, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00, 0x08, 0x00, 0x00, 0x00, 0x21, 0x00, 0xA1, 0x9F, 0x8B, 0x01, 0xFF, 0xFE, 0x10];

(async () => {
  // detecção
  const s = sandbox();
  ok('texto normal não é binário', !s.sotTextoBinario('4500001234;Cabo XLPE 95mm² — isolação;200;m\tok\r\n'));
  ok('U+FFFD é binário', s.sotTextoBinario('!\uFFFD|'));
  ok('controle é binário', s.sotTextoBinario('a\u0001b') && s.sotTextoBinario('a\u0000b'));
  ok('C1 e DEL são binários', s.sotTextoBinario('a\u0085') && s.sotTextoBinario('a\u007F'));
  ok('vazio/nulo não é binário', !s.sotTextoBinario('') && !s.sotTextoBinario(null));

  ok('decodifica UTF-8', s.sotDecodificarTextoArquivo(Uint8Array.from(Buffer.from('1;Isolação;2;UN', 'utf8')).buffer) === '1;Isolação;2;UN');
  ok('decodifica Windows-1252 (CSV do Excel)', s.sotDecodificarTextoArquivo(Uint8Array.from([0x31, 0x3B, 0x49, 0x73, 0x6F, 0x6C, 0x61, 0xE7, 0xE3, 0x6F]).buffer) === '1;Isolação');
  ok('remove BOM', s.sotDecodificarTextoArquivo(Uint8Array.from([0xEF, 0xBB, 0xBF, 0x41]).buffer) === 'A');
  ok('zip/xlsx como texto: recusa', s.sotDecodificarTextoArquivo(Uint8Array.from(ZIP).buffer) === null);

  // carregar arquivo
  {
    const c = sandbox();
    const inp = input(arquivo('lista.xlsx', ZIP));
    await c._sotCarregarArqMat(inp);
    ok('.xlsx sem leitor de planilha: recusa e não preenche', c.els['imp-mat-txt'].value === '' && inp.value === ''
      && c.toasts.length === 1 && c.toasts[0].tipo === 'erro' && /Leitor de planilha indisponível/.test(c.toasts[0].msg), c.toasts);
  }
  {
    const xlsx = { read: () => ({ SheetNames: ['P'], Sheets: { P: {} } }), utils: { sheet_to_json: () => [['4500001234', 'Poste 11m', 5, 'UN', '', 'extra']] } };
    const c = sandbox({ xlsx });
    await c._sotCarregarArqMat(input(arquivo('lista.xlsx', ZIP)));
    ok('.xlsx com leitor: preenche as 5 primeiras colunas', c.els['imp-mat-txt'].value === '4500001234;Poste 11m;5;UN;' && c.toasts.length === 0, c.els['imp-mat-txt'].value);
  }
  {
    const xlsx = { read: () => { throw new Error('arquivo corrompido'); }, utils: {} };
    const c = sandbox({ xlsx });
    await c._sotCarregarArqMat(input(arquivo('lista.xls', ZIP)));
    ok('.xls ilegível: recusa', c.els['imp-mat-txt'].value === '' && /Não foi possível ler a planilha \(arquivo corrompido\)/.test((c.toasts[0] || {}).msg), c.toasts);
  }
  {
    const xlsx = { read: () => ({ SheetNames: ['P'], Sheets: { P: {} } }), utils: { sheet_to_json: () => [['1', 'a\u0001b', 1, 'UN']] } };
    const c = sandbox({ xlsx });
    await c._sotCarregarArqMat(input(arquivo('lista.xlsx', ZIP)));
    ok('.xlsx com célula binária: recusa', c.els['imp-mat-txt'].value === '' && /caracteres inválidos/.test((c.toasts[0] || {}).msg), c.toasts);
  }
  {
    const c = sandbox();
    await c._sotCarregarArqMat(input(arquivo('lista.csv', ZIP)));
    ok('.csv binário: recusa', c.els['imp-mat-txt'].value === '' && /não é texto legível/.test((c.toasts[0] || {}).msg), c.toasts);
  }
  {
    const c = sandbox();
    await c._sotCarregarArqMat(input(arquivo('lista.csv', [...Buffer.from('4500001234;Isola', 'latin1'), 0xE7, 0xE3, 0x6F, ...Buffer.from(';2;UN\r\n', 'latin1')])));
    ok('.csv Windows-1252: preenche', c.els['imp-mat-txt'].value === '4500001234;Isolação;2;UN\r\n' && c.toasts.length === 0, c.els['imp-mat-txt'].value);
  }
  {
    const c = sandbox();
    const inp = input(arquivo('croqui.pdf', [0x25, 0x50, 0x44, 0x46]));
    await c._sotCarregarArqMat(inp);
    ok('.pdf: formato não suportado', c.els['imp-mat-txt'].value === '' && inp.value === '' && /Formato não suportado/.test((c.toasts[0] || {}).msg), c.toasts);
  }

  // importar
  {
    const c = sandbox({ texto: '4500001234;Poste 11m;5;UN\nPK\u0003\u0004\uFFFD;x;1\n4500005678;Cabo;200;m' });
    await c.sotProcessarImportacaoMat('p1');
    ok('lista com linha binária: nada importado', c.inserts.length === 0 && c.lancou.length === 0 && c.fechou === 0
      && /1 linha\(s\) com caracteres inválidos/.test((c.toasts[0] || {}).msg), c.toasts);
  }
  {
    const c = sandbox({ texto: '4500001234;Poste 11m;5;UN\n4500005678;Cabo XLPE 95mm²;200;m\n' });
    await c.sotProcessarImportacaoMat('p1');
    const l = c.lancou[0], m = l && l.pend.materiais;
    ok('lista válida: as 2 linhas vão ao lançamento da lista (Almoxarifado SAP / descritivo)', c.lancou.length === 1 && l.pid === 'p1' && l.cid === 'c1'
      && m.length === 2 && m[1].codigo === '4500005678' && m[1].nome === 'Cabo XLPE 95mm²' && m[1].qtd === 200 && m[1].unidade === 'm'
      && l.pend.servicos.length === 0 && c.inserts.length === 0 && c.fechou === 1, l);
  }

  // versão
  ok('versão 8.1.188 no log', /\{v:'8\.1\.188'/.test(html));
  const num = /numero: '(8\.1\.\d+)'/.exec(html)[1];
  ok('sw.js na versão atual', sw.includes("'cena-" + num + "'"), num);
  ok('input de arquivo continua aceitando .txt/.csv/.xlsx/.xls', html.includes('accept=".txt,.csv,.xlsx,.xls"'));

  if (failed.length) { console.error('FALHOU ' + failed.length + '/' + total + ':\n - ' + failed.join('\n - ')); process.exit(1); }
  console.log('sot-importacao-materiais-binario: ' + total + ' verificações OK');
})().catch(e => { console.error(e); process.exit(1); });
