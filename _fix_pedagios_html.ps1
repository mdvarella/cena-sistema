$ErrorActionPreference = 'Stop'
$path = 'C:\DEV\cena-sistema\index.html'
$utf8 = New-Object System.Text.UTF8Encoding $false
$t = $utf8.GetString([System.IO.File]::ReadAllBytes($path))
$sizeBefore = $t.Length

$start = $t.IndexOf("<!-- MULTAS -->")
if ($start -lt 0) { throw 'MULTAS comment not found' }
$end = $t.IndexOf('<div id="pg-frotas-multas"', $start)
if ($end -lt 0) { throw 'pg-frotas-multas not found after MULTAS' }

$html = @"
<!-- MULTAS -->

<!-- PEDAGIOS -->
<div id="pg-frotas-pedagios" class="hidden">
  <div class="card" style="margin-bottom:1rem">
    <div class="ch" style="flex-wrap:wrap;gap:8px">
      <span class="ct">Pedagios</span>
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
        <button class="btn btn-pri" onclick="frtPedAbrirNovo()">+ Pedagio</button>
      </div>
    </div>
    <div style="display:flex;gap:0;border-top:.5px solid #f0efe8;padding:0 .75rem">
      <button type="button" id="frt-ped-tab-lista" onclick="frtPedAba('lista')" style="padding:.55rem .9rem;border:none;border-bottom:2px solid #1a1a18;background:none;cursor:pointer;font-size:12px;font-weight:700;color:#1a1a18">Lista</button>
      <button type="button" id="frt-ped-tab-fila" onclick="frtPedAba('fila')" style="padding:.55rem .9rem;border:none;border-bottom:2px solid transparent;background:none;cursor:pointer;font-size:12px;font-weight:600;color:#888">Sem apropriacao <span id="frt-ped-fila-badge" style="display:none;min-width:16px;height:16px;border-radius:8px;background:#854F0B;color:#fff;font-size:10px;align-items:center;justify-content:center;padding:0 5px;margin-left:4px"></span></button>
    </div>
    <div id="frt-ped-metricas" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;padding:.75rem;border-top:.5px solid #f0efe8"></div>
    <div style="padding:0 .75rem .65rem;font-size:11px;color:#666">Custo operacional = passagens VALIDADO/CONCILIADO. Fatura e conciliacao — nao entra de novo na Viabilidade Economica.</div>
  </div>
  <div id="frt-ped-panel-lista">
  <div style="overflow-x:auto"><table class="tbl tbl-responsive">
    <thead><tr>
      <th>Data/hora</th><th>Placa</th><th>Veiculo</th><th>Praca</th><th>Rodovia</th><th>Concessionaria</th>
      <th style="text-align:right">Valor</th><th>Equipe</th><th>Contrato</th><th>Projeto</th><th>Status</th><th></th>
    </tr></thead>
    <tbody id="frt-ped-tbody"></tbody>
  </table></div>
  </div>
  <div id="frt-ped-panel-fila" style="display:none">
    <div id="frt-ped-fila"></div>
  </div>
</div>

"@

$t = $t.Remove($start, $end - $start).Insert($start, $html)

$glitch = '}      if(subpage==='
$i = $t.IndexOf($glitch)
if ($i -ge 0) { $t = $t.Remove($i, $glitch.Length).Insert($i, "}`r`n      if(subpage===") }

if ($t.Length -lt ($sizeBefore - 2000)) { throw "truncated $($t.Length) < $sizeBefore" }
[System.IO.File]::WriteAllText($path, $t, $utf8)
Write-Host "OK $($t.Length) (was $sizeBefore)"
