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
    var rows=svc().listarSemApropriacao?svc().listarSemApropriacao():[];
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

  function filtrados(){
    var mesEl=document.getElementById('frt-ped-mes');
    var todos=document.getElementById('frt-ped-todos');
    var cid=(document.getElementById('frt-ped-cont')||{}).value||'';
    var placa=(document.getElementById('frt-ped-placa')||{}).value||'';
    var st=(document.getElementById('frt-ped-status')||{}).value||'';
    var ym=(!todos||!todos.checked)?((mesEl&&mesEl.value)||''):'';
    var arr=repo().memoria?repo().memoria():(global.frt_pedagios||[]);
    return arr.filter(function(p){
      if(!p||p.deleted_at) return false;
      if(ym && svc().competenciaYm(p)!==ym) return false;
      if(cid && String(p.contrato_id||'')!==String(cid)) return false;
      if(placa){
        if(typeof global.frtPlacaMatchBusca==='function'){
          if(!global.frtPlacaMatchBusca(p.placa, placa)) return false;
        } else if(_np(p.placa).indexOf(_np(placa))<0) return false;
      }
      if(st && svc().normStatus(p.status)!==svc().normStatus(st)) return false;
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
        tb.innerHTML='<tr><td colspan="13" style="text-align:center;color:#888;padding:1.5rem">Nenhum pedágio no filtro. Troque o mês ou marque Todos os meses — o cadastro não fica só no mês atual.</td></tr>';
      } else {
        var lim=800;
        var extra=rows.length>lim?'<tr><td colspan="13" style="text-align:center;color:#888;padding:.6rem">Mostrando '+lim+' de '+rows.length+' lançamentos. Afine o mês ou a placa para ver o restante.</td></tr>':'';
        tb.innerHTML=rows.slice(0,lim).map(function(p){
          var tipoLbl=svc().labelTipo?svc().labelTipo(p.tipo):(p.tipo||'PASSAGEM');
          var tipo=svc().ehFatura(p)
            ?'<span class="bdg gray">FATURA</span>'
            :'<span class="bdg info">'+_esc(tipoLbl)+'</span>';
          return '<tr>'
            +'<td>'+_esc(_fmtDt(p.data_hora))+'</td>'
            +'<td style="font-family:monospace">'+_esc(p.placa||'—')+'</td>'
            +'<td>'+_esc(p.modelo||'—')+'</td>'
            +'<td>'+_esc((svc().labelContrato&&svc().labelContrato(p))||p.contrato_nome||'—')+'</td>'
            +'<td>'+_esc(p.praca||'—')+'</td>'
            +'<td>'+_esc(p.rodovia||'—')+'</td>'
            +'<td>'+_esc(p.concessionaria||'—')+'</td>'
            +'<td>'+_esc(p.centro_custo||'—')+'</td>'
            +'<td style="text-align:right;font-weight:600">'+_fmtR(p.valor)+'</td>'
            +'<td>'+_esc(p.equipe_nome||'—')+'</td>'
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
        }).join('')+extra;
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
      var cv=svc().contratoDoVeiculo?svc().contratoDoVeiculo(v):null;
      var cnome=cv?(cv.contrato_nome||''):(v.contrato_nome||'');
      h+='<option value="'+_esc(v.placa)+'" data-vid="'+_esc(v.id||'')+'" data-modelo="'+_esc(v.modelo||'')+'"'
        +' data-cid="'+_esc((cv&&cv.contrato_id)||v.contrato_id||'')+'" data-cnome="'+_esc(cnome)+'"'
        +(_np(v.placa)===_np(selPlaca)?' selected':'')+'>'
        +_esc(v.placa)+' — '+_esc(v.modelo||'')+'</option>';
    });
    return h;
  }
  function optsTipo(sel){
    var itens=[
      ['PASSAGEM','PASSAGEM (custo)'],
      ['FATURA','FATURA (não é custo)'],
      ['MENSALIDADE_TAG','Mensalidade TAG'],
      ['MENSALIDADE_TAG_ESTOQUE','Mensalidade TAG em estoque']
    ];
    var cur=svc().normTipo?svc().normTipo(sel||'PASSAGEM'):(sel||'PASSAGEM');
    return itens.map(function(it){
      return '<option value="'+it[0]+'"'+(cur===it[0]?' selected':'')+'>'+it[1]+'</option>';
    }).join('');
  }

  function abrirNovo(){
    if(typeof global.setModal!=='function'){ _toast('Modal indisponível','erro'); return; }
    var agora=new Date();
    var local=agora.getFullYear()+'-'+String(agora.getMonth()+1).padStart(2,'0')+'-'
      +String(agora.getDate()).padStart(2,'0')+'T'+String(agora.getHours()).padStart(2,'0')+':'
      +String(agora.getMinutes()).padStart(2,'0');
    global.setModal('<div class="modal-bg"><div class="modal" style="max-width:560px"><h3>Novo pedágio</h3>'
      +'<div class="g2"><div class="fg"><label>Veículo / placa</label><select class="inp" id="frt-ped-f-placa" style="width:100%" onchange="frtPedPlacaMudou()">'+optsVeiculo('')+'</select></div>'
      +'<div class="fg"><label>Contrato</label><input class="inp" id="frt-ped-f-cont" style="width:100%;background:#f5f5f3" readonly placeholder="Do cadastro do veículo"/></div></div>'
      +'<div class="g2"><div class="fg"><label>Data/hora da passagem</label><input class="inp" id="frt-ped-f-dt" type="datetime-local" value="'+local+'" style="width:100%"/></div>'
      +'<div class="fg"><label>Valor (R$)</label><input class="inp" id="frt-ped-f-valor" type="number" step="0.01" min="0" style="width:100%"/></div></div>'
      +'<div class="g2"><div class="fg"><label>Praça</label><input class="inp" id="frt-ped-f-praca" style="width:100%" placeholder="Praça / pedágio"/></div>'
      +'<div class="fg"><label>Rodovia</label><input class="inp" id="frt-ped-f-rodovia" style="width:100%"/></div></div>'
      +'<div class="g2"><div class="fg"><label>Estabelecimento</label><input class="inp" id="frt-ped-f-conc" style="width:100%" placeholder="Sem Parar, CCR…"/></div>'
      +'<div class="fg"><label>Centro de custo</label><input class="inp" id="frt-ped-f-cc" style="width:100%" placeholder="Centro de custo"/></div></div>'
      +'<div class="g2"><div class="fg"><label>Origem</label><select class="inp" id="frt-ped-f-origem" style="width:100%">'
      +'<option value="manual">manual</option><option value="sem_parar">sem_parar</option>'
      +'<option value="ticket">ticket</option><option value="importacao">importacao</option></select></div></div>'
      +'<div class="g2"><div class="fg"><label>Tipo</label><select class="inp" id="frt-ped-f-tipo" style="width:100%">'
      +optsTipo('PASSAGEM')+'</select></div>'
      +'<div class="fg"><label>Status</label><select class="inp" id="frt-ped-f-status" style="width:100%">'
      +'<option value="VALIDADO">VALIDADO</option><option value="PENDENTE">PENDENTE</option>'
      +'<option value="CONCILIADO">CONCILIADO</option></select></div></div>'
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
    var tipoSel=(document.getElementById('frt-ped-f-tipo')||{}).value||'PASSAGEM';
    if(!placa && tipoSel!=='MENSALIDADE_TAG_ESTOQUE'){ _toast('Selecione o veículo.','erro'); return; }
    if(!placa) placa='ESTOQUE';
    if(!(Number(valor)>0)){ _toast('Informe o valor.','erro'); return; }
    var iso=dt?new Date(dt).toISOString():new Date().toISOString();
    var saved=await svc().salvarNovo({
      placa:placa,
      veiculo_id:opt&&opt.getAttribute('data-vid'),
      modelo:opt&&opt.getAttribute('data-modelo'),
      data_hora:iso,
      valor:valor,
      praca:(document.getElementById('frt-ped-f-praca')||{}).value,
      rodovia:(document.getElementById('frt-ped-f-rodovia')||{}).value,
      concessionaria:(document.getElementById('frt-ped-f-conc')||{}).value,
      centro_custo:(document.getElementById('frt-ped-f-cc')||{}).value,
      origem:(document.getElementById('frt-ped-f-origem')||{}).value||'manual',
      tipo:(document.getElementById('frt-ped-f-tipo')||{}).value||'PASSAGEM',
      status:(document.getElementById('frt-ped-f-status')||{}).value||'VALIDADO',
      contrato_id:opt&&opt.getAttribute('data-cid'),
      contrato_nome:opt&&opt.getAttribute('data-cnome')
    });
    if(typeof global.closeModal==='function') global.closeModal();
    if(saved&&saved._duplicado) _toast('Este pedágio já estava cadastrado. Nada foi duplicado.');
    else if(saved&&saved._erroPersist) _toast('Não foi possível salvar: '+saved._erroPersist,'erro');
    else _toast('Pedágio registrado.');
    render();
  }

  function abrirEditar(id){
    var p=(repo().memoria?repo().memoria():[]).find(function(x){ return x&&String(x.id)===String(id); });
    if(!p || typeof global.setModal!=='function') return;
    global.setModal('<div class="modal-bg"><div class="modal" style="max-width:520px"><h3>Editar pedágio</h3>'
      +'<div style="font-size:12px;color:#888;margin-bottom:8px">'+_esc(p.placa)+' · '+_esc(_fmtDt(p.data_hora))+'</div>'
      +'<div class="fg"><label>Valor (R$)</label><input class="inp" id="frt-ped-e-valor" type="number" step="0.01" value="'+(p.valor||0)+'" style="width:100%"/></div>'
      +'<div class="g2"><div class="fg"><label>Estabelecimento</label><input class="inp" id="frt-ped-e-conc" style="width:100%" value="'+_esc(p.concessionaria||'')+'"/></div>'
      +'<div class="fg"><label>Centro de custo</label><input class="inp" id="frt-ped-e-cc" style="width:100%" value="'+_esc(p.centro_custo||'')+'"/></div></div>'
      +'<div class="fg"><label>Tipo</label><select class="inp" id="frt-ped-e-tipo" style="width:100%">'+optsTipo(p.tipo)+'</select></div>'
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
    var conc=(document.getElementById('frt-ped-e-conc')||{}).value;
    var cc=(document.getElementById('frt-ped-e-cc')||{}).value;
    var tp=(document.getElementById('frt-ped-e-tipo')||{}).value;
    p.concessionaria=conc||'';
    p.centro_custo=cc||'';
    if(tp) p.tipo=svc().normTipo?svc().normTipo(tp):tp;
    if(Math.round((Number(p.valor)||0)*100)!==Math.round((nv||0)*100)){
      await svc().editarValor(id, nv);
    }
    var persistiu=false;
    if(st && svc().normStatus(st)!==svc().normStatus(p.status)){
      p.status=st;
      if(svc().normStatus(st)==='CANCELADO'){
        await svc().cancelar(id, 'edicao_status');
        persistiu=true;
      }
    }
    if(!persistiu && repo().persistir) await repo().persistir(p,'editar');
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

  function _marcarCarregando(){
    var tb=document.getElementById('frt-ped-tbody');
    if(tb) tb.innerHTML='<tr><td colspan="13" style="text-align:center;color:#888;padding:1.5rem">Carregando pedágios…</td></tr>';
  }

  async function recarregarLista(){
    var todos=document.getElementById('frt-ped-todos');
    var mesEl=document.getElementById('frt-ped-mes');
    _marcarCarregando();
    if(todos&&todos.checked){
      if(repo().carregar) await repo().carregar('');
    } else {
      var ym=mesEl&&mesEl.value;
      if(!ym){
        var d=new Date();
        ym=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
        if(mesEl) mesEl.value=ym;
      }
      if(repo().carregar) await repo().carregar(ym);
    }
    (repo().memoria?repo().memoria():[]).forEach(function(p){
      if(p && !p.contrato_id && svc().normStatus(p.apropriacao_status)!=='SEM_APROPRIACAO'
        && !svc().ehFatura(p) && svc().normStatus(p.status)!=='CANCELADO'){
        svc().apropriarAuto(p);
      }
    });
    render();
  }

  async function init(){
    if(global.DEMO && svc().seedDemo) svc().seedDemo();
    await recarregarLista();
    var todos=document.getElementById('frt-ped-todos');
    var mem=repo().memoria?repo().memoria():[];
    if(!(todos&&todos.checked) && !mem.length && !global.DEMO && repo().carregar){
      if(todos) todos.checked=true;
      await recarregarLista();
    }
  }

  function abrir(){
    if(typeof global.showMain==='function') global.showMain('frotas');
    if(typeof global.showSub==='function') global.showSub('frotas-pedagios');
    return init();
  }

  function _normHead(s){
    return String(s==null?'':s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
      .replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
  }
  function _splitCsvLinha(line, sep){
    var out=[], cur='', q=false;
    for(var i=0;i<line.length;i++){
      var ch=line[i];
      if(ch==='"'){
        if(q && line[i+1]==='"'){ cur+='"'; i++; }
        else q=!q;
      } else if(ch===sep && !q){ out.push(cur); cur=''; }
      else cur+=ch;
    }
    out.push(cur);
    return out;
  }
  function _parseCsv(text){
    var raw=String(text||'').replace(/^\uFEFF/,'').split(/\r?\n/).filter(function(l){ return String(l).trim(); });
    if(!raw.length) return [];
    var sep=(raw[0].split(';').length>raw[0].split(',').length)?';':',';
    var heads=_splitCsvLinha(raw[0], sep).map(_normHead);
    return raw.slice(1).map(function(line){
      var cols=_splitCsvLinha(line, sep);
      var o={};
      heads.forEach(function(h,i){ if(h) o[h]=String(cols[i]==null?'':cols[i]).trim(); });
      return o;
    }).filter(function(o){ return Object.keys(o).some(function(k){ return o[k]; }); });
  }
  function _u16(u,o){ return u[o]|(u[o+1]<<8); }
  function _u32(u,o){ return (u[o]|(u[o+1]<<8)|(u[o+2]<<16)|(u[o+3]<<24))>>>0; }
  async function _unzipXlsx(buf){
    var u=new Uint8Array(buf), files={}, o=0;
    while(o+30<=u.length){
      if(_u32(u,o)!==0x04034b50) break;
      var method=_u16(u,o+8), flags=_u16(u,o+6);
      var comp=_u32(u,o+18), nlen=_u16(u,o+26), elen=_u16(u,o+28);
      var name=new TextDecoder('utf-8').decode(u.subarray(o+30,o+30+nlen));
      var start=o+30+nlen+elen;
      if(flags&8){ o=start; continue; }
      var data=u.subarray(start, start+comp);
      try{
        if(method===0) files[name]=new TextDecoder('utf-8').decode(data);
        else if(method===8 && typeof DecompressionStream!=='undefined'){
          var stream=new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
          files[name]=await new Response(stream).text();
        }
      }catch(eZ){}
      o=start+comp;
    }
    return files;
  }
  function _colLetters(ref){
    var m=String(ref||'').match(/^([A-Z]+)/);
    if(!m) return 0;
    var n=0, s=m[1];
    for(var i=0;i<s.length;i++) n=n*26+(s.charCodeAt(i)-64);
    return n-1;
  }
  function _xmlTxt(s){
    return String(s||'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
  }
  function _xlsxParaLinhas(files){
    var ss=[], sst=files['xl/sharedStrings.xml']||'';
    sst.replace(/<si[\s\S]*?<\/si>/g, function(si){
      var t='';
      si.replace(/<t[^>]*>([\s\S]*?)<\/t>/g, function(_,x){ t+=_xmlTxt(x); return _; });
      ss.push(t);
      return si;
    });
    var sheetName=Object.keys(files).filter(function(k){ return /xl\/worksheets\/sheet\d+\.xml$/i.test(k); }).sort()[0];
    var sheet=files[sheetName]||'';
    var rows=[];
    sheet.replace(/<row[^>]*>([\s\S]*?)<\/row>/g, function(_, row){
      var cells={};
      row.replace(/<c([^>]*)>([\s\S]*?)<\/c>/g, function(__, attrs, inner){
        var ref=(attrs.match(/r="([A-Z]+\d+)"/)||[])[1];
        var t=(attrs.match(/t="([^"]+)"/)||[])[1];
        var v=((inner.match(/<v[^>]*>([\s\S]*?)<\/v>/)||[])[1])||'';
        var is=inner.match(/<t[^>]*>([\s\S]*?)<\/t>/);
        var val='';
        if(t==='s') val=ss[Number(v)]||'';
        else if(is) val=_xmlTxt(is[1]);
        else val=v;
        if(ref) cells[_colLetters(ref)]=val;
        return __;
      });
      var keys=Object.keys(cells).map(Number);
      if(!keys.length) return _;
      var max=Math.max.apply(null, keys);
      var arr=[];
      for(var i=0;i<=max;i++) arr.push(cells[i]==null?'':String(cells[i]).trim());
      rows.push(arr);
      return _;
    });
    if(!rows.length) return [];
    var heads=rows[0].map(_normHead);
    return rows.slice(1).map(function(cols){
      var o={};
      heads.forEach(function(h,i){ if(h) o[h]=cols[i]||''; });
      return o;
    }).filter(function(o){ return Object.keys(o).some(function(k){ return o[k]; }); });
  }
  function _htmlTableParaLinhas(html){
    var rows=[];
    String(html||'').replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, function(_, tr){
      var cols=[];
      tr.replace(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi, function(__, td){
        cols.push(String(td).replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').trim());
        return __;
      });
      if(cols.length) rows.push(cols);
      return _;
    });
    if(rows.length<2) return [];
    var heads=rows[0].map(_normHead);
    return rows.slice(1).map(function(cols){
      var o={};
      heads.forEach(function(h,i){ if(h) o[h]=cols[i]||''; });
      return o;
    }).filter(function(o){ return Object.keys(o).some(function(k){ return o[k]; }); });
  }

  var _pedImportRows=[];
  function _normRowKeys(row){
    var o={};
    Object.keys(row||{}).forEach(function(k){
      o[_normHead(k)]=row[k]==null?'':row[k];
    });
    return o;
  }
  function baixarModelo(){
    var heads=['Data/hora','Placa','Valor','Praca','Rodovia','Estabelecimento','Centro de custo','Tipo','Origem','Status','Contrato','Observacao'];
    var rows=[
      ['24/09/2026 08:32','ABC1D23',21.4,'Praca Castelo','SP-348','CCR','CC-001','PASSAGEM','importacao','VALIDADO','','Exemplo passagem'],
      ['24/09/2026 00:00','ABC1D23',89.9,'','','Sem Parar','CC-001','Mensalidade TAG','importacao','VALIDADO','',''],
      ['24/09/2026 00:00','ESTOQUE',45,'','','Sem Parar','CC-EST','Mensalidade TAG em estoque','importacao','VALIDADO','','']
    ];
    if(typeof global.XLSX!=='undefined' && global.XLSX.utils){
      var ws=global.XLSX.utils.aoa_to_sheet([heads].concat(rows));
      var wb=global.XLSX.utils.book_new();
      global.XLSX.utils.book_append_sheet(wb, ws, 'Pedagios');
      global.XLSX.writeFile(wb, 'modelo_pedagios.xlsx');
      return;
    }
    var sep=';';
    var csv='\uFEFF'+[heads].concat(rows).map(function(r){ return r.map(function(c){ return '"'+String(c).replace(/"/g,'""')+'"'; }).join(sep); }).join('\r\n');
    var blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
    var a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download='modelo_pedagios.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 400);
  }
  function abrirImportar(){
    if(typeof global.setModal!=='function'){ _toast('Modal indisponivel','erro'); return; }
    _pedImportRows=[];
    global.setModal('<div class="modal-bg"><div class="modal" style="max-width:680px"><h3>Importar pedágios (Excel)</h3>'
      +'<div style="background:#f9f9f7;border-radius:8px;padding:.75rem;font-size:12px;margin-bottom:.75rem">'
      +'1) <a href="#" onclick="frtPedBaixarModelo();return false;" style="color:#185FA5;font-weight:600">Baixar modelo Excel</a>'
      +' — abra no Excel, preencha e salve.<br>'
      +'2) Envie o arquivo (.xlsx, .xls ou .csv). Colunas: Data/hora, Placa, Valor, Praca, Rodovia, Estabelecimento, Centro de custo, Tipo, Origem, Status, Contrato, Observacao.<br>'
      +'Tipos aceitos: PASSAGEM, FATURA, Mensalidade TAG, Mensalidade TAG em estoque.</div>'
      +'<div id="frt-ped-drop" style="border:2px dashed #e0dfd8;border-radius:10px;padding:1.6rem;text-align:center;cursor:pointer;margin-bottom:.75rem">'
      +'<div style="font-size:24px;margin-bottom:.35rem">📂</div>'
      +'<div style="font-size:13px;color:#555">Arraste o Excel aqui ou clique para selecionar</div>'
      +'<input type="file" id="frt-ped-file" accept=".xlsx,.xls,.csv,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" style="display:none"/>'
      +'</div>'
      +'<div id="frt-ped-imp-preview" style="font-size:12px;color:#888"></div>'
      +'<div style="margin-top:1rem;text-align:right;display:flex;gap:6px;justify-content:flex-end">'
      +'<button class="btn" onclick="closeModal()">Cancelar</button>'
      +'<button class="btn btn-pri" id="frt-ped-imp-ok" style="display:none" onclick="frtPedConfirmarImportar()">Importar</button>'
      +'</div></div></div>');
    setTimeout(function(){
      var drop=document.getElementById('frt-ped-drop');
      var inp=document.getElementById('frt-ped-file');
      if(drop&&inp){
        drop.onclick=function(){ inp.click(); };
        drop.ondragover=function(e){ e.preventDefault(); drop.style.borderColor='#185FA5'; };
        drop.ondragleave=function(){ drop.style.borderColor='#e0dfd8'; };
        drop.ondrop=function(e){
          e.preventDefault(); drop.style.borderColor='#e0dfd8';
          if(e.dataTransfer&&e.dataTransfer.files[0]) processarArquivo(e.dataTransfer.files[0]);
        };
        inp.onchange=function(){ if(inp.files&&inp.files[0]) processarArquivo(inp.files[0]); };
      }
    }, 30);
  }
  async function processarArquivo(file){
    var preview=document.getElementById('frt-ped-imp-preview');
    var btn=document.getElementById('frt-ped-imp-ok');
    if(preview) preview.innerHTML='<div style="color:#888">Lendo arquivo…</div>';
    if(btn) btn.style.display='none';
    _pedImportRows=[];
    try{
      var nome=String(file&&file.name||'').toLowerCase();
      var rows=[];
      if(typeof global.XLSX!=='undefined' && !/\.csv$/i.test(nome)){
        var buf=await file.arrayBuffer();
        var wb=global.XLSX.read(buf,{type:'array',cellDates:true});
        var ws=wb.Sheets[wb.SheetNames[0]];
        rows=(global.XLSX.utils.sheet_to_json(ws,{defval:''})||[]).map(_normRowKeys);
      } else if(/\.xlsx$/i.test(nome)){
        var buf2=await file.arrayBuffer();
        rows=_xlsxParaLinhas(await _unzipXlsx(buf2));
      } else if(/\.xls$/i.test(nome)){
        var html=await new Promise(function(res,rej){
          var rd=new FileReader();
          rd.onload=function(){ res(rd.result||''); };
          rd.onerror=rej;
          rd.readAsText(file,'utf-8');
        });
        rows=_htmlTableParaLinhas(html);
        if(!rows.length) rows=_parseCsv(html);
      } else {
        var txt=await new Promise(function(res,rej){
          var rd=new FileReader();
          rd.onload=function(){ res(rd.result||''); };
          rd.onerror=rej;
          rd.readAsText(file,'utf-8');
        });
        rows=_parseCsv(txt);
      }
      if(!rows.length){ if(preview) preview.innerHTML='<div style="color:#A32D2D">Nenhuma linha valida.</div>'; return; }
      _pedImportRows=rows;
      var heads=Object.keys(rows[0]);
      var html='<div style="color:#3B6D11;margin-bottom:6px">'+rows.length+' linha(s) pronta(s) para importar</div>'
        +'<div style="overflow:auto;max-height:220px"><table class="tbl" style="font-size:11px"><thead><tr>'
        +heads.slice(0,8).map(function(h){ return '<th>'+_esc(h)+'</th>'; }).join('')
        +'</tr></thead><tbody>'
        +rows.slice(0,6).map(function(r){
          return '<tr>'+heads.slice(0,8).map(function(h){ return '<td>'+_esc(r[h]||'')+'</td>'; }).join('')+'</tr>';
        }).join('')
        +'</tbody></table></div>';
      if(rows.length>6) html+='<div style="color:#888;margin-top:4px">… e mais '+(rows.length-6)+' linha(s)</div>';
      if(preview) preview.innerHTML=html;
      if(btn) btn.style.display='';
    }catch(e){
      if(preview) preview.innerHTML='<div style="color:#A32D2D">'+(e&&e.message?e.message:'Arquivo invalido')+'</div>';
    }
  }
  async function confirmarImportar(){
    if(!_pedImportRows.length){ _toast('Selecione um arquivo.','erro'); return; }
    var preview=document.getElementById('frt-ped-imp-preview');
    if(preview) preview.innerHTML='<div style="color:#888">Importando '+_pedImportRows.length+' linha(s)…</div>';
    var r=svc().importarLote?await svc().importarLote(_pedImportRows):{ok:0,erro:_pedImportRows.length,dup:0};
    if(typeof global.closeModal==='function') global.closeModal();
    var det='Importados: '+r.ok+(r.dup?' · já existiam / repetidos: '+r.dup:'')+(r.erro?' · recusados: '+r.erro:'');
    if(r.erro && r.falhas && r.falhas.length){
      det+=' — '+r.falhas.slice(0,3).map(function(f){ return 'linha '+f.linha+': '+f.motivo; }).join('; ');
    }
    _toast(det, r.ok?undefined:'erro');
    render();
  }

  function placaMudou(){
    var sel=document.getElementById('frt-ped-f-placa');
    var inp=document.getElementById('frt-ped-f-cont');
    if(!inp) return;
    var opt=sel&&sel.options[sel.selectedIndex];
    var nome=opt&&opt.getAttribute('data-cnome');
    var cid=opt&&opt.getAttribute('data-cid');
    if(!nome && cid && svc().nomeContrato) nome=svc().nomeContrato(cid);
    if(!nome && sel && sel.value && svc().labelContrato) nome=svc().labelContrato({placa:sel.value, veiculo_id:opt&&opt.getAttribute('data-vid')});
    inp.value=nome||'';
  }

  Ped.init=init;
  Ped.abrir=abrir;
  Ped.recarregar=init;

  global.frtPedInit=init;
  global.frtPedRender=render;
  global.frtPedRecarregar=recarregarLista;
  global.frtPedAba=aba;
  global.frtPedAbrirImportar=abrirImportar;
  global.frtPedBaixarModelo=baixarModelo;
  global.frtPedConfirmarImportar=confirmarImportar;
  global.frtPedPlacaMudou=placaMudou;
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
})(typeof window!=='undefined'?window:this);
