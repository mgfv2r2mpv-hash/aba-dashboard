import { ScheduleData, ScheduleConflict } from './types';
export interface QcResult {
    pass: boolean;
    hardViolations: ScheduleConflict[];
    newSoftViolations: ScheduleConflict[];
    residuals: string[];
}
export declare function qcSchedule(proposed: ScheduleData, baseline: ScheduleData, now?: Date): QcResult;
//# sourceMappingURL=qc.d.ts.map