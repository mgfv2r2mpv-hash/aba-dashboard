// The PHI boundary, stated as tests.
//
// Two failures used to be reachable here and are what these pin. A blackout's
// `reason` is a free-text box ("e.g. dentist appointment") that rode to Claude
// verbatim. And every id/name lookup fell back to the RAW value on a miss, so an
// entity the map did not know leaked the very thing the map exists to hide.
import { describe, it, expect } from 'vitest';
import { ClaudeScheduler } from './claudeScheduler';
import { anonymizeSchedule, buildAnonymizationMap, entityToken } from './anonymizer';
import { ScheduleData } from './types';

const data: ScheduleData = {
  id: 'sched-1', version: 2,
  clients: [{ id: 'c1', name: 'Zebra Quill', availabilityWindows: {} }],
  technicians: [{ id: 't1', name: 'Yak Riddle', isRBT: true, assignments: [{ clientId: 'c1', hoursPerWeek: 10, billable: true }], availability: {} }],
  settings: {
    practiceName: 'Quillwork Behavioral',
    supervisionDirectHoursPercent: 15, supervisionRBTHoursPercent: 5,
    parentTraining: { minimumHours: 1, targetMinHours: 2, targetMaxHours: 4, periodUnit: 'month' },
  } as ScheduleData['settings'],
  appointments: [
    { id: 'a1', title: 'Session', client: 'c1', technician: 't1', startTime: '2099-01-05T13:00:00', endTime: '2099-01-05T15:00:00', isFixed: false, isBillable: true, type: 'client-session' },
  ],
  blackouts: [
    { id: 'b1', entityType: 'client', entityId: 'c1', entityName: 'Zebra Quill', date: '2099-01-07', reason: 'neurology appointment at the childrens hospital' },
  ],
  lastModified: '2026-07-01T00:00:00.000Z',
};

describe('entityToken — the lookup fails closed', () => {
  const map = buildAnonymizationMap(data);

  it('tokenizes an entity the map knows, by id or by name', () => {
    expect(entityToken(map.clients, 'c1', null, 'CLIENT')).toBe('CLIENT_1');
    expect(entityToken(map.clients, null, 'Zebra Quill', 'CLIENT')).toBe('CLIENT_1');
  });

  it('returns the unknown placeholder for an entity the map does not know', () => {
    expect(entityToken(map.clients, 'no-such-id', null, 'CLIENT')).toBe('CLIENT_unknown');
    expect(entityToken(map.technicians, 'no-such-id', null, 'TECH')).toBe('TECH_unknown');
    expect(entityToken(map.appointments, 'no-such-id', null, 'APT')).toBe('APT_unknown');
  });

  it('never falls back to the raw name or id it was handed', () => {
    expect(entityToken(map.clients, 'unmapped-uuid', 'Casey Unmapped', 'CLIENT')).toBe('CLIENT_unknown');
    expect(entityToken(map.clients, 'unmapped-uuid', 'Casey Unmapped', 'CLIENT')).not.toContain('Casey');
    expect(entityToken(map.clients, 'unmapped-uuid', 'Casey Unmapped', 'CLIENT')).not.toContain('unmapped-uuid');
  });
});

describe('anonymizeSchedule — free text and company detail stay home', () => {
  const anon = anonymizeSchedule(data, buildAnonymizationMap(data));

  it('keeps the blackout day and whose it is, and drops the reason', () => {
    expect(anon.blackouts).toEqual([{ entity: 'CLIENT_1', date: '2099-01-07' }]);
  });

  it('carries no settings block, so the practice name cannot ride along', () => {
    expect(JSON.stringify(anon)).not.toContain('Quillwork');
    expect(Object.keys(anon)).not.toContain('settings');
  });

  it('carries no name and no raw id anywhere', () => {
    const wire = JSON.stringify(anon);
    expect(wire).not.toContain('Zebra Quill');
    expect(wire).not.toContain('Yak Riddle');
    expect(wire).not.toContain('"c1"');
    expect(wire).not.toContain('"a1"');
  });
});

describe('buildSassiSystem — the prompt that actually leaves', () => {
  const prompt = new ClaudeScheduler('test-key', data).buildSassiSystem();

  it('never carries a blackout reason', () => {
    expect(prompt).not.toContain('neurology');
    expect(prompt).not.toContain('childrens hospital');
  });

  it('never carries a client or technician name', () => {
    expect(prompt).not.toContain('Zebra Quill');
    expect(prompt).not.toContain('Yak Riddle');
  });

  it('does carry the blackout day, so the model still knows it is unavailable', () => {
    expect(prompt).toContain('2099-01-07');
    expect(prompt).toContain('CLIENT_1');
  });
});
