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

interface SwGlobals {
  safeToCache(request: { destination: string }, res: unknown): boolean;
  CACHE: string;
}

/** Runs sw.js in a context with the globals a service worker gets, and hands it back. */
function loadServiceWorker(): SwGlobals {
  const sandbox: Record<string, unknown> = {
    self: { addEventListener: () => {}, skipWaiting: () => {}, clients: { claim: () => {} } },
    caches: { keys: async () => [], delete: async () => true, open: async () => ({}), match: async () => undefined },
    fetch: async () => ({}),
  };
  const ctx = createContext(sandbox);
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
  it('has moved past the version that could hold a poisoned entry', () => {
    // `activate` deletes every cache that is not this one, so bumping the name is the
    // only reach anyone has into a browser already holding the bad copy. If this ever
    // goes back to v2, everyone who hit the bug keeps hitting it.
    expect(loadServiceWorker().CACHE).not.toBe('aba-portal-v2');
    expect(loadServiceWorker().CACHE).toMatch(/^aba-portal-v[3-9]\d*$/);
  });
});
