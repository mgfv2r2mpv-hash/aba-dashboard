// The portal's front door.
//
// It does three things in order: work out whether Cloudflare Access has vouched for a
// person, work out whether they hold a portal session, and then ask lib/gate.ts what
// to do about it. The decision itself is pure and lives there; this file is the part
// that has to touch the network.
//
// WHY THE ACCESS EMAIL IS VERIFIED HERE AND PASSED DOWN. Cloudflare injects
// Cf-Access-Authenticated-User-Email and strips any client-supplied copy, but only
// while Access is actually in front of the origin. The moment Access is relaxed - the
// whole point of app login - that header becomes an ordinary header anybody can send.
// So nothing downstream reads it. This file verifies the signed JWT and puts the email
// it actually contains on context.data, and the endpoints read that.
import { jwtVerify, createRemoteJWKSet } from 'jose';
import { D1UserStore } from './lib/userStore';
import { resolveSession } from './lib/authContext';
import { decideGate } from './lib/gate';
import type { PortalEnv, PortalData } from './lib/env';

interface GateEnv extends PortalEnv {
  TEAM_DOMAIN?: string;
  POLICY_AUD?: string;
}

/** What every endpoint downstream reads. Defined once, in lib/env.ts. */
export type GateData = PortalData;

interface GateContext {
  request: Request;
  env: GateEnv;
  data: GateData;
  next: () => Promise<Response>;
}

function forbidden(message: string): Response {
  return new Response(`${message}\n`, {
    status: 403,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

// Cache the JWKS across requests in the same isolate (keyed by team domain).
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksTeam: string | null = null;
function getJwks(teamDomain: string) {
  if (!jwks || jwksTeam !== teamDomain) {
    jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
    jwksTeam = teamDomain;
  }
  return jwks;
}

function readToken(request: Request): string | null {
  const header = request.headers.get('Cf-Access-Jwt-Assertion');
  if (header) return header;
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  return match ? match[1] : null;
}

/** The email from a verified Access token, or null if there is not one. */
async function verifiedAccessEmail(request: Request, env: GateEnv): Promise<string | null> {
  const teamDomain = env.TEAM_DOMAIN;
  const aud = env.POLICY_AUD;
  if (!teamDomain || !aud) return null;

  const token = readToken(request);
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getJwks(teamDomain), {
      issuer: teamDomain,
      audience: aud,
    });
    return typeof payload.email === 'string' ? payload.email : null;
  } catch {
    return null;
  }
}

export const onRequest = async (context: GateContext): Promise<Response> => {
  const { request, env, next } = context;

  // Fail closed on a half-configured gate, exactly as before: with neither Access
  // config nor a login store there is nothing standing in front of the site at all.
  if (!env.PORTAL_DB && (!env.TEAM_DOMAIN || !env.POLICY_AUD)) {
    return forbidden('Gate misconfigured');
  }

  const accessEmail = await verifiedAccessEmail(request, env);

  let sessionUserId: string | null = null;
  if (env.PORTAL_DB) {
    const store = new D1UserStore(env.PORTAL_DB);
    const session = await resolveSession(request, store, 'session', new Date());
    sessionUserId = session ? session.user.id : null;
  }

  const verdict = decideGate({
    pathname: new URL(request.url).pathname,
    storeConfigured: env.PORTAL_DB !== undefined,
    hasAccessIdentity: accessEmail !== null,
    hasPortalSession: sessionUserId !== null,
  });

  if (verdict.kind === 'needs-access') {
    return forbidden('Missing or invalid Cloudflare Access token');
  }
  if (verdict.kind === 'needs-session') {
    return new Response(JSON.stringify({ error: 'Sign in first.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  context.data = { accessEmail, sessionUserId };
  return next();
};
