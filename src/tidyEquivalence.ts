// Semantic-equivalence oracle for the Tidy / Doctor pass.
//
// A tidy op MUST produce a behaviorally identical schedule — only tidier. This
// module is the authority that PROVES it: given a `before` and `after` schedule
// (and a FIXED `now`), it diffs the quantities that define what a schedule
// "means" and reports every divergence. If it returns { equivalent: false }, the
// op is not equivalent and must never be auto-applied (see src/tidy.ts).
//
// The sufficient diff set (see docs/schedule-tidy-stub.md + the plan):
//   A. Reused from compliance.ts — captures per-client/tech direct hours, all
//      supervision/PT/reassessment CREDIT, % and statuses, per calendar month:
//        computeClientCompliance / computeTechCompliance / computeTechContactDays
//   B. Fresh, to make A *sufficient* (A alone is necessary but not sufficient):
//        - per-entity per-day time-COVERAGE union (directHours is a plain sum with
//          no overlap dedupe, so a reshuffle that keeps hours but shifts coverage
//          would slip past A) — via intervals.normalize.
//        - bt/bcba × status hour rollups (catches a bucketOf flip that nets out).
//        - a records-of-fact multiset (completed/canceled rows must be byte-identical).
//
// `now` MUST be held fixed across the before/after runs — compliance splits
// actual vs projected on `now`, so a moving clock would create phantom diffs.

import { ScheduleData, Appointment } from './types';
import {
  computeClientCompliance, computeTechCompliance, computeTechContactDays,
  monthPeriod, CompliancePeriod, ClientComplianceMetrics, TechComplianceMetrics,
} from './compliance';
import { rollupHours, HoursByStatus } from './utilization';
import { normalize, Interval } from './intervals';

export interface EquivDiff { kind: string; detail: string; }
export interface EquivReport { equivalent: boolean; diffs: EquivDiff[]; }

const EPS = 1e-6;
const near = (a: number, b: number): boolean => Math.abs(a - b) < EPS;
const nearOpt = (a: number | undefined, b: number | undefined): boolean => near(a ?? 0, b ?? 0);

// Every calendar month touched by either schedule. Compliance is month-scoped, so
// the oracle must diff each spanned month independently.
function spannedMonths(before: Appointment[], after: Appointment[]): CompliancePeriod[] {
  const keys = new Set<string>();
  for (const a of [...before, ...after]) {
    const d = new Date(a.startTime);
    if (Number.isNaN(d.getTime())) continue;
    keys.add(`${d.getFullYear()}-${d.getMonth()}`);
  }
  return [...keys].map(k => {
    const [y, m] = k.split('-').map(Number);
    return monthPeriod(new Date(y, m, 1));
  });
}

// id → canonical id (mirrors compliance.ts resolvers). References are immutable ids;
// the fallback returns the ref unchanged for a not-yet-healed orphan.
function makeResolver(entities: { id: string; name: string }[]): (ref?: string) => string | undefined {
  const byId = new Map(entities.map(e => [e.id, e.id]));
  return (ref?: string) => (ref ? (byId.get(ref) ?? ref) : undefined);
}

// Total covered minutes per (participant, day) — the union of a participant's
// non-canceled session intervals on a day, so overlaps/duplicates collapse. Keyed
// on the start date; ABA sessions never cross midnight.
function coverageMap(data: ScheduleData): Map<string, number> {
  const resolveClient = makeResolver(data.clients);
  const resolveTech = makeResolver(data.technicians);
  const buckets = new Map<string, Interval[]>();
  const push = (key: string, iv: Interval) => {
    const arr = buckets.get(key);
    if (arr) arr.push(iv); else buckets.set(key, [iv]);
  };
  for (const a of data.appointments) {
    if (a.isGhost || a.status === 'canceled') continue;
    const s = new Date(a.startTime).getTime();
    const e = new Date(a.endTime).getTime();
    if (Number.isNaN(s) || Number.isNaN(e) || e <= s) continue;
    const day = a.startTime.slice(0, 10);
    const iv: Interval = { start: s / 60_000, end: e / 60_000 };
    const cid = resolveClient(a.client);
    const tid = resolveTech(a.technician);
    if (cid) push(`client:${cid}:${day}`, iv);
    if (tid) push(`tech:${tid}:${day}`, iv);
  }
  const out = new Map<string, number>();
  for (const [k, ints] of buckets) {
    out.set(k, normalize(ints).reduce((sum, i) => sum + (i.end - i.start), 0));
  }
  return out;
}

// Byte-stable signature for a "record of fact" (completed / canceled). Tidy must
// never touch these; the multiset must be identical before/after.
function factSignatures(appts: Appointment[]): string[] {
  return appts
    .filter(a => a.status === 'completed' || a.status === 'canceled')
    .map(a => JSON.stringify([
      a.id, a.client, a.technician, a.startTime, a.endTime, a.type, a.status,
      a.isBillable, a.isFixed, a.isMakeUp, a.makeupForId, a.seriesId,
      a.isRecurring, a.recurringPattern, a.cancellation,
    ]))
    .sort();
}

function compareClient(b: ClientComplianceMetrics, a: ClientComplianceMetrics, ctx: string, diffs: EquivDiff[]): void {
  const fields: (keyof ClientComplianceMetrics)[] = ['directHours', 'supervisionHours', 'requiredHours', 'pct', 'hoursToGo'];
  for (const f of fields) {
    if (!near(b[f], a[f])) diffs.push({ kind: 'client-compliance', detail: `${ctx} ${f}: ${b[f].toFixed(3)}→${a[f].toFixed(3)}` });
  }
}

function compareTech(b: TechComplianceMetrics, a: TechComplianceMetrics, ctx: string, diffs: EquivDiff[]): void {
  const num: (keyof TechComplianceMetrics)[] = ['directHours', 'supervisionHours', 'pct', 'companyRequiredPct', 'companyRequiredHours', 'companyHoursToGo'];
  for (const f of num) {
    if (!near(b[f] as number, a[f] as number)) diffs.push({ kind: 'tech-compliance', detail: `${ctx} ${f}: ${(b[f] as number).toFixed(3)}→${(a[f] as number).toFixed(3)}` });
  }
  if (!nearOpt(b.bacbRequiredHours, a.bacbRequiredHours)) diffs.push({ kind: 'tech-compliance', detail: `${ctx} bacbRequiredHours` });
  if (!nearOpt(b.bacbHoursToGo, a.bacbHoursToGo)) diffs.push({ kind: 'tech-compliance', detail: `${ctx} bacbHoursToGo` });
}

/**
 * Prove that `after` is behaviorally identical to `before`. `now` must match the
 * value used to generate `after` (compliance's actual/projected split depends on it).
 */
export function checkEquivalence(before: ScheduleData, after: ScheduleData, now: Date): EquivReport {
  const diffs: EquivDiff[] = [];
  const months = spannedMonths(before.appointments, after.appointments);

  for (const period of months) {
    // A — compliance (per-client, per-tech, contact-days), both scopes.
    const cBefore = new Map(computeClientCompliance(before, period, now).map(c => [c.client.id, c]));
    for (const ca of computeClientCompliance(after, period, now)) {
      const cb = cBefore.get(ca.client.id);
      if (!cb) { diffs.push({ kind: 'client-missing', detail: `${period.label} ${ca.client.id}` }); continue; }
      compareClient(cb.actual, ca.actual, `${period.label} client ${ca.client.id} actual`, diffs);
      compareClient(cb.projected, ca.projected, `${period.label} client ${ca.client.id} proj`, diffs);
    }

    const tBefore = new Map(computeTechCompliance(before, period, now).map(t => [t.tech.id, t]));
    for (const ta of computeTechCompliance(after, period, now)) {
      const tb = tBefore.get(ta.tech.id);
      if (!tb) { diffs.push({ kind: 'tech-missing', detail: `${period.label} ${ta.tech.id}` }); continue; }
      compareTech(tb.actual, ta.actual, `${period.label} tech ${ta.tech.id} actual`, diffs);
      compareTech(tb.projected, ta.projected, `${period.label} tech ${ta.tech.id} proj`, diffs);
      for (const scope of ['actual', 'projected'] as const) {
        const db = computeTechContactDays(before, ta.tech, period, scope, now);
        const da = computeTechContactDays(after, ta.tech, period, scope, now);
        if (db !== da) diffs.push({ kind: 'contact-days', detail: `${period.label} tech ${ta.tech.id} ${scope}: ${db}→${da}` });
      }
    }

    // B — bt/bcba × status rollups per month.
    const startMs = period.start.getTime(), endMs = period.end.getTime();
    for (const bucket of ['bt', 'bcba'] as const) {
      const rb = rollupHours(before.appointments, startMs, endMs, bucket);
      const ra = rollupHours(after.appointments, startMs, endMs, bucket);
      for (const f of Object.keys(rb) as (keyof HoursByStatus)[]) {
        if (!near(rb[f], ra[f])) diffs.push({ kind: 'rollup', detail: `${period.label} ${bucket}.${f}: ${rb[f].toFixed(3)}→${ra[f].toFixed(3)}` });
      }
    }
  }

  // B — per-day coverage union (month-independent; keyed by day).
  const covB = coverageMap(before), covA = coverageMap(after);
  for (const key of new Set([...covB.keys(), ...covA.keys()])) {
    const b = covB.get(key) ?? 0, a = covA.get(key) ?? 0;
    if (!near(a, b)) diffs.push({ kind: 'coverage', detail: `${key}: ${b.toFixed(2)}→${a.toFixed(2)} min` });
  }

  // B — records of fact untouched.
  const fb = factSignatures(before.appointments), fa = factSignatures(after.appointments);
  if (fb.length !== fa.length || fb.some((s, i) => s !== fa[i])) {
    diffs.push({ kind: 'records-of-fact', detail: `completed/canceled multiset changed (${fb.length}→${fa.length})` });
  }

  return { equivalent: diffs.length === 0, diffs };
}

// A one-line human summary of the first few diffs, for a suggestion's metric badge.
export function summarizeDiffs(diffs: EquivDiff[], max = 2): string {
  if (!diffs.length) return '';
  const head = diffs.slice(0, max).map(d => d.detail).join('; ');
  return diffs.length > max ? `${head}; +${diffs.length - max} more` : head;
}
