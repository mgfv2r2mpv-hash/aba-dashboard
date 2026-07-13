// Memoized, lazy loader for the password dictionary (src/passwordDict.ts). Keeps the
// wordlist in its own dynamically-imported chunk so it never enters a critical bundle,
// and shares one in-flight promise across every caller. Fails soft to an empty set —
// a blocked import must not block a save; the other strength rules still apply.
let cached: Promise<ReadonlySet<string>> | null = null;

export function loadPasswordDict(): Promise<ReadonlySet<string>> {
  if (!cached) {
    cached = import('./passwordDict')
      .then((m) => m.PASSWORD_DICT)
      .catch(() => new Set<string>());
  }
  return cached;
}
