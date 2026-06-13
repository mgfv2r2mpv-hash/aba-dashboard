import { Appointment, Client, ScheduleData, Technician } from './types';
export interface ClientComplianceMetrics {
    directHours: number;
    supervisionHours: number;
    requiredHours: number;
    pct: number;
    hoursToGo: number;
}
export interface ClientCompliance {
    client: Client;
    actual: ClientComplianceMetrics;
    projected: ClientComplianceMetrics;
}
export interface TechComplianceMetrics {
    directHours: number;
    supervisionHours: number;
    pct: number;
    bacbRequiredHours?: number;
    bacbHoursToGo?: number;
    companyRequiredPct: number;
    companyRequiredHours: number;
    companyHoursToGo: number;
}
export interface TechCompliance {
    tech: Technician;
    actual: TechComplianceMetrics;
    projected: TechComplianceMetrics;
}
export interface CompliancePeriod {
    start: Date;
    end: Date;
    label: string;
}
export declare function monthPeriod(ref: Date): CompliancePeriod;
export declare function computeClientCompliance(data: ScheduleData, period: CompliancePeriod, now?: Date): ClientCompliance[];
export declare function computeOneClientCompliance(data: ScheduleData, client: Client, period: CompliancePeriod, now?: Date): ClientCompliance;
export declare function computeTechCompliance(data: ScheduleData, period: CompliancePeriod, now?: Date): TechCompliance[];
export declare function computeOneTechCompliance(data: ScheduleData, tech: Technician, period: CompliancePeriod, now?: Date): TechCompliance;
export declare function computeTechContactDays(data: ScheduleData, tech: Technician, period: CompliancePeriod, scope: 'actual' | 'projected', now?: Date): number;
export declare function pastIncompleteAppointments(data: ScheduleData, now?: Date): Appointment[];
export declare function overlapHours(a: Appointment, b: Appointment): number;
//# sourceMappingURL=compliance.d.ts.map