// Incremental supervision-compliance cache.
//
// The Compliance dashboard used to recompute every client × every technician
// on each render. That's wasteful: editing one appointment can only change the
// compliance of the handful of clients/techs that appointment touches. This
// module keeps a per-entity cache for the *current month* and, on each
// appointment mutation, recomputes only the affected entities — so a live
// status badge can update instantly (even off the Compliance tab) without a
// full pass.

import {
  ClientCompliance, TechCompliance, TechComplianceMetrics, CompliancePeriod,
  computeOneClientCompliance, computeOneTechCompliance, monthPeriod, overlapHours,
} from './compliance';
import { Appointment, ScheduleData, CompanySettings } from './types';

export interface ComplianceCache {
  period: CompliancePeriod;
  now: Date;
  clients: Map<string, ClientCompliance>;
  techs: Map<string, TechCompliance>;
}

// A single appointment mutation, expressed as its state before and after the
// change. Either side may be absent (add → no `before`; delete → no `after`).
export interface ApptChange {
  before?: Appointment;
  after?: Appointment;
}

// Full pass — used on initial load and whenever the roster/settings change
// (which can shift many entities at once). Anchored to the current month.
export function buildCache(data: ScheduleData, now: Date = new Date()): ComplianceCache {
  const period = monthPeriod(now);
  const clients = new Map<string, ClientCompliance>();
  const techs = new Map<string, TechCompliance>();
  for (const c of data.clients) { if (c.archived) continue; clients.set(c.id, computeOneClientCompliance(data, c, period, now)); }
  for (const t of data.technicians) techs.set(t.id, computeOneTechCompliance(data, t, period, now));
  return { period, now, clients, techs };
}

// Which client(s) and technician(s) could have their supervision-compliance
// numbers changed by `appt` (interpreted in the context of `data`)?
//
// Only client-session and supervision appointments enter the supervision math:
//   - client-session(client C, tech T): changes ONLY C's case numbers
//     (denominator + its own supervision overlap) and T's tech numbers.
//   - supervision(client C): changes C's case numbers, AND every tech whose
//     direct session overlaps the supervision window (that supervision counts
//     toward the tech's numerator regardless of the supervision's tagged client).
// Other types don't affect supervision compliance, so they resolve to nothing.
export function affectedEntities(
  appt: Appointment,
  data: ScheduleData,
): { clientIds: Set<string>; techIds: Set<string> } {
  const clientIds = new Set<string>();
  const techIds = new Set<string>();
  // Ghosts never enter the supervision math, so they touch no entities.
  if (appt.isGhost) return { clientIds, techIds };
  const client = data.clients.find(c => c.id === appt.client);

  if (appt.type === 'client-session') {
    if (client) clientIds.add(client.id);
    const tech = data.technicians.find(t => t.id === appt.technician);
    if (tech) techIds.add(tech.id);
  } else if (appt.type === 'supervision') {
    if (client) clientIds.add(client.id);
    for (const d of data.appointments) {
      if (d.type !== 'client-session' || d.isGhost) continue;
      if (overlapHours(appt, d) <= 0) continue;
      const tech = data.technicians.find(t => t.id === d.technician);
      if (tech) techIds.add(tech.id);
    }
  }
  return { clientIds, techIds };
}

// Incremental update: recompute only the entities touched by `changes`.
//
// `oldData` is the schedule BEFORE the mutation, `newData` is AFTER. The
// "before" appointment states are resolved against `oldData` (e.g. a deleted
// supervision is gone from `newData`, so its overlapping techs can only be
// found in `oldData`); the "after" states against `newData`. Both sets are
// unioned, then recomputed against `newData`.
export function recomputeCache(
  prev: ComplianceCache | null,
  oldData: ScheduleData,
  newData: ScheduleData,
  changes: ApptChange[],
  now: Date = new Date(),
): ComplianceCache {
  // If there's no cache yet, or the month rolled over since it was built, a
  // full pass is both necessary and correct.
  if (!prev || !sameMonth(prev.period, monthPeriod(now))) {
    return buildCache(newData, now);
  }

  const clientIds = new Set<string>();
  const techIds = new Set<string>();
  for (const ch of changes) {
    if (ch.before) {
      const a = affectedEntities(ch.before, oldData);
      a.clientIds.forEach(id => clientIds.add(id));
      a.techIds.forEach(id => techIds.add(id));
    }
    if (ch.after) {
      const a = affectedEntities(ch.after, newData);
      a.clientIds.forEach(id => clientIds.add(id));
      a.techIds.forEach(id => techIds.add(id));
    }
  }

  const clients = new Map(prev.clients);
  const techs = new Map(prev.techs);
  const { period } = prev;

  for (const id of clientIds) {
    const client = newData.clients.find(c => c.id === id);
    if (client) clients.set(id, computeOneClientCompliance(newData, client, period, now));
    else clients.delete(id);
  }
  for (const id of techIds) {
    const tech = newData.technicians.find(t => t.id === id);
    if (tech) techs.set(id, computeOneTechCompliance(newData, tech, period, now));
    else techs.delete(id);
  }

  return { period, now: prev.now, clients, techs };
}

function sameMonth(a: CompliancePeriod, b: CompliancePeriod): boolean {
  return a.start.getTime() === b.start.getTime();
}

// ---- Status helpers (shared by the dashboard and the live header badge) ----

export type ComplianceStatus = 'green' | 'yellow' | 'red' | 'gray';

// Margin around the minimum target: projected within 2 pp of the floor is "Risky."
const RISKY_MARGIN = 2;

export function clientStatus(
  report: ClientCompliance,
  targetPct: number,
  preferredPct: number,
  maxPct?: number,
): ComplianceStatus {
  const { actual, projected } = report;
  if (actual.directHours === 0 && projected.directHours === 0) return 'gray';
  // Both actual and projected below the floor → critical (red).
  if (actual.pct < targetPct && projected.pct < targetPct) return 'red';
  // Projected won't reach the floor (or is uncomfortably close) → risky (red).
  if (projected.pct < targetPct + RISKY_MARGIN) return 'red';
  // Actual is over the insurer cap → warrants attention (yellow).
  if (maxPct !== undefined && actual.pct > maxPct) return 'yellow';
  // Projected lands in the preferred band or better → green.
  return 'green';
}

export function techStatus(report: TechCompliance): ComplianceStatus {
  const { actual, projected, tech } = report;
  if (actual.directHours === 0 && projected.directHours === 0) return 'gray';
  const passes = (m: TechComplianceMetrics) => {
    const bacbOk = !tech.isRBT || (m.bacbHoursToGo ?? 0) === 0;
    return bacbOk && m.companyHoursToGo === 0;
  };
  if (passes(actual)) return 'green';
  if (passes(projected)) return 'yellow';
  return 'red';
}

export interface ComplianceSummary {
  red: number;
  yellow: number;
  worst: ComplianceStatus;
}

// Count entities needing attention, for the "Comp" tab badge. RBT BACB %
// defaults in when the company target isn't set, matching the dashboard.
export function summarize(cache: ComplianceCache, data: ScheduleData): ComplianceSummary {
  const clientTarget = data.settings.supervisionDirectHoursPercent || 5;
  const preferredPct = data.settings.supervisionPreferredMinPercent ?? 15;
  const maxPct = data.settings.supervisionMaxHoursPercent;
  let red = 0;
  let yellow = 0;
  for (const r of cache.clients.values()) {
    const s = clientStatus(r, clientTarget, preferredPct, maxPct);
    if (s === 'red') red++;
    else if (s === 'yellow') yellow++;
  }
  for (const r of cache.techs.values()) {
    const s = techStatus(r);
    if (s === 'red') red++;
    else if (s === 'yellow') yellow++;
  }
  const worst: ComplianceStatus = red > 0 ? 'red' : yellow > 0 ? 'yellow' : 'green';
  return { red, yellow, worst };
}

// ---- Per-entity attention list (drives the dock's per-case issue cards) ----
// Same thresholds as summarize, but returns WHO with a one-line why — so the
// dock can offer a case-scoped fix instead of one aggregate card whose CTA
// only navigates. Clients before techs at equal severity (the case-scoped
// meet-pace fix is client-shaped); worst deficit first within a band.

export interface ComplianceAttention {
  kind: 'client' | 'tech';
  id: string;
  name: string;
  status: 'red' | 'yellow';
  detail: string;      // e.g. "Projected 3.8% vs 5% floor — 1.2h to go this month."
  hoursToGo: number;   // sort key (bigger deficit = more urgent)
}

export function attentionList(cache: ComplianceCache, data: ScheduleData): ComplianceAttention[] {
  return attentionFromReports([...cache.clients.values()], [...cache.techs.values()], data.settings);
}

// Reports-based core — lets the Compliance dashboard build the same red/yellow
// "needs attention" set for the VIEWED month (which may differ from the cache's).
export function attentionFromReports(
  clients: ClientCompliance[],
  techs: TechCompliance[],
  settings: CompanySettings,
): ComplianceAttention[] {
  const clientTarget = settings.supervisionDirectHoursPercent || 5;
  const preferredPct = settings.supervisionPreferredMinPercent ?? 15;
  const maxPct = settings.supervisionMaxHoursPercent;
  const out: ComplianceAttention[] = [];

  for (const r of clients) {
    const s = clientStatus(r, clientTarget, preferredPct, maxPct);
    if (s !== 'red' && s !== 'yellow') continue;
    const toGo = r.projected.hoursToGo;
    const detail = s === 'yellow' && maxPct !== undefined && r.actual.pct > maxPct
      ? `Supervision at ${r.actual.pct.toFixed(1)}% — over the ${maxPct}% insurer cap.`
      : `Projected ${r.projected.pct.toFixed(1)}% vs ${clientTarget}% floor — ${toGo.toFixed(1)}h to go this month.`;
    out.push({ kind: 'client', id: r.client.id, name: r.client.name, status: s, detail, hoursToGo: toGo });
  }
  for (const r of techs) {
    const s = techStatus(r);
    if (s !== 'red' && s !== 'yellow') continue;
    const toGo = Math.max(r.projected.companyHoursToGo, r.tech.isRBT ? (r.projected.bacbHoursToGo ?? 0) : 0);
    out.push({
      kind: 'tech', id: r.tech.id, name: r.tech.name, status: s,
      detail: `${toGo.toFixed(1)}h of supervision to go for ${r.tech.isRBT ? 'the BACB floor / company target' : 'the company target'}.`,
      hoursToGo: toGo,
    });
  }

  return out.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'red' ? -1 : 1;
    if (a.kind !== b.kind) return a.kind === 'client' ? -1 : 1;
    return b.hoursToGo - a.hoursToGo;
  });
}
