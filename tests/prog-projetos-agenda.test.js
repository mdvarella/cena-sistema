'use strict';
// 8.1.205 (Fila; na prévia era 8.1.203) — Jornada → data → fila de projetos → equipe. Sem banco (stubs de sbFetch/sbInsert/sbUpdate).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.join(__dirname, '..');
const failed = [];
let total = 0;
function ok(name, cond, detail){
  total++;
  if(!cond) failed.push(name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : ''));
}

function ymd(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function br(iso){ var p = iso.split('-'); return p[2]+'/'+p[1]+'/'+p[0]; }
const HOJE = ymd(new Date());
const AMANHA = (function(){ var d = new Date(); d.setDate(d.getDate()+1); return ymd(d); })();
const DEPOIS = (function(){ var d = new Date(); d.setDate(d.getDate()+5); return ymd(d); })();
const ONTEM = (function(){ var d = new Date(); d.setDate(d.getDate()-1); return ymd(d); })();

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const P3 = '33333333-3333-4333-8333-333333333333';
const CID = 'c0000000-0000-4000-8000-000000000001';
const EQA = 'e0000000-0000-4000-8000-00000000000a';
const EQB = 'e0000000-0000-4000-8000-00000000000b';
const EQX = 'e0000000-0000-4000-8000-0000000000ff';

// ── DOM mínimo ───────────────────────────────────────────────
function fakeDom(){
  const els = {};
  function mk(id){
    if(!els[id]) els[id] = {id:id, innerHTML:'', value:'', disabled:false, style:{}, querySelectorAll:function(){ return (this._btns||[]); }};
    return els[id];
  }
  return {els:els, mk:mk, document:{getElementById:function(id){ return els[id] || null; }}};
}

// ── Módulo agenda ────────────────────────────────────────────
const agendaSrc = fs.readFileSync(path.join(raiz, 'modules', 'projetos', 'agenda', 'prog-projetos-agenda.js'), 'utf8');
function sandboxAgenda(over){
  const dom = fakeDom();
  const sb = {console:console, document:dom.document, _dom:dom};
  sb.window = sb; sb.globalThis = sb;
  sb.dataHojeLocal = function(){ return HOJE; };
  sb.usuarioLogado = {nome:'Gestor Teste', perfil:'gestor'};
  sb.sot_projetos = [{id:P1, codigo_cliente:'DAC/S.SUL.22.00031', nome:'Obra Um', contrato_id:CID}];
  sb.equipes = [{id:EQA, nome_equipe:'LM-01'}, {id:EQB, nome_equipe:'LV-02'}];
  sb.contratos = [{id:CID, nome:'RDSE SUL'}];
  Object.assign(sb, over||{});
  vm.createContext(sb);
  vm.runInContext(agendaSrc, sb, {filename:'prog-projetos-agenda.js'});
  return sb;
}

const A = sandboxAgenda();
ok('fonte: sem composicao_dia gravada pelo módulo', !/sbInsert\(\s*['"]composicao_dia|sbUpdate\(\s*['"]composicao_dia/.test(agendaSrc));
ok('fonte: sem TMA/equipes_disp/plpt', !/progTma|equipes_disp|plpt_prog/.test(agendaSrc));
ok('fonte: gravações exigem sessão', (agendaSrc.match(/requireAuth:true/g)||[]).length >= 3);

ok('perfil gestor pode', A.progAgendaPerfilPode({perfil:'gestor'}) === true);
ok('perfil escritorio pode', A.progAgendaPerfilPode({perfil:'Escritorio '}) === true);
ok('perfil equipe não pode', A.progAgendaPerfilPode({perfil:'equipe'}) === false);
ok('perfil portaria não pode', A.progAgendaPerfilPode({perfil:'portaria'}) === false);
ok('sem usuário não pode', A.progAgendaPerfilPode(null) === false);
ok('lista de perfis igual à migration', JSON.stringify(A.PROG_AGENDA_PERFIS) === JSON.stringify(['admin','diretoria','gestor','coordenador','supervisor','administrativo','escritorio']));
const mig = fs.readFileSync(path.join(raiz, 'supabase', 'migrations', '20261004200000_prog_projetos_agenda.sql'), 'utf8');
ok('migration usa os mesmos perfis', mig.indexOf("IN ('admin','diretoria','gestor','coordenador','supervisor','administrativo','escritorio')") >= 0);

// montar fila
const ag = [
  {id:'a1', projeto_id:P1, data:AMANHA, status:'AGUARDANDO_EQUIPE'},
  {id:'a2', projeto_id:P2, data:AMANHA, status:'ALOCADO', equipe_id:EQA},
  {id:'a3', projeto_id:P3, data:AMANHA, status:'CANCELADO', cancelado_em:'x'},
  {id:'a4', projeto_id:P3, data:DEPOIS, status:'AGUARDANDO_EQUIPE'}
];
const comps = [
  {id:'c1', equipe_id:EQA, data:AMANHA, projeto_ids:JSON.stringify([P2]), confirmada:false},
  {id:'c2', equipe_id:EQB, data:AMANHA+'T00:00:00', projeto_ids:[P3], confirmada:'true'},
  {id:'c3', equipe_id:EQX, data:AMANHA, projeto_ids:JSON.stringify([P1]), confirmada:true},
  {id:'c4', equipe_id:EQA, data:AMANHA, projeto_ids:'{quebrado', confirmada:false, deleted_at:'x'}
];
const f = A.progAgendaMontarFila(ag, comps, AMANHA, [EQA, EQB]);
ok('fila: agendado sem equipe fica em A PROGRAMAR', f.aProgramar.length === 1 && f.aProgramar[0].projeto_id === P1, f.aProgramar);
ok('fila: equipe de outro contrato não tira o projeto da fila', f.aProgramar.some(function(r){ return r.projeto_id===P1; }));
ok('fila: projeto na composição não confirmada = EM COMPOSIÇÃO', f.programados.some(function(p){ return p.projeto_id===P2 && p.equipe_id===EQA && p.confirmada===false && p.agenda && p.agenda.id==='a2'; }), f.programados);
ok('fila: composição confirmada (texto true) = PROGRAMADO', f.programados.some(function(p){ return p.projeto_id===P3 && p.equipe_id===EQB && p.confirmada===true; }));
ok('fila: projeto na composição sem agendamento também aparece', f.programados.some(function(p){ return p.projeto_id===P3 && p.agenda===null; }));
ok('fila: cancelado e outra data ficam de fora', !f.aProgramar.some(function(r){ return r.id==='a3' || r.id==='a4'; }));
ok('fila: não duplica projeto em A PROGRAMAR', A.progAgendaMontarFila(ag.concat([{id:'a9', projeto_id:P1, data:AMANHA, status:'AGUARDANDO_EQUIPE'}]), [], AMANHA, [EQA]).aProgramar.length === 2);

// situação e conflito
const s1 = A.progAgendaSituacaoNoDia(P2, AMANHA, comps);
ok('situação: em composição', s1 && s1.tipo === 'em_composicao' && s1.equipe_id === EQA, s1);
ok('situação: programado', A.progAgendaSituacaoNoDia(P3, AMANHA, comps).tipo === 'programado');
ok('situação: nada', A.progAgendaSituacaoNoDia(P1, DEPOIS, comps) === null);

ok('conflito: livre', A.progAgendaAnalisarConflito([], [], P1, AMANHA, HOJE).tipo === 'livre');
const cMesma = A.progAgendaAnalisarConflito([{id:'x', projeto_id:P1, data:AMANHA, status:'AGUARDANDO_EQUIPE'}], [], P1, AMANHA, HOJE);
ok('conflito: mesma data', cMesma.tipo === 'mesma_data' && cMesma.row.id === 'x');
const cOutra = A.progAgendaAnalisarConflito([{id:'y', projeto_id:P1, data:DEPOIS, status:'AGUARDANDO_EQUIPE'}], [], P1, AMANHA, HOJE);
ok('conflito: outra data pendente', cOutra.tipo === 'outras_datas' && cOutra.pendentes.length === 1 && cOutra.datas[0] === DEPOIS, cOutra);
const cComp = A.progAgendaAnalisarConflito([], [{id:'c', equipe_id:EQA, data:AMANHA, projeto_ids:[P1], confirmada:true}], P1, AMANHA, HOJE);
ok('conflito: já na composição do dia', cComp.tipo === 'na_programacao' && cComp.situacao.tipo === 'programado');
const cCompOutra = A.progAgendaAnalisarConflito(
  [{id:'z', projeto_id:P1, data:DEPOIS, status:'ALOCADO', equipe_id:EQA}],
  [{id:'c', equipe_id:EQA, data:DEPOIS, projeto_ids:[P1], confirmada:false}], P1, AMANHA, HOJE);
ok('conflito: outra data já em equipe não é oferecida para alterar', cCompOutra.tipo === 'outras_datas' && cCompOutra.pendentes.length === 0 && cCompOutra.composicoes.length === 1, cCompOutra);
ok('conflito: data antiga não conta', A.progAgendaAnalisarConflito([{id:'o', projeto_id:P1, data:ONTEM, status:'AGUARDANDO_EQUIPE'}], [], P1, AMANHA, HOJE).tipo === 'livre');
ok('conflito: cancelado não conta', A.progAgendaAnalisarConflito([{id:'k', projeto_id:P1, data:AMANHA, status:'CANCELADO'}], [], P1, AMANHA, HOJE).tipo === 'livre');

// leitura
(async function(){
  let pedido = null;
  const L = sandboxAgenda({sbFetch:function(t, o){ pedido = {t:t, o:o}; return Promise.resolve([{id:'r'}]); }});
  const sl = await L.progAgendaListarData(CID, AMANHA);
  ok('leitura do dia: tabela e filtros', pedido.t === 'prog_projetos_agenda' && pedido.o.requireAuth === true
    && pedido.o.filters.indexOf('contrato_id=eq.'+CID) >= 0 && pedido.o.filters.indexOf('data=eq.'+AMANHA) >= 0
    && pedido.o.filters.indexOf('deleted_at=is.null') >= 0 && pedido.o.filters.indexOf('status=neq.CANCELADO') >= 0, pedido);
  ok('leitura do dia: conhecida', sl.known === true && sl.rows.length === 1);
  const L2 = sandboxAgenda({sbFetch:function(){ return Promise.resolve(null); }});
  ok('leitura com erro fica desconhecida (não vira fila vazia)', (await L2.progAgendaListarData(CID, AMANHA)).known === false);
  ok('leitura sem contrato não consulta', (await L.progAgendaListarData('', AMANHA)).known === false);
  let pc = null;
  const L3 = sandboxAgenda({sbFetch:function(t, o){ pc = o; return Promise.resolve([
    {id:'c1', data:AMANHA, equipe_id:EQA, projeto_ids:JSON.stringify([P1]), confirmada:false},
    {id:'c2', data:AMANHA, equipe_id:EQB, projeto_ids:JSON.stringify([P1+'x']), confirmada:false}
  ]); }});
  const cs = await L3.progAgendaComposicoesProjeto(P1, HOJE);
  ok('composições do projeto: confere o UUID exato', cs.known && cs.rows.length === 1 && cs.rows[0].id === 'c1' && pc.filters.indexOf('data=gte.'+HOJE) >= 0, cs);

  // gravação
  let ins = null;
  const G = sandboxAgenda({sbInsert:function(t, d, o){ ins = {t:t, d:d, o:o}; return Promise.resolve([Object.assign({id:'novo'}, d)]); }});
  const r1 = await G.progAgendaCriar({id:P1, contrato_id:CID}, AMANHA, 'jornada');
  ok('criar: grava projeto + data sem equipe', r1.ok && ins.t === 'prog_projetos_agenda' && ins.d.projeto_id === P1 && ins.d.data === AMANHA && ins.d.contrato_id === CID && !('equipe_id' in ins.d) && !('status' in ins.d) && ins.d.origem === 'jornada', ins);
  ok('criar: sessão obrigatória e mensagens próprias', ins.o.requireAuth === true && ins.o.silent === true);
  ok('criar: autor pelo nome do login', ins.d.criado_por === 'Gestor Teste');
  ins = null;
  const r2 = await G.progAgendaCriar({id:P1, contrato_id:CID}, ONTEM, 'jornada');
  ok('criar: data passada nem chega no banco', r2.ok === false && ins === null);
  const r3 = await G.progAgendaCriar({id:P1, contrato_id:CID}, '', 'jornada');
  ok('criar: sem data não grava', r3.ok === false && ins === null);
  const D = sandboxAgenda({sbInsert:function(){ D._sbLastInsertErr = '{"code":"23505","message":"duplicate key value violates unique constraint \\"prog_projetos_agenda_projeto_data_uidx\\""}'; return Promise.resolve(null); }});
  const r4 = await D.progAgendaCriar({id:P1, contrato_id:CID}, AMANHA, 'jornada');
  ok('criar: duplicado (23505) vira aviso de mesma data', r4.ok === false && r4.duplicado === true && r4.erro.indexOf(br(AMANHA)) >= 0, r4);
  const N = sandboxAgenda({sbInsert:function(){ N._sbLastInsertErr = '{"code":"42501","message":"new row violates row-level security policy"}'; return Promise.resolve(null); }});
  const r5 = await N.progAgendaCriar({id:P1, contrato_id:CID}, AMANHA, 'jornada');
  ok('criar: RLS negado vira mensagem de permissão', r5.ok === false && /permissão/.test(r5.erro), r5);

  let up = null;
  const U = sandboxAgenda({sbUpdate:function(t, d, fl, o){ up = {t:t, d:d, f:fl, o:o}; return Promise.resolve([{id:'x'}]); }});
  ok('cancelar: status CANCELADO com sessão', await U.progAgendaCancelar({id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}) === true
    && up.d.status === 'CANCELADO' && up.f === 'id=eq.aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' && up.o.requireAuth === true && up.o.linhas === true, up);
  await U.progAgendaSincronizarAlocacao(P1, AMANHA, EQA);
  ok('alocar: ALOCADO com a equipe, só no agendamento ativo do dia', up.d.status === 'ALOCADO' && up.d.equipe_id === EQA
    && up.f === 'projeto_id=eq.'+P1+'&data=eq.'+AMANHA+'&deleted_at=is.null&status=neq.CANCELADO', up);
  await U.progAgendaSincronizarAlocacao(P1, AMANHA, null);
  ok('desalocar: volta a AGUARDANDO_EQUIPE sem equipe', up.d.status === 'AGUARDANDO_EQUIPE' && up.d.equipe_id === null);
  const U0 = sandboxAgenda({sbUpdate:function(){ return Promise.resolve([]); }});
  ok('alocar sem agendamento: não faz nada e não quebra', await U0.progAgendaSincronizarAlocacao(P1, AMANHA, EQA) === false);

  // modal
  async function abrirModal(fetchAgenda, fetchComp, insertRet){
    const chamadas = {ins:[], upd:[], fetch:[]};
    const M = sandboxAgenda({
      sbFetch:function(t, o){ chamadas.fetch.push(t); return Promise.resolve(t==='prog_projetos_agenda' ? fetchAgenda : fetchComp); },
      sbInsert:function(t, d){ chamadas.ins.push(d); return Promise.resolve(insertRet===undefined ? [Object.assign({id:'n'}, d)] : insertRet); },
      sbUpdate:function(t, d, fl){ chamadas.upd.push({d:d, f:fl, depoisDeInserir:chamadas.ins.length>0}); return Promise.resolve([{id:'u'}]); },
      closeModal:function(){ M._fechou = true; }
    });
    M.setModal = function(html){ M._html = html; ['pa-msg','pa-acoes','pa-data','pa-hoje','pa-amanha'].forEach(M._dom.mk); };
    M.progAgendaPedirData({id:P1, contrato_id:CID, codigo_cliente:'DAC/S.SUL.22.00031', nome:'Obra Um'});
    return {M:M, c:chamadas, msg:function(){ return M._dom.els['pa-msg'].innerHTML; }, acoes:function(){ return M._dom.els['pa-acoes'].innerHTML; }};
  }
  const tick = function(){ return new Promise(function(r){ setTimeout(r, 0); }); };

  let m = await abrirModal([], []);
  ok('modal: pergunta a data', /Para qual data deseja programar esta execução\?/.test(m.M._html));
  ok('modal: mostra projeto e contrato', /DAC\/S\.SUL\.22\.00031/.test(m.M._html) && /RDSE SUL/.test(m.M._html));
  ok('modal: Hoje, Amanhã e calendário', /Hoje/.test(m.M._html) && /Amanhã/.test(m.M._html) && /type="date"/.test(m.M._html));
  ok('modal: calendário não vem preenchido', !/id="pa-data"[^>]*value=/.test(m.M._html));
  ok('modal: botões Cancelar e Enviar', /Cancelar/.test(m.acoes()) && /Enviar para Programação/.test(m.acoes()));
  m.M.progAgendaModalEnviar();
  await tick();
  ok('modal: sem data não grava nada', m.c.ins.length === 0 && m.c.fetch.length === 0 && /obrigatória/.test(m.msg()));
  m.M.progAgendaModalEscolher(ONTEM);
  m.M.progAgendaModalEnviar();
  await tick();
  ok('modal: data passada não grava', m.c.ins.length === 0);
  m.M.progAgendaModalEscolher('amanha');
  ok('modal: Amanhã preenche o calendário', m.M._dom.els['pa-data'].value === AMANHA);
  m.M.progAgendaModalEnviar();
  await tick(); await tick(); await tick();
  ok('modal: livre grava a data escolhida', m.c.ins.length === 1 && m.c.ins[0].data === AMANHA, m.c.ins);
  ok('modal: confere agenda e composição antes de gravar', m.c.fetch.indexOf('prog_projetos_agenda') >= 0 && m.c.fetch.indexOf('composicao_dia') >= 0);
  ok('modal: sucesso diz aguardando equipe e oferece abrir programação', /AGUARDANDO EQUIPE/.test(m.msg()) && /Abrir programação/.test(m.acoes()), m.msg());

  m = await abrirModal([{id:'x', projeto_id:P1, data:AMANHA, status:'AGUARDANDO_EQUIPE'}], []);
  m.M.progAgendaModalEscolher('amanha'); m.M.progAgendaModalEnviar();
  await tick(); await tick(); await tick();
  ok('modal: mesma data não duplica', m.c.ins.length === 0 && m.msg().indexOf('Este projeto já está aguardando programação para <b>'+br(AMANHA)+'</b>') >= 0 && /Abrir programação/.test(m.acoes()), m.msg());

  const Y = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  m = await abrirModal([{id:Y, projeto_id:P1, data:DEPOIS, status:'AGUARDANDO_EQUIPE'}], []);
  m.M.progAgendaModalEscolher('amanha'); m.M.progAgendaModalEnviar();
  await tick(); await tick(); await tick();
  ok('modal: outra data pergunta', m.c.ins.length === 0 && m.msg().indexOf('Este projeto já está previsto para <b>'+br(DEPOIS)+'</b>') >= 0, m.msg());
  ok('modal: opções manter, alterar, adicionar, cancelar', /Manter data/.test(m.acoes()) && /Alterar para/.test(m.acoes()) && /Adicionar mais esta data/.test(m.acoes()) && /Cancelar/.test(m.acoes()), m.acoes());
  m.M.progAgendaModalResolver('alterar');
  for(let i = 0; i < 8; i++) await tick();
  ok('modal: alterar grava a nova data antes de cancelar a antiga', m.c.ins.length === 1 && m.c.ins[0].data === AMANHA && m.c.upd.length === 1 && m.c.upd[0].d.status === 'CANCELADO' && m.c.upd[0].f === 'id=eq.'+Y && m.c.upd[0].depoisDeInserir === true, m.c);

  m = await abrirModal([{id:Y, projeto_id:P1, data:DEPOIS, status:'AGUARDANDO_EQUIPE'}], []);
  m.M.progAgendaModalEscolher('amanha'); m.M.progAgendaModalEnviar();
  await tick(); await tick(); await tick();
  m.M.progAgendaModalResolver('adicionar');
  await tick(); await tick(); await tick();
  ok('modal: adicionar mantém a outra data', m.c.ins.length === 1 && m.c.upd.length === 0);

  m = await abrirModal([], [{id:'c', equipe_id:EQA, data:AMANHA, projeto_ids:JSON.stringify([P1]), confirmada:false}]);
  m.M.progAgendaModalEscolher('amanha'); m.M.progAgendaModalEnviar();
  await tick(); await tick(); await tick();
  ok('modal: já em composição no dia mostra equipe e status', m.c.ins.length === 0 && /LM-01/.test(m.msg()) && /EM COMPOSIÇÃO/.test(m.msg()), m.msg());

  m = await abrirModal(null, []);
  m.M.progAgendaModalEscolher('amanha'); m.M.progAgendaModalEnviar();
  await tick(); await tick(); await tick();
  ok('modal: leitura falhou = fail-closed', m.c.ins.length === 0 && /Nada foi gravado/.test(m.msg()), m.msg());

  const semPerfil = sandboxAgenda({usuarioLogado:{perfil:'equipe'}, progShowToast:function(t){ semPerfil._toast = t; }});
  semPerfil.setModal = function(){ semPerfil._abriu = true; };
  semPerfil.progAgendaPedirData({id:P1, contrato_id:CID});
  ok('modal: perfil sem permissão não abre', !semPerfil._abriu && /perfil/.test(semPerfil._toast||''));

  // ── Jornada ──────────────────────────────────────────────────
  const dirJ = path.join(raiz, 'modules', 'projetos', 'jornada');
  const arqsJ = ['jornada-profiles.js','jornada-resolver.js','jornada-state.js','jornada-actions.js','jornada-ui.js','jornada.js'];
  function sandboxJornada(over){
    const sb = {console:console, document:{getElementById:function(){ return null; }}};
    sb.window = sb; sb.globalThis = sb;
    sb.dataHojeLocal = function(){ return HOJE; };
    sb.equipes = [{id:EQA, nome_equipe:'LM-01'}];
    Object.assign(sb, over||{});
    vm.createContext(sb);
    arqsJ.forEach(function(fn){ vm.runInContext(fs.readFileSync(path.join(dirJ, fn), 'utf8'), sb, {filename:fn}); });
    return sb;
  }
  function ctxJ(over){
    const base = {contrato:null,
      atividades:{loaded:true, known:true, rows:[{qtd_prevista:10, qtd_executada:0, qtd_medida:0, valor_unitario:1, status:'pendente'}]},
      materiais:{loaded:true, known:true, rows:[]}, documentos:{loaded:true, known:true, rows:[]},
      medicoes:{loaded:true, known:true, rows:[]}, programacao:{loaded:true, known:true, rows:[]},
      requisicoes:{loaded:true, known:true, rows:[]}, adicionais:{loaded:true, known:true, rows:[]}};
    Object.keys(over||{}).forEach(function(k){ base[k] = over[k]; });
    return base;
  }
  const J = sandboxJornada();
  const pj = {id:P1, status:'Recebido', contrato_id:CID};
  const eAg = J.jornadaDerivarEstado(pj, ctxJ({agenda:{loaded:true, known:true, rows:[{projeto_id:P1, data:AMANHA, status:'AGUARDANDO_EQUIPE'}]}}));
  ok('Jornada: data escolhida = aguardando definição de equipe', eAg.programacaoDetalhe && eAg.programacaoDetalhe.tipo === 'aguardando_equipe' && eAg.programacaoDetalhe.texto === 'Execução aguardando definição de equipe — '+br(AMANHA), eAg.programacaoDetalhe);
  ok('Jornada: data escolhida não programa', eAg.fases[1].itens[0].estado !== 'concluida' && J.jornadaObterProximaAcao(pj, eAg).id === 'programar_execucao');
  const eComp = J.jornadaDerivarEstado(pj, ctxJ({programacao:{loaded:true, known:true, rows:[{origem:'composicao', equipe_id:EQA, data:AMANHA, confirmada:false, projeto_ids:[P1]}]},
    agenda:{loaded:true, known:true, rows:[{projeto_id:P1, data:AMANHA, status:'ALOCADO', equipe_id:EQA}]}}));
  ok('Jornada: composição em aberto', /^Programação em composição — LM-01 \(/.test(eComp.programacaoDetalhe.texto) && /não confirmada/.test(eComp.programacaoDetalhe.texto), eComp.programacaoDetalhe);
  ok('Jornada: composição em aberto mantém a regra homologada', J.jornadaObterProximaAcao(pj, eComp).id === 'programar_execucao' && /não confirmada/.test(eComp.fases[1].itens[0].texto));
  const eConf = J.jornadaDerivarEstado(pj, ctxJ({programacao:{loaded:true, known:true, rows:[{origem:'composicao', equipe_id:EQA, data:AMANHA, confirmada:true, projeto_ids:[P1]}]}}));
  ok('Jornada: programada com data e equipe', eConf.programacaoDetalhe.texto === 'Execução programada para '+br(AMANHA)+' — LM-01', eConf.programacaoDetalhe);
  ok('Jornada: programada segue aguardar execução', J.jornadaObterProximaAcao(pj, eConf).id === 'aguardar_execucao');
  ok('Jornada: agenda desconhecida não muda nada', J.jornadaDerivarEstado(pj, ctxJ({agenda:{loaded:true, known:false, rows:null}})).programacaoDetalhe === null);
  ok('Jornada: agenda de data passada não aparece', J.jornadaDerivarEstado(pj, ctxJ({agenda:{loaded:true, known:true, rows:[{projeto_id:P1, data:ONTEM, status:'AGUARDANDO_EQUIPE'}]}})).programacaoDetalhe === null);
  const htmlAg = J.jornadaHtml(pj, ctxJ({agenda:{loaded:true, known:true, rows:[{projeto_id:P1, data:AMANHA, status:'AGUARDANDO_EQUIPE'}]}}));
  ok('Jornada: tela mostra o texto da fila', htmlAg.indexOf('Execução aguardando definição de equipe') >= 0);

  let pediu = null, abriuPagina = null;
  const J2 = sandboxJornada({progAgendaPedirData:function(p){ pediu = p; }, showPage:function(pg){ abriuPagina = pg; }});
  J2.jornadaExecutarAcao({id:'programar_execucao'}, pj);
  ok('Jornada: Programar execução pede a data', pediu === pj && abriuPagina === null);
  pediu = null; J2.jornadaExecutarAcao({id:'continuar_execucao'}, pj);
  ok('Jornada: Continuar execução pede a data', pediu === pj && abriuPagina === null);
  pediu = null; J2.jornadaExecutarAcao({id:'programar_proxima'}, pj);
  ok('Jornada: Programar próxima pede a data', pediu === pj);
  pediu = null; J2.jornadaAbrirProgramacao(pj);
  ok('Jornada: abrir programação sem data não presume hoje', pediu === pj && abriuPagina === null);

  const elsJ = {'pp-cont':{value:''}, 'pp-proj-lista':{innerHTML:''}, 'pp-data':{value:''}};
  let invalidou = false;
  const J3 = sandboxJornada({showPage:function(pg){ abriuPagina = pg; }, _pp:{projetoIds:[]}, ppFilaInvalidar:function(){ invalidou = true; },
    document:{getElementById:function(id){ return elsJ[id] || null; }}});
  elsJ['pp-cont'].value = CID;
  J3.jornadaAbrirProgramacao(pj, DEPOIS);
  ok('Jornada: abre a programação na data escolhida', abriuPagina === 'programacao-projetos' && J3._pp.data === DEPOIS && elsJ['pp-data'].value === DEPOIS && J3._pp.cid === CID);
  ok('Jornada: não injeta o projeto no filtro do topo (não alimenta Auto Escalar)', J3._pp.projetoIds.length === 0 && J3._pp.filaDestaque === P1);
  ok('Jornada: descarta o cache da fila ao abrir', invalidou === true);
  abriuPagina = null;
  const J4 = sandboxJornada({showPage:function(pg){ abriuPagina = pg; }, _pp:{}, document:{getElementById:function(id){ return elsJ[id] || null; }}});
  J4._jornadaDetalheProgramacao = {tipo:'programado', data:DEPOIS};
  J4.jornadaExecutarAcao({id:'aguardar_execucao'}, pj);
  ok('Jornada: aguardar execução abre a programação na data programada', abriuPagina === 'programacao-projetos' && J4._pp.data === DEPOIS);

  let pedAg = null;
  const J5 = sandboxJornada({DEMO:false, composicao_dia:[], sbFetch:function(t, o){
    if(t==='prog_projetos_agenda'){ pedAg = o; return null; }
    if(t==='composicao_dia') return [];
    return [];
  }});
  const ex = await J5.jornadaCarregarExtras(P1);
  ok('Jornada: lê a agenda do projeto com sessão, só ativos de hoje em diante', pedAg && pedAg.requireAuth === true
    && pedAg.filters.indexOf('projeto_id=eq.'+P1) >= 0 && pedAg.filters.indexOf('status=neq.CANCELADO') >= 0 && pedAg.filters.indexOf('data=gte.'+HOJE) >= 0, pedAg);
  ok('Jornada: falha na agenda não derruba a programação', ex.agenda.known === false && ex.programacao.known === true);
  const fontesJ = arqsJ.map(function(fn){ return fs.readFileSync(path.join(dirJ, fn), 'utf8'); }).join('\n');
  ok('Jornada: continua sem gravar', !/sbInsert|sbUpdate|sbDelete|sbUpsert/.test(fontesJ));
  ok('Jornada: não toca em _pp.projetoIds', fontesJ.indexOf('projetoIds') < 0);

  // ── index.html ───────────────────────────────────────────────
  const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
  function fn(nome){
    const m = new RegExp('\\n(?:async )?function ' + nome + '\\(').exec(html);
    if(!m) throw new Error('função não encontrada: ' + nome);
    const ini = m.index + 1;
    const fim = html.indexOf('\n}\n', ini);
    return html.slice(ini, fim + 2);
  }
  const num = (/numero: '8\.1\.(\d+)'/.exec(html) || [])[1];
  const iAg = html.indexOf('modules/projetos/agenda/prog-projetos-agenda.js?v=8.1.' + num + '"');
  ok('index: carrega o módulo da agenda', iAg > 0 && iAg < html.indexOf('modules/projetos/jornada/jornada.js?v=8.1.' + num + '"'), num);
  const sw = fs.readFileSync(path.join(raiz, 'sw.js'), 'utf8');
  ok('SW: módulo no precache', sw.indexOf("'./modules/projetos/agenda/prog-projetos-agenda.js'") >= 0);
  ok('versão >= 8.1.205 com log da fusão', Number(num) >= 205 && ["{v:'8.1.205'", "{v:'8.1.204'", "{v:'8.1.202'"].every(function(v){ return html.indexOf(v) >= 0; }), num);
  ok('SW na versão atual', sw.indexOf("const SW_VERSION   = 'cena-8.1." + num + "';") >= 0, num);

  const blocoFila = html.slice(html.indexOf('// FILA "PROJETOS A PROGRAMAR"'), html.indexOf('// MODO MOBILE — PROGRAMAÇÃO DE PROJETOS'));
  ok('fila: sem TMA, equipes_disp ou plpt', blocoFila.length > 1000 && !/progTma|equipes_disp|plpt_/.test(blocoFila));
  ok('fila: não grava composicao_dia direto (usa o motor)', !/sbInsert|sbUpdate|sbUpsert/.test(blocoFila) && blocoFila.indexOf('progProjetoCoreAlterarProjetosEquipe(eqId, data, {add: [pid]})') >= 0);
  ok('quadro desenha a fila', fn('_progProjRenderQuadroInterno').indexOf('ppFilaRender(data, cid);') >= 0);
  ok('mobile também mostra a fila', fn('ppMobileRenderLista').indexOf('pp-fila-mob') >= 0 && fn('ppMobileRenderLista').indexOf('ppFilaRender(data, cid)') >= 0);
  ok('Atualizar descarta o cache da fila', fn('progProjAtualizarQuadro').indexOf('ppFilaInvalidar();') >= 0);
  ok('linha da equipe oferece Colocar aqui', fn('progProjetoCoreRenderEquipeRow').indexOf('ppFilaColocarNaEquipe(') >= 0);

  // motor
  function sandboxMotor(over){
    const sb = {console:console, DEMO:false, composicao_dia:[], _pp:{projetoIds:[]}};
    sb.window = sb; sb.globalThis = sb;
    sb.parseJsonField = function(val, def){ if(!val) return def; if(typeof val==='string'){ try{ return JSON.parse(val); }catch(e){ return def; } } return val; };
    sb.progFindCompDia = function(eqId, data){ return sb.composicao_dia.find(function(c){ return c.equipe_id===eqId && String(c.data).split('T')[0]===data; }) || null; };
    Object.assign(sb, over||{});
    vm.createContext(sb);
    ['progProjetoCoreListaProjetos','progProjetoCoreUniaoProjetos','progProjetoCoreAlterarProjetosEquipe','progProjetoCorePersistirComposicao']
      .forEach(function(n){ vm.runInContext(fn(n), sb); });
    return sb;
  }
  const w = {ins:[], upd:[], fet:[]};
  const S1 = sandboxMotor({
    sbFetch:function(t, o){ w.fet.push(o); return Promise.resolve([{id:'srv1', equipe_id:EQA, data:AMANHA, projeto_ids:JSON.stringify([P2, P3]), colaborador_ids:'["c1"]', confirmada:false}]); },
    sbUpdate:function(t, d, f, o){ w.upd.push({t:t, d:d, f:f, o:o}); return Promise.resolve([{id:'srv1'}]); },
    sbInsert:function(t, d){ w.ins.push(d); return Promise.resolve([{id:'novo'}]); }
  });
  S1.composicao_dia.push({id:'srv1', equipe_id:EQA, data:AMANHA, projeto_ids:JSON.stringify([P2]), colaborador_ids:['c1'], confirmada:false});
  ok('motor: inclui projeto', await S1.progProjetoCoreAlterarProjetosEquipe(EQA, AMANHA, {add:[P1]}) === true);
  ok('motor: lê o banco antes e preserva projeto gravado por outro usuário', w.upd.length === 1 && w.upd[0].t === 'composicao_dia' && w.upd[0].d.projeto_ids === JSON.stringify([P2, P3, P1]) && w.upd[0].f === 'id=eq.srv1', w.upd);
  ok('motor: só mexe em projeto_ids (não confirma, não troca colaboradores)', Object.keys(w.upd[0].d).join() === 'projeto_ids' && w.upd[0].o.linhas === true);
  ok('motor: lê só linha viva', w.fet[0].filters.indexOf('deleted_at=is.null') >= 0 && w.fet[0].filters.indexOf('id=eq.srv1') >= 0);
  ok('motor: memória atualizada', S1.composicao_dia[0].projeto_ids === JSON.stringify([P2, P3, P1]));
  await S1.progProjetoCoreAlterarProjetosEquipe(EQA, AMANHA, {remove:[P3]});
  ok('motor: retira projeto pelo estado do banco sem perder os outros', w.upd[1].d.projeto_ids === JSON.stringify([P2]), w.upd[1]);

  const w2 = {ins:[]};
  const S2 = sandboxMotor({
    sbFetch:function(){ return Promise.resolve([]); },
    sbUpdate:function(){ throw new Error('não devia atualizar'); },
    sbInsert:function(t, d){ w2.ins.push({t:t, d:d}); return Promise.resolve([{id:'novo'}]); }
  });
  ok('motor: equipe sem composição no dia ganha composição em aberto', await S2.progProjetoCoreAlterarProjetosEquipe(EQB, AMANHA, {add:[P1]}) === true
    && w2.ins.length === 1 && w2.ins[0].t === 'composicao_dia' && w2.ins[0].d.equipe_id === EQB && w2.ins[0].d.data === AMANHA
    && w2.ins[0].d.confirmada === false && w2.ins[0].d.projeto_ids === JSON.stringify([P1]), w2.ins);
  ok('motor: composição criada entra na memória com id do banco', S2.composicao_dia.length === 1 && S2.composicao_dia[0].id === 'novo');
  const S2b = sandboxMotor({sbFetch:function(){ return Promise.resolve([]); }, sbInsert:function(){ throw new Error('não devia inserir'); }});
  ok('motor: retirar sem composição no banco não cria linha', await S2b.progProjetoCoreAlterarProjetosEquipe(EQB, AMANHA, {remove:[P1]}) === true);

  let escreveu = false;
  const S3 = sandboxMotor({sbFetch:function(){ return Promise.resolve(null); }, sbUpdate:function(){ escreveu = true; }, sbInsert:function(){ escreveu = true; }});
  S3.composicao_dia.push({id:'srv1', equipe_id:EQA, data:AMANHA, projeto_ids:'[]'});
  ok('motor: leitura falhou = não grava (fail-closed)', await S3.progProjetoCoreAlterarProjetosEquipe(EQA, AMANHA, {add:[P1]}) === false && !escreveu && S3.composicao_dia[0].projeto_ids === '[]');
  const S4 = sandboxMotor({sbFetch:function(){ return Promise.resolve([{id:'srv1', projeto_ids:'[]'}]); }, sbUpdate:function(){ return Promise.resolve([]); }});
  S4.composicao_dia.push({id:'srv1', equipe_id:EQA, data:AMANHA, projeto_ids:'[]'});
  ok('motor: update sem linha afetada = falha', await S4.progProjetoCoreAlterarProjetosEquipe(EQA, AMANHA, {add:[P1]}) === false && S4.composicao_dia[0].projeto_ids === '[]');

  const wp = {upd:[]};
  const S5 = sandboxMotor({sbUpdate:function(t, d){ wp.upd.push(d); return true; }, sbInsert:function(){ return Promise.resolve([{id:'x'}]); }});
  S5.composicao_dia.push({id:'srv9', equipe_id:EQA, data:AMANHA, projeto_ids:JSON.stringify([P2]), colaborador_ids:'[]', confirmada:false});
  S5.progProjetoCorePersistirComposicao(EQA, AMANHA, ['c1','c2']);
  ok('Auto Escalar: não apaga os projetos já vinculados', wp.upd[0].projeto_ids === JSON.stringify([P2]), wp.upd);
  S5._pp.projetoIds = [P1];
  S5.progProjetoCorePersistirComposicao(EQA, AMANHA, ['c1','c2']);
  ok('Auto Escalar: soma os projetos filtrados no topo', wp.upd[1].projeto_ids === JSON.stringify([P2, P1]), wp.upd);

  // fila desenhada e alocação por clique
  function sandboxFila(over){
    const sb = sandboxAgenda(Object.assign({DEMO:false}, over||{}));
    sb._pp = {_horaExtraAuth:{}};
    sb.composicao_dia = [];
    sb.parseJsonField = function(val, def){ if(!val) return def; if(typeof val==='string'){ try{ return JSON.parse(val); }catch(e){ return def; } } return val; };
    sb.progFindCompDia = function(eqId, data){ return sb.composicao_dia.find(function(c){ return c.equipe_id===eqId && String(c.data).split('T')[0]===data; }) || null; };
    sb.progCompEstaProgramada = function(c){ return !!c && (c.confirmada===true || c.confirmada==='true'); };
    sb.equipes = [{id:EQA, nome_equipe:'LM-01'}, {id:EQB, nome_equipe:'LV-02'}, {id:EQX, nome_equipe:'LM-09'}];
    sb.progProjetoCoreGetEquipes = function(){ return sb.equipes; };
    sb.equipeEstaEmFolga = function(eq){ return eq.id === EQX; };
    sb.toasts = [];
    sb.progShowToast = function(t){ sb.toasts.push(t); };
    ['progProjetoCoreListaProjetos','ppFilaEquipesElegiveis','ppFilaEsc','ppFilaPintar','ppFilaSincronizarProjeto','ppFilaColocarNaEquipe','ppFilaSelecionar','ppFilaCancelarSelecao']
      .forEach(function(n){ vm.runInContext(fn(n), sb); });
    return sb;
  }
  const F = sandboxFila();
  F.sot_projetos.push({id:P2, codigo_cliente:'OBRA-2'});
  F.composicao_dia.push({id:'c1', equipe_id:EQA, data:AMANHA, projeto_ids:JSON.stringify([P2]), confirmada:false});
  F.composicao_dia.push({id:'c2', equipe_id:EQB, data:AMANHA, projeto_ids:JSON.stringify([P3]), confirmada:true});
  const host = {innerHTML:''};
  F.ppFilaPintar([host], AMANHA, CID, {known:true, rows:[
    {id:'a1', projeto_id:P1, data:AMANHA, status:'AGUARDANDO_EQUIPE'},
    {id:'a2', projeto_id:P2, data:AMANHA, status:'ALOCADO', equipe_id:EQA}
  ]});
  ok('tela: PROJETOS A PROGRAMAR com o projeto aguardando', /PROJETOS A PROGRAMAR — /.test(host.innerHTML) && host.innerHTML.indexOf('DAC/S.SUL.22.00031') >= 0 && /A PROGRAMAR · AGUARDANDO EQUIPE/.test(host.innerHTML), host.innerHTML.slice(0, 400));
  ok('tela: PROGRAMADOS separado com projeto — equipe', /PROGRAMADOS \/ EM COMPOSIÇÃO \(2\)/.test(host.innerHTML) && host.innerHTML.indexOf('⏳ OBRA-2 — LM-01') >= 0 && host.innerHTML.indexOf('— LV-02') >= 0);
  ok('tela: projeto em composição não aparece em A PROGRAMAR', (host.innerHTML.match(/A PROGRAMAR · AGUARDANDO EQUIPE/g)||[]).length === 1);
  ok('tela: EM COMPOSIÇÃO até confirmar, PROGRAMADO depois', /EM COMPOSIÇÃO — confirme a equipe/.test(host.innerHTML) && />PROGRAMADO</.test(host.innerHTML));

  F.ppFilaPintar([host], AMANHA, CID, {known:false, rows:null});
  ok('tela: leitura falhou avisa e não inventa fila', /Não foi possível ler os projetos a programar/.test(host.innerHTML) && !/AGUARDANDO EQUIPE/.test(host.innerHTML));

  F.progProjRenderQuadro = function(){};
  F._ppMobileAtivo = false;
  F.ppFilaRepintar = function(){};
  F._pp.filaData = AMANHA; F._pp.filaCid = CID;
  F.ppFilaSelecionar(P1);
  ok('selecionar: guarda o projeto escolhido', F._pp.filaSel === P1);
  F.ppFilaPintar([host], AMANHA, CID, {known:true, rows:[{id:'a1', projeto_id:P1, data:AMANHA, status:'AGUARDANDO_EQUIPE'}]});
  ok('selecionar: pede a equipe', /Selecione a equipe para este projeto\./.test(host.innerHTML));
  ok('selecionar: equipe elegível clicável', host.innerHTML.indexOf("ppFilaColocarNaEquipe('"+EQA+"')") >= 0);
  ok('selecionar: equipe de folga aparece desabilitada com motivo', host.innerHTML.indexOf("ppFilaColocarNaEquipe('"+EQX+"')") < 0 && /Folga pela escala/.test(host.innerHTML));

  const chamadas = {mot:[], sync:[]};
  F.progProjetoCoreAlterarProjetosEquipe = function(eq, d, mud){ chamadas.mot.push({eq:eq, d:d, mud:mud}); F.composicao_dia[0].projeto_ids = JSON.stringify([P2, P1]); return Promise.resolve(true); };
  F.progAgendaSincronizarAlocacao = function(pid, d, eq){ chamadas.sync.push({pid:pid, d:d, eq:eq}); return Promise.resolve(true); };
  F.ppFilaInvalidar = function(){};
  F.confirm = function(){ F._perguntou = true; return false; };
  F.dataHojeLocal = function(){ return HOJE; };
  F.ppFilaColocarNaEquipe(EQX);
  ok('alocar: equipe de folga é recusada', chamadas.mot.length === 0 && F.toasts.some(function(t){ return /Folga/.test(t); }));
  F.ppFilaColocarNaEquipe(EQB);
  ok('alocar: equipe já confirmada pergunta antes', F._perguntou === true && chamadas.mot.length === 0);
  F.ppFilaColocarNaEquipe(EQA);
  await tick(); await tick(); await tick();
  ok('alocar: usa o motor existente para pôr o projeto na equipe', chamadas.mot.length === 1 && chamadas.mot[0].eq === EQA && chamadas.mot[0].d === AMANHA && chamadas.mot[0].mud.add[0] === P1, chamadas.mot);
  ok('alocar: fila acompanha (ALOCADO na equipe)', chamadas.sync.length === 1 && chamadas.sync[0].eq === EQA && chamadas.sync[0].pid === P1, chamadas.sync);
  ok('alocar: seleção limpa e aviso de EM COMPOSIÇÃO', F._pp.filaSel === null && F.toasts.some(function(t){ return /EM COMPOSIÇÃO — LM-01/.test(t); }), F.toasts);

  const Fp = sandboxFila();
  Fp._pp.filaData = ONTEM; Fp._pp.filaCid = CID; Fp._pp.filaSel = P1;
  Fp.progProjetoCoreAlterarProjetosEquipe = function(){ Fp._mexeu = true; return Promise.resolve(true); };
  Fp.ppFilaColocarNaEquipe(EQA);
  ok('alocar: data passada é recusada', !Fp._mexeu);

  if(failed.length){
    console.error('FALHOU ' + failed.length + '/' + total + ':\n - ' + failed.join('\n - '));
    process.exit(1);
  }
  console.log('prog-projetos-agenda: OK (' + total + ' verificações)');
})().catch(function(e){
  console.error('prog-projetos-agenda: erro', e && e.stack || e);
  process.exit(1);
});
