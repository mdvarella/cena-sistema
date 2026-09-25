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

  function mesSeguinte(ym){
    var y=Number(String(ym).slice(0,4));
    var m=Number(String(ym).slice(5,7));
    if(!y||!m) return '';
    if(m===12) return (y+1)+'-01-01';
    return y+'-'+String(m+1).padStart(2,'0')+'-01';
  }

  async function carregar(ym, opts){
    if(isDemo() || typeof global.sbFetchAll!=='function') return memoria();
    opts=opts||{};
    ym=String(ym||'').slice(0,7);
    var filters=['deleted_at=is.null'];
    if(opts.todos){
      var d=new Date();
      d.setMonth(d.getMonth()-14);
      filters.push('data_hora=gte.'+d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-01');
    } else if(/^\d{4}-\d{2}$/.test(ym)){
      filters.push('data_hora=gte.'+ym+'-01');
      var nxt=mesSeguinte(ym);
      if(nxt) filters.push('data_hora=lt.'+nxt);
    }
    try{
      var rows=await global.sbFetchAll(TABELA,{order:'data_hora.desc',filters:filters,pageSize:1000,maxPages:12});
      var byId={};
      if(!opts.substituirMes) memoria().forEach(function(p){ if(p&&p.id) byId[p.id]=p; });
      (rows||[]).forEach(function(p){ if(p&&p.id) byId[p.id]=p; });
      global.frt_pedagios=Object.keys(byId).map(function(k){ return byId[k]; });
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

  async function buscarPorPlaca(busca){
    var safe=String(busca||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
    if(!safe || safe.length<2) return [];
    if(isDemo() || typeof global.sbFetch!=='function') return [];
    var like='*'+safe+'*';
    var filters=['deleted_at=is.null','or=(placa.ilike.'+like+',placa_normalizada.ilike.'+like+')'];
    try{
      var rows=await global.sbFetch(TABELA,{filters:filters,order:'data_hora.desc',limit:800});
      (rows||[]).forEach(mergeLocal);
      return rows||[];
    }catch(e){
      console.warn('[PEDAGIOS] buscarPorPlaca', e);
      return [];
    }
  }

  async function zerarImportados(){
    var origens=['importacao','sem_parar','ticket'];
    var arr=memoria();
    var nMem=0;
    arr.slice().forEach(function(p){
      var o=String(p&&p.origem||'').toLowerCase().replace(/\s+/g,'').replace('ação','acao').replace('ã','a');
      if(!p||p.deleted_at) return;
      if(o==='manual'||o==='') return;
      if(origens.indexOf(o)<0 && o!=='importação') return;
      p.deleted_at=new Date().toISOString();
      nMem++;
    });
    global.frt_pedagios=arr.filter(function(p){ return p&&!p.deleted_at; });
    if(isDemo() || typeof global.sbDelete!=='function') return {ok:true, memoria:nMem, banco:0};
    var filtro='deleted_at=is.null&origem=in.(importacao,sem_parar,ticket)';
    try{
      await global.sbDelete(TABELA, filtro);
    }catch(e){
      console.warn('[PEDAGIOS] zerarImportados', e);
      return {ok:false, memoria:nMem, banco:0, erro:e};
    }
    return {ok:true, memoria:nMem, banco:'soft-delete origem importada'};
  }

  Ped._repo={
    TABELA:TABELA,
    COLUNAS:COLUNAS,
    memoria:memoria,
    mergeLocal:mergeLocal,
    listarSaidas:listarSaidas,
    listarVeiculos:listarVeiculos,
    carregar:carregar,
    buscarPorPlaca:buscarPorPlaca,
    persistir:persistir,
    zerarImportados:zerarImportados
  };
})(typeof window!=='undefined'?window:this);
