import { monthPeriod } from './compliance';
import { computeCaseState, computeBtState, weekRange, } from './caseModel';
const fmt = (n) => (Math.round(n * 10) / 10).toString();
export function analyzeCorrections(data, now = new Date()) {
    const period = monthPeriod(now);
    const needs = [];
    for (const client of data.clients) {
        const cs = computeCaseState(data, client, now);
        if (cs.supervision.directHoursMonth === 0 && cs.direct.actualThisWk === 0)
            continue;
        needs.push(...caseNeeds(data, cs, now));
    }
    for (const tech of data.technicians) {
        const bt = computeBtState(data, tech, now);
        if (bt.directHoursMonth === 0)
            continue;
        needs.push(...techNeeds(bt));
    }
    needs.sort((a, b) => a.priority - b.priority ||
        Number(b.hard) - Number(a.hard) ||
        (b.deficitHours ?? 0) - (a.deficitHours ?? 0));
    return { monthLabel: period.label, needs, shaveRoom: computeShaveRoom(data, now) };
}
function caseNeeds(data, cs, now) {
    const out = [];
    const base = {
        clientId: cs.client.id,
        subject: cs.client.name,
        bindingDeadline: cs.cliffs.monthEnd,
        bindingCliff: 'month-end',
    };
    // P1 — supervision floor (monthly, hard at month cliff)
    if (cs.supervision.gapToFloor > 0.01) {
        out.push({
            ...base, priority: 1, kind: 'supervision-floor', hard: true,
            deficitHours: cs.supervision.gapToFloor,
            detail: `${cs.client.name}: supervision ${fmt(cs.supervision.gapToFloor)}h below the ${cs.supervision.floorPct}% floor for ${cs.monthLabel}`,
        });
    }
    // P2 — weekly direct under-delivered: make up before the service cliff
    if (cs.direct.below75) {
        const deficit = Math.max(0, cs.direct.authPerWk - cs.direct.actualThisWk);
        const cause = caseCancelCause(data, cs.client, now);
        out.push({
            priority: 3, kind: 'staffing-75', hard: false,
            clientId: cs.client.id, subject: cs.client.name,
            deficitHours: deficit,
            bindingDeadline: cs.cliffs.serviceEnd || cs.cliffs.monthEnd,
            bindingCliff: cs.cliffs.serviceEnd ? 'service-end' : 'month-end',
            detail: `${cs.client.name}: direct ${fmt(cs.direct.actualThisWk)}h vs authorized ${fmt(cs.direct.authPerWk)}h/wk (${Math.round(cs.direct.pctOfAuth)}%, below 75%)`,
            cause,
            note: cause === 'bt-cancels'
                ? 'shortfall traced to BT cancellations — weekend make-ups may be proposed (flag in conversation)'
                : undefined,
        });
    }
    // P2 — reassessment pacing
    if (!cs.reassessment.paceOk) {
        out.push({
            priority: 2, kind: 'reassessment-pace', hard: false,
            clientId: cs.client.id, subject: cs.client.name,
            deficitHours: Math.max(0, cs.reassessment.blockH - cs.reassessment.usedH),
            bindingDeadline: cs.reassessment.internalClinicalDirectorDue || cs.reassessment.reportDraftDue,
            bindingCliff: 'service-end',
            detail: `${cs.client.name}: reassessment ${fmt(cs.reassessment.usedH)}/${fmt(cs.reassessment.blockH)}h done; internal due ${cs.reassessment.internalClinicalDirectorDue || cs.reassessment.reportDraftDue || '?'} (${cs.reassessment.daysToInternalDue ?? '?'} days)`,
        });
    }
    // P3 — preferred supervision band
    if (cs.supervision.gapToFloor <= 0.01 && cs.supervision.supHoursMonth + 0.01 < cs.supervision.preferredH) {
        out.push({
            ...base, priority: 3, kind: 'supervision-preferred', hard: false,
            deficitHours: cs.supervision.preferredH - cs.supervision.supHoursMonth,
            detail: `${cs.client.name}: supervision ${fmt(cs.supervision.pct)}% — below preferred ${cs.supervision.preferredMinPct}–${cs.supervision.preferredMaxPct}%`,
        });
    }
    // P3 — cadence pacing
    if (cs.supervision.contactsRequiredByCadence !== undefined &&
        cs.supervision.contactsThisMonth < cs.supervision.contactsRequiredByCadence) {
        out.push({
            ...base, priority: 3, kind: 'cadence', hard: false,
            detail: `${cs.client.name}: ${cs.supervision.contactsThisMonth} supervision contact(s) vs ${cs.supervision.cadenceGoal} pacing goal (${cs.supervision.contactsRequiredByCadence})`,
        });
    }
    // P3 — parent-training monthly goal
    if (cs.parentTraining.gap > 0.01) {
        out.push({
            ...base, priority: 3, kind: 'parent-training', hard: false,
            deficitHours: cs.parentTraining.gap,
            detail: `${cs.client.name}: parent training ${fmt(cs.parentTraining.deliveredMonth)}/${fmt(cs.parentTraining.goalMonth)}h this month${cs.parentTraining.parentOutsideOk ? '' : ' (parent only available during sessions)'}`,
        });
    }
    return out;
}
function techNeeds(bt) {
    const out = [];
    if (bt.gapToRequired > 0.01) {
        out.push({
            priority: 1, kind: 'bt-supervision-floor', hard: true,
            techId: bt.tech.id, subject: bt.tech.name,
            deficitHours: bt.gapToRequired, bindingCliff: 'month-end',
            detail: `${bt.tech.name}${bt.tech.isRBT ? ' (RBT)' : ''}: supervision ${fmt(bt.gapToRequired)}h below the required ${bt.requiredPct}%`,
        });
    }
    if (bt.contactsRequired > 0 && bt.contactsThisMonth < bt.contactsRequired) {
        out.push({
            priority: 1, kind: 'bacb-contacts', hard: true,
            techId: bt.tech.id, subject: bt.tech.name,
            deficitHours: bt.contactsRequired - bt.contactsThisMonth, bindingCliff: 'month-end',
            detail: `${bt.tech.name} (RBT): ${bt.contactsThisMonth} observed contact day(s) vs BACB minimum ${bt.contactsRequired}`,
        });
    }
    return out;
}
// Did this case's recent direct shortfall trace to BT-sourced cancellations?
function caseCancelCause(data, client, now) {
    const wk = weekRange(now);
    const btCanceled = data.appointments.some(a => a.type === 'client-session' && a.status === 'canceled' &&
        a.cancellation?.source === 'bt' &&
        (a.client === client.id || a.client === client.name) &&
        new Date(a.startTime).getTime() >= wk.start.getTime() &&
        new Date(a.startTime).getTime() < wk.end.getTime());
    return btCanceled ? 'bt-cancels' : undefined;
}
// Room to trim each supervision session before a floor/contact would break.
// A conservative, per-session estimate using the case it's tagged to.
function computeShaveRoom(data, now) {
    const period = monthPeriod(now);
    const caseStates = new Map();
    for (const c of data.clients)
        caseStates.set(c.id, computeCaseState(data, c, now));
    return data.appointments
        .filter(a => a.type === 'supervision' && a.status !== 'canceled' && !a.isGhost &&
        new Date(a.startTime).getTime() >= period.start.getTime() &&
        new Date(a.startTime).getTime() < period.end.getTime())
        .map(sup => {
        const client = data.clients.find(c => c.id === sup.client || c.name === sup.client);
        const cs = client ? caseStates.get(client.id) : undefined;
        const slackH = cs ? cs.supervision.slackAboveFloor : 0;
        const supDur = (new Date(sup.endTime).getTime() - new Date(sup.startTime).getTime()) / 3600000;
        // Can't shave more than the session length, nor past the case floor.
        const shaveH = Math.max(0, Math.min(slackH, supDur));
        return {
            appointmentId: sup.id,
            clientId: client?.id,
            shaveMinutes: Math.round(shaveH * 60),
            limitedBy: (shaveH <= 0.01 ? 'case-floor' : 'none'),
        };
    });
}
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export function findOpenSlots(data, q, limit = 8) {
    const from = q.fromDate || new Date();
    const period = monthPeriod(from);
    // Hard month boundary unless a later deadline is explicitly given AND still
    // capped by the auth (the caller passes serviceEnd for auth make-ups).
    const monthEnd = new Date(period.end.getTime() - 1);
    const deadline = q.throughDate ? new Date(`${q.throughDate}T23:59:59`) : monthEnd;
    const last = deadline.getTime() < monthEnd.getTime() ? deadline : monthEnd;
    const client = q.clientId ? data.clients.find(c => c.id === q.clientId) : undefined;
    const tech = q.techId ? data.technicians.find(t => t.id === q.techId) : undefined;
    const out = [];
    const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    while (cursor.getTime() <= last.getTime() && out.length < limit) {
        const dow = cursor.getDay();
        const day = DAY_NAMES[dow];
        const dateStr = ymd(cursor);
        const isWeekend = dow === 0 || dow === 6;
        if ((!isWeekend || q.weekendsOk) && !blackedOut(data, dateStr, client, tech)) {
            const windows = intersectAvailability(data, day, client, tech, q.useClinicianAvailability);
            // When PT must coincide with a direct session, the client's own directs
            // are NOT treated as busy — parent-training is allowed to run alongside
            // them (the parent is present). Other appointments still block.
            const busy = busyIntervals(data, dateStr, client, tech, q.mustOverlapDirect === true);
            const directIntervals = q.mustOverlapDirect ? directIntervalsFor(data, dateStr, client) : null;
            for (const w of windows) {
                // PT-coincides mode: anchor candidates to the direct sessions so the
                // slot actually overlaps one. Otherwise fill the earliest free gaps.
                const slots = directIntervals
                    ? anchoredSlots(w, busy, directIntervals, q.durationMinutes)
                    : carveSlots(w, busy, q.durationMinutes);
                for (const slot of slots) {
                    out.push({ date: dateStr, day, start: minToTime(slot.start), end: minToTime(slot.end) });
                    if (out.length >= limit)
                        break;
                }
                if (out.length >= limit)
                    break;
            }
        }
        cursor.setDate(cursor.getDate() + 1);
    }
    return out;
}
function intersectAvailability(data, day, client, tech, useClinician) {
    let acc = null;
    const merge = (windows) => {
        const ivs = (windows || []).map(w => ({ start: toMin(w.start), end: toMin(w.end) })).filter(i => i.end > i.start);
        acc = acc === null ? ivs : intersect(acc, ivs);
    };
    if (client)
        merge(client.availabilityWindows[day]);
    if (tech)
        merge(tech.availability[day]);
    if (useClinician)
        merge(data.settings.clinicianAvailability?.[day]);
    return acc || [];
}
function intersect(a, b) {
    const out = [];
    for (const x of a)
        for (const y of b) {
            const s = Math.max(x.start, y.start), e = Math.min(x.end, y.end);
            if (e > s)
                out.push({ start: s, end: e });
        }
    return out;
}
function busyIntervals(data, dateStr, client, tech, allowOverlapClientDirect = false) {
    return data.appointments
        .filter(a => a.status !== 'canceled' && !a.isGhost && a.startTime.slice(0, 10) === dateStr && ((client && (a.client === client.id || a.client === client.name)) ||
        (tech && (a.technician === tech.id || a.technician === tech.name))))
        // PT-coincides-with-direct mode: don't let the client's own direct sessions
        // block the slot (they are the slots we want to land on).
        .filter(a => !(allowOverlapClientDirect && a.type === 'client-session' &&
        client && (a.client === client.id || a.client === client.name)))
        .map(a => ({ start: minutesOfDay(a.startTime), end: minutesOfDay(a.endTime) }))
        .sort((x, y) => x.start - y.start);
}
function directIntervalsFor(data, dateStr, client) {
    if (!client)
        return [];
    return data.appointments
        .filter(a => a.type === 'client-session' && a.status !== 'canceled' && !a.isGhost && a.startTime.slice(0, 10) === dateStr &&
        (a.client === client.id || a.client === client.name))
        .map(a => ({ start: minutesOfDay(a.startTime), end: minutesOfDay(a.endTime) }));
}
// Open sub-slots of `window` (minus busy) that fit `durationMinutes`.
function carveSlots(window, busy, durationMinutes) {
    const within = busy.filter(b => b.end > window.start && b.start < window.end)
        .map(b => ({ start: Math.max(b.start, window.start), end: Math.min(b.end, window.end) }))
        .sort((a, b) => a.start - b.start);
    const out = [];
    let pos = window.start;
    for (const b of within) {
        if (b.start - pos >= durationMinutes)
            out.push({ start: pos, end: pos + durationMinutes });
        pos = Math.max(pos, b.end);
    }
    if (window.end - pos >= durationMinutes)
        out.push({ start: pos, end: pos + durationMinutes });
    return out;
}
// Slots that fit `durationMinutes`, lie within `window`, are free of `busy`,
// and overlap at least one of `directs` (for PT that must coincide with a
// direct session). Anchored to each direct's start, clamped into the window.
function anchoredSlots(window, busy, directs, durationMinutes) {
    const out = [];
    for (const d of directs) {
        const start = Math.max(window.start, d.start);
        const slot = { start, end: start + durationMinutes };
        if (slot.end > window.end)
            continue;
        if (!overlaps(slot, d))
            continue;
        if (busy.some(b => overlaps(slot, b)))
            continue;
        out.push(slot);
    }
    return out;
}
function blackedOut(data, dateStr, client, tech) {
    return (data.blackouts || []).some(b => b.date === dateStr && ((client && b.entityType === 'client' && b.entityId === client.id) ||
        (tech && b.entityType === 'technician' && b.entityId === tech.id)));
}
function overlaps(a, b) {
    return Math.min(a.end, b.end) > Math.max(a.start, b.start);
}
// --- small date/time helpers ---
function ymd(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function toMin(hhmm) { const [h, m] = hhmm.split(':').map(Number); return (h || 0) * 60 + (m || 0); }
function minToTime(min) { return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`; }
function minutesOfDay(iso) { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes(); }
//# sourceMappingURL=corrections.js.map