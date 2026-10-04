/* Programação de Projetos — fila "Projetos a programar" (8.1.202).
 * Fonte persistente: prog_projetos_agenda (projeto + data, ainda sem equipe). RLS no banco decide quem lê e grava.
 * EM COMPOSIÇÃO e PROGRAMADO continuam vindo só de composicao_dia (projeto_ids + confirmada).
 * Escolher a data não programa o projeto. Nada aqui grava em composicao_dia. */
(function(global){
  'use strict';

  var TABELA = 'prog_projetos_agenda';
  var CAMPOS = 'id,projeto_id,contrato_id,data,status,equipe_id,origem,criado_por,criado_em,alocado_em';
  var PERFIS = ['admin','diretoria','gestor','coordenador','supervisor','administrativo','escritorio'];

  function esc(s){
    return String(s==null?'':s).replace(/[&<>"']/g, function(c){
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
    });
  }

  function iso(v){
    var s = String(v==null?'':v).split('T')[0].slice(0,10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
  }

  function dataBR(v){
    var s = iso(v);
    if(!s) return '—';
    var p = s.split('-');
    return p[2]+'/'+p[1]+'/'+p[0];
  }

  function somarDias(ymd, dias){
    var p = iso(ymd).split('-');
    var d = new Date(Number(p[0]), Number(p[1])-1, Number(p[2]), 12, 0, 0);
    d.setDate(d.getDate() + dias);
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }

  function hoje(){
    if(typeof global.dataHojeLocal==='function'){
      var h = iso(global.dataHojeLocal());
      if(h) return h;
    }
    var d = new Date();
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  }

  function uuid(v){
    var s = String(v||'').toLowerCase();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s) ? s : '';
  }

  function listaIds(raw){
    if(Array.isArray(raw)) return raw.filter(Boolean).map(String);
    if(raw==null || raw==='') return [];
    try{
      var v = JSON.parse(raw);
      return Array.isArray(v) ? v.filter(Boolean).map(String) : [];
    }catch(e){ return []; }
  }

  function confirmada(c){
    var v = c && c.confirmada;
    return v===true || v==='true' || v===1 || v==='t';
  }

  function ativa(r){
    return !!(r && !r.deleted_at && String(r.status||'')!=='CANCELADO');
  }

  function perfilPode(usuario){
    var u = usuario===undefined ? global.usuarioLogado : usuario;
    if(!u) return false;
    return PERFIS.indexOf(String(u.perfil||'').trim().toLowerCase())>=0;
  }

  function projetoDe(id){
    var lista = Array.isArray(global.sot_projetos) ? global.sot_projetos : [];
    for(var i=0;i<lista.length;i++){ if(lista[i] && String(lista[i].id)===String(id)) return lista[i]; }
    return null;
  }

  function nomeProjeto(id, projeto){
    var p = projeto || projetoDe(id);
    if(!p) return 'Projeto '+String(id||'').slice(0,8);
    var cod = p.codigo_cliente || p.codigo || '';
    var nome = p.nome || p.descricao || '';
    if(cod && nome && cod!==nome) return cod+' — '+nome;
    return cod || nome || ('Projeto '+String(id||'').slice(0,8));
  }

  function nomeEquipe(id){
    var lista = Array.isArray(global.equipes) ? global.equipes : [];
    for(var i=0;i<lista.length;i++){
      if(lista[i] && String(lista[i].id)===String(id)) return lista[i].nome_equipe || lista[i].codigo || 'Equipe';
    }
    return 'Equipe '+String(id||'').slice(0,8);
  }

  function nomeContrato(cid){
    var lista = Array.isArray(global.contratos) ? global.contratos : [];
    for(var i=0;i<lista.length;i++){
      if(lista[i] && String(lista[i].id)===String(cid)) return lista[i].nome || lista[i].codigo || '—';
    }
    return '—';
  }

  // ── Leitura ──────────────────────────────────────────────────
  function ler(table, filters, select, requireAuth){
    if(typeof global.sbFetch!=='function') return Promise.resolve({known:false, rows:null});
    var opts = {filters:filters, limit:500, order:'data.asc'};
    if(select) opts.select = select;
    if(requireAuth) opts.requireAuth = true;
    return Promise.resolve(global.sbFetch(table, opts)).then(function(rows){
      return Array.isArray(rows) ? {known:true, rows:rows} : {known:false, rows:null};
    }, function(){ return {known:false, rows:null}; });
  }

  function progAgendaListarData(cid, data){
    var d = iso(data);
    if(!cid || !d) return Promise.resolve({known:false, rows:null});
    if(global.DEMO) return Promise.resolve({known:true, rows:[]});
    return ler(TABELA, ['contrato_id=eq.'+encodeURIComponent(cid), 'data=eq.'+d, 'deleted_at=is.null', 'status=neq.CANCELADO'], CAMPOS, true);
  }

  function progAgendaListarProjeto(projetoId, desde){
    var id = uuid(projetoId);
    if(!id) return Promise.resolve({known:false, rows:null});
    if(global.DEMO) return Promise.resolve({known:true, rows:[]});
    var f = ['projeto_id=eq.'+id, 'deleted_at=is.null', 'status=neq.CANCELADO'];
    if(iso(desde)) f.push('data=gte.'+iso(desde));
    return ler(TABELA, f, CAMPOS, true);
  }

  function compTemProjeto(c, projetoId){
    if(!c || c.deleted_at) return false;
    var alvo = uuid(projetoId);
    return !!alvo && listaIds(c.projeto_ids).some(function(x){ return uuid(x)===alvo; });
  }

  function progAgendaComposicoesProjeto(projetoId, desde){
    var id = uuid(projetoId);
    if(!id) return Promise.resolve({known:false, rows:null});
    if(global.DEMO){
      var mem = (Array.isArray(global.composicao_dia) ? global.composicao_dia : []).filter(function(c){
        return compTemProjeto(c, id) && (!iso(desde) || iso(c.data)>=iso(desde));
      });
      return Promise.resolve({known:true, rows:mem});
    }
    var f = ['deleted_at=is.null', 'projeto_ids=ilike.*'+id+'*'];
    if(iso(desde)) f.push('data=gte.'+iso(desde));
    return ler('composicao_dia', f, 'id,data,equipe_id,projeto_ids,confirmada', false).then(function(slot){
      if(!slot.known) return slot;
      return {known:true, rows:slot.rows.filter(function(c){ return compTemProjeto(c, id); })};
    });
  }

  // ── Regras puras ─────────────────────────────────────────────
  /** Situação do projeto num dia, só pela composição: programado (confirmada) ou em_composicao. */
  function progAgendaSituacaoNoDia(projetoId, data, comps){
    var d = iso(data);
    var achadas = (comps||[]).filter(function(c){ return iso(c && c.data)===d && compTemProjeto(c, projetoId); });
    if(!achadas.length) return null;
    var conf = achadas.filter(confirmada);
    var c = conf[0] || achadas[0];
    return {tipo: conf.length ? 'programado' : 'em_composicao', equipe_id: c.equipe_id, confirmada: !!conf.length, comp_id: c.id};
  }

  /** Separa a fila do dia: a programar (agenda sem projeto em composição) e projetos já nas equipes. */
  function progAgendaMontarFila(agendaRows, comps, data, equipeIds){
    var d = iso(data);
    var filtroEq = Array.isArray(equipeIds) ? equipeIds.map(String) : null;
    var compsDia = (comps||[]).filter(function(c){
      if(!c || c.deleted_at || iso(c.data)!==d) return false;
      return !filtroEq || filtroEq.indexOf(String(c.equipe_id))>=0;
    });
    var porProjeto = {};
    var programados = [];
    compsDia.forEach(function(c){
      listaIds(c.projeto_ids).forEach(function(pid){
        var k = String(pid);
        if(!porProjeto[k]) porProjeto[k] = [];
        if(porProjeto[k].some(function(x){ return String(x.equipe_id)===String(c.equipe_id); })) return;
        var item = {projeto_id:k, equipe_id:c.equipe_id, confirmada:confirmada(c), comp_id:c.id, agenda:null};
        porProjeto[k].push(item);
        programados.push(item);
      });
    });
    var aProgramar = [];
    var vistos = {};
    (agendaRows||[]).forEach(function(r){
      if(!ativa(r) || iso(r.data)!==d) return;
      var k = String(r.projeto_id);
      if(porProjeto[k]){
        porProjeto[k].forEach(function(item){ item.agenda = r; });
        return;
      }
      if(vistos[k]) return;
      vistos[k] = true;
      aProgramar.push(r);
    });
    programados.sort(function(a,b){ return (a.confirmada===b.confirmada) ? 0 : (a.confirmada ? 1 : -1); });
    return {aProgramar:aProgramar, programados:programados};
  }

  /** O que já existe para o projeto antes de gravar a nova data. */
  function progAgendaAnalisarConflito(agendaRows, comps, projetoId, data, hojeIso){
    var d = iso(data);
    var h = iso(hojeIso) || hoje();
    var noDia = progAgendaSituacaoNoDia(projetoId, d, comps);
    if(noDia) return {tipo:'na_programacao', data:d, situacao:noDia};
    var vivas = (agendaRows||[]).filter(function(r){
      return ativa(r) && String(r.projeto_id)===String(projetoId) && iso(r.data)>=h;
    });
    var mesma = vivas.filter(function(r){ return iso(r.data)===d; })[0];
    if(mesma) return {tipo:'mesma_data', data:d, row:mesma};
    var compsOutras = (comps||[]).filter(function(c){
      return compTemProjeto(c, projetoId) && iso(c.data)>=h && iso(c.data)!==d;
    });
    var datasComp = {};
    compsOutras.forEach(function(c){ datasComp[iso(c.data)] = true; });
    var pendentes = vivas.filter(function(r){
      return iso(r.data)!==d && String(r.status)==='AGUARDANDO_EQUIPE' && !datasComp[iso(r.data)];
    });
    if(pendentes.length || compsOutras.length){
      var datas = {};
      pendentes.forEach(function(r){ datas[iso(r.data)] = true; });
      compsOutras.forEach(function(c){ datas[iso(c.data)] = true; });
      return {tipo:'outras_datas', data:d, pendentes:pendentes, composicoes:compsOutras, datas:Object.keys(datas).sort()};
    }
    return {tipo:'livre', data:d};
  }

  // ── Gravação (sessão obrigatória; banco valida tudo de novo) ─
  function erroDoBanco(){
    var bruto = String(global._sbLastInsertErr || global._sbLastUpdateErr || '');
    var info = {code:'', message:bruto};
    try{
      var j = JSON.parse(bruto);
      info.code = String(j.code||'');
      info.message = String(j.message||bruto);
    }catch(e){
      var m = /"code"\s*:\s*"(\w+)"/.exec(bruto);
      if(m) info.code = m[1];
    }
    return info;
  }

  function mensagemErro(info){
    if(info.code==='42501' || /row-level security|permission denied/i.test(info.message)) return 'Seu usuário não tem permissão para programar projetos.';
    if(info.code==='42P01' || /prog_projetos_agenda/.test(info.message) && /does not exist|schema cache/i.test(info.message)) return 'A fila de projetos ainda não está disponível no banco.';
    if(info.code==='23514' || info.code==='23503') return info.message;
    return 'Não foi possível gravar. Nada foi alterado.';
  }

  function usuarioNome(){
    var u = global.usuarioLogado || {};
    return u.nome || u.email || null;
  }

  function progAgendaCriar(projeto, data, origem){
    var d = iso(data);
    if(!projeto || !uuid(projeto.id)) return Promise.resolve({ok:false, erro:'Projeto inválido.'});
    if(!d) return Promise.resolve({ok:false, erro:'Escolha a data.'});
    if(d < hoje()) return Promise.resolve({ok:false, erro:'A data já passou.'});
    if(typeof global.sbInsert!=='function') return Promise.resolve({ok:false, erro:'Gravação indisponível.'});
    var payload = {projeto_id:projeto.id, data:d, origem: origem==='programacao' ? 'programacao' : 'jornada', criado_por:usuarioNome()};
    if(projeto.contrato_id) payload.contrato_id = String(projeto.contrato_id);
    global._sbLastInsertErr = '';
    return Promise.resolve(global.sbInsert(TABELA, payload, {requireAuth:true, silent:true})).then(function(r){
      if(r && r[0] && r[0].id) return {ok:true, row:r[0]};
      var info = erroDoBanco();
      if(info.code==='23505' || /duplicate key|prog_projetos_agenda_projeto_data_uidx/i.test(info.message)) return {ok:false, duplicado:true, erro:'Este projeto já está aguardando programação para '+dataBR(d)+'.'};
      return {ok:false, erro:mensagemErro(info)};
    }, function(){ return {ok:false, erro:'Não foi possível gravar. Nada foi alterado.'}; });
  }

  function progAgendaCancelar(row){
    if(!row || !uuid(row.id) || typeof global.sbUpdate!=='function') return Promise.resolve(false);
    global._sbLastUpdateErr = '';
    return Promise.resolve(global.sbUpdate(TABELA, {status:'CANCELADO', cancelado_por:usuarioNome()}, 'id=eq.'+row.id, {requireAuth:true, silent:true, linhas:true}))
      .then(function(r){ return Array.isArray(r) && r.length>0; }, function(){ return false; });
  }

  /** Acompanha a composição: com equipe → ALOCADO; sem equipe → volta a AGUARDANDO_EQUIPE. Sem agendamento, não faz nada. */
  function progAgendaSincronizarAlocacao(projetoId, data, equipeId){
    var d = iso(data);
    if(global.DEMO || !uuid(projetoId) || !d || typeof global.sbUpdate!=='function') return Promise.resolve(false);
    var filtro = 'projeto_id=eq.'+uuid(projetoId)+'&data=eq.'+d+'&deleted_at=is.null&status=neq.CANCELADO';
    var payload = equipeId ? {status:'ALOCADO', equipe_id:String(equipeId)} : {status:'AGUARDANDO_EQUIPE', equipe_id:null};
    return Promise.resolve(global.sbUpdate(TABELA, payload, filtro, {requireAuth:true, silent:true, linhas:true}))
      .then(function(r){ return Array.isArray(r) && r.length>0; }, function(){ return false; });
  }

  // ── Modal da data (Jornada) ──────────────────────────────────
  var _modal = null;

  function el(id){ return typeof document!=='undefined' ? document.getElementById(id) : null; }

  function msg(html, cor){
    var m = el('pa-msg');
    if(m){ m.innerHTML = html||''; m.style.color = cor||'#555'; }
  }

  function acoes(html){
    var a = el('pa-acoes');
    if(a) a.innerHTML = html;
  }

  function botao(label, onclick, pri, extra){
    return '<button type="button" class="btn'+(pri?' btn-pri':'')+'" style="flex:1;min-width:120px;font-size:13px;padding:10px 12px'+(extra||'')+'" onclick="'+onclick+'">'+esc(label)+'</button>';
  }

  function acoesIniciais(){
    acoes(botao('Cancelar','closeModal()')+botao('Enviar para Programação','progAgendaModalEnviar()',true));
    var b = el('pa-acoes') && el('pa-acoes').querySelectorAll('button');
    if(b && b[1]) b[1].disabled = !(_modal && _modal.data);
  }

  function travar(sim){
    var a = el('pa-acoes');
    if(!a) return;
    Array.prototype.forEach.call(a.querySelectorAll('button'), function(b){ b.disabled = !!sim; });
    ['pa-hoje','pa-amanha','pa-data'].forEach(function(id){ var x = el(id); if(x) x.disabled = !!sim; });
  }

  function progAgendaPedirData(projeto){
    if(!projeto || !projeto.id) return;
    if(global.usuarioLogado && !perfilPode()){
      if(typeof global.progShowToast==='function') global.progShowToast('Seu perfil não envia projetos para a Programação.');
      else if(typeof global.alert==='function') global.alert('Seu perfil não envia projetos para a Programação.');
      return;
    }
    if(typeof global.setModal!=='function') return;
    var h = hoje();
    _modal = {projeto:projeto, data:'', conflito:null};
    var html = '<div class="modal-bg" onclick="if(event.target===this)closeModal()">'
      +'<div class="modal" style="max-width:460px">'
      +'<h3 style="margin:0 0 .6rem">Para qual data deseja programar esta execução?</h3>'
      +'<div style="font-size:13px;margin-bottom:2px">Projeto: <b>'+esc(nomeProjeto(projeto.id, projeto))+'</b></div>'
      +'<div style="font-size:12px;color:#666;margin-bottom:.8rem">Contrato: '+esc(nomeContrato(projeto.contrato_id))+'</div>'
      +'<div style="display:flex;gap:8px;margin-bottom:8px">'
      +'<button type="button" id="pa-hoje" class="btn" style="flex:1;font-size:13px;padding:10px" onclick="progAgendaModalEscolher(\'hoje\')">Hoje</button>'
      +'<button type="button" id="pa-amanha" class="btn" style="flex:1;font-size:13px;padding:10px" onclick="progAgendaModalEscolher(\'amanha\')">Amanhã</button>'
      +'</div>'
      +'<input type="date" id="pa-data" class="inp" min="'+h+'" style="width:100%;font-size:14px;padding:8px;box-sizing:border-box" onchange="progAgendaModalEscolher(this.value)" oninput="progAgendaModalEscolher(this.value)"/>'
      +'<div id="pa-msg" style="font-size:12px;margin:.6rem 0;min-height:1em">A data é obrigatória. Escolher a data não programa a equipe.</div>'
      +'<div id="pa-acoes" style="display:flex;gap:8px;flex-wrap:wrap"></div>'
      +'</div></div>';
    global.setModal(html);
    acoesIniciais();
  }

  function progAgendaModalEscolher(qual){
    if(!_modal) return;
    var h = hoje();
    var d = qual==='hoje' ? h : (qual==='amanha' ? somarDias(h, 1) : iso(qual));
    var inp = el('pa-data');
    if(qual==='hoje' || qual==='amanha'){ if(inp) inp.value = d; }
    if(d && d < h){
      _modal.data = '';
      msg('A data já passou. Escolha hoje ou uma data futura.', '#A32D2D');
    } else {
      _modal.data = d;
      msg(d ? 'Execução para <b>'+dataBR(d)+'</b>. O projeto entra em PROJETOS A PROGRAMAR, aguardando equipe.' : 'A data é obrigatória.', '#555');
    }
    _modal.conflito = null;
    acoesIniciais();
  }

  function rerenderJornada(){
    if(!_modal || typeof global.jornadaRender!=='function' || !el('sot-jornada-root')) return;
    try{ global.jornadaRender(_modal.projeto); }catch(e){}
  }

  function sucesso(d, extra){
    msg('✓ Projeto enviado para a Programação de <b>'+dataBR(d)+'</b>. Situação: <b>A PROGRAMAR — AGUARDANDO EQUIPE</b>.'+(extra?'<br>'+extra:''), '#3B6D11');
    acoes(botao('Fechar','closeModal()')+botao('Abrir programação','progAgendaModalAbrirProgramacao(\''+d+'\')',true));
    rerenderJornada();
  }

  function progAgendaModalEnviar(){
    if(!_modal) return;
    var d = _modal.data;
    var h = hoje();
    if(!d){ msg('A data é obrigatória.', '#A32D2D'); return; }
    if(d < h){ msg('A data já passou. Escolha hoje ou uma data futura.', '#A32D2D'); return; }
    var projeto = _modal.projeto;
    travar(true);
    msg('Conferindo a programação deste projeto…', '#555');
    Promise.all([progAgendaListarProjeto(projeto.id, h), progAgendaComposicoesProjeto(projeto.id, h)]).then(function(r){
      if(!_modal || _modal.projeto!==projeto) return;
      if(!r[0].known || !r[1].known){
        travar(false);
        msg('Não foi possível conferir a programação deste projeto. Nada foi gravado.', '#A32D2D');
        return;
      }
      var c = progAgendaAnalisarConflito(r[0].rows, r[1].rows, projeto.id, d, h);
      _modal.conflito = c;
      if(c.tipo==='livre') return criar(d);
      if(c.tipo==='na_programacao'){
        var st = c.situacao.tipo==='programado' ? 'PROGRAMADO' : 'EM COMPOSIÇÃO';
        msg('Este projeto já está na programação de <b>'+dataBR(d)+'</b> — '+esc(nomeEquipe(c.situacao.equipe_id))+' ('+st+').', '#854F0B');
        acoes(botao('Fechar','closeModal()')+botao('Abrir programação','progAgendaModalAbrirProgramacao(\''+d+'\')',true));
        return;
      }
      if(c.tipo==='mesma_data'){
        msg('Este projeto já está aguardando programação para <b>'+dataBR(d)+'</b>.', '#854F0B');
        acoes(botao('Fechar','closeModal()')+botao('Abrir programação','progAgendaModalAbrirProgramacao(\''+d+'\')',true));
        return;
      }
      var datas = c.datas.map(dataBR).join(', ');
      msg('Este projeto já está previsto para <b>'+datas+'</b>. A nova data é <b>'+dataBR(d)+'</b>.', '#854F0B');
      var h2 = botao('Manter data','closeModal()');
      if(c.pendentes.length) h2 += botao('Alterar para '+dataBR(d),'progAgendaModalResolver(\'alterar\')',true);
      h2 += botao('Adicionar mais esta data','progAgendaModalResolver(\'adicionar\')', !c.pendentes.length);
      h2 += botao('Cancelar','closeModal()');
      acoes(h2);
    }, function(){
      travar(false);
      msg('Não foi possível conferir a programação deste projeto. Nada foi gravado.', '#A32D2D');
    });
  }

  function criar(d, depois){
    var projeto = _modal.projeto;
    msg('Gravando…', '#555');
    return progAgendaCriar(projeto, d, 'jornada').then(function(res){
      if(!_modal || _modal.projeto!==projeto) return;
      if(res.ok){
        if(depois) return depois(res);
        return sucesso(d);
      }
      if(res.duplicado){
        msg('Este projeto já está aguardando programação para <b>'+dataBR(d)+'</b>.', '#854F0B');
        acoes(botao('Fechar','closeModal()')+botao('Abrir programação','progAgendaModalAbrirProgramacao(\''+d+'\')',true));
        return;
      }
      travar(false);
      acoesIniciais();
      msg(esc(res.erro || 'Não foi possível gravar. Nada foi alterado.'), '#A32D2D');
    });
  }

  function progAgendaModalResolver(acao){
    if(!_modal || !_modal.conflito) return;
    var c = _modal.conflito;
    var d = c.data;
    travar(true);
    if(acao==='adicionar') return criar(d);
    if(acao!=='alterar') return;
    return criar(d, function(){
      return Promise.all(c.pendentes.map(progAgendaCancelar)).then(function(oks){
        var falhou = c.pendentes.filter(function(r, i){ return !oks[i]; }).map(function(r){ return dataBR(r.data); });
        sucesso(d, falhou.length
          ? '<span style="color:#A32D2D">Não foi possível retirar '+esc(falhou.join(', '))+' da fila. Confira na Programação.</span>'
          : 'Retirado da fila de '+esc(c.pendentes.map(function(r){ return dataBR(r.data); }).join(', '))+'.');
      });
    });
  }

  function progAgendaModalAbrirProgramacao(data){
    var projeto = _modal && _modal.projeto;
    if(typeof global.closeModal==='function') global.closeModal();
    if(projeto && typeof global.jornadaAbrirProgramacao==='function') global.jornadaAbrirProgramacao(projeto, data);
  }

  global.PROG_AGENDA_PERFIS = PERFIS.slice();
  global.progAgendaPerfilPode = perfilPode;
  global.progAgendaDataBR = dataBR;
  global.progAgendaNomeProjeto = nomeProjeto;
  global.progAgendaNomeEquipe = nomeEquipe;
  global.progAgendaListarData = progAgendaListarData;
  global.progAgendaListarProjeto = progAgendaListarProjeto;
  global.progAgendaComposicoesProjeto = progAgendaComposicoesProjeto;
  global.progAgendaSituacaoNoDia = progAgendaSituacaoNoDia;
  global.progAgendaMontarFila = progAgendaMontarFila;
  global.progAgendaAnalisarConflito = progAgendaAnalisarConflito;
  global.progAgendaCriar = progAgendaCriar;
  global.progAgendaCancelar = progAgendaCancelar;
  global.progAgendaSincronizarAlocacao = progAgendaSincronizarAlocacao;
  global.progAgendaPedirData = progAgendaPedirData;
  global.progAgendaModalEscolher = progAgendaModalEscolher;
  global.progAgendaModalEnviar = progAgendaModalEnviar;
  global.progAgendaModalResolver = progAgendaModalResolver;
  global.progAgendaModalAbrirProgramacao = progAgendaModalAbrirProgramacao;
})(typeof window!=='undefined' ? window : globalThis);
