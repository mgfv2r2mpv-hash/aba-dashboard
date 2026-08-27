// The builder itself is shared and tested by its own unit suites; what this pins
// is the portal's use of it - which passes each choice runs, which week it anchors
// on, the four guards a proposal must clear, and the two properties that must hold
// of anything the portal is willing to put on a calendar: no session in the past,
// and no identity anywhere in it.
import { describe, it, expect } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { runBuild, configFor, nextTemplateWeek } from './runBuild';
import { findIdentityLeaks } from '@shared/identifierPolicy';
import type { ScheduleData, Client, Technician, Authorization } from '@shared/types';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] as const;
const allWeek = (start: string, end: string) =>
  Object.fromEntries(WEEKDAYS.map(d => [d, [{ start, end }]]));

// One case, one tech assigned to it, both free every weekday afternoon, and an
// authorization that actually permits the hours. Anonymised identifiers throughout,
// which is what setup mints - the legacy sampleSchedule.json still links by name.
function roster(now: Date): ScheduleData {
  const client: Client = {
    id: uuidv4(),
    name: 'SB-04',
    availabilityWindows: allWeek('13:00', '18:00'),
  };
  const tech: Technician = {
    id: uuidv4(),
    name: 'TT',
    isRBT: true,
    assignments: [{ clientId: client.id, hoursPerWeek: 10, billable: true }],
    availability: allWeek('12:00', '19:00'),
  };
  // The build runs the recurring template out to the END OF THE AUTHORIZATION,
  // not to the end of the month, so the auth span sets how much schedule appears.
  const auth: Authorization = {
    id: uuidv4(),
    clientId: client.id,
    startDate: '2026-07-01',
    endDate: '2026-12-31',
    buckets: { direct: 500, supervision: 60, parentTraining: 40 },
    weekly: { direct: 10, supervision: 2, parentTraining: 1 },
  };
  return {
    id: uuidv4(),
    version: 1,
    clients: [client],
    technicians: [tech],
    authorizations: [auth],
    appointments: [],
    settings: {
      supervisionDirectHoursPercent: 5,
      supervisionRBTHoursPercent: 5,
      parentTraining: { minimumHours: 1.5, targetMinHours: 2, targetMaxHours: 4, periodUnit: 'month' },
      clinicianAvailability: allWeek('08:00', '19:00'),
    },
    lastModified: now.toISOString(),
  };
}

describe('nextTemplateWeek', () => {
  it('takes the following Monday when today IS a Monday', () => {
    expect(nextTemplateWeek(new Date('2026-09-07T10:00:00'))).toBe('2026-09-14');
  });

  it('takes the coming Monday from mid-week', () => {
    expect(nextTemplateWeek(new Date('2026-09-09T10:00:00'))).toBe('2026-09-14');
  });

  it('takes tomorrow from a Sunday', () => {
    expect(nextTemplateWeek(new Date('2026-09-13T23:00:00'))).toBe('2026-09-14');
  });
});

describe('configFor', () => {
  const now = new Date('2026-09-09T10:00:00');

  it.each([
    ['all',              { chaseDirect: true,  chaseSupervision: true,  chasePT: true }],
    ['direct',           { chaseDirect: true,  chaseSupervision: false, chasePT: false }],
    ['supervision',      { chaseDirect: false, chaseSupervision: true,  chasePT: false }],
    ['parent-training',  { chaseDirect: false, chaseSupervision: false, chasePT: true }],
  ] as const)('runs the passes %s names, and no others', (passes, flags) => {
    const config = configFor(roster(now), { passes, weekStart: '2026-09-14' }, now);
    expect(config).toMatchObject(flags);
  });

  it('anchors on the week that was chosen, not the default', () => {
    const config = configFor(roster(now), { passes: 'all', weekStart: '2026-10-05' }, now);
    expect(config.weekStart).toBe('2026-10-05');
  });
});

describe('runBuild', () => {
  const now = new Date('2026-09-09T10:00:00');

  it('places sessions for a case that has availability, a tech and an auth', () => {
    const data = roster(now);
    const preview = runBuild(data, { passes: 'direct', weekStart: '2026-09-14' }, now);
    expect(preview.added).toBeGreaterThan(0);
    expect(preview.next.appointments.length).toBe(preview.added);
    expect(preview.result.metrics.directHrsPlaced).toBeGreaterThan(0);
  });

  it('leaves the schedule it was given untouched', () => {
    const data = roster(now);
    const before = JSON.stringify(data);
    runBuild(data, { passes: 'all', weekStart: '2026-09-14' }, now);
    expect(JSON.stringify(data)).toBe(before);
  });

  // The property a person actually relies on. The engine upholds it itself -
  // measured: buildSchedule emits no past op even when handed a past weekStart,
  // and it drops a same-day slot whose clock time has passed - and the portal's
  // dropPastOps is defence in depth behind that. The test pins the guarantee, not
  // whichever layer currently delivers it.
  it('never places a session in the past', () => {
    const afternoon = new Date('2026-09-14T15:00:00'); // the build week has begun
    const data = roster(afternoon);
    const preview = runBuild(data, { passes: 'direct', weekStart: '2026-09-14' }, afternoon);
    expect(preview.added).toBeGreaterThan(0);
    expect(preview.next.appointments.filter(a => new Date(a.startTime) < afternoon)).toEqual([]);
  });

  it('drops only the slots of the chosen week that have already passed', () => {
    const morning   = runBuild(roster(new Date('2026-09-14T08:00:00')), { passes: 'direct', weekStart: '2026-09-14' }, new Date('2026-09-14T08:00:00'));
    const afternoon = runBuild(roster(new Date('2026-09-14T15:00:00')), { passes: 'direct', weekStart: '2026-09-14' }, new Date('2026-09-14T15:00:00'));
    expect(afternoon.added).toBe(morning.added - 1);
  });

  // A week that has gone by is not an error - the recurring pattern it describes
  // is simply materialized forward. What must never happen is a session landing
  // behind today, and the earliest one lands today at the soonest.
  it('carries a past week forward instead of building into it', () => {
    const data = roster(now);
    const past = runBuild(data, { passes: 'direct', weekStart: '2026-08-24' }, now);
    const starts = past.next.appointments.map(a => a.startTime).sort();
    expect(starts.length).toBeGreaterThan(0);
    expect(new Date(starts[0]).getTime()).toBeGreaterThanOrEqual(now.getTime());
    expect(starts[0].slice(0, 10)).toBe('2026-09-09'); // today, not 24 August
  });

  it('shifts the whole schedule when a later week is chosen', () => {
    const data = roster(now);
    const soon  = runBuild(data, { passes: 'direct', weekStart: '2026-09-14' }, now);
    const later = runBuild(data, { passes: 'direct', weekStart: '2026-10-05' }, now);
    const first = (p: typeof soon) => p.next.appointments.map(a => a.startTime).sort()[0];
    expect(first(later) > first(soon)).toBe(true);
    expect(later.added).toBeLessThan(soon.added);
  });

  it('runs the recurring template to the end of the authorization', () => {
    const data = roster(now);
    const preview = runBuild(data, { passes: 'direct', weekStart: '2026-09-14' }, now);
    const starts = preview.next.appointments.map(a => a.startTime).sort();
    const last = starts[starts.length - 1];
    expect(last.slice(0, 7)).toBe('2026-12'); // the auth ends 2026-12-31
  });

  it('produces a schedule with no identity in it', () => {
    const data = roster(now);
    const preview = runBuild(data, { passes: 'all', weekStart: '2026-09-14' }, now);
    expect(preview.added).toBeGreaterThan(0);
    expect(findIdentityLeaks(preview.next)).toEqual([]);
  });

  it('reports honestly when there is nothing it can place', () => {
    const data = roster(now);
    const noAuth = { ...data, authorizations: [] };
    const preview = runBuild(noAuth, { passes: 'direct', weekStart: '2026-09-14' }, now);
    expect(preview.added).toBe(0);
    expect(preview.result.blocks.every(b => b.bindingConstraint === 'no-authorization')).toBe(true);
  });

  it('places nothing for a case nobody is free to see', () => {
    const data = roster(now);
    const noOverlap = {
      ...data,
      technicians: data.technicians.map(t => ({ ...t, availability: allWeek('06:00', '08:00') })),
    };
    const preview = runBuild(noOverlap, { passes: 'direct', weekStart: '2026-09-14' }, now);
    expect(preview.added).toBe(0);
    expect(preview.result.blocks.length).toBeGreaterThan(0);
  });
});
