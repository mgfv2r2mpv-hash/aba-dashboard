import { describe, it, expect } from 'vitest';
import { nthWeekdayOf, weekdayOrdinalOf, nextMonthly } from './recurrence';

// Behavior-lock for the monthly-stepping kernel. All fixtures are 2026 dates
// (Tue=2, Thu=4, Fri=5) reasoned from the calendar, no Date.now().
const ymd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('nthWeekdayOf', () => {
  it('locates the 1st/3rd/last weekday of a month', () => {
    expect(ymd(nthWeekdayOf(2026, 0, 2, 1)!)).toBe('2026-01-06'); // 1st Tuesday Jan
    expect(ymd(nthWeekdayOf(2026, 0, 4, 3)!)).toBe('2026-01-15'); // 3rd Thursday Jan
    expect(ymd(nthWeekdayOf(2026, 1, 5, 'last')!)).toBe('2026-02-27'); // last Friday Feb
  });

  it("returns null when the nth weekday doesn't exist that month", () => {
    // Feb 2026 has only four Tuesdays (3,10,17,24) — no 5th.
    expect(nthWeekdayOf(2026, 1, 2, 5)).toBeNull();
    // Jan 2026 has five Fridays (2,9,16,23,30) — the 5th exists.
    expect(ymd(nthWeekdayOf(2026, 0, 5, 5)!)).toBe('2026-01-30');
  });

  it('normalizes an out-of-range month across the year boundary', () => {
    // month 12 → January of the next year. 1st Tuesday of Jan 2027 is the 5th.
    expect(ymd(nthWeekdayOf(2026, 12, 2, 1)!)).toBe('2027-01-05');
  });
});

describe('weekdayOrdinalOf', () => {
  const at = (day: string): Date => {
    const [y, m, d] = day.split('-').map(Number);
    return new Date(y, m - 1, d);
  };

  it('reports the 1-based ordinal for a non-final occurrence', () => {
    expect(weekdayOrdinalOf(at('2026-01-06'))).toEqual({ weekday: 2, nth: 1 }); // 1st Tue
    expect(weekdayOrdinalOf(at('2026-01-15'))).toEqual({ weekday: 4, nth: 3 }); // 3rd Thu
    expect(weekdayOrdinalOf(at('2026-01-23'))).toEqual({ weekday: 5, nth: 4 }); // 4th Fri, not last
  });

  it("reports 'last' when it is the final occurrence of that weekday", () => {
    expect(weekdayOrdinalOf(at('2026-01-30'))).toEqual({ weekday: 5, nth: 'last' }); // 5th & last Fri
    expect(weekdayOrdinalOf(at('2026-02-27'))).toEqual({ weekday: 5, nth: 'last' }); // 4th & last Fri
  });
});

describe('nextMonthly — date mode', () => {
  const at = (iso: string): Date => {
    const [d, t] = iso.split('T');
    const [y, m, day] = d.split('-').map(Number);
    const [hh, mm] = (t ?? '00:00').split(':').map(Number);
    return new Date(y, m - 1, day, hh, mm, 0, 0);
  };

  it('keeps the same day-of-month and clock', () => {
    const n = nextMonthly(at('2026-01-15T09:30'), 'date');
    expect(ymd(n)).toBe('2026-02-15');
    expect([n.getHours(), n.getMinutes()]).toEqual([9, 30]);
  });

  it('preserves the historical naive-setMonth overflow (Jan 31 → Mar 3)', () => {
    expect(ymd(nextMonthly(at('2026-01-31T09:00'), 'date'))).toBe('2026-03-03');
  });
});

describe('nextMonthly — weekday mode', () => {
  const at = (iso: string): Date => {
    const [d, t] = iso.split('T');
    const [y, m, day] = d.split('-').map(Number);
    const [hh, mm] = (t ?? '00:00').split(':').map(Number);
    return new Date(y, m - 1, day, hh, mm, 0, 0);
  };

  it('re-anchors to the same ordinal weekday and holds the clock', () => {
    const n = nextMonthly(at('2026-01-06T09:00'), 'weekday'); // 1st Tue Jan → 1st Tue Feb
    expect(ymd(n)).toBe('2026-02-03');
    expect(n.getDay()).toBe(2);
    expect([n.getHours(), n.getMinutes()]).toEqual([9, 0]);
  });

  it('stays on the same weekday across a three-month walk', () => {
    let occ = at('2026-01-06T09:00');
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) { occ = nextMonthly(occ, 'weekday'); seen.push(ymd(occ)); }
    expect(seen).toEqual(['2026-02-03', '2026-03-03', '2026-04-07']); // all 1st Tuesdays
  });

  it('falls back to the LAST weekday when the anchor is a 5th with no counterpart', () => {
    // Jan 30 is the 5th (and last) Friday; Feb 2026 has no 5th Friday → last Friday Feb 27.
    const n = nextMonthly(at('2026-01-30T10:00'), 'weekday');
    expect(ymd(n)).toBe('2026-02-27');
    expect(n.getDay()).toBe(5);
  });
});
