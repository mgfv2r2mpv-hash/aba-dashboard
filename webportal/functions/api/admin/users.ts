// GET  /api/admin/users - list the accounts
// POST /api/admin/users - make one, turned off and with no usable password
// PATCH /api/admin/users - turn one off or back on, or send it a temp password
//
// AN ACCOUNT ARRIVES TURNED OFF. Typing an address and telling the person are two
// separate acts, and between them there should be nothing anybody can sign in to. So
// POST writes a disabled row holding a random password nobody is ever shown, and the
// account becomes usable only when an admin sends a temporary password to the address
// on it. That also means a typo in the address costs nothing: the invitation bounces
// or goes nowhere, and no account was ever live.
//
// The temp password is returned exactly once, and only when it could not be MAILED -
// mail unconfigured, or the send failed. It is never stored in the clear and no
// endpoint reads it back, so an admin who loses it issues another one.
//
// SENDING ONE IS ALSO THE ONLY WAY TO REISSUE ONE. There used to be a second PATCH
// branch that minted a password without touching `disabled`, and the two could drift:
// the reissue path would hand back a password for an account still turned off, which
// signs in to a 403. One branch does both jobs, so there is nowhere for that to hide.
import { D1UserStore, DuplicateEmailError, type UserRole } from '../../lib/userStore';
import { hashPassword, generateTempPassword } from '../../lib/password';
import { isUsableEmail } from '../../lib/authPolicy';
import { mailerFor, tempPasswordMessage } from '../../lib/mail';
import { fail, json, readJsonObject } from '../../lib/http';
import { decideAdmin } from '../../lib/authContext';
import type { PortalContext } from '../../lib/env';

const ROLES: readonly UserRole[] = ['admin', 'staff', 'bt'];

function isRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export const onRequest = async ({ request, env, data }: PortalContext): Promise<Response> => {
  if (!env.PORTAL_DB) return fail(503, 'Sign-in is not configured on this server yet.');

  const store = new D1UserStore(env.PORTAL_DB);
  const now = new Date();

  const decision = await decideAdmin(request, store, now, data);
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

    // The first admin is the exception, and it has to be. There is nobody to send
    // them an invitation and nobody who could turn their account on afterwards, so
    // first-run keeps the old behaviour: live immediately, password on screen once.
    const firstRun = decision.by === 'first-run';
    const tempPassword = generateTempPassword();
    try {
      const user = await store.createUser({
        email,
        role: chosen,
        // An invited account holds a password that was generated and then discarded.
        // Nothing can present it, which is the point: the row is a placeholder until
        // an admin sends a real temporary password to the address on it.
        passwordHash: await hashPassword(firstRun ? tempPassword : generateTempPassword()),
        mustChangePassword: true,
        disabled: !firstRun,
      }, now);
      return firstRun
        ? json({ user, tempPassword, shownOnce: true }, 201)
        : json({ user, invited: true }, 201);
    } catch (cause) {
      if (cause instanceof DuplicateEmailError) return fail(409, cause.message);
      throw cause;
    }
  }

  if (request.method === 'PATCH') {
    const parsed = await readJsonObject(request);
    if (!parsed.ok) return parsed.response;

    const { userId, disabled, sendTempPassword } = parsed.body;
    if (typeof userId !== 'string' || userId.length === 0) return fail(400, 'Say which account.');

    const user = await store.findById(userId);
    if (!user) return fail(404, 'There is no account with that id.');

    if (typeof disabled === 'boolean') {
      await store.setDisabled(userId, disabled, now);
      // Turning an account off has to take its live sessions with it, or the person
      // stays signed in until their session happens to expire.
      if (disabled) await store.deleteSessionsForUser(userId);
    }

    if (sendTempPassword === true) {
      // Ordered so that a failure anywhere leaves the admin able to finish by hand.
      // The password has to exist before it can be sent, so it is written first, and
      // every path below that either mails it or hands it back.
      const issued = generateTempPassword();
      await store.setPassword(userId, await hashPassword(issued), true, now);
      await store.setDisabled(userId, false, now);
      await store.deleteSessionsForUser(userId);

      const mailer = mailerFor(env);
      if (!mailer) {
        return json({
          user: await store.findById(userId),
          tempPassword: issued,
          shownOnce: true,
          sent: false,
          reason: 'Email is not configured on this server, so the password was not sent. Give it to them yourself.',
        }, 200);
      }

      const origin = new URL(request.url).origin;
      const sent = await mailer.send({ to: user.email, ...tempPasswordMessage(origin, issued) });
      if (!sent.ok) {
        return json({
          user: await store.findById(userId),
          tempPassword: issued,
          shownOnce: true,
          sent: false,
          reason: `The account is ready but the email did not go out: ${sent.reason}`,
        }, 200);
      }

      // Nothing to show. The password is in one inbox and was never on this screen.
      return json({ user: await store.findById(userId), sent: true, sentTo: user.email }, 200);
    }

    return json({ user: await store.findById(userId) }, 200);
  }

  return fail(405, 'Use GET, POST or PATCH.', { Allow: 'GET, POST, PATCH' });
};
