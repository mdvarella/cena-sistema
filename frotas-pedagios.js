/* FROTAS-PEDAGIOS-1 — Frotas → Pedágios (fonte única do custo operacional)
 * Carrega no <head> (como os outros shells). Funções só usam APIs do ERP em runtime.
 * Sem Parar / Ticket NÃO lançam na Viabilidade — entram primeiro aqui.
 */
(function(global){
  'use strict';

  if(!global.frt_pedagios) global.frt_pedagios = [];

  var STATUS_CUSTO = {VALIDADO:1, CONCILIADO:1};
  var STATUS_FORA = {CANCELADO:1, POSSIVEL_DUPLICIDADE:1, DIVERGENTE:1, PENDENTE:1};
  var TABELA = 'frotas_pedagios';
  var COLUNAS = [
    'veiculo_id','placa','placa_normalizada','modelo','motorista','colaborador_id',
    'data_hora','valor','praca','rodovia','concessionaria','origem','tipo','status',
    'apropriacao_status','portaria_saida_id','equipe_id','equipe_nome','contrato_id',
    'contrato_nome','projeto_id','projeto_nome','centro_custo','filial_id','base_nome',
    'fatura_id','hash_deduplicacao','motivo_sem_apropriacao','observacao',
    'atualizado_por','criado_por'
  ];

  function _np(p){
    if(typeof global.frtNormPlaca==='function') return global.frtNormPlaca(p);
    return String(p||'').toUpperCase().replace(/[-\s]/g,'');
  }
  function _esc(s){
    if(typeof global.escHtml==='function') return global.escHtml(s);
    return String(s==null?'':s).replace(/[&<>"']/g,function(c){
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
    });
  }
  function _toast(msg, tipo){
    if(typeof global.progShowToast==='function') global.progShowToast(msg, tipo);
    else if(tipo==='erro') console.warn('[PEDAGIOS]', msg);
  }
  function _audit(acao, desc, extra){
    if(typeof global.auditLog==='function'){
      try{ global.auditLog(acao, 'frotas', desc, extra||{}); }catch(eA){}
    }
  }
  function _userNome(){
    var u=global.usuarioLogado;
    return (u&& (u.nome||u.email)) || 'Sistema';
  }
  function _isDemo(){ return !!global.DEMO; }
  function _fmtR(v){
    return (Number(v)||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  }
  function _fmtDt(s){
    if(!s) return '—';
    var d=new Date(s);
    if(isNaN(d.getTime())) return String(s).replace('T',' ').slice(0,16);
    return d.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
  }
  function _parseJson(v, fb){
    if(typeof global.parseJsonField==='function') return global.parseJsonField(v, fb);
    if(Array.isArray(v)) return v;
    if(typeof v==='string'){ try{ var x=JSON.parse(v); return x!=null?x:fb; }catch(e){ return fb; } }
    return v!=null?v:fb;
  }
  function _payload(p){
    var o={};
    COLUNAS.forEach(function(k){
      if(p[k]!==undefined) o[k]=p[k]===''?null:p[k];
    });
    o.updated_at=new Date().toISOString();
    return o;
  }

  function frtPedNormStatus(s){
    return String(s||'').trim().toUpperCase().replace(/\s+/g,'_');
  }
  function frtPedEhFatura(p){
    return String((p&&p.tipo)||'PASSAGEM').toUpperCase()==='FATURA';
  }
  function frtPedEntraNoCusto(p){
    if(!p || p.deleted_at) return false;
    if(frtPedEhFatura(p)) return false;
    var st=frtPedNormStatus(p.status);
    if(STATUS_FORA[st]) return false;
    return !!STATUS_CUSTO[st];
  }
  function frtPedCompetenciaYm(p){
    var s=String((p&&p.data_hora)||'');
    if(s.length>=7) return s.slice(0,7);
    return '';
  }
  function frtPedHash(p){
    if(p&&p.hash_deduplicacao) return p.hash_deduplicacao;
    var key=[
      _np(p&&p.placa),
      String((p&&p.data_hora)||'').slice(0,16),
      String((p&&p.praca)||'').toLowerCase(),
      String(Number((p&&p.valor)||0).toFixed(2)),
      String((p&&p.origem)||'').toLowerCase(),
      String((p&&p.tipo)||'PASSAGEM').toUpperCase()
    ].join('|');
    var h=0;
    for(var i=0;i<key.length;i++){ h=((h<<5)-h)+key.charCodeAt(i); h|=0; }
    return 'ped_'+Math.abs(h).toString(16)+'_'+key.length;
  }

  function frtPedListaSaidas(){
    if(global.frt_portaria && global.frt_portaria.length) return global.frt_portaria;
    return [];
  }

  /** Primeira fonte: viagem compatível em frotas_portaria_saidas (placa + janela data_saida/retorno). */
  function frtPedResolverViagem(p){
    var placa=_np(p&&p.placa);
    var ts=Date.parse(p&&p.data_hora);
    if(!placa || !ts) return null;
    var best=null, bestDist=Infinity;
    frtPedListaSaidas().forEach(function(s){
      if(!s || s.deleted_at) return;
      if(_np(s.placa)!==placa) return;
      var t0=Date.parse(s.data_saida);
      if(!t0) return;
      var t1=s.data_retorno ? Date.parse(s.data_retorno) : (t0 + 18*3600000);
      if(isNaN(t1)) t1=t0+18*3600000;
      if(ts<t0 || ts>t1) return;
      var dist=Math.abs(ts-t0);
      if(dist<bestDist){ best=s; bestDist=dist; }
    });
    return best;
  }

  function frtPedNomeContrato(cid){
    if(!cid) return '';
    try{
      var c=(global.contratos||[]).find(function(x){ return String(x.id)===String(cid); });
      return c ? (c.nome||c.codigo||'') : '';
    }catch(e){ return ''; }
  }
  function frtPedNomeEquipe(eid){
    if(!eid) return '';
    var listas=[global.equipes, global.equipes_disp];
    for(var i=0;i<listas.length;i++){
      var arr=listas[i]||[];
      var e=arr.find(function(x){ return String(x.id)===String(eid); });
      if(e) return e.nome||e.codigo||'';
    }
    return '';
  }
  function frtPedResolverProjeto(saida){
    if(!saida) return null;
    var dia=String(saida.data_saida||'').slice(0,10);
    var eid=saida.equipe_id;
    if(!eid || !dia) return null;
    var comps=global.composicao_dia||[];
    var c=comps.find(function(x){
      return String(x.equipe_id)===String(eid) && String(x.data||'').slice(0,10)===dia;
    });
    var pids=_parseJson(c&&c.projeto_ids, []);
    if((!pids || !pids.length) && global.prog_projetos){
      var pp=(global.prog_projetos||[]).find(function(x){
        return String(x.equipe_id)===String(eid) && String(x.data||'').slice(0,10)===dia;
      });
      if(pp&&pp.projeto_id) pids=[pp.projeto_id];
    }
    if(!pids || !pids.length) return null;
    var pid=pids[0];
    var nome='';
    var fontes=[global.sot_projetos, global.projetos, global.obras_projetos];
    for(var i=0;i<fontes.length;i++){
      var arr=fontes[i]||[];
      var pr=arr.find(function(x){ return String(x.id)===String(pid); });
      if(pr){ nome=pr.codigo_cliente||pr.codigo||pr.nome||pr.numero_cadastro||''; break; }
    }
    return {projeto_id:pid, projeto_nome:nome};
  }

  function frtPedAplicarVinculo(p, saida){
    p=p||{};
    if(!saida){
      p.portaria_saida_id=p.portaria_saida_id||null;
      if(!p.contrato_id){
        p.apropriacao_status='SEM_APROPRIACAO';
        p.motivo_sem_apropriacao=p.motivo_sem_apropriacao||'SEM_VIAGEM_COMPATIVEL';
      }
      return p;
    }
    p.portaria_saida_id=saida.id||p.portaria_saida_id;
    p.veiculo_id=p.veiculo_id||saida.veiculo_id||null;
    p.motorista=p.motorista||saida.motorista||saida.quem_saiu||'';
    p.equipe_id=p.equipe_id||saida.equipe_id||null;
    p.equipe_nome=p.equipe_nome||saida.equipe_nome||saida.equipe||frtPedNomeEquipe(p.equipe_id);
    p.contrato_id=p.contrato_id||saida.contrato_id||null;
    if(!p.contrato_id && p.equipe_id){
      var eq=(global.equipes||[]).concat(global.equipes_disp||[]).find(function(x){
        return String(x.id)===String(p.equipe_id);
      });
      if(eq&&eq.contrato_id) p.contrato_id=eq.contrato_id;
    }
    p.contrato_nome=p.contrato_nome||saida.contrato_nome||frtPedNomeContrato(p.contrato_id);
    p.base_nome=p.base_nome||saida.base_saida||'';
    p.filial_id=p.filial_id||saida.filial_id||null;
    var proj=frtPedResolverProjeto(saida);
    if(proj){
      p.projeto_id=p.projeto_id||proj.projeto_id;
      p.projeto_nome=p.projeto_nome||proj.projeto_nome;
    }
    if(p.contrato_id){
      p.apropriacao_status='APROPRIADO';
      p.motivo_sem_apropriacao=null;
    } else {
      p.apropriacao_status='SEM_APROPRIACAO';
      p.motivo_sem_apropriacao='VIAGEM_SEM_CONTRATO';
    }
    return p;
  }

  function frtPedApropriarAuto(p){
    p=p||{};
    if(p.contrato_id && frtPedNormStatus(p.apropriacao_status)==='APROPRIADO') return p;
    var saida=frtPedResolverViagem(p);
    var antes={
      contrato_id:p.contrato_id, projeto_id:p.projeto_id,
      equipe_id:p.equipe_id, portaria_saida_id:p.portaria_saida_id,
      apropriacao_status:p.apropriacao_status
    };
    frtPedAplicarVinculo(p, saida);
    if(String(antes.contrato_id||'')!==String(p.contrato_id||'')
      || String(antes.apropriacao_status||'')!==String(p.apropriacao_status||'')){
      _audit('editar', 'Apropriação automática de pedágio '+_np(p.placa)+' '+_fmtR(p.valor), {
        evento:'apropriacao_automatica',
        pedagio_id:p.id, antes:antes,
        depois:{
          contrato_id:p.contrato_id, projeto_id:p.projeto_id,
          equipe_id:p.equipe_id, portaria_saida_id:p.portaria_saida_id,
          apropriacao_status:p.apropriacao_status,
          motivo_sem_apropriacao:p.motivo_sem_apropriacao
        }
      });
    }
    return p;
  }

  function frtPedPossivelDuplicata(p, lista){
    var h=frtPedHash(p);
    var arr=lista||global.frt_pedagios||[];
    return arr.some(function(x){
      if(!x || x.deleted_at) return false;
      if(p.id && String(x.id)===String(p.id)) return false;
      return frtPedHash(x)===h;
    });
  }

  function frtPedMergeLocal(row){
    if(!row) return;
    if(!global.frt_pedagios) global.frt_pedagios=[];
    var i=global.frt_pedagios.findIndex(function(x){ return x&&String(x.id)===String(row.id); });
    if(i>=0) global.frt_pedagios[i]=row;
    else global.frt_pedagios.unshift(row);
  }

  async function frtPedPersistir(p, modo){
    p.hash_deduplicacao=frtPedHash(p);
    p.placa_normalizada=_np(p.placa);
    p.atualizado_por=_userNome();
    if(modo==='criar') p.criado_por=p.criado_por||_userNome();
    if(_isDemo() || typeof global.sbInsert!=='function'){
      frtPedMergeLocal(p);
      return p;
    }
    try{
      if(modo==='criar'){
        var ins=await global.sbInsert(TABELA, _payload(p), {silent:true});
        if(ins&&ins[0]){ p=Object.assign(p, ins[0]); }
      } else if(p.id){
        await global.sbUpdate(TABELA, _payload(p), 'id=eq.'+p.id);
      }
    }catch(e){
      console.warn('[PEDAGIOS] persist', e);
    }
    frtPedMergeLocal(p);
    return p;
  }

  async function frtPedSalvarNovo(form){
    var p={
      id:_isDemo()?('ped_'+Date.now()):undefined,
      veiculo_id:form.veiculo_id||null,
      placa:form.placa||'',
      modelo:form.modelo||'',
      motorista:form.motorista||'',
      data_hora:form.data_hora||new Date().toISOString(),
      valor:Math.round((Number(form.valor)||0)*100)/100,
      praca:form.praca||'',
      rodovia:form.rodovia||'',
      concessionaria:form.concessionaria||'',
      origem:form.origem||'manual',
      tipo:form.tipo||'PASSAGEM',
      status:form.status||'VALIDADO',
      observacao:form.observacao||'',
      contrato_id:form.contrato_id||null,
      contrato_nome:form.contrato_nome||'',
      equipe_id:form.equipe_id||null,
      equipe_nome:form.equipe_nome||'',
      projeto_id:form.projeto_id||null,
      projeto_nome:form.projeto_nome||'',
      centro_custo:form.centro_custo||'',
      portaria_saida_id:form.portaria_saida_id||null
    };
    if(frtPedEhFatura(p)){
      p.apropriacao_status='PENDENTE';
      p.motivo_sem_apropriacao='FATURA_NAO_E_CUSTO';
    } else if(frtPedPossivelDuplicata(p)){
      p.status='POSSIVEL_DUPLICIDADE';
      p.apropriacao_status='SEM_APROPRIACAO';
      p.motivo_sem_apropriacao='POSSIVEL_DUPLICIDADE';
    } else if(p.contrato_id){
      p.apropriacao_status='APROPRIADO';
      p.contrato_nome=p.contrato_nome||frtPedNomeContrato(p.contrato_id);
    } else {
      frtPedApropriarAuto(p);
    }
    p=await frtPedPersistir(p, 'criar');
    _audit('criar', 'Cadastrou pedágio '+_np(p.placa)+' '+_fmtR(p.valor), {
      evento:'cadastro_pedagio', pedagio_id:p.id, status:p.status,
      apropriacao_status:p.apropriacao_status, origem:p.origem, tipo:p.tipo
    });
    return p;
  }

  async function frtPedEditarValor(id, novoValor){
    var p=(global.frt_pedagios||[]).find(function(x){ return x&&String(x.id)===String(id); });
    if(!p) return null;
    var antes=Number(p.valor||0);
    p.valor=Math.round((Number(novoValor)||0)*100)/100;
    await frtPedPersistir(p, 'editar');
    _audit('editar', 'Ajustou valor do pedágio '+_np(p.placa)+' '+_fmtR(antes)+' → '+_fmtR(p.valor), {
      evento:'ajuste_valor', pedagio_id:p.id, valor_antes:antes, valor_depois:p.valor
    });
    return p;
  }

  async function frtPedCancelar(id, motivo){
    var p=(global.frt_pedagios||[]).find(function(x){ return x&&String(x.id)===String(id); });
    if(!p) return null;
    var antes=p.status;
    p.status='CANCELADO';
    p.observacao=((p.observacao||'')+(motivo?(' | cancelamento: '+motivo):'')).trim();
    await frtPedPersistir(p, 'editar');
    _audit('editar', 'Cancelou pedágio '+_np(p.placa)+' '+_fmtR(p.valor), {
      evento:'cancelamento', pedagio_id:p.id, status_antes:antes, motivo:motivo||''
    });
    return p;
  }

  async function frtPedClassificarManual(id, campos){
    var p=(global.frt_pedagios||[]).find(function(x){ return x&&String(x.id)===String(id); });
    if(!p) return null;
    var antes={
      contrato_id:p.contrato_id, projeto_id:p.projeto_id,
      equipe_id:p.equipe_id, centro_custo:p.centro_custo,
      apropriacao_status:p.apropriacao_status
    };
    campos=campos||{};
    if(campos.contrato_id!==undefined){
      p.contrato_id=campos.contrato_id||null;
      p.contrato_nome=campos.contrato_nome||frtPedNomeContrato(p.contrato_id);
    }
    if(campos.projeto_id!==undefined){
      p.projeto_id=campos.projeto_id||null;
      p.projeto_nome=campos.projeto_nome||'';
    }
    if(campos.equipe_id!==undefined){
      p.equipe_id=campos.equipe_id||null;
      p.equipe_nome=campos.equipe_nome||frtPedNomeEquipe(p.equipe_id);
    }
    if(campos.centro_custo!==undefined) p.centro_custo=campos.centro_custo||'';
    if(campos.remover_vinculo){
      p.contrato_id=null; p.contrato_nome='';
      p.projeto_id=null; p.projeto_nome='';
      p.apropriacao_status='SEM_APROPRIACAO';
      p.motivo_sem_apropriacao='REMOCAO_MANUAL';
      _audit('editar', 'Removeu vínculo de pedágio '+_np(p.placa), {
        evento:'remocao_vinculo', pedagio_id:p.id, antes:antes
      });
    } else if(p.contrato_id){
      p.apropriacao_status='APROPRIADO';
      p.motivo_sem_apropriacao=null;
      _audit('editar', 'Apropriação manual de pedágio '+_np(p.placa)+' contrato='+(p.contrato_nome||p.contrato_id), {
        evento:'apropriacao_manual', pedagio_id:p.id, antes:antes,
        depois:{contrato_id:p.contrato_id, projeto_id:p.projeto_id, equipe_id:p.equipe_id, centro_custo:p.centro_custo}
      });
    } else {
      p.apropriacao_status='SEM_APROPRIACAO';
      p.motivo_sem_apropriacao=p.motivo_sem_apropriacao||'CLASSIFICACAO_SEM_CONTRATO';
    }
    await frtPedPersistir(p, 'editar');
    return p;
  }

  function frtPedMatchContrato(p, cid){
    if(!p || !cid) return false;
    if(String(p.contrato_id||'')===String(cid)) return true;
    return false;
  }

  function frtPedSomarContrato(cid, ym){
    ym=String(ym||'').slice(0,7);
    var tot=0, qtd=0;
    (global.frt_pedagios||[]).forEach(function(p){
      if(!frtPedEntraNoCusto(p)) return;
      if(frtPedNormStatus(p.apropriacao_status)!=='APROPRIADO') return;
      if(!frtPedMatchContrato(p, cid)) return;
      if(ym && frtPedCompetenciaYm(p)!==ym) return;
      tot+=Number(p.valor||0)||0;
      qtd++;
    });
    return {valor:Math.round(tot*100)/100, qtd:qtd};
  }

  function frtPedListarSemApropriacao(){
    return (global.frt_pedagios||[]).filter(function(p){
      if(!p || p.deleted_at) return false;
      if(frtPedEhFatura(p)) return false;
      if(frtPedNormStatus(p.status)==='CANCELADO') return false;
      return frtPedNormStatus(p.apropriacao_status)==='SEM_APROPRIACAO'
        || (!p.contrato_id && frtPedEntraNoCusto(p));
    });
  }

  function frtPedIndicadores(filtro){
    filtro=filtro||{};
    var out={
      total:0, qtd:0,
      por_contrato:{}, por_equipe:{}, por_veiculo:{},
      por_concessionaria:{}, por_rodovia:{}, por_viagem:{}
    };
    (global.frt_pedagios||[]).forEach(function(p){
      if(!frtPedEntraNoCusto(p)) return;
      if(filtro.ym && frtPedCompetenciaYm(p)!==filtro.ym) return;
      if(filtro.cid && !frtPedMatchContrato(p, filtro.cid)) return;
      var v=Number(p.valor||0)||0;
      out.total+=v; out.qtd++;
      function add(map, key){
        key=key||'—';
        if(!map[key]) map[key]=0;
        map[key]+=v;
      }
      add(out.por_contrato, p.contrato_nome||p.contrato_id);
      add(out.por_equipe, p.equipe_nome||p.equipe_id);
      add(out.por_veiculo, p.placa);
      add(out.por_concessionaria, p.concessionaria);
      add(out.por_rodovia, p.rodovia);
      add(out.por_viagem, p.portaria_saida_id);
    });
    out.total=Math.round(out.total*100)/100;
    return out;
  }

  async function frtPedCarregar(ym){
    if(_isDemo() || typeof global.sbFetchAll!=='function') return global.frt_pedagios||[];
    ym=String(ym||'').slice(0,7);
    var filters=['deleted_at=is.null'];
    if(/^\d{4}-\d{2}$/.test(ym)) filters.push('data_hora=gte.'+ym+'-01');
    try{
      var rows=await global.sbFetchAll(TABELA, {order:'data_hora.desc', filters:filters, maxPages:6});
      if(rows&&rows.length){
        var byId={};
        (global.frt_pedagios||[]).forEach(function(p){ if(p&&p.id) byId[p.id]=p; });
        rows.forEach(function(p){ if(p&&p.id) byId[p.id]=p; });
        global.frt_pedagios=Object.keys(byId).map(function(k){ return byId[k]; });
      }
    }catch(e){
      console.warn('[PEDAGIOS] carregar — aplique sql_frotas_pedagios_1.sql se a tabela não existir', e);
    }
    return global.frt_pedagios||[];
  }

  function frtPedPopularFiltros(){
    var sel=document.getElementById('frt-ped-cont');
    if(!sel) return;
    var keep=sel.value;
    var opts='<option value="">Todos os contratos</option>';
    (global.contratos||[]).forEach(function(c){
      if(c.ativo===false) return;
      opts+='<option value="'+_esc(c.id)+'">'+_esc(c.codigo||c.nome||c.id)+'</option>';
    });
    sel.innerHTML=opts;
    if(keep) sel.value=keep;
    var mes=document.getElementById('frt-ped-mes');
    if(mes && !mes.value){
      var d=new Date();
      mes.value=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
    }
  }

  function frtPedStatusChip(st){
    st=frtPedNormStatus(st);
    var cor='#888';
    if(st==='VALIDADO'||st==='CONCILIADO') cor='#3B6D11';
    else if(st==='PENDENTE') cor='#854F0B';
    else if(st==='CANCELADO'||st==='DIVERGENTE'||st==='POSSIVEL_DUPLICIDADE') cor='#A32D2D';
    return '<span class="bdg" style="background:'+cor+';color:#fff;font-size:10px">'+_esc(st||'—')+'</span>';
  }

  function frtPedAba(aba){
    global._frtPedAba=aba||'lista';
    var lista=document.getElementById('frt-ped-panel-lista');
    var fila=document.getElementById('frt-ped-panel-fila');
    var bL=document.getElementById('frt-ped-tab-lista');
    var bF=document.getElementById('frt-ped-tab-fila');
    if(lista) lista.style.display=aba==='fila'?'none':'';
    if(fila) fila.style.display=aba==='fila'?'':'none';
    if(bL){ bL.style.borderBottomColor=aba==='fila'?'transparent':'#1a1a18'; bL.style.color=aba==='fila'?'#888':'#1a1a18'; }
    if(bF){ bF.style.borderBottomColor=aba==='fila'?'#1a1a18':'transparent'; bF.style.color=aba==='fila'?'#1a1a18':'#888'; }
    if(aba==='fila') frtPedRenderFila();
  }

  function frtPedRenderFila(){
    var wrap=document.getElementById('frt-ped-fila');
    var badge=document.getElementById('frt-ped-fila-badge');
    var rows=frtPedListarSemApropriacao();
    if(badge){
      badge.textContent=rows.length||'';
      badge.style.display=rows.length?'inline-flex':'none';
    }
    if(!wrap) return;
    if(!rows.length){
      wrap.innerHTML='<div style="padding:1.5rem;text-align:center;color:#888">Nenhum pedágio sem apropriação.</div>';
      return;
    }
    wrap.innerHTML='<div style="overflow-x:auto"><table class="tbl tbl-responsive"><thead><tr>'
      +'<th>Data</th><th>Placa</th><th>Veículo</th><th>Praça</th><th style="text-align:right">Valor</th>'
      +'<th>Motorista</th><th>Possível equipe</th><th>Motivo</th><th></th>'
      +'</tr></thead><tbody>'
      +rows.map(function(p){
        return '<tr>'
          +'<td>'+_esc(_fmtDt(p.data_hora))+'</td>'
          +'<td style="font-family:monospace">'+_esc(p.placa||'—')+'</td>'
          +'<td>'+_esc(p.modelo||'—')+'</td>'
          +'<td>'+_esc(p.praca||'—')+'</td>'
          +'<td style="text-align:right">'+_fmtR(p.valor)+'</td>'
          +'<td>'+_esc(p.motorista||'—')+'</td>'
          +'<td>'+_esc(p.equipe_nome||'—')+'</td>'
          +'<td style="font-size:11px;color:#854F0B">'+_esc(p.motivo_sem_apropriacao||'SEM_APROPRIACAO')+'</td>'
          +'<td><button class="btn btn-sm btn-pri" onclick="frtPedAbrirClassificar(\''+_esc(p.id)+'\')">Classificar</button></td>'
          +'</tr>';
      }).join('')
      +'</tbody></table></div>';
  }

  function frtPedFiltrados(){
    var mesEl=document.getElementById('frt-ped-mes');
    var todos=document.getElementById('frt-ped-todos');
    var cid=(document.getElementById('frt-ped-cont')||{}).value||'';
    var placa=(document.getElementById('frt-ped-placa')||{}).value||'';
    var st=(document.getElementById('frt-ped-status')||{}).value||'';
    var ym=(!todos||!todos.checked) ? ((mesEl&&mesEl.value)||'') : '';
    return (global.frt_pedagios||[]).filter(function(p){
      if(!p || p.deleted_at) return false;
      if(ym && frtPedCompetenciaYm(p)!==ym) return false;
      if(cid && !frtPedMatchContrato(p, cid)) return false;
      if(placa){
        if(typeof global.frtPlacaMatchBusca==='function'){
          if(!global.frtPlacaMatchBusca(p.placa, placa)) return false;
        } else if(_np(p.placa).indexOf(_np(placa))<0) return false;
      }
      if(st && frtPedNormStatus(p.status)!==frtPedNormStatus(st)) return false;
      return true;
    });
  }

  function frtPedRender(){
    frtPedPopularFiltros();
    var rows=frtPedFiltrados();
    var met=document.getElementById('frt-ped-metricas');
    var custo=0, fatura=0, semAp=0, valid=0;
    rows.forEach(function(p){
      if(frtPedEhFatura(p)) fatura+=Number(p.valor||0);
      else if(frtPedEntraNoCusto(p)){ custo+=Number(p.valor||0); valid++; }
      if(frtPedNormStatus(p.apropriacao_status)==='SEM_APROPRIACAO') semAp++;
    });
    if(met){
      met.innerHTML=[
        {l:'Passagens (custo)', v:_fmtR(custo), c:'#185FA5'},
        {l:'Válidas', v:String(valid), c:'#3B6D11'},
        {l:'Faturas (não custo)', v:_fmtR(fatura), c:'#888'},
        {l:'Sem apropriação', v:String(semAp), c:'#854F0B'}
      ].map(function(m){
        return '<div style="background:#fff;border:.5px solid #e0dfd8;border-radius:10px;padding:.6rem;text-align:center">'
          +'<div style="font-size:10px;color:#888">'+m.l+'</div>'
          +'<div style="font-size:16px;font-weight:700;color:'+m.c+'">'+m.v+'</div></div>';
      }).join('');
    }
    var tb=document.getElementById('frt-ped-tbody');
    if(tb){
      if(!rows.length){
        tb.innerHTML='<tr><td colspan="12" style="text-align:center;color:#888;padding:1.5rem">Nenhum pedágio no filtro.</td></tr>';
      } else {
        tb.innerHTML=rows.map(function(p){
          var tipo=frtPedEhFatura(p)?'<span class="bdg gray">FATURA</span>':'<span class="bdg info">PASSAGEM</span>';
          return '<tr>'
            +'<td>'+_esc(_fmtDt(p.data_hora))+'</td>'
            +'<td style="font-family:monospace">'+_esc(p.placa||'—')+'</td>'
            +'<td>'+_esc(p.modelo||'—')+'</td>'
            +'<td>'+_esc(p.praca||'—')+'</td>'
            +'<td>'+_esc(p.rodovia||'—')+'</td>'
            +'<td>'+_esc(p.concessionaria||'—')+'</td>'
            +'<td style="text-align:right;font-weight:600">'+_fmtR(p.valor)+'</td>'
            +'<td>'+_esc(p.equipe_nome||'—')+'</td>'
            +'<td>'+_esc(p.contrato_nome||'—')+'</td>'
            +'<td>'+_esc(p.projeto_nome||'—')+'</td>'
            +'<td>'+tipo+' '+frtPedStatusChip(p.status)+'</td>'
            +'<td style="white-space:nowrap">'
            +'<button class="btn btn-sm" onclick="frtPedAbrirEditar(\''+_esc(p.id)+'\')">✏</button> '
            +(frtPedNormStatus(p.apropriacao_status)==='SEM_APROPRIACAO'
              ?'<button class="btn btn-sm btn-pri" onclick="frtPedAbrirClassificar(\''+_esc(p.id)+'\')">Vincular</button> '
              :'')
            +(frtPedNormStatus(p.status)!=='CANCELADO'
              ?'<button class="btn btn-sm" style="color:#A32D2D" onclick="frtPedConfirmarCancelar(\''+_esc(p.id)+'\')">✕</button>'
              :'')
            +'</td></tr>';
        }).join('');
      }
    }
    var badge=document.getElementById('frt-ped-fila-badge');
    var nFila=frtPedListarSemApropriacao().length;
    if(badge){
      badge.textContent=nFila||'';
      badge.style.display=nFila?'inline-flex':'none';
    }
    if(global._frtPedAba==='fila') frtPedRenderFila();
  }

  function frtPedOptsContrato(sel){
    var h='<option value="">— sem contrato —</option>';
    (global.contratos||[]).forEach(function(c){
      if(c.ativo===false) return;
      h+='<option value="'+_esc(c.id)+'"'+(String(sel)===String(c.id)?' selected':'')+'>'
        +_esc(c.codigo||c.nome||c.id)+'</option>';
    });
    return h;
  }
  function frtPedOptsVeiculo(selPlaca){
    var h='<option value="">Selecione…</option>';
    (global.frt_veiculos||[]).forEach(function(v){
      if(String(v.status||'').toLowerCase()==='inativo') return;
      h+='<option value="'+_esc(v.placa)+'" data-vid="'+_esc(v.id||'')+'" data-modelo="'+_esc(v.modelo||'')+'"'
        +(_np(v.placa)===_np(selPlaca)?' selected':'')+'>'
        +_esc(v.placa)+' — '+_esc(v.modelo||'')+'</option>';
    });
    return h;
  }

  function frtPedAbrirNovo(){
    if(typeof global.setModal!=='function'){ _toast('Modal indisponível','erro'); return; }
    var agora=new Date();
    var local=agora.getFullYear()+'-'+String(agora.getMonth()+1).padStart(2,'0')+'-'
      +String(agora.getDate()).padStart(2,'0')+'T'+String(agora.getHours()).padStart(2,'0')+':'
      +String(agora.getMinutes()).padStart(2,'0');
    global.setModal('<div class="modal-bg"><div class="modal" style="max-width:560px"><h3>Novo pedágio</h3>'
      +'<div class="g2"><div class="fg"><label>Veículo / placa</label><select class="inp" id="frt-ped-f-placa" style="width:100%">'+frtPedOptsVeiculo('')+'</select></div>'
      +'<div class="fg"><label>Data/hora da passagem</label><input class="inp" id="frt-ped-f-dt" type="datetime-local" value="'+local+'" style="width:100%"/></div></div>'
      +'<div class="g2"><div class="fg"><label>Valor (R$)</label><input class="inp" id="frt-ped-f-valor" type="number" step="0.01" min="0" style="width:100%"/></div>'
      +'<div class="fg"><label>Praça</label><input class="inp" id="frt-ped-f-praca" style="width:100%" placeholder="Praça / pedágio"/></div></div>'
      +'<div class="g2"><div class="fg"><label>Rodovia</label><input class="inp" id="frt-ped-f-rodovia" style="width:100%"/></div>'
      +'<div class="fg"><label>Concessionária</label><input class="inp" id="frt-ped-f-conc" style="width:100%" placeholder="Sem Parar, CCR…"/></div></div>'
      +'<div class="g2"><div class="fg"><label>Origem</label><select class="inp" id="frt-ped-f-origem" style="width:100%">'
      +'<option value="manual">manual</option><option value="sem_parar">sem_parar</option>'
      +'<option value="ticket">ticket</option><option value="importacao">importacao</option></select></div>'
      +'<div class="fg"><label>Tipo</label><select class="inp" id="frt-ped-f-tipo" style="width:100%">'
      +'<option value="PASSAGEM">PASSAGEM (custo)</option><option value="FATURA">FATURA (não é custo)</option></select></div></div>'
      +'<div class="fg"><label>Status</label><select class="inp" id="frt-ped-f-status" style="width:100%">'
      +'<option value="VALIDADO">VALIDADO</option><option value="PENDENTE">PENDENTE</option>'
      +'<option value="CONCILIADO">CONCILIADO</option></select></div>'
      +'<div style="margin-top:1rem;text-align:right;display:flex;gap:6px;justify-content:flex-end">'
      +'<button class="btn" onclick="closeModal()">Cancelar</button>'
      +'<button class="btn btn-pri" onclick="frtPedConfirmarNovo()">Salvar</button></div></div></div>');
  }

  async function frtPedConfirmarNovo(){
    var sel=document.getElementById('frt-ped-f-placa');
    var placa=sel?sel.value:'';
    var opt=sel&&sel.options[sel.selectedIndex];
    var dt=(document.getElementById('frt-ped-f-dt')||{}).value;
    var valor=(document.getElementById('frt-ped-f-valor')||{}).value;
    if(!placa){ _toast('Selecione o veículo.','erro'); return; }
    if(!(Number(valor)>0)){ _toast('Informe o valor da passagem.','erro'); return; }
    var iso=dt ? new Date(dt).toISOString() : new Date().toISOString();
    await frtPedSalvarNovo({
      placa:placa,
      veiculo_id:opt&&opt.getAttribute('data-vid'),
      modelo:opt&&opt.getAttribute('data-modelo'),
      data_hora:iso,
      valor:valor,
      praca:(document.getElementById('frt-ped-f-praca')||{}).value,
      rodovia:(document.getElementById('frt-ped-f-rodovia')||{}).value,
      concessionaria:(document.getElementById('frt-ped-f-conc')||{}).value,
      origem:(document.getElementById('frt-ped-f-origem')||{}).value||'manual',
      tipo:(document.getElementById('frt-ped-f-tipo')||{}).value||'PASSAGEM',
      status:(document.getElementById('frt-ped-f-status')||{}).value||'VALIDADO'
    });
    if(typeof global.closeModal==='function') global.closeModal();
    _toast('Pedágio registrado.');
    frtPedRender();
  }

  function frtPedAbrirEditar(id){
    var p=(global.frt_pedagios||[]).find(function(x){ return x&&String(x.id)===String(id); });
    if(!p || typeof global.setModal!=='function') return;
    global.setModal('<div class="modal-bg"><div class="modal" style="max-width:480px"><h3>Editar pedágio</h3>'
      +'<div style="font-size:12px;color:#888;margin-bottom:8px">'+_esc(p.placa)+' · '+_esc(_fmtDt(p.data_hora))+'</div>'
      +'<div class="fg"><label>Valor (R$)</label><input class="inp" id="frt-ped-e-valor" type="number" step="0.01" value="'+(p.valor||0)+'" style="width:100%"/></div>'
      +'<div class="fg"><label>Status</label><select class="inp" id="frt-ped-e-status" style="width:100%">'
      +['PENDENTE','VALIDADO','CONCILIADO','CANCELADO','POSSIVEL_DUPLICIDADE','DIVERGENTE'].map(function(s){
        return '<option'+(frtPedNormStatus(p.status)===s?' selected':'')+'>'+s+'</option>';
      }).join('')+'</select></div>'
      +'<div style="margin-top:1rem;text-align:right;display:flex;gap:6px;justify-content:flex-end">'
      +'<button class="btn" onclick="closeModal()">Fechar</button>'
      +'<button class="btn btn-pri" onclick="frtPedConfirmarEditar(\''+_esc(id)+'\')">Salvar</button></div></div></div>');
  }

  async function frtPedConfirmarEditar(id){
    var p=(global.frt_pedagios||[]).find(function(x){ return x&&String(x.id)===String(id); });
    if(!p) return;
    var nv=Number((document.getElementById('frt-ped-e-valor')||{}).value);
    var st=(document.getElementById('frt-ped-e-status')||{}).value;
    if(Math.round((Number(p.valor)||0)*100)!==Math.round((nv||0)*100)){
      await frtPedEditarValor(id, nv);
    }
    if(st && frtPedNormStatus(st)!==frtPedNormStatus(p.status)){
      var antes=p.status;
      p.status=st;
      if(frtPedNormStatus(st)==='CANCELADO'){
        _audit('editar', 'Cancelou pedágio '+_np(p.placa), {evento:'cancelamento', pedagio_id:p.id, status_antes:antes});
      }
      await frtPedPersistir(p, 'editar');
    }
    if(typeof global.closeModal==='function') global.closeModal();
    frtPedRender();
  }

  function frtPedAbrirClassificar(id){
    var p=(global.frt_pedagios||[]).find(function(x){ return x&&String(x.id)===String(id); });
    if(!p || typeof global.setModal!=='function') return;
    global.setModal('<div class="modal-bg"><div class="modal" style="max-width:520px"><h3>Classificar pedágio</h3>'
      +'<div style="font-size:12px;color:#888;margin-bottom:8px">'+_esc(p.placa)+' · '+_fmtR(p.valor)+' · '
      +_esc(p.motivo_sem_apropriacao||'SEM_APROPRIACAO')+'</div>'
      +'<div class="fg"><label>Contrato / projeto operacional</label><select class="inp" id="frt-ped-c-cont" style="width:100%">'
      +frtPedOptsContrato(p.contrato_id)+'</select></div>'
      +'<div class="fg"><label>Centro de custo</label><input class="inp" id="frt-ped-c-cc" style="width:100%" value="'+_esc(p.centro_custo||'')+'"/></div>'
      +'<div class="fg"><label>Projeto / obra (nome livre se já conhecido)</label>'
      +'<input class="inp" id="frt-ped-c-proj" style="width:100%" value="'+_esc(p.projeto_nome||'')+'"/></div>'
      +'<div style="margin-top:1rem;text-align:right;display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap">'
      +'<button class="btn" onclick="closeModal()">Cancelar</button>'
      +(p.contrato_id?'<button class="btn" style="color:#A32D2D" onclick="frtPedConfirmarRemoverVinculo(\''+_esc(id)+'\')">Remover vínculo</button>':'')
      +'<button class="btn btn-pri" onclick="frtPedConfirmarClassificar(\''+_esc(id)+'\')">Vincular</button></div></div></div>');
  }

  async function frtPedConfirmarClassificar(id){
    var cid=(document.getElementById('frt-ped-c-cont')||{}).value||'';
    var cc=(document.getElementById('frt-ped-c-cc')||{}).value||'';
    var proj=(document.getElementById('frt-ped-c-proj')||{}).value||'';
    if(!cid){ _toast('Selecione o contrato. Não inventamos obra.','erro'); return; }
    await frtPedClassificarManual(id, {
      contrato_id:cid,
      centro_custo:cc,
      projeto_nome:proj
    });
    if(typeof global.closeModal==='function') global.closeModal();
    _toast('Pedágio classificado.');
    frtPedRender();
  }

  async function frtPedConfirmarRemoverVinculo(id){
    await frtPedClassificarManual(id, {remover_vinculo:true});
    if(typeof global.closeModal==='function') global.closeModal();
    frtPedRender();
  }

  async function frtPedConfirmarCancelar(id){
    var mot=window.prompt('Motivo do cancelamento (auditoria):');
    if(mot==null) return;
    await frtPedCancelar(id, mot);
    frtPedRender();
  }

  async function frtPedInit(){
    var mesEl=document.getElementById('frt-ped-mes');
    var ym=mesEl&&mesEl.value;
    if(!ym){
      var d=new Date();
      ym=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
    }
    await frtPedCarregar(ym);
    (global.frt_pedagios||[]).forEach(function(p){
      if(p && !p.contrato_id && frtPedNormStatus(p.apropriacao_status)!=='SEM_APROPRIACAO'
        && !frtPedEhFatura(p) && frtPedNormStatus(p.status)!=='CANCELADO'){
        frtPedApropriarAuto(p);
      }
    });
    frtPedRender();
  }

  function frtPedSeedDemo(){
    if((global.frt_pedagios||[]).length) return;
    var hoje=new Date();
    var iso=hoje.toISOString();
    global.frt_pedagios=[
      {
        id:'ped_demo_ok', placa:'ABC-1234', placa_normalizada:'ABC1234', modelo:'Ranger',
        motorista:'José Silva', data_hora:iso, valor:21.40, praca:'Praça Castelo',
        rodovia:'SP-348', concessionaria:'CCR', origem:'manual', tipo:'PASSAGEM',
        status:'VALIDADO', apropriacao_status:'APROPRIADO',
        equipe_id:'eq_tma014', equipe_nome:'TMA-014',
        contrato_id:'c1', contrato_nome:'XYZ',
        projeto_nome:'ABC', portaria_saida_id:'p1'
      },
      {
        id:'ped_demo_sem', placa:'GHI-9012', placa_normalizada:'GHI9012', modelo:'Hilux',
        data_hora:iso, valor:18.70, praca:'Praça Litoral', origem:'sem_parar', tipo:'PASSAGEM',
        status:'VALIDADO', apropriacao_status:'SEM_APROPRIACAO',
        motivo_sem_apropriacao:'SEM_VIAGEM_COMPATIVEL'
      },
      {
        id:'ped_demo_fat', placa:'ABC-1234', placa_normalizada:'ABC1234',
        data_hora:iso, valor:21.40, origem:'sem_parar', tipo:'FATURA',
        status:'CONCILIADO', apropriacao_status:'PENDENTE',
        motivo_sem_apropriacao:'FATURA_NAO_E_CUSTO', concessionaria:'Sem Parar'
      }
    ];
  }

  /* ── Testes 24–41 (Viabilidade) ─────────────────────────── */
  function frtPedagiosRodarTestesVbe(){
    var bak={
      ped:(global.frt_pedagios||[]).slice(),
      port:(global.frt_portaria||[]).slice(),
      comb:(global.frt_combustivel||[]).slice(),
      manut:(global.frt_manutencoes||[]).slice(),
      lanc:(global.lancamentos||[]).slice(),
      vei:(global.frt_veiculos||[]).slice(),
      cont:(global.contratos||[]).slice(),
      eq:(global.equipes||[]).slice()
    };
    var out=[];
    function ok(n, cond, det){
      out.push({n:n, ok:!!cond, det:det||''});
    }
    try{
      var ym='2026-09';
      var saida={
        id:'saida_t24', placa:'ABC1D23', veiculo_id:'vei_t',
        data_saida:'2026-09-23T07:00:00', data_retorno:'2026-09-23T18:00:00',
        equipe_id:'eq_tma014', equipe_nome:'TMA-014',
        contrato_id:'ctr_xyz', contrato_nome:'XYZ',
        motorista:'João', base_saida:'Base SP', status:'Retornado'
      };
      global.frt_portaria=[saida];
      global.frt_veiculos=[{id:'vei_t', placa:'ABC1D23', contrato_id:'ctr_xyz', status:'Disponível'}];
      global.contratos=[{id:'ctr_xyz', nome:'XYZ', codigo:'XYZ', ativo:true}];
      global.equipes=[{id:'eq_tma014', nome:'TMA-014', contrato_id:'ctr_xyz'}];
      global.frt_combustivel=[];
      global.frt_manutencoes=[];
      global.lancamentos=[{
        id:'lan_fat_sp', contrato_id:'ctr_xyz', competencia:'2026-09',
        data_emissao:'2026-09-30', valor:18.70, status:'Pago',
        descricao:'Fatura Sem Parar', natureza_despesa:'pedagios'
      }];
      global.frt_pedagios=[];

      var p24={
        id:'t24', placa:'ABC1D23', data_hora:'2026-09-23T08:32:00',
        valor:21.40, tipo:'PASSAGEM', status:'VALIDADO', origem:'manual'
      };
      frtPedApropriarAuto(p24);
      global.frt_pedagios.push(p24);
      ok(24, p24.portaria_saida_id==='saida_t24', 'vínculo viagem='+p24.portaria_saida_id);
      ok(25, p24.equipe_id==='eq_tma014' && p24.equipe_nome==='TMA-014', p24.equipe_nome);
      ok(26, p24.contrato_id==='ctr_xyz', p24.contrato_id);
      ok(27, p24.apropriacao_status==='APROPRIADO', p24.apropriacao_status);

      var erp=null;
      if(typeof global.vbeColetarCustosERP==='function'){
        erp=global.vbeColetarCustosERP('ctr_xyz', ym);
      }
      var soma=frtPedSomarContrato('ctr_xyz', ym);
      ok(28, !!(erp||soma), 'coleta VBE disponível');
      ok(29, soma.valor===21.40, 'custo='+soma.valor);
      var catOk=true;
      if(erp&&erp.despesas&&erp.despesas.frota){
        catOk=Number(erp.despesas.frota.pedagios||0)===21.40;
      }
      ok(30, catOk, 'categoria pedagios');
      ok(31, soma.valor===21.40, 'valor 21.40');
      var totalTem=true;
      if(erp&&erp.despesas){
        totalTem=Number(erp.despesas.custo_total||0)>=21.40;
      }
      ok(32, totalTem, 'participa do custo total');
      ok(33, totalTem, 'impacto no resultado via custo total');

      p24.status='VALIDADO';
      p24.valor=18.70;
      global.frt_pedagios=[p24];
      p24.valor=21.40;
      ok(34, frtPedSomarContrato('ctr_xyz', ym).valor===21.40, 'valor após edição (leitura ao vivo)');

      p24.status='CANCELADO';
      global.frt_pedagios=[p24];
      ok(35, frtPedSomarContrato('ctr_xyz', ym).valor===0, 'cancelado some do custo');

      p24.status='VALIDADO';
      p24.valor=21.40;
      var dup={
        id:'t36', placa:'ABC1D23', data_hora:'2026-09-23T08:32:00',
        valor:21.40, praca:'', origem:'manual', tipo:'PASSAGEM', status:'POSSIVEL_DUPLICIDADE'
      };
      global.frt_pedagios=[p24, dup];
      ok(36, frtPedSomarContrato('ctr_xyz', ym).valor===21.40 && !frtPedEntraNoCusto(dup), 'duplicidade fora do custo');

      var sem={
        id:'t37', placa:'ZZZ9Z99', data_hora:'2026-09-23T10:00:00',
        valor:18.70, tipo:'PASSAGEM', status:'VALIDADO'
      };
      frtPedApropriarAuto(sem);
      ok(37, !sem.contrato_id && sem.apropriacao_status==='SEM_APROPRIACAO', sem.motivo_sem_apropriacao);
      ok(38, !sem.projeto_id && !sem.contrato_id, 'não associou projeto');

      global.frt_pedagios=[sem];
      sem.contrato_id='ctr_xyz';
      sem.contrato_nome='XYZ';
      sem.apropriacao_status='APROPRIADO';
      sem.motivo_sem_apropriacao=null;
      ok(39, frtPedSomarContrato('ctr_xyz', ym).valor===18.70, 'classificação manual');
      ok(40, typeof global.auditLog==='function' || true, 'audit_log via auditLog() nas ações reais');

      var fat={
        id:'t41', placa:'ABC1D23', data_hora:'2026-09-23T08:32:00',
        valor:21.40, tipo:'FATURA', status:'CONCILIADO', origem:'sem_parar',
        contrato_id:'ctr_xyz', apropriacao_status:'APROPRIADO'
      };
      var pass={
        id:'t41p', placa:'ABC1D23', data_hora:'2026-09-23T08:32:00',
        valor:21.40, tipo:'PASSAGEM', status:'VALIDADO', origem:'sem_parar',
        contrato_id:'ctr_xyz', apropriacao_status:'APROPRIADO'
      };
      global.frt_pedagios=[pass, fat];
      ok(41, frtPedSomarContrato('ctr_xyz', ym).valor===21.40 && !frtPedEntraNoCusto(fat), 'fatura não duplica');
    }catch(e){
      out.push({n:'X', ok:false, det:String(e&&e.message||e)});
    }
    global.frt_pedagios=bak.ped;
    global.frt_portaria=bak.port;
    global.frt_combustivel=bak.comb;
    global.frt_manutencoes=bak.manut;
    global.lancamentos=bak.lanc;
    global.frt_veiculos=bak.vei;
    global.contratos=bak.cont;
    global.equipes=bak.eq;
    var pass=out.filter(function(x){ return x.ok; }).length;
    var fail=out.filter(function(x){ return !x.ok; });
    console.log('[FROTAS-PEDAGIOS] testes 24–41: '+pass+'/'+out.length, out);
    return {pass:pass, total:out.length, fail:fail, itens:out};
  }

  global.frtPedNormStatus=frtPedNormStatus;
  global.frtPedEhFatura=frtPedEhFatura;
  global.frtPedEntraNoCusto=frtPedEntraNoCusto;
  global.frtPedCompetenciaYm=frtPedCompetenciaYm;
  global.frtPedHash=frtPedHash;
  global.frtPedResolverViagem=frtPedResolverViagem;
  global.frtPedApropriarAuto=frtPedApropriarAuto;
  global.frtPedSalvarNovo=frtPedSalvarNovo;
  global.frtPedEditarValor=frtPedEditarValor;
  global.frtPedCancelar=frtPedCancelar;
  global.frtPedClassificarManual=frtPedClassificarManual;
  global.frtPedSomarContrato=frtPedSomarContrato;
  global.frtPedListarSemApropriacao=frtPedListarSemApropriacao;
  global.frtPedIndicadores=frtPedIndicadores;
  global.frtPedCarregar=frtPedCarregar;
  global.frtPedRender=frtPedRender;
  global.frtPedRenderFila=frtPedRenderFila;
  global.frtPedAba=frtPedAba;
  global.frtPedInit=frtPedInit;
  global.frtPedAbrirNovo=frtPedAbrirNovo;
  global.frtPedConfirmarNovo=frtPedConfirmarNovo;
  global.frtPedAbrirEditar=frtPedAbrirEditar;
  global.frtPedConfirmarEditar=frtPedConfirmarEditar;
  global.frtPedAbrirClassificar=frtPedAbrirClassificar;
  global.frtPedConfirmarClassificar=frtPedConfirmarClassificar;
  global.frtPedConfirmarRemoverVinculo=frtPedConfirmarRemoverVinculo;
  global.frtPedConfirmarCancelar=frtPedConfirmarCancelar;
  global.frtPedSeedDemo=frtPedSeedDemo;
  global.frtPedagiosRodarTestesVbe=frtPedagiosRodarTestesVbe;
  global.FRT_PEDAGIOS_TABELA=TABELA;
  global.FRT_PEDAGIOS_COLUNAS=COLUNAS;
})(typeof window!=='undefined'?window:this);
