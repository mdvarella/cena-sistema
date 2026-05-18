// ══════════════════════════════════════════════════════════════
// CENA ERP — Service Worker v1.0
// Cache-first para estático, Network-first para API/Supabase
// ══════════════════════════════════════════════════════════════

const SW_VERSION = 'cena-v5.9.0';
const CACHE_STATIC = SW_VERSION + '-static';
const CACHE_API    = SW_VERSION + '-api';

// Recursos que ficam em cache offline
const PRECACHE = [
  './',
  './index.html',
  './manifest.json'
];

// ── Install: pré-cachear ────────────────────────────────────
self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(CACHE_STATIC).then(function(cache){
      return cache.addAll(PRECACHE);
    }).then(function(){
      return self.skipWaiting();
    })
  );
});

// ── Activate: limpar caches antigas ────────────────────────
self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(
        keys.filter(function(k){ return k !== CACHE_STATIC && k !== CACHE_API; })
            .map(function(k){ return caches.delete(k); })
      );
    }).then(function(){ return self.clients.claim(); })
  );
});

// ── Fetch: estratégia por tipo de requisição ────────────────
self.addEventListener('fetch', function(e){
  var url = new URL(e.request.url);

  // Supabase / APIs externas: Network-first
  if(url.hostname.includes('supabase') || url.pathname.includes('/rest/v1/')){
    e.respondWith(
      fetch(e.request).then(function(res){
        // Cachear GET de tabelas pequenas
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

  // App shell / estático: Cache-first
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

// ── Background Sync: fila offline ──────────────────────────
self.addEventListener('sync', function(e){
  if(e.tag === 'cena-sync-queue'){
    e.waitUntil(processSyncQueue());
  }
});

async function processSyncQueue(){
  var clients = await self.clients.matchAll();
  clients.forEach(function(client){
    client.postMessage({type:'SYNC_READY'});
  });
}

// ── Push Notifications (estrutura futura) ──────────────────
self.addEventListener('push', function(e){
  var data = e.data ? e.data.json() : {title:'CENA ERP', body:'Nova notificação'};
  e.waitUntil(
    self.registration.showNotification(data.title || 'CENA ERP', {
      body: data.body || '',
      icon: './manifest.json',
      badge: './manifest.json',
      tag: 'cena-notif',
      renotify: true
    })
  );
});

self.addEventListener('notificationclick', function(e){
  e.notification.close();
  e.waitUntil(clients.openWindow('./'));
});
