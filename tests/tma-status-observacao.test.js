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
  const filtrar = q => b.linhas.filter(l => [...q].every(([k, v]) => ['select', 'order', 'limit', 'offset', 'on_conflict'].includes(k) || casa(l, k, v)));
  b.tratar = (metodo, url, corpo, prefer) => {
    const u = new URL(url); const tabela = u.pathname.replace('/rest/v1/', ''); const q = u.searchParams;
    b.reqs.push({ metodo, tabela, url, corpo });
    if (tabela !== 'prog_status_diario') return { status: metodo === 'GET' ? 200 : 201, corpo: metodo === 'GET' ? [] : (corpo ? [].concat(corpo) : []) };
    if (metodo === 'GET') return { status: 200, corpo: filtrar(q).map(l => Object.assign({}, l)) };
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
  ctx.progGetData = () => DIA; ctx.dataHojeLocal = () => DIA; ctx._compDataStr = v => String(v || '').slice(0, 10);
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
    querySelector: sel => (/progSalvarMenuStatus/.test(sel) ? (el.__btnSalvar || null) : null),
    querySelectorAll: () => [],
  };
  vm.createContext(ctx);
  const nomes = ['isUUID', 'sbFetch', 'sbInsert', 'sbDelete', 'sbUpdate', 'progMarcarAutorStatus', 'progDataRetornoStr', 'progRetornoAindaFora', 'progRetornoExpirouNoDia',
    'progFiltrosStatusPersistentes', 'progExpirarPersistenteLinha', 'progAplicarStatusDoBanco', 'progSalvarPersistente', 'progRemoverPersistente',
    'progSalvarStatus', 'progSalvarMenuStatus', 'progSetStatus'];
  const novos = /function progStatusGravarDia\(/.test(src) ? ['progStatusComPrazo', 'progStatusClassificarErro', 'progStatusMsgErro', 'progStatusGravarDia'] : [];
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
async function recarregar(ctx) {
  const dia = await ctx.sbFetch('prog_status_diario', { filters: ['data=eq.' + DIA, 'deleted_at=is.null'] });
  const pers = await ctx.sbFetch('prog_status_diario', { filters: ctx.progFiltrosStatusPersistentes(DIA), order: 'data.desc', limit: 500 });
  ctx.progAplicarStatusDoBanco(dia || [], pers || [], DIA);
  return { status: ctx._progStatus[CLEBER] || 'disponivel', obs: (ctx._progStatusInfo[CLEBER] || {}).obs || '' };
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
    const mud = Object.keys(mb).filter(n => mb[n] !== ma[n]);
    ok('escopo: só progSalvarStatus, progSalvarMenuStatus, progSetStatus e progMarcarAutorStatus mudaram', mud.sort().join(',') === 'progMarcarAutorStatus,progSalvarMenuStatus,progSalvarStatus,progSetStatus', mud);
    const novasNomes = Object.keys(ma).filter(n => !(n in mb)).sort().join(',');
    ok('escopo: funções novas só as de gravação do status', novasNomes === 'progStatusClassificarErro,progStatusComPrazo,progStatusGravarDia,progStatusMsgErro', novasNomes);
    ok('Programação de Projetos, Portaria e wrappers intactos', ['progProjetoCoreSalvarMenuStatus', 'ppDefinirStatus', 'progProjSalvarStatus', 'sbUpsert', 'sbFetch', 'sbDelete', 'sbUpdate']
      .every(n => n === 'sbUpsert' ? sbUpsertReal(base) === sbUpsertReal(html) : fnDe(base, n) === fnDe(html, n)));
    ok('versão não mudou', /numero: '8\.1\.225'/.test(html));
  }

  if (falhas) { console.error('tma-status-observacao: FALHOU ' + falhas + '/' + total); process.exit(1); }
  console.log('tma-status-observacao: ' + total + ' verificações OK');
})().catch(e => { console.error(e); process.exit(1); });
