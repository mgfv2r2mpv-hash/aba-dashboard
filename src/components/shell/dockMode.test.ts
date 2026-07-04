import { describe, it, expect } from 'vitest';
import { resolveDockMode } from './dockMode';

describe('resolveDockMode', () => {
  it('phones (compactRail, ≤639px) get the slide-up sheet', () => {
    expect(resolveDockMode({ compactRail: true, showDock: false })).toBe('sheet');
  });

  it('desktop (showDock, ≥1024px) keeps the permanent side-by-side column', () => {
    expect(resolveDockMode({ compactRail: false, showDock: true })).toBe('column');
  });

  it('tablet-portrait (640–1023px, neither breakpoint) uses the collapsible chip', () => {
    // This is the regression: before the fix, the schedule view forced a
    // space-stealing 340px column here, clipping the calendar lens buttons.
    expect(resolveDockMode({ compactRail: false, showDock: false })).toBe('chip');
  });

  it('prefers the phone sheet if both flags are somehow set', () => {
    expect(resolveDockMode({ compactRail: true, showDock: true })).toBe('sheet');
  });
});
