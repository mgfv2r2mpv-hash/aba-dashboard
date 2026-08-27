// The portal's Claude transport: a same-origin proxy for POST /v1/messages.
//
// The browser talks to this route instead of api.anthropic.com. Three things
// follow from that, and they are the whole reason it exists:
//
//   1. The key never enters the browser. It lives here as the Pages secret
//      ANTHROPIC_API_KEY, so nothing sensitive rides in the encrypted backup and
//      nothing is typed into a Settings box.
//   2. The portal's CSP stays `connect-src 'self'`. Nothing in public/_headers
//      changes to turn the assistant on.
//   3. There is a second gate. The FIRST gate is the browser's anonymizer, which
//      is the only side that ever learns a real name - so this route cannot
//      re-run the name check, and does not pretend to. What it can enforce is the
//      SHAPE the anonymizer promises: token space carries no uuid, no email, no
//      phone number, no SSN. A payload carrying one of those means a mapping was
//      missed upstream, and the request dies here rather than at Anthropic.
//
// Cloudflare Access already gates every request to this project (functions/
// _middleware.js verifies the JWT), so this route inherits authentication and adds
// only the request screen and the rate limit. The request body is never logged.

// Minimal shape of the Pages Functions context - typed locally so the Functions
// surface needs no dependency of its own (see the note in wrangler.toml about
// this project's build being the thing that fails silently).
interface ProxyEnv {
  ANTHROPIC_API_KEY?: string;
}
interface ProxyContext {
  request: Request;
  env: ProxyEnv;
}

const UPSTREAM = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

// Every key ClaudeScheduler sends, and nothing else. An unrecognised key is
// refused rather than forwarded: a new field is a new way for data to travel, and
// it should have to come past this list first.
const ALLOWED_KEYS = new Set(['model', 'max_tokens', 'system', 'tools', 'tool_choice', 'messages']);

// The models the portal offers. Keeping this list here means a typo, or a caller
// that is not the portal, cannot bill an arbitrary model to the account.
const ALLOWED_MODELS = new Set(['claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-opus-4-8']);

// chat() asks for 8000; the cap sits just above it.
const MAX_OUTPUT_TOKENS = 8192;
// A full month of token-space schedule runs well under this. It bounds one
// request's cost and one runaway client's damage.
const MAX_BODY_BYTES = 512 * 1024;

// Per-identity rate limit. This is an in-isolate counter: it bounds the realistic
// failure - one browser stuck in a retry loop hammering one isolate - and it does
// NOT bound a deliberate distributed hammer, which is Access's job, not this map's.
// A durable counter needs a KV binding, which is a project setting a deploy cannot
// create; that is the Phase 2 upgrade, not a silent gap.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 15;
const RATE_KEYS_MAX = 64;
const recentCalls = new Map<string, number[]>();

// Every refusal below is the proxy's own decision, not a hiccup, so each carries
// `x-should-retry: false`. The SDK obeys that header; without it a 429 would make
// the client sleep out the whole Retry-After and try again, and the BCBA would sit
// on "thinking" for a minute to be told the same thing.
function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'x-should-retry': 'false',
      ...extra,
    },
  });
}

// The shapes that never legitimately appear in token space. Each one is a fact
// about a real person that the anonymizer is supposed to have removed or replaced.
const PHI_SHAPES: { name: string; re: RegExp }[] = [
  // A raw uuid means an id reached the payload without being mapped to a token -
  // the exact failure a fail-open lookup used to produce.
  { name: 'uuid', re: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i },
  { name: 'email address', re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i },
  // Separators are required, so an ISO date or a run of digits cannot match.
  { name: 'phone number', re: /(?:\+?1[-. ])?\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}/ },
  { name: 'social security number', re: /\b\d{3}-\d{2}-\d{4}\b/ },
];

/** The first PHI shape found in the serialized request, or null when it is clean. */
export function findPhiShape(payload: string): string | null {
  for (const { name, re } of PHI_SHAPES) {
    if (re.test(payload)) return name;
  }
  return null;
}

/** Why a parsed body may not be forwarded, or null when it may. */
export function findRequestFault(body: unknown): string | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'The request body must be a JSON object.';
  const record = body as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (!ALLOWED_KEYS.has(key)) return `The field "${key}" is not accepted by this proxy.`;
  }
  if (typeof record.model !== 'string' || !ALLOWED_MODELS.has(record.model)) {
    return 'That model is not one this portal offers.';
  }
  if (typeof record.max_tokens !== 'number' || record.max_tokens <= 0 || record.max_tokens > MAX_OUTPUT_TOKENS) {
    return `max_tokens must be a number between 1 and ${MAX_OUTPUT_TOKENS}.`;
  }
  if (!Array.isArray(record.messages) || record.messages.length === 0) {
    return 'The request must carry at least one message.';
  }
  for (const message of record.messages) {
    const role = (message as { role?: unknown } | null)?.role;
    if (role !== 'user' && role !== 'assistant') return 'Every message must be from the user or the assistant.';
  }
  return null;
}

/** True when this identity has already spent its allowance for the window. */
export function isRateLimited(identity: string, now: number, calls = recentCalls): boolean {
  const window = (calls.get(identity) || []).filter(t => now - t < RATE_WINDOW_MS);
  if (window.length >= RATE_MAX) {
    calls.set(identity, window);
    return true;
  }
  window.push(now);
  calls.set(identity, window);
  // An isolate that saw many identities should not hold them all forever.
  if (calls.size > RATE_KEYS_MAX) {
    for (const [key, times] of calls) {
      if (times.every(t => now - t >= RATE_WINDOW_MS)) calls.delete(key);
    }
  }
  return false;
}

// Access injects the authenticated email; the IP is the fallback for a request
// that somehow reached here without one.
function identify(request: Request): string {
  return request.headers.get('Cf-Access-Authenticated-User-Email')
    || request.headers.get('CF-Connecting-IP')
    || 'unknown';
}

// One handler for every method: Pages resolves `onRequest` for all of them, and
// two exported handlers would leave which one runs a POST up to the runtime.
export const onRequest = async ({ request, env }: ProxyContext): Promise<Response> => {
  if (request.method !== 'POST') {
    return json({ error: { type: 'method_not_allowed', message: 'This endpoint accepts POST only.' } }, 405);
  }

  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return json({ error: { type: 'not_configured', message: 'The assistant is not configured on this server yet.' } }, 503);
  }

  if (isRateLimited(identify(request), Date.now())) {
    return json(
      { error: { type: 'rate_limited', message: 'Too many assistant requests. Wait a minute and try again.' } },
      429,
      { 'Retry-After': '60' },
    );
  }

  // Refuse an oversized body on its declared length, before reading it into memory.
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > MAX_BODY_BYTES) {
    return json({ error: { type: 'too_large', message: 'That request is too large to send.' } }, 413);
  }

  // Read as text once: the screen runs over the exact bytes that would be sent.
  const payload = await request.text();
  if (payload.length > MAX_BODY_BYTES) {
    return json({ error: { type: 'too_large', message: 'That request is too large to send.' } }, 413);
  }

  let body: unknown;
  try {
    body = JSON.parse(payload);
  } catch {
    return json({ error: { type: 'invalid_request', message: 'The request body is not valid JSON.' } }, 400);
  }

  const fault = findRequestFault(body);
  if (fault) return json({ error: { type: 'invalid_request', message: fault } }, 400);

  const shape = findPhiShape(payload);
  if (shape) {
    // Deliberately says WHAT was found and never echoes it.
    return json({
      error: {
        type: 'anonymization_failed',
        message: `Blocked: the request carried something shaped like a ${shape}, which anonymized data never contains. Nothing was sent.`,
      },
    }, 422);
  }

  const upstream = await fetch(UPSTREAM, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': request.headers.get('anthropic-version') || ANTHROPIC_VERSION,
    },
    body: payload,
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
      'Cache-Control': 'no-store',
    },
  });
};
