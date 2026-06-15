import { BACB_RBT_SUPERVISION_MIN_PERCENT, countsAsSupervision } from './types';
// Resolve a technician reference (id OR name, as stored on appointments) to a
// stable id so a supervision session and a direct session that name the same BT
// in different forms still match.
function makeTechResolver(data) {
    const byId = new Map(data.technicians.map(t => [t.id, t.id]));
    const byName = new Map(data.technicians.map(t => [t.name, t.id]));
    return (ref) => (ref ? (byId.get(ref) ?? byName.get(ref) ?? ref) : undefined);
}
// Same idea for clients, so a supervision and a direct that reference the same
// client in different forms (id vs name) still match.
function makeClientResolver(data) {
    const byId = new Map(data.clients.map(c => [c.id, c.id]));
    const byName = new Map(data.clients.map(c => [c.name, c.id]));
    return (ref) => (ref ? (byId.get(ref) ?? byName.get(ref) ?? ref) : undefined);
}
// Returns [start, end) for the calendar month containing `ref`.
export function monthPeriod(ref) {
    const start = new Date(ref.getFullYear(), ref.getMonth(), 1);
    const end = new Date(ref.getFullYear(), ref.getMonth() + 1, 1);
    const label = start.toLocaleString(undefined, { month: 'long', year: 'numeric' });
    return { start, end, label };
}
// Per-client supervision compliance, computed two ways per the QA spec:
//   actual    = sessions whose startTime <= now and !canceled (presumed happened)
//   projected = actual + future scheduled sessions (everything !canceled)
//
// Data model (BCBA-confirmed):
//   - Supervision-counting sessions are supervision, parent-training, and
//     case-planning (coordination). Each NAMES the BT being observed in its
//     technician field (the supervisee — these stay BCBA billable). Other types
//     never count toward supervision.
//   - A session only earns supervision credit when it names a BT AND that BT's
//     direct (client-session) overlaps it in time. Credit = the overlapping
//     hours (partial overlap → partial credit; e.g. the BT leaves and parent
//     training continues). No BT named, or no overlap → 0 credit.
//
// Per-client (case) compliance — implemented here:
//   denominator = direct hours for the client in period
//   numerator   = for each supervision-counting session tagged with this client,
//                 its overlap with the NAMED BT's directs FOR THIS CLIENT, capped
//                 at the session's own duration.
//
// Per-RBT compliance:
//   denominator = ALL of that RBT's direct hours in period (any client)
//   numerator   = overlap of the sessions that name THIS RBT with that RBT's
//                 own direct sessions.
export function computeClientCompliance(data, period, now = new Date()) {
    return data.clients.map(client => computeOneClientCompliance(data, client, period, now));
}
// Single-client compliance — the unit the incremental cache recomputes when an
// appointment touching this client changes. `computeClientCompliance` is just a
// map over this, so the two can never drift.
export function computeOneClientCompliance(data, client, period, now = new Date()) {
    return {
        client,
        actual: computeMetrics(data, client, period, 'actual', now),
        projected: computeMetrics(data, client, period, 'projected', now),
    };
}
function computeMetrics(data, client, period, scope, now) {
    const targetPct = data.settings.supervisionDirectHoursPercent || 5;
    const startMs = period.start.getTime();
    const endMs = period.end.getTime();
    const inScope = (a) => {
        if (a.status === 'canceled' || a.isGhost)
            return false;
        if (scope === 'projected')
            return true;
        return new Date(a.startTime).getTime() <= now.getTime();
    };
    const inPeriod = (a) => {
        const t = new Date(a.startTime).getTime();
        return t >= startMs && t < endMs;
    };
    const matches = (a) => a.client === client.id || a.client === client.name;
    const resolveTech = makeTechResolver(data);
    const direct = data.appointments.filter(a => matches(a) && a.type === 'client-session' && inPeriod(a) && inScope(a));
    const supervision = data.appointments.filter(a => matches(a) && countsAsSupervision(a) && inPeriod(a) && inScope(a));
    const directHours = direct.reduce((s, a) => s + duration(a), 0);
    // For each supervision-counting session tagged with this client, credit its
    // overlap with this client's directs, capped at the session's own length.
    // A supervision (no BT named) is inferred — overlap with ANY of the client's
    // directs. A parent-training / case-planning NAMES the BT, so only that BT's
    // directs count. No qualifying overlap → 0.
    const supervisionHours = supervision.reduce((s, sup) => {
        const supDur = duration(sup);
        const supTech = resolveTech(sup.technician);
        const ov = direct.reduce((acc, d) => acc + ((supTech === undefined || resolveTech(d.technician) === supTech) ? overlapHours(sup, d) : 0), 0);
        return s + Math.min(ov, supDur);
    }, 0);
    const requiredHours = (directHours * targetPct) / 100;
    const pct = directHours > 0 ? (supervisionHours / directHours) * 100 : 0;
    const hoursToGo = Math.max(0, requiredHours - supervisionHours);
    return { directHours, supervisionHours, requiredHours, pct, hoursToGo };
}
// Per-tech supervision compliance.
//
// Denominator: ALL of this tech's direct hours in the period (any client).
// Numerator:   sum of supervision-vs-direct overlap hours where the direct
//              is delivered by THIS tech. The supervision's tagged client
//              and the tech's session client should typically match (BCBA
//              physically observing the tech-with-client) but we don't gate
//              on that — overlap is what determines presence.
//
// Two thresholds for RBTs (BACB hard 5% + company target). One for non-RBT
// techs (company target only). Cards fail if any applicable threshold misses.
export function computeTechCompliance(data, period, now = new Date()) {
    return data.technicians.map(tech => computeOneTechCompliance(data, tech, period, now));
}
// Single-technician compliance — the per-entity unit the incremental cache
// recomputes. `computeTechCompliance` maps over this.
export function computeOneTechCompliance(data, tech, period, now = new Date()) {
    return {
        tech,
        actual: computeTechMetrics(data, tech, period, 'actual', now),
        projected: computeTechMetrics(data, tech, period, 'projected', now),
    };
}
function computeTechMetrics(data, tech, period, scope, now) {
    const startMs = period.start.getTime();
    const endMs = period.end.getTime();
    const inScope = (a) => {
        if (a.status === 'canceled' || a.isGhost)
            return false;
        if (scope === 'projected')
            return true;
        return new Date(a.startTime).getTime() <= now.getTime();
    };
    const inPeriod = (a) => {
        const t = new Date(a.startTime).getTime();
        return t >= startMs && t < endMs;
    };
    const resolveTech = makeTechResolver(data);
    const resolveClient = makeClientResolver(data);
    const techId = tech.id;
    const direct = data.appointments.filter(a => resolveTech(a.technician) === techId && a.type === 'client-session' && inPeriod(a) && inScope(a));
    const candidates = data.appointments.filter(a => countsAsSupervision(a) && inPeriod(a) && inScope(a));
    const directHours = direct.reduce((s, a) => s + duration(a), 0);
    // Credit this tech for: a supervision (no BT named) that overlaps one of THIS
    // tech's directs for the supervision's client (inferred observee); or a session
    // that explicitly NAMES this tech, overlapping any of this tech's directs.
    const supervisionHours = candidates.reduce((s, sup) => {
        const supTech = resolveTech(sup.technician);
        let ov = 0;
        if (supTech === undefined) {
            const supClient = resolveClient(sup.client);
            ov = direct.reduce((acc, d) => acc + (resolveClient(d.client) === supClient ? overlapHours(sup, d) : 0), 0);
        }
        else if (supTech === techId) {
            ov = direct.reduce((acc, d) => acc + overlapHours(sup, d), 0);
        }
        return s + Math.min(ov, duration(sup));
    }, 0);
    const pct = directHours > 0 ? (supervisionHours / directHours) * 100 : 0;
    const companyPct = tech.isRBT
        ? (data.settings.supervisionRBTHoursPercent ?? BACB_RBT_SUPERVISION_MIN_PERCENT)
        : (data.settings.supervisionTechHoursPercent ?? 0);
    const companyRequiredHours = (directHours * companyPct) / 100;
    const companyHoursToGo = Math.max(0, companyRequiredHours - supervisionHours);
    const result = {
        directHours,
        supervisionHours,
        pct,
        companyRequiredPct: companyPct,
        companyRequiredHours,
        companyHoursToGo,
    };
    if (tech.isRBT) {
        const bacbRequired = (directHours * BACB_RBT_SUPERVISION_MIN_PERCENT) / 100;
        result.bacbRequiredHours = bacbRequired;
        result.bacbHoursToGo = Math.max(0, bacbRequired - supervisionHours);
    }
    return result;
}
// BACB cadence: distinct calendar days in the period where a supervision
// appointment overlaps one of this tech's direct sessions. Every counted
// contact is an observed overlap, satisfying the "at least one observation"
// requirement inherently.
export function computeTechContactDays(data, tech, period, scope, now = new Date()) {
    const startMs = period.start.getTime();
    const endMs = period.end.getTime();
    const inScope = (a) => {
        if (a.status === 'canceled' || a.isGhost)
            return false;
        if (scope === 'projected')
            return true;
        return new Date(a.startTime).getTime() <= now.getTime();
    };
    const inPeriod = (a) => {
        const t = new Date(a.startTime).getTime();
        return t >= startMs && t < endMs;
    };
    const resolveTech = makeTechResolver(data);
    const resolveClient = makeClientResolver(data);
    const techId = tech.id;
    const direct = data.appointments.filter(a => resolveTech(a.technician) === techId && a.type === 'client-session' && inPeriod(a) && inScope(a));
    const candidates = data.appointments.filter(a => countsAsSupervision(a) && inPeriod(a) && inScope(a));
    const separateDays = data.settings.contactsMustOccurOnSeparateDays ?? true;
    const days = new Set();
    let count = 0;
    for (const sup of candidates) {
        const supTech = resolveTech(sup.technician);
        const supClient = resolveClient(sup.client);
        const hit = direct.some(d => overlapHours(sup, d) > 0 &&
            (supTech === undefined ? resolveClient(d.client) === supClient : supTech === techId));
        if (hit) {
            if (separateDays)
                days.add(sup.startTime.slice(0, 10));
            else
                count++;
        }
    }
    return separateDays ? days.size : count;
}
// Past-dated, non-canceled, not-yet-completed appointments. Surfaced in the
// dashboard so the BCBA can finalize them into the actual roll.
export function pastIncompleteAppointments(data, now = new Date()) {
    const nowMs = now.getTime();
    return data.appointments
        .filter(a => a.status !== 'canceled' &&
        a.status !== 'completed' &&
        !a.isGhost &&
        new Date(a.startTime).getTime() <= nowMs)
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
}
function duration(a) {
    return (new Date(a.endTime).getTime() - new Date(a.startTime).getTime()) / 3600000;
}
export function overlapHours(a, b) {
    const aS = new Date(a.startTime).getTime();
    const aE = new Date(a.endTime).getTime();
    const bS = new Date(b.startTime).getTime();
    const bE = new Date(b.endTime).getTime();
    const start = Math.max(aS, bS);
    const end = Math.min(aE, bE);
    return Math.max(0, (end - start) / 3600000);
}
//# sourceMappingURL=compliance.js.map