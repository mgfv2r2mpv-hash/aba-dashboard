// A lightweight, human-readable diff between the schedule currently loaded and
// a candidate parsed from a newly-picked Excel file. Used by ImportPreview so
// the user can see what "Replace current data" would actually change before it
// overwrites their working schedule.
function nameDelta(current, next, equal) {
    const curById = new Map(current.map(x => [x.id, x]));
    const nextById = new Map(next.map(x => [x.id, x]));
    const added = [];
    const removed = [];
    const changed = [];
    for (const n of next) {
        const c = curById.get(n.id);
        if (!c)
            added.push(n.name);
        else if (!equal(c, n))
            changed.push(n.name);
    }
    for (const c of current) {
        if (!nextById.has(c.id))
            removed.push(c.name);
    }
    return { added, removed, changed };
}
function clientsEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}
function techsEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}
export function diffSchedule(current, next) {
    return {
        clients: nameDelta(current.clients, next.clients, clientsEqual),
        technicians: nameDelta(current.technicians, next.technicians, techsEqual),
        appointments: {
            current: current.appointments.length,
            next: next.appointments.length,
            delta: next.appointments.length - current.appointments.length,
        },
        settingsChanged: JSON.stringify(current.settings) !== JSON.stringify(next.settings),
    };
}
// Whether the diff carries any change at all (used to soften the warning copy
// when the file is effectively identical to what's loaded).
export function isEmptyDiff(d) {
    const empty = (n) => n.added.length === 0 && n.removed.length === 0 && n.changed.length === 0;
    return empty(d.clients) && empty(d.technicians) && d.appointments.delta === 0 && !d.settingsChanged;
}
//# sourceMappingURL=scheduleDiff.js.map