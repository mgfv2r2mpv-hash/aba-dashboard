import { describe, it, expect } from 'vitest';
import type { ScheduleData, CompanySettings, Client, Technician } from './types';
import { DEFAULT_FIXIT_OPTIONS } from './types';
import { ClaudeScheduler } from './claudeScheduler';

// buildFixItPrompt is pure (no network); we can build a scheduler with a dummy
// key and assert the per-case focus + guidance shape it into the prompt.
const client = (id: string, name: string): Client => ({ id, name, availabilityWindows: {} });
const tech = (id: string, name: string): Technician => ({
  id, name, isRBT: true,
  assignments: [{ clientId: 'c1', hoursPerWeek: 10, billable: true }], availability: {},
});

function makeData(): ScheduleData {
  return {
    id: 's', version: 2,
    clients: [client('c1', 'Alpha'), client('c2', 'Beta')],
    technicians: [tech('t1', 'Tina Test')],
    appointments: [],
    settings: { supervisionDirectHoursPercent: 5, supervisionRBTHoursPercent: 5 } as unknown as CompanySettings,
    lastModified: new Date('2026-06-17T09:00:00').toISOString(),
  } as ScheduleData;
}

describe('buildFixItPrompt — per-case focus + guidance', () => {
  it('adds a FOCUS line with the focus client token', () => {
    const sched = new ClaudeScheduler('test-key', makeData());
    const prompt = sched.buildFixItPrompt(
      { ...DEFAULT_FIXIT_OPTIONS, excludedClientIds: [], focusClientId: 'c1' }, [],
    );
    expect(prompt).toMatch(/FOCUS: Address ONLY case CLIENT_\d/);
  });

  it('appends scrubbed BCBA guidance', () => {
    const sched = new ClaudeScheduler('test-key', makeData());
    const prompt = sched.buildFixItPrompt(
      { ...DEFAULT_FIXIT_OPTIONS, excludedClientIds: [], focusClientId: 'c1', guidance: 'prioritize parent training' }, [],
    );
    expect(prompt).toContain('BCBA GUIDANCE');
    expect(prompt).toContain('prioritize parent training');
  });

  it('omits the FOCUS line when no case is focused', () => {
    const sched = new ClaudeScheduler('test-key', makeData());
    const prompt = sched.buildFixItPrompt({ ...DEFAULT_FIXIT_OPTIONS, excludedClientIds: [] }, []);
    expect(prompt).not.toContain('FOCUS:');
  });
});
