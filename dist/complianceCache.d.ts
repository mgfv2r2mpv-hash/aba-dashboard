import { ClientCompliance, TechCompliance, CompliancePeriod } from './compliance';
import { Appointment, ScheduleData } from './types';
export interface ComplianceCache {
    period: CompliancePeriod;
    now: Date;
    clients: Map<string, ClientCompliance>;
    techs: Map<string, TechCompliance>;
}
export interface ApptChange {
    before?: Appointment;
    after?: Appointment;
}
export declare function buildCache(data: ScheduleData, now?: Date): ComplianceCache;
export declare function affectedEntities(appt: Appointment, data: ScheduleData): {
    clientIds: Set<string>;
    techIds: Set<string>;
};
export declare function recomputeCache(prev: ComplianceCache | null, oldData: ScheduleData, newData: ScheduleData, changes: ApptChange[], now?: Date): ComplianceCache;
export type ComplianceStatus = 'green' | 'yellow' | 'red' | 'gray';
export declare function clientStatus(report: ClientCompliance, targetPct: number, preferredPct: number, maxPct?: number): ComplianceStatus;
export declare function techStatus(report: TechCompliance): ComplianceStatus;
export interface ComplianceSummary {
    red: number;
    yellow: number;
    worst: ComplianceStatus;
}
export declare function summarize(cache: ComplianceCache, data: ScheduleData): ComplianceSummary;
//# sourceMappingURL=complianceCache.d.ts.map