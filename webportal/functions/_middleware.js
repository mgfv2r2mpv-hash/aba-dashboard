// Edge gate: HTTP Basic Auth in front of the entire portal.
//
// This runs on every request before any static asset is served. It is
// defense-in-depth only: the real data boundary is the encrypted file plus its
// passphrase (decrypted in-browser, never on the server). This gate just keeps
// the app shell from being publicly loadable.
//
// Credentials come from Pages environment secrets, never hardcoded:
//   GATE_PASSWORD  (required — set via `wrangler pages secret put`)
//   GATE_USER      (optional — defaults to "sassi")
// If GATE_PASSWORD is unset the gate fails closed (denies everything).

const REALM = "SASSi Portal";

function unauthorized() {
  return new Response("Authentication required.\n", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Basic realm="${REALM}", charset="UTF-8"`,
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

// Constant-time comparison so a wrong password can't be recovered by timing.
function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

export const onRequest = async (context) => {
  const { request, env, next } = context;

  const expectedUser = env.GATE_USER || "sassi";
  const expectedPass = env.GATE_PASSWORD;

  // Fail closed: never serve if no password is configured.
  if (!expectedPass) return unauthorized();

  const header = request.headers.get("Authorization") || "";
  if (!header.startsWith("Basic ")) return unauthorized();

  let user = "";
  let pass = "";
  try {
    const decoded = atob(header.slice(6));
    const idx = decoded.indexOf(":");
    if (idx === -1) return unauthorized();
    user = decoded.slice(0, idx);
    pass = decoded.slice(idx + 1);
  } catch {
    return unauthorized();
  }

  // Evaluate both comparisons (no short-circuit) before deciding.
  const userOk = timingSafeEqual(user, expectedUser);
  const passOk = timingSafeEqual(pass, expectedPass);
  if (!(userOk && passOk)) return unauthorized();

  return next();
};
