import { ScheduleData, ScheduleConflict } from './types';
export declare class ConstraintValidator {
    private data;
    constructor(data: ScheduleData);
    validateSchedule(): ScheduleConflict[];
    private validateSupervisionRequirements;
    private validateParentTraining;
    private getPeriodsForUnit;
    private calculateParentTrainingHoursInRange;
    private validateAvailability;
    private validateBillableRequirements;
    private calculateDirectHours;
    private calculateRBTHours;
    private calculateSupervisionHours;
    private calculateParentTrainingHours;
    private calculateBillableHours;
    private getHoursDuration;
    private getTimeFromISO;
    private timeToMinutes;
    private getDayName;
    private getTechnicianName;
    private getMonthsInSchedule;
    private getBillableCycles;
}
//# sourceMappingURL=constraintValidator.d.ts.map