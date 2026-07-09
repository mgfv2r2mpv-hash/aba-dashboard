// seriesEdit — real batch-edit semantics for a recurring series.
//
// The old form path applied only the new CLOCK to each sibling's own original
// date, so a day-of-week move was a silent no-op draft (the edited row itself
// was a target and kept its old date), and a cadence change did nothing at all.
// This module implements the user-confirmed semantics:
//
//   • Targets are PENDING siblings only — completed/canceled rows are records
//     of fact and are never moved, retimed, re-stamped, or removed. Pending
//     make-ups are one-offs and are never swept along either.
//   • Day-delta shift: a date change moves every target to ITS OWN date + the
//     same delta (Mon-series → Wed = every occurrence steps +2 days), with the
//     new clock, duration, and field overrides.
//   • Cadence change: pending targets re-materialize onto the new grid from the
//     edited occurrence to the series horizon — existing rows are reassigned to
//     grid dates chronologically (id-stable moves), surplus grid dates become
//     adds, surplus rows become removals. Same seriesId throughout.
//   • Cadence 'none' (One-time on a series member): 'following' truncates the
//     series after the edited occurrence; 'all' collapses it to just this one
//     (which becomes an honest one-time). Facts always spared.
//
// Every result is folded through normalizeRecurrenceFields against the
// projected set, so the trio invariant holds without the caller thinking about
// it (summaries for the form's live preview come from summarizeSeriesEdit).

import { Appointment, StoredRecurrencePattern } from './types';
import { normalizeRecurrenceFields } from './seriesProfile';
import { v4 as uuidv4 } from 'uuid';

export type SeriesCadence =
  | null      // cadence untouched — plain shift/retime/field edit
  | 'none'    // One-time selected — truncate (following) or collapse (all)
  | { pattern: StoredRecurrencePattern; weekdays?: number[] }; // re-space

export interface SeriesEditInput {
  all: Appointment[];      // the full appointment list (sibling resolution + normalize)
  original: Appointment;   // the edited occurrence's STORED state
  edited: Appointment;     // the occurrence as edited in the form (same id)
  scope: 'following' | 'all';
  cadence: SeriesCadence;
}

export interface SeriesEditResult {
  upserts: Appointment[];
  removeIds: string[];
  kind: 'shift' | 'respace' | 'truncate' | 'collapse';
  movedCount: number;      // targets kept (shifted or reassigned to the grid)
  addedCount: number;      // brand-new grid occurrences
  removedCount: number;
  dayDelta: number;
  newWeekday: number;      // weekday of the edited occurrence's new date
  pattern?: StoredRecurrencePattern;
}

const DAY_MS = 86_400_000;
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad2 = (n: number) => String(n).padStart(2, '0');
const isFact = (a: Appointment): boolean => a.status === 'completed' || a.status === 'canceled';
const dayOf = (iso: string): string => iso.slice(0, 10);
const clockOf = (iso: string): string => iso.slice(11, 16);
// Noon-anchored day parsing so day arithmetic never slips across DST.
const atNoon = (day: string): Date => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
};
const dayString = (d: Date): string => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const addDays = (day: string, delta: number): string => {
  const d = atNoon(day);
  d.setDate(d.getDate() + delta);
  return dayString(d);
};
const formatLocalISO = (d: Date): string =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;

export function buildSeriesEdit(input: SeriesEditInput): SeriesEditResult {
  const { all, original, edited, scope, cadence } = input;
  const seriesId = original.seriesId ?? '';
  const siblings = all.filter(a => a.seriesId === seriesId);
  const pending = siblings.filter(a => !isFact(a) && !a.isMakeUp);
  const cutoffMs = new Date(original.startTime).getTime();
  const targets = pending
    .filter(s => scope === 'all' || new Date(s.startTime).getTime() >= cutoffMs)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  const dayDelta = Math.round((atNoon(dayOf(edited.startTime)).getTime() - atNoon(dayOf(original.startTime)).getTime()) / DAY_MS);
  const newClock = clockOf(edited.startTime);
  const durationMs = new Date(edited.endTime).getTime() - new Date(edited.startTime).getTime();
  const newWeekday = atNoon(dayOf(edited.startTime)).getDay();

  // Field overrides propagate 1:1 (as the old path did); isFixed/status/
  // cancellation stay per-instance.
  const overridden = (sib: Appointment): Appointment => ({
    ...sib,
    title: edited.title,
    description: edited.description,
    type: edited.type,
    technician: edited.technician,
    client: edited.client,
    isBillable: edited.isBillable,
  });
  const placed = (row: Appointment, day: string): Appointment => {
    const [hh, mm] = newClock.split(':').map(Number);
    const [y, mo, d] = day.split('-').map(Number);
    const start = new Date(y, mo - 1, d, hh, mm, 0, 0);
    return {
      ...overridden(row),
      startTime: formatLocalISO(start),
      endTime: formatLocalISO(new Date(start.getTime() + durationMs)),
    };
  };

  let upserts: Appointment[] = [];
  let removeIds: string[] = [];
  let kind: SeriesEditResult['kind'];
  let movedCount = 0, addedCount = 0;
  let pattern: StoredRecurrencePattern | undefined;

  if (cadence === 'none') {
    // The edited occurrence keeps its own (possibly moved) date/time + fields.
    const editedRow = placed({ ...targets.find(t => t.id === original.id) ?? original }, dayOf(edited.startTime));
    if (scope === 'following') {
      kind = 'truncate';
      removeIds = pending.filter(s => s.id !== original.id && new Date(s.startTime).getTime() > cutoffMs).map(s => s.id);
      upserts = [editedRow];
    } else {
      kind = 'collapse';
      removeIds = pending.filter(s => s.id !== original.id).map(s => s.id);
      const oneTime = { ...editedRow };
      delete oneTime.seriesId;
      delete oneTime.isRecurring;
      delete oneTime.recurringPattern;
      upserts = [oneTime];
    }
    movedCount = 1;
  } else if (cadence !== null) {
    kind = 'respace';
    pattern = cadence.pattern;
    // Grid from the edited occurrence's new date to the (shifted) series horizon.
    const anchorDay = dayOf(edited.startTime);
    const lastTargetDay = targets.length ? dayOf(targets[targets.length - 1].startTime) : anchorDay;
    const horizonDay = dayDelta ? addDays(lastTargetDay, dayDelta) : lastTargetDay;
    // Never double-book a date where a COMPLETED sibling already delivered.
    const completedDays = new Set(siblings.filter(s => s.status === 'completed').map(s => dayOf(s.startTime)));
    const grid: string[] = [];
    if (cadence.pattern === 'weekly' || cadence.pattern === 'biweekly') {
      const step = cadence.pattern === 'biweekly' ? 14 : 7;
      for (let day = anchorDay; day <= horizonDay; day = addDays(day, step)) grid.push(day);
    } else if (cadence.pattern === 'monthly') {
      // Same day-of-month stepping (the form's monthly), clamped for short months.
      const anchor = atNoon(anchorDay);
      for (let k = 0; ; k++) {
        const y = anchor.getFullYear(), mo = anchor.getMonth() + k;
        const day = dayString(new Date(y, mo, Math.min(anchor.getDate(), new Date(y, mo + 1, 0).getDate()), 12));
        if (day > horizonDay) break;
        grid.push(day);
      }
    } else { // custom weekday set
      const weekdays = new Set(cadence.weekdays?.length ? cadence.weekdays : [newWeekday]);
      for (let day = anchorDay; day <= horizonDay; day = addDays(day, 1)) {
        if (weekdays.has(atNoon(day).getDay())) grid.push(day);
      }
    }
    const openGrid = grid.filter(day => !completedDays.has(day));
    // Chronological pairing: id-stable moves, then adds, then removals.
    for (let i = 0; i < Math.max(targets.length, openGrid.length); i++) {
      if (i < targets.length && i < openGrid.length) {
        upserts.push({ ...placed(targets[i], openGrid[i]), seriesId, isRecurring: true, recurringPattern: cadence.pattern });
        movedCount++;
      } else if (i < openGrid.length) {
        upserts.push({ ...placed(targets[0] ?? original, openGrid[i]), id: uuidv4(), status: 'scheduled', seriesId, isRecurring: true, recurringPattern: cadence.pattern });
        addedCount++;
      } else {
        removeIds.push(targets[i].id);
      }
    }
  } else {
    kind = 'shift';
    upserts = targets.map(sib => placed(sib, addDays(dayOf(sib.startTime), dayDelta)));
    movedCount = targets.length;
  }

  // Fold the trio invariant over the projected set, but only sweep rows that
  // belong to THIS series (an unrelated half-state elsewhere isn't this edit's
  // business): e.g. a truncate that leaves a singleton clears its trio, a
  // stale-seriesId make-up heals to a one-off, earlier siblings re-measure.
  const byId = new Map(all.map(a => [a.id, a]));
  for (const u of upserts) byId.set(u.id, u);
  for (const id of removeIds) byId.delete(id);
  const projected = [...byId.values()];
  const normalized = normalizeRecurrenceFields(projected);
  if (normalized.changedIds.length) {
    const upsertIds = new Set(upserts.map(u => u.id));
    const seriesIds = new Set(siblings.map(s => s.id));
    for (const row of normalized.appointments) {
      if (!normalized.changedIds.includes(row.id)) continue;
      if (!upsertIds.has(row.id) && !seriesIds.has(row.id)) continue;
      upserts = upserts.some(u => u.id === row.id)
        ? upserts.map(u => (u.id === row.id ? row : u))
        : [...upserts, row];
    }
  }

  // Drop no-op upserts (row identical to what's already stored) EXCEPT the
  // edited row itself — the user explicitly saved it, and dropping it would
  // make an unchanged save feel ignored.
  const current = new Map(all.map(a => [a.id, JSON.stringify(a)]));
  upserts = upserts.filter(u => u.id === original.id || current.get(u.id) !== JSON.stringify(u));

  return {
    upserts, removeIds, kind,
    movedCount, addedCount, removedCount: removeIds.length,
    dayDelta, newWeekday, pattern,
  };
}

// Human summary for the form's live preview — the consequence is visible
// BEFORE Save (user decision: no silent series rewrites).
export function summarizeSeriesEdit(r: SeriesEditResult): string {
  const n = (k: number) => `${k} upcoming session${k === 1 ? '' : 's'}`;
  switch (r.kind) {
    case 'truncate':
      return r.removedCount
        ? `Ends the series here — removes ${n(r.removedCount)}.`
        : 'Ends the series here (no later sessions to remove).';
    case 'collapse':
      return `Removes ${n(r.removedCount)} — this becomes a one-time session.`;
    case 'respace': {
      const label = r.pattern === 'biweekly' ? 'every other week'
        : r.pattern === 'weekly' ? 'every week'
        : r.pattern === 'monthly' ? 'monthly'
        : 'the selected weekdays';
      const parts: string[] = [];
      if (r.addedCount) parts.push(`adds ${r.addedCount}`);
      if (r.removedCount) parts.push(`removes ${r.removedCount}`);
      return `Re-spaces ${n(r.movedCount + r.addedCount)} to ${label}${parts.length ? ` (${parts.join(', ')})` : ''}.`;
    }
    default:
      return r.dayDelta !== 0
        ? `Moves ${n(r.movedCount)} to ${WEEKDAY_NAMES[r.newWeekday]}.`
        : `Updates ${n(r.movedCount)} (dates kept).`;
  }
}
