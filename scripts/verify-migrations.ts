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

console.log('make-up normalization (never recurring)');
{
  // A legacy (version-0 bare) schedule whose make-up was mis-flagged recurring —
  // e.g. a single-instance edit of a recurring session turned into a make-up.
  const dirty = {
    id: 'x', version: 2,
    clients: [], technicians: [], settings: full.settings,
    appointments: [
      { id: 'mu', title: 'Sat make-up', client: 'C', technician: 'T', startTime: '2026-07-04T09:00:00', endTime: '2026-07-04T11:00:00', isFixed: false, isBillable: true, type: 'client-session', isMakeUp: true, isRecurring: true, recurringPattern: 'weekly', makeupForId: 'orig' },
      // A REAL recurring series (multi-member) — must survive both the make-up strip
      // (1→2) and the trio heal (3→4) intact.
      { id: 'reg', title: 'Weekly', client: 'C', technician: 'T', startTime: '2026-07-06T13:00:00', endTime: '2026-07-06T15:00:00', isFixed: false, isBillable: true, type: 'client-session', isRecurring: true, recurringPattern: 'weekly', seriesId: 'S-REG' },
      { id: 'reg2', title: 'Weekly', client: 'C', technician: 'T', startTime: '2026-07-13T13:00:00', endTime: '2026-07-13T15:00:00', isFixed: false, isBillable: true, type: 'client-session', isRecurring: true, recurringPattern: 'weekly', seriesId: 'S-REG' },
    ],
    lastModified: '2026-06-14T00:00:00.000Z',
  };
  const out = migrateScheduleData(dirty);
  const mu = out.appointments.find(a => a.id === 'mu')!;
  const reg = out.appointments.find(a => a.id === 'reg')!;
  check('make-up isRecurring stripped to false', mu.isRecurring === false);
  check('make-up recurringPattern cleared', mu.recurringPattern === undefined);
  check('make-up flag + makeupForId preserved', mu.isMakeUp === true && mu.makeupForId === 'orig');
  check('non-make-up recurring series left intact', reg.isRecurring === true && reg.recurringPattern === 'weekly' && reg.seriesId === 'S-REG');

  // A clean make-up (already one-off) is untouched, and an envelope already at the
  // current version does not double-apply.
  const cleanEnv = wrapEnvelope({ ...(full as any), appointments: [
    { id: 'mu2', title: 'MU', client: 'C', technician: 'T', startTime: '2026-07-04T09:00:00', endTime: '2026-07-04T11:00:00', isFixed: false, isBillable: true, type: 'client-session', isMakeUp: true },
  ] } as ScheduleData);
  const cleanOut = unwrapEnvelope(cleanEnv);
  check('current-version envelope passes make-up through', cleanOut.appointments[0].isMakeUp === true && cleanOut.appointments[0].isRecurring === undefined);
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

console.log('action log: envelope round-trip + backfill');
{
  const entry = {
    id: 'e1', at: '2026-07-08T12:00:00.000Z', label: 'Build — 3 adds', source: 'build' as const,
    ops: [], before: {}, undoable: true,
  };
  const withLog: ScheduleData = { ...full, actionLog: [entry] };
  const out = unwrapEnvelope(wrapEnvelope(withLog));
  check('actionLog survives the envelope round-trip', JSON.stringify(out.actionLog) === JSON.stringify([entry]));
  const bare = migrateScheduleData({ ...full });
  check('absent actionLog backfills to []', Array.isArray(bare.actionLog) && bare.actionLog.length === 0);
}

console.log('recurrence heal (3→4): half-state A — recurring-labeled, no series');
{
  const env = {
    blobFormat: BLOB_FORMAT, schemaVersion: 3, gzip: false,
    data: { ...full, appointments: [
      { id: 'lone', title: 'S', client: 'c1', technician: 't1', startTime: '2026-06-01T10:00:00', endTime: '2026-06-01T11:00:00', isFixed: false, isBillable: true, type: 'client-session', isRecurring: true, recurringPattern: 'weekly' },
    ] },
  };
  const out = migrateScheduleData(env);
  const lone = out.appointments.find(a => a.id === 'lone')!;
  check('lone recurring row healed to one-time', !lone.isRecurring && lone.recurringPattern === undefined && !lone.seriesId,
    JSON.stringify({ r: lone.isRecurring, p: lone.recurringPattern, s: lone.seriesId }));
}

console.log('recurrence heal (3→4): half-state B — seriesId with no flags (measured, not label-copied)');
{
  // Biweekly-gapped fixture with NO stored pattern anywhere: a heal that merely
  // copies labels around cannot fake this pass — it must MEASURE the 14d gaps.
  const mk = (id: string, day: string) => ({
    id, title: 'S', client: 'c1', technician: 't1',
    startTime: `${day}T10:00:00`, endTime: `${day}T11:00:00`,
    isFixed: false, isBillable: true, type: 'client-session' as const, seriesId: 'SER-B',
  });
  const env = {
    blobFormat: BLOB_FORMAT, schemaVersion: 3, gzip: false,
    data: { ...full, appointments: [mk('b1', '2026-06-01'), mk('b2', '2026-06-15'), mk('b3', '2026-06-29')] },
  };
  const out = migrateScheduleData(env);
  check('members gain isRecurring', out.appointments.every(a => a.isRecurring === true));
  check('pattern is MEASURED biweekly', out.appointments.every(a => a.recurringPattern === 'biweekly'),
    out.appointments.map(a => a.recurringPattern).join(','));
}

console.log('recurrence heal (3→4): records of fact are spared byte-for-byte');
{
  const factA = { id: 'fa', title: 'S', client: 'c1', startTime: '2026-05-01T10:00:00', endTime: '2026-05-01T11:00:00', isFixed: false, isBillable: true, type: 'client-session' as const, status: 'completed' as const, isRecurring: true, recurringPattern: 'weekly' as const };
  const factB = { id: 'fb', title: 'S', client: 'c1', startTime: '2026-05-08T10:00:00', endTime: '2026-05-08T11:00:00', isFixed: false, isBillable: true, type: 'client-session' as const, status: 'canceled' as const, seriesId: 'GONE-SINGLETON' };
  const env = { blobFormat: BLOB_FORMAT, schemaVersion: 3, gzip: false, data: { ...full, appointments: [factA, factB] } };
  const out = migrateScheduleData(env);
  check('completed half-state row byte-equal after heal', JSON.stringify(out.appointments.find(a => a.id === 'fa')) === JSON.stringify(factA));
  check('canceled singleton-series row byte-equal after heal', JSON.stringify(out.appointments.find(a => a.id === 'fb')) === JSON.stringify(factB));
}

console.log('recurrence heal (3→4): pending make-up drops its seriesId');
{
  const mk = (id: string, day: string, extra: any = {}) => ({
    id, title: 'S', client: 'c1', technician: 't1',
    startTime: `${day}T10:00:00`, endTime: `${day}T11:00:00`,
    isFixed: false, isBillable: true, type: 'client-session' as const, seriesId: 'SER-M', ...extra,
  });
  const env = {
    blobFormat: BLOB_FORMAT, schemaVersion: 3, gzip: false,
    data: { ...full, appointments: [
      mk('m1', '2026-06-01'), mk('m2', '2026-06-08'),
      mk('mu', '2026-06-10', { isMakeUp: true, makeupForId: 'orig' }),
    ] },
  };
  const out = migrateScheduleData(env);
  const mu = out.appointments.find(a => a.id === 'mu')!;
  check('make-up trio cleared', !mu.seriesId && !mu.isRecurring && mu.recurringPattern === undefined);
  check('make-up linkage preserved', mu.isMakeUp === true && mu.makeupForId === 'orig');
  check('real siblings keep the series', out.appointments.filter(a => a.seriesId === 'SER-M').length === 2);
}

console.log('recurrence heal (3→4): idempotent + only fires below v4');
{
  check('CURRENT_SCHEMA_VERSION is 4', CURRENT_SCHEMA_VERSION === 4, String(CURRENT_SCHEMA_VERSION));
  const dirty = {
    blobFormat: BLOB_FORMAT, schemaVersion: 3, gzip: false,
    data: { ...full, appointments: [
      { id: 'x1', title: 'S', client: 'c1', startTime: '2026-06-01T10:00:00', endTime: '2026-06-01T11:00:00', isFixed: false, isBillable: true, type: 'client-session' as const, isRecurring: true },
    ] },
  };
  const once = migrateScheduleData(dirty);
  const twice = migrateScheduleData({ blobFormat: BLOB_FORMAT, schemaVersion: 3, gzip: false, data: once });
  check('re-running the heal changes nothing', JSON.stringify(once) === JSON.stringify(twice));
  // A v4 envelope was written by a healed app — the step must NOT fire on it
  // (a contrived half-state passes through untouched, proving the version gate).
  const atV4 = migrateScheduleData({ blobFormat: BLOB_FORMAT, schemaVersion: 4, gzip: false, data: dirty.data });
  check('v4 envelope passes through unhealed', atV4.appointments.find(a => a.id === 'x1')!.isRecurring === true);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
