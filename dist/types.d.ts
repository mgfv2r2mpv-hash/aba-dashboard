export type DayOfWeek = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';
export interface TimeWindow {
    start: string;
    end: string;
}
export interface Client {
    id: string;
    name: string;
    availabilityWindows: {
        [key in DayOfWeek]?: TimeWindow[];
    };
    parentTrainingMaxHours?: number;
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
export interface CompanySettings {
    supervisionDirectHoursPercent: number;
    supervisionRBTHoursPercent: number;
    parentTraining: {
        minimumHours: number;
        targetMinHours: number;
        targetMaxHours: number;
        periodUnit: TrainingPeriodUnit;
    };
    parentTrainingHoursPerMonth?: {
        minimum: number;
        target: {
            min: number;
            max: number;
        };
    };
    billableRequirements?: {
        hoursPerCycle: number;
        cycleWeeks: number;
    } | undefined;
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
    type: 'supervision' | 'parent-training' | 'internal-task' | 'client-session' | 'other';
    isRecurring?: boolean;
    recurringPattern?: 'weekly' | 'biweekly' | 'monthly';
}
export interface ScheduleData {
    id: string;
    version: number;
    clients: Client[];
    technicians: Technician[];
    settings: CompanySettings;
    appointments: Appointment[];
    lastModified: string;
}
export interface ScheduleConflict {
    type: 'supervision-violation' | 'training-violation' | 'availability-conflict' | 'scheduling-impossible';
    severity: 'error' | 'warning' | 'info';
    message: string;
    affectedAppointments?: string[];
    affectedTechnicians?: string[];
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