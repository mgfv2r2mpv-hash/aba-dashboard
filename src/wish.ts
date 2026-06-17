// "Wish It" — goal-driven AI schedule rework (Change 3), the pure parts.
//
// The live Anthropic call lives in claudeScheduler.ts; everything here is pure
// and unit-tested (scripts/verify-wish.ts): turning a structured WishRequest into
// a compact natural-language brief for the prompt, parsing the model's strict-
// JSON reply into WishSolutions, and converting a chosen solution into the draft
// ops + blackouts the rest of the app already knows how to preview and commit.

import { WishRequest, WishSolution, WishOp, ScheduleData, Appointment, Blackout, Client, Technician } from './types';
import { computeClientCompliance, computeTechCompliance, monthPeriod, CompliancePeriod } from './compliance';
import { DraftOp, newAddOp, newMoveOp, newRemoveOp, applyOps } from './draft';
import { v4 as uuidv4 } from 'uuid';

const APPT_TYPES: Appointment['type'][] = [
  'supervision', 'parent-training', 'internal-task', 'client-session', 'reassessment', 'case-planning', 'other',
];

function fmtTime(hhmm?: string): string { return hhmm || '—'; }

// A short human brief of the wish, used both in the prompt and as the composer's
// live preview. Kept terse on purpose — the structured fields carry the specifics
// so we don't pay tokens for prose.
export function summarizeWish(w: WishRequest): string {
  const horizon = w.horizonWeeks ? ` over the next ${w.horizonWeeks} weeks` : '';
  const shave = w.shaveDown ? ' Also shave over-served supervision sessions down toward the minimum to free up capacity.' : '';
  let base: string;
  switch (w.kind) {
    case 'vacation':
      base = `Block off ${w.dateStart || '?'}–${w.dateEnd || '?'} for time away and reschedule any of my sessions in that range while staying compliant.`;
      break;
    case 'clearWindow':
      base = `Keep ${w.weekday || 'a chosen day'} ${fmtTime(w.windowStart)}–${fmtTime(w.windowEnd)}${w.everyOtherWeek ? ' (every other week)' : ''} free${horizon}, moving any sessions there elsewhere with minimal week-to-week change.`;
      break;
    case 'addRecurring':
      base = `Add a recurring ${w.newType || 'session'}${w.client ? ` for ${w.client}` : ''} around ${w.weekday || 'a weekday'} ${fmtTime(w.windowStart)}${w.durationMins ? ` (${w.durationMins} min)` : ''}${horizon}, juggling the schedule to fit it with minimal disruption.`;
      break;
    case 'shaveDown':
      base = `Trim over-served supervision sessions toward the compliance minimum${horizon} to free up capacity, without dropping below required floors.`;
      break;
    case 'fillSchedule':
      base = `Fill my schedule out: maximize each case's DIRECT-service utilization toward 100% this week using the open windows, suggest supervision where it helps, and parent training only within scheduled sessions. Do not change my (BCBA) own schedule.`;
      break;
    case 'freeform':
    default:
      base = w.note?.trim() || 'Rework the schedule as described.';
      break;
  }
  return base + (w.kind !== 'shaveDown' ? shave : '');
}

// Pull the first JSON object out of a model reply that may be fenced or prefaced
// with prose. Returns null when nothing parses.
function extractJson(text: string): any {
  if (!text) return null;
  // Prefer a fenced block, else the first {...} span.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(candidate.slice(start, end + 1)); }
  catch { return null; }
}

// Parse the model's reply into WishSolutions. `reverse(token)` maps an anonymized
// token (APT_n/CLIENT_n/TECH_n) back to its real id/name; unknown tokens pass
// through unchanged. Defensive throughout — malformed ops are dropped, not thrown.
export function parseWishSolutions(text: string, reverse: (token: string) => string | undefined): WishSolution[] {
  const json = extractJson(text);
  const rawSolutions: any[] = Array.isArray(json?.solutions) ? json.solutions
    : Array.isArray(json) ? json : [];
  const rev = (v: any): string | undefined => {
    if (v === undefined || v === null || v === '') return undefined;
    const s = String(v);
    return reverse(s) ?? s;
  };

  const out: WishSolution[] = [];
  for (const rs of rawSolutions) {
    const ops: WishOp[] = [];
    for (const ro of Array.isArray(rs?.ops) ? rs.ops : []) {
      const kind = String(ro?.op || '').toLowerCase();
      if (kind === 'move') {
        const id = rev(ro.apt ?? ro.appointmentId);
        if (id && ro.start && ro.end) ops.push({ op: 'move', appointmentId: id, start: String(ro.start), end: String(ro.end) });
      } else if (kind === 'remove') {
        const id = rev(ro.apt ?? ro.appointmentId);
        if (id) ops.push({ op: 'remove', appointmentId: id });
      } else if (kind === 'add') {
        const type = APPT_TYPES.includes(ro.type) ? ro.type : 'other';
        if (ro.start && ro.end) {
          const add: Extract<WishOp, { op: 'add' }> = { op: 'add', type, start: String(ro.start), end: String(ro.end) };
          const title = ro.title ? String(ro.title) : undefined;
          if (title) add.title = title;
          const client = rev(ro.client); if (client) add.client = client;
          const tech = rev(ro.tech ?? ro.technician); if (tech) add.technician = tech;
          if (ro.recurring) { add.recurring = true; add.pattern = ['weekly', 'biweekly', 'monthly'].includes(ro.pattern) ? ro.pattern : 'weekly'; }
          ops.push(add);
        }
      } else if (kind === 'blackout') {
        const entity = rev(ro.entity);
        const entityType = ro.entityType === 'technician' ? 'technician' : 'client';
        if (entity && ro.date) {
          const b: Extract<WishOp, { op: 'blackout' }> = { op: 'blackout', entityType, entity, date: String(ro.date) };
          if (ro.reason) b.reason = String(ro.reason);
          ops.push(b);
        }
      }
    }
    if (ops.length === 0) continue;
    out.push({
      id: uuidv4(),
      summary: rs?.summary ? String(rs.summary) : 'Proposed change',
      reasoning: rs?.reasoning ? String(rs.reasoning) : '',
      ops,
    });
  }
  return out.slice(0, 3);
}

// Resolve a client/tech reference (real name or id) to the entity's id.
function resolveEntityId(ref: string, list: { id: string; name: string }[]): { id: string; name: string } | undefined {
  return list.find(e => e.id === ref || e.name === ref);
}

export interface WishDraft {
  ops: DraftOp[];          // move/add/remove → the editable draft
  blackouts: Blackout[];   // applied on accept (not part of the appointment draft)
  unresolved: number;      // ops we couldn't map (e.g. unknown appointment/entity)
}

// Convert a chosen WishSolution into draft ops + blackouts against `base`.
export function wishSolutionToDraft(sol: WishSolution, base: ScheduleData): WishDraft {
  const ops: DraftOp[] = [];
  const blackouts: Blackout[] = [];
  let unresolved = 0;
  const apptById = new Map(base.appointments.map(a => [a.id, a]));

  for (const o of sol.ops) {
    if (o.op === 'move') {
      const a = apptById.get(o.appointmentId);
      if (a) ops.push(newMoveOp({ ...a, startTime: o.start, endTime: o.end }));
      else unresolved++;
    } else if (o.op === 'remove') {
      if (apptById.has(o.appointmentId)) ops.push(newRemoveOp(o.appointmentId));
      else unresolved++;
    } else if (o.op === 'add') {
      const appt: Appointment = {
        id: uuidv4(),
        title: o.title || defaultTitle(o.type),
        technician: o.technician,
        client: o.client,
        startTime: o.start,
        endTime: o.end,
        isFixed: false,
        isBillable: o.type !== 'internal-task',
        type: o.type,
        status: 'scheduled',
      };
      if (o.recurring) { appt.isRecurring = true; appt.recurringPattern = o.pattern || 'weekly'; }
      ops.push(newAddOp(appt));
    } else if (o.op === 'blackout') {
      const list = o.entityType === 'technician' ? base.technicians : base.clients;
      const ent = resolveEntityId(o.entity, list);
      if (ent) {
        blackouts.push({
          id: uuidv4(), entityType: o.entityType, entityId: ent.id, entityName: ent.name,
          date: o.date, reason: o.reason, createdAt: new Date().toISOString(),
        });
      } else unresolved++;
    }
  }
  return { ops, blackouts, unresolved };
}

function defaultTitle(type: Appointment['type']): string {
  switch (type) {
    case 'parent-training': return 'Parent Training';
    case 'supervision': return 'Supervision';
    case 'case-planning': return 'Case Planning';
    case 'reassessment': return 'Reassessment';
    case 'client-session': return 'Session';
    case 'internal-task': return 'Internal Task';
    default: return 'Appointment';
  }
}

// Apply a whole wish solution (ops + blackouts) to produce the next schedule —
// the Accept path. Customize stages just the appointment ops into the draft.
export function applyWishSolution(base: ScheduleData, sol: WishSolution): ScheduleData {
  const { ops, blackouts } = wishSolutionToDraft(sol, base);
  const withOps = applyOps(base, ops);
  return blackouts.length ? { ...withOps, blackouts: [...(withOps.blackouts || []), ...blackouts] } : withOps;
}

// ── Per-solution compliance impact ───────────────────────────────────────────
// Simulates applying a WishSolution and diffs the projected compliance state
// before/after. All metrics use the projected scope (all non-canceled sessions,
// not just past ones) so the BCBA sees the full-period picture. Only entries
// with a meaningful change (≥0.1pp or ≥0.05h) are included so the display
// stays focused on what actually shifted.

export interface ClientImpact {
  client: Client;
  beforePct: number;
  afterPct: number;
  deltaPct: number;        // pp gained (positive = better)
  beforeSupHours: number;
  afterSupHours: number;
  deltaSupHours: number;   // supervision hours gained
  hoursToGoAfter: number;  // remaining gap after the solution
}

export interface TechImpact {
  tech: Technician;
  beforePct: number;
  afterPct: number;
  deltaPct: number;
  hoursToGoAfter: number;
}

export interface SolutionImpact {
  clientImpacts: ClientImpact[];
  techImpacts: TechImpact[];
  sessionsAdded: number;
  sessionsRemoved: number;
}

export function computeSolutionImpact(
  base: ScheduleData,
  sol: WishSolution,
  period?: CompliancePeriod,
): SolutionImpact {
  const p = period ?? monthPeriod(new Date());
  const now = new Date();

  const clientsBefore = computeClientCompliance(base, p, now);
  const techsBefore   = computeTechCompliance(base, p, now);

  const hypothetical  = applyWishSolution(base, sol);

  const clientsAfter  = computeClientCompliance(hypothetical, p, now);
  const techsAfter    = computeTechCompliance(hypothetical, p, now);

  let sessionsAdded = 0;
  let sessionsRemoved = 0;
  for (const op of sol.ops) {
    if (op.op === 'add') sessionsAdded++;
    else if (op.op === 'remove') sessionsRemoved++;
  }

  const afterClientMap = new Map(clientsAfter.map(c => [c.client.id, c]));
  const clientImpacts: ClientImpact[] = [];
  for (const before of clientsBefore) {
    const after = afterClientMap.get(before.client.id);
    if (!after) continue;
    const deltaPct     = after.projected.pct - before.projected.pct;
    const deltaSupHours = after.projected.supervisionHours - before.projected.supervisionHours;
    if (Math.abs(deltaPct) >= 0.1 || Math.abs(deltaSupHours) >= 0.05) {
      clientImpacts.push({
        client: before.client,
        beforePct: before.projected.pct,
        afterPct: after.projected.pct,
        deltaPct,
        beforeSupHours: before.projected.supervisionHours,
        afterSupHours: after.projected.supervisionHours,
        deltaSupHours,
        hoursToGoAfter: after.projected.hoursToGo,
      });
    }
  }

  const afterTechMap = new Map(techsAfter.map(t => [t.tech.id, t]));
  const techImpacts: TechImpact[] = [];
  for (const before of techsBefore) {
    const after = afterTechMap.get(before.tech.id);
    if (!after) continue;
    const deltaPct = after.projected.pct - before.projected.pct;
    if (Math.abs(deltaPct) >= 0.1) {
      techImpacts.push({
        tech: before.tech,
        beforePct: before.projected.pct,
        afterPct: after.projected.pct,
        deltaPct,
        hoursToGoAfter: after.projected.companyHoursToGo,
      });
    }
  }

  return { clientImpacts, techImpacts, sessionsAdded, sessionsRemoved };
}
