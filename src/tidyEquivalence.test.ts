// Characterization (behavior-lock) tests for the Tidy / Doctor equivalence
// oracle — the load-bearing guard that decides whether a tidy op may auto-apply.
//
// These tests pin the CURRENT contract of `checkEquivalence(before, after, now)`:
//   (a) a schedule vs itself is equivalent (empty diff report);
//   (b) a benign rearrangement (merge contiguous fragments, stamp a seriesId)
//       that preserves every billable/compliance fact stays equivalent;
//   (c) any change that alters direct hours, supervision credit, coverage, or the
//       actual/projected split reports equivalent=false WITH the specific EquivDiff
//       `kind`s the oracle currently emits.
//
// Fixtures mirror scripts/verify-tidy.ts (the tidy fixture source) so the
// ScheduleData shape and settings match how compliance is actually exercised.
// `now` is held FIXED at 2026-07-15T12:00:00; sessions sit on 2026-07-20 (future =
// "projected") so the compliance arm is active — except the straddling-now case,
// which deliberately places fragments across `now` to prove now-sensitivity.

import { describe, it, expect } from 'vitest';
import { ScheduleData, Appointment } from './types';
import { checkEquivalence, EquivReport } from './tidyEquivalence';

const NOW = new Date('2026-07-15T12:00:00');
const D = '2026-07-20'; // future relative to NOW → compliance "projected" arm counts these

let seq = 0;
function appt(p: Partial<Appointment> & { type: Appointment['type']; date: string; start: string; end: string }): Appointment {
  return {
    id: p.id ?? `a${++seq}`, title: p.title ?? p.type, technician: p.technician, client: p.client,
    startTime: `${p.date}T${p.start}:00`, endTime: `${p.date}T${p.end}:00`,
    isFixed: p.isFixed ?? false, isBillable: p.isBillable !== false, type: p.type, status: p.status,
    isMakeUp: p.isMakeUp, makeupForId: p.makeupForId, isRecurring: p.isRecurring,
    recurringPattern: p.recurringPattern, seriesId: p.seriesId, isGhost: p.isGhost, cancellation: p.cancellation,
  };
}

function mkData(appts: Appointment[]): ScheduleData {
  return {
    id: 'd', version: 2,
    clients: [{ id: 'C1', name: 'C1', availabilityWindows: {} }, { id: 'C2', name: 'C2', availabilityWindows: {} }],
    technicians: [
      { id: 'T1', name: 'T1', isRBT: true, assignments: [], availability: {} },
      { id: 'T2', name: 'T2', isRBT: true, assignments: [], availability: {} },
    ],
    settings: { supervisionDirectHoursPercent: 10, supervisionRBTHoursPercent: 10 } as ScheduleData['settings'],
    appointments: appts,
    lastModified: '2026-07-01T00:00:00',
  };
}

const direct = (start: string, end: string, over: Partial<Appointment> = {}) =>
  appt({ type: 'client-session', client: 'C1', technician: 'T1', date: D, start, end, ...over });

const kindsOf = (r: EquivReport) => new Set(r.diffs.map(d => d.kind));

describe('checkEquivalence — equivalent (benign rearrangements)', () => {
  it('reports a schedule against itself as equivalent with zero diffs', () => {
    const base = mkData([direct('10:00', '12:00'), direct('13:00', '15:00')]);
    const report = checkEquivalence(base, base, NOW);
    expect(report.equivalent).toBe(true);
    expect(report.diffs).toEqual([]);
  });

  it('treats merging two exactly-contiguous fragments as equivalent', () => {
    const before = mkData([direct('10:00', '11:00', { id: 'f1' }), direct('11:00', '12:00', { id: 'f2' })]);
    const after = mkData([direct('10:00', '12:00', { id: 'f1' })]);
    const report = checkEquivalence(before, after, NOW);
    expect(report.equivalent).toBe(true);
    expect(report.diffs).toEqual([]);
  });

  it('treats stamping a seriesId on an unchanged row as equivalent', () => {
    const plain = mkData([direct('10:00', '12:00', { id: 'g1' })]);
    const grouped = mkData([direct('10:00', '12:00', { id: 'g1', seriesId: 's1', recurringPattern: 'weekly' })]);
    const report = checkEquivalence(plain, grouped, NOW);
    expect(report.equivalent).toBe(true);
    expect(report.diffs).toEqual([]);
  });

  it('preserves supervision credit when a merge crosses a straddling supervision (additivity)', () => {
    const before = mkData([
      direct('10:00', '11:00', { id: 'f1' }), direct('11:00', '12:00', { id: 'f2' }),
      appt({ type: 'supervision', client: 'C1', date: D, start: '10:30', end: '11:30' }),
    ]);
    const after = mkData([
      direct('10:00', '12:00', { id: 'f1' }),
      appt({ type: 'supervision', client: 'C1', date: D, start: '10:30', end: '11:30' }),
    ]);
    expect(checkEquivalence(before, after, NOW).equivalent).toBe(true);
  });
});

describe('checkEquivalence — NOT equivalent (semantic changes)', () => {
  it('flags removing a session as not equivalent (client direct hours drop)', () => {
    const before = mkData([direct('10:00', '12:00', { id: 'd1' }), direct('13:00', '15:00', { id: 'd2' })]);
    const after = mkData([direct('10:00', '12:00', { id: 'd1' })]);
    const report = checkEquivalence(before, after, NOW);
    expect(report.equivalent).toBe(false);
    expect(report.diffs.length).toBeGreaterThan(0);
    expect(kindsOf(report).has('client-compliance')).toBe(true);
    // Report entries carry a structured { kind, detail } shape.
    for (const d of report.diffs) {
      expect(typeof d.kind).toBe('string');
      expect(typeof d.detail).toBe('string');
    }
  });

  it('flags removing an exact duplicate — caught by the compliance arm, NOT the coverage arm', () => {
    const before = mkData([direct('10:00', '12:00', { id: 'd1' }), direct('10:00', '12:00', { id: 'd2' })]);
    const after = mkData([direct('10:00', '12:00', { id: 'd1' })]);
    const report = checkEquivalence(before, after, NOW);
    const kinds = kindsOf(report);
    expect(report.equivalent).toBe(false);
    expect(kinds.has('client-compliance')).toBe(true); // double-counted direct hours drop
    expect(kinds.has('coverage')).toBe(false);          // union is unchanged — proves both arms matter
  });

  it('flags merging across a real gap as not equivalent (coverage union inflates)', () => {
    const before = mkData([direct('10:00', '11:00', { id: 'f1' }), direct('12:00', '13:00', { id: 'f2' })]);
    const after = mkData([direct('10:00', '13:00', { id: 'f1' })]);
    const report = checkEquivalence(before, after, NOW);
    const kinds = kindsOf(report);
    expect(report.equivalent).toBe(false);
    expect(kinds.has('coverage')).toBe(true);
    expect(kinds.has('client-compliance')).toBe(true);
  });

  it('flags dropping the technician on a direct as not equivalent (tech credit changes)', () => {
    const before = mkData([direct('10:00', '12:00', { id: 'x' })]);
    const after = mkData([direct('10:00', '12:00', { id: 'x', technician: undefined })]);
    const report = checkEquivalence(before, after, NOW);
    expect(report.equivalent).toBe(false);
    expect(kindsOf(report).has('tech-compliance')).toBe(true);
  });
});

describe('checkEquivalence — now-sensitivity (actual/projected split)', () => {
  it('flags a merge that straddles `now` as not equivalent', () => {
    // NOW (12:00) falls strictly between the two fragment STARTS (11:00 and 12:30).
    // Compliance counts a whole session as "actual" when its start <= now, so before
    // the merge only f1 is actual; the merged 11:00–13:30 session (start 11:00 <= now)
    // pulls the future half into the actual roll — a real split shift.
    const before = mkData([
      appt({ type: 'client-session', client: 'C1', technician: 'T1', date: '2026-07-15', start: '11:00', end: '12:30', id: 'f1' }),
      appt({ type: 'client-session', client: 'C1', technician: 'T1', date: '2026-07-15', start: '12:30', end: '13:30', id: 'f2' }),
    ]);
    const after = mkData([
      appt({ type: 'client-session', client: 'C1', technician: 'T1', date: '2026-07-15', start: '11:00', end: '13:30', id: 'f1' }),
    ]);
    expect(checkEquivalence(before, after, NOW).equivalent).toBe(false);
  });
});
