import { describe, it, expect } from 'vitest';
import {
  expandDirectOccurrences,
  isBcbaFree,
  reserveBcba,
  buildDirectCalendar,
  type BcbaBusy,
  type Occ,
} from './builderBcba';
import type {
  ScheduleData, Client, Technician, Authorization, CompanySettings, Appointment, WishOp,
} from './types';
import type { BuilderConfig } from './scheduleBuilder';

// CHARACTERIZATION / behavior-lock for the recurrence MATERIALIZER (Phase 4
// shared BCBA-pass primitives). Every expectation below is derived by reasoning
// about the current implementation of src/builderBcba.ts and would fail if the
// projection window, the exclusive/inclusive overlap boundary, or the
// backbone-vs-chase-target split changed. Fully deterministic: no Date.now(),
// no Math.random(), all clocks are explicit local-ISO strings (the app format).

const HR = 3_600_000;
const ms = (iso: string) => new Date(iso).getTime();

// ── expandDirectOccurrences ─────────────────────────────────────────────────
// Project a Monday-09:00 2h template forward. weekStart is the config template
// Monday (Jul 6 2026 = a Monday, mirrors scripts/verify-builder.ts).
describe('expandDirectOccurrences', () => {
  const templateStart = new Date('2026-07-06T09:00:00'); // Monday 09:00
  const durMs = 2 * HR;
  const weekStartMs = ms('2026-07-06T00:00:00');
  const starts = (occ: Occ[]) => occ.map(o => o.startIso);
  const weeks = (occ: Occ[]) => occ.map(o => o.weekIndex);

  it('projects the weekday+clock across every week inside [lower, horizon)', () => {
    // horizon end = Aug 3 00:00 (4 template weeks). The horizon bound is
    // EXCLUSIVE, so the Aug 3 09:00 occurrence is dropped — 4 occurrences.
    const occ = expandDirectOccurrences(
      templateStart, durMs, weekStartMs,
      ms('2026-07-06T00:00:00'), ms('2026-08-03T00:00:00'),
    );
    expect(occ).toHaveLength(4);
    expect(starts(occ)).toEqual([
      '2026-07-06T09:00:00', '2026-07-13T09:00:00',
      '2026-07-20T09:00:00', '2026-07-27T09:00:00',
    ]);
    // clock + duration are re-anchored each week: end is +2h, same day.
    expect(occ[0].endIso).toBe('2026-07-06T11:00:00');
    expect(occ[3].endIso).toBe('2026-07-27T11:00:00');
    // weekIndex is measured from weekStart (Jul 6), so 0..3.
    expect(weeks(occ)).toEqual([0, 1, 2, 3]);
  });

  it('excludes occurrences before lowerMs while weekIndex stays relative to weekStart', () => {
    // Advance the lower bound into the middle of the horizon: the two earlier
    // Mondays fall out, but the survivors keep their weekStart-relative index.
    const occ = expandDirectOccurrences(
      templateStart, durMs, weekStartMs,
      ms('2026-07-20T00:00:00'), ms('2026-08-03T00:00:00'),
    );
    expect(starts(occ)).toEqual(['2026-07-20T09:00:00', '2026-07-27T09:00:00']);
    expect(weeks(occ)).toEqual([2, 3]); // NOT re-based to 0 at the new lower bound
  });

  it('fast-forwards a stale months-old anchor to the horizon without dropping weeks', () => {
    // A recurring series whose anchor sits back in January must still surface
    // exactly the in-horizon Mondays (the startWk fast-forward + 70-week guard).
    const staleAnchor = new Date('2026-01-05T09:00:00'); // also a Monday, 09:00
    const occ = expandDirectOccurrences(
      staleAnchor, durMs, weekStartMs,
      ms('2026-07-06T00:00:00'), ms('2026-08-03T00:00:00'),
    );
    expect(starts(occ)).toEqual([
      '2026-07-06T09:00:00', '2026-07-13T09:00:00',
      '2026-07-20T09:00:00', '2026-07-27T09:00:00',
    ]);
    expect(weeks(occ)).toEqual([0, 1, 2, 3]);
  });
});

// ── isBcbaFree / reserveBcba (the single-BCBA overlap primitive) ─────────────
// Overlap is STRICT: b.s < eMs && b.e > sMs. So a touching/adjacent interval
// (end == the other's start) does NOT overlap and reads as FREE. This is the
// exact boundary both BCBA passes lean on when packing back-to-back sessions.
describe('isBcbaFree / reserveBcba overlap semantics', () => {
  const RES_S = ms('2026-07-06T10:00:00');
  const RES_E = ms('2026-07-06T11:00:00');
  const busy: BcbaBusy = reserveBcba([], RES_S, RES_E, 'c-alpha');

  it('an empty plane is free everywhere', () => {
    expect(isBcbaFree([], RES_S, RES_E)).toBe(true);
  });

  it('a genuinely overlapping query is NOT free', () => {
    expect(isBcbaFree(busy, ms('2026-07-06T10:30:00'), ms('2026-07-06T11:30:00'))).toBe(false); // straddles the end
    expect(isBcbaFree(busy, ms('2026-07-06T10:15:00'), ms('2026-07-06T10:45:00'))).toBe(false); // fully inside
    expect(isBcbaFree(busy, ms('2026-07-06T09:00:00'), ms('2026-07-06T12:00:00'))).toBe(false); // encloses
    expect(isBcbaFree(busy, RES_S, RES_E)).toBe(false);                                          // identical
  });

  it('a touching interval is FREE (end == start does NOT count as overlap)', () => {
    // Adjacent AFTER: query starts exactly when the reservation ends.
    expect(isBcbaFree(busy, RES_E, ms('2026-07-06T12:00:00'))).toBe(true);
    // Adjacent BEFORE: query ends exactly when the reservation starts.
    expect(isBcbaFree(busy, ms('2026-07-06T09:00:00'), RES_S)).toBe(true);
  });

  it('reserveBcba is immutable and preserves loc + accumulates', () => {
    const before: BcbaBusy = [];
    const after = reserveBcba(before, RES_S, RES_E, 'c-alpha');
    expect(before).toHaveLength(0);            // original untouched
    expect(after).toHaveLength(1);
    expect(after[0]).toEqual({ s: RES_S, e: RES_E, loc: 'c-alpha' });
    const two = reserveBcba(after, ms('2026-07-06T13:00:00'), ms('2026-07-06T14:00:00'));
    expect(two).toHaveLength(2);
    expect(after).toHaveLength(1);             // prior array still untouched
    expect(two[1].loc).toBeUndefined();        // loc is optional
  });
});

// ── buildDirectCalendar (the materializer proper) ───────────────────────────
// Deterministic clock mandated by the task; note it lands AFTER the horizon
// start (Jul 6), so lowerMs = now and the first two template weeks are already
// in the past and never materialize.
const NOW = new Date('2026-07-15T12:00:00');

const monWindow = { Monday: [{ start: '09:00', end: '17:00' }] };
const client = (id: string, name: string): Client =>
  ({ id, name, availabilityWindows: monWindow } as unknown as Client);
const tech = (id: string, name: string, clientId: string): Technician =>
  ({ id, name, isRBT: true, availability: monWindow,
     assignments: [{ clientId, hoursPerWeek: 10, billable: true }] } as unknown as Technician);
const auth = (clientId: string, endDate: string): Authorization =>
  ({ id: `au-${clientId}`, clientId, startDate: '2026-01-01', endDate,
     buckets: { direct: 10_000 }, weekly: { direct: 4 } } as Authorization);

function makeSchedule(clients: Client[], technicians: Technician[], authorizations: Authorization[], appts: Appointment[] = []): ScheduleData {
  return {
    id: 'test', version: 2, clients, technicians, settings: {} as CompanySettings,
    appointments: appts, authorizations, blackouts: [], timeOff: [], companyHolidays: [],
    manualUsage: [], confirmedConflicts: [], lastModified: '2026-07-01T00:00:00.000Z',
  } as ScheduleData;
}

const config: BuilderConfig = {
  weekStart: '2026-07-06',
  monthHorizon: { start: '2026-07-06', end: '2026-08-03' }, // month ends Aug 3 00:00
  bcbaWeeklyBillableTarget: 25, chaseDirect: true,
} as BuilderConfig;

// A new recurring direct op (Source C): the 09:00-11:00 Monday template that the
// materializer clones forward out to the client's authorization end.
const recurringOp: WishOp = {
  op: 'add', type: 'client-session', recurring: true,
  client: 'Casey One', technician: 'Tia One',
  start: '2026-07-06T09:00:00', end: '2026-07-06T11:00:00',
} as WishOp;

describe('buildDirectCalendar materializes the direct backbone', () => {
  it('clones a recurring op to auth-end while keeping chase targets in-month', () => {
    // Auth runs to Aug 17 → the backbone extends to Aug 17, but only the
    // in-month occurrences (< Aug 3 00:00) become supervision/PT chase targets.
    const data = makeSchedule([client('c1', 'Casey One')], [tech('t1', 'Tia One', 'c1')], [auth('c1', '2026-08-17')]);
    const cal = buildDirectCalendar(data, [recurringOp], config, NOW);

    // Backbone: Jul 20, Jul 27, Aug 3, Aug 10, Aug 17 (Jul 6 & 13 are pre-`now`;
    // Aug 24 is past the auth-derived horizon). 5 dated rows, 10h total.
    expect(cal.directOps).toHaveLength(5);
    expect(cal.directOpsHrs).toBeCloseTo(10, 6);
    expect(new Set(cal.directOps.map(o => (o.op === 'add' ? o.start.slice(0, 10) : '')))).toEqual(
      new Set(['2026-07-20', '2026-07-27', '2026-08-03', '2026-08-10', '2026-08-17']),
    );
    // Materialized rows are concrete dated, non-recurring add ops.
    expect(cal.directOps.every(o => o.op === 'add' && o.type === 'client-session' && !o.recurring)).toBe(true);

    // Chase targets: only the two in-month weeks, weekStart-relative index 2 & 3.
    const targets = cal.byClient.get('c1') ?? [];
    expect(targets).toHaveLength(2);
    expect(targets.map(t => t.weekIndex)).toEqual([2, 3]); // sorted by startMs
    expect(targets.map(t => new Date(t.startMs).getHours())).toEqual([9, 9]);
    expect(targets.every(t => t.materialized && t.clientName === 'Casey One' && t.techName === 'Tia One')).toBe(true);

    // Nothing was blocked in the clean case.
    expect(cal.blocks).toHaveLength(0);
  });

  it('collision guard: an existing session on a week blocks that occurrence, not the rest', () => {
    // An active session already occupies the Jul 20 slot for the same client, so
    // that one occurrence is refused (a tech-contention block) while the other
    // four weeks still materialize.
    const clash: Appointment = {
      id: 'sup1', type: 'supervision', client: 'Casey One',
      startTime: '2026-07-20T09:00:00', endTime: '2026-07-20T11:00:00',
    } as Appointment;
    const data = makeSchedule([client('c1', 'Casey One')], [tech('t1', 'Tia One', 'c1')], [auth('c1', '2026-08-17')], [clash]);
    const cal = buildDirectCalendar(data, [recurringOp], config, NOW);

    // Jul 20 dropped → 4 materialized rows (Jul 27, Aug 3, Aug 10, Aug 17), 8h.
    expect(cal.directOps).toHaveLength(4);
    expect(cal.directOpsHrs).toBeCloseTo(8, 6);
    expect(cal.directOps.some(o => o.op === 'add' && o.start.startsWith('2026-07-20'))).toBe(false);

    // Exactly one block, naming the collided date + binding constraint.
    expect(cal.blocks).toHaveLength(1);
    expect(cal.blocks[0].occurrenceDate).toBe('2026-07-20');
    expect(cal.blocks[0].bindingConstraint).toBe('tech-contention');
    expect(cal.blocks[0].clientName).toBe('Casey One');

    // Chase targets shrink to the single surviving in-month week (Jul 27).
    const targets = cal.byClient.get('c1') ?? [];
    expect(targets).toHaveLength(1);
    expect(new Date(targets[0].startMs).getDate()).toBe(27); // Jul 27, not the blocked Jul 20 (local, TZ-safe)
    expect(targets[0].weekIndex).toBe(3);
  });
});
