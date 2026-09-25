/* Portaria — captura in-app (tablets).
 * O clique em “Tirar Foto” é no LABEL; sem isto o Android abre a câmera nativa
 * e o PWA some da memória (reinício intermitente).
 */
(function(global){
  'use strict';

  var MAX_PREVIA=640;
  var MAX_JPEG=400;
  var Q_JPEG=0.55;

  function toast(m, t){
    try{ if(typeof global.progShowToast==='function') global.progShowToast(m, t||'info'); }catch(e){}
  }
  function ehMovel(){
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
        if(on){
          global._portCamRefreshWasPaused=!!global._autoRefresh._pausado;
          global._autoRefresh._pausado=true;
        } else if(global._portCamRefreshWasPaused===false){
          global._autoRefresh._pausado=false;
        }
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

  function aplicarB64NoInput(input, b64){
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
    if(/portFotosExtraAdd\s*\(/.test(oc)){
      var arr=(typeof global.portFotosExtraColetar==='function')?global.portFotosExtraColetar():[];
      arr.push({nome:'foto.jpg', b64:b64});
      if(typeof global.portFotosExtraPersist==='function') global.portFotosExtraPersist(arr);
      return;
    }
    if(/portKmFotoManual\s*\(/.test(oc) && typeof global.portKmSetPreview==='function'){
      global.portKmSetPreview(b64);
      var st=document.getElementById('port-km-status');
      if(st){ st.textContent='Foto anexada. Informe o KM manualmente ou use OCR.'; st.style.color='#185FA5'; }
      return;
    }
    if(/desmobSetFoto|inspFoto|fpr-|avaria/.test(oc) && input.id){
      if(typeof global.portFotoGuardar==='function') global.portFotoGuardar(input.id, b64);
    }
  }

  function videoConstraints(facing){
    return {
      audio:false,
      video:{
        facingMode:{ ideal: facing||'environment' },
        width:{ ideal:MAX_PREVIA, max:MAX_PREVIA },
        height:{ ideal:480, max:480 }
      }
    };
  }

  function overlay(facing, onBlob, onFail){
    if(document.getElementById('port-cam-ov')) return;
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
    function falhou(){
      fecharOverlay();
      toast('Não foi possível abrir a câmera no app. Tente de novo.','erro');
      if(onFail) onFail();
    }
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
      falhou();
      return;
    }
    var tentativas=[
      videoConstraints(facing),
      {audio:false, video:{ facingMode: facing||'environment' }},
      {audio:false, video:true}
    ];
    function pedir(i){
      if(i>=tentativas.length){ falhou(); return; }
      navigator.mediaDevices.getUserMedia(tentativas[i]).then(function(stream){
        global._portCamStream=stream;
        try{
          var track=stream.getVideoTracks()[0];
          if(track && track.applyConstraints){
            track.applyConstraints({width:{max:MAX_PREVIA}, height:{max:480}}).catch(function(){});
          }
        }catch(eC){}
        video.srcObject=stream;
        var p=video.play();
        if(p && p.catch) p.catch(function(){});
      }).catch(function(){ pedir(i+1); });
    }
    pedir(0);

    wrap.querySelector('#port-cam-cancel').onclick=function(){ fecharOverlay(); };
    wrap.querySelector('#port-cam-shot').onclick=function(){
      var btn=wrap.querySelector('#port-cam-shot');
      if(btn) btn.disabled=true;
      try{
        var w=video.videoWidth||640, h=video.videoHeight||480;
        if(w>MAX_JPEG||h>MAX_JPEG){
          if(w>h){ h=Math.round(h*MAX_JPEG/w); w=MAX_JPEG; }
          else { w=Math.round(w*MAX_JPEG/h); h=MAX_JPEG; }
        }
        var c=document.createElement('canvas');
        c.width=w; c.height=h;
        c.getContext('2d').drawImage(video,0,0,w,h);
        pararStream();
        var dataUrl='';
        try{ dataUrl=c.toDataURL('image/jpeg', Q_JPEG); }catch(eJ){ dataUrl=''; }
        try{ c.width=c.height=0; }catch(eZ){}
        fecharOverlay();
        if(!dataUrl){ toast('Não foi possível capturar. Tente de novo.','erro'); return; }
        onBlob(dataUrl);
      }catch(eCap){
        fecharOverlay();
        toast('Falha ao fotografar.','erro');
      }
    };
  }

  function ehInputPortaria(inp){
    if(!inp || inp.tagName!=='INPUT' || inp.type!=='file') return false;
    var acc=String(inp.accept||'');
    if(acc && acc.indexOf('image')<0) return false;
    var oc=String(inp.getAttribute('onchange')||'');
    if(/portFotoPreview|portFotosExtraAdd|portKmFotoManual|desmobSetFoto|inspFoto/.test(oc)) return true;
    var id=String(inp.id||'');
    if(/lib-foto|auth-foto|ret-foto|port-km|fpr-avaria|cl-foto|db-.*foto/.test(id)) return true;
    if(inp.hasAttribute('capture') && (inp.closest('#modal-area') || inp.closest('[id^="pg-portaria"]') || inp.closest('#pg-frotas-portaria'))) return true;
    return false;
  }

  function inputDoEvento(e){
    var t=e.target;
    if(!t) return null;
    if(t.nodeType===3) t=t.parentElement;
    if(!t) return null;
    if(t.tagName==='INPUT' && t.type==='file') return t;
    var lab=t.closest ? t.closest('label') : null;
    if(lab){
      var inp=lab.querySelector('input[type="file"]');
      if(inp) return inp;
    }
    if(t.closest){
      var wrap=t.closest('[data-port-cam], .port-foto-btn');
      if(wrap) return wrap.querySelector('input[type="file"]');
    }
    return null;
  }

  function facingDoInput(inp){
    var cap=String(inp.getAttribute('capture')||'').toLowerCase();
    if(cap==='user') return 'user';
    return 'environment';
  }

  function abrirParaInput(inp){
    if(!inp) return;
    overlay(facingDoInput(inp), function(b64){
      aplicarB64NoInput(inp, b64);
      salvarRascunho();
    }, function(){ /* sem câmera nativa — evita kill do PWA */ });
  }

  function interceptPointer(e){
    var inp=inputDoEvento(e);
    if(!ehInputPortaria(inp)) return;
    e.preventDefault();
    e.stopPropagation();
    if(e.stopImmediatePropagation) e.stopImmediatePropagation();
    abrirParaInput(inp);
  }

  document.addEventListener('click', interceptPointer, true);
  document.addEventListener('pointerdown', function(e){
    var inp=inputDoEvento(e);
    if(!ehInputPortaria(inp)) return;
    e.preventDefault();
    e.stopPropagation();
    if(e.stopImmediatePropagation) e.stopImmediatePropagation();
  }, true);

  function stripCapture(){
    try{
      document.querySelectorAll('input[type="file"][accept*="image"]').forEach(function(inp){
        if(!ehInputPortaria(inp) && !/portFoto|portKm|portFotos/.test(inp.getAttribute('onchange')||'')) return;
        inp.removeAttribute('capture');
      });
    }catch(e){}
  }
  var _mo=null;
  function watchModais(){
    var area=document.getElementById('modal-area')||document.body;
    if(!area || _mo) return;
    _mo=new MutationObserver(function(){ stripCapture(); wrapOcr(); wrapComprimir(); });
    _mo.observe(area, {childList:true, subtree:true});
    stripCapture();
  }

  var _origComprimir=null;
  function wrapComprimir(){
    if(typeof global.portComprimirArquivo!=='function') return;
    if(global.portComprimirArquivo._portCamWrapped) return;
    _origComprimir=global.portComprimirArquivo;
    global.portComprimirArquivo=function(file, opts){
      opts=opts||{};
      var MAX=opts.max||400;
      if(MAX>400 && ehMovel()) MAX=400;
      if(!ehMovel()) return _origComprimir(file, opts);
      return new Promise(function(resolve){
        if(typeof createImageBitmap!=='function'){ resolve(''); return; }
        createImageBitmap(file, {resizeWidth:MAX, resizeQuality:'low'}).then(function(bmp){
          var canvas=document.createElement('canvas');
          canvas.width=bmp.width; canvas.height=bmp.height;
          try{ canvas.getContext('2d').drawImage(bmp,0,0); }catch(eD){ resolve(''); return; }
          if(bmp.close) try{ bmp.close(); }catch(e){}
          var out='';
          try{ out=canvas.toDataURL('image/jpeg', opts.q||0.5); }catch(e){ resolve(''); return; }
          try{ canvas.width=canvas.height=0; }catch(_c){}
          resolve(out||'');
        }).catch(function(){
          createImageBitmap(file, {resizeWidth:240, resizeQuality:'low'}).then(function(bmp){
            var canvas=document.createElement('canvas');
            canvas.width=bmp.width; canvas.height=bmp.height;
            try{ canvas.getContext('2d').drawImage(bmp,0,0); }catch(eD){ resolve(''); return; }
            if(bmp.close) try{ bmp.close(); }catch(e){}
            var out='';
            try{ out=canvas.toDataURL('image/jpeg', 0.45); }catch(e2){ resolve(''); return; }
            try{ canvas.width=canvas.height=0; }catch(_c){}
            resolve(out||'');
          }).catch(function(){ resolve(''); });
        });
      });
    };
    global.portComprimirArquivo._portCamWrapped=true;
  }

  function ocrComB64(b64, targetInputId){
    var target=document.getElementById(targetInputId);
    var st=document.getElementById('port-km-status');
    if(target){ target.placeholder='Analisando...'; target.disabled=true; }
    if(st){ st.textContent='Lendo odômetro com IA...'; st.style.color='#555'; }
    if(typeof global.portKmSetPreview==='function') global.portKmSetPreview(b64);
    var base64=String(b64||'').split(',')[1]||'';
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
  }

  function wrapOcr(){
    if(typeof global.portAbrirCameraOdometro!=='function') return;
    if(global.portAbrirCameraOdometro._portCamWrapped) return;
    global.portAbrirCameraOdometro=function(targetInputId){
      if(typeof global.portKmResetOcr==='function') global.portKmResetOcr();
      if(global._portKmOcr) global._portKmOcr.targetId=targetInputId;
      overlay('environment', function(b64){ ocrComB64(b64, targetInputId); }, function(){
        toast('Câmera indisponível. Use “Foto odômetro”.','erro');
      });
    };
    global.portAbrirCameraOdometro._portCamWrapped=true;
  }

  window.addEventListener('pageshow', function(ev){
    var nav='';
    try{
      var list=performance.getEntriesByType&&performance.getEntriesByType('navigation');
      nav=list&&list[0]&&list[0].type;
    }catch(e){}
    var flag=''; try{ flag=sessionStorage.getItem('cena_port_foto_cap'); }catch(e2){}
    if(flag==='1' && (ev.persisted || nav==='reload' || nav==='back_forward')){
      marcarCap(false);
      toast('O tablet fechou o app na foto. A foto não gravou — tire de novo na tela preta.','erro');
    }
  });

  function boot(){
    wrapComprimir();
    wrapOcr();
    watchModais();
    stripCapture();
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  setTimeout(boot, 400);
  setTimeout(boot, 1500);
  global.portCamFechar=fecharOverlay;
  global.portCamSalvarRascunho=salvarRascunho;
  global.portCamAbrir=abrirParaInput;
})(window);
