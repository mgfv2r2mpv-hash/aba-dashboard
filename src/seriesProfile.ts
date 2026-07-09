// seriesProfile — the single cadence oracle for recurring series.
//
// Recurrence in this app is a set of DATED ROWS sharing a seriesId, not a live
// rule. That makes the member dates the ground truth: measurePattern derives the
// cadence from measured inter-occurrence gaps (a stored label can lie — six
// writers historically set the trio inconsistently), seriesProfileOf summarizes
// a series for the form / extendSeries / tidy, and normalizeRecurrenceFields
// enforces the ONE invariant everywhere else relies on:
//
//   recurring ⇔ member of a multi-row series (shared seriesId)
//             ⇔ isRecurring: true + a coherent recurringPattern
//   one-time  ⇔ no seriesId ⇔ no flag, no pattern
//
// Normalization touches PENDING rows only. Completed/canceled rows are records
// of fact — they are returned by identity (===), never re-stamped (tidy's
// equivalence oracle fingerprints facts INCLUDING the trio, so a re-stamp there
// would be flagged as data corruption).

import { Appointment, StoredRecurrencePattern } from './types';

export type MonthlyFlavor = 'same-date' | 'nth-weekday';

export interface MeasuredPattern {
  pattern: StoredRecurrencePattern;
  monthlyFlavor?: MonthlyFlavor;
  nth?: number | 'last'; // only when monthlyFlavor === 'nth-weekday'
}

export interface SeriesSlot {
  weekday: number;    // 0 (Sun) … 6 (Sat)
  clock: string;      // "HH:MM" local start
  durationMs: number;
  templateId: string; // most-recent member occupying this slot
}

export interface SeriesProfile {
  seriesId: string;
  pattern: StoredRecurrencePattern;
  monthlyFlavor?: MonthlyFlavor;
  nth?: number | 'last';
  weekdays: number[];        // distinct member weekdays, ascending
  slots: SeriesSlot[];       // one per distinct (weekday, clock)
  anchor: string;            // earliest member startTime (local ISO)
  horizon: string;           // latest member startTime (local ISO)
  memberIds: string[];
  pendingMemberIds: string[]; // members that are not completed/canceled
}

const DAY_MS = 86_400_000;
const isFact = (a: Appointment): boolean => a.status === 'completed' || a.status === 'canceled';
const clockOf = (iso: string): string => iso.slice(11, 16);

// Parse a YYYY-MM-DD as a LOCAL date (new Date('YYYY-MM-DD') would be UTC).
function parseLocalDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}

const daysInMonth = (d: Date): number => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();

// Classify one inter-occurrence gap (days) into a cadence bucket.
type Bucket = 'weekly' | 'biweekly' | 'monthly';
function bucketOf(gap: number): Bucket | null {
  if (gap >= 6 && gap <= 8) return 'weekly';
  if (gap >= 13 && gap <= 15) return 'biweekly';
  if (gap >= 28 && gap <= 35) return 'monthly';
  return null;
}

// Measure the recurrence pattern of a set of occurrence start times. Measured
// gaps beat labels; the label is only a fallback when there are too few gaps to
// measure (<3 distinct dates). Tolerates one missing occurrence per cadence: a
// doubled gap (e.g. 14d inside a weekly run) is outvoted by the modal bucket.
export function measurePattern(startISOs: string[], labelHint?: StoredRecurrencePattern): MeasuredPattern {
  const days = [...new Set(startISOs.map(iso => iso.slice(0, 10)))].sort();
  if (days.length < 3) return { pattern: labelHint ?? 'weekly' };

  const dates = days.map(parseLocalDay);
  const weekdays = [...new Set(dates.map(d => d.getDay()))];
  const gaps: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    gaps.push(Math.round((dates[i].getTime() - dates[i - 1].getTime()) / DAY_MS));
  }

  // Modal gap; ties break toward the smaller gap (denser signal).
  const freq = new Map<number, number>();
  for (const g of gaps) freq.set(g, (freq.get(g) ?? 0) + 1);
  const modalGap = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];

  // ≥2 distinct weekdays stepping within a week = a weekday-set-per-week series
  // (Mon–Fri, M/W/F, …). Checked before the bucket classifier because a monthly
  // same-date series also spans weekdays but steps ~30d, never ≤6d.
  if (weekdays.length >= 2 && modalGap <= 6) return { pattern: 'custom' };

  // Single-cadence classification: modal bucket over all gaps. A missing
  // occurrence contributes one off-bucket gap and is outvoted.
  const bucketFreq = new Map<Bucket, number>();
  for (const g of gaps) {
    const b = bucketOf(g);
    if (b) bucketFreq.set(b, (bucketFreq.get(b) ?? 0) + 1);
  }
  const modal = [...bucketFreq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!modal) return { pattern: labelHint ?? 'weekly' };
  if (modal !== 'monthly') return { pattern: modal };

  // Monthly flavor, measured. Same day-of-month → 'same-date'. Same weekday with
  // a constant ⌈dom/7⌉ ordinal → 'nth-weekday' (nth = ordinal); same weekday all
  // landing in the final 7 days of their month → nth 'last' (covers 4th-vs-5th
  // Friday months where the ordinal wobbles). Inconsistent members → plain
  // monthly, no flavor (extendSeries falls back to a same-date step).
  const doms = dates.map(d => d.getDate());
  if (doms.every(x => x === doms[0])) return { pattern: 'monthly', monthlyFlavor: 'same-date' };
  if (weekdays.length === 1) {
    const ordinals = doms.map(x => Math.ceil(x / 7));
    if (ordinals.every(x => x === ordinals[0])) {
      return { pattern: 'monthly', monthlyFlavor: 'nth-weekday', nth: ordinals[0] };
    }
    if (dates.every(d => d.getDate() > daysInMonth(d) - 7)) {
      return { pattern: 'monthly', monthlyFlavor: 'nth-weekday', nth: 'last' };
    }
  }
  return { pattern: 'monthly' };
}

// Summarize a series from its stored members. Pattern is measured (member dates
// are ground truth) with the members' own stored label as the sparse-data
// fallback. Returns null when no row carries the seriesId.
export function seriesProfileOf(appointments: Appointment[], seriesId: string): SeriesProfile | null {
  const members = appointments.filter(a => a.seriesId === seriesId);
  if (members.length === 0) return null;
  const sorted = [...members].sort((a, b) => a.startTime.localeCompare(b.startTime));

  const hint = sorted.map(m => m.recurringPattern).find(Boolean);
  const measured = measurePattern(sorted.map(m => m.startTime), hint);

  // One slot per (weekday, clock); the most-recent member is the template.
  const slots = new Map<string, SeriesSlot>();
  for (const m of sorted) {
    const weekday = new Date(m.startTime).getDay();
    const clock = clockOf(m.startTime);
    slots.set(`${weekday}|${clock}`, {
      weekday, clock,
      durationMs: new Date(m.endTime).getTime() - new Date(m.startTime).getTime(),
      templateId: m.id,
    });
  }

  return {
    seriesId,
    pattern: measured.pattern,
    ...(measured.monthlyFlavor ? { monthlyFlavor: measured.monthlyFlavor } : {}),
    ...(measured.nth !== undefined ? { nth: measured.nth } : {}),
    weekdays: [...new Set(sorted.map(m => new Date(m.startTime).getDay()))].sort((a, b) => a - b),
    slots: [...slots.values()],
    anchor: sorted[0].startTime,
    horizon: sorted[sorted.length - 1].startTime,
    memberIds: sorted.map(m => m.id),
    pendingMemberIds: sorted.filter(m => !isFact(m)).map(m => m.id),
  };
}

// Enforce the trio invariant over a working set. PENDING rows only:
//   • multi-member seriesId  → isRecurring: true + the MEASURED pattern
//   • singleton seriesId     → trio cleared (a series of one is a one-time)
//   • lone isRecurring/pattern (no seriesId) → cleared
//   • pending make-up        → trio cleared (a make-up recovers ONE canceled
//     session; it can never recur — mirrors migration step 1→2)
// Completed/canceled rows are returned by identity (===) — never re-stamped.
// Unchanged pending rows are also returned by identity, so the result is
// idempotent and cheap to diff (changedIds is the exact edit set).
export function normalizeRecurrenceFields(
  appointments: Appointment[],
): { appointments: Appointment[]; changedIds: string[] } {
  const bySeries = new Map<string, Appointment[]>();
  for (const a of appointments) {
    if (!a.seriesId) continue;
    const arr = bySeries.get(a.seriesId);
    if (arr) arr.push(a); else bySeries.set(a.seriesId, [a]);
  }

  // Measured pattern per live (multi-member) series — computed once per series.
  const measured = new Map<string, StoredRecurrencePattern>();
  for (const [sid, members] of bySeries) {
    if (members.length < 2) continue;
    const hint = members.map(m => m.recurringPattern).find(Boolean);
    measured.set(sid, measurePattern(members.map(m => m.startTime), hint).pattern);
  }

  const changedIds: string[] = [];
  const cleared = (a: Appointment): Appointment => {
    if (!a.seriesId && !a.isRecurring && a.recurringPattern === undefined) return a;
    const next = { ...a };
    delete next.seriesId;
    delete next.isRecurring;
    delete next.recurringPattern;
    changedIds.push(a.id);
    return next;
  };

  const out = appointments.map(a => {
    if (isFact(a)) return a;
    if (a.isMakeUp) return cleared(a);
    if (a.seriesId && (bySeries.get(a.seriesId)?.length ?? 0) >= 2) {
      const pattern = measured.get(a.seriesId)!;
      if (a.isRecurring === true && a.recurringPattern === pattern) return a;
      changedIds.push(a.id);
      return { ...a, isRecurring: true, recurringPattern: pattern };
    }
    return cleared(a);
  });

  return { appointments: out, changedIds };
}
