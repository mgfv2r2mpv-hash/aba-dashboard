import { ScheduleData } from './types';
export interface NameDelta {
    added: string[];
    removed: string[];
    changed: string[];
}
export interface ScheduleDiff {
    clients: NameDelta;
    technicians: NameDelta;
    appointments: {
        current: number;
        next: number;
        delta: number;
    };
    settingsChanged: boolean;
}
export declare function diffSchedule(current: ScheduleData, next: ScheduleData): ScheduleDiff;
export declare function isEmptyDiff(d: ScheduleDiff): boolean;
//# sourceMappingURL=scheduleDiff.d.ts.map