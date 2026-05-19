// Plop! Service Worker — NETWORK-FIRST pro vše.
// Strategie:
//   - Network-first pro VŠECHNY assety (vždy zkus fresh, cache jen jako offline fallback)
//   - Bez cache-first → uživatel vždy dostane fresh JS/CSS/audio když je online
//   - Cache slouží POUZE pro offline launch
//   - skipWaiting + clients.claim → nový SW se hned aktivuje
//
// Předchozí "cache-first pro assety" strategie způsobovala že:
//   - cache-bust ?t= a ?v= byl ignorován (ignoreSearch:true)
//   - JS file z předchozí verze se servíroval i po push nové verze
//   - PWA i regular browser ukazovaly starou JS (jen nový HTML version badge)
//
// POZN: SW se registruje jen z index_local.html (PWA entry).
// Gamee verze (index.html) SW nemá → Gamee iframe deployment netknut.

const _VERSION = 'v74.51';
const CACHE_NAME = `bb-cache-${_VERSION}`;

self.addEventListener('install', (e) => {
  // Žádný precache — vše se cache-uje on-demand během používání
  e.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k.startsWith('bb-cache-'))
            .map(k => { console.log('[SW] deleting cache:', k); return caches.delete(k); })
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Pouze same-origin (nebudeme cachovat 3rd-party fonts/scripts)
  if (url.origin !== self.location.origin) return;

  // Network-first pro VŠE — vždy fresh, cache jen jako offline fallback
  e.respondWith(
    fetch(req)
      .then(res => {
        // Úspěšný network response → cache update + return
        if (res && res.ok && res.type !== 'opaque') {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, clone)).catch(() => {});
        }
        return res;
      })
      .catch(() => {
        // Network fail (offline) → zkus cache
        return caches.match(req, { ignoreSearch: true });
      })
  );
});
