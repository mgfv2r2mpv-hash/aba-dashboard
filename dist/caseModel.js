import { SUPERVISION_CADENCES, BACB_RBT_SUPERVISION_MIN_PERCENT, countsAsSupervision, } from './types';
import { monthPeriod, computeClientCompliance, computeTechCompliance, computeTechContactDays, } from './compliance';
import { computeReportDates, findAuthFor, inAuthSpan } from './authorization';
// The Sunday-based calendar week containing `ref` (matches the validator's
// weekly parent-training period boundary).
export function weekRange(ref) {
    const start = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() - ref.getDay());
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { start, end, label: `Week of ${toYMD(start)}` };
}
function toYMD(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function durationHours(a) {
    const ms = new Date(a.endTime).getTime() - new Date(a.startTime).getTime();
    return ms > 0 ? ms / 3600000 : 0;
}
function matchesClient(a, client) {
    return a.client === client.id || a.client === client.name;
}
function inRange(a, start, end) {
    const t = new Date(a.startTime).getTime();
    return t >= start.getTime() && t < end.getTime();
}
// Days from `now` to a YYYY-MM-DD deadline (negative = past). Whole days.
function daysUntil(dateStr, now) {
    if (!dateStr)
        return undefined;
    const end = new Date(`${dateStr}T23:59:59`);
    return Math.floor((end.getTime() - now.getTime()) / 86400000);
}
function expectedContactsForCadence(cadence) {
    if (!cadence)
        return undefined;
    return SUPERVISION_CADENCES.find(c => c.value === cadence)?.contactsPerMonth;
}
export function computeCaseState(data, client, now = new Date()) {
    const period = monthPeriod(now);
    const wk = weekRange(now);
    const settings = data.settings;
    // Auth covering "now" for this case (soonest-ending wins — that's the cliff).
    const auth = findAuthFor(data, client.id, toYMD(now))
        || (data.authorizations || []).find(a => a.clientId === client.id);
    const weekly = auth?.weekly || {};
    // ---- Direct (weekly 75% staffing) ----
    const directThisWk = data.appointments.filter(a => a.type === 'client-session' && a.status !== 'canceled' && matchesClient(a, client) && inRange(a, wk.start, wk.end));
    const actualThisWk = directThisWk.reduce((s, a) => s + durationHours(a), 0);
    const idealPerWk = actualThisWk; // schedulable max from this week's planned blocks
    const authDirectPerWk = weekly.direct ?? 0;
    const direct = {
        authPerWk: authDirectPerWk,
        idealPerWk,
        actualThisWk,
        pctOfAuth: authDirectPerWk > 0 ? (actualThisWk / authDirectPerWk) * 100 : 0,
        belowTarget: authDirectPerWk > 0 && actualThisWk < ((client.directUtilizationTarget ?? 75) / 100) * authDirectPerWk,
        get below75() { return this.belowTarget; },
    };
    // ---- Supervision (monthly %, floor/preferred/cap) ----
    const cc = computeClientCompliance(data, period, now).find(c => c.client.id === client.id);
    const directHoursMonth = cc?.projected.directHours ?? 0;
    const supHoursMonth = cc?.projected.supervisionHours ?? 0;
    const floorPct = settings.supervisionFloorPercent ?? 10;
    const preferredMinPct = settings.supervisionPreferredMinPercent ?? 15;
    const preferredMaxPct = settings.supervisionPreferredMaxPercent ?? settings.supervisionMaxHoursPercent ?? 20;
    const floorH = (directHoursMonth * floorPct) / 100;
    const preferredH = (directHoursMonth * preferredMinPct) / 100;
    const capH = (directHoursMonth * preferredMaxPct) / 100;
    const contactsThisMonth = countCaseContacts(data, client, period);
    const supervision = {
        directHoursMonth,
        supHoursMonth,
        pct: directHoursMonth > 0 ? (supHoursMonth / directHoursMonth) * 100 : 0,
        floorPct, preferredMinPct, preferredMaxPct,
        floorH, preferredH, capH,
        gapToFloor: Math.max(0, floorH - supHoursMonth),
        slackAboveFloor: Math.max(0, supHoursMonth - floorH),
        slackToCap: Math.max(0, capH - supHoursMonth),
        overCap: capH > 0 && supHoursMonth > capH + 0.01,
        cadenceGoal: client.cadenceGoal,
        contactsThisMonth,
        contactsRequiredByCadence: expectedContactsForCadence(client.cadenceGoal),
    };
    // ---- Parent training (monthly goal) ----
    const ptDeliveredMonth = data.appointments.filter(a => a.type === 'parent-training' && a.status !== 'canceled' && matchesClient(a, client) && inRange(a, period.start, period.end)).reduce((s, a) => s + durationHours(a), 0);
    const ptTarget = client.parentTrainingMaxHours !== undefined
        ? client.parentTrainingMaxHours
        : (settings.parentTraining?.targetMinHours ?? 0);
    const parentTraining = {
        authPerWk: weekly.parentTraining ?? 0,
        deliveredMonth: ptDeliveredMonth,
        goalMonth: ptTarget,
        gap: Math.max(0, ptTarget - ptDeliveredMonth),
        parentOutsideOk: client.parentAvailableOutsideSessions === true,
    };
    // ---- Reassessment block + report pacing ----
    const reassessment = computeReassessment(data, client, auth, settings, now);
    // ---- Cliffs ----
    const monthEndDate = new Date(period.end.getTime() - 1);
    const monthEnd = toYMD(monthEndDate);
    const daysToMonthEnd = Math.floor((period.end.getTime() - now.getTime()) / 86400000);
    const daysToServiceEnd = daysUntil(auth?.endDate, now);
    const binding = daysToServiceEnd !== undefined && daysToServiceEnd < daysToMonthEnd ? 'service-end' : 'month-end';
    return {
        client,
        auth,
        monthLabel: period.label,
        weekLabel: wk.label,
        direct,
        supervision,
        parentTraining,
        casePlanningAuthPerWk: weekly.casePlanning ?? 0,
        reassessment,
        cliffs: { serviceEnd: auth?.endDate, monthEnd, daysToServiceEnd, daysToMonthEnd, binding },
    };
}
function computeReassessment(data, client, auth, settings, now) {
    const blockH = auth?.buckets.reassessment ?? 0;
    let usedH = 0;
    if (auth) {
        usedH = data.appointments.filter(a => a.type === 'reassessment' && a.status !== 'canceled' && matchesClient(a, client) &&
            inAuthSpan(a.startTime.slice(0, 10), auth)).reduce((s, a) => s + durationHours(a), 0);
        usedH += (data.manualUsage || []).filter(m => m.clientId === auth.clientId && m.bucket === 'reassessment' && inAuthSpan(m.date, auth)).reduce((s, m) => s + m.hours, 0);
    }
    // Both report milestones are internal, computed back from the auth end date
    // using company policy (initial draft earlier than final draft).
    let initialDraftDue;
    let finalDraftDue;
    if (auth) {
        const dates = computeReportDates(auth, settings);
        initialDraftDue = dates.initialDraftDue;
        finalDraftDue = dates.finalDraftDue;
    }
    const daysToInternalDue = daysUntil(initialDraftDue, now);
    // Behind pace when there's an authorized block not fully delivered and the
    // earliest internal milestone is within ~3 weeks (or already passed).
    const paceOk = !(blockH > 0 && usedH < blockH - 0.01 && daysToInternalDue !== undefined && daysToInternalDue <= 21);
    return {
        blockH, usedH,
        initialDraftDue, finalDraftDue,
        daysToInternalDue, paceOk,
    };
}
// Distinct calendar days this month where a supervision-counting session tagged
// with this case overlaps the NAMED BT's direct session for the same case.
function countCaseContacts(data, client, period) {
    const directs = data.appointments.filter(a => a.type === 'client-session' && a.status !== 'canceled' && matchesClient(a, client) && inRange(a, period.start, period.end));
    const sups = data.appointments.filter(a => countsAsSupervision(a) && a.status !== 'canceled' && matchesClient(a, client) && inRange(a, period.start, period.end));
    const days = new Set();
    for (const sup of sups) {
        const ss = new Date(sup.startTime).getTime();
        const se = new Date(sup.endTime).getTime();
        if (directs.some(d => {
            // Supervision (no BT named) infers from any of this case's directs; a
            // parent-training / case-planning counts only against its named BT's direct.
            if (sup.technician && d.technician !== sup.technician)
                return false;
            const ds = new Date(d.startTime).getTime();
            const de = new Date(d.endTime).getTime();
            return Math.min(se, de) > Math.max(ss, ds);
        })) {
            days.add(sup.startTime.slice(0, 10));
        }
    }
    return days.size;
}
export function computeBtState(data, tech, now = new Date()) {
    const period = monthPeriod(now);
    const wk = weekRange(now);
    const tc = computeTechCompliance(data, period, now).find(t => t.tech.id === tech.id);
    const directHoursMonth = tc?.projected.directHours ?? 0;
    const supHoursMonth = tc?.projected.supervisionHours ?? 0;
    const floorPct = data.settings.supervisionFloorPercent ?? 10;
    const requiredPct = tech.isRBT
        ? Math.max(BACB_RBT_SUPERVISION_MIN_PERCENT, tc?.projected.companyRequiredPct ?? floorPct)
        : (tc?.projected.companyRequiredPct ?? 0);
    const requiredH = (directHoursMonth * requiredPct) / 100;
    const directHoursWeek = data.appointments.filter(a => a.type === 'client-session' && a.status !== 'canceled' &&
        (a.technician === tech.id || a.technician === tech.name) && inRange(a, wk.start, wk.end)).reduce((s, a) => s + durationHours(a), 0);
    return {
        tech,
        directHoursMonth, supHoursMonth,
        pct: directHoursMonth > 0 ? (supHoursMonth / directHoursMonth) * 100 : 0,
        requiredPct,
        gapToRequired: Math.max(0, requiredH - supHoursMonth),
        contactsThisMonth: computeTechContactDays(data, tech, period, 'projected', now),
        contactsRequired: tech.isRBT ? (data.settings.rbtMinContactsPerMonth ?? 2) : 0,
        directHoursWeek,
    };
}
//# sourceMappingURL=caseModel.js.map