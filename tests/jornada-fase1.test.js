'use strict';
// Jornada de Projetos — Fase 1. Sem banco.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.join(__dirname, '..');
const dir = path.join(raiz, 'modules', 'projetos', 'jornada');
const arquivos = ['jornada-profiles.js','jornada-resolver.js','jornada-state.js','jornada-actions.js','jornada-ui.js','jornada.js'];
const sandbox = { console: console };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.document = { getElementById: function(){ return null; } };
vm.createContext(sandbox);
arquivos.forEach(function(f){
  vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), sandbox, { filename: f });
});

const failed = [];
let total = 0;
function ok(name, cond, detail){
  total++;
  if(!cond) failed.push(name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : ''));
}

function ctx(over){
  var base = {
    contrato: null,
    atividades: {loaded:true, known:true, rows:[]},
    materiais: {loaded:true, known:true, rows:[]},
    documentos: {loaded:true, known:true, rows:[]},
    medicoes: {loaded:true, known:true, rows:[]},
    programacao: {loaded:true, known:true, rows:[]},
    requisicoes: {loaded:true, known:true, rows:[]},
    adicionais: {loaded:true, known:true, rows:[]}
  };
  Object.keys(over || {}).forEach(function(k){ base[k] = over[k]; });
  return base;
}
function desconhecido(){ return {loaded:false, known:false, rows:null}; }
function atv(q){
  return Object.assign({qtd_prevista:10, qtd_executada:0, qtd_medida:0, valor_unitario:10, status:'pendente'}, q||{});
}
const resolver = sandbox.jornadaResolverPerfil;
const acaoDe = sandbox.jornadaObterProximaAcao;
const estadoDe = sandbox.jornadaDerivarEstado;

const eqtl = {id:'c-plpt', cliente:'EQUATORIAL', codigo:'PLPT', nome:'PLPT TERESINA'};
const enel = {id:'c-rdse', cliente:'ENEL', codigo:'4600003971', nome:'RDSE'};
const comgas = {id:'c-com', cliente:'COMGAS', codigo:'CW35964', nome:'COMGAS CAMPINAS'};

ok('1 resolve BASE sem contrato específico', resolver({contrato_id:'x'}, {id:'x', cliente:'OUTRO', codigo:'ABC', nome:'Obra'}).id === 'BASE_PROJETOS');
ok('2 resolve EQUATORIAL_PLPT pelo cadastro', resolver({contrato_id:eqtl.id}, eqtl).id === 'EQUATORIAL_PLPT');
ok('2b PLPT no meio do nome, com hífen', resolver({}, {cliente:'Equatorial', codigo:'1', nome:'PLPT-TERESINA'}).id === 'EQUATORIAL_PLPT');
ok('2c APLPTE não é a palavra PLPT', resolver({}, {cliente:'EQUATORIAL', codigo:'APLPTE', nome:'Obra'}).id === 'BASE_PROJETOS');
ok('3 ENEL com PLPT no nome não vira PLPT', resolver({}, {cliente:'ENEL', codigo:'RDSE', nome:'ENEL PLPT'}).id === 'BASE_PROJETOS');
ok('4 COMGÁS não vira PLPT', resolver({}, comgas).id === 'BASE_PROJETOS');
ok('4b COMGÁS usa a base e avisa', resolver({}, comgas).aviso && /jornada base/.test(resolver({}, comgas).aviso));
ok('CTEEP usa a base', resolver({}, {cliente:'ISA CTEEP', codigo:'46300010125', nome:'CTEEP ROÇADA'}).id === 'BASE_PROJETOS');

var pRecebido = {id:'p-plpt', nome:'Obra 1', status:'Recebido', contrato_id:eqtl.id, croqui_url:''};
var eRecebido = estadoDe(pRecebido, ctx({
  contrato: eqtl,
  atividades: {loaded:true, known:true, rows:[atv(), atv({qtd_prevista:5})]}
}));
var aRecebido = acaoDe(pRecebido, ctx({
  contrato: eqtl,
  atividades: {loaded:true, known:true, rows:[atv(), atv()]}
}));
ok('5 status Recebido com atividades não pede importar lista', aRecebido.id !== 'importar_lista', aRecebido);
ok('5b reconhece a lista e a preparação', eRecebido.fases[0].itens[2].estado === 'concluida' && eRecebido.perfil.id === 'EQUATORIAL_PLPT');
ok('5c próxima ação olha a programação, não o status Recebido', aRecebido.id === 'programar_execucao', aRecebido);

var pRdse = {id:'p-rdse', nome:'DAC/S.SUL.22.00031', status:'Em execução', contrato_id:enel.id, croqui_url:'https://croqui'};
var cRdse = ctx({
  contrato: enel,
  atividades: {loaded:true, known:true, rows:[atv({qtd_executada:4, qtd_medida:4})]},
  programacao: {loaded:true, known:true, rows:[{id:'prog1'}]},
  medicoes: {loaded:true, known:true, rows:[
    {numero:1, status:'nf_emitida', nfs:'1', valor_nf:2815.02},
    {numero:2, status:'rascunho'}
  ]}
});
var eRdse = estadoDe(pRdse, cRdse);
var aRdse = acaoDe(pRdse, cRdse);
ok('6 NF emitida e quantidade pendente pede continuar execução', aRdse.id === 'continuar_execucao', aRdse);
ok('6b não conclui o projeto', eRdse.projetoConcluido === false && !/conclu[ií]d/i.test(aRdse.label));
ok('6c a parcial 1 fica com NF e a 2 em rascunho', eRdse.parciais.length === 2 && eRdse.parciais[0].status === 'nf_emitida' && eRdse.parciais[1].status === 'rascunho');
ok('6d status administrativo segue Em execução', eRdse.statusAdministrativo === 'Em execução');
ok('6e perfil do RDSE é a base', eRdse.perfil.id === 'BASE_PROJETOS');

var pSemCroqui = {id:'p2', nome:'Sem croqui', status:'Recebido', contrato_id:eqtl.id, croqui_url:''};
var eCroqui = estadoDe(pSemCroqui, ctx({contrato:eqtl, atividades:{loaded:true, known:true, rows:[atv()]}}));
var aCroqui = acaoDe(pSemCroqui, ctx({contrato:eqtl, atividades:{loaded:true, known:true, rows:[atv()]}}));
var itemCroqui = eCroqui.fases[0].itens[1];
ok('7 sem croqui é pendência', itemCroqui.estado === 'pendencia' && /Croqui não localizado no CENA/.test(itemCroqui.texto), itemCroqui);
ok('7b croqui não bloqueia a próxima ação', aCroqui.id === 'programar_execucao' && aCroqui.bloqueios.length === 0, aCroqui);

var aVazio = acaoDe({id:'p3', status:'Recebido', croqui_url:'x'}, ctx());
ok('8 sem atividades pede importar lista', aVazio.id === 'importar_lista', aVazio);

var aProg = acaoDe({id:'p4', status:'Recebido'}, ctx({
  atividades:{loaded:true, known:true, rows:[atv()]},
  programacao:{loaded:true, known:true, rows:[{id:'g1', origem:'plpt', data:'2099-01-01'}]}
}));
ok('9 com programação não pede programar de novo', aProg.id === 'aguardar_execucao', aProg);

var aReq = acaoDe({id:'p5', status:'Em execução'}, ctx({
  atividades:{loaded:true, known:true, rows:[atv({qtd_executada:4, qtd_medida:0})]},
  materiais:{loaded:true, known:true, rows:[{id:'m1', descricao:'Cabo'}]},
  requisicoes:{loaded:true, known:true, rows:[{id:'r1', status:'Aprovada'}]},
  medicoes:{loaded:true, known:true, rows:[]}
}));
ok('10 com requisição não pede criar requisição', aReq.id !== 'criar_requisicao', aReq);
ok('10b quantidade executada sem medição pede parcial', aReq.id === 'criar_parcial', aReq);

var aRasc = acaoDe({id:'p6', status:'Em execução'}, ctx({
  atividades:{loaded:true, known:true, rows:[atv({qtd_executada:10, qtd_medida:10})]},
  medicoes:{loaded:true, known:true, rows:[{numero:1, status:'rascunho'}]}
}));
ok('11 medição rascunho abre a parcial', aRasc.id === 'avancar_medicao', aRasc);

var eNf = estadoDe({id:'p7', status:'Em execução', nome:'Fechada parcial'}, ctx({
  contrato: enel,
  atividades:{loaded:true, known:true, rows:[atv({qtd_executada:10, qtd_medida:10})]},
  medicoes:{loaded:true, known:true, rows:[{numero:1, status:'nf_emitida', nfs:'99'}]}
}));
var aNf = acaoDe({id:'p7', status:'Em execução'}, ctx({
  contrato: enel,
  atividades:{loaded:true, known:true, rows:[atv({qtd_executada:10, qtd_medida:10})]},
  medicoes:{loaded:true, known:true, rows:[{numero:1, status:'nf_emitida', nfs:'99'}]}
}));
ok('12 NF emitida não vira projeto concluído', eNf.projetoConcluido === false && aNf.id !== 'projeto_concluido' && !/conclu[ií]d/i.test(aNf.label), aNf);
ok('12b a parcial mostra NF', eNf.parciais[0].status === 'nf_emitida');

var eFalta = estadoDe({id:'p8', status:'Recebido'}, ctx({
  atividades: desconhecido(),
  programacao: desconhecido(),
  medicoes: desconhecido(),
  materiais: desconhecido(),
  requisicoes: desconhecido()
}));
var aFalta = acaoDe({id:'p8', status:'Recebido'}, ctx({
  atividades: desconhecido(),
  programacao: desconhecido()
}));
ok('13 dado não carregado não vira pendência de lista', eFalta.fases[0].itens[2].estado === 'desconhecido', eFalta.fases[0].itens[2]);
ok('13b não pede importar lista', aFalta.id === 'dados_incompletos', aFalta);
ok('13c programação desconhecida não fica como não iniciada', eFalta.fases[1].itens[0].estado === 'desconhecido');

var root = { innerHTML: '' };
sandbox.document = { getElementById: function(id){ return id==='sot-jornada-root' ? root : null; } };
var estourou = false;
try { sandbox.jornadaRender({_jornadaForcarErro:true, id:'x'}); }
catch(e){ estourou = true; }
ok('14 erro da jornada não propaga', estourou === false);
ok('14b a aba mostra o aviso e o resto do projeto segue', /outras abas/.test(root.innerHTML), root.innerHTML);

sandbox.escHtml = function(str){ return (str||'').replace(/'/g,"\\'").replace(/"/g,'&quot;'); };
var rootHtml = { innerHTML: '' };
sandbox.document = { getElementById: function(id){ return id==='sot-jornada-root' ? rootHtml : null; } };
var htmlQuebrou = false;
try { sandbox.jornadaRender(pRdse, cRdse); }
catch(e){ htmlQuebrou = true; }
ok('14e parcial com número não quebra o desenho', htmlQuebrou === false && /Parcial 1/.test(rootHtml.innerHTML) && /NF emitida/.test(rootHtml.innerHTML) && /Continuar execução/.test(rootHtml.innerHTML), rootHtml.innerHTML);

var html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');
ok('14c o detalhe chama a jornada dentro de try', /try\{[\s\S]{0,400}jornadaRender\(p\)/.test(html));
ok('14d a aba Atividades continua no detalhe', html.indexOf("sot-tab-'+t") >= 0 && html.indexOf('sot-tab-jornada') >= 0);

var fontes = arquivos.map(function(f){ return fs.readFileSync(path.join(dir, f), 'utf8'); }).join('\n');
ok('sem gravação no motor', !/sbInsert|sbUpdate|sbDelete|sbUpsert/.test(fontes));
ok('sem TMA e sem equipes_disp', !/progTma|equipes_disp/.test(fontes));
ok('programação de projetos não limpa a seleção', fontes.indexOf('progProjMudarContrato') < 0);
ok('sem migration no módulo', fs.readdirSync(dir).every(function(f){ return !/\.sql$/i.test(f); }));

var eAs = estadoDe({id:'p9', status:'Recebido', contrato_id:eqtl.id}, ctx({
  contrato: eqtl,
  atividades:{loaded:true, known:true, rows:[atv({qtd_executada:10, qtd_medida:10})]},
  documentos:{loaded:true, known:true, rows:[]},
  medicoes:{loaded:true, known:true, rows:[{numero:1, status:'nf_emitida'}]}
}));
var aAs = acaoDe({id:'p9', status:'Recebido', contrato_id:eqtl.id}, ctx({
  contrato: eqtl,
  atividades:{loaded:true, known:true, rows:[atv({qtd_executada:10, qtd_medida:10})]},
  documentos:{loaded:true, known:true, rows:[]},
  medicoes:{loaded:true, known:true, rows:[{numero:1, status:'nf_emitida'}]}
}));
ok('PLPT com execução e sem documento deixa AS BUILT a validar', eAs.asBuilt.estado === 'sem_evidencia' && /sem evidência estruturada/.test(eAs.asBuilt.texto), eAs.asBuilt);
ok('PLPT sem evidência abre documentos, não muda status', aAs.id === 'ver_as_built' && aAs.destino === 'documentos', aAs);
var eAsDoc = estadoDe({id:'p10', contrato_id:eqtl.id}, ctx({
  contrato: eqtl,
  atividades:{loaded:true, known:true, rows:[atv({qtd_executada:10, qtd_medida:10})]},
  documentos:{loaded:true, known:true, rows:[{tipo:'As-built', nome:'as built.pdf'}]},
  medicoes:{loaded:true, known:true, rows:[{numero:1, status:'nf_emitida'}]}
}));
ok('documento As-built é a evidência de conclusão da etapa', eAsDoc.asBuilt.estado === 'concluida');

var idProg = 'e256ae24-34dc-4011-8938-9474f86e3947';
var outro = '11111111-1111-4111-8111-111111111111';
var tem = sandbox.jornadaComposicaoTemProjeto;
var mescla = sandbox.jornadaMesclarProgramacao;
var vazioKnown = {loaded:true, known:true, rows:[]};
var desc = {loaded:true, known:false, rows:null};
ok('15 composição com o projeto no JSON conta', tem({projeto_ids:'["'+idProg+'"]'}, idProg) === true);
ok('15b lista em memória também conta', tem({projeto_ids:[idProg, outro]}, outro) === true);
ok('15c outro UUID no mesmo texto não conta', tem({projeto_ids:'["'+outro+'"]'}, idProg) === false);
ok('15h UUID grudado em outro token não é elemento', tem({projeto_ids:'["'+idProg+'extra"]'}, idProg) === false);
ok('15d JSON inválido não vira programação', tem({projeto_ids:'{quebrado'}, idProg) === false);
ok('15e composição apagada não conta', tem({deleted_at:'2026-10-01', projeto_ids:'["'+idProg+'"]'}, idProg) === false);
ok('15f filtro é ilike do UUID inteiro', sandbox.jornadaFiltroComposicao(idProg).join('&') === 'deleted_at=is.null&projeto_ids=ilike.*'+idProg+'*');
ok('15g id que não é UUID não gera filtro', sandbox.jornadaFiltroComposicao('PLPT-1') === null);

var soComp = mescla(vazioKnown, {loaded:true, known:true, rows:[{id:'c1', origem:'composicao', confirmada:true, data:'2099-01-01', projeto_ids:'["'+idProg+'"]'}]});
ok('16 só na composição a programação fica conhecida', soComp.known === true && soComp.rows.length === 1, soComp);
var pSoComp = {id:idProg, nome:'Obra programada', status:'Recebido', croqui_url:''};
var eSoComp = estadoDe(pSoComp, ctx({programacao:soComp, atividades:{loaded:true, known:true, rows:[atv()]}}));
var aSoComp = acaoDe(pSoComp, ctx({programacao:soComp, atividades:{loaded:true, known:true, rows:[atv()]}}));
ok('16b a etapa reconhece a composição confirmada futura', eSoComp.fases[1].itens[0].estado === 'concluida', eSoComp.fases[1].itens[0]);
ok('16c não pede programar de novo', aSoComp.id === 'aguardar_execucao', aSoComp);
ok('A projeto somente em composicao_dia confirmada é reconhecido', eSoComp.programacaoClasse.futura === 1 && eSoComp.programacaoClasse.atualOuFutura === true);
ok('B plpt vazio mais composição válida é reconhecido', soComp.rows.length === 1 && aSoComp.id === 'aguardar_execucao');

var slotHist = {loaded:true, known:true, rows:[
  {id:'c-old', origem:'composicao', confirmada:true, data:'2000-01-01', projeto_ids:[idProg]}
]};
var pHist = {id:idProg, status:'Em execução'};
var ctxHist = ctx({
  programacao: slotHist,
  atividades:{loaded:true, known:true, rows:[atv({qtd_executada:4, qtd_medida:4})]}
});
var eHist = estadoDe(pHist, ctxHist);
var aHist = acaoDe(pHist, ctxHist);
ok('E programação antiga com execução pendente pede a próxima', aHist.id === 'programar_proxima', aHist);
ok('E2 a etapa não fica concluída só com histórico', eHist.fases[1].itens[0].estado !== 'concluida' && /anterior/.test(eHist.fases[1].itens[0].texto), eHist.fases[1].itens[0]);
ok('E3 programação futura ainda aguarda quando não houve execução', acaoDe({id:idProg, status:'Recebido'}, ctx({
  programacao:{loaded:true, known:true, rows:[{origem:'plpt', data:'2099-06-01'}]},
  atividades:{loaded:true, known:true, rows:[atv()]}
})).id === 'aguardar_execucao');

var slotRasc = {loaded:true, known:true, rows:[
  {id:'c-draft', origem:'composicao', confirmada:false, data:'2099-01-01', projeto_ids:[idProg]}
]};
var eRascunho = estadoDe({id:idProg, status:'Recebido'}, ctx({
  programacao: slotRasc,
  atividades:{loaded:true, known:true, rows:[atv()]}
}));
var aRascunhoProg = acaoDe({id:idProg, status:'Recebido'}, ctx({
  programacao: slotRasc,
  atividades:{loaded:true, known:true, rows:[atv()]}
}));
ok('F composição não confirmada não é escala programada', eRascunho.fases[1].itens[0].estado !== 'concluida' && /não confirmada/.test(eRascunho.fases[1].itens[0].texto), eRascunho.fases[1].itens[0]);
ok('F2 não confirmada não segura a próxima ação', aRascunhoProg.id === 'programar_execucao', aRascunhoProg);
ok('F3 confirmada como texto true segue a regra do quadro', sandbox.jornadaProgramacaoConfirmada({confirmada:'true'}) === true);
ok('F4 confirmada falsa não passa', sandbox.jornadaProgramacaoConfirmada({confirmada:false}) === false);

var slotDel = {loaded:true, known:true, rows:[
  {id:'c-del', origem:'composicao', confirmada:true, data:'2099-01-01', deleted_at:'2026-10-01', projeto_ids:[idProg]}
]};
var aDel = acaoDe({id:idProg, status:'Recebido'}, ctx({
  programacao: slotDel,
  atividades:{loaded:true, known:true, rows:[atv()]}
}));
ok('D composição apagada não comprova programação', aDel.id === 'programar_execucao' && sandbox.jornadaClassificarProgramacao(slotDel.rows, '2026-10-04').nunca === true, aDel);

var incompleta = mescla(vazioKnown, desc);
ok('17 plpt vazio e composição não carregada não vira sem programação', incompleta.known === false, incompleta);
var eInc = estadoDe({id:idProg, status:'Recebido'}, ctx({
  programacao: incompleta,
  atividades:{loaded:true, known:true, rows:[atv()]}
}));
var aInc = acaoDe({id:idProg, status:'Recebido'}, ctx({
  programacao: incompleta,
  atividades:{loaded:true, known:true, rows:[atv()]}
}));
ok('17b a etapa fica desconhecida', eInc.fases[1].itens[0].estado === 'desconhecido', eInc.fases[1].itens[0]);
ok('17c não pede programar execução', aInc.id === 'dados_incompletos', aInc);
ok('C uma query falha e a outra vazia fica não carregada', incompleta.known === false && eInc.fases[1].itens[0].estado === 'desconhecido');
ok('18 as duas fontes vazias significam sem programação', mescla(vazioKnown, vazioKnown).known === true && mescla(vazioKnown, vazioKnown).rows.length === 0);
ok('18b linha antiga de plpt_prog_projetos continua valendo', mescla({loaded:true, known:true, rows:[{id:'g1'}]}, desc).rows.length === 1);

function terminar(){
  if(failed.length){
    console.error('FALHOU ' + failed.length + '/' + total + ':\n - ' + failed.join('\n - '));
    process.exit(1);
  }
  console.log('jornada-fase1: OK (' + total + ' verificações)');
}

sandbox.DEMO = false;
sandbox.composicao_dia = [];
sandbox.sbFetch = function(table, opts){
  if(table==='plpt_prog_projetos') return [];
  if(table==='composicao_dia'){
    ok('19 a busca da composição pede o UUID e não traz a equipe inteira', opts && opts.select === 'id,data,equipe_id,projeto_ids,confirmada' && opts.filters.join('&').indexOf('deleted_at=is.null') >= 0 && opts.filters.join('&').indexOf('projeto_ids=ilike.*'+idProg+'*') >= 0, opts);
    return [{id:'c9', confirmada:true, data:'2099-01-01', projeto_ids:JSON.stringify([idProg])}];
  }
  if(table==='plpt_requisicoes_materiais' || table==='sot_adicionais') return [];
  return null;
};
sandbox.jornadaCarregarExtras(idProg).then(function(extra){
  ok('19b o carregamento junta a composição quando plpt_prog_projetos vem vazio', extra.programacao.known === true && extra.programacao.rows.length === 1, extra.programacao);
  terminar();
}).catch(function(e){
  ok('19b carregamento', false, String(e && e.stack || e));
  terminar();
});
