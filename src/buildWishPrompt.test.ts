// Characterization lock for ClaudeScheduler.buildWishPrompt on the ONLY live
// wish path — `freeform`. The structured WishKinds (vacation/clearWindow/
// addRecurring/shaveDown/fillSchedule/maximizeDirectHours) are never constructed
// anywhere in the app (WishComposer is gone; both runtime callers build
// `{kind:'freeform'}`), so this test pins the freeform prompt's shape and its
// PII scrub BEFORE the dead kinds are removed — proving the removal is a no-op
// for the live path. The prompt embeds `new Date()` internally, so we assert on
// stable structure, never on the NOW/HORIZON timestamps.
import { describe, it, expect } from 'vitest';
import { ClaudeScheduler } from './claudeScheduler';
import { ScheduleData } from './types';

const data: ScheduleData = {
  id: 'w', version: 2,
  clients: [{ id: 'c1', name: 'Zebra Quill', availabilityWindows: {} }],
  technicians: [{ id: 't1', name: 'Yak Riddle', isRBT: true, assignments: [], availability: {} }],
  settings: {
    supervisionDirectHoursPercent: 15, supervisionRBTHoursPercent: 5,
    parentTraining: { minimumHours: 1, targetMinHours: 2, targetMaxHours: 4, periodUnit: 'month' },
  } as ScheduleData['settings'],
  appointments: [
    { id: 'a1', title: 'Session', client: 'Zebra Quill', technician: 'Yak Riddle', startTime: '2099-01-05T13:00:00', endTime: '2099-01-05T15:00:00', isFixed: false, isBillable: true, type: 'client-session' },
  ],
  lastModified: '2026-07-01T00:00:00.000Z',
};

describe('buildWishPrompt — freeform (the only live wish path)', () => {
  const scheduler = new ClaudeScheduler('test-key', data);

  it('emits the freeform brief inside the standard prompt scaffold', () => {
    const prompt = scheduler.buildWishPrompt({ kind: 'freeform', note: 'shuffle my Fridays' });
    expect(prompt).toContain('shuffle my Fridays');   // freeform note flows through summarizeWish
    expect(prompt).toContain('HARD RULES');
    expect(prompt).toContain('SCHEDULE IN HORIZON');
    expect(prompt).toContain('OUTPUT: Strict JSON only');
  });

  it('never emits the structured-kind context blocks for a freeform wish', () => {
    const prompt = scheduler.buildWishPrompt({ kind: 'freeform', note: 'anything' });
    expect(prompt).not.toContain('MAXIMIZE DIRECT HOURS');
    expect(prompt).not.toContain('FILL MY SCHEDULE OUT');
    expect(prompt).not.toContain('SHAVE DOWN'); // shaveDown flag never set on the live path
  });

  it('scrubs client names out of the freeform note (PII guard on the live path)', () => {
    const prompt = scheduler.buildWishPrompt({ kind: 'freeform', note: 'give Zebra Quill more supervision' });
    expect(prompt).not.toContain('Zebra Quill'); // scrubText → opaque token, never the raw name
  });
});
