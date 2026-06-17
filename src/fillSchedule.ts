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

import { ScheduleData, Appointment, DayOfWeek, TimeWindow, Technician } from './types';
import { findAuthFor } from './authorization';

const DAYS: DayOfWeek[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const toMin = (t: string): number => { const [h, m] = t.split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const minToClock = (n: number): string => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
const MIN_SLOT_MINS = 60; // ignore feasible gaps shorter than this

interface Interval { start: number; end: number; } // minutes since midnight

// Merge + sort intervals, dropping zero/negative spans.
function normalize(ints: Interval[]): Interval[] {
  const sorted = ints.filter(i => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

function intersect(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const x of a) for (const y of b) {
    const s = Math.max(x.start, y.start), e = Math.min(x.end, y.end);
    if (e > s) out.push({ start: s, end: e });
  }
  return normalize(out);
}

// a minus b (remove busy intervals from free intervals).
function subtract(a: Interval[], b: Interval[]): Interval[] {
  let cur = normalize(a);
  for (const cut of normalize(b)) {
    const next: Interval[] = [];
    for (const seg of cur) {
      if (cut.end <= seg.start || cut.start >= seg.end) { next.push(seg); continue; }
      if (cut.start > seg.start) next.push({ start: seg.start, end: cut.start });
      if (cut.end < seg.end) next.push({ start: cut.end, end: seg.end });
    }
    cur = next;
  }
  return cur;
}

const windowsToIntervals = (ws?: TimeWindow[]): Interval[] =>
  normalize((ws || []).map(w => ({ start: toMin(w.start), end: toMin(w.end) })));

// A BT's effective availability for a given case on a day: general availability,
// further restricted by any per-case availability on that assignment.
function btCaseAvailability(tech: Technician, clientRef: string, day: DayOfWeek): Interval[] {
  const general = windowsToIntervals(tech.availability?.[day]);
  const asg = (tech.assignments || []).find(a => a.clientId === clientRef);
  if (!asg) return [];
  if (asg.availability && Object.keys(asg.availability).length > 0) {
    return intersect(general, windowsToIntervals(asg.availability[day]));
  }
  return general; // no per-case restriction → general availability applies
}

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
      .filter(a => a.type === 'client-session' && isActive(a) && (a.client === c.id || a.client === c.name) && inWeek(a.startTime, weekStart))
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
      const blackedOut = (data.blackouts || []).some(b => b.date === date && b.entityType === 'client' && (b.entityId === client.id || b.entityId === client.name));
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
          .filter(a => isActive(a) && a.technician === tech.name && a.startTime.startsWith(date))
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
