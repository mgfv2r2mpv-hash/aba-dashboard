// A stand-in for D1 that keeps real rows in memory.
//
// It is not a SQL engine. It recognises exactly the statements D1UserStore issues and
// refuses anything else, which is the point: if somebody adds a query and forgets the
// tests, the fake throws rather than quietly returning nothing. Constraint behaviour
// that only real SQLite can prove - the UNIQUE index, the CHECKs, the cascade - is
// covered separately in userStore.sqlite.test.ts, which runs wherever node:sqlite exists.
import type { D1Like, D1StatementLike } from './userStore';

interface Row { [column: string]: unknown }

export class FakeD1 implements D1Like {
  readonly users = new Map<string, Row>();
  readonly sessions = new Map<string, Row>();
  /** Every statement executed, in order, for tests that care about bind order. */
  readonly log: { query: string; values: unknown[] }[] = [];

  prepare(query: string): D1StatementLike {
    return new FakeStatement(this, query.replace(/\s+/g, ' ').trim());
  }
}

class FakeStatement implements D1StatementLike {
  private values: unknown[] = [];
  constructor(private readonly db: FakeD1, private readonly query: string) {}

  bind(...values: unknown[]): D1StatementLike {
    this.values = values;
    return this;
  }

  private record(): void {
    this.db.log.push({ query: this.query, values: this.values });
  }

  async first<T>(): Promise<T | null> {
    this.record();
    const q = this.query;
    if (q.includes('FROM portal_user WHERE email_folded = ?')) {
      const folded = this.values[0];
      for (const row of this.db.users.values()) if (row.email_folded === folded) return row as T;
      return null;
    }
    if (q.includes('FROM portal_user WHERE id = ?')) {
      return (this.db.users.get(String(this.values[0])) as T) ?? null;
    }
    if (q.includes('FROM portal_session WHERE token_hash = ?')) {
      return (this.db.sessions.get(String(this.values[0])) as T) ?? null;
    }
    throw new Error(`FakeD1 has no first() for: ${q}`);
  }

  async all<T>(): Promise<{ results: T[] }> {
    this.record();
    if (this.query.includes('FROM portal_user ORDER BY email_folded')) {
      const rows = [...this.db.users.values()].sort((a, b) =>
        String(a.email_folded).localeCompare(String(b.email_folded)),
      );
      return { results: rows as T[] };
    }
    throw new Error(`FakeD1 has no all() for: ${this.query}`);
  }

  async run(): Promise<unknown> {
    this.record();
    const q = this.query;
    const v = this.values;

    if (q.startsWith('INSERT INTO portal_user')) {
      const [id, email, folded, hash, must, role, disabled, created, passwordSet, lastLogin] = v;
      for (const row of this.db.users.values()) {
        if (row.email_folded === folded) throw new Error('UNIQUE constraint failed: portal_user.email_folded');
      }
      this.db.users.set(String(id), {
        id, email, email_folded: folded, password_hash: hash, must_change_password: must,
        role, disabled_at: disabled, created_at: created, password_set_at: passwordSet,
        last_login_at: lastLogin,
      });
      return {};
    }
    if (q.startsWith('UPDATE portal_user SET password_hash')) {
      const row = this.db.users.get(String(v[3]));
      if (row) { row.password_hash = v[0]; row.must_change_password = v[1]; row.password_set_at = v[2]; }
      return {};
    }
    if (q.startsWith('UPDATE portal_user SET disabled_at')) {
      const row = this.db.users.get(String(v[1]));
      if (row) row.disabled_at = v[0];
      return {};
    }
    if (q.startsWith('UPDATE portal_user SET last_login_at')) {
      const row = this.db.users.get(String(v[1]));
      if (row) row.last_login_at = v[0];
      return {};
    }
    if (q.startsWith('INSERT INTO portal_session')) {
      const [tokenHash, userId, purpose, created, expires] = v;
      this.db.sessions.set(String(tokenHash), {
        token_hash: tokenHash, user_id: userId, purpose, created_at: created, expires_at: expires,
      });
      return {};
    }
    if (q.startsWith('DELETE FROM portal_session WHERE token_hash = ?')) {
      this.db.sessions.delete(String(v[0]));
      return {};
    }
    if (q.startsWith('DELETE FROM portal_session WHERE user_id = ?')) {
      for (const [key, row] of this.db.sessions) if (row.user_id === v[0]) this.db.sessions.delete(key);
      return {};
    }
    if (q.startsWith('DELETE FROM portal_session WHERE expires_at <= ?')) {
      for (const [key, row] of this.db.sessions) {
        if (String(row.expires_at) <= String(v[0])) this.db.sessions.delete(key);
      }
      return {};
    }
    throw new Error(`FakeD1 has no run() for: ${q}`);
  }
}
