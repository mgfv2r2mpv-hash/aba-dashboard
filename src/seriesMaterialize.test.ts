import { describe, it, expect } from 'vitest';
import type { Appointment, DayOfWeek } from './types';
import { materializeSeries, MaterializeSeriesInput } from './seriesMaterialize';

// Characterization (behavior-lock) for materializeSeries — expanding one
// appointment into a bounded recurring series. Every assertion pins the ACTUAL
// current output: concrete occurrence dates, counts, and the recurrence trio.
//
// Determinism: all dated inputs are local ISO strings (no Z), parsed in the
// runner's local zone and re-emitted by the same local formatter, so they
// round-trip exactly. seriesId + non-first ids are uuids — never value-asserted,
// only asserted defined / shared / unique.

// A 1-hour base appointment at `start` (local ISO). Keeps its id as occurrence 0.
function base(start: string, over: Partial<Appointment> = {}): Appointment {
  const end = new Date(new Date(start).getTime() + 60 * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const endIso = `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}T${pad(end.getHours())}:${pad(end.getMinutes())}:00`;
  return {
    id: 'BASE', title: 'Session', client: 'c1', technician: 't1',
    startTime: start, endTime: endIso, isFixed: false, isBillable: true,
    type: 'client-session', status: 'scheduled', ...over,
  };
}
const dates = (r: Appointment[]) => r.map(a => a.startTime.slice(0, 10));
const durMs = (a: Appointment) => new Date(a.endTime).getTime() - new Date(a.startTime).getTime();

// Assert the trio is coherent + shared across an emitted series.
function expectSharedTrio(r: Appointment[], pattern: string): void {
  const sid = r[0].seriesId;
  expect(sid).toBeTruthy();
  for (const a of r) {
    expect(a.seriesId).toBe(sid);
    expect(a.isRecurring).toBe(true);
    expect(a.recurringPattern).toBe(pattern);
  }
  // occurrence 0 keeps the base id; the rest are fresh unique uuids.
  expect(r[0].id).toBe('BASE');
  const ids = r.map(a => a.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const a of r.slice(1)) expect(a.id).not.toBe('BASE');
}

describe('materializeSeries — weekly', () => {
  it('emits every 7 days through an explicit recurrenceEnd horizon (inclusive)', () => {
    const r = materializeSeries({
      base: base('2026-07-15T09:00:00'),
      recurrence: 'weekly',
      recurrenceEnd: '2026-08-12',
    });
    expect(dates(r)).toEqual([
      '2026-07-15', '2026-07-22', '2026-07-29', '2026-08-05', '2026-08-12',
    ]);
    expect(r).toHaveLength(5);
    expectSharedTrio(r, 'weekly');
    // Duration + local wall-clock preserved on every occurrence.
    expect(r.every(a => durMs(a) === 60 * 60_000)).toBe(true);
    expect(r.every(a => a.startTime.endsWith('T09:00:00'))).toBe(true);
    expect(r.every(a => a.endTime.endsWith('T10:00:00'))).toBe(true);
    // monthlyMode is a monthly-only field — never stamped on a weekly series.
    expect(r.every(a => a.monthlyMode === undefined)).toBe(true);
    // Occurrence 0 is the untouched base start (id-stable edit path).
    expect(r[0].startTime).toBe('2026-07-15T09:00:00');
  });

  it('honors authEnd as the horizon when no recurrenceEnd is given', () => {
    const r = materializeSeries({
      base: base('2026-07-15T09:00:00'),
      recurrence: 'weekly',
      authEnd: '2026-08-01', // last Wed before this is Jul 29; Aug 5 falls outside
    });
    expect(dates(r)).toEqual(['2026-07-15', '2026-07-22', '2026-07-29']);
    expectSharedTrio(r, 'weekly');
  });

  it('recurrenceEnd overrides authEnd', () => {
    const r = materializeSeries({
      base: base('2026-07-15T09:00:00'),
      recurrence: 'weekly',
      recurrenceEnd: '2026-07-22', // wins over the later authEnd
      authEnd: '2026-09-01',
    });
    expect(dates(r)).toEqual(['2026-07-15', '2026-07-22']);
  });

  it('falls back to a ~90-day horizon when neither end is given', () => {
    const r = materializeSeries({ base: base('2026-07-15T09:00:00'), recurrence: 'weekly' });
    // 90 days from Jul 15 lands Oct 13; the last weekly step inside it is Oct 7.
    expect(dates(r)).toEqual([
      '2026-07-15', '2026-07-22', '2026-07-29', '2026-08-05', '2026-08-12',
      '2026-08-19', '2026-08-26', '2026-09-02', '2026-09-09', '2026-09-16',
      '2026-09-23', '2026-09-30', '2026-10-07',
    ]);
    expect(r).toHaveLength(13);
    expectSharedTrio(r, 'weekly');
  });
});

describe('materializeSeries — biweekly', () => {
  it('steps 14 days', () => {
    const r = materializeSeries({
      base: base('2026-07-15T09:00:00'),
      recurrence: 'biweekly',
      recurrenceEnd: '2026-09-01',
    });
    expect(dates(r)).toEqual(['2026-07-15', '2026-07-29', '2026-08-12', '2026-08-26']);
    expectSharedTrio(r, 'biweekly');
  });
});

describe('materializeSeries — monthly', () => {
  const modes = (r: Appointment[]) => r.map(a => a.monthlyMode);

  // NEW DEFAULT (no monthlyMode): monthly re-anchors to the ordinal WEEKDAY, so a
  // "first Tuesday" anchor lands on the first Tuesday of every following month —
  // it stays on Tuesday (availability-safe) instead of drifting off the weekday.
  it('defaults to weekday mode — re-anchors to the same ordinal weekday', () => {
    const r = materializeSeries({
      base: base('2026-01-06T09:00:00'), // Jan 6 2026 is the first Tuesday
      recurrence: 'monthly',
      recurrenceEnd: '2026-04-30',
    });
    // First Tuesdays of Jan–Apr 2026: Jan 6, Feb 3, Mar 3, Apr 7 (never Feb/Mar/Apr 6).
    expect(dates(r)).toEqual(['2026-01-06', '2026-02-03', '2026-03-03', '2026-04-07']);
    expect(r).toHaveLength(4);
    expect(r.every(a => new Date(a.startTime).getDay() === 2)).toBe(true); // all Tuesdays
    expect(r.every(a => a.startTime.endsWith('T09:00:00'))).toBe(true);    // clock held
    expect(modes(r)).toEqual(['weekday', 'weekday', 'weekday', 'weekday']); // stamped
    expectSharedTrio(r, 'monthly');
  });

  // Opt-in monthlyMode: 'date' preserves the old same-day-of-month stepping.
  it("monthlyMode: 'date' keeps the same day-of-month (weekday drifts)", () => {
    const r = materializeSeries({
      base: base('2026-01-15T09:00:00'),
      recurrence: 'monthly',
      monthlyMode: 'date',
      recurrenceEnd: '2026-05-20',
    });
    expect(dates(r)).toEqual([
      '2026-01-15', '2026-02-15', '2026-03-15', '2026-04-15', '2026-05-15',
    ]);
    expect(r).toHaveLength(5);
    // Jan 15 is a Thursday; Feb 15 (a Sunday) is NOT — the weekday drifts by design.
    expect(new Date(r[0].startTime).getDay()).toBe(4);
    expect(new Date(r[1].startTime).getDay()).not.toBe(4);
    expect(modes(r)).toEqual(['date', 'date', 'date', 'date', 'date']); // stamped
    expectSharedTrio(r, 'monthly');
  });

  // weekday mode fallback: a 5th-weekday anchor has no 5th counterpart in months
  // that lack one, so those occurrences fall back to the LAST weekday.
  it('weekday mode falls back to the last weekday when there is no 5th', () => {
    const r = materializeSeries({
      base: base('2026-01-30T09:00:00'), // Jan 30 2026 is the 5th (and last) Friday
      recurrence: 'monthly',
      recurrenceEnd: '2026-05-31',
    });
    // Last Fridays Jan–May 2026: Jan 30, Feb 27, Mar 27, Apr 24, May 29.
    expect(dates(r)).toEqual(['2026-01-30', '2026-02-27', '2026-03-27', '2026-04-24', '2026-05-29']);
    expect(r.every(a => new Date(a.startTime).getDay() === 5)).toBe(true); // all Fridays
    expect(modes(r)).toEqual(['weekday', 'weekday', 'weekday', 'weekday', 'weekday']);
    expectSharedTrio(r, 'monthly');
  });
});

describe('materializeSeries — custom-days', () => {
  it('emits on each selected weekday within the horizon and stamps pattern "custom"', () => {
    const selectedDays: DayOfWeek[] = ['Monday', 'Wednesday'];
    const r = materializeSeries({
      base: base('2026-07-13T09:00:00'), // Jul 13 2026 is a Monday
      recurrence: 'custom-days',
      selectedDays,
      recurrenceEnd: '2026-07-24',
    });
    expect(dates(r)).toEqual(['2026-07-13', '2026-07-15', '2026-07-20', '2026-07-22']);
    // Every occurrence lands on Monday (1) or Wednesday (3).
    expect(r.every(a => [1, 3].includes(new Date(a.startTime).getDay()))).toBe(true);
    expectSharedTrio(r, 'custom');
  });

  it('returns the base untouched when no selected day falls in the span', () => {
    const original = base('2026-07-13T09:00:00'); // a Monday
    const r = materializeSeries({
      base: original,
      recurrence: 'custom-days',
      selectedDays: ['Sunday'],
      recurrenceEnd: '2026-07-13', // single-day span, no Sunday
    });
    expect(r).toEqual([original]);
    expect(r[0].isRecurring).toBeUndefined();
    expect(r[0].seriesId).toBeUndefined();
  });
});

describe('materializeSeries — custom-dates', () => {
  it('emits exactly the listed dates (ignoring the weekly/horizon math) at the base clock', () => {
    const r = materializeSeries({
      base: base('2026-07-15T09:00:00'),
      recurrence: 'custom-dates',
      customDates: ['2026-07-20', '2026-08-03', '2026-09-14'],
    });
    expect(r.map(a => a.startTime)).toEqual([
      '2026-07-20T09:00:00', '2026-08-03T09:00:00', '2026-09-14T09:00:00',
    ]);
    expect(r).toHaveLength(3);
    expectSharedTrio(r, 'custom');
  });
});

describe('materializeSeries — one-off short-circuits', () => {
  it('a make-up is never expanded — returns [base]', () => {
    const original = base('2026-07-15T09:00:00', { isMakeUp: true, makeupForId: 'gone' });
    const r = materializeSeries({ base: original, recurrence: 'weekly', recurrenceEnd: '2026-09-01' });
    expect(r).toEqual([original]);
    expect(r[0]).toBe(original); // identity — untouched, no trio stamped
  });

  it('an unparseable start returns [base]', () => {
    const original = base('2026-07-15T09:00:00', { startTime: 'not-a-date' });
    const r = materializeSeries({ base: original, recurrence: 'weekly', recurrenceEnd: '2026-09-01' });
    expect(r).toEqual([original]);
    expect(r[0]).toBe(original);
  });
});

// A guard against silent signature drift — the exported input contract.
describe('materializeSeries — surface', () => {
  it('accepts the documented input shape', () => {
    const input: MaterializeSeriesInput = { base: base('2026-07-15T09:00:00'), recurrence: 'weekly' };
    expect(Array.isArray(materializeSeries(input))).toBe(true);
  });
});
