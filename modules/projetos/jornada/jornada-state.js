/* Jornada de Projetos — estado derivado dos dados (Fase 1).
 * Somente leitura. sot_projetos.status não define a etapa.
 * Slot: {loaded, known, rows}. known false = não carregado ou leitura falhou.
 * Array vazio com known true = evidência de que não há registro. */
(function(global){
  'use strict';

  function jornadaSlot(input){
    if(Array.isArray(input)) return {loaded:true, known:true, rows:input};
    if(!input || typeof input!=='object') return {loaded:false, known:false, rows:null};
    var known = input.known===true;
    var loaded = input.loaded===true || known;
    return {loaded:loaded, known:known, rows: known ? (Array.isArray(input.rows)?input.rows:[]) : null};
  }

  function jornadaNormalizarContexto(contexto){
    var c = contexto || {};
    return {
      atividades: jornadaSlot(c.atividades),
      materiais: jornadaSlot(c.materiais),
      documentos: jornadaSlot(c.documentos),
      medicoes: jornadaSlot(c.medicoes),
      programacao: jornadaSlot(c.programacao),
      requisicoes: jornadaSlot(c.requisicoes),
      adicionais: jornadaSlot(c.adicionais),
      agenda: jornadaSlot(c.agenda),
      hoje: jornadaHojeIso(c.hoje)
    };
  }

  function jornadaHojeIso(pedido){
    var s = String(pedido||'').split('T')[0];
    if(/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if(typeof global.dataHojeLocal==='function'){
      var h = String(global.dataHojeLocal()||'').split('T')[0];
      if(/^\d{4}-\d{2}-\d{2}$/.test(h)) return h;
    }
    var d = new Date();
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }

  function jornadaProgramacaoConfirmada(row){
    if(!row) return false;
    var c = row.confirmada;
    return c===true || c==='true' || c===1 || c==='t';
  }

  function jornadaLinhaEhComposicao(row){
    return !!(row && (Object.prototype.hasOwnProperty.call(row, 'projeto_ids') || row.origem==='composicao'));
  }

  function jornadaDataLinha(row){
    if(!row) return '';
    var dia = row.plpt_prog_dia;
    if(Array.isArray(dia)) dia = dia[0];
    var bruto = row.data || row.prog_data || (dia && dia.data) || '';
    var s = String(bruto).split('T')[0];
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
  }

  function jornadaClassificarProgramacao(rows, hoje){
    var hojeIso = jornadaHojeIso(hoje);
    var out = {hojeIso:hojeIso, historica:0, hoje:0, futura:0, rascunho:0, semData:0, atualOuFutura:false, nunca:true};
    (rows||[]).forEach(function(r){
      if(!r || r.deleted_at) return;
      if(jornadaLinhaEhComposicao(r) && !jornadaProgramacaoConfirmada(r)){
        out.rascunho++;
        return;
      }
      var d = jornadaDataLinha(r);
      if(!d){ out.semData++; return; }
      if(d < hojeIso) out.historica++;
      else if(d===hojeIso) out.hoje++;
      else out.futura++;
    });
    out.atualOuFutura = (out.hoje + out.futura) > 0;
    out.nunca = (out.historica + out.hoje + out.futura + out.semData + out.rascunho)===0;
    return out;
  }

  function textoProgramacao(classe){
    if(classe.atualOuFutura){
      if(classe.hoje && classe.futura) return {estado:'concluida', texto:'Programação de hoje e futura'};
      if(classe.hoje) return {estado:'concluida', texto:'Programação de hoje'};
      return {estado:'concluida', texto:'Programação futura'};
    }
    if(classe.historica) return {estado:'em_andamento', texto:'Programação anterior, sem programação de hoje ou futura'};
    if(classe.semData) return {estado:'em_andamento', texto:'Programação sem data, sem programação de hoje ou futura'};
    if(classe.rascunho) return {estado:'em_andamento', texto:'Composição ainda não confirmada. No quadro isso não é escala programada.'};
    return {estado:'nao_iniciada', texto:'Sem programação registrada'};
  }

  function dataBR(iso){
    var p = String(iso||'').split('-');
    return p.length===3 ? p[2]+'/'+p[1]+'/'+p[0] : '—';
  }

  function nomeEquipe(id){
    var lista = Array.isArray(global.equipes) ? global.equipes : [];
    for(var i=0;i<lista.length;i++){
      if(lista[i] && String(lista[i].id)===String(id)) return lista[i].nome_equipe || lista[i].codigo || 'Equipe';
    }
    return 'Equipe não carregada';
  }

  /** Texto da situação de hoje em diante: composição confirmada, composição em aberto ou data escolhida sem equipe.
   * Só descreve; a classificação e a próxima ação continuam as de jornadaClassificarProgramacao. */
  function jornadaDetalheProgramacao(prog, agenda, hoje){
    var hojeIso = jornadaHojeIso(hoje);
    var comps = (prog && prog.known ? prog.rows : []).filter(function(r){
      return r && !r.deleted_at && jornadaLinhaEhComposicao(r) && jornadaDataLinha(r) >= hojeIso;
    }).sort(function(a,b){ return jornadaDataLinha(a) < jornadaDataLinha(b) ? -1 : 1; });
    var conf = comps.filter(jornadaProgramacaoConfirmada);
    if(conf.length){
      var c = conf[0];
      return {tipo:'programado', data:jornadaDataLinha(c), equipe_id:c.equipe_id,
        texto:'Execução programada para '+dataBR(jornadaDataLinha(c))+' — '+nomeEquipe(c.equipe_id)};
    }
    if(comps.length){
      var r = comps[0];
      return {tipo:'em_composicao', data:jornadaDataLinha(r), equipe_id:r.equipe_id,
        texto:'Programação em composição — '+nomeEquipe(r.equipe_id)+' ('+dataBR(jornadaDataLinha(r))+'), composição não confirmada'};
    }
    var fila = (agenda && agenda.known ? agenda.rows : []).filter(function(a){
      if(!a || a.deleted_at || String(a.status||'')==='CANCELADO') return false;
      var d = jornadaDataLinha(a);
      return d && d >= hojeIso;
    }).sort(function(a,b){ return jornadaDataLinha(a) < jornadaDataLinha(b) ? -1 : 1; });
    if(fila.length){
      var d0 = jornadaDataLinha(fila[0]);
      var outras = fila.length - 1;
      return {tipo:'aguardando_equipe', data:d0, equipe_id:null,
        texto:'Execução aguardando definição de equipe — '+dataBR(d0)+(outras ? ' (+'+outras+' data(s))' : '')};
    }
    return null;
  }

  function num(v){ var n = Number(v); return isFinite(n) ? n : 0; }

  function jornadaAtivas(rows){
    return (rows||[]).filter(function(a){
      if(!a || a.deleted_at || a._deleted) return false;
      if(a.somente_descritivo===true || a.somente_descritivo==='true') return false;
      if(String(a.status||'')==='cancelada') return false;
      return true;
    });
  }

  function jornadaResumoAtividades(rows){
    var r = {qtd:0, prevista:0, executada:0, medida:0, valorPrev:0, valorExec:0, pendenteExec:false, algumaExec:false, pendenteMedir:false};
    jornadaAtivas(rows).forEach(function(a){
      var qp = num(a.qtd_prevista), qe = num(a.qtd_executada), qm = num(a.qtd_medida);
      var vu = num(a.valor_unitario);
      r.qtd++;
      r.prevista += qp;
      r.executada += qe;
      r.medida += qm;
      r.valorPrev += num(a.valor_total) || (qp * vu);
      r.valorExec += qe * vu;
      if(qe > 0) r.algumaExec = true;
      if(qp > qe) r.pendenteExec = true;
    });
    r.pendenteMedir = r.executada > r.medida;
    return r;
  }

  function jornadaRequisicoesVivas(rows){
    return (rows||[]).filter(function(r){
      if(!r || r.deleted_at) return false;
      var st = String(r.status||'');
      return st !== 'Excluída' && st !== 'Reprovada';
    });
  }

  function jornadaTemAsBuilt(docs){
    return (docs||[]).some(function(d){
      if(!d || d.deleted_at) return false;
      var blob = String(d.tipo||'')+' '+String(d.nome||'');
      return /as[\s-]?built/i.test(blob);
    });
  }

  function item(id, label, estado, texto){
    return {id:id, label:label, estado:estado, texto:texto||''};
  }

  function jornadaDerivarEstado(projeto, contexto){
    var p = projeto || {};
    var ctx = jornadaNormalizarContexto(contexto);
    var perfil = (typeof global.jornadaResolverPerfil==='function')
      ? global.jornadaResolverPerfil(p, ctx.contrato || (contexto && contexto.contrato))
      : {id:'BASE_PROJETOS', versao:'v1', aviso:null};
    var def = (typeof global.jornadaPerfilDef==='function')
      ? global.jornadaPerfilDef(perfil.id)
      : {id:perfil.id, versao:'v1', asBuilt:false};
    var at = ctx.atividades;
    var resumo = at.known ? jornadaResumoAtividades(at.rows) : null;
    var croquiTxt = String(p.croqui_url||'').trim();
    var croqui = croquiTxt
      ? item('croqui','Croqui','concluida','Croqui localizado no CENA')
      : item('croqui','Croqui','pendencia','Croqui não localizado no CENA');

    var lista;
    if(!at.known) lista = item('lista','Lista de atividades','desconhecido','Atividades ainda não carregadas');
    else if(!resumo.qtd) lista = item('lista','Lista de atividades','nao_iniciada','Nenhuma atividade operacional');
    else lista = item('lista','Lista de atividades','concluida', resumo.qtd+' atividade(s)');

    var prog = ctx.programacao;
    var classeProg = prog.known ? jornadaClassificarProgramacao(prog.rows, ctx.hoje) : null;
    var programacao;
    if(!prog.known) programacao = item('programacao','Programação','desconhecido','Programação ainda não carregada');
    else {
      var tx = textoProgramacao(classeProg);
      programacao = item('programacao','Programação', tx.estado, tx.texto);
    }

    var mats = ctx.materiais;
    var req = ctx.requisicoes;
    var materiais;
    var matsVivos = mats.known ? (mats.rows||[]).filter(function(m){return m && !m.deleted_at;}) : [];
    var reqVivas = req.known ? jornadaRequisicoesVivas(req.rows) : [];
    if(!mats.known) materiais = item('materiais','Materiais','desconhecido','Materiais ainda não carregados');
    else if(!matsVivos.length) materiais = item('materiais','Materiais','nao_aplicavel','Sem materiais previstos');
    else if(!req.known) materiais = item('materiais','Materiais','desconhecido','Requisição ainda não carregada');
    else if(!reqVivas.length) materiais = item('materiais','Materiais','pendencia','Materiais previstos sem requisição');
    else materiais = item('materiais','Materiais','concluida','Requisição registrada');

    var execucao;
    if(!at.known) execucao = item('execucao','Execução','desconhecido','Execução ainda não carregada');
    else if(!resumo.qtd) execucao = item('execucao','Execução','nao_iniciada','Sem atividades para executar');
    else if(!resumo.algumaExec) execucao = item('execucao','Execução','nao_iniciada','Nenhuma quantidade executada');
    else if(resumo.pendenteExec) execucao = item('execucao','Execução','em_andamento','Há quantidade prevista ainda sem executar');
    else execucao = item('execucao','Execução','concluida','Quantidade prevista executada');

    var relTxt = String(p.relatorio_obras||'').trim();
    var relatorio = relTxt
      ? item('relatorio','Relatório','concluida','Relatório registrado no projeto')
      : item('relatorio','Relatório','nao_iniciada','Relatório não localizado no projeto');

    var meds = ctx.medicoes;
    var parciais = [];
    var medicaoItem;
    if(!meds.known){
      medicaoItem = item('medicao','Medições','desconhecido','Medições ainda não carregadas');
    } else if(!(meds.rows||[]).length){
      medicaoItem = item('medicao','Medições','nao_iniciada','Nenhuma parcial');
    } else {
      medicaoItem = item('medicao','Medições','em_andamento', (meds.rows||[]).length+' parcial(is)');
      (meds.rows||[]).slice().sort(function(a,b){return num(a.numero)-num(b.numero);}).forEach(function(m){
        parciais.push({
          numero: m.numero,
          status: String(m.status||''),
          nfs: m.nfs||'',
          valor_nf: m.valor_nf
        });
      });
      var todasNf = (meds.rows||[]).every(function(m){return String(m.status||'')==='nf_emitida';});
      if(todasNf) medicaoItem = item('medicao','Medições','concluida','Parciais com NF emitida');
    }

    var justificado = !!(resumo && (resumo.algumaExec || (meds.known && (meds.rows||[]).length)));
    var asBuilt = {exibir:false, estado:'nao_aplicavel', texto:''};
    if(def.asBuilt){
      if(!ctx.documentos.known){
        asBuilt = {exibir:justificado, estado:'desconhecido', texto:'Documentos ainda não carregados'};
      } else if(jornadaTemAsBuilt(ctx.documentos.rows)){
        asBuilt = {exibir:true, estado:'concluida', texto:'Documento As-built localizado'};
      } else if(justificado){
        asBuilt = {exibir:true, estado:'sem_evidencia', texto:'A validar / sem evidência estruturada'};
      } else {
        asBuilt = {exibir:false, estado:'nao_aplicavel', texto:''};
      }
    }

    var percentual;
    if(!at.known || !resumo) percentual = {known:false, value:null, temBase:false};
    else if(resumo.valorPrev > 0) percentual = {known:true, value:Math.round(resumo.valorExec / resumo.valorPrev * 100), temBase:true};
    else percentual = {known:true, value:null, temBase:false};

    var adicionaisPend = 0;
    if(ctx.adicionais.known){
      adicionaisPend = (ctx.adicionais.rows||[]).filter(function(a){
        return a && !a.deleted_at && String(a.status||'')==='pendente';
      }).length;
    }

    return {
      perfil: perfil,
      perfilDef: def,
      statusAdministrativo: p.status || '',
      percentual: percentual,
      projetoConcluido: false,
      croqui: croqui,
      fases: [
        {id:'preparacao', titulo:'Preparação', itens:[item('cadastro','Cadastro','concluida','Projeto cadastrado'), croqui, lista]},
        {id:'planejamento', titulo:'Planejamento', itens:[programacao, materiais]},
        {id:'campo', titulo:'Campo', itens:[execucao, relatorio]},
        {id:'medicao', titulo:'Medição', itens:[medicaoItem]}
      ],
      parciais: meds.known ? parciais : null,
      medicoesConhecidas: meds.known,
      asBuilt: asBuilt,
      adicionaisPendentes: ctx.adicionais.known ? adicionaisPend : null,
      resumo: resumo,
      contexto: ctx,
      programacaoClasse: classeProg,
      programacaoDetalhe: jornadaDetalheProgramacao(prog, ctx.agenda, ctx.hoje)
    };
  }

  global.jornadaSlot = jornadaSlot;
  global.jornadaNormalizarContexto = jornadaNormalizarContexto;
  global.jornadaResumoAtividades = jornadaResumoAtividades;
  global.jornadaProgramacaoConfirmada = jornadaProgramacaoConfirmada;
  global.jornadaClassificarProgramacao = jornadaClassificarProgramacao;
  global.jornadaDetalheProgramacao = jornadaDetalheProgramacao;
  global.jornadaDerivarEstado = jornadaDerivarEstado;
})(typeof window!=='undefined' ? window : globalThis);
