// "Wish It" — goal-driven AI schedule rework (Change 3), the pure parts.
//
// The live Anthropic call lives in claudeScheduler.ts; everything here is pure
// and unit-tested (scripts/verify-wish.ts): turning a structured WishRequest into
// a compact natural-language brief for the prompt, parsing the model's strict-
// JSON reply into WishSolutions, and converting a chosen solution into the draft
// ops + blackouts the rest of the app already knows how to preview and commit.

import {
  WishRequest, WishSolution, WishOp, ScheduleData, Appointment, Blackout, Client, Technician,
  Cancellation, CANCELLATION_SOURCES, CANCELLATION_REASONS, activeCancellationCodes, applicableSources,
} from './types';
import { computeClientCompliance, computeTechCompliance, monthPeriod, CompliancePeriod } from './compliance';
import { DraftOp, newAddOp, newMoveOp, newRemoveOp, newEditOp, applyOps } from './draft';
import { buildTravelContext, travelMinutes } from './travel';
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

// Build the token-reverser used across op parsing: maps an anonymized token
// (APT_n/CLIENT_n/TECH_n) back to its real id/name; unknown/empty pass through.
function makeRev(reverse: (token: string) => string | undefined): (v: any) => string | undefined {
  return (v: any): string | undefined => {
    if (v === undefined || v === null || v === '') return undefined;
    const s = String(v);
    return reverse(s) ?? s;
  };
}

// Turn a raw `ops` array from the model into validated WishOps. `rev` maps a raw
// value (token or already-real ref) to a real id/name. Shared by the single-shot
// wish parser and the multi-turn chat parser. Defensive: malformed ops are
// dropped, not thrown.
export function parseOps(rawOps: any, rev: (v: any) => string | undefined): WishOp[] {
  const ops: WishOp[] = [];
  for (const ro of Array.isArray(rawOps) ? rawOps : []) {
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
    } else if (kind === 'setfixed') {
      const id = rev(ro.apt ?? ro.appointmentId);
      if (id && typeof ro.isFixed === 'boolean') ops.push({ op: 'setFixed', appointmentId: id, isFixed: ro.isFixed });
    } else if (kind === 'complete') {
      const id = rev(ro.apt ?? ro.appointmentId);
      if (id) ops.push({ op: 'complete', appointmentId: id });
    } else if (kind === 'cancel') {
      const id = rev(ro.apt ?? ro.appointmentId);
      const source = CANCELLATION_SOURCES.some(s => s.value === ro.source) ? ro.source : undefined;
      if (id && source) {
        // Shape/enum validation only — the reason code is resolved against the
        // company's active codes later, in wishSolutionToDraft (which has settings).
        const c: Extract<WishOp, { op: 'cancel' }> = {
          op: 'cancel', appointmentId: id, source,
          reason: ro.reason ? String(ro.reason) : '',
          unplanned: ro.unplanned !== false, // default true, matching the cancel dialog
        };
        if (typeof ro.noticeMet === 'boolean') c.noticeMet = ro.noticeMet;
        if (ro.notes) c.notes = String(ro.notes);
        ops.push(c);
      }
    }
  }
  return ops;
}

// Parse the model's reply into WishSolutions. `reverse(token)` maps an anonymized
// token (APT_n/CLIENT_n/TECH_n) back to its real id/name; unknown tokens pass
// through unchanged. Defensive throughout — malformed ops are dropped, not thrown.
export function parseWishSolutions(text: string, reverse: (token: string) => string | undefined): WishSolution[] {
  const json = extractJson(text);
  const rawSolutions: any[] = Array.isArray(json?.solutions) ? json.solutions
    : Array.isArray(json) ? json : [];
  const rev = makeRev(reverse);

  const out: WishSolution[] = [];
  for (const rs of rawSolutions) {
    const ops = parseOps(rs?.ops, rev);
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

// One turn of the sAssI conversation: the model's plain-language reply plus the
// COMPLETE current set of proposed ops (empty when it is only explaining and the
// proposal is unchanged). Tokens in ops are reversed to real ids/names here; the
// `reply` is left token-space (the caller de-anonymizes it for display).
export interface ChatTurn {
  reply: string;
  ops: WishOp[];
}

export function parseChatTurn(text: string, reverse: (token: string) => string | undefined): ChatTurn {
  const json = extractJson(text);
  if (!json) {
    // Model answered in prose without a JSON envelope — treat it all as the reply.
    return { reply: (text || '').trim(), ops: [] };
  }
  const rev = makeRev(reverse);
  const reply = typeof json.reply === 'string' ? json.reply
    : typeof json.message === 'string' ? json.message
    : '';
  return { reply, ops: parseOps(json.ops, rev) };
}

// Tool-use variant of parseChatTurn. The `respond` tool hands us a structured
// { reply, ops } object directly, so there's no JSON-from-prose extraction (and no
// silent prose-degradation): just reverse the tokens in ops and pass the reply
// through. `input` is the tool_use block's `input`; `reverse(token)` maps an
// anonymized token back to its real id/name.
export function parseToolTurn(input: any, reverse: (token: string) => string | undefined): ChatTurn {
  const rev = makeRev(reverse);
  const reply = typeof input?.reply === 'string' ? input.reply : '';
  return { reply, ops: parseOps(input?.ops, rev) };
}

// Real-world safety net: a machine must NEVER suggest placing (add) or relocating
// (move) a session into the past — the BCBA cannot perform an appointment that has
// already happened. Removes and blackouts are time-agnostic and pass through.
// Unparseable start times are treated as invalid and dropped. This is a hard,
// testable backstop behind the prompt (which is already told "start ≥ NOW"), so a
// misbehaving model can never land a past-dated session on the calendar.
export function dropPastOps(ops: WishOp[], now: Date = new Date()): WishOp[] {
  const nowMs = now.getTime();
  return ops.filter(o => {
    if (o.op === 'add' || o.op === 'move') {
      const t = new Date(o.start).getTime();
      return !Number.isNaN(t) && t >= nowMs;
    }
    return true;
  });
}

// Real-world safety net #2 (the "same human body" can't teleport): the model may
// propose placing two BCBA sessions at different cities with no time to drive
// between them. This is the CODE source of truth for travel feasibility — the
// prompt's TRAVEL matrix is only a hint. Each add/move that lands a BCBA session
// is checked against the fixed context (existing untouched BCBA sessions) and the
// already-accepted ops; one that leaves too little drive time (or overlaps a
// session at a different location) is dropped. travelMinutes self-zeroes when
// travel is off, a location is unknown, or it's the same site, so a schedule with
// no cities passes everything through unchanged. Non-BCBA ops always pass.
const BCBA_TRAVEL_TYPES = new Set<Appointment['type']>(['supervision', 'parent-training', 'case-planning', 'reassessment']);

export function dropInfeasibleTravelOps(ops: WishOp[], data: ScheduleData): WishOp[] {
  const ctx = buildTravelContext(data);
  if (!ctx.settings.enabled) return ops;

  const idOf = (ref?: string): string | undefined =>
    ref ? data.clients.find(c => c.id === ref)?.id : undefined;

  interface Session { s: number; e: number; loc?: string }
  const touched = new Set(
    ops.filter((o): o is Extract<WishOp, { appointmentId: string }> => 'appointmentId' in o && (o.op === 'move' || o.op === 'remove'))
      .map(o => o.appointmentId),
  );
  const context: Session[] = data.appointments
    .filter(a => a.status !== 'canceled' && !a.isGhost && BCBA_TRAVEL_TYPES.has(a.type) && !touched.has(a.id))
    .map(a => ({ s: new Date(a.startTime).getTime(), e: new Date(a.endTime).getTime(), loc: idOf(a.client) }));

  const sessionOf = (o: WishOp): Session | null => {
    if (o.op !== 'add' && o.op !== 'move') return null;
    const s = new Date(o.start).getTime(), e = new Date(o.end).getTime();
    if (Number.isNaN(s) || Number.isNaN(e)) return null;
    let type: Appointment['type'] | undefined; let client: string | undefined;
    if (o.op === 'add') { type = o.type; client = o.client; }
    else { const a = data.appointments.find(x => x.id === o.appointmentId); type = a?.type; client = a?.client; }
    if (!type || !BCBA_TRAVEL_TYPES.has(type)) return null;
    return { s, e, loc: idOf(client) };
  };

  const feasible = (cand: Session, others: Session[]): boolean => {
    for (const b of others) {
      if (b.s < cand.e && b.e > cand.s) { // overlap
        if ((b.loc || '') !== (cand.loc || '')) return false; // two places at once
        continue;
      }
      if (b.e <= cand.s && (cand.s - b.e) < travelMinutes(b.loc, cand.loc, b.e, ctx) * 60_000) return false;
      if (cand.e <= b.s && (b.s - cand.e) < travelMinutes(cand.loc, b.loc, cand.e, ctx) * 60_000) return false;
    }
    return true;
  };

  const accepted: Session[] = [...context];
  const kept: WishOp[] = [];
  for (const o of ops) {
    const cand = sessionOf(o);
    if (!cand) { kept.push(o); continue; }
    if (feasible(cand, accepted)) { kept.push(o); accepted.push(cand); }
  }
  return kept;
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
  // A mutable working copy so several ops targeting the SAME appointment in one
  // proposal accumulate (e.g. "move it and lock it") instead of each rebuilding
  // from the pristine base and clobbering the other. applyOps is last-write-wins
  // per id, so the final op for an id must carry the fully-accumulated state.
  const working = new Map(base.appointments.map(a => [a.id, { ...a }]));

  for (const o of sol.ops) {
    if (o.op === 'move') {
      const a = working.get(o.appointmentId);
      if (a) { const next: Appointment = { ...a, startTime: o.start, endTime: o.end }; working.set(next.id, next); ops.push(newMoveOp(next)); }
      else unresolved++;
    } else if (o.op === 'remove') {
      if (working.has(o.appointmentId)) { working.delete(o.appointmentId); ops.push(newRemoveOp(o.appointmentId)); }
      else unresolved++;
    } else if (o.op === 'add') {
      // Normalize the op's refs to immutable ids so the PERSISTED appointment is
      // always id-linked, regardless of source: a builder op carries an id, an AI op
      // carries a de-anonymized name. This is the single sanctioned name→id boundary.
      // Empty ('' on supervision) and unresolvable refs pass through untouched.
      const clientId = resolveEntityId(o.client ?? '', base.clients)?.id ?? o.client;
      const technicianId = resolveEntityId(o.technician ?? '', base.technicians)?.id ?? o.technician;
      const appt: Appointment = {
        id: uuidv4(),
        title: o.title || defaultTitle(o.type),
        technician: technicianId,
        client: clientId,
        startTime: o.start,
        endTime: o.end,
        isFixed: false,
        isBillable: o.type !== 'internal-task',
        type: o.type,
        status: 'scheduled',
      };
      if (o.recurring) { appt.isRecurring = true; appt.recurringPattern = o.pattern || 'weekly'; }
      // Extend-series adds carry the EXISTING seriesId so the new occurrences join the
      // series (not a fresh one) — the This/Following/All batch path keys on seriesId.
      if (o.seriesId) appt.seriesId = o.seriesId;
      working.set(appt.id, appt);
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
    } else if (o.op === 'setFixed') {
      const a = working.get(o.appointmentId);
      if (a) { const next: Appointment = { ...a, isFixed: o.isFixed }; working.set(next.id, next); ops.push(newEditOp(next)); }
      else unresolved++;
    } else if (o.op === 'complete') {
      const a = working.get(o.appointmentId);
      // Clear any prior cancellation so a completed record isn't left internally
      // inconsistent (mirrors the manual mark-complete path).
      if (a) { const next: Appointment = { ...a, status: 'completed', cancellation: undefined }; working.set(next.id, next); ops.push(newEditOp(next)); }
      else unresolved++;
    } else if (o.op === 'cancel') {
      const a = working.get(o.appointmentId);
      if (a) {
        // Build the Cancellation exactly as the dialog does: coerce an invalid
        // source for this appointment type (e.g. BCBA on a client-session) and an
        // unknown/retired reason back to a valid one, and stamp canceledAt now.
        const sources = applicableSources(a.type);
        const source = sources.some(s => s.value === o.source) ? o.source : sources[0].value;
        const active = activeCancellationCodes(base.settings);
        const reasons = active.length ? active : CANCELLATION_REASONS;
        const reason = reasons.some(c => c.value === o.reason) ? o.reason : reasons[0].value;
        const cancellation: Cancellation = {
          source, reason, unplanned: o.unplanned,
          noticeMet: o.noticeMet ?? false,
          canceledAt: new Date().toISOString(),
          ...(o.notes ? { notes: o.notes } : {}),
        };
        const next: Appointment = { ...a, status: 'canceled', cancellation };
        working.set(next.id, next);
        ops.push(newEditOp(next));
      } else unresolved++;
    } else if (o.op === 'regroup') {
      // Stamp a shared seriesId (+ pattern annotation) onto each named row via an
      // `edit` — no time change, so rendering/compliance are untouched; it only
      // unlocks the This/Following/All batch-edit path (keyed on seriesId).
      for (const id of o.appointmentIds) {
        const a = working.get(id);
        if (a) {
          const next: Appointment = { ...a, seriesId: o.seriesId, recurringPattern: o.recurringPattern ?? a.recurringPattern };
          working.set(next.id, next);
          ops.push(newEditOp(next));
        } else unresolved++;
      }
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
