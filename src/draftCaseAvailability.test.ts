import { describe, it, expect } from 'vitest';
import type {
  Appointment, Client, Technician, ScheduleData, CompanySettings, TimeWindow,
} from './types';
import { solveDraft } from './draftSolver';
import { newAddOp } from './draft';

// Jun 2026: Jun 1 = Monday. now = Mon 2026-06-01 09:00. Future Tue 06-09, Mon 06-08.
const NOW = new Date('2026-06-01T09:00:00');

const WEEKDAYS_9_5: Record<string, TimeWindow[]> = {
  Monday: [{ start: '09:00', end: '17:00' }],
  Tuesday: [{ start: '09:00', end: '17:00' }],
  Wednesday: [{ start: '09:00', end: '17:00' }],
  Thursday: [{ start: '09:00', end: '17:00' }],
  Friday: [{ start: '09:00', end: '17:00' }],
};
const MON_WED_FRI_9_5: Record<string, TimeWindow[]> = {
  Monday: [{ start: '09:00', end: '17:00' }],
  Wednesday: [{ start: '09:00', end: '17:00' }],
  Friday: [{ start: '09:00', end: '17:00' }],
};

const client: Client = { id: 'c1', name: 'Client One', availabilityWindows: WEEKDAYS_9_5 as any };
const hannah: Technician = {
  id: 't1', name: 'Hannah', isRBT: true,
  assignments: [{ clientId: 'c1', hoursPerWeek: 10, billable: true, availability: MON_WED_FRI_9_5 as any }],
  availability: WEEKDAYS_9_5 as any,
};

const data = (): ScheduleData => ({
  id: 's', version: 2, clients: [client], technicians: [hannah], appointments: [],
  settings: {} as unknown as CompanySettings, lastModified: NOW.toISOString(),
} as ScheduleData);

const session = (date: string): Appointment => ({
  id: `s-${date}`, title: 'Direct', client: 'c1', technician: 't1',
  startTime: `${date}T10:00:00`, endTime: `${date}T12:00:00`,
  isFixed: false, isBillable: true, type: 'client-session', status: 'scheduled',
});

describe('draft grade — per-case tech availability', () => {
  it('grades a session outside the per-case window as yellow (confirm), not green', () => {
    // Tuesday: inside general availability, outside Hannah's per-case (Mon/Wed/Fri).
    const status = solveDraft(data(), [newAddOp(session('2026-06-09'))], NOW, {} as CompanySettings);
    expect(status.grade).toBe('yellow');
    expect(status.label.toLowerCase()).toContain('outside set availability');
  });

  it('grades a session inside the per-case window as green', () => {
    const status = solveDraft(data(), [newAddOp(session('2026-06-08'))], NOW, {} as CompanySettings);
    expect(status.grade).toBe('green');
  });
});
