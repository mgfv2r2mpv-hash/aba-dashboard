import { describe, it, expect } from 'vitest';
import {
  isRateLimited, clearRate, resetRateLimits,
  RATE_MAX_ATTEMPTS, RATE_WINDOW_MS, RATE_KEYS_MAX,
} from '../../functions/lib/loginRate';

describe('isRateLimited', () => {
  it('allows exactly the budget, then refuses', () => {
    const store = new Map<string, number[]>();
    const now = 1_000_000;
    for (let attempt = 0; attempt < RATE_MAX_ATTEMPTS; attempt += 1) {
      expect(isRateLimited('sam', now, store)).toBe(false);
    }
    expect(isRateLimited('sam', now, store)).toBe(true);
  });

  it('counts each identity separately, so one address cannot lock out another', () => {
    const store = new Map<string, number[]>();
    const now = 1_000_000;
    for (let attempt = 0; attempt < RATE_MAX_ATTEMPTS; attempt += 1) isRateLimited('sam', now, store);
    expect(isRateLimited('sam', now, store)).toBe(true);
    expect(isRateLimited('kim', now, store)).toBe(false);
  });

  it('forgets attempts once the window has passed', () => {
    const store = new Map<string, number[]>();
    for (let attempt = 0; attempt < RATE_MAX_ATTEMPTS; attempt += 1) isRateLimited('sam', 1_000_000, store);
    expect(isRateLimited('sam', 1_000_000, store)).toBe(true);
    expect(isRateLimited('sam', 1_000_000 + RATE_WINDOW_MS, store)).toBe(false);
  });

  it('lets a success wipe the slate', () => {
    const store = new Map<string, number[]>();
    for (let attempt = 0; attempt < RATE_MAX_ATTEMPTS; attempt += 1) isRateLimited('sam', 1_000_000, store);
    clearRate('sam', store);
    expect(isRateLimited('sam', 1_000_000, store)).toBe(false);
  });

  it('holds its cap when sprayed faster than the window expires', () => {
    const store = new Map<string, number[]>();
    // One millisecond apart, so nothing is ever stale and eviction cannot lean on age
    // alone. This is the case that used to grow the map to 2,000.
    for (let i = 0; i < 2_000; i += 1) isRateLimited(`identity-${i}`, 1_000_000 + i, store);
    expect(store.size).toBeLessThanOrEqual(RATE_KEYS_MAX);
  });

  it('evicts the least recently seen first, keeping the freshest identities', () => {
    const store = new Map<string, number[]>();
    for (let i = 0; i < RATE_KEYS_MAX + 200; i += 1) isRateLimited(`identity-${i}`, 1_000_000 + i, store);
    expect(store.has('identity-0')).toBe(false);
    expect(store.has(`identity-${RATE_KEYS_MAX + 199}`)).toBe(true);
  });

  it('drops stale identities before it touches live ones', () => {
    const store = new Map<string, number[]>();
    isRateLimited('ancient', 0, store);
    for (let i = 0; i < RATE_KEYS_MAX; i += 1) isRateLimited(`identity-${i}`, 1_000_000 + i, store);
    expect(store.has('ancient')).toBe(false);
    expect(store.size).toBeLessThanOrEqual(RATE_KEYS_MAX);
  });

  it('empties completely on reset', () => {
    const store = new Map<string, number[]>();
    isRateLimited('sam', 1_000_000, store);
    resetRateLimits(store);
    expect(store.size).toBe(0);
  });
});
