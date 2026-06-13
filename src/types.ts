export type DayOfWeek = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';

export interface TimeWindow {
  start: string; // HH:MM format
  end: string;   // HH:MM format
}

// BCBA supervision pacing goal for a case. Soft guidance (drives "are we
// seeing them enough" warnings), NOT a service-stopping rule — the BACB
// observed-contacts floor and the supervision % floor are the hard lines.
//   W   — weekly (typically ~15+ direct h/wk cases)
//   EOW — every other week (~10–15 h/wk)
//   3o4 — three of every four weeks (focused-model / lower-hours cases)
export type SupervisionCadence = 'W' | 'EOW' | '3o4';

export const SUPERVISION_CADENCES: { value: SupervisionCadence; label: string; contactsPerMonth: number }[] = [
  { value: 'W', label: 'Weekly', contactsPerMonth: 4 },
  { value: 'EOW', label: 'Every other week', contactsPerMonth: 2 },
  { value: '3o4', label: '3 of every 4 weeks', contactsPerMonth: 3 },
];

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
  // --- Per-case clinical / scheduling metadata (drives the correction engine) ---
  // Soft supervision pacing goal (see SupervisionCadence).
  cadenceGoal?: SupervisionCadence;
  // Early-Intervention case + the relevant EI date (eligibility / transition).
  isEI?: boolean;
  eiDate?: string;
  // Whether the family permits a session to be covered by only part of the
  // usual staffing (e.g. one of two assigned BTs). Default true; when false,
  // the engine will not propose partial coverage. (Sheet: "Partial Staff Allowed?")
  partialStaffAllowed?: boolean;
  // Whether the parent can be asked to do parent-training OUTSIDE the client's
  // scheduled availability windows AND outside a direct session. Default false:
  // when false, parent-training must fall inside the set availability and
  // coincide with an active direct session — a HARD boundary for the engine.
  // When true, an out-of-window parent-training slot is allowed but TENTATIVE
  // (graded yellow / flagged for BCBA confirmation), not a hard conflict.
  parentAvailableOutsideSessions?: boolean;
  // Free-text anticipated discharge note/date (e.g. EI transition at age 3).
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

// BACB-mandated minimum supervision percentage for RBTs.
// This is set by the Behavior Analyst Certification Board, not the company.
export const BACB_RBT_SUPERVISION_MIN_PERCENT = 5;

export type TrainingPeriodUnit = 'week' | 'month' | 'sixMonths' | 'year';

// A lead time expressed in days or weeks. Used for internal report submission
// milestones computed back from an authorization's end date.
export interface ReportLead {
  value: number;
  unit: 'days' | 'weeks';
}

// Billable / utilization targets. A BCBA tracks their own weekly billable hours
// and the aggregate BT direct hours their caseload generates; both have
// "fully-utilized" thresholds. The BCBA also carries a monthly billable goal
// that differs for 4- vs 5-week months (a light week can be made up by month end).
export interface UtilizationSettings {
  bcbaWeeklyBillableHours?: number;       // BCBA fully-utilized weekly billables (target)
  btWeeklyDirectHours?: number;           // BT (aggregate) fully-utilized weekly direct hours
  bcbaMonthlyBillableHours?: number;      // BCBA monthly goal in a 4-week month
  bcbaMonthlyBillableHours5Week?: number; // BCBA monthly goal in a 5-week month
  // BCBA weekly billable FLOOR. A draft that would drop the BCBA's weekly
  // billable hours below this is graded red ("billable below minimum"). When
  // unset, the weekly target above doubles as the floor.
  bcbaWeeklyBillableMin?: number;
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
  // Supervision percentage band used by the correction engine (all % of a
  // case's / tech's direct hours):
  //   floor    — the company-mandated minimum that must always be met (default 10).
  //   preferredMin/Max — the band the BCBA aims for when capacity allows
  //                      (defaults 15 / 20). preferredMax doubles as the cap when
  //                      supervisionMaxHoursPercent is unset.
  // These are orthogonal to supervisionDirectHoursPercent (the legacy per-case
  // dashboard target) — the engine reads these; the dashboard keeps the legacy field.
  supervisionFloorPercent?: number;
  supervisionPreferredMinPercent?: number;
  supervisionPreferredMaxPercent?: number;
  // Internal report submission lead times, measured back from auth.endDate.
  // The initial draft is due `reportDraftLead` ahead of the auth end; the final
  // draft `reportFinalLead` ahead. Defaults: draft 4 weeks, final 2 weeks.
  reportDraftLead?: ReportLead;
  reportFinalLead?: ReportLead;
  // Legacy fields (weeks before the old insurer due date). Kept so older saved
  // schedules still parse; no longer surfaced or used for pacing.
  reportLeadWeeksBackOffice?: number;
  reportLeadWeeksClinicalDirector?: number;
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
  // Company-customizable cancellation reason codes. When set (and non-empty)
  // these replace the built-in CANCELLATION_REASONS in the cancel picker.
  // `retired` codes are kept (so historical cancellations still resolve to a
  // label) but hidden from new cancellations. Edited via Admin → Settings.
  cancellationReasons?: CancellationCode[];
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

// Per-week authorized service rates. The insurer authorizes a weekly MAX for
// each ongoing service; supervision is conventionally 20% of authorized direct
// (and that 20% IS the insurer cap). Reassessment is handled as a per-auth
// block via `buckets.reassessment`, not a weekly rate.
export interface AuthWeeklyRates {
  direct?: number;          // authorized direct h/week
  supervision?: number;     // authorized supervision h/week (≈ 20% of direct)
  parentTraining?: number;  // authorized parent-training h/week
  casePlanning?: number;    // authorized case-planning h/week
}

export interface Authorization {
  id: string;
  clientId: string;
  label?: string;            // payer / auth number, free text
  startDate: string;         // YYYY-MM-DD inclusive
  endDate: string;           // YYYY-MM-DD inclusive — the service / "makeup cliff"
  // Authorized hours per bucket, totalled over the auth span. Retained for the
  // existing span-usage tracking + adopt-forward manual hours.
  buckets: Partial<Record<AuthBucketKey, number>>;
  // Per-WEEK authorized rates — what the correction engine reasons over. The
  // weekly direct rate also feeds the 75%-staffing rule. Optional for backward
  // compatibility with auths entered before weekly rates existed.
  weekly?: AuthWeeklyRates;
  // Internal reassessment-report pacing deadlines (NOT the service cliff).
  reportFinalDue?: string;   // YYYY-MM-DD the report is due to the insurer
  reportDraftDue?: string;   // YYYY-MM-DD an earlier internal draft milestone
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

// A cancellation reason code. `value` is the stable id stored on records;
// `label` is what humans see; `retired` hides it from new cancellations while
// keeping it resolvable for historical records.
export interface CancellationCode {
  value: string;
  label: string;
  retired?: boolean;
}

// Reason values are free-form strings so companies can customize the set
// (see CompanySettings.cancellationReasons). The list below is the built-in
// default; the literal type just documents the shipped codes.
export type CancellationReason = string;
export const CANCELLATION_REASONS: CancellationCode[] = [
  { value: 'sick', label: 'Sick' },
  { value: 'pto', label: 'PTO/Vacation' },
  { value: 'training', label: 'Training' },
  { value: 'holiday', label: 'Holiday' },
  { value: 'weather', label: 'Weather' },
  { value: 'auth_issues', label: 'Auth Issues' },
];

// Effective reason codes for a company: their customized list when set (and
// non-empty), otherwise the built-in defaults.
export function resolveCancellationCodes(
  settings?: { cancellationReasons?: CancellationCode[] },
): CancellationCode[] {
  const custom = settings?.cancellationReasons;
  return custom && custom.length ? custom : CANCELLATION_REASONS;
}

// Active (non-retired) codes — what the cancel picker offers for new records.
export function activeCancellationCodes(
  settings?: { cancellationReasons?: CancellationCode[] },
): CancellationCode[] {
  return resolveCancellationCodes(settings).filter(c => !c.retired);
}

// Human label for a stored reason value. Falls back to a de-slugged version of
// the raw value so historical / unknown codes still read cleanly.
export function cancellationReasonLabel(
  value: string,
  settings?: { cancellationReasons?: CancellationCode[] },
): string {
  const found = resolveCancellationCodes(settings).find(c => c.value === value);
  return found?.label || value.replace(/_/g, ' ');
}

// Turn a free-text label into a stable code value: lowercase, non-alphanumerics
// to underscores, collapsed and trimmed (e.g. "Auth Issues" -> "auth_issues").
export function slugifyCancellationCode(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

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
  // Ghost = a wished-for session that couldn't be placed (the BCBA chose to log
  // it rather than fit it). Kept at its requested time as a visible reminder but
  // EXCLUDED from every computation — compliance, conflicts, utilization, and
  // slot search all treat a ghost as if it weren't there.
  isGhost?: boolean;
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
