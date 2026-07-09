/**
 * Verification for seriesHorizon — "series ending soon" detection feeding the
 * dock prompt (user decision: PROMPT to extend, never silent adds).
 * Run: npx tsx scripts/verify-series-horizon.ts
 */
import { Appointment, ScheduleData } from '../src/types';
import { findEndingSeries, DEFAULT_EXTENSION_DAYS } from '../src/seriesHorizon';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}

let seq = 0;
function occ(day: string, over: Partial<Appointment> = {}): Appointment {
  return {
    id: over.id ?? `a${++seq}`, title: 'Session', client: 'C1', technician: 'T1',
    startTime: `${day}T10:00:00`, endTime: `${day}T11:00:00`,
    isFixed: false, isBillable: true, type: 'client-session', status: 'scheduled',
    isRecurring: true, recurringPattern: 'weekly', seriesId: 'S',
    ...over,
  };
}
function mkData(appts: Appointment[], over: Partial<ScheduleData> = {}): ScheduleData {
  return {
    id: 'd', version: 2,
    clients: [{ id: 'C1', name: 'Client One', availabilityWindows: {} }],
    technicians: [{ id: 'T1', name: 'Tech One', isRBT: true, assignments: [], availability: {} }],
    settings: { supervisionDirectHoursPercent: 10, supervisionRBTHoursPercent: 10 },
    appointments: appts,
    authorizations: [],
    lastModified: '2026-07-01T00:00:00',
    ...over,
  };
}
const NOW = new Date('2026-07-06T08:00:00'); // Monday

console.log('findEndingSeries — a series whose last occurrence is inside the lookahead is flagged');
{
  // Weekly Mondays ending Jul 13 — 7 days out with a 14-day lookahead.
  const data = mkData([occ('2026-06-29'), occ('2026-07-06'), occ('2026-07-13')]);
  const out = findEndingSeries(data, NOW);
  check('one ending series found', out.length === 1, String(out.length));
  check('carries the seriesId + last occurrence', out[0]?.seriesId === 'S' && out[0]?.lastOccurrence === '2026-07-13',
    JSON.stringify(out[0]));
  check('names the client', out[0]?.clientName === 'Client One', out[0]?.clientName);
}

console.log('findEndingSeries — a series with runway past the lookahead is NOT flagged');
{
  // Same series but materialized through Aug 31 — nothing to prompt about.
  const days = ['2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27', '2026-08-03', '2026-08-31'];
  const data = mkData(days.map(d => occ(d)));
  check('no prompt when the series runs on', findEndingSeries(data, NOW).length === 0);
}

console.log('findEndingSeries — archived clients never prompt');
{
  const data = mkData([occ('2026-07-06'), occ('2026-07-13')], {
    clients: [{ id: 'C1', name: 'Client One', availabilityWindows: {}, archived: true }],
  });
  check('archived case series skipped', findEndingSeries(data, NOW).length === 0);
}

console.log('findEndingSeries — suggestedThrough caps at the auth end');
{
  const data = mkData([occ('2026-07-06'), occ('2026-07-13')], {
    authorizations: [{
      id: 'AU1', clientId: 'C1', startDate: '2026-01-01', endDate: '2026-07-31', buckets: {},
    }],
  });
  const out = findEndingSeries(data, NOW);
  check('suggestion never schedules past the authorization', out[0]?.suggestedThrough === '2026-07-31', out[0]?.suggestedThrough);
}

console.log('findEndingSeries — auth already exhausted at the last occurrence = no runway, no prompt');
{
  const data = mkData([occ('2026-07-06'), occ('2026-07-13')], {
    authorizations: [{
      id: 'AU1', clientId: 'C1', startDate: '2026-01-01', endDate: '2026-07-13', buckets: {},
    }],
  });
  check('no prompt when there is nowhere to extend to', findEndingSeries(data, NOW).length === 0);
}

console.log('findEndingSeries — no auth uses the default extension window');
{
  const data = mkData([occ('2026-07-06'), occ('2026-07-13')]);
  const out = findEndingSeries(data, NOW);
  const expected = (() => {
    const d = new Date(2026, 6, 13, 12); d.setDate(d.getDate() + DEFAULT_EXTENSION_DAYS);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  check(`suggestedThrough = last occurrence + ${DEFAULT_EXTENSION_DAYS}d`, out[0]?.suggestedThrough === expected,
    `${out[0]?.suggestedThrough} vs ${expected}`);
}

console.log('findEndingSeries — a series of only facts never prompts');
{
  const data = mkData([
    occ('2026-06-29', { status: 'completed' }),
    occ('2026-07-06', { status: 'canceled' }),
  ]);
  check('all-facts series skipped (nothing pending to continue)', findEndingSeries(data, NOW).length === 0);
}

console.log(`\n${failed === 0 ? 'ALL PASS' : 'FAILURES'} — ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
