$ErrorActionPreference = 'Stop'
$path = Join-Path $PSScriptRoot 'index.html'
$utf8 = New-Object System.Text.UTF8Encoding $false
$s = $utf8.GetString([System.IO.File]::ReadAllBytes($path))
$len0 = $s.Length

function Replace-Once([string]$hay, [string]$old, [string]$new, [string]$label) {
  $i = $hay.IndexOf($old)
  if ($i -lt 0) { throw "nao achou: $label" }
  $j = $hay.IndexOf($old, $i + $old.Length)
  if ($j -ge 0) { throw "ancora duplicada: $label" }
  return $hay.Substring(0, $i) + $new + $hay.Substring($i + $old.Length)
}

$s = $s.Replace('?v=8.1.140', '?v=8.1.141')
$s = Replace-Once $s "numero: '8.1.140'," "numero: '8.1.141'," 'APP_VERSAO.numero'
$s = Replace-Once $s "build:  '20260924-2155'," "build:  '20260924-2335'," 'APP_VERSAO.build'
$s = Replace-Once $s "{v:'8.1.140', d:'24/09/2026', itens:[" "{v:'8.1.141', d:'24/09/2026', itens:[
      'Documentos: catalogo PJ (contratada/honorarios/representante) e publicacao aceita token CENA fora do catalogo. Sem SQL. HOMOLOGACAO.',
    ]},
    {v:'8.1.140', d:'24/09/2026', itens:[" 'changelog 8.1.141'

$catOld = "  {codigo:'[[CODIGO_VERIFICACAO]]', label:'Codigo de verificacao', grupo:'Assinatura', tipo:'texto', fonte:'assinatura', sensivel:false, formatador:'texto', opcional_padrao:true}`r`n];"
$catNew = @"
  {codigo:'[[CODIGO_VERIFICACAO]]', label:'Codigo de verificacao', grupo:'Assinatura', tipo:'texto', fonte:'assinatura', sensivel:false, formatador:'texto', opcional_padrao:true},
  {codigo:'[[NACIONALIDADE_REPRESENTANTE_EMPRESA]]', label:'Nacionalidade do representante', grupo:'Empresa', tipo:'texto', fonte:'empresa_empregadora', sensivel:false, formatador:'texto', opcional_padrao:true},
  {codigo:'[[ESTADO_CIVIL_REPRESENTANTE_EMPRESA]]', label:'Estado civil do representante', grupo:'Empresa', tipo:'texto', fonte:'empresa_empregadora', sensivel:false, formatador:'texto', opcional_padrao:true},
  {codigo:'[[RG_REPRESENTANTE_EMPRESA]]', label:'RG do representante', grupo:'Empresa', tipo:'texto', fonte:'empresa_empregadora', sensivel:true, formatador:'texto', opcional_padrao:true},
  {codigo:'[[CPF_REPRESENTANTE_EMPRESA]]', label:'CPF do representante', grupo:'Empresa', tipo:'cpf', fonte:'empresa_empregadora', sensivel:true, formatador:'cpf', opcional_padrao:true},
  {codigo:'[[RAZAO_SOCIAL_CONTRATADA]]', label:'Razao social da contratada PJ', grupo:'Contrato PJ', tipo:'texto', fonte:'preenchimento_contrato', sensivel:false, formatador:'texto', opcional_padrao:true},
  {codigo:'[[CNPJ_CONTRATADA]]', label:'CNPJ da contratada PJ', grupo:'Contrato PJ', tipo:'cnpj', fonte:'preenchimento_contrato', sensivel:false, formatador:'cnpj', opcional_padrao:true},
  {codigo:'[[ENDERECO_CONTRATADA]]', label:'Endereco da contratada PJ', grupo:'Contrato PJ', tipo:'texto', fonte:'preenchimento_contrato', sensivel:false, formatador:'texto', opcional_padrao:true},
  {codigo:'[[REPRESENTANTE_CONTRATADA]]', label:'Representante da contratada PJ', grupo:'Contrato PJ', tipo:'texto', fonte:'preenchimento_contrato', sensivel:false, formatador:'texto', opcional_padrao:true},
  {codigo:'[[REGISTRO_PROFISSIONAL_CONTRATADA]]', label:'Registro profissional da contratada', grupo:'Contrato PJ', tipo:'texto', fonte:'preenchimento_contrato', sensivel:false, formatador:'texto', opcional_padrao:true},
  {codigo:'[[RG_REPRESENTANTE_CONTRATADA]]', label:'RG do representante da contratada', grupo:'Contrato PJ', tipo:'texto', fonte:'preenchimento_contrato', sensivel:true, formatador:'texto', opcional_padrao:true},
  {codigo:'[[CPF_REPRESENTANTE_CONTRATADA]]', label:'CPF do representante da contratada', grupo:'Contrato PJ', tipo:'cpf', fonte:'preenchimento_contrato', sensivel:true, formatador:'cpf', opcional_padrao:true},
  {codigo:'[[NACIONALIDADE_REPRESENTANTE_CONTRATADA]]', label:'Nacionalidade do representante da contratada', grupo:'Contrato PJ', tipo:'texto', fonte:'preenchimento_contrato', sensivel:false, formatador:'texto', opcional_padrao:true},
  {codigo:'[[ESTADO_CIVIL_REPRESENTANTE_CONTRATADA]]', label:'Estado civil do representante da contratada', grupo:'Contrato PJ', tipo:'texto', fonte:'preenchimento_contrato', sensivel:false, formatador:'texto', opcional_padrao:true},
  {codigo:'[[ENDERECO_REPRESENTANTE_CONTRATADA]]', label:'Endereco do representante da contratada', grupo:'Contrato PJ', tipo:'texto', fonte:'preenchimento_contrato', sensivel:true, formatador:'texto', opcional_padrao:true},
  {codigo:'[[DATA_INICIO_CONTRATO]]', label:'Inicio do contrato PJ', grupo:'Contrato PJ', tipo:'data', fonte:'preenchimento_contrato', sensivel:false, formatador:'data', opcional_padrao:true},
  {codigo:'[[DATA_FIM_CONTRATO]]', label:'Termino do contrato PJ', grupo:'Contrato PJ', tipo:'data', fonte:'preenchimento_contrato', sensivel:false, formatador:'data', opcional_padrao:true},
  {codigo:'[[VALOR_HONORARIOS]]', label:'Honorarios mensais PJ', grupo:'Contrato PJ', tipo:'moeda', fonte:'preenchimento_contrato', sensivel:true, formatador:'moeda', opcional_padrao:true},
  {codigo:'[[VALOR_HONORARIOS_EXTENSO]]', label:'Honorarios por extenso', grupo:'Contrato PJ', tipo:'texto', fonte:'preenchimento_contrato', sensivel:true, formatador:'extenso_moeda', opcional_padrao:true}
];
"@
$s = Replace-Once $s $catOld $catNew 'catalogo PJ'

$aliasOld = "  CODIGO_VERIFICACAO:'[[CODIGO_VERIFICACAO]]'`r`n};"
$aliasNew = @"
  CODIGO_VERIFICACAO:'[[CODIGO_VERIFICACAO]]',
  RAZAO_SOCIAL_CONTRATADA:'[[RAZAO_SOCIAL_CONTRATADA]]', CNPJ_CONTRATADA:'[[CNPJ_CONTRATADA]]',
  ENDERECO_CONTRATADA:'[[ENDERECO_CONTRATADA]]', REPRESENTANTE_CONTRATADA:'[[REPRESENTANTE_CONTRATADA]]',
  REGISTRO_PROFISSIONAL_CONTRATADA:'[[REGISTRO_PROFISSIONAL_CONTRATADA]]',
  RG_REPRESENTANTE_CONTRATADA:'[[RG_REPRESENTANTE_CONTRATADA]]', CPF_REPRESENTANTE_CONTRATADA:'[[CPF_REPRESENTANTE_CONTRATADA]]',
  NACIONALIDADE_REPRESENTANTE_CONTRATADA:'[[NACIONALIDADE_REPRESENTANTE_CONTRATADA]]',
  ESTADO_CIVIL_REPRESENTANTE_CONTRATADA:'[[ESTADO_CIVIL_REPRESENTANTE_CONTRATADA]]',
  ENDERECO_REPRESENTANTE_CONTRATADA:'[[ENDERECO_REPRESENTANTE_CONTRATADA]]',
  NACIONALIDADE_REPRESENTANTE_EMPRESA:'[[NACIONALIDADE_REPRESENTANTE_EMPRESA]]',
  ESTADO_CIVIL_REPRESENTANTE_EMPRESA:'[[ESTADO_CIVIL_REPRESENTANTE_EMPRESA]]',
  RG_REPRESENTANTE_EMPRESA:'[[RG_REPRESENTANTE_EMPRESA]]', CPF_REPRESENTANTE_EMPRESA:'[[CPF_REPRESENTANTE_EMPRESA]]',
  DATA_INICIO_CONTRATO:'[[DATA_INICIO_CONTRATO]]', DATA_FIM_CONTRATO:'[[DATA_FIM_CONTRATO]]',
  VALOR_HONORARIOS:'[[VALOR_HONORARIOS]]', VALOR_HONORARIOS_EXTENSO:'[[VALOR_HONORARIOS_EXTENSO]]'
};
"@
$s = Replace-Once $s $aliasOld $aliasNew 'aliases PJ'

$resOld = "  put('[[CODIGO_VERIFICACAO]]', ass.codigo_verificacao||'', 'assinatura');"
$resNew = @"
  put('[[CODIGO_VERIFICACAO]]', ass.codigo_verificacao||'', 'assinatura');
  put('[[NACIONALIDADE_REPRESENTANTE_EMPRESA]]', emp?(emp.nacionalidade_representante||emp.nacionalidade_responsavel||''):'', 'empresa_empregadora');
  put('[[ESTADO_CIVIL_REPRESENTANTE_EMPRESA]]', emp?(emp.estado_civil_representante||''):'', 'empresa_empregadora');
  put('[[RG_REPRESENTANTE_EMPRESA]]', emp?(emp.rg_representante||emp.rg_responsavel||''):'', 'empresa_empregadora');
  put('[[CPF_REPRESENTANTE_EMPRESA]]', emp?(emp.cpf_representante||emp.cpf_responsavel||''):'', 'empresa_empregadora');
  put('[[RAZAO_SOCIAL_CONTRATADA]]', pre.razao_social_contratada||pre.contratada_razao||'', 'preenchimento_contrato');
  put('[[CNPJ_CONTRATADA]]', pre.cnpj_contratada||pre.contratada_cnpj||'', 'preenchimento_contrato');
  put('[[ENDERECO_CONTRATADA]]', pre.endereco_contratada||pre.contratada_endereco||'', 'preenchimento_contrato');
  put('[[REPRESENTANTE_CONTRATADA]]', pre.representante_contratada||'', 'preenchimento_contrato');
  put('[[REGISTRO_PROFISSIONAL_CONTRATADA]]', pre.registro_profissional_contratada||'', 'preenchimento_contrato');
  put('[[RG_REPRESENTANTE_CONTRATADA]]', pre.rg_representante_contratada||'', 'preenchimento_contrato');
  put('[[CPF_REPRESENTANTE_CONTRATADA]]', pre.cpf_representante_contratada||'', 'preenchimento_contrato');
  put('[[NACIONALIDADE_REPRESENTANTE_CONTRATADA]]', pre.nacionalidade_representante_contratada||'', 'preenchimento_contrato');
  put('[[ESTADO_CIVIL_REPRESENTANTE_CONTRATADA]]', pre.estado_civil_representante_contratada||'', 'preenchimento_contrato');
  put('[[ENDERECO_REPRESENTANTE_CONTRATADA]]', pre.endereco_representante_contratada||'', 'preenchimento_contrato');
  put('[[DATA_INICIO_CONTRATO]]', pre.data_inicio_contrato||pre.data_admissao||'', 'preenchimento_contrato');
  put('[[DATA_FIM_CONTRATO]]', pre.data_fim_contrato||'', 'preenchimento_contrato');
  put('[[VALOR_HONORARIOS]]', pre.valor_honorarios||rem.honorarios||rem.salario_proposto||'', 'preenchimento_contrato');
  put('[[VALOR_HONORARIOS_EXTENSO]]', pre.valor_honorarios||rem.honorarios||rem.salario_proposto||'', 'preenchimento_contrato');
"@
$s = Replace-Once $s $resOld $resNew 'resolver PJ'

$pubOld = @"
  var val=rhDocValidarTokensModelo(m.modelo_conteudo);
  if(val.invalidos.length){
    progShowToast('Token desconhecido: '+val.invalidos.join(', '),'erro'); return;
  }
"@
$pubNew = @"
  var val=rhDocValidarTokensModelo(m.modelo_conteudo);
  if(val.invalidos.length){
    var runtime=val.invalidos.filter(function(t){ return typeof rhDocEhTokenFormatoCena!=='function' || !rhDocEhTokenFormatoCena(t); });
    if(runtime.length){
      progShowToast('Token desconhecido: '+runtime.join(', '),'erro'); return;
    }
    val.validos=val.validos.concat(val.invalidos.filter(function(t){ return typeof rhDocEhTokenFormatoCena==='function' && rhDocEhTokenFormatoCena(t); }));
    val.invalidos=runtime;
  }
"@
$s = Replace-Once $s $pubOld $pubNew 'publicar tokens'

$s = Replace-Once $s "bloquear_publicacao:true,bloquear_geracao:true,status_biblioteca:'BLOQUEADO_FONTE',motivo_bloqueio:'Sem fonte estruturada da contratada PJ (razao, CNPJ, representante, honorarios, vigencia). DOC-TEMPLATE-1 piloto visual.'" "bloquear_publicacao:false,bloquear_geracao:true,status_biblioteca:'HOMOLOGACAO',motivo_bloqueio:'Geracao bloqueada - sem cadastro estruturado da contratada PJ/honorarios. Publicacao do modelo liberada para homologacao visual.'" 'CTR-PJ publish'

if ($s.Length -lt ($len0 - 200)) { throw "truncou index.html ($($s.Length) < $len0)" }
[System.IO.File]::WriteAllText($path, $s, $utf8)
Write-Host "index.html ok $($s.Length) (antes $len0)"

$sw = Join-Path $PSScriptRoot 'sw.js'
$sws = [System.IO.File]::ReadAllText($sw, $utf8)
$sws = $sws.Replace('v8.1.140', 'v8.1.141').Replace("SW_VERSION   = 'cena-8.1.140'", "SW_VERSION   = 'cena-8.1.141'")
[System.IO.File]::WriteAllText($sw, $sws, $utf8)
Write-Host "sw.js ok"
