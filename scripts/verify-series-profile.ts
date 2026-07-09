/**
 * Verification for seriesProfile — the single cadence oracle: measurePattern
 * (measured inter-occurrence gaps beat stored labels), seriesProfileOf, and
 * normalizeRecurrenceFields (the trio-invariant enforcer, pending rows only).
 * Run: npx tsx scripts/verify-series-profile.ts
 */
import { Appointment } from '../src/types';
import { measurePattern, seriesProfileOf, normalizeRecurrenceFields } from '../src/seriesProfile';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}

// Dated appointment helper: 1-hour session at `start` (local ISO, no Z).
let seq = 0;
function appt(start: string, over: Partial<Appointment> = {}): Appointment {
  const end = new Date(new Date(start).getTime() + 60 * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const endIso = `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}T${pad(end.getHours())}:${pad(end.getMinutes())}:00`;
  return {
    id: over.id ?? `a${++seq}`, title: 'S', client: 'c1', technician: 't1',
    startTime: start, endTime: endIso, isFixed: false, isBillable: true,
    type: 'client-session', status: 'scheduled',
    ...over,
  };
}
const at10 = (day: string) => `${day}T10:00:00`;

console.log('measurePattern — weekly single day');
{
  const m = measurePattern(['2026-06-01', '2026-06-08', '2026-06-15', '2026-06-22'].map(at10));
  check('four Mondays a week apart → weekly', m.pattern === 'weekly', m.pattern);
}

console.log('measurePattern — measured gaps beat a wrong label');
{
  const m = measurePattern(['2026-06-01', '2026-06-15', '2026-06-29'].map(at10), 'weekly');
  check("14-day gaps labeled 'weekly' → biweekly", m.pattern === 'biweekly', m.pattern);
}

console.log('measurePattern — monthly same-date');
{
  const m = measurePattern(['2026-01-15', '2026-02-15', '2026-03-15', '2026-04-15'].map(at10));
  check('15th of each month → monthly', m.pattern === 'monthly', m.pattern);
  check("flavor is 'same-date'", m.monthlyFlavor === 'same-date', String(m.monthlyFlavor));
}

console.log('measurePattern — monthly first Tuesday');
{
  // First Tuesdays of Jan–Apr 2026: Jan 6, Feb 3, Mar 3, Apr 7.
  const m = measurePattern(['2026-01-06', '2026-02-03', '2026-03-03', '2026-04-07'].map(at10));
  check('first-Tuesday dates → monthly', m.pattern === 'monthly', m.pattern);
  check("flavor 'nth-weekday' with nth=1", m.monthlyFlavor === 'nth-weekday' && m.nth === 1, `${m.monthlyFlavor}/${m.nth}`);
}

console.log('measurePattern — monthly last Friday');
{
  // Last Fridays of Jan–Apr 2026: Jan 30 (5th Fri), Feb 27 (4th), Mar 27 (4th), Apr 24 (4th).
  const m = measurePattern(['2026-01-30', '2026-02-27', '2026-03-27', '2026-04-24'].map(at10));
  check('last-Friday dates → monthly', m.pattern === 'monthly', m.pattern);
  check("flavor 'nth-weekday' with nth='last'", m.monthlyFlavor === 'nth-weekday' && m.nth === 'last', `${m.monthlyFlavor}/${m.nth}`);
}

console.log('measurePattern — custom weekday set (M–F)');
{
  const days = ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05',
    '2026-06-08', '2026-06-09', '2026-06-10', '2026-06-11', '2026-06-12'];
  const m = measurePattern(days.map(at10));
  check('two M–F weeks → custom', m.pattern === 'custom', m.pattern);
}

console.log('measurePattern — too few gaps falls back to the label');
{
  check('single date + monthly hint → monthly', measurePattern([at10('2026-06-01')], 'monthly').pattern === 'monthly');
  check('single date, no hint → weekly', measurePattern([at10('2026-06-01')]).pattern === 'weekly');
  check('two dates (one gap) + custom hint → custom', measurePattern([at10('2026-06-01'), at10('2026-06-15')], 'custom').pattern === 'custom');
}

console.log('measurePattern — tolerates one missing occurrence');
{
  const m = measurePattern(['2026-06-01', '2026-06-08', '2026-06-22', '2026-06-29'].map(at10));
  check('weekly with one skipped week (7,14,7) → weekly', m.pattern === 'weekly', m.pattern);
}

console.log('seriesProfileOf');
{
  const rows = [
    appt(at10('2026-06-01'), { id: 'p1', seriesId: 'S' }),
    appt(at10('2026-06-15'), { id: 'p2', seriesId: 'S' }),
    appt(at10('2026-06-29'), { id: 'p3', seriesId: 'S', status: 'completed' }),
    appt(at10('2026-06-03'), { id: 'other' }),
  ];
  const p = seriesProfileOf(rows, 'S')!;
  check('profile exists for a live series', !!p);
  check('pattern measured biweekly', p.pattern === 'biweekly', p.pattern);
  check('anchor = earliest, horizon = latest member start', p.anchor === at10('2026-06-01') && p.horizon === at10('2026-06-29'));
  check('memberIds has all 3; pendingMemberIds excludes the completed one',
    p.memberIds.length === 3 && p.pendingMemberIds.length === 2 && !p.pendingMemberIds.includes('p3'));
  check('one slot (Mon 10:00)', p.slots.length === 1 && p.slots[0].weekday === 1 && p.slots[0].clock === '10:00');
  check('unknown seriesId → null', seriesProfileOf(rows, 'nope') === null);
}

console.log('seriesProfileOf — custom weekday set');
{
  const rows = ['2026-06-01', '2026-06-03', '2026-06-05', '2026-06-08', '2026-06-10', '2026-06-12']
    .map((d, i) => appt(at10(d), { id: `m${i}`, seriesId: 'MWF' }));
  const p = seriesProfileOf(rows, 'MWF')!;
  check('M/W/F series measures custom', p.pattern === 'custom', p.pattern);
  check('weekdays are [1,3,5]', JSON.stringify(p.weekdays) === '[1,3,5]', JSON.stringify(p.weekdays));
  check('three slots', p.slots.length === 3);
}

console.log('normalizeRecurrenceFields — lone recurring flag cleared');
{
  const rows = [appt(at10('2026-06-01'), { id: 'x', isRecurring: true, recurringPattern: 'weekly' })];
  const { appointments, changedIds } = normalizeRecurrenceFields(rows);
  const x = appointments.find(a => a.id === 'x')!;
  check('flag + pattern cleared', !x.isRecurring && x.recurringPattern === undefined);
  check('reported changed', changedIds.includes('x'));
}

console.log('normalizeRecurrenceFields — multi-member series gains flags + MEASURED pattern');
{
  // Three rows 14 days apart sharing a seriesId with NO flags at all (half-state B).
  const rows = ['2026-06-01', '2026-06-15', '2026-06-29'].map((d, i) => appt(at10(d), { id: `b${i}`, seriesId: 'S' }));
  const { appointments, changedIds } = normalizeRecurrenceFields(rows);
  check('all members flagged recurring', appointments.every(a => a.isRecurring === true));
  check('pattern is MEASURED biweekly (not defaulted weekly)', appointments.every(a => a.recurringPattern === 'biweekly'),
    appointments.map(a => a.recurringPattern).join(','));
  check('all three reported changed', changedIds.length === 3);
}

console.log('normalizeRecurrenceFields — singleton series collapses to one-time');
{
  const rows = [appt(at10('2026-06-01'), { id: 's1', seriesId: 'LONE', isRecurring: true, recurringPattern: 'weekly' })];
  const { appointments } = normalizeRecurrenceFields(rows);
  const s = appointments.find(a => a.id === 's1')!;
  check('trio fully cleared', !s.seriesId && !s.isRecurring && s.recurringPattern === undefined);
}

console.log('normalizeRecurrenceFields — pending make-up is always a one-off');
{
  const rows = [
    appt(at10('2026-06-01'), { id: 'mk', isMakeUp: true, makeupForId: 'gone', seriesId: 'S', isRecurring: true, recurringPattern: 'weekly' }),
    appt(at10('2026-06-08'), { id: 'sib', seriesId: 'S' }),
    appt(at10('2026-06-15'), { id: 'sib2', seriesId: 'S' }),
  ];
  const { appointments } = normalizeRecurrenceFields(rows);
  const mk = appointments.find(a => a.id === 'mk')!;
  check('make-up trio cleared even inside a series', !mk.seriesId && !mk.isRecurring && mk.recurringPattern === undefined);
  check('make-up linkage preserved', mk.isMakeUp === true && mk.makeupForId === 'gone');
}

console.log('normalizeRecurrenceFields — records of fact are untouched (identity)');
{
  const fact1 = appt(at10('2026-06-01'), { id: 'f1', status: 'completed', isRecurring: true }); // lone flag, but a fact
  const fact2 = appt(at10('2026-06-08'), { id: 'f2', status: 'canceled', seriesId: 'GONE' });   // singleton series, but a fact
  const fact3 = appt(at10('2026-06-01'), { id: 'f3', status: 'completed', seriesId: 'S' });     // fact inside a live series
  const pend = appt(at10('2026-06-08'), { id: 'p', seriesId: 'S' });
  const pend2 = appt(at10('2026-06-15'), { id: 'p2', seriesId: 'S' });
  const { appointments, changedIds } = normalizeRecurrenceFields([fact1, fact2, fact3, pend, pend2]);
  check('facts returned by identity (===)',
    appointments.includes(fact1) && appointments.includes(fact2) && appointments.includes(fact3));
  check('facts never in changedIds', !changedIds.some(id => ['f1', 'f2', 'f3'].includes(id)));
  check('pending sibling still healed', appointments.find(a => a.id === 'p')!.isRecurring === true);
}

console.log('normalizeRecurrenceFields — idempotent');
{
  const rows = [
    appt(at10('2026-06-01'), { id: 'n1', seriesId: 'S' }),
    appt(at10('2026-06-08'), { id: 'n2', seriesId: 'S' }),
    appt(at10('2026-06-10'), { id: 'n3', isRecurring: true }),
    appt(at10('2026-06-11'), { id: 'n4' }),
  ];
  const first = normalizeRecurrenceFields(rows);
  const second = normalizeRecurrenceFields(first.appointments);
  check('second pass changes nothing', second.changedIds.length === 0, second.changedIds.join(','));
  check('second pass returns every row by identity', second.appointments.every((a, i) => a === first.appointments[i]));
  check('already-clean row untouched on the first pass too',
    first.appointments.find(a => a.id === 'n4') === rows[3]);
}

console.log(`\n${failed === 0 ? 'ALL PASS' : 'FAILURES'} — ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
