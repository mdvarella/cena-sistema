// ══════════════════════════════════════════════════════════════
// CENA ERP — Service Worker v5.9.11
// ══════════════════════════════════════════════════════════════

const SW_VERSION   = 'cena-5.9.11';
const CACHE_STATIC = SW_VERSION + '-static';

const BYPASS_HOSTS = [
  'supabase.co',
  'supabase.com',
  'azurewebsites.net',
  'nexusweb.com.br'
];

// ── Install ────────────────────────────────────────────────
self.addEventListener('install', function(e){
  self.skipWaiting(); // ativar imediatamente sem esperar tabs antigas
  e.waitUntil(
    caches.open(CACHE_STATIC).then(function(cache){
      return cache.addAll(['./manifest.json']);
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
      return self.clients.claim(); // tomar controle imediato de todas as abas
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
    return; // URL inválida — ignorar sem interceptar
  }

  // Não interceptar URLs não-http (chrome-extension, blob, data, etc.)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return;
  }

  // Supabase, Azure e Nexusweb — direto para a rede, sem cache
  if (BYPASS_HOSTS.some(function(host){ return url.hostname.includes(host); })) {
    return;
  }

  var isHTML = event.request.destination === 'document'
    || url.pathname.endsWith('.html')
    || url.pathname.endsWith('/')
    || url.pathname === '/';

  // HTML — sempre da rede (garante versão mais recente)
  if (isHTML) {
    event.respondWith(
      fetch(event.request, {cache: 'no-store'}).catch(function(){
        return caches.match(event.request).then(function(cached){
          return cached || new Response('<h2>Sem conexão — CENA ERP offline</h2>',
            {headers: {'Content-Type': 'text/html'}});
        });
      })
    );
    return;
  }

  // Estáticos (ícones, manifest) — cache-first
  if (event.request.method === 'GET') {
    event.respondWith(
      caches.match(event.request).then(function(cached){
        if (cached) return cached;
        return fetch(event.request).then(function(res){
          if (res && res.ok) {
            var clone = res.clone();
            caches.open(CACHE_STATIC).then(function(c){
              c.put(event.request, clone).catch(function(){});
            });
          }
          return res;
        });
      })
    );
  }
});

// ── Background Sync ─────────────────────────────────────────
self.addEventListener('sync', function(e){
  if (e.tag === 'cena-sync-queue') {
    e.waitUntil(
      self.clients.matchAll().then(function(clients){
        clients.forEach(function(c){ c.postMessage({type: 'SYNC_READY'}); });
      })
    );
  }
});
