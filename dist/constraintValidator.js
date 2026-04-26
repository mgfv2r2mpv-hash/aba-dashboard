export class ConstraintValidator {
    constructor(data) {
        this.data = data;
    }
    validateSchedule() {
        const conflicts = [];
        conflicts.push(...this.validateSupervisionRequirements());
        conflicts.push(...this.validateParentTraining());
        conflicts.push(...this.validateAvailability());
        conflicts.push(...this.validateBillableRequirements());
        return conflicts;
    }
    validateSupervisionRequirements() {
        const conflicts = [];
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
    validateParentTraining() {
        const conflicts = [];
        // Check parent training hours per month
        const months = this.getMonthsInSchedule();
        months.forEach(month => {
            const trainingHours = this.calculateParentTrainingHours(month);
            const required = this.data.settings.parentTrainingHoursPerMonth.minimum;
            if (trainingHours < required) {
                conflicts.push({
                    type: 'training-violation',
                    severity: 'warning',
                    message: `${month} has ${trainingHours} hours of parent training but requires minimum ${required}`,
                });
            }
        });
        return conflicts;
    }
    validateAvailability() {
        const conflicts = [];
        this.data.appointments.forEach(appointment => {
            if (!appointment.technician)
                return;
            const technician = this.data.technicians.find(t => t.id === appointment.technician || t.name === appointment.technician);
            if (!technician)
                return;
            const appointmentDate = new Date(appointment.startTime);
            const dayName = this.getDayName(appointmentDate);
            const timeWindow = technician.availability[dayName];
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
    validateBillableRequirements() {
        const conflicts = [];
        if (!this.data.settings.billableRequirements)
            return conflicts;
        this.data.technicians.forEach(technician => {
            const cycles = this.getBillableCycles();
            cycles.forEach(cycle => {
                const billableHours = this.calculateBillableHours(technician.id, cycle.start, cycle.end);
                const required = this.data.settings.billableRequirements.hoursPerCycle;
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
    calculateDirectHours(technicianId) {
        return this.data.appointments
            .filter(a => (a.technician === technicianId || this.getTechnicianName(technicianId) === a.technician) && a.isBillable && a.type === 'client-session')
            .reduce((sum, a) => sum + this.getHoursDuration(a.startTime, a.endTime), 0);
    }
    calculateRBTHours(technicianId) {
        return this.data.appointments
            .filter(a => (a.technician === technicianId || this.getTechnicianName(technicianId) === a.technician) && a.isBillable && a.type === 'client-session')
            .reduce((sum, a) => sum + this.getHoursDuration(a.startTime, a.endTime), 0);
    }
    calculateSupervisionHours(technicianId) {
        return this.data.appointments
            .filter(a => a.type === 'supervision' && (a.technician?.includes(this.getTechnicianName(technicianId)) || a.description?.includes(this.getTechnicianName(technicianId))))
            .reduce((sum, a) => sum + this.getHoursDuration(a.startTime, a.endTime), 0);
    }
    calculateParentTrainingHours(month) {
        return this.data.appointments
            .filter(a => a.type === 'parent-training' && a.startTime.startsWith(month))
            .reduce((sum, a) => sum + this.getHoursDuration(a.startTime, a.endTime), 0);
    }
    calculateBillableHours(technicianId, startDate, endDate) {
        return this.data.appointments
            .filter(a => (a.technician === technicianId || this.getTechnicianName(technicianId) === a.technician) &&
            a.isBillable &&
            a.startTime >= startDate &&
            a.endTime <= endDate)
            .reduce((sum, a) => sum + this.getHoursDuration(a.startTime, a.endTime), 0);
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
    getTechnicianName(technicianId) {
        const tech = this.data.technicians.find(t => t.id === technicianId);
        return tech?.name || technicianId || '';
    }
    getMonthsInSchedule() {
        const months = new Set();
        this.data.appointments.forEach(a => {
            const month = a.startTime.substring(0, 7); // YYYY-MM
            months.add(month);
        });
        return Array.from(months);
    }
    getBillableCycles() {
        if (!this.data.settings.billableRequirements)
            return [];
        const cycles = [];
        const appointments = this.data.appointments.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
        if (appointments.length === 0)
            return cycles;
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
//# sourceMappingURL=constraintValidator.js.map