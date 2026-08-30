// POST /api/auth/password
//
// Sets a new password. Reached two ways, and they are not the same thing:
//   - holding a password-change ticket, which is what a spent temp password buys
//   - holding an ordinary session, for somebody changing a password they already own
//
// Either way every other session that person holds is dropped, so a password change
// signs out the devices they were not holding when they changed it.
import { D1UserStore } from '../../lib/userStore';
import { hashPassword, verifyPassword } from '../../lib/password';
import { checkNewPassword, describeRejection } from '../../lib/authPolicy';
import { fail, readJsonObject, clearCookie, CHANGE_COOKIE, SESSION_COOKIE } from '../../lib/http';
import { resolveSession } from '../../lib/authContext';
import type { PortalContext } from '../../lib/env';

export const onRequest = async ({ request, env }: PortalContext): Promise<Response> => {
  if (request.method !== 'POST') return fail(405, 'Use POST.', { Allow: 'POST' });
  if (!env.PORTAL_DB) return fail(503, 'Sign-in is not configured on this server yet.');

  const store = new D1UserStore(env.PORTAL_DB);
  const now = new Date();

  const ticket = await resolveSession(request, store, 'password-change', now);
  const session = ticket ?? (await resolveSession(request, store, 'session', now));
  if (!session) {
    return fail(401, 'That password-change link has expired. Sign in again.', {
      'Set-Cookie': clearCookie(CHANGE_COOKIE),
    });
  }

  const parsed = await readJsonObject(request);
  if (!parsed.ok) return parsed.response;

  const { newPassword, currentPassword } = parsed.body;

  // Changing a password you already own means proving you own it. Arriving on a
  // ticket does not, because the temp password was already checked to mint it.
  const stored = await store.findByEmail(session.user.email);
  if (!stored) return fail(500, 'That account could not be read.');

  if (session.purpose === 'session') {
    if (typeof currentPassword !== 'string' || currentPassword.length === 0) {
      return fail(400, 'Enter your current password.');
    }
    const proof = await verifyPassword(currentPassword, stored.passwordHash);
    if (!proof.ok) return fail(401, 'That current password is not right.');
  }

  const rejection = checkNewPassword(
    newPassword,
    typeof currentPassword === 'string' ? currentPassword : undefined,
  );
  if (rejection) return fail(400, describeRejection(rejection));

  // Also refuse the temp password they just came in on, which `currentPassword` does
  // not cover on the ticket path because they never had to type it again.
  const reuse = await verifyPassword(newPassword as string, stored.passwordHash);
  if (reuse.ok) return fail(400, 'Pick a password you have not just been using.');

  await store.setPassword(session.user.id, await hashPassword(newPassword as string), false, now);
  await store.deleteSessionsForUser(session.user.id);

  // Both cookies go, including the one that got them here: deleteSessionsForUser has
  // just made every token they hold worthless, so leaving either behind would only
  // present a cookie the next request has to reject. They sign in again with the
  // password they just chose, which is also the first proof that it took.
  return new Response(JSON.stringify({ status: 'password-set' }), {
    status: 200,
    headers: [
      ['Content-Type', 'application/json; charset=utf-8'],
      ['Cache-Control', 'no-store'],
      ['Set-Cookie', clearCookie(CHANGE_COOKIE)],
      ['Set-Cookie', clearCookie(SESSION_COOKIE)],
    ],
  });
};
