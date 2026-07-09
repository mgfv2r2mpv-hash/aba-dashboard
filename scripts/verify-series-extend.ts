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

// ── Measured cadence beats a wrong label ────────────────────────────────────
console.log('extend — a mislabeled biweekly series extends at 14 days (measured, not label)');
{
  const S = 's';
  // Three members 14 days apart but stamped 'weekly' by a buggy old writer.
  const rows = ['2026-06-01', '2026-06-15', '2026-06-29']
    .map((d, i) => appt({ id: `ml${i}`, start: `${d}T10:00:00`, end: `${d}T12:00:00`, seriesId: S, isRecurring: true, recurringPattern: 'weekly' }));
  const r = extendSeries(mkData(rows), S, '2026-07-27', new Date('2026-06-30T08:00:00'));
  const adds = r.ops.filter(o => o.op === 'add') as Extract<typeof r.ops[number], { op: 'add' }>[];
  check('adds Jul 13 + Jul 27 only (14-day step, label ignored)',
    adds.length === 2 && adds.some(a => a.start.startsWith('2026-07-13')) && adds.some(a => a.start.startsWith('2026-07-27')),
    adds.map(a => a.start.slice(0, 10)).join(','));
  check('adds are stamped with the MEASURED biweekly pattern', adds.every(a => a.pattern === 'biweekly'),
    adds.map(a => a.pattern).join(','));
}

console.log('extend — an UNLABELED biweekly series extends at 14 days');
{
  const S = 's';
  const rows = ['2026-06-01', '2026-06-15', '2026-06-29']
    .map((d, i) => appt({ id: `ul${i}`, start: `${d}T10:00:00`, end: `${d}T12:00:00`, seriesId: S }));
  const r = extendSeries(mkData(rows), S, '2026-07-27', new Date('2026-06-30T08:00:00'));
  const adds = r.ops.filter(o => o.op === 'add') as Extract<typeof r.ops[number], { op: 'add' }>[];
  check('adds Jul 13 + Jul 27 only (no label to lean on)',
    adds.length === 2 && adds.some(a => a.start.startsWith('2026-07-13')) && adds.some(a => a.start.startsWith('2026-07-27')),
    adds.map(a => a.start.slice(0, 10)).join(','));
}

// ── Monthly flavors ─────────────────────────────────────────────────────────
console.log('extend — monthly same-date steps to the same day-of-month (one add per month)');
{
  const S = 's';
  // Jan/Feb/Mar 15 land on DIFFERENT weekdays — a per-(weekday|clock) slot walk
  // would advance each as its own monthly slot and triple-book the series.
  const rows = ['2026-01-15', '2026-02-15', '2026-03-15']
    .map((d, i) => appt({ id: `md${i}`, start: `${d}T10:00:00`, end: `${d}T11:00:00`, seriesId: S }));
  const r = extendSeries(mkData(rows), S, '2026-05-20', new Date('2026-03-20T08:00:00'));
  const adds = r.ops.filter(o => o.op === 'add') as Extract<typeof r.ops[number], { op: 'add' }>[];
  check('exactly Apr 15 + May 15 added (no duplicates from weekday slots)',
    adds.length === 2 && adds.some(a => a.start.startsWith('2026-04-15')) && adds.some(a => a.start.startsWith('2026-05-15')),
    adds.map(a => a.start.slice(0, 10)).join(','));
  check("adds stamped 'monthly'", adds.every(a => a.pattern === 'monthly'), adds.map(a => a.pattern).join(','));
}

console.log('extend — monthly first-Tuesday steps to the next FIRST TUESDAY (no drift)');
{
  const S = 's';
  // First Tuesdays of 2026: Jan 6, Feb 3, Mar 3. A naive setMonth(+1) from Mar 3
  // gives Apr 3 (a Friday) — off the weekday. Must land Apr 7 and May 5.
  const rows = ['2026-01-06', '2026-02-03', '2026-03-03']
    .map((d, i) => appt({ id: `nt${i}`, start: `${d}T10:00:00`, end: `${d}T11:00:00`, seriesId: S }));
  const r = extendSeries(mkData(rows), S, '2026-05-31', new Date('2026-03-10T08:00:00'));
  const adds = r.ops.filter(o => o.op === 'add') as Extract<typeof r.ops[number], { op: 'add' }>[];
  check('adds Apr 7 + May 5 (first Tuesdays), never Apr 3',
    adds.length === 2 && adds.some(a => a.start.startsWith('2026-04-07')) && adds.some(a => a.start.startsWith('2026-05-05'))
    && !adds.some(a => a.start.startsWith('2026-04-03')),
    adds.map(a => a.start.slice(0, 10)).join(','));
  check('every add is a Tuesday', adds.every(a => new Date(a.start).getDay() === 2));
}

console.log("extend — monthly last-Friday steps to the next LAST Friday (nth='last')");
{
  const S = 's';
  // Last Fridays: Jan 30 (a 5th Friday), Feb 27, Mar 27. Next: Apr 24, May 29.
  const rows = ['2026-01-30', '2026-02-27', '2026-03-27']
    .map((d, i) => appt({ id: `lf${i}`, start: `${d}T10:00:00`, end: `${d}T11:00:00`, seriesId: S }));
  const r = extendSeries(mkData(rows), S, '2026-05-31', new Date('2026-04-01T08:00:00'));
  const adds = r.ops.filter(o => o.op === 'add') as Extract<typeof r.ops[number], { op: 'add' }>[];
  check('adds Apr 24 + May 29 (last Fridays)',
    adds.length === 2 && adds.some(a => a.start.startsWith('2026-04-24')) && adds.some(a => a.start.startsWith('2026-05-29')),
    adds.map(a => a.start.slice(0, 10)).join(','));
}

// ── Custom series stamp 'custom', not 'weekly' ──────────────────────────────
console.log("extend — a custom weekday-set series stamps its adds 'custom'");
{
  const S = 's';
  const rows = [
    appt({ id: 'c1', start: '2026-06-01T16:00:00', end: '2026-06-01T18:00:00', seriesId: S }), // Mon
    appt({ id: 'c2', start: '2026-06-03T16:00:00', end: '2026-06-03T18:00:00', seriesId: S }), // Wed
    appt({ id: 'c3', start: '2026-06-08T16:00:00', end: '2026-06-08T18:00:00', seriesId: S }), // Mon
    appt({ id: 'c4', start: '2026-06-10T16:00:00', end: '2026-06-10T18:00:00', seriesId: S }), // Wed
  ];
  const r = extendSeries(mkData(rows), S, '2026-06-24', new Date('2026-06-09T08:00:00'));
  const adds = r.ops.filter(o => o.op === 'add') as Extract<typeof r.ops[number], { op: 'add' }>[];
  check('both weekday slots advance weekly', adds.filter(a => new Date(a.start).getDay() === 1).length === 2
    && adds.filter(a => new Date(a.start).getDay() === 3).length === 2);
  check("adds carry pattern 'custom' (not 'weekly')", adds.every(a => a.pattern === 'custom'),
    adds.map(a => a.pattern).join(','));
}

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILED'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
