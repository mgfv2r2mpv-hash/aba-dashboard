// Web Worker: generate an XLSX workbook and encrypt it with the session password.
// Returns a Uint8Array via transferable so the main thread can trigger a download
// without blocking.
import { generateExcelBytes } from '@shared/excelHandler';
import { encryptBytes, obfuscateKey } from '@shared/clientCrypto';
import type { ScheduleData } from '@shared/types';

export interface SaveRequest {
  data: ScheduleData;
  password: string;
  apiKey?: string;
}

export type SaveResponse =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; message: string };

self.onmessage = async (e: MessageEvent<SaveRequest>) => {
  try {
    const { data, password, apiKey } = e.data;
    const embeddedConfig = apiKey ? await obfuscateKey(apiKey) : undefined;
    const xlsxBytes = generateExcelBytes(data, embeddedConfig);
    const encrypted = await encryptBytes(xlsxBytes, password);
    (self as unknown as Worker).postMessage(
      { ok: true, bytes: encrypted } satisfies SaveResponse,
      [encrypted.buffer],
    );
  } catch (err) {
    (self as unknown as Worker).postMessage({
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    } satisfies SaveResponse);
  }
};
