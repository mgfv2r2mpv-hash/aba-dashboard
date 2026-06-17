// Service worker for SAssi Cal PWA.
// Strategy:
//   Navigation (HTML)  — network-first, cache fallback (always get fresh app shell)
//   Assets (JS/CSS/img)— cache-first, network fallback (hashed filenames → safe to cache forever)
//   API calls          — never cached (pass-through)

const CACHE = 'sassi-cal-v1';
const PRECACHE = ['/', '/manifest.json', '/logo.png'];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(PRECACHE))
      .catch(() => {}) // non-fatal; user may be offline at install time
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Only intercept same-origin GET requests
  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // API calls — never intercept
  if (url.pathname.startsWith('/api/')) return;

  // Navigation requests (HTML) — network first, cache fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match('/').then(r => r ?? caches.match('/index.html')))
    );
    return;
  }

  // Assets — cache first, network fallback + cache update
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});
