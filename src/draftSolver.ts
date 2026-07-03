// Native draft solver + grading.
//
// Given the live schedule and the user's staged draft ops, this computes the
// PREVIEW and grades it for the live status badge, attempting an in-week
// reshuffle that moves only "mobile" sessions (direct service assigned to a
// technician — easy to relocate). Sessions booked directly with the family
// (no technician) are "sticky": the engine won't move them on its own, it asks
// the BCBA to choose. The grade drives the badge:
//
//   green  — resolvable with mobile moves only, billable within target.
//   yellow — resolvable but needs a human call (shorten a session / move a
//            family session), or it solves but pushes BCBA above billable target.
//   red    — no in-week solution, or it would drop BCBA below the billable floor.
//            On red the AI escalation button becomes available.
//
// The grade is advisory: the user can always override and Save anyway.

import { Appointment, ScheduleData, CompanySettings, DayOfWeek, TimeWindow } from './types';
import { DraftOp, applyOps } from './draft';
import { overlapHours } from './compliance';
import { weekRange } from './caseModel';
import { findOpenSlots } from './corrections';
import { rollupHours, resolveUtilization, bucketOf, ptoHoursInRange, reduceRequirementForPto } from './utilization';

export type DraftGrade = 'green' | 'yellow' | 'red';

export interface PrioritizationChoice {
  kind: 'shorten' | 'move-family';
  appointmentId: string;
  label: string; // terse, e.g. "Shorten EC 3:00–5:00" / "Move family session BW"
}

export interface DraftStatus {
  grade: DraftGrade;
  label: string;                 // terse far-left badge text
  resolved?: ScheduleData;       // engine's best arrangement, committed on Accept
  movedIds: string[];            // ids the engine relocated beyond the user's ops
  choices: PrioritizationChoice[];
  needsChoice: boolean;          // yellow that requires a human pick before Accept
  aiEligible: boolean;           // red → enable AI button
}

const DAY_NAMES: DayOfWeek[] = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as any;
const MAX_ROUNDS = 60; // hill-climb cap — keeps the badge instant

// ---- small time helpers (local-day, matching the seeder's ISO format) ----
function ms(iso: string): number { return new Date(iso).getTime(); }
function minutesOfDay(iso: string): number { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes(); }
function toMin(hhmm: string): number { const [h, m] = hhmm.split(':').map(Number); return (h || 0) * 60 + (m || 0); }
function dateStrOf(iso: string): string { return iso.slice(0, 10); }
function durationMin(a: Appointment): number { return Math.round((ms(a.endTime) - ms(a.startTime)) / 60000); }

function isActive(a: Appointment): boolean {
  return a.status !== 'canceled' && !a.isGhost;
}
// Mobile = a future, still-scheduled, non-fixed direct session with a technician.
function isMobile(a: Appointment, nowMs: number): boolean {
  return isActive(a) && !a.isFixed && a.status !== 'completed'
    && !!a.technician && ms(a.startTime) >= nowMs;
}
// Sticky = a future, active session with NO technician (booked with the family).
function isSticky(a: Appointment, nowMs: number): boolean {
  return isActive(a) && !a.technician && a.status !== 'completed' && ms(a.startTime) >= nowMs;
}

function windowsCover(windows: TimeWindow[] | undefined, startMin: number, endMin: number): boolean {
  if (!Array.isArray(windows) || windows.length === 0) return true; // unconfigured = not faulted
  return windows.some(w => startMin >= toMin(w.start) && endMin <= toMin(w.end));
}

// A conflict between two sessions, or an availability/blackout problem on one.
interface Conflict {
  ids: string[];                 // appointment id(s) involved
  kind: 'double-book' | 'availability' | 'blackout';
}

// Focused conflict scan, limited to the affected weeks. Detects technician
// double-booking, client double-booking, availability-window violations, and
// blackout collisions — the things an in-week reshuffle is meant to fix.
function focusedConflicts(data: ScheduleData, weekStartMs: number[]): Conflict[] {
  const inAffectedWeek = (a: Appointment) =>
    weekStartMs.some(w => { const t = ms(a.startTime); return t >= w && t < w + 7 * 86400000; });
  const sessions = data.appointments.filter(a => isActive(a) && inAffectedWeek(a));
  const conflicts: Conflict[] = [];

  // Pairwise double-booking — keyed on the PROVIDER, not the client. A single
  // technician can't be in two overlapping sessions, and the lone BCBA can't be
  // in two overlapping BILLABLE no-tech sessions (supervision / parent-training /
  // coordination-of-care, etc.). A BCBA (no-tech) session overlapping a BT direct
  // session is legitimate CONCURRENT care — that's how supervision and in-session
  // parent training work — so it is NOT a conflict, even for the same client.
  // (The all-billable filter in the past-only path still lets a non-billable task
  // share a tech's slot.)
  for (let i = 0; i < sessions.length; i++) {
    for (let j = i + 1; j < sessions.length; j++) {
      const a = sessions[i], b = sessions[j];
      if (overlapHours(a, b) <= 0) continue;
      // A real tech double-book needs the SAME tech PROVIDING both sessions —
      // i.e. both are BT-bucket work. On a parent-training / case-planning
      // session the technician field names the OBSERVED BT (not a provider), so
      // it overlapping that BT's own direct is required concurrent care (how
      // supervision earns credit), never a double-book.
      const sameTechProvider = bucketOf(a) === 'bt' && bucketOf(b) === 'bt'
        && !!a.technician && a.technician === b.technician;
      // Two direct-service sessions for the same client at the same time are a
      // billing conflict regardless of which BT provides each — insurers reject
      // duplicate direct-service claims for the same client in the same slot.
      const sameClientDirects = a.type === 'client-session' && b.type === 'client-session'
        && !!a.client && a.client === b.client;
      const bothBcbaBillable = bucketOf(a) === 'bcba' && bucketOf(b) === 'bcba';
      if (sameTechProvider || sameClientDirects || bothBcbaBillable) {
        conflicts.push({ ids: [a.id, b.id], kind: 'double-book' });
      }
    }
  }

  // Availability + blackout, per session.
  const clientById = new Map(data.clients.map(c => [c.id, c]));
  const clientByName = new Map(data.clients.map(c => [c.name, c]));
  const techById = new Map(data.technicians.map(t => [t.id, t]));
  const techByName = new Map(data.technicians.map(t => [t.name, t]));
  const blackouts = data.blackouts || [];
  for (const a of sessions) {
    const day = DAY_NAMES[new Date(a.startTime).getDay()];
    const date = dateStrOf(a.startTime);
    const s = minutesOfDay(a.startTime), e = minutesOfDay(a.endTime);
    const client = a.client ? (clientById.get(a.client) || clientByName.get(a.client)) : undefined;
    const tech = a.technician ? (techById.get(a.technician) || techByName.get(a.technician)) : undefined;
    if (blackouts.some(b =>
      b.date === date && (
        (client && b.entityType === 'client' && b.entityId === client.id) ||
        (tech && b.entityType === 'technician' && b.entityId === tech.id)
      ))) {
      conflicts.push({ ids: [a.id], kind: 'blackout' });
      continue;
    }
    const techBad = tech && !windowsCover((tech.availability as any)[day], s, e);
    // Clients are only faulted when they HAVE windows that don't cover the slot.
    // A parent who can meet outside their scheduled availability makes an
    // out-of-window parent-training slot tentative (BCBA-confirm), not a hard
    // conflict — so the engine doesn't call it "no in-week solution".
    const ptOutsideOk = a.type === 'parent-training' && client?.parentAvailableOutsideSessions === true;
    const clientWindows = client ? (client.availabilityWindows as any)[day] as TimeWindow[] : undefined;
    const clientBad = !ptOutsideOk && clientWindows && clientWindows.length > 0 && !windowsCover(clientWindows, s, e);
    if (techBad || clientBad) conflicts.push({ ids: [a.id], kind: 'availability' });
  }

  return conflicts;
}

// Parent-training slots that land outside the client's set availability for a
// client flagged "parent available outside scheduled availability". Allowed,
// but tentative until the BCBA confirms — used to nudge an otherwise-clean
// draft from green to yellow. Blackout days are excluded (still a hard block).
function tentativePtOutside(data: ScheduleData, weekStartMs: number[]): string[] {
  const inAffectedWeek = (a: Appointment) =>
    weekStartMs.some(w => { const t = ms(a.startTime); return t >= w && t < w + 7 * 86400000; });
  const clientById = new Map(data.clients.map(c => [c.id, c]));
  const clientByName = new Map(data.clients.map(c => [c.name, c]));
  const blackouts = data.blackouts || [];
  const ids: string[] = [];
  for (const a of data.appointments) {
    if (a.type !== 'parent-training' || !isActive(a) || !inAffectedWeek(a)) continue;
    const client = a.client ? (clientById.get(a.client) || clientByName.get(a.client)) : undefined;
    if (!client || client.parentAvailableOutsideSessions !== true) continue;
    const date = dateStrOf(a.startTime);
    if (blackouts.some(b => b.date === date && b.entityType === 'client' && b.entityId === client.id)) continue;
    const day = DAY_NAMES[new Date(a.startTime).getDay()];
    const windows = (client.availabilityWindows as any)[day] as TimeWindow[];
    if (windows && windows.length > 0 && !windowsCover(windows, minutesOfDay(a.startTime), minutesOfDay(a.endTime))) {
      ids.push(a.id);
    }
  }
  return ids;
}

// Sessions where the BT is limited to specific windows for THIS client (per-case
// availability) and the slot falls outside them, while still inside the BT's
// general availability. Allowed but tentative — mirrors tentativePtOutside so a
// clean draft surfaces as yellow (BCBA confirms) rather than green.
export function tentativeTechCaseOutside(data: ScheduleData, weekStartMs: number[]): string[] {
  const inAffectedWeek = (a: Appointment) =>
    weekStartMs.some(w => { const t = ms(a.startTime); return t >= w && t < w + 7 * 86400000; });
  const clientById = new Map(data.clients.map(c => [c.id, c]));
  const clientByName = new Map(data.clients.map(c => [c.name, c]));
  const techById = new Map(data.technicians.map(t => [t.id, t]));
  const techByName = new Map(data.technicians.map(t => [t.name, t]));
  const ids: string[] = [];
  for (const a of data.appointments) {
    if (!isActive(a) || !inAffectedWeek(a) || !a.technician || !a.client) continue;
    const tech = techById.get(a.technician) || techByName.get(a.technician);
    const client = clientById.get(a.client) || clientByName.get(a.client);
    if (!tech || !client) continue;
    const asg = tech.assignments.find(x => x.clientId === client.id || x.clientId === client.name);
    const caseAvail = asg?.availability;
    if (!caseAvail || Object.keys(caseAvail).length === 0) continue;
    const day = DAY_NAMES[new Date(a.startTime).getDay()];
    const caseWindows = (caseAvail as any)[day] as TimeWindow[] | undefined;
    const s = minutesOfDay(a.startTime), e = minutesOfDay(a.endTime);
    // Per-case coverage: unlike windowsCover, an ABSENT day is "not available for
    // this case" → not covered. A restricted assignment with the slot uncovered
    // (while inside general availability) is tentative.
    const caseCovered = Array.isArray(caseWindows) && caseWindows.length > 0
      && caseWindows.some(w => s >= toMin(w.start) && e <= toMin(w.end));
    if (windowsCover((tech.availability as any)[day], s, e) && !caseCovered) {
      ids.push(a.id);
    }
  }
  return ids;
}

// Relocate `appt` to its first feasible in-week slot (for its client+tech) that
// is not before `now`. Returns a moved clone, or null if no slot exists.
function relocate(
  data: ScheduleData, appt: Appointment, weekStartMs: number, nowMs: number,
): Appointment | null {
  const weekEnd = new Date(weekStartMs + 6 * 86400000);
  const throughDate = `${weekEnd.getFullYear()}-${String(weekEnd.getMonth() + 1).padStart(2, '0')}-${String(weekEnd.getDate()).padStart(2, '0')}`;
  const from = new Date(Math.max(weekStartMs, nowMs));
  const client = data.clients.find(c => c.id === appt.client || c.name === appt.client);
  const tech = data.technicians.find(t => t.id === appt.technician || t.name === appt.technician);
  const slots = findOpenSlots(data, {
    durationMinutes: durationMin(appt),
    clientId: client?.id,
    techId: tech?.id,
    fromDate: from,
    throughDate,
    weekendsOk: true,
    useClinicianAvailability: !appt.technician,
  }, 12);
  for (const slot of slots) {
    const start = `${slot.date}T${slot.start}:00`;
    const end = `${slot.date}T${slot.end}:00`;
    if (start === appt.startTime && end === appt.endTime) continue; // no-op slot
    return { ...appt, startTime: start, endTime: end };
  }
  return null;
}

// Greedy hill-climb: relocate mobile sessions involved in conflicts until clean
// or stuck. Mutates a working copy; returns the resolved schedule + moved ids
// and whether it reached zero conflicts.
function reshuffleMobile(
  base: ScheduleData, weekStartMs: number[], nowMs: number,
): { data: ScheduleData; movedIds: Set<string>; clean: boolean } {
  let working: ScheduleData = { ...base, appointments: base.appointments.map(a => ({ ...a })) };
  const movedIds = new Set<string>();

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const conflicts = focusedConflicts(working, weekStartMs);
    if (conflicts.length === 0) return { data: working, movedIds, clean: true };

    // Find a mobile session inside any conflict whose relocation strictly
    // reduces the conflict count. Only DOUBLE-BOOKS drive a relocation — an
    // out-of-availability slot is left where the user put it (graded as a
    // yellow "confirm" below) rather than silently snapped back into a window.
    let improved = false;
    outer:
    for (const c of conflicts) {
      if (c.kind !== 'double-book') continue;
      for (const id of c.ids) {
        const idx = working.appointments.findIndex(a => a.id === id);
        if (idx < 0) continue;
        const appt = working.appointments[idx];
        const wkStart = startOfWeekMs(ms(appt.startTime));
        if (!isMobile(appt, nowMs)) continue;
        const moved = relocate(working, appt, wkStart, nowMs);
        if (!moved) continue;
        const trial: ScheduleData = {
          ...working,
          appointments: working.appointments.map(a => a.id === id ? moved : a),
        };
        if (focusedConflicts(trial, weekStartMs).length < conflicts.length) {
          working = trial;
          movedIds.add(id);
          improved = true;
          break outer;
        }
      }
    }
    if (!improved) return { data: working, movedIds, clean: false };
  }
  return { data: working, movedIds, clean: focusedConflicts(working, weekStartMs).length === 0 };
}

function startOfWeekMs(t: number): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay()).getTime();
}

// BCBA weekly billable (no-technician lens), summed over the affected weeks,
// counting completed + scheduled.
function bcbaBillable(data: ScheduleData, weekStartMs: number[]): number {
  let total = 0;
  for (const w of weekStartMs) {
    const h = rollupHours(data.appointments, w, w + 7 * 86400000, 'bcba');
    total += h.completed + h.scheduled;
  }
  return total;
}

// For the unresolved conflicts left after mobile reshuffle, surface the human
// trade-offs: which family (sticky) sessions could move, and which overlapping
// sessions could be shortened.
function buildChoices(data: ScheduleData, conflicts: Conflict[], nowMs: number): PrioritizationChoice[] {
  const choices: PrioritizationChoice[] = [];
  const seen = new Set<string>();
  const label = (a: Appointment) => {
    const who = a.client || a.title || a.id.slice(0, 4);
    const t = new Date(a.startTime);
    return `${who} ${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}`;
  };
  for (const c of conflicts) {
    if (c.kind !== 'double-book') continue;
    for (const id of c.ids) {
      if (seen.has(id)) continue;
      const a = data.appointments.find(x => x.id === id);
      if (!a) continue;
      if (isSticky(a, nowMs)) {
        choices.push({ kind: 'move-family', appointmentId: id, label: `Move family session ${label(a)}` });
        seen.add(id);
      } else if (isActive(a) && a.status !== 'completed' && ms(a.startTime) >= nowMs) {
        choices.push({ kind: 'shorten', appointmentId: id, label: `Shorten ${label(a)}` });
        seen.add(id);
      }
    }
  }
  return choices;
}

export function solveDraft(
  base: ScheduleData,
  ops: DraftOp[],
  now: Date,
  settings: CompanySettings,
): DraftStatus {
  const nowMs = now.getTime();
  const preview = applyOps(base, ops);

  // Affected weeks: the weeks of every op-touched appointment.
  const weekSet = new Set<number>();
  for (const op of ops) {
    const iso = op.appt?.startTime
      ?? base.appointments.find(a => a.id === op.targetId)?.startTime;
    if (iso) weekSet.add(weekRange(new Date(iso)).start.getTime());
  }
  // Fallback: if a draft op carried no date (shouldn't happen), use this week.
  if (weekSet.size === 0) weekSet.add(weekRange(now).start.getTime());
  const weeks = [...weekSet];

  // Past-only drafts (e.g. logging a historical session that already happened):
  // it can't be rescheduled, and billable floors/targets are forward-looking, so
  // grade purely on hard timeslot conflicts. Two BILLABLE activities can't share
  // a slot (you can't bill two at once), but a billable+nonbillable or
  // nonbillable overlap is allowed and passes clean.
  const allPast = ops.length > 0 && ops.every(op => {
    const iso = op.appt?.startTime ?? base.appointments.find(a => a.id === op.targetId)?.startTime;
    return !!iso && ms(iso) < nowMs;
  });
  if (allPast) {
    const conflicts = focusedConflicts(preview, weeks);
    const billable = new Map(preview.appointments.map(a => [a.id, a.isBillable === true]));
    const blocking = conflicts.filter(c =>
      c.kind === 'double-book' && c.ids.every(id => billable.get(id)));
    if (blocking.length === 0) {
      return { grade: 'green', label: 'past session — logged as actual', resolved: preview,
        movedIds: [], choices: [], needsChoice: false, aiEligible: false };
    }
    return { grade: 'red', label: 'two billable sessions overlap', resolved: undefined,
      movedIds: [], choices: [], needsChoice: false, aiEligible: false };
  }

  // Billable floor/target (no-tech BCBA lens). A draft that drops the BCBA below
  // the floor for any affected week is a hard red. BCBA leave in the affected
  // week(s) lowers both thresholds by ptoHours * ratio (Upgrade 1), so a week the
  // BCBA is partly on PTO isn't graded red against the full 25h floor.
  const util = resolveUtilization(settings.utilization);
  const ptoH = weeks.reduce((sum, w) => sum + ptoHoursInRange(base.timeOff, w, w + 7 * 86400000), 0);
  const target = reduceRequirementForPto(util.bcbaWeeklyBillableHours, ptoH, settings.ptoBillableDeductionRatio);
  const floor = reduceRequirementForPto(util.bcbaWeeklyBillableMin, ptoH, settings.ptoBillableDeductionRatio);
  const baseBillable = bcbaBillable(base, weeks);

  const { data: resolved, movedIds, clean } = reshuffleMobile(preview, weeks, nowMs);
  const previewBillable = bcbaBillable(resolved, weeks);
  // Floor only binds when this draft DROPS the BCBA below it (e.g. removing or
  // shortening a BCBA session) — not merely because the week is underbooked.
  const belowFloor = floor > 0 && previewBillable + 0.01 < floor && previewBillable + 0.01 < baseBillable;
  // "Above" only counts when this draft pushes further above target than the
  // starting schedule already was.
  const aboveTarget = previewBillable > target + 0.01 && previewBillable > baseBillable + 0.01;

  // Out-of-window parent-training slots a flagged parent can still make, plus BT
  // sessions outside their per-case availability — allowed but tentative, so a
  // clean draft surfaces as yellow (BCBA confirms) not green.
  const tentative = [...tentativePtOutside(resolved, weeks), ...tentativeTechCaseOutside(resolved, weeks)];

  if (clean && !belowFloor) {
    if (aboveTarget) {
      return { grade: 'yellow', label: 'confirmation needed; above hours', resolved,
        movedIds: [...movedIds], choices: [], needsChoice: false, aiEligible: false };
    }
    if (tentative.length > 0) {
      return { grade: 'yellow', label: 'confirmation needed; outside set availability', resolved,
        movedIds: [...movedIds], choices: [], needsChoice: false, aiEligible: false };
    }
    return { grade: 'green', label: 'no conflict; within hours', resolved,
      movedIds: [...movedIds], choices: [], needsChoice: false, aiEligible: false };
  }

  // Below billable floor: warn but allow BCBA to Accept (yellow, not a hard block).
  // A remove op that drops hours below minimum is still staged as a violation in
  // the draft tray label so the BCBA sees it before confirming.
  if (belowFloor) {
    return { grade: 'yellow', label: 'warning: billable below minimum', resolved,
      movedIds: [...movedIds], choices: [], needsChoice: false, aiEligible: true };
  }

  // Conflicts remain after the mobile reshuffle. Separate the genuinely
  // unsolvable from the merely-needs-a-human-OK:
  //   • a blackout collision, or a double-book the engine can neither move nor
  //     offer a shorten/move-family trade-off for → red, no in-week solution.
  //   • a double-book that DOES offer a trade-off → yellow, BCBA picks first.
  //   • an out-of-availability slot that clashes with nothing (the move just
  //     sits outside the client/tech's set windows) → yellow "confirm", the
  //     same lenient treatment an out-of-window parent-training slot gets. The
  //     move is kept where the user put it, not silently relocated.
  const remaining = focusedConflicts(resolved, weeks);
  const doubleBooks = remaining.filter(c => c.kind === 'double-book');
  const hasBlackout = remaining.some(c => c.kind === 'blackout');
  const hasAvailability = remaining.some(c => c.kind === 'availability');
  const choices = buildChoices(resolved, doubleBooks, nowMs);
  const everyDoubleBookHasChoice = doubleBooks.every(c =>
    c.ids.some(id => choices.some(ch => ch.appointmentId === id)));

  if (hasBlackout || (doubleBooks.length > 0 && !everyDoubleBookHasChoice)) {
    return { grade: 'red', label: 'no in-week solution', resolved: undefined,
      movedIds: [...movedIds], choices, needsChoice: false, aiEligible: true };
  }

  if (doubleBooks.length > 0) {
    return { grade: 'yellow', label: 'confirmation needed', resolved,
      movedIds: [...movedIds], choices, needsChoice: true, aiEligible: false };
  }

  if (hasAvailability) {
    return { grade: 'yellow', label: 'confirmation needed; outside set availability', resolved,
      movedIds: [...movedIds], choices: [], needsChoice: false, aiEligible: false };
  }

  // No classifiable conflict left (defensive — a clean board returns above).
  return { grade: 'red', label: 'no in-week solution', resolved: undefined,
    movedIds: [...movedIds], choices, needsChoice: false, aiEligible: true };
}
