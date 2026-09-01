// Service Worker — stale-while-revalidate for all assets.
// HTML (navigation) uses network-first so the shell stays up to date.
//
// THE CACHE NAME IS A MIGRATION, NOT A VERSION STAMP. `activate` deletes every
// cache whose name is not CACHE, so bumping this string is the only way to throw
// away a store that has gone bad in someone's browser. v2 could hold a Cloudflare
// challenge page filed under a script URL (see below), and there is no other way
// to reach into a person's browser and remove it. Bump it whenever a past version
// could be holding something wrong.
const CACHE = 'aba-portal-v3';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

/**
 * Whether a response is safe to keep under this request's URL.
 *
 * THE BUG THIS EXISTS FOR. The old rule was `if (res.ok)`, and `ok` is true for a
 * Cloudflare managed-challenge page: the edge answers 302 and the redirect lands on
 * a 200 text/html "Just a moment..." document. So a clearance cookie that lapsed
 * mid-session — the TTL on this zone is 30 minutes — got an HTML page written into
 * the cache under /assets/parse.worker-<hash>.js. Reads are cache-first, so from
 * then on the browser handed that HTML to `new Worker(...)` on every load, the
 * network was never consulted again, and the person saw "Worker failed: unknown
 * error. Try refreshing." forever. Refreshing could not help: nothing was reaching
 * the network to be corrected.
 *
 * Three separate things had to be true, so this refuses on all three:
 *   - a redirected response is never the asset that was asked for,
 *   - a cross-origin/opaque response cannot be inspected, so it is not trusted,
 *   - a script or worker request answered with HTML is a challenge or an error
 *     page wearing the URL of a script.
 */
function safeToCache(request, res) {
  if (!res.ok) return false;
  if (res.redirected) return false;
  if (res.type !== 'basic') return false;

  const wanted = request.destination;
  if (wanted === 'script' || wanted === 'worker' || wanted === 'sharedworker' || wanted === 'style') {
    const type = (res.headers.get('content-type') || '').toLowerCase();
    if (type.includes('text/html')) return false;
  }
  return true;
}

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;
  if (!request.url.startsWith('http')) return;

  // Navigation: network-first (keep index.html fresh)
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request).catch(() => caches.match('/') ?? fetch(request))
    );
    return;
  }

  // Assets: stale-while-revalidate
  e.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(request).then(cached => {
        const network = fetch(request).then(res => {
          if (safeToCache(request, res)) cache.put(request, res.clone());
          // A cached copy that the check above would now refuse is a copy written
          // by an older worker under the old rule. Drop it rather than leaving it
          // to be served again on the next load.
          else if (cached) cache.delete(request);
          return res;
        });
        return cached ?? network;
      })
    )
  );
});
