'use strict';
// TMA — leitura incompleta dos status do dia (Atualizar / abrir o dia), com dados fictícios.
// Regra: falha, prazo esgotado ou resposta inesperada NUNCA vira "disponível": o conjunto confiável anterior
// e as alterações locais ficam; aviso fixo; escala, Auto Escalar, modelo e Programar bloqueados até uma
// leitura completa. Executa as funções REAIS do index.html (progAtualizarQuadro, progCarregarStatus,
// progBuscarStatusPersistentes, progAplicarStatusDoBanco, travas) e o sbFetch real contra um banco em memória.
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
const espera = ms => new Promise(r => setTimeout(r, ms));
const semComent = s => s.replace(/\/\/[^\n]*/g, '');

const DIA = '2026-10-23';
const id = n => 'f0000000-0000-4000-8000-' + String(n).padStart(12, '0');
const FERIAS = id(1), AFAST = id(2), INAPTO = id(3), DEMIT = id(4), LIVRE = id(5), LOCAL = id(6), FALTA = id(7);
const INDISP = { [FERIAS]: 'ferias', [AFAST]: 'afastado', [INAPTO]: 'inapto', [DEMIT]: 'demitido' };

// ── Banco em memória (GET com filtros/ordem/paginação do PostgREST) ──
function criarBanco() {
  const b = { linhas: [], regra: () => 'ok', gets: 0 };
  const casa = (l, k, expr) => {
    const i = expr.indexOf('.'), op = expr.slice(0, i), v = decodeURIComponent(expr.slice(i + 1));
    const x = l[k] == null ? null : String(l[k]);
    if (op === 'eq') return x === v;
    if (op === 'lte') return x !== null && x <= v;
    if (op === 'gt') return x !== null && x > v;
    if (op === 'is') return v === 'null' ? l[k] == null : String(l[k]) === v;
    if (op === 'in') return v.replace(/^\(|\)$/g, '').split(',').indexOf(x) >= 0;
    return true;
  };
  const casaOr = (l, v) => v.replace(/^\(|\)$/g, '').split(',').some(p => { const i = p.indexOf('.'); return casa(l, p.slice(0, i), p.slice(i + 1)); });
  b.authFetch = (url, opts) => {
    const metodo = (opts && opts.method) || 'GET';
    const u = new URL(url), tabela = u.pathname.replace('/rest/v1/', ''), q = u.searchParams;
    const modo = b.regra({ metodo, tabela, url });
    if (modo === 'timeout') return new Promise(() => {});
    if (modo === 'rede') return Promise.resolve({ ok: false, status: 0, text: 'Failed to fetch', aborted: false, json: null });
    if (modo === 'erro500') return Promise.resolve({ ok: false, status: 500, text: '{"message":"falha simulada"}', aborted: false, json: { message: 'falha simulada' } });
    if (modo === 'inesperada') return Promise.resolve({ ok: true, status: 200, text: '{"message":"proxy"}', aborted: false, json: { message: 'resposta inesperada do proxy' } });
    if (modo === 'html') return Promise.resolve({ ok: true, status: 200, text: '<html>502 Bad Gateway</html>', aborted: false, json: null });
    if (tabela !== 'prog_status_diario' || metodo !== 'GET') return Promise.resolve({ ok: true, status: 200, json: [], text: '[]', aborted: false });
    b.gets++;
    let rows = b.linhas.filter(l => [...q].every(([k, v]) => ['select', 'order', 'limit', 'offset'].includes(k) || (k === 'or' ? casaOr(l, v) : casa(l, k, v))));
    const ord = (q.get('order') || '').split(',').filter(Boolean).map(o => o.split('.'));
    rows.sort((x, y) => { for (const [c, d] of ord) { const a = String(x[c] == null ? '' : x[c]), bb = String(y[c] == null ? '' : y[c]); if (a !== bb) return (a < bb ? -1 : 1) * (d === 'desc' ? -1 : 1); } return 0; });
    const off = Number(q.get('offset') || 0), lim = Number(q.get('limit') || rows.length);
    rows = rows.slice(off, off + lim).map(l => Object.assign({}, l));
    return Promise.resolve({ ok: true, status: 200, json: rows, text: JSON.stringify(rows), aborted: false });
  };
  return b;
}
// 3.200 cópias de "demitido" de outros colaboradores (volume de produção) empurram os casos antigos para as últimas páginas
function montarBanco() {
  const b = criarBanco();
  for (let i = 0; i < 3200; i++) b.linhas.push({ id: 'c' + String(i).padStart(5, '0'), colaborador_id: 'copia' + (i % 150), data: '2026-10-' + String(1 + Math.floor(i / 150)).padStart(2, '0'), status: 'demitido', data_retorno: null, deleted_at: null });
  b.linhas.push({ id: 'p1', colaborador_id: FERIAS, data: '2026-09-20', status: 'ferias', data_retorno: '2026-10-30', obs: 'férias', deleted_at: null });
  b.linhas.push({ id: 'p2', colaborador_id: AFAST, data: '2026-06-03', status: 'afastado', data_retorno: null, deleted_at: null });
  b.linhas.push({ id: 'p3', colaborador_id: INAPTO, data: '2026-07-12', status: 'inapto', data_retorno: null, deleted_at: null });
  b.linhas.push({ id: 'p4', colaborador_id: DEMIT, data: '2026-05-02', status: 'demitido', data_retorno: null, deleted_at: null });
  b.linhas.push({ id: 'd1', colaborador_id: FALTA, data: DIA, status: 'falta', data_retorno: null, obs: 'faltou', deleted_at: null });
  return b;
}
// Falha só na página de offset N da leitura de persistentes (k-ésima vez em diante, se "sempre")
const falhaNaPagina = (banco, off, modo) => { banco.regra = r => (r.tabela === 'prog_status_diario' && r.metodo === 'GET' && new RegExp('[?&]offset=' + off + '(&|$)').test(r.url) ? modo : 'ok'); };

// ── Sandbox com as funções reais ──
function criarCtx(src, banco) {
  const el = {};
  const hdr = { appendChild: x => { el[x.id] = x; } };
  el['prog-header-fixo'] = hdr;
  const ctx = {
    console: { log() {}, warn() {}, error() {} }, window: {}, DEMO: false, SB: { url: 'https://banco.teste', key: 'anon-teste' }, _sbAuthToken: '',
    Promise, Object, Array, String, JSON, Date, Number, Math, RegExp, URL, clearTimeout, parseInt,
    setTimeout: (f, ms) => setTimeout(f, ms >= 20000 ? 60 : Math.min(ms || 0, 5)),
    usuarioLogado: { id: 'u1', nome: 'SUPERVISOR TESTE', perfil: 'supervisor_tma' },
    _progStatus: {}, _progStatusInfo: {}, _progData: DIA, _progStatusDateCache: null, _progVeiculosDateCache: null,
    composicao_dia: [], colaboradores: [FERIAS, AFAST, INAPTO, DEMIT, LIVRE, LOCAL, FALTA].map((c, i) => ({ id: c, nome: 'COLAB ' + i, ativo: true })),
    equipes_disp: [{ id: 'e1', codigo: 'HOM1' }], equipes: [], tipos_equipe: [{ id: 't1', nome: 'Fiorino' }], _modelos: {}, _CORES_MODELO: {},
    toasts: [], renders: 0, ls: {}, chamou: {},
    _cenaAuthHadSession: false, sbAuthJwtIsAuthenticated: () => false,
  };
  ctx.localStorage = { getItem: k => (k in ctx.ls ? ctx.ls[k] : null), setItem: (k, v) => { ctx.ls[k] = String(v); }, removeItem: k => { delete ctx.ls[k]; } };
  ctx.el = el;
  ctx.document = {
    getElementById: i => el[i] || null, querySelector: () => null, querySelectorAll: () => [],
    createElement: () => { const o = { style: {}, innerHTML: '', remove() { delete el[o.id]; } }; return o; },
  };
  const marca = n => (...a) => { ctx.chamou[n] = (ctx.chamou[n] || 0) + 1; return null; };
  Object.assign(ctx, {
    progShowToast: (m, t) => ctx.toasts.push({ m: String(m), erro: t === 'erro' }),
    progRenderQuadro: () => { ctx.renders++; }, progGetData: () => ctx._diaTela || DIA, dataHojeLocal: () => DIA, dataHoje: () => DIA,
    _compDataStr: v => String(v || '').slice(0, 10), escHtml: s => String(s == null ? '' : s), fmtD: d => String(d || '').split('-').reverse().join('/'),
    parseColabIds: r => (Array.isArray(r) ? r : (typeof r === 'string' ? JSON.parse(r || '[]') : [])), parseJsonField: (v, d) => (v == null ? d : v),
    colabMergePreservarInativos() {}, mergeEquipesDispFromFetch() {}, progMergeColaboradorIdsConfirmada: (a, b) => b.colaborador_ids,
    progCarregarVeiculos() {}, progCarregarPontoDoSupabase: (d, cb) => cb && cb(), progCarregarBadgesPonto() {},
    _progSalvarCacheDia() {}, _progRestaurarCacheDia: () => !!ctx._temCacheDia, progAplicarPersistentes() {},
    _progLS: { carregarStatus: () => ctx._lsDia || null, salvarStatus() {} },
    progFetchVeiculosDia: () => Promise.resolve([]), progLimparVeiculosDia() {}, progPersistVeiculosLocal() {}, progVeiculoKey: () => 'k', progVeiculoKeyB: () => 'kb',
    progSalvarPersistente() {}, progRemoverPersistente() {},
    // pontos de chegada dos caminhos de escala/programação (provam que a trava deixou passar)
    _podeAlterarComposicao: marca('_podeAlterarComposicao'), equipeEstaEmFolga: (...a) => { marca('equipeEstaEmFolga')(); return true; },
    progGetCont: (...a) => { marca('progGetCont')(); return 'cX'; }, progFindCompDia: marca('progFindCompDia'),
    progBuscarEscalaTMAData: (...a) => { marca('progBuscarEscalaTMAData')(); return Promise.reject(new Error('fim do teste')); },
    progValidarComposicao: () => [], progConfirmarEscalarTurnoDiferente: (c, e, cb) => cb(), _calDados: {}, CAL_CORES_2026: {},
    closeModal() {}, setModal() {}, confirm: () => true, progFmtDataBR: d => d,
    // empréstimo entre contratos (A) e Programação de Projetos (C)
    renderProgram() {}, sbUpdate: () => Promise.resolve(true), sbInsert: () => Promise.resolve([]),
    _pp: { statusData: null }, progProjGetData: () => ctx._diaPP || DIA, progProjGetCid: () => 'cPP', ppOpsInvalidar() {}, ppFilaInvalidar() {},
    progProjetoCoreMergeComposicaoRefresh() {}, progProjSalvarStatus() {}, progProjRenderQuadro() {}, _pontoCacheTemDia: () => true,
    parseColabIdsSlots: (v, n) => { const a = ctx.parseColabIds(v).slice(); while (a.length < n) a.push(null); return a; },
    ppVinculadosDisponiveisEq: (...a) => { marca('ppVinculadosDisponiveisEq')(); return []; }, progMinColaboradoresEquipe: () => 2,
    progProjetoCoreFindEquipe: marca('progProjetoCoreFindEquipe'),
  });
  ctx.cenaAuthAuthorizedFetch = banco.authFetch;
  vm.createContext(ctx);
  const nomes = ['isUUID', 'sbFetch', 'progDataRetornoStr', 'progRetornoAindaFora', 'progRetornoExpirouNoDia', 'progFiltrosStatusPersistentes', 'progExpirarPersistenteLinha',
    'progAplicarStatusDoBanco', 'progAtualizarQuadro', 'progCarregarStatus', 'progEfetuarDrop', 'progEfetuarDropInterno', 'progSalvarEquipe', 'progSalvarTodas', 'progMobileProgramar',
    'escalasModeloAplicar', 'progIniciarAutoEscalaRef', 'progEfetuarEmprestimo', 'progEfetuarEmprestimoInterno',
    'progProjCarregarStatus', 'progProjStatusEhDoDia', 'progProjCarregarStatusDia', 'progProjCarregarStatusBanco', 'progProjAtualizarQuadro',
    'progProjetoCoreEfetuarDrop', 'ppAutoEscalarEquipe', 'progProjetoCoreSalvarEquipe'];
  const novos = ['progBuscarStatusPersistentes', 'progStatusComPrazo', 'progStatusLerDia', 'progStatusLeituraMarcar', 'progStatusLeituraEstado', 'progStatusLeituraAviso', 'progStatusBloqueiaEscala',
    'ppStatusVerificado', 'ppStatusBloqueiaEscala']
    .filter(n => new RegExp('\\nfunction ' + n + '\\(').test(src));
  vm.runInContext(['var PROG_STATUS = {};', 'var BLOQ_STATUS = ["falta","ferias","afastado","treinamento","demitido","inapto"];', varDe(src, 'PROG_STATUS_PERSISTENTES')].concat(nomes.concat(novos).map(n => fnDe(src, n))).join('\n'), ctx);
  return ctx;
}
const indisponiveis = ctx => Object.keys(INDISP).filter(c => ctx._progStatus[c] === INDISP[c]);
const aviso = ctx => ctx.el['prog-status-incompleto'] || null;
const ult = ctx => ctx.toasts[ctx.toasts.length - 1] || { m: '', erro: false };
async function atualizar(ctx, ms) { ctx.progAtualizarQuadro(); await espera(ms || 40); }
// Todas as travas de escala/programação: true se TODAS bloquearam (nenhum ponto de chegada alcançado)
function tentarEscalar(ctx, dia) {
  dia = dia || DIA;
  ctx.chamou = {};
  ctx.composicao_dia = [{ id: 'cmp1', equipe_id: 'e1', data: dia, colaborador_ids: [LIVRE], deleted_at: null }];
  ctx.progEfetuarDrop(FERIAS, null, 'e1', 1, false);            // Disponíveis → equipe (arrastar / buscar / celular)
  const drop = !!ctx.chamou._podeAlterarComposicao;
  ctx.chamou = {};
  ctx.progEfetuarDropInterno(LIVRE, 'e1', 'e2', 0, false, dia);  // mover quem já está escalado no dia
  const mover = !!ctx.chamou._podeAlterarComposicao;
  ctx.chamou = {};
  ctx.progSalvarEquipe('e1'); ctx.progSalvarTodas(); ctx.progMobileProgramar('e1');
  const nToasts = ctx.toasts.length;
  ctx._modelos = {}; ctx.escalasModeloAplicar(dia, 'azul');
  const modelo = ctx.toasts.slice(nToasts).some(t => /Modelo azul está vazio/.test(t.m));
  ctx.progIniciarAutoEscalaRef('2026-10-22', dia, { turno: 'Manha', tipoId: 't1' });
  const c = ctx.chamou;
  return { drop, mover, salvarEquipe: !!c.equipeEstaEmFolga, salvarTodas: !!c.progGetCont, mobile: !!c.progFindCompDia,
    modelo, auto: !!c.progBuscarEscalaTMAData };
}
const nadaPassou = r => !r.drop && !r.salvarEquipe && !r.salvarTodas && !r.mobile && !r.modelo && !r.auto;
const tudoPassou = r => r.drop && r.salvarEquipe && r.salvarTodas && r.mobile && r.modelo && r.auto;

(async () => {
  // ═══ 0. Defeito na main (8.1.225): Atualizar com falha mostra férias/afastado/inapto/demitido como disponíveis ═══
  if (!base) ok('commit base 732987e disponível', false);
  else {
    const banco = montarBanco();
    const ctx = criarCtx(base, banco);
    ctx._progStatus = Object.assign({}, INDISP);
    banco.regra = r => (r.tabela === 'prog_status_diario' && /status=in\./.test(r.url) ? 'erro500' : 'ok');
    await atualizar(ctx);
    ok('main: Atualizar com falha apaga os indisponíveis (aparecem como disponíveis)', indisponiveis(ctx).length === 0, ctx._progStatus);
  }

  // ═══ 1. Carga boa: conjunto confiável ═══
  const banco = montarBanco();
  const ctx = criarCtx(html, banco);
  await atualizar(ctx);
  ok('carga completa: férias, afastado, inapto e demitido antigos aparecem (além de 3.000 linhas)', indisponiveis(ctx).length === 4, ctx._progStatus);
  ok('carga completa: falta do dia aparece', ctx._progStatus[FALTA] === 'falta');
  ok('carga completa: leitura marcada como completa e sem aviso', ctx.progStatusLeituraEstado(DIA) === 'ok' && !aviso(ctx));
  ok('carga completa: escala e programação liberadas', tudoPassou(tentarEscalar(ctx)), tentarEscalar(ctx));

  // ═══ 2. Falhas no Atualizar: primeira página · intermediária · última · prazo · inesperada · HTML · status do dia ═══
  const CASOS = [
    ['falha na primeira página', b => falhaNaPagina(b, 0, 'erro500')],
    ['falha em página intermediária (offset 1000)', b => falhaNaPagina(b, 1000, 'rede')],
    ['falha na última página (offset 3000)', b => falhaNaPagina(b, 3000, 'erro500')],
    ['prazo esgotado (timeout) numa página', b => falhaNaPagina(b, 2000, 'timeout')],
    ['resposta inesperada (objeto em vez de lista)', b => falhaNaPagina(b, 1000, 'inesperada')],
    ['resposta parcial: HTML de proxy no meio da paginação', b => falhaNaPagina(b, 2000, 'html')],
    ['resposta parcial: status do dia falha, persistentes chegam', b => { b.regra = r => (r.tabela === 'prog_status_diario' && /data=eq\./.test(r.url) && !/status=in\./.test(r.url) ? 'erro500' : 'ok'); }],
  ];
  for (const [nome, falhar] of CASOS) {
    const b = montarBanco();
    const c = criarCtx(html, b);
    await atualizar(c);                                    // conjunto confiável
    c._progStatus[LOCAL] = 'patio'; c._progStatusInfo[LOCAL] = { obs: 'alteração local ainda não salva' };
    c.window._progStatusPendentes = { [DIA]: { [LOCAL]: true } };
    falhar(b);
    await atualizar(c, /timeout/.test(nome) ? 250 : 40);
    ok('[' + nome + '] férias, afastado, inapto e demitido continuam indisponíveis', indisponiveis(c).length === 4, c._progStatus);
    ok('[' + nome + '] nenhum indisponível vira disponível (falta do dia mantida)', c._progStatus[FALTA] === 'falta');
    ok('[' + nome + '] alteração local preservada (status, observação e pendência)', c._progStatus[LOCAL] === 'patio' && c._progStatusInfo[LOCAL].obs === 'alteração local ainda não salva' && c.window._progStatusPendentes[DIA][LOCAL] === true);
    ok('[' + nome + '] leitura marcada como incompleta', c.progStatusLeituraEstado(DIA) === 'incompleta');
    ok('[' + nome + '] aviso fixo no cabeçalho com nova tentativa', !!aviso(c) && /não foram carregados por completo/.test(aviso(c).innerHTML) && /onclick="progAtualizarQuadro\(\)"/.test(aviso(c).innerHTML), aviso(c));
    ok('[' + nome + '] mensagem de erro (não "Quadro atualizado")', ult(c).erro && !c.toasts.slice(-1).some(t => /Quadro atualizado/.test(t.m)), ult(c));
    const r = tentarEscalar(c);
    ok('[' + nome + '] escalar dos Disponíveis, Programar (3 caminhos), modelo e Auto Escalar bloqueados', nadaPassou(r), r);
    ok('[' + nome + '] mover quem já está escalado continua permitido', r.mover);
    ok('[' + nome + '] o bloqueio explica o motivo', c.toasts.some(t => /Não é possível escalar: os status de 23\/10\/2026 não foram carregados por completo/.test(t.m)));
    // nova tentativa com o banco normal
    b.regra = () => 'ok';
    await atualizar(c);
    ok('[' + nome + '] nova leitura completa restaura a operação normal', c.progStatusLeituraEstado(DIA) === 'ok' && !aviso(c) && tudoPassou(tentarEscalar(c)));
    ok('[' + nome + '] após a recuperação os 4 indisponíveis seguem corretos', indisponiveis(c).length === 4);
  }

  // ═══ 3. Aba nova (sem conjunto confiável) com falha: nada é tratado como disponível verificado ═══
  {
    const b = montarBanco(); falhaNaPagina(b, 1000, 'erro500');
    const c = criarCtx(html, b);
    await atualizar(c);
    ok('aba nova com falha: leitura incompleta, aviso e escala bloqueada', c.progStatusLeituraEstado(DIA) === 'incompleta' && !!aviso(c) && nadaPassou(tentarEscalar(c)));
    ok('aba nova com falha: nenhuma lista parcial aplicada', Object.keys(c._progStatus).length === 0, c._progStatus);
    // painel: o título deixa de dizer "Disponíveis"
    ok('painel: sem leitura verificada o título é "Disponibilidade NÃO verificada"', /\['ok','carregando'\]\.indexOf\(progStatusLeituraEstado\(dataNorm\)\)<0\n\s*\? '[^\n]*Disponibilidade NÃO verificada/.test(fnDe(html, 'progRenderPainelDisp')));
    b.regra = () => 'ok';
    await atualizar(c);
    ok('aba nova: recuperação aplica os 4 indisponíveis e libera', indisponiveis(c).length === 4 && tudoPassou(tentarEscalar(c)));
  }

  // ═══ 4. Durante a leitura (carregando) a escala espera ═══
  {
    const b = montarBanco(); falhaNaPagina(b, 1000, 'timeout');
    const c = criarCtx(html, b);
    c.progAtualizarQuadro(); await espera(10);
    ok('carregando: escala e programação aguardam a leitura', c.progStatusLeituraEstado(DIA) === 'carregando' && nadaPassou(tentarEscalar(c)) && c.toasts.some(t => /ainda estão carregando/.test(t.m)));
    await espera(200);
    ok('carregando → prazo esgotado: vira incompleta (não fica travado em "carregando")', c.progStatusLeituraEstado(DIA) === 'incompleta');
  }

  // ═══ 5. Abrir o dia (progCarregarStatus): os dois caminhos ═══
  {
    // 5a. sem cache em memória: localStorage + banco
    const b = montarBanco(); falhaNaPagina(b, 2000, 'erro500');
    const c = criarCtx(html, b);
    c._lsDia = { status: Object.assign({}, INDISP, { [LOCAL]: 'patio' }), info: {} };
    c.progCarregarStatus(DIA); await espera(40);
    ok('abrir o dia com falha: memória local mantida (não troca por parcial)', indisponiveis(c).length === 4 && c._progStatus[LOCAL] === 'patio', c._progStatus);
    ok('abrir o dia com falha: leitura incompleta, aviso e escala bloqueada', c.progStatusLeituraEstado(DIA) === 'incompleta' && !!aviso(c) && nadaPassou(tentarEscalar(c)));
    ok('abrir o dia com falha: não marca o dia como carregado (nova tentativa refaz a leitura)', c._progStatusDateCache !== DIA);
    b.regra = () => 'ok';
    c.progCarregarStatus(DIA); await espera(40);
    ok('abrir o dia: nova leitura completa libera', c.progStatusLeituraEstado(DIA) === 'ok' && !aviso(c) && indisponiveis(c).length === 4);
    // 5b. com cache em memória do dia (busca em segundo plano)
    const b2 = montarBanco(); falhaNaPagina(b2, 0, 'rede');
    const c2 = criarCtx(html, b2);
    c2._temCacheDia = true; c2._progStatus = Object.assign({}, INDISP); c2._progStatusDateCache = null;
    c2.progCarregarStatus(DIA); await espera(40);
    ok('cache do dia + falha em segundo plano: mantém o cache e marca incompleta', indisponiveis(c2).length === 4 && c2.progStatusLeituraEstado(DIA) === 'incompleta' && !!aviso(c2));
    // 5c. falha também na leitura dos veículos (rejeição): não fica preso em "carregando"
    const b3 = montarBanco();
    const c3 = criarCtx(html, b3); c3.progFetchVeiculosDia = () => Promise.reject(new Error('x'));
    c3.progCarregarStatus(DIA); await espera(40);
    ok('erro inesperado na carga do dia: incompleta (nunca fica "carregando")', c3.progStatusLeituraEstado(DIA) === 'incompleta');
  }

  // ═══ 6. Aviso acompanha o dia da tela ═══
  {
    const b = montarBanco(); falhaNaPagina(b, 1000, 'erro500');
    const c = criarCtx(html, b);
    await atualizar(c);
    c.progStatusLeituraAviso('2026-10-24');
    ok('outro dia na tela (nunca lido): o aviso é de "ainda não lidos", não o da falha do dia 23', !!aviso(c) && /ainda não foram lidos/.test(aviso(c).innerHTML) && !/não foram carregados por completo/.test(aviso(c).innerHTML));
    c.progStatusLeituraAviso(DIA);
    ok('volta ao dia 23: o aviso da falha reaparece', !!aviso(c) && /não foram carregados por completo/.test(aviso(c).innerHTML));
    b.regra = () => 'ok'; await atualizar(c);
    ok('dia 23 lido por completo: sem aviso', !aviso(c));
  }

  // Versão anterior às correções A/B/C (para reproduzir os 3 desvios)
  let antes = null;
  try { antes = norm(execSync('git show 373de1e:index.html', { cwd: raiz, maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8')); } catch (e) { antes = null; }
  if (!antes) ok('commit 373de1e disponível', false);
  const OUTRO = id(99);
  const emprestar = async (c, colab) => {
    c.composicao_dia = [{ id: 'cmp1', equipe_id: 'e1', data: DIA, colaborador_ids: [LIVRE], deleted_at: null }];
    c.progEfetuarEmprestimo(colab, 'e1', 1); await espera(10);
    return c.composicao_dia[0].colaborador_ids.indexOf(colab) >= 0;
  };

  // ═══ A. Empréstimo entre contratos ═══
  for (const [nome, prep] of [['leitura incompleta', b => falhaNaPagina(b, 1000, 'erro500')], ['prazo esgotado (timeout)', b => falhaNaPagina(b, 2000, 'timeout')]]) {
    if (antes) {
      const b = montarBanco(); prep(b); const c = criarCtx(antes, b);
      await atualizar(c, 250); c.colaboradores.push({ id: OUTRO, nome: 'OUTRO CONTRATO', ativo: true, contrato_id: 'cY' });
      ok('A (antes, 373de1e) [' + nome + ']: empréstimo de outro contrato passava sem trava (defeito reproduzido)', await emprestar(c, OUTRO));
    }
    const b = montarBanco(); prep(b); const c = criarCtx(html, b);
    await atualizar(c, 250); c.colaboradores.push({ id: OUTRO, nome: 'OUTRO CONTRATO', ativo: true, contrato_id: 'cY' });
    ok('A [' + nome + ']: empréstimo de outro contrato bloqueado', !(await emprestar(c, OUTRO)) && /Não é possível emprestar colaborador/.test(ult(c).m), ult(c).m);
    b.regra = () => 'ok'; await atualizar(c);
    ok('A [' + nome + ']: após leitura completa o empréstimo volta a funcionar', await emprestar(c, OUTRO));
  }
  {
    const b = montarBanco(); const c = criarCtx(html, b);
    ok('A: dia nunca lido — empréstimo bloqueado', !(await emprestar(c, OUTRO)) && /ainda não foram lidos/.test(ult(c).m), ult(c).m);
    await atualizar(c);
    ok('A: com leitura completa a regra de empréstimo existente não mudou (ainda empresta quem está de férias — proposta separada)', await emprestar(c, FERIAS) && c._progStatus[FERIAS] === 'ferias');
  }

  // ═══ B. Troca de dia dentro dos 5 s · dia nunca lido · memória trocada por outro módulo ═══
  const D24 = '2026-10-24';
  if (antes) {
    const b = montarBanco(); const c = criarCtx(antes, b);
    await atualizar(c);
    c.window._progStatusUltimoSave = Date.now(); c._diaTela = D24; c._progData = D24;
    const g = b.gets; c.progCarregarStatus(D24); await espera(40);
    ok('B (antes, 373de1e): troca de dia em < 5 s não lia o dia novo e liberava escala com a memória do dia 23 (defeito reproduzido)', b.gets === g && c._progStatus[FALTA] === 'falta' && tudoPassou(tentarEscalar(c, D24)));
  }
  {
    const b = montarBanco(); const c = criarCtx(html, b);
    await atualizar(c);
    c.window._progStatusUltimoSave = Date.now(); c._diaTela = D24; c._progData = D24;
    const g = b.gets; c.progCarregarStatus(D24);
    ok('B: troca de dia em < 5 s — durante a leitura do dia novo a escala espera', c.progStatusLeituraEstado(D24) === 'carregando' && nadaPassou(tentarEscalar(c, D24)));
    await espera(40);
    ok('B: troca de dia em < 5 s lê o dia novo e só então libera', b.gets > g && c.progStatusLeituraEstado(D24) === 'ok' && tudoPassou(tentarEscalar(c, D24)), tentarEscalar(c, D24));
    ok('B: a memória do dia 24 não traz a falta do dia 23', c._progStatus[FALTA] !== 'falta');
    // mesmo dia, já verificado, dentro dos 5 s: a otimização continua valendo (não relê)
    c.window._progStatusUltimoSave = Date.now();
    const g2 = b.gets; c.progCarregarStatus(D24); await espera(40);
    ok('B: mesmo dia verificado dentro dos 5 s — reaproveita sem reler', b.gets === g2 && c.progStatusLeituraEstado(D24) === 'ok');
    // falha no dia novo dentro dos 5 s
    c.window._progStatusUltimoSave = Date.now(); c._diaTela = '2026-10-25'; c._progData = '2026-10-25'; c._progStatusDateCache = null;
    falhaNaPagina(b, 1000, 'erro500'); c.progCarregarStatus('2026-10-25'); await espera(40);
    ok('B: troca de dia em < 5 s com falha — incompleta e bloqueada', c.progStatusLeituraEstado('2026-10-25') === 'incompleta' && nadaPassou(tentarEscalar(c, '2026-10-25')));
    b.regra = () => 'ok';
  }
  {
    const b = montarBanco(); const c = criarCtx(html, b);
    ok('B: dia nunca carregado — estado "não lido", escala e programação bloqueadas', c.progStatusLeituraEstado(DIA) === '' && nadaPassou(tentarEscalar(c)) && c.toasts.some(t => /ainda não foram lidos/.test(t.m)));
    c.progStatusLeituraAviso(DIA);
    ok('B: dia nunca carregado — aviso fixo "ainda não foram lidos" com Atualizar', !!aviso(c) && /ainda não foram lidos/.test(aviso(c).innerHTML) && /progAtualizarQuadro\(\)/.test(aviso(c).innerHTML));
    await atualizar(c);
    ok('B: dia lido — estado separado por data (23 ok, 24 não lido)', c.progStatusLeituraEstado(DIA) === 'ok' && c.progStatusLeituraEstado(D24) === '');
    // outro módulo (Programação de Projetos) troca a memória compartilhada: o TMA deixa de considerar o dia verificado
    c.progAplicarStatusDoBanco([], [], D24);
    ok('B: memória trocada por outro módulo — o dia 23 deixa de contar como verificado', c.progStatusLeituraEstado(DIA) === '' && nadaPassou(tentarEscalar(c)));
    await atualizar(c);
    ok('B: nova leitura do dia 23 restaura', c.progStatusLeituraEstado(DIA) === 'ok' && indisponiveis(c).length === 4);
  }

  // ═══ C. Programação de Projetos ═══
  const tentarPP = c => {
    c.chamou = {};
    c.composicao_dia = [{ id: 'cpp1', equipe_id: 'p1', data: DIA, colaborador_ids: JSON.stringify([LIVRE, null, null]), deleted_at: null, confirmada: false }];
    c.progFindCompDia = (e, d) => c.composicao_dia.find(x => x.equipe_id === e && x.data === d) || null;
    c.progProjetoCoreEfetuarDrop(FERIAS, null, 'p1', 1, false);                 // dos Disponíveis para o slot (inclusão/substituição)
    const drop = c.parseColabIds(c.composicao_dia[0].colaborador_ids).indexOf(FERIAS) >= 0;
    c.progProjetoCoreEfetuarDrop(LIVRE, 'p1', 'p1', 2, false);                  // mover quem já está escalado
    const mover = c.parseColabIds(c.composicao_dia[0].colaborador_ids)[2] === LIVRE;
    c.composicao_dia = [];
    c.ppAutoEscalarEquipe('p2'); c.progProjetoCoreSalvarEquipe('p1');
    return { drop, mover, auto: !!c.chamou.ppVinculadosDisponiveisEq, salvar: !!c.chamou.progProjetoCoreFindEquipe };
  };
  const ppNada = r => !r.drop && !r.auto && !r.salvar, ppTudo = r => r.drop && r.auto && r.salvar;
  const carregarPP = async (c, forcar) => { c.progProjCarregarStatusDia(DIA, forcar !== false); await espera(80); };
  if (antes) {
    const b = montarBanco(); const c = criarCtx(antes, b);
    await carregarPP(c); falhaNaPagina(b, 1000, 'erro500'); await carregarPP(c);
    const r = tentarPP(c);
    ok('C (antes, 373de1e): PP com leitura incompleta apagava a lista e permitia escalar/Auto Escalar/Salvar (defeito reproduzido)', indisponiveis(c).length === 0 && ppTudo(r), r);
  }
  for (const [nome, prep, ms] of [['falha de paginação (offset 2000)', b => falhaNaPagina(b, 2000, 'erro500'), 80], ['prazo esgotado (timeout)', b => falhaNaPagina(b, 1000, 'timeout'), 250]]) {
    const b = montarBanco(); const c = criarCtx(html, b);
    await carregarPP(c);
    ok('C [' + nome + ']: carga completa da PP libera escala', c.ppStatusVerificado(DIA) && indisponiveis(c).length === 4 && ppTudo(tentarPP(c)));
    c._progStatus[LOCAL] = 'patio';                                           // alteração local ainda não gravada
    prep(b); c.progProjCarregarStatusDia(DIA, true);
    ok('C [' + nome + ']: durante a leitura a escala da PP espera', !c.ppStatusVerificado(DIA) && ppNada(tentarPP(c)));
    await espera(ms);
    ok('C [' + nome + ']: falha mantém os dados válidos anteriores (4 indisponíveis) e a alteração local', indisponiveis(c).length === 4 && c._progStatus[LOCAL] === 'patio', c._progStatus);
    ok('C [' + nome + ']: falha marca leitura incompleta (não "atualizado")', c._pp.statusFalhou === DIA && !c.ppStatusVerificado(DIA));
    const r = tentarPP(c);
    ok('C [' + nome + ']: escalar dos Disponíveis, Auto Escalar e Salvar bloqueados; mover escalado permitido', ppNada(r) && r.mover, r);
    ok('C [' + nome + ']: mensagem explica o bloqueio', c.toasts.some(t => /Não é possível (escalar|usar o Auto Escalar|programar a equipe): férias, afastamentos, inaptos e demitidos/.test(t.m)));
    b.regra = () => 'ok'; await carregarPP(c);
    ok('C [' + nome + ']: nova leitura completa recupera', c.ppStatusVerificado(DIA) && c._pp.statusFalhou === null && ppTudo(tentarPP(c)));
  }
  {
    // Atualizar da PP (progProjAtualizarQuadro) com falha e recuperação
    const b = montarBanco(); const c = criarCtx(html, b);
    await carregarPP(c);
    falhaNaPagina(b, 3000, 'erro500'); c.progProjAtualizarQuadro(); await espera(80);
    ok('C: Atualizar da PP com falha mantém os 4 indisponíveis, marca incompleta e bloqueia', indisponiveis(c).length === 4 && c._pp.statusFalhou === DIA && ppNada(tentarPP(c)));
    ok('C: Atualizar da PP com falha avisa (não "Quadro atualizado")', ult(c).erro && !/Quadro atualizado/.test(ult(c).m));
    b.regra = () => 'ok'; c.progProjAtualizarQuadro(); await espera(80);
    ok('C: Atualizar da PP com sucesso recupera', c.ppStatusVerificado(DIA) && ppTudo(tentarPP(c)));
    // outro dia na PP: não reaproveita a memória do dia 23
    c._diaPP = D24; c.progProjCarregarStatusDia(D24, false);
    ok('C: troca de dia na PP — memória do dia anterior não é reaproveitada e a escala espera', c._progStatus[FALTA] !== 'falta' && !c.ppStatusVerificado(D24));
    await espera(80); c._diaPP = DIA;
    // PP nunca carregada
    const c2 = criarCtx(html, montarBanco());
    ok('C: PP com dia nunca carregado — escala bloqueada', ppNada(tentarPP(c2)));
    // escala previamente programada continua consultável e não é alterada pela falha
    const b3 = montarBanco(); const c3 = criarCtx(html, b3); await carregarPP(c3);
    const prog = { id: 'cpp9', equipe_id: 'p9', data: DIA, colaborador_ids: JSON.stringify([LIVRE, FALTA]), deleted_at: null, confirmada: true };
    c3.composicao_dia = [prog]; falhaNaPagina(b3, 1000, 'erro500'); c3.progProjAtualizarQuadro(); await espera(80);
    ok('C/TMA: escala já programada não é alterada nem desprogramada pela falha de leitura', c3.composicao_dia[0] === prog && prog.confirmada === true && prog.colaborador_ids === JSON.stringify([LIVRE, FALTA]));
  }
  {
    // TMA: escala previamente programada não muda com a falha
    const b = montarBanco(); const c = criarCtx(html, b); await atualizar(c);
    const prog = { id: 'cmp9', equipe_id: 'e9', data: DIA, colaborador_ids: [LIVRE], deleted_at: null, confirmada: true };
    c.composicao_dia = [prog]; falhaNaPagina(b, 1000, 'erro500'); await atualizar(c);
    ok('TMA: escala já programada não é alterada nem desprogramada pela falha de leitura', c.composicao_dia[0] === prog && prog.confirmada === true && prog.colaborador_ids.join() === LIVRE);
  }

  // ═══ 7. Estático: caminhos de escala/programação do TMA e ES5 ═══
  const travadas = { progEfetuarDropInterno: "'escalar'", progSalvarEquipe: "'programar a equipe'", progSalvarTodas: "'programar as equipes'", progMobileProgramar: "'programar a equipe'",
    escalasModeloAplicar: "'implantar o modelo'", progIniciarAutoEscalaRef: "'usar o Auto Escalar'" };
  travadas.progEfetuarEmprestimoInterno = "'emprestar colaborador'";
  ok('todas as entradas ativas de escala/programação têm a trava', Object.keys(travadas).every(n => fnDe(html, n).indexOf('progStatusBloqueiaEscala(') >= 0 && fnDe(html, n).indexOf(travadas[n]) >= 0));
  const travadasPP = { progProjetoCoreEfetuarDrop: "'escalar'", ppAutoEscalarEquipe: "'usar o Auto Escalar'", progProjetoCoreSalvarEquipe: "'programar a equipe'" };
  ok('PP: todas as entradas ativas de escala/programação têm a trava da PP', Object.keys(travadasPP).every(n => fnDe(html, n).indexOf('ppStatusBloqueiaEscala(') >= 0 && fnDe(html, n).indexOf(travadasPP[n]) >= 0));
  ok('PP: buscar para o slot e arrastar passam pela trava (→ progProjetoCoreEfetuarDrop)', /ppEscolherParaSlot\(/.test(fnDe(html, 'progProjetoCoreBuscarParaSlot')) && /progProjetoCoreEfetuarDrop\(/.test(fnDe(html, 'progProjetoCoreEscolherParaSlot')) && /progProjetoCoreEfetuarDrop\(/.test(fnDe(html, 'progProjetoCoreDrop')));
  ok('empréstimo do slot (outro contrato) passa pela trava (progEfetuarEmprestimo → progEfetuarEmprestimoInterno)', /progEfetuarEmprestimo\(/.test(fnDe(html, 'progBuscarParaSlot')) && /progEfetuarEmprestimoInterno\(/.test(fnDe(html, 'progEfetuarEmprestimo')));
  ok('janela de 5 s só reaproveita dia verificado', /< 5000 && progStatusLeituraEstado\(data\)==='ok'\)/.test(fnDe(html, 'progCarregarStatus')));
  // Todos os caminhos que colocam alguém dos Disponíveis numa equipe passam por progEfetuarDropInterno
  ok('arrastar, buscar para o slot e celular passam pela trava (progEfetuarDrop → progEfetuarDropInterno)',
    ['progDrop', 'progBuscarParaSlot', 'progMobileEscalar'].every(n => /progEfetuarDrop\(/.test(fnDe(html, n))) && /progEfetuarDropInterno\(/.test(fnDe(html, 'progEfetuarDrop')));
  ok('Auto Escalar ativo: o modal chama progIniciarAutoEscalaRef (único caminho para progExecutarAutoEscalaRef)',
    /progIniciarAutoEscalaRef\(/.test(fnDe(html, 'progAbrirModalAutoEscalarRef')) && (html.match(/progExecutarAutoEscalaRef\(/g) || []).length === 2);
  ok('sem leitura de status do TMA fora da camada com prazo (Atualizar / abrir o dia)', ['progAtualizarQuadro', 'progCarregarStatus'].every(n => !/progBuscarStatusPersistentes\(/.test(fnDe(html, n)) && /progStatusLerDia\(data\)/.test(fnDe(html, n))));
  ok('Atualizar não zera a memória de status antes da leitura', !/_progStatus = \{\};/.test(fnDe(html, 'progAtualizarQuadro')));
  const NOVAS = ['progStatusLerDia', 'progStatusLeituraMarcar', 'progStatusLeituraEstado', 'progStatusLeituraAviso', 'progStatusBloqueiaEscala', 'progAtualizarQuadro', 'progCarregarStatus'];
  ok('ES5 nas funções novas/alteradas', !/\blet\s|\bconst\s|=>|`/.test(semComent(NOVAS.map(n => fnDe(html, n)).join('\n'))));
  ok('PP não usa a trava do TMA', !/progStatusBloqueiaEscala|progStatusLeitura/.test(['progProjCarregarStatusDia', 'progProjCarregarStatusBanco', 'progProjAtualizarQuadro', 'ppRenderPainelDisp', 'progProjetoCoreEfetuarDrop', 'progProjetoCoreSalvarEquipe'].map(n => fnDe(html, n)).join('\n')));

  if (falhas) { console.error('tma-status-leitura-incompleta: FALHOU ' + falhas + '/' + total); process.exit(1); }
  console.log('tma-status-leitura-incompleta: ' + total + ' verificações OK');
})().catch(e => { console.error(e); process.exit(1); });
