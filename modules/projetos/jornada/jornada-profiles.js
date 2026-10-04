/* Jornada de Projetos — definição dos perfis (Fase 1).
 * Só BASE_PROJETOS e EQUATORIAL_PLPT. Sem banco. */
(function(global){
  'use strict';

  var FASES_COMUNS = [
    {id:'preparacao', titulo:'Preparação'},
    {id:'planejamento', titulo:'Planejamento'},
    {id:'campo', titulo:'Campo'},
    {id:'medicao', titulo:'Medição'}
  ];

  var JORNADA_PERFIS = {
    BASE_PROJETOS: {
      id:'BASE_PROJETOS',
      versao:'v1',
      asBuilt:false,
      fases:FASES_COMUNS
    },
    EQUATORIAL_PLPT: {
      id:'EQUATORIAL_PLPT',
      versao:'v1',
      asBuilt:true,
      fases:FASES_COMUNS
    }
  };

  global.JORNADA_PERFIS = JORNADA_PERFIS;
  global.jornadaPerfilDef = function(id){
    return JORNADA_PERFIS[id] || JORNADA_PERFIS.BASE_PROJETOS;
  };
})(typeof window!=='undefined' ? window : globalThis);
