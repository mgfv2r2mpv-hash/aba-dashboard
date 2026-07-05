// Versioned envelope + forward migration for the at-rest ScheduleData blob.
//
// The native store (appLock.saveSchedule) is the source of truth: an AES-GCM
// blob of the schedule keyed by the PIN. Historically it stored bare
// JSON.stringify(ScheduleData). This module wraps that JSON in a versioned
// envelope so the schema can evolve independently of the Excel workbook —
// migrateScheduleData() upgrades any older shape (including pre-envelope legacy
// JSON) to the current schema, so new ScheduleData fields can be added with
// ZERO excelHandler changes: old blobs are backfilled on read.
//
// This versions the STORAGE ENVELOPE, independent of ScheduleData.version
// (which versioned the Excel sheet layout, SCHEMA_VERSION in excelHandler.ts).

import { ScheduleData } from './types';

export const BLOB_FORMAT = 'aba-schedule';

// Bump when a migration step is added to STEPS below.
export const CURRENT_SCHEMA_VERSION = 1;

// The on-disk (pre-encryption) shape. `data` is a ScheduleData at `schemaVersion`.
export interface ScheduleEnvelope {
  blobFormat: typeof BLOB_FORMAT;
  schemaVersion: number;
  gzip: boolean;
  data: ScheduleData;
}

// One N→N+1 transform, keyed by the version it upgrades FROM. Each must be pure
// (return a new object). Add entries here as the schema grows; version 0→1 is the
// envelope baseline (no data change), so it is intentionally absent.
const STEPS: Record<number, (data: any) => any> = {
  // 1: (data) => ({ ...data, someNewField: deriveIt(data) }),
};

function isEnvelope(v: any): v is ScheduleEnvelope {
  return !!v && typeof v === 'object'
    && v.blobFormat === BLOB_FORMAT
    && typeof v.schemaVersion === 'number'
    && !!v.data && typeof v.data === 'object';
}

// Apply each N→N+1 step in order from `fromVersion` up to CURRENT. A version at
// or beyond CURRENT (e.g. a blob written by a newer app) passes through untouched
// rather than throwing — forward-compatible for a single-user app.
function upgrade(data: any, fromVersion: number): any {
  let out = data;
  for (let v = fromVersion; v < CURRENT_SCHEMA_VERSION; v++) {
    const step = STEPS[v];
    if (step) out = step(out);
  }
  return out;
}

// Centralize the "absent optional = []" defaults that are scattered through the
// code so every read boundary yields a fully-shaped ScheduleData. Behavior-
// preserving: the rest of the app already treats absent as [].
function backfillDefaults(data: ScheduleData): ScheduleData {
  return {
    ...data,
    blackouts: data.blackouts ?? [],
    timeOff: data.timeOff ?? [],
    companyHolidays: data.companyHolidays ?? [],
    authorizations: data.authorizations ?? [],
    manualUsage: data.manualUsage ?? [],
    confirmedConflicts: data.confirmedConflicts ?? [],
  };
}

// Normalize whatever came out of the encrypted blob (or an import) into a current
// ScheduleData. Accepts a versioned envelope OR a bare legacy ScheduleData
// (pre-envelope, treated as the version-0 baseline). Never throws on a missing
// optional; only the caller's JSON.parse can throw.
export function migrateScheduleData(raw: unknown): ScheduleData {
  const schemaVersion = isEnvelope(raw) ? raw.schemaVersion : 0;
  const data = isEnvelope(raw) ? raw.data : raw;
  return backfillDefaults(upgrade(data, schemaVersion) as ScheduleData);
}

// Wrap a ScheduleData in the current envelope for persistence. The caller
// encrypts the returned JSON string.
export function wrapEnvelope(data: ScheduleData): string {
  const env: ScheduleEnvelope = {
    blobFormat: BLOB_FORMAT,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    gzip: false,
    data,
  };
  return JSON.stringify(env);
}

// Parse a decrypted blob string (envelope OR legacy bare JSON) into a current
// ScheduleData. Throws only on invalid JSON — callers already fail-soft on that.
export function unwrapEnvelope(json: string): ScheduleData {
  return migrateScheduleData(JSON.parse(json));
}
