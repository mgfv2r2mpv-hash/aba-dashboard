import { describe, it, expect } from 'vitest';
import type { CompanyHoliday } from './types';
import { holidaysInRange, holidayAdjustTarget } from './holidayAdjust';

const holiday = (date: string): CompanyHoliday => ({ id: date, date, name: 'Holiday' });

describe('holidaysInRange', () => {
  const hols = [holiday('2026-06-04'), holiday('2026-06-19'), holiday('2026-07-03')];

  it('counts holidays inside the half-open [start, end) range', () => {
    const start = new Date(2026, 5, 1);  // Jun 1
    const end = new Date(2026, 6, 1);    // Jul 1 (exclusive)
    expect(holidaysInRange(hols, start, end)).toBe(2);
  });

  it('excludes a holiday landing exactly on the exclusive end bound', () => {
    const start = new Date(2026, 5, 19); // Jun 19
    const end = new Date(2026, 6, 3);    // Jul 3 (exclusive) — the Jul 3 holiday is out
    expect(holidaysInRange(hols, start, end)).toBe(1);
  });

  it('returns 0 for missing/empty holiday lists', () => {
    expect(holidaysInRange(undefined, new Date(2026, 5, 1), new Date(2026, 6, 1))).toBe(0);
    expect(holidaysInRange([], new Date(2026, 5, 1), new Date(2026, 6, 1))).toBe(0);
  });
});

describe('holidayAdjustTarget', () => {
  const base = { enabled: true, perDayHours: 5, expectedWorkdays: 25 };

  it('shrinks an hours target proportionally to working days lost', () => {
    // 1 holiday in a 5-day week: 40h × 4/5 = 32h.
    expect(holidayAdjustTarget({
      kind: 'hours', base: 40, holidays: 1, enabled: true, perDayHours: 5, expectedWorkdays: 5,
    })).toBeCloseTo(32);
  });

  it('drops a billable target by a fixed per-day amount, floored at 0', () => {
    expect(holidayAdjustTarget({ ...base, kind: 'billable', base: 25, holidays: 2 })).toBe(15);
    expect(holidayAdjustTarget({ ...base, kind: 'billable', base: 8, holidays: 3 })).toBe(0);
  });

  it('passes the base through when disabled or no holidays', () => {
    expect(holidayAdjustTarget({ ...base, kind: 'hours', base: 40, holidays: 2, enabled: false })).toBe(40);
    expect(holidayAdjustTarget({ ...base, kind: 'hours', base: 40, holidays: 0 })).toBe(40);
    expect(holidayAdjustTarget({ ...base, kind: 'billable', base: 25, holidays: 0 })).toBe(25);
  });
});
