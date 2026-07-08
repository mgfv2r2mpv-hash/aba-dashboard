import { describe, it, expect } from 'vitest';
import {
  deriveActionEntry, viewOnlyEntry, pruneLog, buildInverse, summarizeOps,
  LOG_MAX_ENTRIES,
} from './actionLog';
import { ScheduleData, Appointment, ActionLogEntry } from './types';

const appt = (id: string, over: Partial<Appointment> = {}): Appointment => ({
  id, title: `T-${id}`, client: 'c1', technician: 't1',
  startTime: '2026-07-06T09:00:00', endTime: '2026-07-06T11:00:00',
  isFixed: false, isBillable: true, isRecurring: false, type: 'client-session',
  status: 'scheduled', ...over,
});

const sched = (appts: Appointment[], over: Partial<ScheduleData> = {}): ScheduleData => ({
  id: 's', version: 2,
  clients: [{ id: 'c1', name: 'Client One', availabilityWindows: {} }],
  technicians: [{ id: 't1', name: 'Tech One', isRBT: true, availability: {}, assignments: [] }],
  settings: {} as ScheduleData['settings'],
  appointments: appts, lastModified: 'x', ...over,
});

const META = { label: 'test change', source: 'manual' as const };

describe('deriveActionEntry (diff at the chokepoint)', () => {
  it('classifies adds, edits, and removes with before-state', () => {
    const a = appt('a'), b = appt('b'), c = appt('c');
    const prev = sched([a, b]);
    const next = sched([{ ...a, startTime: '2026-07-06T10:00:00' }, c]); // a edited, b removed, c added
    const e = deriveActionEntry(prev, next, META)!;
    expect(e).not.toBeNull();
    const kinds = new Map(e.ops.map(o => [(o.kind === 'add' ? o.appt!.id : o.targetId!), o.kind]));
    expect(kinds.get('a')).toBe('edit');
    expect(kinds.get('b')).toBe('remove');
    expect(kinds.get('c')).toBe('add');
    expect(e.before['a']).toEqual(a);       // pre-edit state captured
    expect(e.before['b']).toEqual(b);       // pre-remove state captured
    expect(e.before['c']).toBeNull();       // add: didn't exist
    expect(e.undoable).toBe(true);
  });

  it('returns null on an empty delta', () => {
    const a = appt('a');
    expect(deriveActionEntry(sched([a]), sched([{ ...a }]), META)).toBeNull();
  });

  it('captures blackout additions and hint changes', () => {
    const prev = sched([], { blackouts: [] });
    const next = sched([], {
      blackouts: [{ id: 'b1', entityType: 'client', entityId: 'c1', entityName: 'Client One', date: '2026-07-10' }],
      clients: [{ id: 'c1', name: 'Client One', availabilityWindows: {}, schedulingHints: { supervisionStyle: 'split' } }],
    });
    const e = deriveActionEntry(prev, next, META)!;
    expect(e.blackoutsAdded?.map(b => b.id)).toEqual(['b1']);
    expect(e.hintChanges).toEqual([{ clientId: 'c1', before: undefined, after: { supervisionStyle: 'split' } }]);
  });

  it('respects undoable:false', () => {
    const e = deriveActionEntry(sched([]), sched([appt('a')]), { ...META, undoable: false })!;
    expect(e.undoable).toBe(false);
  });
});

describe('viewOnlyEntry', () => {
  it('carries counts and is never undoable', () => {
    const e = viewOnlyEntry(sched([appt('a'), appt('b')]), { label: 'Imported', source: 'import' });
    expect(e.undoable).toBe(false);
    expect(e.ops).toEqual([]);
    expect(e.counts).toEqual({ appts: 2, clients: 1, techs: 1 });
  });
});

describe('pruneLog', () => {
  it('caps the entry count, dropping oldest', () => {
    const mk = (i: number): ActionLogEntry => ({
      id: `e${i}`, at: 'x', label: 'l', source: 'manual', ops: [], before: {}, undoable: true,
    });
    const log = Array.from({ length: LOG_MAX_ENTRIES + 7 }, (_, i) => mk(i));
    const pruned = pruneLog(log);
    expect(pruned.length).toBe(LOG_MAX_ENTRIES);
    expect(pruned[0].id).toBe('e7');
    expect(pruned[pruned.length - 1].id).toBe(`e${LOG_MAX_ENTRIES + 6}`);
  });
});

describe('buildInverse (nonlinear undo)', () => {
  const entryFor = (prev: ScheduleData, next: ScheduleData) => deriveActionEntry(prev, next, META)!;

  it('inverts an add into a remove', () => {
    const prev = sched([]);
    const next = sched([appt('a')]);
    const inv = buildInverse(entryFor(prev, next), next);
    expect(inv.ops).toHaveLength(1);
    expect(inv.ops[0].kind).toBe('remove');
    expect(inv.ops[0].targetId).toBe('a');
    expect(inv.superseded).toEqual([]);
  });

  it('inverts an edit into an edit restoring the before-state', () => {
    const a = appt('a');
    const prev = sched([a]);
    const next = sched([{ ...a, startTime: '2026-07-06T10:00:00' }]);
    const inv = buildInverse(entryFor(prev, next), next);
    expect(inv.ops[0].kind).toBe('edit');
    expect(inv.ops[0].appt).toEqual(a);
    expect(inv.superseded).toEqual([]);
  });

  it('inverts a remove into a re-add with the ORIGINAL id', () => {
    const a = appt('a');
    const prev = sched([a]);
    const next = sched([]);
    const inv = buildInverse(entryFor(prev, next), next);
    expect(inv.ops[0].kind).toBe('add');
    expect(inv.ops[0].appt).toEqual(a);
  });

  it('flags a since-modified target as superseded (kept, ✕-able)', () => {
    const a = appt('a');
    const prev = sched([a]);
    const afterEntry = sched([{ ...a, startTime: '2026-07-06T10:00:00' }]);
    const entry = entryFor(prev, afterEntry);
    // A LATER change moved the same appt again.
    const current = sched([{ ...a, startTime: '2026-07-07T09:00:00' }]);
    const inv = buildInverse(entry, current);
    expect(inv.ops).toHaveLength(1);
    expect(inv.superseded).toEqual([inv.ops[0].id]);
    expect(inv.ops[0].appt).toEqual(a); // still restores the entry's before-state
  });

  it('drops the inverse of an add whose appt was deleted later', () => {
    const prev = sched([]);
    const next = sched([appt('a')]);
    const entry = entryFor(prev, next);
    const current = sched([]); // someone already removed it
    const inv = buildInverse(entry, current);
    expect(inv.ops).toEqual([]);
  });

  it('re-adds a since-deleted edit target, flagged superseded', () => {
    const a = appt('a');
    const prev = sched([a]);
    const entry = entryFor(prev, sched([{ ...a, startTime: '2026-07-06T10:00:00' }]));
    const current = sched([]); // deleted after the edit
    const inv = buildInverse(entry, current);
    expect(inv.ops[0].kind).toBe('add');
    expect(inv.ops[0].appt).toEqual(a);
    expect(inv.superseded).toEqual([inv.ops[0].id]);
  });

  it('collects removeBlackoutIds only for blackouts still present', () => {
    const prev = sched([], { blackouts: [] });
    const next = sched([], {
      blackouts: [
        { id: 'b1', entityType: 'client', entityId: 'c1', entityName: 'n', date: '2026-07-10' },
        { id: 'b2', entityType: 'client', entityId: 'c1', entityName: 'n', date: '2026-07-11' },
      ],
    });
    const entry = entryFor(prev, next);
    const current = sched([], { blackouts: [next.blackouts![0]] }); // b2 already gone
    const inv = buildInverse(entry, current);
    expect(inv.removeBlackoutIds).toEqual(['b1']);
  });

  it('restores the entry\'s before-hints', () => {
    const prev = sched([]);
    const next = sched([], {
      clients: [{ id: 'c1', name: 'Client One', availabilityWindows: {}, schedulingHints: { supervisionStyle: 'split' } }],
    });
    const entry = entryFor(prev, next);
    const inv = buildInverse(entry, next);
    expect(inv.hintRestores).toEqual([{ clientId: 'c1', hints: undefined }]);
  });
});

describe('summarizeOps', () => {
  it('counts by kind in a stable order', () => {
    const ops = [
      { kind: 'add' }, { kind: 'add' }, { kind: 'edit' }, { kind: 'remove' },
    ];
    expect(summarizeOps(ops)).toBe('2 adds · 1 edit · 1 removal');
  });
  it('handles empty', () => {
    expect(summarizeOps([])).toBe('no changes');
  });
});
