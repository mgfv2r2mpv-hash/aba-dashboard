// Request and response plumbing shared by the auth endpoints.
//
// It deliberately does not reach into functions/api/claude/v1/messages.ts, which has
// its own copy of `json` shaped around the Anthropic SDK's retry behaviour. Folding
// the two together would put the login endpoints and the model proxy on one set of
// headers, and they do not want the same ones.

export const SESSION_COOKIE = 'sassi_session';
export const CHANGE_COOKIE = 'sassi_pwchange';

// Nothing an auth endpoint accepts is large. A password is capped at 256 characters
// and an email at 320, so anything past this is not a request worth parsing.
export const MAX_BODY_BYTES = 8 * 1024;

export function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extra,
    },
  });
}

export function fail(status: number, message: string, extra: Record<string, string> = {}): Response {
  return json({ error: message }, status, extra);
}

export type BodyResult =
  | { readonly ok: true; readonly body: Record<string, unknown> }
  | { readonly ok: false; readonly response: Response };

/**
 * Reads a JSON object body, refusing anything oversized, unparseable or not an
 * object. Checks the declared length first so a lying Content-Length cannot make us
 * buffer more than the cap.
 */
export async function readJsonObject(request: Request): Promise<BodyResult> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return { ok: false, response: fail(413, 'That request is too large.') };
  }

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    return { ok: false, response: fail(413, 'That request is too large.') };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, response: fail(400, 'That request was not valid JSON.') };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, response: fail(400, 'That request was not a JSON object.') };
  }
  return { ok: true, body: parsed as Record<string, unknown> };
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie') ?? '';
  // Anchored to a boundary so `sassi_session` cannot be matched by `x_sassi_session`.
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * SameSite=Strict because nothing off-origin has any business carrying these, and
 * HttpOnly so a script on the page cannot read the token even if one gets in.
 */
export function setCookie(name: string, value: string, maxAgeSeconds: number): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
  ].join('; ');
}

export function clearCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}
