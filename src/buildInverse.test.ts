// Characterization (behavior-lock) tests for the undo inverse builder —
// `buildInverse(entry, current)` in src/actionLog.ts.
//
// The guarantee under lock: an inverse must be a true inverse. An 'add' inverts to
// a 'remove' and a 'remove' back to an 'add'; a 'move' (captured as a full-appt
// 'edit' by deriveActionEntry) inverts to an 'edit' that restores the ORIGINAL
// times; and applying a committed delta, then applying its inverse, returns the
// schedule to its starting appointments. Round-trips are verified through the real
// draft pipeline (`applyOps` from src/draft.ts) rather than by inspecting op shapes
// alone. Import style + fixture builders mirror src/actionLog.test.ts.

import { describe, it, expect } from 'vitest';
import { deriveActionEntry, buildInverse } from './actionLog';
import { applyOps } from './draft';
import { ScheduleData, Appointment } from './types';

const appt = (id: string, over: Partial<Appointment> = {}): Appointment => ({
  id, title: `T-${id}`, client: 'c1', technician: 't1',
  startTime: '2026-07-06T09:00:00', endTime: '2026-07-06T11:00:00',
  isFixed: false, isBillable: true, isRecurring: false, type: 'client-session',
  status: 'scheduled', ...over,
});

const sched = (appts: Appointment[], over: Partial<ScheduleData> = {}): ScheduleData => ({
  id: 's', version: 2,
  clients: [{ id: 'c1', name: 'Client One', availabilityWindows: {} }],
  technicians: [{ id: 't1', name: 'Tech One', isRBT: true, availability: {}, assignments: [] }],
  settings: {} as ScheduleData['settings'],
  appointments: appts, lastModified: 'x', ...over,
});

const META = { label: 'test change', source: 'manual' as const };
const AT = new Date('2026-07-15T12:00:00'); // deterministic commit clock (never argless new Date())
const entryFor = (prev: ScheduleData, next: ScheduleData) => deriveActionEntry(prev, next, META, AT)!;
const byId = (appts: Appointment[]): Appointment[] => [...appts].sort((a, b) => a.id.localeCompare(b.id));

describe('buildInverse — op-shape inversion', () => {
  it('inverts an add into a remove of the same id', () => {
    const next = sched([appt('a')]);
    const inv = buildInverse(entryFor(sched([]), next), next);
    expect(inv.ops).toHaveLength(1);
    expect(inv.ops[0].kind).toBe('remove');
    expect(inv.ops[0].targetId).toBe('a');
    expect(inv.superseded).toEqual([]);
  });

  it('inverts a remove into an add that restores the original appointment (and its id)', () => {
    const a = appt('a');
    const inv = buildInverse(entryFor(sched([a]), sched([])), sched([]));
    expect(inv.ops).toHaveLength(1);
    expect(inv.ops[0].kind).toBe('add');
    expect(inv.ops[0].appt).toEqual(a);
  });

  it('inverts a move into an edit that restores the original times', () => {
    const a = appt('a', { startTime: '2026-07-06T09:00:00', endTime: '2026-07-06T11:00:00' });
    const moved = { ...a, startTime: '2026-07-06T13:00:00', endTime: '2026-07-06T15:00:00' };
    const next = sched([moved]);
    const inv = buildInverse(entryFor(sched([a]), next), next);
    expect(inv.ops).toHaveLength(1);
    expect(inv.ops[0].kind).toBe('edit');
    expect(inv.ops[0].appt?.startTime).toBe('2026-07-06T09:00:00');
    expect(inv.ops[0].appt?.endTime).toBe('2026-07-06T11:00:00');
    expect(inv.ops[0].appt).toEqual(a);
  });
});

describe('buildInverse — round-trip through applyOps (src/draft.ts)', () => {
  it('a move round-trips: apply the inverse to `next` restores the original appointment', () => {
    const a = appt('a', { startTime: '2026-07-06T09:00:00', endTime: '2026-07-06T11:00:00' });
    const moved = { ...a, startTime: '2026-07-06T13:00:00', endTime: '2026-07-06T15:00:00' };
    const next = sched([moved]);
    const inv = buildInverse(entryFor(sched([a]), next), next);
    const back = applyOps(next, inv.ops);
    expect(byId(back.appointments)).toEqual([a]);
  });

  it('a combined add+move+remove delta round-trips back to the starting appointments', () => {
    const a = appt('a'); // will be moved
    const b = appt('b'); // will be removed
    const c = appt('c', { startTime: '2026-07-06T14:00:00', endTime: '2026-07-06T16:00:00' }); // will be added
    const aMoved = { ...a, startTime: '2026-07-06T10:00:00', endTime: '2026-07-06T12:00:00' };

    const prev = sched([a, b]);
    const next = sched([aMoved, c]);
    const entry = entryFor(prev, next);

    // Forward: applying the committed delta to `prev` reproduces `next`.
    const forward = applyOps(prev, entry.ops);
    expect(byId(forward.appointments)).toEqual(byId(next.appointments));

    // Inverse: applying the inverse to `next` returns exactly to `prev`.
    const inv = buildInverse(entry, next);
    const back = applyOps(next, inv.ops);
    expect(byId(back.appointments)).toEqual(byId(prev.appointments));
  });
});
