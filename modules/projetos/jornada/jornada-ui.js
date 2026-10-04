/* Jornada de Projetos — desenho da aba (Fase 1). */
(function(global){
  'use strict';

  function esc(s){
    return String(s==null?'':s).replace(/[&<>"']/g, function(c){
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];
    });
  }

  var ICONE = {
    concluida:'✅',
    em_andamento:'🟡',
    pendencia:'⚠',
    nao_iniciada:'○',
    aguardando:'⏳',
    bloqueada:'🔴',
    nao_aplicavel:'—',
    desconhecido:'…',
    sem_evidencia:'…'
  };

  var ROTULO_MED = {
    rascunho:'Rascunho',
    em_aprovacao:'Em aprovação',
    aprovado:'Aprovado',
    emissao_liberada:'Emissão liberada',
    nf_emitida:'NF emitida'
  };

  function linha(it){
    var ico = ICONE[it.estado] || '○';
    return '<div style="display:flex;gap:8px;align-items:baseline;font-size:12px;padding:2px 0">'
      +'<span style="width:1.2em">'+ico+'</span>'
      +'<span style="font-weight:600">'+esc(it.label)+'</span>'
      +(it.texto?'<span style="color:#666">'+esc(it.texto)+'</span>':'')
      +'</div>';
  }

  function jornadaHtml(projeto, contexto){
    var p = projeto || {};
    var estado = global.jornadaDerivarEstado(p, contexto);
    var acao = global.jornadaObterProximaAcao(p, estado);
    global._jornadaProjetoAtual = p;
    global._jornadaAcaoAtual = acao;
    var perfil = estado.perfil || {};
    var contrato = perfil.contrato || {};
    var pct = estado.percentual || {};
    var pctTxt = !pct.known ? '…' : (pct.temBase ? pct.value+'%' : 'Sem base de valor');
    var fases = (estado.fases||[]).map(function(f){
      return '<div style="margin-top:10px">'
        +'<div style="font-size:11px;font-weight:700;letter-spacing:.04em;color:#555;text-transform:uppercase">'+esc(f.titulo)+'</div>'
        +(f.itens||[]).map(linha).join('')
        +'</div>';
    }).join('');
    var parciais = '';
    if(estado.medicoesConhecidas && estado.parciais && estado.parciais.length){
      parciais = '<div style="margin-top:8px">'
        +estado.parciais.map(function(m){
          var nome = ROTULO_MED[m.status] || (m.status || 'sem status');
          var extra = m.status==='nf_emitida' && m.nfs ? ' · NF '+m.nfs : '';
          return '<div style="font-size:12px;padding:2px 0 2px 1.2em">Parcial '+esc(m.numero==null?'—':m.numero)+' — '+esc(nome)+esc(extra)+'</div>';
        }).join('')
        +'</div>';
    }
    var asBuilt = '';
    if(estado.asBuilt && estado.asBuilt.exibir){
      asBuilt = '<div style="margin-top:10px">'
        +'<div style="font-size:11px;font-weight:700;letter-spacing:.04em;color:#555;text-transform:uppercase">AS BUILT</div>'
        +linha({estado:estado.asBuilt.estado, label:'AS BUILT', texto:estado.asBuilt.texto})
        +'</div>';
    }
    var detalhe = estado.programacaoDetalhe;
    global._jornadaDetalheProgramacao = detalhe || null;
    var detalheHtml = '';
    if(detalhe){
      var corDet = detalhe.tipo==='programado' ? ['#EAF3DE','#3B6D11','✅'] : (detalhe.tipo==='em_composicao' ? ['#FEF3E2','#854F0B','🟡'] : ['#EBF4FD','#185FA5','⏳']);
      detalheHtml = '<div style="margin-top:8px;font-size:12px;font-weight:600;background:'+corDet[0]+';color:'+corDet[1]+';border-radius:6px;padding:6px 8px">'+corDet[2]+' '+esc(detalhe.texto)+'</div>';
    }
    var adicionais = '';
    if(estado.adicionaisPendentes){
      adicionais = '<div style="margin-top:8px;font-size:12px;color:#854F0B">⚠ '+estado.adicionaisPendentes+' adicional(is) pendente(s)</div>';
    }
    var aviso = perfil.aviso
      ? '<div style="margin-top:8px;font-size:12px;color:#854F0B;background:#FEF3E2;border-radius:6px;padding:6px 8px">'+esc(perfil.aviso)+'</div>'
      : '';
    var botao = acao.destino
      ? '<button type="button" class="btn btn-pri" style="margin-top:8px;font-size:12px" onclick="jornadaExecutarAcao(window._jornadaAcaoAtual, window._jornadaProjetoAtual)">'+esc(acao.label)+'</button>'
      : '<div style="margin-top:8px;font-size:13px;font-weight:700">'+esc(acao.label)+'</div>';
    return '<div style="padding:12px 14px">'
      +'<div style="font-size:15px;font-weight:700">'+esc(p.nome||p.codigo_cliente||'Projeto')+'</div>'
      +'<div style="font-size:12px;color:#555;margin-top:2px">Cliente: '+esc(contrato.cliente||p.cliente||'—')
      +' · Contrato: '+esc(contrato.nome||'—')
      +' · Perfil: '+esc(perfil.id||'BASE_PROJETOS')+' '+esc(perfil.versao||'')+'</div>'
      +aviso
      +'<div style="margin-top:8px;font-size:12px">Execução geral: <b>'+esc(pctTxt)+'</b></div>'
      +'<div style="margin-top:4px;font-size:12px;color:#666">Status administrativo atual: <b>'+esc(estado.statusAdministrativo||'—')+'</b></div>'
      +fases
      +detalheHtml
      +parciais
      +asBuilt
      +adicionais
      +'<div style="margin-top:14px;padding-top:10px;border-top:.5px solid #e0dfd8">'
      +'<div style="font-size:11px;font-weight:700;letter-spacing:.04em;color:#555;text-transform:uppercase">Próxima ação</div>'
      +botao
      +(acao.motivo?'<div style="font-size:11px;color:#666;margin-top:4px">'+esc(acao.motivo)+'</div>':'')
      +'</div></div>';
  }

  global.jornadaHtml = jornadaHtml;
})(typeof window!=='undefined' ? window : globalThis);
