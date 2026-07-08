import { describe, it, expect } from 'vitest';
import { detectHintSignals } from './hintCapture';
import { ScheduleData, Appointment, WishOp, SchedulingHints } from './types';

// Mon Jul 6 2026 (local) — all fixtures live in one week unless noted.
// `h` accepts fractional hours (9.5 → 09:30).
const iso = (day: number, h: number) => {
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  return `2026-07-${String(day).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`;
};

const supOp = (client: string, startDay: number, startH: number, hrs: number): WishOp =>
  ({ op: 'add', type: 'supervision', client, start: iso(startDay, startH), end: iso(startDay, startH + hrs) });

const supAppt = (id: string, client: string, startDay: number, startH: number, hrs: number): Appointment => ({
  id, title: 'Supervision', client, technician: 't1', type: 'supervision',
  startTime: iso(startDay, startH), endTime: iso(startDay, startH + hrs),
  isFixed: false, isBillable: true, isRecurring: false, status: 'scheduled',
});

const sched = (appts: Appointment[], hints?: SchedulingHints): ScheduleData => ({
  id: 's', version: 2,
  clients: [{ id: 'c1', name: 'Client AB', availabilityWindows: {}, ...(hints ? { schedulingHints: hints } : {}) }],
  technicians: [{ id: 't1', name: 'Tech One', isRBT: true, availability: {}, assignments: [] }],
  settings: {} as ScheduleData['settings'],
  appointments: appts, lastModified: 'x',
});

describe('detectHintSignals', () => {
  it('detects a consistent daypart move (morning → midday)', () => {
    // Builder placed Mon 9:00 (morning); user accepted it at Mon 11:30 (midday).
    const builderOps = [supOp('Client AB', 6, 9, 1)];
    const accepted = sched([supAppt('s1', 'c1', 6, 11.5, 1)]);
    const signals = detectHintSignals(builderOps, accepted);
    expect(signals).toHaveLength(1);
    expect(signals[0].kind).toBe('daypart');
    expect(signals[0].suggest).toEqual({ preferredDaypart: 'midday' });
    expect(signals[0].clientName).toBe('Client AB');
  });

  it('detects a split (one contact → two summing the same hours)', () => {
    const builderOps = [supOp('Client AB', 6, 9, 1)];
    const accepted = sched([
      supAppt('s1', 'c1', 6, 9, 0.5),
      supAppt('s2', 'c1', 8, 12, 0.5),
    ]);
    const signals = detectHintSignals(builderOps, accepted);
    expect(signals).toHaveLength(1);
    expect(signals[0].kind).toBe('split');
    expect(signals[0].suggest).toEqual({ supervisionStyle: 'split' });
  });

  it('emits nothing when the placement was accepted unchanged', () => {
    const builderOps = [supOp('Client AB', 6, 9, 1)];
    const accepted = sched([supAppt('s1', 'c1', 6, 9, 1)]);
    expect(detectHintSignals(builderOps, accepted)).toEqual([]);
  });

  it('suppresses a signal the client\'s hints already express', () => {
    const builderOps = [supOp('Client AB', 6, 9, 1)];
    const accepted = sched([supAppt('s1', 'c1', 6, 11.5, 1)], { preferredDaypart: 'midday' });
    expect(detectHintSignals(builderOps, accepted)).toEqual([]);
  });

  it('disagreeing weeks veto the daypart signal (no consistent target)', () => {
    const builderOps = [
      supOp('Client AB', 6, 9, 1),   // week 1: morning
      supOp('Client AB', 13, 9, 1),  // week 2: morning
    ];
    const accepted = sched([
      supAppt('s1', 'c1', 6, 11.5, 1), // week 1 moved → midday
      supAppt('s2', 'c1', 13, 18, 1),    // week 2 moved → evening (disagrees)
    ]);
    expect(detectHintSignals(builderOps, accepted)).toEqual([]);
  });

  it('a removed placement produces no signal', () => {
    const builderOps = [supOp('Client AB', 6, 9, 1)];
    const accepted = sched([]); // user deleted it before Accept
    expect(detectHintSignals(builderOps, accepted)).toEqual([]);
  });

  it('a split with materially different total hours is a re-size, not a split', () => {
    const builderOps = [supOp('Client AB', 6, 9, 1)];
    const accepted = sched([
      supAppt('s1', 'c1', 6, 9, 1),
      supAppt('s2', 'c1', 8, 12, 1), // total 2h vs 1h placed — not the same contact split
    ]);
    expect(detectHintSignals(builderOps, accepted)).toEqual([]);
  });

  it('reverse learning: merging a split back offers to drop the hint', () => {
    const builderOps = [
      supOp('Client AB', 6, 9, 0.5),
      supOp('Client AB', 8, 12, 0.5), // builder split (hint active)
    ];
    const accepted = sched([supAppt('s1', 'c1', 6, 9, 1)], { supervisionStyle: 'split' });
    const signals = detectHintSignals(builderOps, accepted);
    expect(signals).toHaveLength(1);
    expect(signals[0].kind).toBe('unsplit');
    expect(signals[0].suggest).toEqual({ supervisionStyle: 'auto' });
  });

  it('no unsplit offer when the split hint is not set', () => {
    const builderOps = [
      supOp('Client AB', 6, 9, 0.5),
      supOp('Client AB', 8, 12, 0.5), // auto-split (no hint)
    ];
    const accepted = sched([supAppt('s1', 'c1', 6, 9, 1)]);
    expect(detectHintSignals(builderOps, accepted)).toEqual([]);
  });
});
