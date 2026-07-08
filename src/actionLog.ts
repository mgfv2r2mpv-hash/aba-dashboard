// Action log — append-only history of committed schedule changes + selective undo.
//
// DESIGN: the log entry is DERIVED at the commit chokepoint by diffing
// prev-vs-next ScheduleData (deriveActionEntry), NOT captured from the staged
// draft ops. acceptDraft commits `draftStatus.resolved`, which can relocate
// sessions BEYOND the user's ops (movedIds), and the sassi side-channels merge
// blackouts/hints on top — a diff sees the TRUE committed delta on every path
// with one implementation.
//
// UNDO is nonlinear: undoing entry K against the CURRENT schedule builds
// inverse ops (add→remove, edit/move/shorten→restore before, remove→re-add)
// and stages them through the EXISTING draft pipeline — the tray previews the
// blast radius (op list, solveDraft grade, per-entity impact) before commit.
// Ops whose target changed again since K are flagged `superseded` (kept —
// the tray's per-op ✕ is the opt-out). Accepting an undo logs a new 'undo'
// entry; history is never rewritten.

import { v4 as uuidv4 } from 'uuid';
import {
  ScheduleData, Appointment, Blackout, SchedulingHints,
  ActionLogEntry, ActionSource,
} from './types';
import { DraftOp, newAddOp, newEditOp, newRemoveOp } from './draft';

// Caps: entries AND serialized bytes (a month-build accept carries hundreds of
// ops; the before-map of pure adds is all-null so op.appt dominates).
export const LOG_MAX_ENTRIES = 50;
export const LOG_MAX_BYTES = 2_000_000;

export interface ActionMeta {
  label: string;
  source: ActionSource;
  /** Explicitly mark a wholesale replace (import/admin) as not undoable. */
  undoable?: boolean;
}

const apptEq = (a: Appointment, b: Appointment): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

const hintsEq = (a?: SchedulingHints, b?: SchedulingHints): boolean =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// Diff prev→next into a log entry. Returns null when nothing tracked changed.
// `at` is stamped by the caller-supplied clock (default: now) so tests stay
// deterministic.
export function deriveActionEntry(
  prev: ScheduleData,
  next: ScheduleData,
  meta: ActionMeta,
  at: Date = new Date(),
): ActionLogEntry | null {
  const ops: DraftOp[] = [];
  const before: Record<string, Appointment | null> = {};

  const prevById = new Map(prev.appointments.map(a => [a.id, a]));
  const nextById = new Map(next.appointments.map(a => [a.id, a]));

  for (const [id, nextAppt] of nextById) {
    const prevAppt = prevById.get(id);
    if (!prevAppt) {
      ops.push(newAddOp(nextAppt));
      before[id] = null;
    } else if (!apptEq(prevAppt, nextAppt)) {
      ops.push(newEditOp(nextAppt));
      before[id] = prevAppt;
    }
  }
  for (const [id, prevAppt] of prevById) {
    if (!nextById.has(id)) {
      ops.push(newRemoveOp(id));
      before[id] = prevAppt;
    }
  }

  // Blackouts: additions only (removals are rare and ride the admin surface).
  const prevBlackoutIds = new Set((prev.blackouts ?? []).map(b => b.id));
  const blackoutsAdded = (next.blackouts ?? []).filter(b => !prevBlackoutIds.has(b.id));

  // Scheduling-hint changes (the teach loop's writes).
  const prevClients = new Map(prev.clients.map(c => [c.id, c]));
  const hintChanges: NonNullable<ActionLogEntry['hintChanges']> = [];
  for (const c of next.clients) {
    const p = prevClients.get(c.id);
    if (p && !hintsEq(p.schedulingHints, c.schedulingHints)) {
      hintChanges.push({ clientId: c.id, before: p.schedulingHints, after: c.schedulingHints });
    }
  }

  if (ops.length === 0 && blackoutsAdded.length === 0 && hintChanges.length === 0) return null;

  return {
    id: uuidv4(),
    at: at.toISOString(),
    label: meta.label,
    source: meta.source,
    ops,
    before,
    ...(blackoutsAdded.length ? { blackoutsAdded } : {}),
    ...(hintChanges.length ? { hintChanges } : {}),
    undoable: meta.undoable !== false,
  };
}

// A view-only entry for wholesale replaces (imports, wizard, bulk admin) where
// an op-level diff would be noise and inverse ops would be wrong.
export function viewOnlyEntry(
  next: ScheduleData, meta: Omit<ActionMeta, 'undoable'>, at: Date = new Date(),
): ActionLogEntry {
  return {
    id: uuidv4(),
    at: at.toISOString(),
    label: meta.label,
    source: meta.source,
    ops: [],
    before: {},
    undoable: false,
    counts: { appts: next.appointments.length, clients: next.clients.length, techs: next.technicians.length },
  };
}

// Append + cap. Oldest entries fall off by count, then by serialized size.
export function pruneLog(log: ActionLogEntry[]): ActionLogEntry[] {
  let out = log.slice(-LOG_MAX_ENTRIES);
  while (out.length > 1 && JSON.stringify(out).length > LOG_MAX_BYTES) out = out.slice(1);
  return out;
}

export interface InverseResult {
  ops: DraftOp[];
  /** Op ids (of the INVERSE ops) whose target changed again after this entry —
   *  undoing them would overwrite the later change. Kept, flagged, ✕-able. */
  superseded: string[];
  /** Blackouts this entry added, to strip at commit (not modeled as DraftOps). */
  removeBlackoutIds: string[];
  /** Hint patches to restore (clientId → the entry's before-hints). */
  hintRestores: { clientId: string; hints?: SchedulingHints }[];
}

// Build the inverse of `entry` against the CURRENT schedule.
export function buildInverse(entry: ActionLogEntry, current: ScheduleData): InverseResult {
  const ops: DraftOp[] = [];
  const superseded: string[] = [];
  const curById = new Map(current.appointments.map(a => [a.id, a]));

  for (const op of entry.ops) {
    const id = op.kind === 'add' ? op.appt?.id : op.targetId;
    if (!id) continue;
    const cur = curById.get(id);
    const after = op.appt as Appointment | undefined; // add/edit carry the after-state
    const b4 = entry.before[id] ?? null;

    if (op.kind === 'add') {
      if (!cur) continue;                       // already gone — nothing to undo
      const inv = newRemoveOp(id);
      if (after && !apptEq(cur, after)) superseded.push(inv.id);
      ops.push(inv);
    } else if (op.kind === 'remove') {
      if (!b4) continue;                        // nothing to restore
      if (cur) {                                // an appt with this id exists again
        const inv = newEditOp(b4);
        superseded.push(inv.id);
        ops.push(inv);
      } else {
        ops.push({ ...newAddOp(b4) });          // re-add with the ORIGINAL id
      }
    } else {                                    // edit / move / shorten
      if (!b4) continue;
      if (!cur) {                               // deleted since — restoring resurrects it
        const inv = { ...newAddOp(b4) };
        superseded.push(inv.id);
        ops.push(inv);
      } else {
        const inv = newEditOp(b4);
        if (after && !apptEq(cur, after)) superseded.push(inv.id);
        ops.push(inv);
      }
    }
  }

  const currentBlackouts = new Set((current.blackouts ?? []).map(b => b.id));
  const removeBlackoutIds = (entry.blackoutsAdded ?? [])
    .map(b => b.id)
    .filter(id => currentBlackouts.has(id));

  const hintRestores = (entry.hintChanges ?? []).map(h => ({ clientId: h.clientId, hints: h.before }));

  return { ops, superseded, removeBlackoutIds, hintRestores };
}

// Compact human label for an ops delta ("34 adds · 2 moves · 1 removal").
export function summarizeOps(ops: { kind: string }[]): string {
  const counts = new Map<string, number>();
  for (const o of ops) counts.set(o.kind, (counts.get(o.kind) ?? 0) + 1);
  const part = (k: string, one: string, many: string) => {
    const n = counts.get(k) ?? 0;
    return n ? `${n} ${n === 1 ? one : many}` : null;
  };
  return [
    part('add', 'add', 'adds'),
    part('edit', 'edit', 'edits'),
    part('move', 'move', 'moves'),
    part('shorten', 'shorten', 'shortens'),
    part('remove', 'removal', 'removals'),
  ].filter(Boolean).join(' · ') || 'no changes';
}
