/**
 * Verification for real series-edit semantics (seriesEdit.ts) and the extracted
 * creation materializer (seriesMaterialize.ts).
 *
 * buildSeriesEdit: day-delta shifts (a day move MOVES the future occurrences,
 * not a silent no-op), cadence re-materialization (id-stable moves + adds +
 * removes on the new grid), truncate/collapse for "One-time" on a series
 * member, facts never touched, results normalize-stable.
 * Run: npx tsx scripts/verify-series-edit.ts
 */
import { Appointment, DayOfWeek } from '../src/types';
import { buildSeriesEdit, summarizeSeriesEdit } from '../src/seriesEdit';
import { materializeSeries } from '../src/seriesMaterialize';
import { normalizeRecurrenceFields } from '../src/seriesProfile';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}

let seq = 0;
function appt(day: string, clock: string, over: Partial<Appointment> = {}): Appointment {
  const [h, m] = clock.split(':').map(Number);
  const endClock = `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return {
    id: over.id ?? `a${++seq}`, title: 'Session', client: 'c1', technician: 't1',
    startTime: `${day}T${clock}:00`, endTime: `${day}T${endClock}:00`,
    isFixed: false, isBillable: true, type: 'client-session', status: 'scheduled',
    isRecurring: true, recurringPattern: 'weekly', seriesId: 'S',
    ...over,
  };
}
const dayOf = (a: Appointment | undefined) => a?.startTime.slice(0, 10) ?? '?';
const clockOf = (a: Appointment | undefined) => a?.startTime.slice(11, 16) ?? '?';

// A weekly Monday 10:00 series: one completed fact + five pending occurrences.
function weeklySeries(): Appointment[] {
  return [
    appt('2026-06-01', '10:00', { id: 'f1', status: 'completed' }),
    appt('2026-06-08', '10:00', { id: 'p1' }),
    appt('2026-06-15', '10:00', { id: 'p2' }),
    appt('2026-06-22', '10:00', { id: 'p3' }),
    appt('2026-06-29', '10:00', { id: 'p4' }),
    appt('2026-07-06', '10:00', { id: 'p5' }),
  ];
}
// Apply a result to a working set (upserts replace by id, removes drop).
function applyResult(all: Appointment[], r: { upserts: Appointment[]; removeIds: string[] }): Appointment[] {
  const byId = new Map(all.map(a => [a.id, a]));
  for (const u of r.upserts) byId.set(u.id, u);
  for (const id of r.removeIds) byId.delete(id);
  return [...byId.values()];
}

console.log('day shift — This+Following moves every pending target by the delta');
{
  const all = weeklySeries();
  const original = all.find(a => a.id === 'p2')!; // Mon Jun 15
  const edited = appt('2026-06-17', '10:00', { id: 'p2' }); // → Wed Jun 17 (+2 days)
  const r = buildSeriesEdit({ all, original, edited, scope: 'following', cadence: null });
  const up = (id: string) => r.upserts.find(u => u.id === id);
  check('edited occurrence itself lands on its new date', dayOf(up('p2')) === '2026-06-17', dayOf(up('p2')));
  check('day-only change is NOT a no-op (4 targets move)', r.upserts.filter(u => ['p2', 'p3', 'p4', 'p5'].includes(u.id)).length === 4);
  check('each future target shifts by the same +2 days',
    dayOf(up('p3')) === '2026-06-24' && dayOf(up('p4')) === '2026-07-01' && dayOf(up('p5')) === '2026-07-08',
    [dayOf(up('p3')), dayOf(up('p4')), dayOf(up('p5'))].join(','));
  check('earlier pending sibling untouched under following', !up('p1'));
  check('no removals on a pure shift', r.removeIds.length === 0);
  check('following cutoff is the ORIGINAL start (edited row included)', !!up('p2'));
}

console.log('day shift — All in Series spares completed/canceled facts');
{
  const all = weeklySeries();
  all.push(appt('2026-06-10', '10:00', { id: 'fx', status: 'canceled' }));
  const original = all.find(a => a.id === 'p2')!;
  const edited = appt('2026-06-17', '10:00', { id: 'p2' });
  const r = buildSeriesEdit({ all, original, edited, scope: 'all', cadence: null });
  check('every pending member moves (incl. earlier p1)', ['p1', 'p2', 'p3', 'p4', 'p5'].every(id => r.upserts.some(u => u.id === id)));
  check('p1 shifted to Wed Jun 10', dayOf(r.upserts.find(u => u.id === 'p1')) === '2026-06-10');
  check('facts never appear in upserts', !r.upserts.some(u => u.id === 'f1' || u.id === 'fx'));
  check('facts never appear in removeIds', !r.removeIds.includes('f1') && !r.removeIds.includes('fx'));
}

console.log('time-only change — each occurrence keeps its own date (pin)');
{
  const all = weeklySeries();
  const original = all.find(a => a.id === 'p2')!;
  const edited = appt('2026-06-15', '13:00', { id: 'p2' }); // same date, 10:00 → 13:00
  const r = buildSeriesEdit({ all, original, edited, scope: 'following', cadence: null });
  check('dates preserved, clock updated on every target',
    r.upserts.filter(u => ['p2', 'p3', 'p4', 'p5'].includes(u.id))
      .every(u => clockOf(u) === '13:00')
    && dayOf(r.upserts.find(u => u.id === 'p3')) === '2026-06-22');
}

console.log('duration change propagates');
{
  const all = weeklySeries();
  const original = all.find(a => a.id === 'p2')!;
  const edited = { ...appt('2026-06-15', '10:00', { id: 'p2' }), endTime: '2026-06-15T12:00:00' }; // 1h → 2h
  const r = buildSeriesEdit({ all, original, edited, scope: 'following', cadence: null });
  check('every target gets the 2h duration',
    r.upserts.filter(u => ['p2', 'p3', 'p4', 'p5'].includes(u.id))
      .every(u => new Date(u.endTime).getTime() - new Date(u.startTime).getTime() === 2 * 3600_000));
}

console.log('cadence weekly → biweekly (following) re-materializes the 14-day grid');
{
  const all = weeklySeries();
  const original = all.find(a => a.id === 'p1')!; // Mon Jun 8, first pending
  const edited = appt('2026-06-08', '10:00', { id: 'p1' });
  const r = buildSeriesEdit({ all, original, edited, scope: 'following', cadence: { pattern: 'biweekly' } });
  // Grid from Jun 8 to the Jul 6 horizon: Jun 8, Jun 22, Jul 6 — 5 rows → 3 kept, 2 removed.
  const kept = r.upserts.filter(u => ['p1', 'p2', 'p3', 'p4', 'p5'].includes(u.id));
  const keptDays = kept.map(dayOf).sort();
  check('kept rows land on the 14-day grid', JSON.stringify([...new Set(keptDays)].sort()) === JSON.stringify(['2026-06-22', '2026-07-06']) || keptDays.includes('2026-06-08'),
    keptDays.join(','));
  const projected = applyResult(all, r);
  const pendingDays = projected.filter(a => a.seriesId === 'S' && a.status === 'scheduled').map(a => a.startTime.slice(0, 10)).sort();
  check('projected pending series is exactly the biweekly grid',
    JSON.stringify(pendingDays) === JSON.stringify(['2026-06-08', '2026-06-22', '2026-07-06']), pendingDays.join(','));
  check('two surplus rows removed', r.removeIds.length === 2, String(r.removeIds.length));
  check('no adds needed (grid smaller than row count)', !r.upserts.some(u => !all.some(a => a.id === u.id)));
  check('kept rows carry the biweekly trio', kept.every(u => u.isRecurring === true && u.recurringPattern === 'biweekly' && u.seriesId === 'S'),
    kept.map(u => u.recurringPattern).join(','));
}

console.log('cadence weekly → custom M/W/F (following) adds the new weekday occurrences');
{
  const all = [
    appt('2026-06-01', '10:00', { id: 'q1' }),
    appt('2026-06-08', '10:00', { id: 'q2' }),
    appt('2026-06-15', '10:00', { id: 'q3' }),
  ];
  const original = all.find(a => a.id === 'q1')!;
  const edited = appt('2026-06-01', '10:00', { id: 'q1' });
  const r = buildSeriesEdit({ all, original, edited, scope: 'following', cadence: { pattern: 'custom', weekdays: [1, 3, 5] } });
  const projected = applyResult(all, r);
  const days = projected.filter(a => a.seriesId === 'S').map(a => a.startTime.slice(0, 10)).sort();
  // M/W/F from Jun 1 through the Jun 15 horizon: 1,3,5,8,10,12,15.
  check('projected series covers every M/W/F date in the span',
    JSON.stringify(days) === JSON.stringify(['2026-06-01', '2026-06-03', '2026-06-05', '2026-06-08', '2026-06-10', '2026-06-12', '2026-06-15']),
    days.join(','));
  const adds = r.upserts.filter(u => !all.some(a => a.id === u.id));
  check('new weekday occurrences are ADDS under the SAME seriesId',
    adds.length === 4 && adds.every(u => u.seriesId === 'S'), String(adds.length));
  check('everything carries the typed custom trio',
    r.upserts.every(u => u.isRecurring === true && u.recurringPattern === 'custom'));
}

console.log('re-materialization never touches facts');
{
  const all = weeklySeries(); // f1 completed Jun 1
  const f1 = all.find(a => a.id === 'f1')!;
  // Grid anchored Jun 8 biweekly under ALL scope — facts stay put regardless.
  const original = all.find(a => a.id === 'p1')!;
  const edited = appt('2026-06-08', '10:00', { id: 'p1' });
  const r = buildSeriesEdit({ all, original, edited, scope: 'all', cadence: { pattern: 'biweekly' } });
  check('completed fact not in upserts or removes', !r.upserts.some(u => u.id === 'f1') && !r.removeIds.includes('f1'));
  const projected = applyResult(all, r);
  check('fact object survives by identity', projected.includes(f1));
}

console.log("cadence 'none' (following) truncates the series after the edited occurrence");
{
  const all = weeklySeries();
  const original = all.find(a => a.id === 'p2')!; // Jun 15
  const edited = appt('2026-06-15', '10:00', { id: 'p2' });
  const r = buildSeriesEdit({ all, original, edited, scope: 'following', cadence: 'none' });
  check('strictly-later pendings removed', JSON.stringify([...r.removeIds].sort()) === JSON.stringify(['p3', 'p4', 'p5']), r.removeIds.join(','));
  check('edited row kept', r.upserts.some(u => u.id === 'p2'));
  check('earlier sibling + fact spared', !r.removeIds.includes('p1') && !r.removeIds.includes('f1'));
  const projected = applyResult(all, r);
  const members = projected.filter(a => a.seriesId === 'S');
  check('remaining series still coherent (f1, p1, p2 stay members)', members.length === 3);
}

console.log("cadence 'none' (all) collapses to a single one-time, sparing facts");
{
  const all = weeklySeries();
  const original = all.find(a => a.id === 'p2')!;
  const edited = appt('2026-06-15', '10:00', { id: 'p2' });
  const r = buildSeriesEdit({ all, original, edited, scope: 'all', cadence: 'none' });
  check('every OTHER pending removed', JSON.stringify([...r.removeIds].sort()) === JSON.stringify(['p1', 'p3', 'p4', 'p5']), r.removeIds.join(','));
  const p2 = r.upserts.find(u => u.id === 'p2')!;
  check('edited becomes an honest one-time (trio cleared)', !!p2 && !p2.seriesId && !p2.isRecurring && p2.recurringPattern === undefined);
  check('facts keep their seriesId', !r.removeIds.includes('f1') && !r.upserts.some(u => u.id === 'f1'));
}

console.log('results are normalize-stable (the trio invariant holds after applying)');
{
  const all = weeklySeries();
  const original = all.find(a => a.id === 'p2')!;
  const shift = buildSeriesEdit({ all, original, edited: appt('2026-06-17', '10:00', { id: 'p2' }), scope: 'following', cadence: null });
  const n1 = normalizeRecurrenceFields(applyResult(all, shift));
  check('day-shift result is normalize-stable', n1.changedIds.length === 0, n1.changedIds.join(','));
  const respace = buildSeriesEdit({ all, original: all.find(a => a.id === 'p1')!, edited: appt('2026-06-08', '10:00', { id: 'p1' }), scope: 'following', cadence: { pattern: 'biweekly' } });
  const n2 = normalizeRecurrenceFields(applyResult(all, respace));
  check('re-space result is normalize-stable', n2.changedIds.length === 0, n2.changedIds.join(','));
  const collapse = buildSeriesEdit({ all, original, edited: appt('2026-06-15', '10:00', { id: 'p2' }), scope: 'all', cadence: 'none' });
  const n3 = normalizeRecurrenceFields(applyResult(all, collapse));
  check('collapse result is normalize-stable', n3.changedIds.length === 0, n3.changedIds.join(','));
}

console.log('a pending make-up sibling is never targeted and gets healed to one-off');
{
  const all = weeklySeries();
  all.push(appt('2026-06-18', '10:00', { id: 'mk', isMakeUp: true, makeupForId: 'gone' }));
  const original = all.find(a => a.id === 'p2')!;
  const edited = appt('2026-06-17', '10:00', { id: 'p2' });
  const r = buildSeriesEdit({ all, original, edited, scope: 'all', cadence: null });
  check('make-up not shifted with the series', !r.upserts.some(u => u.id === 'mk' && dayOf(u) !== '2026-06-18'));
  const mk = r.upserts.find(u => u.id === 'mk');
  check('make-up healed: seriesId dropped (one-off), linkage kept',
    !!mk && !mk.seriesId && mk.isMakeUp === true && mk.makeupForId === 'gone');
}

console.log('summaries — the live preview strings');
{
  const all = weeklySeries();
  const original = all.find(a => a.id === 'p2')!;
  const truncate = buildSeriesEdit({ all, original, edited: appt('2026-06-15', '10:00', { id: 'p2' }), scope: 'following', cadence: 'none' });
  check('truncate summary counts the removals', summarizeSeriesEdit(truncate).includes('3'), summarizeSeriesEdit(truncate));
  const respace = buildSeriesEdit({ all, original: all.find(a => a.id === 'p1')!, edited: appt('2026-06-08', '10:00', { id: 'p1' }), scope: 'following', cadence: { pattern: 'biweekly' } });
  const rs = summarizeSeriesEdit(respace);
  check('re-space summary mentions the cadence and removal count', /every other week/i.test(rs) && rs.includes('2'), rs);
  const shift = buildSeriesEdit({ all, original, edited: appt('2026-06-17', '10:00', { id: 'p2' }), scope: 'following', cadence: null });
  const sh = summarizeSeriesEdit(shift);
  check('day-shift summary names the new weekday', /wednesday/i.test(sh), sh);
}

console.log('materializeSeries — one-time → weekly conversion mints a real series');
{
  const base = appt('2026-06-01', '10:00', { id: 'orig', seriesId: undefined, isRecurring: undefined, recurringPattern: undefined });
  const out = materializeSeries({ base, recurrence: 'weekly', recurrenceEnd: '2026-06-29' });
  check('five weekly occurrences', out.length === 5, String(out.length));
  check('converted row keeps its id', out[0].id === 'orig');
  const sid = out[0].seriesId;
  check('all occurrences share ONE minted seriesId + full trio',
    !!sid && out.every(o => o.seriesId === sid && o.isRecurring === true && o.recurringPattern === 'weekly'));
}

console.log('materializeSeries — custom days carry the typed custom pattern');
{
  const base = appt('2026-06-01', '10:00', { id: 'cd', seriesId: undefined, isRecurring: undefined, recurringPattern: undefined });
  const out = materializeSeries({
    base, recurrence: 'custom-days',
    selectedDays: ['Monday', 'Wednesday'] as DayOfWeek[],
    recurrenceEnd: '2026-06-10',
  });
  const days = out.map(o => o.startTime.slice(0, 10)).sort();
  check('Mon+Wed occurrences in the span', JSON.stringify(days) === JSON.stringify(['2026-06-01', '2026-06-03', '2026-06-08', '2026-06-10']), days.join(','));
  check("typed 'custom' pattern (no as-any)", out.every(o => o.recurringPattern === 'custom'));
}

console.log('materializeSeries — horizon: recurrenceEnd → authEnd → +90d');
{
  const base = appt('2026-06-01', '10:00', { id: 'h', seriesId: undefined, isRecurring: undefined, recurringPattern: undefined });
  const viaAuth = materializeSeries({ base, recurrence: 'weekly', authEnd: '2026-06-15' });
  check('auth end bounds the series when no explicit end', viaAuth.length === 3, String(viaAuth.length));
  const via90 = materializeSeries({ base, recurrence: 'weekly' });
  check('90-day fallback with no auth (13–14 weekly occurrences)', via90.length >= 13 && via90.length <= 14, String(via90.length));
  const explicit = materializeSeries({ base, recurrence: 'weekly', recurrenceEnd: '2026-06-08', authEnd: '2026-08-01' });
  check('explicit recurrence end wins over auth', explicit.length === 2, String(explicit.length));
}

console.log(`\n${failed === 0 ? 'ALL PASS' : 'FAILURES'} — ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
