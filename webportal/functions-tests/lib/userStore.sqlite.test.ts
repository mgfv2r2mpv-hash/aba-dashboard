// Drives the SAME D1UserStore against real SQLite, running the real migration file.
//
// The FakeD1 suite proves the store's behaviour and its bind order, but a fake cannot
// prove that 0001_portal_users.sql parses, that the UNIQUE index bites, that the CHECK
// constraints reject a bad role, or that deleting a user takes their sessions with
// them. This does, wherever node:sqlite exists.
//
// It SKIPS on Node 20, which is what CI pins, so treat it as a local guard on the
// schema rather than a gate. Anything it proves that the suite must never lose is
// worth also pinning in userStore.test.ts.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { D1UserStore, DuplicateEmailError, type D1Like, type D1StatementLike } from '../../functions/lib/userStore';
import { hashPassword } from '../../functions/lib/password';

let DatabaseSync: (new (path: string) => SqliteDb) | null = null;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  DatabaseSync = null;
}

interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): { get(...v: unknown[]): unknown; all(...v: unknown[]): unknown[]; run(...v: unknown[]): unknown };
}

class SqliteD1 implements D1Like {
  constructor(private readonly db: SqliteDb) {}
  prepare(query: string): D1StatementLike {
    const statement = this.db.prepare(query);
    let values: unknown[] = [];
    const self: D1StatementLike = {
      bind(...next: unknown[]) { values = next; return self; },
      async first<T>() { return (statement.get(...values) as T) ?? null; },
      async all<T>() { return { results: statement.all(...values) as T[] }; },
      async run() { return statement.run(...values); },
    };
    return self;
  }
}

const MIGRATION = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations', '0001_portal_users.sql');
const NOW = new Date('2026-08-30T12:00:00.000Z');
const FAST = 1_000;

describe.skipIf(!DatabaseSync)('the migration, against real SQLite', () => {
  let raw: SqliteDb;
  let store: D1UserStore;

  beforeEach(async () => {
    raw = new DatabaseSync!(':memory:');
    raw.exec('PRAGMA foreign_keys = ON');
    raw.exec(readFileSync(MIGRATION, 'utf-8'));
    store = new D1UserStore(new SqliteD1(raw));
  });

  const newUser = async (email: string, role = 'bt') => ({
    email, role: role as 'admin' | 'staff' | 'bt',
    passwordHash: await hashPassword('temporary123', FAST), mustChangePassword: true,
  });

  it('parses and creates both tables', () => {
    const names = raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[];
    expect(names.map((row) => row.name)).toEqual(expect.arrayContaining(['portal_user', 'portal_session']));
  });

  it('round-trips a user through the real schema', async () => {
    const created = await store.createUser(await newUser('sam@clinic.org'), NOW);
    const found = await store.findByEmail('SAM@CLINIC.ORG');
    expect(found?.id).toBe(created.id);
    expect(found?.mustChangePassword).toBe(true);
  });

  it('lets the UNIQUE index refuse a duplicate address, not just the read-ahead', async () => {
    await store.createUser(await newUser('sam@clinic.org'), NOW);
    // Go around createUser's own check and hit the constraint directly.
    expect(() => raw.prepare(
      'INSERT INTO portal_user (id, email, email_folded, password_hash, must_change_password, role, disabled_at, created_at, password_set_at, last_login_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    ).run('other-id', 'Sam@Clinic.org', 'sam@clinic.org', 'x', 0, 'bt', null, 'now', 'now', null)).toThrow(/UNIQUE/);

    await expect(store.createUser(await newUser('SAM@clinic.org'), NOW)).rejects.toBeInstanceOf(DuplicateEmailError);
  });

  it('rejects a role the schema does not name', () => {
    expect(() => raw.prepare(
      'INSERT INTO portal_user (id, email, email_folded, password_hash, must_change_password, role, disabled_at, created_at, password_set_at, last_login_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    ).run('id', 'a@b.co', 'a@b.co', 'x', 0, 'superuser', null, 'now', 'now', null)).toThrow(/CHECK/);
  });

  it('rejects a must_change_password that is not 0 or 1', () => {
    expect(() => raw.prepare(
      'INSERT INTO portal_user (id, email, email_folded, password_hash, must_change_password, role, disabled_at, created_at, password_set_at, last_login_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
    ).run('id', 'a@b.co', 'a@b.co', 'x', 7, 'bt', null, 'now', 'now', null)).toThrow(/CHECK/);
  });

  it('rejects a session purpose the schema does not name', async () => {
    const user = await store.createUser(await newUser('sam@clinic.org'), NOW);
    expect(() => raw.prepare(
      'INSERT INTO portal_session (token_hash, user_id, purpose, created_at, expires_at) VALUES (?,?,?,?,?)',
    ).run('h', user.id, 'impersonate', 'now', 'later')).toThrow(/CHECK/);
  });

  it('refuses a session pointing at nobody', async () => {
    expect(() => raw.prepare(
      'INSERT INTO portal_session (token_hash, user_id, purpose, created_at, expires_at) VALUES (?,?,?,?,?)',
    ).run('h', 'no-such-user', 'session', 'now', 'later')).toThrow(/FOREIGN KEY/);
  });

  it("takes a deleted user's sessions with them", async () => {
    const user = await store.createUser(await newUser('sam@clinic.org'), NOW);
    await store.createSession({
      tokenHash: 'h', userId: user.id, purpose: 'session',
      createdAt: NOW.toISOString(), expiresAt: '2026-08-31T00:00:00.000Z',
    });
    raw.prepare('DELETE FROM portal_user WHERE id = ?').run(user.id);
    expect(await store.findSession('h')).toBeNull();
  });

  it('is safe to run twice, so a redeploy does not fail on it', () => {
    expect(() => raw.exec(readFileSync(MIGRATION, 'utf-8'))).not.toThrow();
  });
});
