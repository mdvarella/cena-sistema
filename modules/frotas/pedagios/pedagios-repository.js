/* CENA-MOD-PED-1 — Frotas > Pedágios — persistência
 * Sem regra de negócio. Scripts clássicos (sem type=module).
 */
(function(global){
  'use strict';
  var CENA=global.CENA=global.CENA||{};
  CENA.Frotas=CENA.Frotas||{};
  var Ped=CENA.Frotas.Pedagios=CENA.Frotas.Pedagios||{};

  var TABELA='frotas_pedagios';
  var COLUNAS=[
    'veiculo_id','placa','placa_normalizada','modelo','motorista','colaborador_id',
    'data_hora','valor','praca','rodovia','concessionaria','origem','tipo','status',
    'apropriacao_status','portaria_saida_id','equipe_id','equipe_nome','contrato_id',
    'contrato_nome','projeto_id','projeto_nome','centro_custo','filial_id','base_nome',
    'fatura_id','hash_deduplicacao','motivo_sem_apropriacao','observacao',
    'atualizado_por','criado_por'
  ];

  function memoria(){
    if(!global.frt_pedagios) global.frt_pedagios=[];
    return global.frt_pedagios;
  }
  function isDemo(){ return !!global.DEMO; }
  function payload(p){
    var o={};
    COLUNAS.forEach(function(k){
      if(p[k]!==undefined) o[k]=p[k]===''?null:p[k];
    });
    o.updated_at=new Date().toISOString();
    return o;
  }

  function mergeLocal(row){
    if(!row) return;
    var arr=memoria();
    var i=arr.findIndex(function(x){ return x&&String(x.id)===String(row.id); });
    if(i>=0) arr[i]=row;
    else arr.unshift(row);
  }

  function listarSaidas(){
    if(global.frt_portaria && global.frt_portaria.length) return global.frt_portaria;
    return [];
  }

  function listarVeiculos(){
    return global.frt_veiculos||[];
  }

  async function carregar(ym){
    if(isDemo() || typeof global.sbFetchAll!=='function') return memoria();
    ym=String(ym||'').slice(0,7);
    var filters=['deleted_at=is.null'];
    if(/^\d{4}-\d{2}$/.test(ym)) filters.push('data_hora=gte.'+ym+'-01');
    try{
      var rows=await global.sbFetchAll(TABELA,{order:'data_hora.desc',filters:filters,maxPages:6});
      if(rows&&rows.length){
        var byId={};
        memoria().forEach(function(p){ if(p&&p.id) byId[p.id]=p; });
        rows.forEach(function(p){ if(p&&p.id) byId[p.id]=p; });
        global.frt_pedagios=Object.keys(byId).map(function(k){ return byId[k]; });
      }
    }catch(e){
      console.warn('[PEDAGIOS] carregar — tabela frotas_pedagios', e);
    }
    return memoria();
  }

  async function persistir(p, modo){
    p.atualizado_por=p.atualizado_por||((global.usuarioLogado&&(global.usuarioLogado.nome||global.usuarioLogado.email))||'Sistema');
    if(modo==='criar') p.criado_por=p.criado_por||p.atualizado_por;
    if(isDemo() || typeof global.sbInsert!=='function'){
      mergeLocal(p);
      return p;
    }
    try{
      if(modo==='criar'){
        var ins=await global.sbInsert(TABELA, payload(p), {silent:true});
        if(ins&&ins[0]) p=Object.assign(p, ins[0]);
      } else if(p.id){
        await global.sbUpdate(TABELA, payload(p), 'id=eq.'+p.id);
      }
    }catch(e){
      console.warn('[PEDAGIOS] persist', e);
    }
    mergeLocal(p);
    return p;
  }

  Ped._repo={
    TABELA:TABELA,
    COLUNAS:COLUNAS,
    memoria:memoria,
    mergeLocal:mergeLocal,
    listarSaidas:listarSaidas,
    listarVeiculos:listarVeiculos,
    carregar:carregar,
    persistir:persistir
  };
})(typeof window!=='undefined'?window:this);
