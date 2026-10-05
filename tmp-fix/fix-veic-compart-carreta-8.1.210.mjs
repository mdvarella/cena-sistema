// 8.1.210 — Programação de Projetos: caminhão compartilhado por 2 equipes e carreta (cabos/compressor).
// Requer a migration supabase/migrations/20261005170000_prog_veiculos_compartilhado_carreta.sql.
import fs from 'node:fs';

const ARQ = 'index.html';
const ARQ_SW = 'sw.js';

function carregar(arq) {
  const bruto = fs.readFileSync(arq, 'utf8');
  const crlf = bruto.includes('\r\n');
  return { crlf, txt: crlf ? bruto.replace(/\r\n/g, '\n') : bruto };
}
function salvar(arq, { crlf, txt }) {
  fs.writeFileSync(arq, crlf ? txt.replace(/\n/g, '\r\n') : txt, 'utf8');
}
function trocar(doc, nome, de, para, esperado = 1) {
  const n = doc.txt.split(de).length - 1;
  if (n !== esperado) throw new Error(`${nome}: esperado ${esperado} ocorrência(s), achou ${n}`);
  doc.txt = doc.txt.split(de).join(para);
  console.log('ok  ' + nome + (esperado > 1 ? ` (${n}x)` : ''));
}

const html = carregar(ARQ);
const sw = carregar(ARQ_SW);

// ── sbUpsert guarda o texto do erro (como sbUpdate já faz) ──
trocar(html, 'sbUpsert erro',
`    if(resUp.aborted || !resUp.ok){
      if(!resUp.aborted) console.error('sbUpsert erro ['+table+']',resUp.status,resUp.text);
      return null;`,
`    if(resUp.aborted || !resUp.ok){
      if(!resUp.aborted){ console.error('sbUpsert erro ['+table+']',resUp.status,resUp.text); window._sbLastUpsertErr=resUp.text; }
      return null;`);

// ── Helpers ──
trocar(html, 'helpers',
`function progGetVeiculo(eqId, data){
  var d=(data||'').split('T')[0];`,
`// ── Programação de Projetos: caminhão compartilhado (máx. 2 equipes) e carreta — migration 20261005170000 ──
var PROG_CARRETA_TIPOS = {carreta_cabos:'Carreta de cabos', compressor:'Compressor'};
var _progVeicExtrasOk = null;

/** Colunas de compartilhamento/carreta existem no banco? Sem confirmação as opções ficam escondidas. */
function progVeicExtrasVerificar(){
  if(DEMO){ _progVeicExtrasOk = true; return Promise.resolve(true); }
  if(_progVeicExtrasOk === true) return Promise.resolve(true);
  return Promise.resolve(sbFetch('prog_veiculos_dia',{select:'id,compartilhado_com_equipe_id,carreta_tipo,carreta_placa,carreta_veiculo_id',limit:1}))
    .then(function(r){ if(Array.isArray(r)) _progVeicExtrasOk = true; return _progVeicExtrasOk === true; })
    .catch(function(){ return false; });
}
function progVeicNormPlaca(p){ return String(p||'').toUpperCase().replace(/[^A-Z0-9]/g,''); }
function progVeicPlacaValida(p){ return /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(progVeicNormPlaca(p)); }
function progVeicObjDaLinha(r){
  var o = {id:r.veiculo_id, placa:r.placa, modelo:r.modelo, justificativa:r.justificativa, alterado_por:r.alterado_por};
  if(r.compartilhado_com_equipe_id) o.compartilhado_com_equipe_id = String(r.compartilhado_com_equipe_id);
  if(r.carreta_tipo){
    o.carreta_tipo = r.carreta_tipo;
    o.carreta_placa = r.carreta_placa || '';
    o.carreta_veiculo_id = r.carreta_veiculo_id || null;
  }
  return o;
}
function progVeicNomeEquipe(eqId){
  var id = String(eqId||'');
  var eq = (typeof progProjetoCoreFindEquipe==='function' ? progProjetoCoreFindEquipe(id) : null)
    || (equipes_disp||[]).find(function(e){ return String(e.id)===id; });
  return eq ? (eq.nome_equipe || eq.codigo || eq.nome || id) : id;
}
function progVeicEqDaChave(k, d){
  var suf = '_'+d;
  return k.length > suf.length && k.slice(-suf.length) === suf ? k.slice(0, -suf.length) : null;
}
/** Par compartilhado (os dois lados apontam um para o outro, mesma placa): o segundo lado não conta como duplicado. */
function progVeicEhSegundoDoPar(k, data, pv){
  var d = (data||'').split('T')[0];
  var parc = pv && pv.compartilhado_com_equipe_id;
  var eqK = progVeicEqDaChave(k, d);
  if(!parc || !eqK) return false;
  var po = _progVeiculos[progVeiculoKey(parc, d)];
  if(!po || String(po.compartilhado_com_equipe_id||'') !== eqK) return false;
  if(progVeicNormPlaca(po.placa) !== progVeicNormPlaca(pv.placa)) return false;
  return eqK > String(parc);
}
/** Outras equipes com a mesma placa no dia e turno sobreposto: uma só e livre → pode compartilhar; mais → bloqueado. */
function progVeicAvaliarCompart(eqId, data, placa, eq){
  var d = (data||'').split('T')[0];
  var pn = progVeicNormPlaca(placa);
  var res = {outras:[], parceiro:null, parceiroNome:'', jaCompartilhado:false, bloqueio:''};
  if(!pn) return res;
  var hIA = eq ? String(eq.hora_inicio||'').substring(0,5) : '';
  var hFA = eq ? String(eq.hora_fim||'').substring(0,5) : '';
  Object.keys(_progVeiculos||{}).forEach(function(k){
    var kEq = progVeicEqDaChave(k, d);
    if(!kEq || kEq === String(eqId)) return;
    var o = _progVeiculos[k];
    if(!o || progVeicNormPlaca(o.placa) !== pn) return;
    var eqO = (typeof progProjetoCoreFindEquipe==='function' ? progProjetoCoreFindEquipe(kEq) : null)
      || (equipes_disp||[]).find(function(e){ return String(e.id)===kEq; }) || null;
    var hIO = eqO ? String(eqO.hora_inicio||'').substring(0,5) : '';
    var hFO = eqO ? String(eqO.hora_fim||'').substring(0,5) : '';
    if(hIA && hFA && hIO && hFO && !turnsoSeSobrepoe(hIA, hFA, hIO, hFO)) return;
    res.outras.push({eqId:kEq, nome:progVeicNomeEquipe(kEq), compart:o.compartilhado_com_equipe_id ? String(o.compartilhado_com_equipe_id) : null});
  });
  if(!res.outras.length) return res;
  if(res.outras.length === 1){
    var o1 = res.outras[0];
    if(!o1.compart || o1.compart === String(eqId)){
      res.parceiro = o1.eqId;
      res.parceiroNome = o1.nome;
      res.jaCompartilhado = o1.compart === String(eqId);
    } else {
      res.bloqueio = 'já compartilhado entre '+o1.nome+' e '+progVeicNomeEquipe(o1.compart)+' (máximo 2 equipes)';
    }
  } else {
    res.bloqueio = 'já em uso por '+res.outras.map(function(x){ return x.nome; }).join(' e ')+' (máximo 2 equipes)';
  }
  return res;
}
/** Espelha na memória o vínculo que o banco grava dos dois lados. */
function progVeicAplicarCompartLocal(eqId, data, novoParc){
  var d = (data||'').split('T')[0];
  var eqS = String(eqId);
  var parcS = novoParc ? String(novoParc) : '';
  Object.keys(_progVeiculos||{}).forEach(function(k){
    var kEq = progVeicEqDaChave(k, d);
    if(!kEq || kEq === eqS) return;
    var o = _progVeiculos[k];
    if(!o) return;
    if(parcS && kEq === parcS) o.compartilhado_com_equipe_id = eqS;
    else if(String(o.compartilhado_com_equipe_id||'') === eqS) delete o.compartilhado_com_equipe_id;
  });
}
function progVeicAtualizarCelulas(eqIds, data){
  var d = (data||'').split('T')[0];
  var vistos = {};
  (eqIds||[]).forEach(function(id){
    id = id ? String(id) : '';
    if(!id || vistos[id]) return;
    vistos[id] = true;
    var eq = (equipes_disp||[]).find(function(e){ return String(e.id)===id; })
      || (typeof progProjetoCoreFindEquipe==='function' ? progProjetoCoreFindEquipe(id) : null) || {id:id};
    var comp = typeof progFindCompDia==='function' ? progFindCompDia(id, d) : null;
    var conf = comp && (comp.confirmada===true || comp.confirmada==='true' || comp.confirmada===1);
    var html = conf ? progRenderVeiculoCellBloqueado(eq, d) : progRenderVeiculoCell(eq, d);
    ['prog-veic-cell-','pp-veic-cell-'].forEach(function(pref){
      var c = document.getElementById(pref+id);
      if(c) c.innerHTML = html;
    });
  });
}
function progVeicExtrasHtml(v){
  if(!v) return '';
  var h = '';
  if(v.compartilhado_com_equipe_id){
    h += '<div style="font-size:9px;color:#533AB7;font-weight:700">🤝 Compartilhado com '+escHtml(progVeicNomeEquipe(v.compartilhado_com_equipe_id))+'</div>';
  }
  if(v.carreta_tipo){
    h += '<div style="font-size:9px;color:#7B4A1E;font-weight:700">🚛 '+escHtml(PROG_CARRETA_TIPOS[v.carreta_tipo]||v.carreta_tipo)
      +' <span style="font-family:monospace">'+escHtml(v.carreta_placa||'')+'</span></div>';
  }
  return h;
}
function progVeicCarretasFrota(){
  return (frt_veiculos||[]).filter(function(v){
    if(v.ativo===false) return false;
    var st = String(v.status||'').toLowerCase();
    if(st==='vendido'||st==='descartado'||st==='extraviado'||st==='inativo') return false;
    return /carret|reboque|compressor/i.test([v.modelo, v.tipo, v.tipo_operacional].map(function(x){ return String(x||''); }).join(' '));
  }).sort(function(a,b){ return String(a.placa||'').localeCompare(String(b.placa||'')); });
}
function progVeicExtrasModalHtml(eqId, data, vAtual){
  var ct = vAtual && vAtual.carreta_tipo ? vAtual.carreta_tipo : '';
  var cp = vAtual && vAtual.carreta_placa ? vAtual.carreta_placa : '';
  var parc = vAtual && vAtual.compartilhado_com_equipe_id ? vAtual.compartilhado_com_equipe_id : '';
  var lbl = 'font-size:11px;font-weight:500;display:block;margin-bottom:3px';
  var opts = progVeicCarretasFrota().map(function(v){
    var pn = progVeicNormPlaca(v.placa);
    return '<option value="'+escHtml(pn)+'"'+(cp && pn===progVeicNormPlaca(cp)?' selected':'')+'>'+escHtml(v.placa)+' — '+escHtml(v.modelo||v.tipo||'')+'</option>';
  }).join('');
  return '<div style="border-top:.5px solid #e0dfd8;padding-top:.6rem;margin-bottom:.75rem">'
    +(parc
      ? '<div style="background:#EEEAFB;color:#533AB7;border-radius:8px;padding:.5rem .6rem;font-size:11px;margin-bottom:.5rem">🤝 Compartilhado com <b>'+escHtml(progVeicNomeEquipe(parc))+'</b>. Para desfazer, troque a placa ou remova o veículo.</div>'
      : '<div style="font-size:10px;color:#888;margin-bottom:.5rem">🤝 Se a placa já estiver com outra equipe no mesmo horário, o sistema pergunta se o veículo será compartilhado (máximo 2 equipes).</div>')
    +'<label style="'+lbl+'">Sai com carreta?</label>'
    +'<select class="inp" id="pv-carreta-tipo" style="width:100%" onchange="progVeicCarretaTipoMudou()">'
    +'<option value="">Não</option>'
    +Object.keys(PROG_CARRETA_TIPOS).map(function(k){ return '<option value="'+k+'"'+(k===ct?' selected':'')+'>'+PROG_CARRETA_TIPOS[k]+'</option>'; }).join('')
    +'</select>'
    +'<div id="pv-carreta-box" style="display:'+(ct?'grid':'none')+';grid-template-columns:1fr 1fr;gap:.5rem;margin-top:.5rem">'
    +'<div><label style="'+lbl+'">Carreta da frota</label>'
    +'<select class="inp" id="pv-carreta-sel" style="width:100%" onchange="progVeicCarretaSelMudou()"><option value="">— digitar a placa —</option>'+opts+'</select></div>'
    +'<div><label style="'+lbl+'">Placa da carreta *</label>'
    +'<input class="inp" id="pv-carreta-placa" style="width:100%;text-transform:uppercase;font-family:monospace" value="'+escHtml(cp)+'" placeholder="ABC1D23" maxlength="8"/></div>'
    +'</div></div>';
}
function progVeicCarretaTipoMudou(){
  var t = (document.getElementById('pv-carreta-tipo')||{}).value||'';
  var box = document.getElementById('pv-carreta-box');
  if(box) box.style.display = t ? 'grid' : 'none';
}
function progVeicCarretaSelMudou(){
  var s = document.getElementById('pv-carreta-sel');
  var p = document.getElementById('pv-carreta-placa');
  if(s && p && s.value) p.value = s.value;
}
/** Lê e valida carreta + compartilhamento do modal. null = cancelado ou inválido (nada é gravado). */
function progVeicExtrasLerModal(eqId, data, placa, eq, vAtual){
  var d = (data||'').split('T')[0];
  var ct = (document.getElementById('pv-carreta-tipo')||{}).value||'';
  var cp = progVeicNormPlaca((document.getElementById('pv-carreta-placa')||{}).value);
  if(ct && !PROG_CARRETA_TIPOS[ct]){ alert('Tipo de carreta inválido.'); return null; }
  if(ct){
    if(!cp){ alert('Informe a placa '+(ct==='compressor'?'do compressor':'da carreta de cabos')+'.'); return null; }
    if(!progVeicPlacaValida(cp)){ alert('Placa da carreta inválida: '+cp+'\\nUse o formato ABC1234 ou ABC1D23.'); return null; }
    if(cp === progVeicNormPlaca(placa)){ alert('A placa da carreta precisa ser diferente da placa do caminhão.'); return null; }
  }
  var cmp = progVeicAvaliarCompart(eqId, d, placa, eq);
  if(cmp.bloqueio){ alert('⛔ Veículo '+placa+': '+cmp.bloqueio+'.'); return null; }
  var parc = null;
  if(cmp.parceiro){
    var jaEra = !!(vAtual && String(vAtual.compartilhado_com_equipe_id||'')===cmp.parceiro && progVeicNormPlaca(vAtual.placa)===progVeicNormPlaca(placa));
    if(!jaEra && !confirm('🤝 O veículo '+placa+' já está programado para '+cmp.parceiroNome+' neste dia e horário.\\n\\nCompartilhar o veículo entre as duas equipes?')) return null;
    parc = cmp.parceiro;
  }
  if(ct){
    var outraCarreta = null;
    Object.keys(_progVeiculos||{}).some(function(k){
      var kEq = progVeicEqDaChave(k, d);
      if(!kEq || kEq===String(eqId) || kEq===parc) return false;
      var o = _progVeiculos[k];
      if(o && o.carreta_tipo && progVeicNormPlaca(o.carreta_placa)===cp){ outraCarreta = kEq; return true; }
      return false;
    });
    if(outraCarreta && !confirm('⚠ A carreta '+cp+' já está com '+progVeicNomeEquipe(outraCarreta)+' neste dia.\\n\\nConfirmar mesmo assim?')) return null;
  }
  var fv = ct ? (frt_veiculos||[]).find(function(v){ return progVeicNormPlaca(v.placa)===cp; }) : null;
  return {
    parceiroAnterior: vAtual && vAtual.compartilhado_com_equipe_id ? String(vAtual.compartilhado_com_equipe_id) : null,
    campos: {
      compartilhado_com_equipe_id: parc,
      carreta_tipo: ct || null,
      carreta_placa: ct ? cp : null,
      carreta_veiculo_id: fv && fv.id && isUUID(String(fv.id)) ? fv.id : null
    }
  };
}
/** Mensagem do banco (regras da migration) para mostrar ao usuário; '' se não for uma delas. */
function progVeicMsgErroBanco(){
  var raw = window._sbLastUpsertErr || window._sbLastUpdateErr || '';
  var msg = '';
  try{ var j = JSON.parse(raw); msg = (j && (j.message||'')) || ''; }catch(e){ msg = String(raw||''); }
  if(/carreta_placa_chk/.test(msg)) return 'Placa da carreta inválida.';
  if(/carreta_par_chk/.test(msg)) return 'Carreta precisa de tipo e placa.';
  if(/carreta_com_veiculo_chk/.test(msg)) return 'A placa da carreta precisa ser diferente da placa do caminhão.';
  if(/compart_outra_chk/.test(msg)) return 'A equipe não pode compartilhar o veículo com ela mesma.';
  if(/_chk|PGRST|violates|JWT/i.test(msg)) return '';
  return /equipe|veículo|placa/i.test(msg) ? msg.slice(0, 240) : '';
}

function progGetVeiculo(eqId, data){
  var d=(data||'').split('T')[0];`);

// ── Salvar no banco: campos novos só quando vêm do modal de Projetos; trocar a placa desfaz o compartilhamento ──
trocar(html, 'salvar payload',
`    slot        : slotNum,
    alterado_por: veiculoObj.alterado_por||(usuarioLogado?usuarioLogado.nome:'')
  };
  var insertPayload = Object.assign({`,
`    slot        : slotNum,
    alterado_por: veiculoObj.alterado_por||(usuarioLogado?usuarioLogado.nome:'')
  };
  if(veiculoObj._extras && slotNum===1){
    updatePayload.compartilhado_com_equipe_id = veiculoObj.compartilhado_com_equipe_id||null;
    updatePayload.carreta_tipo       = veiculoObj.carreta_tipo||null;
    updatePayload.carreta_placa      = veiculoObj.carreta_tipo ? progVeicNormPlaca(veiculoObj.carreta_placa) : null;
    updatePayload.carreta_veiculo_id = veiculoObj.carreta_tipo ? (veiculoObj.carreta_veiculo_id||null) : null;
  }
  var insertPayload = Object.assign({`);

trocar(html, 'salvar doUpdate',
`    var payload=Object.assign({}, updatePayload);
    if(existing.deleted_at) payload.deleted_at=null;
    return sbUpdate('prog_veiculos_dia', payload, 'id=eq.'+existing.id)`,
`    var payload=Object.assign({}, updatePayload);
    if(existing.deleted_at) payload.deleted_at=null;
    if(!veiculoObj._extras && existing.compartilhado_com_equipe_id && progVeicNormPlaca(existing.placa)!==progVeicNormPlaca(placa)){
      payload.compartilhado_com_equipe_id=null;
    }
    return sbUpdate('prog_veiculos_dia', payload, 'id=eq.'+existing.id)`);

trocar(html, 'salvar erro limpo',
`  return progFetchVeiculosDiaEquipeAll(eqId, dataStr)
  .then(function(rows){
    var existing=pickExisting(rows);`,
`  window._progVeicUltimoErro=''; window._sbLastUpdateErr=''; window._sbLastUpsertErr='';
  return progFetchVeiculosDiaEquipeAll(eqId, dataStr)
  .then(function(rows){
    var existing=pickExisting(rows);`);

trocar(html, 'salvar erro msg',
`    var ok = op==='updated'||op==='upserted';
    if(ok) console.log('[veic save OK]', Object.assign({},logCtx,{op:op}));`,
`    var ok = op==='updated'||op==='upserted';
    if(!ok) window._progVeicUltimoErro=progVeicMsgErroBanco();
    if(ok) console.log('[veic save OK]', Object.assign({},logCtx,{op:op}));`);

// ── progSetVeiculo: parceiro do compartilhamento não é "escalado em outra equipe" ──
trocar(html, 'setVeiculo conflito',
`      return k!==progVeiculoKey(eqId,data)&&k.indexOf('_'+data)>=0&&!k.endsWith('_b');
    }).filter(function(k){`,
`      return k!==progVeiculoKey(eqId,data)&&k.indexOf('_'+data)>=0&&!k.endsWith('_b')
        &&!(veiculoObj.compartilhado_com_equipe_id&&k===progVeiculoKey(veiculoObj.compartilhado_com_equipe_id,data));
    }).filter(function(k){`);

// ── Carregamento: inclui os campos novos ──
trocar(html, 'load TMA',
`      _progVeiculos[key] = {id:r.veiculo_id,placa:r.placa,modelo:r.modelo,
        justificativa:r.justificativa,alterado_por:r.alterado_por};`,
`      _progVeiculos[key] = progVeicObjDaLinha(r);`);

trocar(html, 'load Projetos',
`          _progVeiculos[_k]={
            placa:r.placa, modelo:r.modelo, id:r.veiculo_id,
            justificativa:r.justificativa, alterado_por:r.alterado_por
          };`,
`          _progVeiculos[_k]=progVeicObjDaLinha(r);`);

// ── Duplicidade: par compartilhado conta uma vez ──
trocar(html, 'conflitos par',
`      if(pv&&pv.placa) placaCount[pv.placa]=(placaCount[pv.placa]||0)+1;`,
`      if(pv&&pv.placa&&!progVeicEhSegundoDoPar(k, data, pv)) placaCount[pv.placa]=(placaCount[pv.placa]||0)+1;`);

// ── Células ──
trocar(html, 'célula extras',
`    +_progVeicKitBadgeHtml(frtV)
    +(temConflito?'<div style="font-size:9px;color:#A32D2D;font-weight:700">Veículo duplicado!</div>':'')`,
`    +_progVeicKitBadgeHtml(frtV)
    +progVeicExtrasHtml(v)
    +(temConflito?'<div style="font-size:9px;color:#A32D2D;font-weight:700">Veículo duplicado!</div>':'')`);

trocar(html, 'célula bloqueada extras',
`    +(veic.modelo?'<div style="font-size:10px;color:#888">'+veic.modelo+'</div>':'')
    +progSelo('🔒 bloqueado', PROG_SELO_COR.bloqueado, '#FEF3E2')`,
`    +(veic.modelo?'<div style="font-size:10px;color:#888">'+veic.modelo+'</div>':'')
    +progVeicExtrasHtml(veic)
    +progSelo('🔒 bloqueado', PROG_SELO_COR.bloqueado, '#FEF3E2')`);

// ── Modal de veículo ──
trocar(html, 'modal verificar extras',
`  // Aceita equipes de equipes_disp (Disponibilidade) OU equipes (Projetos)
  var eq = equipes_disp.find(function(e){return e.id===eqId;})
        || equipes.find(function(e){return e.id===eqId;});
  if(!eq) return;`,
`  var _pvEhProj = !(equipes_disp||[]).some(function(e){return e.id===eqId;}) && !!progProjetoCoreFindEquipe(eqId);
  if(_pvEhProj && slot!=='b' && !DEMO && _progVeicExtrasOk!==true && (Date.now()-(window._progVeicExtrasTentouEm||0))>60000){
    window._progVeicExtrasTentouEm=Date.now();
    progVeicExtrasVerificar().then(function(){ progAbrirSelecionarVeiculo(eqId, data, slot); });
    return;
  }
  var _pvExtras = _pvEhProj && slot!=='b' && (DEMO || _progVeicExtrasOk===true);
  // Aceita equipes de equipes_disp (Disponibilidade) OU equipes (Projetos)
  var eq = equipes_disp.find(function(e){return e.id===eqId;})
        || equipes.find(function(e){return e.id===eqId;});
  if(!eq) return;`);

trocar(html, 'modal lista compart',
`    var outraEquipe = null;
    var turnoConflito = false;
    Object.keys(_progVeiculos).forEach(function(k){
      var kData = k.split('_').pop();`,
`    var outraEquipe = null;
    var turnoConflito = false;
    var _cmp = _pvExtras ? progVeicAvaliarCompart(eqId, data, v.placa, eq) : null;
    if(!_cmp) Object.keys(_progVeiculos).forEach(function(k){
      var kData = k.split('_').pop();`);

trocar(html, 'modal lista classe',
`    if(outraEquipe && turnoConflito){
      classe = 'red'; cor = '#A32D2D'; bg = '#FCEBEB'; icone = '🔴';`,
`    if(_cmp && _cmp.bloqueio){
      classe = 'red'; cor = '#A32D2D'; bg = '#FCEBEB'; icone = '🔴';
      titulo = '⛔ ' + _cmp.bloqueio;
    } else if(_cmp && _cmp.parceiro){
      classe = 'yellow'; cor = '#533AB7'; bg = '#EEEAFB'; icone = '🤝';
      titulo = _cmp.jaCompartilhado ? 'Compartilhado com ' + _cmp.parceiroNome : 'Com ' + _cmp.parceiroNome + ' — pode compartilhar';
    } else if(outraEquipe && turnoConflito){
      classe = 'red'; cor = '#A32D2D'; bg = '#FCEBEB'; icone = '🔴';`);

trocar(html, 'modal lista bloqueado',
`      bloqueado: bloqueado || (outraEquipe !== null && turnoConflito) || (v.status==='Em uso'`,
`      bloqueado: bloqueado || (outraEquipe !== null && turnoConflito) || !!(_cmp && _cmp.bloqueio) || (v.status==='Em uso'`);

trocar(html, 'modal título',
`    +'<h3>🚗 Veículo'+_slotLbl+' — <b>'+eq.codigo+'</b></h3>'`,
`    +'<h3>🚗 Veículo'+_slotLbl+' — <b>'+escHtml(eq.codigo||eq.nome_equipe||'')+'</b></h3>'`);

trocar(html, 'modal html extras',
`    +'</div></details>'

    // Justificativa`,
`    +'</div></details>'

    +(_pvExtras ? progVeicExtrasModalHtml(eqId, data, vAtual) : '')

    // Justificativa`);

trocar(html, 'modal salvar ler extras',
`      // Verificar conflito de turno com veículo já alocado
      var conflito = false;
      var compartilhado = false;
      Object.keys(_progVeiculos).forEach(function(k){`,
`      var _extrasSel = null;
      if(_pvExtras){
        _extrasSel = progVeicExtrasLerModal(eqId, data, placa, eq, vAtual);
        if(!_extrasSel) return;
      }
      // Verificar conflito de turno com veículo já alocado
      var conflito = false;
      var compartilhado = false;
      if(!_extrasSel) Object.keys(_progVeiculos).forEach(function(k){`);

trocar(html, 'modal salvar payload',
`        alterado_por: usuarioLogado?usuarioLogado.nome:''
      };
      // Bloquear modal até banco confirmar`,
`        alterado_por: usuarioLogado?usuarioLogado.nome:''
      };
      if(_extrasSel) Object.assign(_veicPayload, _extrasSel.campos);
      // Bloquear modal até banco confirmar`);

trocar(html, 'modal salvar promise',
`      var _savePromise = _slotAtual==='b'
        ? progSetVeiculoB(eqId, data, _veicPayload)
        : progSetVeiculo(eqId, data, _veicPayload);

      _savePromise.then(function(ok){
        if(!ok){
          if(_btnSalvarEl){ _btnSalvarEl.disabled=false; _btnSalvarEl.textContent='Confirmar'; }
          progShowToast('⚠ Erro ao salvar veículo no banco. Tente novamente.','erro');
          return;
        }
        closeModal();`,
`      // Com compartilhamento/carreta: grava no banco primeiro; memória e composição só depois de aceito.
      var _savePromise = _slotAtual==='b'
        ? progSetVeiculoB(eqId, data, _veicPayload)
        : (_extrasSel
          ? progSalvarVeiculoNoBanco(eqId, data, Object.assign({_extras:true}, _veicPayload), 1).then(function(okX){
              return okX ? progSetVeiculo(eqId, data, _veicPayload) : false;
            })
          : progSetVeiculo(eqId, data, _veicPayload));

      _savePromise.then(function(ok){
        if(!ok){
          if(_btnSalvarEl){ _btnSalvarEl.disabled=false; _btnSalvarEl.textContent='Confirmar'; }
          progShowToast('⚠ '+(window._progVeicUltimoErro||'Erro ao salvar veículo no banco. Tente novamente.'),'erro');
          return;
        }
        closeModal();
        if(_extrasSel){
          var _parcNovo = _extrasSel.campos.compartilhado_com_equipe_id;
          progVeicAplicarCompartLocal(eqId, data, _parcNovo);
          progPersistVeiculosLocal(data);
          progVeicAtualizarCelulas([eqId, _parcNovo, _extrasSel.parceiroAnterior], data);
          if(_parcNovo && _parcNovo!==_extrasSel.parceiroAnterior) progShowToast('🤝 Veículo '+placa+' compartilhado com '+progVeicNomeEquipe(_parcNovo)+'.');
        } else if(_pvEhProj){
          progVeicAtualizarCelulas([eqId], data);
        }`);

// ── Remover veículo: desfaz o compartilhamento (o banco também desfaz) ──
trocar(html, 'remover confirm',
`  if(!confirm(_avEmCampo?(_avEmCampo.txt+'\\n\\nRemover o veículo desta equipe mesmo assim?'):'Remover veículo desta equipe?')) return;

  delete _progVeiculos[progVeiculoKey(eqId, d)];`,
`  var _vRem = _progVeiculos[progVeiculoKey(eqId, d)] || null;
  var _parcRem = _vRem && _vRem.compartilhado_com_equipe_id ? String(_vRem.compartilhado_com_equipe_id) : '';
  var _msgRem = (_avEmCampo?(_avEmCampo.txt+'\\n\\nRemover o veículo desta equipe mesmo assim?'):'Remover veículo desta equipe?')
    + (_parcRem ? '\\n\\nO compartilhamento com '+progVeicNomeEquipe(_parcRem)+' será desfeito.' : '');
  if(!confirm(_msgRem)) return;

  delete _progVeiculos[progVeiculoKey(eqId, d)];
  if(_parcRem) progVeicAplicarCompartLocal(eqId, d, null);`);

trocar(html, 'remover células',
`  if(btn) btn.onclick = function(){progAbrirSelecionarVeiculo(eqId, d);};

  // Persistir remoção: composição (fonte do Atualizar) + prog_veiculos_dia`,
`  if(btn) btn.onclick = function(){progAbrirSelecionarVeiculo(eqId, d);};
  if(_parcRem || progProjetoCoreFindEquipe(eqId)) progVeicAtualizarCelulas([eqId, _parcRem], d);

  // Persistir remoção: composição (fonte do Atualizar) + prog_veiculos_dia`);

// ── Versão ──
trocar(html, 'APP_VERSAO',
`  numero: '8.1.209',
  data:   '05/10/2026',
  build:  '20261005-1555',
  log: [
`,
`  numero: '8.1.210',
  data:   '05/10/2026',
  build:  '20261005-1730',
  log: [
    {v:'8.1.210', d:'05/10/2026', itens:[
      'Programação de Projetos: caminhão compartilhado por 2 equipes no mesmo dia e horário. Ao escolher uma placa que já está com outra equipe no mesmo horário, o sistema pergunta se o veículo será compartilhado e marca as duas equipes (🤝 na linha da equipe; não aparece mais "Veículo duplicado"). Uma 3ª equipe fica bloqueada. Para desfazer, troque a placa ou remova o veículo. O banco garante as mesmas regras.',
      'Programação de Projetos: "Sai com carreta?" no veículo da equipe — Carreta de cabos ou Compressor, com a placa da carreta obrigatória (lista das carretinhas da frota ou placa digitada). Aparece como 🚛 na linha da equipe.',
      'Programação TMA e Portaria sem mudança. SQL: supabase/migrations/20261005170000_prog_veiculos_compartilhado_carreta.sql (já aplicada).',
    ]},
`);

trocar(html, 'script ?v=', '?v=8.1.209"', '?v=8.1.210"', 7);
trocar(sw, 'SW_VERSION', "const SW_VERSION   = 'cena-8.1.209';", "const SW_VERSION   = 'cena-8.1.210';");

salvar(ARQ, html);
salvar(ARQ_SW, sw);
console.log('gravado: ' + ARQ + ' (' + (html.crlf ? 'CRLF' : 'LF') + '), ' + ARQ_SW + ' (' + (sw.crlf ? 'CRLF' : 'LF') + ')');
