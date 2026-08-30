// GET  /api/admin/users - list the accounts
// POST /api/admin/users - make one, with a temp password
// PATCH /api/admin/users - turn one off or back on, or reissue a temp password
//
// The temp password is returned exactly once, in the response to the POST or PATCH
// that made it. It is never stored in the clear and there is no endpoint that will
// read it back, so an admin who loses it issues another one.
import { D1UserStore, DuplicateEmailError, type UserRole } from '../../lib/userStore';
import { hashPassword, generateTempPassword } from '../../lib/password';
import { isUsableEmail } from '../../lib/authPolicy';
import { fail, json, readJsonObject } from '../../lib/http';
import { decideAdmin } from '../../lib/authContext';
import type { PortalContext } from '../../lib/env';

const ROLES: readonly UserRole[] = ['admin', 'staff', 'bt'];

function isRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export const onRequest = async ({ request, env }: PortalContext): Promise<Response> => {
  if (!env.PORTAL_DB) return fail(503, 'Sign-in is not configured on this server yet.');

  const store = new D1UserStore(env.PORTAL_DB);
  const now = new Date();

  const decision = await decideAdmin(request, store, now);
  if (decision.kind === 'refused') return fail(403, decision.reason);

  if (request.method === 'GET') {
    return json({ users: await store.listUsers() }, 200);
  }

  if (request.method === 'POST') {
    const parsed = await readJsonObject(request);
    if (!parsed.ok) return parsed.response;

    const { email, role } = parsed.body;
    if (!isUsableEmail(email)) return fail(400, 'Enter the email address for the new account.');

    // The account that opens the store has to be able to make the next one, so a
    // first-run creation is an admin whatever was asked for. After that the caller
    // says, and 'bt' is the safe default for a field they left out.
    const chosen: UserRole = decision.by === 'first-run'
      ? 'admin'
      : (isRole(role) ? role : 'bt');

    const tempPassword = generateTempPassword();
    try {
      const user = await store.createUser({
        email,
        role: chosen,
        passwordHash: await hashPassword(tempPassword),
        mustChangePassword: true,
      }, now);
      return json({ user, tempPassword, shownOnce: true }, 201);
    } catch (cause) {
      if (cause instanceof DuplicateEmailError) return fail(409, cause.message);
      throw cause;
    }
  }

  if (request.method === 'PATCH') {
    const parsed = await readJsonObject(request);
    if (!parsed.ok) return parsed.response;

    const { userId, disabled, reissueTempPassword } = parsed.body;
    if (typeof userId !== 'string' || userId.length === 0) return fail(400, 'Say which account.');

    const user = await store.findById(userId);
    if (!user) return fail(404, 'There is no account with that id.');

    if (typeof disabled === 'boolean') {
      await store.setDisabled(userId, disabled, now);
      // Turning an account off has to take its live sessions with it, or the person
      // stays signed in until their session happens to expire.
      if (disabled) await store.deleteSessionsForUser(userId);
    }

    if (reissueTempPassword === true) {
      const tempPassword = generateTempPassword();
      await store.setPassword(userId, await hashPassword(tempPassword), true, now);
      await store.deleteSessionsForUser(userId);
      return json({ user: await store.findById(userId), tempPassword, shownOnce: true }, 200);
    }

    return json({ user: await store.findById(userId) }, 200);
  }

  return fail(405, 'Use GET, POST or PATCH.', { Allow: 'GET, POST, PATCH' });
};
