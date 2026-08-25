/* Generated builds replace VERSION, ASSETS, and LEGAL_PATHS. Keep the source
   values useful for the single-file/native development worker. */
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
const LEGAL_PATHS = [];

function scopePathname() {
  const pathname = new URL(self.registration.scope).pathname;
  return pathname.endsWith('/') ? pathname : pathname + '/';
}

/* Only the app root and generated legal routes are HTML cache entries. Query
   strings never create a second shell identity, and an arbitrary navigation
   can never overwrite or fall back to Home. */
function canonicalPageKey(requestUrl) {
  const url = new URL(requestUrl);
  if (url.origin !== location.origin) return null;
  const scopePath = scopePathname();
  const relative = url.pathname.startsWith(scopePath)
    ? url.pathname.slice(scopePath.length)
    : null;
  if (relative === '' || relative === 'index.html') {
    return new URL('./index.html', self.registration.scope).href;
  }
  const route = '/' + (relative || '').replace(/^\/+/, '');
  if (!LEGAL_PATHS.includes(route)) return null;
  return new URL('.' + route, self.registration.scope).href;
}

function fetchWithTimeout(request) {
  return Promise.race([
    fetch(request),
    new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), 3500)),
  ]);
}

async function pageResponse(request, key) {
  try {
    const response = await fetchWithTimeout(request);
    if (response && response.ok) {
      await caches.open(VERSION).then((cache) => cache.put(key, response.clone()));
    }
    return response;
  } catch (error) {
    const cached = await caches.match(key);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (event.request.mode === 'navigate') {
    const key = canonicalPageKey(url.href);
    if (key) event.respondWith(pageResponse(event.request, key));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response && response.ok && url.origin === location.origin) {
          const copy = response.clone();
          void caches.open(VERSION).then((cache) => cache.put(event.request, copy));
        }
        return response;
      });
    }),
  );
});
