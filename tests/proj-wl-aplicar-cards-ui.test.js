'use strict';
// ETAPA 1.5b-1 — botão "Aplicar estrutura" (aba 📥 LMS, só em ESTRUTURA_PENDENTE com pode_aplicar, confirm(), recarga do
// projeto, recusas traduzidas, migration ausente sem quebrar) e selo WL nos cards (lote ≤500, cache, fallback pela sot_wl).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const failed = [];
let total = 0;
function ok(name, cond, detail) { total++; if (!cond) failed.push(name + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 400) : '')); }
function fnTexto(nome) {
  const m = new RegExp('\\n(?:async )?function ' + nome + '\\(').exec(html);
  if (!m) throw new Error('função não encontrada: ' + nome);
  const re = /\n(?:async function |function |var |\/\/ ═)/g;
  re.lastIndex = m.index + 12;
  const f = re.exec(html);
  return html.slice(m.index + 1, f ? f.index : undefined);
}
const iConf = html.indexOf('// ETAPA 1.3 — LMS: Confirmação humana do RASCUNHO (Projetos)');
const fim = html.indexOf('\nfunction renderProjetosPorContrato(', iConf);
const blocos = html.slice(iConf, fim);   // confirmação + envio + 1.5a/1.5b-1
const semComent = s => s.replace(/\/\/[^\n]*/g, '');

// ── Estáticos ───────────────────────────────────────────────────
const i15 = html.indexOf('// ETAPA 1.5a — WL oficial nas telas do projeto');
ok('ES5 nos trechos novos (sem let/const/arrow/template)', !/\blet\s|\bconst\s|=>|`/.test(semComent(html.slice(i15, fim)))
  && !/\blet\s|\bconst\s|=>|`/.test(semComent(fnTexto('projLmsUpAplicar') + fnTexto('projLmsUpCardPendenteHtml'))));
ok('fn_proj_lms_aplicar_estrutura_nova só em projLmsUpAplicar (após confirm)',
  (html.match(/'fn_proj_lms_aplicar_estrutura_nova'/g) || []).length === 1 && /if\(!ok\) return;[\s\S]*'fn_proj_lms_aplicar_estrutura_nova'/.test(fnTexto('projLmsUpAplicar')));
ok('projLmsUpAplicar só é chamado pelo botão (definição + 1 onclick)', (html.match(/projLmsUpAplicar\(/g) || []).length === 2);
ok('situação lê sot_lms_original_do_projeto', /'sot_lms_original_do_projeto'/.test(fnTexto('projLmsUpSituacao')));
ok('as duas listas pedem os selos em lote depois de renderizar',
  /sotWlSelosCards\(rows\.map/.test(fnTexto('sotRenderProjetos')) && /sotWlSelosCards\(rows\.map/.test(fnTexto('coRenderProjetos')));
ok('card tem o espaço do selo', /id="sot-card-selo-'\+p\.id\+'"/.test(fnTexto('sotRenderCardProjeto')));
ok('não mexe em medição/seletores/PLPT/validação/Jornada nesta etapa',
  !/sotWlSelos|sotWlSeloCardHtml|projLmsUpAplicar|sot_lms_original|estado_wl_lote/.test(fnTexto('sotRenderTabMedicao') + fnTexto('sotRenderTabReserva') + fnTexto('sotValidarLancamento')));

// ── vm ──────────────────────────────────────────────────────────
const PJ = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const IMP = '11111111-1111-4111-8111-111111111111';
const U = n => `cccccccc-cccc-4ccc-8ccc-${String(n).padStart(12, '0')}`;
function montar(cfg) {
  cfg = cfg || {};
  const els = {};
  const log = { rpc: [], fetch: [], toast: [], confirm: [], abriu: [] };
  const el = id => els[id] || (els[id] = { id, innerHTML: '', style: {}, classList: { contains: () => false } });
  el('sot-tab-content');
  const sb = {
    console: { error() {}, warn() {}, log() {} }, DEMO: false, SB: { url: 'https://x', key: 'k' },
    window: { _sotTabAtiva: 'lms' }, usuarioLogado: { id: 'u1' }, XLSX: {},
    sot_projetos: [{ id: PJ, nome: 'Obra EN', codigo_cliente: 'EN-1' }],
    sot_atividades: [], sot_atividades_desc: [], sot_materiais_proj: [], sot_materiais_desc: [],
    isUUID: v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v)),
    _escapeHtml: v => String(v == null ? '' : v), escHtml: v => String(v == null ? '' : v),
    cenaAuthGetValidToken: async () => (cfg.token === undefined ? 'jwt' : cfg.token), sbAuthJwtIsAuthenticated: t => t === 'jwt',
    document: { getElementById: id => els[id] || (/^sot-card-selo-/.test(id) ? el(id) : null) },
    confirm: m => { log.confirm.push(m); return cfg.confirmar !== false; },
    progShowToast: (m, t) => log.toast.push((t || 'ok') + ':' + m),
    sotAbrirProjeto: id => log.abriu.push(id),
    sbFetch: async (t, o) => { log.fetch.push({ t, f: (o && o.filters) || [] }); return cfg.sbFetch ? cfg.sbFetch(t, o) : []; },
    fetch: async (url, opt) => {
      const fn = url.split('/rpc/')[1];
      const body = JSON.parse(opt.body || '{}');
      log.rpc.push({ fn, body });
      const r = cfg.rpc && cfg.rpc[fn] ? cfg.rpc[fn](body)
        : fn === 'sot_lms_autorizar_recebimento' ? { s: 200, b: { permitido: true, motivo: 'OK' } }
        : fn === 'sot_lms_estado_wl' ? { s: 200, b: cfg.estado || 'ESTRUTURA_PENDENTE' }
        : fn === 'sot_lms_rascunhos_listar' ? { s: 200, b: [] }
        : fn === 'sot_lms_original_do_projeto' ? { s: 200, b: cfg.original === undefined ? { existe: true, importacao_id: IMP, modo: 'ESTRUTURA_NOVA',
            estado: 'ESTRUTURA_PENDENTE', pode_aplicar: true, arquivo_nome_original: 'Modelo LMS.xlsx', qtd_linhas: 200, qtd_wls_distintas: 12 } : cfg.original }
        : fn === 'fn_proj_lms_aplicar_estrutura_nova' ? { s: 200, b: { operacao: 'ESTRUTURA_APLICADA', wls: 12, atividades: 16, materiais_operacionais: 92, materiais_retirada_descritivos: 92, estado_wl: 'ESTRUTURADO' } }
        : { s: 404, b: { code: 'PGRST202', message: 'Could not find the function' } };
      return { ok: r.s < 400, status: r.s, text: async () => JSON.stringify(r.b) };
    }
  };
  vm.createContext(sb);
  vm.runInContext(blocos, sb);
  return { sb, els, log, html: () => els['sot-tab-content'].innerHTML };
}
const tick = () => new Promise(r => setImmediate(r));

(async () => {
  // ── Botão "Aplicar estrutura" ──────────────────────────────────
  let t = montar();
  await t.sb.projLmsUpCarregar(PJ, t.els['sot-tab-content']);
  let h = t.html();
  ok('pendente + pode_aplicar: card "Estrutura pendente" com arquivo/linhas/WLs e botão', /id="proj-lms-up-pendente"/.test(h)
    && /Modelo LMS\.xlsx · 200 linhas · 12 WL\(s\)/.test(h) && /id="proj-lms-up-aplicar"[^>]*>Aplicar estrutura</.test(h));
  ok('pendente: envio continua bloqueado', /proj-lms-up-bloqueio/.test(h) && !/id="proj-lms-up-arquivo"/.test(h));
  ok('carregar a aba não aplica nada', !t.log.rpc.some(x => x.fn === 'fn_proj_lms_aplicar_estrutura_nova') && !t.log.confirm.length);

  t = montar({ original: { existe: true, importacao_id: IMP, modo: 'ESTRUTURA_NOVA', estado: 'ESTRUTURA_PENDENTE', pode_aplicar: false } });
  await t.sb.projLmsUpCarregar(PJ, t.els['sot-tab-content']);
  ok('pendente sem PROJ_CONFIRMAR_LMS: sem botão, aviso de aguardando', !/proj-lms-up-aplicar/.test(t.html()) && /Aguardando quem tem a permissão PROJ_CONFIRMAR_LMS/.test(t.html()));

  t = montar({ rpc: { sot_lms_original_do_projeto: () => ({ s: 404, b: { code: 'PGRST202', message: 'Could not find the function' } }) } });
  await t.sb.projLmsUpCarregar(PJ, t.els['sot-tab-content']);
  h = t.html();
  ok('migration ausente: mensagem clara, tela não quebra', /id="proj-lms-up-pendente-ausente"/.test(h) && /20261012100000_proj_lms_leitura_wl\.sql/.test(h)
    && /proj-lms-up-bloqueio/.test(h) && !/proj-lms-up-aplicar/.test(h));

  t = montar({ estado: 'ESTRUTURADO', original: { existe: true, importacao_id: IMP, modo: 'ESTRUTURA_NOVA', estado: 'ESTRUTURADO', pode_aplicar: false } });
  await t.sb.projLmsUpCarregar(PJ, t.els['sot-tab-content']);
  ok('ESTRUTURADO: sem card de pendente', !/proj-lms-up-pendente/.test(t.html()));
  t = montar({ estado: 'LEGADO_SEM_WL', original: { existe: false, estado: 'LEGADO_SEM_WL', pode_aplicar: false } });
  await t.sb.projLmsUpCarregar(PJ, t.els['sot-tab-content']);
  ok('legado: sem card de pendente e envio liberado', !/proj-lms-up-pendente/.test(t.html()) && /id="proj-lms-up-arquivo"/.test(t.html()));

  t = montar({ confirmar: false });
  await t.sb.projLmsUpCarregar(PJ, t.els['sot-tab-content']);
  await t.sb.projLmsUpAplicar();
  ok('cancelar o confirm() não aplica', t.log.confirm.length === 1 && !t.log.rpc.some(x => x.fn === 'fn_proj_lms_aplicar_estrutura_nova'));
  ok('confirm() explica a ação e a irreversibilidade', /Aplicar a estrutura do LMS ORIGINAL ao projeto "Obra EN — EN-1"/.test(t.log.confirm[0])
    && /Linhas: 200 · WLs: 12/.test(t.log.confirm[0]) && /não pode ser desfeita pela tela/.test(t.log.confirm[0]));

  t = montar();
  await t.sb.projLmsUpCarregar(PJ, t.els['sot-tab-content']);
  t.sb._sotWlSelosCache[PJ] = 'ESTRUTURA_PENDENTE';
  await t.sb.projLmsUpAplicar();
  const ap = t.log.rpc.filter(x => x.fn === 'fn_proj_lms_aplicar_estrutura_nova');
  ok('aplicar: chama a função com o id da ORIGINAL', ap.length === 1 && ap[0].body.p_importacao_id === IMP, ap);
  ok('aplicar: resumo no toast, recarrega o projeto e invalida o cache do card',
    /Estrutura aplicada: 12 WL\(s\), 16 atividade\(s\), 92 material\(is\) e 92 retirada\(s\)/.test(t.log.toast.join('|'))
    && t.log.abriu[0] === PJ && !t.sb._sotWlSelosCache.hasOwnProperty(PJ), { toast: t.log.toast, abriu: t.log.abriu });

  t = montar();
  await t.sb.projLmsUpCarregar(PJ, t.els['sot-tab-content']);
  await Promise.all([t.sb.projLmsUpAplicar(), t.sb.projLmsUpAplicar()]);
  ok('duplo clique aplica uma vez só', t.log.rpc.filter(x => x.fn === 'fn_proj_lms_aplicar_estrutura_nova').length === 1);

  const recusas = [
    ['PROJETO_COM_LEGADO', 'WL aplicar: PROJETO_COM_LEGADO (atividades 1, materiais 2)', /itens legados ativos \(1 atividade\(s\), 2 material\(is\)\)/],
    ['LINHA_NAO_CLASSIFICADA', 'WL aplicar: LINHA_NAO_CLASSIFICADA (linhas 5, 9)', /código fora do padrão.*linha\(s\) 5, 9/],
    ['LINHAS_REPETIDAS_NA_CHAVE', 'WL aplicar: LINHAS_REPETIDAS_NA_CHAVE (linhas 4,5)', /repete a mesma WL \+ código \+ FT \+ KIT: linhas 4,5/],
    ['SEM_PERMISSAO', 'WL aplicar: SEM_PERMISSAO', /PROJ_CONFIRMAR_LMS/],
    ['IMPORTACAO_NAO_ELEGIVEL', 'WL aplicar: IMPORTACAO_NAO_ELEGIVEL (tipo ORIGINAL, status CONFIRMADA, modo CONCILIACAO)', /não está confirmada como ESTRUTURA_NOVA/]
  ];
  for (const [nome, msg, re] of recusas) {
    t = montar({ rpc: { fn_proj_lms_aplicar_estrutura_nova: () => ({ s: 400, b: { code: '55000', message: msg } }) } });
    await t.sb.projLmsUpCarregar(PJ, t.els['sot-tab-content']);
    await t.sb.projLmsUpAplicar();
    ok('recusa traduzida: ' + nome, /id="proj-lms-up-aplicar-erro"/.test(t.html()) && re.test(t.html()) && !t.log.abriu.length, t.html().slice(-300));
  }

  // ── Selo nos cards ─────────────────────────────────────────────
  const ids = [U(1), U(2), U(3)];
  t = montar({ rpc: { sot_lms_estado_wl_lote: b => ({ s: 200, b: { [U(1)]: 'ESTRUTURADO', [U(2)]: 'LEGADO_SEM_WL' } }) },
    sbFetch: (tb, o) => (tb === 'sot_wl' ? [{ projeto_id: U(3) }] : []) });
  await t.sb.sotWlSelosCards(ids);
  const lt = t.log.rpc.filter(x => x.fn === 'sot_lms_estado_wl_lote');
  ok('cards: uma chamada em lote para a lista', lt.length === 1 && JSON.stringify(lt[0].body.p_projeto_ids) === JSON.stringify(ids));
  ok('cards: estado do banco vira selo; legado sem selo', /Estruturado</.test(t.els['sot-card-selo-' + U(1)].innerHTML) && t.els['sot-card-selo-' + U(2)].innerHTML === '');
  ok('cards: projeto fora do lote (sem permissão) usa fallback pela sot_wl', /Estruturado \(WL\)/.test(t.els['sot-card-selo-' + U(3)].innerHTML)
    && t.log.fetch.length === 1 && t.log.fetch[0].t === 'sot_wl' && t.log.fetch[0].f.some(f => f === 'projeto_id=in.(' + U(3) + ')'));
  const nRpc = t.log.rpc.length;
  await t.sb.sotWlSelosCards(ids);
  ok('cards: cache por sessão (segunda lista não chama de novo)', t.log.rpc.length === nRpc && t.log.fetch.length === 1);
  t.sb.sotWlSelosInvalidar(U(1));
  await t.sb.sotWlSelosCards(ids);
  ok('cards: invalidação refaz só o projeto invalidado', t.log.rpc.length === nRpc + 1 && JSON.stringify(t.log.rpc[t.log.rpc.length - 1].body.p_projeto_ids) === JSON.stringify([U(1)]));

  const mil = Array.from({ length: 1200 }, (_, i) => U(1000 + i));
  t = montar({ rpc: { sot_lms_estado_wl_lote: b => ({ s: 200, b: Object.fromEntries(b.p_projeto_ids.map(id => [id, 'LEGADO_SEM_WL'])) }) } });
  await t.sb.sotWlSelosCards(mil);
  const fat = t.log.rpc.filter(x => x.fn === 'sot_lms_estado_wl_lote').map(x => x.body.p_projeto_ids.length);
  ok('cards: 1.200 projetos → blocos de no máximo 500', JSON.stringify(fat) === '[500,500,200]' && t.log.fetch.length === 0, fat);

  t = montar({ sbFetch: (tb) => (tb === 'sot_wl' ? [{ projeto_id: U(2) }] : []) });   // RPC de lote ausente (404)
  await t.sb.sotWlSelosCards(ids);
  ok('cards: migration ausente → fallback pela sot_wl para todos, sem quebrar', /Estruturado \(WL\)/.test(t.els['sot-card-selo-' + U(2)].innerHTML)
    && t.els['sot-card-selo-' + U(1)].innerHTML === '' && t.log.fetch.length === 1);
  t = montar({ sbFetch: (tb) => (tb === 'sot_wl' ? Array.from({ length: 0 }) : []) });
  await t.sb.sotWlSelosCards(Array.from({ length: 250 }, (_, i) => U(5000 + i)));
  ok('cards: fallback em blocos de 100 ids', t.log.fetch.filter(x => x.t === 'sot_wl').length === 3);
  t = montar({ token: 'anon-key' });
  await t.sb.sotWlSelosCards(ids);
  ok('cards: login MD5/anon → sem RPC; fallback sem dado = sem selo, sem erro', !t.log.rpc.length && ids.every(id => t.els['sot-card-selo-' + id].innerHTML === ''));
  t = montar();
  await t.sb.sotWlSelosCards(['nao-uuid', '', null]);
  ok('cards: ids inválidos ignorados', !t.log.rpc.length && !t.log.fetch.length);
  ok('selo do card: pendente e conciliação têm rótulo; legado não', /Estrutura pendente/.test(t.sb.sotWlSeloCardHtml('ESTRUTURA_PENDENTE'))
    && /Em conciliação/.test(t.sb.sotWlSeloCardHtml('EM_CONCILIACAO')) && t.sb.sotWlSeloCardHtml('LEGADO_SEM_WL') === '' && t.sb.sotWlSeloCardHtml('') === '');

  if (failed.length) {
    console.log(`proj-wl-aplicar-cards-ui: FALHOU ${failed.length}/${total}`);
    for (const f of failed) console.log('  - ' + f);
    process.exit(1);
  }
  console.log(`proj-wl-aplicar-cards-ui: OK (${total} verificações)`);
})().catch(e => { console.error(e); process.exit(1); });
