import { ScheduleData, ScheduleConflict, Appointment } from './types';

export class ConstraintValidator {
  private data: ScheduleData;

  constructor(data: ScheduleData) {
    // Canceled appointments are excluded from every constraint check by
    // shadowing the appointments array at the data-source level. Completed
    // and scheduled appointments are both counted (completed appointments
    // still consume hours that need to have been supervised, etc.).
    this.data = {
      ...data,
      appointments: data.appointments.filter(a => a.status !== 'canceled'),
    };
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

    const periods = this.getPeriodsForUnit(pt.periodUnit);

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

  private getPeriodsForUnit(unit: 'week' | 'month' | 'sixMonths' | 'year'): { start: Date; end: Date; label: string }[] {
    if (this.data.appointments.length === 0) return [];
    const dates = this.data.appointments.map(a => new Date(a.startTime));
    const min = new Date(Math.min(...dates.map(d => d.getTime())));
    const max = new Date(Math.max(...dates.map(d => d.getTime())));
    const periods: { start: Date; end: Date; label: string }[] = [];
    let cursor = new Date(min);
    cursor.setHours(0, 0, 0, 0);
    while (cursor <= max) {
      const start = new Date(cursor);
      const end = new Date(cursor);
      let label: string;
      if (unit === 'week') {
        end.setDate(end.getDate() + 7);
        label = `Week of ${start.toISOString().slice(0, 10)}`;
      } else if (unit === 'month') {
        end.setMonth(end.getMonth() + 1);
        label = start.toISOString().slice(0, 7);
      } else if (unit === 'sixMonths') {
        end.setMonth(end.getMonth() + 6);
        label = `${start.toISOString().slice(0, 7)} (6mo)`;
      } else {
        end.setFullYear(end.getFullYear() + 1);
        label = String(start.getFullYear());
      }
      periods.push({ start, end, label });
      cursor = end;
    }
    return periods;
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

    this.data.appointments.forEach(appointment => {
      if (!appointment.technician) return;

      const technician = this.data.technicians.find(t => t.id === appointment.technician || t.name === appointment.technician);
      if (!technician) return;

      const appointmentDate = new Date(appointment.startTime);
      const dayName = this.getDayName(appointmentDate);
      const timeWindow = (technician.availability as any)[dayName];

      if (!timeWindow || !Array.isArray(timeWindow)) {
        conflicts.push({
          type: 'availability-conflict',
          severity: 'error',
          message: `Technician ${technician.name} has no availability on ${dayName}`,
          affectedAppointments: [appointment.id],
          affectedTechnicians: [technician.id],
        });
        return;
      }

      const [appStart, appEnd] = this.getTimeFromISO(appointment.startTime, appointment.endTime);
      const available = timeWindow.some(window => {
        const [windowStart, windowEnd] = [
          this.timeToMinutes(window.start),
          this.timeToMinutes(window.end),
        ];
        return appStart >= windowStart && appEnd <= windowEnd;
      });

      if (!available) {
        conflicts.push({
          type: 'availability-conflict',
          severity: 'error',
          message: `Appointment overlaps with technician ${technician.name}'s unavailable time`,
          affectedAppointments: [appointment.id],
          affectedTechnicians: [technician.id],
        });
      }
    });

    return conflicts;
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
