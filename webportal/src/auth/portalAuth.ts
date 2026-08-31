// The browser's half of the portal's account login.
//
// Everything here talks to a Pages Function under /api, and every one of those can
// answer three different ways: a normal outcome, a refusal the person has to read, or
// a deployment with no login store bound at all. Those are three different things and
// this file keeps them apart, so no screen downstream has to guess which it got.
//
// Outcomes are RETURNED, as unions the caller switches on. Refusals THROW an
// AuthError carrying the server's own sentence, because the endpoints write those
// sentences for the person reading them and this file has no business rewriting them.
//
// Nothing here is React, so the whole transport is testable without a DOM.

export type UserRole = 'admin' | 'staff' | 'bt';

export const ROLES: readonly UserRole[] = ['admin', 'staff', 'bt'];

/** How a role reads on screen. The store speaks in slugs; people do not. */
export const ROLE_LABELS: Readonly<Record<UserRole, string>> = {
  admin: 'Administrator',
  staff: 'Staff',
  bt: 'Behavior technician',
};

/** Who is signed in. The three fields every screen needs and nothing more. */
export interface Account {
  readonly id: string;
  readonly email: string;
  readonly role: UserRole;
}

/** What the admin list shows. Same account, seen from the other side of the desk. */
export interface ManagedUser extends Account {
  readonly mustChangePassword: boolean;
  readonly disabledAt: string | null;
  readonly createdAt: string;
  readonly passwordSetAt: string;
  readonly lastLoginAt: string | null;
}

/**
 * A refusal, carrying the status and the server's own wording.
 *
 * `status` is 0 for a request that never reached a server at all, which is the one
 * case where the message below is ours rather than the endpoint's.
 */
export class AuthError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }

  /** No login store is bound on this deployment, so app login is not running here. */
  get isUnconfigured(): boolean {
    return this.status === 503;
  }

  /** The server never answered, as opposed to answering no. */
  get isOffline(): boolean {
    return this.status === 0;
  }
}

const JSON_HEADERS: Readonly<Record<string, string>> = {
  'Content-Type': 'application/json; charset=utf-8',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads whatever the server sent.
 *
 * Deliberately tolerant of a non-JSON body: functions/_middleware.ts refuses a
 * missing Access token with `text/plain`, not JSON, and folding that into the same
 * `{ error }` shape means one error path instead of two.
 */
async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: text.trim() };
  }
}

function messageFrom(body: unknown, status: number): string {
  if (isRecord(body) && typeof body.error === 'string' && body.error.length > 0) {
    return body.error;
  }
  if (status === 401) return 'Sign in first.';
  if (status === 403) return 'You are not allowed to do that.';
  if (status === 429) return 'Too many attempts. Wait a few minutes, then try again.';
  return 'The server could not complete that. Try again.';
}

async function call(path: string, init: RequestInit = {}): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...init });
  } catch {
    throw new AuthError(0, 'The server did not answer. Check your connection, then try again.');
  }

  const body = await readBody(response);
  if (!response.ok) throw new AuthError(response.status, messageFrom(body, response.status));
  return body;
}

function post(path: string, payload?: unknown): Promise<unknown> {
  return call(path, {
    method: 'POST',
    headers: JSON_HEADERS,
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
}

/**
 * The server answered in a shape this build does not know. Treated as a server fault
 * rather than silently coerced, because a login screen that guesses is worse than one
 * that says it cannot tell.
 */
function unreadable(): AuthError {
  return new AuthError(500, 'The server gave an answer this app does not understand.');
}

function asAccount(value: unknown): Account | null {
  if (!isRecord(value)) return null;
  const { id, email, role } = value;
  if (typeof id !== 'string' || typeof email !== 'string') return null;
  if (typeof role !== 'string' || !(ROLES as readonly string[]).includes(role)) return null;
  return { id, email, role: role as UserRole };
}

function asManagedUser(value: unknown): ManagedUser | null {
  const account = asAccount(value);
  if (!account || !isRecord(value)) return null;
  return {
    ...account,
    mustChangePassword: value.mustChangePassword === true,
    disabledAt: typeof value.disabledAt === 'string' ? value.disabledAt : null,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
    passwordSetAt: typeof value.passwordSetAt === 'string' ? value.passwordSetAt : '',
    lastLoginAt: typeof value.lastLoginAt === 'string' ? value.lastLoginAt : null,
  };
}

// ─── The session ────────────────────────────────────────────────────────────────

export type SessionState =
  /** No login store is bound here, so Cloudflare Access is still the only gate. */
  | { readonly kind: 'unconfigured' }
  /**
   * Nobody is signed in. `accessEmail` is who Access says reached the origin, which
   * the sign-in screen fills the email field with. `holdsChangeTicket` means a temp
   * password was already spent and the person owes us a new one.
   */
  | {
      readonly kind: 'signed-out';
      readonly accessEmail: string | null;
      readonly holdsChangeTicket: boolean;
    }
  | { readonly kind: 'signed-in'; readonly user: Account; readonly mustChangePassword: boolean };

/**
 * Who is signed in, asked on every load.
 *
 * GET /api/auth/session answers 200 with `signedIn: false` rather than 401, because
 * "nobody is signed in" is an ordinary answer to that question. A 503 is the one
 * status this turns into an outcome instead of a throw: it means the deployment has
 * no store bound, which is a configuration state and not a refusal.
 */
export async function readSession(): Promise<SessionState> {
  let body: unknown;
  try {
    body = await call('/api/auth/session');
  } catch (error) {
    if (error instanceof AuthError && error.isUnconfigured) return { kind: 'unconfigured' };
    throw error;
  }

  if (!isRecord(body)) throw unreadable();

  if (body.signedIn === true) {
    const user = asAccount(body.user);
    if (!user) throw unreadable();
    return { kind: 'signed-in', user, mustChangePassword: body.mustChangePassword === true };
  }

  if (body.signedIn === false) {
    return {
      kind: 'signed-out',
      accessEmail: typeof body.accessEmail === 'string' ? body.accessEmail : null,
      holdsChangeTicket: body.mustChangePassword === true,
    };
  }

  throw unreadable();
}

export type SignInOutcome =
  | { readonly kind: 'signed-in'; readonly user: Account }
  /** The password worked and was a temp one, so it bought a ticket, not a session. */
  | { readonly kind: 'must-change-password'; readonly expiresAt: string };

export async function signIn(email: string, password: string): Promise<SignInOutcome> {
  const body = await post('/api/auth/login', { email, password });
  if (!isRecord(body)) throw unreadable();

  if (body.status === 'must-change-password') {
    return {
      kind: 'must-change-password',
      expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : '',
    };
  }
  if (body.status === 'signed-in') {
    const user = asAccount(body.user);
    if (!user) throw unreadable();
    return { kind: 'signed-in', user };
  }
  throw unreadable();
}

export async function signOut(): Promise<void> {
  await post('/api/auth/session');
}

/**
 * Sets a new password, on a change ticket or on an ordinary session.
 *
 * Pass `currentPassword` when the person already holds a session, because the server
 * demands proof they own the password they are replacing. Omit it on the ticket path,
 * where the temp password was already checked to mint the ticket.
 *
 * Either way the server drops EVERY session that person holds and clears both
 * cookies, so the caller lands signed out and signs in again with what they just
 * chose. That second sign-in is also the first proof the new password took.
 */
export async function setPassword(input: {
  readonly newPassword: string;
  readonly currentPassword?: string;
}): Promise<void> {
  await post('/api/auth/password', {
    newPassword: input.newPassword,
    ...(input.currentPassword === undefined ? {} : { currentPassword: input.currentPassword }),
  });
}

// ─── The accounts ───────────────────────────────────────────────────────────────

export async function listUsers(): Promise<readonly ManagedUser[]> {
  const body = await call('/api/admin/users');
  if (!isRecord(body) || !Array.isArray(body.users)) throw unreadable();
  const users = body.users.map(asManagedUser);
  if (users.some((user) => user === null)) throw unreadable();
  return users as readonly ManagedUser[];
}

/**
 * The temp password comes back exactly once, in this response. No endpoint reads it
 * back, so a caller that drops it has to issue another one.
 */
export interface Issued {
  readonly user: ManagedUser;
  readonly tempPassword: string;
}

function asIssued(body: unknown): Issued {
  if (!isRecord(body) || typeof body.tempPassword !== 'string') throw unreadable();
  const user = asManagedUser(body.user);
  if (!user) throw unreadable();
  return { user, tempPassword: body.tempPassword };
}

/**
 * Makes an account.
 *
 * The role asked for here is not always the role granted: when the store is empty the
 * server forces 'admin', because the account that opens the store has to be able to
 * make the next one. Read the role off the returned user rather than off the request.
 */
export async function createUser(email: string, role: UserRole): Promise<Issued> {
  return asIssued(await post('/api/admin/users', { email, role }));
}

async function patch(payload: Record<string, unknown>): Promise<unknown> {
  return call('/api/admin/users', {
    method: 'PATCH',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
}

export async function setUserDisabled(userId: string, disabled: boolean): Promise<void> {
  await patch({ userId, disabled });
}

export async function reissueTempPassword(userId: string): Promise<Issued> {
  return asIssued(await patch({ userId, reissueTempPassword: true }));
}

/**
 * Whether this caller may make the FIRST account.
 *
 * There is no endpoint that answers this directly, so it is read off the one that
 * does the work. GET /api/admin/users succeeds for an Access-authenticated caller
 * while the store is empty, and refuses once it is not, which is exactly the
 * condition the sign-in screen needs to know about. A refusal here is not an error to
 * show anybody: it is the ordinary answer once accounts exist.
 */
export async function isFirstRunOpen(): Promise<boolean> {
  try {
    return (await listUsers()).length === 0;
  } catch {
    return false;
  }
}
