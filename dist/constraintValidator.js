import { monthPeriod, computeClientCompliance, computeTechCompliance, computeTechContactDays, } from './compliance';
import { computeAuthUsage } from './authorization';
import { computeCaseState } from './caseModel';
export class ConstraintValidator {
    constructor(data, now = new Date()) {
        // Canceled appointments are excluded from every constraint check by
        // shadowing the appointments array at the data-source level. Completed
        // and scheduled appointments are both counted (completed appointments
        // still consume hours that need to have been supervised, etc.).
        this.data = {
            ...data,
            appointments: data.appointments.filter(a => a.status !== 'canceled'),
        };
        this.now = now;
    }
    validateSchedule() {
        const conflicts = [];
        // Supervision-compliance is computed per client in src/compliance.ts and
        // surfaced on the Compliance tab. Removed from the schedule-level validator
        // because the prior implementation matched supervisors to techs by
        // String.includes(name) and never checked time overlap with direct
        // sessions — both fundamentally wrong for BCBA case-supervision rules.
        conflicts.push(...this.validateParentTraining());
        conflicts.push(...this.validateAvailability());
        conflicts.push(...this.validateSupervision());
        conflicts.push(...this.validateAuthorizations());
        conflicts.push(...this.validateCaseModel());
        return conflicts;
    }
    // Weekly-rate + pacing checks layered on the per-case decision model. These
    // are intentionally distinct from validateAuthorizations (span-bucket totals)
    // and validateSupervision (monthly floors): they cover the WEEKLY authorized
    // direct rate (75% staffing, over-authorized = unbillable) and the soft
    // pacing goals (cadence, reassessment-report deadlines). Current month only.
    validateCaseModel() {
        const conflicts = [];
        const fmt = (n) => (Math.round(n * 10) / 10).toString();
        for (const client of this.data.clients) {
            const cs = computeCaseState(this.data, client, this.now);
            if (!cs.auth)
                continue;
            // Over the authorized WEEKLY direct rate is unbillable.
            if (cs.direct.authPerWk > 0 && cs.direct.actualThisWk > cs.direct.authPerWk + 0.01) {
                conflicts.push({
                    type: 'scheduling-impossible',
                    severity: 'warning',
                    message: `${client.name}: ${fmt(cs.direct.actualThisWk)}h direct scheduled this week vs ${fmt(cs.direct.authPerWk)}h authorized/week — overage is unbillable`,
                });
            }
            else if (cs.direct.below75) {
                // 75% staffing is a soft target.
                conflicts.push({
                    type: 'scheduling-impossible',
                    severity: 'info',
                    message: `${client.name}: direct ${fmt(cs.direct.actualThisWk)}h is ${Math.round(cs.direct.pctOfAuth)}% of the ${fmt(cs.direct.authPerWk)}h/wk authorization (below the 75% staffing target)`,
                });
            }
            // Supervision pacing cadence (soft).
            if (cs.supervision.contactsRequiredByCadence !== undefined &&
                cs.supervision.contactsThisMonth < cs.supervision.contactsRequiredByCadence &&
                cs.supervision.directHoursMonth > 0) {
                conflicts.push({
                    type: 'supervision-violation',
                    severity: 'info',
                    message: `${client.name}: ${cs.supervision.contactsThisMonth} supervision contact(s) projected vs the ${cs.supervision.cadenceGoal} pacing goal (${cs.supervision.contactsRequiredByCadence}) for ${cs.monthLabel}`,
                });
            }
            // Reassessment-report pacing (soft → warning when behind a near deadline).
            if (!cs.reassessment.paceOk) {
                const due = cs.reassessment.internalClinicalDirectorDue || cs.reassessment.reportDraftDue;
                conflicts.push({
                    type: 'scheduling-impossible',
                    severity: 'warning',
                    message: `${client.name}: reassessment ${fmt(cs.reassessment.usedH)}/${fmt(cs.reassessment.blockH)}h with internal report due ${due || '?'} (${cs.reassessment.daysToInternalDue ?? '?'} day(s)) — pace the block`,
                });
            }
        }
        return conflicts;
    }
    // Supervision compliance for the viewed month, with urgency that escalates as
    // the month closes out:
    //   - projected (everything scheduled) still short  -> error, always — waiting
    //     can't fix it; sessions must be added.
    //   - actual behind pace but scheduled would cover  -> warning past mid-month,
    //     info before that.
    // RBT cadence: distinct supervision contact-days vs the BACB monthly minimum.
    validateSupervision() {
        const conflicts = [];
        const period = monthPeriod(this.now);
        const elapsed = Math.min(1, Math.max(0, (this.now.getTime() - period.start.getTime()) / (period.end.getTime() - period.start.getTime())));
        const pctOfMonth = Math.round(elapsed * 100);
        const fmt = (n) => (Math.round(n * 10) / 10).toString();
        for (const cc of computeClientCompliance(this.data, period, this.now)) {
            if (cc.projected.directHours === 0 && cc.actual.directHours === 0)
                continue;
            if (cc.projected.hoursToGo > 0.01) {
                conflicts.push({
                    type: 'supervision-violation',
                    severity: 'error',
                    message: `${cc.client.name}: supervision short ${fmt(cc.projected.hoursToGo)}h for ${period.label} even if every scheduled session happens — add supervision overlapping a direct session`,
                });
            }
            else if (cc.actual.hoursToGo > 0.01 && elapsed >= 0.25) {
                conflicts.push({
                    type: 'supervision-violation',
                    severity: elapsed >= 0.5 ? 'warning' : 'info',
                    message: `${cc.client.name}: supervision ${fmt(cc.actual.hoursToGo)}h behind pace with ${pctOfMonth}% of the month gone — scheduled sessions cover it only if they hold`,
                });
            }
        }
        const minContacts = this.data.settings.rbtMinContactsPerMonth ?? 2;
        for (const tc of computeTechCompliance(this.data, period, this.now)) {
            if (tc.projected.directHours === 0 && tc.actual.directHours === 0)
                continue;
            const projGap = Math.max(tc.projected.companyHoursToGo, tc.projected.bacbHoursToGo ?? 0);
            const actGap = Math.max(tc.actual.companyHoursToGo, tc.actual.bacbHoursToGo ?? 0);
            if (projGap > 0.01) {
                conflicts.push({
                    type: 'supervision-violation',
                    severity: 'error',
                    message: `${tc.tech.name}${tc.tech.isRBT ? ' (RBT)' : ''}: supervision short ${fmt(projGap)}h for ${period.label} even with everything scheduled`,
                    affectedTechnicians: [tc.tech.id],
                });
            }
            else if (actGap > 0.01 && elapsed >= 0.25) {
                conflicts.push({
                    type: 'supervision-violation',
                    severity: elapsed >= 0.5 ? 'warning' : 'info',
                    message: `${tc.tech.name}${tc.tech.isRBT ? ' (RBT)' : ''}: supervision ${fmt(actGap)}h behind pace (${pctOfMonth}% of month gone)`,
                    affectedTechnicians: [tc.tech.id],
                });
            }
            // Cadence applies to RBTs only; BTs are month-percentage only.
            if (tc.tech.isRBT) {
                const projContacts = computeTechContactDays(this.data, tc.tech, period, 'projected', this.now);
                if (projContacts < minContacts) {
                    conflicts.push({
                        type: 'supervision-violation',
                        severity: elapsed >= 0.75 ? 'error' : 'warning',
                        message: `${tc.tech.name} (RBT): only ${projContacts} supervision contact day(s) projected for ${period.label}; BACB cadence needs ${minContacts} — spread supervision across separate days`,
                        affectedTechnicians: [tc.tech.id],
                    });
                }
            }
        }
        return conflicts;
    }
    // Authorization health: over-booking a bucket is an error; unused hours with
    // the auth end (makeup cliff) approaching is a warning.
    validateAuthorizations() {
        const conflicts = [];
        const fmt = (n) => (Math.round(n * 10) / 10).toString();
        for (const auth of this.data.authorizations || []) {
            const usage = computeAuthUsage(this.data, auth, this.now);
            if (usage.daysLeft < 0)
                continue; // expired — dead for compliance
            const name = usage.client?.name || auth.clientId;
            const tag = auth.label ? ` (${auth.label})` : '';
            for (const b of usage.buckets) {
                if (b.usage.authorized <= 0)
                    continue;
                if (b.usage.remaining < -0.01) {
                    conflicts.push({
                        type: 'scheduling-impossible',
                        severity: 'error',
                        message: `${name}${tag}: ${b.label} over-authorized — ${fmt(b.usage.projected)}h projected vs ${fmt(b.usage.authorized)}h authorized`,
                    });
                }
                else if (b.usage.remaining > 0.01 && usage.daysLeft <= 21) {
                    conflicts.push({
                        type: 'scheduling-impossible',
                        severity: 'warning',
                        message: `${name}${tag}: ${fmt(b.usage.remaining)}h of ${b.label} unused with ${usage.daysLeft} day(s) until the auth ends ${auth.endDate} — makeup cliff`,
                    });
                }
            }
        }
        return conflicts;
    }
    validateParentTraining() {
        const conflicts = [];
        const pt = this.data.settings.parentTraining;
        if (!pt)
            return conflicts;
        // Only flag the current (calendar-aligned) period. Future-period
        // projections ("light on parent training in 3 months") are noise, not
        // actionable now.
        const periods = [this.currentPeriod(pt.periodUnit)];
        // Per-client validation: minimum/target are company-wide defaults, but the
        // per-case max (Client.parentTrainingMaxHours) overrides them when lower.
        this.data.clients.forEach(client => {
            const caseMax = client.parentTrainingMaxHours;
            // If a case max is set and is below the target floor, the case max becomes
            // the effective minimum too (we don't fault a client for being below target
            // when their cap doesn't allow them to reach it).
            const effectiveMin = caseMax !== undefined && caseMax < pt.minimumHours ? caseMax : pt.minimumHours;
            periods.forEach(period => {
                const hours = this.calculateClientParentTrainingHoursInRange(client, period.start, period.end);
                if (caseMax !== undefined && hours > caseMax) {
                    conflicts.push({
                        type: 'training-violation',
                        severity: 'error',
                        message: `${client.name} in ${period.label} has ${hours.toFixed(1)}h parent training, exceeding the case max of ${caseMax}h per ${pt.periodUnit}`,
                    });
                    return;
                }
                if (hours < effectiveMin) {
                    conflicts.push({
                        type: 'training-violation',
                        severity: 'warning',
                        message: `${client.name} in ${period.label} has ${hours.toFixed(1)}h parent training but requires at least ${effectiveMin}h per ${pt.periodUnit}`,
                    });
                }
            });
        });
        return conflicts;
    }
    // The calendar-aligned period (for the configured unit) that contains today.
    currentPeriod(unit) {
        const n = this.now;
        const y = n.getFullYear();
        const m = n.getMonth();
        if (unit === 'week') {
            const start = new Date(y, m, n.getDate() - n.getDay()); // Sunday 00:00
            const end = new Date(start);
            end.setDate(end.getDate() + 7);
            return { start, end, label: `Week of ${start.toISOString().slice(0, 10)}` };
        }
        if (unit === 'sixMonths') {
            const half = m < 6 ? 0 : 6;
            const start = new Date(y, half, 1);
            const end = new Date(y, half + 6, 1);
            return { start, end, label: `${start.toISOString().slice(0, 7)} (6mo)` };
        }
        if (unit === 'year') {
            return { start: new Date(y, 0, 1), end: new Date(y + 1, 0, 1), label: String(y) };
        }
        // month (default)
        return {
            start: new Date(y, m, 1),
            end: new Date(y, m + 1, 1),
            label: `${y}-${String(m + 1).padStart(2, '0')}`,
        };
    }
    calculateClientParentTrainingHoursInRange(client, start, end) {
        return this.data.appointments
            .filter(a => {
            if (a.type !== 'parent-training')
                return false;
            const t = new Date(a.startTime);
            if (t < start || t >= end)
                return false;
            return a.client === client.id || a.client === client.name;
        })
            .reduce((sum, a) => sum + this.getHoursDuration(a.startTime, a.endTime), 0);
    }
    validateAvailability() {
        const conflicts = [];
        const blackouts = this.data.blackouts || [];
        this.data.appointments.forEach(appointment => {
            const appointmentDate = new Date(appointment.startTime);
            // Only the current calendar month — keeps the Issues panel about now, and
            // stops a year of recurring appointments from flooding it.
            if (appointmentDate.getFullYear() !== this.now.getFullYear() || appointmentDate.getMonth() !== this.now.getMonth())
                return;
            const technician = appointment.technician
                ? this.data.technicians.find(t => t.id === appointment.technician || t.name === appointment.technician)
                : undefined;
            const client = appointment.client
                ? this.data.clients.find(c => c.id === appointment.client || c.name === appointment.client)
                : undefined;
            // Nothing to check against — appointment has no resolvable parties.
            if (!technician && !client)
                return;
            const dayName = this.getDayName(appointmentDate);
            const dateStr = this.toDateString(appointmentDate);
            const [appStart, appEnd] = this.getTimeFromISO(appointment.startTime, appointment.endTime);
            const parties = [];
            const blockingMessages = [];
            const affectedTechnicians = [];
            if (technician) {
                const windows = technician.availability[dayName] || [];
                const blackout = this.findBlackout(blackouts, 'technician', technician.id, dateStr);
                const status = this.partyStatus(windows, appStart, appEnd, blackout);
                parties.push({ role: 'Technician', name: technician.name, status, windows, blackoutReason: blackout?.reason });
                // Techs are expected to have availability defined, so an empty day
                // ('none') is a real conflict for a tech (preserves prior behavior).
                if (status !== 'ok') {
                    affectedTechnicians.push(technician.id);
                    blockingMessages.push(this.partyMessage(technician.name, dayName, status, windows, blackout));
                }
            }
            if (client) {
                const windows = client.availabilityWindows[dayName] || [];
                const blackout = this.findBlackout(blackouts, 'client', client.id, dateStr);
                const status = this.partyStatus(windows, appStart, appEnd, blackout);
                parties.push({ role: 'Client', name: client.name, status, windows, blackoutReason: blackout?.reason });
                // Clients frequently have no availability configured, so we only fault
                // a client when there ARE windows that don't cover the slot, or an
                // explicit blackout — never for an unconfigured day ('none').
                if (status === 'outside' || status === 'blackout') {
                    blockingMessages.push(this.partyMessage(client.name, dayName, status, windows, blackout));
                }
            }
            if (blockingMessages.length === 0)
                return;
            conflicts.push({
                type: 'availability-conflict',
                severity: 'error',
                message: blockingMessages.join('; '),
                affectedAppointments: [appointment.id],
                affectedTechnicians: affectedTechnicians.length ? affectedTechnicians : undefined,
                availabilityDetail: {
                    day: dayName,
                    date: dateStr,
                    start: this.minutesToTime(appStart),
                    end: this.minutesToTime(appEnd),
                    parties,
                },
            });
        });
        return conflicts;
    }
    findBlackout(blackouts, entityType, entityId, dateStr) {
        return blackouts.find(b => b.entityType === entityType && b.entityId === entityId && b.date === dateStr);
    }
    partyStatus(windows, appStart, appEnd, blackout) {
        if (blackout)
            return 'blackout';
        if (!Array.isArray(windows) || windows.length === 0)
            return 'none';
        const covered = windows.some(w => appStart >= this.timeToMinutes(w.start) && appEnd <= this.timeToMinutes(w.end));
        return covered ? 'ok' : 'outside';
    }
    partyMessage(name, day, status, windows, blackout) {
        switch (status) {
            case 'blackout':
                return `${name} is marked away on this day${blackout?.reason ? ` (${blackout.reason})` : ''}`;
            case 'none':
                return `${name} has no availability on ${day}`;
            case 'outside': {
                const ranges = windows.map(w => `${w.start}–${w.end}`).join(', ');
                return `${name} is only available ${ranges} on ${day}`;
            }
            default:
                return `${name} is available`;
        }
    }
    toDateString(date) {
        // Local calendar day (matches how a user picks a date), not UTC.
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    minutesToTime(mins) {
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
    getHoursDuration(startISO, endISO) {
        const start = new Date(startISO);
        const end = new Date(endISO);
        return (end.getTime() - start.getTime()) / (1000 * 60 * 60);
    }
    getTimeFromISO(startISO, endISO) {
        const start = new Date(startISO);
        const end = new Date(endISO);
        return [
            this.timeToMinutes(`${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`),
            this.timeToMinutes(`${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`),
        ];
    }
    timeToMinutes(time) {
        const parts = time.split(':').map(Number);
        const hours = parts[0] || 0;
        const minutes = parts[1] || 0;
        return hours * 60 + minutes;
    }
    getDayName(date) {
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        return days[date.getDay()];
    }
}
//# sourceMappingURL=constraintValidator.js.map