/* Jornada de Projetos — entrada da aba (Fase 1).
 * Lê o que o detalhe já carregou e busca, só com SELECT, programação, requisição e adicionais.
 * Programação: plpt_prog_projetos (com a data do dia) ou composicao_dia confirmada.
 * Composição apagada, não confirmada ou só histórica não vira programação de hoje/futura.
 * Erro aqui não segue para as outras abas. */
(function(global){
  'use strict';

  var _seq = 0;

  function slotMemoria(arr){
    if(!Array.isArray(arr)) return {loaded:false, known:false, rows:null};
    return {loaded:true, known:true, rows:arr};
  }

  function jornadaContextoDaMemoria(projeto){
    var contrato = null;
    if(typeof global.jornadaResolverPerfil==='function'){
      contrato = global.jornadaResolverPerfil(projeto).contrato || null;
    }
    return {
      contrato: contrato,
      atividades: slotMemoria(global.sot_atividades),
      materiais: slotMemoria(global.sot_materiais_proj),
      documentos: slotMemoria(global._sotDocs),
      medicoes: slotMemoria(global.sot_medicoes),
      programacao: {loaded:false, known:false, rows:null},
      requisicoes: {loaded:false, known:false, rows:null},
      adicionais: {loaded:false, known:false, rows:null}
    };
  }

  function lerTabela(table, filters, select){
    if(typeof global.sbFetch!=='function'){
      return Promise.resolve({loaded:false, known:false, rows:null});
    }
    var opts = {filters:filters, limit:500};
    if(select) opts.select = select;
    return Promise.resolve(global.sbFetch(table, opts)).then(function(rows){
      if(!Array.isArray(rows)) return {loaded:true, known:false, rows:null};
      return {loaded:true, known:true, rows:rows};
    }, function(){
      return {loaded:true, known:false, rows:null};
    });
  }

  function uuidDe(id){
    var s = String(id||'').toLowerCase();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s) ? s : '';
  }

  function listaProjetoIds(raw){
    if(Array.isArray(raw)) return raw;
    if(raw==null || raw==='') return [];
    try{
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    }catch(e){
      return null;
    }
  }

  function jornadaComposicaoTemProjeto(row, projetoId){
    if(!row || row.deleted_at) return false;
    var alvo = uuidDe(projetoId);
    if(!alvo) return false;
    var lista = listaProjetoIds(row.projeto_ids);
    if(!lista) return false;
    return lista.some(function(item){ return uuidDe(item)===alvo; });
  }

  function jornadaFiltroComposicao(projetoId){
    var id = uuidDe(projetoId);
    if(!id) return null;
    return ['deleted_at=is.null', 'projeto_ids=ilike.*'+id+'*'];
  }

  function linhasVivas(slot){
    if(!slot || !slot.known) return null;
    return (slot.rows||[]).filter(function(r){ return r && !r.deleted_at; });
  }

  function jornadaMesclarProgramacao(plpt, comp){
    var a = linhasVivas(plpt);
    var b = linhasVivas(comp);
    if((a && a.length) || (b && b.length)){
      return {loaded:true, known:true, rows:(a||[]).concat(b||[])};
    }
    if(a && b) return {loaded:true, known:true, rows:[]};
    return {loaded:true, known:false, rows:null};
  }

  function programacaoNaMemoria(id){
    if(!Array.isArray(global.composicao_dia)) return null;
    var hits = global.composicao_dia.filter(function(r){ return jornadaComposicaoTemProjeto(r, id); });
    return {loaded:true, known:true, rows:hits};
  }

  function consultarComposicao(id){
    var filtro = jornadaFiltroComposicao(id);
    if(!filtro) return Promise.resolve({loaded:true, known:false, rows:null});
    return lerTabela('composicao_dia', filtro, 'id,data,equipe_id,projeto_ids,confirmada').then(function(slot){
      if(!slot.known) return {loaded:true, known:false, rows:null};
      var hits = (slot.rows||[]).map(function(r){
        return {id:r.id, data:r.data, equipe_id:r.equipe_id, projeto_ids:r.projeto_ids, confirmada:r.confirmada, deleted_at:r.deleted_at||null, origem:'composicao'};
      }).filter(function(r){ return jornadaComposicaoTemProjeto(r, id); });
      return {loaded:true, known:true, rows:hits};
    });
  }

  function normalizarPlpt(slot){
    if(!slot || !slot.known) return {loaded:true, known:false, rows:null};
    var rows = [];
    (slot.rows||[]).forEach(function(r){
      if(!r || r.deleted_at) return;
      var dia = r.plpt_prog_dia;
      if(Array.isArray(dia)) dia = dia[0];
      if(dia && dia.deleted_at) return;
      rows.push({
        id:r.id, projeto_id:r.projeto_id, prog_dia_id:r.prog_dia_id,
        status:r.status, data: dia && dia.data, origem:'plpt', deleted_at:null
      });
    });
    return {loaded:true, known:true, rows:rows};
  }

  function jornadaCarregarExtras(projetoId){
    var id = String(projetoId||'');
    if(global.DEMO){
      var vazio = {loaded:true, known:true, rows:[]};
      var mem = Array.isArray(global.composicao_dia) ? programacaoNaMemoria(id) : vazio;
      return Promise.resolve({programacao:mem, requisicoes:vazio, adicionais:vazio});
    }
    return Promise.all([
      lerTabela('plpt_prog_projetos', ['projeto_id=eq.'+id, 'deleted_at=is.null'], 'id,prog_dia_id,projeto_id,status,deleted_at,plpt_prog_dia(data,deleted_at)').then(normalizarPlpt),
      consultarComposicao(id),
      lerTabela('plpt_requisicoes_materiais', ['projeto_id=eq.'+id, 'deleted_at=is.null']),
      lerTabela('sot_adicionais', ['projeto_id=eq.'+id])
    ]).then(function(r){
      return {
        programacao: jornadaMesclarProgramacao(r[0], r[1]),
        requisicoes: r[2],
        adicionais: r[3]
      };
    });
  }

  function pintar(projeto, contexto){
    var root = document.getElementById('sot-jornada-root');
    if(!root || typeof global.jornadaHtml!=='function') return;
    root.innerHTML = global.jornadaHtml(projeto, contexto);
  }

  function jornadaRender(projeto, contextoPronto){
    try{
      if(projeto && projeto._jornadaForcarErro) throw new Error('erro forçado da jornada');
      var root = document.getElementById('sot-jornada-root');
      if(!root) return;
      if(!projeto) throw new Error('projeto ausente');
      if(contextoPronto){
        pintar(projeto, contextoPronto);
        return;
      }
      var base = jornadaContextoDaMemoria(projeto);
      pintar(projeto, base);
      var seq = ++_seq;
      jornadaCarregarExtras(projeto.id).then(function(extra){
        if(seq !== _seq) return;
        if(global._sotProjetoAtual && String(global._sotProjetoAtual)!==String(projeto.id)) return;
        var ctx = jornadaContextoDaMemoria(projeto);
        ctx.programacao = extra.programacao;
        ctx.requisicoes = extra.requisicoes;
        ctx.adicionais = extra.adicionais;
        try{ pintar(projeto, ctx); }
        catch(e2){
          if(global.console && console.error) console.error('[Jornada]', e2);
        }
      }, function(){});
    }catch(e){
      if(global.console && console.error) console.error('[Jornada]', e);
      var el = document.getElementById('sot-jornada-root');
      if(el) el.innerHTML = '<div style="padding:1rem;color:#854F0B">A Jornada não pôde ser exibida. As outras abas do projeto seguem disponíveis.</div>';
    }
  }

  global.jornadaContextoDaMemoria = jornadaContextoDaMemoria;
  global.jornadaComposicaoTemProjeto = jornadaComposicaoTemProjeto;
  global.jornadaFiltroComposicao = jornadaFiltroComposicao;
  global.jornadaMesclarProgramacao = jornadaMesclarProgramacao;
  global.jornadaCarregarExtras = jornadaCarregarExtras;
  global.jornadaRender = jornadaRender;
})(typeof window!=='undefined' ? window : globalThis);
