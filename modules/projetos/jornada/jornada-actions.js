/* Jornada de Projetos — próxima ação e navegação (Fase 1).
 * Não grava. Cada ação abre uma tela que já existe; programar pede a data (módulo agenda). */
(function(global){
  'use strict';

  function acao(id, label, status, motivo, destino, prioridade){
    return {id:id, label:label, status:status, motivo:motivo, destino:destino, prioridade:prioridade, bloqueios:[]};
  }

  function medsDe(estado){
    var slot = estado.contexto && estado.contexto.medicoes;
    if(!slot || !slot.known) return [];
    return slot.rows || [];
  }

  function temStatus(rows, nome){
    return rows.some(function(m){ return String(m && m.status || '')===nome; });
  }

  function jornadaObterProximaAcao(projeto, contexto){
    var estado = (contexto && contexto.fases && contexto.contexto)
      ? contexto
      : global.jornadaDerivarEstado(projeto, contexto);
    var ctx = estado.contexto;
    var at = ctx.atividades;
    var faltou = false;

    if(!at.known){
      return acao('dados_incompletos','Aguardando dados do projeto','desconhecido','As atividades ainda não foram carregadas. Nada foi marcado como pendente.', null, 0);
    }
    var resumo = estado.resumo || {qtd:0, algumaExec:false, pendenteExec:false, pendenteMedir:false};
    if(!resumo.qtd){
      return acao('importar_lista','Importar lista','pendente','O projeto não tem atividades operacionais.', 'atividades', 1);
    }

    var meds = medsDe(estado);
    var medsKnown = !!(ctx.medicoes && ctx.medicoes.known);
    if(!medsKnown) faltou = true;
    var temNf = medsKnown && temStatus(meds, 'nf_emitida');

    if(temNf && resumo.pendenteExec){
      return acao('continuar_execucao','Continuar execução','em_andamento','Há NF de uma parcial e ainda existe quantidade prevista sem executar. A NF não encerra o projeto.', 'programacao', 2);
    }
    if(medsKnown && temStatus(meds, 'rascunho')){
      return acao('avancar_medicao','Abrir medição em rascunho','em_andamento','Existe parcial em rascunho.', 'medicao', 3);
    }
    if(medsKnown && temStatus(meds, 'em_aprovacao')){
      return acao('aguardar_validacao','Aguardar validação','aguardando','Existe parcial em aprovação.', 'medicao', 4);
    }
    if(medsKnown && resumo.pendenteMedir){
      return acao('criar_parcial','Criar parcial','pendente','Há quantidade executada ainda não medida.', 'medicao', 5);
    }
    if(medsKnown && (temStatus(meds, 'aprovado') || temStatus(meds, 'emissao_liberada'))){
      return acao('emitir_nf','Emitir NF','pendente','Existe parcial aprovada sem NF.', 'medicao', 6);
    }

    var prog = ctx.programacao;
    var classe = estado.programacaoClasse;
    if(!prog || !prog.known || !classe) faltou = true;
    else if(!resumo.algumaExec && !classe.atualOuFutura){
      return acao('programar_execucao','Programar execução','pendente','Não há programação de hoje ou futura, nem quantidade executada. Programação anterior ou composição não confirmada não cobre essa etapa.', 'programacao', 7);
    } else if(!resumo.algumaExec && classe.atualOuFutura){
      return acao('aguardar_execucao','Aguardar execução','aguardando','Há programação de hoje ou futura e ainda não há quantidade executada.', 'programacao', 8);
    }

    var mats = ctx.materiais;
    var req = ctx.requisicoes;
    var matsVivos = (mats && mats.known) ? (mats.rows||[]).filter(function(m){return m && !m.deleted_at;}) : [];
    var reqVivas = (req && req.known) ? (req.rows||[]).filter(function(r){
      if(!r || r.deleted_at) return false;
      var st = String(r.status||'');
      return st!=='Excluída' && st!=='Reprovada';
    }) : [];
    if(mats && mats.known && matsVivos.length && (!req || !req.known)) faltou = true;
    if(mats && mats.known && req && req.known && matsVivos.length && !reqVivas.length && resumo.algumaExec){
      return acao('criar_requisicao','Criar requisição','pendente','Há materiais previstos e execução, sem requisição.', 'reserva', 9);
    }

    if(resumo.algumaExec && resumo.pendenteExec && prog && prog.known && classe && !classe.atualOuFutura){
      return acao('programar_proxima','Programar próxima execução','pendente','A execução ainda tem quantidade pendente e não há programação de hoje ou futura. Programação anterior não cobre o que falta.', 'programacao', 10);
    }
    if(resumo.algumaExec && resumo.pendenteExec && classe && classe.atualOuFutura){
      return acao('continuar_execucao','Continuar execução','em_andamento','A execução começou, ainda há quantidade prevista e existe programação de hoje ou futura.', 'programacao', 10);
    }

    var rel = String((projeto && projeto.relatorio_obras)||'').trim();
    if(rel && resumo.algumaExec && medsKnown && !meds.length){
      return acao('conferir_relatorio','Conferir relatório','em_andamento','Há relatório no projeto e ainda não há parcial.', 'relatorio', 11);
    }

    if(estado.asBuilt && estado.asBuilt.exibir && estado.asBuilt.estado==='sem_evidencia'){
      return acao('ver_as_built','Ver / Registrar AS BUILT','sem_evidencia','A validar / sem evidência estruturada. Abrir documentos não marca AS BUILT.', 'documentos', 12);
    }

    var stAdm = String((projeto && projeto.status)||'');
    if(stAdm==='Aguardando cliente' || stAdm==='AGUARDANDO BOLETIM'){
      return acao('aguardar_terceiro', stAdm==='AGUARDANDO BOLETIM'?'Aguardar boletim':'Aguardar cliente','aguardando','Status administrativo: '+stAdm+'. A Jornada não altera esse status.', null, 13);
    }

    if(faltou){
      return acao('dados_incompletos','Aguardando dados do projeto','desconhecido','Parte dos dados ainda não carregou. O que falta não foi marcado como pendente.', null, 0);
    }

    return acao('validar_encerramento','Processo administrativo específico a validar','aguardando','As etapas comuns visíveis não fecham a obra. A NF de uma parcial não conclui o projeto.', null, 20);
  }

  function jornadaDataValida(v){
    var s = String(v||'').split('T')[0];
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
  }

  /** Abre a Programação de Projetos no contrato e na data escolhida. Sem data não abre: a data nunca é presumida. */
  function jornadaAbrirProgramacao(projeto, dataEscolhida){
    if(!projeto) return;
    var data = jornadaDataValida(dataEscolhida);
    if(!data){
      if(typeof global.progAgendaPedirData==='function') global.progAgendaPedirData(projeto);
      return;
    }
    if(typeof global.showPage==='function') global.showPage('programacao-projetos');
    var tentativas = 0;
    var pintou = false;
    var aplicar = function(){
      if(global._pp){
        global._pp.cid = projeto.contrato_id || '';
        global._pp.data = data;
        global._pp.filaDestaque = projeto.id || null;
      }
      var sel = document.getElementById('pp-cont');
      var lista = document.getElementById('pp-proj-lista');
      var dt = document.getElementById('pp-data');
      if(dt) dt.value = data;
      if(sel && projeto.contrato_id) sel.value = String(projeto.contrato_id);
      var valorOk = !projeto.contrato_id || (sel && sel.value === String(projeto.contrato_id));
      if((!sel || !lista || !valorOk) && tentativas < 30 && typeof global.setTimeout==='function'){
        tentativas++;
        global.setTimeout(aplicar, 100);
        return;
      }
      if(typeof global.progProjAtualizarProjLista==='function') global.progProjAtualizarProjLista();
      if(pintou) return;
      pintou = true;
      if(typeof global.ppFilaInvalidar==='function') global.ppFilaInvalidar();
      if(typeof global.progProjAtualizarPillsTipo==='function') global.progProjAtualizarPillsTipo();
      if(typeof global.progProjCarregarStatus==='function') global.progProjCarregarStatus(data);
      if(typeof global.progProjCarregarStatusBanco==='function'){
        global.progProjCarregarStatusBanco(data, function(){
          if(typeof global.progProjAtualizarProjLista==='function') global.progProjAtualizarProjLista();
          if(typeof global.progProjRenderQuadro==='function') global.progProjRenderQuadro();
        });
      } else if(typeof global.progProjRenderQuadro==='function'){
        global.progProjRenderQuadro();
      }
    };
    if(typeof global.setTimeout==='function') global.setTimeout(aplicar, 100);
    else aplicar();
  }

  function jornadaExecutarAcao(acaoAtual, projeto){
    try{
      if(!acaoAtual || !projeto) return;
      var id = acaoAtual.id;
      if(id==='importar_lista' && typeof global.sotImportarAtividades==='function') global.sotImportarAtividades(projeto.id);
      else if((id==='programar_execucao' || id==='programar_proxima' || id==='continuar_execucao') && typeof global.progAgendaPedirData==='function') global.progAgendaPedirData(projeto);
      else if(id==='aguardar_execucao' && global._jornadaDetalheProgramacao && global._jornadaDetalheProgramacao.data && typeof global.jornadaAbrirProgramacao==='function') global.jornadaAbrirProgramacao(projeto, global._jornadaDetalheProgramacao.data);
      else if(id==='criar_requisicao' && typeof global.sotMostrarTab==='function') global.sotMostrarTab('reserva');
      else if((id==='criar_parcial' || id==='avancar_medicao' || id==='aguardar_validacao' || id==='emitir_nf') && typeof global.sotMostrarTab==='function') global.sotMostrarTab('medicao');
      else if(id==='ver_as_built' && typeof global.sotMostrarTab==='function') global.sotMostrarTab('documentos');
      else if(id==='conferir_relatorio' && typeof global.sotAnalisarRelatorio==='function') global.sotAnalisarRelatorio(projeto.id);
    }catch(e){
      if(global.console && console.error) console.error('[Jornada]', e);
    }
  }

  global.jornadaObterProximaAcao = jornadaObterProximaAcao;
  global.jornadaAbrirProgramacao = jornadaAbrirProgramacao;
  global.jornadaExecutarAcao = jornadaExecutarAcao;
})(typeof window!=='undefined' ? window : globalThis);
