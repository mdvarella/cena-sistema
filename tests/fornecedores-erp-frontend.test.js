'use strict';
// 8.1.212 — Fornecedores: tela e selects só leem o banco; sincronização pela Edge. Executa as funções reais do index.html.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
let falhas = 0, total = 0;
function ok(nome, cond, extra) {
  total++;
  if (!cond) { falhas++; console.error('FALHOU: ' + nome + (extra !== undefined ? ' → ' + JSON.stringify(extra) : '')); }
}
function fn(nome) {
  const re = new RegExp('\\n(?:async )?function ' + nome + '\\(');
  const n = html.split(re).length - 1;
  if (n !== 1) throw new Error('definição de ' + nome + ': ' + n);
  const ini = html.search(re) + 1;
  return html.slice(ini, html.indexOf('\n}\n', ini) + 2);
}

// ── Estáticos ─────────────────────────────────────────────────────
ok('sem busca de /suppliers pelo navegador', !/path:\s*'\/suppliers'/.test(html));
ok('sem cache de fornecedores do ERP no localStorage', !/ERP\.cache|localStorage\.setItem\([^)]*erp_forn/.test(html));
ok('chaves antigas apagadas na inicialização', /localStorage\.removeItem\('cena_erp_forn_v6'\); localStorage\.removeItem\('cena_erp_forn_ts_v6'\)/.test(html));
ok('carga inicial de fornecedores paginada (passa de 1000)', /sbFetchAll\('fornecedores',\{filters:\['status=eq\.Ativo','deleted_at=is\.null'\],order:'razao_social\.asc,id\.asc'/.test(html));
ok('botão Sincronizar chama a Edge', /onclick="erpSincronizarFornecedores\(\\'auto\\'\)"/.test(html));
ok('Edge sem token no navegador', !/ERP_CENABR_TOKEN|erp_sync_cron_secret/.test(html));

// ── Sandbox ───────────────────────────────────────────────────────
const UUID_M = '11111111-1111-4111-8111-111111111111';
const UUID_E = '22222222-2222-4222-8222-222222222222';
const ctx = {
  console: { log() {}, warn() {}, error() {} },
  DEMO: false,
  escHtml: s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
  isUUID: id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
  campos: {}, toasts: [], updates: [], deletes: [], fetches: [], edge: [], edgeResp: null, banco: [],
  setTimeout: () => 0,
};
ctx.document = { getElementById: id => (id in ctx.campos ? { value: ctx.campos[id], innerHTML: '' } : null) };
ctx.progShowToast = (m, t) => ctx.toasts.push({ m, t });
ctx.confirm = () => true;
ctx.alert = m => ctx.toasts.push({ m, t: 'alert' });
ctx.closeModal = () => {};
ctx._fornRefreshLista = () => {};
ctx.renderFornecedoresVis = () => {};
ctx.sbUpdate = async (t, d, f) => { ctx.updates.push({ t, d, f }); return ctx.updateOk !== false; };
ctx.sbDelete = async (t, f) => { ctx.deletes.push({ t, f }); return true; };
ctx.sbFetch = async (t, o) => {
  ctx.fetches.push({ t, o });
  if (t === 'erp_sync_execucoes') return [{ status: 'OK', disparo: 'MANUAL', iniciado_em: '2026-10-06T10:00:00Z' }];
  if (t === 'fornecedores') {
    const m = /^erp_id=eq\.(\d+)$/.exec((o.filters || [])[0] || '');
    return m ? ctx.banco.filter(f => String(f.erp_id) === m[1]) : [];
  }
  return [];
};
ctx.carregarFornDB = async () => { ctx._fornDB = ctx.banco.slice(); return ctx._fornDB; };
ctx.chamarEdgeFunction = async (nome, body) => {
  ctx.edge.push({ nome, body });
  const r = ctx.edgeResp;
  if (r instanceof Error) throw r;
  return r;
};
vm.createContext(ctx);
vm.runInContext([
  'var _fornDB=[], fornecedores=[];',
  fn('_fornEhErp'), fn('_fornDataHora'), fn('_erpSetStatus'),
  'var _erpFornUltimaExec=null;',
  fn('erpCarregarUltimaSincFornecedores'), fn('erpCarregarFornecedores'), fn('erpSincronizarFornecedores'),
  fn('_fornFindById'), fn('frtFornecedoresLista'), fn('frtResolverFornecedorId'),
  fn('excluirFornecedor'), fn('salvarEditarForn'),
].join('\n'), ctx);

const manual = { id: UUID_M, razao_social: 'Local Ltda', cnpj_cpf: '11.111.111/0001-11', tipo: 'Locadora', contato: 'Ana', status: 'Ativo', origem: 'MANUAL', erp_id: null, deleted_at: null };
const doErp = { id: UUID_E, razao_social: 'ERP SA', cnpj_cpf: '22222222000122', tipo: 'Fornecedor', contato: '', telefone: '1', email: 'a@b.c', status: 'Ativo', origem: 'ERP', erp_id: 2354, deleted_at: null };
const inativo = { id: '33333333-3333-4333-8333-333333333333', razao_social: 'AAA Inativo', status: 'Inativo', origem: 'ERP', erp_id: 7, deleted_at: null };

(async () => {
  ctx.banco = [manual, doErp, inativo];
  await ctx.erpCarregarFornecedores(false);
  ok('carregar: fornecedores = banco', ctx.fornecedores.length === 3 && ctx.edge.length === 0);

  const lst = ctx.frtFornecedoresLista();
  ok('selects: lista só do banco, erp vazio', lst.db.length === 3 && Array.isArray(lst.erp) && lst.erp.length === 0);
  ok('selects: ativos primeiro', lst.db[2].status === 'Inativo');

  ok('_fornEhErp por origem', ctx._fornEhErp(doErp) && !ctx._fornEhErp(manual) && ctx._fornEhErp({ _erp: true }));

  ok('resolver: uuid passa direto', (await ctx.frtResolverFornecedorId(UUID_M)) === UUID_M);
  ok('resolver: id antigo _erp_ vira o uuid do espelho', (await ctx.frtResolverFornecedorId('_erp_2354')) === UUID_E);
  ctx._fornDB = [manual];
  ctx.fetches.length = 0;
  ok('resolver: busca no banco por erp_id quando não está na memória', (await ctx.frtResolverFornecedorId('_erp_2354')) === UUID_E
    && ctx.fetches.some(f => f.t === 'fornecedores' && f.o.filters[0] === 'erp_id=eq.2354'));
  let erroRes = null;
  try { await ctx.frtResolverFornecedorId('_erp_999'); } catch (e) { erroRes = e.message; }
  ok('resolver: ERP ainda não sincronizado recusa (não cria cadastro manual)', /ainda não sincronizado/.test(erroRes || ''), erroRes);
  ok('resolver: nunca insere fornecedor pelo navegador', !/sbInsert/.test(fn('frtResolverFornecedorId')));

  await ctx.erpCarregarFornecedores(false);
  ctx.toasts.length = 0;
  await ctx.excluirFornecedor(UUID_E);
  ok('excluir: fornecedor do ERP recusado sem chamar o banco', ctx.deletes.length === 0 && /não pode ser excluído/.test(ctx.toasts[0] && ctx.toasts[0].m));

  ctx.campos = { 'nf-rs': 'Trocado', 'nf-cnpj': '999', 'nf-tipo': 'Prestador', 'nf-cont': 'Bruno', 'nf-tel': '9', 'nf-email': 'x@y.z' };
  await ctx.salvarEditarForn(UUID_E);
  const upE = ctx.updates[0];
  ok('editar ERP: só tipo e contato vão ao banco', upE && JSON.stringify(Object.keys(upE.d).sort()) === '["contato","tipo"]' && upE.d.tipo === 'Prestador', upE);
  ok('editar ERP: dados do ERP intactos na memória', doErp.razao_social === 'ERP SA' && doErp.contato === 'Bruno');

  ctx.updates.length = 0;
  await ctx.salvarEditarForn(UUID_M);
  ok('editar manual: todos os campos', ctx.updates[0] && ctx.updates[0].d.razao_social === 'Trocado' && ctx.updates[0].d.email === 'x@y.z');

  ctx.updates.length = 0; ctx.updateOk = false; ctx.toasts.length = 0;
  const antes = manual.contato;
  ctx.campos['nf-cont'] = 'Outro';
  await ctx.salvarEditarForn(UUID_M);
  ok('editar: erro do banco não altera a memória e avisa', manual.contato === antes && ctx.toasts.some(t => t.t === 'erro'));
  ctx.updateOk = true;

  ctx.edgeResp = { ok: true, modo: 'INCREMENTAL', status: 'OK', contadores: { lidos: 3, inseridos: 1, atualizados: 1, vinculados: 0, inativados: 0, conflitos: 0 } };
  ctx.toasts.length = 0; ctx.edge.length = 0;
  await ctx.erpSincronizarFornecedores('auto');
  ok('sincronizar: chama a Edge com modo auto', ctx.edge.length === 1 && ctx.edge[0].nome === 'erp-fornecedores-sync' && ctx.edge[0].body.modo === 'auto');
  ok('sincronizar: recarrega o banco e a última execução', ctx._erpFornUltimaExec && ctx._erpFornUltimaExec.status === 'OK');
  ok('sincronizar: mostra os números', /3 lidos, 1 novos, 1 atualizados/.test(ctx.toasts[0] && ctx.toasts[0].m));

  const e409 = Object.assign(new Error('em_execucao'), { status: 409 });
  ctx.edgeResp = e409; ctx.toasts.length = 0;
  await ctx.erpSincronizarFornecedores('auto');
  ok('sincronizar: 409 avisa execução em andamento', /em andamento/.test(ctx.toasts[0] && ctx.toasts[0].m));
  ctx.edgeResp = Object.assign(new Error('forbidden'), { status: 403 }); ctx.toasts.length = 0;
  await ctx.erpSincronizarFornecedores('auto');
  ok('sincronizar: 403 avisa perfil sem permissão', /perfil não pode/.test(ctx.toasts[0] && ctx.toasts[0].m));

  ctx.edge.length = 0;
  await ctx.erpSincronizarFornecedores('tudo');
  ok('sincronizar: modo inválido não chama a Edge', ctx.edge.length === 0);

  console.log(`fornecedores-erp-frontend: ${total - falhas}/${total} ok`);
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
