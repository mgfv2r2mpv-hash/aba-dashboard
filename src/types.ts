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

// Billable / utilization targets. A BCBA tracks their own weekly billable hours
// and the aggregate BT direct hours their caseload generates; both have
// "fully-utilized" thresholds. The BCBA also carries a monthly billable goal
// that differs for 4- vs 5-week months (a light week can be made up by month end).
export interface UtilizationSettings {
  bcbaWeeklyBillableHours?: number;       // BCBA fully-utilized weekly billables
  btWeeklyDirectHours?: number;           // BT (aggregate) fully-utilized weekly direct hours
  bcbaMonthlyBillableHours?: number;      // BCBA monthly goal in a 4-week month
  bcbaMonthlyBillableHours5Week?: number; // BCBA monthly goal in a 5-week month
}

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
  // Billable / utilization targets (BCBA weekly+monthly, BT weekly).
  utilization?: UtilizationSettings;
  // BACB cadence: minimum distinct supervision contact-days per month for an
  // RBT (at least one must observe service delivery — in this data model every
  // counted contact is an observed overlap, so that's inherent). Default 2.
  rbtMinContactsPerMonth?: number;
}

export const DEFAULT_CANCELLATION_NOTICE = {
  unplannedHoursThreshold: 24,
  plannedDaysThreshold: 30,
};

export type AppointmentStatus = 'scheduled' | 'completed' | 'canceled';

// Insurance-authorization buckets. Hours are authorized per bucket for the
// span of an Authorization, and consumed by appointments (mapped by type)
// plus manual entries (hours delivered outside this system — adopt-forward,
// no historical import).
export type AuthBucketKey = 'supervision' | 'direct' | 'parentTraining' | 'reassessment' | 'casePlanning';

export const AUTH_BUCKETS: { key: AuthBucketKey; label: string }[] = [
  { key: 'supervision', label: 'Supervision / Protocol Revision' },
  { key: 'direct', label: 'Direct Service' },
  { key: 'parentTraining', label: 'Parent Training / Coord. of Care' },
  { key: 'reassessment', label: 'Reassessment' },
  { key: 'casePlanning', label: 'Case Planning' },
];

export interface Authorization {
  id: string;
  clientId: string;
  label?: string;            // payer / auth number, free text
  startDate: string;         // YYYY-MM-DD inclusive
  endDate: string;           // YYYY-MM-DD inclusive — the "makeup cliff"
  buckets: Partial<Record<AuthBucketKey, number>>; // authorized hours per bucket
}

// Hours consumed outside the system (sessions held before adopting the app,
// or anything not entered as an appointment). Counts as used.
export interface ManualUsage {
  id: string;
  clientId: string;
  bucket: AuthBucketKey;
  hours: number;
  date: string;              // YYYY-MM-DD
  note?: string;
}

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
  type: 'supervision' | 'parent-training' | 'internal-task' | 'client-session' | 'reassessment' | 'case-planning' | 'other';
  // Make-up session: replaces hours lost to a cancellation. makeupForId points
  // at the canceled appointment being made up (optional — a make-up can be
  // "general" when the canceled session isn't tracked in the system).
  isMakeUp?: boolean;
  makeupForId?: string;
  isRecurring?: boolean;
  recurringPattern?: 'weekly' | 'biweekly' | 'monthly';
  // Shared by all occurrences of a recurring series — set when the series is
  // first expanded. Lets edit/delete operations target "this and following"
  // or "all in series" without having to match by signature.
  seriesId?: string;
  // Lifecycle. Absent / 'scheduled' = active; 'completed' counts toward
  // compliance totals; 'canceled' is excluded from totals (with cancellation
  // metadata kept for downstream reporting).
  status?: AppointmentStatus;
  cancellation?: Cancellation;
}

// A single-day "no session" marker for a technician or client. Unlike the
// weekly availability map (an ongoing schedule), a blackout knocks out one
// specific calendar date — "they're away that Thursday." Recorded with an
// optional reason so it's auditable later ("why was there no session?").
export interface Blackout {
  id: string;
  entityType: 'technician' | 'client';
  entityId: string;            // the tech/client id this blackout belongs to
  entityName?: string;         // snapshot of the name at creation, for review/audit
  date: string;                // YYYY-MM-DD (local calendar day)
  reason?: string;
  createdAt?: string;          // ISO timestamp when logged
}

export interface ScheduleData {
  id: string;
  version: number;
  clients: Client[];
  technicians: Technician[];
  settings: CompanySettings;
  appointments: Appointment[];
  // Per-day "away" markers. Optional for backward compatibility with schedules
  // (and Excel files) created before blackouts existed; treat absent as [].
  blackouts?: Blackout[];
  // Insurance authorizations + manually-entered consumed hours. Optional for
  // backward compatibility; treat absent as [].
  authorizations?: Authorization[];
  manualUsage?: ManualUsage[];
  lastModified: string; // ISO 8601
}

// How a single party's availability lines up with an appointment on its day.
//   ok       — has windows that fully cover the appointment time
//   outside  — has windows that day, but none cover the appointment
//   none     — no availability configured for that day
//   blackout — explicitly marked away that calendar date
export type PartyAvailabilityStatus = 'ok' | 'outside' | 'none' | 'blackout';

export interface PartyAvailability {
  role: 'Technician' | 'Client';
  name: string;
  status: PartyAvailabilityStatus;
  windows: TimeWindow[];       // that party's windows for the appointment's day
  blackoutReason?: string;
}

// Everything needed to understand an availability conflict without navigating
// away: the appointment slot plus each involved party's windows for that day.
export interface AvailabilityConflictDetail {
  day: DayOfWeek;
  date: string;                // YYYY-MM-DD
  start: string;               // HH:MM (appointment start)
  end: string;                 // HH:MM (appointment end)
  parties: PartyAvailability[];
}

export interface ScheduleConflict {
  type: 'supervision-violation' | 'training-violation' | 'availability-conflict' | 'scheduling-impossible';
  severity: 'error' | 'warning' | 'info';
  message: string;
  affectedAppointments?: string[];
  affectedTechnicians?: string[];
  // Present on availability-conflict: the structured slot + party windows the
  // ConflictPanel renders inline so the fix is visible in place.
  availabilityDetail?: AvailabilityConflictDetail;
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
