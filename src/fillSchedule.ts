// "Fill my Schedule out" — local solver core (the deterministic half of the
// hybrid). It does NOT invent the final schedule; it computes the hard facts the
// optimizer needs and hands them to Claude to assemble + rank 3 variants:
//
//   1. Per-case DIRECT-service utilization: authorized weekly direct hours
//      (the 100% target) vs hours already scheduled → the gap to fill.
//   2. Feasible direct windows: for each case, the times a session could be
//      placed — client availability ∩ assigned-BT availability (general ∩ any
//      per-case restriction) minus everything already booked for that BT or
//      client. Each window names the BT(s) who could cover it.
//
// Scope guards (clinical law — see CLAUDE.md):
//   - Only DIRECT (client-session) work is optimized here. The BCBA's own
//     schedule (supervision/PT/case-planning/reassessment) is never moved or
//     filled by this solver — supervision + parent-training are suggested by the
//     Claude layer, and PT only WITHIN already-scheduled sessions.
//   - Never double-books a BT or a client; respects blackouts.

import { ScheduleData, Appointment, DayOfWeek, TimeWindow } from './types';
import { findAuthFor } from './authorization';
import { computeClientCompliance, CompliancePeriod } from './compliance';
import { DAYS, toMin, minToClock, MIN_SLOT_MINS, intersect, subtract, windowsToIntervals, btCaseAvailability } from './intervals';

const isActive = (a: Appointment) => a.status !== 'canceled' && !a.isGhost;
const dirHours = (a: Appointment) => (new Date(a.endTime).getTime() - new Date(a.startTime).getTime()) / 3_600_000;

export interface CaseUtilization {
  clientId: string;
  clientName: string;
  targetDirectHrs: number;   // authorized weekly direct (100% target); 0 if none
  scheduledDirectHrs: number;
  gapHrs: number;            // max(0, target - scheduled)
  pct: number;               // scheduled / target (0..1+), 0 when no target
}

// Per-client direct-service utilization for the week beginning weekStart.
export function computeCaseUtilization(data: ScheduleData, weekStart: Date): CaseUtilization[] {
  const weekISO = isoOf(weekStart);
  return data.clients.map(c => {
    const auth = findAuthFor(data, c.id, weekISO) || findAuthFor(data, c.name, weekISO);
    const target = auth?.weekly?.direct && auth.weekly.direct > 0 ? auth.weekly.direct : 0;
    const scheduled = data.appointments
      .filter(a => a.type === 'client-session' && isActive(a) && a.client === c.id && inWeek(a.startTime, weekStart))
      .reduce((s, a) => s + dirHours(a), 0);
    const gap = target > 0 ? Math.max(0, target - scheduled) : 0;
    return {
      clientId: c.id, clientName: c.name,
      targetDirectHrs: +target.toFixed(2),
      scheduledDirectHrs: +scheduled.toFixed(2),
      gapHrs: +gap.toFixed(2),
      pct: target > 0 ? +(scheduled / target).toFixed(2) : 0,
    };
  });
}

export interface FeasibleWindow {
  clientId: string;
  clientName: string;
  day: DayOfWeek;
  date: string;        // YYYY-MM-DD
  start: string;       // HH:MM
  end: string;         // HH:MM
  minutes: number;
  techs: { id: string; name: string }[]; // assigned BTs free for the whole window
}

// Open direct-service windows per case for the week: client availability ∩ an
// assigned BT's case availability, minus what the BT or client already has booked
// and minus client blackout days. Windows shorter than MIN_SLOT_MINS are dropped.
export function feasibleDirectWindows(data: ScheduleData, weekStart: Date): FeasibleWindow[] {
  const out: FeasibleWindow[] = [];

  for (let d = 0; d < 7; d++) {
    const day = DAYS[d];
    const date = isoOf(addDays(weekStart, d));

    for (const client of data.clients) {
      const blackedOut = (data.blackouts || []).some(b => b.date === date && b.entityType === 'client' && b.entityId === client.id);
      if (blackedOut) continue;
      const clientAvail = windowsToIntervals(client.availabilityWindows?.[day]);
      if (clientAvail.length === 0) continue;

      // Busy = client's own active appts that day.
      const clientBusy = data.appointments
        .filter(a => isActive(a) && (a.client === client.id || a.client === client.name) && a.startTime.startsWith(date))
        .map(a => ({ start: minOf(a.startTime), end: minOf(a.endTime) }));

      // Assigned BTs for this client.
      const assignedTechs = data.technicians.filter(t => (t.assignments || []).some(a => a.clientId === client.id || a.clientId === client.name));

      // Per free window, collect which BTs are available for the whole window.
      const windowTechs = new Map<string, { id: string; name: string }[]>(); // key `${start}-${end}`
      for (const tech of assignedTechs) {
        const techCaseAvail = btCaseAvailability(tech, client.id, day).length
          ? btCaseAvailability(tech, client.id, day)
          : btCaseAvailability(tech, client.name, day);
        if (techCaseAvail.length === 0) continue;
        const techBusy = data.appointments
          .filter(a => isActive(a) && a.technician === tech.id && a.startTime.startsWith(date))
          .map(a => ({ start: minOf(a.startTime), end: minOf(a.endTime) }));

        // Free = clientAvail ∩ techCaseAvail − clientBusy − techBusy
        let free = intersect(clientAvail, techCaseAvail);
        free = subtract(free, [...clientBusy, ...techBusy]);
        for (const seg of free) {
          if (seg.end - seg.start < MIN_SLOT_MINS) continue;
          const key = `${seg.start}-${seg.end}`;
          const arr = windowTechs.get(key) || [];
          arr.push({ id: tech.id, name: tech.name });
          windowTechs.set(key, arr);
        }
      }

      for (const [key, techs] of windowTechs) {
        const [start, end] = key.split('-').map(Number);
        out.push({
          clientId: client.id, clientName: client.name, day, date,
          start: minToClock(start), end: minToClock(end), minutes: end - start, techs,
        });
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || toMin(a.start) - toMin(b.start) || a.clientName.localeCompare(b.clientName));
}

// Compact context object for the Claude layer: only under-utilized cases and
// their open windows (keeps the prompt small).
export function buildFillContext(data: ScheduleData, weekStart: Date) {
  const util = computeCaseUtilization(data, weekStart).filter(u => u.targetDirectHrs > 0);
  const underserved = util.filter(u => u.gapHrs > 0.01);
  const windows = feasibleDirectWindows(data, weekStart);
  const underservedIds = new Set(underserved.map(u => u.clientId));
  return {
    weekStart: isoOf(weekStart),
    cases: util,
    underserved,
    windows: windows.filter(w => underservedIds.has(w.clientId)),
  };
}

// ── Supervisable windows for Fix It ──────────────────────────────────────────
// Future direct sessions in [now, horizonEnd) where the BCBA is both available
// (per clinicianAvailability) and not already double-booked by an existing
// supervision/PT/case-planning/reassessment session. These are the concrete
// candidate slots the Fix It prompt gives to Claude so it can pick specific
// times rather than reasoning from raw JSON availability blocks.

export interface SupervisableWindow {
  clientId: string;
  clientName: string;
  appointmentId: string;  // the direct session's ID
  date: string;           // YYYY-MM-DD
  sessionStart: string;   // ISO local datetime (no Z)
  sessionEnd: string;
  techId: string | undefined;
  techName: string | undefined;
}

const BCBA_TYPES = new Set<string>(['supervision', 'parent-training', 'case-planning', 'reassessment']);

function isBcbaBusyFn(data: ScheduleData) {
  const busy = data.appointments
    .filter(a => isActive(a) && BCBA_TYPES.has(a.type))
    .map(a => ({ s: new Date(a.startTime).getTime(), e: new Date(a.endTime).getTime() }));
  return (startMs: number, endMs: number) => busy.some(b => b.s < endMs && b.e > startMs);
}

function isBcbaAvailableAtFn(data: ScheduleData) {
  const avail = data.settings.clinicianAvailability as Record<string, TimeWindow[]> | undefined;
  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return (startIso: string, endIso: string): boolean => {
    if (!avail) return true;
    const d = new Date(startIso);
    const ws = avail[DAY_NAMES[d.getDay()]];
    if (!ws || ws.length === 0) return false;
    const sMin = d.getHours() * 60 + d.getMinutes();
    const eMin = (new Date(endIso).getHours()) * 60 + (new Date(endIso).getMinutes());
    return ws.some(w => toMin(w.start) <= sMin && toMin(w.end) >= eMin);
  };
}

export function buildSupervisableWindows(
  data: ScheduleData,
  now: Date,
  horizonEnd: Date,
): SupervisableWindow[] {
  const nowMs = now.getTime();
  const horizonMs = horizonEnd.getTime();
  const isBusy = isBcbaBusyFn(data);
  const isAvail = isBcbaAvailableAtFn(data);

  return data.appointments
    .filter(a => {
      const s = new Date(a.startTime).getTime();
      return a.type === 'client-session' && isActive(a) && s > nowMs && s <= horizonMs;
    })
    .filter(a => isAvail(a.startTime, a.endTime))
    .filter(a => !isBusy(new Date(a.startTime).getTime(), new Date(a.endTime).getTime()))
    .map(a => {
      const client = data.clients.find(c => c.id === a.client);
      const tech = a.technician
        ? data.technicians.find(t => t.id === a.technician)
        : undefined;
      return {
        clientId: client?.id || a.client || '',
        clientName: client?.name || a.client || '',
        appointmentId: a.id,
        date: a.startTime.slice(0, 10),
        sessionStart: a.startTime,
        sessionEnd: a.endTime,
        techId: tech?.id,
        techName: tech?.name || a.technician,
      };
    })
    .sort((a, b) => a.sessionStart.localeCompare(b.sessionStart));
}

// Per-client feasibility check: why can't the BCBA supervise a given client?
// Used to build the "why impossible" diagnostic for the no-solution case.
export interface FeasibilityDiagnostic {
  clientId: string;
  clientName: string;
  futureDirects: number;
  bcbaAvailableSlots: number;
  bcbaFreeSlots: number;
  blocker: string | null;  // null = slots are available
}

export function buildFeasibilityDiagnostics(
  data: ScheduleData,
  now: Date,
  horizonEnd: Date,
): FeasibilityDiagnostic[] {
  const nowMs = now.getTime();
  const horizonMs = horizonEnd.getTime();
  const isBusy = isBcbaBusyFn(data);
  const isAvail = isBcbaAvailableAtFn(data);

  return data.clients.map(client => {
    const futureDirects = data.appointments.filter(a =>
      a.type === 'client-session' && isActive(a) &&
      (a.client === client.id || a.client === client.name) &&
      new Date(a.startTime).getTime() > nowMs &&
      new Date(a.startTime).getTime() <= horizonMs
    );
    const bcbaAvailable = futureDirects.filter(a => isAvail(a.startTime, a.endTime));
    const bcbaFree = bcbaAvailable.filter(
      a => !isBusy(new Date(a.startTime).getTime(), new Date(a.endTime).getTime())
    );
    let blocker: string | null = null;
    if (futureDirects.length === 0) blocker = 'no future direct sessions in scope';
    else if (bcbaAvailable.length === 0) blocker = `${futureDirects.length} direct session(s), none fall within BCBA availability`;
    else if (bcbaFree.length === 0) blocker = `${bcbaAvailable.length} slot(s) within BCBA availability, all blocked by existing BCBA appointments`;
    return {
      clientId: client.id,
      clientName: client.name,
      futureDirects: futureDirects.length,
      bcbaAvailableSlots: bcbaAvailable.length,
      bcbaFreeSlots: bcbaFree.length,
      blocker,
    };
  });
}

// Re-export helpers so localSolver.ts can use the same logic.
export { isBcbaBusyFn as _isBcbaBusyFn, isBcbaAvailableAtFn as _isBcbaAvailableAtFn };

// ── date helpers ──────────────────────────────────────────────────────────────
function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function minOf(iso: string): number { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes(); }
function inWeek(iso: string, weekStart: Date): boolean {
  const start = isoOf(weekStart), end = isoOf(addDays(weekStart, 6));
  const day = iso.slice(0, 10);
  return day >= start && day <= end;
}

// ── Compliance-fill context ("Fill my schedule out") ─────────────────────────
// For the BCBA-fills-their-own-calendar wish: computes which cases are below
// ideal supervision range, and lists future direct sessions as the valid windows
// into which the BCBA can drop supervision or PT to earn compliance credit.
//
// Supervision earns credit when it overlaps a direct (BT present).
// PT earns credit only when it falls within a direct session's time window.

export interface ComplianceFillCase {
  clientId: string;
  clientName: string;
  supPct: number;        // current projected supervision %
  supHrs: number;        // current projected supervision hours
  directHrs: number;     // projected direct hours
  gapToIdealHrs: number; // additional sup hours needed to reach idealMinPct
  idealMaxHrs: number;   // sup hours at idealMaxPct cap
}

export interface ComplianceFillDirectWindow {
  clientId: string;
  clientName: string;
  appointmentId: string;
  start: string;         // ISO datetime
  end: string;
  techId: string | undefined;
  techName: string | undefined;
}

export interface ComplianceFillContext {
  periodLabel: string;
  floorPct: number;
  idealMinPct: number;
  idealMaxPct: number;
  cases: ComplianceFillCase[];               // below ideal, sorted by gap desc
  directWindows: ComplianceFillDirectWindow[]; // future directs for those cases
}

export function buildComplianceFillContext(
  data: ScheduleData,
  period: CompliancePeriod,
  now: Date,
): ComplianceFillContext {
  const compliances = computeClientCompliance(data, period, now);
  const s = data.settings;
  const floorPct   = s.supervisionFloorPercent        ?? 10;
  const idealMinPct = s.supervisionPreferredMinPercent ?? 15;
  const idealMaxPct = s.supervisionPreferredMaxPercent ?? 20;

  const cases: ComplianceFillCase[] = [];
  for (const cc of compliances) {
    if (cc.projected.directHours < 0.1) continue;
    const clientMin = (cc.client as any).supervisionIdealPct ?? idealMinPct;
    const supPct    = cc.projected.supervisionHours / cc.projected.directHours * 100;
    const gap       = Math.max(0, (clientMin / 100) * cc.projected.directHours - cc.projected.supervisionHours);
    if (gap < 0.05) continue; // already at or above ideal
    cases.push({
      clientId:      cc.client.id,
      clientName:    cc.client.name,
      supPct:        +supPct.toFixed(1),
      supHrs:        +cc.projected.supervisionHours.toFixed(2),
      directHrs:     +cc.projected.directHours.toFixed(2),
      gapToIdealHrs: +gap.toFixed(2),
      idealMaxHrs:   +(idealMaxPct / 100 * cc.projected.directHours).toFixed(2),
    });
  }
  cases.sort((a, b) => b.gapToIdealHrs - a.gapToIdealHrs);

  const caseIds   = new Set(cases.map(c => c.clientId));
  const caseNames = new Set(cases.map(c => c.clientName));

  const directWindows: ComplianceFillDirectWindow[] = data.appointments
    .filter(a =>
      a.type === 'client-session' &&
      isActive(a) &&
      new Date(a.startTime) >= now &&
      new Date(a.startTime) < period.end &&
      (caseIds.has(a.client || '') || caseNames.has(a.client || ''))
    )
    .map(a => {
      const client = data.clients.find(c => c.id === a.client);
      const tech   = a.technician
        ? data.technicians.find(t => t.id === a.technician)
        : undefined;
      return {
        clientId:      client?.id    || a.client || '',
        clientName:    client?.name  || a.client || '',
        appointmentId: a.id,
        start: a.startTime,
        end:   a.endTime,
        techId:   tech?.id,
        techName: tech?.name || a.technician,
      };
    })
    .sort((a, b) => a.start.localeCompare(b.start));

  return { periodLabel: period.label, floorPct, idealMinPct, idealMaxPct, cases, directWindows };
}

// ── "Fill MY week" context (sAssI conversational assistant) ───────────────────
// The BCBA-centric objective: fill the clinician's OWN calendar toward a weekly-
// hours target, compliance-first. It layers three facts on top of the compliance-
// fill context so the assistant can both propose sessions AND explain blockers
// plainly (instead of dead-ending on "no options"):
//   - bcbaScheduledHrs: BCBA billable hours already on the calendar this period
//     (the "15h so far" baseline; the user states the target in chat).
//   - directWindows: future direct sessions supervision/PT can overlap for credit.
//   - blockers: per-case reasons the BCBA can't supervise (no windows / outside
//     availability / fully booked), so an empty-ops turn still has something to say.

// BCBA billable hours (supervision / PT / case-planning / reassessment) already
// scheduled within the period — the baseline the fill works up from.
export function computeBcbaScheduledHours(data: ScheduleData, period: CompliancePeriod): number {
  return data.appointments
    .filter(a =>
      isActive(a) && BCBA_TYPES.has(a.type) &&
      new Date(a.startTime) >= period.start && new Date(a.startTime) < period.end)
    .reduce((sum, a) => sum + dirHours(a), 0);
}

export interface BcbaWeekBlocker {
  clientId: string;
  clientName: string;
  blocker: string;
}

export interface BcbaWeekFillContext extends ComplianceFillContext {
  bcbaScheduledHrs: number;
  blockers: BcbaWeekBlocker[];
}

export function buildBcbaWeekFillContext(
  data: ScheduleData,
  period: CompliancePeriod,
  now: Date,
): BcbaWeekFillContext {
  const base = buildComplianceFillContext(data, period, now);
  const blockers = buildFeasibilityDiagnostics(data, now, period.end)
    .filter(d => d.blocker !== null)
    .map(d => ({ clientId: d.clientId, clientName: d.clientName, blocker: d.blocker! }));
  const bcbaScheduledHrs = +computeBcbaScheduledHours(data, period).toFixed(1);
  return { ...base, bcbaScheduledHrs, blockers };
}
