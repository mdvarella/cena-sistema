'use strict';
// TMA — observação/status do dia que sumia após Atualizar (caso CLEBER, 22/10/2026), com dados fictícios.
// Executa as funções REAIS do index.html (gravação individual, lote, progSetStatus e a releitura do dia
// progAplicarStatusDoBanco) e os wrappers reais sbFetch/sbUpsert/sbDelete contra um banco em memória com a
// semântica do PostgREST: on_conflict por coluna (nome inexistente → 42703), merge só das colunas enviadas,
// UNIQUE (colaborador_id,data) inclusive para linhas excluídas. A prova é sempre uma NOVA LEITURA do banco.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execSync } = require('child_process');

const raiz = path.join(__dirname, '..');
const norm = s => s.replace(/\r\n/g, '\n');
const html = norm(fs.readFileSync(path.join(raiz, 'index.html'), 'utf8'));
let base = null;
try { base = norm(execSync('git show ' + (process.env.TMA_STATUS_BASE || '732987e') + ':index.html', { cwd: raiz, maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8')); } catch (e) { base = null; }
let falhas = 0, total = 0;
function ok(nome, cond, extra) { total++; if (!cond) { falhas++; console.error('FALHOU: ' + nome + (extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 400) : '')); } }
function fnDe(src, nome) {
  const re = new RegExp('\\n(?:async )?function ' + nome + '\\(');
  const n = src.split(re).length - 1;
  if (n !== 1) throw new Error('definição de ' + nome + ': ' + n);
  const ini = src.search(re) + 1;
  return src.slice(ini, src.indexOf('\n}\n', ini) + 2);
}
const varDe = (src, nome) => { const m = new RegExp('\\nvar ' + nome + '\\s*=[^;]*;').exec(src); if (!m) throw new Error('var ' + nome); return m[0].slice(1); };
const sbUpsertReal = src => fnDe(src.slice(src.indexOf('\nasync function sbUpsert', src.indexOf('\nasync function sbInsert'))), 'sbUpsert');
const espera = ms => new Promise(r => setTimeout(r, ms));
const semComent = s => s.replace(/\/\/[^\n]*/g, '');

const DIA = '2026-10-22';
const CLEBER = 'f0000000-0000-4000-8000-000000001903';
const COLS = ['id', 'colaborador_id', 'data', 'status', 'data_retorno', 'registrado_por', 'criado_em', 'deleted_at', 'obs', 'created_at', 'updated_at'];

// ── Banco em memória com a semântica do PostgREST ─────────────────────────────
function criarBanco() {
  const b = { linhas: [], regra: () => 'ok', reqs: [] };
  let seq = 1;
  const casa = (l, k, expr) => {
    const i = expr.indexOf('.'), op = expr.slice(0, i), v = decodeURIComponent(expr.slice(i + 1));
    const x = l[k] == null ? null : String(l[k]);
    if (op === 'eq') return x === v;
    if (op === 'neq') return x !== v;
    if (op === 'lte') return x !== null && x <= v;
    if (op === 'gt') return x !== null && x > v;
    if (op === 'is') return v === 'null' ? l[k] == null : String(l[k]) === v;
    if (op === 'in') return v.replace(/^\(|\)$/g, '').split(',').indexOf(x) >= 0;
    return true;
  };
  // or=(col.op.val,col.op.val) — usado pelo filtro de persistentes
  const casaOr = (l, v) => v.replace(/^\(|\)$/g, '').split(',').some(p => { const i = p.indexOf('.'); return casa(l, p.slice(0, i), p.slice(i + 1)); });
  const filtrar = q => b.linhas.filter(l => [...q].every(([k, v]) => ['select', 'order', 'limit', 'offset', 'on_conflict'].includes(k) || (k === 'or' ? casaOr(l, v) : casa(l, k, v))));
  const ordenarPaginar = (rows, q) => {
    const ord = (q.get('order') || '').split(',').filter(Boolean).map(o => o.split('.'));
    rows.sort((x, y) => { for (const [c, d] of ord) { const a = x[c] == null ? '' : String(x[c]), bb = y[c] == null ? '' : String(y[c]); if (a !== bb) return (a < bb ? -1 : 1) * (d === 'desc' ? -1 : 1); } return 0; });
    const off = Number(q.get('offset') || 0), lim = q.get('limit') ? Number(q.get('limit')) : rows.length;
    return rows.slice(off, off + lim);
  };
  b.tratar = (metodo, url, corpo, prefer) => {
    const u = new URL(url); const tabela = u.pathname.replace('/rest/v1/', ''); const q = u.searchParams;
    b.reqs.push({ metodo, tabela, url, corpo });
    if (tabela !== 'prog_status_diario') return { status: metodo === 'GET' ? 200 : 201, corpo: metodo === 'GET' ? [] : (corpo ? [].concat(corpo) : []) };
    if (metodo === 'GET') return { status: 200, corpo: ordenarPaginar(filtrar(q).map(l => Object.assign({}, l)), q) };
    if (metodo === 'PATCH') { const alvo = filtrar(q); alvo.forEach(l => Object.assign(l, corpo)); return { status: /representation/.test(prefer) ? 200 : 204, corpo: alvo.map(l => Object.assign({}, l)) }; }
    if (metodo === 'DELETE') { const alvo = new Set(filtrar(q)); b.linhas = b.linhas.filter(l => !alvo.has(l)); return { status: 204, corpo: [] }; }
    // POST (insert/upsert)
    const conflito = (q.get('on_conflict') || '').split(',').filter(Boolean);
    const ruim = conflito.find(c => COLS.indexOf(c) < 0);
    if (ruim) return { status: 400, corpo: { code: '42703', message: 'column "' + ruim + '" does not exist' } };
    const merge = /merge-duplicates/.test(prefer), ignora = /ignore-duplicates/.test(prefer);
    const out = [];
    for (const novo of [].concat(corpo)) {
      const ex = b.linhas.find(l => l.colaborador_id === novo.colaborador_id && String(l.data) === String(novo.data));
      if (ex) {
        if (merge && conflito.length) { Object.keys(novo).forEach(k => { ex[k] = novo[k]; }); out.push(Object.assign({}, ex)); continue; }
        if (ignora) continue;
        return { status: 409, corpo: { code: '23505', message: 'duplicate key value violates unique constraint "prog_status_diario_colaborador_id_data_key"' } };
      }
      const l = Object.assign({ id: 'id-' + (seq++), status: 'disponivel', deleted_at: null, obs: null, data_retorno: null, criado_em: new Date().toISOString() }, novo);
      b.linhas.push(l); out.push(Object.assign({}, l));
    }
    return { status: 201, corpo: out };
  };
  const erro = modo => modo === 'recusa' ? { status: 400, corpo: { code: 'P0001', message: 'STATUS_BLOQUEADO: recusa simulada' } }
    : modo === 'permissao' ? { status: 403, corpo: { code: '42501', message: 'permission denied for table prog_status_diario' } } : null;
  // cenaAuthAuthorizedFetch (usado por sbFetch/sbUpsert/sbUpdate/sbInsert)
  b.authFetch = (url, opts) => {
    const metodo = opts.method || 'GET';
    const modo = b.regra({ metodo, url, via: 'auth' });
    if (modo === 'timeout') return new Promise(() => {});
    if (modo === 'rede') return Promise.resolve({ ok: false, status: 0, text: 'Failed to fetch', aborted: false, json: null });
    const e = erro(modo);
    const r = e || b.tratar(metodo, url, opts.body ? JSON.parse(opts.body) : null, (opts.headers || {}).Prefer || '');
    const ok = r.status < 300;
    return new Promise(res => setTimeout(() => res({ ok, status: r.status, text: JSON.stringify(r.corpo), json: r.corpo, aborted: false }), modo && modo.lento || 0));
  };
  // fetch cru (lote progSalvarStatus, sbDelete)
  b.fetch = (url, opts) => {
    const metodo = (opts && opts.method) || 'GET';
    const modo = b.regra({ metodo, url, via: 'fetch' });
    if (modo === 'timeout') return new Promise(() => {});
    if (modo === 'rede') return Promise.reject(new TypeError('Failed to fetch'));
    const e = erro(modo);
    const r = e || b.tratar(metodo, url, opts && opts.body ? JSON.parse(opts.body) : null, ((opts && opts.headers) || {}).Prefer || '');
    return Promise.resolve({ ok: r.status < 300, status: r.status, text: () => Promise.resolve(JSON.stringify(r.corpo)), json: () => Promise.resolve(r.corpo) });
  };
  return b;
}

// ── Sandbox com as funções reais ───────────────────────────────────────────
function criarCtx(src, banco) {
  const el = {};
  const ctx = {
    console: { log() {}, warn() {}, error() {} }, window: {}, DEMO: false, SB: { url: 'https://banco.teste', key: 'anon-teste' }, _sbAuthToken: '',
    Promise, Object, Array, String, JSON, Date, Number, Math, RegExp, URL, clearTimeout, parseInt, TypeError,
    // prazo de 20 s comprimido para o teste
    setTimeout: (f, ms) => setTimeout(f, ms >= 20000 ? 60 : ms),
    usuarioLogado: { id: 'u1', nome: 'SUPERVISOR TESTE', perfil: 'supervisor_tma' },
    _progStatus: {}, _progStatusInfo: {}, _progData: DIA, _progStatusDateCache: 'x', composicao_dia: [], colaboradores: [{ id: CLEBER, nome: 'CLEBER TESTE', ativo: true }], equipes_disp: [],
    PROG_STATUS: { falta: { label: 'Faltou' }, observacao: { label: 'Observação' }, treinamento: { label: 'Treinamento' } },
    toasts: [], audits: [], fechou: 0, renders: 0, ls: {},
    _cenaAuthHadSession: false, sbAuthJwtIsAuthenticated: () => false,
  };
  ctx.localStorage = { getItem: k => (k in ctx.ls ? ctx.ls[k] : null), setItem: (k, v) => { ctx.ls[k] = String(v); }, removeItem: k => { delete ctx.ls[k]; } };
  ctx.progShowToast = (m, t) => ctx.toasts.push({ m: String(m), erro: t === 'erro' });
  ctx.closeModal = () => { ctx.fechou++; };
  ctx.progRenderQuadro = () => { ctx.renders++; };
  // dia da tela e "hoje" configuráveis (consulta de dias anteriores / atuais / futuros)
  ctx.progGetData = () => ctx._diaTela || DIA; ctx.dataHojeLocal = () => ctx._hoje || DIA; ctx.dataHoje = () => ctx._hoje || DIA;
  ctx._compDataStr = v => String(v || '').slice(0, 10);
  ctx.setModal = () => {}; ctx.escHtml = s => String(s == null ? '' : s);
  ctx.vtGarantirTratamento = () => {}; ctx.vtAtualizarAbaAlerta = () => {};
  ctx.progLancarFaltaPLR = () => {}; ctx.progVerificarRetornos = () => {}; ctx._progSalvarCacheDia = () => {};
  ctx.parseColabIds = r => (Array.isArray(r) ? r : []); ctx.fmtD = d => d; ctx.confirm = () => true;
  ctx._auditAuto = () => {};
  ctx.auditLog = (acao, modulo, descricao, extra) => ctx.audits.push({ acao, modulo, descricao, extra });
  ctx.isUUID = id => /^[0-9a-f-]{36}$/i.test(id);
  ctx.cenaAuthAuthorizedFetch = banco.authFetch;
  ctx.fetch = banco.fetch;
  ctx.el = el;
  ctx.document = {
    getElementById: id => el[id] || null,
    querySelector: sel => (/progSalvarMenuStatus/.test(sel) ? (el.__btnSalvar || null) : /progConfirmarStatus/.test(sel) ? (el.__btnConfirmar || null) : null),
    querySelectorAll: () => [],
  };
  vm.createContext(ctx);
  const nomes = ['isUUID', 'sbFetch', 'sbInsert', 'sbDelete', 'sbUpdate', 'progMarcarAutorStatus', 'progDataRetornoStr', 'progRetornoAindaFora', 'progRetornoExpirouNoDia',
    'progFiltrosStatusPersistentes', 'progExpirarPersistenteLinha', 'progAplicarStatusDoBanco', 'progSalvarPersistente', 'progRemoverPersistente',
    'progSalvarStatus', 'progSalvarMenuStatus', 'progSetStatus'];
  nomes.push('progVerificarRetornos', 'progAlterarStatusPool');
  const novos = /function progStatusGravarDia\(/.test(src) ? ['progStatusComPrazo', 'progStatusClassificarErro', 'progStatusMsgErro', 'progStatusGravarDia'] : [];
  if (/function progBuscarStatusPersistentes\(/.test(src)) novos.push('progBuscarStatusPersistentes');
  if (/function progStatusLerDia\(/.test(src)) novos.push('progStatusLerDia');
  vm.runInContext(['var _SOFT_DELETE_TABLES = ["prog_status_diario"];', varDe(src, 'PROG_STATUS_PERSISTENTES')]
    .concat(nomes.map(n => fnDe(src, n)), [sbUpsertReal(src)], novos.map(n => fnDe(src, n))).join('\n'), ctx);
  return ctx;
}
// Abre a modal do status (o menu já marca o status escolhido em _progStatus) e digita a observação
function abrirMenu(ctx, colab, status, texto) {
  ctx._progStatus[colab] = status;
  ctx.el['obs-status-input'] = { value: texto };
  ctx.el.__btnSalvar = { disabled: false, textContent: '💾 Salvar' };
}
// Nova leitura do banco — o que a tela faz ao Atualizar / abrir o dia
async function recarregar(ctx, diaTela, colab) {
  const d = diaTela || DIA, c = colab || CLEBER;
  const dia = await ctx.sbFetch('prog_status_diario', { filters: ['data=eq.' + d, 'deleted_at=is.null'] });
  // Mesma consulta da tela: versão nova pagina (progBuscarStatusPersistentes); main = limite fixo de 500
  const pers = ctx.progBuscarStatusPersistentes ? await ctx.progBuscarStatusPersistentes(d)
    : await ctx.sbFetch('prog_status_diario', { filters: ctx.progFiltrosStatusPersistentes(d), order: 'data.desc', limit: 500 });
  ctx.progAplicarStatusDoBanco(dia || [], pers || [], d);
  return { status: ctx._progStatus[c] || 'disponivel', obs: (ctx._progStatusInfo[c] || {}).obs || '', persistentes: pers };
}
function linhaCleberExcluida(banco) {
  banco.linhas.push({ id: 'id-cleber', colaborador_id: CLEBER, data: DIA, status: 'treinamento', data_retorno: DIA, registrado_por: 'GESTOR TESTE',
    obs: '', criado_em: '2026-10-21T20:39:00Z', deleted_at: '2026-10-22T11:14:42Z' });
}
const OBS = 'Colaborador na base — veículo quebrado (teste)';
const ult = ctx => ctx.toasts[ctx.toasts.length - 1] || { m: '', erro: false };

(async () => {
  // ═══ 0. Reproduz o defeito com o código da main (8.1.225) ═══
  if (!base) ok('commit base 732987e disponível', false);
  else {
    const banco = criarBanco(); linhaCleberExcluida(banco);
    const ctx = criarCtx(base, banco);
    abrirMenu(ctx, CLEBER, 'observacao', OBS);
    ctx.progSalvarMenuStatus(CLEBER); await espera(30);
    ok('main: tela mostra "salvo"', ctx.toasts.some(t => /Status salvo/.test(t.m)));
    ok('main: gravação individual recusada (on_conflict pelo nome da regra → 42703)', banco.reqs.some(r => r.metodo === 'POST' && /on_conflict=prog_status_diario_colaborador_id_data_key/.test(r.url)));
    ok('main: lote gravou na linha excluída (continua excluída)', banco.linhas[0].status === 'observacao' && !!banco.linhas[0].deleted_at, banco.linhas[0]);
    const rel = await recarregar(ctx);
    ok('main: depois de Atualizar a observação SOME (defeito reproduzido)', rel.status !== 'observacao' && rel.obs === '', rel);
  }

  // ═══ 1. Caso CLEBER com a correção ═══
  {
    const banco = criarBanco(); linhaCleberExcluida(banco);
    const ctx = criarCtx(html, banco);
    abrirMenu(ctx, CLEBER, 'observacao', OBS);
    ctx.progSalvarMenuStatus(CLEBER);
    ok('cleber: modal continua aberta enquanto o banco não confirma', ctx.fechou === 0 && ctx.el.__btnSalvar.disabled === true && ctx.el.__btnSalvar.textContent === 'Salvando...');
    await espera(30);
    ok('cleber: sucesso só depois da confirmação', /Status salvo/.test(ult(ctx).m) && ctx.fechou === 1, ctx.toasts);
    ok('cleber: individual usa as colunas da regra de unicidade', banco.reqs.some(r => r.metodo === 'POST' && /on_conflict=colaborador_id,data/.test(r.url) && r.corpo && r.corpo[0] && r.corpo[0].deleted_at === null));
    ok('cleber: uma única linha no dia (sem duplicidade)', banco.linhas.filter(l => l.colaborador_id === CLEBER && l.data === DIA).length === 1);
    ok('cleber: linha original reativada (mesmo id e criação)', banco.linhas[0].id === 'id-cleber' && banco.linhas[0].deleted_at === null && banco.linhas[0].criado_em === '2026-10-21T20:39:00Z');
    const a = ctx.audits.find(x => /Reativou status do dia excluído/.test(x.descricao));
    ok('cleber: reativação registrada na auditoria com o status e a exclusão anteriores',
      a && a.extra.status_anterior === 'treinamento' && a.extra.excluido_em === '2026-10-22T11:14:42Z' && a.extra.status_novo === 'observacao' && a.extra.colaborador_id === CLEBER, a);
    // Nova leitura em OUTRA "aba" (memória vazia) — persistência real no banco
    const outra = criarCtx(html, banco);
    const rel = await recarregar(outra);
    ok('cleber: depois de Atualizar a observação CONTINUA (nova leitura do banco)', rel.status === 'observacao' && rel.obs === OBS, rel);
  }

  // ═══ 2. Observação nova · alteração · exclusão e novo lançamento ═══
  {
    const banco = criarBanco();
    const ctx = criarCtx(html, banco);
    abrirMenu(ctx, CLEBER, 'observacao', 'primeira');
    ctx.progSalvarMenuStatus(CLEBER); await espera(30);
    let rel = await recarregar(criarCtx(html, banco));
    ok('observação nova: persiste após nova leitura', rel.status === 'observacao' && rel.obs === 'primeira', rel);
    ok('observação nova: sem auditoria de reativação', !ctx.audits.length);
    abrirMenu(ctx, CLEBER, 'observacao', 'texto alterado');
    ctx.progSalvarMenuStatus(CLEBER); await espera(30);
    rel = await recarregar(criarCtx(html, banco));
    ok('alteração: novo texto persiste, uma linha só', rel.obs === 'texto alterado' && banco.linhas.length === 1, rel);
    // Exclusão (soft delete real do sbDelete, como a sincronização de ponto faz)
    await ctx.sbDelete('prog_status_diario', 'colaborador_id=eq.' + CLEBER + '&data=eq.' + DIA);
    rel = await recarregar(criarCtx(html, banco));
    ok('exclusão: some da releitura', rel.status === 'disponivel', rel);
    abrirMenu(ctx, CLEBER, 'observacao', 'depois da exclusão');
    ctx.progSalvarMenuStatus(CLEBER); await espera(30);
    rel = await recarregar(criarCtx(html, banco));
    ok('exclusão e novo lançamento: volta a aparecer após nova leitura', rel.status === 'observacao' && rel.obs === 'depois da exclusão', rel);
    ok('exclusão e novo lançamento: auditoria da reativação', ctx.audits.some(x => /Reativou/.test(x.descricao) && x.extra.status_anterior === 'observacao'));
  }

  // ═══ 3. Falhas: recusa · permissão · rede · timeout (texto preservado, nada "salvo") ═══
  for (const [modo, re] of [['recusa', /O banco recusou a gravação: STATUS_BLOQUEADO/], ['permissao', /não tem permissão/], ['rede', /Sem conexão/], ['timeout', /não respondeu a tempo/]]) {
    const banco = criarBanco(); linhaCleberExcluida(banco);
    banco.regra = r => (r.metodo === 'POST' && r.via === 'auth' ? modo : 'ok');
    const ctx = criarCtx(html, banco);
    abrirMenu(ctx, CLEBER, 'observacao', OBS);
    ctx.progSalvarMenuStatus(CLEBER); await espera(modo === 'timeout' ? 200 : 30);
    ok('[' + modo + '] mensagem clara de erro', re.test(ult(ctx).m) && ult(ctx).erro, ult(ctx).m);
    ok('[' + modo + '] sem "Status salvo"', !ctx.toasts.some(t => /Status salvo/.test(t.m)));
    ok('[' + modo + '] modal aberta e texto digitado preservado', ctx.fechou === 0 && ctx.el['obs-status-input'].value === OBS && ctx.el.__btnSalvar.disabled === false);
    ok('[' + modo + '] lote não disparou (nada gravado na linha)', banco.linhas[0].status === 'treinamento');
    const rel = await recarregar(criarCtx(html, banco));
    ok('[' + modo + '] nova leitura: nada mudou', rel.status === 'disponivel' && !banco.linhas[0].obs, rel);
    ok('[' + modo + '] trava liberada para nova tentativa', !Object.keys(ctx.window._progStatusGravando || {}).length);
    // nova tentativa com o banco normal
    banco.regra = () => 'ok';
    ctx.progSalvarMenuStatus(CLEBER); await espera(30);
    const rel2 = await recarregar(criarCtx(html, banco));
    ok('[' + modo + '] nova tentativa grava e persiste', rel2.status === 'observacao' && rel2.obs === OBS, rel2);
  }

  // ═══ 4. Clique duplo ═══
  {
    const banco = criarBanco(); linhaCleberExcluida(banco);
    banco.regra = r => (r.metodo === 'POST' && r.via === 'auth' ? { lento: 40 } : 'ok');
    const ctx = criarCtx(html, banco);
    abrirMenu(ctx, CLEBER, 'observacao', OBS);
    ctx.progSalvarMenuStatus(CLEBER); ctx.progSalvarMenuStatus(CLEBER);
    ok('clique duplo: segundo clique avisa gravação em andamento', /Gravação em andamento/.test(ult(ctx).m));
    await espera(120);
    ok('clique duplo: uma única gravação individual', banco.reqs.filter(r => r.metodo === 'POST' && /on_conflict=colaborador_id,data/.test(r.url) && r.corpo[0].deleted_at === null).length === 1);
    ok('clique duplo: uma linha e persistida', banco.linhas.length === 1 && banco.linhas[0].deleted_at === null && banco.linhas[0].status === 'observacao');
  }

  // ═══ 5. Gravação em lote (progSalvarStatus) — só quem foi editado ═══
  const ONTEM = '2026-10-21';
  // Memória de 21/10 (várias faltas/observações) ainda no navegador; a tela já está em 22/10 (troca de dia
  // dentro da janela de 5 s em que progCarregarStatus ignora a recarga, ou aba antiga). O usuário edita UM colaborador.
  const memoriaDeOntem = ctx => {
    ctx._progStatus = { a1: 'falta', a2: 'observacao', a3: 'patio', [CLEBER]: 'falta' };
    ctx._progStatusInfo = { a1: { registrado_por: 'RODRIGO' }, a2: { obs: 'de ontem', registrado_por: 'RODRIGO' }, [CLEBER]: { obs: 'colaborador ficou na base (21/10)', registrado_por: 'RODRIGO' } };
  };
  if (base) {
    // Reprodução com a main: o lote copia a memória inteira de ontem para 22/10 e sobrescreve o Cleber
    const banco = criarBanco();
    banco.linhas.push({ id: 'id-cleber', colaborador_id: CLEBER, data: DIA, status: 'treinamento', data_retorno: '2026-10-23', registrado_por: 'ANSELMO', obs: null, deleted_at: null });
    const ctx = criarCtx(base, banco);
    memoriaDeOntem(ctx);
    ctx._progStatus.editado = 'observacao'; ctx._progStatusInfo.editado = { obs: 'decisão de hoje' };
    ctx.progMarcarAutorStatus('editado'); ctx.progSalvarStatus(); await espera(30);
    ok('main: lote copia faltas/observações de ontem para 22/10', ['a1', 'a2', 'a3'].every(id => banco.linhas.some(l => l.colaborador_id === id && l.data === DIA)), banco.linhas.map(l => l.colaborador_id));
    ok('main: lote sobrescreve o treinamento do Cleber com a falta antiga (sem auditoria)', banco.linhas.find(l => l.colaborador_id === CLEBER).status === 'falta');
  }
  {
    const banco = criarBanco();
    banco.linhas.push({ id: 'id-cleber', colaborador_id: CLEBER, data: DIA, status: 'treinamento', data_retorno: '2026-10-23', registrado_por: 'ANSELMO', obs: null, deleted_at: null });
    const ctx = criarCtx(html, banco);
    memoriaDeOntem(ctx);
    ctx._progStatus.editado = 'observacao'; ctx._progStatusInfo.editado = { obs: 'decisão de hoje' };
    ctx.progMarcarAutorStatus('editado'); ctx.progSalvarStatus(); await espera(40);
    ok('lote: grava só o colaborador editado', banco.linhas.some(l => l.colaborador_id === 'editado' && l.obs === 'decisão de hoje' && !l.deleted_at));
    ok('lote: NÃO copia faltas/observações da memória de ontem para 22/10', !banco.linhas.some(l => ['a1', 'a2', 'a3'].indexOf(l.colaborador_id) >= 0), banco.linhas.map(l => l.colaborador_id));
    ok('lote: NÃO sobrescreve o treinamento do Cleber com dado antigo', banco.linhas.find(l => l.colaborador_id === CLEBER).status === 'treinamento' && banco.linhas.find(l => l.colaborador_id === CLEBER).registrado_por === 'ANSELMO');
    ok('lote: localStorage do dia continua salvo', !!ctx.ls['prog_status_' + DIA]);
    ok('lote: confirmado sai da lista de pendentes', !Object.keys(ctx.window._progStatusPendentes[DIA] || {}).length);
    const n = banco.reqs.filter(r => r.metodo === 'POST').length;
    ctx.progSalvarStatus(); await espera(30);
    ok('lote: sem pendentes não grava nada (nem a memória antiga)', banco.reqs.filter(r => r.metodo === 'POST').length === n);
    // Pendente marcado em OUTRO dia não vai para o dia da tela
    ctx._progData = ONTEM; ctx.progMarcarAutorStatus('a1'); ctx._progData = DIA;
    ctx.progSalvarStatus(); await espera(30);
    ok('lote: edição marcada em outro dia não é gravada na data da tela', !banco.linhas.some(l => l.colaborador_id === 'a1'));
  }
  {
    // Edição explícita sobre linha excluída (ex.: janela de status dos Disponíveis, que grava pelo lote)
    const banco = criarBanco(); linhaCleberExcluida(banco);
    const ctx = criarCtx(html, banco);
    ctx._progStatus[CLEBER] = 'observacao'; ctx._progStatusInfo[CLEBER] = { obs: OBS };
    ctx.progMarcarAutorStatus(CLEBER); ctx.progSalvarStatus(); await espera(40);
    const rel = await recarregar(criarCtx(html, banco));
    ok('lote: edição explícita sobre linha excluída reativa e persiste após nova leitura', rel.status === 'observacao' && rel.obs === OBS, rel);
    ok('lote: reativação auditada', ctx.audits.some(x => /Reativou/.test(x.descricao) && x.extra.status_anterior === 'treinamento'));
    // Exclusão feita por outro usuário NÃO volta: memória de outro colaborador excluído não é gravada
    banco.linhas.push({ id: 'id-outro', colaborador_id: 'outro', data: DIA, status: 'falta', deleted_at: '2026-10-22T11:00:00Z' });
    ctx._progStatus.outro = 'falta';
    ctx._progStatus.x = 'patio'; ctx.progMarcarAutorStatus('x'); ctx.progSalvarStatus(); await espera(40);
    ok('lote: NÃO ressuscita exclusão de outro colaborador', banco.linhas.find(l => l.colaborador_id === 'outro').deleted_at !== null);
  }
  for (const [modo, re] of [['recusa', /Status do dia não foi salvo no banco \(CLEBER\) — O banco recusou/], ['rede', /não foi salvo no banco \(CLEBER\) — Sem conexão/], ['timeout', /não foi salvo no banco \(CLEBER\) — O servidor não respondeu/]]) {
    const banco = criarBanco();
    banco.regra = r => (r.metodo === 'POST' && r.via === 'auth' ? modo : 'ok');
    const ctx = criarCtx(html, banco);
    ctx._progStatus[CLEBER] = 'observacao'; ctx._progStatusInfo[CLEBER] = { obs: OBS };
    ctx.progMarcarAutorStatus(CLEBER); ctx.progSalvarStatus(); await espera(modo === 'timeout' ? 200 : 40);
    ok('lote [' + modo + ']: avisa que não salvou', re.test(ult(ctx).m) && ult(ctx).erro, ult(ctx).m);
    ok('lote [' + modo + ']: continua pendente para nova tentativa', !!(ctx.window._progStatusPendentes[DIA] || {})[CLEBER]);
    banco.regra = () => 'ok';
    ctx.progSalvarStatus(); await espera(40);
    const rel = await recarregar(criarCtx(html, banco));
    ok('lote [' + modo + ']: nova tentativa grava e persiste', rel.status === 'observacao' && rel.obs === OBS, rel);
  }

  // ═══ 5b. Dois supervisores ═══
  {
    const banco = criarBanco();
    const A = criarCtx(html, banco), B = criarCtx(html, banco);
    // A grava treinamento do Cleber; B (aba aberta antes, memória com falta do Cleber) edita OUTRO colaborador
    B._progStatus[CLEBER] = 'falta'; B._progStatusInfo[CLEBER] = { obs: 'memória antiga' };
    abrirMenu(A, CLEBER, 'treinamento', '');
    A.el['retorno-data'] = { value: '2026-10-23' };
    A.progSalvarMenuStatus(CLEBER); await espera(30);
    B._progStatus.y = 'patio'; B._progStatusInfo.y = { obs: 'pátio' }; B.progMarcarAutorStatus('y'); B.progSalvarStatus(); await espera(30);
    let rel = await recarregar(criarCtx(html, banco));
    ok('2 supervisores: edição de B em outro colaborador NÃO sobrescreve o treinamento gravado por A', rel.status === 'treinamento', rel);
    // Mesmo colaborador, decisões explícitas em sequência: vale a última (sem aviso de conflito — ver relatório)
    abrirMenu(B, CLEBER, 'observacao', 'decisão de B');
    B.progSalvarMenuStatus(CLEBER); await espera(30);
    rel = await recarregar(criarCtx(html, banco));
    ok('2 supervisores no mesmo colaborador: prevalece a última decisão explícita, uma linha só', rel.status === 'observacao' && rel.obs === 'decisão de B' && banco.linhas.filter(l => l.colaborador_id === CLEBER).length === 1, rel);
  }

  // ═══ 6. progSetStatus (janela de status: Faltou etc.) ═══
  {
    const banco = criarBanco(); linhaCleberExcluida(banco);
    const ctx = criarCtx(html, banco);
    ctx.progSetStatus(CLEBER, 'falta', null); await espera(30);
    let rel = await recarregar(criarCtx(html, banco));
    ok('progSetStatus: falta sobre linha excluída persiste após nova leitura', rel.status === 'falta', rel);
    ok('progSetStatus: sem nome da regra no on_conflict', !banco.reqs.some(r => /on_conflict=prog_status_diario_colaborador_id_data_key/.test(r.url)));
    const banco2 = criarBanco(); linhaCleberExcluida(banco2);
    banco2.regra = r => (r.via === 'auth' && r.metodo === 'POST' ? 'permissao' : (r.via === 'fetch' && r.metodo === 'POST' ? 'permissao' : 'ok'));
    const ctx2 = criarCtx(html, banco2);
    ctx2.progSetStatus(CLEBER, 'falta', null); await espera(30);
    ok('progSetStatus sem permissão: tela volta ao status anterior e avisa', ctx2._progStatus[CLEBER] === undefined && ctx2.toasts.some(t => /Status não foi salvo — Seu usuário não tem permissão/.test(t.m)), [ctx2._progStatus[CLEBER], ctx2.toasts]);
  }

  // ═══ 6b. P1 — histórico: treinamento de 22/10 com retorno 23/10 ═══
  const linhaTreinoCleber = banco => banco.linhas.push({ id: 'a0000000-0000-4000-8000-000000000022', colaborador_id: CLEBER, data: DIA, status: 'treinamento', data_retorno: '2026-10-23',
    registrado_por: 'ANSELMO VIEIRA', obs: null, criado_em: '2026-10-21T20:39:00Z', deleted_at: null });
  if (base) {
    // main: no dia do retorno a primeira abertura de tela exclui a linha (histórico de 22/10 some)
    const banco = criarBanco(); linhaTreinoCleber(banco);
    const ctx = criarCtx(base, banco); ctx._hoje = '2026-10-23';
    await recarregar(ctx, '2026-10-23'); await espera(20);
    ok('main: em 23/10 a rotina de vencimento EXCLUI o treinamento de 22/10', !!banco.linhas[0].deleted_at);
    const rel = await recarregar(criarCtx(base, banco), DIA);
    ok('main: consultar 22/10 depois do retorno mostra "disponível" (histórico perdido)', rel.status === 'disponivel', rel);
  }
  {
    const banco = criarBanco(); linhaTreinoCleber(banco);
    const n0 = () => banco.reqs.filter(r => r.metodo === 'PATCH' || r.metodo === 'DELETE').length;
    const nAntes = n0();
    for (const hoje of ['2026-10-22', '2026-10-23', '2026-10-30']) {
      const ctx = criarCtx(html, banco); ctx._hoje = hoje;
      for (const [diaTela, esperado] of [['2026-10-21', 'disponivel'], [DIA, 'treinamento'], ['2026-10-23', 'disponivel'], ['2026-10-24', 'disponivel']]) {
        const rel = await recarregar(ctx, diaTela);
        ok('P1 hoje=' + hoje + ', consulta ' + diaTela + ': ' + esperado, rel.status === esperado, rel);
      }
    }
    ok('P1: abrir dias em datas posteriores ao retorno não exclui nem altera nada no banco', n0() === nAntes && banco.linhas[0].deleted_at === null && banco.linhas.length === 1);
    // Férias de 15/10 com retorno 25/10: vale de 15 a 24, histórico preservado depois
    banco.linhas.push({ id: 'id-fer', colaborador_id: 'fer', data: '2026-10-15', status: 'ferias', data_retorno: '2026-10-25', deleted_at: null });
    const ctx = criarCtx(html, banco); ctx._hoje = '2026-11-10';
    for (const [diaTela, esperado] of [['2026-10-14', 'disponivel'], ['2026-10-15', 'ferias'], ['2026-10-24', 'ferias'], ['2026-10-25', 'disponivel']]) {
      const rel = await recarregar(ctx, diaTela, 'fer');
      ok('P1 férias (consultadas em 10/11) — ' + diaTela + ': ' + esperado, rel.status === esperado, rel);
    }
    ok('P1 férias: linha preservada, sem duplicar', banco.linhas.filter(l => l.colaborador_id === 'fer').length === 1 && !banco.linhas.find(l => l.colaborador_id === 'fer').deleted_at);
  }

  // ═══ 6c. P2 — consulta de persistentes paginada, sem omissão silenciosa ═══
  {
    const banco = criarBanco();
    // ~3.200 linhas como em 22/10/2026 (cópias diárias de "demitido"), e uma férias antiga
    for (let i = 0; i < 3200; i++) banco.linhas.push({ id: 'd' + String(i).padStart(5, '0'), colaborador_id: 'dem' + (i % 60), data: '2026-10-' + String(1 + (i % 22)).padStart(2, '0'), status: 'demitido', data_retorno: null, deleted_at: null });
    banco.linhas.push({ id: 'id-ferias-antiga', colaborador_id: 'fer-antiga', data: '2026-09-20', status: 'ferias', data_retorno: '2026-10-30', deleted_at: null });
    banco.linhas.push({ id: 'id-vencida', colaborador_id: 'vencida', data: '2026-10-01', status: 'afastado', data_retorno: '2026-10-10', deleted_at: null });
    if (base) {
      const relMain = await recarregar(criarCtx(base, banco), DIA, 'fer-antiga');
      ok('main: limite de 500 omite em silêncio a férias iniciada em 20/09 (aparece disponível)', relMain.status === 'disponivel', relMain.status);
    }
    const ctx = criarCtx(html, banco);
    const nGet = banco.reqs.length;
    const rel = await recarregar(ctx, DIA, 'fer-antiga');
    ok('P2: férias iniciada em 20/09 continua aparecendo em 22/10', rel.status === 'ferias', rel.status);
    ok('P2: todas as linhas pertinentes foram lidas (paginação)', rel.persistentes.length === 3201, rel.persistentes.length);
    ok('P2: status vencido não entra na consulta', !rel.persistentes.some(r => r.colaborador_id === 'vencida'));
    const pags = banco.reqs.slice(nGet).filter(r => r.metodo === 'GET' && /offset=/.test(r.url));
    ok('P2: 4 páginas de 1000, ordem estável (data desc, id desc)', pags.length === 4 && pags.every(r => /order=data\.desc,id\.desc/.test(r.url) && /limit=1000/.test(r.url)), pags.map(r => r.url.slice(-60)));
    ok('P2: filtro de retorno no formato do PostgREST', /or=\(data_retorno\.is\.null,data_retorno\.gt\.2026-10-22\)/.test(pags[0].url), pags[0].url);
    // Falha numa página do meio → null (nunca lista parcial calada)
    let k = 0; banco.regra = r => (r.metodo === 'GET' && /offset=2000/.test(r.url) && k++ === 0 ? 'rede' : 'ok');
    const parcial = await ctx.progBuscarStatusPersistentes(DIA);
    ok('P2: falha numa página devolve null (não lista parcial)', parcial === null);
    banco.regra = () => 'ok';
  }

  // ═══ 6c-PP. Programação de Projetos: os 3 colaboradores do diagnóstico (dados fictícios) ═══
  {
    const PP3 = [
      { id: 'pp-heitor', status: 'inapto', data: '2026-07-12', ret: null },          // como HEITOR SILVA DIAS
      { id: 'pp-joelson', status: 'afastado', data: '2026-07-26', ret: '2026-10-31' }, // como JOELSON GOMES DE SOUSA
      { id: 'pp-ricardo', status: 'afastado', data: '2026-06-03', ret: null },        // como RICARDO OLIVEIRA
    ];
    const montarBanco = () => {
      const banco = criarBanco();
      for (let i = 0; i < 3200; i++) banco.linhas.push({ id: 'd' + String(i).padStart(5, '0'), colaborador_id: 'dem' + (i % 150), data: '2026-10-' + String(1 + Math.floor(i / 150)).padStart(2, '0'), status: 'demitido', data_retorno: null, deleted_at: null });
      PP3.forEach(p => banco.linhas.push({ id: 'id-' + p.id, colaborador_id: p.id, data: p.data, status: p.status, data_retorno: p.ret, deleted_at: null }));
      return banco;
    };
    const ctxPP = (src, banco) => {
      const ctx = criarCtx(src, banco);
      ctx._pp = { statusData: null }; ctx.progProjRenderQuadro = () => {}; ctx._pontoCacheTemDia = () => true;
      ctx.setTimeout = (f, ms) => setTimeout(f, ms >= 20000 ? 2000 : ms);   // prazo da leitura (20 s) comprimido, mas maior que 4 páginas em memória
      vm.runInContext(['progProjStatusEhDoDia', 'progProjCarregarStatusDia', 'progProjCarregarStatusBanco'].map(n => fnDe(src, n)).join('\n'), ctx);
      return ctx;
    };
    if (base) {
      const ctx = ctxPP(base, montarBanco());
      ctx.progProjCarregarStatusDia(DIA, true); await espera(600);
      ok('main (PP): os 3 colaboradores somem com o limite de 500 (aparecem disponíveis)', PP3.every(p => !ctx._progStatus[p.id]), PP3.map(p => ctx._progStatus[p.id]));
    }
    const banco = montarBanco();
    const ctx = ctxPP(html, banco);
    ctx.progProjCarregarStatusDia(DIA, true); await espera(600);
    ok('PP: inapto desde 12/07 sem prazo aparece em 22/10', ctx._progStatus['pp-heitor'] === 'inapto', ctx._progStatus['pp-heitor']);
    ok('PP: afastado até 31/10 aparece em 22/10', ctx._progStatus['pp-joelson'] === 'afastado', ctx._progStatus['pp-joelson']);
    ok('PP: afastado desde 03/06 sem prazo aparece em 22/10', ctx._progStatus['pp-ricardo'] === 'afastado', ctx._progStatus['pp-ricardo']);
    ok('PP: carga completa marcada como do dia, sem aviso de falha', ctx._pp.statusData === DIA && ctx._pp.statusFalhou === null && ctx._pp.statusCarregando === false);
    // Afastamento de Joelson vence em 31/10: em 31/10 não vale mais (histórico preservado)
    ctx.progProjCarregarStatusDia('2026-10-31', true); await espera(600);
    ok('PP: em 31/10 (retorno) o afastado não vale mais; inapto/afastado sem prazo continuam', !ctx._progStatus['pp-joelson'] && ctx._progStatus['pp-heitor'] === 'inapto' && ctx._progStatus['pp-ricardo'] === 'afastado');
    // Falha numa página intermediária: NÃO vira "ninguém indisponível"
    let k = 0; banco.regra = r => (r.metodo === 'GET' && /offset=2000/.test(r.url) && k++ === 0 ? 'rede' : 'ok');
    const ctx2 = ctxPP(html, banco);
    ctx2.progProjCarregarStatusDia(DIA, true); await espera(600);
    ok('PP: falha de paginação não aplica lista parcial e marca o dia como incompleto', ctx2._pp.statusFalhou === DIA && !Object.keys(ctx2._progStatus).length);
    ok('PP: falha de paginação avisa o usuário', /não foi possível carregar férias\/afastamentos\/treinamentos/i.test(ult(ctx2).m) && ult(ctx2).erro, ult(ctx2).m);
    banco.regra = () => 'ok';
    ctx2.progProjCarregarStatusDia(DIA, true); await espera(600);
    ok('PP: nova carga com o banco normal aplica os 3 e limpa o aviso', ctx2._pp.statusFalhou === null && PP3.every(p => !!ctx2._progStatus[p.id]));
  }

  // ═══ 6d. P3 — progVerificarRetornos usa o dia da tela ═══
  {
    const banco = criarBanco();
    const ctx = criarCtx(html, banco);
    const prep = () => { ctx._progStatus = { [CLEBER]: 'treinamento' }; ctx._progStatusInfo = { [CLEBER]: { retorno: '2026-10-23' } }; };
    ctx._hoje = '2026-10-30';
    prep(); ctx._diaTela = DIA; ctx.progVerificarRetornos();
    ok('P3: consultando 22/10 (hoje 30/10), retorno em 23/10 → continua em treinamento', ctx._progStatus[CLEBER] === 'treinamento');
    prep(); ctx._diaTela = '2026-10-23'; ctx.progVerificarRetornos();
    ok('P3: consultando 23/10 → retornou (disponível)', ctx._progStatus[CLEBER] === 'disponivel');
    prep(); ctx._hoje = '2026-10-21'; ctx._diaTela = '2026-10-21'; ctx.progVerificarRetornos();
    ok('P3: consultando dia atual antes do retorno → continua', ctx._progStatus[CLEBER] === 'treinamento');
    prep(); ctx._diaTela = '2026-10-25'; ctx.progVerificarRetornos();
    ok('P3: consultando dia futuro depois do retorno → disponível', ctx._progStatus[CLEBER] === 'disponivel');
    ctx._diaTela = null; ctx._hoje = null;
  }

  // ═══ 6e. Janela de status dos Disponíveis (progAlterarStatusPool) ═══
  {
    const abrirPool = (ctx, st, texto) => {
      ctx.progAlterarStatusPool(CLEBER);
      ctx.window.progStSelecionar(CLEBER, st);
      ctx.el['prog-st-obs'] = { value: texto };
      ctx.el.__btnConfirmar = { disabled: false, textContent: 'Confirmar' };
    };
    if (base) {
      const banco = criarBanco(); linhaCleberExcluida(banco);
      banco.regra = r => (r.via === 'fetch' && r.metodo === 'POST' ? 'recusa' : 'ok');
      const ctx = criarCtx(base, banco);
      abrirPool(ctx, 'observacao', OBS);
      ctx.window.progConfirmarStatus(CLEBER); await espera(30);
      ok('main (pool): "✅ Status salvo." aparece mesmo sem nada gravado', ctx.toasts.some(t => /Status salvo/.test(t.m)) && !banco.linhas[0].obs);
    }
    for (const [modo, re] of [['recusa', /O banco recusou/], ['permissao', /não tem permissão/], ['rede', /Sem conexão/], ['timeout', /não respondeu a tempo/]]) {
      const banco = criarBanco(); linhaCleberExcluida(banco);
      banco.regra = r => (r.metodo === 'POST' ? modo : 'ok');
      const ctx = criarCtx(html, banco);
      abrirPool(ctx, 'observacao', OBS);
      ctx.window.progConfirmarStatus(CLEBER); await espera(modo === 'timeout' ? 200 : 30);
      ok('pool [' + modo + ']: sem "Status salvo", mensagem clara', !ctx.toasts.some(t => /Status salvo/.test(t.m)) && re.test(ult(ctx).m) && ult(ctx).erro, ctx.toasts);
      ok('pool [' + modo + ']: janela aberta e texto preservado', ctx.fechou === 0 && ctx.el['prog-st-obs'].value === OBS && ctx.el.__btnConfirmar.disabled === false);
      ok('pool [' + modo + ']: tela não mudou', ctx._progStatus[CLEBER] === undefined);
    }
    {
      const banco = criarBanco(); linhaCleberExcluida(banco);
      const ctx = criarCtx(html, banco);
      abrirPool(ctx, 'observacao', OBS);
      ctx.window.progConfirmarStatus(CLEBER);
      ok('pool: janela continua aberta até o banco confirmar', ctx.fechou === 0 && ctx.el.__btnConfirmar.textContent === 'Salvando...');
      ctx.window.progConfirmarStatus(CLEBER);
      ok('pool: clique duplo bloqueado', /Gravação em andamento/.test(ult(ctx).m));
      await espera(40);
      ok('pool: sucesso só depois da confirmação, janela fecha', /✅ Status salvo/.test(ult(ctx).m) && ctx.fechou === 1, ctx.toasts);
      ok('pool: sem nome da regra, uma gravação confirmada', !banco.reqs.some(r => /prog_status_diario_colaborador_id_data_key/.test(r.url))
        && banco.reqs.filter(r => r.metodo === 'POST' && /on_conflict=colaborador_id,data/.test(r.url)).length === 1);
      const rel = await recarregar(criarCtx(html, banco));
      ok('pool: observação sobre linha excluída persiste após nova leitura', rel.status === 'observacao' && rel.obs === OBS, rel);
      ok('pool: reativação auditada', ctx.audits.some(x => /Reativou/.test(x.descricao)));
    }
  }

  // ═══ 7. Estático: ES5 e escopo ═══
  const novas = ['progStatusComPrazo', 'progStatusClassificarErro', 'progStatusMsgErro', 'progStatusGravarDia', 'progSalvarStatus', 'progSalvarMenuStatus', 'progSetStatus'];
  ok('ES5 nas funções novas/alteradas', !/\blet\s|\bconst\s|=>|`/.test(semComent(novas.map(n => fnDe(html, n)).join('\n'))));
  ok('nenhum on_conflict pelo nome da regra nas funções corrigidas', !/prog_status_diario_colaborador_id_data_key/.test(['progSalvarStatus', 'progSalvarMenuStatus', 'progSetStatus'].map(n => fnDe(html, n)).join('\n')));
  if (base) {
    const mapa = src => { const m = {}, pos = [], re = /\n(?:async )?function ([A-Za-z0-9_$]+)\(/g; let x;
      while ((x = re.exec(src))) pos.push([x[1], x.index + 1]);
      pos.forEach((p, i) => { const bl = src.slice(p[1], i + 1 < pos.length ? pos[i + 1][1] : src.length); const f = bl.indexOf('\n}\n'); m[p[0]] = (m[p[0]] || '') + (f >= 0 ? bl.slice(0, f + 2) : bl); });
      return m; };
    const mb = mapa(base), ma = mapa(html);
    // Entrega do relatório "Horas Logadas e Faturamento" por fontes (branch feat/rel-tma-fontes-horas): fora do escopo de status
    const REL_FONTES = n => /^relTma(Fat|BuscarTodas$|ValorHoraSeguro$|EnsureServicosTma$|FetchPontoPeriodo$|CalcFat(Portaria|Bordo|Escala)Dia$)/.test(n);
    const mud = Object.keys(mb).filter(n => mb[n] !== ma[n] && !REL_FONTES(n));
    // + trava de escala/programação com leitura incompleta: escalasModeloAplicar, progEfetuarDropInterno,
    //   progIniciarAutoEscalaRef, progMobileProgramar, progSalvarEquipe, progSalvarTodas (só a linha da trava)
    // + correções A/B/C: progEfetuarEmprestimoInterno (empréstimo), PP progProjetoCoreEfetuarDrop, ppAutoEscalarEquipe,
    //   progProjetoCoreSalvarEquipe (trava da PP)
    const ESPERADAS = ['escalasModeloAplicar', 'ppAutoEscalarEquipe', 'ppRenderPainelDisp', 'progAlterarStatusPool', 'progAplicarStatusDoBanco', 'progAtualizarQuadro', 'progCarregarStatus', 'progEfetuarDropInterno', 'progEfetuarEmprestimoInterno', 'progExpirarPersistenteLinha', 'progFiltrosStatusPersistentes',
      'progIniciarAutoEscalaRef', 'progMarcarAutorStatus', 'progMobileProgramar', 'progProjAtualizarQuadro', 'progProjCarregarStatusBanco', 'progProjCarregarStatusDia', 'progProjetoCoreEfetuarDrop', 'progProjetoCoreSalvarEquipe', 'progRenderPainelDisp', 'progSalvarEquipe', 'progSalvarMenuStatus', 'progSalvarStatus', 'progSalvarTodas', 'progSetStatus', 'progVerificarRetornos', 'relTmaStatus'];
    const painel = fnDe(html, 'progRenderPainelDisp'), painelBase = fnDe(base, 'progRenderPainelDisp');
    const painelSemLeitura = painel.replace(/\n  progStatusLeituraAviso\(dataNorm\);[^\n]*/, '')
      .replace(/\+\(\['ok','carregando'\]\.indexOf\(progStatusLeituraEstado\(dataNorm\)\)<0\n\s*\? '[^\n]*'\n\s*: ('[^\n]*')\)/, '+$1');
    ok('painel de Disponíveis: retorno pelo dia da tela + aviso de leitura incompleta (únicas mudanças na função)',
      /var hoje = dataNorm \|\| dataHojeLocal\(\);/.test(painel) && painelSemLeitura.replace(/\n  \/\/ pelo DIA DA TELA[^\n]*/, '').replace('var hoje = dataNorm || dataHojeLocal();', 'var hoje = dataHojeLocal();') === painelBase);
    ok('escopo: só as funções de status do TMA mudaram', mud.sort().join(',') === ESPERADAS.join(','), mud);
    const novasNomes = Object.keys(ma).filter(n => !(n in mb) && !REL_FONTES(n)).sort().join(',');
    ok('escopo: funções novas só as de status', novasNomes === 'ppStatusBloqueiaEscala,ppStatusVerificado,progBuscarStatusPersistentes,progStatusBloqueiaEscala,progStatusClassificarErro,progStatusComPrazo,progStatusGravarDia,progStatusLeituraAviso,progStatusLeituraEstado,progStatusLeituraMarcar,progStatusLerDia,progStatusMsgErro', novasNomes);
    // Trava: nas 6 funções de escala/programação a única mudança é a linha da trava (ou o bloco de entrada na escala)
    const TRAVA = { escalasModeloAplicar: /\n  if\(progStatusBloqueiaEscala\(data, 'implantar o modelo'\)\) return;/, progIniciarAutoEscalaRef: /\n  if\(progStatusBloqueiaEscala\(dest, 'usar o Auto Escalar'\)\) return;/,
      progMobileProgramar: /\n  if\(progStatusBloqueiaEscala\(data, 'programar a equipe'\)\) return;/, progSalvarEquipe: /\n  if\(progStatusBloqueiaEscala\(data, 'programar a equipe'\)\) return;/,
      progSalvarTodas: /\n  if\(progStatusBloqueiaEscala\(data, 'programar as equipes'\)\) return;/,
      progEfetuarDropInterno: /\n  \/\/ Entrar na escala do dia[^\n]*\n  \/\/ Mover[^\n]*\n  var jaNaEscalaDia = [^]*?\n  if\(!jaNaEscalaDia && progStatusBloqueiaEscala\(data, 'escalar'\)\) return;/,
      progEfetuarEmprestimoInterno: /\n  \/\/ Empréstimo de outro contrato[^\n]*\n  if\(progStatusBloqueiaEscala\(data, 'emprestar colaborador'\)\) return;/,
      ppAutoEscalarEquipe: /\n  if\(ppStatusBloqueiaEscala\(data, 'usar o Auto Escalar'\)\) return;/,
      progProjetoCoreSalvarEquipe: /\n  if\(ppStatusBloqueiaEscala\(data, 'programar a equipe'\)\) return;/,
      progProjetoCoreEfetuarDrop: /\n  \/\/ Entrar na escala do dia[^\n]*\n  \/\/ Mover[^\n]*\n  var jaNaEscalaDia=[^]*?\n  if\(!jaNaEscalaDia && ppStatusBloqueiaEscala\(data, 'escalar'\)\) return;/ };
    ok('trava: nas funções de escala/programação só entrou a trava', Object.keys(TRAVA).every(n => TRAVA[n].test(fnDe(html, n)) && fnDe(html, n).replace(TRAVA[n], '') === fnDe(base, n)),
      Object.keys(TRAVA).filter(n => !(TRAVA[n].test(fnDe(html, n)) && fnDe(html, n).replace(TRAVA[n], '') === fnDe(base, n))));
    // PP: só a LEITURA dos persistentes (paginada) e o aviso de leitura incompleta mudaram
    const semLeitura = s => s.replace(/sbFetch\('prog_status_diario',\{[^]*?limit:500\s*\}\)/g, 'LEITURA').replace(/progBuscarStatusPersistentes\(data\),?\s*(\/\/[^\n]*)?/g, 'LEITURA');
    ok('PP: carga usa a busca paginada com prazo (sem limite de 500)', /progBuscarStatusPersistentes\(dia\)/.test(fnDe(html, 'progStatusLerDia'))
      && ['progProjCarregarStatusBanco', 'progProjAtualizarQuadro'].every(n => /progStatusLerDia\(data\)/.test(fnDe(html, n)) && !/limit:\s*500\s*\}\)\s*,?\s*$/m.test(fnDe(html, n).split('composicao_dia')[0])));
    ok('PP: aviso de leitura incompleta no painel', /pp-status-incompleto/.test(fnDe(html, 'ppRenderPainelDisp')) && /statusFalhou === data/.test(fnDe(html, 'ppRenderPainelDisp')));
    ok('Programação de Projetos (gravação/regras), Portaria e wrappers intactos', ['progProjetoCoreSalvarMenuStatus', 'ppDefinirStatus', 'ppDispStatusColab', 'ppDispFaltaPeloPonto', 'sbUpsert', 'sbFetch', 'sbDelete', 'sbUpdate']
      .every(n => n === 'sbUpsert' ? sbUpsertReal(base) === sbUpsertReal(html) : fnDe(base, n) === fnDe(html, n)));
    ok('PP: progProjSalvarStatus continua vazia', /\nfunction progProjSalvarStatus\(\)\{\}\n/.test(html));
    ok('versão da publicação A: 8.1.226 (app e service worker)', /numero: '8\.1\.226'/.test(html) && /SW_VERSION\s*=\s*'cena-8\.1\.226'/.test(fs.readFileSync(path.join(raiz, 'sw.js'), 'utf8')));
  }

  if (falhas) { console.error('tma-status-observacao: FALHOU ' + falhas + '/' + total); process.exit(1); }
  console.log('tma-status-observacao: ' + total + ' verificações OK');
})().catch(e => { console.error(e); process.exit(1); });
