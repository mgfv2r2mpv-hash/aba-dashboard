import { describe, it, expect } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { checkIdentifier, isUuid, findIdentityLeaks } from './identifierPolicy';
import { ScheduleData, Client, Technician, Appointment } from './types';

describe('checkIdentifier - coaching, never blocking', () => {
  it('says nothing about a case code', () => {
    expect(checkIdentifier('SB-04').concern).toBeNull();
  });

  it('says nothing about initials', () => {
    expect(checkIdentifier('TT').concern).toBeNull();
    expect(checkIdentifier('SB').concern).toBeNull();
  });

  it('says nothing about a first name alone', () => {
    expect(checkIdentifier('Sam').concern).toBeNull();
  });

  it('says nothing about a first name and last initial', () => {
    expect(checkIdentifier('Samuel B.').concern).toBeNull();
    expect(checkIdentifier('Samuel B').concern).toBeNull();
  });

  it('says nothing about the "Client A" convention', () => {
    expect(checkIdentifier('Client A').concern).toBeNull();
  });

  it('says nothing about an empty or whitespace entry', () => {
    expect(checkIdentifier('').concern).toBeNull();
    expect(checkIdentifier('   ').concern).toBeNull();
  });

  it('flags a full legal name and suggests the initials', () => {
    const v = checkIdentifier('Samuel Brennan');
    expect(v.concern).toBe('full-name');
    expect(v.suggestion).toBe('SB');
  });

  it('flags a three-part name', () => {
    expect(checkIdentifier('Mary Jo Sandoval').concern).toBe('full-name');
  });

  it('flags hyphenated and apostrophe surnames', () => {
    expect(checkIdentifier('Mary-Jane Watson').concern).toBe('full-name');
    expect(checkIdentifier('Sean O’Brien').concern).toBe('full-name');
  });

  it('flags an email address or a phone number', () => {
    expect(checkIdentifier('sam.brennan@example.com').concern).toBe('contact-detail');
    expect(checkIdentifier('555 867 5309').concern).toBe('contact-detail');
  });

  it('never returns anything that could gate the entry', () => {
    // The verdict type carries no "blocked" or "valid" flag by construction —
    // this test exists so adding one is a deliberate, visible change.
    const v = checkIdentifier('Samuel Brennan');
    expect(Object.keys(v).sort()).toEqual(['concern', 'message', 'suggestion']);
  });
});

describe('isUuid', () => {
  it('accepts a minted v4', () => expect(isUuid(uuidv4())).toBe(true));
  it('rejects a typed name', () => expect(isUuid('Samuel Brennan')).toBe(false));
  it('rejects an empty string, null and undefined', () => {
    expect(isUuid('')).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});

// ── The invariant ───────────────────────────────────────────────────────────

const client = (name: string): Client => ({ id: uuidv4(), name, availabilityWindows: {} });
const tech = (name: string, assignments: Technician['assignments'] = []): Technician =>
  ({ id: uuidv4(), name, isRBT: true, assignments, availability: {} });

const appt = (over: Partial<Appointment>): Appointment => ({
  id: uuidv4(),
  title: 'Session',
  type: 'client-session',
  startTime: '2026-09-01T14:00:00.000Z',
  endTime: '2026-09-01T16:00:00.000Z',
  isFixed: false,
  isBillable: true,
  ...over,
});

const schedule = (over: Partial<ScheduleData>): ScheduleData => ({
  id: uuidv4(),
  version: 1,
  clients: [],
  technicians: [],
  settings: {
    supervisionDirectHoursPercent: 5,
    supervisionRBTHoursPercent: 5,
    parentTraining: { minimumHours: 1.5, targetMinHours: 2, targetMaxHours: 4, periodUnit: 'month' },
  },
  appointments: [],
  lastModified: new Date().toISOString(),
  ...over,
});

describe('findIdentityLeaks - the boundary the clinician cannot opt out of', () => {
  it('holds for a schedule whose links are all uuids', () => {
    const c = client('SB-04');
    const t = tech('TT', [{ clientId: c.id, hoursPerWeek: 10, billable: true }]);
    const data = schedule({
      clients: [c],
      technicians: [t],
      appointments: [appt({ client: c.id, technician: t.id })],
    });
    expect(findIdentityLeaks(data)).toEqual([]);
  });

  it('STILL holds when the clinician typed a full legal name into every field', () => {
    // This is the load-bearing case. The coaching warned and was ignored; the
    // names are real; the links are still uuids, so nothing identifying can
    // reach the wire through a reference.
    const c = client('Samuel Brennan');
    const t = tech('Theresa Toledo', [{ clientId: c.id, hoursPerWeek: 10, billable: true }]);
    const data = schedule({
      clients: [c],
      technicians: [t],
      appointments: [appt({ client: c.id, technician: t.id })],
    });
    expect(checkIdentifier(c.name).concern).toBe('full-name');
    expect(checkIdentifier(t.name).concern).toBe('full-name');
    expect(findIdentityLeaks(data)).toEqual([]);
  });

  it('catches an appointment linked by client NAME instead of id', () => {
    const c = client('Samuel Brennan');
    const data = schedule({ clients: [c], appointments: [appt({ client: 'Samuel Brennan' })] });
    const leaks = findIdentityLeaks(data);
    expect(leaks).toHaveLength(1);
    expect(leaks[0]).toContain('non-uuid client');
  });

  it('catches an assignment linked by client name instead of id', () => {
    const c = client('SB-04');
    const data = schedule({
      clients: [c],
      technicians: [tech('TT', [{ clientId: 'SB-04', hoursPerWeek: 10, billable: true }])],
    });
    expect(findIdentityLeaks(data)[0]).toContain('non-uuid client');
  });

  it('catches an appointment linked by technician name', () => {
    const t = tech('TT');
    const data = schedule({ technicians: [t], appointments: [appt({ technician: 'TT' })] });
    expect(findIdentityLeaks(data)[0]).toContain('non-uuid technician');
  });

  it('catches a well-formed uuid that is not in the roster', () => {
    const orphan = uuidv4();
    const data = schedule({ clients: [client('SB-04')], appointments: [appt({ client: orphan })] });
    expect(findIdentityLeaks(data)[0]).toContain('unknown client id');
  });

  it('catches a roster id that is not a uuid at all', () => {
    const data = schedule({ clients: [{ id: 'client-1', name: 'SB-04', availabilityWindows: {} }] });
    expect(findIdentityLeaks(data)[0]).toContain('client id is not a uuid');
  });

  it('does not treat an unfilled assignment row as a leak', () => {
    const data = schedule({
      technicians: [tech('TT', [{ clientId: '', hoursPerWeek: 0, billable: true }])],
    });
    expect(findIdentityLeaks(data)).toEqual([]);
  });
});
