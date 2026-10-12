'use strict';
// ETAPA 1.5a — telas com WL oficial: selo de estado (com fallback), WL/FT/KIT e agrupamento nas abas, 🔒 e edição só de
// campos livres em linha com WL, erro real do banco, bloqueio de inclusão (projeto com WL / ESTRUTURA_PENDENTE; legado e
// EM_CONCILIACAO liberados), busca de material pelo id da linha (mat_id), sbDelete com retorno, aviso da aba Plano.
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
const INI = '// ETAPA 1.5a — WL oficial nas telas do projeto';
const iB = html.indexOf(INI);
const fB = html.indexOf('\nfunction renderProjetosPorContrato(', iB);
if (iB < 0 || fB < 0) throw new Error('bloco 1.5a não encontrado');
const bloco = html.slice(iB, fB);
const semComent = s => s.replace(/\/\/[^\n]*/g, '');

// ── Estáticos ───────────────────────────────────────────────────
ok('ES5 no bloco 1.5a (sem let/const/arrow/template)', !/\blet\s|\bconst\s|=>|`/.test(semComent(bloco)));
ok('selo no detalhe do projeto (ao lado do status)', /\+sotWlSeloHtml\(p\.id\)/.test(fnTexto('sotRenderDetalhe')));
ok('sotAbrirProjeto carrega o contexto WL junto com o projeto', /sotWlCarregarProjeto\(projetoId\)/.test(fnTexto('sotAbrirProjeto')));
ok('cards da lista intactos (sem selo na 1.5a)', !/sotWlSelo/.test(fnTexto('sotRenderCardProjeto')));
ok('aba Plano tem o aviso fixo nos dois caminhos', (fnTexto('sotRenderTabPlano').match(/sotWlAvisoPlanoHtml\(projetoId\)/g) || []).length === 2);
ok('lixeira inline da aba Atividades substituída por sotExcluirAtividade (checa o banco)',
  !/onclick="if\(confirm\(\\'Excluir atividade\?/.test(html) && /sotExcluirAtividade\(\\''\+a\.id\+'\\'\)/.test(html));
const ins = ['sotAbrirNovaAtividade', 'sotAbrirNovoMaterial', 'sotImportarAtividades', 'sotImportarMateriais'];
ok('E5: entradas de inclusão/importação começam pelo bloqueio', ins.every(n => /^function \w+\(projetoId\)\{\n  if\(sotWlAvisarBloqueio\(projetoId\)\) return;/.test(fnTexto(n))));
ok('E5: importação colada e lista pendente checam o banco antes de gravar',
  /await sotWlBloqueioInsercaoAsync\(projetoId\)/.test(fnTexto('sotConfirmarImportacao')) && /await sotWlBloqueioInsercaoAsync\(projetoId\)/.test(fnTexto('_sotLancarPendentes')));
ok('E5: validação do campo não cria atividade automática em projeto com WL', /if\(!ativ\)\{\n    if\(sotWlAvisarBloqueio\(projetoId\)\) return;/.test(fnTexto('sotValidarLancamento')));
ok('E5: adicional PLPT bloqueado em projeto com WL', /sotWlBloqueioInsercaoAsync\(projId\)/.test(fnTexto('plptAprovarAdicional')));
ok('E6: PLPT aplicação e Kanban entregue usam sotMatBuscarLinha (mat_id)',
  /sotMatBuscarLinha\(projId, it\)/.test(fnTexto('plptConfirmarAplicacaoDevolucao')) && /sotMatBuscarLinha\(m\.projeto_id, it\)/.test(fnTexto('_coSalvarPlptRequisicao')));
const st = fnTexto('_coSalvarStatusMaterial');
ok('E6: _coSalvarStatusMaterial não soma de novo o item do PLPT (dupla contagem removida)',
  /!\(m\._from_plpt && m\._req_id\)/.test(st) && /sotMatBuscarLinha\(m\.projeto_id/.test(st));
ok('E6: enriquecimento ao abrir o projeto casa itens por mat_id', /sotMatAcharLocal\(sot_materiais_proj, it\)/.test(fnTexto('sotAbrirProjeto')));
ok('E6: baixa conta entregue só da própria linha', /it\.mat_id \? it\.mat_id === m\.id :/.test(fnTexto('sotLancarBaixaMaterial')));
ok('E6: fallback de edição de material só em linha legada operacional',
  /'wl_id=is\.null','somente_descritivo=is\.false'/.test(fnTexto('sotEditarMaterial')));
const sbd = fnTexto('sbDelete');
ok('E7: sbDelete devolve true/false e guarda o erro; não tenta DELETE físico após recusa da WL',
  (sbd.match(/return true;/g) || []).length === 2 && (sbd.match(/return false;/g) || []).length >= 3
  && /window\._sbLastDeleteErr/.test(sbd) && /LINHA_ESTRUTURADA\|WL_SO_POR_FUNCAO/.test(sbd));
ok('nenhuma escrita direta em sot_wl pelo front', !/sbInsert\('sot_wl'|sbUpdate\('sot_wl'|sbDelete\('sot_wl'/.test(html));

// ── vm: bloco 1.5a + abas + modais ──────────────────────────────
const P = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', PL = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const W1 = '11111111-1111-4111-8111-000000000001', W2 = '11111111-1111-4111-8111-000000000002';
const U = n => `cccccccc-cccc-4ccc-8ccc-${String(n).padStart(12, '0')}`;
function montar(cfg) {
  cfg = cfg || {};
  const log = { toast: [], fetch: [], update: [], del: [], rpc: [], modal: '' , renders: 0, abriu: [] };
  const els = {};
  const sb = {
    console: { error() {}, warn() {}, log() {} }, DEMO: false, SB: { url: 'https://x', key: 'k' }, _sbAuthToken: 'jwt',
    window: {}, Promise, JSON, Object, Number, String, Array, Math, isNaN, encodeURIComponent,
    usuarioLogado: { id: 'u1', nome: 'Gestor' }, _coContratoAtual: '', servicos: [],
    sot_projetos: [{ id: P, nome: 'Obra WL', contrato_id: 'c1' }, { id: PL, nome: 'Legado', contrato_id: 'c1' }],
    sot_atividades: cfg.atividades || [], sot_atividades_desc: cfg.atividadesDesc || [],
    sot_materiais_proj: cfg.materiais || [], sot_materiais_desc: cfg.materiaisDesc || [],
    isUUID: v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v)),
    escHtml: v => String(v == null ? '' : v), _escapeHtml: v => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    fmtMoeda: v => 'R$' + Number(v || 0).toFixed(2),
    progShowToast: (m, t) => log.toast.push((t || 'ok') + ':' + m),
    confirm: () => cfg.confirmar !== false, alert: () => {},
    setModal: h => { log.modal = h; }, closeModal: () => { log.modal = ''; },
    setTimeout: fn => fn(),
    document: { getElementById: id => els[id] || (els[id] = { value: (cfg.inputs || {})[id] || '', style: {}, onclick: null }) },
    sotAtualizarAbaAtual: () => { log.renders++; }, sotAbrirProjeto: id => { log.abriu.push(id); },
    sotPersistirAdicionalMaterial: (m, q, cb) => cb(),
    _auditAuto() {}, sotFiltrarServicos() {}, sotBuscarPorCodigo() {}, sotLimparServico() {},
    projLmsRpc: async (fn, p) => { log.rpc.push(fn); return cfg.estado === undefined ? { ok: false } : { ok: true, data: cfg.estado }; },
    sbFetch: async (t, o) => { log.fetch.push({ t, f: (o && o.filters) || [] }); if (cfg.sbFetch) return cfg.sbFetch(t, o); if (t === 'sot_wl') return cfg.wls || []; return []; },
    sbUpdate: async (t, d, f) => { log.update.push({ t, d, f }); if (cfg.updateFalha) { sb.window._sbLastUpdateErr = cfg.updateFalha; return false; } return true; },
    fetch: async (url, opt) => { log.del.push({ url, method: opt.method }); const r = cfg.fetchResp ? cfg.fetchResp(url, opt) : { ok: true, status: 204, body: '' }; return { ok: r.ok, status: r.status, text: async () => r.body }; }
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext('var PROJ_LMS_ESTADO_WL_LABEL = {LEGADO_SEM_WL:"Legado (sem WL)", EM_CONCILIACAO:"Em conciliação", ESTRUTURA_PENDENTE:"Estrutura pendente", ESTRUTURADO:"Estruturado"};\n'
    + 'var _SOFT_DELETE_TABLES = ["sot_materiais"];\n' + bloco + '\n'
    + ['sbDelete', '_sotRenderTabAtividadesOper', '_sotLinhasAtividadesHtml', '_sotLinhaAtividadeHtml', '_sotRenderTabMateriaisOper',
       'sotRenderBlocoDescritivo', 'sotExcluirDescritivo', 'sotEditarAtividade', 'sotEditarMaterial', 'sotAbrirNovaAtividade',
       'sotAbrirNovoMaterial', 'sotImportarAtividades', 'sotImportarMateriais'].map(fnTexto).join('\n'), sb);
  return { sb, log, els };
}
const atv = (id, cod, wl, extra) => Object.assign({ id, projeto_id: P, codigo: cod, descricao: 'Serv ' + cod, unidade: 'UN', qtd_prevista: 2, valor_unitario: 3, ordem_exec: 1, status: 'pendente', wl_id: wl || null, lms_linha_id: wl ? 'L' + id : null, ft: wl ? 'I' : null, kit: wl ? 'S-1' : null }, extra || {});
const mat = (id, cod, wl, extra) => Object.assign({ id, projeto_id: P, codigo_sap: cod, descricao: 'Mat ' + cod, unidade: 'M', qtd_projetada: 5, wl_id: wl || null, lms_linha_id: wl ? 'L' + id : null, ft: wl ? 'I' : null, kit: wl ? 'NK' : null, somente_descritivo: false }, extra || {});
const WLS = [{ id: W1, codigo: '1', ordem: 1 }, { id: W2, codigo: '2', ordem: 2 }];

(async () => {
  // Selo e contexto
  let t = montar({ estado: 'ESTRUTURADO', wls: WLS, atividades: [atv(U(1), 'I-A', W1)] });
  await t.sb.sotWlCarregarProjeto(P);
  ok('contexto: estado lido do banco + WLs oficiais carregadas', t.sb._sotWlCtx.estadoOk && t.sb._sotWlCtx.estado === 'ESTRUTURADO' && t.sb._sotWlCtx.wlsLista.length === 2);
  ok('selo: Estruturado (banco)', /🧩 Estruturado</.test(t.sb.sotWlSeloHtml(P)));
  t = montar({ estado: 'ESTRUTURA_PENDENTE' }); await t.sb.sotWlCarregarProjeto(P);
  ok('selo: Estrutura pendente', /Estrutura pendente/.test(t.sb.sotWlSeloHtml(P)));
  t = montar({ estado: undefined, atividades: [atv(U(1), 'I-A', W1)] }); await t.sb.sotWlCarregarProjeto(P);
  ok('E3: sem permissão/anon → selo derivado das linhas ("Estruturado (WL)")', /Estruturado \(WL\)/.test(t.sb.sotWlSeloHtml(P)));
  t = montar({ estado: undefined, atividades: [atv(U(1), '5020000092', null)] }); await t.sb.sotWlCarregarProjeto(P);
  ok('E3: legado sem permissão → sem selo', t.sb.sotWlSeloHtml(P) === '');

  // Bloqueio de inclusão (E5)
  t = montar({ estado: 'ESTRUTURADO' }); await t.sb.sotWlCarregarProjeto(P);
  ok('E5: ESTRUTURADO bloqueia', /bloqueadas/.test(t.sb.sotWlBloqueioInsercao(P)));
  t = montar({ estado: 'ESTRUTURA_PENDENTE' }); await t.sb.sotWlCarregarProjeto(P);
  ok('E5: ESTRUTURA_PENDENTE bloqueia', /estrutura pendente/.test(t.sb.sotWlBloqueioInsercao(P)));
  t = montar({ estado: 'EM_CONCILIACAO' }); await t.sb.sotWlCarregarProjeto(P);
  ok('E5: EM_CONCILIACAO segue liberado', t.sb.sotWlBloqueioInsercao(P) === '');
  t = montar({ estado: 'LEGADO_SEM_WL' }); await t.sb.sotWlCarregarProjeto(P);
  ok('E5: legado liberado', t.sb.sotWlBloqueioInsercao(P) === '');
  t = montar({ estado: undefined, materiais: [mat(U(2), '324894', W1)] }); await t.sb.sotWlCarregarProjeto(P);
  ok('E5: sem estado, mas com linha de WL → bloqueia', !!t.sb.sotWlBloqueioInsercao(P));
  t = montar({ estado: 'ESTRUTURADO' }); await t.sb.sotWlCarregarProjeto(P);
  for (const n of ['sotAbrirNovaAtividade', 'sotAbrirNovoMaterial', 'sotImportarAtividades', 'sotImportarMateriais']) {
    t.log.toast = []; t.log.modal = '';
    t.sb[n](P);
    ok(`E5: ${n} não abre em projeto estruturado e avisa`, t.log.modal === '' && /🔒/.test(t.log.toast[0] || ''), t.log.toast);
  }
  t = montar({ estado: 'LEGADO_SEM_WL' }); await t.sb.sotWlCarregarProjeto(PL);
  t.sb.sotImportarMateriais(PL);
  ok('E5: legado abre o importador normalmente', /Importar Materiais/.test(t.log.modal) && !t.log.toast.length);
  t = montar({ estado: undefined, sbFetch: (tb) => (tb === 'sot_materiais' ? [{ id: 'x', wl_id: W1 }] : []) });
  ok('E5 (banco): projeto não aberto com linha de WL → bloqueia', /bloqueadas/.test(await t.sb.sotWlBloqueioInsercaoAsync(P)));
  t = montar({ estado: 'ESTRUTURA_PENDENTE' });
  ok('E5 (banco): estado ESTRUTURA_PENDENTE lido na hora → bloqueia', /estrutura pendente/.test(await t.sb.sotWlBloqueioInsercaoAsync(P)));
  t = montar({ estado: undefined });
  ok('E5 (banco): legado sem WL → liberado', (await t.sb.sotWlBloqueioInsercaoAsync(PL)) === '');

  // Aba Atividades: agrupamento, rótulo, 🔒, sem 🗑 em linha de WL
  const atvs = [atv(U(3), 'I-B', W2, { ordem_exec: 1 }), atv(U(4), 'I-A', W1, { ordem_exec: 2 }), atv(U(5), 'I-C', W1, { ordem_exec: 3 })];
  t = montar({ estado: 'ESTRUTURADO', wls: WLS, atividades: atvs }); await t.sb.sotWlCarregarProjeto(P);
  let h = t.sb._sotRenderTabAtividadesOper(P);
  const ordemCods = (h.match(/>I-[ABC]</g) || []).map(x => x.slice(1, -1));
  ok('Atividades: agrupadas pela ordem da WL (WL 1 antes de WL 2), mantendo a ordem dentro da WL', JSON.stringify(ordemCods) === '["I-A","I-C","I-B"]', ordemCods);
  ok('Atividades: cabeçalho por WL', (h.match(/class="sot-wl-grupo"/g) || []).length === 2 && /🧩 WL 1</.test(h) && /🧩 WL 2</.test(h));
  ok('Atividades: rótulo WL/FT/KIT na linha', /🔒 WL 1 · FT I · KIT S-1/.test(h));
  ok('Atividades: linha de WL sem 🗑, com 🔒 e ✎ de campos livres', !/sotExcluirAtividade/.test(h) && (h.match(/sot-wl-lock/g) || []).length === 3 && /Editar campos livres/.test(h));
  ok('Atividades: "▶ Lançar" continua', (h.match(/▶ Lançar/g) || []).length === 3);
  t = montar({ atividades: [atv(U(6), '5020000092', null)] });
  h = t.sb._sotRenderTabAtividadesOper(P);
  ok('Atividades legado: sem grupo/🔒, com 🗑 (sotExcluirAtividade)', !/sot-wl-grupo|sot-wl-lock/.test(h) && /sotExcluirAtividade/.test(h));

  // Aba Materiais + descritivos de retirada
  const mats = [mat(U(7), '324894', W2), mat(U(8), '324895', W1)];
  const desc = [mat(U(9), '324894', W2, { ft: 'R', somente_descritivo: true }), mat(U(10), '999', null, { somente_descritivo: true })];
  t = montar({ estado: 'ESTRUTURADO', wls: WLS, materiais: mats, materiaisDesc: desc }); await t.sb.sotWlCarregarProjeto(P);
  h = t.sb._sotRenderTabMateriaisOper(P, null);
  ok('Materiais: agrupados por WL, rótulo e 🔒', /🧩 WL 1</.test(h) && h.indexOf('324895') < h.indexOf('>324894') && /🔒 WL 2 · FT I · KIT NK/.test(h) && (h.match(/sot-wl-lock/g) || []).length === 2);
  h = t.sb.sotRenderBlocoDescritivo(P, 'material');
  ok('Descritivos: retirada da WL com 🔒 e aviso "fora de requisição/almoxarifado"; legado descritivo com 🗑',
    /Retirada \(FT=R\): fora de requisição, reserva, entrega e almoxarifado/.test(h) && (h.match(/sot-wl-lock/g) || []).length === 1
    && (h.match(/sotExcluirDescritivo\(/g) || []).length === 1);

  // Edição de atividade com WL: campos travados, payload só livre, erro real e reversão
  const aWl = atv(U(11), 'I-A', W1, { descricao: 'Orig', qtd_prevista: 2, etapa: 'E0', observacoes: '' });
  t = montar({ estado: 'ESTRUTURADO', wls: WLS, atividades: [aWl],
    inputs: { 'sot-at-cod': 'I-XX', 'sot-at-desc': 'Mudou', 'sot-at-un': 'KG', 'sot-at-qtd': '99', 'sot-at-etapa': 'E1', 'sot-at-vu': '7', 'sot-at-ordem': '4', 'sot-at-obs': 'ok' } });
  await t.sb.sotWlCarregarProjeto(P);
  t.sb.sotEditarAtividade(U(11));
  const modalAt = t.log.modal;
  ok('E4: modal da atividade com WL avisa e trava código/descrição/unidade/quantidade; sem Excluir',
    /🔒 WL 1 · FT I · KIT S-1 — linha da estrutura do LMS/.test(modalAt) && (modalAt.match(/ disabled title=/g) || []).length === 4 && !/sot-excluir-at/.test(modalAt));
  await t.els['sot-salvar-at'].onclick();
  await new Promise(r => setImmediate(r));
  const up = t.log.update[0] || {};
  ok('E4: payload da linha com WL só tem campos livres', up.t === 'sot_atividades' && JSON.stringify(Object.keys(up.d).sort()) === JSON.stringify(['etapa', 'observacoes', 'ordem_exec', 'servico_id', 'valor_unitario']), up.d);
  ok('E4: estruturais locais intactos', aWl.codigo === 'I-A' && aWl.descricao === 'Orig' && aWl.qtd_prevista === 2 && aWl.etapa === 'E1');
  t = montar({ atividades: [atv(U(12), 'X1', null, { descricao: 'Antes' })], updateFalha: '{"message":"x (LINHA_ESTRUTURADA_CAMPO_PROTEGIDO: descricao)"}',
    inputs: { 'sot-at-desc': 'Depois', 'sot-at-cod': 'X1', 'sot-at-un': 'UN', 'sot-at-qtd': '1', 'sot-at-vu': '1', 'sot-at-ordem': '1' } });
  t.sb.sotEditarAtividade(U(12));
  await t.els['sot-salvar-at'].onclick();
  await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  ok('erro real: banco recusou → volta o valor e mostra a mensagem traduzida',
    t.sb.sot_atividades[0].descricao === 'Antes' && /não alterada: Linha da estrutura de WL/.test(t.log.toast.join('|')), t.log.toast);

  // Edição de material com WL
  const mWl = mat(U(13), '324894', W1, { observacao: '' });
  t = montar({ estado: 'ESTRUTURADO', wls: WLS, materiais: [mWl], inputs: { 'sot-mat-cod': '1', 'sot-mat-desc': 'Outro', 'sot-mat-un': 'KG', 'sot-mat-qtd': '9', 'sot-mat-adic': '0', 'sot-mat-obs': 'nota' } });
  await t.sb.sotWlCarregarProjeto(P);
  t.sb.sotEditarMaterial(U(13));
  ok('E4: modal de material com WL trava 4 campos e não tem Excluir', (t.log.modal.match(/ disabled title=/g) || []).length === 4 && !/sot-excluir-mat/.test(t.log.modal));
  t.els['sot-salvar-mat'].onclick();
  await new Promise(r => setImmediate(r));
  ok('E4: material com WL envia só a observação', JSON.stringify((t.log.update[0] || {}).d) === '{"observacao":"nota"}' && mWl.codigo_sap === '324894' && mWl.qtd_projetada === 5, t.log.update);

  // Exclusões com retorno real
  t = montar({ fetchResp: () => ({ ok: false, status: 400, body: '{"message":"x (LINHA_ESTRUTURADA_SEM_EXCLUSAO)"}' }) });
  let r = await t.sb.sbDelete('sot_materiais', 'id=eq.' + U(14));
  ok('E7: sbDelete recusado pela WL → false, guarda o erro e não tenta DELETE físico',
    r === false && /LINHA_ESTRUTURADA/.test(t.sb._sbLastDeleteErr) && t.log.del.length === 1 && t.log.del[0].method === 'PATCH');
  t = montar();
  r = await t.sb.sbDelete('sot_atividades', 'id=eq.' + U(15));
  ok('E7: sbDelete com sucesso → true', r === true && t.log.del[0].method === 'DELETE');
  t = montar({ fetchResp: () => ({ ok: false, status: 500, body: 'falha' }) });
  ok('E7: sbDelete com falha → false', (await t.sb.sbDelete('sot_atividades', 'id=eq.' + U(16))) === false);
  t = montar();
  ok('E7: id não-UUID continua ignorado (undefined, como antes)', (await t.sb.sbDelete('sot_atividades', 'id=eq.sa123')) === undefined);
  t = montar({ atividades: [atv(U(17), 'X1', null)], fetchResp: () => ({ ok: false, status: 409, body: '{"message":"fk"}' }) });
  await t.sb.sotExcluirAtividade(U(17));
  ok('exclusão de atividade recusada: linha fica na tela e mostra o erro', t.sb.sot_atividades.length === 1 && /Não excluída/.test(t.log.toast.join('|')));
  t = montar({ atividades: [atv(U(18), 'I-A', W1)] });
  await t.sb.sotExcluirAtividade(U(18));
  ok('exclusão de atividade com WL nem chega ao banco', t.log.del.length === 0 && /não pode ser excluída/.test(t.log.toast.join('|')));
  t = montar({ materiaisDesc: [mat(U(19), '324894', W1, { ft: 'R', somente_descritivo: true })] });
  await t.sb.sotExcluirDescritivo('sot_materiais', U(19), P);
  ok('descritivo de retirada da WL não é excluído', t.log.del.length === 0 && /não pode ser excluída/.test(t.log.toast.join('|')));

  // E6: busca de material
  t = montar({ sbFetch: (tb, o) => (o.filters.some(f => /^id=eq\./.test(f)) ? [{ id: U(20) }] : []) });
  r = await t.sb.sotMatBuscarLinha(P, { mat_id: U(20), codigo: '324894' });
  const f0 = t.log.fetch[0].f;
  ok('E6: com mat_id busca pela linha, só operacional e não excluída', r && r.id === U(20) && f0.includes('id=eq.' + U(20)) && f0.includes('somente_descritivo=is.false') && f0.includes('deleted_at=is.null'), f0);
  t = montar({ sbFetch: () => [{ id: 'a', wl_id: W1 }, { id: 'b', wl_id: W2 }] });
  r = await t.sb.sotMatBuscarLinha(P, { codigo: '324894' });
  ok('E6: sem mat_id e ambíguo com WL → aborta (null) e avisa', r === null && /mais de uma linha de WL/.test(t.log.toast.join('|')) && t.log.fetch[0].f.includes('somente_descritivo=is.false'));
  t = montar({ sbFetch: () => [{ id: 'a', wl_id: null }, { id: 'b', wl_id: null }] });
  r = await t.sb.sotMatBuscarLinha(P, { codigo: '324894' });
  ok('E6: legado ambíguo (sem WL) mantém o comportamento antigo (primeira linha)', r && r.id === 'a');
  const lista = [{ id: 'x1', codigo_sap: '324894', wl_id: W1 }, { id: 'x2', codigo_sap: '324894', wl_id: W2 }];
  ok('E6 (memória): mat_id acha a linha certa entre irmãs', t.sb.sotMatAcharLocal(lista, { mat_id: 'x2', codigo: '324894' }).id === 'x2');
  ok('E6 (memória): ambíguo com WL e sem mat_id → nenhuma (sem aviso em laço)', t.sb.sotMatAcharLocal(lista, { codigo: '324894' }) === null);

  // Tradução de erros
  ok('tradução: recusas da 1.4 em português', /não pode ser excluída/.test(t.sb.sotWlTraduzErro('LINHA_ESTRUTURADA_SEM_EXCLUSAO'))
    && /não recebe quantidade operacional/.test(t.sb.sotWlTraduzErro('violates check constraint "sot_materiais_descritivo_sem_operacao"'))
    && /aplicação da estrutura/.test(t.sb.sotWlTraduzErro('WL_SO_POR_FUNCAO: kit')));

  // Aviso da aba Plano
  t = montar({ estado: 'ESTRUTURADO', wls: WLS }); await t.sb.sotWlCarregarProjeto(P);
  h = t.sb.sotWlAvisoPlanoHtml(P);
  ok('E9: aviso "WL do croqui (IA) não é a WL oficial" + contagem das WLs oficiais', /WL do croqui \(IA\) não é a WL oficial/.test(h) && /2 WL\(s\) oficial\(is\) do LMS/.test(h));

  if (failed.length) {
    console.log(`proj-wl-telas-ui: FALHOU ${failed.length}/${total}`);
    for (const f of failed) console.log('  - ' + f);
    process.exit(1);
  }
  console.log(`proj-wl-telas-ui: OK (${total} verificações)`);
})().catch(e => { console.error(e); process.exit(1); });
