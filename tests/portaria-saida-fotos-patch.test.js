'use strict';
// Portaria 8.1.224 — PATCH 400 em frotas_portaria_saidas (17/10/2026): depois do insert da saída, cada foto/campo ia num
// PATCH separado e 8 campos não existem na tabela (km_foto_url, foto_odometro_b64, fotos_carga_extras, foto_extra_1/2_b64,
// km_lido_ocr, km_ocr_confianca, km_confirmado_por) → ~5 respostas 400 por saída. Agora: 1 PATCH só com colunas reais;
// KM e extras no pacote {v:1} que portAplicarFotosPacote já lê; OCR nas colunas novas quando existirem, senão no pacote.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execSync } = require('child_process');

const raiz = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const off = fs.readFileSync(path.join(raiz, 'portaria-offline.js'), 'utf8').replace(/\r\n/g, '\n');
const failed = [];
let total = 0;
function ok(name, cond, detail) { total++; if (!cond) failed.push(name + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 400) : '')); }
function fnDe(src, nome) {
  const m = new RegExp('\\n(?:async )?function ' + nome + '\\(').exec(src);
  if (!m) throw new Error('função não encontrada: ' + nome);
  const re = /\n(?:async function |function |var |\/\/ ═|\/\/ ──|\/\*\*|\/\* )/g;
  re.lastIndex = m.index + 12;
  const f = re.exec(src);
  return src.slice(m.index + 1, f ? f.index : undefined);
}
const fn = n => fnDe(html, n);
const semComent = s => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

// Colunas reais de public.frotas_portaria_saidas em produção (17/10/2026), antes da migration 20261017120000.
const COLS = ['id', 'veiculo_id', 'placa', 'modelo', 'motorista', 'equipe_id', 'equipe_nome', 'contrato_id', 'contrato_nome',
  'base_saida', 'data_saida', 'previsao_retorno', 'km_saida', 'km_retorno', 'data_retorno', 'base_retorno', 'status', 'obs',
  'obs_retorno', 'registrado_por', 'criado_em', 'deleted_at', 'foto_carga_saida_b64', 'foto_carga_saida_ts',
  'foto_carga_retorno_b64', 'foto_carga_retorno_ts', 'tem_materiais_saida', 'retorno_registrado_por', 'status_devolucao',
  'destino', 'equipe', 'quem_saiu', 'liberado_por', 'tipo_liberacao', 'km_ajustes', 'km_ajustado_por', 'km_ajustado_em',
  'km_ajuste_justificativa', 'saida_principal_id'];
const OCR = ['km_lido_ocr', 'km_ocr_confianca', 'km_confirmado_por', 'km_confirmado_em'];

const varOcr = (html.match(/\nvar PORT_SAIDA_COLS_OCR=[^\n]*/) || [''])[0];
const NOVAS = ['portSaidaTemColsOcr', 'portSaidaOcrMeta', 'portSaidaPatchFotos', 'portGravarFotosSaida'];
const codigoNovo = varOcr + '\n' + NOVAS.map(fn).join('\n');
ok('ES5 nas funções novas (fora async/await já usado na Portaria)', !/\blet\s|\bconst\s|=>|`/.test(semComent(codigoNovo)));

// Banco simulado: PostgREST recusa (400) qualquer coluna fora da tabela.
function ctxBanco(opts) {
  opts = opts || {};
  const cols = new Set(COLS.concat(opts.comOcr ? OCR : []));
  const banco = [];
  const ctx = {
    console: { log() {}, warn() {}, error() {} }, Promise, Math, String, Object, Array, JSON, Date, isNaN, parseFloat,
    crypto: { randomUUID: () => 'aaaaaaaa-bbbb-4ccc-8ddd-' + String(banco.length + 100000000000).slice(-12) },
    DEMO: false, banco, patches: [], erros400: 0,
    async portUploadFotoSaida(v) { return v || null; },
    async sbInsert(t, row) {
      if (Object.keys(row).some(k => !cols.has(k))) { ctx.erros400++; return null; }
      if (banco.some(b => b.id === row.id)) return null;
      const linha = {}; cols.forEach(k => { linha[k] = null; }); Object.assign(linha, row);
      banco.push(linha);
      return [Object.assign({}, linha)];
    },
    async sbFetch(t, o) {
      const id = (o.filters[0] || '').replace('id=eq.', '');
      return banco.filter(b => b.id === id).map(b => Object.assign({}, b));
    },
    async sbUpdate(t, data, filtro) {
      ctx.patches.push(Object.assign({}, data));
      if (opts.falhaPatch && opts.falhaPatch(data, ctx.patches.length)) return false;
      if (Object.keys(data).some(k => !cols.has(k))) { ctx.erros400++; return false; }
      const id = filtro.replace(/^.*id=eq\./, '');
      const b = banco.find(x => x.id === id);
      if (b) Object.assign(b, data);
      return true;
    },
  };
  ctx.portPatchFotoCampo = async (id, campo, valor) => {
    if (valor == null || valor === '') return false;
    const o = {}; o[campo] = valor; return !!(await ctx.sbUpdate('frotas_portaria_saidas', o, 'id=eq.' + id));
  };
  vm.createContext(ctx);
  vm.runInContext(['isUUID', 'gerarUUID', 'portPickCols', 'portFotoCampoSrc', 'portSaidaJaGravada', 'portFotoSrcValido',
    'portAplicarFotosPacote', 'portInsertSaidaDB'].map(fn).join('\n') + '\n' + codigoNovo, ctx);
  return ctx;
}

const ID = '11111111-2222-4333-8444-555555555555';
const JPG = n => 'data:image/jpeg;base64,' + n;
const saida = extra => Object.assign({ id: ID, placa: 'TTN6F14', modelo: 'STRADA', tipo_liberacao: 'equipe', equipe: 'EON192',
  equipe_id: '99999999-2222-4333-8444-555555555555', km_saida: 37037, data_saida: '2026-10-17T11:40:31.647Z', status: 'Em campo',
  motorista: 'X', liberado_por: 'Portaria Coaquira 1' }, extra || {});
const OCR_TELA = { km_lido_ocr: 37037, km_ocr_confianca: 0.85, km_confirmado_por: 'Portaria Coaquira 1', km_confirmado_em: '2026-10-17T11:40:30.000Z' };
const lerPacote = c => { try { return JSON.parse(c.banco[0].foto_carga_saida_b64); } catch (e) { return null; } };
const recuperar = c => c.portAplicarFotosPacote(Object.assign({}, c.banco[0]));

(async () => {
  // 1. Saída completa (hodômetro + carga + 2 extras + OCR + materiais), banco SEM colunas de OCR (hoje)
  let c = ctxBanco();
  let s = saida(Object.assign({ km_foto_url: JPG('KM'), foto_carga_saida_b64: JPG('CARGA'), foto_carga_saida_ts: '2026-10-17T11:40:20.000Z',
    fotos_carga_extras: [JPG('E1'), { nome: 'Baú', b64: JPG('E2') }], tem_materiais_saida: false }, OCR_TELA));
  let r = await c.portInsertSaidaDB(s);
  ok('saída completa: insert gravou 1 linha', r && r[0] && r[0].id === ID && c.banco.length === 1);
  ok('saída completa: nenhum 400', c.erros400 === 0, c.erros400);
  ok('saída completa: 1 PATCH só (antes eram 9)', c.patches.length === 1, c.patches.map(p => Object.keys(p)));
  ok('saída completa: PATCH só com colunas reais', c.patches.every(p => Object.keys(p).every(k => COLS.includes(k))), c.patches.map(p => Object.keys(p)));
  let pk = lerPacote(c);
  ok('hodômetro: foto no pacote', pk && pk.v === 1 && pk.km === JPG('KM'));
  ok('carga: foto no pacote', pk && pk.carga === JPG('CARGA'));
  ok('extras: as 2 imagens no pacote', pk && pk.extras.length === 2 && pk.extras[0].url === JPG('E1') && pk.extras[1].url === JPG('E2') && pk.extras[1].nome === 'Baú');
  ok('OCR sem colunas: vai no pacote (não se perde)', pk && pk.km_ocr && pk.km_ocr.km_lido_ocr === 37037 && pk.km_ocr.km_ocr_confianca === 0.85
    && pk.km_ocr.km_confirmado_por === 'Portaria Coaquira 1' && pk.km_ocr.km_confirmado_em === OCR_TELA.km_confirmado_em, pk && pk.km_ocr);
  ok('horário da carga e materiais gravados', c.banco[0].foto_carga_saida_ts === '2026-10-17T11:40:20.000Z' && c.banco[0].tem_materiais_saida === false);
  let rec = recuperar(c);
  ok('leitura: tela recupera hodômetro, carga e extras do pacote', rec.km_foto_url === JPG('KM') && rec.foto_carga_saida_b64 === JPG('CARGA')
    && rec.fotos_carga_extras.length === 2, { km: rec.km_foto_url, carga: rec.foto_carga_saida_b64 });

  // 2. Banco COM colunas de OCR (depois da migration): OCR direto nas colunas, ainda 1 PATCH
  c = ctxBanco({ comOcr: true });
  await c.portInsertSaidaDB(saida(Object.assign({ km_foto_url: JPG('KM'), foto_carga_saida_b64: JPG('CARGA') }, OCR_TELA)));
  pk = lerPacote(c);
  ok('com migration: 1 PATCH, nenhum 400', c.patches.length === 1 && c.erros400 === 0, c.patches.map(p => Object.keys(p)));
  ok('com migration: OCR nas colunas', OCR.every(k => c.banco[0][k] === OCR_TELA[k]), OCR.map(k => c.banco[0][k]));
  ok('com migration: OCR não duplica no pacote', pk && !('km_ocr' in pk) && pk.km === JPG('KM'));

  // 3. Só carga (sem hodômetro nem extras): continua JPEG puro na coluna, como antes
  c = ctxBanco();
  await c.portInsertSaidaDB(saida({ foto_carga_saida_b64: JPG('CARGA') }));
  ok('só carga: JPEG puro (sem pacote), 1 PATCH', c.banco[0].foto_carga_saida_b64 === JPG('CARGA') && c.patches.length === 1 && c.erros400 === 0);

  // 4. Só hodômetro
  c = ctxBanco();
  await c.portInsertSaidaDB(saida({ km_foto_url: JPG('KM') }));
  pk = lerPacote(c);
  ok('só hodômetro: pacote com km e carga vazia', pk && pk.km === JPG('KM') && pk.carga === null && c.erros400 === 0);
  ok('só hodômetro: tela recupera a foto', recuperar(c).km_foto_url === JPG('KM'));

  // 5. Sem foto nenhuma e sem OCR (KM digitado): nada além do insert
  c = ctxBanco();
  await c.portInsertSaidaDB(saida({ km_lido_ocr: null, km_ocr_confianca: 0 }));
  ok('sem foto: nenhum PATCH de foto vazia', c.patches.every(p => !('foto_carga_saida_b64' in p)) && c.erros400 === 0, c.patches);
  c = ctxBanco({ comOcr: true });
  await c.portInsertSaidaDB(saida({ km_lido_ocr: null, km_ocr_confianca: 0, km_confirmado_por: 'P1' }));
  ok('com migration: confiança 0 (OCR falhou) é gravada, não descartada', c.banco[0].km_ocr_confianca === 0 && c.banco[0].km_confirmado_por === 'P1' && c.erros400 === 0);

  // 6. PATCH conjunto falha (rede/tamanho): foto gravada sozinha, depois o resto
  c = ctxBanco({ falhaPatch: (d, n) => n === 1 });
  await c.portInsertSaidaDB(saida(Object.assign({ km_foto_url: JPG('KM'), foto_carga_saida_b64: JPG('CARGA'), tem_materiais_saida: true }, OCR_TELA)));
  pk = lerPacote(c);
  ok('falha no conjunto: tenta a foto sozinha e grava o pacote', pk && pk.km === JPG('KM') && pk.carga === JPG('CARGA'), c.patches.map(p => Object.keys(p)));
  ok('falha no conjunto: materiais gravados depois', c.banco[0].tem_materiais_saida === true);
  ok('falha no conjunto: nenhum 400 de coluna', c.erros400 === 0);

  // 7. Pacote recusado: cai para a carga pura (comportamento antigo)
  c = ctxBanco({ falhaPatch: d => typeof d.foto_carga_saida_b64 === 'string' && d.foto_carga_saida_b64.charAt(0) === '{' });
  await c.portInsertSaidaDB(saida({ km_foto_url: JPG('KM'), foto_carga_saida_b64: JPG('CARGA') }));
  ok('pacote recusado: carga pura preservada', c.banco[0].foto_carga_saida_b64 === JPG('CARGA'), c.patches.map(p => Object.keys(p)));

  // 8. Registros antigos: formatos já gravados continuam sendo lidos igual
  c = ctxBanco();
  const antigoPacote = { foto_carga_saida_b64: JSON.stringify({ v: 1, carga: JPG('C'), km: JPG('K'), extras: [{ i: 0, nome: 'extra_1', url: JPG('X'), b64: JPG('X') }] }) };
  rec = c.portAplicarFotosPacote(Object.assign({}, antigoPacote));
  ok('antigo: pacote v1 (sem km_ocr) recupera km, carga e extra', rec.km_foto_url === JPG('K') && rec.foto_carga_saida_b64 === JPG('C') && rec.fotos_carga_extras[0].url === JPG('X'));
  rec = c.portAplicarFotosPacote({ foto_carga_saida_b64: JPG('SO') });
  ok('antigo: carga em JPEG puro continua igual', rec.foto_carga_saida_b64 === JPG('SO') && !rec.km_foto_url);
  rec = c.portAplicarFotosPacote({ foto_carga_saida_b64: JSON.stringify({ v: 1, carga: JPG('C'), km: JPG('K'), extras: [], km_ocr: OCR_TELA }) });
  ok('novo: pacote com km_ocr é lido pela função antiga sem mudança', rec.km_foto_url === JPG('K') && rec.foto_carga_saida_b64 === JPG('C'));
  ok('leitura de fotos não foi alterada', fn('portAplicarFotosPacote') === fnDe(execSync('git show HEAD:index.html', { cwd: raiz, maxBuffer: 1 << 30 }).toString('utf8').replace(/\r\n/g, '\n'), 'portAplicarFotosPacote'));

  // 9. Sincronização offline: SAIDA passa pelo mesmo portInsertSaidaDB
  c = ctxBanco();
  vm.runInContext(['portOffFetchPorEventId', 'portOffSyncSaida', 'portOffAplicarSaidaMemoria'].map(n => fnDe(off, n)).join('\n')
    + '\nvar PORT_OFF_COLS_AUSENTES={frotas_portaria_saidas:{offline_event_id:1, retorno_offline_event_id:1}};', c);
  c.frt_portaria = [];
  c.portOffRestaurarFotos = async f => f;
  c.portOffApagarFotos = async () => {};
  const slim = saida(Object.assign({ offline_event_id: ID, dispositivo_id: 'tab-1', registrado_offline: true }, OCR_TELA));
  const ev = { event_id: ID, tipo_evento: 'SAIDA', data_hora_evento: '2026-10-17T11:40:31.647Z', criado_offline: true, dispositivo_id: 'tab-1', timezone_offset: -180,
    payload: { saida: slim, fotos: { km: JPG('KM'), carga: JPG('CARGA'), extras: [JPG('E1')] } } };
  await c.portOffSyncSaida(ev);
  pk = lerPacote(c);
  ok('offline: evento sincronizado com o id do servidor', ev.status_sync === 'SINCRONIZADO' && ev.payload.server_id === ID);
  ok('offline: nenhum 400 (insert e PATCH)', c.erros400 === 0, c.erros400);
  ok('offline: fotos e OCR gravados no pacote', pk && pk.km === JPG('KM') && pk.carga === JPG('CARGA') && pk.extras.length === 1 && pk.km_ocr && pk.km_ocr.km_lido_ocr === 37037);
  ok('offline: horário real da saída (sem recálculo)', c.banco[0].data_saida === '2026-10-17T11:40:31.647Z');

  // 10. Varredura: nenhum PATCH de frotas_portaria_saidas com campo literal inexistente
  const todasCols = COLS.concat(OCR);
  const ruins = [];
  for (const [nome, src] of [['index.html', html], ['portaria-offline.js', off]]) {
    const reCampo = /portPatchFotoCampo\([^,]+,\s*'([a-z_0-9]+)'/g; let m;
    while ((m = reCampo.exec(src))) if (!COLS.includes(m[1])) ruins.push(nome + ': portPatchFotoCampo ' + m[1]);
    const reLit = /sbUpdate\('frotas_portaria_saidas',\s*\{([^}]*)\}/g;
    while ((m = reLit.exec(src))) {
      (m[1].match(/(?:^|,)\s*([a-z_0-9]+)\s*:/g) || []).map(x => x.replace(/[,:\s]/g, '')).forEach(k => { if (!COLS.includes(k)) ruins.push(nome + ': sbUpdate ' + k); });
    }
  }
  ok('varredura: nenhum campo inexistente em PATCH literal da Portaria', ruins.length === 0, ruins);
  const corpoGravar = fn('portSaidaPatchFotos');
  ok('pacote só usa colunas reais + OCR condicional', /patch\.foto_carga_saida_b64=/.test(corpoGravar) && !/km_foto_url\s*:|fotos_carga_extras\s*:|foto_odometro_b64|foto_extra_/.test(semComent(corpoGravar)));
  ok('retorno offline: PATCH só com colunas reais', (() => {
    const b = fnDe(off, 'portOffSyncRetorno'); const m = /var patch=\{([\s\S]*?)\n  \};/.exec(b);
    return m && semComent(m[1]).match(/([a-z_0-9]+)\s*:/g).map(x => x.replace(/[:\s]/g, '')).every(k => COLS.includes(k));
  })());

  // 11. Escopo. (a) A ENTREGA da 8.1.224 (base c27358c → release a557b5d) só mudou funções da Portaria — comparação entre
  //     commits fixos, para não quebrar com versões seguintes aprovadas (8.1.225 mexe também em Frotas/Showroom).
  //     (b) No arquivo atual, TMA/PP/Diário/SOT continuam idênticos à base. Commit ausente: falha clara.
  const showCommit = c => { try { return execSync('git show ' + c + ':index.html', { cwd: raiz, maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8').replace(/\r\n/g, '\n'); }
    catch (e) { console.error('FALHOU: commit histórico ' + c + ' indisponível — verificação de escopo não pode ser feita.'); process.exit(1); } };
  const BASE_224 = process.env.PORT224_BASE || 'c27358c', REL_224 = process.env.PORT224_RELEASE || 'a557b5d';
  const htmlBase = showCommit(BASE_224), htmlRel = showCommit(REL_224);
  ok('escopo: commits históricos certos (8.1.224 na release, não na base)', /numero: '8\.1\.224'/.test(htmlRel) && !/numero: '8\.1\.224'/.test(htmlBase));
  const nomes = src => { const s = new Set(); const re = /\n(?:async )?function ([A-Za-z0-9_$]+)\(/g; let m; while ((m = re.exec(src))) s.add(m[1]); return s; };
  const difs = (a, b) => { const nA = nomes(a), nB = nomes(b), out = [];
    nB.forEach(n => { if (!nA.has(n) || fnDe(a, n) !== fnDe(b, n)) out.push(n); });
    nA.forEach(n => { if (!nB.has(n)) out.push('-' + n); }); return out; };
  const mudou224 = difs(htmlBase, htmlRel);
  ok('escopo: a entrega da 8.1.224 só alterou funções da Portaria', mudou224.length > 0 && mudou224.every(n => /^-?port[A-Z]/.test(n)), mudou224);
  const mudouAgora = difs(htmlBase, html);
  ok('escopo: TMA/PP/Diário/SOT idênticos à base no arquivo atual', !mudouAgora.some(n => /tma|progProj|pp[A-Z]|diario|sot/i.test(n)), mudouAgora.filter(n => /tma|progProj|pp[A-Z]|diario|sot/i.test(n)));

  if (failed.length) { console.error('FALHOU ' + failed.length + '/' + total + ':\n- ' + failed.join('\n- ')); process.exit(1); }
  console.log('portaria-saida-fotos-patch: OK (' + total + ' verificações)');
})().catch(e => { console.error(e); process.exit(1); });
