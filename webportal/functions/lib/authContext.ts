// Who is calling, and may they do this.
//
// Two identities are in play and they are not the same thing. Cloudflare Access says
// which PERSON reached the origin, and functions/_middleware.js has already refused
// the request if that answer is nobody. A portal session says which ACCOUNT they are
// signed into. Access is the building's front door; a portal session is the desk you
// are allowed to sit at.
import { hashSessionToken } from './password';
import { hasExpired } from './authPolicy';
import { readCookie, SESSION_COOKIE, CHANGE_COOKIE } from './http';
import type { PortalUser, UserStore, SessionPurpose } from './userStore';

export interface AuthContext {
  readonly user: PortalUser;
  readonly purpose: SessionPurpose;
  readonly tokenHash: string;
}

/**
 * Resolves the cookie for `purpose` into a live account, or null. An expired row is
 * deleted on the way past rather than left to the sweeper, so a stolen cookie stops
 * working the moment somebody tries it rather than whenever the next sweep runs.
 */
export async function resolveSession(
  request: Request, store: UserStore, purpose: SessionPurpose, now: Date,
): Promise<AuthContext | null> {
  const cookieName = purpose === 'session' ? SESSION_COOKIE : CHANGE_COOKIE;
  const token = readCookie(request, cookieName);
  if (!token) return null;

  const tokenHash = await hashSessionToken(token);
  const session = await store.findSession(tokenHash);
  if (!session) return null;

  if (session.purpose !== purpose) return null;
  if (hasExpired(session.expiresAt, now)) {
    await store.deleteSession(tokenHash);
    return null;
  }

  const user = await store.findById(session.userId);
  if (!user) return null;
  // A session outlives neither a disabling nor a fresh temp password.
  if (user.disabledAt !== null) return null;

  return { user, purpose, tokenHash };
}

/** The verified Access email, put there by Cloudflare in front of the origin. */
export function accessEmail(request: Request): string | null {
  return request.headers.get('Cf-Access-Authenticated-User-Email');
}

export type AdminDecision =
  | { readonly kind: 'allowed'; readonly by: 'admin-session' | 'first-run' }
  | { readonly kind: 'refused'; readonly reason: string };

/**
 * Admin endpoints want an admin, and the very first admin cannot have one.
 *
 * So: an account with role 'admin' and a live session always passes. When the store
 * holds NO accounts at all, any Access-authenticated caller passes instead, which is
 * how the first admin gets made. That opening closes itself the moment one account
 * exists, and it is only ever reachable by somebody Cloudflare Access has already
 * authenticated into the site, so it is not an anonymous door.
 */
export async function decideAdmin(
  request: Request, store: UserStore, now: Date,
): Promise<AdminDecision> {
  const context = await resolveSession(request, store, 'session', now);
  if (context && context.user.role === 'admin') {
    return { kind: 'allowed', by: 'admin-session' };
  }

  const everyone = await store.listUsers();
  if (everyone.length === 0) {
    if (!accessEmail(request)) {
      return { kind: 'refused', reason: 'The first account can only be made from inside the Access gate.' };
    }
    return { kind: 'allowed', by: 'first-run' };
  }

  if (context) return { kind: 'refused', reason: 'That account is not an administrator.' };
  return { kind: 'refused', reason: 'Sign in first.' };
}
