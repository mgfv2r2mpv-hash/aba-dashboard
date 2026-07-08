import { describe, it, expect } from 'vitest';
import { buildDossier } from './dossier';
import type { ScheduleData, Appointment, ScheduleConflict, CompanySettings, Client } from './types';

// Wednesday, mid-July 2026 — matches the app's "today" in these fixtures.
const NOW = new Date(2026, 6, 8, 10, 0, 0);

const iso = (day: number, hhmm: string): string => {
  const [h, mi] = hhmm.split(':').map(Number);
  return new Date(2026, 6, day, h, mi).toISOString();
};

let seq = 0;
const appt = (over: Partial<Appointment> = {}): Appointment => ({
  id: `a${++seq}`, title: 'T', client: undefined, technician: 't1',
  startTime: iso(8, '15:00'), endTime: iso(8, '17:00'),
  isFixed: false, isBillable: true, isRecurring: false, type: 'client-session',
  status: 'scheduled', ...over,
});

const conflict = (
  type: ScheduleConflict['type'],
  severity: ScheduleConflict['severity'],
  message: string,
  affectedAppointments?: string[],
): ScheduleConflict => ({ type, severity, message, affectedAppointments });

const allDay = {
  Monday: [{ start: '08:00', end: '18:00' }], Tuesday: [{ start: '08:00', end: '18:00' }],
  Wednesday: [{ start: '08:00', end: '18:00' }], Thursday: [{ start: '08:00', end: '18:00' }],
  Friday: [{ start: '08:00', end: '18:00' }],
} as any;

const settings: CompanySettings = {
  supervisionFloorPercent: 10,
  supervisionPreferredMinPercent: 15,
  supervisionPreferredMaxPercent: 20,
  supervisionMaxHoursPercent: 20,
} as CompanySettings;

const sched = (appts: Appointment[], over: Partial<ScheduleData> = {}): ScheduleData => ({
  id: 's', version: 2,
  clients: over.clients ?? [],
  technicians: [{ id: 't1', name: 'Tech One', isRBT: true, availability: allDay, assignments: [] }],
  settings,
  appointments: appts, lastModified: 'x', ...over,
});

describe('buildDossier — self-contained analysis (no case resolved)', () => {
  // A client ref that resolves to nobody skips the case-level analysis, isolating
  // the dossier's own conflict/label/headline logic.
  it('maps a touching conflict to a titled finding and skips a non-touching one', () => {
    const a = appt({ id: 'x1', client: 'nobody' });
    const data = sched([a]);
    const touching = conflict('supervision-violation', 'error', 'Under target', ['x1']);
    const elsewhere = conflict('availability-conflict', 'warning', 'Somewhere else', ['zzz']);
    const d = buildDossier(data, { kind: 'appointment', appointmentId: 'x1' }, NOW, [touching, elsewhere]);
    expect(d.findings).toHaveLength(1);
    expect(d.findings[0].title).toBe('Supervision gap');
    expect(d.findings[0].severity).toBe('red');
    expect(d.findings[0].detail).toBe('Under target');
    expect(d.clientId).toBeUndefined();
  });

  it('orders findings worst-first (red → yellow → info)', () => {
    const a = appt({ id: 'x2', client: 'nobody', status: 'canceled' }); // canceled → an info finding
    const data = sched([a]);
    const warn = conflict('training-violation', 'warning', 'w', ['x2']);
    const err = conflict('availability-conflict', 'error', 'e', ['x2']);
    const d = buildDossier(data, { kind: 'appointment', appointmentId: 'x2' }, NOW, [warn, err]);
    expect(d.findings.map((f) => f.severity)).toEqual(['red', 'yellow', 'info']);
    expect(d.headline).toContain('to fix');
  });

  it('flags a ghost session as an info finding', () => {
    const a = appt({ id: 'x3', client: 'nobody', isGhost: true });
    const d = buildDossier(sched([a]), { kind: 'appointment', appointmentId: 'x3' }, NOW, []);
    expect(d.findings).toHaveLength(1);
    expect(d.findings[0].title).toBe('Unplaced (ghost)');
    expect(d.headline).toContain('to watch');
  });

  it('returns a graceful result when the appointment is gone', () => {
    const d = buildDossier(sched([]), { kind: 'appointment', appointmentId: 'missing' }, NOW, []);
    expect(d.findings).toEqual([]);
    expect(d.headline).toMatch(/no longer/i);
  });

  it('reports a clean bill when nothing is flagged', () => {
    const a = appt({ id: 'x4', client: 'nobody' });
    const d = buildDossier(sched([a]), { kind: 'appointment', appointmentId: 'x4' }, NOW, []);
    expect(d.findings).toEqual([]);
    expect(d.headline).toMatch(/on track/i);
  });
});

describe('buildDossier — case-level analysis', () => {
  it('surfaces a supervision floor gap for a case with directs but no supervision', () => {
    const client: Client = { id: 'C1', name: 'Casey', availabilityWindows: allDay };
    // Two scheduled directs this month, zero supervision → floor (10% of direct) unmet.
    const directs = [
      appt({ id: 'd1', client: 'C1', startTime: iso(6, '09:00'), endTime: iso(6, '12:00') }),
      appt({ id: 'd2', client: 'C1', startTime: iso(8, '09:00'), endTime: iso(8, '12:00') }),
    ];
    const data = sched(directs, { clients: [client] });
    const d = buildDossier(data, { kind: 'appointment', appointmentId: 'd1' }, NOW, []);
    expect(d.clientId).toBe('C1');
    expect(d.focusLabel).toContain('Casey');
    const sup = d.findings.find((f) => f.title === 'Supervision below floor');
    expect(sup).toBeDefined();
    expect(sup!.severity).toBe('red');
    expect(d.headline).toContain('to fix');
  });

  it('works from a case focus directly', () => {
    const client: Client = { id: 'C1', name: 'Casey', availabilityWindows: allDay };
    const directs = [appt({ id: 'd3', client: 'C1', startTime: iso(7, '09:00'), endTime: iso(7, '12:00') })];
    const data = sched(directs, { clients: [client] });
    const d = buildDossier(data, { kind: 'case', clientId: 'C1' }, NOW, []);
    expect(d.focusKind).toBe('case');
    expect(d.focusLabel).toBe('Casey');
    expect(d.clientId).toBe('C1');
  });
});
