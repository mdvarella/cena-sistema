// ══════════════════════════════════════════════════════════════
// CENA ERP — Service Worker v5.9.9
// Estratégia: Network-first para HTML, Cache-first para estático
// ══════════════════════════════════════════════════════════════

const SW_VERSION   = 'cena-5.9.9';
const CACHE_STATIC = SW_VERSION + '-static';
const CACHE_API    = SW_VERSION + '-api';

// ── Install ────────────────────────────────────────────────
self.addEventListener('install', function(e){
  // Ativar imediatamente sem esperar tabs antigas fecharem
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_STATIC).then(function(cache){
      // NÃO cachear index.html — sempre buscar do servidor
      return cache.addAll(['./manifest.json']);
    })
  );
});

// ── Activate: limpar caches antigas ───────────────────────
self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(
        keys.filter(function(k){ return k !== CACHE_STATIC && k !== CACHE_API; })
            .map(function(k){
              console.log('[SW] Removendo cache antigo:', k);
              return caches.delete(k);
            })
      );
    }).then(function(){
      // Tomar controle de todas as abas imediatamente
      return self.clients.claim();
    }).then(function(){
      // Notificar todas as abas que há uma nova versão
      return self.clients.matchAll().then(function(clients){
        clients.forEach(function(client){
          client.postMessage({type:'SW_UPDATED', version:SW_VERSION});
        });
      });
    })
  );
});

// ── Fetch ───────────────────────────────────────────────────
self.addEventListener('fetch', function(e){
  var url = new URL(e.request.url);
  var isHTML = e.request.destination === 'document'
    || url.pathname.endsWith('.html')
    || url.pathname.endsWith('/')
    || url.pathname === '/';

  // HTML — SEMPRE network-first (garante versão mais recente)
  if(isHTML){
    e.respondWith(
      fetch(e.request, {cache:'no-store'}).then(function(res){
        return res;
      }).catch(function(){
        // Só usa cache se estiver offline
        return caches.match(e.request).then(function(cached){
          return cached || new Response('<h2>Sem conexão — CENA ERP offline</h2>',
            {headers:{'Content-Type':'text/html'}});
        });
      })
    );
    return;
  }

  // Supabase / APIs — Network-first
  if(url.hostname.includes('supabase') || url.pathname.includes('/rest/v1/')
  || url.pathname.includes('/auth/v1/')){
    e.respondWith(
      fetch(e.request).then(function(res){
        if(e.request.method === 'GET' && res.ok){
          var clone = res.clone();
          caches.open(CACHE_API).then(function(c){ c.put(e.request, clone); });
        }
        return res;
      }).catch(function(){
        return caches.match(e.request);
      })
    );
    return;
  }

  // Ícones, manifest, sw.js — Cache-first
  if(e.request.method === 'GET'){
    e.respondWith(
      caches.match(e.request).then(function(cached){
        if(cached) return cached;
        return fetch(e.request).then(function(res){
          if(res.ok){
            var clone = res.clone();
            caches.open(CACHE_STATIC).then(function(c){ c.put(e.request, clone); });
          }
          return res;
        });
      })
    );
  }
});

// ── Background Sync ─────────────────────────────────────────
self.addEventListener('sync', function(e){
  if(e.tag === 'cena-sync-queue'){
    e.waitUntil(
      self.clients.matchAll().then(function(clients){
        clients.forEach(function(c){ c.postMessage({type:'SYNC_READY'}); });
      })
    );
  }
});
