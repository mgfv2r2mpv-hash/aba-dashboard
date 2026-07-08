/**
 * Verification for the deterministic parent-training pass (Phase 4).
 * Run: npx tsx scripts/verify-builder-pt.ts
 *
 * The load-bearing guarantee: parent-training credit is REAL. Every test builds a
 * synthetic ScheduleData, runs buildSchedule with chasePT, commits the ops through
 * the real wishSolutionToDraft → applyOps pipeline, then RE-RUNS src/caseModel on
 * the committed schedule to prove the placed PT actually burns down the case's
 * monthly PT gap (and, when it overlaps a direct and names that BT, earns
 * supervision credit too) — not just that ops were emitted.
 *
 * Client names here are synthetic ("Client Papa"); nothing real is logged.
 */
import { ScheduleData, Client, Technician, Authorization, CompanySettings, Appointment, SupervisionCadence } from '../src/types';
import { buildSchedule, BuilderConfig, defaultBuilderConfig, combinedBuilderConfig, parentTrainingBuilderConfig } from '../src/scheduleBuilder';
import { wishSolutionToDraft, dropPastOps } from '../src/wish';
import { applyOps } from '../src/draft';
import { computeCaseState } from '../src/caseModel';
import { computeClientCompliance, monthPeriod, overlapHours } from '../src/compliance';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}

const NOW = new Date('2026-07-01T00:00:00');            // Wednesday; next Monday = 2026-07-06
const HR = 3_600_000;
const durH = (a: { startTime: string; endTime: string }) =>
  (new Date(a.endTime).getTime() - new Date(a.startTime).getTime()) / HR;

function daysWindows(days: string[], start: string, end: string): Client['availabilityWindows'] {
  const out: any = {};
  for (const d of days) out[d] = [{ start, end }];
  return out;
}

function baseSettings(clin: Record<string, { start: string; end: string }[]>): CompanySettings {
  return {
    supervisionDirectHoursPercent: 5,
    supervisionRBTHoursPercent: 5,
    supervisionTechHoursPercent: 0,
    supervisionFloorPercent: 10,
    supervisionPreferredMinPercent: 15,
    supervisionPreferredMaxPercent: 20,
    parentTraining: { minimumHours: 1, targetMinHours: 2, targetMaxHours: 4, periodUnit: 'month' },
    clinicianAvailability: clin as any,
  } as CompanySettings;
}
const WIDE_CLIN = { Monday: [{ start: '07:00', end: '18:00' }], Tuesday: [{ start: '07:00', end: '18:00' }], Wednesday: [{ start: '07:00', end: '18:00' }], Thursday: [{ start: '07:00', end: '18:00' }], Friday: [{ start: '07:00', end: '18:00' }] };

function client(id: string, name: string, windows: Client['availabilityWindows'], cadence?: SupervisionCadence): Client {
  return { id, name, availabilityWindows: windows, cadenceGoal: cadence };
}
function tech(id: string, name: string, avail: Technician['availability'], assignments: Technician['assignments'], isRBT = true): Technician {
  return { id, name, isRBT, availability: avail, assignments };
}
function auth(clientId: string, direct: number): Authorization {
  return { id: `au-${clientId}`, clientId, startDate: '2026-01-01', endDate: '2026-12-31', buckets: { direct: 10_000 }, weekly: { direct } };
}
function schedule(clients: Client[], technicians: Technician[], authorizations: Authorization[], settings: CompanySettings, appts: Appointment[] = []): ScheduleData {
  return {
    id: 'test', version: 2, clients, technicians, settings,
    appointments: appts, authorizations, blackouts: [], timeOff: [], companyHolidays: [],
    manualUsage: [], confirmedConflicts: [], lastModified: '2026-06-30T00:00:00.000Z',
  };
}

// Build + commit through the real pipeline (dropPastOps → wishSolutionToDraft → applyOps).
function run(base: ScheduleData, config: BuilderConfig, now: Date = NOW) {
  const result = buildSchedule(base, config, now);
  const safe = dropPastOps(result.solution.ops, now);
  const { ops } = wishSolutionToDraft({ id: 'x', summary: '', reasoning: '', ops: safe }, base);
  const committed = applyOps(base, ops);
  return { result, committed, staged: safe };
}
const ptAppts = (d: ScheduleData) => d.appointments.filter(a => a.type === 'parent-training');
const supAppts = (d: ScheduleData) => d.appointments.filter(a => a.type === 'supervision');
const directAppts = (d: ScheduleData) => d.appointments.filter(a => a.type === 'client-session');
const ptGap = (d: ScheduleData, name: string): number => {
  const c = d.clients.find(x => x.name === name)!;
  return computeCaseState(d, c, NOW).parentTraining.gap;
};
const ptGoal = (d: ScheduleData, name: string): number => {
  const c = d.clients.find(x => x.name === name)!;
  return computeCaseState(d, c, NOW).parentTraining.goalMonth;
};
const clientSupH = (d: ScheduleData, name: string): number => {
  const cc = computeClientCompliance(d, monthPeriod(NOW), NOW).find(c => c.client.name === name);
  return cc?.projected.supervisionHours ?? 0;
};
const clientPtH = (d: ScheduleData, name: string): number => {
  // Materialized appointments are id-linked (the add path normalizes refs to ids),
  // so resolve the client's name to its id before matching.
  const id = d.clients.find(c => c.name === name)?.id ?? name;
  return ptAppts(d).filter(a => a.client === id).reduce((s, a) => s + durH(a), 0);
};

// ─────────────────────────────────────────────────────────────────────────────
console.log('off switch: chasePT:false is byte-identical to directs-only');
{
  const c1 = client('c1', 'Client Alpha', daysWindows(['Monday', 'Tuesday'], '08:00', '16:00'), 'W');
  const t1 = tech('t1', 'Ana Aide', WIDE_CLIN, [{ clientId: 'c1', hoursPerWeek: 40, billable: true }]);
  const base = schedule([c1], [t1], [auth('c1', 8)], baseSettings(WIDE_CLIN));
  const cfg = defaultBuilderConfig(base, NOW);
  const off = buildSchedule(base, { ...cfg, chasePT: false }, NOW);
  const plain = buildSchedule(base, cfg, NOW);
  check('ops identical with chasePT:false vs unset', JSON.stringify(off.solution.ops) === JSON.stringify(plain.solution.ops));
  check('no parent-training ops emitted when off', off.solution.ops.every(o => !(o.op === 'add' && o.type === 'parent-training')));
  check('metrics.ptBuilt is false when off', off.metrics.ptBuilt === false);
}

console.log('standalone: PT over existing directs burns the gap to 0');
{
  const c1 = client('c1', 'Client Bravo', daysWindows(['Monday', 'Tuesday', 'Wednesday'], '08:00', '16:00'), 'W');
  const t1 = tech('t1', 'Ben Aide', WIDE_CLIN, [{ clientId: 'c1', hoursPerWeek: 40, billable: true }]);
  const fresh = schedule([c1], [t1], [auth('c1', 10)], baseSettings(WIDE_CLIN));
  const withDirects = run(fresh, defaultBuilderConfig(fresh, NOW)).committed;
  check('goal defaults to the company targetMinHours (2h)', Math.abs(ptGoal(withDirects, 'Client Bravo') - 2) < 1e-9, `goal=${ptGoal(withDirects, 'Client Bravo')}`);

  const { result, committed } = run(withDirects, parentTrainingBuilderConfig(withDirects, NOW));
  check('standalone build ran PT only (not direct, not supervision)', result.metrics.ptBuilt && !result.metrics.directBuilt && !result.metrics.supervisionBuilt);
  check('PT hours were placed', result.metrics.ptHrsPlaced > 0, String(result.metrics.ptHrsPlaced));
  check('committed PT reaches the goal (gap → 0)', ptGap(committed, 'Client Bravo') < 0.01, `gap=${ptGap(committed, 'Client Bravo')}`);
  const pts = ptAppts(committed);
  check('every PT session names a BT', pts.length > 0 && pts.every(p => !!p.technician));

  // Every PT session is a subinterval of a same-client / same-tech direct (overlaps
  // a real direct — the placement law).
  const dirs = directAppts(committed);
  const allOverDirect = pts.every(p => {
    const host = dirs.find(d => d.client === p.client && d.technician === p.technician && overlapHours(p, d) > 0);
    return host && Math.abs(overlapHours(p, host) - durH(p)) < 1e-6;
  });
  check('every PT session overlaps a matching direct', allOverDirect);
  check('no PT contact exceeds the 2h cap', pts.every(p => durH(p) <= 2 + 1e-9));
}

console.log('per-case override: parentTrainingMaxHours becomes the goal');
{
  const c1: Client = { ...client('c1', 'Client Charlie', daysWindows(['Monday', 'Tuesday', 'Wednesday'], '08:00', '16:00'), 'W'), parentTrainingMaxHours: 3 };
  const t1 = tech('t1', 'Cid Aide', WIDE_CLIN, [{ clientId: 'c1', hoursPerWeek: 40, billable: true }]);
  const fresh = schedule([c1], [t1], [auth('c1', 10)], baseSettings(WIDE_CLIN));
  const withDirects = run(fresh, defaultBuilderConfig(fresh, NOW)).committed;
  check('goal is the per-case override (3h), not the company 2h', Math.abs(ptGoal(withDirects, 'Client Charlie') - 3) < 1e-9, `goal=${ptGoal(withDirects, 'Client Charlie')}`);
  const { committed } = run(withDirects, parentTrainingBuilderConfig(withDirects, NOW));
  check('PT placed ~3h to hit the override goal', Math.abs(clientPtH(committed, 'Client Charlie') - 3) < 0.01, `ptH=${clientPtH(committed, 'Client Charlie')}`);
  check('override goal reached (gap → 0)', ptGap(committed, 'Client Charlie') < 0.01, `gap=${ptGap(committed, 'Client Charlie')}`);
}

console.log('disablePTRequirements: exempt clients are never chased');
{
  const c1: Client = { ...client('c1', 'Client Delta', daysWindows(['Monday', 'Tuesday'], '08:00', '16:00'), 'W'), disablePTRequirements: true };
  const t1 = tech('t1', 'Dot Aide', WIDE_CLIN, [{ clientId: 'c1', hoursPerWeek: 40, billable: true }]);
  const base = schedule([c1], [t1], [auth('c1', 8)], baseSettings(WIDE_CLIN));
  const { result, committed } = run(base, combinedBuilderConfig(base, NOW));
  check('no PT placed for the exempt client', clientPtH(committed, 'Client Delta') === 0);
  check('exempt client is not a PT target', result.metrics.ptTargetCases === 0, `targets=${result.metrics.ptTargetCases}`);
  check('exempt client yields no pt-availability block', !result.blocks.some(b => b.bindingConstraint === 'pt-availability'));
  // Directs + supervision still ran for the case.
  check('directs still placed for the exempt case', directAppts(committed).length > 0);
}

console.log('no directs: a PT goal with nothing to overlap → shortfall block');
{
  // A dated direct exists only in week 0, its only clinician window is fully taken
  // by an EXISTING supervision — so PT can find no BCBA-free slot over any direct.
  const c1 = client('c1', 'Client Echo', daysWindows(['Monday'], '09:00', '10:00'), 'W');
  const t1 = tech('t1', 'Eli Aide', { Monday: [{ start: '09:00', end: '10:00' }] }, [{ clientId: 'c1', hoursPerWeek: 40, billable: true }]);
  const tightClin = { Monday: [{ start: '09:00', end: '09:30' }] };
  const direct: Appointment = { id: 'd0', type: 'client-session', client: 'Client Echo', technician: 'Eli Aide', startTime: '2026-07-06T09:00:00', endTime: '2026-07-06T10:00:00', status: 'scheduled' } as Appointment;
  const existingSup: Appointment = { id: 's0', type: 'supervision', client: 'Client Echo', technician: 'Eli Aide', startTime: '2026-07-06T09:00:00', endTime: '2026-07-06T09:30:00', status: 'scheduled' } as Appointment;
  const base = schedule([c1], [t1], [auth('c1', 1)], baseSettings(tightClin), [direct, existingSup]);
  const { result, committed } = run(base, parentTrainingBuilderConfig(base, NOW));
  check('existing BCBA session blocks the only slot → no PT placed', ptAppts(committed).length === 0, `n=${ptAppts(committed).length}`);
  const ptBlocks = result.blocks.filter(b => b.bindingConstraint === 'pt-availability');
  check('the un-trainable case yields a pt-availability block', ptBlocks.length >= 1, `blocks=${JSON.stringify(result.blocks.map(b => b.bindingConstraint))}`);
  check('the residual block reports a PT gap', ptBlocks.some(b => (b.ptGapRemaining ?? 0) > 0));
}

console.log('double-duty: a named-BT PT over a direct earns supervision credit');
{
  const c1 = client('c1', 'Client Foxtrot', daysWindows(['Monday', 'Tuesday'], '08:00', '16:00'), 'W');
  const t1 = tech('t1', 'Fay Aide', WIDE_CLIN, [{ clientId: 'c1', hoursPerWeek: 40, billable: true }]);
  const fresh = schedule([c1], [t1], [auth('c1', 8)], baseSettings(WIDE_CLIN));
  const withDirects = run(fresh, defaultBuilderConfig(fresh, NOW)).committed;
  const { committed } = run(withDirects, parentTrainingBuilderConfig(withDirects, NOW));
  check('PT-only build placed no supervision sessions', supAppts(committed).length === 0);
  const supCredit = clientSupH(committed, 'Client Foxtrot');
  check('PT alone earns supervision credit (double-duty)', supCredit > 0.01, `supH=${supCredit}`);
  // The credit is tied to the named BT: ghost every PT tech → credit must vanish.
  const mutated: ScheduleData = { ...committed, appointments: committed.appointments.map(a => a.type === 'parent-training' ? { ...a, technician: 'Ghost Tech' } : a) };
  check('mutating the named BT drops the PT-derived credit to 0', clientSupH(mutated, 'Client Foxtrot') < 0.01, `supH=${clientSupH(mutated, 'Client Foxtrot')}`);
}

console.log('combined: one materialized backbone, sup + PT share the BCBA plane');
{
  const c1 = client('c1', 'Client Golf', daysWindows(['Monday', 'Tuesday', 'Wednesday'], '08:00', '16:00'), 'W');
  const t1 = tech('t1', 'Gus Aide', WIDE_CLIN, [{ clientId: 'c1', hoursPerWeek: 40, billable: true }]);
  const base = schedule([c1], [t1], [auth('c1', 10)], baseSettings(WIDE_CLIN));
  const { result, committed } = run(base, combinedBuilderConfig(base, NOW));

  check('all three passes ran', result.metrics.directBuilt && result.metrics.supervisionBuilt && result.metrics.ptBuilt);
  check('combined placed supervision AND parent training', supAppts(committed).length > 0 && ptAppts(committed).length > 0);

  // No duplicate materialized directs: no two client-session rows share an identical
  // (client, startTime). Double-materialization would collide here.
  const dirKeys = directAppts(committed).map(a => `${a.client}|${a.startTime}`);
  check('no duplicate dated direct rows (materialized exactly once)', new Set(dirKeys).size === dirKeys.length, `n=${dirKeys.length} uniq=${new Set(dirKeys).size}`);

  // The single BCBA is never double-booked across the two passes.
  const sups = supAppts(committed), pts = ptAppts(committed);
  let overlap = false;
  for (const s of sups) for (const p of pts) if (overlapHours(s, p) > 1e-9) overlap = true;
  check('no supervision session overlaps any parent-training session (one BCBA)', !overlap);
}

console.log('dropPastOps guard: a mid-horizon build emits no past-dated PT');
{
  const midNow = new Date('2026-07-15T00:00:00');       // next Monday = 2026-07-20
  const c1 = client('c1', 'Client Hotel', daysWindows(['Monday', 'Tuesday'], '08:00', '16:00'), 'W');
  const t1 = tech('t1', 'Hal Aide', WIDE_CLIN, [{ clientId: 'c1', hoursPerWeek: 8, billable: true }]);
  const base = schedule([c1], [t1], [auth('c1', 8)], baseSettings(WIDE_CLIN));
  const { staged } = run(base, combinedBuilderConfig(base, midNow), midNow);
  const anyPastPt = staged.some(o => o.op === 'add' && o.type === 'parent-training' && new Date(o.start).getTime() < midNow.getTime());
  check('no PT op is dated before the mid-horizon now', !anyPastPt);
  check('some PT still placed in the remaining weeks', staged.some(o => o.op === 'add' && o.type === 'parent-training'));
}

console.log('inactive client: a default PT goal with NO directs is never chased');
{
  // A rostered client with availability but no auth (→ no directs), alongside a
  // served client. The no-direct client must NOT become a PT target or emit a block.
  const inactive = client('c1', 'Client India', daysWindows(['Monday'], '09:00', '10:00'), 'W');
  const served = client('c2', 'Client Juliet', daysWindows(['Monday', 'Tuesday'], '08:00', '16:00'), 'W');
  const t1 = tech('t1', 'Ivy Aide', WIDE_CLIN, [{ clientId: 'c2', hoursPerWeek: 40, billable: true }]);
  const base = schedule([inactive, served], [t1], [auth('c2', 8)], baseSettings(WIDE_CLIN));
  const { result, committed } = run(base, combinedBuilderConfig(base, NOW));
  check('inactive client still carries a default PT goal (2h)', Math.abs(ptGoal(committed, 'Client India') - 2) < 1e-9, `goal=${ptGoal(committed, 'Client India')}`);
  check('no PT placed for the inactive (no-direct) client', clientPtH(committed, 'Client India') === 0);
  check('inactive client yields NO phantom pt-availability block', !result.blocks.some(b => b.bindingConstraint === 'pt-availability' && b.clientName === 'Client India'));
  check('only the served client counts as a PT target', result.metrics.ptTargetCases === 1, `targets=${result.metrics.ptTargetCases}`);
  check('the served client still got PT', clientPtH(committed, 'Client Juliet') > 0);
}

console.log('cap safety: PT never overshoots a fractional goal (== the case cap)');
{
  const MIN_BLOCK = 0.25; // placeBcbaSubinterval minimum
  const c1: Client = { ...client('c1', 'Client Kilo', daysWindows(['Monday', 'Tuesday', 'Wednesday'], '08:00', '16:00'), 'W'), parentTrainingMaxHours: 2.2 };
  const t1 = tech('t1', 'Kim Aide', WIDE_CLIN, [{ clientId: 'c1', hoursPerWeek: 40, billable: true }]);
  const fresh = schedule([c1], [t1], [auth('c1', 10)], baseSettings(WIDE_CLIN));
  const withDirects = run(fresh, defaultBuilderConfig(fresh, NOW)).committed;
  const { result, committed } = run(withDirects, parentTrainingBuilderConfig(withDirects, NOW));
  const placed = clientPtH(committed, 'Client Kilo');
  // 2h in week 0 (MAX cap), then the 0.2h remainder is below the min block → not
  // placed (would round UP to 0.25h and breach the 2.2h case cap).
  check('PT never overshoots the fractional cap (≤ 2.2h)', placed <= 2.2 + 1e-9, `ptH=${placed}`);
  check('PT gets within one min-block of the goal', placed >= 2.2 - MIN_BLOCK, `ptH=${placed}`);
  check('no shortfall block for the sub-min residual', !result.blocks.some(b => b.bindingConstraint === 'pt-availability'));
}

console.log('series: builder parent-training shares one editable seriesId per case');
{
  const c1 = client('c1', 'Client Series', daysWindows(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], '08:00', '16:00'), 'W');
  const t1 = tech('t1', 'Ben Aide', WIDE_CLIN, [{ clientId: 'c1', hoursPerWeek: 40, billable: true }]);
  const base = schedule([c1], [t1], [auth('c1', 20)], { ...baseSettings(WIDE_CLIN), parentTraining: { minimumHours: 1, targetMinHours: 6, targetMaxHours: 8, periodUnit: 'month' } } as any);
  const { committed } = run(base, combinedBuilderConfig(base, NOW));
  const pts = ptAppts(committed).filter(a => a.client === 'c1' || a.client === 'Client Series');
  check('multiple PT sessions placed', pts.length >= 2, `count ${pts.length}`);
  const ids = new Set(pts.map(p => p.seriesId));
  check('all of the case’s PT share ONE seriesId', ids.size === 1 && !ids.has(undefined), `ids=${[...ids].join(',')}`);
  check('PT is marked recurring with a pattern', pts.every(p => p.isRecurring && !!p.recurringPattern));
}

console.log(`\n${failed === 0 ? 'ALL PASS' : 'FAILURES'} — ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
