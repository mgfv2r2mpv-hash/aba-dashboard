// The journey he asked for, driven through the real handlers:
// an admin makes an account with a temp password, that password gets the person to
// the change screen and nowhere else, and what they pick then persists.
import { describe, it, expect, beforeEach } from 'vitest';
import { onRequest as login } from './auth/login';
import { onRequest as password } from './auth/password';
import { onRequest as session } from './auth/session';
import { onRequest as users } from './admin/users';
import { FakeD1 } from '../lib/fakeD1';
import { resetRateLimits } from '../lib/loginRate';
import type { PortalEnv } from '../lib/env';

const ACCESS = { 'Cf-Access-Authenticated-User-Email': 'boss@clinic.org' };
let env: PortalEnv;

beforeEach(() => {
  env = { PORTAL_DB: new FakeD1() };
  resetRateLimits();
});

function post(url: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://sassi.nooutco.me${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function cookieFrom(response: Response, name: string): string | null {
  for (const header of response.headers.getSetCookie()) {
    const match = header.match(new RegExp(`^${name}=([^;]*)`));
    // An expiring cookie carries Max-Age=0 and an empty value; that is a clear, not a set.
    if (match && match[1] !== '') return decodeURIComponent(match[1]);
  }
  return null;
}

async function makeFirstAdmin(email = 'boss@clinic.org') {
  const response = await users({ request: post('/api/admin/users', { email }, ACCESS), env });
  return { response, body: await response.json() as Record<string, string> };
}

describe('the first account', () => {
  it('can be made by anyone Access has let in, while the store is empty', async () => {
    const { response, body } = await makeFirstAdmin();
    expect(response.status).toBe(201);
    expect(body.tempPassword).toMatch(/^[A-HJ-NP-Z2-9]{12}$/);
    expect((body.user as unknown as { role: string }).role).toBe('admin');
  });

  it('closes that opening the moment one account exists', async () => {
    await makeFirstAdmin();
    const second = await users({ request: post('/api/admin/users', { email: 'bt@clinic.org' }, ACCESS), env });
    expect(second.status).toBe(403);
    expect((await second.json() as { error: string }).error).toMatch(/Sign in first/);
  });

  it('will not open for a caller Access has not authenticated', async () => {
    const response = await users({ request: post('/api/admin/users', { email: 'boss@clinic.org' }), env });
    expect(response.status).toBe(403);
  });

  it('never returns the password hash alongside the account', async () => {
    const { body } = await makeFirstAdmin();
    expect(JSON.stringify(body.user)).not.toContain('pbkdf2');
    expect(body.user).not.toHaveProperty('passwordHash');
  });
});

describe('the temp password journey', () => {
  it('lets the temp password in only as far as the change screen', async () => {
    const { body } = await makeFirstAdmin();
    const response = await login({
      request: post('/api/auth/login', { email: 'boss@clinic.org', password: body.tempPassword }), env,
    });

    expect(response.status).toBe(200);
    expect((await response.json() as { status: string }).status).toBe('must-change-password');
    expect(cookieFrom(response, 'sassi_pwchange')).not.toBeNull();
    expect(cookieFrom(response, 'sassi_session')).toBeNull();
  });

  it('sets the chosen password, and it persists into a real session', async () => {
    const { body } = await makeFirstAdmin();
    const first = await login({
      request: post('/api/auth/login', { email: 'boss@clinic.org', password: body.tempPassword }), env,
    });
    const ticket = cookieFrom(first, 'sassi_pwchange')!;

    const changed = await password({
      request: post('/api/auth/password', { newPassword: 'a passphrase of my own' },
        { Cookie: `sassi_pwchange=${encodeURIComponent(ticket)}` }),
      env,
    });
    expect(changed.status).toBe(200);

    const second = await login({
      request: post('/api/auth/login', { email: 'boss@clinic.org', password: 'a passphrase of my own' }), env,
    });
    const seated = await second.json() as { status: string; user: { email: string } };
    expect(seated.status).toBe('signed-in');
    expect(seated.user.email).toBe('boss@clinic.org');
    expect(cookieFrom(second, 'sassi_session')).not.toBeNull();
  });

  it('spends the temp password, which no longer opens the account', async () => {
    const { body } = await makeFirstAdmin();
    const first = await login({
      request: post('/api/auth/login', { email: 'boss@clinic.org', password: body.tempPassword }), env,
    });
    const ticket = cookieFrom(first, 'sassi_pwchange')!;
    await password({
      request: post('/api/auth/password', { newPassword: 'a passphrase of my own' },
        { Cookie: `sassi_pwchange=${encodeURIComponent(ticket)}` }),
      env,
    });

    const retry = await login({
      request: post('/api/auth/login', { email: 'boss@clinic.org', password: body.tempPassword }), env,
    });
    expect(retry.status).toBe(401);
  });

  it('refuses a new password that is the temp password again', async () => {
    const { body } = await makeFirstAdmin();
    const first = await login({
      request: post('/api/auth/login', { email: 'boss@clinic.org', password: body.tempPassword }), env,
    });
    const ticket = cookieFrom(first, 'sassi_pwchange')!;

    const changed = await password({
      request: post('/api/auth/password', { newPassword: body.tempPassword },
        { Cookie: `sassi_pwchange=${encodeURIComponent(ticket)}` }),
      env,
    });
    expect(changed.status).toBe(400);
    expect((await changed.json() as { error: string }).error).toMatch(/have not just been using/);
  });

  it('refuses a new password that is too short, naming the rule', async () => {
    const { body } = await makeFirstAdmin();
    const first = await login({
      request: post('/api/auth/login', { email: 'boss@clinic.org', password: body.tempPassword }), env,
    });
    const ticket = cookieFrom(first, 'sassi_pwchange')!;

    const changed = await password({
      request: post('/api/auth/password', { newPassword: 'short' },
        { Cookie: `sassi_pwchange=${encodeURIComponent(ticket)}` }),
      env,
    });
    expect(changed.status).toBe(400);
    expect((await changed.json() as { error: string }).error).toMatch(/at least 12 characters/);
  });

  it('will not set a password without a ticket or a session', async () => {
    await makeFirstAdmin();
    const response = await password({
      request: post('/api/auth/password', { newPassword: 'a passphrase of my own' }), env,
    });
    expect(response.status).toBe(401);
  });

  it('will not let a session cookie pass as a change ticket', async () => {
    const { body } = await makeFirstAdmin();
    const first = await login({
      request: post('/api/auth/login', { email: 'boss@clinic.org', password: body.tempPassword }), env,
    });
    const ticket = cookieFrom(first, 'sassi_pwchange')!;
    // The same token, offered under the session cookie name.
    const response = await session({
      request: new Request('https://sassi.nooutco.me/api/auth/session', {
        headers: { Cookie: `sassi_session=${encodeURIComponent(ticket)}` },
      }),
      env,
    });
    expect((await response.json() as { signedIn: boolean }).signedIn).toBe(false);
  });
});

describe('sessions', () => {
  async function seated() {
    const { body } = await makeFirstAdmin();
    const first = await login({
      request: post('/api/auth/login', { email: 'boss@clinic.org', password: body.tempPassword }), env,
    });
    const ticket = cookieFrom(first, 'sassi_pwchange')!;
    await password({
      request: post('/api/auth/password', { newPassword: 'a passphrase of my own' },
        { Cookie: `sassi_pwchange=${encodeURIComponent(ticket)}` }),
      env,
    });
    const second = await login({
      request: post('/api/auth/login', { email: 'boss@clinic.org', password: 'a passphrase of my own' }), env,
    });
    return cookieFrom(second, 'sassi_session')!;
  }

  it('answers who is signed in, and answers 200 when nobody is', async () => {
    const empty = await session({ request: new Request('https://sassi.nooutco.me/api/auth/session'), env });
    expect(empty.status).toBe(200);
    expect(await empty.json()).toMatchObject({ signedIn: false });

    const cookie = await seated();
    const response = await session({
      request: new Request('https://sassi.nooutco.me/api/auth/session', {
        headers: { Cookie: `sassi_session=${encodeURIComponent(cookie)}` },
      }),
      env,
    });
    expect(await response.json()).toMatchObject({ signedIn: true, user: { email: 'boss@clinic.org' } });
  });

  it('offers the Access email so the login screen can fill the field in', async () => {
    const response = await session({
      request: new Request('https://sassi.nooutco.me/api/auth/session', { headers: ACCESS }), env,
    });
    expect(await response.json()).toMatchObject({ accessEmail: 'boss@clinic.org' });
  });

  it('signs out, and the cookie stops working', async () => {
    const cookie = await seated();
    const out = await session({
      request: post('/api/auth/session', {}, { Cookie: `sassi_session=${encodeURIComponent(cookie)}` }), env,
    });
    expect(out.status).toBe(200);

    const after = await session({
      request: new Request('https://sassi.nooutco.me/api/auth/session', {
        headers: { Cookie: `sassi_session=${encodeURIComponent(cookie)}` },
      }),
      env,
    });
    expect(await after.json()).toMatchObject({ signedIn: false });
  });

  it('drops every other session when the password changes', async () => {
    const laptop = await seated();
    const phone = cookieFrom(await login({
      request: post('/api/auth/login', { email: 'boss@clinic.org', password: 'a passphrase of my own' }), env,
    }), 'sassi_session')!;

    await password({
      request: post('/api/auth/password',
        { currentPassword: 'a passphrase of my own', newPassword: 'a different passphrase' },
        { Cookie: `sassi_session=${encodeURIComponent(phone)}` }),
      env,
    });

    for (const cookie of [laptop, phone]) {
      const response = await session({
        request: new Request('https://sassi.nooutco.me/api/auth/session', {
          headers: { Cookie: `sassi_session=${encodeURIComponent(cookie)}` },
        }),
        env,
      });
      expect(await response.json()).toMatchObject({ signedIn: false });
    }
  });

  it('makes a voluntary change prove the current password', async () => {
    const cookie = await seated();
    const wrong = await password({
      request: post('/api/auth/password',
        { currentPassword: 'not the right one', newPassword: 'a different passphrase' },
        { Cookie: `sassi_session=${encodeURIComponent(cookie)}` }),
      env,
    });
    expect(wrong.status).toBe(401);

    const missing = await password({
      request: post('/api/auth/password', { newPassword: 'a different passphrase' },
        { Cookie: `sassi_session=${encodeURIComponent(cookie)}` }),
      env,
    });
    expect(missing.status).toBe(400);
  });
});

describe('refusals', () => {
  it('answers 503 with a plain sentence when the database is not bound', async () => {
    for (const handler of [login, password, session, users]) {
      const response = await handler({ request: post('/api/whatever', {}), env: {} });
      expect(response.status).toBe(503);
      expect((await response.json() as { error: string }).error).toMatch(/not configured/);
    }
  });

  it('rejects the wrong method with an Allow header', async () => {
    const response = await login({
      request: new Request('https://sassi.nooutco.me/api/auth/login'), env,
    });
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
  });

  it('gives the same answer for a wrong password and an address with no account', async () => {
    await makeFirstAdmin();
    const noAccount = await login({
      request: post('/api/auth/login', { email: 'nobody@clinic.org', password: 'whatever it is' }), env,
    });
    const wrongPassword = await login({
      request: post('/api/auth/login', { email: 'boss@clinic.org', password: 'whatever it is' }), env,
    });
    expect(noAccount.status).toBe(401);
    expect(wrongPassword.status).toBe(401);
    expect(await noAccount.json()).toEqual(await wrongPassword.json());
  });

  it('refuses a body that is not a JSON object', async () => {
    const response = await login({
      request: new Request('https://sassi.nooutco.me/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '"just a string"',
      }),
      env,
    });
    expect(response.status).toBe(400);
  });

  it('refuses an oversized body without reading it all', async () => {
    const response = await login({
      request: new Request('https://sassi.nooutco.me/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(20000) }),
      }),
      env,
    });
    expect(response.status).toBe(413);
  });
});

describe('administering accounts', () => {
  async function adminCookie() {
    const { body } = await makeFirstAdmin();
    const first = await login({
      request: post('/api/auth/login', { email: 'boss@clinic.org', password: body.tempPassword }), env,
    });
    const ticket = cookieFrom(first, 'sassi_pwchange')!;
    await password({
      request: post('/api/auth/password', { newPassword: 'a passphrase of my own' },
        { Cookie: `sassi_pwchange=${encodeURIComponent(ticket)}` }),
      env,
    });
    const second = await login({
      request: post('/api/auth/login', { email: 'boss@clinic.org', password: 'a passphrase of my own' }), env,
    });
    return `sassi_session=${encodeURIComponent(cookieFrom(second, 'sassi_session')!)}`;
  }

  it('lets a signed-in admin add a BT, defaulting the role', async () => {
    const Cookie = await adminCookie();
    const response = await users({
      request: post('/api/admin/users', { email: 'bt@clinic.org' }, { Cookie }), env,
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ user: { role: 'bt' }, shownOnce: true });
  });

  it('refuses a duplicate address with 409 rather than a 500', async () => {
    const Cookie = await adminCookie();
    await users({ request: post('/api/admin/users', { email: 'bt@clinic.org' }, { Cookie }), env });
    const again = await users({
      request: post('/api/admin/users', { email: 'BT@clinic.org' }, { Cookie }), env,
    });
    expect(again.status).toBe(409);
  });

  it('will not let a non-admin add anyone', async () => {
    const Cookie = await adminCookie();
    const made = await users({
      request: post('/api/admin/users', { email: 'bt@clinic.org', role: 'bt' }, { Cookie }), env,
    }).then((r) => r.json()) as Record<string, string>;

    const btFirst = await login({
      request: post('/api/auth/login', { email: 'bt@clinic.org', password: made.tempPassword }), env,
    });
    const ticket = cookieFrom(btFirst, 'sassi_pwchange')!;
    await password({
      request: post('/api/auth/password', { newPassword: 'the bt passphrase' },
        { Cookie: `sassi_pwchange=${encodeURIComponent(ticket)}` }),
      env,
    });
    const btIn = await login({
      request: post('/api/auth/login', { email: 'bt@clinic.org', password: 'the bt passphrase' }), env,
    });
    const btCookie = `sassi_session=${encodeURIComponent(cookieFrom(btIn, 'sassi_session')!)}`;

    const attempt = await users({
      request: post('/api/admin/users', { email: 'another@clinic.org' }, { Cookie: btCookie }), env,
    });
    expect(attempt.status).toBe(403);
    expect((await attempt.json() as { error: string }).error).toMatch(/not an administrator/);
  });

  it('turns an account off, drops its sessions, and turns it back on', async () => {
    const Cookie = await adminCookie();
    const made = await users({
      request: post('/api/admin/users', { email: 'bt@clinic.org' }, { Cookie }), env,
    }).then((r) => r.json()) as { user: { id: string }; tempPassword: string };

    const patch = (body: unknown) => new Request('https://sassi.nooutco.me/api/admin/users', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie }, body: JSON.stringify(body),
    });

    await users({ request: patch({ userId: made.user.id, disabled: true }), env });
    const blocked = await login({
      request: post('/api/auth/login', { email: 'bt@clinic.org', password: made.tempPassword }), env,
    });
    expect(blocked.status).toBe(403);
    expect((await blocked.json() as { error: string }).error).toMatch(/turned off/);

    await users({ request: patch({ userId: made.user.id, disabled: false }), env });
    const allowed = await login({
      request: post('/api/auth/login', { email: 'bt@clinic.org', password: made.tempPassword }), env,
    });
    expect(allowed.status).toBe(200);
  });

  it('reissues a temp password, which puts the account back behind the change screen', async () => {
    const Cookie = await adminCookie();
    const made = await users({
      request: post('/api/admin/users', { email: 'bt@clinic.org' }, { Cookie }), env,
    }).then((r) => r.json()) as { user: { id: string }; tempPassword: string };

    const reissued = await users({
      request: new Request('https://sassi.nooutco.me/api/admin/users', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie },
        body: JSON.stringify({ userId: made.user.id, reissueTempPassword: true }),
      }),
      env,
    }).then((r) => r.json()) as { tempPassword: string };

    expect(reissued.tempPassword).not.toBe(made.tempPassword);
    const response = await login({
      request: post('/api/auth/login', { email: 'bt@clinic.org', password: reissued.tempPassword }), env,
    });
    expect((await response.json() as { status: string }).status).toBe('must-change-password');
  });

  it('lists accounts without any password material', async () => {
    const Cookie = await adminCookie();
    await users({ request: post('/api/admin/users', { email: 'bt@clinic.org' }, { Cookie }), env });
    const listed = await users({
      request: new Request('https://sassi.nooutco.me/api/admin/users', { headers: { Cookie } }), env,
    });
    const body = await listed.text();
    expect(body).not.toContain('pbkdf2');
    expect(JSON.parse(body).users).toHaveLength(2);
  });
});
