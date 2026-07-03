import { describe, it, expect } from 'vitest';
import type {
  Appointment, Client, Technician, ScheduleData, CompanySettings, TimeWindow,
} from './types';
import { ConstraintValidator } from './constraintValidator';

// June 2026: Jun 1 = Monday. now = Wed 2026-06-17. Mondays 15/22, Tuesdays 16/23.
const NOW = new Date('2026-06-17T09:00:00');

const WEEKDAYS_9_5: Record<string, TimeWindow[]> = {
  Monday: [{ start: '09:00', end: '17:00' }],
  Tuesday: [{ start: '09:00', end: '17:00' }],
  Wednesday: [{ start: '09:00', end: '17:00' }],
  Thursday: [{ start: '09:00', end: '17:00' }],
  Friday: [{ start: '09:00', end: '17:00' }],
};
// Per-case: Hannah covers this client only Mon / Wed / Fri.
const MON_WED_FRI_9_5: Record<string, TimeWindow[]> = {
  Monday: [{ start: '09:00', end: '17:00' }],
  Wednesday: [{ start: '09:00', end: '17:00' }],
  Friday: [{ start: '09:00', end: '17:00' }],
};

function makeData(over: Partial<ScheduleData>): ScheduleData {
  return {
    id: 'sched', version: 2, clients: [], technicians: [], appointments: [],
    blackouts: [], companyHolidays: [],
    settings: {} as unknown as CompanySettings,
    lastModified: NOW.toISOString(), ...over,
  } as ScheduleData;
}

const client: Client = { id: 'c1', name: 'Client One', availabilityWindows: WEEKDAYS_9_5 as any };

const hannah = (caseAvail?: Record<string, TimeWindow[]>): Technician => ({
  id: 't1', name: 'Hannah', isRBT: true,
  assignments: [{ clientId: 'c1', hoursPerWeek: 10, billable: true, availability: caseAvail as any }],
  availability: WEEKDAYS_9_5 as any,
});

const session = (date: string, over: Partial<Appointment> = {}): Appointment => ({
  id: `appt-${date}`, title: 'Direct', client: 'c1', technician: 't1',
  startTime: `${date}T10:00:00`, endTime: `${date}T12:00:00`,
  isFixed: false, isBillable: true, type: 'client-session', status: 'scheduled', ...over,
});

const availConflicts = (data: ScheduleData) =>
  new ConstraintValidator(data, NOW).validateSchedule().filter(c => c.type === 'availability-conflict');

describe('per-case technician availability enforcement', () => {
  it('flags a slot outside the per-case window as a tentative (warning), not a block', () => {
    // Tuesday 2026-06-16 — inside Hannah's GENERAL availability, outside her
    // per-case (Mon/Wed/Fri) availability for this client.
    const data = makeData({ clients: [client], technicians: [hannah(MON_WED_FRI_9_5)], appointments: [session('2026-06-16')] });
    const conflicts = availConflicts(data);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].severity).toBe('warning');
    expect(conflicts[0].message.toLowerCase()).toContain('case availability');
  });

  it('does not flag a slot inside the per-case window', () => {
    // Monday 2026-06-15 — inside both general and per-case availability.
    const data = makeData({ clients: [client], technicians: [hannah(MON_WED_FRI_9_5)], appointments: [session('2026-06-15')] });
    expect(availConflicts(data)).toHaveLength(0);
  });

  it('does not flag when the assignment has no per-case restriction', () => {
    // No per-case availability → general availability governs; Tuesday is fine.
    const data = makeData({ clients: [client], technicians: [hannah(undefined)], appointments: [session('2026-06-16')] });
    expect(availConflicts(data)).toHaveLength(0);
  });

  it('keeps a slot outside GENERAL availability a hard error, not a tentative', () => {
    // 19:00 on a Monday — outside general 9–5; must stay a blocking error.
    const data = makeData({
      clients: [client], technicians: [hannah(MON_WED_FRI_9_5)],
      appointments: [session('2026-06-15', { startTime: '2026-06-15T19:00:00', endTime: '2026-06-15T20:00:00' })],
    });
    const conflicts = availConflicts(data);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].severity).toBe('error');
  });
});
