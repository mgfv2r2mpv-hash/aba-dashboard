import { describe, it, expect } from 'vitest';
import type { Appointment, ScheduleData, CompanySettings } from './types';
import { solveDraft } from './draftSolver';
import { newAddOp } from './draft';

const appt = (over: Partial<Appointment>): Appointment => ({
  id: 'x', title: '', client: 'CO',
  startTime: '2026-06-01T14:45:00', endTime: '2026-06-01T15:30:00',
  isFixed: false, isBillable: true, type: 'supervision', status: 'completed', ...over,
});

const data = (appointments: Appointment[]): ScheduleData => ({
  id: 's', version: 2, clients: [], technicians: [], appointments,
  settings: {} as unknown as CompanySettings, lastModified: '2026-06-02T09:00:00',
} as ScheduleData);

const NOW = new Date('2026-06-02T09:00:00'); // both sessions are in the past

describe('solveDraft — adjacent BCBA-billable sessions (regression)', () => {
  it('does NOT flag supervision 2:45–3:30 and PT 3:30–4:30 as overlapping (touching is not overlap)', () => {
    const sup = appt({ id: 'sup', type: 'supervision', startTime: '2026-06-01T14:45:00', endTime: '2026-06-01T15:30:00' });
    const pt = appt({ id: 'pt', type: 'parent-training', technician: 'SB', startTime: '2026-06-01T15:30:00', endTime: '2026-06-01T16:30:00' });
    const status = solveDraft(data([sup]), [newAddOp(pt)], NOW, {} as CompanySettings);
    expect(status.grade).toBe('green');
  });

  it('still flags genuinely overlapping BCBA-billable sessions', () => {
    const sup = appt({ id: 'sup', type: 'supervision', startTime: '2026-06-01T14:45:00', endTime: '2026-06-01T15:45:00' });
    const pt = appt({ id: 'pt', type: 'parent-training', technician: 'SB', startTime: '2026-06-01T15:30:00', endTime: '2026-06-01T16:30:00' });
    const status = solveDraft(data([sup]), [newAddOp(pt)], NOW, {} as CompanySettings);
    expect(status.grade).toBe('red');
  });

  // The real defect: a PT (or case-planning) session names the OBSERVED BT in
  // its technician field. That BT is being observed, not providing — so the PT
  // overlapping that BT's own direct session is required concurrent care (it's
  // how supervision earns credit), NOT a tech double-book.
  it("does NOT flag PT-naming-a-BT overlapping that BT's own direct session", () => {
    const direct = appt({ id: 'd', type: 'client-session', technician: 'SB', startTime: '2026-06-01T14:45:00', endTime: '2026-06-01T16:30:00' });
    const sup = appt({ id: 'sup', type: 'supervision', startTime: '2026-06-01T14:45:00', endTime: '2026-06-01T15:30:00' });
    const pt = appt({ id: 'pt', type: 'parent-training', technician: 'SB', startTime: '2026-06-01T15:30:00', endTime: '2026-06-01T16:30:00' });
    const status = solveDraft(data([direct, sup]), [newAddOp(pt)], NOW, {} as CompanySettings);
    expect(status.grade).toBe('green');
  });

  // Two genuine BT-provided directs by the same tech at once is still a real
  // double-book (the tech can only deliver one).
  it('still flags the same tech delivering two overlapping direct sessions', () => {
    const d1 = appt({ id: 'd1', type: 'client-session', technician: 'SB', client: 'CO', startTime: '2026-06-01T14:00:00', endTime: '2026-06-01T15:00:00' });
    const d2 = appt({ id: 'd2', type: 'client-session', technician: 'SB', client: 'XX', startTime: '2026-06-01T14:30:00', endTime: '2026-06-01T15:30:00' });
    const status = solveDraft(data([d1]), [newAddOp(d2)], NOW, {} as CompanySettings);
    expect(status.grade).toBe('red');
  });

  // Regression for the reshuffleMobile path: when the new appointment is in the
  // future, solveDraft routes through reshuffleMobile instead of the all-past
  // shortcut. Touching BCBA sessions must still grade green on that path.
  it('does NOT flag future touching BCBA sessions (reshuffleMobile path)', () => {
    const FUTURE_NOW = new Date('2026-05-01T09:00:00');
    const sup = appt({ id: 'sup', type: 'supervision', startTime: '2026-06-01T14:45:00', endTime: '2026-06-01T15:30:00' });
    const pt = appt({ id: 'pt', type: 'parent-training', technician: 'SB', startTime: '2026-06-01T15:30:00', endTime: '2026-06-01T16:30:00' });
    const status = solveDraft(data([sup]), [newAddOp(pt)], FUTURE_NOW, {} as CompanySettings);
    expect(status.grade).toBe('green');
  });

  // Two different BTs delivering direct service to the same client at the same
  // time is a billing conflict — insurers reject duplicate direct-service claims
  // for the same client in the same slot.
  it('flags two overlapping direct sessions for the same client from different BTs', () => {
    const d1 = appt({ id: 'd1', type: 'client-session', technician: 'SB', client: 'CO', startTime: '2026-06-01T14:00:00', endTime: '2026-06-01T15:00:00' });
    const d2 = appt({ id: 'd2', type: 'client-session', technician: 'KW', client: 'CO', startTime: '2026-06-01T14:30:00', endTime: '2026-06-01T15:30:00' });
    const status = solveDraft(data([d1]), [newAddOp(d2)], NOW, {} as CompanySettings);
    expect(status.grade).not.toBe('green');
  });
});
