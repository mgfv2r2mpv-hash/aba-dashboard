// Password hashing for the portal's own login.
//
// Workers ship no bcrypt, scrypt or argon2 without dragging in WASM, so this derives
// with PBKDF2-HMAC-SHA256 out of WebCrypto, which the Pages runtime and the test
// suite both have. The cost parameter and the salt live INSIDE the stored string, so
// raising the cost later re-hashes people on their next login rather than
// invalidating every password at once.

const ALGORITHM = 'pbkdf2';
const DIGEST = 'sha256';
const SALT_BYTES = 16;
const KEY_BITS = 256;

// OWASP's 2023 floor for PBKDF2-HMAC-SHA256. Measured at 17.8ms per derivation on an
// M-series laptop, so budget about that much request CPU per login and per password
// change. Logins are rare and nothing else in the portal is CPU-bound, but a Workers
// FREE plan caps a request at 10ms of CPU: on that plan this number has to come down.
// Lowering it is safe precisely because every stored hash carries the count it was
// made with, and verifyPassword reports `needsRehash` when a hash is behind.
export const PBKDF2_ITERATIONS = 210_000;

// 32 characters, no I/O/0/1, so a temp password read off a screen and typed into a
// phone does not turn into a support call. 256 is a whole multiple of 32, which is
// why the modulo below is unbiased and needs no rejection sampling.
const TEMP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export type PasswordCheck =
  | { readonly ok: true; readonly needsRehash: boolean }
  | { readonly ok: false; readonly reason: 'mismatch' | 'corrupt' };

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

// The ArrayBuffer type argument is load-bearing: a bare Uint8Array may be backed by
// a SharedArrayBuffer, which WebCrypto will not accept as a BufferSource.
function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

async function derive(
  plain: string, salt: Uint8Array<ArrayBuffer>, iterations: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(plain), 'PBKDF2', false, ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, KEY_BITS,
  );
  return new Uint8Array(bits);
}

// Compares every byte whatever happens, so the time taken says nothing about how far
// down the two hashes first differ. The length comparison is not secret: these are
// always 32 bytes.
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a[i] ^ b[i];
  return difference === 0;
}

export async function hashPassword(plain: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(plain, salt, iterations);
  return [ALGORITHM, DIGEST, String(iterations), toBase64(salt), toBase64(hash)].join('$');
}

/**
 * Separates a wrong password from a broken row on purpose. Both deny the login, but
 * only one of them means a stored hash has been corrupted, and that deserves to be
 * noticed rather than folded into "bad password" and never seen again.
 */
export async function verifyPassword(plain: string, stored: string): Promise<PasswordCheck> {
  const parts = stored.split('$');
  if (parts.length !== 5) return { ok: false, reason: 'corrupt' };

  const [algorithm, digest, iterationText, saltText, hashText] = parts;
  if (algorithm !== ALGORITHM || digest !== DIGEST) return { ok: false, reason: 'corrupt' };

  const iterations = Number(iterationText);
  if (!Number.isInteger(iterations) || iterations < 1) return { ok: false, reason: 'corrupt' };

  let salt: Uint8Array<ArrayBuffer>;
  let expected: Uint8Array<ArrayBuffer>;
  try {
    salt = fromBase64(saltText);
    expected = fromBase64(hashText);
  } catch {
    return { ok: false, reason: 'corrupt' };
  }
  if (salt.length === 0 || expected.length !== KEY_BITS / 8) return { ok: false, reason: 'corrupt' };

  const actual = await derive(plain, salt, iterations);
  if (!timingSafeEqual(actual, expected)) return { ok: false, reason: 'mismatch' };
  return { ok: true, needsRehash: iterations < PBKDF2_ITERATIONS };
}

/** The password an admin reads out to someone who has never logged in. */
export function generateTempPassword(length = 12): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = '';
  for (const byte of bytes) out += TEMP_ALPHABET[byte % TEMP_ALPHABET.length];
  return out;
}

/**
 * Session cookies are stored by their SHA-256, never in the clear, so a read-only
 * leak of the sessions table cannot be replayed into somebody's account.
 */
export async function hashSessionToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return toBase64(new Uint8Array(digest));
}

export function generateSessionToken(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(32)));
}
