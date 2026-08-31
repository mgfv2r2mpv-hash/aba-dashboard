// Which requests get through the front door, and on whose say-so.
//
// This is the whole gate decision as one pure function, so the two states the portal
// can be in are legible side by side rather than tangled in middleware.
//
// BEFORE the login store is configured, the site behaves exactly as it always has:
// Cloudflare Access gates every path, and nothing reaches the app without a valid
// Access token. That branch is the reason shipping this cannot take the site down.
//
// AFTER it is configured, the portal's own session is the gate. The page shell is
// served to anyone, because a person with no account has to be able to load a login
// screen, and in a single-page app the login screen IS the shell. The API is where
// the boundary actually sits.
//
// One caveat that belongs here rather than in a commit message: serving the shell
// openly is a real change from today, where even the HTML needed Access. It matches
// the threat model the portal already had - the encrypted file and its passphrase are
// the data boundary, and they are only ever opened in the browser - but it is a
// change, and it is the direct cost of letting a BT reach a login form.

export type GateVerdict =
  /** Hand it to the app. */
  | { readonly kind: 'serve' }
  /** An API call with no portal session behind it. */
  | { readonly kind: 'needs-session' }
  /** The store is not configured yet, so Access is still the only gate, and it said no. */
  | { readonly kind: 'needs-access' };

export function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}

/**
 * API routes that do their own authorization and must therefore be reachable without
 * a session already in hand.
 *
 * `/api/auth/` is obvious: it is how a session is obtained in the first place.
 *
 * `/api/admin/` is here because its own check is STRICTER than a session check, not
 * weaker. decideAdmin demands an admin role, or an empty store plus a verified Access
 * identity for the very first account. Gating it on a session here would only make
 * that first account impossible to create.
 */
export function isSelfAuthorizingApiPath(pathname: string): boolean {
  return pathname.startsWith('/api/auth/') || pathname.startsWith('/api/admin/');
}

export function decideGate(facts: {
  readonly pathname: string;
  readonly storeConfigured: boolean;
  readonly hasAccessIdentity: boolean;
  readonly hasPortalSession: boolean;
}): GateVerdict {
  if (!facts.storeConfigured) {
    return facts.hasAccessIdentity ? { kind: 'serve' } : { kind: 'needs-access' };
  }
  if (!isApiPath(facts.pathname)) return { kind: 'serve' };
  if (isSelfAuthorizingApiPath(facts.pathname)) return { kind: 'serve' };
  return facts.hasPortalSession ? { kind: 'serve' } : { kind: 'needs-session' };
}
