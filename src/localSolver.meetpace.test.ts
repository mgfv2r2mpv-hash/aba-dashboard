import { describe, it, expect } from 'vitest';
import type {
  Appointment, Authorization, Client, Technician, ScheduleData, CompanySettings, TimeWindow,
} from './types';
import { solveMeetPace } from './localSolver';

// Calendar reference: 2026-06-15 is a Monday. "now" = Mon 08:00, so the whole
// Mon–Sun week (the placement horizon) is in the future.
const NOW = new Date('2026-06-15T08:00:00');

const WEEKDAY_9_5: Record<string, TimeWindow[]> = {
  Monday: [{ start: '09:00', end: '17:00' }],
  Tuesday: [{ start: '09:00', end: '17:00' }],
  Wednesday: [{ start: '09:00', end: '17:00' }],
  Thursday: [{ start: '09:00', end: '17:00' }],
  Friday: [{ start: '09:00', end: '17:00' }],
};

function makeData(over: Partial<ScheduleData>): ScheduleData {
  return {
    id: 'sched', version: 2, clients: [], technicians: [], appointments: [],
    authorizations: [], companyHolidays: [],
    settings: { supervisionDirectHoursPercent: 15 } as unknown as CompanySettings,
    lastModified: NOW.toISOString(), ...over,
  } as ScheduleData;
}

const client = (over: Partial<Client> = {}): Client => ({
  id: 'c1', name: 'Client One', availabilityWindows: WEEKDAY_9_5, ...over,
});

const auth = (over: Partial<Authorization> = {}): Authorization => ({
  id: 'a1', clientId: 'c1', startDate: '2026-01-01', endDate: '2026-12-31',
  buckets: {}, weekly: { direct: 10 }, ...over,
});

const tech = (over: Partial<Technician> = {}): Technician => ({
  id: 't1', name: 'Tech One', isRBT: true,
  assignments: [{ clientId: 'c1', hoursPerWeek: 20, billable: true }],
  availability: WEEKDAY_9_5, ...over,
});

// A direct client-session `hours` long starting at `time` on `date`.
const direct = (date: string, time: string, hours: number, over: Partial<Appointment> = {}): Appointment => {
  const [h, m] = time.split(':').map(Number);
  const end = `${String(h + hours).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return {
    id: `d-${date}-${time}`, title: '', client: 'c1', technician: 'Tech One',
    startTime: `${date}T${time}:00`, endTime: `${date}T${end}:00`,
    isFixed: false, isBillable: true, type: 'client-session', status: 'scheduled', ...over,
  };
};

const sup = (date: string, time: string, hours: number, over: Partial<Appointment> = {}): Appointment => {
  const [h, m] = time.split(':').map(Number);
  const end = `${String(h + hours).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return {
    id: `s-${date}-${time}`, title: 'Supervision', client: 'c1', technician: 'Tech One',
    startTime: `${date}T${time}:00`, endTime: `${date}T${end}:00`,
    isFixed: false, isBillable: true, type: 'supervision', status: 'scheduled', ...over,
  };
};

const uniqueDays = (ops: { start?: string }[]) =>
  new Set(ops.map(o => o.start?.slice(0, 10)).filter(Boolean)).size;

describe('solveMeetPace — direct-hours pace', () => {
  it('closes the direct-hours gap by adding client-session ops', () => {
    // Auth 10h/wk, only 4h booked (Mon) → 6h gap. Tue/Wed wide open.
    const data = makeData({
      clients: [client()], technicians: [tech()], authorizations: [auth()],
      appointments: [direct('2026-06-15', '09:00', 4)],
    });
    const r = solveMeetPace(data, 'c1', NOW);
    expect(r.intent).toBe('behind');
    expect(r.directHrsAdded).toBeCloseTo(6, 1);
    expect(r.directGapRemaining).toBeLessThan(0.5);
    const directAdds = r.solution.ops.filter(
      o => o.op === 'add' && o.type === 'client-session',
    ) as Extract<typeof r.solution.ops[number], { op: 'add' }>[];
    expect(directAdds.length).toBeGreaterThan(0);
    expect(directAdds.every(o => o.client === 'c1' || o.client === 'Client One')).toBe(true);
  });

  it('distributes added sessions across distinct days, not stacked on one', () => {
    // 6h gap, nothing booked; Mon–Fri wide open. Sessions should spread.
    const data = makeData({
      clients: [client()], technicians: [tech()],
      authorizations: [auth({ weekly: { direct: 6 } })],
      appointments: [],
    });
    const r = solveMeetPace(data, 'c1', NOW);
    const directAdds = r.solution.ops.filter(o => o.op === 'add' && o.type === 'client-session');
    expect(r.directHrsAdded).toBeCloseTo(6, 1);
    expect(uniqueDays(directAdds as any)).toBeGreaterThanOrEqual(2);
    expect(r.daysTouched).toBeGreaterThanOrEqual(2);
  });

  it('reports a blocker when the case has no feasible windows', () => {
    // Auth gap but the client has no availability windows at all.
    const data = makeData({
      clients: [client({ availabilityWindows: {} })], technicians: [tech()],
      authorizations: [auth()], appointments: [],
    });
    const r = solveMeetPace(data, 'c1', NOW);
    expect(r.directHrsAdded).toBe(0);
    expect(r.blocked.length).toBeGreaterThan(0);
  });

  it('is a no-op when the case is already at pace', () => {
    const data = makeData({
      clients: [client()], technicians: [tech()],
      authorizations: [auth({ weekly: { direct: 4 } })],
      appointments: [direct('2026-06-16', '09:00', 4), sup('2026-06-16', '13:00', 1)],
    });
    const r = solveMeetPace(data, 'c1', NOW);
    expect(r.directHrsAdded).toBe(0);
    expect(r.intent).not.toBe('behind');
  });
});

describe('solveMeetPace — supervision pace', () => {
  it('adds supervision to reach the target supervision %', () => {
    // Direct at pace (10h booked across the week), zero supervision → 15% target
    // means ~1.5h supervision needed.
    const data = makeData({
      clients: [client()], technicians: [tech()],
      authorizations: [auth({ weekly: { direct: 10 } })],
      appointments: [
        direct('2026-06-16', '09:00', 5),
        direct('2026-06-17', '09:00', 5),
      ],
    });
    const r = solveMeetPace(data, 'c1', NOW);
    expect(r.supHrsAdded).toBeGreaterThan(1);
    const supAdds = r.solution.ops.filter(o => o.op === 'add' && o.type === 'supervision');
    expect(supAdds.length).toBeGreaterThan(0);
    // Supervision must name a BT for credit.
    expect((supAdds as any).every((o: any) => !!o.technician)).toBe(true);
  });
});

describe('solveMeetPace — over-served trim', () => {
  it('trims supervision when the case is over the insurer cap', () => {
    // Direct 10h, supervision 4h = 40% >> 25% cap → should trim.
    const data = makeData({
      clients: [client()], technicians: [tech()],
      authorizations: [auth({ weekly: { direct: 10 } })],
      settings: { supervisionDirectHoursPercent: 15, supervisionMaxHoursPercent: 25 } as unknown as CompanySettings,
      appointments: [
        direct('2026-06-16', '09:00', 5),
        direct('2026-06-17', '09:00', 5),
        sup('2026-06-16', '14:00', 2),
        sup('2026-06-17', '14:00', 2),
      ],
    });
    const r = solveMeetPace(data, 'c1', NOW);
    expect(r.intent).toBe('over');
    expect(r.hrsTrimmed).toBeGreaterThan(0);
    expect(r.solution.ops.some(o => o.op === 'remove' || o.op === 'move')).toBe(true);
  });
});
