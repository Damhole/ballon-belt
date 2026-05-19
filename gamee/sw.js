// Plop! Service Worker — offline-first PWA caching.
// Strategie:
//   - Network-first pro HTML (vždy chce čerstvý dokument)
//   - Cache-first pro assety (JS, CSS, audio, GLB, images) — instant offline load
//   - ignoreSearch při lookupu → cache-bust query params (?t=, ?v=) ignorovány
//   - Cache versioning přes _VERSION → bump verze invaliduje starý cache
//
// POZN: SW se registruje jen z index_local.html (PWA entry).
// Gamee verze (index.html) SW nemá → Gamee iframe deployment netknut.

const _VERSION = 'v74.36';
const CACHE_NAME = `bb-cache-${_VERSION}`;

// Critical bootstrap — musí být cached aby PWA fungovala offline
const PRECACHE = [
  './',
  './index_local.html',
  './manifest.json',
  './css/game.css',
  './js/game.js',
  './js/levels.js',
  './js/render3d.js',
  './js/render3d_bottom.js',
  './js/debug.js',
  './lib/three.module.min.js',
  './lib/GLTFLoader.js',
  './lib/gamee-js-stub.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      // allSettled → install nefailne pokud jeden URL 404
      .then(cache => Promise.allSettled(PRECACHE.map(url => cache.add(url))))
      .then(results => {
        const failed = results.filter(r => r.status === 'rejected');
        if (failed.length) console.warn('[SW] precache failures:', failed.length);
        return self.skipWaiting();
      })
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME && k.startsWith('bb-cache-'))
            .map(k => { console.log('[SW] deleting old cache:', k); return caches.delete(k); })
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

  const isHTML = req.destination === 'document' || /\.html?$/.test(url.pathname);

  if (isHTML) {
    // Network-first pro HTML — vždy zkusíme čerstvý dokument, cache jako fallback
    e.respondWith(
      fetch(req)
        .then(res => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => caches.match(req, { ignoreSearch: true }))
    );
  } else {
    // Cache-first pro assety — instant offline, network jen při miss
    e.respondWith(
      caches.match(req, { ignoreSearch: true }).then(cached => {
        if (cached) return cached;
        return fetch(req).then(res => {
          if (res && res.ok && res.type !== 'opaque') {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
          }
          return res;
        });
      })
    );
  }
});
