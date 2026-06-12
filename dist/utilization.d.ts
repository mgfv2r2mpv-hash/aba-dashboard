import { Appointment, UtilizationSettings } from './types';
export declare const DEFAULT_UTILIZATION: Required<UtilizationSettings>;
export declare function resolveUtilization(u?: UtilizationSettings): Required<UtilizationSettings>;
export interface HoursByStatus {
    completed: number;
    scheduled: number;
    canceled: number;
    canceledFamily: number;
    canceledStaff: number;
}
export type UtilBucket = 'bt' | 'bcba';
export declare function bucketOf(a: Appointment): UtilBucket | null;
export declare function rollupHours(appointments: Appointment[], startMs: number, endMs: number, bucket: UtilBucket): HoursByStatus;
//# sourceMappingURL=utilization.d.ts.map