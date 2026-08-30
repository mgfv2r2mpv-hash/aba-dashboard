// A brake on password guessing.
//
// It counts in memory, so it is per isolate and resets when one recycles: a
// determined attacker spread across enough isolates gets more than MAX attempts.
// That is worth saying plainly rather than implying this is a real lockout. It is
// here to make online guessing slow and noisy, and the site sits behind Cloudflare
// Access as well. A durable counter belongs in D1 or a Durable Object when password
// login is opened to people Access does not already gate.

export const RATE_WINDOW_MS = 15 * 60 * 1000;
export const RATE_MAX_ATTEMPTS = 10;
export const RATE_KEYS_MAX = 512;

const attempts = new Map<string, number[]>();

export function isRateLimited(
  identity: string, now: number, store: Map<string, number[]> = attempts,
): boolean {
  const recent = (store.get(identity) ?? []).filter((at) => now - at < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX_ATTEMPTS) {
    store.set(identity, recent);
    return true;
  }
  recent.push(now);
  store.set(identity, recent);

  if (store.size > RATE_KEYS_MAX) evictDown(store, now);
  return false;
}

/** A successful sign-in clears the count, so one bad day does not lock somebody out. */
export function clearRate(identity: string, store: Map<string, number[]> = attempts): void {
  store.delete(identity);
}

/**
 * Keeps the map at its cap. Stale identities go first. If that is not enough - and it
 * is not, when a spray arrives faster than the window expires - the least recently
 * seen identities go too, whether or not their window has passed.
 *
 * That second step is a real concession and worth naming: an attacker who sprays
 * enough fresh identities can push their own counter out of the map and get a new
 * budget. It is the honest consequence of counting in memory, and the reason the
 * comment at the top of this file calls this a brake rather than a lockout. A counter
 * that cannot be flushed has to live in D1 or a Durable Object.
 */
function evictDown(store: Map<string, number[]>, now: number): void {
  for (const [key, times] of store) {
    if (times.every((at) => now - at >= RATE_WINDOW_MS)) store.delete(key);
  }
  if (store.size <= RATE_KEYS_MAX) return;

  const byAge = [...store.entries()]
    .map(([key, times]) => [key, Math.max(...times)] as const)
    .sort((a, b) => a[1] - b[1]);
  for (const [key] of byAge) {
    if (store.size <= RATE_KEYS_MAX) return;
    store.delete(key);
  }
}

/**
 * Empties the counter. The module keeps its state for the life of an isolate, which
 * is right in production and wrong across tests, where one file's failed logins would
 * otherwise be counted against the next file's.
 */
export function resetRateLimits(store: Map<string, number[]> = attempts): void {
  store.clear();
}
