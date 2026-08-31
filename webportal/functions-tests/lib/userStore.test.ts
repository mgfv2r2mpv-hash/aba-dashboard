import { describe, it, expect, beforeEach } from 'vitest';
import { D1UserStore, DuplicateEmailError, type PortalUser } from '../../functions/lib/userStore';
import { FakeD1 } from '../../functions/lib/fakeD1';
import { hashPassword, verifyPassword, generateTempPassword } from '../../functions/lib/password';
import { decideLogin, expiryFrom, hasExpired } from '../../functions/lib/authPolicy';

const FAST = 1_000;
const NOW = new Date('2026-08-30T12:00:00.000Z');

let db: FakeD1;
let store: D1UserStore;

beforeEach(() => {
  db = new FakeD1();
  store = new D1UserStore(db);
});

async function addUser(email: string, password: string, mustChange = true) {
  return store.createUser(
    { email, role: 'bt', passwordHash: await hashPassword(password, FAST), mustChangePassword: mustChange },
    NOW,
  );
}

describe('createUser', () => {
  it('returns a uuid id rather than keying the account on the email', async () => {
    const user = await addUser('sam@clinic.org', 'temporary123');
    expect(user.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(user.id).not.toContain('sam');
  });

  it('keeps the typed spelling and looks up by the folded one', async () => {
    await addUser('  Sam@Clinic.ORG ', 'temporary123');
    const found = await store.findByEmail('sam@clinic.org');
    expect(found?.email).toBe('Sam@Clinic.ORG');
    expect(await store.findByEmail('SAM@CLINIC.ORG')).not.toBeNull();
  });

  it('refuses a second account on the same address whatever the casing', async () => {
    await addUser('sam@clinic.org', 'temporary123');
    await expect(addUser('SAM@clinic.org', 'temporary456')).rejects.toBeInstanceOf(DuplicateEmailError);
  });

  it('starts a new account with no login recorded and not disabled', async () => {
    const user = await addUser('sam@clinic.org', 'temporary123');
    expect(user.lastLoginAt).toBeNull();
    expect(user.disabledAt).toBeNull();
    expect(user.createdAt).toBe(NOW.toISOString());
  });
});

describe('what leaves the store', () => {
  it('never puts the password hash on a user the endpoints hand back', async () => {
    const created = await addUser('sam@clinic.org', 'temporary123');
    const byId = await store.findById(created.id);
    const listed = await store.listUsers();

    expect(created).not.toHaveProperty('passwordHash');
    expect(byId).not.toHaveProperty('passwordHash');
    expect(listed[0]).not.toHaveProperty('passwordHash');
    expect(JSON.stringify(listed)).not.toContain('pbkdf2');
  });

  it('does put the hash on the record used to check a password', async () => {
    await addUser('sam@clinic.org', 'temporary123');
    const stored = await store.findByEmail('sam@clinic.org');
    expect(stored?.passwordHash).toMatch(/^pbkdf2\$sha256\$/);
  });

  it('returns null rather than throwing for an address with no account', async () => {
    expect(await store.findByEmail('nobody@clinic.org')).toBeNull();
    expect(await store.findById('not-a-real-id')).toBeNull();
  });
});

describe('the temp password journey', () => {
  it('lets a temp password in, refuses to seat it, and seats the replacement', async () => {
    const temp = generateTempPassword();
    const user = await addUser('sam@clinic.org', temp);

    // First login: the temp password is right, and gets them only to the change screen.
    const first = await store.findByEmail('sam@clinic.org');
    const firstCheck = await verifyPassword(temp, first!.passwordHash);
    expect(decideLogin({
      passwordMatched: firstCheck.ok, disabled: first!.disabledAt !== null,
      mustChangePassword: first!.mustChangePassword,
    })).toEqual({ kind: 'must-change-password' });

    // They pick their own.
    await store.setPassword(user.id, await hashPassword('a passphrase of my own', FAST), false, NOW);

    // Second login: seated.
    const second = await store.findByEmail('sam@clinic.org');
    const secondCheck = await verifyPassword('a passphrase of my own', second!.passwordHash);
    expect(decideLogin({
      passwordMatched: secondCheck.ok, disabled: second!.disabledAt !== null,
      mustChangePassword: second!.mustChangePassword,
    })).toEqual({ kind: 'signed-in' });
  });

  it('spends the temp password: it no longer opens the account', async () => {
    const temp = generateTempPassword();
    const user = await addUser('sam@clinic.org', temp);
    await store.setPassword(user.id, await hashPassword('a passphrase of my own', FAST), false, NOW);

    const after = await store.findByEmail('sam@clinic.org');
    expect(await verifyPassword(temp, after!.passwordHash)).toEqual({ ok: false, reason: 'mismatch' });
  });

  it('makes the new password persist, which is the whole point of the flag', async () => {
    const user = await addUser('sam@clinic.org', generateTempPassword());
    const later = new Date('2026-09-15T09:00:00.000Z');
    await store.setPassword(user.id, await hashPassword('a passphrase of my own', FAST), false, later);

    const reread = await store.findById(user.id);
    expect(reread?.mustChangePassword).toBe(false);
    expect(reread?.passwordSetAt).toBe(later.toISOString());
  });

  it('can issue a fresh temp password, which puts the account back behind the gate', async () => {
    const user = await addUser('sam@clinic.org', generateTempPassword(), false);
    expect((await store.findById(user.id))?.mustChangePassword).toBe(false);

    const reissued = generateTempPassword();
    await store.setPassword(user.id, await hashPassword(reissued, FAST), true, NOW);

    const after = await store.findByEmail('sam@clinic.org');
    expect(after?.mustChangePassword).toBe(true);
    expect(decideLogin({
      passwordMatched: (await verifyPassword(reissued, after!.passwordHash)).ok,
      disabled: false, mustChangePassword: after!.mustChangePassword,
    })).toEqual({ kind: 'must-change-password' });
  });
});

describe('disabling', () => {
  it('stamps and clears disabled_at without deleting the account', async () => {
    const user = await addUser('sam@clinic.org', 'temporary123');
    await store.setDisabled(user.id, true, NOW);
    expect((await store.findById(user.id))?.disabledAt).toBe(NOW.toISOString());

    await store.setDisabled(user.id, false, NOW);
    expect((await store.findById(user.id))?.disabledAt).toBeNull();
    expect(await store.findById(user.id)).not.toBeNull();
  });

  it('shuts a disabled account out even with the right password', async () => {
    const user = await addUser('sam@clinic.org', 'temporary123', false);
    await store.setDisabled(user.id, true, NOW);
    const stored = await store.findByEmail('sam@clinic.org');
    expect(decideLogin({
      passwordMatched: (await verifyPassword('temporary123', stored!.passwordHash)).ok,
      disabled: stored!.disabledAt !== null, mustChangePassword: stored!.mustChangePassword,
    })).toEqual({ kind: 'disabled' });
  });
});

describe('recordLogin and listUsers', () => {
  it('records the login stamp without touching anything else', async () => {
    const user = await addUser('sam@clinic.org', 'temporary123');
    const before = await store.findById(user.id);
    await store.recordLogin(user.id, new Date('2026-09-01T08:30:00.000Z'));
    const after = await store.findById(user.id);

    expect(after?.lastLoginAt).toBe('2026-09-01T08:30:00.000Z');
    expect({ ...after, lastLoginAt: null }).toEqual({ ...before, lastLoginAt: null });
  });

  it('lists everyone in folded-email order', async () => {
    await addUser('zoe@clinic.org', 'temporary123');
    await addUser('Adam@clinic.org', 'temporary123');
    await addUser('mid@clinic.org', 'temporary123');
    expect((await store.listUsers()).map((u: PortalUser) => u.email))
      .toEqual(['Adam@clinic.org', 'mid@clinic.org', 'zoe@clinic.org']);
  });
});

describe('sessions', () => {
  const session = (tokenHash: string, userId: string, expiresAt: string, purpose: 'session' | 'password-change' = 'session') =>
    ({ tokenHash, userId, purpose, createdAt: NOW.toISOString(), expiresAt });

  it('round-trips a session and deletes it', async () => {
    const user = await addUser('sam@clinic.org', 'temporary123');
    await store.createSession(session('hash-1', user.id, expiryFrom(NOW, 12)));
    expect((await store.findSession('hash-1'))?.userId).toBe(user.id);

    await store.deleteSession('hash-1');
    expect(await store.findSession('hash-1')).toBeNull();
  });

  it('keeps the purpose, so a change ticket cannot pass as a session', async () => {
    const user = await addUser('sam@clinic.org', 'temporary123');
    await store.createSession(session('ticket', user.id, expiryFrom(NOW, 1), 'password-change'));
    expect((await store.findSession('ticket'))?.purpose).toBe('password-change');
  });

  it('drops every session a person holds, which is what a password change should do', async () => {
    const sam = await addUser('sam@clinic.org', 'temporary123');
    const kim = await addUser('kim@clinic.org', 'temporary123');
    await store.createSession(session('sam-laptop', sam.id, expiryFrom(NOW, 12)));
    await store.createSession(session('sam-phone', sam.id, expiryFrom(NOW, 12)));
    await store.createSession(session('kim-laptop', kim.id, expiryFrom(NOW, 12)));

    await store.deleteSessionsForUser(sam.id);
    expect(await store.findSession('sam-laptop')).toBeNull();
    expect(await store.findSession('sam-phone')).toBeNull();
    expect(await store.findSession('kim-laptop')).not.toBeNull();
  });

  it('sweeps only what has actually expired', async () => {
    const user = await addUser('sam@clinic.org', 'temporary123');
    await store.createSession(session('stale', user.id, '2026-08-30T11:00:00.000Z'));
    await store.createSession(session('exactly-now', user.id, NOW.toISOString()));
    await store.createSession(session('fresh', user.id, '2026-08-31T00:00:00.000Z'));

    await store.deleteExpiredSessions(NOW);
    expect(await store.findSession('stale')).toBeNull();
    expect(await store.findSession('exactly-now')).toBeNull();
    expect(await store.findSession('fresh')).not.toBeNull();
  });

  it('agrees with hasExpired about the boundary', async () => {
    expect(hasExpired(NOW.toISOString(), NOW)).toBe(true);
  });
});

describe('the SQL the store issues', () => {
  it('binds the folded email, never the typed one, when looking an account up', async () => {
    await addUser('Sam@Clinic.ORG', 'temporary123');
    db.log.length = 0;
    await store.findByEmail('  SAM@clinic.org  ');
    expect(db.log[0].values).toEqual(['sam@clinic.org']);
  });

  it('binds ten values in column order on insert', async () => {
    db.log.length = 0;
    await addUser('sam@clinic.org', 'temporary123');
    const insert = db.log.find((entry) => entry.query.startsWith('INSERT INTO portal_user'));
    expect(insert?.values).toHaveLength(10);
    expect(insert?.values[2]).toBe('sam@clinic.org');
    expect(insert?.values[4]).toBe(1);
  });

  it('parameterises every statement instead of interpolating', async () => {
    const user = await addUser("o'brien@clinic.org", "it's a passphrase");
    await store.setPassword(user.id, await hashPassword('another one entirely', FAST), false, NOW);
    await store.recordLogin(user.id, NOW);
    await store.setDisabled(user.id, true, NOW);
    await store.listUsers();

    for (const { query } of db.log) {
      expect(query).not.toMatch(/'/);
      expect(query).toMatch(/\?|SELECT .* FROM portal_user ORDER BY/);
    }
    expect((await store.findByEmail("o'brien@clinic.org"))?.email).toBe("o'brien@clinic.org");
  });
});
