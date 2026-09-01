import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// THIS EXACT LINE HAS BROKEN THE APP TWICE.
//
// The portal decrypts a .sassi backup inside a module worker, and it builds that
// worker from a same-origin asset URL:
//
//   new Worker(new URL('../parse.worker.ts', import.meta.url), { type: 'module' })
//
// Vite emits that as /assets/parse.worker-<hash>.js, so the worker script is an
// ordinary same-origin https URL. `worker-src blob:` does not cover it. The browser
// refuses the load, `worker.onerror` fires with an EMPTY message, and the person is
// told "Worker failed: unknown error. Try refreshing." - a message that names
// nothing and sends them to a refresh that cannot help.
//
// 8837db9 (2026-06-15) fixed it by adding 'self'. 85d835a (2026-06-22) rewrote the
// whole policy to add img-src and connect-src and dropped 'self' back off in the
// process, which is how a hardening commit shipped an outage. Nothing failed at
// build time either round, because a CSP is a static string until a browser reads it.
//
// So this reads the shipped header back and pins the one token. It fails against
// both broken builds.

const HERE = fileURLToPath(new URL('.', import.meta.url));
const HEADERS = join(HERE, '..', 'public', '_headers');

/** The CSP value as Cloudflare Pages will actually serve it. */
function contentSecurityPolicy(): string {
  const line = readFileSync(HEADERS, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.toLowerCase().startsWith('content-security-policy:'));
  if (!line) throw new Error('_headers carries no Content-Security-Policy');
  return line.slice(line.indexOf(':') + 1).trim();
}

/** One directive's source list, or null when the directive is absent. */
function directive(csp: string, name: string): string[] | null {
  const found = csp
    .split(';')
    .map((d) => d.trim())
    .find((d) => d === name || d.startsWith(name + ' '));
  return found ? found.slice(name.length).trim().split(/\s+/).filter(Boolean) : null;
}

describe('the shipped Content-Security-Policy', () => {
  it('lets the app load its own worker scripts', () => {
    // The whole bug, in one assertion. Without 'self' the decrypt worker never starts.
    expect(directive(contentSecurityPolicy(), 'worker-src')).toContain("'self'");
  });

  it('still allows blob: workers, which something in the app relies on', () => {
    // Kept deliberately rather than replaced. 'self' is being ADDED to the list, not
    // swapped for what was there, and a future tightening should not read this file
    // as licence to drop blob:.
    expect(directive(contentSecurityPolicy(), 'worker-src')).toContain('blob:');
  });

  it('is pinning a real call site, not a hypothetical one', () => {
    // The reason, not a restatement. If the store ever moves to a blob: worker this
    // test should be revisited rather than kept passing out of habit, so it reads the
    // construction back and will start failing the day that changes.
    const store = readFileSync(join(HERE, '..', 'src', 'store', 'fileScheduleStore.ts'), 'utf8');
    expect(store).toMatch(/new Worker\(\s*new URL\(/);
  });

  it('keeps the directives the portal depends on for everything else', () => {
    // A rewrite of this header is exactly what dropped worker-src's 'self', so the
    // neighbours it was rewritten alongside get held down too.
    const csp = contentSecurityPolicy();
    expect(directive(csp, 'default-src')).toEqual(["'self'"]);
    expect(directive(csp, 'connect-src')).toEqual(["'self'"]);
    expect(directive(csp, 'object-src')).toEqual(["'none'"]);
    expect(directive(csp, 'frame-ancestors')).toEqual(["'none'"]);
  });
});
