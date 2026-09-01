// The seam between the portal's login and wherever staff accounts actually live.
//
// Today there is one implementation and it is a D1 database. It is behind an
// interface for the same reason schedules are (see webportal/src/store/scheduleStore.ts):
// the endpoints should be arguing about who may log in, not about SQL, and a second
// implementation should replace mechanics rather than rewrite the endpoints.
//
// Note what PortalUser does NOT carry: the password hash. The hash only ever leaves
// this module inside StoredUser, which the endpoints use to check a password and then
// drop. Anything that reaches a JSON response is a PortalUser, so a hash cannot be
// serialised out by accident.
import { foldEmail } from './authPolicy';

export type UserRole = 'admin' | 'staff' | 'bt';
export type SessionPurpose = 'session' | 'password-change';

export interface PortalUser {
  readonly id: string;
  readonly email: string;
  readonly role: UserRole;
  readonly mustChangePassword: boolean;
  readonly disabledAt: string | null;
  readonly createdAt: string;
  readonly passwordSetAt: string;
  readonly lastLoginAt: string | null;
}

export interface StoredUser extends PortalUser {
  readonly passwordHash: string;
}

export interface PortalSession {
  readonly tokenHash: string;
  readonly userId: string;
  readonly purpose: SessionPurpose;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface NewUser {
  readonly email: string;
  readonly role: UserRole;
  readonly passwordHash: string;
  /** Admin-issued passwords arrive spent; a person setting their own does not. */
  readonly mustChangePassword: boolean;
  /**
   * Whether the row lands turned off. An invited account is created disabled and has
   * no usable password until an admin sends one, so the window between "the address
   * was typed" and "the person was told" is not a window in which anybody can sign in.
   */
  readonly disabled?: boolean;
}

export class DuplicateEmailError extends Error {
  constructor(email: string) {
    super(`An account already exists for ${email}`);
    this.name = 'DuplicateEmailError';
  }
}

export interface UserStore {
  findByEmail(email: string): Promise<StoredUser | null>;
  findById(id: string): Promise<PortalUser | null>;
  listUsers(): Promise<readonly PortalUser[]>;
  createUser(input: NewUser, now: Date): Promise<PortalUser>;
  setPassword(userId: string, passwordHash: string, mustChangePassword: boolean, now: Date): Promise<void>;
  setDisabled(userId: string, disabled: boolean, now: Date): Promise<void>;
  recordLogin(userId: string, now: Date): Promise<void>;

  createSession(session: PortalSession): Promise<void>;
  findSession(tokenHash: string): Promise<PortalSession | null>;
  deleteSession(tokenHash: string): Promise<void>;
  /** Used when a password changes: every other device holding a session loses it. */
  deleteSessionsForUser(userId: string): Promise<void>;
  deleteExpiredSessions(now: Date): Promise<void>;
}

// The slice of Cloudflare's D1Database this store actually uses. Declared here rather
// than pulled from @cloudflare/workers-types so the test suite can supply a fake
// without the portal taking on a types dependency it otherwise does not need.
export interface D1Like {
  prepare(query: string): D1StatementLike;
}
export interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

interface UserRow {
  id: string;
  email: string;
  email_folded: string;
  password_hash: string;
  must_change_password: number;
  role: string;
  disabled_at: string | null;
  created_at: string;
  password_set_at: string;
  last_login_at: string | null;
}

interface SessionRow {
  token_hash: string;
  user_id: string;
  purpose: string;
  created_at: string;
  expires_at: string;
}

const USER_COLUMNS =
  'id, email, email_folded, password_hash, must_change_password, role, disabled_at, created_at, password_set_at, last_login_at';

function toStoredUser(row: UserRow): StoredUser {
  return {
    id: row.id,
    email: row.email,
    role: row.role as UserRole,
    mustChangePassword: row.must_change_password === 1,
    disabledAt: row.disabled_at,
    createdAt: row.created_at,
    passwordSetAt: row.password_set_at,
    lastLoginAt: row.last_login_at,
    passwordHash: row.password_hash,
  };
}

function toPortalUser(row: UserRow): PortalUser {
  const { passwordHash: _hash, ...rest } = toStoredUser(row);
  return rest;
}

function toSession(row: SessionRow): PortalSession {
  return {
    tokenHash: row.token_hash,
    userId: row.user_id,
    purpose: row.purpose as SessionPurpose,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export class D1UserStore implements UserStore {
  constructor(private readonly db: D1Like) {}

  async findByEmail(email: string): Promise<StoredUser | null> {
    const row = await this.db
      .prepare(`SELECT ${USER_COLUMNS} FROM portal_user WHERE email_folded = ?`)
      .bind(foldEmail(email))
      .first<UserRow>();
    return row ? toStoredUser(row) : null;
  }

  async findById(id: string): Promise<PortalUser | null> {
    const row = await this.db
      .prepare(`SELECT ${USER_COLUMNS} FROM portal_user WHERE id = ?`)
      .bind(id)
      .first<UserRow>();
    return row ? toPortalUser(row) : null;
  }

  async listUsers(): Promise<readonly PortalUser[]> {
    const { results } = await this.db
      .prepare(`SELECT ${USER_COLUMNS} FROM portal_user ORDER BY email_folded`)
      .all<UserRow>();
    return results.map(toPortalUser);
  }

  async createUser(input: NewUser, now: Date): Promise<PortalUser> {
    const folded = foldEmail(input.email);
    const existing = await this.findByEmail(folded);
    if (existing) throw new DuplicateEmailError(input.email);

    const stamp = now.toISOString();
    const user: PortalUser = {
      id: crypto.randomUUID(),
      email: input.email.trim(),
      role: input.role,
      mustChangePassword: input.mustChangePassword,
      disabledAt: input.disabled ? stamp : null,
      createdAt: stamp,
      passwordSetAt: stamp,
      lastLoginAt: null,
    };

    // The UNIQUE index on email_folded is the real guard. The read above only makes
    // the common case a clean message instead of a constraint error, and it races:
    // two admins adding the same address at once still collide here, and should.
    try {
      await this.db
        .prepare(
          `INSERT INTO portal_user (${USER_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          user.id,
          user.email,
          folded,
          input.passwordHash,
          input.mustChangePassword ? 1 : 0,
          user.role,
          user.disabledAt,
          stamp,
          stamp,
          null,
        )
        .run();
    } catch (cause) {
      if (String(cause).includes('UNIQUE')) throw new DuplicateEmailError(input.email);
      throw cause;
    }
    return user;
  }

  async setPassword(
    userId: string, passwordHash: string, mustChangePassword: boolean, now: Date,
  ): Promise<void> {
    await this.db
      .prepare(
        'UPDATE portal_user SET password_hash = ?, must_change_password = ?, password_set_at = ? WHERE id = ?',
      )
      .bind(passwordHash, mustChangePassword ? 1 : 0, now.toISOString(), userId)
      .run();
  }

  async setDisabled(userId: string, disabled: boolean, now: Date): Promise<void> {
    await this.db
      .prepare('UPDATE portal_user SET disabled_at = ? WHERE id = ?')
      .bind(disabled ? now.toISOString() : null, userId)
      .run();
  }

  async recordLogin(userId: string, now: Date): Promise<void> {
    await this.db
      .prepare('UPDATE portal_user SET last_login_at = ? WHERE id = ?')
      .bind(now.toISOString(), userId)
      .run();
  }

  async createSession(session: PortalSession): Promise<void> {
    await this.db
      .prepare(
        'INSERT INTO portal_session (token_hash, user_id, purpose, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(session.tokenHash, session.userId, session.purpose, session.createdAt, session.expiresAt)
      .run();
  }

  async findSession(tokenHash: string): Promise<PortalSession | null> {
    const row = await this.db
      .prepare(
        'SELECT token_hash, user_id, purpose, created_at, expires_at FROM portal_session WHERE token_hash = ?',
      )
      .bind(tokenHash)
      .first<SessionRow>();
    return row ? toSession(row) : null;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.db.prepare('DELETE FROM portal_session WHERE token_hash = ?').bind(tokenHash).run();
  }

  async deleteSessionsForUser(userId: string): Promise<void> {
    await this.db.prepare('DELETE FROM portal_session WHERE user_id = ?').bind(userId).run();
  }

  async deleteExpiredSessions(now: Date): Promise<void> {
    await this.db
      .prepare('DELETE FROM portal_session WHERE expires_at <= ?')
      .bind(now.toISOString())
      .run();
  }
}
