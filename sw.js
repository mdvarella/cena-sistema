// ══════════════════════════════════════════════════════════════
// CENA ERP — Service Worker v8.1.110
// App shell cache (network-first no HTML e nos scripts do app).
// NÃO cacheia API Supabase / Azure / Nexus.
// IndexedDB (fila Portaria) é independente deste cache.
// ══════════════════════════════════════════════════════════════

const SW_VERSION   = 'cena-8.1.110';
const CACHE_STATIC = SW_VERSION + '-static';

const BYPASS_HOSTS = [
  'supabase.co',
  'supabase.com',
  'azurewebsites.net',
  'nexusweb.com.br'
];

const PRECACHE = [
  './',
  './index.html',
  './manifest.json',
  './portaria-offline.js'
];

// ── Install ────────────────────────────────────────────────
self.addEventListener('install', function(e){
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_STATIC).then(function(cache){
      return Promise.all(PRECACHE.map(function(url){
        return cache.add(url).catch(function(){});
      }));
    }).catch(function(){})
  );
});

// ── Activate ───────────────────────────────────────────────
self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(
        keys.filter(function(k){ return k !== CACHE_STATIC; })
            .map(function(k){ return caches.delete(k); })
      );
    }).then(function(){
      return self.clients.claim();
    }).then(function(){
      return self.clients.matchAll().then(function(clients){
        clients.forEach(function(client){
          client.postMessage({type:'SW_UPDATED', version:SW_VERSION});
        });
      });
    })
  );
});

// ── Fetch ───────────────────────────────────────────────────
self.addEventListener('fetch', function(event){
  var url;
  try {
    url = new URL(event.request.url);
  } catch(e) {
    return;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return;
  }

  // API — nunca cache-first; não interceptar
  if (BYPASS_HOSTS.some(function(host){ return url.hostname.includes(host); })) {
    return;
  }

  if (event.request.method !== 'GET') {
    return;
  }

  var isHTML = event.request.destination === 'document'
    || url.pathname.endsWith('.html')
    || url.pathname.endsWith('/')
    || url.pathname === '/';

  // HTML — network-first; grava no cache para uso offline; NÃO destrói IndexedDB
  if (isHTML) {
    event.respondWith(
      fetch(event.request, {cache: 'no-store'}).then(function(res){
        if (res && res.ok) {
          var cloneReq = res.clone();
          var cloneIdx = res.clone();
          caches.open(CACHE_STATIC).then(function(c){
            c.put(event.request, cloneReq).catch(function(){});
            c.put('./index.html', cloneIdx).catch(function(){});
          });
        }
        return res;
      }).catch(function(){
        return caches.match(event.request).then(function(cached){
          if (cached) return cached;
          return caches.match('./index.html').then(function(idx){
            return idx || caches.match('./').then(function(root){
              return root || new Response(
                '<!doctype html><meta charset="utf-8"><title>CENA</title><h2>Sem conexão — abra o CENA uma vez online para usar a Portaria offline.</h2>',
                {headers: {'Content-Type': 'text/html; charset=utf-8'}}
              );
            });
          });
        });
      })
    );
    return;
  }

  // Estáticos / scripts do app — network-first (revalida sempre); cache é só
  // fallback offline. Evita index.html novo rodar com portaria-offline.js velho.
  event.respondWith(
    fetch(event.request).then(function(res){
      if (res && res.ok) {
        var clone = res.clone();
        caches.open(CACHE_STATIC).then(function(c){
          c.put(event.request, clone).catch(function(){});
        });
      }
      return res;
    }).catch(function(){
      return caches.match(event.request);
    })
  );
});

// ── Background Sync (opcional; a Portaria NÃO depende só disto) ─
self.addEventListener('sync', function(e){
  if (e.tag === 'cena-sync-queue') {
    e.waitUntil(
      self.clients.matchAll().then(function(clients){
        clients.forEach(function(c){ c.postMessage({type: 'SYNC_READY'}); });
      })
    );
  }
});
