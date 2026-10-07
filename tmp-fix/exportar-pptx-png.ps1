param([string]$Arquivo, [string]$Pasta)
$ErrorActionPreference = 'Stop'
if (Test-Path $Pasta) { Remove-Item -Recurse -Force $Pasta }
New-Item -ItemType Directory -Force $Pasta | Out-Null
$ppt = New-Object -ComObject PowerPoint.Application
try {
  $p = $ppt.Presentations.Open($Arquivo, $true, $false, $false)
  $i = 0
  foreach ($s in $p.Slides) {
    $i++
    $s.Export((Join-Path $Pasta ("slide-$i.png")), 'PNG', 1600, 900)
  }
  $p.Close()
  "exportados: $i"
} finally {
  $ppt.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($ppt) | Out-Null
}
