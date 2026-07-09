/**
 * Verification for the Tidy / Doctor pass — the equivalence oracle and every rule.
 *
 * The oracle (src/tidyEquivalence.ts) is the load-bearing guard: it must PASS a
 * behavior-preserving edit and FAIL any edit that changes direct hours, credit,
 * coverage, or records of fact. The rules (src/tidy.ts) must only auto-apply
 * oracle-equivalent ops and route the rest to review.
 *
 * Run: npx tsx scripts/verify-tidy.ts
 */
import { ScheduleData, Appointment } from '../src/types';
import { checkEquivalence } from '../src/tidyEquivalence';
import { analyzeTidy, defaultTidyConfig } from '../src/tidy';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}

let seq = 0;
function appt(p: Partial<Appointment> & { type: Appointment['type']; date: string; start: string; end: string }): Appointment {
  return {
    id: p.id ?? `a${++seq}`, title: p.title ?? p.type, technician: p.technician, client: p.client,
    startTime: `${p.date}T${p.start}:00`, endTime: `${p.date}T${p.end}:00`,
    isFixed: p.isFixed ?? false, isBillable: p.isBillable !== false, type: p.type, status: p.status,
    isMakeUp: p.isMakeUp, makeupForId: p.makeupForId, isRecurring: p.isRecurring,
    recurringPattern: p.recurringPattern, seriesId: p.seriesId, isGhost: p.isGhost, cancellation: p.cancellation,
  };
}

function mkData(appts: Appointment[]): ScheduleData {
  return {
    id: 'd', version: 2,
    clients: [{ id: 'C1', name: 'C1', availabilityWindows: {} }, { id: 'C2', name: 'C2', availabilityWindows: {} }],
    technicians: [
      { id: 'T1', name: 'T1', isRBT: true, assignments: [], availability: {} },
      { id: 'T2', name: 'T2', isRBT: true, assignments: [], availability: {} },
    ],
    settings: { supervisionDirectHoursPercent: 10, supervisionRBTHoursPercent: 10 },
    appointments: appts,
    lastModified: '2026-06-01T00:00:00',
  };
}

const D = '2026-06-15';
const direct = (start: string, end: string, over: Partial<Appointment> = {}) =>
  appt({ type: 'client-session', client: 'C1', technician: 'T1', date: D, start, end, ...over });

// ── Oracle: the load-bearing guard ──────────────────────────────────────────
console.log('oracle — passes behavior-preserving edits');
{
  const now = new Date(2026, 5, 1); // Jun 1 — everything in June is future/projected

  // Identity.
  const base = mkData([direct('10:00', '12:00'), direct('13:00', '15:00')]);
  check('identical schedules are equivalent', checkEquivalence(base, base, now).equivalent);

  // Merge two exactly-contiguous fragments into one (same client/tech/type).
  const before = mkData([direct('10:00', '11:00', { id: 'f1' }), direct('11:00', '12:00', { id: 'f2' })]);
  const after = mkData([direct('10:00', '12:00', { id: 'f1' })]);
  check('merging contiguous fragments is equivalent', checkEquivalence(before, after, now).equivalent);

  // Merge additivity of supervision credit across the seam (sup straddles 11:00).
  const beforeSup = mkData([
    direct('10:00', '11:00', { id: 'f1' }), direct('11:00', '12:00', { id: 'f2' }),
    appt({ type: 'supervision', client: 'C1', date: D, start: '10:30', end: '11:30' }),
  ]);
  const afterSup = mkData([
    direct('10:00', '12:00', { id: 'f1' }),
    appt({ type: 'supervision', client: 'C1', date: D, start: '10:30', end: '11:30' }),
  ]);
  check('credit survives merge across a straddling supervision (additivity)', checkEquivalence(beforeSup, afterSup, now).equivalent);

  // Recurring grouping: same rows, seriesId stamped on → equivalent.
  const plain = mkData([direct('10:00', '12:00', { id: 'g1' })]);
  const grouped = mkData([direct('10:00', '12:00', { id: 'g1', seriesId: 's1', recurringPattern: 'weekly' })]);
  check('stamping a seriesId is equivalent', checkEquivalence(plain, grouped, now).equivalent);
}

console.log('oracle — fails semantic changes');
{
  const now = new Date(2026, 5, 1);

  // Drop the technician on a direct → tech credit + bt/bcba bucket both change.
  const beforeT = mkData([direct('10:00', '12:00', { id: 'x' })]);
  const afterT = mkData([direct('10:00', '12:00', { id: 'x', technician: undefined })]);
  check('dropping a technician is NOT equivalent', !checkEquivalence(beforeT, afterT, now).equivalent);

  // Merge across a real gap → inflates direct hours.
  const beforeG = mkData([direct('10:00', '11:00', { id: 'f1' }), direct('12:00', '13:00', { id: 'f2' })]);
  const afterG = mkData([direct('10:00', '13:00', { id: 'f1' })]);
  check('merging across a gap is NOT equivalent', !checkEquivalence(beforeG, afterG, now).equivalent);

  // Remove an exact duplicate → drops double-counted direct hours. The COMPLIANCE
  // arm catches it; the COVERAGE arm alone would not (union unchanged). Proves both
  // arms are load-bearing.
  const beforeD = mkData([direct('10:00', '12:00', { id: 'd1' }), direct('10:00', '12:00', { id: 'd2' })]);
  const afterD = mkData([direct('10:00', '12:00', { id: 'd1' })]);
  const dupReport = checkEquivalence(beforeD, afterD, now);
  const dupKinds = new Set(dupReport.diffs.map(d => d.kind));
  check('removing a duplicate is NOT equivalent', !dupReport.equivalent);
  check('duplicate removal is caught by compliance, not coverage', dupKinds.has('client-compliance') && !dupKinds.has('coverage'));
}

console.log('oracle — actual/projected split (straddling now)');
{
  // now falls between the two fragments\' starts: merging pulls the future half into
  // the "actual" (already-happened) roll.
  const now = new Date('2026-06-15T10:30:00');
  const before = mkData([direct('10:00', '11:00', { id: 'f1' }), direct('11:00', '12:00', { id: 'f2' })]);
  const after = mkData([direct('10:00', '12:00', { id: 'f1' })]);
  check('a merge that straddles `now` is NOT equivalent', !checkEquivalence(before, after, now).equivalent);
}

// ── Rules: analyzeTidy routing ──────────────────────────────────────────────
console.log('tidy — auto rules (equivalent, staged by default)');
{
  const now = new Date(2026, 5, 1);
  const r = analyzeTidy(
    mkData([
      direct('10:00', '11:00', { id: 'f1' }), direct('11:00', '12:00', { id: 'f2' }), // merge → one
      direct('14:00', '14:00', { id: 'z' }),                                           // degenerate → remove
      direct('16:00', '18:00', { id: 'ok' }),                                          // clean, untouched
    ]),
    defaultTidyConfig(), now,
  );
  check('auto set is oracle-equivalent', r.equivalence.equivalent);
  check('merge emitted (move + remove)', r.auto.ops.some(o => o.op === 'move') && r.auto.ops.some(o => o.op === 'remove'));
  check('degenerate zero-length row removed', r.auto.ops.some(o => o.op === 'remove' && o.appointmentId === 'z'));
  check('clean session left alone', !r.auto.ops.some(o => (o as any).appointmentId === 'ok'));
}

console.log('tidy — a contiguous orphan folds into a series occurrence (the JO/Toniel case)');
{
  const now = new Date(2026, 5, 1);
  // A recurring series occurrence, and a series-less standalone that exactly abuts it —
  // same client/tech/type. Pre-fix these never grouped (seriesId was in the identity key).
  const serRow = direct('15:30', '17:30', { id: 'ser', seriesId: 's1', isRecurring: true, recurringPattern: 'weekly' });
  const orphanRow = direct('17:30', '18:30', { id: 'orphan' });
  const r = analyzeTidy(mkData([serRow, orphanRow]), defaultTidyConfig(), now);
  const moveOp = r.auto.ops.find(o => o.op === 'move') as any;
  check('orphan+series merge is oracle-equivalent (auto)', r.equivalence.equivalent);
  check('survivor is the series row, extended to the orphan end',
    !!moveOp && moveOp.appointmentId === 'ser' && moveOp.start === serRow.startTime && moveOp.end === orphanRow.endTime);
  check('orphan removed, series row kept',
    r.auto.ops.some(o => o.op === 'remove' && (o as any).appointmentId === 'orphan') &&
    !r.auto.ops.some(o => o.op === 'remove' && (o as any).appointmentId === 'ser'));
}

console.log('tidy — two DIFFERENT direct series never combine');
{
  const now = new Date(2026, 5, 1);
  const r = analyzeTidy(mkData([
    direct('15:30', '17:30', { id: 'a', seriesId: 's1', isRecurring: true }),
    direct('17:30', '18:30', { id: 'b', seriesId: 's2', isRecurring: true }),
  ]), defaultTidyConfig(), now);
  check('directs: no merge across two distinct series', !r.auto.ops.some(o => o.op === 'move' || o.op === 'remove'));
}

console.log('tidy — adjacent BCBA supervision fragments in DIFFERENT series combine (the EC/Hannah case)');
{
  const now = new Date(2026, 5, 1);
  // Two supervision occurrences for the same client + BT that meet exactly at 09:00
  // but carry different seriesIds (accumulated across repeated builds). seriesId is
  // internal — they must fuse into one 08:45–09:15 session, dropping the redundant
  // orphan, and the survivor must stay in the LARGER series (its other dates untouched).
  const big = appt({ type: 'supervision', client: 'C1', technician: 'T1', date: D, start: '08:45', end: '09:00', id: 'sup-a', seriesId: 's1', isRecurring: true, recurringPattern: 'weekly' });
  const bigTwin = appt({ type: 'supervision', client: 'C1', technician: 'T1', date: '2026-06-22', start: '08:45', end: '09:00', id: 'sup-a2', seriesId: 's1', isRecurring: true, recurringPattern: 'weekly' }); // 2nd occ → s1 is the bigger series
  const orphan = appt({ type: 'supervision', client: 'C1', technician: 'T1', date: D, start: '09:00', end: '09:15', id: 'sup-b', seriesId: 's2', isRecurring: true, recurringPattern: 'weekly' });
  const r = analyzeTidy(mkData([big, bigTwin, orphan]), defaultTidyConfig(), now);
  const moveOp = r.auto.ops.find(o => o.op === 'move') as any;
  check('cross-series BCBA merge is oracle-equivalent (auto)', r.equivalence.equivalent);
  check('fragments fuse into one 08:45–09:15 session on the survivor',
    !!moveOp && moveOp.appointmentId === 'sup-a' && moveOp.start === big.startTime && moveOp.end === orphan.endTime);
  check('the redundant orphan (smaller series) is dropped, larger series kept',
    r.auto.ops.some(o => o.op === 'remove' && (o as any).appointmentId === 'sup-b') &&
    !r.auto.ops.some(o => o.op === 'remove' && ((o as any).appointmentId === 'sup-a' || (o as any).appointmentId === 'sup-a2')));
}

console.log('tidy — overlapping BCBA supervision fragments coalesce, never silently ignored');
{
  const now = new Date(2026, 5, 1);
  // Two supervision rows for the same client + BT that genuinely OVERLAP. They must
  // be combined into their union span (10:00–11:15). Coalescing overlap drops the
  // double-scheduled minutes, so the oracle routes it to REVIEW (not auto) — the
  // point of the test is that it is acted on and NOT flagged as a double-book.
  const r = analyzeTidy(mkData([
    appt({ type: 'supervision', client: 'C1', technician: 'T1', date: D, start: '10:00', end: '10:45', id: 'ov1', seriesId: 's1', isRecurring: true }),
    appt({ type: 'supervision', client: 'C1', technician: 'T1', date: D, start: '10:30', end: '11:15', id: 'ov2', seriesId: 's2', isRecurring: true }),
  ]), defaultTidyConfig(), now);
  const mergeSug = r.suggestions.find(s => s.ruleId === 'merge');
  const moveOp = (mergeSug?.ops ?? r.auto.ops).find(o => o.op === 'move') as any;
  check('overlapping BCBA fragments are combined (auto or review), not ignored',
    r.auto.ops.some(o => o.op === 'move') || !!mergeSug);
  check('coalesced span covers the union 10:00–11:15',
    !!moveOp && moveOp.start.endsWith('10:00:00') && moveOp.end.endsWith('11:15:00'));
  check('overlapping same-case BCBA fragments are NOT flagged as an analyst double-book',
    !r.suggestions.some(s => s.ruleId === 'doubleBook' && s.rationale.startsWith('Double-book')));
}

console.log('tidy — cross-client BCBA overlap is still a real analyst double-book');
{
  const now = new Date(2026, 5, 1);
  const r = analyzeTidy(mkData([
    appt({ type: 'supervision', client: 'C1', technician: 'T1', date: D, start: '10:00', end: '11:00', id: 'x1', seriesId: 's1', isRecurring: true }),
    appt({ type: 'supervision', client: 'C2', technician: 'T2', date: D, start: '10:30', end: '11:30', id: 'x2', seriesId: 's2', isRecurring: true }),
  ]), defaultTidyConfig(), now);
  check('different-client BCBA overlap still flags a double-book',
    r.suggestions.some(s => s.ruleId === 'doubleBook' && s.rationale.startsWith('Double-book')));
  check('different-client BCBA sessions are NOT merged', !r.auto.ops.some(o => o.op === 'move' || o.op === 'remove'));
}

console.log('tidy — review rules (never auto)');
{
  const now = new Date(2026, 5, 1);
  // Exact duplicate → review (changes double-counted hours).
  const dup = analyzeTidy(mkData([direct('10:00', '12:00', { id: 'd1' }), direct('10:00', '12:00', { id: 'd2' })]), defaultTidyConfig(), now);
  check('duplicate is a suggestion, not auto', dup.auto.ops.length === 0 && dup.suggestions.some(s => s.ruleId === 'dedup'));
  check('duplicate suggestion carries a metric delta', dup.suggestions.some(s => s.ruleId === 'dedup' && !!s.metricDelta));

  // Weekly pattern (3 Mondays, same client/tech/time) → grouping suggestion.
  const weeklyData = mkData([
    appt({ type: 'client-session', client: 'C1', technician: 'T1', date: '2026-06-01', start: '10:00', end: '12:00', id: 'w1' }),
    appt({ type: 'client-session', client: 'C1', technician: 'T1', date: '2026-06-08', start: '10:00', end: '12:00', id: 'w2' }),
    appt({ type: 'client-session', client: 'C1', technician: 'T1', date: '2026-06-15', start: '10:00', end: '12:00', id: 'w3' }),
  ]);
  const grp = analyzeTidy(weeklyData, defaultTidyConfig(), new Date(2026, 4, 1));
  check('weekly pattern → grouping suggestion', grp.suggestions.some(s => s.ruleId === 'grouping' && s.ops.some(o => o.op === 'regroup')));
  check('grouping is not auto-applied', !grp.auto.ops.some(o => o.op === 'regroup'));
}

console.log('tidy — a duplicate elsewhere in a case does not block merging a clean run');
{
  const now = new Date(2026, 5, 1);
  const r = analyzeTidy(mkData([
    direct('10:00', '11:00', { id: 'm1' }), direct('11:00', '12:00', { id: 'm2' }), // contiguous → merge
    direct('13:00', '15:00', { id: 'p1' }), direct('13:00', '15:00', { id: 'p2' }), // identical → dedup (review)
  ]), defaultTidyConfig(), now);
  check('clean contiguous run still merges', r.auto.ops.some(o => o.op === 'move' && o.appointmentId === 'm1') && r.auto.ops.some(o => o.op === 'remove' && o.appointmentId === 'm2'));
  check('the duplicate pair is NOT auto-merged/removed', !r.auto.ops.some(o => o.op === 'remove' && (o.appointmentId === 'p1' || o.appointmentId === 'p2')));
  check('the duplicate surfaces as a review suggestion', r.suggestions.some(s => s.ruleId === 'dedup'));
  check('auto set stays equivalent', r.equivalence.equivalent);
}

console.log('tidy — double-book respects the concurrent-care service model');
{
  const now = new Date(2026, 5, 1);
  const dbFlags = (d: ScheduleData) => analyzeTidy(d, defaultTidyConfig(), now).suggestions.filter(s => s.ruleId === 'doubleBook' && s.rationale.startsWith('Double-book'));

  // A BT direct + the BCBA supervising THAT BT (same technician + client, overlapping
  // by design) is concurrent care — the core model — NOT a double-book.
  const sup = dbFlags(mkData([
    direct('10:00', '12:00', { id: 'd' }),
    appt({ type: 'supervision', client: 'C1', technician: 'T1', date: D, start: '10:30', end: '11:30' }),
  ]));
  check('direct + supervision overlap is NOT a double-book', sup.length === 0);

  // Same for parent-training that names the BT and overlaps the direct.
  const pt = dbFlags(mkData([
    direct('10:00', '12:00', { id: 'd' }),
    appt({ type: 'parent-training', client: 'C1', technician: 'T1', date: D, start: '11:00', end: '12:00' }),
  ]));
  check('direct + parent-training overlap is NOT a double-book', pt.length === 0);

  // A BT genuinely delivering two DIRECTS at once IS a real conflict.
  const realBt = dbFlags(mkData([
    direct('10:00', '12:00', { id: 'x', client: 'C1' }),
    appt({ type: 'client-session', client: 'C2', technician: 'T1', date: D, start: '11:00', end: '13:00' }),
  ]));
  check('BT delivering two overlapping directs IS a double-book', realBt.length === 1);

  // The single supervising analyst can't run two BCBA sessions at once.
  const twoBcba = dbFlags(mkData([
    appt({ type: 'supervision', client: 'C1', date: D, start: '10:00', end: '11:00' }),
    appt({ type: 'parent-training', client: 'C2', technician: 'T2', date: D, start: '10:30', end: '11:30' }),
  ]));
  check('two overlapping BCBA sessions ARE a double-book', twoBcba.length === 1);
}

console.log('tidy — idempotency');
{
  const now = new Date(2026, 5, 1);
  const clean = mkData([direct('10:00', '12:00', { id: 'a' }), direct('13:00', '15:00', { id: 'b' })]);
  const r = analyzeTidy(clean, defaultTidyConfig(), now);
  check('an already-tidy schedule yields zero auto ops', r.auto.ops.length === 0);
}

console.log(`\n${failed === 0 ? 'ALL PASS' : 'FAILURES'} — ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
