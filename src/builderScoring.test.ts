import { describe, it, expect } from 'vitest';
import {
  DAYPART_BANDS, daypartOfMs, addedTravelMinutes, compareSlots, SlotCandidate,
} from './builderScoring';
import type { BcbaBusy } from './builderBcba';
import type { TravelContext } from './travel';
import { DEFAULT_TRAVEL_SETTINGS } from './types';

const at = (h: number, m = 0) => new Date(2026, 6, 6, h, m).getTime(); // Mon Jul 6 2026, local

describe('daypartOfMs', () => {
  it('maps band interiors to their daypart', () => {
    expect(daypartOfMs(at(8))).toBe('morning');
    expect(daypartOfMs(at(12, 30))).toBe('midday');
    expect(daypartOfMs(at(15))).toBe('afternoon');
    expect(daypartOfMs(at(18, 45))).toBe('evening');
  });

  it('band starts are inclusive, ends exclusive', () => {
    expect(daypartOfMs(at(11))).toBe('midday');     // 11:00 starts midday
    expect(daypartOfMs(at(10, 59))).toBe('morning');
    expect(daypartOfMs(at(14))).toBe('afternoon');  // 14:00 leaves midday
    expect(daypartOfMs(at(17))).toBe('evening');
  });

  it('outside all bands returns undefined (early morning / late night)', () => {
    expect(daypartOfMs(at(5, 30))).toBeUndefined();
    expect(daypartOfMs(at(21))).toBeUndefined();
    expect(daypartOfMs(at(23))).toBeUndefined();
  });

  it('bands tile 06:00–21:00 with no gaps', () => {
    const parts = Object.values(DAYPART_BANDS).sort((a, b) => a.start - b.start);
    for (let i = 1; i < parts.length; i++) expect(parts[i].start).toBe(parts[i - 1].end);
  });
});

describe('addedTravelMinutes', () => {
  // Real TravelContext shape (travel.ts): clients CA/CX in 'a-town', CB in
  // 'b-town'; HOME's exact coords sit ON a-town's centroid (0-minute fallback
  // leg) so the within-city arithmetic is the only nonzero term. No routed
  // cache entries → cross-city falls back to haversine.
  const ctx: TravelContext = {
    settings: { ...DEFAULT_TRAVEL_SETTINGS, enabled: true, withinCityMin: 15, padPercent: 0 },
    centers: new Map([['a-town', { lat: 40.0, lng: -75.0 }], ['b-town', { lat: 40.5, lng: -75.5 }]]),
    cache: new Map<string, number>(),
    homeBase: { lat: 40.0, lng: -75.0 },
    clientLoc: new Map([['CA', 'a-town'], ['CX', 'a-town'], ['CB', 'b-town']]),
  };

  it('returns 0 without a travel context', () => {
    expect(addedTravelMinutes([], 'CA', { startMs: at(10), endMs: at(11) }, undefined)).toBe(0);
  });

  it('a same-city neighbor adds the within-city floor leg', () => {
    const busy: BcbaBusy = [{ s: at(8), e: at(9), loc: 'CX' }];
    // prev=CX(a-town)→CA(a-town): within-city 15; CA→HOME: centroid-identical
    // fallback 0; baseline CX→HOME: 0. Detour = 15 + 0 − 0 = 15.
    expect(addedTravelMinutes(busy, 'CA', { startMs: at(10), endMs: at(11) }, ctx)).toBe(15);
  });

  it('ignores busy blocks on other calendar days (the route is per-day)', () => {
    const busy: BcbaBusy = [{ s: at(8) - 86_400_000, e: at(9) - 86_400_000, loc: 'CB' }];
    const withOtherDay = addedTravelMinutes(busy, 'CA', { startMs: at(10), endMs: at(11) }, ctx);
    const withNothing = addedTravelMinutes([], 'CA', { startMs: at(10), endMs: at(11) }, ctx);
    expect(withOtherDay).toBe(withNothing);
  });

  it('a cross-city slot wedged between same-city blocks costs more than a same-city one', () => {
    const busy: BcbaBusy = [
      { s: at(8), e: at(9), loc: 'CX' },
      { s: at(13), e: at(14), loc: 'CA' },
    ];
    const sameCity = addedTravelMinutes(busy, 'CA', { startMs: at(10), endMs: at(11) }, ctx);
    const crossCity = addedTravelMinutes(busy, 'CB', { startMs: at(10), endMs: at(11) }, ctx);
    expect(crossCity).toBeGreaterThan(sameCity);
  });

  it('never returns negative (clamped detour)', () => {
    const busy: BcbaBusy = [
      { s: at(8), e: at(9), loc: 'CA' },
      { s: at(13), e: at(14), loc: 'CB' },
    ];
    expect(addedTravelMinutes(busy, 'CX', { startMs: at(10), endMs: at(11) }, ctx)).toBeGreaterThanOrEqual(0);
  });
});

describe('compareSlots (lexicographic)', () => {
  const slot = (over: Partial<SlotCandidate>): SlotCandidate => ({
    startMs: at(9), endMs: at(10), startIso: '', endIso: '',
    fitsWhole: true, addedTravelMin: 0, daypartMatch: false, ...over,
  });

  it('① whole fit beats truncated regardless of travel', () => {
    const whole = slot({ fitsWhole: true, addedTravelMin: 40 });
    const trunc = slot({ fitsWhole: false, addedTravelMin: 0 });
    expect(compareSlots(whole, trunc)).toBeLessThan(0);
  });

  it('② among truncated, longer duration wins (hour recovery)', () => {
    const long = slot({ fitsWhole: false, startMs: at(9), endMs: at(10) });
    const short = slot({ fitsWhole: false, startMs: at(8), endMs: at(8, 30) });
    expect(compareSlots(long, short)).toBeLessThan(0);
  });

  it('③ less added travel wins at equal fit/duration', () => {
    const near = slot({ addedTravelMin: 5 });
    const far = slot({ addedTravelMin: 25 });
    expect(compareSlots(near, far)).toBeLessThan(0);
  });

  it('④ daypart match wins at equal fit/duration/travel', () => {
    const matched = slot({ daypartMatch: true, startMs: at(11), endMs: at(12) });
    const unmatched = slot({ daypartMatch: false, startMs: at(9), endMs: at(10) });
    expect(compareSlots(matched, unmatched)).toBeLessThan(0);
  });

  it('⑤ earlier start is the final tiebreak', () => {
    const early = slot({ startMs: at(9), endMs: at(10) });
    const late = slot({ startMs: at(10), endMs: at(11) });
    expect(compareSlots(early, late)).toBeLessThan(0);
  });

  it('is deterministic and antisymmetric', () => {
    const a = slot({ fitsWhole: false, addedTravelMin: 10, startMs: at(9), endMs: at(9, 45) });
    const b = slot({ fitsWhole: false, addedTravelMin: 5, startMs: at(10), endMs: at(10, 45) });
    expect(Math.sign(compareSlots(a, b))).toBe(-Math.sign(compareSlots(b, a)));
    expect(compareSlots(a, a)).toBe(0);
  });
});
