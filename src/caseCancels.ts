// Per-case cancellation aggregation for the Cases home-screen table.
//
// The appointment-anchored engine in cancelStats.ts answers "how much pressure
// is on THIS canceled appointment". The table needs the orthogonal view: for a
// CASE, how many cancellations does each entity (Family, each BT, and the
// Admin/BCBA roll-up) own — across four trailing windows, broken down by
// appointment type. Built on the same countInWindow primitive + the BCBA's
// source attribution (bt / family / admin / bcba).

import { Appointment, Client, ScheduleData, Technician } from './types';
import { countInWindow } from './cancelStats';

export type CancelWindow = 'r60' | 'r30' | 'mtd' | 'wtd';
export const CANCEL_WINDOWS: CancelWindow[] = ['r60', 'r30', 'mtd', 'wtd'];
export const CANCEL_WINDOW_LABELS: Record<CancelWindow, string> = {
  r60: '60d', r30: '30d', mtd: 'Mo', wtd: 'Wk',
};
// The window shown in the compact table cell (the popover shows all four).
export const CANCEL_HEADLINE_WINDOW: CancelWindow = 'r30';

export type CancelEntityKind = 'family' | 'bt' | 'adminBcba';

export interface EntityCancels {
  key: string;            // 'F' | tech.id | 'ADMIN'
  label: string;          // 'F' | BT initials | 'A/B'
  kind: CancelEntityKind;
  totals: Record<CancelWindow, number>;
  byType: Record<CancelWindow, Partial<Record<Appointment['type'], number>>>;
}

export interface CaseCancelSummary {
  clientId: string;
  family: EntityCancels;
  bts: EntityCancels[];       // assigned BTs + any BT with cancels on this case
  adminBcba: EntityCancels;   // admin + bcba rolled up
}

const TYPE_ABBR: Partial<Record<Appointment['type'], string>> = {
  'client-session': 'Dir', 'supervision': 'Sup', 'parent-training': 'PT',
  'case-planning': 'CP', 'reassessment': 'RA', 'internal-task': 'Int', 'other': 'Oth',
};
export function cancelTypeAbbr(t: Appointment['type']): string {
  return TYPE_ABBR[t] ?? t;
}

// 0 grey · 1–2 yellow · 3–4 orange · 5+ red — matches the compliance palette.
export function cancelSeverityColor(n: number): string {
  if (n <= 0) return '#9ca3af';
  if (n <= 2) return '#a16207';
  if (n <= 4) return 'var(--status-over)';
  return 'var(--status-behind)';
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Trailing day-spans, all anchored at `now` (inclusive). Month/week to-date are
// expressed as a day count back to the 1st / the Sunday, so the same
// countInWindow([asOf-(n-1), asOf]) primitive serves all four.
function windowDayCounts(now: Date): Record<CancelWindow, number> {
  return { r60: 60, r30: 30, mtd: now.getDate(), wtd: now.getDay() + 1 };
}

const matchesClient = (a: Appointment, client: Client): boolean =>
  a.client === client.id || a.client === client.name;
const matchesTech = (a: Appointment, tech: Technician): boolean =>
  a.technician === tech.id;

export function initials(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function buildEntity(
  key: string, label: string, kind: CancelEntityKind,
  cancels: Appointment[], asOf: string, wd: Record<CancelWindow, number>,
): EntityCancels {
  const allDates = cancels.map(a => a.startTime.slice(0, 10));
  const datesByType = new Map<Appointment['type'], string[]>();
  for (const a of cancels) {
    const list = datesByType.get(a.type) || [];
    list.push(a.startTime.slice(0, 10));
    datesByType.set(a.type, list);
  }

  const totals = {} as Record<CancelWindow, number>;
  const byType = {} as Record<CancelWindow, Partial<Record<Appointment['type'], number>>>;
  for (const w of CANCEL_WINDOWS) {
    totals[w] = countInWindow(allDates, asOf, wd[w]);
    const tmap: Partial<Record<Appointment['type'], number>> = {};
    for (const [type, dates] of datesByType) {
      const n = countInWindow(dates, asOf, wd[w]);
      if (n > 0) tmap[type] = n;
    }
    byType[w] = tmap;
  }
  return { key, label, kind, totals, byType };
}

export function computeOneCaseCancels(
  data: ScheduleData, client: Client, now: Date = new Date(),
): CaseCancelSummary {
  const asOf = ymd(now);
  const wd = windowDayCounts(now);

  const cancels = data.appointments.filter(a =>
    a.status === 'canceled' && a.cancellation && !a.isGhost && matchesClient(a, client),
  );
  const familyCancels = cancels.filter(a => a.cancellation!.source === 'family');
  const adminCancels = cancels.filter(a => a.cancellation!.source === 'admin' || a.cancellation!.source === 'bcba');
  const btCancels = cancels.filter(a => a.cancellation!.source === 'bt');

  // BTs to show: those assigned to the case, plus any BT that has a cancel on
  // it (so a departed/covering tech's cancels aren't lost). Assigned first.
  const assigned = data.technicians.filter(t =>
    (t.assignments || []).some(as => as.clientId === client.id || as.clientId === client.name),
  );
  const seen = new Set(assigned.map(t => t.id));
  const extras: Technician[] = [];
  for (const a of btCancels) {
    const t = data.technicians.find(x => x.id === a.technician);
    if (t && !seen.has(t.id)) { seen.add(t.id); extras.push(t); }
  }
  const techs = [...assigned, ...extras];

  return {
    clientId: client.id,
    family: buildEntity('F', 'F', 'family', familyCancels, asOf, wd),
    bts: techs.map(t =>
      buildEntity(t.id, initials(t.name), 'bt', btCancels.filter(a => matchesTech(a, t)), asOf, wd),
    ),
    adminBcba: buildEntity('ADMIN', 'A/B', 'adminBcba', adminCancels, asOf, wd),
  };
}

export function computeCaseCancels(
  data: ScheduleData, now: Date = new Date(),
): Map<string, CaseCancelSummary> {
  const out = new Map<string, CaseCancelSummary>();
  for (const c of data.clients) out.set(c.id, computeOneCaseCancels(data, c, now));
  return out;
}
