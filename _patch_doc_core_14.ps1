$ErrorActionPreference = 'Stop'
$p = 'c:\DEV\cena-sistema\index.html'
$utf8 = New-Object System.Text.UTF8Encoding $false
$t = [IO.File]::ReadAllText($p, $utf8)
$n0 = $t.Length

function Replace-Once([string]$old, [string]$new, [string]$label) {
  $i = $t.IndexOf($old)
  if ($i -lt 0) { throw "NAO ACHOU: $label" }
  $j = $t.IndexOf($old, $i + 1)
  if ($j -ge 0) { throw "DUPLICADO: $label" }
  $script:t = $t.Remove($i, $old.Length).Insert($i, $new)
}

# --- catalog tokens ---
Replace-Once @"
  {codigo:'[[CNH_VALIDADE]]', label:'CNH validade', grupo:'Pessoa', tipo:'data', fonte:'processo', sensivel:false, formatador:'data', opcional_padrao:true}
];
"@ @"
  {codigo:'[[CNH_VALIDADE]]', label:'CNH validade', grupo:'Pessoa', tipo:'data', fonte:'processo', sensivel:false, formatador:'data', opcional_padrao:true},
  {codigo:'[[DOCUMENTO_ID]]', label:'ID do documento gerado', grupo:'Documento', tipo:'texto', fonte:'motor_documento', sensivel:false, formatador:'texto', opcional_padrao:true},
  {codigo:'[[DATA_HORA_GERACAO]]', label:'Data/hora de geração', grupo:'Documento', tipo:'texto', fonte:'motor_documento', sensivel:false, formatador:'data_hora', opcional_padrao:true},
  {codigo:'[[STATUS_ASSINATURA]]', label:'Status de assinatura (geração)', grupo:'Documento', tipo:'texto', fonte:'motor_documento', sensivel:false, formatador:'texto', opcional_padrao:true}
];
"@ 'catalog-tokens'

Replace-Once "  FILIAL_LOCAL_TRABALHO:'[[BASE]]', CENTRO_CUSTO:'[[CENTRO_CUSTO]]', ESTADO_CIVIL:'[[ESTADO_CIVIL]]'" "  FILIAL_LOCAL_TRABALHO:'[[BASE]]', CENTRO_CUSTO:'[[CENTRO_CUSTO]]', ESTADO_CIVIL:'[[ESTADO_CIVIL]]',`r`n  DOCUMENTO_ID:'[[DOCUMENTO_ID]]', DATA_HORA_GERACAO:'[[DATA_HORA_GERACAO]]', STATUS_ASSINATURA:'[[STATUS_ASSINATURA]]'" 'aliases'

Replace-Once "  if(f==='extenso_moeda') return rhDocExtensoMoeda(v);`r`n  return v;" "  if(f==='extenso_moeda') return rhDocExtensoMoeda(v);`r`n  if(f==='data_hora') return typeof rhDocFmtDataHora==='function'?rhDocFmtDataHora(v):v;`r`n  return v;" 'fmt-data-hora-apply'

Replace-Once @"
function rhDocFmtData(v){
  var s=String(v||'').trim();
  if(!s) return '';
  var m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(m) return m[3]+'/'+m[2]+'/'+m[1];
  return s;
}
"@ @"
function rhDocFmtData(v){
  var s=String(v||'').trim();
  if(!s) return '';
  var m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(m) return m[3]+'/'+m[2]+'/'+m[1];
  return s;
}
function rhDocFmtDataHora(iso){
  if(!iso) return '';
  var d=new Date(iso);
  if(isNaN(d.getTime())) return String(iso);
  function z(n){ return String(n).padStart(2,'0'); }
  return z(d.getDate())+'/'+z(d.getMonth()+1)+'/'+d.getFullYear()+' '+z(d.getHours())+':'+z(d.getMinutes());
}
"@ 'fmt-data-hora-fn'

Replace-Once "  put('[[CODIGO_MODELO]]', (opts.modelo&&opts.modelo.codigo)||'', 'modelo');`r`n  put('[[VERSAO_MODELO]]', (opts.modelo&&opts.modelo.versao!=null)?String(opts.modelo.versao):'', 'modelo');" "  put('[[CODIGO_MODELO]]', (opts.modelo&&opts.modelo.codigo)||'', 'modelo');`r`n  put('[[VERSAO_MODELO]]', (opts.modelo&&opts.modelo.versao!=null)?String(opts.modelo.versao):'', 'modelo');`r`n  var _docIdTok=opts.documentoId!=null?String(opts.documentoId):'';`r`n  var _dtTok=opts.geradoEm?(typeof rhDocFmtDataHora==='function'?rhDocFmtDataHora(opts.geradoEm):String(opts.geradoEm)):'';`r`n  put('[[DOCUMENTO_ID]]', _docIdTok, 'motor_documento', _docIdTok?'OK':'AUSENTE');`r`n  put('[[DATA_HORA_GERACAO]]', _dtTok, 'motor_documento', _dtTok?'OK':'AUSENTE');`r`n  put('[[STATUS_ASSINATURA]]', opts.statusAssinatura||'NAO ASSINADO', 'motor_documento', 'OK');" 'resolver-motor-tokens'

Replace-Once "      && ['GERADO','EM_REVISAO','APROVADO_PARA_ASSINATURA','AGUARDANDO_ASSINATURA','ASSINADO','ARQUIVADO_DOSSIE','RASCUNHO'].indexOf(String(g.status))>=0;" "      && ['GERADO','EM_REVISAO','APROVADO_PARA_ASSINATURA','AGUARDANDO_ASSINATURA','ASSINADO','ARQUIVADO_DOSSIE'].indexOf(String(g.status))>=0;" 'ativo-sem-rascunho'

Replace-Once @"
async function rhDocHashBlob(blob){
  try{
    if(typeof rhSynHashArquivo==='function') return await rhSynHashArquivo(blob);
    if(typeof rhIaHashFile==='function') return await rhIaHashFile(blob);
  }catch(e){}
  if(!(window.crypto&&crypto.subtle)) return '';
  var buf=await blob.arrayBuffer();
  var dig=await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(dig)).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
}
"@ @"
async function rhDocHashBlob(blob){
  if(!blob) return '';
  if(!(window.crypto&&crypto.subtle)) return '';
  var buf;
  try{
    if(blob instanceof ArrayBuffer) buf=blob;
    else if(typeof blob.arrayBuffer==='function') buf=await blob.arrayBuffer();
    else return '';
    var dig=await crypto.subtle.digest('SHA-256', buf);
    var hex=Array.from(new Uint8Array(dig)).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
    if(!/^[0-9a-f]{64}$/i.test(hex)) return '';
    return hex.toLowerCase();
  }catch(eHash){
    return '';
  }
}
function rhDocHashDocumentalValido(h){
  var s=String(h||'');
  if(!s || /^err_/i.test(s) || /^fallback_/i.test(s)) return false;
  return /^[0-9a-f]{64}$/i.test(s);
}
function rhDocStatusInicialGeracao(){ return 'RASCUNHO'; }
function rhDocPodeRegenerar(g){
  var st=String((g&&g.status)||'');
  return st==='GERADO' || st==='EM_REVISAO';
}
function rhDocGeradoCumpreInvariantesMotor(gerado){
  if(!gerado||!gerado.id) return {ok:false, motivo:'Registro sem id.'};
  var snap=gerado.snapshot_tokens;
  if(typeof snap==='string'){ try{snap=JSON.parse(snap);}catch(eInvSnap){snap=null;} }
  snap=snap||{};
  var idTok=snap['[[DOCUMENTO_ID]]']||{};
  var dtTok=snap['[[DATA_HORA_GERACAO]]']||{};
  if(String(idTok.valor||'')!==String(gerado.id)) return {ok:false, motivo:'DOCUMENTO_ID do snapshot diverge do id.'};
  var dtEsp=typeof rhDocFmtDataHora==='function'?rhDocFmtDataHora(gerado.gerado_em):String(gerado.gerado_em||'');
  if(!gerado.gerado_em || String(dtTok.valor||'')!==String(dtEsp)) return {ok:false, motivo:'DATA_HORA_GERACAO diverge de gerado_em.'};
  var html=String(gerado.conteudo_html||'');
  if(!html) return {ok:false, motivo:'conteudo_html vazio.'};
  if(html.indexOf(String(gerado.id))<0) return {ok:false, motivo:'HTML sem DOCUMENTO_ID real.'};
  if(!rhDocHashDocumentalValido(gerado.hash_sha256)) return {ok:false, motivo:'hash_sha256 inválido.'};
  return {ok:true};
}
function rhDocBloquearUsoSeInvarianteFalhar(gerado, acao){
  var st=String((gerado&&gerado.status)||'');
  if(st==='RASCUNHO' || st==='CANCELADO'){
    if(typeof progShowToast==='function') progShowToast((acao||'Uso')+' bloqueado: documento '+st+' não é utilizável.','erro');
    return true;
  }
  var inv=rhDocGeradoCumpreInvariantesMotor(gerado);
  if(inv.ok) return false;
  if(typeof progShowToast==='function') progShowToast((acao||'Uso')+' bloqueado: '+(inv.motivo||'invariantes do motor.'),'erro');
  return true;
}
function rhDocValidarModeloOperacional(modelo, opts){
  opts=opts||{};
  var motivos=[];
  if(!modelo) return {ok:false, motivos:['Modelo ausente.']};
  if(opts.paraPublicar){
    if(String(modelo.status)!=='RASCUNHO' && String(modelo.status)!=='EM_REVISAO')
      motivos.push('Só rascunho/em revisão publica.');
  } else {
    if(String(modelo.status)!=='PUBLICADO'||modelo.ativo===false)
      motivos.push('Só modelo PUBLICADO + ATIVO gera documento oficial.');
  }
  var val=rhDocValidarTokensModelo(modelo.modelo_conteudo);
  if(val.invalidos.length) motivos.push('Token desconhecido: '+val.invalidos.join(', '));
  var lay=rhDocLayoutCena(modelo.codigo);
  if(opts.paraPublicar && lay && lay.bloquear_publicacao)
    motivos.push(lay.motivo_bloqueio||('Modelo '+modelo.codigo+' não pode ser publicado nesta fase.'));
  if(!opts.paraPublicar && lay && lay.bloquear_geracao)
    motivos.push(lay.motivo_bloqueio||('Modelo '+modelo.codigo+' não gera documento operacional.'));
  return {ok:!motivos.length, motivos:motivos, tokens:val};
}
async function rhDocInvalidarGeracaoIncompleta(saved, motivo){
  if(!saved||!saved.id) return {ok:false};
  var payload={
    status:'CANCELADO',
    cancelado_em:new Date().toISOString(),
    cancelado_por:(typeof usuarioLogado!=='undefined'&&usuarioLogado)?(usuarioLogado.nome||usuarioLogado.email):null,
    cancelado_motivo:motivo||'FALHA_GERACAO_SEGUNDO_PASSO'
  };
  if(typeof DEMO!=='undefined' && DEMO){ Object.assign(saved, payload); return {ok:true, saved:saved}; }
  try{
    var ok=await sbUpdate('rh_contratacao_documentos_gerados', payload, 'id=eq.'+saved.id);
    if(ok){ Object.assign(saved, payload); return {ok:true, saved:saved}; }
  }catch(eInv){}
  return {ok:false, saved:saved};
}
async function rhDocAplicarSegundoPassoMotor(saved, modelo, proc){
  if(!saved||!saved.id) throw new Error('Segundo passo sem id persistido.');
  if(!saved.gerado_em) saved.gerado_em=new Date().toISOString();
  var resolved=rhDocResolverTokens(proc,{modelo:modelo, documentoId:saved.id, geradoEm:saved.gerado_em, statusAssinatura:'NAO ASSINADO'});
  var opcionais=modelo.tokens_opcionais||[];
  if(typeof opcionais==='string'){ try{opcionais=JSON.parse(opcionais);}catch(eOp){opcionais=[];} }
  var render=rhDocRenderConteudo(modelo.modelo_conteudo, resolved, {tokensOpcionais:opcionais, preview:false, paraDocumento:true});
  if(render.pendencias && render.pendencias.length) throw new Error('Pendências no segundo passo: '+render.pendencias.join(', '));
  var htmlDoc=rhDocMontarDocumentoHtml(modelo.nome, render.html);
  var blob=new Blob([htmlDoc],{type:'text/html;charset=utf-8'});
  var hash=await rhDocHashBlob(blob);
  if(!rhDocHashDocumentalValido(hash)) throw new Error('SHA-256 final inválido.');
  var snapTokens={};
  Object.keys(resolved).forEach(function(k){
    snapTokens[k]={valor:resolved[k].valor, fonte:resolved[k].fonte, status:resolved[k].status};
  });
  var probe={id:saved.id, gerado_em:saved.gerado_em, conteudo_html:render.html, snapshot_tokens:snapTokens, hash_sha256:hash};
  var inv=rhDocGeradoCumpreInvariantesMotor(probe);
  if(!inv.ok) throw new Error(inv.motivo||'Invariantes do segundo passo.');
  return {html:render.html, htmlDoc:htmlDoc, snapTokens:snapTokens, hash:hash, blob:blob};
}
"@ 'hash-e-helpers'

# --- gerar documento ---
$iGer = $t.IndexOf('async function rhDocGerarDocumento(modeloId, opts){')
if ($iGer -lt 0) { throw 'NAO ACHOU gerar' }
$iNext = $t.IndexOf('function rhDocMostrarPendencias(titulo, motivos){', $iGer)
if ($iNext -lt 0) { throw 'NAO ACHOU mostrar pendencias' }
$newGer = @'
async function rhDocGerarDocumento(modeloId, opts){
  opts=opts||{};
  if(_rhDocGerando){ progShowToast('Geração já em andamento.','erro'); return null; }
  if(!_rhCtAtual||!_rhCtAtual.id){ progShowToast('Abra um processo.','erro'); return null; }
  var modelo=(_rhDocModelos||[]).find(function(m){return String(m.id)===String(modeloId);});
  if(!modelo){ progShowToast('Modelo não encontrado.','erro'); return null; }
  var opMod=rhDocValidarModeloOperacional(modelo,{});
  if(!opMod.ok){
    progShowToast(opMod.motivos[0]||'Modelo não operacional.','erro');
    return null;
  }
  var check=rhDocValidarAntesGerar(modelo, _rhCtAtual);
  if(!check.ok){
    progShowToast('Não é possível gerar: '+(check.motivos[0]||'pendências'),'erro');
    rhDocMostrarPendencias(modelo.nome, check.motivos);
    return null;
  }
  var existente=rhDocGeradoAtivoDoModelo(_rhCtAtual.id, modelo.codigo);
  if(existente && !opts.regenerar){
    progShowToast('Já existe documento gerado. Use Regenerar.','erro'); return null;
  }
  if(opts.regenerar && existente && !rhDocPodeRegenerar(existente)){
    progShowToast('Regeneração bloqueada neste status.','erro'); return null;
  }
  _rhDocGerando=true;
  try{
    var snapTokens={};
    Object.keys(check.resolved).forEach(function(k){
      snapTokens[k]={valor:check.resolved[k].valor, fonte:check.resolved[k].fonte, status:check.resolved[k].status};
    });
    var snapDados={
      nome:_rhCtAtual.nome_pretendido, cargo:_rhCtAtual.cargo, cargo_id:_rhCtAtual.cargo_id,
      contrato_id:_rhCtAtual.contrato_id, base_id:_rhCtAtual.base_id,
      data_admissao:_rhCtAtual.data_prevista_admissao,
      remuneracao:_rhCtAtual.remuneracao,
      empresa_empregadora_id:_rhCtAtual.empresa_empregadora_id||null,
      modelo_codigo:modelo.codigo, modelo_versao:modelo.versao, modelo_id:modelo.id
    };
    var fileName=rhDocNomeArquivo(modelo.tipo_documento, _rhCtAtual.nome_pretendido, new Date().toISOString());
    var htmlDoc=rhDocMontarDocumentoHtml(modelo.nome, check.render.html);
    var blob=new Blob([htmlDoc],{type:'text/html;charset=utf-8'});
    var hash=await rhDocHashBlob(blob);
    var payload={
      contratacao_id:_rhCtAtual.id,
      colaborador_id:_rhCtAtual.colaborador_id||null,
      origem_contexto:'CONTRATACAO',
      evento_codigo:'ADMISSAO',
      tipo_documento_codigo:modelo.tipo_documento||null,
      provider_assinatura:'MANUAL',
      modelo_id:modelo.id,
      modelo_codigo:modelo.codigo,
      modelo_versao:modelo.versao,
      tipo_documento:modelo.tipo_documento,
      status:rhDocStatusInicialGeracao(),
      snapshot_dados:snapDados,
      snapshot_tokens:snapTokens,
      conteudo_html:check.render.html,
      arquivo_nome:fileName,
      formato:'HTML',
      hash_sha256:hash||null,
      gerado_por:usuarioLogado?(usuarioLogado.nome||usuarioLogado.email):null,
      substitui_id:existente?existente.id:null
    };
    var saved=null;
    if(DEMO){
      saved=Object.assign({id:'ger'+Date.now(), gerado_em:new Date().toISOString()}, payload);
      _rhDocGerados.unshift(saved);
    } else {
      var ins=await sbInsert('rh_contratacao_documentos_gerados', payload);
      saved=ins&&ins[0];
      if(!saved) throw new Error('Falha ao gravar documento gerado. '+rhDocSqlHint());
      if(!saved.gerado_em) saved.gerado_em=new Date().toISOString();
    }
    var passo2=null;
    try{
      passo2=await rhDocAplicarSegundoPassoMotor(saved, modelo, _rhCtAtual);
    }catch(eMotor){
      var inv=await rhDocInvalidarGeracaoIncompleta(saved, 'FALHA_GERACAO_SEGUNDO_PASSO');
      if(!inv.ok){
        saved.status='RASCUNHO';
        progShowToast('Geração incompleta. Registro permanece RASCUNHO (não utilizável).','erro');
      } else {
        progShowToast('Segundo passo falhou. Documento cancelado.','erro');
      }
      throw eMotor;
    }
    var upd={
      status:'GERADO',
      snapshot_tokens:passo2.snapTokens,
      conteudo_html:passo2.html,
      hash_sha256:passo2.hash,
      gerado_em:saved.gerado_em
    };
    if(DEMO){
      Object.assign(saved, upd);
    } else {
      var okU=await sbUpdate('rh_contratacao_documentos_gerados', upd, 'id=eq.'+saved.id);
      if(!okU){
        var invU=await rhDocInvalidarGeracaoIncompleta(saved, 'FALHA_UPDATE_GERADO');
        if(!invU.ok) saved.status='RASCUNHO';
        throw new Error('Falha ao promover RASCUNHO para GERADO.');
      }
      Object.assign(saved, upd);
      var up=await rhDocUploadGerado(_rhCtAtual.id, saved.id, fileName, passo2.blob);
      await sbUpdate('rh_contratacao_documentos_gerados',{arquivo_path:up.path, arquivo_url:up.url},'id=eq.'+saved.id);
      saved.arquivo_path=up.path; saved.arquivo_url=up.url;
      if(existente){
        await sbUpdate('rh_contratacao_documentos_gerados',{
          status:'SUBSTITUIDO', substituido_por_id:saved.id,
          observacao:(existente.observacao?existente.observacao+' | ':'')+'Substituído por regeneração'
        },'id=eq.'+existente.id);
        existente.status='SUBSTITUIDO'; existente.substituido_por_id=saved.id;
      }
    }
    if(!DEMO && _rhDocGerados.indexOf(saved)<0) _rhDocGerados.unshift(saved);
    await rhDocRegistrarEvento(_rhCtAtual.id, opts.regenerar?'REGEROU_DOCUMENTO_ADMISSIONAL':'GEROU_DOCUMENTO_ADMISSIONAL',
      (opts.regenerar?'Regenerou ':'Gerou ')+modelo.codigo+' v'+modelo.versao,
      {tabela:'rh_contratacao_documentos_gerados', id:saved.id, meta:{modelo_codigo:modelo.codigo, versao:modelo.versao}});
    progShowToast((opts.regenerar?'Documento regenerado.':'Documento gerado.')+' Pronto para revisão.');
    return saved;
  }catch(e){
    console.error(e);
    if(e&&String(e.message||'').indexOf('RASCUNHO')<0 && String(e.message||'').indexOf('Segundo passo')<0 && String(e.message||'').indexOf('incompleta')<0)
      progShowToast((e&&e.message)||'Erro ao gerar documento.','erro');
    return null;
  }finally{
    _rhDocGerando=false;
  }
}

'@
$script:t = $t.Remove($iGer, $iNext - $iGer).Insert($iGer, $newGer)

$iAp = $t.IndexOf("async function rhDocAprovarParaAssinatura(docId){")
if ($iAp -lt 0) { throw 'NAO ACHOU aprovar fn' }
$iCf = $t.IndexOf("if(!confirm('Aprovar para assinatura?", $iAp)
if ($iCf -lt 0) { throw 'NAO ACHOU confirm aprovar' }
$script:t = $t.Insert($iCf, "if(rhDocBloquearUsoSeInvarianteFalhar(d,'Aprovação')) return;`r`n  ")

$iDs = $t.IndexOf("async function rhDocEnviarDocusign(docId){")
if ($iDs -lt 0) { throw 'NAO ACHOU enviar docusign' }
$iDsAuth = $t.IndexOf("if(!_sbAuthToken){", $iDs)
if ($iDsAuth -lt 0) { throw 'NAO ACHOU jwt docusign' }
$iDsNl = $t.IndexOf("`n", $iDsAuth)
if ($iDsNl -lt 0) { throw 'NAO ACHOU nl docusign' }
$script:t = $t.Insert($iDsNl + 1, "  var dEnv=(_rhDocGerados||[]).find(function(x){return String(x.id)===String(docId);});`r`n  if(dEnv && rhDocBloquearUsoSeInvarianteFalhar(dEnv,'DocuSign')) return;`r`n  if(dEnv && String(dEnv.status)!=='APROVADO_PARA_ASSINATURA' && String(dEnv.status)!=='ERRO_ASSINATURA'){`r`n    progShowToast('Aprove o documento para assinatura antes.','erro'); return;`r`n  }`r`n")

Replace-Once "      d.arquivo_path=res.arquivo_assinado_path; d.hash_sha256=res.hash;" "      d.arquivo_path=res.arquivo_assinado_path; if(res.hash_documento_final) d.hash_documento_final=res.hash_documento_final; else if(res.hash) d.hash_documento_final=res.hash;" 'download-nao-sobrescreve-html-hash'

$iDos = $t.IndexOf("Arquive s")
if ($iDos -lt 0) { $iDos = $t.IndexOf("documento ASSINADO.','erro');") }
if ($iDos -lt 0) { throw 'NAO ACHOU dossie arquive' }
$iDosBrace = $t.IndexOf("  }", $iDos)
if ($iDosBrace -lt 0) { throw 'NAO ACHOU dossie brace' }
$iDosNl = $t.IndexOf("`n", $iDosBrace)
$script:t = $t.Insert($iDosNl + 1, "  if(rhDocBloquearUsoSeInvarianteFalhar(d,'Dossiê')) return;`r`n")

$oldPubA = "  if(String(m.status)!=='RASCUNHO' && String(m.status)!=='EM_REVISAO'){"
$iPub = $t.IndexOf($oldPubA)
if ($iPub -lt 0) { throw 'NAO ACHOU publicar status' }
$iPubLay = $t.IndexOf("    return;", $t.IndexOf("bloquear_publicacao", $iPub))
if ($iPubLay -lt 0) { throw 'NAO ACHOU publicar lay return' }
$iPubEnd = $t.IndexOf("`n", $iPubLay)
$lenPub = $iPubEnd + 1 - $iPub
$newPub = "  m.modelo_conteudo=rhDocSanitizarHtmlModelo(m.modelo_conteudo||'');`r`n  var opPub=rhDocValidarModeloOperacional(m,{paraPublicar:true});`r`n  if(!opPub.ok){`r`n    progShowToast(opPub.motivos[0]||'Modelo não operacional.','erro'); return;`r`n  }`r`n  var val=opPub.tokens||rhDocValidarTokensModelo(m.modelo_conteudo);`r`n"
$script:t = $t.Remove($iPub, $lenPub).Insert($iPub, $newPub)

$iReg = $t.IndexOf("html+='<button class=`"btn btn-sm`" type=`"button`" onclick=`"rhDocGerarDocumento(\''+String(item.modelo.id).replace(/'/g,'')+'\',{regenerar:true})")
if ($iReg -lt 0) { throw 'NAO ACHOU ui regenerar' }
$iRegLine = $t.LastIndexOf("`n", $iReg) + 1
$script:t = $t.Insert($iRegLine, "          if(rhDocPodeRegenerar(g))`r`n")

# version bump 8.1.150 -> 8.1.151 (APP only unique)
Replace-Once "numero: '8.1.150'" "numero: '8.1.151'" 'app-ver'
$logNeedle = "    {v:'8.1.150', d:'25/09/2026', itens:["
if ($t.IndexOf($logNeedle) -ge 0) {
  Replace-Once $logNeedle "    {v:'8.1.151', d:'25/09/2026', itens:[`r`n      'DOC-CORE-1.4: restaura motor 1.3 (RASCUNHO→segundo passo→GERADO fail-closed, SHA-256, invariantes, regeneração) na build atual sem reverter Pedágios/Câmera. Sem SQL.',`r`n    ]},`r`n    {v:'8.1.150', d:'25/09/2026', itens:[" 'log-151'
}

$tmp = $p + '.tmp'
[IO.File]::WriteAllText($tmp, $t, $utf8)
if ((Get-Item $tmp).Length -lt ($n0 - 2000)) { Remove-Item $tmp; throw 'tmp small' }
$tail = Get-Content $tmp -Tail 2 -Encoding UTF8 | Out-String
if ($tail -notmatch '</html>') { Remove-Item $tmp; throw 'tail broken' }
Move-Item -Force $tmp $p
Write-Output ('size0='+$n0+' size1='+(Get-Item $p).Length)
@('function rhDocAplicarSegundoPassoMotor','function rhDocInvalidarGeracaoIncompleta','function rhDocGeradoCumpreInvariantesMotor','function rhDocBloquearUsoSeInvarianteFalhar','function rhDocValidarModeloOperacional','function rhDocHashBlob','function rhDocPodeRegenerar','status:rhDocStatusInicialGeracao()','hash_documento_final','portaria-camera.js','frtPedOnFiltroMes') | ForEach-Object {
  if ($t.Contains($_)) { "OK $_" } else { "FAIL $_" }
}
Get-Content $p -Tail 3
