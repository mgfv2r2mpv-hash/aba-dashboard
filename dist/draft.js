// Draft sandbox — staged, non-destructive schedule edits.
//
// Every add / move / shorten / remove the user makes while a draft is open is
// recorded as a DraftOp instead of mutating the live schedule. `applyOps`
// derives the PREVIEW schedule (what the week would look like if accepted); the
// live `ScheduleData` is only ever replaced on an explicit commit. This lets the
// BCBA stack several "potential" changes, see them previewed and graded, and
// then accept, override, or discard the whole batch.
import { v4 as uuidv4 } from 'uuid';
export function newAddOp(appt) {
    return { id: uuidv4(), kind: 'add', appt };
}
export function newMoveOp(appt) {
    return { id: uuidv4(), kind: 'move', targetId: appt.id, appt };
}
export function newShortenOp(appt) {
    return { id: uuidv4(), kind: 'shorten', targetId: appt.id, appt };
}
export function newRemoveOp(targetId) {
    return { id: uuidv4(), kind: 'remove', targetId };
}
// Apply staged ops over the base schedule, in order, producing the preview.
// Later ops win (e.g. moving the same appointment twice keeps the last move).
export function applyOps(base, ops) {
    const byId = new Map(base.appointments.map(a => [a.id, { ...a }]));
    for (const op of ops) {
        if ((op.kind === 'add' || op.kind === 'move' || op.kind === 'shorten') && op.appt) {
            byId.set(op.appt.id, { ...op.appt });
        }
        else if (op.kind === 'remove' && op.targetId) {
            byId.delete(op.targetId);
        }
    }
    return { ...base, appointments: Array.from(byId.values()) };
}
// Map of appointment id → the draft mark currently affecting it. When the same
// id is touched by several ops, the last one wins (matches `applyOps`).
export function draftMarks(ops) {
    const marks = new Map();
    for (const op of ops) {
        const id = op.kind === 'add' ? op.appt?.id : op.targetId;
        if (id)
            marks.set(id, op.kind);
    }
    return marks;
}
// The list the calendar renders while a draft is open: the preview's
// appointments (adds/moves/shortens applied) PLUS tombstones for removed
// originals, so a pending removal is visible (struck through) rather than just
// vanishing. Marks tell the renderer how to style each.
export function renderList(base, ops) {
    const marks = draftMarks(ops);
    const preview = applyOps(base, ops);
    const appointments = [...preview.appointments];
    // Re-attach removed originals as tombstones for display.
    for (const [id, mark] of marks) {
        if (mark !== 'remove')
            continue;
        const original = base.appointments.find(a => a.id === id);
        if (original && !appointments.some(a => a.id === id))
            appointments.push(original);
    }
    return { appointments, marks };
}
//# sourceMappingURL=draft.js.map