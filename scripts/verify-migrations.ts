/**
 * Verification for the at-rest storage envelope + schema migration.
 * Run: npx tsx scripts/verify-migrations.ts
 *
 * Covers: envelope round-trip, legacy bare-JSON adoption, optional backfilling,
 * and forward-compatible passthrough of a newer (unknown) schema version.
 */
import { ScheduleData } from '../src/types';
import {
  wrapEnvelope, unwrapEnvelope, migrateScheduleData,
  CURRENT_SCHEMA_VERSION, BLOB_FORMAT,
} from '../src/scheduleMigrations';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}

// A full-shaped schedule with every optional present.
const full: ScheduleData = {
  id: 'd', version: 2,
  clients: [{ id: 'c1', name: 'Client One', availabilityWindows: {} }],
  technicians: [{ id: 't1', name: 'Tech One', isRBT: true, assignments: [], availability: {} }],
  settings: { supervisionDirectHoursPercent: 5, supervisionRBTHoursPercent: 5, parentTraining: { minimumHours: 1, targetMinHours: 2, targetMaxHours: 4, periodUnit: 'month' } },
  appointments: [
    { id: 'a1', title: 'Session', client: 'Client One', technician: 'Tech One', startTime: '2026-06-19T13:00:00', endTime: '2026-06-19T15:00:00', isFixed: false, isBillable: true, type: 'client-session' },
  ],
  blackouts: [{ entityType: 'client', entityId: 'c1', date: '2026-07-04' } as any],
  timeOff: [],
  companyHolidays: [],
  authorizations: [],
  manualUsage: [],
  confirmedConflicts: ['k1'],
  lastModified: '2026-06-14T00:00:00.000Z',
};

console.log('envelope round-trip');
{
  const json = wrapEnvelope(full);
  const env = JSON.parse(json);
  check('wrap sets blobFormat', env.blobFormat === BLOB_FORMAT);
  check('wrap sets current schemaVersion', env.schemaVersion === CURRENT_SCHEMA_VERSION);
  check('wrap defaults gzip off', env.gzip === false);
  const out = unwrapEnvelope(json);
  check('round-trip preserves id/appointments', out.id === 'd' && out.appointments.length === 1);
  check('round-trip preserves confirmedConflicts', JSON.stringify(out.confirmedConflicts) === JSON.stringify(['k1']));
  check('round-trip preserves a blackout', (out.blackouts ?? []).length === 1);
}

console.log('legacy bare-JSON adoption (pre-envelope store)');
{
  // Today's format: bare JSON.stringify(ScheduleData), no envelope.
  const legacyJson = JSON.stringify(full);
  const out = unwrapEnvelope(legacyJson);
  check('legacy JSON parses to a schedule', out.id === 'd' && out.appointments.length === 1);
  check('legacy JSON is not mistaken for an envelope', out.clients.length === 1 && (out as any).blobFormat === undefined);
}

console.log('optional backfilling');
{
  // A minimal legacy object missing every optional array.
  const minimal = {
    id: 'm', version: 2,
    clients: [], technicians: [],
    settings: full.settings,
    appointments: [],
    lastModified: '2026-06-14T00:00:00.000Z',
  };
  const out = migrateScheduleData(minimal);
  check('blackouts backfilled to []', Array.isArray(out.blackouts) && out.blackouts.length === 0);
  check('timeOff backfilled to []', Array.isArray(out.timeOff));
  check('companyHolidays backfilled to []', Array.isArray(out.companyHolidays));
  check('authorizations backfilled to []', Array.isArray(out.authorizations));
  check('manualUsage backfilled to []', Array.isArray(out.manualUsage));
  check('confirmedConflicts backfilled to []', Array.isArray(out.confirmedConflicts));
}

console.log('forward-compatible passthrough (newer schema version)');
{
  const future = JSON.stringify({
    blobFormat: BLOB_FORMAT,
    schemaVersion: CURRENT_SCHEMA_VERSION + 5,
    gzip: false,
    data: { ...full, someFutureField: 42 },
  });
  let threw = false;
  let out: ScheduleData | null = null;
  try { out = unwrapEnvelope(future); } catch { threw = true; }
  check('does not throw on a newer schema version', !threw);
  check('passes through unknown future fields', out !== null && (out as any).someFutureField === 42);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
