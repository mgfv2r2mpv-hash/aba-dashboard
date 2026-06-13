import { BACB_RBT_SUPERVISION_MIN_PERCENT } from './types';
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
//   - Supervision appointments carry CLIENT only — no technician field.
//   - Who is being supervised is inferred from whichever direct
//     (client-session) appointments for that client overlap the
//     supervision's time window.
//   - "BCBA solo with the client" = supervision with no overlapping direct
//     for that client. Consumes BCBA hours; counts as 0 toward compliance.
//
// Per-client (case) compliance — implemented here:
//   denominator = direct hours for the client in period
//   numerator   = sum of supervision-vs-direct overlap hours for that
//                 client, capped at each supervision's own duration so
//                 multiple overlapping directs can't double-count.
//
// Per-RBT (BACB 5%) compliance — DEFERRED, but the rule is locked in:
//   denominator = ALL of that RBT's direct hours in period (any client)
//   numerator   = supervision time overlapping any of THIS RBT's direct
//                 sessions (the supervision's tagged client may differ
//                 from the direct's client; that's a data-quality
//                 question we'll surface separately when we add this).
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
        if (a.status === 'canceled')
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
    const direct = data.appointments.filter(a => matches(a) && a.type === 'client-session' && inPeriod(a) && inScope(a));
    const supervision = data.appointments.filter(a => matches(a) && a.type === 'supervision' && inPeriod(a) && inScope(a));
    const directHours = direct.reduce((s, a) => s + duration(a), 0);
    // For each supervision tagged with this client, sum overlap with this
    // client's directs. Cap at the supervision's own length. If the
    // supervision overlaps no directs (BCBA solo with client), it contributes
    // nothing — which falls out of the math without an explicit guard since
    // ov === 0 in that case.
    const supervisionHours = supervision.reduce((s, sup) => {
        const supDur = duration(sup);
        const ov = direct.reduce((acc, d) => acc + overlapHours(sup, d), 0);
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
        if (a.status === 'canceled')
            return false;
        if (scope === 'projected')
            return true;
        return new Date(a.startTime).getTime() <= now.getTime();
    };
    const inPeriod = (a) => {
        const t = new Date(a.startTime).getTime();
        return t >= startMs && t < endMs;
    };
    const matchesTech = (a) => a.technician === tech.id || a.technician === tech.name;
    const direct = data.appointments.filter(a => matchesTech(a) && a.type === 'client-session' && inPeriod(a) && inScope(a));
    const supervisions = data.appointments.filter(a => a.type === 'supervision' && inPeriod(a) && inScope(a));
    const directHours = direct.reduce((s, a) => s + duration(a), 0);
    const supervisionHours = supervisions.reduce((s, sup) => {
        const supDur = duration(sup);
        const ov = direct.reduce((acc, d) => acc + overlapHours(sup, d), 0);
        return s + Math.min(ov, supDur);
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
        if (a.status === 'canceled')
            return false;
        if (scope === 'projected')
            return true;
        return new Date(a.startTime).getTime() <= now.getTime();
    };
    const inPeriod = (a) => {
        const t = new Date(a.startTime).getTime();
        return t >= startMs && t < endMs;
    };
    const matchesTech = (a) => a.technician === tech.id || a.technician === tech.name;
    const direct = data.appointments.filter(a => matchesTech(a) && a.type === 'client-session' && inPeriod(a) && inScope(a));
    const supervisions = data.appointments.filter(a => a.type === 'supervision' && inPeriod(a) && inScope(a));
    const days = new Set();
    for (const sup of supervisions) {
        if (direct.some(d => overlapHours(sup, d) > 0)) {
            days.add(sup.startTime.slice(0, 10));
        }
    }
    return days.size;
}
// Past-dated, non-canceled, not-yet-completed appointments. Surfaced in the
// dashboard so the BCBA can finalize them into the actual roll.
export function pastIncompleteAppointments(data, now = new Date()) {
    const nowMs = now.getTime();
    return data.appointments
        .filter(a => a.status !== 'canceled' &&
        a.status !== 'completed' &&
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