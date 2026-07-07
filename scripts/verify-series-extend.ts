// Verifies extendSeries: materialize a recurring series forward under the same
// seriesId, absorbing stray lone-recurring rows instead of duplicating them.
import { extendSeries } from '../src/seriesExtend';
import { Appointment, ScheduleData } from '../src/types';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra = ''): void {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}

let seq = 0;
function appt(p: Partial<Appointment> & { start: string; end: string }): Appointment {
  return {
    id: p.id ?? `a${++seq}`, title: p.title ?? 'JO / JA',
    client: p.client ?? 'JO', technician: p.technician ?? 'JA', type: p.type ?? 'client-session',
    startTime: p.start, endTime: p.end,
    isFixed: p.isFixed ?? false, isBillable: p.isBillable !== false, status: p.status ?? 'scheduled',
    isRecurring: p.isRecurring, recurringPattern: p.recurringPattern, seriesId: p.seriesId,
  };
}
function mkData(appts: Appointment[]): ScheduleData {
  return {
    id: 'd', version: 3,
    clients: [{ id: 'JO', name: 'JO', availabilityWindows: {} }],
    technicians: [{ id: 'JA', name: 'JA', isRBT: true, assignments: [], availability: {} }],
    settings: { supervisionDirectHoursPercent: 10, supervisionRBTHoursPercent: 10 },
    appointments: appts, lastModified: '2026-07-07T00:00:00',
  };
}
const dur = (a: { start: string; end: string }) => new Date(a.end).getTime() - new Date(a.start).getTime();

// ── The JO/JA Saturday case ─────────────────────────────────────────────────
console.log('extend — the JO/JA weekly Saturday series (real-world case)');
{
  const S = '31dcd1b4';
  const rows = [
    appt({ id: 's1', start: '2026-06-13T10:00:00', end: '2026-06-13T12:00:00', seriesId: S, isRecurring: true, recurringPattern: 'weekly', status: 'canceled' }),
    appt({ id: 's2', start: '2026-06-20T10:00:00', end: '2026-06-20T13:00:00', seriesId: S, isRecurring: true, recurringPattern: 'weekly', status: 'completed' }),
    appt({ id: 's3', start: '2026-06-27T10:00:00', end: '2026-06-27T12:00:00', seriesId: S, isRecurring: true, recurringPattern: 'weekly', status: 'canceled' }),
    appt({ id: 's4', start: '2026-07-04T10:00:00', end: '2026-07-04T12:00:00', seriesId: S, isRecurring: true, recurringPattern: 'weekly', status: 'canceled' }),
    appt({ id: 'orphan', start: '2026-07-11T10:00:00', end: '2026-07-11T13:00:00', isRecurring: true, recurringPattern: 'weekly' }), // no seriesId
  ];
  const r = extendSeries(mkData(rows), S, '2026-08-18', new Date('2026-07-07T08:00:00')); // auth end → last Sat Aug 15
  const adds = r.ops.filter(o => o.op === 'add') as Extract<typeof r.ops[number], { op: 'add' }>[];
  const regroups = r.ops.filter(o => o.op === 'regroup') as Extract<typeof r.ops[number], { op: 'regroup' }>[];
  check('5 new Saturdays added', adds.length === 5, `got ${adds.length}`);
  check('added through Aug 15', r.through === '2026-08-15', r.through);
  check('adds land on Jul 18 → Aug 15 Saturdays',
    ['2026-07-18', '2026-07-25', '2026-08-01', '2026-08-08', '2026-08-15'].every(d => adds.some(a => a.start.startsWith(d))));
  check('no duplicate on Jul 11 (orphan relinked, not re-added)', !adds.some(a => a.start.startsWith('2026-07-11')));
  check('orphan folded into the series via one regroup',
    regroups.length === 1 && regroups[0].appointmentIds.includes('orphan') && regroups[0].seriesId === S);
  check('new occurrences carry the existing series id', adds.every(a => a.seriesId === S));
  check('new occurrences keep the 2h template duration (latest member)', adds.every(a => dur(a) === 2 * 3600_000));
  check('relinked=1, added=5', r.relinked === 1 && r.added === 5);
}

// ── Idempotency: already runs to the end date ───────────────────────────────
console.log('extend — idempotent when the series already reaches the horizon');
{
  const S = 's';
  const rows = ['2026-07-11', '2026-07-18', '2026-07-25', '2026-08-01', '2026-08-08', '2026-08-15']
    .map((d, i) => appt({ id: `x${i}`, start: `${d}T10:00:00`, end: `${d}T12:00:00`, seriesId: S, isRecurring: true, recurringPattern: 'weekly' }));
  const r = extendSeries(mkData(rows), S, '2026-08-15', new Date('2026-07-07T08:00:00'));
  check('no ops when already extended', r.ops.length === 0 && !!r.reason, r.reason);
}

// ── Skip existing / extend only forward (no backfill of internal gaps) ───────
console.log('extend — fills forward from the latest occurrence, skips existing');
{
  const S = 's';
  const rows = ['2026-07-04', '2026-07-18'] // note: Jul 11 gap left intentionally
    .map((d, i) => appt({ id: `x${i}`, start: `${d}T10:00:00`, end: `${d}T12:00:00`, seriesId: S, isRecurring: true, recurringPattern: 'weekly' }));
  const r = extendSeries(mkData(rows), S, '2026-08-01', new Date('2026-07-07T08:00:00'));
  const adds = r.ops.filter(o => o.op === 'add') as Extract<typeof r.ops[number], { op: 'add' }>[];
  check('adds Jul 25 + Aug 1 only (forward from latest, no dup of Jul 18)',
    adds.length === 2 && adds.some(a => a.start.startsWith('2026-07-25')) && adds.some(a => a.start.startsWith('2026-08-01')));
  check('does NOT backfill the internal Jul 11 gap', !adds.some(a => a.start.startsWith('2026-07-11')));
}

// ── Multi-weekday series: both slots advance ────────────────────────────────
console.log('extend — a two-weekday series advances each weekday slot');
{
  const S = 's';
  const rows = [
    appt({ id: 'm1', start: '2026-06-01T16:00:00', end: '2026-06-01T18:00:00', seriesId: S, isRecurring: true, recurringPattern: 'weekly' }), // Mon
    appt({ id: 'w1', start: '2026-06-03T16:00:00', end: '2026-06-03T18:00:00', seriesId: S, isRecurring: true, recurringPattern: 'weekly' }), // Wed
    appt({ id: 'm2', start: '2026-06-08T16:00:00', end: '2026-06-08T18:00:00', seriesId: S, isRecurring: true, recurringPattern: 'weekly' }), // Mon
    appt({ id: 'w2', start: '2026-06-10T16:00:00', end: '2026-06-10T18:00:00', seriesId: S, isRecurring: true, recurringPattern: 'weekly' }), // Wed
  ];
  const r = extendSeries(mkData(rows), S, '2026-06-24', new Date('2026-06-09T08:00:00'));
  const adds = r.ops.filter(o => o.op === 'add') as Extract<typeof r.ops[number], { op: 'add' }>[];
  const mons = adds.filter(a => new Date(a.start).getDay() === 1).length;
  const weds = adds.filter(a => new Date(a.start).getDay() === 3).length;
  check('adds 2 Mondays (Jun 15, 22) and 2 Wednesdays (Jun 17, 24)', mons === 2 && weds === 2, `mon=${mons} wed=${weds}`);
}

// ── Biweekly step ───────────────────────────────────────────────────────────
console.log('extend — biweekly cadence steps 14 days');
{
  const S = 's';
  const rows = ['2026-06-13', '2026-06-27']
    .map((d, i) => appt({ id: `b${i}`, start: `${d}T10:00:00`, end: `${d}T12:00:00`, seriesId: S, isRecurring: true, recurringPattern: 'biweekly' }));
  const r = extendSeries(mkData(rows), S, '2026-07-25', new Date('2026-07-01T08:00:00'));
  const adds = r.ops.filter(o => o.op === 'add') as Extract<typeof r.ops[number], { op: 'add' }>[];
  check('adds Jul 11 + Jul 25 (14-day step)', adds.length === 2 && adds.some(a => a.start.startsWith('2026-07-11')) && adds.some(a => a.start.startsWith('2026-07-25')));
}

// ── Never poach: rows in another series or non-recurring stay put ────────────
console.log('extend — never absorbs rows from another series or non-recurring rows');
{
  const S = 's';
  const rows = [
    appt({ id: 's1', start: '2026-07-04T10:00:00', end: '2026-07-04T12:00:00', seriesId: S, isRecurring: true, recurringPattern: 'weekly' }),
    appt({ id: 'other', start: '2026-07-11T10:00:00', end: '2026-07-11T12:00:00', seriesId: 'OTHER', isRecurring: true, recurringPattern: 'weekly' }),
    appt({ id: 'oneoff', start: '2026-07-18T10:00:00', end: '2026-07-18T12:00:00' }), // not recurring, no series
  ];
  const r = extendSeries(mkData(rows), S, '2026-07-25', new Date('2026-07-07T08:00:00'));
  const regroups = r.ops.filter(o => o.op === 'regroup');
  check('no regroup (neither row is a stray recurring orphan)', regroups.length === 0);
}

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILED'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
