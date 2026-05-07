export type DayOfWeek = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';

export interface TimeWindow {
  start: string; // HH:MM format
  end: string;   // HH:MM format
}

export interface Client {
  id: string;
  name: string; // anonymized
  availabilityWindows: {
    [key in DayOfWeek]?: TimeWindow[];
  };
  // Per-case parent-training cap (uses the company-wide periodUnit).
  // If set and lower than CompanySettings.parentTraining.targetMinHours,
  // the per-case max takes precedence — i.e. the client is capped below
  // the company target floor and is not flagged for being below target.
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

// BACB-mandated minimum supervision percentage for RBTs.
// This is set by the Behavior Analyst Certification Board, not the company.
export const BACB_RBT_SUPERVISION_MIN_PERCENT = 5;

export type TrainingPeriodUnit = 'week' | 'month' | 'sixMonths' | 'year';

export interface CompanySettings {
  // Per-client (case) supervision target — % of direct hours per client per period.
  supervisionDirectHoursPercent: number;
  // Per-RBT supervision target — % of THAT RBT's direct hours (any client).
  // BACB enforces a hard floor of 5%; companies can require higher.
  supervisionRBTHoursPercent: number;
  // Per-non-RBT-tech supervision target — % of THAT tech's direct hours (any
  // client). No BACB rule applies; this is purely company policy.
  supervisionTechHoursPercent?: number;
  // Insurer cap on supervision-to-direct ratio (e.g., 20%). Varies by payer
  // and over time; left undefined = no cap warning. When set, any per-client
  // or per-tech ratio that exceeds it is flagged in the dashboard so the
  // BCBA can adjust before the case runs out of authorized supervision hours.
  supervisionMaxHoursPercent?: number;
  parentTraining: {
    minimumHours: number;
    targetMinHours: number;
    targetMaxHours: number;
    periodUnit: TrainingPeriodUnit;
  };
  // The supervising clinician's weekly availability. Sessions cannot ethically
  // be scheduled outside these windows because supervision must be available.
  // Used as the default visible range in the schedule grid; users can
  // override to show a full 24h range when occasional late work is needed.
  clinicianAvailability?: {
    [key in DayOfWeek]?: TimeWindow[];
  };
  // Legacy field kept for older Excel files; mirrors `parentTraining` when present.
  parentTrainingHoursPerMonth?: {
    minimum: number;
    target: { min: number; max: number };
  };
  // Notice thresholds for cancellation tracking. Defaults are 24 hours
  // (unplanned) and 30 days (planned) but can be overridden per company.
  cancellationNotice?: {
    unplannedHoursThreshold: number;
    plannedDaysThreshold: number;
  };
}

export const DEFAULT_CANCELLATION_NOTICE = {
  unplannedHoursThreshold: 24,
  plannedDaysThreshold: 30,
};

export type AppointmentStatus = 'scheduled' | 'completed' | 'canceled';

// WHO initiated the cancellation. Source-only; reason is separate.
export type CancellationSource = 'bt' | 'bcba' | 'admin' | 'family';
export const CANCELLATION_SOURCES: { value: CancellationSource; label: string }[] = [
  { value: 'bt', label: 'Cancel-BT' },
  { value: 'bcba', label: 'Cancel-BCBA' },
  { value: 'admin', label: 'Cancel-Admin' },
  { value: 'family', label: 'Cancel-Family' },
];

export type CancellationReason = 'sick' | 'pto' | 'training' | 'holiday' | 'weather' | 'auth_issues';
export const CANCELLATION_REASONS: { value: CancellationReason; label: string }[] = [
  { value: 'sick', label: 'Sick' },
  { value: 'pto', label: 'PTO/Vacation' },
  { value: 'training', label: 'Training' },
  { value: 'holiday', label: 'Holiday' },
  { value: 'weather', label: 'Weather' },
  { value: 'auth_issues', label: 'Auth Issues' },
];

export interface Cancellation {
  source: CancellationSource;
  reason: CancellationReason;
  // Unplanned: callout / sick / weather. Planned: PTO weeks ahead, holiday, etc.
  unplanned: boolean;
  // For unplanned: did notice exceed CompanySettings.cancellationNotice.unplannedHoursThreshold?
  // For planned:   did notice exceed CompanySettings.cancellationNotice.plannedDaysThreshold?
  // Stored as a single boolean per the QA flow; thresholds are configured per company.
  noticeMet?: boolean;
  canceledAt?: string;  // ISO timestamp when this record was logged
  notes?: string;
}

export interface Appointment {
  id: string;
  title: string;
  description?: string;
  technician?: string; // technician ID or name
  client?: string;     // client ID or name
  startTime: string;   // ISO 8601 format
  endTime: string;     // ISO 8601 format
  isFixed: boolean;    // cannot be moved
  isBillable: boolean;
  type: 'supervision' | 'parent-training' | 'internal-task' | 'client-session' | 'other';
  isRecurring?: boolean;
  recurringPattern?: 'weekly' | 'biweekly' | 'monthly';
  // Lifecycle. Absent / 'scheduled' = active; 'completed' counts toward
  // compliance totals; 'canceled' is excluded from totals (with cancellation
  // metadata kept for downstream reporting).
  status?: AppointmentStatus;
  cancellation?: Cancellation;
}

export interface ScheduleData {
  id: string;
  version: number;
  clients: Client[];
  technicians: Technician[];
  settings: CompanySettings;
  appointments: Appointment[];
  lastModified: string; // ISO 8601
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
  weekSpan: { startDate: string; endDate: string };
  changes: {
    appointmentId: string;
    oldTime: { start: string; end: string };
    newTime: { start: string; end: string };
  }[];
  reasoning: string;
  violatesConstraints: boolean;
}
