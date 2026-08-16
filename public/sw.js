/* Knucklebones service worker.

   Strategy:
   - The PAGE (index.html / navigations) is NETWORK-FIRST with a 3.5s timeout
     falling back to cache. A fresh deploy is visible on the very next launch —
     no "close it twice" ritual — while offline launches still boot instantly
     from cache.
   - Everything else (icons, manifest) is cache-first; those only change
     together with a new VERSION anyway.
   - Install fetches bypass the HTTP cache (cache:'reload') so hosts with
     aggressive caching can't freeze an old copy into a new cache. */
const VERSION = 'kb-dev';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSION)
      .then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const isPage = e.request.mode === 'navigate' ||
    (url.origin === location.origin &&
      (url.pathname.endsWith('/index.html') || url.pathname.endsWith('/')));

  if (isPage) {
    e.respondWith(
      Promise.race([
        fetch(e.request).then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then(c => c.put('./index.html', copy));
          }
          return res;
        }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 3500))
      ]).catch(() =>
        caches.match('./index.html').then(hit => hit || fetch(e.request))
      )
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(hit => {
      if (hit) return hit;
      return fetch(e.request)
        .then(res => {
          if (res && res.ok && url.origin === location.origin) {
            const copy = res.clone();
            caches.open(VERSION).then(c => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});
