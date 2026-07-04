import type { CompanyHoliday } from './types';

// ---------------------------------------------------------------------------
// Holiday-adjusted targets
//
// When CompanySettings.holidayAffectsBillable is on, company holidays that fall
// inside a period lower that period's targets:
//   • hours/auth targets (client direct, BT direct) shrink PROPORTIONALLY to the
//     working days lost — a holiday is one fewer day to deliver the same auth.
//   • billable targets (BCBA billable) drop by a FIXED holidayBillableHoursPerDay
//     for each holiday day, mirroring ptoBillableDeductionRatio's per-day intent.
// Both are floored at 0. With the toggle off (or no holidays), targets pass
// through unchanged.
// ---------------------------------------------------------------------------

// Local YYYY-MM-DD for a Date (matches CompanyHoliday.date, which is a local day).
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Count company holidays whose calendar day falls in the half-open range
// [start, end) — same boundary convention as the trend windows' inRange.
export function holidaysInRange(
  holidays: CompanyHoliday[] | undefined,
  start: Date,
  end: Date,
): number {
  if (!holidays || holidays.length === 0) return 0;
  const startYMD = ymd(start);
  const endYMD = ymd(end);
  return holidays.filter(h => h.date >= startYMD && h.date < endYMD).length;
}

export type HolidayTargetKind = 'hours' | 'billable';

export interface HolidayAdjustParams {
  kind: HolidayTargetKind;
  base: number;              // the un-adjusted target for the period
  holidays: number;          // holiday days in the period (from holidaysInRange)
  enabled: boolean;          // CompanySettings.holidayAffectsBillable
  perDayHours: number;       // CompanySettings.holidayBillableHoursPerDay (billable)
  expectedWorkdays: number;  // full-attendance working days in the period (hours)
}

// Reduce a period target for the holidays it contains. See module header.
export function holidayAdjustTarget(p: HolidayAdjustParams): number {
  const { kind, base, holidays, enabled, perDayHours, expectedWorkdays } = p;
  if (!enabled || holidays <= 0 || base <= 0) return base;
  if (kind === 'billable') {
    return Math.max(0, base - perDayHours * holidays);
  }
  // hours/auth: proportional to working days remaining.
  if (expectedWorkdays <= 0) return base;
  const remaining = Math.max(0, expectedWorkdays - holidays);
  return base * (remaining / expectedWorkdays);
}
