import { DayOfWeek, ScheduleData } from './types';
export type NeedKind = 'supervision-floor' | 'bt-supervision-floor' | 'bacb-contacts' | 'auth-direct-makeup' | 'reassessment-pace' | 'supervision-preferred' | 'cadence' | 'staffing-75' | 'parent-training';
export type NeedCause = 'bt-cancels' | 'understaffed' | 'capacity' | undefined;
export interface CorrectionNeed {
    priority: 0 | 1 | 2 | 3;
    kind: NeedKind;
    hard: boolean;
    clientId?: string;
    techId?: string;
    subject: string;
    detail: string;
    deficitHours?: number;
    bindingDeadline?: string;
    bindingCliff: 'month-end' | 'service-end';
    cause?: NeedCause;
    note?: string;
}
export interface ShaveEntry {
    appointmentId: string;
    clientId?: string;
    shaveMinutes: number;
    limitedBy: 'case-floor' | 'bt-floor' | 'bacb-contact' | 'none';
}
export interface CorrectionReport {
    monthLabel: string;
    needs: CorrectionNeed[];
    shaveRoom: ShaveEntry[];
}
export declare function analyzeCorrections(data: ScheduleData, now?: Date): CorrectionReport;
export interface SlotQuery {
    durationMinutes: number;
    clientId?: string;
    techId?: string;
    useClinicianAvailability?: boolean;
    fromDate?: Date;
    throughDate?: string;
    weekendsOk?: boolean;
    mustOverlapDirect?: boolean;
}
export interface SlotCandidate {
    date: string;
    day: DayOfWeek;
    start: string;
    end: string;
}
export declare function findOpenSlots(data: ScheduleData, q: SlotQuery, limit?: number): SlotCandidate[];
//# sourceMappingURL=corrections.d.ts.map