import { describe, it, expect } from 'vitest';
import { overlaps, overlapsAny } from './overlap';

// Boundary lock for the single collision primitive. The STRICT semantics
// (touching intervals do not overlap) is relied on by back-to-back scheduling
// and adjacent-fragment fusion — see builderBcba.test.ts.
describe('overlaps', () => {
  it('true when intervals genuinely intersect', () => {
    expect(overlaps(0, 10, 5, 15)).toBe(true);   // partial
    expect(overlaps(5, 15, 0, 10)).toBe(true);   // partial (commutative)
    expect(overlaps(2, 8, 0, 10)).toBe(true);    // enclosed
    expect(overlaps(0, 10, 2, 8)).toBe(true);    // enclosing
    expect(overlaps(0, 10, 0, 10)).toBe(true);   // identical
  });

  it('false when intervals only TOUCH (aEnd === bStart) — the load-bearing boundary', () => {
    expect(overlaps(0, 10, 10, 20)).toBe(false); // after-touch
    expect(overlaps(10, 20, 0, 10)).toBe(false); // before-touch
  });

  it('false when intervals are fully disjoint', () => {
    expect(overlaps(0, 10, 11, 20)).toBe(false);
    expect(overlaps(11, 20, 0, 10)).toBe(false);
  });
});

describe('overlapsAny', () => {
  const busy = [{ s: 0, e: 10 }, { s: 20, e: 30 }];

  it('true when the query overlaps any busy interval', () => {
    expect(overlapsAny(5, 25, busy)).toBe(true);
    expect(overlapsAny(25, 35, busy)).toBe(true);
  });

  it('false when the query fits in a gap or only touches', () => {
    expect(overlapsAny(10, 20, busy)).toBe(false); // exactly in the gap, touching both
    expect(overlapsAny(30, 40, busy)).toBe(false); // after, touching
  });

  it('false against an empty busy set', () => {
    expect(overlapsAny(0, 100, [])).toBe(false);
  });
});
