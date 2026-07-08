import { describe, it, expect } from 'vitest';
import { planArchive, unarchiveClient, sessionsCutByArchive } from './clientArchive';
import type { ScheduleData, Appointment } from './types';

const at = (day: number, h = 9): string => new Date(2026, 6, day, h, 0, 0).toISOString();

let seq = 0;
const appt = (over: Partial<Appointment> = {}): Appointment => ({
  id: `a${++seq}`, title: 'T', client: 'C1', technician: 't1',
  startTime: at(10), endTime: at(10, 11),
  isFixed: false, isBillable: true, isRecurring: false, type: 'client-session',
  status: 'scheduled', ...over,
});

const sched = (appts: Appointment[]): ScheduleData => ({
  id: 's', version: 2,
  clients: [
    { id: 'C1', name: 'Casey', availabilityWindows: {} },
    { id: 'C2', name: 'Other', availabilityWindows: {} },
  ],
  technicians: [{ id: 't1', name: 'Tech', isRBT: true, availability: {}, assignments: [] }],
  settings: {} as ScheduleData['settings'],
  appointments: appts, lastModified: 'x',
});

describe('planArchive', () => {
  it('deletes the client\'s sessions on or after the as-of date, keeps earlier ones', () => {
    const before = appt({ id: 'past', startTime: at(5), endTime: at(5, 10) });
    const boundary = appt({ id: 'onday', startTime: at(8), endTime: at(8, 10) }); // exactly as-of
    const after = appt({ id: 'future', startTime: at(20), endTime: at(20, 10) });
    const other = appt({ id: 'other', client: 'C2', startTime: at(20), endTime: at(20, 10) });
    const data = sched([before, boundary, after, other]);

    const { next, removedCount } = planArchive(data, 'C1', '2026-07-08');
    expect(removedCount).toBe(2); // onday + future (>= boundary), inclusive
    const ids = next.appointments.map(a => a.id).sort();
    expect(ids).toEqual(['other', 'past']); // C2 untouched, past kept
    const c1 = next.clients.find(c => c.id === 'C1')!;
    expect(c1.archived).toBe(true);
    expect(c1.archivedAsOf).toBe('2026-07-08');
    // Other client untouched.
    expect(next.clients.find(c => c.id === 'C2')!.archived).toBeUndefined();
  });

  it('matches sessions by client name too (un-healed legacy refs)', () => {
    const byName = appt({ id: 'named', client: 'Casey', startTime: at(20), endTime: at(20, 10) });
    const { removedCount } = planArchive(sched([byName]), 'C1', '2026-07-08');
    expect(removedCount).toBe(1);
  });

  it('archives with zero deletions when nothing is on/after the date', () => {
    const past = appt({ id: 'p', startTime: at(1), endTime: at(1, 10) });
    const { next, removedCount } = planArchive(sched([past]), 'C1', '2026-07-08');
    expect(removedCount).toBe(0);
    expect(next.appointments).toHaveLength(1);
    expect(next.clients.find(c => c.id === 'C1')!.archived).toBe(true);
  });
});

describe('sessionsCutByArchive', () => {
  it('counts what planArchive would remove without mutating', () => {
    const data = sched([
      appt({ id: 'a', startTime: at(3) }),
      appt({ id: 'b', startTime: at(9) }),
      appt({ id: 'c', startTime: at(30) }),
    ]);
    expect(sessionsCutByArchive(data, 'C1', '2026-07-08').sort()).toEqual(['b', 'c']);
    // Pure: original untouched.
    expect(data.appointments).toHaveLength(3);
  });
});

describe('unarchiveClient', () => {
  it('clears the flags and leaves appointments alone', () => {
    const { next } = planArchive(sched([appt({ startTime: at(20) })]), 'C1', '2026-07-08');
    const back = unarchiveClient(next, 'C1');
    const c1 = back.clients.find(c => c.id === 'C1')!;
    expect(c1.archived).toBe(false);
    expect(c1.archivedAsOf).toBeUndefined();
    // Deleted sessions are NOT resurrected — the case returns empty.
    expect(back.appointments).toHaveLength(0);
  });
});
