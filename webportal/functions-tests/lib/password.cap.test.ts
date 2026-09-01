import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import {
  hashPassword, verifyPassword, PBKDF2_ITERATIONS, PBKDF2_MAX_ITERATIONS,
} from '../../functions/lib/password';

// The one number in this codebase that a passing local test cannot vouch for.
//
// Cloudflare's DEPLOYED Workers runtime refuses PBKDF2 above 100,000 iterations:
//
//   NotSupportedError: Pbkdf2 failed: iteration counts above 100000 are not
//   supported (requested 210000).
//
// Local workerd under `wrangler dev` does not enforce that. Measured 2026-08-31: it
// derived 210,000 iterations in 13ms and returned a hash, while the same code on
// sassi.nooutco.me threw and handed the caller a Cloudflare 1101 page. So the suite
// below deliberately does NOT try to derive its way to the answer - it reads the
// constant back and checks that every derivation in the portal goes through it.

const HERE = fileURLToPath(new URL('.', import.meta.url));
const FUNCTIONS = join(HERE, '..', '..', 'functions');

/** Every .ts file under functions/, which is everything Pages compiles into the Worker. */
function functionSources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return functionSources(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

describe('the PBKDF2 cost the portal ships', () => {
  it('is one the deployed runtime will actually derive', () => {
    // Fails against every build up to and including 4391662, which asked for 210,000
    // and could not create a single account in production.
    expect(PBKDF2_ITERATIONS).toBeLessThanOrEqual(PBKDF2_MAX_ITERATIONS);
    expect(PBKDF2_MAX_ITERATIONS).toBe(100_000);
  });

  it('is what an unqualified hash actually records', async () => {
    // The constant only protects anything if hashPassword's default is the constant.
    const stored = await hashPassword('a passphrase worth keeping');
    expect(Number(stored.split('$')[2])).toBeLessThanOrEqual(PBKDF2_MAX_ITERATIONS);
  });

  it('governs every derivation in the portal, because only one module derives', () => {
    // A second call site with its own hardcoded count would sail past the two checks
    // above. This is the check that keeps them meaningful.
    //
    // Keyed on deriveBits rather than on the word PBKDF2: deriveBits is the only call
    // that actually spends the iterations, and authPolicy.ts discusses the algorithm
    // in a comment without ever running it.
    const derivers = functionSources(FUNCTIONS)
      .filter((file) => readFileSync(file, 'utf8').includes('deriveBits'))
      .map((file) => relative(FUNCTIONS, file));
    expect(derivers).toEqual(['lib/password.ts']);
  });
});

describe('a stored hash the runtime cannot derive', () => {
  it('reads as corrupt rather than throwing out of the request', async () => {
    // Hand-built, because hashPassword can no longer produce one: this is the shape a
    // row would have if the cost were raised past the ceiling and then lowered again.
    const overCap = ['pbkdf2', 'sha256', String(PBKDF2_MAX_ITERATIONS + 1), btoa('sixteen bytes!!!'), btoa('x'.repeat(32))].join('$');
    await expect(verifyPassword('any password at all', overCap)).resolves.toEqual({
      ok: false, reason: 'corrupt',
    });
  });

  it('still accepts a hash made at or under the ceiling', async () => {
    // The guard must not swallow the ordinary case it sits next to.
    const stored = await hashPassword('a passphrase worth keeping', 1_000);
    await expect(verifyPassword('a passphrase worth keeping', stored)).resolves.toMatchObject({ ok: true });
  });
});
