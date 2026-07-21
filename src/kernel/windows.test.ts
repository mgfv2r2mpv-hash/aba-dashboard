import { describe, it, expect } from 'vitest';
import { computeWindowSlots, TechFeasibility } from './windows';

// MIN_SLOT_MINS is 60. Times are minutes-of-day.
const tech = (id: string, caseAvail: [number, number][], busy: [number, number][] = []): TechFeasibility => ({
  tech: { id, name: id.toUpperCase() },
  caseAvail: caseAvail.map(([start, end]) => ({ start, end })),
  busy: busy.map(([start, end]) => ({ start, end })),
});

describe('computeWindowSlots', () => {
  it('returns nothing when the client has no availability', () => {
    expect(computeWindowSlots([], [], [tech('t', [[540, 660]])])).toEqual([]);
  });

  it('returns nothing when no BT is provided', () => {
    expect(computeWindowSlots([{ start: 540, end: 660 }], [], [])).toEqual([]);
  });

  it('intersects client availability with a BT case-availability', () => {
    // client 9:00–12:00, tech available 10:00–14:00 → overlap 10:00–12:00 (120m).
    const slots = computeWindowSlots([{ start: 540, end: 720 }], [], [tech('t', [[600, 840]])]);
    expect(slots).toEqual([{ start: 600, end: 720, techs: [{ id: 't', name: 'T' }] }]);
  });

  it('subtracts both client busy and BT busy', () => {
    // avail 9:00–12:00, tech busy 10:00–11:00, client busy 11:30–12:00.
    // → free 9:00–10:00 (60m ok) and 11:00–11:30 (30m dropped).
    const slots = computeWindowSlots(
      [{ start: 540, end: 720 }],
      [{ start: 690, end: 720 }],
      [tech('t', [[540, 720]], [[600, 660]])],
    );
    expect(slots).toEqual([{ start: 540, end: 600, techs: [{ id: 't', name: 'T' }] }]);
  });

  it('drops windows shorter than MIN_SLOT_MINS', () => {
    // only 45 minutes of mutual availability.
    expect(computeWindowSlots([{ start: 540, end: 585 }], [], [tech('t', [[540, 660]])])).toEqual([]);
  });

  it('skips a BT with no case availability without affecting others', () => {
    const slots = computeWindowSlots(
      [{ start: 540, end: 660 }],
      [],
      [tech('idle', []), tech('t', [[540, 660]])],
    );
    expect(slots).toEqual([{ start: 540, end: 660, techs: [{ id: 't', name: 'T' }] }]);
  });

  it('groups every BT free for the same span onto one window', () => {
    const slots = computeWindowSlots(
      [{ start: 540, end: 660 }],
      [],
      [tech('a', [[540, 660]]), tech('b', [[540, 660]])],
    );
    expect(slots).toEqual([
      { start: 540, end: 660, techs: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] },
    ]);
  });
});
