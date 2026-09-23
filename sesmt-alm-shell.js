/* CENA — casco das telas SESMT / Almoxarifado (8.1.112)
   O index.html perdeu os <div id="pg-sesmt-*"> / pg-alm-*.
   Sem o container, o clique no menu não pinta nada. */
(function(){
  function aca(){ return document.getElementById('app-content-area')||document.body; }
  function page(id, html, parent){
    var el=document.getElementById(id);
    if(!el){
      el=document.createElement('div');
      el.id=id;
      el.className='hidden';
      (parent||aca()).appendChild(el);
    }
    if(!el.innerHTML || !String(el.innerHTML).trim()) el.innerHTML=html||'';
    return el;
  }
  function tbl(id, cols){
    return '<div style="overflow-x:auto"><table class="tbl"><thead><tr>'
      +cols.map(function(c){ return '<th>'+c+'</th>'; }).join('')
      +'</tr></thead><tbody id="'+id+'"></tbody></table></div>';
  }
  function hdr(titulo, extra){
    return '<div style="display:flex;align-items:center;gap:10px;margin-bottom:1rem;flex-wrap:wrap">'
      +'<span style="font-size:14px;font-weight:700">'+titulo+'</span>'+(extra||'')+'</div>';
  }

  function hubHtml(){
    var tabs=[
      ['entradas','📥 Entradas'],['alm','📦 Movimentações'],['itens','🗂 Catálogo'],
      ['estoque','🗄 Estoque'],['diagnostico','🔍 Diagnóstico'],['epis','🦺 EPIs'],
      ['uniformes','👕 Uniformes'],['ferramentas','🔧 Ferramentas'],['locacoes','🏗 Locações'],
      ['filiais','🏢 Filiais'],['vales','📄 Vales'],['sap-obra','🏭 SAP']
    ];
    return '<div class="card" style="margin-bottom:.75rem"><div class="ch" style="flex-wrap:wrap;gap:6px">'
      +'<span class="ct">🏭 Almoxarifado CENA</span>'
      +'<div style="display:flex;gap:4px;flex-wrap:wrap;margin-left:auto">'
      +tabs.map(function(t){
        return '<button class="btn btn-sm" id="alm-tab-'+t[0]+'" onclick="_almShowAba(\''+t[0]+'\')">'+t[1]+'</button>';
      }).join('')
      +'</div></div></div><div id="alm-conteudo"></div>';
  }

  function htmlEntradas(){
    return hdr('📥 Entradas no almoxarifado')
      +'<div id="alm-entr-metricas" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-bottom:1rem"></div>'
      +'<div id="alm-entr-cards" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;margin-bottom:1rem"></div>'
      +'<div class="card"><div class="ch"><span class="ct">Entradas recentes</span></div>'
      +tbl('alm-entr-recentes',['Data','Item','Tipo','Qtd','Origem'])+'</div>';
  }
  function htmlAlm(){
    return hdr('📦 Movimentações','<span id="alm-titulo" style="font-size:12px;color:#888"></span>')
      +'<div id="alm-metricas" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-bottom:.75rem"></div>'
      +'<div class="card" style="padding:.75rem;margin-bottom:.75rem;display:flex;gap:6px;flex-wrap:wrap;align-items:center">'
      +'<select class="inp" id="alm-fil-filial" style="width:160px" onchange="if(typeof atualizarDepositos===\'function\')atualizarDepositos();if(typeof aplicarFiltroAlm===\'function\')aplicarFiltroAlm()"><option value="">Todas as filiais</option></select>'
      +'<select class="inp" id="alm-fil-dep" style="width:160px" onchange="if(typeof aplicarFiltroAlm===\'function\')aplicarFiltroAlm()"><option value="">Todos os depósitos</option></select>'
      +'<input class="inp" id="alm-fil-q" placeholder="Item / código" style="width:180px" oninput="if(typeof aplicarFiltroAlm===\'function\')aplicarFiltroAlm()">'
      +'<input type="hidden" id="alm-fil-item-id">'
      +'<div id="alm-fil-sug" style="display:none"></div>'
      +'<input class="inp" id="alm-fil-ini" type="date" onchange="if(typeof aplicarFiltroAlm===\'function\')aplicarFiltroAlm()">'
      +'<input class="inp" id="alm-fil-fim" type="date" onchange="if(typeof aplicarFiltroAlm===\'function\')aplicarFiltroAlm()">'
      +'</div>'
      +'<div id="alm-timeline-info" style="display:none;font-size:12px;color:#555;margin-bottom:.5rem"></div>'
      +'<div id="alm-posse-wrap"></div>'
      +'<div class="card">'+tbl('tbody-alm-mov',['Data','Saldo ant.','Entradas','Saídas','Entregas','Devoluções','Saldo'])+'</div>'
      +'<div id="alm-det"></div>';
  }
  function htmlItens(){
    return hdr('🗂 Catálogo de itens','<button class="btn btn-pri" onclick="if(typeof openCadastroItem===\'function\')openCadastroItem()">+ Novo item</button>')
      +'<div class="card"><div class="ch" style="flex-wrap:wrap;gap:6px"><span class="ct">Itens</span>'
      +'<select class="inp" id="itens-fil-tipo" style="width:140px" onchange="if(typeof renderItens===\'function\')renderItens()"><option value="">Todos os tipos</option></select>'
      +'<input class="inp" id="itens-fil-busca" placeholder="Nome / código" style="width:180px" oninput="if(typeof renderItens===\'function\')renderItens()">'
      +'<select class="inp" id="itens-fil-status" style="width:120px" onchange="if(typeof renderItens===\'function\')renderItens()"><option value="">Todos</option><option value="ativo">Ativos</option><option value="inativo">Inativos</option></select>'
      +'</div>'+tbl('tbody-itens',['Código','SKU','Nome','Tipo','Un.','Série','CA','Validade','Calib.','Devol.','Status',''])+'</div>';
  }
  function htmlEstoque(){
    return hdr('🗄 Estoque')
      +'<div class="card"><div class="ch" style="flex-wrap:wrap;gap:6px"><span class="ct">Saldos</span>'
      +'<select class="inp" id="est-fil-filial" style="width:150px" onchange="if(typeof renderEstoque===\'function\')renderEstoque()"><option value="">Todas as filiais</option></select>'
      +'<select class="inp" id="est-fil-deposito" style="width:150px" onchange="if(typeof renderEstoque===\'function\')renderEstoque()"><option value="">Todos os depósitos</option></select>'
      +'<select class="inp" id="est-fil-tipo" style="width:140px" onchange="if(typeof renderEstoque===\'function\')renderEstoque()"><option value="">Todos os tipos</option></select>'
      +'<select class="inp" id="est-fil-status" style="width:130px" onchange="if(typeof renderEstoque===\'function\')renderEstoque()"><option value="">Todos</option></select>'
      +'<input class="inp" id="est-fil-busca" placeholder="Buscar" style="width:160px" oninput="if(typeof renderEstoque===\'function\')renderEstoque()">'
      +'<input class="inp" id="est-fil-ini" type="date"><input class="inp" id="est-fil-fim" type="date">'
      +'</div>'+tbl('tbody-est',['Item','Tipo','Depósito','Saldo','Mín.','Status',''])+'</div>';
  }
  function htmlDiag(){
    return hdr('🔍 Diagnóstico de Estoque','<button class="btn btn-pri" onclick="if(typeof almRodarDiagnosticoEstoque===\'function\')almRodarDiagnosticoEstoque();else if(typeof almInitDiagnosticoEstoque===\'function\')almInitDiagnosticoEstoque()">Analisar</button>')
      +'<div id="diag-vazio" class="card" style="padding:2rem;text-align:center;color:#888">Clique em Analisar para comparar saldo físico × movimentações.</div>'
      +'<div id="diag-resumo" style="display:none"></div>'
      +'<div id="diag-filtros" style="display:none"></div>'
      +'<div id="diag-tabela-wrap" style="display:none"></div>'
      +'<button class="btn" id="diag-btn-csv" disabled>CSV</button> '
      +'<button class="btn" id="diag-btn-copiar" disabled>Copiar</button>';
  }
  function htmlEpis(){
    return hdr('🦺 EPIs / EPCs')
      +'<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:.75rem">'
      +['entregar','lista','ficha','cad','fichas','caepi'].map(function(x,i){
        var lbl=['Entregar colaborador','Lista','Ficha NR-6','Cadastro','Fichas assinadas','Consulta CA'][i];
        return '<button class="btn btn-sm" id="epiv-btn-'+x+'" onclick="if(typeof epiTabView===\'function\')epiTabView(\''+x+'\')">'+lbl+'</button>';
      }).join('')+'</div>'
      +'<div id="epi-view-entregar"><div id="alm-req-fila-entrega"></div><div id="epi-entrega-box"></div></div>'
      +'<div id="epi-view-lista" style="display:none" class="card">'
      +'<div class="ch"><input class="inp" id="fil-epi-q" placeholder="Buscar" style="width:180px" oninput="if(typeof renderEpis===\'function\')renderEpis()">'
      +'<select class="inp" id="fil-epi-tipo" style="width:120px" onchange="if(typeof renderEpis===\'function\')renderEpis()"><option value="">Todos</option><option>EPI</option><option>EPC</option></select></div>'
      +tbl('tbody-epis',['Item','Tipo','CA','Validade','Responsável','Contrato','Status',''])+'</div>'
      +'<div id="epi-view-ficha" style="display:none"></div>'
      +'<div id="epi-view-cad" style="display:none"></div>'
      +'<div id="epi-view-fichas" style="display:none"></div>'
      +'<div id="epi-view-caepi" style="display:none"></div>';
  }
  function htmlUniformes(){
    return hdr('👕 Uniformes')
      +'<div class="tabs2" style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:.75rem">'
      +[['entregues','Entregues'],['catalogo','Catálogo'],['estoque-uni','Estoque'],['caepi','CA'],['lavagem','Lavagem']].map(function(t){
        return '<button class="tab2 btn btn-sm" onclick="if(typeof uniTab===\'function\')uniTab(\''+t[0]+'\')">'+t[1]+'</button>';
      }).join('')+'</div>'
      +'<div id="uni-entregues"><div class="card"><div class="ch"><select class="inp" id="fil-uni-func" style="width:220px" onchange="if(typeof renderUniformesEntregues===\'function\')renderUniformesEntregues()"><option value="">Todos</option></select></div>'
      +tbl('tbody-uni-ent',['Colaborador','Peça','Qtd','CA','Validade','Status'])+'</div></div>'
      +'<div id="uni-catalogo" class="hidden"><div class="card">'+tbl('tbody-cat',['Código','SKU','Tipo','Modelo','Cor','Tam.'])+'</div></div>'
      +'<div id="uni-estoque-uni" class="hidden"><div class="card">'+tbl('tbody-est-uni',['Código','SKU','Tipo','Modelo','Tam.','Novo','Hig.','Rep.','Total'])+'</div></div>'
      +'<div id="uni-caepi" class="hidden"><div id="uni-view-caepi"></div></div>'
      +'<div id="uni-lavagem" class="hidden">'
      +'<div class="tabs2-lav" style="display:flex;gap:6px;margin-bottom:.5rem">'
      +'<button class="tab2 btn btn-sm on" onclick="if(typeof lavTab===\'function\')lavTab(\'andamento\')">Em andamento</button>'
      +'<button class="tab2 btn btn-sm" onclick="if(typeof lavTab===\'function\')lavTab(\'historico\')">Histórico</button></div>'
      +'<div id="lav-andamento"><div class="card">'+tbl('tbody-lav-and',['Colaborador','Peça','Qtd','Tipo','Prestador','Saída','Previsão','Status',''])+'</div></div>'
      +'<div id="lav-historico" class="hidden"><div class="card">'+tbl('tbody-lav-hist',['Colaborador','Peça','Tipo','Status','Datas'])+'</div></div>'
      +'</div>';
  }
  function htmlFer(){
    return hdr('🔧 Ferramentas','<button class="btn btn-pri" onclick="if(typeof openCadastroItem===\'function\')openCadastroItem(\'ferramenta\')">+ Ferramenta</button>')
      +'<div class="card"><div class="ch"><input class="inp" id="fil-fer-q" placeholder="Buscar" style="width:180px" oninput="if(typeof renderFer===\'function\')renderFer()">'
      +'<select class="inp" id="fil-fer-status" style="width:150px" onchange="if(typeof renderFer===\'function\')renderFer()"><option value="">Todos</option></select></div>'
      +tbl('tbody-fer',['Código','Nome','Disponível','Em uso','Manutenção',''])+'</div>';
  }
  function htmlLoc(){
    return hdr('🏗 Locações')
      +'<div id="loc-tabs" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:.75rem">'
      +'<button class="btn btn-sm" id="loc-tab-lista" onclick="if(typeof locShowTab===\'function\')locShowTab(\'lista\')">📋 Lista</button>'
      +'<button class="btn btn-sm" id="loc-tab-relatorio" onclick="if(typeof locShowTab===\'function\')locShowTab(\'relatorio\')">📊 Relatórios</button>'
      +'</div>'
      +'<div id="loc-view-lista">'
      +'<div id="loc-metricas" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin-bottom:.75rem">'
      +'<div class="card" style="padding:.6rem;text-align:center"><div style="font-size:11px;color:#888">Total</div><div id="loc-total" style="font-size:20px;font-weight:700">0</div></div>'
      +'<div class="card" style="padding:.6rem;text-align:center"><div style="font-size:11px;color:#888">Em uso</div><div id="loc-uso" style="font-size:20px;font-weight:700">0</div></div>'
      +'<div class="card" style="padding:.6rem;text-align:center"><div style="font-size:11px;color:#888">Manutenção</div><div id="loc-manut" style="font-size:20px;font-weight:700">0</div></div>'
      +'<div class="card" style="padding:.6rem;text-align:center"><div style="font-size:11px;color:#888">A vencer</div><div id="loc-venc" style="font-size:20px;font-weight:700">0</div></div>'
      +'<div class="card" style="padding:.6rem;text-align:center"><div style="font-size:11px;color:#888">Custo</div><div id="loc-custo" style="font-size:14px;font-weight:700">R$ 0</div></div></div>'
      +'<div class="card" style="padding:.75rem;margin-bottom:.75rem;display:flex;gap:6px;flex-wrap:wrap">'
      +'<select class="inp" id="fil-loc-fornecedor" style="width:160px" onchange="if(typeof renderLocacoes===\'function\')renderLocacoes()"><option value="">Fornecedor</option></select>'
      +'<select class="inp" id="fil-loc-resp" style="width:160px" onchange="if(typeof renderLocacoes===\'function\')renderLocacoes()"><option value="">Responsável</option></select>'
      +'<select class="inp" id="fil-loc-contrato" style="width:160px" onchange="if(typeof renderLocacoes===\'function\')renderLocacoes()"><option value="">Contrato</option></select>'
      +'<select class="inp" id="fil-loc-status" style="width:140px" onchange="if(typeof renderLocacoes===\'function\')renderLocacoes()"><option value="">Status</option></select>'
      +'<input class="inp" id="fil-loc-q" placeholder="Equipamento" style="width:160px" oninput="if(typeof renderLocacoes===\'function\')renderLocacoes()">'
      +'<label style="font-size:11px"><input type="checkbox" id="fil-loc-resumo-todos" onchange="if(typeof renderLocacoes===\'function\')renderLocacoes()"> Resumo todos</label>'
      +'<label style="font-size:11px"><input type="checkbox" id="fil-loc-resumo-empresa" onchange="if(typeof renderLocacoes===\'function\')renderLocacoes()"> Por empresa</label>'
      +'</div><div id="loc-lista-cards"></div></div>'
      +'<div id="loc-view-relatorio" class="hidden"><div id="loc-rel-builder"></div><div id="loc-rel-resultado"></div></div>';
  }
  function htmlFiliais(){
    return hdr('🏢 Filiais / Depósitos','<button class="btn btn-pri" onclick="if(typeof openFilial===\'function\')openFilial();else if(typeof openCadastro===\'function\')openCadastro(\'filiais\')">+ Filial</button>')
      +'<div class="card" id="filiais-wrap">'+tbl('tbody-filiais',['Código','Nome','Cidade','Status',''])+'</div>';
  }
  function htmlVales(){
    return hdr('📄 Vales / Relatórios')
      +'<div class="card" id="vales-wrap">'+tbl('tbody-vales',['Número','Colaborador','Item','Tipo','Valor','Status','Data'])+'</div>';
  }
  function htmlDesmob(){
    return hdr('📤 Desmobilização','<button class="btn" id="desmob-btn-voltar" style="display:none" onclick="if(typeof desmobVoltarHub===\'function\')desmobVoltarHub()">◀ Voltar</button>')
      +'<div style="font-size:16px;font-weight:700;margin-bottom:1rem" id="desmob-titulo">📤 Desmobilização</div>'
      +'<div id="desmob-hub" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px">'
      +'<button class="card" style="padding:1.2rem;text-align:left;cursor:pointer" onclick="if(typeof desmobShowColaborador===\'function\')desmobShowColaborador()"><div style="font-size:22px">👤</div><div style="font-weight:700;margin-top:6px">Colaborador</div><div style="font-size:12px;color:#888">Receber itens em poder</div></button>'
      +'<button class="card" style="padding:1.2rem;text-align:left;cursor:pointer" onclick="if(typeof desmobShowVeiculo===\'function\')desmobShowVeiculo()"><div style="font-size:22px">🚗</div><div style="font-weight:700;margin-top:6px">Veículo</div><div style="font-size:12px;color:#888">Kit / carga do veículo</div></button>'
      +'<button class="card" style="padding:1.2rem;text-align:left;cursor:pointer" onclick="if(typeof desmobShowEquipe===\'function\')desmobShowEquipe()"><div style="font-size:22px">👥</div><div style="font-weight:700;margin-top:6px">Equipe</div><div style="font-size:12px;color:#888">Desmobilizar equipe</div></button>'
      +'</div>'
      +'<div id="desmob-painel-colaborador" class="hidden">'
      +'<input class="inp" id="desmob-busca" placeholder="Nome ou RE" style="width:280px" oninput="if(typeof desmobBuscarInput===\'function\')desmobBuscarInput()">'
      +'<div id="desmob-sugestoes" style="display:none;background:#fff;border:.5px solid #e0dfd8;border-radius:8px;margin-top:4px;padding:6px"></div>'
      +'<div id="desmob-vazio" style="padding:1.5rem;color:#888">Selecione o colaborador.</div>'
      +'<div id="desmob-conteudo"></div></div>'
      +'<div id="desmob-painel-veiculo" class="hidden"><div class="card" style="padding:1.5rem;color:#888">Informe a placa no fluxo de desmobilização de veículo.</div></div>'
      +'<div id="desmob-painel-equipe" class="hidden"><div class="card" style="padding:1.5rem;color:#888">Selecione a equipe no fluxo de desmobilização.</div></div>';
  }
  function htmlExtrato(){
    return hdr('📋 Extrato do Colaborador','<button class="btn" id="extrato-voltar-btn" onclick="if(window._extratoContext===\'almox\')showMain(\'almoxarifado\');else showMain(\'sesmt\')">◀ Voltar</button>')
      +'<input class="inp" id="extrato-busca" placeholder="Nome ou RE" style="width:280px" oninput="if(typeof extratoBuscarInput===\'function\')extratoBuscarInput()">'
      +'<div id="extrato-sugestoes" style="display:none;background:#fff;border:.5px solid #e0dfd8;border-radius:8px;margin-top:4px;padding:6px"></div>'
      +'<div id="extrato-vazio" style="padding:1.5rem;color:#888">Busque um colaborador para ver o extrato.</div>'
      +'<div id="extrato-aviso" style="display:none;color:#B85C00;font-size:12px;margin:.5rem 0"></div>'
      +'<div id="extrato-cabecalho" style="display:none"></div>'
      +'<div id="extrato-resumo" style="display:none"></div>'
      +'<div id="extrato-abas" style="display:none"></div>'
      +'<div id="extrato-conteudo"></div>';
  }
  function htmlSdb(){
    return hdr('📊 Dashboard SESMT')
      +'<div class="card" style="padding:.75rem;margin-bottom:.75rem;display:flex;gap:8px;flex-wrap:wrap">'
      +'<select class="inp" id="sdb-fil-cont" style="min-width:200px" onchange="if(typeof renderSesmtDashboard===\'function\')renderSesmtDashboard()"><option value="">Todos os contratos</option></select>'
      +'<select class="inp" id="sdb-fil-periodo" style="width:140px" onchange="if(typeof renderSesmtDashboard===\'function\')renderSesmtDashboard()">'
      +'<option value="30">30 dias</option><option value="90" selected>90 dias</option><option value="180">180 dias</option></select></div>'
      +'<div id="sdb-alertas"></div><div id="sdb-score"></div><div id="sdb-gerais"></div>'
      +'<div id="sdb-trein"></div><div id="sdb-docs"></div><div id="sdb-epi"></div>'
      +'<div id="sdb-veic"></div><div id="sdb-seg"></div><div id="sdb-ocorr"></div>'
      +'<div id="sdb-por-nr"></div>'
      +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div id="sdb-rank-top"></div><div id="sdb-rank-pend"></div></div>';
  }

  window.sesmtAlmGarantirPaginas=function(){
    var hub=page('pg-alm-dashboard', hubHtml());
    var cont=document.getElementById('alm-conteudo');
    if(!cont){
      cont=document.createElement('div');
      cont.id='alm-conteudo';
      hub.appendChild(cont);
    }
    page('pg-sesmt-entradas', htmlEntradas(), cont);
    page('pg-sesmt-alm', htmlAlm(), cont);
    page('pg-sesmt-itens', htmlItens(), cont);
    page('pg-sesmt-estoque', htmlEstoque(), cont);
    page('pg-sesmt-diagnostico', htmlDiag(), cont);
    page('pg-sesmt-epis', htmlEpis(), cont);
    page('pg-sesmt-uniformes', htmlUniformes(), cont);
    page('pg-sesmt-lavagem', '<div style="padding:1rem;color:#888">A lavagem abre dentro de Uniformes.</div>', cont);
    page('pg-sesmt-ferramentas', htmlFer(), cont);
    page('pg-sesmt-locacoes', htmlLoc(), cont);
    page('pg-sesmt-filiais', htmlFiliais(), cont);
    page('pg-sesmt-vales', htmlVales(), cont);
    page('pg-sesmt-sap-obra', '<div id="sap-obra-wrap" style="padding:.75rem;color:#888">O módulo SAP abre em pg-obras-sap.</div>', cont);
    page('pg-sesmt-ficha-epi', '<div id="ficha-epi-wrap"></div>', cont);
    page('pg-sesmt-kanban-campo', '', cont);
    page('pg-sesmt-vistoria-inicial', '', cont);
    page('pg-sesmt-kits-veiculo', '', cont);

    if(typeof almReqGarantirPagina==='function') almReqGarantirPagina();
    else page('pg-alm-requisicao', '<div id="alm-req-wrap"></div>');

    page('pg-alm-desmobilizacao', htmlDesmob());
    page('pg-sesmt-extrato-colaborador', htmlExtrato());
    page('pg-sesmt-dashboard', htmlSdb());
    page('pg-sesmt-mobilizacao', hdr('🚀 Mobilização nos Contratos')
      +'<div class="card" style="padding:.75rem;margin-bottom:.75rem;display:flex;gap:6px;flex-wrap:wrap">'
      +'<select class="inp" id="mob-fil-contrato" style="width:200px" onchange="if(typeof renderMobilizacao===\'function\')renderMobilizacao()"><option value="">Todos os contratos</option></select>'
      +'<select class="inp" id="mob-fil-status" style="width:160px" onchange="if(typeof renderMobilizacao===\'function\')renderMobilizacao()"><option value="">Todos os status</option><option>Apto</option><option>Em mobilização</option><option>Pendente</option><option>Bloqueado</option></select>'
      +'<input class="inp" id="mob-fil-busca" placeholder="Nome / RE" style="width:180px" oninput="if(typeof renderMobilizacao===\'function\')renderMobilizacao()"></div>'
      +'<div id="mob-metricas" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-bottom:.75rem"></div>'
      +'<div id="mob-lista"></div>');
    page('pg-sesmt-evolucao', hdr('📈 Evolução do Colaborador')
      +'<div class="card" style="padding:.75rem;margin-bottom:.75rem;display:flex;gap:6px;flex-wrap:wrap">'
      +'<select class="inp" id="evol-fil-contrato" style="width:200px" onchange="if(typeof evolOnFiltroChange===\'function\')evolOnFiltroChange()"><option value="">Todos os contratos (só com busca)</option></select>'
      +'<input class="inp" id="evol-fil-busca" placeholder="Nome ou RE" style="width:200px" oninput="if(typeof evolOnFiltroChange===\'function\')evolOnFiltroChange()">'
      +'<select class="inp" id="evol-fil-situacao" style="width:140px" onchange="if(typeof evolOnFiltroChange===\'function\')evolOnFiltroChange()"><option value="ativo">Ativos</option><option value="inativo">Inativos</option><option value="">Todos</option></select></div>'
      +'<div id="evol-lista"></div>');
    page('pg-sesmt-aptidao', hdr('✅ Aptidão ao Trabalho')
      +'<div class="card" style="padding:.75rem;margin-bottom:.75rem;display:flex;gap:6px;flex-wrap:wrap">'
      +'<select class="inp" id="apt-fil-contrato" style="width:200px" onchange="if(typeof renderAptidao===\'function\')renderAptidao()"><option value="">Todos os contratos</option></select>'
      +'<select class="inp" id="apt-fil-status" style="width:150px" onchange="if(typeof renderAptidao===\'function\')renderAptidao()"><option value="">Todos</option></select>'
      +'<input class="inp" id="apt-fil-busca" placeholder="Nome / RE" style="width:180px" oninput="if(typeof renderAptidao===\'function\')renderAptidao()"></div>'
      +'<div id="apt-lista"></div>');
    page('pg-sesmt-treinamentos', hdr('🎓 Treinamentos / NRs','<button class="btn btn-pri" onclick="if(typeof openTreinamento===\'function\')openTreinamento()">+ Treinamento</button>')
      +'<div class="card"><div class="ch"><span class="ct">Treinamentos</span></div>'+tbl('tbody-trein',['Colaborador','NR / Curso','Validade','Status',''])+'</div>');
    page('pg-sesmt-turmas', hdr('👥 Turmas de Treinamento','<button class="btn btn-pri" onclick="if(typeof openTurmaModal===\'function\')openTurmaModal()">+ Turma</button>')
      +'<div id="turmas-container"></div>');
    page('pg-sesmt-nr6', hdr('📋 Ficha NR-6')
      +'<select class="inp" id="nr6-func" style="min-width:260px;margin-bottom:1rem" onchange="if(typeof renderNR6===\'function\')renderNR6()"><option value="">Selecione o colaborador</option></select>'
      +'<div id="nr6-conteudo"></div>');
    page('pg-sesmt-ocorrencias', hdr('⚠️ Ocorrências / Incidentes','<button class="btn btn-pri" onclick="if(typeof openOcorrencia===\'function\')openOcorrencia()">+ Ocorrência</button>')
      +'<div class="card">'+tbl('tbody-oc',['Data','Colaborador','Item','Tipo','Motivo','Status',''])+'</div>');
    page('pg-sesmt-aprovacoes', hdr('✅ Aprovações')+'<div id="m-aprov" style="display:none"></div><div id="aprovacoes-list"></div>');
    page('pg-sesmt-inspecoes', hdr('🔍 Inspeções')+'<div id="insp-wrap"></div>');

    ['dashboard','inspecoes','nc','pa','cdi','rem','checklist'].forEach(function(a){
      page('pg-enel-'+a, hdr('⚡ ENEL — '+a)+'<div id="enel-'+a+'-wrap" class="card" style="padding:1.5rem;color:#888">Módulo ENEL: tela '+a+'.</div>');
      page('pg-comgas-'+a, hdr('🔥 COMGÁS — '+a)+'<div id="comgas-'+a+'-wrap" class="card" style="padding:1.5rem;color:#888">Módulo COMGÁS: tela '+a+'.</div>');
    });
    if(window._ALM_HUB_CHILD_PG_IDS){
      ['pg-sesmt-vales','pg-sesmt-sap-obra'].forEach(function(id){
        if(window._ALM_HUB_CHILD_PG_IDS.indexOf(id)<0) window._ALM_HUB_CHILD_PG_IDS.push(id);
      });
    }
    return hub;
  };

  window.sesmtShowTab=window.sesmtShowTab||function(aba){
    if(typeof sesmtAlmGarantirPaginas==='function') sesmtAlmGarantirPaginas();
    var hubAbas=['entradas','alm','itens','epis','uniformes','lavagem','ferramentas','locacoes','estoque','diagnostico','vales','filiais','ficha-epi','sap-obra','kanban-campo','kits-veiculo'];
    if(hubAbas.indexOf(aba)>=0 && typeof _almShowAba==='function'){ _almShowAba(aba); return; }
    if(typeof ocultarPaginasSESMTAlmoxarifado==='function') ocultarPaginasSESMTAlmoxarifado();
    var pg=document.getElementById('pg-sesmt-'+aba);
    if(pg){ pg.classList.remove('hidden'); pg.style.display=''; }
    if(aba==='treinamentos' && typeof renderTreinamentos==='function') renderTreinamentos();
    else if(aba==='nr6' && typeof renderNR6==='function') renderNR6();
    else if(aba==='ocorrencias' && typeof renderOc==='function') renderOc();
    else if(aba==='aprovacoes' && typeof renderAprovacoes==='function') renderAprovacoes();
    else if(aba==='dashboard' && typeof renderSesmtDashboard==='function') renderSesmtDashboard();
    else if(aba==='turmas' && typeof renderTurmas==='function') renderTurmas();
    else if(aba==='mobilizacao' && typeof renderMobilizacao==='function') renderMobilizacao();
    else if(aba==='evolucao' && typeof renderSesmtEvolucao==='function') renderSesmtEvolucao();
    else if(aba==='aptidao' && typeof renderSesmtAptidao==='function') renderSesmtAptidao();
    else if(aba==='extrato-colaborador' && typeof extratoInit==='function') extratoInit();
    else if(aba==='inspecoes' && typeof renderInspecoesEnel==='function') renderInspecoesEnel();
  };

  window.comgasShowTab=window.comgasShowTab||function(aba){
    if(typeof sesmtAlmGarantirPaginas==='function') sesmtAlmGarantirPaginas();
    if(typeof ocultarPaginasSESMTAlmoxarifado==='function') ocultarPaginasSESMTAlmoxarifado();
    var pg=document.getElementById('pg-comgas-'+(aba||'dashboard'));
    if(pg){ pg.classList.remove('hidden'); pg.style.display=''; }
  };
  window.enelShowTab=window.enelShowTab||function(aba){
    if(typeof sesmtAlmGarantirPaginas==='function') sesmtAlmGarantirPaginas();
    if(typeof ocultarPaginasSESMTAlmoxarifado==='function') ocultarPaginasSESMTAlmoxarifado();
    var pg=document.getElementById('pg-enel-'+(aba||'dashboard'));
    if(pg){ pg.classList.remove('hidden'); pg.style.display=''; }
  };

  window.renderFiliais=window.renderFiliais||function(){
    var tb=document.getElementById('tbody-filiais'); if(!tb) return;
    var lista=window.filiais||[];
    tb.innerHTML=lista.length?lista.map(function(f){
      return '<tr><td>'+(f.codigo||'—')+'</td><td>'+(f.nome||'—')+'</td><td>'+(f.cidade||'—')+'</td><td>'+(f.ativa===false?'Inativa':'Ativa')+'</td><td></td></tr>';
    }).join():'<tr><td colspan="5" style="padding:1.5rem;text-align:center;color:#aaa">Nenhuma filial carregada.</td></tr>';
  };
  window.renderVales=window.renderVales||function(){
    var tb=document.getElementById('tbody-vales'); if(!tb) return;
    var lista=window.vales||[];
    tb.innerHTML=lista.length?lista.map(function(v){
      return '<tr><td>'+(v.numero||'—')+'</td><td>'+(v.funcionario_id||'—')+'</td><td>'+(v.item||'—')+'</td><td>'+(v.tipo||'—')+'</td><td>'+(v.valor||0)+'</td><td>'+(v.status||'—')+'</td><td>'+(v.data_emissao||'—')+'</td></tr>';
    }).join():'<tr><td colspan="7" style="padding:1.5rem;text-align:center;color:#aaa">Nenhum vale.</td></tr>';
  };

  window._almShowAbaInterna = window._almShowAbaInterna || function(aba){
    try{ sesmtAlmGarantirPaginas(); }catch(e){}
    var pg=document.getElementById(aba==='ficha-epi'?'pg-sesmt-ficha-epi':('pg-sesmt-'+aba));
    if(pg){ pg.classList.remove('hidden'); pg.style.display=''; }
    var hub=document.getElementById('pg-alm-dashboard');
    if(hub){ hub.classList.remove('hidden'); hub.style.display=''; }
  };
  window._almShowAba = window._almShowAba || function(aba){
    if(aba==='lavagem') aba='uniformes';
    if(aba==='vistoria-inicial') aba='kanban-campo';
    try{ sesmtAlmGarantirPaginas(); }catch(e){}
    var hub=document.getElementById('pg-alm-dashboard');
    if(hub){ hub.classList.remove('hidden'); hub.style.display=''; }
    if(typeof window._almShowAbaInterna==='function') window._almShowAbaInterna(aba);
  };

  function boot(){
    try{ sesmtAlmGarantirPaginas(); }catch(e){ console.warn('sesmtAlmGarantirPaginas', e); }
    if(typeof window._almShowAba==='function' && !window._almShowAba._cenaWrapped){
      var prev=window._almShowAba;
      window._almShowAba=function(aba){
        try{ sesmtAlmGarantirPaginas(); }catch(e){}
        return prev.apply(this, arguments);
      };
      window._almShowAba._cenaWrapped=true;
    }
    if(typeof window.showPage==='function' && !window.showPage._cenaWrapped){
      var prevSp=window.showPage;
      window.showPage=function(pageId){
        if(pageId && /^(sesmt-|alm-|enel-|comgas)/.test(pageId)){
          try{ sesmtAlmGarantirPaginas(); }catch(e){}
        }
        return prevSp.apply(this, arguments);
      };
      window.showPage._cenaWrapped=true;
    }
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
