import { Authorization, Client, ScheduleData, Technician, SupervisionCadence } from './types';
export interface WeekRange {
    start: Date;
    end: Date;
    label: string;
}
export declare function weekRange(ref: Date): WeekRange;
export interface CaseDirectState {
    authPerWk: number;
    idealPerWk: number;
    actualThisWk: number;
    pctOfAuth: number;
    below75: boolean;
}
export interface CaseSupervisionState {
    directHoursMonth: number;
    supHoursMonth: number;
    pct: number;
    floorPct: number;
    preferredMinPct: number;
    preferredMaxPct: number;
    floorH: number;
    preferredH: number;
    capH: number;
    gapToFloor: number;
    slackAboveFloor: number;
    slackToCap: number;
    overCap: boolean;
    cadenceGoal?: SupervisionCadence;
    contactsThisMonth: number;
    contactsRequiredByCadence?: number;
}
export interface CaseParentTrainingState {
    authPerWk: number;
    deliveredMonth: number;
    goalMonth: number;
    gap: number;
    parentOutsideOk: boolean;
}
export interface CaseReassessmentState {
    blockH: number;
    usedH: number;
    initialDraftDue?: string;
    finalDraftDue?: string;
    daysToInternalDue?: number;
    paceOk: boolean;
}
export interface CaseCliffs {
    serviceEnd?: string;
    monthEnd: string;
    daysToServiceEnd?: number;
    daysToMonthEnd: number;
    binding: 'service-end' | 'month-end';
}
export interface CaseState {
    client: Client;
    auth?: Authorization;
    monthLabel: string;
    weekLabel: string;
    direct: CaseDirectState;
    supervision: CaseSupervisionState;
    parentTraining: CaseParentTrainingState;
    casePlanningAuthPerWk: number;
    reassessment: CaseReassessmentState;
    cliffs: CaseCliffs;
}
export declare function computeCaseState(data: ScheduleData, client: Client, now?: Date): CaseState;
export interface BtState {
    tech: Technician;
    directHoursMonth: number;
    supHoursMonth: number;
    pct: number;
    requiredPct: number;
    gapToRequired: number;
    contactsThisMonth: number;
    contactsRequired: number;
    directHoursWeek: number;
}
export declare function computeBtState(data: ScheduleData, tech: Technician, now?: Date): BtState;
//# sourceMappingURL=caseModel.d.ts.map