// POST /api/auth/login
//
// Takes an email and a password. Answers with one of three outcomes, and the caller
// never has to infer which: signed-in, must-change-password, or a refusal.
import { D1UserStore } from '../../lib/userStore';
import { verifyPassword, hashPassword, generateSessionToken, hashSessionToken } from '../../lib/password';
import {
  decideLogin, isUsableEmail, foldEmail, expiryFrom,
  SESSION_TTL_HOURS, CHANGE_TICKET_TTL_MINUTES,
} from '../../lib/authPolicy';
import {
  json, fail, readJsonObject, setCookie, SESSION_COOKIE, CHANGE_COOKIE,
} from '../../lib/http';
import { isRateLimited, clearRate } from '../../lib/loginRate';
import { accessEmail } from '../../lib/authContext';
import type { PortalContext } from '../../lib/env';

// Verifying against this when no account exists keeps a miss the same shape and
// roughly the same cost as a hit, so response time does not answer "does this address
// have an account" for somebody who has not signed in.
//
// Built on first use rather than at module scope: a top-level await would spend a
// derivation's worth of CPU on every cold start, which is exactly the budget a
// Workers request is metered on.
let absentAccountHash: string | null = null;
async function absentHash(): Promise<string> {
  absentAccountHash ??= await hashPassword(
    'this hash exists only so that a missing account costs what a real one costs',
  );
  return absentAccountHash;
}

export const onRequest = async ({ request, env }: PortalContext): Promise<Response> => {
  if (request.method !== 'POST') return fail(405, 'Use POST.', { Allow: 'POST' });
  if (!env.PORTAL_DB) return fail(503, 'Sign-in is not configured on this server yet.');

  const parsed = await readJsonObject(request);
  if (!parsed.ok) return parsed.response;

  const { email, password } = parsed.body;
  if (!isUsableEmail(email)) return fail(400, 'Enter the email address for the account.');
  if (typeof password !== 'string' || password.length === 0) {
    return fail(400, 'Enter the password.');
  }

  // Keyed on the account being attacked and on who is attacking, so one person
  // hammering an address cannot lock everybody out of it.
  const identity = `${foldEmail(email)}|${accessEmail(request) ?? request.headers.get('CF-Connecting-IP') ?? 'unknown'}`;
  const now = new Date();
  if (isRateLimited(identity, now.getTime())) {
    return fail(429, 'Too many attempts. Wait a few minutes, then try again.', {
      'Retry-After': '900',
    });
  }

  const store = new D1UserStore(env.PORTAL_DB);
  const account = await store.findByEmail(email);
  const check = await verifyPassword(password, account?.passwordHash ?? (await absentHash()));

  if (!check.ok && check.reason === 'corrupt') {
    // Not a wrong password. The stored hash is unreadable, which is a server fault
    // and should look like one rather than hiding among bad-password denials.
    console.error('portal login: stored password hash is unreadable', { email: foldEmail(String(email)) });
    return fail(500, 'Something is wrong with that account. Ask an administrator.');
  }

  const outcome = decideLogin({
    passwordMatched: check.ok && account !== null,
    disabled: account?.disabledAt != null,
    mustChangePassword: account?.mustChangePassword === true,
  });

  if (outcome.kind === 'denied' || account === null) {
    return fail(401, 'That email and password do not match.');
  }

  // Says plainly that the account is off rather than pretending the password is
  // wrong. This is a staff portal behind Cloudflare Access, so the caller is already
  // a known colleague and the alternative just sends them to reset a working
  // password. If password login is ever opened past the Access gate, revisit this.
  if (outcome.kind === 'disabled') {
    return fail(403, 'That account has been turned off. Ask an administrator.');
  }

  clearRate(identity);

  const token = generateSessionToken();
  const tokenHash = await hashSessionToken(token);

  if (outcome.kind === 'must-change-password') {
    const expiresAt = expiryFrom(now, CHANGE_TICKET_TTL_MINUTES / 60);
    await store.createSession({
      tokenHash, userId: account.id, purpose: 'password-change',
      createdAt: now.toISOString(), expiresAt,
    });
    return json(
      { status: 'must-change-password', expiresAt },
      200,
      { 'Set-Cookie': setCookie(CHANGE_COOKIE, token, CHANGE_TICKET_TTL_MINUTES * 60) },
    );
  }

  const expiresAt = expiryFrom(now, SESSION_TTL_HOURS);
  await store.createSession({
    tokenHash, userId: account.id, purpose: 'session',
    createdAt: now.toISOString(), expiresAt,
  });
  await store.recordLogin(account.id, now);

  // Behind on cost because the constant was raised since this password was set.
  // Re-hashing here is the only moment the plain password is in hand.
  if (check.ok && check.needsRehash) {
    await store.setPassword(account.id, await hashPassword(password), false, now);
  }

  const { id, email: address, role } = account;
  return json(
    { status: 'signed-in', user: { id, email: address, role }, expiresAt },
    200,
    { 'Set-Cookie': setCookie(SESSION_COOKIE, token, SESSION_TTL_HOURS * 60 * 60) },
  );
};
