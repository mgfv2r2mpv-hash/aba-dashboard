import { describe, it, expect } from 'vitest';
import type { Appointment, Client, Technician, ScheduleData, CompanySettings, DayOfWeek, TimeWindow } from './types';
import {
  durationMinutesOf,
  endOfWeekYmd,
  assignedTechsForClient,
  techSupervisionForCase,
  leastSupervisedTechs,
  findMoveOptions,
  applyOption,
  applyManual,
} from './findTime';

// ── Calendar reference ─────────────────────────────────────────────────────
//   2026-06-01 Mon · 06-02 Tue · 06-03 Wed · 06-04 Thu · 06-05 Fri · 06-06 Sat
// "Now" sits on Wednesday morning; the current week ends Saturday 06-06.
const NOW = new Date('2026-06-03T09:00:00');

const allDay: Record<string, TimeWindow[]> = {
  Wednesday: [{ start: '09:00', end: '17:00' }],
  Thursday: [{ start: '09:00', end: '17:00' }],
  Friday: [{ start: '09:00', end: '17:00' }],
};
const avail = (): { [k in DayOfWeek]?: TimeWindow[] } => ({ ...allDay });

function makeData(over: Partial<ScheduleData>): ScheduleData {
  return {
    id: 'sched',
    version: 2,
    clients: [],
    technicians: [],
    appointments: [],
    settings: { clinicianAvailability: avail() } as unknown as CompanySettings,
    lastModified: NOW.toISOString(),
    ...over,
  } as ScheduleData;
}

const client = (over: Partial<Client> = {}): Client => ({
  id: 'c1', name: 'Client 1', availabilityWindows: avail(), ...over,
});

const tech = (id: string, over: Partial<Technician> = {}): Technician => ({
  id, name: id.toUpperCase(), isRBT: true,
  assignments: [{ clientId: 'c1', hoursPerWeek: 10, billable: true }],
  availability: avail(), ...over,
});

const appt = (over: Partial<Appointment>): Appointment => ({
  id: 'x', title: '', startTime: '2026-06-03T10:00:00', endTime: '2026-06-03T11:00:00',
  isFixed: false, isBillable: true, type: 'case-planning', status: 'scheduled', ...over,
});

describe('durationMinutesOf', () => {
  it('derives minutes from start/end', () => {
    expect(durationMinutesOf(appt({ startTime: '2026-06-03T13:00:00', endTime: '2026-06-03T15:00:00' }))).toBe(120);
  });
});

describe('endOfWeekYmd', () => {
  it('returns the Saturday ending the current week', () => {
    expect(endOfWeekYmd(NOW)).toBe('2026-06-06');
  });
});

describe('case-planning move', () => {
  it('proposes BCBA-availability slots and avoids the BCBA\'s other sessions', () => {
    const moved = appt({ id: 'cp1', type: 'case-planning', startTime: '2026-06-01T10:00:00', endTime: '2026-06-01T11:00:00' });
    // The BCBA already has another case-planning session Wed 10:00–11:00.
    const busy = appt({ id: 'cp2', type: 'case-planning', client: 'c9', technician: 't9', startTime: '2026-06-03T10:00:00', endTime: '2026-06-03T11:00:00' });
    const data = makeData({ clients: [client()], appointments: [moved, busy] });

    const opts = findMoveOptions(data, moved, NOW);
    expect(opts.length).toBeGreaterThan(0);
    // Earliest free BCBA hour Wednesday is 09:00–10:00 (10:00 is taken).
    expect(opts[0]).toMatchObject({ date: '2026-06-03', start: '09:00', end: '10:00' });
    // Nothing should land on the occupied 10:00 Wednesday hour.
    expect(opts.some(o => o.date === '2026-06-03' && o.start === '10:00')).toBe(false);
  });

  it('stays within the current week (no slots past Saturday)', () => {
    const moved = appt({ id: 'cp1', type: 'case-planning' });
    const data = makeData({ clients: [client()], appointments: [moved] });
    const opts = findMoveOptions(data, moved, NOW);
    expect(opts.every(o => o.date <= '2026-06-06')).toBe(true);
  });
});

describe('supervision move — least-supervised tech, anchored to that tech\'s direct', () => {
  function superData() {
    const c = client();
    const t1 = tech('t1');
    const t2 = tech('t2');
    // t1 already received 1h supervision this month (overlapping t1's own direct Mon).
    const t1direct = appt({ id: 'd1', type: 'client-session', client: 'c1', technician: 't1', startTime: '2026-06-01T13:00:00', endTime: '2026-06-01T15:00:00', status: 'completed' });
    const t1sup = appt({ id: 's1', type: 'supervision', client: 'c1', startTime: '2026-06-01T13:00:00', endTime: '2026-06-01T14:00:00', status: 'completed' });
    // Future directs to anchor a supervision onto.
    const t2directThu = appt({ id: 'd2', type: 'client-session', client: 'c1', technician: 't2', startTime: '2026-06-04T13:00:00', endTime: '2026-06-04T15:00:00' });
    const t1directFri = appt({ id: 'd3', type: 'client-session', client: 'c1', technician: 't1', startTime: '2026-06-05T13:00:00', endTime: '2026-06-05T15:00:00' });
    const moved = appt({ id: 'sup0', type: 'supervision', client: 'c1', startTime: '2026-06-01T16:00:00', endTime: '2026-06-01T17:00:00' });
    return makeData({ clients: [c], technicians: [t1, t2], appointments: [t1direct, t1sup, t2directThu, t1directFri, moved] });
  }

  it('ranks techs by ascending supervision for the case', () => {
    const data = superData();
    expect(techSupervisionForCase(data, 'c1', 't1', NOW)).toBeCloseTo(1);
    expect(techSupervisionForCase(data, 'c1', 't2', NOW)).toBeCloseTo(0);
    expect(leastSupervisedTechs(data, 'c1', NOW).map(t => t.id)).toEqual(['t2', 't1']);
  });

  it('proposes the least-supervised tech\'s slot first, overlapping their direct', () => {
    const data = superData();
    const moved = data.appointments.find(a => a.id === 'sup0')!;
    const opts = findMoveOptions(data, moved, NOW);
    expect(opts.length).toBeGreaterThan(0);
    expect(opts[0]).toMatchObject({ date: '2026-06-04', start: '13:00', end: '14:00', techId: 't2' });
    expect(opts[0].improvesCompliance).toBe(true);
  });
});

describe('parent-training move', () => {
  it('anchors to a client direct when the parent is not available outside sessions', () => {
    const c = client({ parentAvailableOutsideSessions: false });
    const direct = appt({ id: 'd1', type: 'client-session', client: 'c1', technician: 't1', startTime: '2026-06-04T13:00:00', endTime: '2026-06-04T15:00:00' });
    const moved = appt({ id: 'pt0', type: 'parent-training', client: 'c1', startTime: '2026-06-01T10:00:00', endTime: '2026-06-01T11:00:00' });
    const data = makeData({ clients: [c], technicians: [tech('t1')], appointments: [direct, moved] });
    const opts = findMoveOptions(data, moved, NOW);
    expect(opts.length).toBeGreaterThan(0);
    expect(opts.every(o => o.date === '2026-06-04' && o.start === '13:00')).toBe(true);
  });

  it('allows free slots when the parent is available outside sessions', () => {
    const c = client({ parentAvailableOutsideSessions: true });
    const moved = appt({ id: 'pt0', type: 'parent-training', client: 'c1', startTime: '2026-06-01T10:00:00', endTime: '2026-06-01T11:00:00' });
    const data = makeData({ clients: [c], technicians: [tech('t1')], appointments: [moved] });
    const opts = findMoveOptions(data, moved, NOW);
    expect(opts.length).toBeGreaterThan(0); // no direct to anchor to, yet slots exist
  });
});

describe('assignedTechsForClient', () => {
  it('returns techs whose assignments include the client', () => {
    const t1 = tech('t1');
    const t2 = tech('t2', { assignments: [{ clientId: 'cX', hoursPerWeek: 5, billable: true }] });
    const data = makeData({ clients: [client()], technicians: [t1, t2] });
    expect(assignedTechsForClient(data, 'c1').map(t => t.id)).toEqual(['t1']);
  });
});

describe('applyOption / applyManual', () => {
  const base = appt({ id: 'm1', type: 'supervision', client: 'c1', startTime: '2026-06-01T10:00:00', endTime: '2026-06-01T11:00:00' });

  it('applyOption rewrites the time and sets the chosen tech for supervision', () => {
    const out = applyOption(base, { date: '2026-06-04', day: 'Thursday', start: '13:00', end: '14:00', techId: 't2', techName: 'T2' });
    expect(out.startTime).toBe('2026-06-04T13:00:00');
    expect(out.endTime).toBe('2026-06-04T14:00:00');
    expect(out.technician).toBe('t2');
    expect(out.id).toBe('m1'); // same appointment, moved
  });

  it('applyManual rewrites the time and leaves the tech untouched', () => {
    const out = applyManual(base, '2026-06-05', '09:30', '10:30');
    expect(out.startTime).toBe('2026-06-05T09:30:00');
    expect(out.endTime).toBe('2026-06-05T10:30:00');
    expect(out.technician).toBe(base.technician);
  });
});
