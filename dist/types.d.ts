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
    utilization?: UtilizationSettings;
    rbtMinContactsPerMonth?: number;
}
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
export type CancellationReason = 'sick' | 'pto' | 'training' | 'holiday' | 'weather' | 'auth_issues';
export declare const CANCELLATION_REASONS: {
    value: CancellationReason;
    label: string;
}[];
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
export interface Blackout {
    id: string;
    entityType: 'technician' | 'client';
    entityId: string;
    entityName?: string;
    date: string;
    reason?: string;
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
    authorizations?: Authorization[];
    manualUsage?: ManualUsage[];
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
//# sourceMappingURL=types.d.ts.map