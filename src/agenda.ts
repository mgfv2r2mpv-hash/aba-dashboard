// One goal object the whole app reads from.
//
// Before this, the same "off-pace" fact was recomputed on four surfaces — the
// SAssi dock's issue queue, the ZenStrip flag pills, the Home rituals, and the
// nav badge — each walking the compliance cache and re-deriving red/yellow with
// its own slightly-different reduction (`summarize` counted, `attentionList`
// itemized, callers re-added red+yellow). computeAgenda does it ONCE: it turns
// the per-entity compliance reports into a single ordered list of typed gaps plus
// the aggregate target-progress counts every surface needs. No surface owns the
// math anymore; they are thin renderers of this value.
//
// The gap KIND (behind / off-pace / over-served) is a label DERIVED from the
// existing client/tech status thresholds — it changes nothing about how those
// statuses are computed, it just names each red/yellow entity so downstream
// surfaces (and the P4 landing) can group and order them without re-deriving
// intent.

import type { CompanySettings, ScheduleData } from './types';
import type { ClientCompliance, TechCompliance } from './compliance';
import { ComplianceCache, clientStatus, techStatus } from './complianceCache';

/**
 * What kind of attention a gap needs, read straight off the compliance status:
 *   behind      — below the required floor and not projected to reach it (red).
 *   off-pace    — on track by projection but not yet met in actuals (tech yellow).
 *   over-served — above the insurer cap; wants trimming, not adding (client yellow).
 */
export type GapKind = 'behind' | 'off-pace' | 'over-served';

export interface AgendaGap {
  entity: 'client' | 'tech';
  id: string;
  name: string;
  kind: GapKind;
  /** Legacy severity band, kept so the dock can rank error(red) ahead of warning(yellow). */
  status: 'red' | 'yellow';
  detail: string;
  /** Remaining supervision hours to clear the gap — the worst-first sort key. */
  hoursToGo: number;
}

export interface TargetProgress {
  red: number;
  yellow: number;
  /** red + yellow — the "N compliance" every badge counts. Equals gaps.length. */
  attentionCount: number;
}

export interface Agenda {
  targetProgress: TargetProgress;
  /** Red/yellow entities, worst-first: red before yellow, client before tech, bigger deficit first. */
  gaps: AgendaGap[];
}

export const EMPTY_AGENDA: Agenda = {
  targetProgress: { red: 0, yellow: 0, attentionCount: 0 },
  gaps: [],
};

/**
 * The single-pass core: per-entity compliance reports → typed gaps + counts.
 * A faithful port of the old `attentionFromReports` (identical detail strings and
 * ordering) that also carries the gap KIND and derives the aggregate counts from
 * the same pass, so the itemized list and the badge count can never drift.
 * Works on any set of reports, so the Compliance dashboard can build the agenda
 * for a VIEWED month that differs from the live cache's current month.
 */
export function agendaFromReports(
  clients: ClientCompliance[],
  techs: TechCompliance[],
  settings: CompanySettings,
): Agenda {
  const clientTarget = settings.supervisionDirectHoursPercent || 5;
  const preferredPct = settings.supervisionPreferredMinPercent ?? 15;
  const maxPct = settings.supervisionMaxHoursPercent;
  const gaps: AgendaGap[] = [];
  let red = 0;
  let yellow = 0;

  for (const r of clients) {
    const s = clientStatus(r, clientTarget, preferredPct, maxPct);
    if (s !== 'red' && s !== 'yellow') continue;
    if (s === 'red') red++; else yellow++;
    const toGo = r.projected.hoursToGo;
    // A yellow client is only ever the over-insurer-cap case; red is below floor.
    const overCap = s === 'yellow' && maxPct !== undefined && r.actual.pct > maxPct;
    const detail = overCap
      ? `Supervision at ${r.actual.pct.toFixed(1)}% — over the ${maxPct}% insurer cap.`
      : `Projected ${r.projected.pct.toFixed(1)}% vs ${clientTarget}% floor — ${toGo.toFixed(1)}h to go this month.`;
    gaps.push({
      entity: 'client', id: r.client.id, name: r.client.name,
      kind: s === 'red' ? 'behind' : 'over-served', status: s, detail, hoursToGo: toGo,
    });
  }

  for (const r of techs) {
    const s = techStatus(r);
    if (s !== 'red' && s !== 'yellow') continue;
    if (s === 'red') red++; else yellow++;
    const toGo = Math.max(r.projected.companyHoursToGo, r.tech.isRBT ? (r.projected.bacbHoursToGo ?? 0) : 0);
    gaps.push({
      entity: 'tech', id: r.tech.id, name: r.tech.name,
      // Red RBT/tech misses its floor by projection; yellow passes projection but not actuals yet.
      kind: s === 'red' ? 'behind' : 'off-pace', status: s,
      detail: `${toGo.toFixed(1)}h of supervision to go for ${r.tech.isRBT ? 'the BACB floor / company target' : 'the company target'}.`,
      hoursToGo: toGo,
    });
  }

  gaps.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'red' ? -1 : 1;
    if (a.entity !== b.entity) return a.entity === 'client' ? -1 : 1;
    return b.hoursToGo - a.hoursToGo;
  });

  return { targetProgress: { red, yellow, attentionCount: red + yellow }, gaps };
}

/**
 * The live-surface entry point: reads the memoized compliance cache (which
 * encapsulates the current period and the incrementally-recomputed per-entity
 * reports) and returns the agenda for it. A null cache (pre-unlock or mid first
 * build) yields the empty agenda so callers render "all clear" without guards.
 */
export function computeAgenda(cache: ComplianceCache | null, data: ScheduleData): Agenda {
  if (!cache) return EMPTY_AGENDA;
  return agendaFromReports([...cache.clients.values()], [...cache.techs.values()], data.settings);
}
