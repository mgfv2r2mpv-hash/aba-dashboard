// Outbound mail for the portal. One message exists today: the temporary password an
// admin sends to a new account.
//
// WHY THIS NEVER THROWS. The caller has already written a new password hash to the
// store by the time it gets here - it cannot know what to send before it has decided
// what the password is. If a send failure propagated as an exception the account
// would be left holding a password nobody has, and the admin would see a 500 with no
// way to recover it. So every failure comes back as a value, and the endpoint hands
// the password to the admin instead. A mail outage should cost a copy and paste, not
// an account.
//
// THE KEY IS A PROJECT SETTING, LIKE EVERY OTHER BINDING. RESEND_API_KEY is added in
// the Pages dashboard for Production and Preview separately, and secrets attach at
// deploy time, so one added after a deployment does not reach it. Until it is there
// `mailerFor` returns null and the endpoint says plainly that mail is not configured
// rather than pretending a message went out.
import type { PortalEnv } from './env';

export type SendResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export interface Mailer {
  send(message: { to: string; subject: string; text: string }): Promise<SendResult>;
}

/** The address the portal sends as. nooutco.me is the verified sending domain. */
const DEFAULT_FROM = 'SAssi Scheduler <sassi@nooutco.me>';

/**
 * Resend over its HTTP API. This runs in the Function, not the browser, so it is not
 * touched by the page's `connect-src 'self'` and does not widen the CSP.
 */
export function resendMailer(apiKey: string, from: string): Mailer {
  return {
    async send({ to, subject, text }) {
      let response: Response;
      try {
        response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ from, to: [to], subject, text }),
        });
      } catch (cause) {
        // A network failure reaching Resend. The message names the step rather than
        // the exception, because an admin reading it needs to know what to do next.
        return { ok: false, reason: `Could not reach the mail service: ${String(cause)}` };
      }

      if (response.ok) return { ok: true };

      // Resend puts a usable sentence in `message`. The status alone ("422") tells an
      // admin nothing, and the common causes - an unverified domain, a malformed
      // address - are all things they can act on once they can read them.
      let detail = `status ${response.status}`;
      try {
        const body = (await response.json()) as { message?: unknown; name?: unknown };
        if (typeof body.message === 'string' && body.message) detail = body.message;
      } catch {
        // A non-JSON error body leaves the status, which is better than nothing.
      }
      return { ok: false, reason: detail };
    },
  };
}

/** The configured mailer, or null when this deployment has no key bound. */
export function mailerFor(env: PortalEnv): Mailer | null {
  if (!env.RESEND_API_KEY) return null;
  return resendMailer(env.RESEND_API_KEY, env.PORTAL_MAIL_FROM || DEFAULT_FROM);
}

/**
 * The invitation itself.
 *
 * Deliberately plain text and deliberately short. It carries the password once, says
 * where to use it, and says that it is spent on arrival. It names no client, no
 * schedule and nothing about the person's role, because an email is the one part of
 * this system that leaves the machine and lands somewhere nobody here controls.
 */
export function tempPasswordMessage(origin: string, tempPassword: string) {
  return {
    subject: 'Your SAssi Scheduler sign-in',
    text: [
      'An administrator has set up your SAssi Scheduler account.',
      '',
      `Sign in at: ${origin}`,
      `Temporary password: ${tempPassword}`,
      '',
      'You will be asked to choose your own password the first time you sign in.',
      'This temporary one stops working at that point.',
      '',
      'If you were not expecting this, tell the person who administers the scheduler.',
    ].join('\n'),
  };
}
