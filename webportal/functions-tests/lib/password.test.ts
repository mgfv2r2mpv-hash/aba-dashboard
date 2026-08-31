import { describe, it, expect } from 'vitest';
import {
  hashPassword, verifyPassword, generateTempPassword,
  hashSessionToken, generateSessionToken, PBKDF2_ITERATIONS,
} from './password';

// The real cost parameter is deliberately slow. Tests that only care about the
// algorithm pass a small one; the two that care about the shipped constant say so.
const FAST = 1_000;

describe('hashPassword', () => {
  it('encodes algorithm, digest, cost and salt into the stored string', async () => {
    const stored = await hashPassword('correct horse battery staple', FAST);
    const [algorithm, digest, iterations, salt, hash] = stored.split('$');
    expect(algorithm).toBe('pbkdf2');
    expect(digest).toBe('sha256');
    expect(Number(iterations)).toBe(FAST);
    expect(atob(salt)).toHaveLength(16);
    expect(atob(hash)).toHaveLength(32);
  });

  it('salts every hash, so the same password stored twice does not collide', async () => {
    const a = await hashPassword('same password', FAST);
    const b = await hashPassword('same password', FAST);
    expect(a).not.toBe(b);
    await expect(verifyPassword('same password', a)).resolves.toMatchObject({ ok: true });
    await expect(verifyPassword('same password', b)).resolves.toMatchObject({ ok: true });
  });

  it('defaults to the shipped cost when none is given', async () => {
    const stored = await hashPassword('a passphrase worth keeping');
    expect(Number(stored.split('$')[2])).toBe(PBKDF2_ITERATIONS);
  });
});

describe('verifyPassword', () => {
  it('accepts the right password', async () => {
    const stored = await hashPassword('a passphrase worth keeping', FAST);
    expect(await verifyPassword('a passphrase worth keeping', stored)).toEqual({ ok: true, needsRehash: true });
  });

  it('rejects the wrong password as a mismatch, not as corruption', async () => {
    const stored = await hashPassword('a passphrase worth keeping', FAST);
    expect(await verifyPassword('a passphrase worth keepinG', stored)).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('reports needsRehash only when the stored cost is behind the shipped one', async () => {
    const behind = await hashPassword('a passphrase worth keeping', FAST);
    const current = await hashPassword('a passphrase worth keeping', PBKDF2_ITERATIONS);
    expect(await verifyPassword('a passphrase worth keeping', behind)).toEqual({ ok: true, needsRehash: true });
    expect(await verifyPassword('a passphrase worth keeping', current)).toEqual({ ok: true, needsRehash: false });
  });

  it.each([
    ['empty', ''],
    ['too few fields', 'pbkdf2$sha256$1000$c2FsdA=='],
    ['too many fields', 'pbkdf2$sha256$1000$c2FsdA==$aGFzaA==$extra'],
    ['unknown algorithm', 'bcrypt$sha256$1000$c2FsdA==$aGFzaA=='],
    ['unknown digest', 'pbkdf2$sha512$1000$c2FsdA==$aGFzaA=='],
    ['non-numeric cost', 'pbkdf2$sha256$lots$c2FsdA==$aGFzaA=='],
    ['zero cost', 'pbkdf2$sha256$0$c2FsdA==$aGFzaA=='],
    ['negative cost', 'pbkdf2$sha256$-5$c2FsdA==$aGFzaA=='],
    ['unparseable base64', 'pbkdf2$sha256$1000$!!!!$aGFzaA=='],
    ['hash of the wrong length', 'pbkdf2$sha256$1000$c2FsdA==$aGFzaA=='],
  ])('calls a %s stored value corrupt rather than a mismatch', async (_label, stored) => {
    expect(await verifyPassword('anything at all', stored)).toEqual({ ok: false, reason: 'corrupt' });
  });
});

describe('generateTempPassword', () => {
  it('avoids the characters people misread aloud', () => {
    const alphabet = new Set('ABCDEFGHJKLMNPQRSTUVWXYZ23456789');
    for (let attempt = 0; attempt < 200; attempt += 1) {
      for (const character of generateTempPassword()) expect(alphabet.has(character)).toBe(true);
    }
  });

  it('is twelve characters unless asked otherwise, and does not repeat itself', () => {
    expect(generateTempPassword()).toHaveLength(12);
    expect(generateTempPassword(20)).toHaveLength(20);
    const seen = new Set(Array.from({ length: 200 }, () => generateTempPassword()));
    expect(seen.size).toBe(200);
  });
});

describe('session tokens', () => {
  it('hashes to a stable value that is not the token', async () => {
    const token = generateSessionToken();
    const hash = await hashSessionToken(token);
    expect(hash).not.toBe(token);
    expect(await hashSessionToken(token)).toBe(hash);
    expect(await hashSessionToken(generateSessionToken())).not.toBe(hash);
  });

  it('mints tokens with 256 bits behind them', () => {
    expect(atob(generateSessionToken())).toHaveLength(32);
    const seen = new Set(Array.from({ length: 200 }, () => generateSessionToken()));
    expect(seen.size).toBe(200);
  });
});
