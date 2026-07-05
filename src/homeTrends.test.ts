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

// A supervision session (counts as supervision unconditionally) of `hours`.
const sup = (date: string, hours: number, over: Partial<Appointment> = {}): Appointment => ({
  id: `sup-${date}-${hours}`, title: '', client: 'c1',
  startTime: `${date}T13:00:00`, endTime: `${date}T${String(13 + hours).padStart(2, '0')}:00:00`,
  isFixed: false, isBillable: true, type: 'supervision', status: 'scheduled', ...over,
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

  it('builds a plan envelope with one point per week, non-decreasing (cumulative)', () => {
    const { plan } = card!.month.series;
    expect(plan).toHaveLength(NUM_WEEKS);
    for (let i = 1; i < plan.length; i++) expect(plan[i]).toBeGreaterThanOrEqual(plan[i - 1]);
  });

  it('accumulates the delivered series (non-decreasing delivered hours)', () => {
    const { delivered } = card!.month.series;
    for (let i = 1; i < delivered.length; i++) expect(delivered[i]).toBeGreaterThanOrEqual(delivered[i - 1]);
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

describe('computeHomeTrends — utilization %', () => {
  it('direct week util = projection ÷ authorized (100% when the week is full)', () => {
    const data = makeData({
      clients: [client()], authorizations: [auth({ weekly: { direct: 10 } })],
      appointments: [direct('2026-06-15', 10)], // Mon of the NOW week
    });
    const card = computeHomeTrends(data, NOW).find(t => t.id === 'c1-direct');
    expect(card!.week.util).toBe(100);
  });

  it('direct week util reflects a partially booked week (16 of 20 → 80%)', () => {
    const data = makeData({
      clients: [client()], authorizations: [auth({ weekly: { direct: 20 } })],
      appointments: [direct('2026-06-15', 8), direct('2026-06-16', 8)],
    });
    const card = computeHomeTrends(data, NOW).find(t => t.id === 'c1-direct');
    expect(card!.week.util).toBe(80);
  });
});

describe('computeHomeTrends — supervision % card', () => {
  it('reports supervised % vs target and honors the per-case override', () => {
    const data = makeData({
      clients: [client({ supervisionIdealPct: 25 })],
      settings: { supervisionDirectHoursPercent: 10 } as CompanySettings,
      appointments: [
        direct('2026-06-08', 10), direct('2026-06-15', 10), // 20h direct this month
        sup('2026-06-15', 4),                               // 4h supervision this month
      ],
    });
    const card = computeHomeTrends(data, NOW).find(t => t.id === 'c1-supervision');
    expect(card).toBeDefined();
    expect(card!.month.targetPct).toBe(25);   // per-case override beats the global 10
    expect(card!.month.util).toBe(20);        // 4h sup ÷ 20h direct
  });

  it('falls back to the company supervision target with no per-case override', () => {
    const data = makeData({
      clients: [client()],
      settings: { supervisionDirectHoursPercent: 15 } as CompanySettings,
      appointments: [direct('2026-06-15', 10), sup('2026-06-15', 2)],
    });
    const card = computeHomeTrends(data, NOW).find(t => t.id === 'c1-supervision');
    expect(card!.month.targetPct).toBe(15);
  });
});

describe('computeHomeTrends — sparkline labels & holiday adjustment', () => {
  it('labels the axis: 7 daily points for the week, one per week for the month', () => {
    const data = makeData({
      clients: [client()], authorizations: [auth()],
      appointments: [direct('2026-06-15', 8)],
    });
    const card = computeHomeTrends(data, NOW).find(t => t.id === 'c1-direct');
    expect(card!.week.series.labels).toHaveLength(7);
    expect(card!.month.series.labels).toHaveLength(NUM_WEEKS);
    expect(card!.week.series.labels[0]).toMatch(/^(Su|Mo|Tu|We|Th|Fr|Sa)$/);
  });

  it('shrinks the month direct target when a holiday falls in the period', () => {
    const base = makeData({
      clients: [client()], authorizations: [auth({ weekly: { direct: 10 } })], appointments: [],
    });
    const withHol = {
      ...base,
      settings: { holidayAffectsBillable: true, holidayBillableHoursPerDay: 8 } as CompanySettings,
      companyHolidays: [{ id: 'h', date: '2026-06-18', name: 'Holiday' }],
    };
    const plain = computeHomeTrends(base, NOW).find(t => t.id === 'c1-direct');
    const adj = computeHomeTrends(withHol, NOW).find(t => t.id === 'c1-direct');
    expect(adj!.month.target).toBeLessThan(plain!.month.target);
  });
});

describe('computeHomeTrends — planned vs delivered (redesign)', () => {
  // Coming-week: 16h scheduled AFTER "now" (Thu+Fri Jun 18/19), nothing delivered yet.
  it('week card: planned = scheduled, delivered = 0, chips = coverage + execution', () => {
    const data = makeData({
      clients: [client()], authorizations: [auth({ weekly: { direct: 20 } })],
      appointments: [direct('2026-06-18', 8), direct('2026-06-19', 8)],
    });
    const wk = computeHomeTrends(data, NOW).find(t => t.id === 'c1-direct')!.week;
    expect(wk.planned).toBe(16);     // scheduled, not the 20h auth
    expect(wk.delivered).toBe(0);    // nothing occurred before "now"
    expect(wk.pctOfAuth).toBe(80);   // 16 planned ÷ 20 auth
    expect(wk.pctOfPlan).toBe(0);    // 0 delivered ÷ 16 planned
  });

  it('empty week reads 0 planned and 0% of auth (the AA case)', () => {
    const data = makeData({
      clients: [client()], authorizations: [auth({ weekly: { direct: 10 } })],
      appointments: [],
    });
    const wk = computeHomeTrends(data, NOW).find(t => t.id === 'c1-direct')!.week;
    expect(wk.planned).toBe(0);
    expect(wk.pctOfAuth).toBe(0);
  });

  it('cancellation: plan INCLUDES canceled hours, delivered excludes → below plan', () => {
    const data = makeData({
      clients: [client()], authorizations: [auth({ weekly: { direct: 20 } })],
      appointments: [
        direct('2026-06-15', 6),                           // Mon — past & delivered
        direct('2026-06-16', 6, { status: 'canceled' }),   // Tue — past & CANCELED
        direct('2026-06-18', 6),                           // Thu — future scheduled
      ],
    });
    const wk = computeHomeTrends(data, NOW).find(t => t.id === 'c1-direct')!.week;
    expect(wk.planned).toBe(18);              // 6 + 6(canceled) + 6
    expect(wk.delivered).toBe(6);             // only Mon (Tue canceled, Thu future)
    expect(wk.varianceH!).toBeLessThan(0);    // 6 delivered vs 12 planned-to-date
    expect(wk.pctOfPlan).toBeLessThan(100);   // 6 ÷ 18
  });

  it('catch-up week crosses its own weekly auth, but the month stays under the full-period auth', () => {
    // Week of 6/8 was short (4h, cancellations elsewhere took the rest). Week of
    // 6/15 (the "now" week) makes up with 5×3h sessions Mon–Fri (15h) — the amber
    // threshold for THIS week (10h/wk) is crossed, but the month total (4+15=19h)
    // stays well under the 5-week auth budget (50h), so the month card shows no
    // overage: a legitimate catch-up week shouldn't read as blowing the auth bucket.
    const data = makeData({
      clients: [client()], authorizations: [auth({ weekly: { direct: 10 } })],
      appointments: [
        direct('2026-06-08', 4),                              // week of 6/8 — short week
        direct('2026-06-15', 3), direct('2026-06-16', 3), direct('2026-06-17', 3),
        direct('2026-06-18', 3), direct('2026-06-19', 3),     // week of 6/15 — 5×3h catch-up
      ],
    });
    const card = computeHomeTrends(data, NOW).find(t => t.id === 'c1-direct')!;
    // The catch-up week itself exceeds its own weekly auth share.
    expect(card.week.planned).toBe(15);
    expect(card.week.target).toBe(10);
    expect(card.week.planned).toBeGreaterThan(card.week.target);
    // The month's cumulative total is nowhere near its full-period auth budget —
    // this is the "self-correction" the amber threshold relies on (a single heavy
    // week only shows as overage on the month card if it pushes the RUNNING TOTAL
    // past the whole period's authorized hours, not a per-week slice).
    expect(card.month.planned).toBe(19);           // 4 + 15
    expect(card.month.target).toBe(10 * NUM_WEEKS); // 50h — the full-period budget
    expect(card.month.planned).toBeLessThan(card.month.target);
  });

  it('badge is graded on the month pace toward auth (drives the week card badge)', () => {
    const data = makeData({
      clients: [client()], authorizations: [auth({ weekly: { direct: 10 } })],
      appointments: [direct('2026-06-16', 3)], // barely booked → month behind
    });
    const card = computeHomeTrends(data, NOW).find(t => t.id === 'c1-direct')!;
    expect(card.month.status).toBe('behind');
  });
});
