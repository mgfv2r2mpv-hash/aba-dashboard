import { describe, it, expect } from 'vitest';
import { MAX_DIRECT_SESSION_HRS, MIN_SESSION_HRS, directBlockHours } from './placement';

describe('kernel/placement', () => {
  it('pins the shared bounds', () => {
    expect(MAX_DIRECT_SESSION_HRS).toBe(4);
    expect(MIN_SESSION_HRS).toBe(0.5);
  });

  it('caps the block at the open window', () => {
    expect(directBlockHours(1.5, 10, 4)).toBe(1.5); // window is the binding limit
  });

  it('caps the block at the remaining gap', () => {
    expect(directBlockHours(6, 2, 4)).toBe(2); // no overshoot beyond the need
  });

  it('caps the block at the per-session ceiling', () => {
    expect(directBlockHours(8, 8, 4)).toBe(4); // default ceiling
    expect(directBlockHours(8, 8, 2)).toBe(2); // lowered per-case override wins
  });

  it('defaults the ceiling to MAX_DIRECT_SESSION_HRS', () => {
    expect(directBlockHours(8, 8)).toBe(MAX_DIRECT_SESSION_HRS);
  });

  it('can return a sub-minimum sliver (caller applies the MIN guard)', () => {
    expect(directBlockHours(0.25, 5, 4)).toBe(0.25); // < MIN — the loop skips it, not this fn
  });
});
