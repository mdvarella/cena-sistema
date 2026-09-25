$ErrorActionPreference = 'Stop'
$path = Join-Path $PSScriptRoot 'index.html'
$bytes = [System.IO.File]::ReadAllBytes($path)
$utf8 = New-Object System.Text.UTF8Encoding $false
$s = $utf8.GetString($bytes)
$len0 = $s.Length

function Replace-Once([string]$hay, [string]$old, [string]$new, [string]$label) {
  $i = $hay.IndexOf($old)
  if ($i -lt 0) { throw "nao achou: $label" }
  $j = $hay.IndexOf($old, $i + $old.Length)
  if ($j -ge 0) { throw "ancora duplicada: $label" }
  return $hay.Substring(0, $i) + $new + $hay.Substring($i + $old.Length)
}

$s = $s.Replace('?v=8.1.139', '?v=8.1.140')
$s = Replace-Once $s "numero: '8.1.139'," "numero: '8.1.140'," 'APP_VERSAO.numero'
$s = Replace-Once $s "build:  '20260924-2125'," "build:  '20260924-2155'," 'APP_VERSAO.build'
$s = Replace-Once $s "{v:'8.1.139', d:'24/09/2026', itens:[" "{v:'8.1.140', d:'24/09/2026', itens:[
      'Documentos: 7 templates nativos CENA (VT, jornada, LGPD, atestados, promocao, experiencia, imagem). Sem runtime Claude. Sem SQL. HOMOLOGACAO VISUAL.',
    ]},
    {v:'8.1.139', d:'24/09/2026', itens:[" 'changelog 8.1.140'

if ($s.Length -lt ($len0 - 200)) { throw "truncou index.html ($($s.Length) < $len0)" }
[System.IO.File]::WriteAllText($path, $s, $utf8)
Write-Host "index.html ok $($s.Length) (antes $len0)"

$sw = Join-Path $PSScriptRoot 'sw.js'
$sws = [System.IO.File]::ReadAllText($sw, $utf8)
$sws = $sws.Replace('v8.1.139', 'v8.1.140').Replace("SW_VERSION   = 'cena-8.1.139'", "SW_VERSION   = 'cena-8.1.140'")
[System.IO.File]::WriteAllText($sw, $sws, $utf8)
Write-Host "sw.js ok"
