/* Jornada de Projetos — resolvedor único de perfil (Fase 1).
 * EQUATORIAL_PLPT: cliente EQUATORIAL e código ou nome com a palavra PLPT.
 * O UUID do contrato não é a regra. Os outros clientes ficam em BASE_PROJETOS. */
(function(global){
  'use strict';

  function jornadaNorm(s){
    return String(s==null?'':s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim();
  }

  function jornadaTemPalavra(texto, palavra){
    var n = jornadaNorm(texto);
    var p = jornadaNorm(palavra);
    if(!n || !p) return false;
    return new RegExp('(^|[^A-Z0-9])'+p+'([^A-Z0-9]|$)').test(n);
  }

  function jornadaClientePendente(clienteNorm){
    if(!clienteNorm) return false;
    if(clienteNorm==='ENEL' || clienteNorm==='COMGAS' || clienteNorm==='CTEEP') return true;
    if(jornadaTemPalavra(clienteNorm, 'CTEEP')) return true;
    if(jornadaTemPalavra(clienteNorm, 'COMGAS')) return true;
    return false;
  }

  function jornadaAcharContrato(projeto, contrato){
    if(contrato && typeof contrato==='object') return contrato;
    var lista = global.contratos;
    if(!projeto || !Array.isArray(lista)) return null;
    var id = projeto.contrato_id;
    if(id==null || id==='') return null;
    for(var i=0;i<lista.length;i++){
      if(lista[i] && String(lista[i].id)===String(id)) return lista[i];
    }
    return null;
  }

  function jornadaResolverPerfil(projeto, contrato){
    var c = jornadaAcharContrato(projeto, contrato);
    var base = {id:'BASE_PROJETOS', versao:'v1', aviso:null, contrato:c, especificoPendente:false};
    if(!c){
      base.aviso = 'Contrato não carregado — usando jornada base.';
      return base;
    }
    var cliente = jornadaNorm(c.cliente);
    var identificacao = String(c.codigo||'')+' '+String(c.nome||'');
    if(cliente==='EQUATORIAL' && jornadaTemPalavra(identificacao, 'PLPT')){
      return {id:'EQUATORIAL_PLPT', versao:'v1', aviso:null, contrato:c, especificoPendente:false};
    }
    if(jornadaClientePendente(cliente) || cliente==='EQUATORIAL'){
      base.aviso = 'Processo específico ainda não configurado — usando jornada base.';
      base.especificoPendente = true;
    }
    return base;
  }

  global.jornadaNorm = jornadaNorm;
  global.jornadaTemPalavra = jornadaTemPalavra;
  global.jornadaResolverPerfil = jornadaResolverPerfil;
})(typeof window!=='undefined' ? window : globalThis);
