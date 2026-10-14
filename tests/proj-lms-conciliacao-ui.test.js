'use strict';
// ETAPA 1.6b — aba 📥 LMS: card "Conciliação com o LMS" (projeto EM_CONCILIACAO), prévia sot_lms_conciliacao_previa,
// botão "Aplicar conciliação" (fn_proj_lms_aplicar_conciliacao) com confirm(), duplo clique, recusas traduzidas,
// migration ausente/erros sem quebrar a aba, e paridade dos demais estados com a versão anterior (enel-etapa16, via git).
// Prévias de teste espelham as reais lidas em 13/10/2026 (DFdfSDF liberado; ETD VARGINHA bloqueado).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const raiz = path.join(__dirname, '..');
const norm = s => s.replace(/\r\n/g, '\n');
const html = norm(fs.readFileSync(path.join(raiz, 'index.html'), 'utf8'));
const BASE = process.env.CONC_UI_BASE || 'enel-etapa16';
const htmlAntes = norm(execFileSync('git', ['show', BASE + ':index.html'], { cwd: raiz, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
const failed = [];
let total = 0;
function ok(name, cond, detail) { total++; if (!cond) failed.push(name + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 500) : '')); }
function fnTexto(h, nome) {
  const m = new RegExp('\\n(?:async )?function ' + nome + '\\(').exec(h);
  if (!m) throw new Error('função não encontrada: ' + nome);
  const re = /\n(?:async function |function |var |\/\/ ═)/g;
  re.lastIndex = m.index + 12;
  const f = re.exec(h);
  return h.slice(m.index + 1, f ? f.index : undefined);
}
const blocosDe = h => { const i = h.indexOf('// ETAPA 1.3 — LMS: Confirmação humana do RASCUNHO (Projetos)');
  return h.slice(i, h.indexOf('\nfunction renderProjetosPorContrato(', i)); };
const semComent = s => s.replace(/\/\/[^\n]*/g, '');

// ── Estáticos ───────────────────────────────────────────────────
const iC = html.indexOf('// ── Etapa 1.6b: conciliação com o LMS');
const fC = html.indexOf('// Modelo LMS em branco', iC);
const novo = html.slice(iC, fC);
ok('bloco 1.6b presente', iC > 0 && fC > iC);
ok('ES5 no bloco 1.6b e na leitura da prévia', !/\blet\s|\bconst\s|=>|`/.test(semComent(novo)) && !/\blet\s|\bconst\s|=>|`/.test(semComent(fnTexto(html, 'projLmsUpSituacao'))));
ok('aplicação da conciliação só em projLmsUpAplicarConciliacao, depois do confirm()', (html.match(/'fn_proj_lms_aplicar_conciliacao'/g) || []).length === 1
  && /if\(!ok\) return;[\s\S]*'fn_proj_lms_aplicar_conciliacao'/.test(fnTexto(html, 'projLmsUpAplicarConciliacao')));
ok('projLmsUpAplicarConciliacao só é chamado pelo botão', (html.match(/projLmsUpAplicarConciliacao\(/g) || []).length === 2);
ok('prévia só é lida em projLmsUpSituacao e só em EM_CONCILIACAO', (html.match(/'sot_lms_conciliacao_previa'/g) || []).length === 1
  && /s\.estado === 'EM_CONCILIACAO' && s\.original/.test(fnTexto(html, 'projLmsUpSituacao')));
ok('nada grava em tabela pela tela da conciliação', !/sb(Insert|Update|Delete)\(/.test(novo));

// ── vm ──────────────────────────────────────────────────────────
const PJ = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const IMP = '11111111-1111-4111-8111-111111111111';
const lmsLinha = (wl, ft, kit, un, q, lx) => ({ wl, ft, kit, unidade: un, qtd: q, linha_excel: lx });
const PREVIA_DF = { importacao_id: IMP, projeto_id: PJ, estado: 'EM_CONCILIACAO', aplicada: false, pode_aplicar: true, bloqueios: [],
  resumo: { wls: 12, codigos: 98, linhas_lms: 200, legado_itens: 0, por_situacao: { SEM_LEGADO: 98 } },
  linhas_problema: { nao_classificada: null, sem_wl_ou_descricao: null, repetidas: null },
  itens: [
    { tipo: 'MATERIAL', codigo: '324894', situacao: 'SEM_LEGADO', com_movimento: false, unidade_legado: null, unidade_lms: 'M', qtd_legado: null, qtd_lms: 12,
      legado: [], lms: [lmsLinha('1', 'I', 'NK-AMAR-RC', 'M', 6, 4), lmsLinha('2', 'I', 'NK-AMAR-RC', 'M', 6, 30)] },
    { tipo: 'ATIVIDADE', codigo: 'I-654321', situacao: 'SEM_LEGADO', com_movimento: false, unidade_legado: null, unidade_lms: 'US3', qtd_legado: null, qtd_lms: 1,
      legado: [], lms: [lmsLinha('1', 'I', 'S-654321', 'US3', 1, 9)] }] };
const leg = (id, q, un, mov) => ({ id, descricao: 'ANTIGO', unidade: un, qtd: q, movimento: mov || [] });
const PREVIA_VARG = { importacao_id: IMP, projeto_id: PJ, estado: 'EM_CONCILIACAO', aplicada: false, pode_aplicar: false,
  bloqueios: ['COM_MOVIMENTO', 'UNIDADE_DIFERENTE'],
  resumo: { wls: 6, codigos: 36, linhas_lms: 110, legado_itens: 36, por_situacao: { BATE: 27, UNIDADE_DIFERENTE: 9 } },
  linhas_problema: { nao_classificada: null, sem_wl_ou_descricao: null, repetidas: null },
  itens: [
    { tipo: 'ATIVIDADE', codigo: 'I-8000656', situacao: 'UNIDADE_DIFERENTE', com_movimento: true, unidade_legado: 'UN', unidade_lms: 'US3', qtd_legado: 2, qtd_lms: 2,
      legado: [leg('c7a', 2, 'UN', ['MEDICAO'])], lms: [lmsLinha('5', 'I', 'S-8000656', 'US3', 1, 61), lmsLinha('6', 'I', 'S-8000656', 'US3', 1, 108)] },
    { tipo: 'ATIVIDADE', codigo: 'R-8000656', situacao: 'UNIDADE_DIFERENTE', com_movimento: true, unidade_legado: 'UN', unidade_lms: 'US3', qtd_legado: 2, qtd_lms: 2,
      legado: [leg('91b', 2, 'UN', ['MEDICAO'])], lms: [lmsLinha('5', 'R', 'S-8000656', 'US3', 1, 65), lmsLinha('6', 'R', 'S-8000656', 'US3', 1, 112)] },
    { tipo: 'MATERIAL', codigo: '325070', situacao: 'UNIDADE_DIFERENTE', com_movimento: false, unidade_legado: 'UN', unidade_lms: 'M', qtd_legado: 100, qtd_lms: 100,
      legado: [leg('a4c', 100, 'UN')], lms: [lmsLinha('1', 'I', 'M-0325070', 'M', 50, 5), lmsLinha('4', 'I', 'M-0325070', 'M', 50, 19)] },
    { tipo: 'MATERIAL', codigo: '321638', situacao: 'BATE', com_movimento: false, unidade_legado: 'PC', unidade_lms: 'PC', qtd_legado: 28, qtd_lms: 28,
      legado: [leg('d48', 28, 'PC')], lms: [lmsLinha('5', 'I', 'K-ASQ03TI', 'PC', 7, 20), lmsLinha('5', 'R', 'K-ASQ03TI', 'PC', 7, 44)] }] };
const ORIG = (modo, pode) => ({ existe: true, importacao_id: IMP, modo, estado: modo === 'CONCILIACAO' ? 'EM_CONCILIACAO' : 'ESTRUTURA_PENDENTE',
  pode_aplicar: pode, arquivo_nome_original: 'Modelo LMS.xlsx', qtd_linhas: 200, qtd_wls_distintas: 12 });

function montar(h, cfg) {
  cfg = cfg || {};
  const els = {};
  const log = { rpc: [], toast: [], confirm: [], abriu: [] };
  const el = id => els[id] || (els[id] = { id, innerHTML: '', style: {}, classList: { contains: () => false } });
  el('sot-tab-content');
  const sb = {
    console: { error() {}, warn() {}, log() {} }, DEMO: false, SB: { url: 'https://x', key: 'k' },
    window: { _sotTabAtiva: 'lms' }, usuarioLogado: { id: 'u1' }, XLSX: {},
    sot_projetos: [{ id: PJ, nome: 'TESTE 1', codigo_cliente: 'DFdfSDF' }],
    sot_atividades: [], sot_atividades_desc: [], sot_materiais_proj: [], sot_materiais_desc: [],
    isUUID: v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v)),
    _escapeHtml: v => String(v == null ? '' : v), escHtml: v => String(v == null ? '' : v),
    cenaAuthGetValidToken: async () => 'jwt', sbAuthJwtIsAuthenticated: t => t === 'jwt',
    document: { getElementById: id => els[id] || null },
    confirm: m => { log.confirm.push(m); return cfg.confirmar !== false; },
    progShowToast: (m, t) => log.toast.push((t || 'ok') + ':' + m),
    sotAbrirProjeto: id => log.abriu.push(id),
    fetch: async (url, opt) => {
      const fn = url.split('/rpc/')[1];
      const body = JSON.parse(opt.body || '{}');
      log.rpc.push({ fn, body });
      if (cfg.segurar && fn === cfg.segurar.fn) await cfg.segurar.promessa;
      const r = cfg.rpc && cfg.rpc[fn] ? cfg.rpc[fn](body)
        : fn === 'sot_lms_autorizar_recebimento' ? { s: 200, b: { permitido: true, motivo: 'OK' } }
        : fn === 'sot_lms_estado_wl' ? { s: 200, b: cfg.estado || 'EM_CONCILIACAO' }
        : fn === 'sot_lms_rascunhos_listar' ? { s: 200, b: [] }
        : fn === 'sot_lms_original_do_projeto' ? { s: 200, b: cfg.original === undefined ? ORIG('CONCILIACAO', false) : cfg.original }
        : fn === 'sot_lms_conciliacao_previa' ? { s: 200, b: cfg.previa || PREVIA_DF }
        : fn === 'fn_proj_lms_aplicar_conciliacao' ? { s: 200, b: { operacao: 'CONCILIACAO_APLICADA', wls: 12, atividades: 16, materiais_operacionais: 92,
            materiais_retirada_descritivos: 92, itens_antigos_substituidos: 0, estado_wl: 'ESTRUTURADO' } }
        : { s: 404, b: { code: 'PGRST202', message: 'Could not find the function' } };
      return { ok: r.s < 400, status: r.s, text: async () => JSON.stringify(r.b) };
    }
  };
  vm.createContext(sb);
  vm.runInContext(blocosDe(h), sb);
  return { sb, els, log, html: () => els['sot-tab-content'].innerHTML };
}
const carregar = async t => { await t.sb.projLmsUpCarregar(PJ, t.els['sot-tab-content']); return t.html(); };
const tick = () => new Promise(r => setImmediate(r));

(async () => {
  // ── 1. DFdfSDF: prévia liberada ───────────────────────────────
  let t = montar(html, { previa: PREVIA_DF });
  let h = await carregar(t);
  ok('DFdfSDF: card de conciliação com resumo (0 antigos, 98 códigos, 200 linhas, 12 WLs)', /id="proj-lms-up-conc"/.test(h)
    && /Itens antigos:<\/span> <b>0<\/b>/.test(h) && /Códigos:<\/span> <b>98<\/b>/.test(h) && /Batem:<\/span> <b>98<\/b>/.test(h) && /200 linhas · 12 WL\(s\)/.test(h)
    && /não tem cadastro antigo/.test(h), h.slice(h.indexOf('proj-lms-up-conc'), h.indexOf('proj-lms-up-conc') + 900));
  ok('DFdfSDF: prévia lida uma vez com o id da ORIGINAL', t.log.rpc.filter(x => x.fn === 'sot_lms_conciliacao_previa').length === 1
    && t.log.rpc.find(x => x.fn === 'sot_lms_conciliacao_previa').body.p_importacao_id === IMP);
  ok('DFdfSDF: botão "Aplicar conciliação" aparece; sem bloqueios', /id="proj-lms-up-conc-aplicar"[^>]*>Aplicar conciliação</.test(h) && !/proj-lms-up-conc-bloqueios/.test(h));
  ok('DFdfSDF: lista completa recolhível com WL, FT e KIT', /<details id="proj-lms-up-conc-lista"/.test(h) && /Ver todos os códigos \(2\)/.test(h)
    && /WL 1 · FT I · KIT NK-AMAR-RC · 6 M/.test(h) && /WL 2 · FT I · KIT NK-AMAR-RC · 6 M/.test(h) && /Novo \(sem cadastro antigo\)/.test(h));
  ok('DFdfSDF: carregar a aba não aplica nada', !t.log.rpc.some(x => x.fn === 'fn_proj_lms_aplicar_conciliacao') && !t.log.confirm.length);
  ok('envio de LMS continua bloqueado em conciliação', /proj-lms-up-bloqueio/.test(h) && !/id="proj-lms-up-arquivo"/.test(h));

  t = montar(html, { previa: PREVIA_DF, confirmar: false });
  await carregar(t);
  await t.sb.projLmsUpAplicarConciliacao();
  ok('cancelar o confirm() não aplica', t.log.confirm.length === 1 && !t.log.rpc.some(x => x.fn === 'fn_proj_lms_aplicar_conciliacao'));
  ok('confirm() explica a ação, sem cadastro antigo, e que não se desfaz pela tela', /Aplicar a conciliação do LMS ao projeto "TESTE 1 — DFdfSDF"/.test(t.log.confirm[0])
    && /não tem cadastro antigo/.test(t.log.confirm[0]) && /Códigos: 98 · Linhas do LMS: 200 · WLs: 12/.test(t.log.confirm[0])
    && /não pode ser desfeita pela tela/.test(t.log.confirm[0]), t.log.confirm[0]);

  let soltar;
  const segura = new Promise(r => { soltar = r; });
  t = montar(html, { previa: PREVIA_DF, segurar: { fn: 'fn_proj_lms_aplicar_conciliacao', promessa: segura } });
  await carregar(t);
  t.sb._sotWlSelosCache[PJ] = 'EM_CONCILIACAO';
  const p1 = t.sb.projLmsUpAplicarConciliacao();
  const p2 = t.sb.projLmsUpAplicarConciliacao();
  await tick();
  h = t.html();
  ok('durante a aplicação o botão fica "Aplicando…" e desabilitado', /id="proj-lms-up-conc-aplicar"[^>]* disabled[^>]*>Aplicando…</.test(h));
  soltar();
  await Promise.all([p1, p2]);
  const ap = t.log.rpc.filter(x => x.fn === 'fn_proj_lms_aplicar_conciliacao');
  ok('duplo clique envia só uma vez, com o id da ORIGINAL', ap.length === 1 && ap[0].body.p_importacao_id === IMP && t.log.confirm.length === 1, ap);
  ok('sucesso: resumo no toast, selo invalidado e projeto recarregado', /Conciliação aplicada: 12 WL\(s\), 16 atividade\(s\), 92 material\(is\), 92 retirada\(s\) descritivas; 0 item\(ns\) antigo\(s\) substituído\(s\)/.test(t.log.toast.join('|'))
    && !Object.prototype.hasOwnProperty.call(t.sb._sotWlSelosCache, PJ) && t.log.abriu[0] === PJ, { toast: t.log.toast, abriu: t.log.abriu });

  t = montar(html, { previa: PREVIA_DF, rpc: { fn_proj_lms_aplicar_conciliacao: () => ({ s: 200, b: { operacao: 'JA_APLICADA', wls: 12, itens_antigos_substituidos: 0 } }) } });
  await carregar(t); await t.sb.projLmsUpAplicarConciliacao();
  ok('JA_APLICADA: avisa e recarrega', /já estava aplicada/.test(t.log.toast.join('|')) && t.log.abriu[0] === PJ);

  // ── 2. ETD VARGINHA: bloqueada ────────────────────────────────
  t = montar(html, { previa: PREVIA_VARG });
  h = await carregar(t);
  ok('VARGINHA: bloqueios traduzidos (movimento e unidade)', /id="proj-lms-up-conc-bloqueios"/.test(h)
    && /<li>Item antigo com movimento: 2 código\(s\)<\/li>/.test(h) && /<li>Unidade diferente: 9 código\(s\)<\/li>/.test(h), h.slice(h.indexOf('conc-bloqueios'), h.indexOf('conc-bloqueios') + 500));
  const tab = h.slice(h.indexOf('id="proj-lms-up-conc-divergentes"'), h.indexOf('</table>', h.indexOf('id="proj-lms-up-conc-divergentes"')));
  ok('VARGINHA: tabela só com os que não batem (3), sem o 321638 que bate', (tab.match(/<tr data-codigo=/g) || []).length === 3 && tab.indexOf('321638') < 0
    && /Códigos que não batem \(3\)/.test(h));
  ok('VARGINHA: mostra UNIDADE_DIFERENTE com as unidades (UN × US3, UN × M)', /data-codigo="I-8000656"[\s\S]*?2 UN<\/td>[\s\S]*?2 US3<\/td>[\s\S]*?Unidade diferente/.test(tab)
    && /data-codigo="325070"[\s\S]*?100 UN<\/td>[\s\S]*?100 M<\/td>/.test(tab), tab.slice(0, 600));
  ok('VARGINHA: mostra COM_MOVIMENTO (item de medição) nas atividades medidas', /data-codigo="I-8000656"[\s\S]*?item de medição/.test(tab) && /data-codigo="R-8000656"[\s\S]*?item de medição/.test(tab));
  ok('VARGINHA: botão não aparece; aviso de que segue em conciliação', !/proj-lms-up-conc-aplicar/.test(h) && /id="proj-lms-up-conc-bloqueada"/.test(h));
  await t.sb.projLmsUpAplicarConciliacao();
  ok('VARGINHA: chamar a aplicação direto não envia nada', !t.log.rpc.some(x => x.fn === 'fn_proj_lms_aplicar_conciliacao') && !t.log.confirm.length);

  // ── 3. Sem permissão de aplicar ───────────────────────────────
  t = montar(html, { previa: Object.assign({}, PREVIA_DF, { pode_aplicar: false }) });
  h = await carregar(t);
  ok('sem PROJ_CONFIRMAR_LMS: vê a prévia, não vê o botão, vê o aviso de permissão', /id="proj-lms-up-conc-resumo"/.test(h) && !/proj-lms-up-conc-aplicar/.test(h)
    && /id="proj-lms-up-conc-permissao"[^>]*>Prévia liberada\. Aguardando quem tem a permissão PROJ_CONFIRMAR_LMS/.test(h));
  await t.sb.projLmsUpAplicarConciliacao();
  ok('sem permissão: chamar a aplicação direto não envia nada', !t.log.rpc.some(x => x.fn === 'fn_proj_lms_aplicar_conciliacao'));

  // ── 4. Migration ausente / erros ──────────────────────────────
  t = montar(html, { rpc: { sot_lms_conciliacao_previa: () => ({ s: 404, b: { code: 'PGRST202', message: 'Could not find the function' } }) } });
  h = await carregar(t);
  ok('migration ausente: mensagem clara com o nome do arquivo; aba não quebra', /id="proj-lms-up-conc-ausente"/.test(h) && /20261012200000_proj_lms_conciliacao\.sql/.test(h)
    && /Estado WL do projeto/.test(h) && /proj-lms-up-bloqueio/.test(h) && !/proj-lms-up-conc-aplicar/.test(h));
  t = montar(html, { rpc: { sot_lms_original_do_projeto: () => ({ s: 404, b: { code: 'PGRST202', message: 'x' } }) } });
  h = await carregar(t);
  ok('leitura da ORIGINAL ausente: cita as duas migrations, sem pedir prévia', /20261012100000_proj_lms_leitura_wl\.sql e a 20261012200000/.test(h)
    && !t.log.rpc.some(x => x.fn === 'sot_lms_conciliacao_previa'));
  t = montar(html, { rpc: { sot_lms_conciliacao_previa: () => ({ s: 403, b: { code: '42501', message: 'Conciliação prévia: acesso negado (SEM_PERMISSAO)' } }) } });
  h = await carregar(t);
  ok('erro de permissão na prévia: traduzido, sem botão', /id="proj-lms-up-conc-erro"/.test(h) && /não tem a permissão PROJ_CONFIRMAR_LMS/.test(h) && !/proj-lms-up-conc-aplicar/.test(h), h.slice(h.indexOf('conc-erro'), h.indexOf('conc-erro') + 300));
  t = montar(html, { rpc: { sot_lms_conciliacao_previa: () => ({ s: 500, b: { message: 'falha interna' } }) } });
  h = await carregar(t);
  ok('falha do banco na prévia: mensagem, aba segue', /id="proj-lms-up-conc-erro"/.test(h) && /Não foi possível ler a prévia/.test(h) && /Estado WL do projeto/.test(h));

  const recusas = [
    ['CONCILIACAO_BLOQUEADA', 'Conciliação: CONCILIACAO_BLOQUEADA (COM_MOVIMENTO 1, UNIDADE_DIFERENTE 2)', /bloqueada — Item antigo com movimento: 1 código\(s\); Unidade diferente: 2 código\(s\)\. Atualize a prévia/],
    ['PROJETO_JA_TEM_WL', 'Conciliação: PROJETO_JA_TEM_WL', /já tem WL oficial/],
    ['SEM_PERMISSAO', 'Conciliação: SEM_PERMISSAO', /não tem a permissão PROJ_CONFIRMAR_LMS/],
    ['LINHA_NAO_CLASSIFICADA', 'Conciliação: LINHA_NAO_CLASSIFICADA (linhas 4)', /código fora do padrão[\s\S]*linha\(s\) 4/],
    ['falha genérica', 'deu ruim no banco', /Conciliação não aplicada: deu ruim no banco/]
  ];
  for (const [nome, msg, re] of recusas) {
    t = montar(html, { previa: PREVIA_DF, rpc: { fn_proj_lms_aplicar_conciliacao: () => ({ s: 400, b: { code: '55000', message: msg } }) } });
    await carregar(t); await t.sb.projLmsUpAplicarConciliacao();
    h = t.html();
    ok('recusa traduzida: ' + nome, /id="proj-lms-up-conc-erro-aplicar"/.test(h) && re.test(h) && !t.log.abriu.length && /id="proj-lms-up-conc-aplicar"[^>]*>Aplicar conciliação</.test(h),
      h.slice(h.indexOf('conc-erro-aplicar') - 10, h.indexOf('conc-erro-aplicar') + 300));
  }

  // ── 5. Paridade com a versão anterior (legado, pendente, estruturado) ──
  const casos = [
    ['legado (envio liberado)', { estado: 'LEGADO_SEM_WL', original: { existe: false, estado: 'LEGADO_SEM_WL', pode_aplicar: false } }],
    ['estrutura pendente com permissão', { estado: 'ESTRUTURA_PENDENTE', original: ORIG('ESTRUTURA_NOVA', true) }],
    ['estrutura pendente sem permissão', { estado: 'ESTRUTURA_PENDENTE', original: ORIG('ESTRUTURA_NOVA', false) }],
    ['estruturado', { estado: 'ESTRUTURADO', original: Object.assign(ORIG('ESTRUTURA_NOVA', false), { estado: 'ESTRUTURADO' }) }]
  ];
  for (const [nome, cfg] of casos) {
    const a = montar(htmlAntes, cfg), d = montar(html, cfg);
    const ha = await carregar(a), hd = await carregar(d);
    ok('paridade (' + nome + '): mesma tela', ha === hd && ha.length > 200, { antes: ha.slice(0, 200), depois: hd.slice(0, 200) });
    ok('paridade (' + nome + '): mesmas chamadas, sem prévia', JSON.stringify(a.log.rpc) === JSON.stringify(d.log.rpc)
      && !d.log.rpc.some(x => x.fn === 'sot_lms_conciliacao_previa'), d.log.rpc.map(x => x.fn));
  }
  const ac = montar(htmlAntes, {}), dc = montar(html, { previa: PREVIA_DF });
  const hac = await carregar(ac), hdc = await carregar(dc);
  ok('em conciliação: a tela anterior continua igual, só com o card novo acrescentado',
    hdc.replace(/<div class="card" id="proj-lms-up-conc"[\s\S]*?<div id="proj-lms-up-bloqueio"/, '<div id="proj-lms-up-bloqueio"') === hac);

  if (failed.length) {
    console.log(`proj-lms-conciliacao-ui: FALHOU ${failed.length}/${total}`);
    for (const f of failed) console.log('  - ' + f);
    process.exit(1);
  }
  console.log(`proj-lms-conciliacao-ui: OK (${total} verificações, base ${BASE})`);
})().catch(e => { console.error(e); process.exit(1); });
