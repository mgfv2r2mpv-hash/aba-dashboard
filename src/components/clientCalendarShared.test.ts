import { describe, it, expect } from 'vitest';
import type { Client } from '../types';
import { availabilityDensity } from './clientCalendarShared';

const client = (name: string, windows: Record<string, { start: string; end: string }[]>): Client =>
  ({ id: name, name, availabilityWindows: windows } as unknown as Client);

describe('availabilityDensity', () => {
  it('counts overlapping client availability per 30-min slot', () => {
    const a = client('A', { Monday: [{ start: '16:00', end: '18:00' }] }); // 960–1080
    const b = client('B', { Monday: [{ start: '17:00', end: '19:00' }] }); // 1020–1140
    const slots = availabilityDensity([a, b], 'Monday', 16 * 60, 19 * 60, 30);

    expect(slots.map(s => s.startMin)).toEqual([960, 990, 1020, 1050, 1080, 1110]);
    // 16:00–17:00 = A only; 17:00–18:00 = A+B; 18:00–19:00 = B only.
    expect(slots.map(s => s.count)).toEqual([1, 1, 2, 2, 1, 1]);
  });

  it('counts zero where a client has no window for that day', () => {
    const a = client('A', { Monday: [{ start: '16:00', end: '17:00' }] });
    const slots = availabilityDensity([a], 'Tuesday', 16 * 60, 18 * 60, 30);
    expect(slots.every(s => s.count === 0)).toBe(true);
  });

  it('tolerates clients with no availabilityWindows at all', () => {
    const legacy = { id: 'x', name: 'x' } as unknown as Client;
    const slots = availabilityDensity([legacy], 'Monday', 16 * 60, 17 * 60, 30);
    expect(slots.map(s => s.count)).toEqual([0, 0]);
  });
});
