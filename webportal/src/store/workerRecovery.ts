// Why a schedule would not open, and how the app gets itself out of it.
//
// THE FAILURE THIS EXISTS FOR. `new Worker(url)` fails with an ErrorEvent carrying no
// message when the browser cannot start the script, so the person was told "Worker
// failed: unknown error. Try refreshing." - a sentence that names nothing and sends
// them to a refresh that cannot help. It could not help because the thing serving the
// bad copy was the app's own service worker cache, and a reload reads from it again.
//
// The old cache rule was `if (res.ok)`, and `ok` is true for a Cloudflare managed
// challenge: the edge answers 302 and the redirect lands on a 200 text/html page. That
// HTML got written under a script URL. sw.js refuses that now, but a browser that
// already holds one is not reached by fixing the rule - only by finding the entry and
// removing it, which is what this module does.
//
// It looks for the SHAPE of the problem rather than for one known URL: any cached
// script holding HTML. That finds every poisoned entry instead of the one we happened
// to name, and it needs no plumbing to tell it where the worker lives - which matters,
// because the worker's URL cannot be hoisted out of `new Worker(new URL(...))` without
// Vite silently dropping the worker from the build. See the guard in
// `workerBundle.test.ts`.

/** One cached script that is not a script. */
export interface PoisonedEntry {
  readonly url: string;
  readonly cacheName: string;
  readonly contentType: string;
}

export interface PurgeReport {
  readonly cachesDeleted: readonly string[];
  readonly workersUnregistered: number;
}

/** The browser bits this needs, named so a test can hand over its own. */
export interface RecoveryEnv {
  readonly caches: CacheStorage | undefined;
  readonly serviceWorker: ServiceWorkerContainer | undefined;
}

const SCRIPT_URL = /\.(?:js|mjs)(?:\?.*)?$/i;

/**
 * Every cached response filed under a script URL that is not JavaScript.
 *
 * Returns an empty list when the browser has no Cache Storage, which is the honest
 * answer rather than a failure: nothing cached means nothing poisoned.
 */
export async function findPoisonedScripts(env: RecoveryEnv): Promise<readonly PoisonedEntry[]> {
  if (!env.caches) return [];
  const found: PoisonedEntry[] = [];
  let names: readonly string[];
  try {
    names = await env.caches.keys();
  } catch {
    // A browser that refuses to enumerate caches (private mode, blocked storage) tells
    // us nothing either way, and must not turn a worker failure into a second error.
    return [];
  }

  for (const cacheName of names) {
    try {
      const cache = await env.caches.open(cacheName);
      for (const request of await cache.keys()) {
        if (!SCRIPT_URL.test(new URL(request.url).pathname)) continue;
        const cached = await cache.match(request);
        if (!cached) continue;
        const contentType = (cached.headers.get('content-type') || '').toLowerCase();
        if (contentType.includes('text/html')) {
          found.push({ url: request.url, cacheName, contentType });
        }
      }
    } catch {
      // One unreadable cache must not hide the others.
    }
  }
  return found;
}

/**
 * Throws away every cache and every service worker registration for this origin.
 *
 * Deliberately total rather than surgical. This runs only after a script has been
 * proven corrupt, at which point the cache has demonstrated it cannot be trusted, and
 * a service worker that wrote one entry under the old rule may hold others. Everything
 * here is a copy of something the network still has.
 */
export async function purgeBrowserCopies(env: RecoveryEnv): Promise<PurgeReport> {
  const cachesDeleted: string[] = [];
  if (env.caches) {
    try {
      for (const name of await env.caches.keys()) {
        if (await env.caches.delete(name)) cachesDeleted.push(name);
      }
    } catch {
      // Nothing to add; the report says what actually went.
    }
  }

  let workersUnregistered = 0;
  if (env.serviceWorker) {
    try {
      for (const registration of await env.serviceWorker.getRegistrations()) {
        if (await registration.unregister()) workersUnregistered += 1;
      }
    } catch {
      // Same.
    }
  }
  return { cachesDeleted, workersUnregistered };
}

/** What the store does when a worker will not start. */
export interface Recovery {
  inspect(): Promise<readonly PoisonedEntry[]>;
  purge(): Promise<PurgeReport>;
}

export function browserRecovery(): Recovery {
  const env: RecoveryEnv = {
    caches: typeof caches === 'undefined' ? undefined : caches,
    serviceWorker: typeof navigator === 'undefined' ? undefined : navigator.serviceWorker,
  };
  return {
    inspect: () => findPoisonedScripts(env),
    purge: () => purgeBrowserCopies(env),
  };
}

/**
 * The sentence the person reads.
 *
 * Names the file and says what was found in place of it, because "unknown error" is
 * what sent this bug round three separate wrong diagnoses. When the app healed itself
 * the person is told that too, so a success that looks like a glitch reads as a fix.
 */
export function describeWorkerFailure(
  poisoned: readonly PoisonedEntry[],
  purged: PurgeReport | null,
): string {
  if (poisoned.length === 0) {
    return 'The decryption worker would not start, and nothing in this browser explains why. '
      + 'Reload the page; if it happens again the file has not been touched.';
  }
  const one = poisoned[0];
  const name = new URL(one.url).pathname.split('/').pop() ?? one.url;
  const also = poisoned.length > 1 ? ` (and ${poisoned.length - 1} more)` : '';
  const cleared = purged
    ? ' Cleared it and tried again.'
    : '';
  return `This browser had a web page saved in place of the program file ${name}${also}, `
    + `so the decryption step could not start.${cleared}`;
}
