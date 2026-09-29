'use strict';
// FROTAS 8.1.166 — modelos Excel de importação (Combustível, Pedágios, Multas): cada modelo baixado,
// preenchido com os exemplos da aba Instruções, é lido pelo importador real de cada módulo sem perder coluna.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const sw = fs.readFileSync(path.join(raiz, 'sw.js'), 'utf8');
const pedUi = fs.readFileSync(path.join(raiz, 'modules/frotas/pedagios/pedagios.js'), 'utf8');
const pedSvc = fs.readFileSync(path.join(raiz, 'modules/frotas/pedagios/pedagios-service.js'), 'utf8');
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
const vr = nome => bloco(new RegExp('\\nvar ' + nome + '\\s*='));

function xlsxFake(saida) {
  return {
    utils: {
      aoa_to_sheet: function (aoa) { return { aoa: aoa }; },
      book_new: function () { return { abas: [] }; },
      book_append_sheet: function (wb, ws, nome) { wb.abas.push({ nome: nome, aoa: ws.aoa, cols: ws['!cols'] }); }
    },
    writeFile: function (wb, arquivo) { saida.push({ arquivo: arquivo, abas: wb.abas }); }
  };
}
function linhaDoExemplo(arq) {
  const inst = arq.abas[1].aoa;
  const heads = arq.abas[0].aoa[0];
  const row = {};
  heads.forEach(function (h) {
    const l = inst.find(function (x) { return x[0] === h; });
    row[h] = l ? l[3] : '';
  });
  return row;
}
function conferirModelo(nomeArq, arq, abaDados, obrigatorias) {
  ok(nomeArq + ': arquivo xlsx', arq && arq.arquivo === nomeArq + '.xlsx', arq && arq.arquivo);
  ok(nomeArq + ': primeira aba é a de dados (a que o importador lê)', arq.abas[0].nome === abaDados && arq.abas[1].nome === 'Instruções');
  ok(nomeArq + ': aba de dados só com o cabeçalho (sem exemplo que seria importado)', arq.abas[0].aoa.length === 1);
  const inst = arq.abas[1].aoa;
  ok(nomeArq + ': instruções com Coluna/Obrigatória/Formato/Exemplo/Observação', inst[0].join('|') === 'Coluna|Obrigatória|Formato|Exemplo|Observação');
  const heads = arq.abas[0].aoa[0];
  ok(nomeArq + ': uma linha de instrução por coluna', heads.every(function (h) { return inst.some(function (x) { return x[0] === h; }); }));
  const obr = inst.filter(function (x) { return x[1] === 'SIM'; }).map(function (x) { return x[0]; });
  ok(nomeArq + ': obrigatórias ' + obrigatorias.join(', '), obr.join('|') === obrigatorias.join('|'), obr);
}

(async function () {
  const helper = fn('frtBaixarModeloExcel');

  // ── Combustível ───────────────────────────────────────────
  let saida = [];
  let ctx = {
    console: console, DEMO: true, XLSX: xlsxFake(saida),
    frt_combustivel: [], contratos: [{ id: 'k1', nome: 'TMA', codigo: 'TMA' }],
    document: { getElementById: function () { return { style: {}, innerHTML: '' }; } },
    escHtml: String, frtCombBadgeHtml: function () { return ''; },
    frtCombMapaVeiculosPorPlaca: function () { return { ABC1D23: { id: 'v1', placa: 'ABC1D23', modelo: 'Strada' } }; },
    frtCombMapaAutorizadosPorPlaca: function () { return {}; },
    frtCombBuscarVeiculoPorPlaca: function (pn, m) { return m[pn] || null; },
    frtCombBuscarAutorizadoPorPlaca: function () { return null; },
    frtCombResolverContratoLanc: function () { return null; },
    _frtCombImport: null, _frtCombImportMeta: { dups: [], origemArquivo: 'modelo_importacao_combustivel.xlsx' }
  };
  vm.createContext(ctx);
  vm.runInContext([helper, vr('FRT_COMB_MODELO'), fn('frtCombBaixarModelo'), fn('frtNormPlaca'), vr('FRT_PLACAS_FORCADAS'),
    fn('_frtPlacaNear'), fn('frtCombHashDedup'), fn('frtCombHashDeRow'), fn('frtCombClassificarPlaca'), fn('frtCombImportPreview')].join('\n'), ctx);
  ok('combustível: gera xlsx', ctx.frtCombBaixarModelo() === 'xlsx');
  const comb = saida[0];
  conferirModelo('modelo_importacao_combustivel', comb, 'Abastecimentos', ['Data', 'Placa', 'Litros']);
  await ctx.frtCombImportPreview([linhaDoExemplo(comb)]);
  const c = (ctx._frtCombImport || [])[0] || {};
  ok('combustível: importador lê todas as colunas do modelo',
    c.data === '2026-09-28' && c.placa_normalizada === 'ABC1D23' && c.litros === 45.5 && c.combustivel === 'Diesel S10'
    && c.valor_litro === 6.19 && c.valor_total === 281.65 && c.km === 125430 && c.posto === 'Posto Castelo'
    && c.posto_endereco === 'Rod. Castelo Branco, km 30' && c.posto_bairro === 'Centro' && c.posto_cidade === 'Barueri/SP'
    && c.motorista === 'JOÃO DA SILVA' && c.status_conciliacao === 'CONCILIADO', c);
  const semTotal = linhaDoExemplo(comb); semTotal['Valor total'] = '';
  await ctx.frtCombImportPreview([semTotal]);
  ok('combustível: sem Valor total calcula por litros × valor/litro', Math.abs(ctx._frtCombImport[0].valor_total - 281.645) < 1e-9);

  // ── Multas ────────────────────────────────────────────────
  saida = [];
  ctx = {
    console: console, XLSX: xlsxFake(saida),
    frt_documentos: [], frt_veiculos: [{ id: 'v1', placa: 'ABC-1D23' }],
    colaboradores: [{ id: 'c1', nome: 'JOÃO DA SILVA', re: '1078' }],
    fdocFiltrarColabs: function () { return []; },
    fdocMultaImportMostrarPreview: function () {},
    fdocMultaVincularRecs: function () { return Promise.resolve({ ok: 0, miss: 0 }); },
    document: { getElementById: function () { return { style: {}, innerHTML: '' }; } },
    _fdocMulImport: null
  };
  vm.createContext(ctx);
  vm.runInContext([vr('FDOC_STATUS'), vr('FDOC_GRAVIDADE'), vr('FDOC_GRAVIDADE_PONTOS'), vr('FDOC_TIPO_INFRACAO'), helper,
    vr('FDOC_MULTA_MODELO'), fn('fdocMultaBaixarModelo'), fn('frtNormPlaca'), fn('fdocMultaPnum'), fn('fdocMultaPdata'), fn('fdocMultaPhora'),
    fn('fdocMultaMatchPlaca'), fn('fdocMulMatchPlacaSafe'), fn('fdocMultaMatchColab'), fn('fdocMultaImportPreview')].join('\n'), ctx);
  ok('multas: gera xlsx', ctx.fdocMultaBaixarModelo() === 'xlsx');
  const mul = saida[0];
  conferirModelo('modelo_importacao_multas', mul, 'Multas', ['Placa']);
  ok('multas: mesmas colunas do modelo anterior', mul.abas[0].aoa[0].join('|') === 'Placa|Nº Auto|Órgão|Data Infração|Hora|Município|Local|Código|Tipo de Infração|Gravidade|Pontos|Valor|Valor C/ Desconto|Desconto|Vencimento|Status|Recurso|Condutor|RE|Observação');
  ctx.fdocMultaImportPreview([linhaDoExemplo(mul)]);
  const m = (ctx._fdocMulImport || [])[0] || {};
  ok('multas: importador lê todas as colunas do modelo',
    m.placa === 'ABC-1D23' && m.numero_auto === 'E-123456' && m.orgao_emissor === 'DETRAN-SP' && m.data_infracao === '2026-09-21'
    && m.hora_infracao === '14:30' && m.municipio_infracao === 'São Paulo/SP' && m.local_infracao === 'Av. Paulista, 1000'
    && m.codigo_infracao === '745-50' && m.tipo_infracao === 'Velocidade' && m.gravidade === 'Média' && m.pontos_cnh === 4
    && m.valor === 195.23 && m.valor_desconto === 156.18 && m.desconto_disponivel === true && m.data_vencimento === '2026-09-30'
    && m.status === 'Pendente' && m.colaborador_id === 'c1' && m.observacao === 'Pagamento antecipado', m);

  // ── Pedágios ──────────────────────────────────────────────
  saida = [];
  ctx = { console: console, XLSX: xlsxFake(saida), contratos: [], frt_veiculos: [{ id: 'v1', placa: 'ABC1D23', modelo: 'Strada' }], frt_pedagios: [] };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(helper, ctx);
  vm.runInContext(pedSvc, ctx);
  vm.runInContext(pedUi, ctx);
  ok('pedágios: gera xlsx pelo helper comum', ctx.frtPedBaixarModelo() === 'xlsx');
  const ped = saida[0];
  conferirModelo('modelo_importacao_pedagios', ped, 'Pedagios', ['Data/hora', 'Placa', 'Valor']);
  const normHead = new Function('return ' + /function _normHead\(s\)\{[\s\S]*?\n  \}/.exec(pedUi)[0])();
  const linha = linhaDoExemplo(ped);
  const norm = {};
  Object.keys(linha).forEach(function (k) { norm[normHead(k)] = linha[k]; });
  const p = ctx.CENA.Frotas.Pedagios._svc.mapearLinhaImport(norm);
  ok('pedágios: importador lê todas as colunas do modelo',
    p.placa === 'ABC1D23' && p.veiculo_id === 'v1' && p.valor === 21.4 && p.praca === 'Praça Castelo' && p.rodovia === 'SP-348'
    && p.concessionaria === 'CCR' && p.centro_custo === 'CC-001' && p.tipo === 'PASSAGEM' && p.origem === 'importacao'
    && p.status === 'VALIDADO' && /^2026-09-24T/.test(p.data_hora), p);

  // ── Telas e versão ────────────────────────────────────────
  ok('Combustível: botão Modelo Excel', /onclick="frtCombBaixarModelo\(\)"[^>]*>⬇ Modelo Excel</.test(html));
  ok('Combustível: modal de importação com Baixar modelo', /onclick="frtCombBaixarModelo\(\)">⬇ Baixar modelo</.test(html));
  ok('Pedágios: botões Importar Excel e Modelo Excel', /onclick="frtPedAbrirImportar\(\)"[^>]*>📊 Importar Excel</.test(html) && /onclick="frtPedBaixarModelo\(\)"[^>]*>⬇ Modelo Excel</.test(html));
  ok('Multas: botão Modelo Excel', /onclick="fdocMultaBaixarModelo\(\)"[^>]*>⬇ Modelo Excel</.test(html));
  ok('versão 8.1.166 no changelog', /\{v:'8\.1\.166'/.test(html) && /'cena-8\.1\.\d+'/.test(sw));
  ok('cache do pedagios.js renovado', /pedagios\.js\?v=8\.1\.166/.test(html));

  if (failed.length) { console.error('FALHOU:\n- ' + failed.join('\n- ')); process.exit(1); }
  console.log('frotas-modelos-importacao: OK (' + total + ' verificações)');
})().catch(function (e) { console.error(e); process.exit(1); });
