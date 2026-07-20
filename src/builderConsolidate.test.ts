import { describe, it, expect } from 'vitest';
import { consolidateAdjacentBcba } from './builderConsolidate';
import { ScheduleData, Client, Appointment, WishOp, CompanySettings } from './types';

// CHARACTERIZATION tests — behavior-lock for consolidateAdjacentBcba, which fuses
// exactly-adjacent (end === next.start) same-identity BCBA fragments and extends a
// committed BCBA session a fused add abuts. Identity = type|clientId|techId.
// Expected values are derived by reasoning through builderConsolidate.ts.
//
// Determinism: every timestamp is a fixed local ISO string on 2026-07-15.

const DAY = '2026-07-15';
const pad = (n: number): string => String(n).padStart(2, '0');
const iso = (h: number): string => `${DAY}T${pad(h)}:00:00`;

const mkClient = (id: string, name: string): Client => ({ id, name, availabilityWindows: {} });

const mkData = (over: Partial<ScheduleData> = {}): ScheduleData => ({
  id: 'test', version: 2,
  clients: [mkClient('c1', 'Client One'), mkClient('c2', 'Client Two')],
  technicians: [],
  settings: {} as CompanySettings,
  appointments: [],
  lastModified: '2026-07-01T00:00:00.000Z',
  ...over,
});

// A supervision add op (BCBA-solo: technician '' → techId '').
const addSup = (client: string, sh: number, eh: number, over: Partial<Extract<WishOp, { op: 'add' }>> = {}): WishOp =>
  ({ op: 'add', type: 'supervision', client, technician: '', start: iso(sh), end: iso(eh), ...over });

const isAdd = (o: WishOp): o is Extract<WishOp, { op: 'add' }> => o.op === 'add';

describe('consolidateAdjacentBcba', () => {
  it('fuses two exactly-adjacent same-identity BCBA adds into one (2 ops → 1)', () => {
    const ops = [addSup('c1', 9, 10), addSup('c1', 10, 11)];
    const out = consolidateAdjacentBcba(ops, mkData());
    expect(out).toHaveLength(1);
    const fused = out[0];
    expect(fused.op).toBe('add');
    if (isAdd(fused)) {
      expect(fused.type).toBe('supervision');
      expect(fused.client).toBe('c1');
      expect(fused.start).toBe(iso(9));
      expect(fused.end).toBe(iso(11));
    }
  });

  it('does NOT fuse a non-adjacent pair (30-min gap stays two ops)', () => {
    // 09:00–10:00 then 10:30–11:30 — a real 30-min gap, so end !== next.start.
    const gapOps: WishOp[] = [
      addSup('c1', 9, 10),
      { op: 'add', type: 'supervision', client: 'c1', technician: '', start: `${DAY}T10:30:00`, end: `${DAY}T11:30:00` },
    ];
    const out = consolidateAdjacentBcba(gapOps, mkData());
    expect(out).toHaveLength(2);
    expect(out.filter(o => o.op === 'add')).toHaveLength(2);
  });

  it('treats a different type as a different identity — no cross-type fusion', () => {
    const ops: WishOp[] = [
      addSup('c1', 9, 10),
      { op: 'add', type: 'parent-training', client: 'c1', technician: '', start: iso(10), end: iso(11) },
    ];
    const out = consolidateAdjacentBcba(ops, mkData());
    expect(out).toHaveLength(2);
    expect(out.map(o => (isAdd(o) ? o.type : o.op)).sort()).toEqual(['parent-training', 'supervision']);
  });

  it('leaves directs and non-BCBA ops untouched, fusing only BCBA adds (4 ops → 3)', () => {
    const directAdd: WishOp = { op: 'add', type: 'client-session', client: 'c1', technician: 'techX', start: iso(9), end: iso(10) };
    const moveOp: WishOp = { op: 'move', appointmentId: 'some-id', start: iso(14), end: iso(15) };
    const ops = [directAdd, addSup('c1', 10, 11), addSup('c1', 11, 12), moveOp];
    const out = consolidateAdjacentBcba(ops, mkData());
    expect(out).toHaveLength(3);
    // the direct add survives byte-for-byte
    expect(out).toContainEqual(directAdd);
    // the move op survives byte-for-byte
    expect(out).toContainEqual(moveOp);
    // exactly one supervision add, fused to 10:00–12:00
    const sups = out.filter((o): o is Extract<WishOp, { op: 'add' }> => isAdd(o) && o.type === 'supervision');
    expect(sups).toHaveLength(1);
    expect([sups[0].start, sups[0].end]).toEqual([iso(10), iso(12)]);
  });

  it('extends a committed BCBA session a fused add exactly abuts (add → move on the committed row)', () => {
    const committed = {
      id: 'sup-existing', title: 'Supervision', type: 'supervision', client: 'c1',
      startTime: iso(8), endTime: iso(9), isFixed: false, isBillable: true,
    } as Appointment;
    const out = consolidateAdjacentBcba([addSup('c1', 9, 10)], mkData({ appointments: [committed] }));
    expect(out).toHaveLength(1);
    const mv = out[0];
    expect(mv.op).toBe('move');
    if (mv.op === 'move') {
      expect(mv.appointmentId).toBe('sup-existing');
      expect(mv.start).toBe(iso(8)); // grows down to the committed start
      expect(mv.end).toBe(iso(10));  // grows up to the fused add's end
    }
  });

  it('returns the original ops array unchanged (same reference) when there are no BCBA adds', () => {
    const directAdd: WishOp = { op: 'add', type: 'client-session', client: 'c1', technician: 'techX', start: iso(9), end: iso(10) };
    const ops = [directAdd];
    expect(consolidateAdjacentBcba(ops, mkData())).toBe(ops);
  });

  it('the fused survivor keeps a seriesId carried by any fragment', () => {
    const ops = [addSup('c1', 9, 10), addSup('c1', 10, 11, { seriesId: 's1' })];
    const out = consolidateAdjacentBcba(ops, mkData());
    expect(out).toHaveLength(1);
    expect(isAdd(out[0]) && (out[0] as Extract<WishOp, { op: 'add' }>).seriesId).toBe('s1');
  });
});
