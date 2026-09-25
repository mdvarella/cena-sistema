/* CENA-MOD-PED-1 — Frotas > Pedágios — UI + API pública
 * CENA.Frotas.Pedagios.init | abrir | recarregar
 * Wrappers globais frtPed* preservados (VBE / index / onclick).
 */
(function(global){
  'use strict';
  var CENA=global.CENA=global.CENA||{};
  CENA.Frotas=CENA.Frotas||{};
  var Ped=CENA.Frotas.Pedagios=CENA.Frotas.Pedagios||{};
  function svc(){ return Ped._svc||{}; }
  function repo(){ return Ped._repo||{}; }

  function _esc(s){
    if(typeof global.escHtml==='function') return global.escHtml(s);
    return String(s==null?'':s).replace(/[&<>"']/g,function(c){
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
    });
  }
  function _toast(msg, tipo){
    if(typeof global.progShowToast==='function') global.progShowToast(msg, tipo);
  }
  function _fmtR(v){
    return (Number(v)||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  }
  function _fmtDt(s){
    if(!s) return '—';
    var d=new Date(s);
    if(isNaN(d.getTime())) return String(s).replace('T',' ').slice(0,16);
    return d.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
  }
  function _np(p){
    if(typeof global.frtNormPlaca==='function') return global.frtNormPlaca(p);
    return String(p||'').toUpperCase().replace(/[-\s]/g,'');
  }

  function popularFiltros(){
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

  function statusChip(st){
    st=svc().normStatus?svc().normStatus(st):String(st||'');
    var cor='#888';
    if(st==='VALIDADO'||st==='CONCILIADO') cor='#3B6D11';
    else if(st==='PENDENTE') cor='#854F0B';
    else if(st==='CANCELADO'||st==='DIVERGENTE'||st==='POSSIVEL_DUPLICIDADE') cor='#A32D2D';
    return '<span class="bdg" style="background:'+cor+';color:#fff;font-size:10px">'+_esc(st||'—')+'</span>';
  }

  function aba(qual){
    global._frtPedAba=qual||'lista';
    var lista=document.getElementById('frt-ped-panel-lista');
    var fila=document.getElementById('frt-ped-panel-fila');
    var bL=document.getElementById('frt-ped-tab-lista');
    var bF=document.getElementById('frt-ped-tab-fila');
    if(lista) lista.style.display=qual==='fila'?'none':'';
    if(fila) fila.style.display=qual==='fila'?'':'none';
    if(bL){ bL.style.borderBottomColor=qual==='fila'?'transparent':'#1a1a18'; bL.style.color=qual==='fila'?'#888':'#1a1a18'; }
    if(bF){ bF.style.borderBottomColor=qual==='fila'?'#1a1a18':'transparent'; bF.style.color=qual==='fila'?'#1a1a18':'#888'; }
    if(qual==='fila') renderFila();
  }

  function renderFila(){
    var wrap=document.getElementById('frt-ped-fila');
    var badge=document.getElementById('frt-ped-fila-badge');
    var placa=placaFiltroAtual();
    var todos=svc().listarSemApropriacao?svc().listarSemApropriacao():[];
    var rows=todos.filter(function(p){ return casaPlaca(p, placa); });
    if(badge){
      badge.textContent=todos.length||'';
      badge.style.display=todos.length?'inline-flex':'none';
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

  function placaFiltroAtual(){
    return String((document.getElementById('frt-ped-placa')||{}).value||'').trim();
  }
  function casaPlaca(p, busca){
    if(!busca) return true;
    if(typeof global.frtPlacaMatchBusca==='function'){
      return global.frtPlacaMatchBusca(p&&p.placa, busca)
        || global.frtPlacaMatchBusca(p&&p.placa_normalizada, busca)
        || global.frtPlacaMatchBusca(p&&p.placa_original, busca);
    }
    var q=_np(busca);
    if(!q) return true;
    return _np(p&&p.placa).indexOf(q)>=0 || _np(p&&p.placa_normalizada).indexOf(q)>=0;
  }
  function filtrados(){
    var mesEl=document.getElementById('frt-ped-mes');
    var todos=document.getElementById('frt-ped-todos');
    var cid=(document.getElementById('frt-ped-cont')||{}).value||'';
    var placa=placaFiltroAtual();
    var st=(document.getElementById('frt-ped-status')||{}).value||'';
    var buscaPlaca=_np(placa).length>=2;
    var ym=(!buscaPlaca && (!todos||!todos.checked))?((mesEl&&mesEl.value)||''):'';
    var arr=repo().memoria?repo().memoria():(global.frt_pedagios||[]);
    return arr.filter(function(p){
      if(!p||p.deleted_at) return false;
      if(ym && svc().competenciaYm && svc().competenciaYm(p)!==ym) return false;
      if(cid && String(p.contrato_id||'')!==String(cid)) return false;
      if(placa && !casaPlaca(p, placa)) return false;
      if(st && svc().normStatus && svc().normStatus(p.status)!==svc().normStatus(st)) return false;
      return true;
    });
  }

  function render(){
    popularFiltros();
    var rows=filtrados();
    var met=document.getElementById('frt-ped-metricas');
    var custo=0, fatura=0, semAp=0, valid=0;
    rows.forEach(function(p){
      if(svc().ehFatura(p)) fatura+=Number(p.valor||0);
      else if(svc().entraNoCusto(p)){ custo+=Number(p.valor||0); valid++; }
      if(svc().normStatus(p.apropriacao_status)==='SEM_APROPRIACAO') semAp++;
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
          var tipo=svc().ehFatura(p)?'<span class="bdg gray">FATURA</span>':'<span class="bdg info">PASSAGEM</span>';
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
            +'<td>'+tipo+' '+statusChip(p.status)+'</td>'
            +'<td style="white-space:nowrap">'
            +'<button class="btn btn-sm" onclick="frtPedAbrirEditar(\''+_esc(p.id)+'\')">✏</button> '
            +(svc().normStatus(p.apropriacao_status)==='SEM_APROPRIACAO'
              ?'<button class="btn btn-sm btn-pri" onclick="frtPedAbrirClassificar(\''+_esc(p.id)+'\')">Vincular</button> '
              :'')
            +(svc().normStatus(p.status)!=='CANCELADO'
              ?'<button class="btn btn-sm" style="color:#A32D2D" onclick="frtPedConfirmarCancelar(\''+_esc(p.id)+'\')">✕</button>'
              :'')
            +'</td></tr>';
        }).join('');
      }
    }
    var badge=document.getElementById('frt-ped-fila-badge');
    var nFila=(svc().listarSemApropriacao?svc().listarSemApropriacao():[]).length;
    if(badge){
      badge.textContent=nFila||'';
      badge.style.display=nFila?'inline-flex':'none';
    }
    if(global._frtPedAba==='fila') renderFila();
  }

  var _placaTimer=null;
  function onFiltroPlaca(){
    try{
      if(typeof global.frtHintFiltroPlacas==='function'){
        global.frtHintFiltroPlacas(document.getElementById('frt-ped-placa'));
      }
      render();
    }catch(e){ console.warn('[PEDAGIOS] filtro placa', e); }
    var placa=placaFiltroAtual();
    var safe=_np(placa);
    if(safe.length<2 || global.DEMO) return;
    if(_placaTimer) clearTimeout(_placaTimer);
    _placaTimer=setTimeout(function(){
      if(!repo().buscarPorPlaca) return;
      repo().buscarPorPlaca(placa).then(function(){
        if(_np(placaFiltroAtual())===safe) render();
      });
    }, 280);
  }

  function optsContrato(sel){
    var h='<option value="">— sem contrato —</option>';
    (global.contratos||[]).forEach(function(c){
      if(c.ativo===false) return;
      h+='<option value="'+_esc(c.id)+'"'+(String(sel)===String(c.id)?' selected':'')+'>'
        +_esc(c.codigo||c.nome||c.id)+'</option>';
    });
    return h;
  }
  function optsVeiculo(selPlaca){
    var h='<option value="">Selecione…</option>';
    (repo().listarVeiculos?repo().listarVeiculos():global.frt_veiculos||[]).forEach(function(v){
      if(String(v.status||'').toLowerCase()==='inativo') return;
      h+='<option value="'+_esc(v.placa)+'" data-vid="'+_esc(v.id||'')+'" data-modelo="'+_esc(v.modelo||'')+'"'
        +(_np(v.placa)===_np(selPlaca)?' selected':'')+'>'
        +_esc(v.placa)+' — '+_esc(v.modelo||'')+'</option>';
    });
    return h;
  }

  function abrirNovo(){
    if(typeof global.setModal!=='function'){ _toast('Modal indisponível','erro'); return; }
    var agora=new Date();
    var local=agora.getFullYear()+'-'+String(agora.getMonth()+1).padStart(2,'0')+'-'
      +String(agora.getDate()).padStart(2,'0')+'T'+String(agora.getHours()).padStart(2,'0')+':'
      +String(agora.getMinutes()).padStart(2,'0');
    global.setModal('<div class="modal-bg"><div class="modal" style="max-width:560px"><h3>Novo pedágio</h3>'
      +'<div class="g2"><div class="fg"><label>Veículo / placa</label><select class="inp" id="frt-ped-f-placa" style="width:100%">'+optsVeiculo('')+'</select></div>'
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

  async function confirmarNovo(){
    var sel=document.getElementById('frt-ped-f-placa');
    var placa=sel?sel.value:'';
    var opt=sel&&sel.options[sel.selectedIndex];
    var dt=(document.getElementById('frt-ped-f-dt')||{}).value;
    var valor=(document.getElementById('frt-ped-f-valor')||{}).value;
    if(!placa){ _toast('Selecione o veículo.','erro'); return; }
    if(!(Number(valor)>0)){ _toast('Informe o valor da passagem.','erro'); return; }
    var iso=dt?new Date(dt).toISOString():new Date().toISOString();
    await svc().salvarNovo({
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
    render();
  }

  function abrirEditar(id){
    var p=(repo().memoria?repo().memoria():[]).find(function(x){ return x&&String(x.id)===String(id); });
    if(!p || typeof global.setModal!=='function') return;
    global.setModal('<div class="modal-bg"><div class="modal" style="max-width:480px"><h3>Editar pedágio</h3>'
      +'<div style="font-size:12px;color:#888;margin-bottom:8px">'+_esc(p.placa)+' · '+_esc(_fmtDt(p.data_hora))+'</div>'
      +'<div class="fg"><label>Valor (R$)</label><input class="inp" id="frt-ped-e-valor" type="number" step="0.01" value="'+(p.valor||0)+'" style="width:100%"/></div>'
      +'<div class="fg"><label>Status</label><select class="inp" id="frt-ped-e-status" style="width:100%">'
      +['PENDENTE','VALIDADO','CONCILIADO','CANCELADO','POSSIVEL_DUPLICIDADE','DIVERGENTE'].map(function(s){
        return '<option'+(svc().normStatus(p.status)===s?' selected':'')+'>'+s+'</option>';
      }).join('')+'</select></div>'
      +'<div style="margin-top:1rem;text-align:right;display:flex;gap:6px;justify-content:flex-end">'
      +'<button class="btn" onclick="closeModal()">Fechar</button>'
      +'<button class="btn btn-pri" onclick="frtPedConfirmarEditar(\''+_esc(id)+'\')">Salvar</button></div></div></div>');
  }

  async function confirmarEditar(id){
    var p=(repo().memoria?repo().memoria():[]).find(function(x){ return x&&String(x.id)===String(id); });
    if(!p) return;
    var nv=Number((document.getElementById('frt-ped-e-valor')||{}).value);
    var st=(document.getElementById('frt-ped-e-status')||{}).value;
    if(Math.round((Number(p.valor)||0)*100)!==Math.round((nv||0)*100)){
      await svc().editarValor(id, nv);
    }
    if(st && svc().normStatus(st)!==svc().normStatus(p.status)){
      p.status=st;
      if(svc().normStatus(st)==='CANCELADO'){
        await svc().cancelar(id, 'edicao_status');
      } else {
        await repo().persistir(p,'editar');
      }
    }
    if(typeof global.closeModal==='function') global.closeModal();
    render();
  }

  function abrirClassificar(id){
    var p=(repo().memoria?repo().memoria():[]).find(function(x){ return x&&String(x.id)===String(id); });
    if(!p || typeof global.setModal!=='function') return;
    global.setModal('<div class="modal-bg"><div class="modal" style="max-width:520px"><h3>Classificar pedágio</h3>'
      +'<div style="font-size:12px;color:#888;margin-bottom:8px">'+_esc(p.placa)+' · '+_fmtR(p.valor)+' · '
      +_esc(p.motivo_sem_apropriacao||'SEM_APROPRIACAO')+'</div>'
      +'<div class="fg"><label>Contrato / projeto operacional</label><select class="inp" id="frt-ped-c-cont" style="width:100%">'
      +optsContrato(p.contrato_id)+'</select></div>'
      +'<div class="fg"><label>Centro de custo</label><input class="inp" id="frt-ped-c-cc" style="width:100%" value="'+_esc(p.centro_custo||'')+'"/></div>'
      +'<div class="fg"><label>Projeto / obra (nome livre se já conhecido)</label>'
      +'<input class="inp" id="frt-ped-c-proj" style="width:100%" value="'+_esc(p.projeto_nome||'')+'"/></div>'
      +'<div style="margin-top:1rem;text-align:right;display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap">'
      +'<button class="btn" onclick="closeModal()">Cancelar</button>'
      +(p.contrato_id?'<button class="btn" style="color:#A32D2D" onclick="frtPedConfirmarRemoverVinculo(\''+_esc(id)+'\')">Remover vínculo</button>':'')
      +'<button class="btn btn-pri" onclick="frtPedConfirmarClassificar(\''+_esc(id)+'\')">Vincular</button></div></div></div>');
  }

  async function confirmarClassificar(id){
    var cid=(document.getElementById('frt-ped-c-cont')||{}).value||'';
    var cc=(document.getElementById('frt-ped-c-cc')||{}).value||'';
    var proj=(document.getElementById('frt-ped-c-proj')||{}).value||'';
    if(!cid){ _toast('Selecione o contrato. Não inventamos obra.','erro'); return; }
    await svc().classificarManual(id,{contrato_id:cid, centro_custo:cc, projeto_nome:proj});
    if(typeof global.closeModal==='function') global.closeModal();
    _toast('Pedágio classificado.');
    render();
  }

  async function confirmarRemoverVinculo(id){
    await svc().classificarManual(id,{remover_vinculo:true});
    if(typeof global.closeModal==='function') global.closeModal();
    render();
  }

  async function confirmarCancelar(id){
    var mot=window.prompt('Motivo do cancelamento (auditoria):');
    if(mot==null) return;
    await svc().cancelar(id, mot);
    render();
  }

  async function init(){
    if(global.DEMO && svc().seedDemo) svc().seedDemo();
    var mesEl=document.getElementById('frt-ped-mes');
    var ym=mesEl&&mesEl.value;
    if(!ym){
      var d=new Date();
      ym=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
    }
    if(repo().carregar) await repo().carregar(ym);
    (repo().memoria?repo().memoria():[]).forEach(function(p){
      if(p && !p.contrato_id && svc().normStatus(p.apropriacao_status)!=='SEM_APROPRIACAO'
        && !svc().ehFatura(p) && svc().normStatus(p.status)!=='CANCELADO'){
        svc().apropriarAuto(p);
      }
    });
    render();
  }

  function abrir(){
    if(typeof global.showMain==='function') global.showMain('frotas');
    if(typeof global.showSub==='function') global.showSub('frotas-pedagios');
    return init();
  }

  Ped.init=init;
  Ped.abrir=abrir;
  Ped.recarregar=init;

  global.frtPedInit=init;
  global.frtPedRender=render;
  global.frtPedOnFiltroPlaca=onFiltroPlaca;
  global.frtPedAba=aba;
  global.frtPedAbrirNovo=abrirNovo;
  global.frtPedConfirmarNovo=confirmarNovo;
  global.frtPedAbrirEditar=abrirEditar;
  global.frtPedConfirmarEditar=confirmarEditar;
  global.frtPedAbrirClassificar=abrirClassificar;
  global.frtPedConfirmarClassificar=confirmarClassificar;
  global.frtPedConfirmarRemoverVinculo=confirmarRemoverVinculo;
  global.frtPedConfirmarCancelar=confirmarCancelar;
  global.frtPedSeedDemo=function(){ if(svc().seedDemo) svc().seedDemo(); };
  global.frtPedagiosRodarTestesVbe=function(){ return svc().rodarTestesVbe?svc().rodarTestesVbe():{pass:0,total:0}; };
  global.frtPedSomarContrato=function(cid,ym){ return svc().somarContrato?svc().somarContrato(cid,ym):{valor:0,qtd:0}; };
  global.frtPedCarregar=function(ym){ return repo().carregar?repo().carregar(ym):Promise.resolve([]); };
  global.frtPedEntraNoCusto=function(p){ return !!(svc().entraNoCusto&&svc().entraNoCusto(p)); };
  global.frtPedApropriarAuto=function(p){ return svc().apropriarAuto?svc().apropriarAuto(p):p; };
  global.frtPedNormStatus=function(s){ return svc().normStatus?svc().normStatus(s):String(s||''); };
  global.frtPedEhFatura=function(p){ return !!(svc().ehFatura&&svc().ehFatura(p)); };
  global.FRT_PEDAGIOS_TABELA='frotas_pedagios';
  global.frtPedZerarImportados=async function(){
    var r=repo().zerarImportados?await repo().zerarImportados():{ok:false};
    render();
    _toast(r&&r.ok?'Pedágios importados removidos (soft-delete).':'Falha ao zerar importados.');
    return r;
  };
})(typeof window!=='undefined'?window:this);
