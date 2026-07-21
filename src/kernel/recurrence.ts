// recurrence — the single source of MONTHLY stepping for the schedule engine.
//
// A monthly series is inherently ambiguous: "the 6th" and "the first Tuesday"
// coincide once, then diverge. This module owns the two ways a monthly cadence
// can advance and nothing else re-implements them:
//
//   'date'    — same day-of-month (naive setMonth; Jan 31 → Mar 3 overflow kept).
//   'weekday' — same ordinal weekday (1st Tuesday → 1st Tuesday), which keeps the
//               series on one weekday so it stays inside a tech's availability.
//
// Both materializeSeries (create) and extendSeries (extend) route their monthly
// math through here so nthWeekdayOf has exactly one home. Dates are treated as
// LOCAL wall-clock: stepping preserves the anchor's hours/minutes across DST, and
// month arguments may be un-normalized (e.g. anchor.getMonth() + step) — they are
// folded into a real year/month.

/**
 * The nth <weekday> of a month (nth 1..5, or 'last'). Returns null when the month
 * has no nth occurrence — a 5th Friday does not exist every month. `month` may be
 * out of 0..11 range (callers pass anchor.getMonth() + step); it is normalized.
 */
export function nthWeekdayOf(
  year: number,
  month: number,
  weekday: number,
  nth: number | 'last',
): Date | null {
  // Fold an un-normalized month into a real year/month so the getMonth() identity
  // check below stays valid even across a year boundary.
  const y = year + Math.floor(month / 12);
  const m = ((month % 12) + 12) % 12;
  if (nth === 'last') {
    const last = new Date(y, m + 1, 0);
    const diff = (last.getDay() - weekday + 7) % 7;
    return new Date(y, m, last.getDate() - diff);
  }
  const first = new Date(y, m, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  const d = new Date(y, m, 1 + offset + (nth - 1) * 7);
  return d.getMonth() === m ? d : null;
}

/**
 * Which ordinal that weekday is within its own month — { weekday, nth }. Returns
 * nth: 'last' when the date is the FINAL occurrence of its weekday in the month (a
 * +7 step rolls into the next month), so "last Friday" cadence survives stepping;
 * otherwise the 1-based ordinal (1st..4th). A 5th occurrence is always final, so it
 * reports as 'last'.
 */
export function weekdayOrdinalOf(date: Date): { weekday: number; nth: number | 'last' } {
  const weekday = date.getDay();
  const dom = date.getDate();
  const daysInMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const isFinal = dom + 7 > daysInMonth;
  return { weekday, nth: isFinal ? 'last' : Math.ceil(dom / 7) };
}

/**
 * The next month's occurrence from `anchor`, per mode. 'date' keeps the same
 * day-of-month via setMonth (JS overflow preserved deliberately — the historical
 * materialize behavior). 'weekday' re-anchors to the same ordinal weekday next
 * month; if that ordinal has no counterpart next month (e.g. a 5th Tuesday), it
 * falls back to the LAST such weekday. Either way the anchor's local hours/minutes
 * are re-pinned so the wall-clock stays stable across DST.
 */
export function nextMonthly(anchor: Date, mode: 'weekday' | 'date'): Date {
  const hh = anchor.getHours();
  const mm = anchor.getMinutes();
  if (mode === 'date') {
    const d = new Date(anchor);
    d.setMonth(d.getMonth() + 1);
    d.setHours(hh, mm, 0, 0);
    return d;
  }
  const { weekday, nth } = weekdayOrdinalOf(anchor);
  const year = anchor.getFullYear();
  const month = anchor.getMonth() + 1; // next month (12 normalized inside nthWeekdayOf)
  const target =
    (nth === 'last' ? null : nthWeekdayOf(year, month, weekday, nth)) ??
    nthWeekdayOf(year, month, weekday, 'last')!; // 'last' always resolves
  target.setHours(hh, mm, 0, 0);
  return target;
}
