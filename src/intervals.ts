// Pure minute-of-day interval geometry + weekday availability math.
//
// Extracted from fillSchedule.ts so the schedule builder (builderOccupancy.ts,
// scheduleBuilder.ts) can reuse the exact same placement geometry the local
// solvers already trust. fillSchedule.ts re-imports these — its public API is
// unchanged. verify-fill.ts is the regression guard for the extraction.

import { DayOfWeek, TimeWindow, Technician } from './types';

// Ordered Monday-first so `DAYS[d]` lines up with a Monday-based week iteration
// (weekStart + d), matching feasibleDirectWindows / solveMeetPace.
export const DAYS: DayOfWeek[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export const MIN_SLOT_MINS = 60; // ignore feasible gaps shorter than this

export interface Interval { start: number; end: number; } // minutes since midnight

export const toMin = (t: string): number => { const [h, m] = t.split(':').map(Number); return (h || 0) * 60 + (m || 0); };
export const minToClock = (n: number): string => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

// Merge + sort intervals, dropping zero/negative spans.
export function normalize(ints: Interval[]): Interval[] {
  const sorted = ints.filter(i => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

export function intersect(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const x of a) for (const y of b) {
    const s = Math.max(x.start, y.start), e = Math.min(x.end, y.end);
    if (e > s) out.push({ start: s, end: e });
  }
  return normalize(out);
}

// a minus b (remove busy intervals from free intervals).
export function subtract(a: Interval[], b: Interval[]): Interval[] {
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

export const windowsToIntervals = (ws?: TimeWindow[]): Interval[] =>
  normalize((ws || []).map(w => ({ start: toMin(w.start), end: toMin(w.end) })));

// A BT's effective availability for a given case on a day: general availability,
// further restricted by any per-case availability on that assignment.
export function btCaseAvailability(tech: Technician, clientRef: string, day: DayOfWeek): Interval[] {
  const general = windowsToIntervals(tech.availability?.[day]);
  const asg = (tech.assignments || []).find(a => a.clientId === clientRef);
  if (!asg) return [];
  if (asg.availability && Object.keys(asg.availability).length > 0) {
    return intersect(general, windowsToIntervals(asg.availability[day]));
  }
  return general; // no per-case restriction → general availability applies
}
