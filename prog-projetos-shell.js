/* CENA — casco da Programação de Equipes / Projetos (8.1.113)
   O clique em #sn-programacao-projetos chama showPage → progProjInit,
   mas #pg-programacao-projetos não existia no HTML. */
(function(){
  function aca(){ return document.getElementById('app-content-area')||document.body; }

  function htmlPagina(){
    var tab='padding:.5rem 1.2rem;border:none;border-bottom:2.5px solid transparent;background:none;font-size:13px;font-weight:600;cursor:pointer;color:#888';
    var tabOn='padding:.5rem 1.2rem;border:none;border-bottom:2.5px solid #1a1a18;background:none;font-size:13px;font-weight:700;cursor:pointer;color:#1a1a18';
    return ''
      +'<div style="display:flex;gap:0;border-bottom:1.5px solid #e0dfd8;margin-bottom:1rem">'
      +'<button id="pp-tab-programacao" onclick="ppSetAba(\'programacao\')" style="'+tabOn+'">🗂 Programação</button>'
      +'<button id="pp-tab-dashboard" onclick="ppSetAba(\'dashboard\')" style="'+tab+'">📊 Dashboard</button>'
      +'<button id="pp-tab-requisicoes" onclick="ppSetAba(\'requisicoes\')" style="'+tab+'">📥 Requisições</button>'
      +'<button id="pp-tab-obras" onclick="ppSetAba(\'obras\')" style="'+tab+'">🔨 Obras</button>'
      +'</div>'
      +'<div id="pp-mobile-view" style="display:none"></div>'
      +'<div id="pp-painel-programacao">'
      +'<div class="card" style="margin-bottom:1rem;background:#fff;box-shadow:0 2px 8px #0002">'
      +'<div class="ch" style="flex-wrap:nowrap;gap:6px;align-items:center;overflow-x:auto">'
      +'<span class="ct" style="white-space:nowrap;flex-shrink:0">🗂 Programação de Equipes</span>'
      +'<div style="display:flex;align-items:center;gap:2px;flex-shrink:0">'
      +'<button class="btn" onclick="ppNavData(-7)" title="Semana anterior" style="padding:3px 6px;font-size:12px">◀◀</button>'
      +'<button class="btn" onclick="ppNavData(-1)" title="Dia anterior" style="padding:3px 6px;font-size:12px">◀</button>'
      +'<input type="date" class="inp" id="pp-data" style="width:130px;font-size:12px" onchange="if(window._pp)_pp.data=this.value;if(typeof progProjCarregarStatus===\'function\')progProjCarregarStatus(this.value);if(typeof progProjCarregarStatusBanco===\'function\')progProjCarregarStatusBanco(this.value,function(){if(typeof progProjRenderQuadro===\'function\')progProjRenderQuadro();});else if(typeof progProjRenderQuadro===\'function\')progProjRenderQuadro();"/>'
      +'<button class="btn" onclick="ppNavData(1)" title="Próximo dia" style="padding:3px 6px;font-size:12px">▶</button>'
      +'<button class="btn" onclick="ppNavData(7)" title="Próxima semana" style="padding:3px 6px;font-size:12px">▶▶</button>'
      +'<button class="btn" onclick="ppNavHoje()" style="padding:3px 6px;font-size:11px;color:#185FA5;border-color:#185FA5">Hoje</button>'
      +'</div>'
      +'<select class="inp" id="pp-cont" style="min-width:200px;font-size:12px" onchange="if(typeof progProjMudarContrato===\'function\')progProjMudarContrato()"><option value="">Selecione o contrato...</option></select>'
      +'<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;flex-shrink:0">'
      +'<button class="btn" onclick="if(typeof progProjSelecionarProjetos===\'function\')progProjSelecionarProjetos()" style="font-size:11px;padding:4px 8px">📋 Projetos</button>'
      +'<span id="pp-proj-vazio" style="font-size:11px;color:#888">Nenhum projeto filtrado</span>'
      +'<div id="pp-proj-lista" style="display:flex;gap:4px;flex-wrap:wrap"></div>'
      +'</div>'
      +'<div style="width:.5px;height:24px;background:#e0dfd8;flex-shrink:0"></div>'
      +'<div style="display:flex;align-items:center;gap:4px;flex-shrink:0">'
      +'<button class="btn" id="pp-btn-sync-ponto" onclick="if(typeof ppSyncPonto===\'function\')ppSyncPonto()" style="color:#185FA5;border-color:#185FA5;font-size:11px;padding:4px 8px">🔄 Sync Ponto</button>'
      +'<button class="btn" onclick="if(typeof ppNavScroll===\'function\')ppNavScroll(\'topo\')" style="color:#185FA5;border-color:#185FA5;font-size:11px;padding:4px 8px">🏠 Topo</button>'
      +'<button class="btn" id="pp-btn-mobile" onclick="if(typeof ppMobileToggle===\'function\')ppMobileToggle()" style="color:#533AB7;border-color:#533AB7;font-size:11px;padding:4px 8px">📱 Mobile</button>'
      +'<button class="btn" onclick="progProjAtualizarQuadro()" style="color:#185FA5;border-color:#185FA5;font-size:11px;padding:4px 8px">🔄 Atualizar</button>'
      +'</div></div>'
      +'<div style="padding:.5rem 1rem;display:flex;gap:6px;border-top:.5px solid #f0efe8;flex-wrap:wrap" id="pp-tipos-btns">'
      +'<button class="btn prog-tipo-btn" data-tipo="" onclick="if(typeof progProjFiltrarTipo===\'function\')progProjFiltrarTipo(\'\')" style="font-size:11px;background:#1a1a18;color:#fff">Todos</button>'
      +'</div>'
      +'<div style="padding:.5rem 1rem;display:flex;gap:8px;flex-wrap:wrap;align-items:center;border-top:.5px solid #f0efe8">'
      +'<select id="pp-busca-scope" class="inp" style="width:130px;font-size:12px" onchange="if(typeof progProjFiltrarColab===\'function\')progProjFiltrarColab((document.getElementById(\'pp-busca\')||{}).value||\'\')">'
      +'<option value="todos">🔍 Todos</option>'
      +'<option value="colaborador">👤 Colaborador</option>'
      +'<option value="equipe">🚛 Equipe</option>'
      +'<option value="placa">🚗 Placa</option>'
      +'<option value="status">📋 Status</option>'
      +'</select>'
      +'<input type="text" id="pp-busca" class="inp" placeholder="Colaborador, placa, equipe ou status..." style="width:240px;font-size:12px" oninput="if(typeof progProjFiltrarColab===\'function\')progProjFiltrarColab(this.value)"/>'
      +'<button id="pp-btn-incompletas" class="btn" onclick="if(typeof progProjToggleIncompletas===\'function\')progProjToggleIncompletas()" style="font-size:11px">⚠ Só incompletas</button>'
      +'<label id="pp-lbl-programadas" style="display:inline-flex;align-items:center;gap:5px;font-size:11px;cursor:pointer;padding:4px 8px;border:.5px solid #e0dfd8;border-radius:6px;background:#fff;user-select:none;white-space:nowrap">'
      +'<input type="checkbox" id="pp-chk-programadas" onchange="if(typeof progProjToggleSoProgramadas===\'function\')progProjToggleSoProgramadas(this.checked)" style="accent-color:#3B6D11;margin:0"/>'
      +'✓ Só programadas</label>'
      +'<button class="btn" onclick="if(typeof progProjLimparFiltros===\'function\')progProjLimparFiltros()" style="font-size:11px;color:#888">✕ Limpar filtros</button>'
      +'</div></div>'
      +'<div id="pp-quadro"><div style="padding:3rem;text-align:center;color:#aaa">Selecione um contrato e uma data para ver o quadro.</div></div>'
      +'</div>'
      +'<div id="pp-painel-dashboard" class="hidden" style="display:none"><div id="pp-dash-inner"></div></div>'
      +'<div id="pp-painel-requisicoes" class="hidden" style="display:none"></div>'
      +'<div id="pp-painel-obras" class="hidden" style="display:none"><div id="pp-obras-inner"></div></div>';
  }

  window.progProjGarantirPagina=function(){
    var host=aca();
    var pg=document.getElementById('pg-programacao-projetos');
    if(!pg){
      pg=document.createElement('div');
      pg.id='pg-programacao-projetos';
      pg.className='hidden';
      host.appendChild(pg);
    }
    if(!document.getElementById('pp-quadro') || !document.getElementById('pp-cont') || !document.getElementById('pp-painel-programacao')){
      pg.innerHTML=htmlPagina();
    }
    if(host && pg.parentElement!==host) host.appendChild(pg);
    return pg;
  };

  function boot(){
    try{ progProjGarantirPagina(); }catch(e){ console.warn('progProjGarantirPagina', e); }
    if(typeof window.showPage==='function' && !window.showPage._cenaPpWrapped){
      var prev=window.showPage;
      window.showPage=function(pageId){
        if(pageId==='programacao-projetos'){
          try{ progProjGarantirPagina(); }catch(e){}
        }
        return prev.apply(this, arguments);
      };
      window.showPage._cenaPpWrapped=true;
    }
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
