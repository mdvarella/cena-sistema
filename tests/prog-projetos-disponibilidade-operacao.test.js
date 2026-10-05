'use strict';
// PROGRAMAÇÃO DE PROJETOS 8.1.170 — OPERAÇÃO (Portaria/APP, somente leitura) e painel de disponibilidade.
// Status A–F, indicadores/filtros, ausência de calendário TMA e TMA intacta.
process.env.TZ = 'America/Sao_Paulo';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execSync } = require('child_process');

const raiz = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const sw = fs.readFileSync(path.join(raiz, 'sw.js'), 'utf8');
const failed = [];
let total = 0;
function ok(name, cond, detail) { total++; if (!cond) failed.push(name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }

function blocoEm(fonte, inicioRe) {
  const m = inicioRe.exec(fonte);
  if (!m) return null;
  const ini = m.index + 1;
  const re = /\n(?:async function |function |var |\/\*\*|\/\/)/g;
  re.lastIndex = ini + 5;
  const fim = re.exec(fonte);
  return fonte.slice(ini, fim ? fim.index : undefined);
}
function bloco(re) { const b = blocoEm(html, re); if (!b) throw new Error('não encontrado: ' + re); return b; }
const fn = nome => bloco(new RegExp('\\n(?:async )?function ' + nome + '\\('));
const vr = nome => bloco(new RegExp('\\nvar ' + nome + '\\s*='));

const HOJE = '2026-09-29';
const escHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ─────────────────────────── OPERAÇÃO (Portaria + APP) ───────────────────────────
const OPS_FUNCS = ['ppOpsTs', 'ppOpsDiaLocal', 'ppOpsHora', 'ppOpsAddDias', 'ppOpsEhFuturo', 'ppOpsNormPlaca', 'ppOpsSaidaRetornou',
  'ppOpsSaidaAberta', 'ppOpsInvalidar', 'ppOpsCarregar', 'ppOpsEstadoFonte', 'ppGetStatusPortariaEquipe', 'ppGetStatusAppEquipe',
  'ppOpsOsVisual', 'ppOpsOsEventos', 'ppOpsOsTs', 'ppOpsOsUltimoTs', 'ppGetOrdemEquipe', 'ppProjetosSelecionadosEquipe', 'ppHtmlOperacaoEquipe'];
const opsCodigo = [vr('PP_OPS_TTL_MS'), vr('_ppOps'), vr('PP_OPS_VISUAL'), vr('PP_OPS_OS_ATIVA'), vr('PP_OPS_OS_FIM'), vr('PP_OPS_OS_EV')]
  .concat(OPS_FUNCS.map(fn)).join('\n');

function ctxOps(opts) {
  const ctx = {
    console, Math, Number, String, Object, Array, Date, isFinite, isNaN, JSON, Promise,
    DEMO: false,
    dataHojeLocal: () => HOJE,
    escHtml,
    progProjetoCoreGetEquipes: () => ['eqA', 'eqB', 'eqC', 'eqE', 'eqG', 'eqN', 'eqO'].map(id => ({ id })),
    programadas: opts.programadas || {},
    progEquipeProgramadaNoDia(eqId, dia) { return !!ctx.programadas[eqId + '_' + dia]; },
    composicao_dia: opts.composicao || [],
    parseJsonField(v, d) { if (!v) return d; if (typeof v === 'string') { try { return JSON.parse(v); } catch (e) { return d; } } return v; },
    progProjGetCid: () => 'cid-1',
    progProjGetProjetos: cid => (cid === 'cid-1' ? PROJETOS : []),
    fetches: [], escritas: 0,
    sbInsert() { ctx.escritas++; }, sbUpdate() { ctx.escritas++; }, sbUpsert() { ctx.escritas++; }, sbDelete() { ctx.escritas++; },
    async sbFetch(tabela, o) {
      ctx.fetches.push([tabela, o]);
      if (opts.falha && opts.falha[tabela]) return null;
      return (opts.tabelas[tabela] || []).map(r => Object.assign({}, r));
    }
  };
  vm.createContext(ctx);
  vm.runInContext(opsCodigo, ctx);
  return ctx;
}
const ms = iso => new Date(iso).getTime();
const SAIDAS = [
  // B / F: saída aberta, sem sessão no app
  { id: 's-b', equipe_id: 'eqB', placa: 'TTM8E98', status: 'Em campo', data_saida: '2026-09-29T07:12:30-03:00', data_retorno: null },
  // C: saída retornada + clone aberto da mesma saída (mesma placa, mesmo instante)
  { id: 's-c', equipe_id: 'eqC', placa: 'TTP2G93', status: 'Retornado', data_saida: '2026-09-29T07:40:00-03:00', data_retorno: '2026-09-29T16:22:10-03:00' },
  { id: 's-c2', equipe_id: 'eqC', placa: 'TTP-2G93', status: 'Em campo', data_saida: '2026-09-29T07:40:00.500-03:00', data_retorno: null },
  // G: saída aberta + app encerrado (logout não é retorno)
  { id: 's-g', equipe_id: 'eqG', placa: 'AAA1B22', status: 'Em campo', data_saida: '2026-09-29T08:05:00-03:00', data_retorno: null },
  // Cancelada não conta
  { id: 's-x', equipe_id: 'eqN', placa: 'BBB1C33', status: 'Cancelado', data_saida: '2026-09-29T09:00:00-03:00', data_retorno: null },
  // O: saída aberta de ontem (virada) — vale só para hoje
  { id: 's-o', equipe_id: 'eqO', placa: 'CCC1D44', status: 'Em campo', data_saida: '2026-09-28T22:10:00-03:00', data_retorno: null },
  // Histórico de 28/09 da eqA (retornou)
  { id: 's-a28', equipe_id: 'eqA', placa: 'DDD1E55', status: 'Retornado', data_saida: '2026-09-28T07:00:00-03:00', data_retorno: '2026-09-28T17:45:00-03:00' }
];
const SESSOES = [
  // E: logado, sem saída
  { id: 'p-e', equipe_id: 'eqE', data: HOJE, login_ts: ms('2026-09-29T06:55:00-03:00'), logout_ts: null },
  // C: retornou pela portaria mas app segue aberto (retorno não é logout)
  { id: 'p-c', equipe_id: 'eqC', data: HOJE, login_ts: String(ms('2026-09-29T07:30:00-03:00')), logout_ts: null },
  // G: encerrado no app com saída ainda aberta
  { id: 'p-g', equipe_id: 'eqG', data: HOJE, login_ts: ms('2026-09-29T07:50:00-03:00'), logout_ts: ms('2026-09-29T11:01:00-03:00') }
];

const ORDENS = [
  // B: OS em atendimento (a caminho) + uma já encerrada antes
  { id: 'o-b1', equipe_id: 'eqB', data: HOJE, numero_ordem: '54321', status: 'a_caminho', eventos: [{ tipo: 'A caminho', ts: ms('2026-09-29T16:49:00-03:00') }] },
  { id: 'o-b0', equipe_id: 'eqB', data: HOJE, numero_ordem: '54300', status: 'encerrada', eventos: JSON.stringify([{ tipo: 'A caminho', ts: ms('2026-09-29T08:00:00-03:00') }, { tipo: 'Atividade_encerrada', ts: ms('2026-09-29T12:10:00-03:00') }]) },
  // C: só encerradas → ÚLTIMA OS + contagem
  { id: 'o-c1', equipe_id: 'eqC', data: HOJE, numero_ordem: '700', status: 'encerrada', eventos: [{ tipo: 'Atividade_encerrada', ts: ms('2026-09-29T11:00:00-03:00') }] },
  { id: 'o-c2', equipe_id: 'eqC', data: HOJE, numero_ordem: '701', status: 'encerrada', eventos: [{ tipo: 'Atividade_encerrada', ts: ms('2026-09-29T15:30:00-03:00') }] },
  // G: no local, OS com data do dia seguinte (turno da noite)
  { id: 'o-g', equipe_id: 'eqG', data: '2026-09-30', numero_ordem: '900', status: 'no_local', eventos: [{ tipo: 'A caminho', ts: ms('2026-09-29T22:00:00-03:00') }, { tipo: 'Chegou_local', ts: ms('2026-09-29T22:40:00-03:00') }] },
  // excluída não conta; OS de outro dia não conta
  { id: 'o-x', equipe_id: 'eqE', data: HOJE, numero_ordem: '1', status: 'a_caminho', deleted_at: '2026-09-29T10:00:00-03:00', eventos: [] },
  { id: 'o-y', equipe_id: 'eqA', data: '2026-09-27', numero_ordem: '2', status: 'a_caminho', eventos: [] }
];

const PROJETOS = [
  { id: 'pj-1', nome: 'DAC/S.SUL.22.00031', status: 'Em execução', origem: 'sot' },
  { id: 'pj-2', nome: 'OBRA <2>', status: 'Em execução', origem: 'sot' }
];
const COMPOSICAO = [
  // O: sem OS, dois projetos selecionados (string JSON, como no banco)
  { equipe_id: 'eqO', data: HOJE, projeto_ids: JSON.stringify(['pj-1', 'pj-2']) },
  // B: OS ativa + projeto selecionado → mostra a OS
  { equipe_id: 'eqB', data: HOJE, projeto_ids: ['pj-1'] },
  // N: projeto que não existe no cadastro do contrato
  { equipe_id: 'eqN', data: HOJE, projeto_ids: '["pj-x"]' },
  // A: projeto só em outra data; composição excluída não conta
  { equipe_id: 'eqA', data: '2026-09-28', projeto_ids: '["pj-1"]' },
  { equipe_id: 'eqC', data: HOJE, projeto_ids: '["pj-1"]', deleted_at: '2026-09-29T09:00:00-03:00' },
  // E: composição sem projeto
  { equipe_id: 'eqE', data: HOJE, projeto_ids: '[]' }
];

async function testesOperacao() {
  const tabelas = { frotas_portaria_saidas: SAIDAS, plpt_sessoes: SESSOES, ordens_diario: ORDENS };
  const ctx = ctxOps({ tabelas, composicao: COMPOSICAO, programadas: { eqA_2026_09_29: false, 'eqA_2026-09-29': true, 'eqE_2026-09-29': true, 'eqB_2026-09-29': true } });
  await ctx.ppOpsCarregar(HOJE, 'cid-1');
  const tabs = ctx.fetches.map(f => f[0]).sort();
  ok('leitura: frotas_portaria_saidas, ordens_diario e plpt_sessoes', JSON.stringify(tabs) === JSON.stringify(['frotas_portaria_saidas', 'ordens_diario', 'plpt_sessoes']), tabs);
  const fOs = ctx.fetches.find(f => f[0] === 'ordens_diario')[1].filters;
  ok('OS filtradas pelas equipes do contrato, dia e dia seguinte', fOs.some(f => /^equipe_id=in\.\(eqA,eqB,/.test(f)) && fOs.includes('data=gte.' + HOJE) && fOs.includes('data=lte.2026-09-30'), fOs);
  const fPort = ctx.fetches.find(f => f[0] === 'frotas_portaria_saidas')[1].filters;
  ok('portaria filtrada pelas equipes do contrato', fPort.some(f => /^equipe_id=in\.\(eqA,eqB,/.test(f)), fPort);
  ok('portaria janela dia-1..dia+2', fPort.includes('data_saida=gte.2026-09-28') && fPort.includes('data_saida=lt.2026-10-01'), fPort);
  const fApp = ctx.fetches.find(f => f[0] === 'plpt_sessoes')[1].filters;
  ok('app filtrado pela data', fApp.includes('data=eq.' + HOJE), fApp);

  const P = id => ctx.ppGetStatusPortariaEquipe(id, HOJE);
  const A = id => ctx.ppGetStatusAppEquipe(id, HOJE);
  const H = id => ctx.ppHtmlOperacaoEquipe(id, HOJE);

  // A
  ok('A: programada sem saída → aguardando', P('eqA').status === 'aguardando', P('eqA'));
  ok('A: html Aguardando saída', H('eqA').includes('Aguardando saída'));
  ok('A: não é em campo', !/Em campo/i.test(H('eqA')));
  // B
  ok('B: saída sem retorno → em_campo', P('eqB').status === 'em_campo', P('eqB'));
  ok('B: hora real da saída', P('eqB').hora === '07:12', P('eqB').hora);
  ok('B: html 🟢 Em Campo · 07:12 (visual TMA)', H('eqB').includes('🟢 Em Campo · 07:12'), H('eqB'));
  // C
  ok('C: retornou (clone aberto ignorado)', P('eqC').status === 'retornou', P('eqC'));
  ok('C: hora real do retorno', P('eqC').hora === '16:22', P('eqC').hora);
  ok('C: html 🔵 Retornou · 16:22', H('eqC').includes('🔵 Retornou · 16:22'), H('eqC'));
  ok('C: retorno não gera logout (app segue logado)', A('eqC').status === 'logado' && A('eqC').hora === '07:30', A('eqC'));
  // E
  ok('E: login sem saída → APP logado', A('eqE').status === 'logado' && A('eqE').hora === '06:55', A('eqE'));
  ok('E: PORTARIA aguardando', P('eqE').status === 'aguardando', P('eqE'));
  ok('E: html 🟢 Dia iniciado · 06:55 + Aguardando', H('eqE').includes('🟢 Dia iniciado · 06:55') && H('eqE').includes('Aguardando saída'), H('eqE'));
  // F
  ok('F: saída sem login → PORTARIA em campo', P('eqB').status === 'em_campo');
  ok('F: ⚪ App não iniciado', A('eqB').status === 'sem_sessao' && H('eqB').includes('⚪ App não iniciado'), A('eqB'));
  // logout ≠ retorno
  ok('logout não gera retorno (portaria em campo)', P('eqG').status === 'em_campo', P('eqG'));
  ok('app encerrado com hora real', A('eqG').status === 'encerrado' && A('eqG').hora === '11:01', A('eqG'));
  ok('html ✅ Dia encerrado · 11:01', H('eqG').includes('✅ Dia encerrado · 11:01'), H('eqG'));
  // OS
  const O = id => ctx.ppGetOrdemEquipe(id, HOJE);
  ok('OS: em atendimento vence a encerrada', O('eqB').status === 'ativa' && O('eqB').ordem.id === 'o-b1', O('eqB'));
  ok('OS: html OS 54321 + 🚗 A caminho · 16:49', H('eqB').includes('>OS 54321<') && H('eqB').includes('🚗 A caminho · 16:49'), H('eqB'));
  ok('OS: rótulo OS quando há OS ativa', H('eqB').includes('>OS</div>') && !H('eqB').includes('ÚLTIMA OS'));
  ok('OS: só encerradas → ÚLTIMA OS mais recente', O('eqC').status === 'ultima' && O('eqC').ordem.id === 'o-c2', O('eqC'));
  ok('OS: html ÚLTIMA OS ✅ Encerrada · 15:30 + contagem', H('eqC').includes('ÚLTIMA OS') && H('eqC').includes('✅ Encerrada · 15:30') && H('eqC').includes('2 OS concluídas no dia'), H('eqC'));
  ok('OS: turno da noite (OS do dia seguinte) → 📍 No local · 22:40', H('eqG').includes('📍 Cheguei / No local · 22:40'), H('eqG'));
  ok('OS: excluída não conta', O('eqE').status === 'sem_os' && H('eqE').includes('Sem OS em atendimento'), O('eqE'));
  ok('OS: OS de outro dia não conta', O('eqA').status === 'sem_os', O('eqA'));
  // Projeto selecionado no lugar de "Sem OS em atendimento"
  ok('projeto: sem OS mostra rótulo PROJETO e os projetos selecionados', H('eqO').includes('>PROJETO</div>') && H('eqO').includes('📋 DAC/S.SUL.22.00031')
    && H('eqO').includes('📋 OBRA &lt;2&gt;') && !H('eqO').includes('Sem OS em atendimento'), H('eqO'));
  ok('projeto: data-pp-op-proj com o id real', H('eqO').includes('data-pp-op-proj="pj-1"') && H('eqO').includes('data-pp-op-proj="pj-2"'));
  ok('projeto: OS ativa continua no lugar do projeto', H('eqB').includes('>OS 54321<') && !H('eqB').includes('PROJETO') && !H('eqB').includes('data-pp-op-proj'), H('eqB'));
  ok('projeto: id fora do cadastro não aparece (Sem OS)', H('eqN').includes('Sem OS em atendimento') && !H('eqN').includes('pj-x') && !H('eqN').includes('PROJETO'), H('eqN'));
  ok('projeto: de outra data não vaza', H('eqA').includes('Sem OS em atendimento') && !H('eqA').includes('data-pp-op-proj'), H('eqA'));
  ok('projeto: composição excluída não conta', ctx.ppProjetosSelecionadosEquipe('eqC', HOJE).length === 0);
  ok('projeto: lista vazia → Sem OS em atendimento', H('eqE').includes('Sem OS em atendimento') && !H('eqE').includes('PROJETO'), H('eqE'));
  ok('projeto: data futura não mostra projeto no bloco OS', !ctx.ppHtmlOperacaoEquipe('eqO', '2026-09-30').includes('data-pp-op-proj'));
  ok('visual TMA: rótulos PORTARIA/APP/OS empilhados', /PORTARIA<\/div><div data-pp-op-st="em_campo"[^>]*>🟢 Em Campo · 07:12<\/div><div[^>]*>APP<\/div>/.test(H('eqB')), H('eqB'));
  // cancelada / sem programação
  ok('saída cancelada ignorada; sem programação → sem_saida', P('eqN').status === 'sem_saida', P('eqN'));
  ok('programação sozinha não gera em campo', ['eqA', 'eqE'].every(id => P(id).status !== 'em_campo'));
  // virada (saída aberta de ontem) vale para hoje
  ok('virada: saída aberta de ontem → em campo hoje', P('eqO').status === 'em_campo' && P('eqO').hora === '22:10', P('eqO'));
  ok('equipe fora do contrato → carregando (não inventa)', P('eqZ').status === 'carregando');
  ok('somente leitura: nenhuma escrita', ctx.escritas === 0, ctx.escritas);

  // TTL e Atualizar
  const n0 = ctx.fetches.length;
  await ctx.ppOpsCarregar(HOJE, 'cid-1');
  ok('TTL: sem nova leitura dentro de 60s', ctx.fetches.length === n0, ctx.fetches.length - n0);
  ctx.ppOpsInvalidar();
  await ctx.ppOpsCarregar(HOJE, 'cid-1');
  ok('Atualizar (invalidar) relê portaria, app e OS', ctx.fetches.length === n0 + 3, ctx.fetches.length - n0);

  // D — data futura
  const n1 = ctx.fetches.length;
  await ctx.ppOpsCarregar('2026-09-30', 'cid-1');
  ok('D: data futura não consulta nada', ctx.fetches.length === n1, ctx.fetches.length - n1);
  const pF = ctx.ppGetStatusPortariaEquipe('eqB', '2026-09-30');
  ok('D: futura nunca em campo (mesmo com saída aberta hoje)', pF.status === 'futuro', pF);
  ok('D: html futura sem Em campo', !/Em campo/i.test(ctx.ppHtmlOperacaoEquipe('eqB', '2026-09-30')));
  ok('D: futura sem OS', ctx.ppGetOrdemEquipe('eqB', '2026-09-30').status === 'futuro' && !ctx.ppHtmlOperacaoEquipe('eqB', '2026-09-30').includes('A caminho'));
  ok('D: app futuro sem sessão', ctx.ppGetStatusAppEquipe('eqE', '2026-09-30').status === 'futuro');

  // Passado — histórico real do dia
  await ctx.ppOpsCarregar('2026-09-28', 'cid-1');
  const p28 = ctx.ppGetStatusPortariaEquipe('eqA', '2026-09-28');
  ok('passado: histórico do dia (retornou 17:45)', p28.status === 'retornou' && p28.hora === '17:45', p28);
  ok('passado: saída aberta do próprio dia', ctx.ppGetStatusPortariaEquipe('eqO', '2026-09-28').status === 'em_campo'
    && ctx.ppGetStatusPortariaEquipe('eqO', '2026-09-28').hora === '22:10');
  ok('passado: dados de outra data não vazam', ctx.ppGetStatusPortariaEquipe('eqB', '2026-09-28').status === 'sem_saida',
    ctx.ppGetStatusPortariaEquipe('eqB', '2026-09-28'));

  // Falha de leitura → não afirma "Aguardando"
  const cErr = ctxOps({ tabelas, programadas: { 'eqA-x': true }, falha: { frotas_portaria_saidas: true } });
  await cErr.ppOpsCarregar(HOJE, 'cid-1');
  ok('falha na portaria → sem_leitura (fail-closed)', cErr.ppGetStatusPortariaEquipe('eqA', HOJE).status === 'sem_leitura');
  ok('falha só na portaria mantém app', cErr.ppGetStatusAppEquipe('eqE', HOJE).status === 'logado');
  const cOs = ctxOps({ tabelas, programadas: {}, falha: { ordens_diario: true } });
  await cOs.ppOpsCarregar(HOJE, 'cid-1');
  ok('falha nas OS → sem_leitura, sem inventar OS', cOs.ppGetOrdemEquipe('eqB', HOJE).status === 'sem_leitura' && cOs.ppHtmlOperacaoEquipe('eqB', HOJE).includes('Sem leitura das OS'));
  ok('falha só nas OS mantém portaria', cOs.ppGetStatusPortariaEquipe('eqB', HOJE).status === 'em_campo');
}

// ─────────────────────────── DISPONIBILIDADE ───────────────────────────
const DISP_FUNCS = ['ppDispStatusColab', 'ppDispEscaladosDia', 'ppDispCalcular', 'ppDispPonto', 'ppDispPresente', 'ppDispFiltrarPonto',
  'ppDispBadgePontoHtml', 'ppDispEscalasUsadas', 'ppDispChipLivreHtml', 'ppDispChipStatusHtml', 'ppDispCorHex', 'ppDispBotaoFiltroHtml',
  'ppRenderPainelDisp', 'ppSetFiltroDispStatus', 'ppSetFiltroIndisp', 'ppSetFiltroEscalaColab', 'ppVinculadosDisponiveisEq',
  'progFiltrarColsProgramacao', 'progProjetoCoreStatusColab', 'progProjetoCoreStatusInfoColab', 'progStatusAutor', 'progObsLinhaHtml'];
const bloqMatch = /var BLOQ_STATUS = (\[[^\]]*\])/.exec(html);
const dispCodigo = [vr('PROG_STATUS'), 'var BLOQ_STATUS = ' + bloqMatch[1] + ';', vr('PP_DISP_LIVRE_ST'), vr('PP_DISP_INDISP_ST'), vr('PP_DISP_BADGE_ORDEM')]
  .concat(DISP_FUNCS.map(fn)).join('\n');

const CID = 'cid-1';
const COLS = [
  ['d1', 'disponivel', 'e1'], ['d2', 'disponivel', 'e2'], ['d3', 'disponivel', 'e1'],
  ['o1', 'observacao', 'e1'], ['o2', 'observacao', 'e2'],
  ['f1', 'falta', 'e1'], ['fe1', 'ferias', 'e2'], ['a1', 'afastado', 'e2'],
  ['t1', 'treinamento', 'e1'], ['t2', 'treinamento', 'e2'], ['fo1', 'folga', 'e1'], ['v1', 'verificar', 'e2']
].map(([id, st, esc], i) => ({ id, st, escala_id: esc, nome: 'COLAB ' + id.toUpperCase(), re: String(1000 + i), contrato_id: CID, ativo: true, vinculo: 'campo', equipe_id: 'eqX', cor_escala: 'Azul' }));

function ctxDisp() {
  const status = {}; COLS.forEach(c => { if (c.st !== 'disponivel') status[c.id] = c.st; });
  const ctx = {
    console, Math, Number, String, Object, Array, Date, JSON,
    colaboradores: COLS.map(c => Object.assign({}, c)).concat([{ id: 'outro', nome: 'OUTRO CONTRATO', contrato_id: 'cid-2', ativo: true, vinculo: 'campo' }]),
    _progStatus: status,
    _progStatusInfo: { fe1: { retorno: '2026-10-05' }, t1: { retorno: '2026-10-10' }, o1: { obs: 'Só dirige carro leve', registrado_por: 'Ana' } },
    composicao_dia: [{ equipe_id: 'eqX', data: HOJE, colaborador_ids: JSON.stringify(['d3', 'o2', null]) },
      { equipe_id: 'eqY', data: '2026-09-28', colaborador_ids: ['d1'] }],
    _pp: { filtroPonto: 'todos' },
    ponto: { '1000': { entrada: '06:58' } },
    pontoCacheGet(re) { return ctx.ponto[re] || null; },
    CAL_CORES_2026: { [HOJE]: 'Azul' }, _calDados: { [HOJE]: 'Azul' },
    dataHojeLocal: () => HOJE,
    fmtD: d => { const [y, m, dd] = String(d).slice(0, 10).split('-'); return dd + '/' + m + '/' + y; },
    escHtml, nomeAbrev: n => n,
    parseJsonField(v, d) { if (!v) return d; if (typeof v === 'string') { try { return JSON.parse(v); } catch (e) { return d; } } return v; },
    getEscala(id) { return { e1: { id: 'e1', tipo: '4x2', inicio: '07:00', fim: '17:00' }, e2: { id: 'e2', tipo: '5x2', inicio: '08:00', fim: '18:00' } }[id] || null; },
    renders: 0, progProjRenderQuadro() { ctx.renders++; }
  };
  vm.createContext(ctx);
  vm.runInContext(dispCodigo, ctx);
  return ctx;
}
const conta = (s, sub) => s.split(sub).length - 1;

function testesDisponibilidade() {
  const ctx = ctxDisp();
  const cols = ctx.progFiltrarColsProgramacao(CID);
  const calc = ctx.ppDispCalcular(cols, HOJE, '');
  const cnt = JSON.parse(JSON.stringify(calc.contagem));
  ok('contagem Disponível (exclui escalado)', cnt.disponivel === 2, cnt);
  ok('contagem Observação (não escalados)', cnt.observacao === 1, cnt);
  ok('contagem Faltou', cnt.falta === 1, cnt);
  ok('contagem Férias', cnt.ferias === 1, cnt);
  ok('contagem Afastado', cnt.afastado === 1, cnt);
  ok('contagem Treinamento', cnt.treinamento === 2, cnt);
  ok('contagem Folga explícita', cnt.folga === 1, cnt);
  ok('outro contrato não entra', !calc.base.some(c => c.id === 'outro'));
  ok('Disponível + Observação = não escalados', calc.livres.length === cnt.disponivel + cnt.observacao, calc.livres.length);
  const todosIds = calc.livres.concat(calc.indisp, calc.treino).map(c => c.id);
  ok('sem duplicação entre grupos', new Set(todosIds).size === todosIds.length, todosIds);
  ok('escalados do dia fora do painel (d3, o2)', !todosIds.includes('d3') && !todosIds.includes('o2'));
  ok('escalado em outro dia continua disponível (d1)', calc.livres.some(c => c.id === 'd1'));
  ok('soma das contagens = colaboradores classificados', Object.values(cnt).reduce((a, b) => a + b, 0) === todosIds.length);

  let h = ctx.ppRenderPainelDisp([], HOJE, CID);
  ok('título Disponíveis não escalados (3)', h.includes('Disponíveis não escalados (<b id="pp-disp-total">3</b>)'), h.match(/Disponíveis não escalados \(.{0,40}/));
  [['pp-count-disponivel', '2 Disponível'], ['pp-count-falta', '1 Faltou'], ['pp-count-ferias', '1 Férias'], ['pp-count-afastado', '1 Afastado'],
    ['pp-count-treinamento', '2 Treinamento'], ['pp-count-observacao', '1 Observação']].forEach(([id, txt]) => {
    const m = new RegExp('id="' + id + '"[^>]*>([^<]*)<').exec(h);
    ok('badge ' + txt, m && m[1] === txt, m && m[1]);
  });
  ok('badge Todos presente e ativo', /id="pp-count-todos"[^>]*background:#185FA5/.test(h));
  ok('badges clicáveis (filtro, não modal)', h.includes("ppSetFiltroDispStatus('falta')") && !h.includes('ppMostrarListaStatus'));
  ok('sem badge de status inexistente (Pátio)', !h.includes('pp-count-patio'));
  ok('borda do badge Afastado com hex válido', /id="pp-count-afastado"[^>]*border:\.5px solid #55555544/.test(h));
  ok('Em treinamento (2)', h.includes('📚 Em treinamento (2)'));
  ok('treinamento: volta só com data real', h.includes('volta 10/10/2026') && conta(h, ' · volta ') === 1);
  ok('Indisponíveis hoje (5/5)', h.includes('Indisponíveis hoje (5/5)'), h.match(/Indisponíveis[^<]{0,30}/));
  ok('filtros de indisponíveis só dos status presentes', ['falta', 'ferias', 'afastado', 'folga', 'verificar'].every(s => h.includes('id="pp-indisp-' + s + '"'))
    && !h.includes('pp-indisp-patio') && !h.includes('pp-indisp-fraude') && !h.includes('pp-indisp-treinamento'));
  ok('card indisponível com retorno real', h.includes('Férias · retorno 05/10/2026'));
  ok('pool padrão: 3 chips arrastáveis', conta(h, 'class="pp-colab-chip"') === 3);
  ok('observação escalável no pool com motivo', h.includes('id="pp-chip-o1"') && h.includes('📝 Só dirige carro leve'));
  ok('filtro Todas as escalas', h.includes('<option value="">Todas as escalas</option>') && h.includes('⏰ 4x2 (07:00-17:00)'));

  ctx.ppSetFiltroDispStatus('falta');
  ok('clique Faltou aplica filtro e re-renderiza', ctx._pp.filtroDispStatus === 'falta' && ctx.renders === 1);
  h = ctx.ppRenderPainelDisp([], HOJE, CID);
  const pool = h.slice(h.indexOf('id="pp-pool"'));
  ok('filtro Faltou: só f1 no pool, sem arrastar', pool.includes('COLAB F1') && conta(pool, 'class="pp-colab-chip"') === 0 && !pool.includes('COLAB D1'));
  ok('filtro Faltou: badge ativo + info', /id="pp-count-falta"[^>]*background:#A32D2D/.test(h) && h.includes('Filtro: <b>Faltou</b> (1)'));
  ok('total de não escalados mantém 3 com filtro', h.includes('<b id="pp-disp-total">3</b>'));

  ctx.ppSetFiltroDispStatus('observacao');
  h = ctx.ppRenderPainelDisp([], HOJE, CID);
  ok('filtro Observação: só o1 arrastável', conta(h, 'class="pp-colab-chip"') === 1 && h.includes('id="pp-chip-o1"'));
  ctx.ppSetFiltroDispStatus('treinamento');
  h = ctx.ppRenderPainelDisp([], HOJE, CID);
  ok('filtro Treinamento: t1 e t2 no pool', h.slice(h.indexOf('id="pp-pool"')).includes('COLAB T1') && h.slice(h.indexOf('id="pp-pool"')).includes('COLAB T2'));
  ctx.ppSetFiltroDispStatus('patio');
  h = ctx.ppRenderPainelDisp([], HOJE, CID);
  ok('filtro de status sem ninguém no dia cai em Todos', conta(h, 'class="pp-colab-chip"') === 3 && /id="pp-count-todos"[^>]*background:#185FA5/.test(h));
  ctx.ppSetFiltroDispStatus('xyz');
  ok('status desconhecido → todos', ctx._pp.filtroDispStatus === 'todos');
  ctx.ppSetFiltroDispStatus('todos');
  h = ctx.ppRenderPainelDisp([], HOJE, CID);
  ok('Todos restaura o pool', conta(h, 'class="pp-colab-chip"') === 3 && ctx._pp.filtroDispStatus === 'todos');

  ctx.ppSetFiltroIndisp('ferias');
  h = ctx.ppRenderPainelDisp([], HOJE, CID);
  ok('filtro indisponíveis Férias (1/5)', h.includes('Indisponíveis hoje (1/5)') && /id="pp-indisp-ferias"[^>]*background:#185FA5/.test(h));
  ctx.ppSetFiltroIndisp('todos');

  ctx.ppSetFiltroEscalaColab('e1');
  h = ctx.ppRenderPainelDisp([], HOJE, CID);
  ok('escala e1: não escalados = d1 + o1 (2)', h.includes('<b id="pp-disp-total">2</b>'));
  ok('escala e1: contagens afetadas', /id="pp-count-disponivel"[^>]*>1 Disponível</.test(h) && !h.includes('pp-count-ferias') && h.includes('Indisponíveis hoje (2/2)'));
  ok('escala e1: treinamento afetado (1)', h.includes('📚 Em treinamento (1)'));
  ctx.ppSetFiltroEscalaColab('');

  ctx._pp.filtroPonto = 'presentes';
  h = ctx.ppRenderPainelDisp([], HOJE, CID);
  ok('ponto Presentes: só d1 (com entrada)', h.includes('<b id="pp-disp-total">1/3</b>') && h.includes('id="pp-chip-d1"') && !h.includes('id="pp-chip-d2"'));
  ctx._pp.filtroPonto = 'ausentes';
  h = ctx.ppRenderPainelDisp([], HOJE, CID);
  ok('ponto Ausentes: d2 + o1', h.includes('<b id="pp-disp-total">2/3</b>') && !h.includes('id="pp-chip-d1"'));
  ctx._pp.filtroPonto = 'todos';

  const vinc = ctx.ppVinculadosDisponiveisEq('eqX', HOJE, CID, {}).map(c => c.id).sort();
  ok('auto-escalar: observação escalável, bloqueantes fora', vinc.includes('o1') && !vinc.includes('f1') && !vinc.includes('t1') && !vinc.includes('fe1'), vinc);
  ok('auto-escalar: sem folga por calendário TMA (cor igual ao dia)', vinc.includes('d1') && vinc.includes('d2'), vinc);

  h = ctx.ppRenderPainelDisp([], '2026-09-28', CID);
  ok('outra data: rótulo com a data', h.includes('Indisponíveis em 28/09/2026'));
}

// ─────────────────────────── ESTÁTICOS / ISOLAMENTO ───────────────────────────
function testesEstaticos() {
  const ppFuncs = [...html.matchAll(/\nfunction ((?:pp|_?progProj|progProjetoCore)\w*)\(/g)].map(m => m[1]);
  const comCal = ppFuncs.filter(n => /CAL_CORES_2026|_calDados|cor_escala/.test(fn(n)));
  ok('nenhuma função de Projetos usa calendário TMA', comCal.length === 0, comCal);
  const usaTma = ppFuncs.filter(n => /progTma\w*\(|progRenderPainelDisp\(|progRenderEquipeRow\(|progValidarComposicao\(|progEfetuarDrop\(/.test(fn(n)));
  ok('Projetos não chama progTma*/painel/linha TMA', usaTma.length === 0, usaTma);
  ok('coluna Operação no cabeçalho do quadro', fn('_progProjRenderQuadroInterno').includes('>Operação</th>'));
  ok('render sincroniza Operação', fn('_progProjRenderQuadroInterno').includes('ppOpsSincronizar(data, cid, false)'));
  ok('linha da equipe com célula Operação', fn('progProjetoCoreRenderEquipeRow').includes('data-pp-op-eq="\'+eq.id+\'">\'+ppHtmlOperacaoEquipe(eq.id, data)'));
  ok('Atualizar invalida leitura', fn('progProjAtualizarQuadro').includes('ppOpsInvalidar();'));
  const linhaPP = fn('progProjetoCoreRenderEquipeRow');
  ok('ações da linha sem Conf. saída e WhatsApp', !/ppSupConfirmar\(|ppEnviarWhatsApp\(|Conf\. saída|Saída OK|📲/.test(linhaPP));
  ok('ações da linha mantêm Desprog., HE, Auto Escalar e Salvar', ['ppDesprogramarEquipe(', 'ppAutorizarHoraExtra(', 'ppAutoEscalarEquipe(', 'ppSalvarEquipe('].every(t => linhaPP.includes(t)));
  ok('funções ppSupConfirmar e ppEnviarWhatsApp preservadas', /\nfunction ppSupConfirmar\(/.test(html) && /\nfunction ppEnviarWhatsApp\(/.test(html));
  ok('versão 8.1.184 no log e sw.js da versão atual', /\{v:'8\.1\.184'/.test(html) && sw.includes("'cena-" + /numero: '(8\.1\.\d+)'/.exec(html)[1] + "'"));
  ok('slots de Projetos sem laranja a partir do T3', !/isFolg2|#FFF0E0|#E65C00|pos>=2/.test(linhaPP));
  ok('slot usa a cor do status em todas as posições', linhaPP.includes("background:'+stI.bg+';") && linhaPP.includes("color:'+stI.cor+';margin-top:2px\">'+stI.label"));
  ok('retorno à página (visibilitychange)', fn('ppOpsRegistrarVisibilidade').includes("'visibilitychange'") && /\nppOpsRegistrarVisibilidade\(\);/.test(html));
  const ops = OPS_FUNCS.map(fn).join('\n');
  ok('módulo Operação sem escrita', !/sbInsert|sbUpdate|sbUpsert|sbDelete|method:\s*'(POST|PATCH|DELETE)'/.test(ops));
  ok('módulo Operação sem sessoes_disponibilidade', !/sessoes_disponibilidade|sessoes_disp\b/.test(ops));
  ok('versão 8.1.170 no log', /\{v:'8\.1\.170'/.test(html) && /numero: '8\.1\.\d+'/.test(html));
  ok('sw.js versionado', /'cena-8\.1\.\d+'/.test(sw));

  let base = null;
  // Base = 8.1.169 (última alteração aprovada da TMA: indicadores).
  try { base = execSync('git show 63eb865:index.html', { cwd: raiz, maxBuffer: 64 * 1024 * 1024 }).toString('utf8').replace(/\r\n/g, '\n'); } catch (e) { base = null; }
  if (!base) { ok('base 8.1.169 disponível para comparar TMA', false); return; }
  const nomesTma = [...new Set([...base.matchAll(/\nfunction (progTma\w*)\(/g)].map(m => m[1]))]
    .concat(['progRenderPainelDisp', 'progRenderEquipeRow', 'progValidarComposicao', 'progEfetuarDrop', 'progRenderQuadro', 'progRenderResumo', 'progFiltrarColsProgramacao', 'progMenuSlot']);
  // 8.1.171: aviso de placa divergente (saída da portaria × programação) — coberto em portaria-placa-reconferencia.test.js.
  // 8.1.208: CNH B para Delivery Express / 4x2 no menu do slot — coberto em cnh-delivery-express.test.js.
  const ALTERADAS_DEPOIS = ['progTmaHtmlOperacao', 'progMenuSlot'];
  const difs = nomesTma.filter(n => {
    if (ALTERADAS_DEPOIS.includes(n)) return false;
    const re = new RegExp('\\n(?:async )?function ' + n + '\\(');
    return blocoEm(base, re) !== blocoEm(html, re);
  });
  ok('TMA: ' + (nomesTma.length - ALTERADAS_DEPOIS.length) + ' funções idênticas à 8.1.169', difs.length === 0, difs);
  ok('TMA: PROG_STATUS/BLOQ_STATUS inalterados', blocoEm(base, /\nvar PROG_STATUS\s*=/) === blocoEm(html, /\nvar PROG_STATUS\s*=/)
    && /var BLOQ_STATUS = (\[[^\]]*\])/.exec(base)[1] === bloqMatch[1]);
}

(async () => {
  try {
    await testesOperacao();
    testesDisponibilidade();
    testesEstaticos();
  } catch (e) { failed.push('exceção: ' + (e && e.stack || e)); }
  if (failed.length) {
    console.error('FALHOU ' + failed.length + '/' + total + ':\n - ' + failed.join('\n - '));
    process.exit(1);
  }
  console.log('OK prog-projetos-disponibilidade-operacao: ' + total + ' verificações');
})();
