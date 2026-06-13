import { Appointment, Authorization, AuthBucketKey, Client, CompanySettings, ScheduleData } from './types';
export declare function bucketOfAppointment(a: Appointment): AuthBucketKey | null;
export interface BucketUsage {
    authorized: number;
    completed: number;
    scheduled: number;
    manual: number;
    used: number;
    projected: number;
    remaining: number;
}
export interface AuthUsage {
    auth: Authorization;
    client?: Client;
    daysLeft: number;
    buckets: {
        key: AuthBucketKey;
        label: string;
        usage: BucketUsage;
    }[];
}
export declare function inAuthSpan(dateStr: string, auth: Authorization): boolean;
export interface ReportDates {
    initialDraftDue: string;
    finalDraftDue: string;
}
export declare function computeReportDates(auth: Authorization, settings: CompanySettings): ReportDates;
export declare function computeAuthUsage(data: ScheduleData, auth: Authorization, now?: Date): AuthUsage;
export declare function findAuthFor(data: ScheduleData, clientRef: string, dateStr: string): Authorization | undefined;
export interface MakeupCandidate {
    appointment: Appointment;
    hours: number;
    madeUpHours: number;
    remainingHours: number;
}
export declare function makeupCandidates(data: ScheduleData, clientRef: string, dateStr: string, excludeId?: string): MakeupCandidate[];
//# sourceMappingURL=authorization.d.ts.map