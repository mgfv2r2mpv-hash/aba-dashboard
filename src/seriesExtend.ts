import { Appointment, ScheduleData, StoredRecurrencePattern, WishOp } from './types';
import { seriesProfileOf } from './seriesProfile';

// Extend a recurring series forward. Recurrence in this app is a set of dated rows
// materialized up to a fixed end date (AppointmentForm), NOT a live rule — the
// calendar draws only stored rows and never expands the flag (see appointmentsOn /
// scheduleBuilder "never expands a recurring flag"). So a series stops at whatever
// horizon it was created with. This re-materializes the missing occurrences of an
// EXISTING series up to a new end date, under the same seriesId, and folds in any
// stray lone-recurring rows that belong to it (so we relink instead of duplicating).
//
// Cadence comes from seriesProfileOf — MEASURED from the members' own dates (a
// stored label can lie; a mislabeled biweekly must not extend weekly and double
// every occurrence). Weekly / biweekly / custom advance per (weekday, start-clock)
// slot on a 7/14-day period, the most-recent member as the slot's template
// (client/tech/type/duration/title). Monthly advances as ONE sequence per month
// honoring the measured flavor — same day-of-month, or nth-weekday incl. 'last'
// (a naive setMonth(+1) drifts off the weekday). The emitted ops ride the normal
// add/regroup → wishSolutionToDraft → draft-tray pipeline for review.

export interface ExtendSeriesResult {
  ops: WishOp[];
  added: number;      // new occurrences materialized
  relinked: number;   // stray rows folded into the series
  through?: string;   // YYYY-MM-DD of the last occurrence added
  reason?: string;    // why nothing happened (for the UI)
}

const pad = (n: number): string => String(n).padStart(2, '0');
const localISO = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const dayOf = (iso: string): string => iso.slice(0, 10);
const clockOf = (iso: string): string => iso.slice(11, 16);         // "HH:MM"
const slotKey = (a: Appointment): string => `${new Date(a.startTime).getDay()}|${clockOf(a.startTime)}`;
const atClock = (day: string, hh: number, mm: number): Date => {
  const [y, mo, d] = day.split('-').map(Number);
  return new Date(y, mo - 1, d, hh, mm, 0, 0);
};

// The nth <weekday> of a month (nth 1..5 or 'last'). Returns null when the month
// has no nth occurrence (a 5th Friday doesn't exist every month).
function nthWeekdayOf(year: number, month: number, weekday: number, nth: number | 'last'): Date | null {
  if (nth === 'last') {
    const last = new Date(year, month + 1, 0);
    const diff = (last.getDay() - weekday + 7) % 7;
    return new Date(year, month, last.getDate() - diff);
  }
  const first = new Date(year, month, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  const d = new Date(year, month, 1 + offset + (nth - 1) * 7);
  return d.getMonth() === month ? d : null;
}

export function extendSeries(
  data: ScheduleData,
  seriesId: string,
  endDateISO: string,
  now: Date,
): ExtendSeriesResult {
  const endDay = dayOf(endDateISO);
  const nowDay = dayOf(localISO(now));
  const members = data.appointments.filter(a => a.seriesId === seriesId);
  if (members.length === 0) return { ops: [], added: 0, relinked: 0, reason: 'No sessions found in this series.' };

  // Archived case: never extend a series forward for a client that's off the caseload.
  const seriesClient = data.clients.find(c => c.id === members[0].client || c.name === members[0].client);
  if (seriesClient?.archived) return { ops: [], added: 0, relinked: 0, reason: 'This client is archived — its series will not be extended.' };

  // MEASURED cadence — the member dates are ground truth, labels only a fallback.
  const profile = seriesProfileOf(data.appointments, seriesId)!;
  const pat: StoredRecurrencePattern = profile.pattern;

  // One template per (weekday|clock) slot — the most-recent member wins.
  const bySort = [...members].sort((a, b) => a.startTime.localeCompare(b.startTime));
  const slots = new Map<string, Appointment>();
  for (const m of bySort) slots.set(slotKey(m), m);

  // occupiedDates: `${day}|${slotKey}` already covered (a member or an absorbed orphan).
  const occupied = new Set<string>();
  for (const m of members) occupied.add(`${dayOf(m.startTime)}|${slotKey(m)}`);

  // Absorb lone recurring rows that match a slot's identity but aren't in any series.
  const orphanIds: string[] = [];
  for (const a of data.appointments) {
    if (a.seriesId) continue;          // already in a series (this or another) — never poach
    if (!a.isRecurring) continue;      // only stray recurring rows are misplaced occurrences
    const tmpl = slots.get(slotKey(a));
    if (!tmpl || a.client !== tmpl.client || a.technician !== tmpl.technician || a.type !== tmpl.type) continue;
    orphanIds.push(a.id);
    occupied.add(`${dayOf(a.startTime)}|${slotKey(a)}`);
  }

  const addOps: WishOp[] = [];
  let through = '';
  const emit = (tmpl: Appointment, start: Date, durationMs: number): void => {
    addOps.push({
      op: 'add', type: tmpl.type, client: tmpl.client, technician: tmpl.technician,
      title: tmpl.title, start: localISO(start), end: localISO(new Date(start.getTime() + durationMs)),
      recurring: true, pattern: pat, seriesId,
    });
    const day = dayOf(localISO(start));
    if (day > through) through = day;
  };

  if (pat === 'monthly') {
    // ONE sequence per month (a same-date monthly series lands on a different
    // weekday each month — walking it per weekday-slot would multiply the series).
    const tmpl = bySort[bySort.length - 1];
    const durationMs = new Date(tmpl.endTime).getTime() - new Date(tmpl.startTime).getTime();
    const [hh, mm] = clockOf(tmpl.startTime).split(':').map(Number);
    // Anchor = latest covered day (member or absorbed orphan).
    let anchorDay = dayOf(tmpl.startTime);
    for (const a of data.appointments) {
      if (a.seriesId === seriesId || orphanIds.includes(a.id)) {
        if (dayOf(a.startTime) > anchorDay) anchorDay = dayOf(a.startTime);
      }
    }
    const coveredDays = new Set([...occupied].map(k => k.split('|')[0]));
    const anchor = atClock(anchorDay, hh, mm);
    const weekday = anchor.getDay();
    const dom = anchor.getDate();
    for (let step = 1; ; step++) {
      const y = anchor.getFullYear();
      const mo = anchor.getMonth() + step;
      if (new Date(y, mo, 1).getTime() > atClock(endDay, 23, 59).getTime()) break;
      const occDate = profile.monthlyFlavor === 'nth-weekday' && profile.nth !== undefined
        ? nthWeekdayOf(y, mo, weekday, profile.nth)
        // same-date (measured or fallback): same day-of-month, clamped to short months.
        : new Date(y, mo, Math.min(dom, new Date(y, mo + 1, 0).getDate()));
      if (!occDate) continue; // no nth weekday in this month
      occDate.setHours(hh, mm, 0, 0);
      const day = dayOf(localISO(occDate));
      if (day > endDay) continue;
      if (day >= nowDay && !coveredDays.has(day)) {
        emit(tmpl, occDate, durationMs);
        coveredDays.add(day);
      }
    }
  } else {
    // weekly / biweekly / custom: each (weekday|clock) slot advances on its own
    // 7- or 14-day period (a custom weekday-set is a set of weekly slots).
    const stepDays = pat === 'biweekly' ? 14 : 7;
    for (const [key, tmpl] of slots) {
      const durationMs = new Date(tmpl.endTime).getTime() - new Date(tmpl.startTime).getTime();
      const [hh, mm] = clockOf(tmpl.startTime).split(':').map(Number);
      // Anchor = latest date already covered for this slot (member OR absorbed orphan).
      let anchorDay = dayOf(tmpl.startTime);
      for (const a of data.appointments) {
        if (slotKey(a) !== key) continue;
        const covered = a.seriesId === seriesId || orphanIds.includes(a.id);
        if (covered && dayOf(a.startTime) > anchorDay) anchorDay = dayOf(a.startTime);
      }
      const cur = atClock(anchorDay, hh, mm);
      cur.setDate(cur.getDate() + stepDays);
      while (dayOf(localISO(cur)) <= endDay) {
        const day = dayOf(localISO(cur));
        const occKey = `${day}|${key}`;
        if (day >= nowDay && !occupied.has(occKey)) {
          emit(tmpl, new Date(cur), durationMs);
          occupied.add(occKey);
        }
        cur.setDate(cur.getDate() + stepDays);
      }
    }
  }

  const ops: WishOp[] = [];
  if (orphanIds.length) ops.push({ op: 'regroup', appointmentIds: orphanIds, seriesId, recurringPattern: pat });
  ops.push(...addOps);

  return {
    ops,
    added: addOps.length,
    relinked: orphanIds.length,
    through: through || undefined,
    reason: ops.length ? undefined : 'This series already runs through the chosen date.',
  };
}
