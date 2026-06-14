import { PtoConfig, PtoBucket, AccrualRule, TimeOff, Appointment } from './types';
export declare function resolvePtoConfig(c?: PtoConfig): PtoConfig;
export declare function activeBuckets(c: PtoConfig): PtoBucket[];
export declare function ptoBucketLabel(b: PtoBucket): string;
export declare function canonicalBucket(entryBucket: PtoBucket | undefined, c: PtoConfig): PtoBucket;
export declare function convertedBcbaHours(appointments: Appointment[] | undefined, since: Date | null, asOf: Date): number;
export interface PtoGoalHours {
    week?: number;
    month?: number;
}
export declare function accruedForRule(rule: AccrualRule, since: Date | null, asOf: Date, convertedHours?: number, appointments?: Appointment[], goals?: PtoGoalHours): number;
export interface BucketBalance {
    bucket: PtoBucket;
    used: number;
    opening?: number;
    accrued?: number;
    remaining?: number;
}
export declare function computePtoBalances(config: PtoConfig | undefined, timeOff: TimeOff[] | undefined, appointments?: Appointment[], asOf?: Date, goals?: PtoGoalHours): BucketBalance[];
//# sourceMappingURL=pto.d.ts.map