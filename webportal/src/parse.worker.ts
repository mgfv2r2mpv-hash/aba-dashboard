// Web Worker: decrypt the file bytes, parse the workbook, build the cache.
// Runs off the main thread so the UI stays responsive during heavy XLSX parsing.
import * as XLSX from 'xlsx';
import { decryptBytes, deobfuscateKey } from '@shared/clientCrypto';
import { parseWorkbook } from '@shared/excelHandler';
import { buildCache } from '@shared/complianceCache';

export interface WorkerRequest {
  bytes: Uint8Array;
  password: string;
}

export type WorkerResponse =
  | { ok: true; data: ReturnType<typeof parseWorkbook>['data']; cache: ReturnType<typeof buildCache>; apiKey?: string }
  | { ok: false; isDOMException: boolean; message: string };

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  try {
    const { bytes, password } = e.data;
    const plain = await decryptBytes(bytes, password);
    const wb = XLSX.read(plain, { type: 'array' });
    const { data, embeddedConfig } = parseWorkbook(wb);
    const cache = buildCache(data);
    const apiKey = embeddedConfig ? (await deobfuscateKey(embeddedConfig)) || undefined : undefined;
    (self as unknown as Worker).postMessage({ ok: true, data, cache, apiKey } satisfies WorkerResponse);
  } catch (err) {
    (self as unknown as Worker).postMessage({
      ok: false,
      isDOMException: err instanceof DOMException,
      message: err instanceof Error ? err.message : String(err),
    } satisfies WorkerResponse);
  }
};
