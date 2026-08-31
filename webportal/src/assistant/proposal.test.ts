// What the BCBA reads before applying a chat proposal. The ops arrive already
// de-anonymized, so these lines are the first place real names appear again -
// and the net count is the number that decides whether Apply is worth pressing.
import { describe, it, expect } from 'vitest';
import type { ScheduleData, WishOp } from '@shared/types';
import { buildProposal, describeOp } from './proposal';

const data: ScheduleData = {
  id: 's', version: 2,
  clients: [{ id: 'c1', name: 'Zebra Quill', availabilityWindows: {} }],
  technicians: [{ id: 't1', name: 'Yak Riddle', isRBT: true, assignments: [], availability: {} }],
  settings: {
    supervisionDirectHoursPercent: 15, supervisionRBTHoursPercent: 5,
    parentTraining: { minimumHours: 1, targetMinHours: 2, targetMaxHours: 4, periodUnit: 'month' },
  } as ScheduleData['settings'],
  appointments: [{
    id: 'a1', title: 'Session', client: 'c1', technician: 't1',
    startTime: '2026-09-10T13:00:00', endTime: '2026-09-10T15:00:00',
    isFixed: false, isBillable: true, type: 'client-session',
  }],
  lastModified: '2026-07-01T00:00:00.000Z',
};

describe('describeOp - one sentence per change', () => {
  it('names the case, the technician and the span on an add', () => {
    const op: WishOp = { op: 'add', type: 'supervision', client: 'c1', technician: 't1', start: '2026-09-10T13:30:00', end: '2026-09-10T14:30:00' };
    const line = describeOp(op, data);
    expect(line).toContain('Add supervision for Zebra Quill');
    expect(line).toContain('Yak Riddle');
    expect(line).toContain('Thu Sep 10, 1:30 PM to 2:30 PM');
  });

  it('resolves a case named by the reverse map, not only by id', () => {
    // What a live turn actually carries: parseOps maps CLIENT_n back through the
    // reverse map, which holds the NAME. An id-only lookup here read "a case".
    const op: WishOp = { op: 'add', type: 'supervision', client: 'Zebra Quill', start: '2026-09-10T13:30:00', end: '2026-09-10T14:30:00' };
    expect(describeOp(op, data)).toContain('for Zebra Quill');
  });

  it('describes an existing session by its type and time, never by its id', () => {
    const line = describeOp({ op: 'remove', appointmentId: 'a1' }, data);
    expect(line).toBe('Remove a direct session on Thu Sep 10, 1:00 PM.');
    expect(line).not.toContain('a1');
  });

  it('falls back to a neutral phrase when the session is not in this schedule', () => {
    expect(describeOp({ op: 'complete', appointmentId: 'gone' }, data)).toBe('Mark a session complete.');
  });
});

describe('buildProposal - the schedule it would produce', () => {
  it('counts sessions gained without touching the schedule it was given', () => {
    const ops: WishOp[] = [
      { op: 'add', type: 'supervision', client: 'c1', technician: 't1', start: '2026-09-10T13:30:00', end: '2026-09-10T14:30:00' },
      { op: 'add', type: 'parent-training', client: 'c1', start: '2026-09-10T14:30:00', end: '2026-09-10T15:00:00' },
    ];
    const proposal = buildProposal(data, ops);
    expect(proposal.netSessions).toBe(2);
    expect(proposal.lines).toHaveLength(2);
    expect(proposal.next.appointments).toHaveLength(3);
    expect(data.appointments).toHaveLength(1);   // the base is untouched
  });

  it('counts a removal as a session lost', () => {
    expect(buildProposal(data, [{ op: 'remove', appointmentId: 'a1' }]).netSessions).toBe(-1);
  });

  it('reports no net change for an op that only moves a session', () => {
    const proposal = buildProposal(data, [{ op: 'move', appointmentId: 'a1', start: '2026-09-11T13:00:00', end: '2026-09-11T15:00:00' }]);
    expect(proposal.netSessions).toBe(0);
    expect(proposal.next.appointments[0].startTime).toContain('2026-09-11');
  });
});
