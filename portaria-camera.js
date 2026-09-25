/* Portaria — captura in-app (tablets).
 * Evita capture= nativo (Android mata o PWA) e decode 12MP (OOM/reload).
 */
(function(global){
  'use strict';

  function toast(m, t){
    try{ if(typeof global.progShowToast==='function') global.progShowToast(m, t||'info'); }catch(e){}
  }
  function ehTabletFraco(){
    var ua=String(navigator.userAgent||'');
    var touch=('ontouchstart' in window) || (navigator.maxTouchPoints>0);
    var mem=navigator.deviceMemory;
    return touch || (mem && mem<=4) || /Android|iPad|Mobile|Tablet/i.test(ua);
  }
  function marcarCap(on){
    global._portFotoCapturando=!!on;
    try{ sessionStorage.setItem('cena_port_foto_cap', on?'1':'0'); }catch(e){}
    try{
      if(global._autoRefresh){
        if(on){ global._portCamRefreshWasPaused=!!global._autoRefresh._pausado; global._autoRefresh._pausado=true; }
        else if(global._portCamRefreshWasPaused===false) global._autoRefresh._pausado=false;
      }
    }catch(e){}
  }
  function salvarRascunho(){
    var area=document.getElementById('modal-area');
    if(!area) return;
    var fields={};
    area.querySelectorAll('input,select,textarea').forEach(function(el){
      if(!el.id) return;
      if(el.type==='file') return;
      var v=el.value;
      if(v && String(v).indexOf('data:image')===0) return;
      fields[el.id]=v;
    });
    try{ sessionStorage.setItem('cena_port_rascunho', JSON.stringify({t:Date.now(), fields:fields})); }catch(e){}
  }
  function restaurarRascunho(){
    var raw; try{ raw=sessionStorage.getItem('cena_port_rascunho'); }catch(e){ return; }
    if(!raw) return;
    var pack; try{ pack=JSON.parse(raw); }catch(e){ return; }
    if(!pack || !pack.fields) return;
    if(Date.now()-(pack.t||0)>30*60*1000) return;
    Object.keys(pack.fields).forEach(function(id){
      var el=document.getElementById(id);
      if(el && el.type!=='file') try{ el.value=pack.fields[id]; }catch(e2){}
    });
  }

  function pararStream(){
    var s=global._portCamStream;
    global._portCamStream=null;
    if(!s) return;
    try{ (s.getTracks()||[]).forEach(function(t){ try{ t.stop(); }catch(e){} }); }catch(e){}
  }
  function fecharOverlay(){
    pararStream();
    marcarCap(false);
    var ov=document.getElementById('port-cam-ov');
    if(ov && ov.parentNode) ov.parentNode.removeChild(ov);
  }

  function aplicarB64NoInput(input, b64, blob){
    var oc=input.getAttribute('onchange')||'';
    if(/portFotoPreview\s*\(/.test(oc)){
      var m=oc.match(/portFotoPreview\s*\(\s*this\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/);
      if(m && typeof global.portFotoGuardar==='function'){
        global.portFotoGuardar(m[2], b64);
        var prev=document.getElementById(m[1]);
        if(prev) prev.innerHTML='<img src="'+b64+'" style="width:100%;height:100%;object-fit:cover">';
        return;
      }
    }
    if(/portFotosExtraAdd\s*\(/.test(oc) && typeof global.portFotosExtraAdd==='function'){
      var file=new File([blob], 'foto.jpg', {type:'image/jpeg'});
      var dt=new DataTransfer();
      dt.items.add(file);
      input.files=dt.files;
      global.portFotosExtraAdd(input);
      return;
    }
    if(/portKmFotoManual\s*\(/.test(oc)){
      var km=oc.match(/portKmFotoManual\s*\(\s*this\s*,\s*'([^']+)'\s*\)/);
      if(typeof global.portKmSetPreview==='function'){
        global.portKmSetPreview(b64);
        var st=document.getElementById('port-km-status');
        if(st){ st.textContent='Foto anexada. Informe o KM manualmente ou use OCR.'; st.style.color='#185FA5'; }
      } else if(km && typeof global.portKmFotoManual==='function'){
        var f=new File([blob], 'odo.jpg', {type:'image/jpeg'});
        var d2=new DataTransfer();
        d2.items.add(f);
        input.files=d2.files;
        global.portKmFotoManual(input, km[1]);
      }
      return;
    }
    if(typeof global.portFotoPreview==='function'){
      var f3=new File([blob], 'foto.jpg', {type:'image/jpeg'});
      var d3=new DataTransfer();
      d3.items.add(f3);
      input.files=d3.files;
      global.portFotoPreview(input, '', '');
    }
  }

  function overlay(facing, onBlob, onFail){
    fecharOverlay();
    marcarCap(true);
    salvarRascunho();
    var wrap=document.createElement('div');
    wrap.id='port-cam-ov';
    wrap.setAttribute('style','position:fixed;inset:0;z-index:30000;background:#111;display:flex;flex-direction:column');
    wrap.innerHTML='<video id="port-cam-v" playsinline webkit-playsinline autoplay muted style="flex:1;width:100%;object-fit:cover;background:#000"></video>'
      +'<div style="padding:14px 12px calc(14px + env(safe-area-inset-bottom,0px));display:flex;gap:10px;justify-content:center;background:#000">'
      +'<button type="button" id="port-cam-cancel" style="min-width:110px;padding:12px 16px;border:0;border-radius:10px;background:#444;color:#fff;font-weight:700;font-size:15px">Cancelar</button>'
      +'<button type="button" id="port-cam-shot" style="min-width:140px;padding:12px 16px;border:0;border-radius:10px;background:#185FA5;color:#fff;font-weight:700;font-size:15px">Fotografar</button>'
      +'</div>';
    document.body.appendChild(wrap);
    var video=wrap.querySelector('#port-cam-v');
    var cons={ audio:false, video:{ facingMode:{ ideal: facing||'environment' }, width:{ ideal:1280 }, height:{ ideal:720 } } };
    function falhou(err){
      fecharOverlay();
      if(onFail) onFail(err);
    }
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
      falhou(new Error('sem getUserMedia'));
      return;
    }
    navigator.mediaDevices.getUserMedia(cons).then(function(stream){
      global._portCamStream=stream;
      video.srcObject=stream;
      var p=video.play();
      if(p && p.catch) p.catch(function(){});
    }).catch(function(){
      return navigator.mediaDevices.getUserMedia({audio:false, video:true}).then(function(stream){
        global._portCamStream=stream;
        video.srcObject=stream;
        var p=video.play();
        if(p && p.catch) p.catch(function(){});
      });
    }).catch(falhou);

    wrap.querySelector('#port-cam-cancel').onclick=function(){ fecharOverlay(); };
    wrap.querySelector('#port-cam-shot').onclick=function(){
      try{
        var w=video.videoWidth||1280, h=video.videoHeight||720;
        var MAX=960;
        if(w>MAX||h>MAX){ if(w>h){ h=Math.round(h*MAX/w); w=MAX; } else { w=Math.round(w*MAX/h); h=MAX; } }
        var c=document.createElement('canvas');
        c.width=w; c.height=h;
        c.getContext('2d').drawImage(video,0,0,w,h);
        c.toBlob(function(blob){
          try{ c.width=c.height=0; }catch(e){}
          fecharOverlay();
          if(!blob){ toast('Não foi possível capturar. Tente de novo.','erro'); return; }
          onBlob(blob);
        }, 'image/jpeg', 0.72);
      }catch(eCap){
        fecharOverlay();
        toast('Falha ao fotografar.','erro');
      }
    };
  }

  function blobParaB64(blob, max){
    max=max||480;
    if(typeof global.portComprimirArquivo==='function'){
      return global.portComprimirArquivo(blob, {max:max, q:0.5, limite:80000});
    }
    return new Promise(function(resolve){
      var r=new FileReader();
      r.onload=function(){ resolve(r.result||''); };
      r.onerror=function(){ resolve(''); };
      r.readAsDataURL(blob);
    });
  }

  function ehInputPortaria(inp){
    if(!inp || inp.tagName!=='INPUT' || inp.type!=='file') return false;
    var acc=String(inp.accept||'');
    if(acc && acc.indexOf('image')<0) return false;
    var oc=String(inp.getAttribute('onchange')||'');
    if(/portFotoPreview|portFotosExtraAdd|portKmFotoManual/.test(oc)) return true;
    if(inp.hasAttribute('capture') && (inp.id||'').indexOf('lib-foto')>=0) return true;
    if(inp.hasAttribute('capture') && (inp.id||'').indexOf('auth-foto')>=0) return true;
    if(inp.hasAttribute('capture') && (inp.id||'').indexOf('ret-foto')>=0) return true;
    return false;
  }

  function facingDoInput(inp){
    var cap=String(inp.getAttribute('capture')||'').toLowerCase();
    if(cap==='user') return 'user';
    return 'environment';
  }

  function interceptClick(e){
    var inp=e.target;
    if(!inp || inp.tagName!=='INPUT'){
      inp=e.target && e.target.closest ? e.target.closest('input[type="file"]') : null;
    }
    if(!ehInputPortaria(inp)) return;
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    e.preventDefault();
    e.stopPropagation();
    if(e.stopImmediatePropagation) e.stopImmediatePropagation();
    overlay(facingDoInput(inp), function(blob){
      blobParaB64(blob, 480).then(function(b64){
        if(!b64){ toast('Não foi possível ler a foto. Tire de novo.','erro'); return; }
        aplicarB64NoInput(inp, b64, blob);
        salvarRascunho();
      });
    }, function(){
      try{ inp.click(); }catch(e2){}
    });
  }

  document.addEventListener('click', interceptClick, true);

  var _origComprimir=null;
  function wrapComprimir(){
    if(_origComprimir || typeof global.portComprimirArquivo!=='function') return;
    _origComprimir=global.portComprimirArquivo;
    global.portComprimirArquivo=function(file, opts){
      opts=opts||{};
      var MAX=opts.max||480;
      if(!ehTabletFraco()) return _origComprimir(file, opts);
      return new Promise(function(resolve){
        if(typeof createImageBitmap!=='function'){
          toast('Este tablet não compacta a foto com segurança. Tente de novo.','erro');
          resolve('');
          return;
        }
        createImageBitmap(file, {resizeWidth:MAX, resizeQuality:'low'}).then(function(bmp){
          var canvas=document.createElement('canvas');
          canvas.width=bmp.width; canvas.height=bmp.height;
          try{ canvas.getContext('2d').drawImage(bmp,0,0); }catch(eD){ resolve(''); return; }
          if(bmp.close) try{ bmp.close(); }catch(e){}
          var q=opts.q||0.5, out='', LIMITE=opts.limite||80000;
          try{ out=canvas.toDataURL('image/jpeg', q); }catch(e){ resolve(''); return; }
          while(out && out.length>LIMITE && q>0.35){
            q-=0.08;
            try{ out=canvas.toDataURL('image/jpeg', q); }catch(e2){ break; }
          }
          try{ canvas.width=canvas.height=0; }catch(_c){}
          resolve(out||'');
        }).catch(function(){
          createImageBitmap(file, {resizeWidth:320, resizeQuality:'low'}).then(function(bmp){
            var canvas=document.createElement('canvas');
            canvas.width=bmp.width; canvas.height=bmp.height;
            try{ canvas.getContext('2d').drawImage(bmp,0,0); }catch(eD){ resolve(''); return; }
            if(bmp.close) try{ bmp.close(); }catch(e){}
            var out='';
            try{ out=canvas.toDataURL('image/jpeg', 0.45); }catch(e){ resolve(''); return; }
            try{ canvas.width=canvas.height=0; }catch(_c){}
            resolve(out||'');
          }).catch(function(){ resolve(''); });
        });
      });
    };
  }

  function ocrComBlob(blob, targetInputId){
    var target=document.getElementById(targetInputId);
    var st=document.getElementById('port-km-status');
    if(target){ target.placeholder='Analisando...'; target.disabled=true; }
    if(st){ st.textContent='Lendo odômetro com IA...'; st.style.color='#555'; }
    blobParaB64(blob, 520).then(function(b64Prev){
      if(b64Prev && typeof global.portKmSetPreview==='function') global.portKmSetPreview(b64Prev);
      var dataUrl=b64Prev||'';
      var base64=String(dataUrl).split(',')[1]||'';
      if(!base64){
        if(target){ target.disabled=false; target.placeholder='Ex: 45230'; }
        toast('Foto do odômetro falhou. Tire de novo.','erro');
        return;
      }
      fetch('https://cena-proxy.marcos-afe.workers.dev',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          model:'claude-sonnet-4-5',
          max_tokens:100,
          messages:[{
            role:'user',
            content:[
              {type:'image', source:{type:'base64', media_type:'image/jpeg', data:base64}},
              {type:'text', text:'Esta é uma foto do odômetro de um veículo. Responda APENAS com o número inteiro do KM mostrado no odômetro, sem pontos, vírgulas ou texto. Exemplo: 45230. Se não conseguir ler, responda: ERRO'}
            ]
          }]
        })
      }).then(function(r){ return r.json(); }).then(function(data){
        if(target){ target.disabled=false; target.placeholder='Ex: 45230'; }
        var resp=data.content&&data.content[0]?String(data.content[0].text||'').trim():'ERRO';
        var km=parseInt(resp.replace(/\D/g,''),10);
        if(isNaN(km)||resp==='ERRO'){
          if(global._portKmOcr){ global._portKmOcr.km_lido_ocr=null; global._portKmOcr.km_ocr_confianca=0; }
          if(st){ st.textContent='Não foi possível ler o odômetro. Informe o KM manualmente (foto já salva).'; st.style.color='#A32D2D'; }
          toast('OCR não leu o KM. Digite manualmente.','erro');
        } else if(typeof global.portAbrirCameraOdometro==='function' && global._portCamOcrOrigApply){
          global._portCamOcrOrigApply(km, target, st);
        } else {
          if(target) target.value=String(km);
          if(global._portKmOcr){ global._portKmOcr.km_lido_ocr=km; global._portKmOcr.km_ocr_confianca=0.7; }
          var hO=document.getElementById('port-km-ocr'); if(hO) hO.value=String(km);
          var hC=document.getElementById('port-km-conf'); if(hC) hC.value='0.7';
          if(st){ st.textContent='KM lido: '+km+' — revise antes de liberar.'; st.style.color='#3B6D11'; }
          if(typeof global.portKmMostrarAlertasPlaca==='function') global.portKmMostrarAlertasPlaca(targetInputId);
        }
      }).catch(function(){
        if(target){ target.disabled=false; target.placeholder='Ex: 45230'; }
        if(st){ st.textContent='Falha no OCR. Foto salva — digite o KM.'; st.style.color='#A32D2D'; }
        toast('OCR indisponível. Digite o KM.','erro');
      });
    });
  }

  function wrapOcr(){
    if(typeof global.portAbrirCameraOdometro!=='function') return;
    if(global.portAbrirCameraOdometro._portCamWrapped) return;
    var orig=global.portAbrirCameraOdometro;
    global.portAbrirCameraOdometro=function(targetInputId){
      if(typeof global.portKmResetOcr==='function') global.portKmResetOcr();
      if(global._portKmOcr) global._portKmOcr.targetId=targetInputId;
      if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
        return orig(targetInputId);
      }
      overlay('environment', function(blob){ ocrComBlob(blob, targetInputId); }, function(){ orig(targetInputId); });
    };
    global.portAbrirCameraOdometro._portCamWrapped=true;
  }

  function onVolta(){
    var flag; try{ flag=sessionStorage.getItem('cena_port_foto_cap'); }catch(e){ flag=''; }
    if(flag==='1'){
      marcarCap(false);
      restaurarRascunho();
      toast('A câmera fechou o app. A foto não ficou gravada — tire de novo.','erro');
    }
  }
  window.addEventListener('pageshow', function(ev){
    if(ev.persisted || (typeof performance!=='undefined' && performance.getEntriesByType)){
      onVolta();
    }
  });
  document.addEventListener('visibilitychange', function(){
    if(!document.hidden && global._portFotoCapturando) salvarRascunho();
  });

  function boot(){
    wrapComprimir();
    wrapOcr();
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  setTimeout(boot, 800);
  global.portCamFechar=fecharOverlay;
  global.portCamSalvarRascunho=salvarRascunho;
})(window);
