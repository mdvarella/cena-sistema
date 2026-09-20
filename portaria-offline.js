/* =============================================================================
   ERP CENA — PORTARIA-OFFLINE-1
   IndexedDB + fila persistente + sync automático.
   Não usa localStorage para a fila operacional.
   device_id (não sensível) pode ficar em localStorage.
   ============================================================================= */
(function(global){
'use strict';

var PORT_OFF_DB = 'cena_portaria_offline';
var PORT_OFF_DB_VER = 1;
var PORT_OFF_TTL_MS = 48 * 3600 * 1000;
var PORT_OFF_LOCK_MS = 2500;
var PORT_OFF_RETRY = [0, 4000, 12000, 30000, 60000];

var _db = null;
var _syncing = false;
var _syncTimer = null;
var _probeOnline = null; // true/false/null
var _locks = {};
var _backoffIdx = 0;
var _lastQuotaWarn = 0;

function portOffUuid(){
  if(typeof gerarUUID==='function') return gerarUUID();
  if(global.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c){
    var r=Math.random()*16|0, v=c==='x'?r:(r&0x3|0x8);
    return v.toString(16);
  });
}
function portOffNovoId(){ return portOffUuid(); }

function portOffDeviceId(){
  var k='cena_portaria_device_id';
  try{
    var id=localStorage.getItem(k);
    if(id && id.length>=8) return id;
    id=portOffUuid();
    localStorage.setItem(k, id);
    return id;
  }catch(e){
    return 'dev-temp-'+String(Date.now());
  }
}

function portOffNow(){
  var d=new Date();
  return {
    utc: d.toISOString(),
    offset: -d.getTimezoneOffset(),
    ms: d.getTime()
  };
}

function portOffUsuario(){
  var u=typeof usuarioLogado!=='undefined'?usuarioLogado:null;
  if(!u) return {id:null, nome:'Portaria'};
  return {
    id: u.id||u.usuario_id||u.auth_user_id||null,
    nome: (u.nome||u.nome_completo||u.email||'Portaria')
  };
}

function portOffNavOnline(){ return typeof navigator==='undefined' ? true : !!navigator.onLine; }

function portOffIsOnline(){
  if(_probeOnline===false) return false;
  if(!portOffNavOnline()) return false;
  if(_probeOnline===true) return true;
  return portOffNavOnline();
}

function portOffSessaoOk(){
  try{
    if(typeof sbAuthJwtIsAuthenticated==='function' && typeof _sbAuthToken!=='undefined'){
      if(sbAuthJwtIsAuthenticated(_sbAuthToken)) return true;
    }
  }catch(e){}
  // Login MD5 legado da Portaria: gravação atual já usa fallback anon.
  // Não exigimos JWT para não quebrar o tablet; apenas bloqueamos se
  // sbInsert/sbUpdate recusarem. Tokens/senhas nunca são gravados no IDB.
  return true;
}

function portOffToast(msg, tipo){
  if(typeof progShowToast==='function') progShowToast(msg, tipo);
}

/* ── IndexedDB ─────────────────────────────────────────── */
function portOffDb(){
  if(_db) return Promise.resolve(_db);
  if(!global.indexedDB) return Promise.reject(new Error('IndexedDB indisponível'));
  return new Promise(function(resolve, reject){
    var req=indexedDB.open(PORT_OFF_DB, PORT_OFF_DB_VER);
    req.onupgradeneeded=function(ev){
      var db=ev.target.result;
      if(!db.objectStoreNames.contains('portaria_eventos')){
        var evs=db.createObjectStore('portaria_eventos',{keyPath:'event_id'});
        evs.createIndex('status_sync','status_sync',{unique:false});
        evs.createIndex('data_hora_evento','data_hora_evento',{unique:false});
        evs.createIndex('tipo_evento','tipo_evento',{unique:false});
      }
      if(!db.objectStoreNames.contains('portaria_cache')){
        db.createObjectStore('portaria_cache',{keyPath:'chave'});
      }
      if(!db.objectStoreNames.contains('portaria_sync_meta')){
        db.createObjectStore('portaria_sync_meta',{keyPath:'chave'});
      }
      if(!db.objectStoreNames.contains('portaria_blobs')){
        db.createObjectStore('portaria_blobs',{keyPath:'blob_id'});
      }
    };
    req.onsuccess=function(){ _db=req.result; resolve(_db); };
    req.onerror=function(){ reject(req.error||new Error('IDB open fail')); };
  });
}

function portOffTx(store, mode){
  return portOffDb().then(function(db){
    return db.transaction(store, mode||'readonly').objectStore(store);
  });
}

function portOffReq(req){
  return new Promise(function(resolve, reject){
    req.onsuccess=function(){ resolve(req.result); };
    req.onerror=function(){ reject(req.error); };
  });
}

function portOffPut(store, obj){
  return portOffDb().then(function(db){
    return portOffReq(db.transaction(store,'readwrite').objectStore(store).put(obj));
  });
}
function portOffGet(store, key){
  return portOffDb().then(function(db){
    return portOffReq(db.transaction(store,'readonly').objectStore(store).get(key));
  });
}
function portOffDel(store, key){
  return portOffDb().then(function(db){
    return portOffReq(db.transaction(store,'readwrite').objectStore(store).delete(key));
  });
}
function portOffGetAll(store){
  return portOffDb().then(function(db){
    return portOffReq(db.transaction(store,'readonly').objectStore(store).getAll());
  });
}

function portOffPutEvent(ev){ return portOffPut('portaria_eventos', ev); }
function portOffGetEvent(id){ return portOffGet('portaria_eventos', id); }
function portOffListEvents(){ return portOffGetAll('portaria_eventos').then(function(r){ return r||[]; }); }

function portOffCachePut(chave, valor){
  return portOffPut('portaria_cache', {chave:chave, valor:valor, gravado_em:new Date().toISOString()});
}
function portOffCacheGet(chave){
  return portOffGet('portaria_cache', chave).then(function(r){ return r ? r.valor : null; });
}
function portOffMetaPut(chave, valor){
  return portOffPut('portaria_sync_meta', {chave:chave, valor:valor, gravado_em:new Date().toISOString()});
}
function portOffMetaGet(chave){
  return portOffGet('portaria_sync_meta', chave).then(function(r){ return r ? r.valor : null; });
}

/* ── Blobs (fotos) ─────────────────────────────────────── */
function portOffDataUrlToBlob(dataUrl){
  if(!dataUrl) return null;
  if(typeof Blob!=='undefined' && dataUrl instanceof Blob) return dataUrl;
  var s=String(dataUrl);
  if(s.indexOf('data:')!==0) return null;
  try{
    var parts=s.split(',');
    var meta=parts[0]||'';
    var b64=parts[1]||'';
    var mime=(meta.match(/data:([^;]+)/)||[])[1]||'image/jpeg';
    var bin=atob(b64);
    var arr=new Uint8Array(bin.length);
    for(var i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
    return new Blob([arr], {type:mime});
  }catch(e){ return null; }
}
function portOffBlobToDataUrl(blob){
  if(!blob) return Promise.resolve('');
  if(typeof blob==='string') return Promise.resolve(blob);
  return new Promise(function(resolve){
    var fr=new FileReader();
    fr.onload=function(){ resolve(String(fr.result||'')); };
    fr.onerror=function(){ resolve(''); };
    fr.readAsDataURL(blob);
  });
}
function portOffPutBlob(blob){
  if(!blob) return Promise.resolve(null);
  var id=portOffUuid();
  return portOffPut('portaria_blobs', {blob_id:id, blob:blob, criado_em:new Date().toISOString()}).then(function(){ return id; });
}
function portOffGetBlob(id){
  if(!id) return Promise.resolve(null);
  return portOffGet('portaria_blobs', id).then(function(r){ return r ? r.blob : null; });
}
function portOffDelBlob(id){
  if(!id) return Promise.resolve();
  return portOffDel('portaria_blobs', id).catch(function(){});
}

function portOffGuardarFotos(mapa){
  var out={};
  var jobs=[];
  Object.keys(mapa||{}).forEach(function(k){
    var v=mapa[k];
    if(Array.isArray(v)){
      out[k]=[];
      v.forEach(function(item, i){
        var src=typeof item==='string'?item:(item&&(item.b64||item.url||item.src))||'';
        var blob=portOffDataUrlToBlob(src);
        if(!blob) return;
        jobs.push(portOffPutBlob(blob).then(function(id){
          if(id) out[k].push({i:i, blob_id:id, nome:(item&&item.nome)||('foto_'+(i+1))});
        }));
      });
    } else {
      var blob=portOffDataUrlToBlob(v);
      if(!blob) return;
      jobs.push(portOffPutBlob(blob).then(function(id){ if(id) out[k]=id; }));
    }
  });
  return Promise.all(jobs).then(function(){ return out; });
}

function portOffRestaurarFotos(refs){
  refs=refs||{};
  var saida={};
  var jobs=[];
  Object.keys(refs).forEach(function(k){
    var v=refs[k];
    if(Array.isArray(v)){
      saida[k]=new Array(v.length);
      v.forEach(function(it, idx){
        jobs.push(portOffGetBlob(it.blob_id).then(portOffBlobToDataUrl).then(function(url){
          saida[k][idx]={nome:it.nome, b64:url, url:url};
        }));
      });
    } else if(typeof v==='string'){
      jobs.push(portOffGetBlob(v).then(portOffBlobToDataUrl).then(function(url){ saida[k]=url; }));
    }
  });
  return Promise.all(jobs).then(function(){ return saida; });
}

function portOffApagarFotos(refs){
  refs=refs||{};
  var ids=[];
  Object.keys(refs).forEach(function(k){
    var v=refs[k];
    if(Array.isArray(v)) v.forEach(function(it){ if(it && it.blob_id) ids.push(it.blob_id); });
    else if(typeof v==='string') ids.push(v);
  });
  return Promise.all(ids.map(portOffDelBlob));
}

/* ── Trava anti duplo clique ───────────────────────────── */
function portOffTravar(chave){
  var k=String(chave||'x');
  var agora=Date.now();
  if(_locks[k] && agora-_locks[k]<PORT_OFF_LOCK_MS) return false;
  _locks[k]=agora;
  setTimeout(function(){ if(_locks[k]===agora) delete _locks[k]; }, PORT_OFF_LOCK_MS);
  return true;
}

/* ── Regra em campo ────────────────────────────────────── */
function portEstaEmCampo(p){
  if(!p || p.deleted_at || p.status==='Cancelado') return false;
  if(p.status==='Retornado') return false;
  if(p.data_retorno) return false;
  return p.status==='Em campo';
}

/* ── Enfileirar (grava local PRIMEIRO) ─────────────────── */
function portOffEventoBase(tipo, extra){
  var now=portOffNow();
  var u=portOffUsuario();
  extra=extra||{};
  return {
    event_id: extra.event_id || portOffUuid(),
    tipo_evento: tipo,
    equipe_id: extra.equipe_id||null,
    veiculo_id: extra.veiculo_id||null,
    programacao_id: extra.programacao_id||null,
    depends_on: extra.depends_on||null,
    data_hora_evento: extra.data_hora_evento || now.utc,
    timezone_offset: extra.timezone_offset != null ? extra.timezone_offset : now.offset,
    usuario_id: u.id,
    usuario_nome: u.nome,
    dispositivo_id: portOffDeviceId(),
    criado_offline: !portOffIsOnline(),
    data_hora_criacao_local: now.utc,
    status_sync: 'PENDENTE',
    tentativas_sync: 0,
    ultimo_erro: null,
    data_hora_sincronizacao: null,
    payload: extra.payload||{}
  };
}

function portOffEnfileirar(ev){
  return portOffPutEvent(ev).then(function(){
    portOffRenderIndicador();
    portOffAgendarSync();
    return ev;
  });
}

function portOffRegistrarSaida(saida){
  if(!saida) return Promise.resolve(null);
  var now=portOffNow();
  if(!saida.id || (typeof isUUID==='function' && !isUUID(String(saida.id)))){
    saida.id=portOffUuid();
  }
  saida.offline_event_id=saida.offline_event_id||saida.id;
  saida.registrado_em=saida.registrado_em||saida.data_saida||now.utc;
  saida.data_saida=saida.data_saida||now.utc;
  saida.dispositivo_id=saida.dispositivo_id||portOffDeviceId();
  saida.timezone_offset=saida.timezone_offset!=null?saida.timezone_offset:now.offset;
  saida.registrado_offline=!!(!portOffIsOnline());
  saida._sync_status='PENDENTE';

  var fotos={
    km: saida.km_foto_url,
    carga: saida.foto_carga_saida_b64,
    extras: Array.isArray(saida.fotos_carga_extras)?saida.fotos_carga_extras:[]
  };
  return portOffGuardarFotos(fotos).then(function(refs){
    var slim=Object.assign({}, saida);
    delete slim.km_foto_url;
    delete slim.foto_carga_saida_b64;
    delete slim.fotos_carga_extras;
    delete slim.foto_odometro_b64;
    delete slim.foto_extra_1_b64;
    delete slim.foto_extra_2_b64;
    var ev=portOffEventoBase('SAIDA', {
      event_id: saida.offline_event_id,
      equipe_id: saida.equipe_id||null,
      veiculo_id: saida.veiculo_id||null,
      data_hora_evento: saida.data_saida,
      timezone_offset: saida.timezone_offset,
      payload: {saida:slim, fotos:refs}
    });
    return portOffEnfileirar(ev);
  }).then(function(ev){
    portOffSyncPendentes();
    return ev;
  }).catch(function(e){
    console.warn('[Portaria OFF] fila saida', e);
    portOffToast('Registro ficou neste tablet. Sincroniza quando a internet voltar.');
    return null;
  });
}

function portOffRegistrarRetorno(saida, campos){
  if(!saida) return Promise.resolve(null);
  campos=campos||{};
  var now=portOffNow();
  var eventId=portOffUuid();
  saida.retorno_offline_event_id=eventId;
  saida._sync_status='PENDENTE';
  var fotos={ retorno: campos.foto_carga_retorno_b64 || saida.foto_carga_retorno_b64 };
  var depends=saida.offline_event_id||saida.id||null;
  return portOffGuardarFotos(fotos).then(function(refs){
    var ev=portOffEventoBase('RETORNO', {
      event_id: eventId,
      equipe_id: saida.equipe_id||null,
      veiculo_id: saida.veiculo_id||null,
      depends_on: depends,
      data_hora_evento: campos.data_retorno || saida.data_retorno || now.utc,
      payload: {
        saida_id: saida.id,
        saida_offline_event_id: saida.offline_event_id||null,
        placa: saida.placa||null,
        km_retorno: campos.km_retorno,
        data_retorno: campos.data_retorno || saida.data_retorno,
        obs_retorno: campos.obs_retorno||null,
        retorno_registrado_por: campos.retorno_registrado_por,
        status_devolucao: campos.status_devolucao||null,
        base_retorno: campos.base_retorno||saida.base_retorno||null,
        foto_carga_retorno_ts: campos.foto_carga_retorno_ts||null,
        fotos: refs
      }
    });
    return portOffEnfileirar(ev);
  }).then(function(ev){
    portOffSyncPendentes();
    return ev;
  }).catch(function(e){
    console.warn('[Portaria OFF] fila retorno', e);
    portOffToast('Retorno ficou neste tablet. Sincroniza quando a internet voltar.');
    return null;
  });
}

function portOffRegistrarAuth(mov, autorizado){
  var now=portOffNow();
  var eventId=portOffUuid();
  var ev=portOffEventoBase(mov.tipo==='saida'?'AUTH_SAIDA':'AUTH_ENTRADA', {
    event_id: eventId,
    data_hora_evento: now.utc,
    payload: {
      mov: Object.assign({offline_event_id:eventId, registrado_em:now.utc, dispositivo_id:portOffDeviceId()}, mov),
      autorizado_id: autorizado && autorizado.id,
      status_acesso: autorizado && autorizado.status_acesso
    }
  });
  return portOffEnfileirar(ev).then(function(){ portOffSyncPendentes(); return ev; });
}

function portOffRegistrarVisita(tipo, dados, idLocal){
  var now=portOffNow();
  var eventId=portOffUuid();
  var fotos={
    visitante: dados.foto_visitante,
    documento: dados.foto_documento
  };
  return portOffGuardarFotos(fotos).then(function(refs){
    var slim=Object.assign({}, dados);
    delete slim.foto_visitante;
    delete slim.foto_documento;
    var ev=portOffEventoBase(tipo, {
      event_id: eventId,
      data_hora_evento: now.utc,
      payload: {visita:slim, id_local:idLocal||dados.id, fotos:refs}
    });
    return portOffEnfileirar(ev);
  }).then(function(ev){ portOffSyncPendentes(); return ev; });
}

/* ── Probe de conexão (não só navigator.onLine) ────────── */
function portOffProbe(){
  if(!portOffNavOnline()){
    _probeOnline=false;
    return Promise.resolve(false);
  }
  if(typeof SB==='undefined' || !SB.url){
    _probeOnline=true;
    return Promise.resolve(true);
  }
  var ctrl=typeof AbortController!=='undefined'?new AbortController():null;
  var t=setTimeout(function(){ if(ctrl) try{ctrl.abort();}catch(e){} }, 4000);
  var h={'apikey':SB.key,'Authorization':'Bearer '+((typeof _sbAuthToken!=='undefined'&&_sbAuthToken)||SB.key)};
  // Alvo que responde 200 (a raiz /rest/v1/ devolve 401 e polui o console).
  // HEAD leve; qualquer resposta HTTP significa "rede de pé".
  return fetch(SB.url+'/rest/v1/frotas_portaria_saidas?select=id&limit=1', {method:'HEAD', headers:h, cache:'no-store', signal:ctrl?ctrl.signal:undefined})
    .then(function(){ clearTimeout(t); _probeOnline=true; return true; })
    .catch(function(){
      clearTimeout(t);
      // Abort/erro de rede NÃO força offline: se o navegador diz que há
      // internet, deixa o sync tentar (insert que falhar fica pendente e
      // re-tenta). Evita "sync travado por falso offline".
      _probeOnline=portOffNavOnline();
      return _probeOnline;
    });
}

/* ── Sync ──────────────────────────────────────────────── */
function portOffAgendarSync(){
  if(_syncTimer) return;
  var wait=PORT_OFF_RETRY[Math.min(_backoffIdx, PORT_OFF_RETRY.length-1)];
  _syncTimer=setTimeout(function(){
    _syncTimer=null;
    portOffSyncPendentes();
  }, wait);
}

function portOffOrdenarFila(lista){
  var peso={SAIDA:1, VISITA_ENTRADA:1, AUTH_ENTRADA:2, AUTH_SAIDA:2, RETORNO:3, VISITA_SAIDA:3, VISITA_UPDATE:4};
  return (lista||[]).slice().sort(function(a,b){
    var pa=peso[a.tipo_evento]||5, pb=peso[b.tipo_evento]||5;
    if(pa!==pb) return pa-pb;
    return String(a.data_hora_evento||'').localeCompare(String(b.data_hora_evento||''));
  });
}

function portOffErroAuth(msg){
  var s=String(msg||'');
  return /jwt|not authenticated|401|sessão/i.test(s);
}

function portOffColunaAusente(msg){
  var s=String(msg||'');
  return /PGRST204|schema cache|column/i.test(s);
}

// Colunas do sql_portaria_offline_1 que NÃO existem na tabela (SQL não aplicado).
// Consultá-las gera 400; retornamos null direto (a dedupe cai no id do registro).
var PORT_OFF_COLS_AUSENTES = {
  'frotas_portaria_saidas': {offline_event_id:1, retorno_offline_event_id:1}
};
async function portOffFetchPorEventId(tabela, col, id){
  if(!id || typeof sbFetch!=='function') return null;
  if(PORT_OFF_COLS_AUSENTES[tabela] && PORT_OFF_COLS_AUSENTES[tabela][col]) return null;
  try{
    var rows=await sbFetch(tabela,{filters:[col+'=eq.'+id], limit:1});
    return rows && rows[0] ? rows[0] : null;
  }catch(e){ return null; }
}

async function portOffSyncUm(ev){
  if(!ev || ev.status_sync==='SINCRONIZADO' || ev.status_sync==='CONFLITO') return ev;
  if(ev.depends_on){
    var dep=await portOffGetEvent(ev.depends_on);
    if(dep && dep.status_sync!=='SINCRONIZADO'){
      if(dep.status_sync==='CONFLITO' || dep.status_sync==='ERRO'){
        ev.status_sync='ERRO';
        ev.ultimo_erro='Aguardando evento anterior ('+dep.status_sync+')';
        await portOffPutEvent(ev);
        return ev;
      }
      return ev; // ainda pendente — tenta depois
    }
  }
  ev.status_sync='SINCRONIZANDO';
  ev.tentativas_sync=(ev.tentativas_sync||0)+1;
  await portOffPutEvent(ev);

  try{
    if(ev.tipo_evento==='SAIDA') await portOffSyncSaida(ev);
    else if(ev.tipo_evento==='RETORNO') await portOffSyncRetorno(ev);
    else if(ev.tipo_evento==='AUTH_ENTRADA' || ev.tipo_evento==='AUTH_SAIDA') await portOffSyncAuth(ev);
    else if(ev.tipo_evento==='VISITA_ENTRADA' || ev.tipo_evento==='VISITA_SAIDA' || ev.tipo_evento==='VISITA_UPDATE') await portOffSyncVisita(ev);
    else {
      ev.status_sync='ERRO';
      ev.ultimo_erro='Tipo desconhecido: '+ev.tipo_evento;
    }
  }catch(e){
    var msg=(e && (e.message||e.hint)) || String(e||'erro');
    if(portOffErroAuth(msg)){
      ev.status_sync='PENDENTE';
      ev.ultimo_erro='Sessão expirada. Faça login para sincronizar. Os registros locais foram preservados.';
    } else {
      ev.status_sync='ERRO';
      ev.ultimo_erro=msg.slice(0,280);
    }
  }
  await portOffPutEvent(ev);
  return ev;
}

async function portOffSyncSaida(ev){
  var p=ev.payload||{};
  var saida=Object.assign({}, p.saida||{});
  var ja=await portOffFetchPorEventId('frotas_portaria_saidas','offline_event_id', ev.event_id);
  if(!ja && saida.id) ja=await portOffFetchPorEventId('frotas_portaria_saidas','id', saida.id);
  if(ja && ja.id){
    ev.status_sync='SINCRONIZADO';
    ev.data_hora_sincronizacao=new Date().toISOString();
    ev.payload.server_id=ja.id;
    portOffAplicarSaidaMemoria(saida, ja);
    await portOffApagarFotos(p.fotos);
    p.fotos=null;
    return;
  }
  var fotos=await portOffRestaurarFotos(p.fotos);
  if(fotos.km) saida.km_foto_url=fotos.km;
  if(fotos.carga) saida.foto_carga_saida_b64=fotos.carga;
  if(fotos.extras) saida.fotos_carga_extras=fotos.extras;
  saida.offline_event_id=ev.event_id;
  saida.registrado_em=ev.data_hora_evento;
  saida.sincronizado_em=new Date().toISOString();
  saida.registrado_offline=!!ev.criado_offline;
  saida.dispositivo_id=ev.dispositivo_id;
  saida.timezone_offset=ev.timezone_offset;
  saida.data_saida=ev.data_hora_evento; // NUNCA recálculo no sync
  var r=await portInsertSaidaDB(saida);
  if(!r || !r[0]){
    ja=await portOffFetchPorEventId('frotas_portaria_saidas','offline_event_id', ev.event_id);
    if(!ja && saida.id) ja=await portOffFetchPorEventId('frotas_portaria_saidas','id', saida.id);
    if(ja && ja.id){
      ev.status_sync='SINCRONIZADO';
      ev.data_hora_sincronizacao=new Date().toISOString();
      ev.payload.server_id=ja.id;
      portOffAplicarSaidaMemoria(saida, ja);
      await portOffApagarFotos(p.fotos);
      p.fotos=null;
      return;
    }
    throw new Error('Servidor não confirmou a saída');
  }
  ev.status_sync='SINCRONIZADO';
  ev.data_hora_sincronizacao=saida.sincronizado_em;
  ev.payload.server_id=r[0].id;
  portOffAplicarSaidaMemoria(saida, r[0]);
  await portOffApagarFotos(p.fotos);
  p.fotos=null;
}

function portOffAplicarSaidaMemoria(local, server){
  if(typeof frt_portaria==='undefined' || !frt_portaria) return;
  var ix=frt_portaria.findIndex(function(p){
    return p && (String(p.id)===String(local.id) || String(p.offline_event_id)===String(local.offline_event_id||local.id));
  });
  if(ix>=0){
    frt_portaria[ix].id=server.id||frt_portaria[ix].id;
    frt_portaria[ix]._sync_status='SINCRONIZADO';
    if(server.offline_event_id) frt_portaria[ix].offline_event_id=server.offline_event_id;
  }
}

async function portOffSyncRetorno(ev){
  var p=ev.payload||{};
  var sid=p.saida_id;
  if(p.saida_offline_event_id){
    var saidaEv=await portOffGetEvent(p.saida_offline_event_id);
    if(saidaEv && saidaEv.payload && saidaEv.payload.server_id) sid=saidaEv.payload.server_id;
  }
  if(!sid || (typeof isUUID==='function' && !isUUID(String(sid)))){
    throw new Error('Saída ainda sem ID no servidor');
  }
  var rows=null;
  try{ rows=await sbFetch('frotas_portaria_saidas',{filters:['id=eq.'+sid], limit:1}); }catch(e){ rows=null; }
  var srv=rows && rows[0];
  if(!srv){
    var byRet=await portOffFetchPorEventId('frotas_portaria_saidas','retorno_offline_event_id', ev.event_id);
    if(byRet){
      ev.status_sync='SINCRONIZADO';
      ev.data_hora_sincronizacao=new Date().toISOString();
      await portOffApagarFotos(p.fotos);
      p.fotos=null;
      return;
    }
    throw new Error('Saída não encontrada no servidor');
  }
  if(srv.retorno_offline_event_id && String(srv.retorno_offline_event_id)===String(ev.event_id)){
    ev.status_sync='SINCRONIZADO';
    ev.data_hora_sincronizacao=new Date().toISOString();
    await portOffApagarFotos(p.fotos);
    p.fotos=null;
    return;
  }
  if(srv.status==='Retornado' && srv.data_retorno){
    ev.status_sync='CONFLITO';
    ev.ultimo_erro='Este evento não foi aplicado porque a equipe já possui retorno registrado no servidor.';
    portOffMarcarMemoriaConflito(sid);
    return;
  }
  var fotos=await portOffRestaurarFotos(p.fotos);
  var fotoUrl=fotos.retorno||null;
  if(fotoUrl && String(fotoUrl).indexOf('data:')===0 && typeof portUploadFotoSaida==='function'){
    try{ fotoUrl=await portUploadFotoSaida(fotoUrl,'retorno')||fotoUrl; }catch(e){}
  }
  var syncEm=new Date().toISOString();
  var patch={
    status:'Retornado',
    km_retorno:p.km_retorno,
    data_retorno:p.data_retorno, // horário REAL
    base_retorno:p.base_retorno||null,
    obs_retorno:p.obs_retorno||null,
    retorno_registrado_por:p.retorno_registrado_por||null,
    status_devolucao:p.status_devolucao||null,
    foto_carga_retorno_b64:fotoUrl||null,
    foto_carga_retorno_ts:p.foto_carga_retorno_ts||null
    // NÃO enviar colunas do sql_portaria_offline_1 (dispositivo_id/retorno_offline_event_id/
    // sincronizado_em) — não existem na tabela (SQL não aplicado) e causavam 400 PGRST204.
  };
  var ok=await sbUpdate('frotas_portaria_saidas', patch, 'id=eq.'+sid);
  if(ok===false && portOffColunaAusente('column')){
    ok=await sbUpdate('frotas_portaria_saidas', {
      status:'Retornado', km_retorno:p.km_retorno, data_retorno:p.data_retorno,
      base_retorno:p.base_retorno||null, status_devolucao:p.status_devolucao||null,
      obs_retorno:p.obs_retorno||null, retorno_registrado_por:p.retorno_registrado_por||null,
      foto_carga_retorno_b64:fotoUrl||null
    }, 'id=eq.'+sid);
  }
  if(ok===false){
    var mini=await sbUpdate('frotas_portaria_saidas', {
      status:'Retornado', km_retorno:p.km_retorno, data_retorno:p.data_retorno,
      obs_retorno:p.obs_retorno||null, retorno_registrado_por:p.retorno_registrado_por||null
    }, 'id=eq.'+sid);
    if(mini===false) throw new Error('Servidor não confirmou o retorno');
  }
  ev.status_sync='SINCRONIZADO';
  ev.data_hora_sincronizacao=syncEm;
  await portOffApagarFotos(p.fotos);
  p.fotos=null;
  if(typeof frt_portaria!=='undefined'){
    var mem=(frt_portaria||[]).find(function(x){return String(x.id)===String(sid);});
    if(mem) mem._sync_status='SINCRONIZADO';
  }
}

function portOffMarcarMemoriaConflito(sid){
  if(typeof frt_portaria==='undefined') return;
  var mem=(frt_portaria||[]).find(function(x){return String(x.id)===String(sid);});
  if(mem) mem._sync_status='CONFLITO';
}

async function portOffSyncAuth(ev){
  var p=ev.payload||{};
  var mov=Object.assign({}, p.mov||{});
  var ja=await portOffFetchPorEventId('portaria_autorizados_mov','offline_event_id', ev.event_id);
  if(ja){
    ev.status_sync='SINCRONIZADO';
    ev.data_hora_sincronizacao=new Date().toISOString();
    return;
  }
  if(!mov.autorizado_id) throw new Error('Autorizado sem ID');
  var rows=null;
  try{ rows=await sbFetch('portaria_autorizados',{filters:['id=eq.'+mov.autorizado_id], limit:1}); }catch(e){}
  var srv=rows && rows[0];
  if(srv){
    var st=srv.status_acesso||'Fora';
    if(mov.tipo==='entrada' && st==='No local'){
      ev.status_sync='CONFLITO';
      ev.ultimo_erro='Este evento não foi aplicado porque a pessoa já está no local no servidor.';
      return;
    }
    if(mov.tipo==='saida' && st!=='No local'){
      ev.status_sync='CONFLITO';
      ev.ultimo_erro='Este evento não foi aplicado porque a pessoa já saiu no servidor.';
      return;
    }
  }
  var novoStatus=p.status_acesso;
  var up=await sbUpdate('portaria_autorizados', {
    status_acesso: novoStatus,
    atualizado_por: mov.liberado_por||null
  }, 'id=eq.'+mov.autorizado_id);
  if(up===false) throw new Error('Falha ao atualizar autorizado');
  var insPayload=Object.assign({}, mov);
  var r=await sbInsert('portaria_autorizados_mov', insPayload, {silent:true});
  if(!r){
    delete insPayload.offline_event_id;
    delete insPayload.registrado_em;
    delete insPayload.dispositivo_id;
    r=await sbInsert('portaria_autorizados_mov', insPayload, {silent:true});
  }
  if(!r) throw new Error('Servidor não confirmou o movimento');
  ev.status_sync='SINCRONIZADO';
  ev.data_hora_sincronizacao=new Date().toISOString();
}

async function portOffSyncVisita(ev){
  var p=ev.payload||{};
  var dados=Object.assign({}, p.visita||{});
  var fotos=await portOffRestaurarFotos(p.fotos);
  if(fotos.visitante) dados.foto_visitante=fotos.visitante;
  if(fotos.documento) dados.foto_documento=fotos.documento;
  dados.offline_event_id=ev.event_id;
  dados.registrado_em=ev.data_hora_evento;
  dados.dispositivo_id=ev.dispositivo_id;
  if(ev.tipo_evento==='VISITA_ENTRADA'){
    var ja=await portOffFetchPorEventId('portaria_visitas','offline_event_id', ev.event_id);
    if(ja){
      ev.status_sync='SINCRONIZADO';
      ev.data_hora_sincronizacao=new Date().toISOString();
      await portOffApagarFotos(p.fotos);
      return;
    }
    var body=typeof _semId==='function'?_semId(dados):dados;
    var r=await sbInsert('portaria_visitas', body, {silent:true});
    if(!r){
      delete body.offline_event_id; delete body.registrado_em; delete body.dispositivo_id;
      r=await sbInsert('portaria_visitas', body, {silent:true});
    }
    if(!r) throw new Error('Servidor não confirmou o visitante');
    if(r[0] && r[0].id && typeof portaria_visitas!=='undefined'){
      var loc=(portaria_visitas||[]).find(function(v){return String(v.id)===String(p.id_local);});
      if(loc) loc.id=r[0].id;
      p.server_id=r[0].id;
      var todos=await portOffListEvents();
      var i;
      for(i=0;i<todos.length;i++){
        var o=todos[i];
        if(!o || o.event_id===ev.event_id) continue;
        if((o.tipo_evento==='VISITA_SAIDA'||o.tipo_evento==='VISITA_UPDATE') && o.payload && String(o.payload.id_local)===String(p.id_local)){
          o.payload.id_local=r[0].id;
          o.depends_on=ev.event_id;
          await portOffPutEvent(o);
        }
      }
    }
  } else {
    var id=p.id_local||dados.id;
    if(!id || (typeof isUUID==='function' && !isUUID(String(id)))){
      throw new Error('Visita local ainda sem ID no servidor');
    }
    var patch={hora_saida:dados.hora_saida, status:dados.status||'Saiu'};
    var ok=await sbUpdate('portaria_visitas', patch, 'id=eq.'+id);
    if(ok===false) throw new Error('Servidor não confirmou a saída do visitante');
  }
  ev.status_sync='SINCRONIZADO';
  ev.data_hora_sincronizacao=new Date().toISOString();
  await portOffApagarFotos(p.fotos);
  p.fotos=null;
}

async function portOffSyncPendentes(){
  if(_syncing) return;
  if(typeof DEMO!=='undefined' && DEMO) return;
  portOffRenderIndicador();
  var online=await portOffProbe();
  if(!online){
    portOffRenderIndicador();
    return;
  }
  if(!portOffSessaoOk()){
    portOffRenderIndicador();
    return;
  }
  var lista=await portOffListEvents();
  var fila=portOffOrdenarFila(lista.filter(function(e){
    return e && (e.status_sync==='PENDENTE' || e.status_sync==='ERRO' || e.status_sync==='SINCRONIZANDO');
  }));
  if(!fila.length){
    _backoffIdx=0;
    portOffRenderIndicador();
    await portOffLimparCacheSincronizado();
    return;
  }
  _syncing=true;
  portOffRenderIndicador();
  var i, falhou=false;
  for(i=0;i<fila.length;i++){
    try{
      await portOffSyncUm(fila[i]);
    }catch(e){ falhou=true; }
    portOffRenderIndicador();
  }
  _syncing=false;
  if(falhou) _backoffIdx=Math.min(_backoffIdx+1, PORT_OFF_RETRY.length-1);
  else _backoffIdx=0;
  portOffRenderIndicador();
  await portOffLimparCacheSincronizado();
  if(typeof portRenderEquipesDia==='function') try{ portRenderEquipesDia(); }catch(e){}
  if(typeof portRenderRetorno==='function'){
    var el=document.getElementById('port-aba-retorno');
    if(el && el.style.display!=='none') try{ portRenderRetorno(); }catch(e2){}
  }
  var ainda=await portOffContagem();
  if(ainda.pendente+ainda.erro>0) portOffAgendarSync();
}

function portOffContagemFrom(lista){
  var o={pendente:0, erro:0, conflito:0, sync:0, sincronizando:0};
  (lista||[]).forEach(function(e){
    if(!e) return;
    if(e.status_sync==='PENDENTE') o.pendente++;
    else if(e.status_sync==='ERRO') o.erro++;
    else if(e.status_sync==='CONFLITO') o.conflito++;
    else if(e.status_sync==='SINCRONIZANDO') o.sincronizando++;
    else if(e.status_sync==='SINCRONIZADO') o.sync++;
  });
  return o;
}
async function portOffContagem(){
  var lista=await portOffListEvents();
  return portOffContagemFrom(lista);
}

/* ── Limpeza 48h ───────────────────────────────────────── */
async function portOffLimparCacheSincronizado(){
  var lista=await portOffListEvents();
  var agora=Date.now();
  var i;
  for(i=0;i<lista.length;i++){
    var e=lista[i];
    if(!e || e.status_sync!=='SINCRONIZADO') continue;
    var t=new Date(e.data_hora_sincronizacao||e.data_hora_evento||0).getTime();
    if(!t || agora-t < PORT_OFF_TTL_MS) continue;
    await portOffApagarFotos((e.payload&&e.payload.fotos)||{});
    await portOffDel('portaria_eventos', e.event_id);
  }
}

/* ── Cache operacional ─────────────────────────────────── */
function portOffSlimSaida(p){
  if(!p) return null;
  return {
    id:p.id, offline_event_id:p.offline_event_id||null,
    placa:p.placa, modelo:p.modelo, status:p.status,
    equipe:p.equipe, equipe_id:p.equipe_id, motorista:p.motorista,
    contrato_id:p.contrato_id, contrato_nome:p.contrato_nome,
    data_saida:p.data_saida, previsao_retorno:p.previsao_retorno,
    km_saida:p.km_saida, km_retorno:p.km_retorno, data_retorno:p.data_retorno,
    destino:p.destino, base_saida:p.base_saida, quem_saiu:p.quem_saiu,
    liberado_por:p.liberado_por, obs:p.obs, veiculo_id:p.veiculo_id,
    tem_materiais_saida:p.tem_materiais_saida, tipo_liberacao:p.tipo_liberacao
  };
}
function portOffSlimColab(c){
  if(!c) return null;
  return {id:c.id, nome:c.nome, re:c.re||c.matricula, matricula:c.matricula||c.re, cargo:c.cargo, cnh_validade:c.cnh_validade, ativo:c.ativo};
}

async function portOffSnapshotCache(){
  if(!portOffIsOnline()) return;
  try{
    var hoje=typeof dataHojeLocal==='function'?dataHojeLocal():'';
    var ontem=typeof _diasAtras==='function'?_diasAtras(1):hoje;
    var emCampo=(typeof frt_portaria!=='undefined'?frt_portaria:[]).filter(portEstaEmCampo).map(portOffSlimSaida);
    var comps=(typeof composicao_dia!=='undefined'?composicao_dia:[]).filter(function(c){
      var d=typeof portDiaISO==='function'?portDiaISO(c.data):String(c.data||'').slice(0,10);
      return d===hoje || d===ontem;
    });
    var ids={};
    comps.forEach(function(c){
      var arr=typeof parseColabIds==='function'?parseColabIds(c.colaborador_ids):[];
      arr.forEach(function(id){ ids[id]=true; });
    });
    var colabs=(typeof colaboradores!=='undefined'?colaboradores:[]).filter(function(c){ return ids[c.id]; }).map(portOffSlimColab);
    var eqs=(typeof equipes_disp!=='undefined' && equipes_disp.length?equipes_disp:(typeof equipes!=='undefined'?equipes:[])).map(function(e){
      return {id:e.id, codigo:e.codigo, nome:e.nome||e.nome_equipe, contrato_id:e.contrato_id, filial_id:e.filial_id, status:e.status};
    });
    var veics=(typeof frt_veiculos!=='undefined'?frt_veiculos:[]).map(function(v){
      return {id:v.id, placa:v.placa, modelo:v.modelo, km_atual:v.km_atual, tipo:v.tipo};
    });
    var snap={
      em_campo: emCampo,
      composicao: comps,
      colaboradores: colabs,
      equipes: eqs,
      veiculos: veics,
      autorizados: typeof portaria_autorizados!=='undefined'?portaria_autorizados:[],
      visitas: typeof portaria_visitas!=='undefined'?portaria_visitas:[],
      configs: typeof portaria_configs!=='undefined'?portaria_configs:[],
      reservas: typeof frt_reservas!=='undefined'?frt_reservas:[],
      filiais: typeof filiais!=='undefined'?filiais:[],
      contratos: (typeof contratos!=='undefined'?contratos:[]).map(function(c){ return {id:c.id, nome:c.nome, codigo:c.codigo, filial_id:c.filial_id}; }),
      prog_veiculos: typeof _progVeiculos!=='undefined'?_progVeiculos:{},
      hoje: hoje, ontem: ontem,
      gravado_em: new Date().toISOString()
    };
    await portOffCachePut('operacional', snap);
    await portOffMetaPut('ultimo_snapshot', snap.gravado_em);
  }catch(e){ console.warn('[Portaria OFF] snapshot', e); }
}

async function portOffHidatarCache(){
  try{
    await portOffDb();
  }catch(e){ return; }
  var snap=await portOffCacheGet('operacional');
  if(snap){
    if(typeof frt_portaria!=='undefined' && snap.em_campo){
      if(typeof portMesclarSaidas==='function') portMesclarSaidas(snap.em_campo);
      else (snap.em_campo||[]).forEach(function(r){
        if(!(frt_portaria||[]).some(function(p){return String(p.id)===String(r.id);})) frt_portaria.push(r);
      });
    }
    if(typeof composicao_dia!=='undefined' && snap.composicao && typeof portMesclarComposicao==='function'){
      portMesclarComposicao(snap.composicao);
    }
    if(typeof colaboradores!=='undefined' && snap.colaboradores && !colaboradores.length){
      colaboradores=snap.colaboradores;
    }
    if(snap.equipes){
      if(typeof equipes_disp!=='undefined' && !equipes_disp.length) equipes_disp=snap.equipes;
      if(typeof equipes!=='undefined' && !equipes.length) equipes=snap.equipes;
    }
    if(typeof frt_veiculos!=='undefined' && snap.veiculos && !frt_veiculos.length) frt_veiculos=snap.veiculos;
    if(typeof portaria_autorizados!=='undefined' && snap.autorizados && !portaria_autorizados.length){
      portaria_autorizados=snap.autorizados;
      portaria_autorizados_loaded=true;
    }
    if(typeof portaria_visitas!=='undefined' && snap.visitas && !portaria_visitas.length) portaria_visitas=snap.visitas;
    if(typeof portaria_configs!=='undefined' && snap.configs && !portaria_configs.length) portaria_configs=snap.configs;
    if(typeof frt_reservas!=='undefined' && snap.reservas && !frt_reservas.length) frt_reservas=snap.reservas;
    if(typeof filiais!=='undefined' && snap.filiais && !filiais.length) filiais=snap.filiais;
    if(typeof contratos!=='undefined' && snap.contratos && !contratos.length) contratos=snap.contratos;
    if(typeof _progVeiculos!=='undefined' && snap.prog_veiculos){
      Object.keys(snap.prog_veiculos).forEach(function(k){ if(!_progVeiculos[k]) _progVeiculos[k]=snap.prog_veiculos[k]; });
    }
  }
  await portOffRehidratarEventos();
}

async function portOffRehidratarEventos(){
  var lista=await portOffListEvents();
  if(typeof frt_portaria==='undefined') frt_portaria=[];
  lista.forEach(function(ev){
    if(!ev) return;
    if(ev.tipo_evento==='SAIDA' && ev.payload && ev.payload.saida){
      var s=Object.assign({}, ev.payload.saida);
      s._sync_status=ev.status_sync;
      var ix=frt_portaria.findIndex(function(p){
        return p && (String(p.id)===String(s.id) || String(p.offline_event_id)===String(ev.event_id));
      });
      if(ix<0) frt_portaria.unshift(s);
      else if(ev.status_sync!=='SINCRONIZADO') frt_portaria[ix]._sync_status=ev.status_sync;
    }
    if(ev.tipo_evento==='RETORNO' && ev.payload && ev.status_sync!=='CONFLITO'){
      var sid=ev.payload.saida_id;
      var mem=(frt_portaria||[]).find(function(x){
        return String(x.id)===String(sid) || String(x.offline_event_id)===String(ev.depends_on||'');
      });
      if(mem){
        mem.status='Retornado';
        mem.data_retorno=ev.payload.data_retorno;
        mem.km_retorno=ev.payload.km_retorno;
        mem.obs_retorno=ev.payload.obs_retorno;
        mem.retorno_registrado_por=ev.payload.retorno_registrado_por;
        mem._sync_status=ev.status_sync;
      }
    }
  });
}

/* ── Quota ─────────────────────────────────────────────── */
function portOffChecarQuota(){
  if(!navigator.storage || !navigator.storage.estimate) return;
  navigator.storage.estimate().then(function(est){
    if(!est || !est.quota) return;
    var pct=est.usage/est.quota;
    if(pct>0.85 && Date.now()-_lastQuotaWarn>10*60000){
      _lastQuotaWarn=Date.now();
      portOffToast('Armazenamento offline do CENA está próximo do limite. Conecte o tablet à internet para sincronizar os registros.');
    }
  }).catch(function(){});
}

/* ── UI indicador + painel ─────────────────────────────── */
function portOffRenderIndicador(){
  var el=document.getElementById('port-off-indicador');
  if(!el) return;
  portOffListEvents().then(function(lista){
    var c=portOffContagemFrom(lista);
    var online=portOffIsOnline();
    var html, bg, fg, border;
    if(!online){
      bg='#FEF2F2'; fg='#A32D2D'; border='#F4C7C7';
      html='🔴 Sem internet<br><span style="font-weight:500">Operando em modo offline</span>'
        +(c.pendente+c.erro+c.sincronizando? '<br>'+(c.pendente+c.erro+c.sincronizando)+' registro(s) aguardando envio':'');
    } else if(_syncing || c.sincronizando){
      bg='#EBF4FD'; fg='#185FA5'; border='#B5D4F4';
      html='🔄 Sincronizando…<br><span style="font-weight:500">'+(c.sincronizando||1)+' de '+(c.pendente+c.erro+c.sincronizando)+'</span>';
    } else if(c.conflito || c.erro){
      bg='#FEF3E2'; fg='#854F0B'; border='#F5D0A6';
      html='🟠 Falha de sincronização<br><span style="font-weight:500">'+(c.conflito+c.erro)+' registro(s) requer(em) atenção</span>';
    } else if(c.pendente){
      bg='#EAF3DE'; fg='#3B6D11'; border='#C6DDAA';
      html='🟢 Online<br><span style="font-weight:500">'+c.pendente+' registro(s) aguardando sincronização</span>';
    } else {
      bg='#EAF3DE'; fg='#3B6D11'; border='#C6DDAA';
      html='🟢 Online<br><span style="font-weight:500">Todos os registros sincronizados</span>';
    }
    el.style.background=bg; el.style.color=fg; el.style.borderColor=border;
    el.innerHTML=html;
  }).catch(function(){});
}

function portOffFmtHora(iso){
  if(!iso) return '—';
  try{ return new Date(iso).toLocaleString('pt-BR'); }catch(e){ return String(iso); }
}
function portOffTipoLabel(t){
  return ({SAIDA:'Saída', RETORNO:'Retorno', AUTH_ENTRADA:'Autorizado — entrada', AUTH_SAIDA:'Autorizado — saída',
    VISITA_ENTRADA:'Visitante — entrada', VISITA_SAIDA:'Visitante — saída', VISITA_UPDATE:'Visitante — update'})[t]||t;
}

function portOffAbrirPainel(){
  portOffListEvents().then(function(lista){
    lista=portOffOrdenarFila(lista).reverse();
    function bloco(titulo, itens, cor){
      if(!itens.length) return '';
      return '<div style="margin-bottom:.75rem"><div style="font-size:11px;font-weight:700;color:'+cor+';margin-bottom:6px">'+titulo+' ('+itens.length+')</div>'
        +itens.map(function(e){
          var p=e.payload||{};
          var saida=(p.saida)||{};
          var eq=saida.equipe||p.placa||saida.placa||'—';
          var vei=saida.placa||p.placa||'—';
          return '<div style="background:#f7f7f4;border-radius:8px;padding:8px 10px;margin-bottom:4px;font-size:12px">'
            +'<div style="font-weight:700">'+portOffTipoLabel(e.tipo_evento)+' · '+escHtml(String(eq))+'</div>'
            +'<div style="color:#555">Veículo: '+escHtml(String(vei))+' · Evento: '+escHtml(portOffFmtHora(e.data_hora_evento))+'</div>'
            +'<div style="font-size:11px;color:#888">Status: '+escHtml(e.status_sync)+' · Tentativas: '+(e.tentativas_sync||0)+'</div>'
            +(e.ultimo_erro?'<div style="font-size:11px;color:#A32D2D;margin-top:3px">'+escHtml(e.ultimo_erro)+'</div>':'')
            +'</div>';
        }).join('')+'</div>';
    }
    var pend=lista.filter(function(e){return e.status_sync==='PENDENTE'||e.status_sync==='SINCRONIZANDO';});
    var err=lista.filter(function(e){return e.status_sync==='ERRO';});
    var conf=lista.filter(function(e){return e.status_sync==='CONFLITO';});
    var ok=lista.filter(function(e){return e.status_sync==='SINCRONIZADO';}).slice(0,20);
    setModal('<div class="modal-bg" onclick="if(event.target===this)closeModal()"><div class="modal" style="max-width:520px;max-height:90vh;overflow:auto">'
      +'<h3 style="margin:0 0 .75rem">Sincronização da Portaria</h3>'
      +'<div style="font-size:12px;color:#666;margin-bottom:.75rem">Os horários abaixo são os reais do evento, não o momento do envio.</div>'
      +bloco('Pendentes', pend, '#185FA5')
      +bloco('Erros', err, '#854F0B')
      +bloco('Conflitos', conf, '#A32D2D')
      +(conf.length
        ? '<div style="background:#FCEBEB;border-radius:8px;padding:8px 10px;margin-bottom:.75rem;font-size:11px;color:#A32D2D">'
          +'Conflito = este retorno/saída <b>já consta no sistema</b> (foi lançado por outro tablet/turno). Ele não sobe de novo e fica só ocupando a fila. Você pode descartá-lo — nada é apagado do sistema.'
          +'<div style="margin-top:6px"><button class="btn btn-sm" onclick="portOffDescartarConflitos()" style="color:#fff;background:#A32D2D;border-color:#A32D2D;font-size:11px;font-weight:700">🗑 Descartar '+conf.length+' conflito(s)</button></div>'
          +'</div>'
        : '')
      +bloco('Sincronizados (recentes)', ok, '#3B6D11')
      +(!lista.length?'<div style="color:#aaa;font-size:12px;text-align:center;padding:1rem">Nenhum registro na fila deste tablet.</div>':'')
      +'<div style="display:flex;gap:8px;margin-top:1rem">'
      +'<button class="btn" onclick="closeModal()" style="flex:1">Fechar</button>'
      +'<button class="btn btn-pri" onclick="portOffSyncAgora()" style="flex:2">Sincronizar agora</button>'
      +'</div></div></div>');
  });
}

/** Descarta manualmente os eventos em CONFLITO (já constam no sistema). Nunca automático. */
function portOffDescartarConflitos(){
  portOffListEvents().then(function(lista){
    var conf=(lista||[]).filter(function(e){ return e && e.status_sync==='CONFLITO'; });
    if(!conf.length){ portOffToast('Nenhum conflito para descartar.'); return; }
    if(!confirm('Descartar '+conf.length+' conflito(s)?\n\nEsses registros JÁ constam no sistema (retorno/saída já lançado). Serão removidos apenas desta fila do tablet — nada é apagado do sistema.')) return;
    var jobs=conf.map(function(e){
      return portOffApagarFotos((e.payload&&e.payload.fotos)||{}).catch(function(){}).then(function(){ return portOffDel('portaria_eventos', e.event_id).catch(function(){}); });
    });
    Promise.all(jobs).then(function(){
      portOffToast('✅ '+conf.length+' conflito(s) descartado(s).','ok');
      portOffRenderIndicador();
      portOffAbrirPainel();
    }).catch(function(){ portOffToast('⚠ Não foi possível descartar todos.','erro'); portOffAbrirPainel(); });
  });
}

function portOffSyncAgora(){
  portOffToast('🔄 Sincronizando…');
  _backoffIdx=0;
  portOffSyncPendentes().then(function(){
    return portOffContagem();
  }).then(function(c){
    if(typeof closeModal==='function') closeModal();
    var resta=(c.pendente||0)+(c.erro||0)+(c.conflito||0)+(c.sincronizando||0);
    if(resta===0){
      portOffToast('✅ Sincronização concluída — todos os registros foram enviados.','ok');
    } else {
      var partes=[];
      if(c.pendente) partes.push(c.pendente+' pendente(s)');
      if(c.sincronizando) partes.push(c.sincronizando+' em andamento');
      if(c.erro) partes.push(c.erro+' com erro');
      if(c.conflito) partes.push(c.conflito+' em conflito');
      portOffToast('⚠ Sincronização incompleta — falta: '+partes.join(', ')+'.','aviso');
    }
    portOffRenderIndicador();
  }).catch(function(){
    if(typeof closeModal==='function') closeModal();
    portOffToast('⚠ Não foi possível concluir a sincronização. Verifique a conexão e tente novamente.','erro');
    portOffRenderIndicador();
  });
}

function portOffOnConnectivityChange(){
  portOffRenderIndicador();
  if(portOffNavOnline()){
    _backoffIdx=0;
    portOffProbe().then(function(ok){
      portOffRenderIndicador();
      if(ok) portOffSyncPendentes();
    });
  }
}

/* ── Init ──────────────────────────────────────────────── */
function portOffInit(){
  portOffHidatarCache().then(function(){
    portOffRenderIndicador();
    portOffChecarQuota();
    portOffLimparCacheSincronizado();
    if(portOffNavOnline()){
      portOffSnapshotCache();
      portOffSyncPendentes();
    }
    try{
      if(navigator.serviceWorker && navigator.serviceWorker.ready && 'sync' in ServiceWorkerRegistration.prototype){
        navigator.serviceWorker.ready.then(function(reg){
          return reg.sync.register('cena-sync-queue');
        }).catch(function(){});
      }
    }catch(e){}
  }).catch(function(e){ console.warn('[Portaria OFF] init', e); });
}

window.addEventListener('online', portOffOnConnectivityChange);
window.addEventListener('offline', portOffOnConnectivityChange);
window.addEventListener('pageshow', function(){ portOffRenderIndicador(); if(portOffNavOnline()) portOffSyncPendentes(); });

if(typeof navigator!=='undefined' && navigator.serviceWorker){
  navigator.serviceWorker.addEventListener('message', function(e){
    if(e.data && e.data.type==='SYNC_READY') portOffSyncPendentes();
  });
}

setInterval(function(){
  var pg=document.getElementById('pg-frotas-portaria');
  if(!pg || pg.classList.contains('hidden')) return;
  portOffListEvents().then(function(lista){
    var c=portOffContagemFrom(lista);
    if((c.pendente+c.erro)>0 && portOffNavOnline()) portOffSyncPendentes();
    else portOffRenderIndicador();
  }).catch(function(){});
}, 30000);

global.portOffUuid=portOffUuid;
global.portOffNovoId=portOffNovoId;
global.portOffDeviceId=portOffDeviceId;
global.portOffNow=portOffNow;
global.portOffIsOnline=portOffIsOnline;
global.portOffTravar=portOffTravar;
global.portEstaEmCampo=portEstaEmCampo;
global.portOffRegistrarSaida=portOffRegistrarSaida;
global.portOffRegistrarRetorno=portOffRegistrarRetorno;
global.portOffRegistrarAuth=portOffRegistrarAuth;
global.portOffRegistrarVisita=portOffRegistrarVisita;
global.portOffSyncPendentes=portOffSyncPendentes;
global.portOffLimparCacheSincronizado=portOffLimparCacheSincronizado;
global.portOffSnapshotCache=portOffSnapshotCache;
global.portOffHidatarCache=portOffHidatarCache;
global.portOffInit=portOffInit;
global.portOffAbrirPainel=portOffAbrirPainel;
global.portOffDescartarConflitos=portOffDescartarConflitos;
global.portOffSyncAgora=portOffSyncAgora;
global.portOffRenderIndicador=portOffRenderIndicador;
global.portOffOnConnectivityChange=portOffOnConnectivityChange;

})(window);
