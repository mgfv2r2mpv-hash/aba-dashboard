import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  readSession, signIn, signOut, setPassword,
  listUsers, createUser, reissueTempPassword, setUserDisabled, isFirstRunOpen,
  AuthError,
} from './portalAuth';

// The transport, exercised against a stubbed fetch.
//
// Only three properties of a Response are ever touched - ok, status and text() - so
// the stub provides exactly those rather than depending on whatever Response
// implementation the runtime happens to ship.

function answer(status: number, body: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  } as unknown as Response;
}

function withJson(status: number, body: unknown): Response {
  return answer(status, JSON.stringify(body));
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The path and the parsed body of the nth call, for asserting what was sent. */
function sent(index = 0): { path: string; method: string; body: unknown } {
  const [path, init] = fetchMock.mock.calls[index] as [string, RequestInit | undefined];
  return {
    path,
    method: init?.method ?? 'GET',
    body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
  };
}

describe('readSession', () => {
  it('reports an unbound login store as a configuration state, not a refusal', async () => {
    fetchMock.mockResolvedValue(
      withJson(503, { error: 'Sign-in is not configured on this server yet.' }),
    );
    await expect(readSession()).resolves.toEqual({ kind: 'unconfigured' });
  });

  it('reads a signed-out answer, keeping the Access email for the sign-in field', async () => {
    fetchMock.mockResolvedValue(
      withJson(200, { signedIn: false, mustChangePassword: false, accessEmail: 'boss@clinic.org' }),
    );
    await expect(readSession()).resolves.toEqual({
      kind: 'signed-out',
      accessEmail: 'boss@clinic.org',
      holdsChangeTicket: false,
    });
  });

  it('reports a live change ticket, which is not the same as being signed out empty-handed', async () => {
    fetchMock.mockResolvedValue(
      withJson(200, { signedIn: false, mustChangePassword: true, accessEmail: null }),
    );
    const state = await readSession();
    expect(state).toMatchObject({ kind: 'signed-out', holdsChangeTicket: true });
  });

  it('reads a signed-in answer', async () => {
    fetchMock.mockResolvedValue(
      withJson(200, {
        signedIn: true,
        mustChangePassword: false,
        user: { id: 'u1', email: 'sam@clinic.org', role: 'staff' },
      }),
    );
    await expect(readSession()).resolves.toEqual({
      kind: 'signed-in',
      user: { id: 'u1', email: 'sam@clinic.org', role: 'staff' },
      mustChangePassword: false,
    });
  });

  it('refuses to guess when the account carries a role this build does not know', async () => {
    fetchMock.mockResolvedValue(
      withJson(200, { signedIn: true, user: { id: 'u1', email: 'x@y.z', role: 'wizard' } }),
    );
    await expect(readSession()).rejects.toBeInstanceOf(AuthError);
  });
});

describe('refusals', () => {
  it('carries the server\'s own sentence rather than one of its own', async () => {
    fetchMock.mockResolvedValue(withJson(401, { error: 'That email and password do not match.' }));
    await expect(signIn('sam@clinic.org', 'nope')).rejects.toThrow(
      'That email and password do not match.',
    );
  });

  it('folds the middleware\'s plain-text Access refusal into the same shape', async () => {
    // functions/_middleware.ts answers text/plain, not JSON, when Access is required
    // and the token is missing. One error path has to cover both.
    fetchMock.mockResolvedValue(answer(403, 'Missing or invalid Cloudflare Access token\n'));
    await expect(readSession()).rejects.toThrow('Missing or invalid Cloudflare Access token');
  });

  it('tells a server that answered no apart from one that never answered', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const caught = await readSession().catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(AuthError);
    expect((caught as AuthError).isOffline).toBe(true);
    expect((caught as AuthError).isUnconfigured).toBe(false);
  });

  it('supplies wording when the server sent a status and no sentence', async () => {
    fetchMock.mockResolvedValue(answer(429, ''));
    await expect(signIn('sam@clinic.org', 'x')).rejects.toThrow(/Too many attempts/);
  });
});

describe('signIn', () => {
  it('keeps a spent temp password apart from a real sign-in', async () => {
    fetchMock.mockResolvedValue(
      withJson(200, { status: 'must-change-password', expiresAt: '2026-09-01T00:15:00.000Z' }),
    );
    await expect(signIn('sam@clinic.org', 'temp')).resolves.toEqual({
      kind: 'must-change-password',
      expiresAt: '2026-09-01T00:15:00.000Z',
    });
  });

  it('posts the trimmed pair and returns the account on success', async () => {
    fetchMock.mockResolvedValue(
      withJson(200, {
        status: 'signed-in',
        user: { id: 'u1', email: 'sam@clinic.org', role: 'admin' },
      }),
    );
    await expect(signIn('sam@clinic.org', 'a long passphrase')).resolves.toEqual({
      kind: 'signed-in',
      user: { id: 'u1', email: 'sam@clinic.org', role: 'admin' },
    });
    expect(sent()).toEqual({
      path: '/api/auth/login',
      method: 'POST',
      body: { email: 'sam@clinic.org', password: 'a long passphrase' },
    });
  });
});

describe('setPassword', () => {
  it('omits currentPassword on the ticket path, where it was never typed', async () => {
    fetchMock.mockResolvedValue(withJson(200, { status: 'password-set' }));
    await setPassword({ newPassword: 'a long new passphrase' });
    expect(sent().body).toEqual({ newPassword: 'a long new passphrase' });
  });

  it('sends currentPassword when the person already holds a session', async () => {
    fetchMock.mockResolvedValue(withJson(200, { status: 'password-set' }));
    await setPassword({ newPassword: 'a long new passphrase', currentPassword: 'the old one' });
    expect(sent().body).toEqual({
      newPassword: 'a long new passphrase',
      currentPassword: 'the old one',
    });
  });
});

describe('signOut', () => {
  it('posts to the session endpoint', async () => {
    fetchMock.mockResolvedValue(withJson(200, { status: 'signed-out' }));
    await signOut();
    expect(sent()).toMatchObject({ path: '/api/auth/session', method: 'POST' });
  });
});

const ROW = {
  id: 'u2',
  email: 'bt@clinic.org',
  role: 'bt',
  mustChangePassword: true,
  disabledAt: null,
  createdAt: '2026-08-31T00:00:00.000Z',
  passwordSetAt: '2026-08-31T00:00:00.000Z',
  lastLoginAt: null,
};

describe('the account list', () => {
  it('reads the rows the admin screen shows', async () => {
    fetchMock.mockResolvedValue(withJson(200, { users: [ROW] }));
    const users = await listUsers();
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ email: 'bt@clinic.org', role: 'bt', lastLoginAt: null });
  });

  it('returns the temp password the create response carries exactly once', async () => {
    fetchMock.mockResolvedValue(withJson(201, { user: ROW, tempPassword: 'horse-battery-42' }));
    const issued = await createUser('bt@clinic.org', 'bt');
    expect(issued.tempPassword).toBe('horse-battery-42');
    expect(sent()).toMatchObject({
      path: '/api/admin/users',
      method: 'POST',
      body: { email: 'bt@clinic.org', role: 'bt' },
    });
  });

  it('reissues a temp password over PATCH', async () => {
    fetchMock.mockResolvedValue(withJson(200, { user: ROW, tempPassword: 'second-one' }));
    await expect(reissueTempPassword('u2')).resolves.toMatchObject({ tempPassword: 'second-one' });
    expect(sent()).toMatchObject({
      path: '/api/admin/users',
      method: 'PATCH',
      body: { userId: 'u2', reissueTempPassword: true },
    });
  });

  it('turns an account off over PATCH', async () => {
    fetchMock.mockResolvedValue(withJson(200, { user: ROW }));
    await setUserDisabled('u2', true);
    expect(sent().body).toEqual({ userId: 'u2', disabled: true });
  });
});

describe('isFirstRunOpen', () => {
  it('is true only while the store is empty', async () => {
    fetchMock.mockResolvedValue(withJson(200, { users: [] }));
    await expect(isFirstRunOpen()).resolves.toBe(true);
  });

  it('is false once accounts exist', async () => {
    fetchMock.mockResolvedValue(withJson(200, { users: [ROW] }));
    await expect(isFirstRunOpen()).resolves.toBe(false);
  });

  it('treats the refusal that follows the first account as an answer, not an error', async () => {
    // Once the store is not empty, decideAdmin refuses a caller with no admin session.
    // That 403 is the ordinary case and must never reach the person as a message.
    fetchMock.mockResolvedValue(withJson(403, { error: 'Sign in first.' }));
    await expect(isFirstRunOpen()).resolves.toBe(false);
  });
});
