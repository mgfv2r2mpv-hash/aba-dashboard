import { describe, it, expect } from 'vitest';
import type { Appointment, Client, Technician, ScheduleData, CompanySettings } from './types';
import {
  computeOneCaseCancels, computeCaseCancels, initials, cancelSeverityColor,
} from './caseCancels';

// ── Calendar reference ─────────────────────────────────────────────────────
//   2026-06-01 is Monday. "Now" = Wed 2026-06-17 09:00.
//   wtd  → Sun 06-14 .. 06-17   (getDay()=3 → 4 days back)
//   mtd  → 06-01 .. 06-17       (getDate()=17)
//   r30  → 05-19 .. 06-17
//   r60  → 04-18 .. 06-17
const NOW = new Date('2026-06-17T09:00:00');

function makeData(over: Partial<ScheduleData>): ScheduleData {
  return {
    id: 'sched', version: 2, clients: [], technicians: [], appointments: [],
    settings: {} as unknown as CompanySettings,
    lastModified: NOW.toISOString(), ...over,
  } as ScheduleData;
}

const client = (over: Partial<Client> = {}): Client => ({
  id: 'c1', name: 'Client 1', availabilityWindows: {}, ...over,
});

const tech = (id: string, name: string, over: Partial<Technician> = {}): Technician => ({
  id, name, isRBT: true,
  assignments: [{ clientId: 'c1', hoursPerWeek: 10, billable: true }],
  availability: {}, ...over,
});

// Canceled appointment on a given YYYY-MM-DD with a source + type.
const cx = (
  date: string, source: string, type: Appointment['type'], over: Partial<Appointment> = {},
): Appointment => ({
  id: `${date}-${source}-${type}`, title: '', client: 'c1',
  startTime: `${date}T10:00:00`, endTime: `${date}T11:00:00`,
  isFixed: false, isBillable: true, type, status: 'canceled',
  cancellation: { source } as Appointment['cancellation'], ...over,
});

describe('initials', () => {
  it('uses first + last initial', () => {
    expect(initials('Alpha Bravo')).toBe('AB');
    expect(initials('Cara')).toBe('CA');
    expect(initials('')).toBe('?');
  });
});

describe('cancelSeverityColor', () => {
  it('escalates grey → yellow → orange → red', () => {
    expect(cancelSeverityColor(0)).toBe('#9ca3af');
    expect(cancelSeverityColor(2)).toBe('#a16207');
    expect(cancelSeverityColor(4)).toBe('var(--status-over)');
    expect(cancelSeverityColor(7)).toBe('var(--status-behind)');
  });
});

describe('computeOneCaseCancels — family windows', () => {
  const data = makeData({
    clients: [client()],
    appointments: [
      cx('2026-06-16', 'family', 'client-session'),   // wtd, mtd, r30, r60
      cx('2026-06-10', 'family', 'parent-training'),  // mtd, r30, r60 (before Sun 06-14)
      cx('2026-05-01', 'family', 'client-session'),   // r60 only
    ],
  });
  const sum = computeOneCaseCancels(data, client(), NOW);

  it('counts each trailing window correctly', () => {
    expect(sum.family.totals.r60).toBe(3);
    expect(sum.family.totals.r30).toBe(2);
    expect(sum.family.totals.mtd).toBe(2);
    expect(sum.family.totals.wtd).toBe(1);
  });

  it('breaks the r60 window down by appointment type', () => {
    expect(sum.family.byType.r60['client-session']).toBe(2);
    expect(sum.family.byType.r60['parent-training']).toBe(1);
    // wtd only has the 06-16 client-session
    expect(sum.family.byType.wtd['client-session']).toBe(1);
    expect(sum.family.byType.wtd['parent-training']).toBeUndefined();
  });
});

describe('computeOneCaseCancels — BT + admin/bcba attribution', () => {
  const a1 = tech('t1', 'Alpha Bravo');
  const a2 = tech('t2', 'Cara Dane'); // assigned, but no cancels
  const data = makeData({
    clients: [client()],
    technicians: [a1, a2],
    appointments: [
      cx('2026-06-15', 'bt', 'client-session', { technician: 't1' }), // wtd
      cx('2026-06-16', 'bt', 'client-session', { technician: 't1' }), // wtd
      cx('2026-06-17', 'admin', 'supervision'),                       // wtd
      cx('2026-06-12', 'bcba', 'case-planning'),                      // mtd, not wtd
    ],
  });
  const sum = computeOneCaseCancels(data, client(), NOW);

  it('attributes BT cancels to the named tech by initials', () => {
    const ab = sum.bts.find(b => b.key === 't1')!;
    expect(ab.label).toBe('AB');
    expect(ab.totals.wtd).toBe(2);
    expect(ab.totals.r30).toBe(2);
  });

  it('lists assigned BTs with no cancels at zero', () => {
    const cd = sum.bts.find(b => b.key === 't2')!;
    expect(cd.label).toBe('CD');
    expect(cd.totals.r60).toBe(0);
  });

  it('rolls admin + bcba into one column', () => {
    expect(sum.adminBcba.totals.r60).toBe(2); // admin 06-17 + bcba 06-12
    expect(sum.adminBcba.totals.wtd).toBe(1); // only 06-17 is in the week
  });

  it('keeps BT cancels out of the family/admin buckets', () => {
    expect(sum.family.totals.r60).toBe(0);
  });
});

describe('computeCaseCancels', () => {
  it('keys summaries by client id', () => {
    const data = makeData({ clients: [client(), client({ id: 'c2', name: 'Client 2' })] });
    const map = computeCaseCancels(data, NOW);
    expect(map.has('c1')).toBe(true);
    expect(map.has('c2')).toBe(true);
  });
});
