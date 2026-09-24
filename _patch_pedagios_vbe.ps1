$ErrorActionPreference = 'Stop'
$path = 'C:\DEV\cena-sistema\index.html'
$bytes = [System.IO.File]::ReadAllBytes($path)
$utf8 = New-Object System.Text.UTF8Encoding $false
$t = $utf8.GetString($bytes)
$sizeBefore = $t.Length
$nl = if ($t.Contains("`r`n")) { "`r`n" } else { "`n" }
Write-Host "index.html chars before: $sizeBefore  newline=$(if($nl -eq "`r`n"){'CRLF'}else{'LF'})"

function ReplaceOnce([string]$hay, [string]$old, [string]$new, [string]$label) {
  $i = $hay.IndexOf($old)
  if ($i -lt 0) { throw "ANCHOR NOT FOUND: $label" }
  $j = $hay.IndexOf($old, $i + $old.Length)
  if ($j -ge 0) { throw "ANCHOR NOT UNIQUE: $label" }
  return $hay.Remove($i, $old.Length).Insert($i, $new)
}
function InsertAfter([string]$hay, [string]$anchor, [string]$insert, [string]$label) {
  $i = $hay.IndexOf($anchor)
  if ($i -lt 0) { throw "ANCHOR NOT FOUND: $label" }
  $j = $hay.IndexOf($anchor, $i + $anchor.Length)
  if ($j -ge 0) { throw "ANCHOR NOT UNIQUE: $label" }
  return $hay.Insert($i + $anchor.Length, $insert)
}
function InsertAfterLine([string]$hay, [string]$linePrefix, [string]$insert, [string]$label) {
  $i = $hay.IndexOf($linePrefix)
  if ($i -lt 0) { throw "ANCHOR NOT FOUND: $label" }
  $j = $hay.IndexOf($linePrefix, $i + $linePrefix.Length)
  if ($j -ge 0) { throw "ANCHOR NOT UNIQUE: $label" }
  $nlPos = $hay.IndexOf("`n", $i)
  if ($nlPos -lt 0) { throw "NO NL: $label" }
  return $hay.Insert($nlPos + 1, $insert)
}

# 1) versao
$t = ReplaceOnce $t "numero: '8.1.124'" "numero: '8.1.125'" "APP_VERSAO.numero"
$t = ReplaceOnce $t "build:  '20260923-1935'" "build:  '20260923-2215'" "APP_VERSAO.build"

$t = InsertAfter $t "  log: [`r`n" @"
    {v:'8.1.125', d:'23/09/2026', itens:[
      'Frotas Pedagios: passagens validadas de Frotas > Pedagios alimentam a Viabilidade Economica como custo operacional de frota (categoria Pedagio), sem lancamento financeiro duplicado e sem somar a fatura. Vinculo via frotas_portaria_saidas. Requer SQL sql_frotas_pedagios_1.sql. HOMOLOGACAO.',
    ]},
"@ "changelog 8.1.125"

# 2) scripts ?v=
$t = $t.Replace('portaria-offline.js?v=8.1.124','portaria-offline.js?v=8.1.125')
$t = $t.Replace('sesmt-alm-shell.js?v=8.1.124','sesmt-alm-shell.js?v=8.1.125')
$t = $t.Replace('prog-projetos-shell.js?v=8.1.124','prog-projetos-shell.js?v=8.1.125')
$t = InsertAfter $t '<script src="prog-projetos-shell.js?v=8.1.125"></script>' "`r`n<script src=`"frotas-pedagios.js?v=8.1.125`"></script>" "script frotas-pedagios"

# 3) CSS portaria
$t = InsertAfter $t "body.perfil-portaria #frotas-tab-combustivel,`r`n" "body.perfil-portaria #frotas-tab-pedagios,`r`n" "css pedagios"

# 4) menus (ancoras ASCII — emoji do arquivo nao casa com o encoding do .ps1)
$icoPed = [char]::ConvertFromUtf32(0x1F6E3)
$t = InsertAfterLine $t "{id:'frotas-combustivel',  label:" ("    {id:'frotas-pedagios',     label:'" + $icoPed + " Pedagios'},`r`n") "MENU_SUBS pedagios"
$t = ReplaceOnce $t "'frotas-combustivel','frotas-multas','frotas-avarias'" "'frotas-combustivel','frotas-pedagios','frotas-multas','frotas-avarias'" "ALL_PAGES pedagios"
$t = InsertAfterLine $t "{id:'frotas-combustivel', icon:" ("      {id:'frotas-pedagios',    icon:'" + $icoPed + "', label:'Pedagios'},`r`n") "sidebar pedagios"

# 5) frtInit lista de paginas
$t = ReplaceOnce $t "'frotas-programacao','frotas-manutencoes','frotas-combustivel','frotas-multas'," "'frotas-programacao','frotas-manutencoes','frotas-combustivel','frotas-pedagios','frotas-multas'," "frtInit pages"

# 6) frtInit render
$t = InsertAfter $t @"
    else if(subpage==='frotas-combustivel'){
      frtCombRender();
      if(typeof frtCombCarregarInconsistencias==='function'){
        frtCombCarregarInconsistencias().then(function(){ frtCombRender(); });
      }
    }
"@ @"

    else if(subpage==='frotas-pedagios'){
      if(typeof frtPedInit==='function') frtPedInit();
      else if(typeof frtPedRender==='function') frtPedRender();
    }
"@ "frtInit render pedagios"

$t = InsertAfter $t @"
      if(subpage==='frotas-combustivel'){
        frtCombRender();
        if(typeof frtCombCorrigirContratosAgo2026==='function') frtCombCorrigirContratosAgo2026({auto:true});
      }
"@ @"
      if(subpage==='frotas-pedagios' && typeof frtPedInit==='function') frtPedInit();
"@ "frtInit rerender pedagios"

# 7) carga: frtPedInit / vbeEnsureDadosCustosERP ja chamam frtPedCarregar (nao deslocar Promise.all)

# 8) demo
$t = InsertAfter $t "    origem:'manual'}];`r`n  frt_documentos = [" "`r`n  if(typeof frtPedSeedDemo==='function') frtPedSeedDemo();`r`n  frt_documentos = [" "demo seed pedagios"

# 9) whitelist colunas
$t = InsertAfter $t "    'frotas_multas':['placa','modelo','veiculo_id','motorista','colaborador_id','descricao','data_infracao','valor','vencimento','status'],`r`n" @"
    'frotas_pedagios':['veiculo_id','placa','placa_normalizada','modelo','motorista','colaborador_id','data_hora','valor','praca','rodovia','concessionaria','origem','tipo','status','apropriacao_status','portaria_saida_id','equipe_id','equipe_nome','contrato_id','contrato_nome','projeto_id','projeto_nome','centro_custo','filial_id','base_nome','fatura_id','hash_deduplicacao','motivo_sem_apropriacao','observacao','criado_por','atualizado_por'],
"@ "whitelist frotas_pedagios"

# 10) audit + soft delete
$t = ReplaceOnce $t "  frotas_veiculos:'frotas', frt_manutencoes:'frotas', frt_combustivel:'frotas', frt_documentos:'frotas', frt_multas:'frotas'," "  frotas_veiculos:'frotas', frt_manutencoes:'frotas', frt_combustivel:'frotas', frotas_pedagios:'frotas', frt_documentos:'frotas', frt_multas:'frotas'," "audit mapa pedagios"
$t = ReplaceOnce $t "  'frotas_veiculos','frotas_manutencoes','frotas_documentos'," "  'frotas_veiculos','frotas_manutencoes','frotas_documentos','frotas_pedagios'," "soft delete pedagios"

# 11) VBE mapa legado
$t = ReplaceOnce $t "    combustivel:'combustivel', pedagios:'outros'," "    combustivel:'combustivel', pedagios:'pedagio'," "map pedagios legado"

# 12) grupo + alias
$t = ReplaceOnce $t "    combustivel:1,pedagios:1,locacao_frota:1,manutencao_frota:1," "    combustivel:1,pedagio:1,pedagios:1,locacao_frota:1,manutencao_frota:1," "grupo pedagio alias"

$t = InsertAfter $t "  var cat=String(categoria||'outros');`r`n" "  if(cat==='pedagio') cat='pedagios';`r`n" "alias pedagio->pedagios"

# 13) ensure + coleta
$t = InsertAfter $t "  await vbeEnsureCombustivelCompetencia(ym, d120);`r`n" "  if(typeof frtPedCarregar==='function'){ try{ await frtPedCarregar(ym); }catch(ePed){} }`r`n" "ensure pedagios"

$coleta = @'

  var pedag=0;
  if(typeof frtPedSomarContrato==='function'){
    var _ps=frtPedSomarContrato(cid, ym);
    pedag=Number(_ps&&_ps.valor||0)||0;
  } else {
    (typeof frt_pedagios!=='undefined'?frt_pedagios:[]).forEach(function(p){
      if(!p||p.deleted_at) return;
      if(String(p.tipo||'PASSAGEM').toUpperCase()==='FATURA') return;
      var st=String(p.status||'').toUpperCase();
      if(st!=='VALIDADO'&&st!=='CONCILIADO') return;
      if(String(p.apropriacao_status||'').toUpperCase()!=='APROPRIADO') return;
      if(String(p.contrato_id||'')!==String(cid)) return;
      if(String(p.data_hora||'').slice(0,7)!==ym) return;
      pedag+=Number(p.valor||0)||0;
    });
    pedag=Math.round(pedag*100)/100;
  }
  if(pedag>0){
    pedag=Math.round(pedag*100)/100;
    linhas.push({categoria_custo:'pedagio',valor:pedag,descricao:P+'Pedagios (frota)',fonte_erp:'frt_pedagios',origem:'Calculado',nivel_confianca:'Alta'});
    vbeAdicionarValorNaEstrutura(despesas,'pedagios',pedag,{fonte:'frt_pedagios'});
  }

'@
$t = InsertAfter $t "    vbeAdicionarValorNaEstrutura(despesas,'combustivel',comb,{fonte:'frt_combustivel'});`r`n  }`r`n" $coleta "coleta pedagios VBE"

$t = InsertAfter $t "      ((catNova==='combustivel'||catLeg==='combustivel')&&comb>0)||`r`n" "      ((catNova==='pedagios'||catNova==='pedagio'||catLeg==='pedagio'||catLeg==='pedagios')&&pedag>0)||`r`n" "dedup pedagios"

$t = ReplaceOnce $t "    comb_modulo:comb, manut_modulo:manut, loc_modulo:loc," "    comb_modulo:comb, pedag_modulo:pedag, manut_modulo:manut, loc_modulo:loc," "diagnostico pedag"

$t = ReplaceOnce $t "  if(filtro==='frota') return ['frt_combustivel','frt_manutencoes','frt_veiculos'].indexOf(l.fonte_erp)>=0;" "  if(filtro==='frota') return ['frt_combustivel','frt_manutencoes','frt_veiculos','frt_pedagios'].indexOf(l.fonte_erp)>=0;" "filtro frota pedagios"
$t = InsertAfter $t ">=0?'frt_combustivel':`r`n" "    (c.descricao||'').indexOf('Pedagio')>=0?'frt_pedagios':`r`n" "pseudo fonte pedagios"

# 14) DRE simples
$t = InsertAfter $t "  var combustivel=vbeSomarCombustivelContratoComp(cid, ym);`r`n" @"
  var pedagios=0;
  if(typeof frtPedSomarContrato==='function'){
    var _pd=frtPedSomarContrato(cid, ym);
    pedagios=Number(_pd&&_pd.valor||0)||0;
  }
"@ "dre somar pedagios"

$t = ReplaceOnce $t "  var totalDespesas=Math.round((folhaOp+folhaBo+combustivel+locacoes+demais)*100)/100;" "  var totalDespesas=Math.round((folhaOp+folhaBo+combustivel+pedagios+locacoes+demais)*100)/100;" "dre total +pedagios"

$t = InsertAfter $t "    combustivel:combustivel,`r`n    locacoes:locacoes,`r`n" "    pedagios:pedagios,`r`n" "dre campo pedagios"

$t = InsertAfterLine $t "      locacoes:'Almoxarifado" "      pedagios:'Frotas > Pedagios',`r`n" "dre origem pedagios"

$t = InsertAfter $t "vbeFmtValor(dre.combustivel), o.combustivel)`r`n" "    +row('(-) Pedagios', vbeFmtValor(dre.pedagios), o.pedagios)`r`n" "dre html pedagios"

# 15) resumo custos ERP header
$t = InsertAfter $t "vbeFmtValor(erp.resumo.combustivel)+'</strong></span>'`r`n" "      +'<span>Pedagios: <strong>'+vbeFmtValor(erp.resumo.pedagios!=null?erp.resumo.pedagios:(erp.despesas&&erp.despesas.frota&&erp.despesas.frota.pedagios)||0)+'</strong></span>'`r`n" "custos header pedagios"

$t = ReplaceOnce $t "  var linhas=[], resumo={folha:0,combustivel:0,manutencao_frota:0,locacao:0,lancamentos:0,outros:0,total:0};" "  var linhas=[], resumo={folha:0,combustivel:0,pedagios:0,manutencao_frota:0,locacao:0,lancamentos:0,outros:0,total:0};" "resumo pedagios"

$t = InsertAfter $t "  resumo.combustivel=leg.combustivel;`r`n" "  resumo.pedagios=Number(despesas.frota&&despesas.frota.pedagios||0);`r`n" "resumo.pedagios assign"

# 16) Sem Parar stub — unica fonte
$t = InsertAfter $t "function syncSemPararPedagios(){`r`n" "  if(typeof progShowToast==='function') progShowToast('Sem Parar ainda sem API. Passagens entram so em Frotas > Pedagios.','info');`r`n" "stub sem parar"

# 17) HTML pagina Pedágios
$html = @'

<!-- PEDÁGIOS -->
<div id="pg-frotas-pedagios" class="hidden">
  <div class="card" style="margin-bottom:1rem">
    <div class="ch" style="flex-wrap:wrap;gap:8px">
      <span class="ct">🛣 Pedágios</span>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <input type="month" class="inp" id="frt-ped-mes" style="width:145px" onchange="frtPedInit()"/>
        <label style="font-size:11px;display:flex;align-items:center;gap:4px;white-space:nowrap"><input type="checkbox" id="frt-ped-todos" onchange="frtPedRender()"/> Todos os meses</label>
        <select class="inp" id="frt-ped-cont" style="width:180px" onchange="frtPedRender()">
          <option value="">Todos os contratos</option>
        </select>
        <input class="inp" id="frt-ped-placa" placeholder="Placa ou cole lista (Ctrl+V)" style="width:180px" oninput="frtPedRender();if(typeof frtHintFiltroPlacas==='function')frtHintFiltroPlacas(this)" onpaste="if(typeof frtPasteFiltroPlacas==='function')frtPasteFiltroPlacas(event, frtPedRender)"/>
        <select class="inp" id="frt-ped-status" style="width:170px" onchange="frtPedRender()">
          <option value="">Todos os status</option>
          <option>PENDENTE</option><option>VALIDADO</option><option>CONCILIADO</option>
          <option>CANCELADO</option><option>POSSIVEL_DUPLICIDADE</option><option>DIVERGENTE</option>
        </select>
        <button class="btn btn-pri" onclick="frtPedAbrirNovo()">+ Pedágio</button>
      </div>
    </div>
    <div style="display:flex;gap:0;border-top:.5px solid #f0efe8;padding:0 .75rem">
      <button type="button" id="frt-ped-tab-lista" onclick="frtPedAba('lista')" style="padding:.55rem .9rem;border:none;border-bottom:2px solid #1a1a18;background:none;cursor:pointer;font-size:12px;font-weight:700;color:#1a1a18">Lista</button>
      <button type="button" id="frt-ped-tab-fila" onclick="frtPedAba('fila')" style="padding:.55rem .9rem;border:none;border-bottom:2px solid transparent;background:none;cursor:pointer;font-size:12px;font-weight:600;color:#888">Sem apropriação <span id="frt-ped-fila-badge" style="display:none;min-width:16px;height:16px;border-radius:8px;background:#854F0B;color:#fff;font-size:10px;align-items:center;justify-content:center;padding:0 5px;margin-left:4px"></span></button>
    </div>
    <div id="frt-ped-metricas" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;padding:.75rem;border-top:.5px solid #f0efe8"></div>
    <div style="padding:0 .75rem .65rem;font-size:11px;color:#666">Custo operacional = passagens VALIDADO/CONCILIADO. Fatura é conciliação — não entra de novo na Viabilidade Econômica.</div>
  </div>
  <div id="frt-ped-panel-lista">
  <div style="overflow-x:auto"><table class="tbl tbl-responsive">
    <thead><tr>
      <th>Data/hora</th><th>Placa</th><th>Veículo</th><th>Praça</th><th>Rodovia</th><th>Concessionária</th>
      <th style="text-align:right">Valor</th><th>Equipe</th><th>Contrato</th><th>Projeto</th><th>Status</th><th></th>
    </tr></thead>
    <tbody id="frt-ped-tbody"></tbody>
  </table></div>
  </div>
  <div id="frt-ped-panel-fila" style="display:none">
    <div id="frt-ped-fila"></div>
  </div>
</div>

'@
$t = InsertAfter $t "<!-- MULTAS -->`r`n" $html "html pg-frotas-pedagios"

if ($t.Length -lt $sizeBefore) { throw "TRUNCATED: $($t.Length) < $sizeBefore" }

[System.IO.File]::WriteAllText($path, $t, $utf8)
Write-Host "index.html chars after: $($t.Length)  delta=$($t.Length - $sizeBefore)"
Write-Host "OK"
