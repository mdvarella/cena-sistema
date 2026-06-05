// ══════════════════════════════════════════════════════════════
// CENA ERP — Service Worker v5.9.10
// Estratégia: Network-first para HTML, Cache-first para estático
// ══════════════════════════════════════════════════════════════

const SW_VERSION   = 'cena-5.9.10';
const CACHE_STATIC = SW_VERSION + '-static';
const CACHE_API    = SW_VERSION + '-api';

// URLs que nunca devem ser cacheadas (APIs externas)
const BYPASS_ORIGINS = [
  'cena-ponto-api-ecbnckaufzdqgxf5.brazilsouth-01.azurewebsites.net',
  'nexusweb.com.br',
  'o2.nexusweb.com.br',
];

// Verifica se a URL pode ser cacheada
function podeCache(url) {
  // Só cachear http e https
  if (!url.protocol.startsWith('http')) return false;
  // Não cachear APIs externas
  if (BYPASS_ORIGINS.some(function(o){ return url.hostname.includes(o); })) return false;
  return true;
}

// ── Install ────────────────────────────────────────────────
self.addEventListener('install', function(e){
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_STATIC).then(function(cache){
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
self.addEventListener('fetch', function(e){
  var url;
  try {
    url = new URL(e.request.url);
  } catch(err) {
    return; // URL inválida — ignorar
  }

  // Ignorar requests não-http (chrome-extension, blob, data, etc.)
  if (!url.protocol.startsWith('http')) return;

  // API do ponto e APIs externas — sempre direto para rede, sem cache
  if (BYPASS_ORIGINS.some(function(o){ return url.hostname.includes(o); })) {
    e.respondWith(fetch(e.request));
    return;
  }

  var isHTML = e.request.destination === 'document'
    || url.pathname.endsWith('.html')
    || url.pathname.endsWith('/')
    || url.pathname === '/';

  // HTML — SEMPRE network-first
  if (isHTML) {
    e.respondWith(
      fetch(e.request, {cache:'no-store'}).then(function(res){
        return res;
      }).catch(function(){
        return caches.match(e.request).then(function(cached){
          return cached || new Response('<h2>Sem conexão — CENA ERP offline</h2>',
            {headers:{'Content-Type':'text/html'}});
        });
      })
    );
    return;
  }

  // Supabase / APIs internas — Network-first
  if (url.hostname.includes('supabase') || url.pathname.includes('/rest/v1/')
  || url.pathname.includes('/auth/v1/')) {
    e.respondWith(
      fetch(e.request).then(function(res){
        if (e.request.method === 'GET' && res.ok && podeCache(url)) {
          var clone = res.clone();
          caches.open(CACHE_API).then(function(c){
            c.put(e.request, clone).catch(function(err){
              console.warn('[SW] Falha ao cachear:', e.request.url, err);
            });
          });
        }
        return res;
      }).catch(function(){
        return caches.match(e.request);
      })
    );
    return;
  }

  // Estáticos (ícones, manifest, etc.) — Cache-first
  if (e.request.method === 'GET') {
    e.respondWith(
      caches.match(e.request).then(function(cached){
        if (cached) return cached;
        return fetch(e.request).then(function(res){
          if (res.ok && podeCache(url)) {
            var clone = res.clone();
            caches.open(CACHE_STATIC).then(function(c){
              c.put(e.request, clone).catch(function(err){
                console.warn('[SW] Falha ao cachear estático:', e.request.url, err);
              });
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
        clients.forEach(function(c){ c.postMessage({type:'SYNC_READY'}); });
      })
    );
  }
});
