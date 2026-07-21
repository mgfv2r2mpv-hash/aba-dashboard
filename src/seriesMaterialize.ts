// seriesMaterialize — expand one appointment into a bounded recurring series.
//
// Extracted from AppointmentForm's creation path so BOTH entrances share it: a
// brand-new recurring appointment AND a one-time→recurring conversion on an
// existing row (the base keeps its id, so the edit is id-stable). Recurrence in
// this app is bounded dated rows, never a live rule — the horizon is an explicit
// end date, else the client's authorization end, else 90 days out. Every
// occurrence is born with the FULL trio (shared minted seriesId, isRecurring,
// typed pattern) so no half-state can enter through this path.

import { Appointment, DayOfWeek, StoredRecurrencePattern } from './types';
import { nextMonthly } from './kernel/recurrence';
import { v4 as uuidv4 } from 'uuid';

export type MaterializeRecurrence = 'weekly' | 'biweekly' | 'monthly' | 'custom-days' | 'custom-dates';

export interface MaterializeSeriesInput {
  base: Appointment;           // first-occurrence template; keeps its id
  recurrence: MaterializeRecurrence;
  selectedDays?: DayOfWeek[];  // custom-days: which weekdays
  customDates?: string[];      // custom-dates: explicit YYYY-MM-DD list
  recurrenceEnd?: string;      // YYYY-MM-DD horizon override
  authEnd?: string;            // YYYY-MM-DD client authorization end
  monthlyMode?: 'weekday' | 'date'; // monthly only; default 'weekday' (see below)
}

const DAYS: DayOfWeek[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const pad2 = (n: number) => String(n).padStart(2, '0');
const formatLocalISO = (d: Date): string =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;

export function materializeSeries(input: MaterializeSeriesInput): Appointment[] {
  const { base, recurrence } = input;
  // A make-up recovers ONE canceled session — inherently a one-off. The form
  // locks the recurrence select for make-ups; this is the belt-and-braces.
  if (base.isMakeUp) return [base];

  const start = new Date(base.startTime);
  if (isNaN(start.getTime())) return [base];
  const durationMs = new Date(base.endTime).getTime() - start.getTime();

  const defaultEnd = input.authEnd
    ? new Date(`${input.authEnd}T23:59:59`)
    : new Date(start.getTime() + 90 * 24 * 60 * 60 * 1000);
  const end = input.recurrenceEnd ? new Date(`${input.recurrenceEnd}T23:59:59`) : defaultEnd;

  const seriesId = uuidv4();
  const pattern: StoredRecurrencePattern =
    recurrence === 'custom-days' || recurrence === 'custom-dates' ? 'custom' : recurrence;

  // Monthly stepping unifies behind kernel/recurrence.nextMonthly. The default is
  // 'weekday' — re-anchoring to the same ordinal weekday (1st Tuesday → 1st
  // Tuesday) keeps every occurrence on the same weekday, so it stays inside the
  // tech's availability instead of drifting off it like a naive day-of-month step.
  const isMonthly = recurrence === 'monthly';
  const monthlyMode: 'weekday' | 'date' = input.monthlyMode ?? 'weekday';

  const result: Appointment[] = [];
  const emit = (occStart: Date): void => {
    result.push({
      ...base,
      id: result.length === 0 ? base.id : uuidv4(),
      startTime: formatLocalISO(occStart),
      endTime: formatLocalISO(new Date(occStart.getTime() + durationMs)),
      seriesId,
      isRecurring: true,
      recurringPattern: pattern,
      // Only monthly rows carry the mode; it recovers the flavor without measuring.
      ...(isMonthly ? { monthlyMode } : {}),
    });
  };

  if (recurrence === 'weekly' || recurrence === 'biweekly' || recurrence === 'monthly') {
    // Date-arithmetic stepping (not ms) keeps the local clock stable across DST.
    let occ = new Date(start);
    while (occ <= end) {
      emit(new Date(occ));
      if (isMonthly) {
        occ = nextMonthly(occ, monthlyMode);
      } else {
        occ.setDate(occ.getDate() + (recurrence === 'weekly' ? 7 : 14));
        occ.setHours(start.getHours(), start.getMinutes(), 0, 0);
      }
    }
  } else if (recurrence === 'custom-days') {
    const selected = new Set(input.selectedDays ?? []);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dayName = DAYS[(d.getDay() + 6) % 7];
      if (!dayName || !selected.has(dayName)) continue;
      const occ = new Date(d);
      occ.setHours(start.getHours(), start.getMinutes(), 0, 0);
      emit(occ);
    }
  } else { // custom-dates
    for (const dateStr of input.customDates ?? []) {
      const occ = new Date(`${dateStr}T${pad2(start.getHours())}:${pad2(start.getMinutes())}:00`);
      if (isNaN(occ.getTime())) continue;
      emit(occ);
    }
  }

  // Nothing matched (e.g. no selected days in the span): a series of one is a
  // one-time — return the base untouched rather than minting a singleton series.
  return result.length > 0 ? result : [base];
}
