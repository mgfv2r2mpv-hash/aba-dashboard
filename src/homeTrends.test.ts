import { describe, it, expect } from 'vitest';
import type {
  Appointment, Authorization, Client, Technician, ScheduleData, CompanySettings,
} from './types';
import { computeHomeTrends } from './caseModel';

// Calendar reference: 2026-06-01 is Monday; "now" = Wed 2026-06-17 09:00.
// June splits into 5 Sunday/7-day buckets from the 1st, so numWeeks = 5.
const NOW = new Date('2026-06-17T09:00:00');
const NUM_WEEKS = 5;

function makeData(over: Partial<ScheduleData>): ScheduleData {
  return {
    id: 'sched', version: 2, clients: [], technicians: [], appointments: [],
    authorizations: [],
    settings: {} as unknown as CompanySettings,
    lastModified: NOW.toISOString(), ...over,
  } as ScheduleData;
}

const client = (over: Partial<Client> = {}): Client => ({
  id: 'c1', name: 'Client One', availabilityWindows: {}, ...over,
});

const auth = (over: Partial<Authorization> = {}): Authorization => ({
  id: 'a1', clientId: 'c1', startDate: '2026-01-01', endDate: '2026-12-31',
  buckets: {}, weekly: { direct: 10 }, ...over,
});

const tech = (over: Partial<Technician> = {}): Technician => ({
  id: 't1', name: 'Tech One', isRBT: true,
  assignments: [{ clientId: 'c1', hoursPerWeek: 12, billable: true }],
  availability: {}, ...over,
});

// A direct client-session of `hours` on a given date.
const direct = (date: string, hours: number, over: Partial<Appointment> = {}): Appointment => ({
  id: `${date}-${hours}`, title: '', client: 'c1',
  startTime: `${date}T09:00:00`, endTime: `${date}T${String(9 + hours).padStart(2, '0')}:00:00`,
  isFixed: false, isBillable: true, type: 'client-session', status: 'scheduled', ...over,
});

describe('computeHomeTrends — direct card', () => {
  const data = makeData({
    clients: [client()],
    authorizations: [auth()],
    appointments: [
      direct('2026-06-02', 8),
      direct('2026-06-09', 8),
      direct('2026-06-16', 8),
    ],
  });
  const trends = computeHomeTrends(data, NOW);
  const card = trends.find(t => t.id === 'c1-direct');

  it('emits a direct card with month target = weekly auth × weeks-in-month', () => {
    expect(card).toBeDefined();
    expect(card!.month.target).toBe(10 * NUM_WEEKS);
    expect(card!.role).toBe('client');
  });

  it('builds a pace series with one point per week, strictly increasing', () => {
    const { pace } = card!.month.series;
    expect(pace).toHaveLength(NUM_WEEKS);
    for (let i = 1; i < pace.length; i++) expect(pace[i]).toBeGreaterThan(pace[i - 1]);
  });

  it('accumulates the actual series (non-decreasing booked hours)', () => {
    const { actual } = card!.month.series;
    for (let i = 1; i < actual.length; i++) expect(actual[i]).toBeGreaterThanOrEqual(actual[i - 1]);
  });
});

describe('computeHomeTrends — status thresholds', () => {
  it('flags a barely-booked case as behind', () => {
    const data = makeData({
      clients: [client()], authorizations: [auth()],
      appointments: [direct('2026-06-16', 3)],
    });
    const card = computeHomeTrends(data, NOW).find(t => t.id === 'c1-direct');
    expect(card!.month.status).toBe('behind');
  });

  it('marks a fully-booked case as met', () => {
    const data = makeData({
      clients: [client()], authorizations: [auth()],
      appointments: [
        direct('2026-06-02', 10), direct('2026-06-09', 10), direct('2026-06-16', 10),
        direct('2026-06-23', 10), direct('2026-06-30', 10),
      ],
    });
    const card = computeHomeTrends(data, NOW).find(t => t.id === 'c1-direct');
    expect(card!.month.status).toBe('met');
  });
});

describe('computeHomeTrends — omission & techs', () => {
  it('omits the direct card when the client has no authorized weekly direct', () => {
    const data = makeData({ clients: [client({ id: 'c1' })], authorizations: [] });
    const trends = computeHomeTrends(data, NOW);
    expect(trends.find(t => t.id === 'c1-direct')).toBeUndefined();
  });

  it('emits a tech card sized from weekly assignments', () => {
    const data = makeData({
      clients: [client()], authorizations: [auth()], technicians: [tech()],
      appointments: [direct('2026-06-16', 8, { technician: 't1' })],
    });
    const card = computeHomeTrends(data, NOW).find(t => t.id === 't1-direct');
    expect(card).toBeDefined();
    expect(card!.role).toBe('tech');
    expect(card!.month.target).toBe(12 * NUM_WEEKS);
    expect(card!.subtitle).toBe('Credentialed BT');
  });
});
