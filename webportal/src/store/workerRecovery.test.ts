// The self-heal, driven with a fake Cache Storage rather than a browser.
//
// What this is protecting: a person whose browser holds a challenge page under a
// script URL saw "Worker failed: unknown error. Try refreshing." forever, because the
// refresh read the same cache. These pin the two halves of the way out - finding the
// bad entry, and removing every copy of it.
import { describe, it, expect, vi } from 'vitest';
import {
  findPoisonedScripts, purgeBrowserCopies, describeWorkerFailure,
  type RecoveryEnv,
} from './workerRecovery';

/** A Cache Storage holding whatever the test says, shaped the way the code reads it. */
function fakeCaches(contents: Record<string, Record<string, string>>) {
  const deleted: string[] = [];
  const storage = {
    keys: async () => Object.keys(contents),
    open: async (name: string) => ({
      keys: async () => Object.keys(contents[name] ?? {}).map((url) => ({ url })),
      match: async (request: { url: string }) => {
        const type = contents[name]?.[request.url];
        return type === undefined ? undefined : { headers: { get: () => type } };
      },
    }),
    delete: async (name: string) => { deleted.push(name); return name in contents; },
  } as unknown as CacheStorage;
  return { storage, deleted };
}

const envOf = (caches: CacheStorage | undefined, serviceWorker?: ServiceWorkerContainer): RecoveryEnv =>
  ({ caches, serviceWorker });

describe('finding a cached script that is not a script', () => {
  it('finds the challenge page filed under a worker URL', async () => {
    // The exact shape of the outage.
    const { storage } = fakeCaches({
      'aba-portal-v2': {
        'https://sassi.nooutco.me/assets/parse.worker-Cs9QSITe.js': 'text/html; charset=UTF-8',
        'https://sassi.nooutco.me/assets/index-CDmPFP5Z.js': 'application/javascript',
      },
    });
    const found = await findPoisonedScripts(envOf(storage));
    expect(found).toHaveLength(1);
    expect(found[0].url).toContain('parse.worker');
    expect(found[0].cacheName).toBe('aba-portal-v2');
  });

  it('leaves a healthy cache alone, or it would purge on every unrelated failure', async () => {
    const { storage } = fakeCaches({
      'aba-portal-v3': { 'https://x/assets/parse.worker-a.js': 'application/javascript' },
    });
    await expect(findPoisonedScripts(envOf(storage))).resolves.toEqual([]);
  });

  it('ignores an HTML page cached under an HTML URL, which is the point of the cache', async () => {
    const { storage } = fakeCaches({ c: { 'https://x/': 'text/html', 'https://x/index.html': 'text/html' } });
    await expect(findPoisonedScripts(envOf(storage))).resolves.toEqual([]);
  });

  it('looks across every cache, not just the current one', async () => {
    // The bad entry lives in the OLD cache by definition, since bumping the name is
    // what a fixed build does.
    const { storage } = fakeCaches({
      'aba-portal-v3': { 'https://x/assets/a.js': 'application/javascript' },
      'aba-portal-v2': { 'https://x/assets/parse.worker-b.js': 'text/html' },
    });
    const found = await findPoisonedScripts(envOf(storage));
    expect(found.map((f) => f.cacheName)).toEqual(['aba-portal-v2']);
  });

  it('says nothing is wrong when the browser has no cache storage at all', async () => {
    await expect(findPoisonedScripts(envOf(undefined))).resolves.toEqual([]);
  });

  it('does not throw a second error when the caches cannot be read', async () => {
    // Private mode and blocked site storage both throw here. A worker failure must not
    // become an unhandled rejection on top.
    const hostile = { keys: async () => { throw new Error('denied'); } } as unknown as CacheStorage;
    await expect(findPoisonedScripts(envOf(hostile))).resolves.toEqual([]);
  });
});

describe('removing every copy the browser is holding', () => {
  it('deletes the caches and unregisters the workers', async () => {
    const { storage, deleted } = fakeCaches({ 'aba-portal-v2': {}, 'aba-portal-v3': {} });
    const unregister = vi.fn(async () => true);
    const sw = { getRegistrations: async () => [{ unregister }, { unregister }] } as unknown as ServiceWorkerContainer;

    const report = await purgeBrowserCopies(envOf(storage, sw));
    expect(deleted).toEqual(['aba-portal-v2', 'aba-portal-v3']);
    expect(report.cachesDeleted).toEqual(['aba-portal-v2', 'aba-portal-v3']);
    expect(report.workersUnregistered).toBe(2);
  });

  it('still reports what it managed when there is no service worker', async () => {
    const { storage } = fakeCaches({ 'aba-portal-v2': {} });
    const report = await purgeBrowserCopies(envOf(storage, undefined));
    expect(report.cachesDeleted).toEqual(['aba-portal-v2']);
    expect(report.workersUnregistered).toBe(0);
  });
});

describe('what the person is told', () => {
  const entry = [{ url: 'https://x/assets/parse.worker-Cs9QSITe.js', cacheName: 'v2', contentType: 'text/html' }];

  it('names the file rather than saying unknown error', () => {
    // The whole reason this module exists. The old sentence named nothing.
    const said = describeWorkerFailure(entry, null);
    expect(said).toContain('parse.worker-Cs9QSITe.js');
    expect(said).not.toContain('unknown error');
  });

  it('says it fixed itself when it did', () => {
    const said = describeWorkerFailure(entry, { cachesDeleted: ['v2'], workersUnregistered: 1 });
    expect(said).toMatch(/Cleared it and tried again/);
  });

  it('does not blame the file when nothing local explains it', () => {
    // A person whose worker failed for some other reason must not be told their backup
    // is damaged, because it is not.
    const said = describeWorkerFailure([], null);
    expect(said).toMatch(/has not been touched/);
  });
});
