import { ScheduleData, ScheduleConflict, Appointment } from './types';

export class ConstraintValidator {
  private data: ScheduleData;

  constructor(data: ScheduleData) {
    this.data = data;
  }

  validateSchedule(): ScheduleConflict[] {
    const conflicts: ScheduleConflict[] = [];

    conflicts.push(...this.validateSupervisionRequirements());
    conflicts.push(...this.validateParentTraining());
    conflicts.push(...this.validateAvailability());
    conflicts.push(...this.validateBillableRequirements());

    return conflicts;
  }

  private validateSupervisionRequirements(): ScheduleConflict[] {
    const conflicts: ScheduleConflict[] = [];

    // For each technician, check if supervision hours meet requirements
    this.data.technicians.forEach(technician => {
      // Calculate direct client hours
      const directHours = this.calculateDirectHours(technician.id);
      // Calculate RBT hours (only for RBTs)
      const rbtHours = technician.isRBT ? this.calculateRBTHours(technician.id) : 0;

      const requiredSupervisionDirect = (directHours * this.data.settings.supervisionDirectHoursPercent) / 100;
      const requiredSupervisionRBT = technician.isRBT ? (rbtHours * this.data.settings.supervisionRBTHoursPercent) / 100 : 0;

      const actualSupervision = this.calculateSupervisionHours(technician.id);

      if (actualSupervision < requiredSupervisionDirect + requiredSupervisionRBT) {
        conflicts.push({
          type: 'supervision-violation',
          severity: 'error',
          message: `Technician ${technician.name} needs ${requiredSupervisionDirect + requiredSupervisionRBT} hours of supervision but has ${actualSupervision}`,
          affectedTechnicians: [technician.id],
        });
      }
    });

    return conflicts;
  }

  private validateParentTraining(): ScheduleConflict[] {
    const conflicts: ScheduleConflict[] = [];
    const pt = this.data.settings.parentTraining;
    if (!pt) return conflicts;

    const periods = this.getPeriodsForUnit(pt.periodUnit);

    periods.forEach(period => {
      const trainingHours = this.calculateParentTrainingHoursInRange(period.start, period.end);
      if (trainingHours < pt.minimumHours) {
        conflicts.push({
          type: 'training-violation',
          severity: 'warning',
          message: `${period.label} has ${trainingHours.toFixed(1)} hours of parent training but requires minimum ${pt.minimumHours} per ${pt.periodUnit}`,
        });
      }
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

  private calculateParentTrainingHoursInRange(start: Date, end: Date): number {
    return this.data.appointments
      .filter(a => {
        if (a.type !== 'parent-training') return false;
        const t = new Date(a.startTime);
        return t >= start && t < end;
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

  private validateBillableRequirements(): ScheduleConflict[] {
    const conflicts: ScheduleConflict[] = [];

    if (!this.data.settings.billableRequirements) return conflicts;

    this.data.technicians.forEach(technician => {
      const cycles = this.getBillableCycles();
      cycles.forEach(cycle => {
        const billableHours = this.calculateBillableHours(technician.id, cycle.start, cycle.end);
        const required = this.data.settings.billableRequirements!.hoursPerCycle;

        if (billableHours < required) {
          conflicts.push({
            type: 'scheduling-impossible',
            severity: 'info',
            message: `Technician ${technician.name} has ${billableHours} billable hours in cycle but needs ${required}`,
            affectedTechnicians: [technician.id],
          });
        }
      });
    });

    return conflicts;
  }

  // Helper calculations
  private calculateDirectHours(technicianId: string): number {
    return this.data.appointments
      .filter(a => (a.technician === technicianId || this.getTechnicianName(technicianId) === a.technician) && a.isBillable && a.type === 'client-session')
      .reduce((sum, a) => sum + this.getHoursDuration(a.startTime, a.endTime), 0);
  }

  private calculateRBTHours(technicianId: string): number {
    return this.data.appointments
      .filter(a => (a.technician === technicianId || this.getTechnicianName(technicianId) === a.technician) && a.isBillable && a.type === 'client-session')
      .reduce((sum, a) => sum + this.getHoursDuration(a.startTime, a.endTime), 0);
  }

  private calculateSupervisionHours(technicianId: string): number {
    return this.data.appointments
      .filter(a => a.type === 'supervision' && (a.technician?.includes(this.getTechnicianName(technicianId)) || a.description?.includes(this.getTechnicianName(technicianId))))
      .reduce((sum, a) => sum + this.getHoursDuration(a.startTime, a.endTime), 0);
  }

  private calculateParentTrainingHours(month: string): number {
    return this.data.appointments
      .filter(a => a.type === 'parent-training' && a.startTime.startsWith(month))
      .reduce((sum, a) => sum + this.getHoursDuration(a.startTime, a.endTime), 0);
  }

  private calculateBillableHours(technicianId: string, startDate: string, endDate: string): number {
    return this.data.appointments
      .filter(a =>
        (a.technician === technicianId || this.getTechnicianName(technicianId) === a.technician) &&
        a.isBillable &&
        a.startTime >= startDate &&
        a.endTime <= endDate
      )
      .reduce((sum, a) => sum + this.getHoursDuration(a.startTime, a.endTime), 0);
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

  private getTechnicianName(technicianId: string): string {
    const tech = this.data.technicians.find(t => t.id === technicianId);
    return tech?.name || technicianId || '';
  }

  private getMonthsInSchedule(): string[] {
    const months = new Set<string>();
    this.data.appointments.forEach(a => {
      const month = a.startTime.substring(0, 7); // YYYY-MM
      months.add(month);
    });
    return Array.from(months);
  }

  private getBillableCycles(): { start: string; end: string }[] {
    if (!this.data.settings.billableRequirements) return [];

    const cycles: { start: string; end: string }[] = [];
    const appointments = this.data.appointments.sort((a, b) =>
      new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    );

    if (appointments.length === 0) return cycles;

    let cycleStart = appointments[0].startTime;
    const cycleWeeks = this.data.settings.billableRequirements.cycleWeeks;

    for (let i = 0; i < appointments.length; i++) {
      const cycleEnd = new Date(cycleStart);
      cycleEnd.setDate(cycleEnd.getDate() + cycleWeeks * 7);

      cycles.push({
        start: cycleStart,
        end: cycleEnd.toISOString(),
      });

      cycleStart = cycleEnd.toISOString();
    }

    return cycles;
  }
}
