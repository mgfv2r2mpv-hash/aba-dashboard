// GET  /api/auth/session  - who is signed in
// POST /api/auth/session  - sign out
//
// The GET is what the portal calls on load to decide whether to show the login screen
// or the app. It answers 200 with `signedIn: false` rather than 401, because "nobody
// is signed in" is a normal answer to that question and not an error.
import { D1UserStore } from '../../lib/userStore';
import { fail, json, clearCookie, SESSION_COOKIE, CHANGE_COOKIE } from '../../lib/http';
import { resolveSession, accessEmail } from '../../lib/authContext';
import type { PortalContext } from '../../lib/env';

export const onRequest = async ({ request, env }: PortalContext): Promise<Response> => {
  if (!env.PORTAL_DB) return fail(503, 'Sign-in is not configured on this server yet.');
  const store = new D1UserStore(env.PORTAL_DB);
  const now = new Date();

  if (request.method === 'GET') {
    const context = await resolveSession(request, store, 'session', now);
    if (!context) {
      const pending = await resolveSession(request, store, 'password-change', now);
      return json({
        signedIn: false,
        mustChangePassword: pending !== null,
        // Useful on the login screen: Access already knows who they are, so the
        // email field can be filled in for them.
        accessEmail: accessEmail(request),
      }, 200);
    }
    const { id, email, role, mustChangePassword } = context.user;
    return json({ signedIn: true, mustChangePassword, user: { id, email, role } }, 200);
  }

  if (request.method === 'POST') {
    const context = await resolveSession(request, store, 'session', now);
    if (context) await store.deleteSession(context.tokenHash);
    // Sweeping here rather than on a schedule: Pages Functions have no cron, and
    // sign-out is the one moment somebody is already waiting on a write.
    await store.deleteExpiredSessions(now);
    return new Response(JSON.stringify({ status: 'signed-out' }), {
      status: 200,
      headers: [
        ['Content-Type', 'application/json; charset=utf-8'],
        ['Cache-Control', 'no-store'],
        ['Set-Cookie', clearCookie(SESSION_COOKIE)],
        ['Set-Cookie', clearCookie(CHANGE_COOKIE)],
      ],
    });
  }

  return fail(405, 'Use GET or POST.', { Allow: 'GET, POST' });
};
