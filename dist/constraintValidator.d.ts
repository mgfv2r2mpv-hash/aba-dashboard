import { ScheduleData, ScheduleConflict } from './types';
export declare class ConstraintValidator {
    private data;
    private now;
    constructor(data: ScheduleData, now?: Date);
    validateSchedule(): ScheduleConflict[];
    private validateCaseModel;
    private validateSupervision;
    private validateAuthorizations;
    private validateParentTraining;
    private currentPeriod;
    private calculateClientParentTrainingHoursInRange;
    private validateAvailability;
    private findBlackout;
    private partyStatus;
    private partyMessage;
    private toDateString;
    private minutesToTime;
    private getHoursDuration;
    private getTimeFromISO;
    private timeToMinutes;
    private getDayName;
}
//# sourceMappingURL=constraintValidator.d.ts.map