// Web Worker: decrypt the file bytes, require a lossless JSON backup envelope, build
// the compliance cache, and restore any embedded AI settings. Runs off the main
// thread so the UI stays responsive. Excel (.xlsx) is intentionally no longer
// supported — a decrypted workbook is rejected with a clear message.
import { decryptBytes, deobfuscateKey } from '@shared/clientCrypto';
import { unwrapBackup } from '@shared/scheduleMigrations';
import { buildCache } from '@shared/complianceCache';
import type { ScheduleData } from '@shared/types';

// The AI settings the backup carries (obfuscated) so they restore on the other side
// of the app↔portal handoff. Held in session memory only; never sent anywhere.
export interface AiConfig {
  apiKey: string;
  model?: string;
  mapsApiKey?: string;
}

export interface WorkerRequest {
  bytes: Uint8Array;
  password: string;
}

export type WorkerResponse =
  | { ok: true; data: ScheduleData; cache: ReturnType<typeof buildCache>; aiConfig?: AiConfig }
  | { ok: false; isDOMException: boolean; message: string };

// Sniff the DECRYPTED bytes: a JSON envelope begins with '{' (0x7B) after optional
// whitespace; a legacy .xlsx is a PK zip (0x50 0x4B).
function sniff(bytes: Uint8Array): 'json' | 'xlsx' | 'unknown' {
  for (let i = 0; i < Math.min(bytes.length, 64); i++) {
    const b = bytes[i];
    if (b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d) continue; // whitespace
    if (b === 0x7b) return 'json';
    if (b === 0x50 && bytes[i + 1] === 0x4b) return 'xlsx';
    return 'unknown';
  }
  return 'unknown';
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  try {
    const { bytes, password } = e.data;
    const plain = await decryptBytes(bytes, password); // throws DOMException on a wrong password

    const kind = sniff(plain);
    if (kind !== 'json') {
      throw new Error(
        kind === 'xlsx'
          ? 'This is a legacy Excel export. In the ABA Dashboard app, download a JSON backup (.enc.json) and upload that here.'
          : 'This file is not a JSON schedule backup. Export a backup from the ABA Dashboard app.',
      );
    }

    const { data, aiConfig: rawConfig } = unwrapBackup(new TextDecoder().decode(plain));

    let aiConfig: AiConfig | undefined;
    if (rawConfig) {
      // The embedded config is app-obfuscated (no user password); a corrupt blob is
      // non-fatal — the schedule still loads, the user just re-enters the key.
      try {
        aiConfig = JSON.parse(await deobfuscateKey(rawConfig)) as AiConfig;
      } catch {
        aiConfig = undefined;
      }
    }

    const cache = buildCache(data);
    (self as unknown as Worker).postMessage({ ok: true, data, cache, aiConfig } satisfies WorkerResponse);
  } catch (err) {
    (self as unknown as Worker).postMessage({
      ok: false,
      isDOMException: err instanceof DOMException,
      message: err instanceof Error ? err.message : String(err),
    } satisfies WorkerResponse);
  }
};
