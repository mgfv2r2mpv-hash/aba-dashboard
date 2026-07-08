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

console.log('materialization: directs fill the month AND the backbone runs to auth end');
{
  const c1 = client('c1', 'Client Beta', daysWindows(['Monday', 'Tuesday', 'Wednesday'], '08:00', '16:00'), 'W');
  const t1 = tech('t1', 'Ray Aide', WIDE_CLIN, [{ clientId: 'c1', hoursPerWeek: 40, billable: true }]);
  const base = schedule([c1], [t1], [auth('c1', 10)], baseSettings(WIDE_CLIN));

  const cfg = defaultBuilderConfig(base, NOW);
  const phase2 = run(base, cfg);                                   // direct-only — now materialized
  const combined = run(base, combinedBuilderConfig(base, NOW));    // directs + BCBA passes
  const d2 = clientDirectH(phase2.committed, 'Client Beta');
  const d4 = clientDirectH(combined.committed, 'Client Beta');
  // Both builds materialize the month into concrete weekly rows, so the monthly
  // floor denominator is the real ~4-week figure in either case (no 1-week
  // understatement) and they agree.
  check('direct-only build materializes the month (~4 weeks)', d2 >= 38, `d2=${d2}`);
  check('combined build materializes the month (~4 weeks)', d4 >= 38, `d4=${d4}`);
  check('both builds agree on the monthly denominator', Math.abs(d2 - d4) < 1e-6, `d2=${d2} d4=${d4}`);
  // NEW: the direct backbone extends past the month out to the auth end (2026-12-31),
  // not just the current calendar month.
  const monthEndMs = new Date(`${cfg.monthHorizon.end}T00:00:00`).getTime();
  const beyondMonth = phase2.staged.filter(o => o.op === 'add' && o.type === 'client-session' && new Date(o.start).getTime() >= monthEndMs);
  check('direct backbone extends past the month toward the auth end', beyondMonth.length > 0, `beyond=${beyondMonth.length}`);
}

console.log('combined horizon split: directs run to auth end, the BCBA passes stay monthly');
{
  const c1 = client('c1', 'Client Sierra', daysWindows(['Monday', 'Tuesday', 'Wednesday'], '08:00', '16:00'), 'W');
  const t1 = tech('t1', 'Sia Aide', WIDE_CLIN, [{ clientId: 'c1', hoursPerWeek: 40, billable: true }]);
  const base = schedule([c1], [t1], [auth('c1', 10)], baseSettings(WIDE_CLIN));
  const cfg = combinedBuilderConfig(base, NOW);
  const monthEndMs = new Date(`${cfg.monthHorizon.end}T00:00:00`).getTime();
  const { staged } = run(base, cfg);
  const beyond = (type: string) => staged.filter(o => o.op === 'add' && o.type === type && new Date(o.start).getTime() >= monthEndMs).length;
  const within = (type: string) => staged.filter(o => o.op === 'add' && o.type === type && new Date(o.start).getTime() < monthEndMs).length;
  // The direct backbone runs to the auth end; supervision (and PT) are monthly
  // targets, so the chase only ever places inside the current month.
  check('combined: direct backbone extends past the month', beyond('client-session') > 0, `directsBeyond=${beyond('client-session')}`);
  check('combined: supervision IS placed within the month', within('supervision') > 0, `supWithin=${within('supervision')}`);
  check('combined: no supervision placed past the month', beyond('supervision') === 0, `supBeyond=${beyond('supervision')}`);
  check('combined: no parent training placed past the month', beyond('parent-training') === 0, `ptBeyond=${beyond('parent-training')}`);
}

console.log('auth boundary: the backbone never materializes a direct past a mid-month auth end');
{
  const c1 = client('c1', 'Client Tango', daysWindows(['Monday', 'Tuesday'], '08:00', '16:00'), 'W');
  const t1 = tech('t1', 'Tia Aide', WIDE_CLIN, [{ clientId: 'c1', hoursPerWeek: 40, billable: true }]);
  // Auth covers the weekStart (2026-07-13) but ends mid-month with no renewal.
  const midAuth: Authorization = { id: 'au-c1', clientId: 'c1', startDate: '2026-01-01', endDate: '2026-07-24', buckets: { direct: 10_000 }, weekly: { direct: 6 } };
  const base = schedule([c1], [t1], [midAuth], baseSettings(WIDE_CLIN));
  const { staged } = run(base, defaultBuilderConfig(base, NOW));
  const directs = staged.filter(o => o.op === 'add' && o.type === 'client-session');
  const authEndMs = new Date('2026-07-24T23:59:59').getTime();
  const pastAuth = directs.filter(o => new Date((o as { start: string }).start).getTime() > authEndMs).map(o => (o as { start: string }).start);
  check('some directs were placed inside the auth span', directs.length > 0, `n=${directs.length}`);
  check('NO direct is dated after the auth end (auth caps never bypass)', pastAuth.length === 0, JSON.stringify(pastAuth));
}

console.log('auth renewal: the backbone spans a contiguous renewal and skips the coverage gap');
{
  const c1 = client('c1', 'Client Uniform', daysWindows(['Monday', 'Tuesday'], '08:00', '16:00'), 'W');
  const t1 = tech('t1', 'Uma Aide', WIDE_CLIN, [{ clientId: 'c1', hoursPerWeek: 40, billable: true }]);
  const auth1: Authorization = { id: 'au1', clientId: 'c1', startDate: '2026-01-01', endDate: '2026-07-24', buckets: { direct: 10_000 }, weekly: { direct: 6 } };
  const auth2: Authorization = { id: 'au2', clientId: 'c1', startDate: '2026-08-10', endDate: '2026-12-31', buckets: { direct: 10_000 }, weekly: { direct: 6 } };
  const base = schedule([c1], [t1], [auth1, auth2], baseSettings(WIDE_CLIN));
  const { staged } = run(base, defaultBuilderConfig(base, NOW));
  const dates = staged.filter(o => o.op === 'add' && o.type === 'client-session').map(o => (o as { start: string }).start.slice(0, 10));
  const inAuth1 = dates.filter(d => d >= '2026-01-01' && d <= '2026-07-24').length;
  const gapDates = dates.filter(d => d > '2026-07-24' && d < '2026-08-10');
  const inAuth2 = dates.filter(d => d >= '2026-08-10' && d <= '2026-12-31').length;
  check('directs placed in the first auth span', inAuth1 > 0, `n1=${inAuth1}`);
  check('NO directs placed in the coverage gap between auths', gapDates.length === 0, JSON.stringify(gapDates));
  check('directs placed in the renewal auth span', inAuth2 > 0, `n2=${inAuth2}`);
}

console.log('availability guard: an existing recurring session is never cloned onto a day/time the BT cannot work');
{
  // Client is free Mon-Sat; the BT works Mon-Fri only. An existing recurring
  // Saturday makeup (mis-flagged recurring) plus a legit recurring Tuesday session.
  const c1 = client('c1', 'Client Whiskey', daysWindows(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], '09:00', '15:00'), 'W');
  const t1 = tech('t1', 'Wanda Aide', daysWindows(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], '09:00', '17:00') as Technician['availability'], [{ clientId: 'c1', hoursPerWeek: 40, billable: true }]);
  const mkAppt = (id: string, start: string, end: string): Appointment => ({
    id, type: 'client-session', client: 'Client Whiskey', technician: 'Wanda Aide', startTime: start, endTime: end, status: 'scheduled', isRecurring: true,
  } as Appointment);
  const satMakeup = mkAppt('a-sat', '2026-06-27T09:00:00', '2026-06-27T11:00:00'); // Saturday — BT never works Sat
  const tueReal = mkAppt('a-tue', '2026-06-30T10:00:00', '2026-06-30T14:00:00');    // Tuesday — legit
  const base = schedule([c1], [t1], [auth('c1', 12)], baseSettings(WIDE_CLIN), [satMakeup, tueReal]);
  const { staged } = run(base, defaultBuilderConfig(base, NOW));
  const directs = staged.filter(o => o.op === 'add' && o.type === 'client-session') as Array<{ start: string; end: string }>;
  const satOps = directs.filter(o => new Date(o.start).getDay() === 6);
  const outsideWanda = directs.filter(o => {
    const d = new Date(o.start), day = d.getDay();
    if (day === 0 || day === 6) return true;                 // weekend — Wanda is off
    const e = new Date(o.end);
    const sMin = d.getHours() * 60 + d.getMinutes(), eMin = e.getHours() * 60 + e.getMinutes();
    return !(sMin >= 9 * 60 && eMin <= 17 * 60);             // Wanda 09:00-17:00
  });
  check('directs were materialized forward at all', directs.length > 0, `n=${directs.length}`);
  check('the mis-flagged Saturday makeup is NOT cloned forward', satOps.length === 0, `sat=${satOps.length}`);
  check('no direct falls outside the BT availability', outsideWanda.length === 0, JSON.stringify(outsideWanda.slice(0, 3)));
}

console.log('availability guard: an UNRESOLVED tech ref still honors the client\'s closed days');
{
  // The real-world failure: a session stores a short tech ref ("Sidiatu") while the
  // roster record is "Sidiatu K", so resolveTech hands back the raw string and the
  // guard can't find the tech. It must NOT bypass — the CLIENT's availability still
  // governs, so a completed Saturday session (client closed Sat) never clones forward.
  const c1 = client('c1', 'Client Xray', daysWindows(['Tuesday', 'Wednesday', 'Thursday', 'Friday'], '10:00', '14:00'), 'W');
  const t1 = tech('t1', 'Sidiatu K', daysWindows(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'], '09:00', '17:00') as Technician['availability'], [{ clientId: 'c1', hoursPerWeek: 40, billable: true }]);
  const mkAppt = (id: string, start: string, end: string, status: string): Appointment => ({
    id, type: 'client-session', client: 'Client Xray', technician: 'Sidiatu', startTime: start, endTime: end, status, isRecurring: true,
  } as Appointment);
  const satCompleted = mkAppt('a-sat', '2026-06-27T09:04:00', '2026-06-27T13:05:00', 'completed'); // Saturday — client is closed
  const tueReal = mkAppt('a-tue', '2026-06-30T10:00:00', '2026-06-30T14:00:00', 'scheduled');       // Tuesday — legit
  const base = schedule([c1], [t1], [auth('c1', 12)], baseSettings(WIDE_CLIN), [satCompleted, tueReal]);
  const { staged } = run(base, defaultBuilderConfig(base, NOW));
  const directs = staged.filter(o => o.op === 'add' && o.type === 'client-session') as Array<{ start: string; end: string }>;
  const satOps = directs.filter(o => new Date(o.start).getDay() === 6);
  const outOfWindow = directs.filter(o => {
    const d = new Date(o.start), e = new Date(o.end), day = d.getDay();
    if (day === 0 || day === 6) return true;
    const sMin = d.getHours() * 60 + d.getMinutes(), eMin = e.getHours() * 60 + e.getMinutes();
    return !(sMin >= 10 * 60 && eMin <= 14 * 60);
  });
  check('directs materialized despite the unresolved tech ref', directs.length > 0, `n=${directs.length}`);
  check('completed Saturday session (unresolved tech) is NOT cloned forward', satOps.length === 0, `sat=${satOps.length}`);
  check('no direct falls outside the client 10:00-14:00 window', outOfWindow.length === 0, JSON.stringify(outOfWindow.slice(0, 3)));
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
  // Re-name every counting session (supervision AND parent-training — a combined
  // build now places both, and both earn credit only via their named BT) to a tech
  // that serves nobody → overlap credit must vanish.
  const mutated: ScheduleData = { ...committed, appointments: committed.appointments.map(a => (a.type === 'supervision' || a.type === 'parent-training') ? { ...a, technician: 'Ghost Tech' } : a) };
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
  // Materialized appointments are id-linked (the add path normalizes refs to ids).
  const kiloId = committed.clients.find(c => c.name === 'Client Kilo')?.id;
  const beaId = committed.technicians.find(t => t.name === 'Bea Behind')?.id;
  const kiloSups = committed.appointments.filter(a => a.type === 'supervision' && a.client === kiloId);
  check('a Client Kilo supervision names the behind RBT despite its later day', kiloSups.some(s => s.technician === beaId), JSON.stringify(kiloSups.map(s => s.technician)));
}

console.log('standalone: Build supervision over EXISTING materialized directs');
{
  const c1 = client('c1', 'Client Mike', daysWindows(['Monday', 'Tuesday', 'Wednesday'], '08:00', '16:00'), 'W');
  const t1 = tech('t1', 'Mae Aide', WIDE_CLIN, [{ clientId: 'c1', hoursPerWeek: 40, billable: true }]);
  const fresh = schedule([c1], [t1], [auth('c1', 10)], baseSettings(WIDE_CLIN));
  // First accept a direct build → the schedule now holds DATED (materialized) directs.
  const withDirects = run(fresh, defaultBuilderConfig(fresh, NOW)).committed;
  const directRows = withDirects.appointments.filter(a => a.type === 'client-session');
  check('a direct build leaves dated (materialized) direct rows, not recurring', directRows.length > 1 && directRows.every(a => !a.isRecurring));

  const { result, committed } = run(withDirects, supervisionBuilderConfig(withDirects, NOW));
  check('standalone build ran supervision only (not direct)', result.metrics.supervisionBuilt && !result.metrics.directBuilt);
  check('supervision hours were placed over existing directs', result.metrics.supervisionHrsPlaced > 0, String(result.metrics.supervisionHrsPlaced));
  const dH = clientDirectH(committed, 'Client Mike');
  const sH = clientSupH(committed, 'Client Mike');
  check('the month slice of existing directs reads ~4 weeks (no double-count)', dH >= 38 && dH <= 42, `directH=${dH}`);
  check('committed supervision reaches the corrected floor', sH >= dH * 0.10 - 0.01, `supH=${sH.toFixed(2)} floorH=${(dH * 0.10).toFixed(2)}`);
}

console.log('off switch: chaseSupervision:false === a plain (materialized) direct build');
{
  const c1 = client('c1', 'Client November', daysWindows(['Monday', 'Tuesday'], '08:00', '16:00'), 'W');
  const t1 = tech('t1', 'Ned Aide', WIDE_CLIN, [{ clientId: 'c1', hoursPerWeek: 40, billable: true }]);
  const base = schedule([c1], [t1], [auth('c1', 8)], baseSettings(WIDE_CLIN));
  const cfg = defaultBuilderConfig(base, NOW);
  const off = buildSchedule(base, { ...cfg, chaseSupervision: false }, NOW);
  const plain = buildSchedule(base, cfg, NOW);
  check('ops identical with chaseSupervision:false vs unset', JSON.stringify(off.solution.ops) === JSON.stringify(plain.solution.ops));
  check('no supervision ops emitted when off', off.solution.ops.every(o => !(o.op === 'add' && o.type === 'supervision')));
  check('direct ops are dated (materialized), not recurring, when supervision is off', off.solution.ops.every(o => o.op === 'add' && o.type === 'client-session' && !o.recurring));
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

// ── Scored placement (schedulingHints) ───────────────────────────────────────

console.log('hint split+midday (the AB case): two midday sub-contacts on different days');
{
  // Directs Mon+Wed 09:00-13:00; hint says split + midday. Expect each week to
  // get TWO sub-contacts, band-anchored at 11:00, on two DIFFERENT days — and
  // the credit to be real.
  const c1: Client = {
    ...client('c1', 'Client Split', daysWindows(['Monday', 'Wednesday'], '09:00', '13:00')),
    disablePTRequirements: true,
    schedulingHints: { supervisionStyle: 'split', preferredDaypart: 'midday' },
  };
  const t1 = tech('t1', 'Sal Aide', WIDE_CLIN, [{ clientId: 'c1', hoursPerWeek: 40, billable: true }]);
  const base = schedule([c1], [t1], [auth('c1', 8)], baseSettings(WIDE_CLIN));
  const { committed, result } = run(base, combinedBuilderConfig(base, NOW));
  const sups = supAppts(committed);
  const week0 = sups.filter(s => weekOf(s.startTime) === 0);
  check('split hint: week 0 has exactly two sub-contacts', week0.length === 2, `n=${week0.length}`);
  check('split hint: the two land on different days', new Set(week0.map(s => new Date(s.startTime).getDay())).size === 2,
    JSON.stringify(week0.map(s => s.startTime)));
  check('split hint: every sub-contact is ≥ the 15-min minimum', sups.every(s => durH(s) >= 0.25 - 1e-9),
    JSON.stringify(sups.map(durH)));
  check('split hint: sub-contacts anchor at the midday band (11:00)', week0.every(s => new Date(s.startTime).getHours() === 11),
    JSON.stringify(week0.map(s => s.startTime)));
  const floorH = clientDirectH(committed, 'Client Split') * 0.10;
  check('split hint: floor met with real credit', clientSupH(committed, 'Client Split') >= floorH - 0.01,
    `sup=${clientSupH(committed, 'Client Split')} floor=${floorH}`);
  check('split hint: no supervision shortfall block', !result.blocks.some(b => b.clientId === 'c1' && b.bindingConstraint === 'bcba-availability'));
}

console.log('auto default: a roomy week still gets ONE consolidated contact');
{
  const c1: Client = {
    ...client('c1', 'Client Whole', daysWindows(['Monday', 'Wednesday'], '09:00', '13:00')),
    disablePTRequirements: true,
  };
  const t1 = tech('t1', 'Wes Aide', WIDE_CLIN, [{ clientId: 'c1', hoursPerWeek: 40, billable: true }]);
  const base = schedule([c1], [t1], [auth('c1', 8)], baseSettings(WIDE_CLIN));
  const { committed } = run(base, combinedBuilderConfig(base, NOW));
  const sups = supAppts(committed);
  const perWeek = new Map<number, number>();
  for (const s of sups) perWeek.set(weekOf(s.startTime), (perWeek.get(weekOf(s.startTime)) ?? 0) + 1);
  check('auto: exactly one contact per placed week (no fragmentation)', [...perWeek.values()].every(n => n === 1),
    JSON.stringify([...perWeek.entries()]));
  check('auto: no sub-minimum fragments', sups.every(s => durH(s) >= 0.25 - 1e-9), JSON.stringify(sups.map(durH)));
}

console.log('auto-split recovery: hours the old first-fit silently truncated get placed');
{
  // BCBA availability is two 1h windows (Mon + Tue) against a front-loaded
  // ~1.4-1.6h/week target: no single gap fits whole → auto splits across both
  // and the client reaches the floor (the old first-fit placed only the first
  // window each week and blocked the rest). Sizing keeps every week's split
  // residual ≥ the 15-min schedulable minimum.
  const clin = { Monday: [{ start: '09:00', end: '10:00' }], Tuesday: [{ start: '09:00', end: '10:00' }] };
  const c1: Client = {
    ...client('c1', 'Client Recover', daysWindows(['Monday', 'Tuesday', 'Wednesday'], '08:00', '16:00')),
    disablePTRequirements: true,
  };
  const t1 = tech('t1', 'Rea Aide', WIDE_CLIN, [{ clientId: 'c1', hoursPerWeek: 40, billable: true }]);
  const base = schedule([c1], [t1], [auth('c1', 15)], baseSettings(clin));
  const { committed, result } = run(base, combinedBuilderConfig(base, NOW));
  const sups = supAppts(committed);
  const week0 = sups.filter(s => weekOf(s.startTime) === 0);
  check('recovery: week 0 places two sub-contacts across the two small windows', week0.length === 2, `n=${week0.length}`);
  const floorH = clientDirectH(committed, 'Client Recover') * 0.10;
  check('recovery: floor met (old first-fit fell short here)', clientSupH(committed, 'Client Recover') >= floorH - 0.01,
    `sup=${clientSupH(committed, 'Client Recover')} floor=${floorH}`);
  check('recovery: no supervision shortfall block', !result.blocks.some(b => b.clientId === 'c1' && b.bindingConstraint === 'bcba-availability'));
}

console.log('consolidate hint: one visit even when the week cannot fit it whole');
{
  const clin = { Monday: [{ start: '09:00', end: '09:45' }], Tuesday: [{ start: '09:00', end: '09:30' }] };
  const c1: Client = {
    ...client('c1', 'Client OneBlock', daysWindows(['Monday', 'Tuesday', 'Wednesday'], '08:00', '16:00')),
    disablePTRequirements: true,
    schedulingHints: { supervisionStyle: 'consolidate' },
  };
  const t1 = tech('t1', 'Ona Aide', WIDE_CLIN, [{ clientId: 'c1', hoursPerWeek: 40, billable: true }]);
  const base = schedule([c1], [t1], [auth('c1', 12)], baseSettings(clin));
  const { committed, result } = run(base, combinedBuilderConfig(base, NOW));
  const sups = supAppts(committed);
  const perWeek = new Map<number, number>();
  for (const s of sups) perWeek.set(weekOf(s.startTime), (perWeek.get(weekOf(s.startTime)) ?? 0) + 1);
  check('consolidate: never splits a week', [...perWeek.values()].every(n => n === 1), JSON.stringify([...perWeek.entries()]));
  check('consolidate: takes the biggest single block (45 min)', supAppts(committed).every(s => Math.abs(durH(s) - 0.75) < 1e-9),
    JSON.stringify(sups.map(durH)));
  check('consolidate: the unreachable residual is reported honestly',
    result.blocks.some(b => b.clientId === 'c1' && b.bindingConstraint === 'bcba-availability'));
}

console.log('travel adjacency: at equal need, the direct wedged between same-city blocks wins');
{
  // Week 0 candidates: a Monday direct sandwiched between two B-town BCBA blocks
  // (big detour) and a Tuesday direct sandwiched between two A-town blocks
  // (within-city floor only). Same tech (equal btBehind) → travel breaks the tie.
  const st = baseSettings(WIDE_CLIN);
  st.travel = { enabled: true, withinCityMin: 15, padPercent: 0, avgSpeedMph: 30, defaultUnknownMin: 45, hourBucketSize: 1 };
  st.cityCenters = [{ city: 'a town', lat: 40.0, lng: -75.0 }, { city: 'b town', lat: 40.5, lng: -75.5 }];
  st.homeBase = { lat: 40.0, lng: -75.0 };
  const cv: Client = {
    ...client('cv', 'Client Vera', daysWindows(['Monday', 'Tuesday'], '10:00', '12:00')),
    disablePTRequirements: true, city: 'A Town',
  };
  const cw: Client = { ...client('cw', 'Client Far', {}), city: 'B Town', disablePTRequirements: true };
  const cu: Client = { ...client('cu', 'Client Near', {}), city: 'A Town', disablePTRequirements: true };
  const t1 = tech('t1', 'Vic Aide', WIDE_CLIN, [{ clientId: 'cv', hoursPerWeek: 40, billable: true }]);
  const mkSup = (id: string, clientId: string, day: string, s: string, e: string): Appointment => ({
    id, title: 'Supervision', client: clientId, technician: '', type: 'supervision',
    startTime: `${day}T${s}:00`, endTime: `${day}T${e}:00`, isFixed: true, isBillable: true, isRecurring: false, status: 'scheduled',
  });
  const base = schedule([cv, cw, cu], [t1], [auth('cv', 8)], st, [
    mkSup('x1', 'cw', '2026-07-06', '08:00', '09:00'),  // Mon morning, B town
    mkSup('x2', 'cw', '2026-07-06', '13:00', '14:00'),  // Mon afternoon, B town
    mkSup('x3', 'cu', '2026-07-07', '08:00', '09:00'),  // Tue morning, A town
    mkSup('x4', 'cu', '2026-07-07', '13:00', '14:00'),  // Tue afternoon, A town
  ]);
  const { committed } = run(base, combinedBuilderConfig(base, NOW));
  const week0 = supAppts(committed).filter(s => weekOf(s.startTime) === 0 && (s.client === 'cv' || s.client === 'Client Vera'));
  check('travel: week 0 supervision hosted on the same-city day (Tuesday)',
    week0.length > 0 && week0.every(s => new Date(s.startTime).getDay() === 2),
    JSON.stringify(week0.map(s => s.startTime)));
}

console.log('overlap-fix: a standalone supervision build hosts ONLY over concrete directs — never a phantom future-week occurrence');
{
  // One RECURRING concrete direct on Monday week 0. buildDirectCalendar would
  // materialize future Mondays (Source B) as hosts; the supervision-only build must
  // ignore those (they are never committed) and stage no new direct rows.
  const c = client('c1', 'Rec Case', WIDE_CLIN, 'W');
  const t = tech('t1', 'Aide', WIDE_CLIN, [{ clientId: 'c1', hoursPerWeek: 20, billable: true }]);
  const d0: Appointment = { id: 'd0', title: 'Direct', client: 'c1', technician: 't1', type: 'client-session', startTime: '2026-07-06T09:00:00', endTime: '2026-07-06T13:00:00', isFixed: false, isBillable: true, isRecurring: true, status: 'scheduled' };
  const base = schedule([c], [t], [auth('c1', 20)], baseSettings(WIDE_CLIN), [d0]);
  const { committed, staged } = run(base, supervisionBuilderConfig(base, NOW));
  const newDirects = staged.filter((o: any) => o.op === 'add' && o.type === 'client-session');
  check('supervision-only build stages ZERO new direct rows', newDirects.length === 0, `staged ${newDirects.length}`);
  const dirs = directAppts(committed).filter(a => a.client === 'c1' || a.client === 'Rec Case');
  const sups = supAppts(committed).filter(a => a.client === 'c1' || a.client === 'Rec Case');
  const overlapsDirect = (s: Appointment) => dirs.some(dd => new Date(dd.startTime).getTime() < new Date(s.endTime).getTime() && new Date(s.startTime).getTime() < new Date(dd.endTime).getTime());
  check('every placed supervision overlaps a concrete direct (0-credit bug fixed)', sups.length > 0 && sups.every(overlapsDirect), `${sups.filter(s => !overlapsDirect(s)).length} off-direct of ${sups.length}`);
}

console.log('series: builder supervision shares one editable seriesId per case (This / Following / All)');
{
  const c = client('c1', 'Case One', WIDE_CLIN, 'W');
  const t = tech('t1', 'Aide', WIDE_CLIN, [{ clientId: 'c1', hoursPerWeek: 30, billable: true }]);
  const base = schedule([c], [t], [auth('c1', 30)], baseSettings(WIDE_CLIN), []);
  const { committed } = run(base, combinedBuilderConfig(base, NOW));
  const sups = supAppts(committed).filter(a => a.client === 'c1' || a.client === 'Case One');
  check('supervision placed for the case', sups.length >= 1, `count ${sups.length}`);
  const ids = new Set(sups.map(s => s.seriesId));
  check('all of the case’s supervision share ONE seriesId', ids.size === 1 && !ids.has(undefined), `ids=${[...ids].join(',')}`);
  check('supervision is marked recurring with a pattern', sups.every(s => s.isRecurring && !!s.recurringPattern));
}

console.log('archived: an archived case is skipped by every build pass, even with pre-archive directs this month');
{
  const active: Client = client('c1', 'Active Ann', WIDE_CLIN);
  const gone: Client = { ...client('ar', 'Archie Gone', WIDE_CLIN), archived: true };
  const t1 = tech('t1', 'Aide', WIDE_CLIN, [
    { clientId: 'c1', hoursPerWeek: 40, billable: true },
    { clientId: 'ar', hoursPerWeek: 40, billable: true },
  ]);
  // A direct from earlier this month, kept because it predates the archive — its
  // presence is exactly what used to trick the supervision/PT passes into acting.
  const preArchive: Appointment = {
    id: 'd0', title: 'Direct', client: 'ar', technician: 't1', type: 'client-session',
    startTime: '2026-07-06T09:00:00', endTime: '2026-07-06T12:00:00',
    isFixed: true, isBillable: true, isRecurring: false, status: 'completed',
  };
  const base = schedule([active, gone], [t1], [auth('c1', 10), auth('ar', 10)], baseSettings(WIDE_CLIN), [preArchive]);
  const { committed } = run(base, combinedBuilderConfig(base, NOW));
  const forGone = (t: string) => committed.appointments.filter(a => a.type === t && (a.client === 'ar' || a.client === 'Archie Gone'));
  check('archived: no supervision built for the archived case', forGone('supervision').length === 0, `sup=${forGone('supervision').length}`);
  check('archived: no parent-training built for the archived case', forGone('parent-training').length === 0, `pt=${forGone('parent-training').length}`);
  check('archived: no NEW directs built for the archived case (only the seeded one remains)', forGone('client-session').length === 1, `dir=${forGone('client-session').length}`);
  check('archived: the active case is unaffected (still supervised)', committed.appointments.some(a => a.type === 'supervision' && (a.client === 'c1' || a.client === 'Active Ann')));
}

console.log(`\n${failed === 0 ? 'ALL PASS' : 'FAILURES'} — ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
