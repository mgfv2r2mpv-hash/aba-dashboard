import { describe, it, expect } from 'vitest';
import type { Appointment, ScheduleData, WishSolution, CompanySettings } from './types';
import { wishSolutionToDraft } from './wish';

// Characterization (behavior-lock) for wishSolutionToDraft — turning a chosen
// WishSolution into draft ops + blackouts + hint changes, and (critically) the
// TRIO-INVARIANT normalization that runs over the projected working set on the
// way out (normalizeRecurrenceFields). Every assertion pins ACTUAL output.
//
// Non-determinism: added ids, minted seriesIds, blackout ids, and *At timestamps
// are uuids/clock — never value-asserted, only defined / shared / unique.

function makeData(over: Partial<ScheduleData> = {}): ScheduleData {
  return {
    id: 'd', version: 3,
    clients: [{ id: 'c1', name: 'Client One', availabilityWindows: {} }],
    technicians: [{ id: 't1', name: 'Tech One', isRBT: true, assignments: [], availability: {} }],
    settings: {
      supervisionDirectHoursPercent: 5, supervisionRBTHoursPercent: 5,
    } as unknown as CompanySettings,
    appointments: [],
    lastModified: '2026-07-15T12:00:00.000Z',
    ...over,
  } as ScheduleData;
}

// A pending appointment; overrides win.
const appt = (over: Partial<Appointment> & { id: string; startTime: string; endTime: string }): Appointment => ({
  title: 'Session', client: 'c1', technician: 't1', type: 'client-session',
  isFixed: false, isBillable: true, status: 'scheduled', ...over,
});

const sol = (ops: WishSolution['ops']): WishSolution => ({ id: 'w', summary: 's', reasoning: '', ops });

describe('wishSolutionToDraft — move / remove / add', () => {
  const base = makeData({
    appointments: [
      appt({ id: 'a1', title: 'PT', type: 'parent-training', startTime: '2026-06-19T10:00:00', endTime: '2026-06-19T11:00:00' }),
      appt({ id: 'a2', title: 'Session', startTime: '2026-06-19T13:00:00', endTime: '2026-06-19T15:00:00' }),
    ],
  });

  it('move → a move DraftOp carrying the exact new ISO timestamps (no string-mangling)', () => {
    const d = wishSolutionToDraft(sol([
      { op: 'move', appointmentId: 'a1', start: '2026-06-19T17:00:00', end: '2026-06-19T18:00:00' },
    ]), base);
    const mv = d.ops.find(o => o.kind === 'move');
    expect(mv).toBeDefined();
    expect(mv!.targetId).toBe('a1');
    expect(mv!.appt!.id).toBe('a1');
    // ISO strings preserved byte-for-byte, and still parse to the intended instant.
    expect(mv!.appt!.startTime).toBe('2026-06-19T17:00:00');
    expect(mv!.appt!.endTime).toBe('2026-06-19T18:00:00');
    expect(new Date(mv!.appt!.startTime).getHours()).toBe(17);
    expect(d.unresolved).toBe(0);
  });

  it('remove → a remove DraftOp targeting the id', () => {
    const d = wishSolutionToDraft(sol([{ op: 'remove', appointmentId: 'a2' }]), base);
    expect(d.ops.some(o => o.kind === 'remove' && o.targetId === 'a2')).toBe(true);
  });

  it('add → an add DraftOp: fresh id, default title, billable derived, client name normalized to its id', () => {
    const d = wishSolutionToDraft(sol([
      { op: 'add', type: 'parent-training', client: 'Client One', start: '2026-06-26T10:00:00', end: '2026-06-26T11:00:00' },
    ]), base);
    const add = d.ops.find(o => o.kind === 'add');
    expect(add).toBeDefined();
    const a = add!.appt!;
    expect(a.type).toBe('parent-training');
    expect(a.title).toBe('Parent Training');  // defaulted from type
    expect(a.client).toBe('c1');               // 'Client One' name → immutable id
    expect(a.isBillable).toBe(true);
    expect(a.isFixed).toBe(false);
    expect(a.status).toBe('scheduled');
    expect(a.startTime).toBe('2026-06-26T10:00:00'); // ISO preserved
    expect(a.endTime).toBe('2026-06-26T11:00:00');
    expect(a.id).toBeTruthy();
    expect(a.id).not.toBe('a1');
    expect(a.id).not.toBe('a2');
  });

  it('add of an internal-task derives isBillable=false', () => {
    const d = wishSolutionToDraft(sol([
      { op: 'add', type: 'internal-task', start: '2026-06-26T10:00:00', end: '2026-06-26T11:00:00' },
    ]), base);
    const add = d.ops.find(o => o.kind === 'add');
    expect(add!.appt!.isBillable).toBe(false);
  });

  it('an unresolvable target increments unresolved and emits no op for it', () => {
    const before = wishSolutionToDraft(sol([{ op: 'remove', appointmentId: 'a2' }]), base).ops.length;
    const d = wishSolutionToDraft(sol([
      { op: 'remove', appointmentId: 'a2' },
      { op: 'remove', appointmentId: 'ghost-id' },
    ]), base);
    expect(d.unresolved).toBe(1);
    expect(d.ops.filter(o => o.kind === 'remove')).toHaveLength(1);
    expect(d.ops.length).toBe(before); // ghost added nothing
  });

  it('blackout → resolved name to entityId (side-channel, not a draft op)', () => {
    const d = wishSolutionToDraft(sol([
      { op: 'blackout', entityType: 'client', entity: 'Client One', date: '2026-07-04', reason: 'holiday' },
    ]), base);
    expect(d.blackouts).toHaveLength(1);
    expect(d.blackouts[0].entityId).toBe('c1');
    expect(d.blackouts[0].entityName).toBe('Client One');
    expect(d.blackouts[0].date).toBe('2026-07-04');
  });
});

describe('wishSolutionToDraft — TRIO INVARIANT (normalizeRecurrenceFields choke point)', () => {
  // ── Half-state A: a lone recurring flag/pattern with NO seriesId is inconsistent
  //    (a "recurs weekly" label with no series behind it). The choke point clears
  //    BOTH the flag AND the pattern, leaving an honest one-time — via a metadata-
  //    only edit — even when NO op in the solution touches the row.
  it('clears an inconsistent lone recurring/pattern combo already sitting in the base', () => {
    const base = makeData({
      appointments: [
        appt({ id: 'a1', startTime: '2026-07-20T10:00:00', endTime: '2026-07-20T11:00:00', isRecurring: true, recurringPattern: 'monthly' }),
      ],
    });
    const d = wishSolutionToDraft(sol([]), base); // no ops — pure normalization
    const edit = d.ops.find(o => o.kind === 'edit' && o.targetId === 'a1');
    expect(edit).toBeDefined();
    expect(edit!.appt!.isRecurring).toBeUndefined();
    expect(edit!.appt!.recurringPattern).toBeUndefined();
    expect(edit!.appt!.seriesId).toBeUndefined();
  });

  // ── Half-state B: ≥2 rows sharing a seriesId but carrying NO flags gain
  //    isRecurring=true + the MEASURED pattern (14-day gaps → biweekly, NOT the
  //    defaulted 'weekly'). One metadata-only edit per member.
  it('stamps a flagless multi-member series with isRecurring + the MEASURED pattern', () => {
    const base = makeData({
      appointments: ['2026-06-01', '2026-06-15', '2026-06-29'].map((day, i) =>
        appt({ id: `b${i}`, startTime: `${day}T10:00:00`, endTime: `${day}T11:00:00`, seriesId: 'S' })),
    });
    const d = wishSolutionToDraft(sol([]), base);
    const edits = d.ops.filter(o => o.kind === 'edit' && o.appt!.seriesId === 'S');
    expect(edits).toHaveLength(3);
    expect(edits.every(o => o.appt!.isRecurring === true)).toBe(true);
    expect(edits.every(o => o.appt!.recurringPattern === 'biweekly')).toBe(true); // measured, not 'weekly'
  });

  // ── A remove that leaves a series with a single member collapses the survivor's
  //    whole trio to one-time (a series of one is a one-time).
  it('collapses a series to one-time when a remove leaves a single member', () => {
    const base = makeData({
      appointments: [
        appt({ id: 'a1', startTime: '2026-07-20T10:00:00', endTime: '2026-07-20T11:00:00', seriesId: 'S', isRecurring: true, recurringPattern: 'weekly' }),
        appt({ id: 'a2', startTime: '2026-07-27T10:00:00', endTime: '2026-07-27T11:00:00', seriesId: 'S', isRecurring: true, recurringPattern: 'weekly' }),
      ],
    });
    const d = wishSolutionToDraft(sol([{ op: 'remove', appointmentId: 'a2' }]), base);
    expect(d.ops.some(o => o.kind === 'remove' && o.targetId === 'a2')).toBe(true);
    const survivorEdit = d.ops.find(o => o.kind === 'edit' && o.targetId === 'a1');
    expect(survivorEdit).toBeDefined();
    expect(survivorEdit!.appt!.seriesId).toBeUndefined();
    expect(survivorEdit!.appt!.isRecurring).toBeUndefined();
    expect(survivorEdit!.appt!.recurringPattern).toBeUndefined();
  });

  // ── An ALREADY-consistent multi-member series must not churn — no edit ops.
  it('emits no edits for an already-consistent series (idempotent, no churn)', () => {
    const base = makeData({
      appointments: [
        appt({ id: 'a1', startTime: '2026-07-20T10:00:00', endTime: '2026-07-20T11:00:00', seriesId: 'S', isRecurring: true, recurringPattern: 'weekly' }),
        appt({ id: 'a2', startTime: '2026-07-27T10:00:00', endTime: '2026-07-27T11:00:00', seriesId: 'S', isRecurring: true, recurringPattern: 'weekly' }),
      ],
    });
    const d = wishSolutionToDraft(sol([]), base);
    expect(d.ops).toHaveLength(0);
  });

  // ── Completed/canceled FACTS are never re-stamped, even when inconsistent.
  it('never touches a completed/canceled fact row', () => {
    const base = makeData({
      appointments: [
        // a lone recurring flag, but a completed FACT — must be left alone
        appt({ id: 'f1', status: 'completed', startTime: '2026-06-01T10:00:00', endTime: '2026-06-01T11:00:00', isRecurring: true, recurringPattern: 'weekly' }),
      ],
    });
    const d = wishSolutionToDraft(sol([]), base);
    expect(d.ops.some(o => o.targetId === 'f1')).toBe(false);
  });
});

describe('wishSolutionToDraft — recurring ADD trio (born whole or one-time)', () => {
  const base = makeData();

  // A lone recurring add has no siblings → lands as an honest one-time (no flag,
  // no seriesId, no pattern) rather than a flag-only half-state.
  it('a lone recurring add becomes a one-time (flag + series + pattern all absent)', () => {
    const d = wishSolutionToDraft(sol([
      { op: 'add', type: 'supervision', client: 'Client One', start: '2026-07-20T10:00:00', end: '2026-07-20T11:00:00', recurring: true, pattern: 'weekly' },
    ]), base);
    const add = d.ops.find(o => o.kind === 'add' && o.appt!.type === 'supervision');
    expect(add).toBeDefined();
    expect(add!.appt!.isRecurring).toBeUndefined();
    expect(add!.appt!.seriesId).toBeUndefined();
    expect(add!.appt!.recurringPattern).toBeUndefined();
  });

  // ≥2 matching recurring adds (same identity + clock + duration) are a series
  // being born → they share ONE minted seriesId and carry the full trio.
  it('a batch of matching recurring adds mints one SHARED seriesId + full trio', () => {
    const d = wishSolutionToDraft(sol([
      { op: 'add', type: 'supervision', client: 'Client One', technician: 'Tech One', start: '2026-07-20T10:00:00', end: '2026-07-20T11:00:00', recurring: true, pattern: 'weekly' },
      { op: 'add', type: 'supervision', client: 'Client One', technician: 'Tech One', start: '2026-07-27T10:00:00', end: '2026-07-27T11:00:00', recurring: true, pattern: 'weekly' },
    ]), base);
    const adds = d.ops.filter(o => o.kind === 'add' && o.appt!.type === 'supervision');
    expect(adds).toHaveLength(2);
    expect(adds[0].appt!.seriesId).toBeTruthy();
    expect(adds[0].appt!.seriesId).toBe(adds[1].appt!.seriesId); // shared mint
    expect(adds.every(o => o.appt!.isRecurring === true)).toBe(true);
    expect(adds.every(o => o.appt!.recurringPattern === 'weekly')).toBe(true);
    // ISO timestamps on each occurrence preserved exactly.
    expect(adds.map(o => o.appt!.startTime).sort()).toEqual(['2026-07-20T10:00:00', '2026-07-27T10:00:00']);
  });
});

describe('wishSolutionToDraft — regroup stamps the full trio', () => {
  it('regroup yields a metadata-only edit with seriesId + isRecurring + pattern on every member', () => {
    const base = makeData({
      appointments: [
        appt({ id: 'a1', startTime: '2026-06-19T10:00:00', endTime: '2026-06-19T11:00:00' }),
        appt({ id: 'a2', startTime: '2026-06-26T10:00:00', endTime: '2026-06-26T11:00:00' }),
      ],
    });
    const d = wishSolutionToDraft(sol([
      { op: 'regroup', appointmentIds: ['a1', 'a2'], seriesId: 'SER', recurringPattern: 'weekly' },
    ]), base);
    const edits = d.ops.filter(o => o.kind === 'edit' && o.appt!.seriesId === 'SER');
    expect(edits).toHaveLength(2);
    expect(edits.every(o => o.appt!.isRecurring === true)).toBe(true);
    expect(edits.every(o => o.appt!.recurringPattern === 'weekly')).toBe(true);
    // regroup is time-agnostic — the original ISO timestamps are untouched.
    const a1Edit = edits.find(o => o.targetId === 'a1')!;
    expect(a1Edit.appt!.startTime).toBe('2026-06-19T10:00:00');
    expect(a1Edit.appt!.endTime).toBe('2026-06-19T11:00:00');
  });
});
