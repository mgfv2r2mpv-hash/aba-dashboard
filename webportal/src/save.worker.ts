// Web Worker: wrap the schedule in the lossless versioned JSON envelope, embed the
// AI settings (app-obfuscated, like the retired .xlsx _Config), and encrypt the whole
// thing with the session password. Returns bytes via transferable so the main thread
// can trigger a download without blocking. This is the portable backup format the
// companion app reads/writes; the schedule password is NEVER embedded.
import { wrapEnvelope } from '@shared/scheduleMigrations';
import { encryptBytes, obfuscateKey } from '@shared/clientCrypto';
import type { ScheduleData } from '@shared/types';
import type { AiConfig } from './parse.worker';

export interface SaveRequest {
  data: ScheduleData;
  password: string;
  aiConfig?: AiConfig | null;
}

export type SaveResponse =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; message: string };

self.onmessage = async (e: MessageEvent<SaveRequest>) => {
  try {
    const { data, password, aiConfig } = e.data;

    // Preserve every AI setting across the round-trip (model/mapsApiKey ride along
    // even though the portal UI only edits the Claude key), so nothing the app set
    // is silently dropped. Omit the field entirely when there is nothing to carry.
    const embedded =
      aiConfig?.apiKey || aiConfig?.mapsApiKey
        ? await obfuscateKey(JSON.stringify({ apiKey: aiConfig.apiKey, model: aiConfig.model, mapsApiKey: aiConfig.mapsApiKey }))
        : undefined;

    const encrypted = await encryptBytes(new TextEncoder().encode(wrapEnvelope(data, embedded)), password);
    (self as unknown as Worker).postMessage({ ok: true, bytes: encrypted } satisfies SaveResponse, [encrypted.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    } satisfies SaveResponse);
  }
};
