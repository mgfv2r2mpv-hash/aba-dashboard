// The file store's plumbing, exercised without a browser: fake workers stand in
// for the real ones so every branch the portal used to carry inline - a wrong
// password, a decrypted file that is not a schedule, a worker that never starts -
// is pinned to the failure the screen keys off.
import { describe, it, expect, vi } from 'vitest';
import { createFileScheduleStore, readBackupFile, type WorkerFactory } from './fileScheduleStore';
import { StoreError } from './scheduleStore';
import type { ScheduleData } from '@shared/types';
import type { ComplianceCache } from '@shared/complianceCache';

const MAGIC = [0x41, 0x42, 0x41, 0x45, 0x4e, 0x43, 0x31]; // 'ABAENC1'
const encryptedBytes = (payload: number[] = [1, 2, 3]) => new Uint8Array([...MAGIC, ...payload]);

class FakeWorker extends EventTarget {
  onerror: ((e: ErrorEvent) => void) | null = null;
  readonly posted: unknown[] = [];
  terminated = false;
  postMessage(msg: unknown) { this.posted.push(msg); }
  terminate() { this.terminated = true; }
  reply(data: unknown) { this.dispatchEvent(new MessageEvent('message', { data })); }
  fail(message: string) { this.onerror?.({ message } as ErrorEvent); }
}

function harness() {
  const parse = new FakeWorker();
  const save = new FakeWorker();
  const delivered: { bytes: Uint8Array; filename: string }[] = [];
  const factory: WorkerFactory = {
    parse: () => parse as unknown as Worker,
    save: () => save as unknown as Worker,
  };
  const store = createFileScheduleStore(factory, (bytes, filename) => { delivered.push({ bytes, filename }); });
  return { parse, save, delivered, store };
}

const schedule = {
  id: 'e2a2f0f4-2b53-4e2f-9d1c-0f4f6b6c1a11',
  settings: { practiceName: 'Sunrise ABA' },
} as unknown as ScheduleData;
const cache = {} as ComplianceCache;

describe('readBackupFile', () => {
  it('accepts a file carrying the encrypted-backup magic', async () => {
    const ref = await readBackupFile(new File([encryptedBytes()], 'backup.sassi'));
    expect(Array.from(ref.bytes.slice(0, 7))).toEqual(MAGIC);
  });

  it('refuses an unencrypted file before any password is asked for', async () => {
    const err = await readBackupFile(new File(['{"clients":[]}'], 'plain.json')).catch(e => e);
    expect(err).toBeInstanceOf(StoreError);
    expect(err.failure).toBe('unreadable');
    expect(err.message).toMatch(/not encrypted/i);
  });
});

describe('file store: load', () => {
  it('hands back the schedule, its cache and its AI settings', async () => {
    const { parse, store } = harness();
    const opened = store.load({ bytes: encryptedBytes() }, 'hunter2');
    parse.reply({ ok: true, data: schedule, cache, aiConfig: { apiKey: 'sk-x' } });
    await expect(opened).resolves.toMatchObject({ data: schedule, aiConfig: { apiKey: 'sk-x' } });
  });

  it('reports absent AI settings as null rather than undefined', async () => {
    const { parse, store } = harness();
    const opened = store.load({ bytes: encryptedBytes() }, 'hunter2');
    parse.reply({ ok: true, data: schedule, cache });
    expect((await opened).aiConfig).toBeNull();
  });

  it('sends the bytes and the password to the worker, and nothing else', async () => {
    const { parse, store } = harness();
    const bytes = encryptedBytes([9, 9]);
    void store.load({ bytes }, 'hunter2').catch(() => {});
    expect(parse.posted).toEqual([{ bytes, password: 'hunter2' }]);
  });

  it('calls a wrong password a bad credential, not an unreadable file', async () => {
    const { parse, store } = harness();
    const opened = store.load({ bytes: encryptedBytes() }, 'wrong');
    parse.reply({ ok: false, isDOMException: true, message: 'The operation failed' });
    const err = await opened.catch(e => e);
    expect(err.failure).toBe('bad-credential');
    expect(err.message).toMatch(/incorrect password/i);
  });

  it('carries the worker\'s own message when the decrypted file is not a schedule', async () => {
    const { parse, store } = harness();
    const opened = store.load({ bytes: encryptedBytes() }, 'hunter2');
    parse.reply({ ok: false, isDOMException: false, message: 'This is a legacy Excel export.' });
    const err = await opened.catch(e => e);
    expect(err.failure).toBe('unreadable');
    expect(err.message).toBe('This is a legacy Excel export.');
  });

  it('drops a worker that failed to start instead of retrying into it', async () => {
    const { parse, store } = harness();
    const opened = store.load({ bytes: encryptedBytes() }, 'hunter2');
    parse.fail('boom');
    const err = await opened.catch(e => e);
    expect(err.failure).toBe('failed');
    expect(parse.terminated).toBe(true);
  });

  it('says what is wrong rather than "unknown error" when nothing local explains it', async () => {
    // The old message named nothing and told the person to refresh, which could not
    // help. A clean browser now gets a sentence that at least does not blame the file.
    const { parse, store } = harness();
    const opened = store.load({ bytes: encryptedBytes() }, 'hunter2');
    parse.fail('boom');
    const err = await opened.catch(e => e);
    expect(err.message).not.toContain('unknown error');
    expect(err.message).toMatch(/has not been touched/);
  });

  it('clears a poisoned cache and opens the schedule anyway', async () => {
    // The whole self-heal, end to end. The first worker never starts, the browser turns
    // out to be holding a web page under a script URL, and the person sees the schedule
    // rather than a dead end.
    const first = new FakeWorker();
    const second = new FakeWorker();
    const spawned = [first, second];
    const purge = vi.fn(async () => ({ cachesDeleted: ['aba-portal-v2'], workersUnregistered: 1 }));
    const recovery = {
      inspect: async () => [{ url: 'https://x/assets/parse.worker-a.js', cacheName: 'aba-portal-v2', contentType: 'text/html' }],
      purge,
    };
    const store = createFileScheduleStore(
      { parse: () => spawned.shift() as unknown as Worker, save: () => new FakeWorker() as unknown as Worker },
      () => {},
      recovery,
    );

    const opened = store.load({ bytes: encryptedBytes() }, 'hunter2');
    first.fail('');
    await vi.waitFor(() => { expect(second.posted).toHaveLength(1); });
    second.reply({ ok: true, data: schedule, cache });

    await expect(opened).resolves.toMatchObject({ data: schedule });
    expect(purge).toHaveBeenCalledTimes(1);
    expect(first.terminated).toBe(true);
  });

  it('heals once, then reports honestly instead of purging on a loop', async () => {
    // A second purge would be purging an empty cache, so it would spin rather than
    // recover. The second failure has to reach the person.
    const workers = [new FakeWorker(), new FakeWorker(), new FakeWorker()];
    const purge = vi.fn(async () => ({ cachesDeleted: [], workersUnregistered: 0 }));
    const store = createFileScheduleStore(
      { parse: () => workers.shift() as unknown as Worker, save: () => new FakeWorker() as unknown as Worker },
      () => {},
      {
        inspect: async () => [{ url: 'https://x/assets/parse.worker-a.js', cacheName: 'v2', contentType: 'text/html' }],
        purge,
      },
    );

    const [one, two] = [workers[0], workers[1]];
    const firstTry = store.load({ bytes: encryptedBytes() }, 'p');
    one.fail('');
    await vi.waitFor(() => { expect(two.posted).toHaveLength(1); });
    two.fail('');
    const err = await firstTry.catch((e) => e);

    expect(err.failure).toBe('failed');
    expect(err.message).toMatch(/even after clearing/);
    expect(purge).toHaveBeenCalledTimes(1);
  });

  it('does not purge a healthy browser just because a worker died', async () => {
    // Purging is destructive to the offline cache, so it is reserved for a browser that
    // has actually been proven to hold something corrupt.
    const purge = vi.fn();
    const { parse, store: _ } = harness();
    void _;
    const worker = new FakeWorker();
    const store = createFileScheduleStore(
      { parse: () => worker as unknown as Worker, save: () => new FakeWorker() as unknown as Worker },
      () => {},
      { inspect: async () => [], purge },
    );
    void parse;

    const opened = store.load({ bytes: encryptedBytes() }, 'p');
    worker.fail('');
    await opened.catch(() => {});
    expect(purge).not.toHaveBeenCalled();
  });

  it('reuses one parse worker across a retyped password', async () => {
    const spawn = vi.fn(() => new FakeWorker() as unknown as Worker);
    const worker = new FakeWorker();
    spawn.mockReturnValue(worker as unknown as Worker);
    const store = createFileScheduleStore({ parse: spawn, save: () => new FakeWorker() as unknown as Worker }, () => {});

    const first = store.load({ bytes: encryptedBytes() }, 'wrong');
    worker.reply({ ok: false, isDOMException: true, message: 'nope' });
    await first.catch(() => {});

    const second = store.load({ bytes: encryptedBytes() }, 'right');
    worker.reply({ ok: true, data: schedule, cache });
    await second;

    expect(spawn).toHaveBeenCalledTimes(1);
  });
});

describe('file store: save', () => {
  it('delivers the encrypted bytes under a name built from the practice', async () => {
    const { save, delivered, store } = harness();
    const done = store.save(schedule, null, 'hunter2');
    const bytes = new Uint8Array([7, 7, 7]);
    save.reply({ ok: true, bytes });
    await done;
    expect(delivered).toHaveLength(1);
    expect(delivered[0].bytes).toBe(bytes);
    expect(delivered[0].filename).toMatch(/^sunrise-aba_\d{4}-\d{2}-\d{2}_\d{4}\.sassi$/);
  });

  it('sends the schedule, the password and the AI settings to the worker', async () => {
    const { save, store } = harness();
    void store.save(schedule, { apiKey: 'sk-x' }, 'hunter2').catch(() => {});
    expect(save.posted).toEqual([{ data: schedule, password: 'hunter2', aiConfig: { apiKey: 'sk-x' } }]);
  });

  it('does not deliver anything when the worker reports a failure', async () => {
    const { save, delivered, store } = harness();
    const done = store.save(schedule, null, 'hunter2');
    save.reply({ ok: false, message: 'out of memory' });
    const err = await done.catch(e => e);
    expect(err.failure).toBe('failed');
    expect(err.message).toMatch(/out of memory/);
    expect(delivered).toEqual([]);
  });
});

describe('file store: shape', () => {
  it('says it needs a credential, because the bytes are encrypted at rest', () => {
    expect(harness().store.describe()).toMatchObject({ id: 'file', needsCredential: true });
  });

  it('terminates its workers on dispose and stays usable afterwards', async () => {
    const { parse, store } = harness();
    void store.load({ bytes: encryptedBytes() }, 'hunter2').catch(() => {});
    store.dispose();
    expect(parse.terminated).toBe(true);
    void store.load({ bytes: encryptedBytes() }, 'hunter2').catch(() => {});
    expect(parse.posted).toHaveLength(2);
  });
});
