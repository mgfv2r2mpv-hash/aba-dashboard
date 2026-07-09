import { Appointment, ScheduleData, WishOp, SUPERVISION_COUNTING_TYPES } from './types';

// Consolidate adjacent BCBA session fragments in a set of staged/build ops.
//
// The deterministic builder (and Claude's free-authored edits) can place a case's
// supervision / parent-training / case-planning as TWO exactly-abutting fragments —
// the floor pass places one contact, the fill tops it up with another that lands in
// the gap starting right where the first ended (both share the bcbaBusy plane), or a
// "split" contact's two halves land back-to-back. `extendAdjacentDirects` only fuses
// client-session directs, so nothing consolidates BCBA fragments at placement time.
//
// This is the BCBA-session analogue: it fuses each run of exactly-contiguous
// (end === next.start) same-identity BCBA `add` ops into one, and — so it also cleans
// a fill staged over an EXISTING committed contact — extends a committed BCBA session
// that a staged add abuts (via a `move`) instead of leaving a separate fragment.
//
// Identity = type + client + technician (mirrors tidy.ts ruleMerge). Merging two
// contiguous same-participant intervals is credit-preserving (Σ min(overlap,dur) is
// unchanged), so compliance is untouched — same guarantee tidy's equivalence oracle
// verifies. At most one distinct non-empty seriesId per run (never crosses two series).

const BCBA_TYPES = new Set<Appointment['type']>(SUPERVISION_COUNTING_TYPES);
const ms = (iso: string): number => new Date(iso).getTime();

type AddOp = Extract<WishOp, { op: 'add' }>;
const isBcbaAdd = (o: WishOp): o is AddOp => o.op === 'add' && BCBA_TYPES.has(o.type);

export function consolidateAdjacentBcba(ops: WishOp[], data: ScheduleData): WishOp[] {
  const clientId = (ref?: string): string => (ref ? (data.clients.find(c => c.id === ref || c.name === ref)?.id ?? ref) : '');
  const techId = (ref?: string): string => (ref ? (data.technicians.find(t => t.id === ref || t.name === ref)?.id ?? ref) : '');
  const identity = (type: Appointment['type'], client?: string, tech?: string): string => `${type}|${clientId(client)}|${techId(tech)}`;
  const addKey = (o: AddOp): string => identity(o.type, o.client, o.technician);

  const others = ops.filter(o => !isBcbaAdd(o));
  const bcbaAdds = ops.filter(isBcbaAdd);
  if (bcbaAdds.length === 0) return ops;

  // ── 1. Fuse runs of exactly-contiguous same-identity BCBA adds ──────────────
  const groups = new Map<string, AddOp[]>();
  for (const a of bcbaAdds) {
    const k = addKey(a);
    const g = groups.get(k) ?? []; g.push(a); groups.set(k, g);
  }
  const fused: AddOp[] = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort((x, y) => ms(x.start) - ms(y.start));
    let i = 0;
    while (i < sorted.length) {
      let j = i;
      const runSeries = new Set<string>();
      if (sorted[i].seriesId) runSeries.add(sorted[i].seriesId!);
      while (j + 1 < sorted.length && ms(sorted[j].end) === ms(sorted[j + 1].start)) {
        const next = sorted[j + 1].seriesId;
        if (next && runSeries.size >= 1 && !runSeries.has(next)) break; // would be a 2nd distinct series
        if (next) runSeries.add(next);
        j++;
      }
      if (j > i) {
        const run = sorted.slice(i, j + 1);
        const survivor = run.find(r => r.seriesId) ?? run[0];
        fused.push({ ...survivor, start: run[0].start, end: run[run.length - 1].end });
      } else {
        fused.push(sorted[i]);
      }
      i = j + 1;
    }
  }

  // ── 2. Extend a committed BCBA session a fused add exactly abuts ─────────────
  const touched = new Set(
    ops.filter((o): o is Extract<WishOp, { appointmentId: string }> => 'appointmentId' in o && (o.op === 'move' || o.op === 'remove'))
      .map(o => o.appointmentId),
  );
  const committedByKey = new Map<string, Appointment[]>();
  for (const a of data.appointments) {
    if (a.status === 'canceled' || a.isGhost || !BCBA_TYPES.has(a.type) || touched.has(a.id)) continue;
    const k = identity(a.type, a.client, a.technician);
    const g = committedByKey.get(k) ?? []; g.push(a); committedByKey.set(k, g);
  }

  const usedCommitted = new Set<string>();
  const keptAdds: WishOp[] = [];
  const extendMoves: WishOp[] = [];
  for (const a of fused) {
    const cands = committedByKey.get(addKey(a)) ?? [];
    const hit = cands.find(c => !usedCommitted.has(c.id) && (ms(c.endTime) === ms(a.start) || ms(a.end) === ms(c.startTime)));
    if (hit) {
      usedCommitted.add(hit.id);
      const start = ms(hit.startTime) <= ms(a.start) ? hit.startTime : a.start;
      const end = ms(hit.endTime) >= ms(a.end) ? hit.endTime : a.end;
      extendMoves.push({ op: 'move', appointmentId: hit.id, start, end });
    } else {
      keptAdds.push(a);
    }
  }

  return [...others, ...keptAdds, ...extendMoves];
}
