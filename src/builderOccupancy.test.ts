import { describe, it, expect } from 'vitest';
import {
  seedOccupancy, feasibleWindowsLive, reserve, dayOfWeekOf, Occupancy,
} from './builderOccupancy';
import { ScheduleData, Client, Technician, Appointment, CompanySettings } from './types';

// CHARACTERIZATION tests — behavior-lock for the live-occupancy placement
// primitives. These pin the CURRENT output (concrete intervals/windows/keys) so a
// refactor of builderOccupancy.ts cannot change it silently. Values are derived by
// reasoning through the interval math in builderOccupancy.ts + intervals.ts.
//
// Determinism: all Dates are constructed from fixed local strings; nothing reads
// Date.now(). WEEK_START '2026-07-06' is a Monday (matches scripts/verify-builder.ts).

const WEEK_START = new Date('2026-07-06T00:00:00'); // a Monday, local
const MON_DATE = '2026-07-06';

const mkClient = (id: string, name: string, windows: Client['availabilityWindows'] = {}): Client =>
  ({ id, name, availabilityWindows: windows });

const mkTech = (id: string, name: string, availMon: { start: string; end: string }[], clientId: string): Technician =>
  ({ id, name, isRBT: true, availability: { Monday: availMon }, assignments: [{ clientId, hoursPerWeek: 10, billable: true }] });

const mkData = (clients: Client[], technicians: Technician[], appointments: Appointment[] = [], blackouts: ScheduleData['blackouts'] = []): ScheduleData =>
  ({ id: 't', version: 2, clients, technicians, settings: {} as CompanySettings, appointments, blackouts, lastModified: '2026-07-01T00:00:00.000Z' });

const emptyOcc = (): Occupancy => ({ tech: new Map(), client: new Map() });

describe('dayOfWeekOf (JS getDay → Monday-first)', () => {
  it('maps interior weekdays without offset error', () => {
    expect(dayOfWeekOf(new Date(2026, 6, 6))).toBe('Monday');   // Jul 6 2026
    expect(dayOfWeekOf(new Date(2026, 6, 10))).toBe('Friday');  // +4
    expect(dayOfWeekOf(new Date(2026, 6, 11))).toBe('Saturday');
  });

  it('wraps JS Sunday (getDay()===0) to the END of the Monday-first week', () => {
    expect(dayOfWeekOf(new Date(2026, 6, 12))).toBe('Sunday');
  });
});

describe('seedOccupancy', () => {
  // Clients: c1 referenced both by id and by name; c2 referenced by id.
  const clients = [mkClient('c1', 'Client One'), mkClient('c2', 'Client Two')];

  const appt = (over: Partial<Appointment>): Appointment => ({
    id: 'x', title: 't', startTime: '', endTime: '', isFixed: false, isBillable: true, type: 'client-session', ...over,
  } as Appointment);

  const appts: Appointment[] = [
    // A: in-week, client by id, Monday 09:00–11:00
    appt({ id: 'A', technician: 'techId1', client: 'c1', startTime: '2026-07-06T09:00:00', endTime: '2026-07-06T11:00:00' }),
    // B: in-week, client by NAME, Tuesday 13:00–14:30 → resolves to id c1
    appt({ id: 'B', technician: 'techId2', client: 'Client One', startTime: '2026-07-07T13:00:00', endTime: '2026-07-07T14:30:00' }),
    // C: canceled — must be excluded (would add Monday 15:00–16:00 on techId1)
    appt({ id: 'C', status: 'canceled', technician: 'techId1', client: 'c1', startTime: '2026-07-06T15:00:00', endTime: '2026-07-06T16:00:00' }),
    // D: ghost — excluded
    appt({ id: 'D', isGhost: true, technician: 'techId1', client: 'c1', startTime: '2026-07-08T09:00:00', endTime: '2026-07-08T10:00:00' }),
    // E: before weekStart — excluded
    appt({ id: 'E', technician: 'techIdOut', client: 'c1', startTime: '2026-07-05T09:00:00', endTime: '2026-07-05T10:00:00' }),
    // F: at the exclusive end boundary (next Monday 00:00) — excluded
    appt({ id: 'F', technician: 'techIdOut', client: 'c1', startTime: '2026-07-13T09:00:00', endTime: '2026-07-13T10:00:00' }),
    // G + H: same tech/client, exactly-touching → normalize merges into one interval
    appt({ id: 'G', technician: 'techId3', client: 'c2', startTime: '2026-07-06T09:00:00', endTime: '2026-07-06T10:00:00' }),
    appt({ id: 'H', technician: 'techId3', client: 'c2', startTime: '2026-07-06T10:00:00', endTime: '2026-07-06T11:00:00' }),
  ];

  const occ = seedOccupancy(mkData(clients, [], appts), WEEK_START);

  it('indexes an active in-week appointment by tech and minute-of-day interval', () => {
    expect(occ.tech.get('techId1')?.Monday).toEqual([{ start: 540, end: 660 }]);
    expect(occ.tech.get('techId2')?.Tuesday).toEqual([{ start: 780, end: 870 }]);
  });

  it('keys client occupancy by resolved id (name ref folds into the same id)', () => {
    expect(occ.client.get('c1')).toEqual({ Monday: [{ start: 540, end: 660 }], Tuesday: [{ start: 780, end: 870 }] });
  });

  it('excludes canceled and ghost appointments (techId1 Monday stays a single interval)', () => {
    expect(occ.tech.get('techId1')?.Monday).toHaveLength(1);
  });

  it('excludes appointments outside the template week (before start and at the exclusive end)', () => {
    expect(occ.tech.get('techIdOut')).toBeUndefined();
  });

  it('normalizes exactly-touching intervals for the same owner into one', () => {
    expect(occ.tech.get('techId3')?.Monday).toEqual([{ start: 540, end: 660 }]);
    expect(occ.client.get('c2')?.Monday).toEqual([{ start: 540, end: 660 }]);
  });
});

describe('feasibleWindowsLive', () => {
  const client = mkClient('c1', 'Client One', { Monday: [{ start: '09:00', end: '17:00' }] });
  const bea = mkTech('t1', 'Bea', [{ start: '09:00', end: '17:00' }], 'c1');

  it('returns the full open window against empty occupancy', () => {
    const data = mkData([client], [bea]);
    const wins = feasibleWindowsLive(data, client, 'Monday', MON_DATE, emptyOcc());
    expect(wins).toEqual([
      { start: '09:00', end: '17:00', day: 'Monday', date: MON_DATE, techs: [{ id: 't1', name: 'Bea' }] },
    ]);
  });

  it('splits the window around a reserved slot (live occupancy shrinks openings)', () => {
    const data = mkData([client], [bea]);
    const occ = emptyOcc();
    reserve(occ, 'Bea', 'c1', 'Monday', { start: 660, end: 780 }); // 11:00–13:00
    const wins = feasibleWindowsLive(data, client, 'Monday', MON_DATE, occ);
    expect(wins.map(w => `${w.start}-${w.end}`)).toEqual(['09:00-11:00', '13:00-17:00']);
    expect(wins.every(w => w.techs.length === 1 && w.techs[0].name === 'Bea')).toBe(true);
  });

  it('a same-day client blackout suppresses all windows', () => {
    const data = mkData([client], [bea], [], [
      { id: 'b1', entityType: 'client', entityId: 'c1', date: MON_DATE },
    ]);
    expect(feasibleWindowsLive(data, client, 'Monday', MON_DATE, emptyOcc())).toEqual([]);
  });

  it('drops a residual opening shorter than MIN_SLOT_MINS (60)', () => {
    const tiny = mkClient('c9', 'Tiny', { Monday: [{ start: '09:00', end: '09:50' }] }); // 50 min
    const t = mkTech('t9', 'Nan', [{ start: '09:00', end: '17:00' }], 'c9');
    expect(feasibleWindowsLive(mkData([tiny], [t]), tiny, 'Monday', MON_DATE, emptyOcc())).toEqual([]);
  });

  it('lists every free BT under a single shared-window key, in technician order', () => {
    const t1 = mkTech('t1', 'Bea', [{ start: '09:00', end: '17:00' }], 'c1');
    const t2 = mkTech('t2', 'Cal', [{ start: '09:00', end: '17:00' }], 'c1');
    const wins = feasibleWindowsLive(mkData([client], [t1, t2]), client, 'Monday', MON_DATE, emptyOcc());
    expect(wins).toHaveLength(1);
    expect(wins[0].techs).toEqual([{ id: 't1', name: 'Bea' }, { id: 't2', name: 'Cal' }]);
  });
});

describe('reserve', () => {
  it('grows both tech and client busy sets and normalizes adjacent reservations', () => {
    const occ = emptyOcc();
    reserve(occ, 'Bea', 'c1', 'Monday', { start: 540, end: 600 });
    reserve(occ, 'Bea', 'c1', 'Monday', { start: 600, end: 660 }); // touching → merges
    expect(occ.tech.get('Bea')?.Monday).toEqual([{ start: 540, end: 660 }]);
    expect(occ.client.get('c1')?.Monday).toEqual([{ start: 540, end: 660 }]);
  });
});
