/**
 * Verification for the deterministic direct-schedule builder (Phase 1).
 * Run: npx tsx scripts/verify-builder.ts
 *
 * Guarantees pinned here:
 *   - Anti-double-book: a whole caseload placed in one pass never double-books a
 *     shared tech (the reason builderOccupancy exists). Cross-checked through the
 *     real solveDraft grader (movedIds === 0 → no reshuffle was needed).
 *   - MRV ordering: a constrained case isn't stranded by an easy one taking its
 *     only shared-tech window.
 *   - Materialized representation: direct ops are dated per-week rows (the backbone
 *     extends to the auth end); weekly-target checks read the template week only.
 *   - Infeasibility: an impossible case is FLAGGED with the right binding
 *     constraint, and everyone else is still placed (partial success).
 *   - Validity: the applied result introduces no new hard (error) conflicts.
 */
import { ScheduleData, Client, Technician, Authorization, CompanySettings, Appointment } from '../src/types';
import { buildSchedule, BuilderConfig, defaultBuilderConfig, formatBuildSummary } from '../src/scheduleBuilder';
import { wishSolutionToDraft } from '../src/wish';
import { applyOps } from '../src/draft';
import { solveDraft } from '../src/draftSolver';
import { ConstraintValidator } from '../src/constraintValidator';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}

const WEEK_START = '2026-07-06';           // a Monday
const NOW = new Date('2026-07-06T00:00:00'); // week is fully in the future
const HR = 3_600_000;

const SETTINGS: CompanySettings = {
  supervisionDirectHoursPercent: 15,
  supervisionRBTHoursPercent: 5,
  parentTraining: { minimumHours: 1, targetMinHours: 2, targetMaxHours: 4, periodUnit: 'month' },
} as CompanySettings;

function client(id: string, name: string, windows: Partial<Record<string, { start: string; end: string }[]>>): Client {
  return { id, name, availabilityWindows: windows as any };
}
function tech(id: string, name: string, avail: Partial<Record<string, { start: string; end: string }[]>>, assignments: Technician['assignments']): Technician {
  return { id, name, isRBT: true, availability: avail as any, assignments };
}
function auth(clientId: string, direct: number): Authorization {
  // Generous span bucket so the auth-bucket-overbooking check (a separate,
  // span-total rule) never fires — these tests isolate the builder's weekly
  // placement, not span budgeting.
  return { id: `au-${clientId}`, clientId, startDate: '2026-01-01', endDate: '2026-12-31', buckets: { direct: 10_000 }, weekly: { direct } };
}
function schedule(clients: Client[], technicians: Technician[], authorizations: Authorization[], appts: Appointment[] = []): ScheduleData {
  return {
    id: 'test', version: 2, clients, technicians, settings: SETTINGS,
    appointments: appts, authorizations, blackouts: [], timeOff: [], companyHolidays: [],
    manualUsage: [], confirmedConflicts: [], lastModified: '2026-07-01T00:00:00.000Z',
  };
}
function config(overrides?: BuilderConfig['clientOverrides']): BuilderConfig {
  return {
    weekStart: WEEK_START,
    monthHorizon: { start: WEEK_START, end: '2026-08-03' }, // 4 weeks
    bcbaWeeklyBillableTarget: 25, chaseDirect: true, clientOverrides: overrides,
  };
}

const hrsOf = (a: { startTime: string; endTime: string }) =>
  (new Date(a.endTime).getTime() - new Date(a.startTime).getTime()) / HR;

// Any two active client-sessions with the same technician that overlap in time.
function techDoubleBooked(data: ScheduleData): boolean {
  const byTech = new Map<string, Appointment[]>();
  for (const a of data.appointments) {
    if (a.type !== 'client-session' || a.status === 'canceled' || !a.technician) continue;
    (byTech.get(a.technician) ?? byTech.set(a.technician, []).get(a.technician)!).push(a);
  }
  for (const list of byTech.values()) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const s1 = new Date(list[i].startTime).getTime(), e1 = new Date(list[i].endTime).getTime();
      const s2 = new Date(list[j].startTime).getTime(), e2 = new Date(list[j].endTime).getTime();
      if (s1 < e2 && s2 < e1) return true;
    }
  }
  return false;
}

const clientHours = (result: ReturnType<typeof buildSchedule>, name: string) =>
  result.solution.ops
    .filter((o): o is Extract<typeof o, { op: 'add' }> => o.op === 'add' && o.client === name)
    .reduce((s, o) => s + hrsOf({ startTime: o.start, endTime: o.end }), 0);

// Directs now materialize to dated per-week rows out to the auth end, so summing
// EVERY op returns the whole backbone. These tests pin the WEEKLY template logic,
// so scope the tally to the first template week.
const WEEK0_START = new Date(`${WEEK_START}T00:00:00`).getTime();
const WEEK0_END = WEEK0_START + 7 * 24 * HR;
const clientWeekHours = (result: ReturnType<typeof buildSchedule>, name: string) =>
  result.solution.ops
    .filter((o): o is Extract<typeof o, { op: 'add' }> => o.op === 'add' && o.client === name)
    .filter(o => { const s = new Date(o.start).getTime(); return s >= WEEK0_START && s < WEEK0_END; })
    .reduce((s, o) => s + hrsOf({ startTime: o.start, endTime: o.end }), 0);

console.log('anti-double-book: two clients share one BT, non-overlapping windows');
{
  const mon = (s: string, e: string) => ({ Monday: [{ start: s, end: e }] });
  const c1 = client('c1', 'Client One', mon('09:00', '13:00'));
  const c2 = client('c2', 'Client Two', mon('13:00', '17:00'));
  const t1 = tech('t1', 'Tech One', mon('09:00', '17:00'), [
    { clientId: 'c1', hoursPerWeek: 8, billable: true },
    { clientId: 'c2', hoursPerWeek: 8, billable: true },
  ]);
  const base = schedule([c1, c2], [t1], [auth('c1', 4), auth('c2', 4)]);
  const result = buildSchedule(base, config(), NOW);

  check('both cases hit their 4h weekly target', Math.abs(clientWeekHours(result, 'Client One') - 4) < 0.01 && Math.abs(clientWeekHours(result, 'Client Two') - 4) < 0.01);
  check('no case blocked', result.blocks.length === 0, JSON.stringify(result.blocks));
  check('direct ops are dated (non-recurring) and materialized across multiple weeks',
    result.solution.ops.every(o => o.op === 'add' && o.type === 'client-session' && !o.recurring)
    && new Set(result.solution.ops.map(o => o.op === 'add' ? o.start.slice(0, 10) : '')).size > 1);

  const preview = applyOps(base, wishSolutionToDraft(result.solution, base).ops);
  check('applied schedule has no tech double-book', !techDoubleBooked(preview));
  const status = solveDraft(base, wishSolutionToDraft(result.solution, base).ops, NOW, base.settings);
  check('solveDraft needed no reshuffle (movedIds empty)', status.movedIds.length === 0, `moved=${status.movedIds.length}`);
}

console.log('MRV: a scarce shared tech must not strand the constrained case');
{
  const c1 = client('c1', 'Tight Case', { Monday: [{ start: '09:00', end: '11:00' }] });      // only 2h window
  const c2 = client('c2', 'Roomy Case', { Monday: [{ start: '09:00', end: '17:00' }] });       // wide open
  const t1 = tech('t1', 'Shared BT', { Monday: [{ start: '09:00', end: '17:00' }] }, [
    { clientId: 'c1', hoursPerWeek: 4, billable: true },
    { clientId: 'c2', hoursPerWeek: 4, billable: true },
  ]);
  // Order the roomy case FIRST so a naive first-come pass would steal 09–11.
  const base = schedule([c2, c1], [t1], [auth('c1', 2), auth('c2', 2)]);
  const result = buildSchedule(base, config(), NOW);

  check('constrained case is fully staffed', Math.abs(clientWeekHours(result, 'Tight Case') - 2) < 0.01, JSON.stringify(result.blocks));
  check('roomy case is fully staffed', Math.abs(clientWeekHours(result, 'Roomy Case') - 2) < 0.01);
  check('constrained case took its only 09:00 window', result.solution.ops.some(o => o.op === 'add' && o.client === 'Tight Case' && o.start.endsWith('09:00:00')));
}

console.log('infeasibility: impossible case flagged, others still placed (partial success)');
{
  const c1 = client('c1', 'No Room', { Monday: [{ start: '09:00', end: '09:40' }] });  // 40min < 60 → no window
  const c2 = client('c2', 'Fine Case', { Monday: [{ start: '09:00', end: '13:00' }] });
  const t1 = tech('t1', 'BT A', { Monday: [{ start: '09:00', end: '17:00' }] }, [
    { clientId: 'c1', hoursPerWeek: 8, billable: true },
    { clientId: 'c2', hoursPerWeek: 8, billable: true },
  ]);
  const base = schedule([c1, c2], [t1], [auth('c1', 2), auth('c2', 4)]);
  const result = buildSchedule(base, config(), NOW);

  const block = result.blocks.find(b => b.clientId === 'c1');
  check('impossible case is blocked', !!block);
  check('block names availability as the binding constraint', block?.bindingConstraint === 'availability', block?.bindingConstraint);
  check('block reports a non-zero remaining gap', (block?.directGapRemaining ?? 0) >= 0.5);
  check('the feasible case is still fully placed', Math.abs(clientWeekHours(result, 'Fine Case') - 4) < 0.01);
  check('metrics count one fully staffed of two', result.metrics.casesFullyStaffed === 1 && result.metrics.totalCases === 2);

  // The chat-transcript readout: leads with metrics + a tray cue, then names the
  // blocked case and its constraint. Contains real names by design — display-only
  // (never sent back to the API; see sassiSession's build branch).
  const summary = formatBuildSummary(result, true);
  check('summary leads with placed hours + staffed count', /Placed [\d.]+h of direct across 2 cases \(1\/2 fully staffed\)\./.test(summary));
  check('summary points the BCBA to the tray', summary.includes('Review the proposal in the tray'));
  check('summary names the blocked client and its constraint', summary.includes('No Room') && summary.includes('No open availability'));
  check('summary reports the remaining shortfall', /No Room — No open availability \([\d.]+h short\)/.test(summary));

  // When the build staged nothing, the readout drops the "0h/tray" wording for a
  // clear no-op message (all-blocked) or an all-at-target message (no blocks).
  const allBlocked = formatBuildSummary(result, false);
  check('unstaged build with blocks leads with "No sessions could be placed"', allBlocked.startsWith('No sessions could be placed:') && allBlocked.includes('No Room'));
  check('unstaged build with blocks omits the misleading 0h/tray line', !allBlocked.includes('Placed') && !allBlocked.includes('tray'));
  const nothing = formatBuildSummary({ ...result, blocks: [] }, false);
  check('unstaged build with no blocks reads as already-at-target', nothing === 'Nothing to place — every case is already at its direct target.');
}

console.log('validity: applied build introduces no new hard (error) conflicts');
{
  const days = { Monday: [{ start: '09:00', end: '15:00' }], Wednesday: [{ start: '09:00', end: '15:00' }] };
  const c1 = client('c1', 'Alpha', days);
  const c2 = client('c2', 'Bravo', days);
  const c3 = client('c3', 'Cara', { Tuesday: [{ start: '10:00', end: '16:00' }] });
  const wide = { Monday: [{ start: '08:00', end: '18:00' }], Tuesday: [{ start: '08:00', end: '18:00' }], Wednesday: [{ start: '08:00', end: '18:00' }] };
  const t1 = tech('t1', 'BT1', wide, [
    { clientId: 'c1', hoursPerWeek: 10, billable: true },
    { clientId: 'c3', hoursPerWeek: 10, billable: true },
  ]);
  const t2 = tech('t2', 'BT2', wide, [{ clientId: 'c2', hoursPerWeek: 10, billable: true }]);
  const base = schedule([c1, c2, c3], [t1, t2], [auth('c1', 6), auth('c2', 6), auth('c3', 5)]);

  // Phase 1 is direct-only: placing directs legitimately CREATES a supervision
  // shortfall (filled in the supervision phase), so exclude supervision-violation
  // and assert only that no new PLACEMENT conflict (double-book / availability /
  // auth-overbooking) was introduced.
  const placementErrors = (d: ScheduleData) =>
    new ConstraintValidator(d, NOW).validateSchedule()
      .filter(c => c.severity === 'error' && c.type !== 'supervision-violation').length;
  const before = placementErrors(base);
  const result = buildSchedule(base, config(), NOW);
  const preview = applyOps(base, wishSolutionToDraft(result.solution, base).ops);
  const after = placementErrors(preview);

  check('some direct hours were placed', result.metrics.directHrsPlaced > 0);
  check('no tech double-book in the applied result', !techDoubleBooked(preview));
  check('no NEW placement-error conflicts (double-book/availability/auth)', after <= before, `before=${before} after=${after}`);
  // Sanity: the only new errors are the expected supervision shortfalls Phase 3 fills.
  const supShort = new ConstraintValidator(preview, NOW).validateSchedule().filter(c => c.type === 'supervision-violation').length;
  check('the expected supervision gaps appear (deferred to the supervision phase)', supShort > 0);
}

console.log('defaultBuilderConfig: one-tap defaults are sane and drive a real build');
{
  const c1 = client('c1', 'Solo', { Monday: [{ start: '09:00', end: '17:00' }] });
  const t1 = tech('t1', 'BT', { Monday: [{ start: '09:00', end: '17:00' }] }, [{ clientId: 'c1', hoursPerWeek: 10, billable: true }]);
  const data = schedule([c1], [t1], [auth('c1', 4)]);
  // weekStart is always the NEXT Monday — the soonest week entirely in the future
  // — because buildSchedule places across the whole template week and doesn't guard
  // against `now`, so any partly-past week would drop already-passed slots. The
  // containing week always includes today, so even a Monday run anchors next Monday.
  const mon = new Date('2026-07-06T09:00:00');
  const wed = new Date('2026-07-08T09:00:00');
  check('Monday build still anchors the NEXT full week (this week includes today)', defaultBuilderConfig(data, mon).weekStart === '2026-07-13');
  const cfg = defaultBuilderConfig(data, wed);
  check('mid-week build anchors the NEXT Monday (fully future)', cfg.weekStart === '2026-07-13');
  check('monthHorizon spans the calendar month', cfg.monthHorizon.start === '2026-07-01' && cfg.monthHorizon.end === '2026-08-01');
  check('weekly billable target falls back to the utilization default', cfg.bcbaWeeklyBillableTarget > 0);
  check('chaseDirect is on', cfg.chaseDirect === true);
  // The default config actually drives a build that places the case's direct hours.
  const result = buildSchedule(data, cfg, wed);
  check('default config produces a placeable build', clientHours(result, 'Solo') >= 4 - 1e-9);
}

console.log('extend-vs-add: an adjacent existing session GROWS instead of a fragment being bolted on');
{
  // The reported case: a client scheduled 16:00-18:00 with room to 19:00 and a 1h gap
  // should have the 2h session GROWN to 16:00-19:00 (a resize), not a 1h 18:00-19:00
  // fragment placed beside it.
  const c1 = client('cx', 'Client Extend', { Monday: [{ start: '15:30', end: '19:00' }] });
  const t1 = tech('tx', 'Tammy Extend', { Monday: [{ start: '09:00', end: '20:00' }] }, [{ clientId: 'cx', hoursPerWeek: 40, billable: true }]);
  const existing = {
    id: 'e1', type: 'client-session', client: 'Client Extend', technician: 'Tammy Extend',
    startTime: `${WEEK_START}T16:00:00`, endTime: `${WEEK_START}T18:00:00`, isRecurring: true,
  } as Appointment;
  const base = schedule([c1], [t1], [auth('cx', 3)], [existing]); // 3h target, 2h scheduled → 1h gap
  const result = buildSchedule(base, config(), NOW);
  const moves = result.solution.ops.filter(o => o.op === 'move');
  const grew = moves.some(o => o.op === 'move' && o.start.endsWith('16:00:00') && o.end.endsWith('19:00:00'));
  const fragments = result.solution.ops.filter(o => o.op === 'add' && o.client === 'Client Extend' && o.start.endsWith('18:00:00'));
  check('the existing 2h session is RESIZED (a move op is emitted)', moves.length > 0, `moves=${moves.length}`);
  check('the resize grows it to 16:00-19:00', grew, JSON.stringify(moves.slice(0, 3).map(o => (o.op === 'move' ? `${o.start.slice(11, 16)}-${o.end.slice(11, 16)}` : ''))));
  check('NO 18:00-19:00 fragment is bolted on beside it', fragments.length === 0, `frags=${fragments.length}`);
  const preview = applyOps(base, wishSolutionToDraft(result.solution, base).ops);
  check('the applied schedule has no tech double-book', !techDoubleBooked(preview));
}

console.log(`\n${failed === 0 ? 'ALL PASS' : 'FAILURES'} — ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
