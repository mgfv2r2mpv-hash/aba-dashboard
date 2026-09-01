// The file-backed schedule store: an encrypted .sassi backup on the person's own
// disk. Crypto runs in workers so the main thread stays responsive, and both the
// worker factory and the delivery step are injectable so the plumbing can be
// exercised without a browser.
import { isEncryptedSchedule } from '@shared/clientCrypto';
import { backupFilename } from '@shared/lib/backupFilename';
import type { WorkerRequest, WorkerResponse } from '../parse.worker';
import type { SaveRequest, SaveResponse } from '../save.worker';
import {
  browserRecovery,
  describeWorkerFailure,
  type Recovery,
} from './workerRecovery';
import {
  StoreError,
  type OpenedSchedule,
  type ScheduleStore,
  type StoreDescription,
} from './scheduleStore';

/** One encrypted backup, held as the bytes we were handed. */
export interface FileRef {
  readonly bytes: Uint8Array;
}

const NOT_ENCRYPTED =
  'This file is not encrypted. Export a backup (.sassi) from the SAssi Cal app with a schedule password, then try again.';

/**
 * Turns a file the person dropped into a ref, before any password is asked for.
 * Throws StoreError('unreadable') when the file is not a SAssi backup at all -
 * asking for a password first would be a worse way to say the same thing.
 */
export async function readBackupFile(file: File): Promise<FileRef> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    throw new StoreError('unreadable', 'Could not read the file. Please try again.');
  }
  if (!isEncryptedSchedule(bytes)) throw new StoreError('unreadable', NOT_ENCRYPTED);
  return { bytes };
}

/** How the store gets its workers. */
export interface WorkerFactory {
  parse(): Worker;
  save(): Worker;
}

const browserWorkers: WorkerFactory = {
  parse: () => new Worker(new URL('../parse.worker.ts', import.meta.url), { type: 'module' }),
  save: () => new Worker(new URL('../save.worker.ts', import.meta.url), { type: 'module' }),
};

/** Hands the finished bytes to the person. */
export type Deliver = (bytes: Uint8Array, filename: string) => void;

const downloadToDisk: Deliver = (bytes, filename) => {
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

const DESCRIPTION: StoreDescription = {
  id: 'file',
  label: 'an encrypted backup file on this device',
  needsCredential: true,
};

/**
 * One request to an already-running parse worker.
 *
 * Used by the retry after a purge. It deliberately has no recovery arm of its own: the
 * cache has just been emptied, so a second failure here is a real one and must surface
 * rather than starting the cycle again.
 */
function once(worker: Worker, ref: FileRef, credential: string): Promise<OpenedSchedule> {
  return new Promise<OpenedSchedule>((resolve, reject) => {
    const detach = () => {
      worker.removeEventListener('message', onMessage);
      worker.onerror = null;
    };
    const onMessage = (e: MessageEvent<WorkerResponse>) => {
      detach();
      const res = e.data;
      if (res.ok) resolve({ data: res.data, cache: res.cache, aiConfig: res.aiConfig ?? null });
      else if (res.isDOMException) reject(new StoreError('bad-credential', 'Incorrect password. Please try again.'));
      else reject(new StoreError('unreadable', res.message));
    };
    worker.addEventListener('message', onMessage);
    worker.onerror = () => {
      detach();
      reject(new StoreError('failed',
        'The decryption worker would not start even after clearing this browser\'s saved copies. '
        + 'Reload the page, and if it happens again the file itself has not been touched.'));
    };
    worker.postMessage({ bytes: ref.bytes, password: credential } satisfies WorkerRequest);
  });
}

export function createFileScheduleStore(
  workers: WorkerFactory = browserWorkers,
  deliver: Deliver = downloadToDisk,
  recovery: Recovery = browserRecovery(),
): ScheduleStore<FileRef> {
  // The parse worker outlives one attempt so a retyped password does not pay for a
  // fresh module load. The save worker is one-shot: each save gets a clean one.
  let parseWorker: Worker | null = null;
  let saveWorker: Worker | null = null;
  // One self-heal per session. A second attempt after a purge would be purging an
  // empty cache, so it would spin rather than recover.
  let healed = false;

  return {
    describe: () => DESCRIPTION,

    load(ref, credential) {
      return new Promise<OpenedSchedule>((resolve, reject) => {
        const worker = (parseWorker ??= workers.parse());
        const detach = () => {
          worker.removeEventListener('message', onMessage);
          worker.onerror = null;
        };

        const onMessage = (e: MessageEvent<WorkerResponse>) => {
          detach();
          const res = e.data;
          if (res.ok) {
            resolve({ data: res.data, cache: res.cache, aiConfig: res.aiConfig ?? null });
          } else if (res.isDOMException) {
            reject(new StoreError('bad-credential', 'Incorrect password. Please try again.'));
          } else {
            // The worker only reaches here after decrypting, so the password was
            // right and the plaintext was not a schedule. Its message says which.
            reject(new StoreError('unreadable', res.message));
          }
        };

        worker.addEventListener('message', onMessage);
        worker.onerror = () => {
          detach();
          // A worker that failed to start will fail the same way next time, so
          // drop it rather than retrying into the same corpse.
          parseWorker?.terminate();
          parseWorker = null;

          // The ErrorEvent from a worker that never started carries no message, which
          // is why this used to say "unknown error" and send people to a refresh that
          // could not help. So the failure asks the browser what it actually has, and
          // if it is holding a web page under a script URL it throws that away and
          // tries once more. From the person's side the schedule simply opens.
          void (async () => {
            const poisoned = await recovery.inspect();
            if (poisoned.length === 0 || healed) {
              reject(new StoreError('failed', describeWorkerFailure(poisoned, null)));
              return;
            }
            healed = true;
            const purged = await recovery.purge();
            try {
              const fresh = (parseWorker = workers.parse());
              resolve(await once(fresh, ref, credential));
            } catch (cause) {
              parseWorker?.terminate();
              parseWorker = null;
              reject(cause instanceof StoreError
                ? cause
                : new StoreError('failed', describeWorkerFailure(poisoned, purged)));
            }
          })();
        };

        worker.postMessage({ bytes: ref.bytes, password: credential } satisfies WorkerRequest);
      });
    },

    save(data, aiConfig, credential) {
      return new Promise<void>((resolve, reject) => {
        const worker = workers.save();
        saveWorker?.terminate();
        saveWorker = worker;

        const finish = () => {
          worker.terminate();
          if (saveWorker === worker) saveWorker = null;
        };

        worker.addEventListener('message', (e: MessageEvent<SaveResponse>) => {
          finish();
          const res = e.data;
          if (!res.ok) {
            reject(new StoreError('failed', `Save failed: ${res.message}`));
            return;
          }
          deliver(res.bytes, backupFilename(data.settings.practiceName));
          resolve();
        });

        worker.onerror = (e: ErrorEvent) => {
          finish();
          reject(new StoreError('failed', `Save worker failed: ${e.message ?? 'unknown error'}`));
        };

        worker.postMessage({ data, password: credential, aiConfig: aiConfig ?? undefined } satisfies SaveRequest);
      });
    },

    dispose() {
      parseWorker?.terminate();
      parseWorker = null;
      saveWorker?.terminate();
      saveWorker = null;
    },
  };
}
