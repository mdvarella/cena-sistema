'use strict';
// Programação de Projetos — status pertence ao DIA da tela:
// (1) trocar/abrir a data zera a memória e recarrega do banco (não repete Faltou/Pátio/Observação do dia anterior);
// (2) a modal do painel é a da Programação de Projetos e grava SÓ o colaborador, NA DATA DA TELA, sem a gravação
//     em lote do TMA; "Disponível" com observação opcional; Fechar desfaz a seleção não salva;
// (3) Faltou pelo relógio de ponto: sem entrada depois do horário vira Faltou; entrada registrada tira do Faltou;
//     nunca em data futura; (4) TMA intacto (funções idênticas à main).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const raiz = path.join(__dirname, '..');
const norm = s => s.replace(/\r\n/g, '\n');
const html = norm(fs.readFileSync(path.join(raiz, 'index.html'), 'utf8'));
const BASE = process.env.PP_STATUS_BASE || '229fab8';
const htmlBase = norm(execFileSync('git', ['show', BASE + ':index.html'], { cwd: raiz, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
const failed = [];
let total = 0;
function ok(name, cond, detail) { total++; if (!cond) failed.push(name + (detail !== undefined ? ' — ' + JSON.stringify(detail).slice(0, 400) : '')); }
function fnEm(h, nome) {
  const m = new RegExp('\\n(?:async )?function ' + nome + '\\(').exec(h);
  if (!m) throw new Error('função não encontrada: ' + nome);
  const re = /\n(?:async function |function |var |\/\/ ═|\/\/ ──|\/\*\*)/g;
  re.lastIndex = m.index + 12;
  const f = re.exec(h);
  return h.slice(m.index + 1, f ? f.index : undefined);
}
const fn = n => fnEm(html, n);
const varEm = (h, nome) => { const m = new RegExp('\\nvar ' + nome + '\\s*=[^;]*;').exec(h); if (!m) throw new Error('var ' + nome); return m[0].slice(1); };
const objEm = (h, nome) => { const i = h.indexOf('\nvar ' + nome + ' = {'); return h.slice(i + 1, h.indexOf('\n};', i) + 3); };
const semComent = s => s.replace(/\/\/[^\n]*/g, '');
const tick = () => new Promise(r => setImmediate(r));

// ── TMA intacto ─────────────────────────────────────────────────
const TMA = ['progMenuSlot', 'progSalvarMenuStatus', 'progSalvarStatus', 'progCarregarStatus', 'progSetStatusMenu', 'progSetStatus',
  'progAplicarStatusDoBanco', 'progGetData', 'progRenderPainelDisp', 'progLimparHistoricoFerias'];
// (a) A ENTREGA desta etapa (base → release 8.1.221) não alterou o TMA — commits fixos.
// (b) No arquivo atual, o TMA continua idêntico à base, exceto as 3 funções de gravação de status corrigidas
//     depois pelo próprio TMA (observação que sumia após Atualizar) — cobertas em tma-status-observacao.test.js.
const REL_PP_STATUS = process.env.PP_STATUS_RELEASE || 'c654452';
const htmlRelPP = norm(execFileSync('git', ['show', REL_PP_STATUS + ':index.html'], { cwd: raiz, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
ok('TMA: commit da release 8.1.221 certo', /numero: '8\.1\.221'/.test(htmlRelPP));
const difEntrega = TMA.filter(n => fnEm(htmlBase, n) !== fnEm(htmlRelPP, n));
ok('TMA: a entrega 8.1.221 manteve as ' + TMA.length + ' funções idênticas à main (' + BASE + ')', difEntrega.length === 0, difEntrega);
// + progCarregarStatus/progAplicarStatusDoBanco: histórico de status persistentes (P1/P2, retorno não apaga o histórico)
// + progRenderPainelDisp: retorno automático pelo dia da tela (não por hoje) — homologação ponta a ponta 23/10/2026
const TMA_CORRIGIDAS_DEPOIS = ['progSalvarStatus', 'progSalvarMenuStatus', 'progSetStatus', 'progCarregarStatus', 'progAplicarStatusDoBanco', 'progRenderPainelDisp'];
const difTma = TMA.filter(n => TMA_CORRIGIDAS_DEPOIS.indexOf(n) < 0 && fnEm(htmlBase, n) !== fn(n));
ok('TMA: ' + (TMA.length - TMA_CORRIGIDAS_DEPOIS.length) + ' funções idênticas à main (' + BASE + ') no arquivo atual', difTma.length === 0, difTma);
ok('TMA: a modal do painel de Projetos não chama a gravação corrigida do TMA', !/progStatusGravarDia\(/.test(['ppDispChipLivreHtml', 'ppDispChipStatusHtml', 'ppRenderPainelDisp'].map(fn).join('\n')));
ok('TMA: PROG_STATUS_PERSISTENTES e PROG_STATUS iguais', varEm(htmlBase, 'PROG_STATUS_PERSISTENTES') === varEm(html, 'PROG_STATUS_PERSISTENTES')
  && objEm(htmlBase, 'PROG_STATUS') === objEm(html, 'PROG_STATUS'));

// ── Estáticos (Programação de Projetos) ────────────────────────
const ppFuncs = [...html.matchAll(/\nfunction ((?:pp|_?progProj|progProjetoCore)\w*)\(/g)].map(m => m[1]);
const chamaLote = ppFuncs.filter(n => /\bprogSalvarStatus\(\)/.test(semComent(fn(n))));
ok('nenhuma função da Programação de Projetos chama a gravação em lote do TMA', chamaLote.length === 0, chamaLote);
const chamaModalTma = ppFuncs.filter(n => /\bprogMenuSlot\(/.test(fn(n)));
ok('painel da Programação de Projetos não abre a modal do TMA', chamaModalTma.length === 0, chamaModalTma);
ok('chips do painel abrem a modal da Programação de Projetos (ppMenuSlot)', /ppMenuSlot\(/.test(fn('ppDispChipLivreHtml'))
  && /ppMenuSlot\(/.test(fn('ppDispChipStatusHtml')) && /ppMenuSlot\(/.test(fn('ppRenderPainelDisp')));
ok('Programação de Projetos não lê nem grava status no navegador', !/localStorage/.test(fn('progProjCarregarStatus') + fn('progProjSalvarStatus') + fn('progProjCarregarStatusDia')));
ok('ES5 nas funções alteradas', !/\blet\s|\bconst\s|=>|`/.test(semComent(['progProjCarregarStatus', 'progProjCarregarStatusDia', 'progProjCarregarStatusBanco',
  'progProjetoCoreSalvarMenuStatus', 'ppFecharMenuStatus', 'ppDispStatusColab', 'ppDispFaltaPeloPonto', 'progProjetoCoreMenuSlot',
  'progProjetoCoreSetStatusMenu', 'ppDefinirStatus', 'progProjetoCoreRetirarDaEquipe'].map(fn).join('\n'))));
const upsertNomeConstraint = ppFuncs.filter(n => /prog_status_diario_colaborador_id_data_key/.test(fn(n)));
ok('Programação de Projetos: on_conflict por colunas (colaborador_id,data), não pelo nome da constraint (PostgREST recusa 42703)',
  upsertNomeConstraint.length === 0 && /sbUpsert\('prog_status_diario', linha, 'colaborador_id,data'\)/.test(fn('progProjetoCoreSalvarMenuStatus')), upsertNomeConstraint);
ok('Disponível não apaga mais o histórico de férias/afastamento de outros dias', !/sbDelete\('prog_status_diario'/.test(fn('ppDefinirStatus')));

// ── vm: carregamento por data ───────────────────────────────────
const CARGA = ['progDataRetornoStr', 'progRetornoAindaFora', 'progRetornoExpirouNoDia', 'progFiltrosStatusPersistentes', 'progExpirarPersistenteLinha',
  'progRemoverPersistente', 'progSalvarPersistente', 'progAplicarStatusDoBanco', 'progProjCarregarStatus', 'progProjStatusEhDoDia', 'progProjCarregarStatusDia',
  'progProjCarregarStatusBanco', 'progProjSalvarStatus'];
function ctxCarga(cfg) {
  const log = { fetch: [], renders: 0, ponto: [], ls: 0 };
  const ctx = {
    console: { log() {}, warn() {}, error() {} }, Date, JSON, Object, Array, String, Number, Math, Promise,
    DEMO: false, window: {}, _pp: { statusData: cfg.statusData },
    _progStatus: Object.assign({}, cfg.memoria || {}), _progStatusInfo: {},
    // conta só as chaves de status POR DIA (pp_status_*, pp_statusinfo_*, prog_status_*); prog_persistentes é do TMA
    localStorage: {
      getItem(k) { if (/^(pp_status|pp_statusinfo|prog_status)_/.test(k)) log.ls++; return /^(pp_status|prog_status)_/.test(k) ? JSON.stringify({ x1: 'falta' }) : null; },
      setItem(k) { if (/^(pp_status|pp_statusinfo|prog_status)_/.test(k)) log.ls++; }
    },
    dataHojeLocal: () => '2026-10-14',
    sbFetch: (t, o) => { log.fetch.push((o.filters || []).join('&')); return cfg.sbFetch ? cfg.sbFetch(o) : Promise.resolve([]); },
    sbDelete: () => Promise.resolve(true),
    progProjRenderQuadro: () => { log.renders++; },
    progCarregarPontoDoSupabase: (d, cb) => { log.ponto.push(d); if (cb) cb(); },
    _pontoCacheTemDia: () => false
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(varEm(html, 'PROG_STATUS_PERSISTENTES') + '\n' + CARGA.map(fn).join('\n'), ctx);
  return { ctx, log };
}

(async () => {
  // 14/10 na memória (Faltou e Pátio); tela vai para 15/10, onde o banco só tem um afastado persistente
  let { ctx, log } = ctxCarga({
    statusData: '2026-10-14', memoria: { x1: 'falta', x2: 'patio', x3: 'observacao' },
    sbFetch: o => Promise.resolve(o.filters[0] === 'data=eq.2026-10-15' ? []
      : [{ id: 'r1', colaborador_id: 'af1', data: '2026-10-10', status: 'afastado', data_retorno: '2026-10-20' }])
  });
  ctx.progProjCarregarStatusDia('2026-10-15');
  ok('ao trocar de data a memória do dia anterior é zerada na hora', Object.keys(ctx._progStatus).length === 0 && ctx._pp.statusData === '2026-10-15');
  await tick(); await tick();
  ok('15/10: só o afastado persistente; Faltou/Pátio/Observação do dia 14 não repetem',
    JSON.stringify(ctx._progStatus) === JSON.stringify({ af1: 'afastado' }), ctx._progStatus);
  ok('carga lê o dia e os persistentes do banco e redesenha', log.fetch.length === 2 && log.fetch[0].includes('data=eq.2026-10-15') && log.renders >= 1);
  ok('não lê nem grava status do dia no navegador (pp_status_*/prog_status_*)', log.ls === 0, log.ls);
  ok('data futura não busca ponto', log.ponto.length === 0);

  // TMA troca a memória (objeto novo, status do dia 14) e o usuário volta à Programação de Projetos no dia 15
  const memAntes = ctx._progStatus;
  ok('memória carregada pela tela é reconhecida como do dia', ctx.progProjStatusEhDoDia('2026-10-15') === true);
  ctx._progStatus = { x1: 'falta', x2: 'patio' };   // o que progCarregarStatus/progAplicarStatusDoBanco do TMA fazem
  ok('memória trocada pelo TMA não é mais "do dia" (mesmo com a data igual)', ctx._pp.statusData === '2026-10-15' && ctx.progProjStatusEhDoDia('2026-10-15') === false);
  const nFetch = log.fetch.length;
  ctx.progProjCarregarStatusDia('2026-10-15');
  await tick(); await tick();
  ok('ao voltar do TMA recarrega o dia 15 do banco (não mostra Faltou/Pátio do 14)', log.fetch.length === nFetch + 2
    && JSON.stringify(ctx._progStatus) === JSON.stringify({ af1: 'afastado' }) && ctx._progStatus !== memAntes, ctx._progStatus);
  ok('render recarrega quando a memória não é do dia', /if\(!progProjStatusEhDoDia\(data\)\) progProjCarregarStatusDia\(data, true\);/.test(fn('progProjRenderQuadro')));

  ({ ctx, log } = ctxCarga({ statusData: '2026-10-15', memoria: { k: 'patio' } }));
  ctx._pp.statusRef = ctx._progStatus;
  ctx.progProjCarregarStatusDia('2026-10-15');
  ok('mesma data e mesma memória: não recarrega à toa', log.fetch.length === 0 && ctx._progStatus.k === 'patio');
  ctx.progProjCarregarStatusDia('2026-10-14');
  await tick(); await tick();
  ok('hoje/passado: carrega o ponto do dia (Faltou automático)', JSON.stringify(log.ponto) === '["2026-10-14"]');

  // resposta atrasada de outra data não sobrescreve
  let soltar15;
  ({ ctx, log } = ctxCarga({
    statusData: '2026-10-13',
    sbFetch: o => o.filters[0] === 'data=eq.2026-10-15'
      ? new Promise(r => { soltar15 = () => r([{ colaborador_id: 'v15', data: '2026-10-15', status: 'patio' }]); })
      : Promise.resolve(o.filters[0] === 'data=eq.2026-10-16' ? [{ colaborador_id: 'v16', data: '2026-10-16', status: 'folga' }] : [])
  }));
  ctx.progProjCarregarStatusDia('2026-10-15');
  ctx.progProjCarregarStatusDia('2026-10-16');
  await tick(); await tick();
  soltar15(); await tick(); await tick();
  ok('resposta atrasada da data anterior é ignorada', JSON.stringify(ctx._progStatus) === JSON.stringify({ v16: 'folga' }) && ctx._pp.statusData === '2026-10-16', ctx._progStatus);

  // ── vm: Faltou pelo ponto ─────────────────────────────────────
  const PONTO = ['_pontoHoraParaMin', '_pontoExtrairHorarios', '_pontoTemEntrada', '_pontoDeveMostrarAusente', 'pontoHorarioPassou',
    'ppDispPonto', 'ppDispStatusColab', 'ppDispFaltaPeloPonto', 'progProjetoCoreStatusColab'];
  const pc = {
    console, Date, JSON, Object, Array, String, Number, Math, parseInt,
    PROG_STATUS: { disponivel: {}, falta: {}, patio: {}, observacao: {}, ferias: {} },
    _progStatus: {}, dataHoje: () => '2026-10-14', progProjGetData: () => '2026-10-14',
    ponto: {}, pontoCacheGet(re, d) { return pc.ponto[re + '_' + d]; }
  };
  vm.createContext(pc);
  vm.runInContext(PONTO.map(fn).join('\n'), pc);
  const col = (id, re, vinculo) => ({ id, re, vinculo: vinculo || 'campo' });
  pc.ponto['10_2026-10-13'] = { status: 'falta', horario_previsto: { entrada: '07:00' } };
  ok('sem entrada no ponto (dia passado) → Faltou automático', pc.ppDispStatusColab(col('a', '10'), '2026-10-13') === 'falta'
    && pc.ppDispFaltaPeloPonto(col('a', '10'), '2026-10-13') === true);
  pc._progStatus.b = 'falta';
  pc.ponto['11_2026-10-13'] = { status: 'presente', entrada: '07:02', horario_previsto: { entrada: '07:00' } };
  ok('Faltou gravado + entrada registrada no ponto → sai do Faltou sozinho', pc.ppDispStatusColab(col('b', '11'), '2026-10-13') === 'disponivel');
  pc._progStatus.c = 'falta';
  ok('Faltou gravado sem ponto continua Faltou (não é "do ponto")', pc.ppDispStatusColab(col('c', '12'), '2026-10-13') === 'falta'
    && pc.ppDispFaltaPeloPonto(col('c', '12'), '2026-10-13') === false);
  pc.ponto['13_2026-10-15'] = { status: 'falta', horario_previsto: { entrada: '07:00' } };
  ok('data futura nunca vira Faltou', pc.ppDispStatusColab(col('d', '13'), '2026-10-15') === 'disponivel');
  pc.ponto['14_2026-10-13'] = { status: 'falta', horario_previsto: { entrada: '07:00' } };
  ok('vínculo fora de campo não vira Faltou automático', pc.ppDispStatusColab(col('e', '14', 'escritorio'), '2026-10-13') === 'disponivel');
  pc._progStatus.f = 'ferias';
  pc.ponto['15_2026-10-13'] = { status: 'falta', horario_previsto: { entrada: '07:00' } };
  ok('férias não vira Faltou pelo ponto', pc.ppDispStatusColab(col('f', '15'), '2026-10-13') === 'ferias');
  pc._progStatus.g = 'observacao';
  pc.ponto['16_2026-10-13'] = { status: 'falta', horario_previsto: { entrada: '07:00' } };
  ok('disponível com observação sem entrada → Faltou', pc.ppDispStatusColab(col('g', '16'), '2026-10-13') === 'falta');

  // ── vm: modal e gravação ──────────────────────────────────────
  const MODAL = ['progProjetoCoreStatusColab', 'progProjetoCoreStatusInfoColab', 'progProjetoCoreMenuSlot', 'progProjetoCoreSetStatusMenu',
    'progProjetoCoreSalvarMenuStatus', 'ppFecharMenuStatus', 'progDataRetornoStr', 'ppSetStatusMenu', 'ppSalvarMenuStatus'];
  function ctxModal(cfg) {
    const els = {};
    const log = { modal: [], upsert: [], update: [], toast: [], lote: 0, recarga: [], fechou: 0 };
    const m = {
      console: { log() {}, warn() {}, error() {} }, Date, JSON, Object, Array, String, Number, Math, Promise,
      DEMO: false, window: {}, usuarioLogado: { nome: 'Gestor' },
      PROG_STATUS: { disponivel: { label: 'Disponível', cor: '#3B6D11', bg: '#EAF3DE' }, patio: { label: 'Pátio', cor: '#0A6B7C', bg: '#E2F4F7' },
        ferias: { label: 'Férias', cor: '#185FA5', bg: '#E6F1FB' }, observacao: { label: 'Observação', cor: '#00788A', bg: '#E0F3F6' },
        afastado: { label: 'Afastado', cor: '#555', bg: '#f5f5f3' }, treinamento: { label: 'Treinamento', cor: '#534AB7', bg: '#EEEDFE' },
        verificar: { label: 'Verificar', cor: '#8B1A6B', bg: '#F7E2F2' }, demitido: { label: 'Demitido', cor: '#4A1010', bg: '#F0E0E0' } },
      PP_MENU_STATUS: ['ferias', 'afastado', 'treinamento', 'patio', 'verificar', 'demitido', 'observacao'],
      PROG_STATUS_PERSISTENTES: ['ferias', 'afastado', 'treinamento', 'demitido', 'inapto'],
      colaboradores: [{ id: 'c1', nome: 'FULANO', re: '10' }],
      _progStatus: Object.assign({}, cfg.st || {}), _progStatusInfo: {}, _pp: { statusData: '2026-10-15' },
      progProjGetData: () => '2026-10-15', fmtD: d => d.split('-').reverse().join('/'), escHtml: s => String(s), nomeAbrev: s => s,
      setModal: h => { log.modal.push(h); }, closeModal: () => { log.fechou++; },
      progShowToast: (t, k) => log.toast.push((k || 'ok') + ':' + t),
      progProjRenderQuadro() {}, progColabUltimasEscalasHtml: () => '',
      progProjCarregarStatusDia: (d, f) => log.recarga.push(d + ':' + !!f),
      progSalvarStatus: () => { log.lote++; },
      sbUpsert: (t, l) => { log.upsert.push(JSON.parse(JSON.stringify(l))); return Promise.resolve(cfg.upsertFalha ? null : [l]); },
      sbUpdate: (t, p, f) => { log.update.push({ p, f }); return Promise.resolve(true); },
      vtGarantirTratamento() {}, vtAtualizarAbaAlerta() {},
      progFindCompDia: () => null, progProjetoCoreFindEquipe: () => null, progGetVeiculo: () => null, frt_veiculos: [],
      cnhVeiculoAceitaCnhB: () => false, cnhCompatibilidadeVeiculo: () => 'ok', cnhVeiculoEhDeliveryExpress: () => false,
      document: { getElementById: id => els[id] || null, querySelector: s => (s === 'button[data-st="disponivel"]' && cfg.pool) ? {} : null, querySelectorAll: () => [] }
    };
    m.window = m;
    vm.createContext(m);
    vm.runInContext(MODAL.map(fn).join('\n'), m);
    return { m, log, els };
  }
  let t = ctxModal({ pool: true });
  t.m.ppMenuSlot = t.m.progProjetoCoreMenuSlot;
  t.m.progProjetoCoreMenuSlot('c1', '', undefined);
  let h = t.log.modal[0];
  ok('modal do painel: mostra o dia da tela e tem "✅ Disponível"', /Status do dia 2026\/10\/15|Status do dia 15\/10\/2026/.test(h) && h.includes('data-st="disponivel"'));
  ok('modal do painel: sem "retirar da equipe"/"emprestar"', !h.includes('retirar da equipe') && !h.includes('Emprestar'));
  t = ctxModal({});
  t.m.progProjetoCoreMenuSlot('c1', 'eq1', 0);
  ok('modal da equipe mantém retirar/emprestar e não ganha o botão do painel', t.log.modal[0].includes('retirar da equipe') && !t.log.modal[0].includes('data-st="disponivel"'));

  // Pátio com observação → grava só c1, em 15/10, sem lote do TMA
  t = ctxModal({ pool: true });
  t.m.progProjetoCoreMenuSlot('c1', '', undefined);
  t.m._progStatus.c1 = 'patio';
  t.els['pp-obs-status-input'] = { value: 'devido falta de uniforme' };
  t.m.progProjetoCoreSalvarMenuStatus('c1');
  await tick(); await tick(); await tick();
  ok('grava uma linha, só deste colaborador, na data da tela', t.log.upsert.length === 1 && t.log.upsert[0].colaborador_id === 'c1'
    && t.log.upsert[0].data === '2026-10-15' && t.log.upsert[0].status === 'patio' && t.log.upsert[0].obs === 'devido falta de uniforme'
    && t.log.upsert[0].data_retorno === null && t.log.upsert[0].deleted_at === null, t.log.upsert);
  ok('não chama a gravação em lote do TMA', t.log.lote === 0);
  ok('relê o dia do banco depois de salvar', JSON.stringify(t.log.recarga) === '["2026-10-15:true"]' && /Status do dia 2026-10-15 salvo|Status do dia 15\/10\/2026 salvo/.test(t.log.toast.join('|')));

  // Disponível com observação
  t = ctxModal({ pool: true, st: { c1: 'patio' } });
  t.m.progProjetoCoreMenuSlot('c1', '', undefined);
  t.m._progStatus.c1 = 'disponivel';
  t.els['pp-obs-status-input'] = { value: 'só dirige carro leve' };
  t.m.progProjetoCoreSalvarMenuStatus('c1');
  await tick(); await tick();
  ok('"Disponível" com observação grava Disponível com observação (escalável)', t.log.upsert[0] && t.log.upsert[0].status === 'observacao' && t.log.upsert[0].obs === 'só dirige carro leve');
  // Disponível sem observação, vindo de férias → ausência termina no dia (histórico mantido)
  t = ctxModal({ pool: true, st: { c1: 'ferias' } });
  t.m.progProjetoCoreMenuSlot('c1', '', undefined);
  t.m._progStatus.c1 = 'disponivel';
  t.els['pp-obs-status-input'] = { value: '' };
  t.m.progProjetoCoreSalvarMenuStatus('c1');
  await tick(); await tick(); await tick();
  ok('Disponível (sem obs): grava disponível no dia', t.log.upsert[0] && t.log.upsert[0].status === 'disponivel' && t.log.upsert[0].obs === null);
  ok('saindo de férias: retorno das férias anteriores vira o dia (sem apagar histórico)', t.log.update.length === 1 && t.log.update[0].p.data_retorno === '2026-10-15'
    && /colaborador_id=eq\.c1&status=eq\.ferias&data=lt\.2026-10-15/.test(t.log.update[0].f) && /or=\(data_retorno\.is\.null,data_retorno\.gt\.2026-10-15\)/.test(t.log.update[0].f), t.log.update);
  // Férias exige retorno
  t = ctxModal({ pool: true });
  t.m.progProjetoCoreMenuSlot('c1', '', undefined);
  t.m._progStatus.c1 = 'ferias';
  t.m.progProjetoCoreSalvarMenuStatus('c1');
  ok('férias sem data de retorno não grava', t.log.upsert.length === 0 && /data prevista de retorno/.test(t.log.toast.join('|')));
  // Banco recusa → avisa (antes dizia "salvo")
  t = ctxModal({ pool: true, upsertFalha: true });
  t.m.progProjetoCoreMenuSlot('c1', '', undefined);
  t.m._progStatus.c1 = 'patio';
  t.els['pp-obs-status-input'] = { value: 'x' };
  t.m.progProjetoCoreSalvarMenuStatus('c1');
  await tick(); await tick(); await tick();
  ok('banco recusou: avisa "não salvo" e relê o dia', /Status não salvo/.test(t.log.toast.join('|')) && !/salvo\./.test(t.log.toast.join('|')) && t.log.recarga.length === 1);
  // Fechar desfaz a seleção
  t = ctxModal({ pool: true, st: { c1: 'patio' } });
  t.m.progProjetoCoreMenuSlot('c1', '', undefined);
  t.m.progProjetoCoreSetStatusMenu('c1', 'ferias');
  t.m.ppFecharMenuStatus();
  ok('Fechar sem salvar volta ao status anterior', t.m._progStatus.c1 === 'patio' && t.log.upsert.length === 0 && t.log.fechou === 1);

  if (failed.length) {
    console.log(`prog-projetos-status-dia: FALHOU ${failed.length}/${total}`);
    for (const f of failed) console.log('  - ' + f);
    process.exit(1);
  }
  console.log(`prog-projetos-status-dia: OK (${total} verificações, base ${BASE})`);
})().catch(e => { console.error(e); process.exit(1); });
