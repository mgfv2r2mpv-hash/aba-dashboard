import {
  ScheduleData,
  ScheduleConflict,
  Appointment,
  Blackout,
  TimeWindow,
  DayOfWeek,
  PartyAvailability,
  PartyAvailabilityStatus,
  TrainingPeriodUnit,
} from './types';
import {
  monthPeriod,
  computeClientCompliance,
  computeTechCompliance,
  computeTechContactDays,
} from './compliance';
import { computeAuthUsage } from './authorization';
import { computeCaseState } from './caseModel';

export class ConstraintValidator {
  private data: ScheduleData;
  private now: Date;

  constructor(data: ScheduleData, now: Date = new Date()) {
    // Canceled appointments (and ghosts — wished-for sessions that were never
    // placed) are excluded from every constraint check by shadowing the
    // appointments array at the data-source level. Completed and scheduled
    // appointments are both counted (completed appointments still consume hours
    // that need to have been supervised, etc.).
    this.data = {
      ...data,
      appointments: data.appointments.filter(a => a.status !== 'canceled' && !a.isGhost),
    };
    this.now = now;
  }

  validateSchedule(): ScheduleConflict[] {
    const conflicts: ScheduleConflict[] = [];

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
  private validateCaseModel(): ScheduleConflict[] {
    const conflicts: ScheduleConflict[] = [];
    const fmt = (n: number) => (Math.round(n * 10) / 10).toString();

    const isUnstaffed = (clientId: string): boolean => {
      const clientName = this.data.clients.find(c => c.id === clientId)?.name;
      return !this.data.technicians.some(t =>
        t.assignments.some(a => a.clientId === clientId || (clientName != null && a.clientId === clientName))
      );
    };

    for (const client of this.data.clients) {
      const cs = computeCaseState(this.data, client, this.now);
      if (!cs.auth) continue;

      // Over the authorized WEEKLY direct rate is unbillable.
      if (cs.direct.authPerWk > 0 && cs.direct.actualThisWk > cs.direct.authPerWk + 0.01) {
        conflicts.push({
          type: 'scheduling-impossible',
          severity: 'warning',
          message: `${client.name}: ${fmt(cs.direct.actualThisWk)}h direct scheduled this week vs ${fmt(cs.direct.authPerWk)}h authorized/week — overage is unbillable`,
        });
      } else if (cs.direct.belowTarget) {
        if (isUnstaffed(client.id)) {
          // Suppress utilization violation; emit a staff issue instead.
          conflicts.push({
            type: 'scheduling-impossible',
            severity: 'info',
            message: `${client.name}: no BT assigned — direct service hours not tracked`,
          });
        } else {
          const targetPct = client.directUtilizationTarget ?? 75;
          conflicts.push({
            type: 'scheduling-impossible',
            severity: 'info',
            message: `${client.name}: direct ${fmt(cs.direct.actualThisWk)}h is ${Math.round(cs.direct.pctOfAuth)}% of the ${fmt(cs.direct.authPerWk)}h/wk authorization (below ${targetPct}% targeted utilization)`,
          });
        }
      }

      // Supervision pacing cadence — critical: falling behind on contact count
      // cannot be recovered by extending existing sessions; new sessions are required.
      if (cs.supervision.contactsRequiredByCadence !== undefined &&
          cs.supervision.contactsThisMonth < cs.supervision.contactsRequiredByCadence &&
          cs.supervision.directHoursMonth > 0) {
        conflicts.push({
          type: 'supervision-violation',
          severity: 'error',
          message: `${client.name}: ${cs.supervision.contactsThisMonth} supervision contact(s) projected vs the ${cs.supervision.cadenceGoal} pacing goal (${cs.supervision.contactsRequiredByCadence}) for ${cs.monthLabel}`,
        });
      }

      // Reassessment-report pacing (soft → warning when behind a near deadline).
      if (!cs.reassessment.paceOk) {
        const due = cs.reassessment.initialDraftDue;
        conflicts.push({
          type: 'scheduling-impossible',
          severity: 'warning',
          message: `${client.name}: reassessment ${fmt(cs.reassessment.usedH)}/${fmt(cs.reassessment.blockH)}h with internal report due ${due || '?'} (${cs.reassessment.daysToInternalDue ?? '?'} day(s)). Pace the block.`,
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
  private validateSupervision(): ScheduleConflict[] {
    const conflicts: ScheduleConflict[] = [];
    const period = monthPeriod(this.now);
    const elapsed = Math.min(1, Math.max(0,
      (this.now.getTime() - period.start.getTime()) / (period.end.getTime() - period.start.getTime())
    ));
    const pctOfMonth = Math.round(elapsed * 100);
    const fmt = (n: number) => (Math.round(n * 10) / 10).toString();

    for (const cc of computeClientCompliance(this.data, period, this.now)) {
      if (cc.projected.directHours === 0 && cc.actual.directHours === 0) continue;
      if (cc.projected.hoursToGo > 0.01) {
        conflicts.push({
          type: 'supervision-violation',
          severity: 'error',
          message: `${cc.client.name}: supervision short ${fmt(cc.projected.hoursToGo)}h for ${period.label} even if every scheduled session happens — add supervision overlapping a direct session`,
        });
      } else if (cc.actual.hoursToGo > 0.01 && elapsed >= 0.25) {
        conflicts.push({
          type: 'supervision-violation',
          severity: elapsed >= 0.5 ? 'warning' : 'info',
          message: `${cc.client.name}: supervision ${fmt(cc.actual.hoursToGo)}h behind pace with ${pctOfMonth}% of the month gone — scheduled sessions cover it only if they hold`,
        });
      }
    }

    const rbtMinContacts = this.data.settings.rbtMinContactsPerMonth ?? 2;
    const btMinContacts = this.data.settings.techMinContactsPerMonth ?? 1;
    const separateDays = this.data.settings.contactsMustOccurOnSeparateDays ?? true;
    const contactLabel = separateDays ? 'contact day(s)' : 'contact(s)';
    for (const tc of computeTechCompliance(this.data, period, this.now)) {
      if (tc.projected.directHours === 0 && tc.actual.directHours === 0) continue;
      const projGap = Math.max(tc.projected.companyHoursToGo, tc.projected.bacbHoursToGo ?? 0);
      const actGap = Math.max(tc.actual.companyHoursToGo, tc.actual.bacbHoursToGo ?? 0);
      if (projGap > 0.01) {
        conflicts.push({
          type: 'supervision-violation',
          severity: 'error',
          message: `${tc.tech.name}${tc.tech.isRBT ? ' (RBT)' : ''}: supervision short ${fmt(projGap)}h for ${period.label} even with everything scheduled`,
          affectedTechnicians: [tc.tech.id],
        });
      } else if (actGap > 0.01 && elapsed >= 0.25) {
        conflicts.push({
          type: 'supervision-violation',
          severity: elapsed >= 0.5 ? 'warning' : 'info',
          message: `${tc.tech.name}${tc.tech.isRBT ? ' (RBT)' : ''}: supervision ${fmt(actGap)}h behind pace (${pctOfMonth}% of month gone)`,
          affectedTechnicians: [tc.tech.id],
        });
      }

      const projContacts = computeTechContactDays(this.data, tc.tech, period, 'projected', this.now);
      if (tc.tech.isRBT) {
        if (projContacts < rbtMinContacts) {
          const spreadNote = separateDays ? ' — spread supervision across separate days' : '';
          conflicts.push({
            type: 'supervision-violation',
            severity: elapsed >= 0.75 ? 'error' : 'warning',
            message: `${tc.tech.name} (RBT): only ${projContacts} supervision ${contactLabel} projected for ${period.label}; BACB cadence needs ${rbtMinContacts}${spreadNote}`,
            affectedTechnicians: [tc.tech.id],
          });
        }
      } else if (tc.projected.directHours > 0 && btMinContacts > 0) {
        if (projContacts < btMinContacts) {
          conflicts.push({
            type: 'supervision-violation',
            severity: 'warning',
            message: `${tc.tech.name}: only ${projContacts} supervision ${contactLabel} projected for ${period.label} — company minimum is ${btMinContacts}`,
            affectedTechnicians: [tc.tech.id],
          });
        }
      }
    }

    return conflicts;
  }

  // Authorization health: over-booking a bucket is an error; unused hours with
  // the auth end (makeup cliff) approaching is a warning.
  private validateAuthorizations(): ScheduleConflict[] {
    const conflicts: ScheduleConflict[] = [];
    const fmt = (n: number) => (Math.round(n * 10) / 10).toString();

    for (const auth of this.data.authorizations || []) {
      const usage = computeAuthUsage(this.data, auth, this.now);
      if (usage.daysLeft < 0) continue; // expired — dead for compliance
      const name = usage.client?.name || auth.clientId;
      const tag = auth.label ? ` (${auth.label})` : '';

      for (const b of usage.buckets) {
        if (b.usage.authorized <= 0) continue;
        if (b.usage.remaining < -0.01) {
          conflicts.push({
            type: 'scheduling-impossible',
            severity: 'error',
            message: `${name}${tag}: ${b.label} over-authorized — ${fmt(b.usage.projected)}h projected vs ${fmt(b.usage.authorized)}h authorized`,
          });
        } else if (b.usage.remaining > 0.01 && usage.daysLeft <= 21) {
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

  private validateParentTraining(): ScheduleConflict[] {
    const conflicts: ScheduleConflict[] = [];
    const pt = this.data.settings.parentTraining;
    if (!pt) return conflicts;

    // Only flag the current (calendar-aligned) period. Future-period
    // projections ("light on parent training in 3 months") are noise, not
    // actionable now.
    const periods = [this.currentPeriod(pt.periodUnit)];

    // Per-client validation: minimum/target are company-wide defaults, but the
    // per-case max (Client.parentTrainingMaxHours) overrides them when lower.
    // Clients with disablePTRequirements are fully exempted.
    this.data.clients.forEach(client => {
      if (client.disablePTRequirements) return;
      const caseMax = client.parentTrainingMaxHours;
      // If a case max is set and is below the target floor, the case max becomes
      // the effective minimum too (we don't fault a client for being below target
      // when their cap doesn't allow them to reach it).
      const effectiveMin =
        caseMax !== undefined && caseMax < pt.minimumHours ? caseMax : pt.minimumHours;

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
  private currentPeriod(unit: TrainingPeriodUnit): { start: Date; end: Date; label: string } {
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

  private calculateClientParentTrainingHoursInRange(
    client: { id: string; name: string },
    start: Date,
    end: Date,
  ): number {
    return this.data.appointments
      .filter(a => {
        if (a.type !== 'parent-training') return false;
        const t = new Date(a.startTime);
        if (t < start || t >= end) return false;
        return a.client === client.id || a.client === client.name;
      })
      .reduce((sum, a) => sum + this.getHoursDuration(a.startTime, a.endTime), 0);
  }

  private validateAvailability(): ScheduleConflict[] {
    const conflicts: ScheduleConflict[] = [];
    const blackouts = this.data.blackouts || [];
    // Company holidays act as a blanket blackout for all entities on that date.
    const holidayByDate = new Map<string, string>(
      (this.data.companyHolidays || []).map(h => [h.date, h.name]),
    );

    this.data.appointments.forEach(appointment => {
      // A completed session already happened — whether or not it fell inside an
      // availability window is moot, so don't surface an availability conflict for it.
      if (appointment.status === 'completed') return;
      const appointmentDate = new Date(appointment.startTime);
      // Only the current calendar month — keeps the Issues panel about now, and
      // stops a year of recurring appointments from flooding it.
      if (appointmentDate.getFullYear() !== this.now.getFullYear() || appointmentDate.getMonth() !== this.now.getMonth()) return;

      const technician = appointment.technician
        ? this.data.technicians.find(t => t.id === appointment.technician || t.name === appointment.technician)
        : undefined;
      const client = appointment.client
        ? this.data.clients.find(c => c.id === appointment.client || c.name === appointment.client)
        : undefined;

      // Nothing to check against — appointment has no resolvable parties.
      if (!technician && !client) return;

      const dayName = this.getDayName(appointmentDate) as DayOfWeek;
      const dateStr = this.toDateString(appointmentDate);
      const [appStart, appEnd] = this.getTimeFromISO(appointment.startTime, appointment.endTime);

      const parties: PartyAvailability[] = [];
      const blockingMessages: string[] = [];
      const affectedTechnicians: string[] = [];
      let tentativeNote: string | undefined;

      if (technician) {
        const windows: TimeWindow[] = ((technician.availability as any)[dayName] as TimeWindow[]) || [];
        const blackout = this.findBlackout(blackouts, 'technician', technician.id, dateStr)
          ?? this.syntheticHolidayBlackout('technician', technician.id, dateStr, holidayByDate);
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
        const windows: TimeWindow[] = ((client.availabilityWindows as any)[dayName] as TimeWindow[]) || [];
        const blackout = this.findBlackout(blackouts, 'client', client.id, dateStr)
          ?? this.syntheticHolidayBlackout('client', client.id, dateStr, holidayByDate);
        const status = this.partyStatus(windows, appStart, appEnd, blackout);
        parties.push({ role: 'Client', name: client.name, status, windows, blackoutReason: blackout?.reason });
        // Clients frequently have no availability configured, so we only fault
        // a client when there ARE windows that don't cover the slot, or an
        // explicit blackout — never for an unconfigured day ('none'). When the
        // parent can meet outside their scheduled availability, an out-of-window
        // parent-training slot is allowed-but-tentative rather than blocking.
        const ptOutsideOk = appointment.type === 'parent-training'
          && client.parentAvailableOutsideSessions === true
          && status === 'outside';
        if ((status === 'outside' && !ptOutsideOk) || status === 'blackout') {
          blockingMessages.push(this.partyMessage(client.name, dayName, status, windows, blackout));
        } else if (ptOutsideOk) {
          tentativeNote = `${client.name}: parent training ${this.minutesToTime(appStart)}–${this.minutesToTime(appEnd)} is outside set availability on ${dayName} — allowed, pending confirmation`;
        }
      }

      if (blockingMessages.length === 0) {
        if (tentativeNote) {
          conflicts.push({
            type: 'availability-conflict',
            severity: 'warning',
            message: tentativeNote,
            affectedAppointments: [appointment.id],
            availabilityDetail: {
              day: dayName,
              date: dateStr,
              start: this.minutesToTime(appStart),
              end: this.minutesToTime(appEnd),
              parties,
            },
          });
        }
        return;
      }

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

  private findBlackout(
    blackouts: Blackout[],
    entityType: 'technician' | 'client',
    entityId: string,
    dateStr: string,
  ): Blackout | undefined {
    return blackouts.find(b => b.entityType === entityType && b.entityId === entityId && b.date === dateStr);
  }

  private syntheticHolidayBlackout(
    entityType: 'technician' | 'client',
    entityId: string,
    dateStr: string,
    holidayByDate: Map<string, string>,
  ): Blackout | undefined {
    const name = holidayByDate.get(dateStr);
    if (!name) return undefined;
    return { id: '_holiday', entityType, entityId, date: dateStr, reason: name };
  }

  private partyStatus(
    windows: TimeWindow[],
    appStart: number,
    appEnd: number,
    blackout: Blackout | undefined,
  ): PartyAvailabilityStatus {
    if (blackout) return 'blackout';
    if (!Array.isArray(windows) || windows.length === 0) return 'none';
    const covered = windows.some(w => appStart >= this.timeToMinutes(w.start) && appEnd <= this.timeToMinutes(w.end));
    return covered ? 'ok' : 'outside';
  }

  private partyMessage(
    name: string,
    day: DayOfWeek,
    status: PartyAvailabilityStatus,
    windows: TimeWindow[],
    blackout: Blackout | undefined,
  ): string {
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

  private toDateString(date: Date): string {
    // Local calendar day (matches how a user picks a date), not UTC.
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private minutesToTime(mins: number): string {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  private getHoursDuration(startISO: string, endISO: string): number {
    const start = new Date(startISO);
    const end = new Date(endISO);
    return (end.getTime() - start.getTime()) / (1000 * 60 * 60);
  }

  private getTimeFromISO(startISO: string, endISO: string): [number, number] {
    const start = new Date(startISO);
    const end = new Date(endISO);
    return [
      this.timeToMinutes(`${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`),
      this.timeToMinutes(`${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`),
    ];
  }

  private timeToMinutes(time: string): number {
    const parts = time.split(':').map(Number);
    const hours = parts[0] || 0;
    const minutes = parts[1] || 0;
    return hours * 60 + minutes;
  }

  private getDayName(date: Date): string {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[date.getDay()];
  }

}
