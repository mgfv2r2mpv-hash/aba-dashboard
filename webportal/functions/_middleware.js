// Edge gate: Cloudflare Access SSO — verify the Access JWT at the origin.
//
// Cloudflare Access authenticates the user (SSO) in front of sassi.nooutco.me and
// injects a signed JWT in the `Cf-Access-Jwt-Assertion` header. We verify it here so
// that ONLY requests carrying a valid Access token are served. This also closes the
// *.pages.dev bypass: those URLs are not fronted by Access, so their requests have no
// valid JWT and are denied. This is defense-in-depth — the real data boundary is still
// the encrypted file + passphrase, decrypted only in the browser.
//
// Config comes from wrangler.toml [vars] (non-secret identifiers):
//   TEAM_DOMAIN  e.g. https://t-nooutco-me.cloudflareaccess.com
//   POLICY_AUD   the Access application's Audience (AUD) tag
// Fails closed if either is unset or the token is missing/invalid.

import { jwtVerify, createRemoteJWKSet } from "jose";

function forbidden(message) {
  return new Response(`${message}\n`, {
    status: 403,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

// Cache the JWKS across requests in the same isolate (keyed by team domain).
let jwks = null;
let jwksTeam = null;
function getJwks(teamDomain) {
  if (!jwks || jwksTeam !== teamDomain) {
    jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
    jwksTeam = teamDomain;
  }
  return jwks;
}

function readToken(request) {
  const header = request.headers.get("Cf-Access-Jwt-Assertion");
  if (header) return header;
  // Fallback to the CF_Authorization cookie.
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  return match ? match[1] : null;
}

export const onRequest = async (context) => {
  const { request, env, next } = context;

  const teamDomain = env.TEAM_DOMAIN;
  const aud = env.POLICY_AUD;

  // Fail closed if the gate is misconfigured.
  if (!teamDomain || !aud) return forbidden("Gate misconfigured");

  const token = readToken(request);
  if (!token) return forbidden("Missing Cloudflare Access token");

  try {
    await jwtVerify(token, getJwks(teamDomain), {
      issuer: teamDomain,
      audience: aud,
    });
  } catch {
    return forbidden("Invalid Cloudflare Access token");
  }

  return next();
};
