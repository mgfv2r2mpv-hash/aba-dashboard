/**
 * Verification for the deterministic supervision pass (Phase 3).
 * Run: npx tsx scripts/verify-builder-sup.ts
 *
 * The load-bearing guarantee: supervision credit is REAL. Every test builds a
 * synthetic ScheduleData, runs buildSchedule with chaseSupervision, commits the
 * ops through the real wishSolutionToDraft → applyOps pipeline, then RE-RUNS
 * src/compliance on the committed schedule to prove the placed supervision earns
 * credit against the (materialized) directs — not just that ops were emitted.
 *
 * Client names here are synthetic ("Client Alpha"); nothing real is logged.
 */
import { ScheduleData, Client, Technician, Authorization, CompanySettings, Appointment, SupervisionCadence } from '../src/types';
import { buildSchedule, BuilderConfig, defaultBuilderConfig, combinedBuilderConfig, supervisionBuilderConfig, formatBuildSummary, sessionTitle } from '../src/scheduleBuilder';
import { weeksForCadence, cancellationRiskWeight, isBcbaFree, reserveBcba, expandDirectOccurrences } from '../src/builderSupervision';
import { wishSolutionToDraft, dropPastOps } from '../src/wish';
import { applyOps } from '../src/draft';
import { computeClientCompliance, computeTechCompliance, monthPeriod, overlapHours } from '../src/compliance';
import { bucketOf } from '../src/utilization';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}

const NOW = new Date('2026-07-01T00:00:00');            // Wednesday; next Monday = 2026-07-06
const WEEK0 = new Date('2026-07-06T00:00:00').getTime();
const WEEK_MS = 7 * 86_400_000;
const HR = 3_600_000;
const weekOf = (iso: string): number => {
  const d = new Date(iso); d.setHours(0, 0, 0, 0);
  return Math.floor((d.getTime() - WEEK0) / WEEK_MS);
};
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
const supAppts = (d: ScheduleData) => d.appointments.filter(a => a.type === 'supervision');
const directAppts = (d: ScheduleData) => d.appointments.filter(a => a.type === 'client-session');
const clientDirectH = (d: ScheduleData, name: string) => {
  const cc = computeClientCompliance(d, monthPeriod(NOW), NOW).find(c => c.client.name === name);
  return cc?.projected.directHours ?? 0;
};
const clientSupH = (d: ScheduleData, name: string) => {
  const cc = computeClientCompliance(d, monthPeriod(NOW), NOW).find(c => c.client.name === name);
  return cc?.projected.supervisionHours ?? 0;
};

// ─────────────────────────────────────────────────────────────────────────────
console.log('sessionTitle: first-name initials / tech name-initials');
{
  check('"Archie Client" + "Mike Technician" → "AR / MT"', sessionTitle('Archie Client', 'Mike Technician') === 'AR / MT', sessionTitle('Archie Client', 'Mike Technician'));
  check('"Client Baddy" + "Boring Tech" → "CL / BT"', sessionTitle('Client Baddy', 'Boring Tech') === 'CL / BT', sessionTitle('Client Baddy', 'Boring Tech'));
  check('multi-part tech name folds to initials', sessionTitle('Ed', 'Boring Tech Jones') === 'ED / BTJ');
  check('single-letter first name yields no stray space', sessionTitle('A Client', 'Mike Technician') === 'A / MT', sessionTitle('A Client', 'Mike Technician'));
  check('no tech → client initials only', sessionTitle('Client Baddy') === 'CL');
}

console.log('weeksForCadence: cadence → front-loaded week picks');
{
  check('W over 4 weeks → every week', JSON.stringify(weeksForCadence('W', [0, 1, 2, 3], 0)) === JSON.stringify([0, 1, 2, 3]));
  check('EOW risk 0 → even spread [0,2]', JSON.stringify(weeksForCadence('EOW', [0, 1, 2, 3], 0)) === JSON.stringify([0, 2]));
  check('EOW risk 1 → front-packed [0,1]', JSON.stringify(weeksForCadence('EOW', [0, 1, 2, 3], 1)) === JSON.stringify([0, 1]));
  check('3o4 risk 1 → front-packed [0,1,2]', JSON.stringify(weeksForCadence('3o4', [0, 1, 2, 3], 1)) === JSON.stringify([0, 1, 2]));
  check('3o4 count is 3 of the available weeks', weeksForCadence('3o4', [0, 1, 2, 3], 0).length === 3);
  check('undefined cadence → every available week', JSON.stringify(weeksForCadence(undefined, [0, 1, 2], 0.5)) === JSON.stringify([0, 1, 2]));
  check('count clamped to availability', weeksForCadence('W', [0, 1], 0).length === 2);
}

console.log('cancellationRiskWeight: deterministic, visible');
{
  const cW = client('c', 'C', daysWindows(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], '08:00', '16:00'), 'W');
  const cEOW = client('c', 'C', daysWindows(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], '08:00', '16:00'), 'EOW');
  const cEOWtight = client('c', 'C', daysWindows(['Monday'], '08:00', '16:00'), 'EOW');
  check('weekly, 5 days → 0 risk', cancellationRiskWeight(cW) === 0);
  check('EOW, 5 days → 0.5 risk', Math.abs(cancellationRiskWeight(cEOW) - 0.5) < 1e-9, String(cancellationRiskWeight(cEOW)));
  check('EOW, 1 day → 0.9 risk (both proxies fire)', Math.abs(cancellationRiskWeight(cEOWtight) - 0.9) < 1e-9, String(cancellationRiskWeight(cEOWtight)));
}

console.log('DST safety: week indices stay distinct + consecutive across spring-forward');
{
  // US spring-forward is 2026-03-08. Anchor a Monday before it; a fixed-ms week
  // would collapse two real weeks (Mar 2 & Mar 9) into one bucket.
  const anchor = new Date('2026-02-16T09:00:00');
  const weekStartMs = new Date('2026-02-16T00:00:00').getTime();
  const horizonEndMs = new Date('2026-04-01T00:00:00').getTime();
  const occ = expandDirectOccurrences(anchor, 2 * HR, weekStartMs, weekStartMs, horizonEndMs);
  const idxs = occ.map(o => o.weekIndex);
  check('week indices are all distinct across the DST boundary', new Set(idxs).size === idxs.length, JSON.stringify(idxs));
  check('week indices are consecutive 0..n', JSON.stringify(idxs) === JSON.stringify(idxs.map((_, i) => i)), JSON.stringify(idxs));
  check('a Mar-9 occurrence exists and is its own week', occ.some(o => o.startIso.startsWith('2026-03-09')));
}

console.log('isBcbaFree / reserveBcba: half-open overlap, immutable');
{
  const busy = reserveBcba([], 100, 200);
  check('reserve returns a NEW array', busy.length === 1);
  check('overlapping instant is not free', !isBcbaFree(busy, 150, 250));
  check('touching end is free (half-open)', isBcbaFree(busy, 200, 300));
  check('touching start is free (half-open)', isBcbaFree(busy, 50, 100));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('cadence W: floor met, credit is REAL (re-run compliance)');
{
  const c1 = client('c1', 'Client Alpha', daysWindows(['Monday', 'Tuesday', 'Wednesday'], '08:00', '16:00'), 'W');
  const t1 = tech('t1', 'Ruth Aide', WIDE_CLIN, [{ clientId: 'c1', hoursPerWeek: 40, billable: true }]);
  const base = schedule([c1], [t1], [auth('c1', 10)], baseSettings(WIDE_CLIN));
  const { result, committed, staged } = run(base, combinedBuilderConfig(base, NOW));

  check('both passes ran (directBuilt + supervisionBuilt)', result.metrics.directBuilt && result.metrics.supervisionBuilt);
  check('supervision hours were placed', result.metrics.supervisionHrsPlaced > 0, String(result.metrics.supervisionHrsPlaced));

  const dH = clientDirectH(committed, 'Client Alpha');
  const sH = clientSupH(committed, 'Client Alpha');
  const floorH = dH * 0.10;
  check('directs materialized to ~4 weeks (~40h)', dH >= 38 && dH <= 42, `directH=${dH}`);
  check('committed supervision >= the (corrected) monthly floor', sH >= floorH - 0.01, `supH=${sH.toFixed(2)} floorH=${floorH.toFixed(2)}`);
  check('cadence W placed one contact per week (4)', supAppts(committed).length === 4, `n=${supAppts(committed).length}`);

  // Every sup names a tech, starts in the future, and is a FULL subinterval of a
  // same-client / same-tech direct (full overlap = full credit).
  const sups = supAppts(committed);
  const dirs = directAppts(committed);
  const allNamed = sups.every(s => !!s.technician);
  const allFuture = staged.every(o => (o.op !== 'add' && o.op !== 'move') || new Date((o as any).start).getTime() >= NOW.getTime());
  const allFullOverlap = sups.every(s => {
    const host = dirs.find(d => (d.client === s.client) && d.technician === s.technician && overlapHours(s, d) > 0);
    return host && Math.abs(overlapHours(s, host) - durH(s)) < 1e-6;
  });
  check('every supervision names the observed BT', allNamed);
  check('no supervision op is dated in the past', allFuture);
  check('every supervision is a full subinterval of a matching direct', allFullOverlap);

  check('summary reports a supervision line', /supervision/.test(formatBuildSummary(result, true)));
}

console.log('materialization: chaseSupervision expands the floor denominator ~4×');
{
  const c1 = client('c1', 'Client Beta', daysWindows(['Monday', 'Tuesday', 'Wednesday'], '08:00', '16:00'), 'W');
  const t1 = tech('t1', 'Ray Aide', WIDE_CLIN, [{ clientId: 'c1', hoursPerWeek: 40, billable: true }]);
  const base = schedule([c1], [t1], [auth('c1', 10)], baseSettings(WIDE_CLIN));

  const phase2 = run(base, defaultBuilderConfig(base, NOW));        // recurring, unexpanded
  const combined = run(base, combinedBuilderConfig(base, NOW));     // materialized
  const d2 = clientDirectH(phase2.committed, 'Client Beta');
  const d4 = clientDirectH(combined.committed, 'Client Beta');
  check('recurring build counts ~1 week of direct', d2 >= 9 && d2 <= 11, `d2=${d2}`);
  check('materialized build counts ~4 weeks of direct', d4 >= 38, `d4=${d4}`);
  check('materialized denominator ≈ 4× the naive value', d4 / d2 >= 3.5 && d4 / d2 <= 4.5, `ratio=${(d4 / d2).toFixed(2)}`);
}

console.log('cadence EOW: exactly two contacts');
{
  const c1 = client('c1', 'Client Echo', daysWindows(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], '08:00', '16:00'), 'EOW');
  const t1 = tech('t1', 'Eve Aide', WIDE_CLIN, [{ clientId: 'c1', hoursPerWeek: 40, billable: true }]);
  const base = schedule([c1], [t1], [auth('c1', 10)], baseSettings(WIDE_CLIN));
  const { committed } = run(base, combinedBuilderConfig(base, NOW));
  const sups = supAppts(committed);
  check('EOW placed exactly two contacts', sups.length === 2, `n=${sups.length}`);
  const weeks = sups.map(s => weekOf(s.startTime)).sort();
  check('EOW contacts land in two distinct weeks', new Set(weeks).size === 2, JSON.stringify(weeks));
}

console.log('named-BT credit: mutate the tech → credit collapses to 0');
{
  const c1 = client('c1', 'Client Foxtrot', daysWindows(['Monday', 'Tuesday'], '08:00', '16:00'), 'W');
  const t1 = tech('t1', 'Fay Aide', WIDE_CLIN, [{ clientId: 'c1', hoursPerWeek: 40, billable: true }]);
  const base = schedule([c1], [t1], [auth('c1', 8)], baseSettings(WIDE_CLIN));
  const { committed } = run(base, combinedBuilderConfig(base, NOW));
  const before = clientSupH(committed, 'Client Foxtrot');
  check('supervision earns credit with the correct named BT', before > 0.01, `supH=${before}`);
  // Re-name every supervision to a tech that serves nobody → overlap credit must vanish.
  const mutated: ScheduleData = { ...committed, appointments: committed.appointments.map(a => a.type === 'supervision' ? { ...a, technician: 'Ghost Tech' } : a) };
  const after = clientSupH(mutated, 'Client Foxtrot');
  check('mutating the named BT drops per-client credit to 0', after < 0.01, `supH=${after}`);
}

console.log('bucket safety: every supervision classifies as bcba (never bt)');
{
  const c1 = client('c1', 'Client Golf', daysWindows(['Monday', 'Tuesday'], '08:00', '16:00'), 'W');
  const t1 = tech('t1', 'Gus Aide', WIDE_CLIN, [{ clientId: 'c1', hoursPerWeek: 40, billable: true }]);
  const base = schedule([c1], [t1], [auth('c1', 8)], baseSettings(WIDE_CLIN));
  const { committed } = run(base, combinedBuilderConfig(base, NOW));
  const sups = supAppts(committed);
  check('some supervision was placed', sups.length > 0);
  check('every supervision buckets as bcba (no leakage to bt direct)', sups.every(s => bucketOf(s) === 'bcba'));
}

console.log('single BCBA: contended directs never double-book the one BCBA');
{
  // Three clients whose only direct each week lands at the SAME 1h slot (placeable
  // — direct windows must clear the 60-min minimum), but the BCBA is available for
  // only a 0.5h window — so the BCBA cannot supervise all three that week.
  const win = daysWindows(['Monday'], '09:00', '10:00');
  const tightClin = { Monday: [{ start: '09:00', end: '09:30' }] };
  const c1 = client('c1', 'Client Hotel', win, 'W');
  const c2 = client('c2', 'Client India', win, 'W');
  const c3 = client('c3', 'Client Juliet', win, 'W');
  const t1 = tech('t1', 'Hank Aide', { Monday: [{ start: '09:00', end: '10:00' }] }, [{ clientId: 'c1', hoursPerWeek: 40, billable: true }]);
  const t2 = tech('t2', 'Ida Aide', { Monday: [{ start: '09:00', end: '10:00' }] }, [{ clientId: 'c2', hoursPerWeek: 40, billable: true }]);
  const t3 = tech('t3', 'Jon Aide', { Monday: [{ start: '09:00', end: '10:00' }] }, [{ clientId: 'c3', hoursPerWeek: 40, billable: true }]);
  const base = schedule([c1, c2, c3], [t1, t2, t3], [auth('c1', 1), auth('c2', 1), auth('c3', 1)], baseSettings(tightClin));
  const { result, committed } = run(base, combinedBuilderConfig(base, NOW));

  const sups = supAppts(committed);
  let overlaps = false;
  for (let i = 0; i < sups.length; i++) for (let j = i + 1; j < sups.length; j++) {
    if (overlapHours(sups[i], sups[j]) > 1e-9) overlaps = true;
  }
  check('no two supervision sessions overlap (single BCBA honored)', !overlaps);
  const supBlocks = result.blocks.filter(b => b.bindingConstraint === 'bcba-availability');
  check('the un-supervisable case yields a bcba-availability block', supBlocks.length >= 1, `blocks=${JSON.stringify(result.blocks.map(b => b.bindingConstraint))}`);
  check('the residual block reports a supervision gap', supBlocks.some(b => (b.supervisionGapRemaining ?? 0) > 0));
}

console.log('per-RBT (D4): the BT furthest behind their own floor is preferred');
{
  // BCBA is available Mon+Tue only. Client Kilo has two candidate directs each
  // week: Monday by Al Ahead, Tuesday by Bea Behind. Bea ALSO carries a big
  // Wednesday caseload (Client Xray) the BCBA structurally cannot supervise (no
  // Wednesday clinician availability) — so Bea stays far behind her per-RBT floor
  // and the Kilo contact must route to Bea's LATER (Tuesday) direct, not Al's
  // Monday one. A day-of-week fallback (the pre-fix bug) would pick Al.
  const clin = { Monday: [{ start: '09:00', end: '12:00' }], Tuesday: [{ start: '09:00', end: '12:00' }] };
  const kilo = client('c1', 'Client Kilo', { Monday: [{ start: '09:00', end: '11:00' }], Tuesday: [{ start: '09:00', end: '11:00' }] }, 'W');
  const xray = client('c2', 'Client Xray', { Wednesday: [{ start: '08:00', end: '16:00' }] }, 'W');
  const bea = tech('tb', 'Bea Behind', WIDE_CLIN, [
    { clientId: 'c1', hoursPerWeek: 40, billable: true, availability: { Tuesday: [{ start: '09:00', end: '11:00' }] } },
    { clientId: 'c2', hoursPerWeek: 40, billable: true, availability: { Wednesday: [{ start: '08:00', end: '16:00' }] } },
  ]);
  const al = tech('ta', 'Al Ahead', WIDE_CLIN, [
    { clientId: 'c1', hoursPerWeek: 40, billable: true, availability: { Monday: [{ start: '09:00', end: '11:00' }] } },
  ]);
  const base = schedule([kilo, xray], [bea, al], [auth('c1', 4), auth('c2', 8)], baseSettings(clin));
  const { result, committed } = run(base, combinedBuilderConfig(base, NOW));

  check('per-RBT floor targets are tracked', result.metrics.rbtFloorTargets >= 1, `targets=${result.metrics.rbtFloorTargets}`);
  // The behind BT (Bea Behind) must be chosen despite being on the LATER day —
  // proving floor-gap selection, not chronological fallback (the review found the
  // old code degraded to day-of-week because per-RBT gaps were computed on
  // unmaterialized data and were all ~0).
  const kiloSups = committed.appointments.filter(a => a.type === 'supervision' && a.client === 'Client Kilo');
  check('a Client Kilo supervision names the behind RBT despite its later day', kiloSups.some(s => s.technician === 'Bea Behind'), JSON.stringify(kiloSups.map(s => s.technician)));
}

console.log('standalone: Build supervision over EXISTING recurring directs');
{
  const c1 = client('c1', 'Client Mike', daysWindows(['Monday', 'Tuesday', 'Wednesday'], '08:00', '16:00'), 'W');
  const t1 = tech('t1', 'Mae Aide', WIDE_CLIN, [{ clientId: 'c1', hoursPerWeek: 40, billable: true }]);
  const fresh = schedule([c1], [t1], [auth('c1', 10)], baseSettings(WIDE_CLIN));
  // First accept a Phase-2 direct build → the schedule now holds recurring directs.
  const withDirects = run(fresh, defaultBuilderConfig(fresh, NOW)).committed;
  check('a phase-2 direct build leaves recurring direct rows', withDirects.appointments.some(a => a.type === 'client-session' && a.isRecurring));

  const { result, committed } = run(withDirects, supervisionBuilderConfig(withDirects, NOW));
  check('standalone build ran supervision only (not direct)', result.metrics.supervisionBuilt && !result.metrics.directBuilt);
  check('supervision hours were placed over existing directs', result.metrics.supervisionHrsPlaced > 0, String(result.metrics.supervisionHrsPlaced));
  const dH = clientDirectH(committed, 'Client Mike');
  const sH = clientSupH(committed, 'Client Mike');
  check('existing recurring directs were materialized to ~4 weeks (no double-count)', dH >= 38 && dH <= 42, `directH=${dH}`);
  check('committed supervision reaches the corrected floor', sH >= dH * 0.10 - 0.01, `supH=${sH.toFixed(2)} floorH=${(dH * 0.10).toFixed(2)}`);
}

console.log('off switch: chaseSupervision:false is byte-identical to Phase 2');
{
  const c1 = client('c1', 'Client November', daysWindows(['Monday', 'Tuesday'], '08:00', '16:00'), 'W');
  const t1 = tech('t1', 'Ned Aide', WIDE_CLIN, [{ clientId: 'c1', hoursPerWeek: 40, billable: true }]);
  const base = schedule([c1], [t1], [auth('c1', 8)], baseSettings(WIDE_CLIN));
  const cfg = defaultBuilderConfig(base, NOW);
  const off = buildSchedule(base, { ...cfg, chaseSupervision: false }, NOW);
  const plain = buildSchedule(base, cfg, NOW);
  check('ops identical with chaseSupervision:false vs unset', JSON.stringify(off.solution.ops) === JSON.stringify(plain.solution.ops));
  check('no supervision ops emitted when off', off.solution.ops.every(o => !(o.op === 'add' && o.type === 'supervision')));
  check('all direct ops stay recurring weekly when off', off.solution.ops.every(o => o.op === 'add' && o.recurring === true));
}

console.log('dropPastOps guard: a mid-horizon build emits no past-dated supervision');
{
  const midNow = new Date('2026-07-15T00:00:00');       // next Monday = 2026-07-20
  const c1 = client('c1', 'Client Oscar', daysWindows(['Monday', 'Tuesday'], '08:00', '16:00'), 'W');
  const t1 = tech('t1', 'Oda Aide', WIDE_CLIN, [{ clientId: 'c1', hoursPerWeek: 8, billable: true }]);
  const base = schedule([c1], [t1], [auth('c1', 8)], baseSettings(WIDE_CLIN));
  const { staged } = run(base, combinedBuilderConfig(base, midNow), midNow);
  const anyPast = staged.some(o => o.op === 'add' && new Date(o.start).getTime() < midNow.getTime());
  check('no op is dated before the mid-horizon now', !anyPast);
  check('some supervision still placed in the remaining weeks', staged.some(o => o.op === 'add' && o.type === 'supervision'));
}

console.log(`\n${failed === 0 ? 'ALL PASS' : 'FAILURES'} — ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
