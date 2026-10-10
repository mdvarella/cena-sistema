// ETAPA 1.3 — parser do LMS original (supabase/functions/_shared/lms-parser.ts).
// Oráculo: tests/fixtures/lms/modelo-lms-esperado.json + leitura independente das células da fixture.
// Variações sintéticas montadas em memória (nunca gravadas no repositório).
// Uso: XLSX_PATH=<.../node_modules/xlsx/xlsx.mjs> node tests/proj-lms-parser.test.mjs (padrão: %TEMP%/cena-lms-parse)
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { createHash } from 'crypto';
import { fileURLToPath, pathToFileURL } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.join(here, '..');
let XLSX;
try {
  const p = process.env.XLSX_PATH || path.join(process.env.TEMP || '/tmp', 'cena-lms-parse', 'node_modules', 'xlsx', 'xlsx.mjs');
  XLSX = await import(pathToFileURL(p).href);
} catch {
  console.log('proj-lms-parser: SKIP (instale xlsx 0.20.3 e defina XLSX_PATH)');
  process.exit(0);
}
const parserPath = process.env.LMS_PARSER_PATH || path.join(raiz, 'supabase', 'functions', '_shared', 'lms-parser.ts');
const P = await import(pathToFileURL(parserPath).href);

const failed = [];
let total = 0;
const ok = (n, c, d) => { total++; if (!c) failed.push(n + (d !== undefined ? ' — ' + JSON.stringify(d).slice(0, 300) : '')); };

const fixDir = path.join(raiz, 'tests', 'fixtures', 'lms');
const fixture = new Uint8Array(fs.readFileSync(path.join(fixDir, 'modelo-lms-anonimizado.xlsx')));
const esperado = JSON.parse(fs.readFileSync(path.join(fixDir, 'modelo-lms-esperado.json'), 'utf8'));
const readme = fs.readFileSync(path.join(fixDir, 'README.md'), 'utf8');
const sha = b => createHash('sha256').update(b).digest('hex');

// ── Hash dos bytes originais ────────────────────────────────────
const hashFix = await P.sha256Hex(fixture);
ok('SHA-256 = node:crypto sobre os mesmos bytes', hashFix === sha(fixture), hashFix);
ok('SHA-256 da fixture = o registrado no README', readme.includes(hashFix), hashFix);

// ── Normalização ────────────────────────────────────────────────
const casosCodigo = [[' 000123 ', '123'], ['000000', '0'], ['0', '0'], [' I-AHO01 ', 'I-AHO01'], ['   ', null], ['', null],
  [null, null], ['i-aho01', 'I-AHO01'], ['00A1', '00A1'], ['\u00a0123\t', '123'], ['\n0042\r', '42'], ['324894', '324894'],
  ['ação', 'AçãO'], ['12 34', '12 34'], ['-0012', '-0012']];
for (const [e, s] of casosCodigo) ok(`codigoNorm(${JSON.stringify(e)}) = ${JSON.stringify(s)}`, P.codigoNorm(e) === s, P.codigoNorm(e));
ok('textoNorm: trim + maiúsculas ASCII, vazio → null', P.textoNorm(' wp ') === 'WP' && P.textoNorm(' \t ') === null && P.textoNorm(' r ') === 'R');
const num = (t, v) => P.numeroLms(t === undefined ? undefined : { t, v });
const casosNum = [[['s', '0,2616'], 0.2616], [['s', '6,132'], 6.132], [['s', '1.234,5'], 1234.5], [['s', '2'], 2], [['s', ' 0.5 '], 0.5],
  [['n', 0], 0], [['n', 552], 552], [['s', '-3,5'], -3.5]];
for (const [[t, v], e] of casosNum) { const r = num(t, v); ok(`numeroLms(${t}:${v}) = ${e}`, r.valor === e && !r.invalido, r); }
for (const v of ['1.234', 'abc', '1,2,3', '12a', '1.234.5']) { const r = num('s', v); ok(`numeroLms("${v}") inválido (sem adivinhar)`, r.valor === null && r.invalido, r); }
ok('numeroLms vazio → null sem alerta', num(undefined).valor === null && !num(undefined).invalido && num('s', '  ').valor === null && !num('s', '  ').invalido);
ok('zero numérico é dado (0, não null)', num('n', 0).valor === 0);

// ── Fixture real anonimizada ────────────────────────────────────
const val = await P.validarArquivo(fixture, 'Modelo LMS.xlsx', P.XLSX_MIME);
ok('fixture passa na validação do arquivo', val.ok === true && val.mime_validado === P.XLSX_MIME, val);
const r = P.parseLms(fixture, XLSX);
ok('fixture: parse ok', r.ok === true, r.erros);
ok('fixture: hash não muda depois do parse (bytes intocados)', sha(fixture) === hashFix);
ok('fixture: worksheet e versão do parser', r.worksheet === esperado.aba && r.parser_version === P.PARSER_VERSION && P.PARSER_VERSION === '1');
ok('fixture: identificação D1', r.projeto_identificacao_raw === 'DMP/A.OES.00.00001', r.projeto_identificacao_raw);
ok('fixture: linhas reais = esperado', r.linhas.length === esperado.linhas_reais, r.linhas.length);
ok('fixture: linha fantasma ignorada e listada', esperado.linhas_fantasma.every(n => r.linhas_ignoradas.includes(n) && !r.linhas.some(l => l.linha_excel === n)), r.linhas_ignoradas);
ok('fixture: linhas formatadas vazias não contam (só a fantasma é ignorada)', r.total_linhas_ignoradas === esperado.linhas_fantasma.length, r.total_linhas_ignoradas);
ok('fixture: ordem 1..n e linha_excel crescente', r.linhas.every((l, i) => l.ordem === i + 1 && (i === 0 || l.linha_excel > r.linhas[i - 1].linha_excel)));
ok('fixture: primeira e última linha', r.linhas[0].linha_excel === 4 && r.linhas.at(-1).linha_excel === 203);

const wls = new Set(r.linhas.map(l => P.textoNorm(l.wl_raw)));
ok('fixture: WLs distintas = esperado', wls.size === esperado.wls, wls.size);
const isMat = l => /^[0-9]+$/.test(l.codigo_norm || '');
ok('fixture: materiais = esperado', r.linhas.filter(isMat).length === esperado.materiais);
ok('fixture: materiais FT=R preservados = esperado', r.linhas.filter(l => isMat(l) && P.textoNorm(l.ft_raw) === 'R').length === esperado.materiais_ft_R);
ok('fixture: serviços = esperado', r.linhas.filter(l => !isMat(l)).length === esperado.servicos);
for (const [wl, e] of Object.entries(esperado.por_wl)) {
  const ls = r.linhas.filter(l => P.textoNorm(l.wl_raw) === wl);
  const c = (m, ft) => ls.filter(l => isMat(l) === m && P.textoNorm(l.ft_raw) === ft).length;
  const ups = ls.reduce((s, l) => s + (l.valor_final ?? 0), 0);
  ok(`fixture: WL ${wl} materiais/serviços por FT e UPS = esperado`,
    c(true, 'I') === e.material_I && c(true, 'R') === e.material_R && c(false, 'I') === e.servico_I && c(false, 'R') === e.servico_R
    && Math.abs(ups - e.ups_total_real) < 1e-9, { ls: ls.length, ups });
}
const resumo = P.montarResumo(r);
ok('resumo: duplicados WL+código+FT = esperado (linhas excedentes)', resumo.duplicados_wl_codigo_ft === esperado.duplicados_wl_codigo_ft, resumo.duplicados_wl_codigo_ft);
ok('resumo: com KIT não há duplicidade = esperado', resumo.duplicados_wl_codigo_ft_kit === esperado.duplicados_wl_codigo_ft_kit);
ok('fixture: Plan ≠ Real = esperado', r.linhas.filter(l => l.qtd_plan !== l.lms_qtd_real_informada).length === esperado.plan_diferente_de_real);
ok('resumo: qtd_linhas, WLs, fantasma listada', resumo.qtd_linhas === esperado.linhas_reais && resumo.qtd_wls_distintas === esperado.wls
  && resumo.wls.map(w => w.wl).join(',') === '1,2,3,4,5,6,7,8,9,10,11,12' && resumo.linhas_ignoradas.linhas.join() === '6024', resumo.wls);
ok('resumo: códigos repetidos contados, nenhum agregado', resumo.codigos_repetidos === 42 && resumo.codigos_nulos === 0, resumo);
ok('resumo: sem Plan=0/Real>0 na fixture', resumo.plan_zero_real_positivo === 0);

// Leitura independente: cada linha do parser = as células da planilha, linha a linha.
const wbRef = XLSX.read(fixture, { type: 'array', cellFormula: false });
const ws = wbRef.Sheets.Planilha1;
const txt = c => (c === undefined || c.v === undefined || c.v === null || c.v === '') ? null : (c.t === 'b' ? (c.v ? 'TRUE' : 'FALSE') : String(c.v));
const campos = [['A', 'wl_raw'], ['B', 'ctg_raw'], ['C', 'ft_raw'], ['D', 'codigo_raw'], ['E', 'kit_raw'], ['F', 'umd_raw'], ['G', 'descricao_raw'],
  ['H', 'qtd_plan_raw'], ['I', 'qtd_real_raw'], ['J', 'valor_ups_item_raw'], ['K', 'valor_final_raw'], ['L', 'valor_final_plan_raw'],
  ['M', 'estorno_raw'], ['N', 'adicionais_raw']];
const divergentes = [];
for (const l of r.linhas) {
  for (const [c, f] of campos) if (txt(ws[c + l.linha_excel]) !== l[f]) divergentes.push([l.linha_excel, f, l[f]]);
  const h = ws['H' + l.linha_excel], i = ws['I' + l.linha_excel];
  if (l.qtd_plan !== (h ? h.v : null)) divergentes.push([l.linha_excel, 'qtd_plan', l.qtd_plan]);
  if (l.lms_qtd_real_informada !== (i ? i.v : null)) divergentes.push([l.linha_excel, 'lms_qtd_real_informada']);
  if (l.codigo_norm !== P.codigoNorm(l.codigo_raw)) divergentes.push([l.linha_excel, 'codigo_norm']);
}
ok('fixture: WL, CTG, FT, código, KIT, UMD, descrição, quantidades, valores, Estorno e Adicionais = célula original, linha a linha',
  divergentes.length === 0, divergentes.slice(0, 5));
ok('fixture: Quant. Plan vem de H e Quant. Real de I (campos separados)', r.linhas.every(l => 'qtd_plan' in l && 'lms_qtd_real_informada' in l && !('qtd_real' in l)));
ok('fixture: código numérico preservado (324894)', r.linhas[0].codigo_raw === '324894' && r.linhas[0].codigo_norm === '324894' && r.linhas[0].linha_raw.D.t === 'n');
const l12 = r.linhas.find(l => l.linha_excel === 12);
ok('fixture: serviço I-AHO234 com KIT S-AHO234 e UMD US3, sem alerta de padrão', l12.codigo_norm === 'I-AHO234' && l12.kit_raw === 'S-AHO234'
  && l12.umd_raw === 'US3' && !l12.alertas.some(a => a.startsWith('SERVICO_')), l12);
ok('fixture: decimal pt-BR em J (texto "6,132" → 6.132, raw preservado)', r.linhas.some(l => l.valor_ups_item_raw === '6,132' && l.valor_ups_item === 6.132));
ok('fixture: descrição com espaço duplo preservada', r.linhas.find(l => l.linha_excel === 14).descricao_raw === 'R-POSTE  DE MT OU BT');
const l2527 = r.linhas.filter(l => l.linha_excel >= 25 && l.linha_excel <= 27);
ok('fixture: mesmo WL+código+FT com KIT diferente = 3 linhas distintas',
  l2527.length === 3 && new Set(l2527.map(l => l.kit_raw)).size === 3 && l2527.every(l => l.codigo_norm === '310567' && l.wl_raw === '6' && l.ft_raw === 'I'), l2527.map(l => l.kit_raw));
ok('fixture: código 324894 em 5 WLs = 5 linhas, nada somado', r.linhas.filter(l => l.codigo_norm === '324894').length >= 5);
ok('fixture: Estorno e Adicionais vazios → null', r.linhas.every(l => l.estorno_raw === null && l.adicionais_raw === null));
ok('fixture: linha_raw só com colunas A:N', r.linhas.every(l => Object.keys(l.linha_raw).every(k => /^[A-N]$/.test(k))));
const saida = JSON.stringify({ r, resumo, amostra: P.amostraPreview(r.linhas) });
ok('fixture: nada das colunas R/U (pessoas, RE) no resultado', !/PESSOA|ANONIMA|R:\d{3}/.test(saida));
ok('fixture: amostra limitada', P.amostraPreview(r.linhas).length === P.LIMITES.amostraPreview && !('linha_raw' in P.amostraPreview(r.linhas)[0]));
ok('fixture: parse determinístico', JSON.stringify(P.parseLms(fixture, XLSX)) === JSON.stringify(r));

// ── Variações sintéticas ────────────────────────────────────────
const CAB = esperado.colunas;
function planilha(linhas, { aba = 'Planilha1', cab = CAB, d1 = 'DMP/A.OES.00.00001', extra = {} } = {}) {
  const aoa = [['Definição de projeto:', null, null, d1], [], cab, ...linhas];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  for (const [ref, cell] of Object.entries(extra)) sheet[ref] = cell;
  const rng = XLSX.utils.decode_range(sheet['!ref']);
  for (const ref of Object.keys(extra)) { const a = XLSX.utils.decode_cell(ref); rng.e.r = Math.max(rng.e.r, a.r); rng.e.c = Math.max(rng.e.c, a.c); }
  sheet['!ref'] = XLSX.utils.encode_range(rng);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, aba);
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
}
const L = (o = {}) => { const b = ['1', 'WP', 'I', 324894, 'NK-AMAR-RC', 'M', 'FIO AL COBERTO', 6, 6, null, null, null, null, null];
  for (const [k, v] of Object.entries(o)) b['ABCDEFGHIJKLMN'.indexOf(k)] = v; return b; };
const parse = b => P.parseLms(b, XLSX);

let s = parse(planilha([L({ H: 0, I: 6 })]));
ok('Plan=0 e Real>0: linha preservada, Plan continua 0, Real separado, alerta', s.ok && s.linhas.length === 1 && s.linhas[0].qtd_plan === 0
  && s.linhas[0].lms_qtd_real_informada === 6 && s.linhas[0].alertas.includes('PLAN_ZERO_REAL_POSITIVO') && P.montarResumo(s).plan_zero_real_positivo === 1, s.linhas?.[0]);

s = parse(planilha([L({ D: ' 000123 ' }), L({ D: '000000', A: '2' }), L({ D: '   ', A: '3' }), L({ D: ' i-aho01 ', C: 'I', E: 'S-AHO01', A: '4' })]));
ok('código texto com zeros e espaços: raw preservado, norm "123"', s.linhas[0].codigo_raw === ' 000123 ' && s.linhas[0].codigo_norm === '123');
ok('código só zeros: norm "0"', s.linhas[1].codigo_raw === '000000' && s.linhas[1].codigo_norm === '0');
ok('código só espaços: raw preservado, norm null, alerta CODIGO_VAZIO', s.linhas[2].codigo_raw === '   ' && s.linhas[2].codigo_norm === null
  && s.linhas[2].alertas.includes('CODIGO_VAZIO'), s.linhas[2]);
ok('código alfanumérico minúsculo: norm em maiúsculas', s.linhas[3].codigo_norm === 'I-AHO01' && s.linhas[3].codigo_raw === ' i-aho01 ');

s = parse(planilha([L({ D: 310567, E: 'NK-RC6AFX' }), L({ D: 310567, E: 'NK-I2I' }), L({ D: 310567, E: 'NK-I2I' })]));
let rs = P.montarResumo(s);
ok('mesmo WL+código+FT: todas as linhas preservadas; KIT diferencia; repetida idêntica marcada',
  s.linhas.length === 3 && rs.duplicados_wl_codigo_ft === 2 && rs.duplicados_wl_codigo_ft_kit === 1
  && s.linhas[1].alertas.includes('LINHA_REPETIDA') && s.linhas[2].alertas.includes('LINHA_REPETIDA') && !s.linhas[0].alertas.includes('LINHA_REPETIDA'), rs);

s = parse(planilha([L({ C: 'R', D: 328951 }), L({ C: 'R', D: 'R-AHO234', E: 'S-AHO234', F: 'US3', J: '0,2616', K: 0.2616, L: 0.2616 }),
  L({ C: 'R', D: 'I-AHO234', E: 'S-AHO999' })]));
ok('material FT=R preservado', s.linhas[0].ft_raw === 'R' && s.linhas[0].codigo_norm === '328951');
ok('serviço R-AHO com decimal pt-BR em J', s.linhas[1].valor_ups_item === 0.2616 && s.linhas[1].valor_ups_item_raw === '0,2616' && s.linhas[1].alertas.length === 0, s.linhas[1]);
ok('serviço com prefixo ≠ FT e KIT fora do padrão: só alertas, linha preservada', s.linhas[2].alertas.includes('SERVICO_PREFIXO_DIFERENTE_FT')
  && s.linhas[2].alertas.includes('SERVICO_KIT_FORA_DO_PADRAO') && s.linhas[2].codigo_norm === 'I-AHO234');

s = parse(planilha([L({ M: 'EST-1', N: ' 3 ' }), L({ A: '2' })]));
ok('Estorno/Adicionais preenchidos: preservados como vieram, só alerta', s.linhas[0].estorno_raw === 'EST-1' && s.linhas[0].adicionais_raw === ' 3 '
  && s.linhas[0].alertas.includes('ESTORNO_INFORMADO') && s.linhas[0].alertas.includes('ADICIONAIS_INFORMADO') && s.linhas[0].qtd_plan === 6);
ok('Estorno/Adicionais vazios → null', s.linhas[1].estorno_raw === null && s.linhas[1].adicionais_raw === null);

const vazia = Array(14).fill(null);
const soL = [...vazia]; soL[11] = 0;
const soH0 = [...vazia]; soH0[7] = 0;
const soH5 = [...vazia]; soH5[7] = 5;
const soEspaco = [...vazia]; soEspaco[0] = '   '; soEspaco[3] = ' ';
s = parse(planilha([L(), soL, soH0, soEspaco, L({ A: '2' }), soH5, L({ D: null, A: '3' })]));
ok('linha fantasma (só L=0), só H=0 e só espaços: ignoradas e listadas', s.ok && s.linhas_ignoradas.join() === '5,6,7' && s.total_linhas_ignoradas === 3, s.linhas_ignoradas);
ok('linha só com quantidade ≠ 0 é preservada com alertas', s.linhas.some(l => l.linha_excel === 9 && l.qtd_plan === 5 && l.alertas.includes('WL_VAZIA') && l.alertas.includes('CODIGO_VAZIO')));
ok('linha sem código mas com conteúdo é preservada (CODIGO_VAZIO)', s.linhas.some(l => l.linha_excel === 10 && l.codigo_raw === null && l.alertas.includes('CODIGO_VAZIO')));
ok('quantidades zero com identificação: 0, não null', parse(planilha([L({ H: 0, I: 0 })])).linhas[0].qtd_plan === 0);

s = parse(planilha([L(), L({ A: '2' })], { extra: { O4: { t: 's', v: 'SEGREDO FORA' }, R5: { t: 's', v: 'PESSOA X R:123456' }, Z9: { t: 's', v: 'SEGREDO Z' },
  AA12: { t: 'n', v: 999 }, O20: { t: 's', v: 'SO FORA' }, P21: { t: 's', v: 'x'.repeat(5000) } } }));
ok('conteúdo fora de A:N ignorado (O, R, Z, AA; célula gigante em P)', s.ok && s.linhas.length === 2 && !/SEGREDO|PESSOA|SO FORA|999|xxxx/.test(JSON.stringify(s)), s.erros);
ok('linha só com conteúdo fora de A:N não vira linha nem aparece como ignorada', !s.linhas.some(l => l.linha_excel >= 20) && s.total_linhas_ignoradas === 0);

s = parse(planilha([L()], { extra: { H4: { t: 'n', v: 7, f: 'I4+1' } } }));
ok('fórmula: usa o valor gravado, nunca o texto da fórmula', s.ok && s.linhas[0].qtd_plan === 7 && !/I4\+1/.test(JSON.stringify(s)), s.linhas?.[0]);

s = parse(planilha([L()], { cab: CAB.map((c, i) => (i === 3 ? 'Código' : c)) }));
ok('cabeçalho diferente (D3 = "Código"): FORMATO_LMS_INCOMPATIVEL, nenhuma linha', !s.ok && s.codigo === 'FORMATO_LMS_INCOMPATIVEL'
  && s.erros[0].codigo === 'CABECALHO_INCOMPATIVEL' && s.erros[0].detalhe.coluna === 'D' && !('linhas' in s), s);
s = parse(planilha([L()], { cab: CAB.slice(0, 13) }));
ok('cabeçalho sem a coluna N: incompatível', !s.ok && s.erros.some(e => e.detalhe?.coluna === 'N'));
s = parse(planilha([L()], { cab: CAB.map(c => ' ' + c.normalize('NFD').toLowerCase() + ' ') }));
ok('cabeçalho com espaços, minúsculas e acento decomposto: aceito', s.ok, s.erros);
s = parse(planilha([L()], { aba: 'LMS' }));
ok('aba diferente de Planilha1: WORKSHEET_AUSENTE', !s.ok && s.erros[0].codigo === 'WORKSHEET_AUSENTE');
s = parse(planilha([L({ G: 'y'.repeat(P.LIMITES.caracteresCelula + 1) })]));
ok('célula A:N gigante: recusada', !s.ok && s.erros[0].codigo === 'CELULA_GRANDE_DEMAIS');
s = parse(planilha([]));
ok('sem linhas operacionais: recusado', !s.ok && s.erros[0].codigo === 'SEM_LINHAS_OPERACIONAIS');
s = parse(planilha(Array.from({ length: P.LIMITES.linhasOperacionais + 1 }, (_, i) => L({ A: String(i) }))));
ok('acima do limite de linhas: recusado inteiro (sem truncar)', !s.ok && s.erros[0].codigo === 'LIMITE_LINHAS_EXCEDIDO');
s = parse(planilha([L({ H: '1.234', I: 'abc', K: 'x' })]));
ok('número inválido/ambíguo: null + alerta, raw preservado', s.ok && s.linhas[0].qtd_plan === null && s.linhas[0].qtd_plan_raw === '1.234'
  && s.linhas[0].alertas.includes('QTD_PLAN_INVALIDA') && s.linhas[0].alertas.includes('QTD_REAL_INVALIDA') && s.linhas[0].alertas.includes('VALOR_FINAL_INVALIDO'));

// ── Validação do arquivo (antes do SheetJS) ─────────────────────
function crc32(b) { return zlib.crc32 ? zlib.crc32(b) >>> 0 : 0; }
function zip(entradas, { flags = 0 } = {}) {
  const locais = [], centrais = [];
  let off = 0;
  for (const e of entradas) {
    const nome = Buffer.from(e.nome);
    const dados = Buffer.from(e.dados);
    const comp = e.guardar ? dados : zlib.deflateRawSync(dados);
    const declarado = e.declarar ?? dados.length;
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(flags, 6); h.writeUInt16LE(e.guardar ? 0 : 8, 8);
    h.writeUInt32LE(crc32(dados), 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(declarado, 22); h.writeUInt16LE(nome.length, 26);
    locais.push(h, nome, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(flags, 8); c.writeUInt16LE(e.guardar ? 0 : 8, 10);
    c.writeUInt32LE(crc32(dados), 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(declarado, 24); c.writeUInt16LE(nome.length, 28);
    c.writeUInt32LE(off, 42);
    centrais.push(c, nome);
    off += 30 + nome.length + comp.length;
  }
  const dir = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(entradas.length, 8); fim.writeUInt16LE(entradas.length, 10);
  fim.writeUInt32LE(dir.length, 12); fim.writeUInt32LE(off, 16);
  return new Uint8Array(Buffer.concat([...locais, dir, fim]));
}
const CT_OK = '<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>';
const CT_MACRO = '<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.ms-excel.sheet.macroEnabled.main+xml"/></Types>';
const base = [{ nome: '[Content_Types].xml', dados: CT_OK }, { nome: 'xl/workbook.xml', dados: '<workbook/>' }];
const v = (b, nome = 'lms.xlsx', mime = P.XLSX_MIME) => P.validarArquivo(b, nome, mime);
const falhou = async (n, p, http, codigo, erro) => { const x = await p; ok(n, x.ok === false && x.http === http && x.codigo === codigo && x.erros[0].codigo === erro, x); };

ok('zip mínimo válido aceito', (await v(zip(base))).ok === true);
await falhou('arquivo acima do limite: 413', v(new Uint8Array(P.LIMITES.arquivoBytes + 1)), 413, 'ARQUIVO_GRANDE_DEMAIS', 'TAMANHO_EXCEDIDO');
await falhou('arquivo vazio: 415', v(new Uint8Array(0)), 415, 'TIPO_ARQUIVO_INVALIDO', 'ARQUIVO_VAZIO');
await falhou('CSV renomeado para .xlsx: 415', v(new TextEncoder().encode('WL;CTG;FT\n1;WP;I\n')), 415, 'TIPO_ARQUIVO_INVALIDO', 'ASSINATURA_ZIP_AUSENTE');
await falhou('XLS antigo (OLE) renomeado: 415', v(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, ...new Array(600).fill(0)])), 415, 'TIPO_ARQUIVO_INVALIDO', 'ASSINATURA_ZIP_AUSENTE');
await falhou('extensão .xlsm: 415', v(fixture, 'lms.xlsm'), 415, 'TIPO_ARQUIVO_INVALIDO', 'EXTENSAO_OU_NOME_INVALIDO');
await falhou('extensão .xls: 415', v(fixture, 'lms.xls'), 415, 'TIPO_ARQUIVO_INVALIDO', 'EXTENSAO_OU_NOME_INVALIDO');
await falhou('sem nome: 415', v(fixture, ''), 415, 'TIPO_ARQUIVO_INVALIDO', 'EXTENSAO_OU_NOME_INVALIDO');
await falhou('MIME text/csv: 415', v(fixture, 'lms.xlsx', 'text/csv'), 415, 'TIPO_ARQUIVO_INVALIDO', 'MIME_NAO_ACEITO');
ok('MIME vazio/octet-stream aceitos (navegadores variam); nome sanitizado', (await v(fixture, 'C:\\pasta\\Modelo LMS.xlsx', '')).nome === 'Modelo LMS.xlsx'
  && (await v(fixture, 'a.XLSX', 'application/octet-stream')).ok === true);
await falhou('XLSM (content type macroEnabled) com nome .xlsx: 415', v(zip([{ nome: '[Content_Types].xml', dados: CT_MACRO }, base[1]])), 415, 'TIPO_ARQUIVO_INVALIDO', 'ARQUIVO_COM_MACRO');
await falhou('vbaProject.bin: 415', v(zip([...base, { nome: 'xl/vbaProject.bin', dados: 'x' }])), 415, 'TIPO_ARQUIVO_INVALIDO', 'ARQUIVO_COM_MACRO');
await falhou('ZIP sem workbook (não é XLSX): 415', v(zip([base[0], { nome: 'word/document.xml', dados: '<w/>' }])), 415, 'TIPO_ARQUIVO_INVALIDO', 'NAO_E_XLSX');
await falhou('ZIP criptografado: 415', v(zip(base, { flags: 1 })), 415, 'TIPO_ARQUIVO_INVALIDO', 'ZIP_CRIPTOGRAFADO');
await falhou('caminho com ..: 415', v(zip([...base, { nome: '../fora.xml', dados: 'x' }])), 415, 'TIPO_ARQUIVO_INVALIDO', 'ZIP_CAMINHO_INVALIDO');
await falhou('ZIP bomb (razão de compressão suspeita): 413', v(zip([...base, { nome: 'xl/worksheets/sheet1.xml', dados: Buffer.alloc(8 * 1024 * 1024) }])), 413, 'ARQUIVO_GRANDE_DEMAIS', 'ZIP_RAZAO_SUSPEITA');
await falhou('planilha descompactada acima do limite: 413', v(zip([...base, { nome: 'xl/worksheets/sheet1.xml', dados: 'abc', declarar: P.LIMITES.zipDescompactadoEntrada + 1 }])), 413, 'ARQUIVO_GRANDE_DEMAIS', 'ZIP_DESCOMPACTADO_EXCEDIDO');
await falhou('ZIP que declara tamanho menor que o real (bomba disfarçada): 415', v(zip([...base, { nome: 'xl/worksheets/sheet1.xml', dados: Buffer.alloc(900 * 1024), declarar: 100 }])), 415, 'TIPO_ARQUIVO_INVALIDO', 'ZIP_INCONSISTENTE');
await falhou('ZIP que declara tamanho maior que o real: 415', v(zip([...base, { nome: 'xl/styles.xml', dados: 'abc', declarar: 5000 }])), 415, 'TIPO_ARQUIVO_INVALIDO', 'ZIP_INCONSISTENTE');
await falhou('parte declarada como vbaProject (nome disfarçado): 415', v(zip([{ nome: '[Content_Types].xml', dados: CT_OK.replace('</Types>', '<Override PartName="/xl/x.bin" ContentType="application/vnd.ms-office.vbaProject"/></Types>') }, base[1]])), 415, 'TIPO_ARQUIVO_INVALIDO', 'ARQUIVO_COM_MACRO');
ok('Default genérico de .bin "macroEnabled" (gravado pelo SheetJS/Excel) não é macro', (await v(zip([{ nome: '[Content_Types].xml', dados: CT_OK.replace('<Types>', '<Types><Default Extension="bin" ContentType="application/vnd.ms-excel.sheet.binary.macroEnabled.main"/>') }, base[1]]))).ok === true);
await falhou('entradas demais no ZIP: 413', v(zip([...base, ...Array.from({ length: P.LIMITES.zipEntradas }, (_, i) => ({ nome: `xl/x${i}.xml`, dados: 'x' }))])), 413, 'ARQUIVO_GRANDE_DEMAIS', 'ZIP_ENTRADAS_EXCEDIDAS');
const valFix = await v(fixture);
ok('fixture real (4,4 MB, planilha gravada sem compressão) dentro dos limites', valFix.ok === true, valFix);

if (failed.length) {
  console.log(`proj-lms-parser: FALHOU ${failed.length}/${total}`);
  for (const f of failed) console.log('  - ' + f);
  process.exit(1);
}
console.log(`proj-lms-parser: OK (${total} verificações)`);
