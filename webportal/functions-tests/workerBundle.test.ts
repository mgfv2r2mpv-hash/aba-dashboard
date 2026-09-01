// THE BUILD CAN DROP A WORKER AND SAY NOTHING.
//
// Vite only compiles a worker into its own chunk when it sees the exact shape
//
//   new Worker(new URL('./x.worker.ts', import.meta.url), { type: 'module' })
//
// with the URL constructed INLINE inside the Worker call. Hoisting that URL into a
// const - the obvious tidy-up, and one I nearly made while fixing the failure this
// file is about - is not an error. The build succeeds, `parse.worker-<hash>.js` is
// simply never emitted, and the deployed app asks for an asset that does not exist.
// A single-page app answers any unknown path with index.html, so the browser is handed
// a WEB PAGE where a script should be, `new Worker` fails with an ErrorEvent carrying
// no message, and the person reads "Worker failed: unknown error".
//
// Measured on this repo 2026-09-01: with the URL hoisted, `npm run build` exits 0, is
// silent, and emits save.worker but NOT parse.worker.
//
// This is the same family as the seam that took sassi.nooutco.me down for five weeks:
// a compiler that is the only checker, and nothing reading its output back. So this
// reads the output back.
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const PORTAL = fileURLToPath(new URL('..', import.meta.url));
const ASSETS = join(PORTAL, 'dist', 'assets');

/** The worker entry points the app relies on, by the source file each comes from. */
const WORKERS = ['parse.worker', 'save.worker'];

beforeAll(() => {
  // Build only if there is nothing to read. CI builds anyway, and a local run should
  // not pay for a build it already has.
  if (!existsSync(ASSETS)) {
    execFileSync('npm', ['run', 'build'], { cwd: PORTAL, stdio: 'inherit' });
  }
}, 180_000);

const emitted = () => readdirSync(ASSETS);

describe('what the portal build actually emits', () => {
  it.each(WORKERS)('emits a chunk for %s', (worker) => {
    // Fails against the hoisted-URL form, which is the whole point.
    expect(emitted().filter((f) => f.startsWith(worker + '-') && f.endsWith('.js'))).toHaveLength(1);
  });

  it.each(WORKERS)('and the app actually asks for the %s chunk it emitted', (worker) => {
    // Emitting it is not enough: the entry has to reference the same hashed name, or
    // the app requests something that is not there and gets index.html back.
    const chunk = emitted().find((f) => f.startsWith(worker + '-') && f.endsWith('.js'));
    const entry = emitted().find((f) => f.startsWith('index-') && f.endsWith('.js'));
    expect(chunk).toBeDefined();
    expect(entry).toBeDefined();
    expect(readFileSync(join(ASSETS, entry!), 'utf8')).toContain(chunk!);
  });

  it('builds every worker with the inline URL form the bundler needs', () => {
    // The guard on the source, so the reason survives next to the code. If this ever
    // has to change, the two tests above are what say whether the change was safe.
    const store = readFileSync(join(PORTAL, 'src', 'store', 'fileScheduleStore.ts'), 'utf8');
    for (const worker of WORKERS) {
      expect(store).toMatch(
        new RegExp(`new Worker\\(\\s*new URL\\(\\s*['"\`]\\.\\./${worker.replace('.', '\\.')}\\.ts`),
      );
    }
  });
});
