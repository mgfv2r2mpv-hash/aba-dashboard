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

export class ConstraintValidator {
  private data: ScheduleData;
  private now: Date;

  constructor(data: ScheduleData, now: Date = new Date()) {
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

  validateSchedule(): ScheduleConflict[] {
    const conflicts: ScheduleConflict[] = [];

    // Supervision-compliance is computed per client in src/compliance.ts and
    // surfaced on the Compliance tab. Removed from the schedule-level validator
    // because the prior implementation matched supervisors to techs by
    // String.includes(name) and never checked time overlap with direct
    // sessions — both fundamentally wrong for BCBA case-supervision rules.
    conflicts.push(...this.validateParentTraining());
    conflicts.push(...this.validateAvailability());

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
    this.data.clients.forEach(client => {
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

    this.data.appointments.forEach(appointment => {
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

      if (technician) {
        const windows: TimeWindow[] = ((technician.availability as any)[dayName] as TimeWindow[]) || [];
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
        const windows: TimeWindow[] = ((client.availabilityWindows as any)[dayName] as TimeWindow[]) || [];
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

      if (blockingMessages.length === 0) return;

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
