import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';

// The service worker is a plain script with no module boundary, so it is loaded here
// the way a browser loads it: into a context carrying stubbed service-worker globals.
// That lets the caching rule be exercised directly instead of asserted about.
//
// WHAT THIS IS PROTECTING. `if (res.ok)` was true for a Cloudflare managed-challenge
// page, because the challenge answers 302 and the redirect lands on a 200 text/html
// document. The worker wrote that HTML into the cache under a script URL, reads are
// cache-first, and the browser then handed HTML to `new Worker(...)` on every load:
// "Worker failed: unknown error. Try refreshing", permanently, with nothing reaching
// the network to correct it.

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SW = join(HERE, '..', 'public', 'sw.js');

interface FetchEventLike {
  request: { method: string; url: string; mode: string; destination: string };
  respondWith: (value: unknown) => void;
}

interface SwGlobals {
  safeToCache(request: { destination: string }, res: unknown): boolean;
  CACHE: string;
  /** The listeners sw.js registered, by event name, so they can be dispatched. */
  listeners: Map<string, ((event: FetchEventLike) => void)[]>;
}

/** Runs sw.js in a context with the globals a service worker gets, and hands it back. */
function loadServiceWorker(): SwGlobals {
  const listeners = new Map<string, ((event: FetchEventLike) => void)[]>();
  const sandbox: Record<string, unknown> = {
    self: {
      addEventListener: (type: string, fn: (event: FetchEventLike) => void) => {
        listeners.set(type, [...(listeners.get(type) ?? []), fn]);
      },
      skipWaiting: () => {},
      clients: { claim: () => {} },
    },
    caches: {
      keys: async () => [],
      delete: async () => true,
      // A whole Cache, not an empty object: the fetch handler calls match/put/delete on
      // whatever open() hands back, and a stub missing them turns a real interception
      // into an unhandled rejection that reads like a harness fault rather than a result.
      open: async () => ({ match: async () => undefined, put: async () => {}, delete: async () => true }),
      match: async () => undefined,
    },
    fetch: async () => ({ ok: true, redirected: false, type: 'basic', clone: () => ({}), headers: { get: () => null } }),
    URL,
  };
  const ctx = createContext(sandbox);
  ctx.listeners = listeners;
  // A function declaration lands on the context object; a top-level `const` does not,
  // it stays in the script's own lexical scope. So CACHE is handed out from inside the
  // same script rather than read off the context afterwards, where it reads undefined
  // and quietly satisfies any assertion phrased as "not equal to the old value".
  runInContext(readFileSync(SW, 'utf8') + '\n;globalThis.CACHE = CACHE;', ctx);
  return ctx as unknown as SwGlobals;
}

/** A response shaped the way the caching rule inspects one. */
function response(over: Partial<{ ok: boolean; redirected: boolean; type: string; contentType: string }> = {}) {
  const { ok = true, redirected = false, type = 'basic', contentType = 'application/javascript' } = over;
  return { ok, redirected, type, headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? contentType : null) } };
}

const scriptRequest = { destination: 'script' };
const workerRequest = { destination: 'worker' };

describe('what the service worker is willing to keep', () => {
  const sw = loadServiceWorker();

  it('refuses an HTML page offered as a worker script', () => {
    // The whole outage in one assertion. Fails against the previous sw.js, which
    // asked only whether the response was ok.
    const challengePage = response({ contentType: 'text/html; charset=UTF-8' });
    expect(sw.safeToCache(workerRequest, challengePage)).toBe(false);
  });

  it('refuses an HTML page offered as a script', () => {
    expect(sw.safeToCache(scriptRequest, response({ contentType: 'text/html' }))).toBe(false);
  });

  it('refuses anything that arrived through a redirect', () => {
    // A challenge answers 302 first. Even when the final document looks right, a
    // redirected response is not the asset that was asked for.
    expect(sw.safeToCache(scriptRequest, response({ redirected: true }))).toBe(false);
  });

  it('refuses a response it cannot inspect', () => {
    expect(sw.safeToCache(scriptRequest, response({ type: 'opaque' }))).toBe(false);
  });

  it('refuses a response that failed', () => {
    expect(sw.safeToCache(scriptRequest, response({ ok: false }))).toBe(false);
  });

  it('still keeps the real thing, or the cache is pointless', () => {
    // The check has to stay narrow. A rule that refuses everything would "fix" the
    // bug by turning the service worker off, which is not the same fix.
    expect(sw.safeToCache(workerRequest, response())).toBe(true);
    expect(sw.safeToCache(scriptRequest, response({ contentType: 'text/javascript' }))).toBe(true);
    expect(sw.safeToCache({ destination: 'image' }, response({ contentType: 'image/svg+xml' }))).toBe(true);
  });
});

describe('the cache name', () => {
  it('has moved past every version that could hold something wrong', () => {
    // `activate` deletes every cache that is not this one, so bumping the name is the
    // only reach anyone has into a browser already holding a bad copy. Two versions
    // are now disqualified for two different reasons: v2 could hold a challenge page
    // filed under a script URL, and v3 could hold an authenticated people list,
    // because it ran in front of `/api/`. Going back to either strands somebody.
    expect(loadServiceWorker().CACHE).not.toBe('aba-portal-v2');
    expect(loadServiceWorker().CACHE).not.toBe('aba-portal-v3');
    expect(loadServiceWorker().CACHE).toMatch(/^aba-portal-v[4-9]\d*$/);
  });
});

describe('what the service worker refuses to come between', () => {
  /** Dispatches one GET at the worker's fetch handler and says whether it answered. */
  function intercepted(url: string, over: Partial<{ mode: string; destination: string }> = {}) {
    const sw = loadServiceWorker();
    const handler = sw.listeners.get('fetch')?.[0];
    if (!handler) throw new Error('sw.js registered no fetch listener');
    let answered = false;
    handler({
      request: { method: 'GET', url, mode: over.mode ?? 'cors', destination: over.destination ?? '' },
      respondWith: () => { answered = true; },
    });
    return answered;
  }

  // WHAT THIS IS PROTECTING, and it is two separate harms from one cause.
  //
  // The worker used to sit in front of every same-origin GET, `/api/` included. Those
  // responses are authenticated and per-session, so a cached people list or session
  // record outlived signing out, and stale-while-revalidate would hand the previous
  // answer to whoever opened the browser next.
  //
  // It also put the cache layer in the failure path of every admin call. A rejection
  // anywhere inside `respondWith` reaches the page as a fetch that threw carrying no
  // response at all, which the portal can only report as "The server did not answer" -
  // indistinguishable, from the page's side, from the network being down.
  it('never answers for an API call', () => {
    expect(intercepted('https://sassi.nooutco.me/api/admin/users')).toBe(false);
    expect(intercepted('https://sassi.nooutco.me/api/auth/session')).toBe(false);
    expect(intercepted('https://sassi.nooutco.me/api/claude/v1/messages')).toBe(false);
  });

  it('still answers for the assets it exists to cache', () => {
    // The skip has to stay narrow. A worker that steps back from everything would
    // "fix" this by turning itself off, which is not the same fix.
    expect(intercepted('https://sassi.nooutco.me/assets/index-D6PC6tv9.js', { destination: 'script' })).toBe(true);
    expect(intercepted('https://sassi.nooutco.me/assets/parse.worker-Cs9QSITe.js', { destination: 'worker' })).toBe(true);
    expect(intercepted('https://sassi.nooutco.me/icon.svg', { destination: 'image' })).toBe(true);
  });

  it('does not mistake a path that merely starts with the letters api', () => {
    expect(intercepted('https://sassi.nooutco.me/apiary/notes.js', { destination: 'script' })).toBe(true);
  });

  it('still takes navigation, which is how index.html stays fresh', () => {
    expect(intercepted('https://sassi.nooutco.me/', { mode: 'navigate' })).toBe(true);
  });
});
