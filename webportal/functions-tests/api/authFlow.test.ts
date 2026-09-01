// The journey he asked for, driven through the real handlers:
// an admin makes an account with a temp password, that password gets the person to
// the change screen and nowhere else, and what they pick then persists.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { onRequest as login } from '../../functions/api/auth/login';
import { onRequest as password } from '../../functions/api/auth/password';
import { onRequest as session } from '../../functions/api/auth/session';
import { onRequest as users } from '../../functions/api/admin/users';
import { FakeD1 } from '../../functions/lib/fakeD1';
import { resetRateLimits } from '../../functions/lib/loginRate';
import type { PortalEnv } from '../../functions/lib/env';

// What _middleware.ts hands down after verifying the Access token. NOT a header:
// see the test at the bottom of this file for why that distinction is load-bearing.
const ACCESS = { accessEmail: 'boss@clinic.org', sessionUserId: null };
const RAW_HEADER = { 'Cf-Access-Authenticated-User-Email': 'boss@clinic.org' };
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
  const response = await users({ request: post('/api/admin/users', { email }), env, data: ACCESS });
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
    const second = await users({ request: post('/api/admin/users', { email: 'bt@clinic.org' }), env, data: ACCESS });
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
      request: new Request('https://sassi.nooutco.me/api/auth/session'), env, data: ACCESS,
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

  const patchAs = (Cookie: string, body: unknown) =>
    new Request('https://sassi.nooutco.me/api/admin/users', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie }, body: JSON.stringify(body),
    });

  /**
   * The two steps an admin actually takes: add the address, then send it a password.
   *
   * These tests bind no RESEND_API_KEY, so the send lands on the show branch and the
   * password comes back in the response - which is the branch a test can drive, and
   * the one that has to keep working when mail is down.
   */
  async function invite(Cookie: string, email: string, role?: string) {
    const created = await users({
      request: post('/api/admin/users', role ? { email, role } : { email }, { Cookie }), env,
    }).then((r) => r.json()) as { user: { id: string } };
    const sent = await users({
      request: patchAs(Cookie, { userId: created.user.id, sendTempPassword: true }), env,
    }).then((r) => r.json()) as { tempPassword: string; sent: boolean };
    return { user: created.user, tempPassword: sent.tempPassword, sent: sent.sent };
  }

  it('lets a signed-in admin add a BT, defaulting the role', async () => {
    const Cookie = await adminCookie();
    const response = await users({
      request: post('/api/admin/users', { email: 'bt@clinic.org' }, { Cookie }), env,
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ user: { role: 'bt' }, invited: true });
  });

  it('hands back no password when it makes one, and the row lands turned off', async () => {
    // The security half of the invitation. Typing an address must not create anything
    // signable-in; only sending a password to that address does.
    const Cookie = await adminCookie();
    const body = await users({
      request: post('/api/admin/users', { email: 'bt@clinic.org' }, { Cookie }), env,
    }).then((r) => r.json()) as Record<string, unknown> & { user: { disabledAt: string | null } };
    expect(body.tempPassword).toBeUndefined();
    expect(body.shownOnce).toBeUndefined();
    expect(body.user.disabledAt).not.toBeNull();
  });

  it('leaves an uninvited account with nothing that can sign in to it', async () => {
    // The row holds a hash of a password that was generated and thrown away. Nothing
    // can present it, and even the right one would meet a turned-off account.
    const Cookie = await adminCookie();
    await users({ request: post('/api/admin/users', { email: 'bt@clinic.org' }, { Cookie }), env });
    const attempt = await login({
      request: post('/api/auth/login', { email: 'bt@clinic.org', password: 'anything at all' }), env,
    });
    expect(attempt.status).not.toBe(200);
  });

  it('sends a temp password, which turns the account on and stops at the change screen', async () => {
    const Cookie = await adminCookie();
    const { tempPassword, sent } = await invite(Cookie, 'bt@clinic.org');

    // No key is bound here, so the endpoint hands the password back instead of
    // mailing it, and says so rather than reporting a send that never happened.
    expect(sent).toBe(false);
    expect(tempPassword).toMatch(/^[A-HJ-NP-Z2-9]{12}$/);

    const response = await login({
      request: post('/api/auth/login', { email: 'bt@clinic.org', password: tempPassword }), env,
    });
    expect(response.status).toBe(200);
    expect((await response.json() as { status: string }).status).toBe('must-change-password');
  });

  it('gives a different password every time it is asked, and spends the last one', async () => {
    const Cookie = await adminCookie();
    const first = await invite(Cookie, 'bt@clinic.org');
    const second = await users({
      request: patchAs(Cookie, { userId: first.user.id, sendTempPassword: true }), env,
    }).then((r) => r.json()) as { tempPassword: string };

    expect(second.tempPassword).not.toBe(first.tempPassword);
    const stale = await login({
      request: post('/api/auth/login', { email: 'bt@clinic.org', password: first.tempPassword }), env,
    });
    expect(stale.status).not.toBe(200);
  });

  it('turns a disabled account back on as part of sending it a password', async () => {
    // The pairing that made the old reissue branch a trap: a password issued to an
    // account still turned off signs in to a 403. Sending one has to do both.
    const Cookie = await adminCookie();
    const made = await invite(Cookie, 'bt@clinic.org');
    await users({ request: patchAs(Cookie, { userId: made.user.id, disabled: true }), env });

    const resent = await users({
      request: patchAs(Cookie, { userId: made.user.id, sendTempPassword: true }), env,
    }).then((r) => r.json()) as { user: { disabledAt: string | null }; tempPassword: string };
    expect(resent.user.disabledAt).toBeNull();

    const response = await login({
      request: post('/api/auth/login', { email: 'bt@clinic.org', password: resent.tempPassword }), env,
    });
    expect(response.status).toBe(200);
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
    const made = await invite(Cookie, 'bt@clinic.org', 'bt');

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
    const made = await invite(Cookie, 'bt@clinic.org');
    const patch = (body: unknown) => patchAs(Cookie, body);

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

describe('when this deployment can actually send mail', () => {
  // Everything above runs with no key bound, which exercises the fallback. This is
  // the other branch: the one that runs in production, where the password goes to an
  // inbox and never appears on the admin's screen at all.
  afterEach(() => { vi.unstubAllGlobals(); });

  async function adminCookie() {
    const first = await users({ request: post('/api/admin/users', { email: 'boss@clinic.org' }), env, data: ACCESS });
    const { tempPassword } = await first.json() as { tempPassword: string };
    const opened = await login({ request: post('/api/auth/login', { email: 'boss@clinic.org', password: tempPassword }), env });
    const ticket = cookieFrom(opened, 'sassi_pwchange')!;
    await password({
      request: post('/api/auth/password', { newPassword: 'a passphrase of my own' },
        { Cookie: `sassi_pwchange=${encodeURIComponent(ticket)}` }),
      env,
    });
    const second = await login({ request: post('/api/auth/login', { email: 'boss@clinic.org', password: 'a passphrase of my own' }), env });
    return `sassi_session=${encodeURIComponent(cookieFrom(second, 'sassi_session')!)}`;
  }

  function sendPassword(Cookie: string, userId: string) {
    return users({
      request: new Request('https://sassi.nooutco.me/api/admin/users', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie },
        body: JSON.stringify({ userId, sendTempPassword: true }),
      }),
      env,
    });
  }

  it('mails the password to the address on the account and shows nothing', async () => {
    const Cookie = await adminCookie();
    env.RESEND_API_KEY = 're_test_key';
    const outbox: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      outbox.push(JSON.parse(init.body as string));
      return { ok: true, status: 200, json: async () => ({ id: 'sent' }) } as unknown as Response;
    }));

    const made = await users({ request: post('/api/admin/users', { email: 'bt@clinic.org' }, { Cookie }), env })
      .then((r) => r.json()) as { user: { id: string } };
    const body = await sendPassword(Cookie, made.user.id).then((r) => r.json()) as Record<string, unknown>;

    expect(body).toMatchObject({ sent: true, sentTo: 'bt@clinic.org' });
    // The point of the whole change: on the success path the password exists in one
    // inbox and nowhere else, so it must not come back in the response.
    expect(body.tempPassword).toBeUndefined();

    const message = outbox[0] as { to: string[]; text: string };
    expect(message.to).toEqual(['bt@clinic.org']);
    expect(message.text).toContain('https://sassi.nooutco.me');

    // And the mailed password is the one that works.
    const mailed = message.text.match(/Temporary password: (\S+)/)![1];
    const response = await login({
      request: post('/api/auth/login', { email: 'bt@clinic.org', password: mailed }), env,
    });
    expect((await response.json() as { status: string }).status).toBe('must-change-password');
  });

  it('hands the password back when the send fails, and says why', async () => {
    // The account already has the new password by this point. Losing it here would
    // strand the account, so a failed send degrades to the show branch rather than
    // to an error.
    const Cookie = await adminCookie();
    env.RESEND_API_KEY = 're_test_key';
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 422, json: async () => ({ message: 'That domain is not verified.' }),
    } as unknown as Response)));

    const made = await users({ request: post('/api/admin/users', { email: 'bt@clinic.org' }, { Cookie }), env })
      .then((r) => r.json()) as { user: { id: string } };
    const body = await sendPassword(Cookie, made.user.id).then((r) => r.json()) as
      { sent: boolean; tempPassword: string; reason: string; user: { disabledAt: string | null } };

    expect(body.sent).toBe(false);
    expect(body.reason).toContain('That domain is not verified.');
    expect(body.user.disabledAt).toBeNull();
    const response = await login({
      request: post('/api/auth/login', { email: 'bt@clinic.org', password: body.tempPassword }), env,
    });
    expect(response.status).toBe(200);
  });

  it('does not leave the account unusable when the mail service is unreachable', async () => {
    const Cookie = await adminCookie();
    env.RESEND_API_KEY = 're_test_key';
    vi.stubGlobal('fetch', vi.fn(() => { throw new TypeError('Failed to fetch'); }));

    const made = await users({ request: post('/api/admin/users', { email: 'bt@clinic.org' }, { Cookie }), env })
      .then((r) => r.json()) as { user: { id: string } };
    const response = await sendPassword(Cookie, made.user.id);

    // A thrown fetch must not surface as a 500 with the password lost inside it.
    expect(response.status).toBe(200);
    const body = await response.json() as { sent: boolean; tempPassword: string };
    expect(body.sent).toBe(false);
    expect(body.tempPassword).toMatch(/^[A-HJ-NP-Z2-9]{12}$/);
  });
});

describe('the Access identity is verified, not asserted', () => {
  // Cloudflare strips a client-supplied Cf-Access-Authenticated-User-Email only while
  // Access is in front of the origin. Relaxing Access is the entire point of app
  // login, and from that moment the header is one anybody can send. _middleware.ts
  // verifies the signed token and passes down what it actually contained; nothing
  // downstream reads the header. This test is what stops that regressing.
  it('refuses to open the first-run door for a spoofed header', async () => {
    const response = await users({
      request: post('/api/admin/users', { email: 'attacker@example.com' }, RAW_HEADER),
      env,
    });
    expect(response.status).toBe(403);
    expect((await response.json() as { error: string }).error).toMatch(/inside the Access gate/);
  });

  it('opens it for a verified identity handed down by the middleware', async () => {
    const response = await users({
      request: post('/api/admin/users', { email: 'boss@clinic.org' }), env, data: ACCESS,
    });
    expect(response.status).toBe(201);
  });

  it('does not echo a spoofed header back as the Access email', async () => {
    const response = await session({
      request: new Request('https://sassi.nooutco.me/api/auth/session', { headers: RAW_HEADER }), env,
    });
    expect(await response.json()).toMatchObject({ accessEmail: null });
  });
});
