export type DayOfWeek = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';
export interface TimeWindow {
    start: string;
    end: string;
}
export type SupervisionCadence = 'W' | 'EOW' | '3o4';
export declare const SUPERVISION_CADENCES: {
    value: SupervisionCadence;
    label: string;
    contactsPerMonth: number;
}[];
export interface Client {
    id: string;
    name: string;
    availabilityWindows: {
        [key in DayOfWeek]?: TimeWindow[];
    };
    parentTrainingMaxHours?: number;
    cadenceGoal?: SupervisionCadence;
    isEI?: boolean;
    eiDate?: string;
    partialStaffAllowed?: boolean;
    parentAvailableOutsideSessions?: boolean;
    anticipatedDischarge?: string;
    notes?: string;
    disablePTRequirements?: boolean;
    directUtilizationTarget?: number;
    supervisionIdealPct?: number;
}
export interface Technician {
    id: string;
    name: string;
    isRBT: boolean;
    assignments: {
        clientId: string;
        hoursPerWeek: number;
        billable: boolean;
    }[];
    availability: {
        [key in DayOfWeek]?: TimeWindow[];
    };
    notes?: string;
}
export declare const BACB_RBT_SUPERVISION_MIN_PERCENT = 5;
export type TrainingPeriodUnit = 'week' | 'month' | 'sixMonths' | 'year';
export interface ReportLead {
    value: number;
    unit: 'days' | 'weeks';
}
export interface UtilizationSettings {
    bcbaWeeklyBillableHours?: number;
    btWeeklyDirectHours?: number;
    bcbaMonthlyBillableHours?: number;
    bcbaMonthlyBillableHours5Week?: number;
    bcbaWeeklyBillableMin?: number;
}
export interface CompanySettings {
    supervisionDirectHoursPercent: number;
    supervisionRBTHoursPercent: number;
    supervisionTechHoursPercent?: number;
    supervisionMaxHoursPercent?: number;
    supervisionFloorPercent?: number;
    supervisionPreferredMinPercent?: number;
    supervisionPreferredMaxPercent?: number;
    reportDraftLead?: ReportLead;
    reportFinalLead?: ReportLead;
    reportLeadWeeksBackOffice?: number;
    reportLeadWeeksClinicalDirector?: number;
    parentTraining: {
        minimumHours: number;
        targetMinHours: number;
        targetMaxHours: number;
        periodUnit: TrainingPeriodUnit;
    };
    clinicianAvailability?: {
        [key in DayOfWeek]?: TimeWindow[];
    };
    parentTrainingHoursPerMonth?: {
        minimum: number;
        target: {
            min: number;
            max: number;
        };
    };
    cancellationNotice?: {
        unplannedHoursThreshold: number;
        plannedDaysThreshold: number;
    };
    cancellationReasons?: CancellationCode[];
    utilization?: UtilizationSettings;
    rbtMinContactsPerMonth?: number;
    techMinContactsPerMonth?: number;
    contactsMustOccurOnSeparateDays?: boolean;
    ptoBillableDeductionRatio?: number;
    pto?: PtoConfig;
    bcbaSessionDefaults?: BcbaSessionDefaults;
}
export declare const DEFAULT_PTO_DEDUCTION_RATIO = 1;
export interface BcbaSessionDefaults {
    supervisionPercentOfWeeklyDirect: number;
    reassessmentHours: number;
    casePlanningHours: number;
    parentTrainingHours: number;
    otherHours: number;
}
export declare const DEFAULT_BCBA_SESSION_DEFAULTS: BcbaSessionDefaults;
export declare const DEFAULT_CANCELLATION_NOTICE: {
    unplannedHoursThreshold: number;
    plannedDaysThreshold: number;
};
export type AppointmentStatus = 'scheduled' | 'completed' | 'canceled';
export type AuthBucketKey = 'supervision' | 'direct' | 'parentTraining' | 'reassessment' | 'casePlanning';
export declare const AUTH_BUCKETS: {
    key: AuthBucketKey;
    label: string;
}[];
export interface AuthWeeklyRates {
    direct?: number;
    supervision?: number;
    parentTraining?: number;
    casePlanning?: number;
}
export interface Authorization {
    id: string;
    clientId: string;
    label?: string;
    startDate: string;
    endDate: string;
    buckets: Partial<Record<AuthBucketKey, number>>;
    weekly?: AuthWeeklyRates;
    reportFinalDue?: string;
    reportDraftDue?: string;
}
export interface ManualUsage {
    id: string;
    clientId: string;
    bucket: AuthBucketKey;
    hours: number;
    date: string;
    note?: string;
}
export type CancellationSource = 'bt' | 'bcba' | 'admin' | 'family';
export declare const CANCELLATION_SOURCES: {
    value: CancellationSource;
    label: string;
}[];
export interface CancellationCode {
    value: string;
    label: string;
    retired?: boolean;
}
export type CancellationReason = string;
export declare const CANCELLATION_REASONS: CancellationCode[];
export declare function resolveCancellationCodes(settings?: {
    cancellationReasons?: CancellationCode[];
}): CancellationCode[];
export declare function activeCancellationCodes(settings?: {
    cancellationReasons?: CancellationCode[];
}): CancellationCode[];
export declare function cancellationReasonLabel(value: string, settings?: {
    cancellationReasons?: CancellationCode[];
}): string;
export declare function slugifyCancellationCode(label: string): string;
export interface Cancellation {
    source: CancellationSource;
    reason: CancellationReason;
    unplanned: boolean;
    noticeMet?: boolean;
    canceledAt?: string;
    notes?: string;
}
export interface Appointment {
    id: string;
    title: string;
    description?: string;
    technician?: string;
    client?: string;
    startTime: string;
    endTime: string;
    isFixed: boolean;
    isBillable: boolean;
    type: 'supervision' | 'parent-training' | 'internal-task' | 'client-session' | 'reassessment' | 'case-planning' | 'other';
    isMakeUp?: boolean;
    makeupForId?: string;
    isRecurring?: boolean;
    recurringPattern?: 'weekly' | 'biweekly' | 'monthly';
    seriesId?: string;
    status?: AppointmentStatus;
    cancellation?: Cancellation;
    isGhost?: boolean;
}
export declare const SUPERVISION_COUNTING_TYPES: readonly Appointment['type'][];
export declare function countsAsSupervision(a: Pick<Appointment, 'type' | 'technician'>): boolean;
export interface Blackout {
    id: string;
    entityType: 'technician' | 'client';
    entityId: string;
    entityName?: string;
    date: string;
    reason?: string;
    createdAt?: string;
}
export type PtoBucket = 'sick' | 'vacation' | 'combined' | 'unpaid';
export type AccrualKind = 'semimonthly' | 'everyNWeeks' | 'perConvertedHours' | 'perConvertedBonus';
export declare const DATE_BASED_ACCRUALS: AccrualKind[];
export interface AccrualRule {
    id: string;
    kind: AccrualKind;
    bucket: PtoBucket;
    hours: number;
    everyWeeks?: number;
    weekday?: DayOfWeek;
    anchor?: string;
    perHours?: number;
    bonusHours?: number;
    bonusInterval?: 'week' | 'month';
    bonusConsecutiveIntervals?: number;
    bonusCriterion?: 'hours' | 'percentAboveGoal';
    bonusPerExtraHours?: number;
    bonusPercentAboveGoal?: number;
    enabled?: boolean;
}
export interface PtoOpeningBalance {
    bucket: PtoBucket;
    hours: number;
    asOf: string;
}
export interface PtoConfig {
    mode: 'unlimited' | 'accrual';
    buckets: 'combined' | 'separate';
    unpaidEnabled?: boolean;
    accruals?: AccrualRule[];
    openingBalances?: PtoOpeningBalance[];
}
export declare const DEFAULT_PTO_CONFIG: PtoConfig;
export interface TimeOff {
    id: string;
    date: string;
    hours: number;
    bucket?: PtoBucket;
    note?: string;
    createdAt?: string;
}
export interface ScheduleData {
    id: string;
    version: number;
    clients: Client[];
    technicians: Technician[];
    settings: CompanySettings;
    appointments: Appointment[];
    blackouts?: Blackout[];
    timeOff?: TimeOff[];
    authorizations?: Authorization[];
    manualUsage?: ManualUsage[];
    confirmedConflicts?: string[];
    lastModified: string;
}
export type PartyAvailabilityStatus = 'ok' | 'outside' | 'none' | 'blackout';
export interface PartyAvailability {
    role: 'Technician' | 'Client';
    name: string;
    status: PartyAvailabilityStatus;
    windows: TimeWindow[];
    blackoutReason?: string;
}
export interface AvailabilityConflictDetail {
    day: DayOfWeek;
    date: string;
    start: string;
    end: string;
    parties: PartyAvailability[];
}
export interface ScheduleConflict {
    type: 'supervision-violation' | 'training-violation' | 'availability-conflict' | 'scheduling-impossible';
    severity: 'error' | 'warning' | 'info';
    message: string;
    affectedAppointments?: string[];
    affectedTechnicians?: string[];
    availabilityDetail?: AvailabilityConflictDetail;
}
export interface ScheduleSolution {
    id: string;
    description: string;
    affectedWeeks: number;
    weekSpan: {
        startDate: string;
        endDate: string;
    };
    changes: {
        appointmentId: string;
        oldTime: {
            start: string;
            end: string;
        };
        newTime: {
            start: string;
            end: string;
        };
    }[];
    reasoning: string;
    violatesConstraints: boolean;
}
export type WishKind = 'vacation' | 'clearWindow' | 'addRecurring' | 'shaveDown' | 'freeform';
export interface WishRequest {
    kind: WishKind;
    note?: string;
    dateStart?: string;
    dateEnd?: string;
    weekday?: DayOfWeek;
    windowStart?: string;
    windowEnd?: string;
    everyOtherWeek?: boolean;
    newType?: Appointment['type'];
    client?: string;
    durationMins?: number;
    horizonWeeks?: number;
    shaveDown?: boolean;
}
export interface FixItOptions {
    includeBtSupervision: boolean;
    includeNoBtSupervision: boolean;
    includeInSessionParentTraining: boolean;
    includeOutSessionParentTraining: boolean;
    includeCasePlanning: boolean;
    softenBillableMinimum: boolean;
    excludedClientIds: string[];
    horizonWeeks?: number;
    prioritizeBtSupervision?: boolean;
    prioritizeParentTraining?: boolean;
}
export declare const DEFAULT_FIXIT_OPTIONS: FixItOptions;
export type WishOp = {
    op: 'move';
    appointmentId: string;
    start: string;
    end: string;
} | {
    op: 'remove';
    appointmentId: string;
} | {
    op: 'add';
    title?: string;
    type: Appointment['type'];
    client?: string;
    technician?: string;
    start: string;
    end: string;
    recurring?: boolean;
    pattern?: 'weekly' | 'biweekly' | 'monthly';
} | {
    op: 'blackout';
    entityType: 'client' | 'technician';
    entity: string;
    date: string;
    reason?: string;
};
export interface WishSolution {
    id: string;
    summary: string;
    reasoning: string;
    ops: WishOp[];
}
//# sourceMappingURL=types.d.ts.map