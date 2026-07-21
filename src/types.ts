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
  // When true, skips all PT-minimum validation for this client (absolute override).
  disablePTRequirements?: boolean;
  // Per-case direct utilization floor (%). Default 75. If direct hours fall below
  // this % of authorization, a "Below Targeted Utilization" issue is emitted.
  directUtilizationTarget?: number;
  // Per-case ideal supervision percentage (%). Overrides the company-wide
  // supervisionPreferredMinPercent on the Compliance dashboard for this client.
  supervisionIdealPct?: number;
  // Short handles the user might type for this client in the sAssI chat ("SB",
  // "Sammy"). Resolved LOCALLY to a token before any prompt is built (Claude
  // never sees names). Absent = fall back to name / auto-derived initials.
  aliases?: string[];
  // Coarse service locality — a CITY NAME ONLY (e.g. "Springfield"), never a
  // street or exact address. This is the HIPAA guardrail: a city centroid is a
  // public point shared by thousands, so it (and only it) may be geocoded and
  // used to estimate BCBA travel time between sessions. See CompanySettings.travel.
  city?: string;
  // Per-case placement heuristics the builder honors (see builderScoring.ts).
  // Captured from the owner's corrections, the sAssI chat, or the editor —
  // the "taught scheduler knowledge" store. Absent == everything 'auto'.
  schedulingHints?: SchedulingHints;
  // Archived = temporarily off the active caseload (e.g. the family moved to
  // another BCBA for the summer). An archived client is excluded from the
  // builder, compliance, counts, and the Cases list, but kept in the roster so
  // it can be unarchived. Archiving deletes the client's sessions dated on/after
  // `archivedAsOf` (past sessions stay for history). Absent == active.
  archived?: boolean;
  archivedAsOf?: string; // YYYY-MM-DD — the effective date sessions were cut from.
}

// How the builder should shape this case's BCBA-facing contacts. 'auto' (or an
// absent field) lets the scoring engine decide; the explicit styles are owner
// judgment the engine must honor (e.g. mid-day clients whose directs straddle
// morning/evening often do better as two shorter visits wedged between nearby
// sessions than one long evening block).
export type SupervisionStyle = 'auto' | 'consolidate' | 'split';
export type Daypart = 'morning' | 'midday' | 'afternoon' | 'evening';
export interface SchedulingHints {
  supervisionStyle?: SupervisionStyle;
  preferredDaypart?: Daypart;
  // Free text for the human (never parsed by the builder, never leaves device).
  note?: string;
  // Provenance: how this knowledge arrived — a hand edit, a chat instruction,
  // or a detected-and-confirmed correction ("learned").
  source?: 'manual' | 'chat' | 'learned';
  updatedAt?: string; // ISO date of the last hint change
}

export interface Technician {
  id: string;
  name: string;
  isRBT: boolean;
  isFieldworkSupervisee?: boolean;
  assignments: {
    clientId: string; // client ID (immutable; normalized from any legacy name ref)
    hoursPerWeek: number;
    billable: boolean;
    // Optional per-case availability: when set, this BT can only serve THIS
    // client within these windows (e.g. Hannah covers EC only Tue/Thu PM), even
    // though her overall `availability` below is wider. Absent = the BT's general
    // availability applies to this case with no extra restriction. The scheduler
    // intersects client avail ∩ BT general avail ∩ this per-case avail.
    availability?: {
      [key in DayOfWeek]?: TimeWindow[];
    };
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
  // Client-level utilization targets.
  clientUtilizationPercent?: number;      // % of auth'd direct hours to hit (default 80)
  minClientSessionHoursPerWeek?: number;  // minimum direct hours/wk per client (default 10)
}

export interface CompanySettings {
  // Practice/owner display name. Optional; labels exported backup filenames
  // (see lib/backupFilename) and rides inside backups/workbooks like any setting.
  practiceName?: string;
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
  // BACB cadence: minimum supervision contacts per month for an RBT. Default 2.
  rbtMinContactsPerMonth?: number;
  // Company minimum supervision contacts per month for non-RBT BTs. Default 1.
  techMinContactsPerMonth?: number;
  // When true (default), contacts are counted as distinct calendar days;
  // when false, each qualifying supervision session counts as a separate contact.
  contactsMustOccurOnSeparateDays?: boolean;
  // Billable-requirement hours removed per 1 hour of BCBA leave (Upgrade 1).
  // Default 1.0 — every PTO hour drops the week's requirement by an hour. A
  // company that assumes ~3 non-billable hours in an 8h day sets 0.625, so an
  // 8h PTO day removes 5 billable hours from the 25h/wk requirement. The reduced
  // week is floored at 0. Stored in the workbook so it travels with the schedule.
  ptoBillableDeductionRatio?: number;
  // When true, company holidays in a period reduce billable/hours targets (Home
  // trend cards + BCBA billable). Default false — holidays are informational only.
  // Hours/auth targets (client direct, BT direct) shrink proportionally to the
  // holiday days lost; billable targets drop by holidayBillableHoursPerDay per day.
  holidayAffectsBillable?: boolean;
  // Billable hours removed per company-holiday day when holidayAffectsBillable is
  // on (e.g. 5 / 6 / 5.5 / 6.25 — the billable hours a normal working day carries).
  // Default 8. Mirrors ptoBillableDeductionRatio's per-day intent for whole days off.
  holidayBillableHoursPerDay?: number;
  // PTO buckets / accrual / balances (Upgrade 2). Absent = DEFAULT_PTO_CONFIG
  // (unlimited mode, one combined pool, no balances).
  pto?: PtoConfig;
  // Preselected default session lengths for BCBA (non-direct) appointment types.
  // Absent = DEFAULT_BCBA_SESSION_DEFAULTS. Drives the auto-filled end time of a
  // new appointment in AppointmentForm. See BcbaSessionDefaults.
  bcbaSessionDefaults?: BcbaSessionDefaults;
  // Per-type minimum session length (minutes) the builder sizes toward; absent =
  // DEFAULT_MIN_SESSION_MINUTES. See MinSessionMinutes (grow-toward + flag, not a gate).
  minSessionMinutes?: MinSessionMinutes;
  // --- Travel-time grounding (the single BCBA physically travels between sites) ---
  // The BCBA's home base — the day's travel origin/terminus and the ONLY exact
  // address in the model (the user's own home, not PHI). Clients are city-level only.
  homeBase?: HomeBase;
  // Travel-model tunables. Absent = DEFAULT_TRAVEL_SETTINGS.
  travel?: TravelSettings;
  // Geocode cache: each distinct city → its public centroid. Filled once at
  // data-entry / "Refresh travel times"; read synchronously by the deterministic
  // builder so scheduling never hits the network.
  cityCenters?: CityCenter[];
  // Traffic-aware routed-duration cache keyed by (from, to, dow, hour). Filled by
  // the async pre-warm; read synchronously by the builder. Absent/miss → offline fallback.
  travelCache?: TravelCacheEntry[];
}

export const DEFAULT_PTO_DEDUCTION_RATIO = 1;

// A geographic point (WGS84). Coordinates are the ONLY geo data that ever leaves
// the device (to the maps provider): always a public city centroid or the user's
// own home — never a client's real address.
export interface LatLng {
  lat: number;
  lng: number;
}

// The BCBA's home base — the day's travel origin/terminus. The one place an exact
// street address is allowed (the user's own home). Clients stay city-level only.
export interface HomeBase {
  label?: string;
  address?: string; // exact street address permitted here (user's own home)
  city?: string;
  lat?: number;
  lng?: number;
}

// Cached geocode of a city name → its public centroid.
export interface CityCenter {
  city: string;
  lat: number;
  lng: number;
}

// One cached, traffic-aware routed duration between two localities for a given
// departure day-of-week + hour bucket. `from`/`to` are a city name or literal
// 'HOME'. `minutes` is the raw routed duration_in_traffic BEFORE the pad.
export interface TravelCacheEntry {
  from: string; // city name | 'HOME'
  to: string;   // city name | 'HOME'
  dow: number;  // 0=Sun … 6=Sat (local)
  hour: number; // hour-bucket start, 0–23 (local)
  minutes: number;
}

// Tunables for the travel-time model (Admin → Settings). See src/travel.ts.
export interface TravelSettings {
  enabled: boolean;          // master on/off for travel-gap enforcement
  withinCityMin: number;     // flat minutes for a same-city, different-site trip
  padPercent: number;        // % added to a routed duration (last-mile slack)
  avgSpeedMph: number;       // offline-fallback speed when no cached routed time
  defaultUnknownMin: number; // fallback minutes when a city has no centroid at all
  hourBucketSize: number;    // hours per traffic bucket (1 = hourly)
}

export const DEFAULT_TRAVEL_SETTINGS: TravelSettings = {
  enabled: true,
  withinCityMin: 15,
  padPercent: 5,
  avgSpeedMph: 30,
  defaultUnknownMin: 45,
  hourBucketSize: 1,
};

// Default session lengths for BCBA (non-direct) appointment types, used to
// auto-fill a NEW appointment's end time the moment its type is chosen. Supervision
// is special: it's a percentage of the client's authed weekly direct hours (a
// per-case figure), so it's stored as a percent rather than a fixed length; the
// rest are fixed hour counts. Direct (client-session) is unaffected — it keeps
// drawing its duration from the client's authorized weekly direct rate.
export interface BcbaSessionDefaults {
  supervisionPercentOfWeeklyDirect: number; // supervision = this % of weekly direct
  reassessmentHours: number;
  casePlanningHours: number;
  parentTrainingHours: number;
  otherHours: number;
}

export const DEFAULT_BCBA_SESSION_DEFAULTS: BcbaSessionDefaults = {
  supervisionPercentOfWeeklyDirect: 20,
  reassessmentHours: 2,
  casePlanningHours: 1,
  parentTrainingHours: 1,
  otherHours: 1,
};

// Per-type MINIMUM session length (minutes) the builder sizes toward. Not a hard
// suppression gate: the builder grows a session up to this when the host window + cap
// allow ("grow them"), but a session that can't reach it is still PLACED and PRESENTED
// (the BCBA may make it work — grow it, run it as telehealth to save travel, etc.) and
// flagged in the build summary. Absent = DEFAULT_MIN_SESSION_MINUTES.
export interface MinSessionMinutes {
  supervision: number;
  parentTraining: number;
  casePlanning: number;
  clientSession: number;
}

export const DEFAULT_MIN_SESSION_MINUTES: MinSessionMinutes = {
  supervision: 30,
  parentTraining: 30,
  casePlanning: 30,
  clientSession: 30,
};

export function resolveMinSessionMinutes(settings: Pick<CompanySettings, 'minSessionMinutes'>): MinSessionMinutes {
  return { ...DEFAULT_MIN_SESSION_MINUTES, ...settings.minSessionMinutes };
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

// Sources that apply to a given appointment type. For client-session /
// internal-task the BCBA isn't a participant, so Cancel-BCBA doesn't apply; every
// other type may be canceled by any of the four sources. The data model holds all
// four either way — callers just hide the irrelevant option. Shared by the cancel
// dialog (UI) and the sAssI `cancel` command op (wish.ts), so a spoken cancel and
// a clicked one obey the same rule.
export function applicableSources(apptType: Appointment['type']): { value: CancellationSource; label: string }[] {
  if (apptType === 'client-session' || apptType === 'internal-task') {
    return CANCELLATION_SOURCES.filter(s => s.value !== 'bcba');
  }
  return CANCELLATION_SOURCES;
}

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

// The stored recurrence vocabulary. 'custom' = a weekday-set-per-week series
// (e.g. Mon–Fri, M/W/F) whose slots each advance on a 7-day period. Monthly's
// nth-weekday flavor is NOT stored — it is MEASURED from the member dates
// (seriesProfile.measurePattern); dated rows fully determine it, and a stored
// flavor could contradict reality.
export type StoredRecurrencePattern = 'weekly' | 'biweekly' | 'monthly' | 'custom';
export const STORED_RECURRENCE_PATTERNS: readonly StoredRecurrencePattern[] = ['weekly', 'biweekly', 'monthly', 'custom'];

export interface Appointment {
  id: string;
  title: string;
  description?: string;
  technician?: string; // technician ID (immutable; never the display name — the
                       // v2→v3 migration normalizes any legacy name ref to the id).
                       // On a DIRECT (client-session) appointment this is the BT
                       // delivering the service. On a supervision-counting BCBA
                       // session (supervision / parent-training / case-planning) it
                       // instead identifies the BT being OBSERVED — the supervisee —
                       // so the overlap can be credited to that tech. Either way
                       // these BCBA sessions remain BCBA billable (see bucketOf),
                       // since the BCBA runs them. '' means no BT (BCBA-solo).
  client?: string;     // client ID (immutable; never the display name)
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
  recurringPattern?: StoredRecurrencePattern;
  // For MONTHLY series only: how each month's occurrence is chosen. 'weekday'
  // re-anchors to the same ordinal weekday (e.g. 1st Tuesday), keeping the series
  // on a consistent weekday for tech availability; 'date' keeps the same
  // day-of-month. Undefined on non-monthly rows and on legacy monthly series
  // (whose flavor is recovered by measurement — seriesProfile.measurePattern).
  monthlyMode?: 'weekday' | 'date';
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

// Session types that can count toward BT supervision — supervision, parent
// training, and coordination-of-care (case planning) — but ONLY when they
// overlap the supervised BT's direct (client-session) in time. Other types
// never count.
//   - A SUPERVISION session implies the client is present, so the BT is inferred
//     from whichever of that client's directs it overlaps — no BT need be named.
//   - PARENT-TRAINING / CASE-PLANNING can be caregiver-only (client/BT not in the
//     room), so they count only when they NAME the observed BT (technician field)
//     and overlap that BT's direct.
// Either way these stay BCBA billable (the technician on a parent-training /
// case-planning / reassessment session is the observee, not a provider — see
// bucketOf). Reassessment counts when the BT is present and assisting (e.g. data
// collection while the BCBA runs an assessment tool) — BCBA-confirmed.
export const SUPERVISION_COUNTING_TYPES: readonly Appointment['type'][] = ['supervision', 'parent-training', 'case-planning', 'reassessment'];

// True for a session eligible for supervision credit. Supervision always
// qualifies (credit is decided by overlap); parent-training / case-planning / reassessment
// qualify only when they name a BT (BT must be present and assisting). The credited hours are the time-overlap with
// the relevant BT's direct session(s) — partial overlap → partial credit.
export function countsAsSupervision(a: Pick<Appointment, 'type' | 'technician'>): boolean {
  if (a.type === 'supervision') return true;
  if (a.type === 'parent-training' || a.type === 'case-planning' || a.type === 'reassessment') return !!a.technician;
  return false;
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

// A bucket that paid/unpaid leave is drawn from. Sick/vacation can be tracked
// separately or merged into one "combined" pool; "unpaid" is its own optional
// pool (off by default — see CompanySettings.pto). The bucket is recorded on each
// entry now so Upgrade 2 (accrual + balances) is purely additive; today only the
// deduction-from-billable-requirement (Upgrade 1) reads these entries.
export type PtoBucket = 'sick' | 'vacation' | 'combined' | 'unpaid';

// ── PTO buckets, accrual & balances (Upgrade 2) ──────────────────────────────
// Balances are OPTIONAL: in 'unlimited' mode the app only tracks leave taken
// (used hours) and never blocks; in 'accrual' mode it also accrues hours over
// time and reports a remaining balance. Anyone whose real accrual rule isn't yet
// supported can stay on 'unlimited' and still use time off.

// How a rule grants hours. Phase 1 computes the two date-based kinds; the
// hours-based kinds are defined for forward-compat and reported as deferred until
// Phase 2 (so a saved rule round-trips and is visible, but doesn't yet accrue).
export type AccrualKind =
  | 'semimonthly'        // fixed hours on the 1st and the 15th of every month
  | 'everyNWeeks'        // fixed hours every N weeks, on a given weekday, from an anchor date
  | 'perConvertedHours'  // (Phase 2) X hours per Y converted billable hours
  | 'perConvertedBonus'; // (Phase 2) base per-converted plus a bonus when extra hours sustained

export const DATE_BASED_ACCRUALS: AccrualKind[] = ['semimonthly', 'everyNWeeks'];

export interface AccrualRule {
  id: string;
  kind: AccrualKind;
  bucket: PtoBucket;       // which pool this rule feeds
  hours: number;           // hours granted per event (or per `perHours` block)
  // everyNWeeks:
  everyWeeks?: number;     // cadence in weeks (>=1)
  weekday?: DayOfWeek;     // which day the grant lands on
  anchor?: string;         // YYYY-MM-DD the cadence counts from
  // perConvertedHours / perConvertedBonus:
  perHours?: number;       // grant `hours` per this many converted billable hours
  // perConvertedBonus adds Z=`bonusHours` each time the BCBA strings together M=
  // `bonusConsecutiveIntervals` consecutive `bonusInterval`s (week/month) that are
  // each "at criterion" (the streak resets after paying out). The criterion is
  // either an absolute converted-hours total per interval, or a percent above the
  // billable goal for that interval — user's choice. All values user-supplied.
  bonusHours?: number;                // Z — bonus hours granted per completed streak
  bonusInterval?: 'week' | 'month';
  bonusConsecutiveIntervals?: number; // M — consecutive at-criterion intervals required
  bonusCriterion?: 'hours' | 'percentAboveGoal';  // default 'hours'
  bonusPerExtraHours?: number;        // Y' — converted hours/interval to be at criterion ('hours')
  bonusPercentAboveGoal?: number;     // e.g. 5 → converted >= goal*1.05 ('percentAboveGoal')
  enabled?: boolean;       // default true; lets a rule be parked without deleting
  waitingPeriodDays?: number;
}

// A starting balance for a bucket as of a date — accrual is summed forward from
// here, so a BCBA can adopt the feature mid-year without backfilling history.
export interface PtoOpeningBalance {
  bucket: PtoBucket;
  hours: number;
  asOf: string;            // YYYY-MM-DD
}

export interface PtoConfig {
  mode: 'unlimited' | 'accrual';   // default 'unlimited'
  // 'combined' = one pool (entries use the 'combined' bucket); 'separate' = sick
  // and vacation tracked apart. Default 'combined'.
  buckets: 'combined' | 'separate';
  unpaidEnabled?: boolean;         // expose a distinct 'unpaid' pool. Default false.
  accruals?: AccrualRule[];        // used only in 'accrual' mode
  openingBalances?: PtoOpeningBalance[];
  maxBalances?: Partial<Record<PtoBucket, number>>;
}

export const DEFAULT_PTO_CONFIG: PtoConfig = { mode: 'unlimited', buckets: 'combined' };

// One block of BCBA leave on a single calendar day. The hours reduce that week's
// billable requirement by `hours * ptoBillableDeductionRatio` (see CompanySettings).
// A multi-day vacation is stored as one entry per day so each lands in the right
// ISO week and partial days are exact.
export interface TimeOff {
  id: string;
  date: string;                // YYYY-MM-DD (local calendar day)
  hours: number;               // leave hours taken that day (e.g. 8)
  bucket?: PtoBucket;          // which pool it draws from; absent = 'combined'
  note?: string;
  createdAt?: string;          // ISO timestamp when logged
}

// A company-wide non-working day (e.g. Thanksgiving, July 4th). Unlike a Blackout
// (which knocks out one specific tech or client) a holiday applies to everyone:
// any session landing on the date is flagged with a green star, and the day acts
// as blackout coverage for every entity. Preplaced in the schedule and shipped in
// the Excel workbook so the same holiday set travels with the program.
export interface CompanyHoliday {
  id: string;
  date: string;                // YYYY-MM-DD (local calendar day)
  name: string;                // human label shown on the green-star session ("Thanksgiving")
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
  // BCBA paid/unpaid leave. Each day's hours shave the week's billable
  // requirement per CompanySettings.ptoBillableDeductionRatio. Optional; absent = [].
  timeOff?: TimeOff[];
  // Company-wide holidays (non-working days for everyone). Drive the green-star
  // session marker and act as blackout coverage. Optional; absent = [].
  companyHolidays?: CompanyHoliday[];
  // Insurance authorizations + manually-entered consumed hours. Optional for
  // backward compatibility; treat absent as [].
  authorizations?: Authorization[];
  manualUsage?: ManualUsage[];
  // Per-instance conflict keys that the user has confirmed & dismissed. Stored in
  // the schedule so dismissals survive page reload and round-trip through Excel.
  confirmedConflicts?: string[];
  // Append-only history of committed changes (see src/actionLog.ts): what
  // changed, who/what sourced it, and enough before-state to stage a selective
  // undo through the draft pipeline. Capped (count + bytes) by pruneLog.
  // Rides the lossless envelope/native blob; deliberately NOT exported to xlsx.
  actionLog?: ActionLogEntry[];
  lastModified: string; // ISO 8601
}

// Where a committed change came from — drives the Activity list's grouping/icon
// and the undo label. 'undo' entries are themselves commits (append-only history).
export type ActionSource = 'build' | 'wish' | 'tidy' | 'manual' | 'chat' | 'undo' | 'import' | 'admin';

export interface ActionLogEntry {
  id: string;
  at: string;      // ISO commit time
  label: string;   // human summary ("Build month: 34 adds · 2 moves")
  source: ActionSource;
  // Normalized committed delta (add | edit | remove; the after-state rides
  // op.appt). Derived by diffing prev vs next at the commit chokepoint, so it
  // captures engine relocations and side-channel merges too. Import/admin
  // full-replaces log view-only entries with ops: [].
  ops: DraftOpLike[];
  // Pre-commit state of every touched appointment id (null = didn't exist).
  before: Record<string, Appointment | null>;
  blackoutsAdded?: Blackout[];
  hintChanges?: { clientId: string; before?: SchedulingHints; after?: SchedulingHints }[];
  undoable: boolean;
  // Coarse counts for view-only entries (imports / wholesale admin edits).
  counts?: { appts: number; clients: number; techs: number };
}

// Structural twin of draft.ts DraftOp (types.ts must not import draft.ts —
// draft.ts already imports types.ts). draft.ts's DraftOp is assignable to it.
export interface DraftOpLike {
  id: string;
  kind: 'add' | 'move' | 'shorten' | 'remove' | 'edit';
  targetId?: string;
  appt?: Appointment;
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

// ── "Wish It" — goal-driven AI schedule rework (Change 3) ────────────────────
// Unlike "Fix It" (resolve a conflict the user already created), "Wish It" takes
// a forward-looking GOAL and asks the AI for up to 3 ways to reshape the schedule
// to honor it while staying compliant. The composer is a natural-language box
// that's STRUCTURED — the kind + fields below capture the details the model needs
// so the prompt stays compact (fewer tokens) and the parse is reliable.
export type WishKind =
  | 'vacation'              // block off a date range (reschedule my sessions out of it)
  | 'clearWindow'           // free up a recurring weekday/time window, going forward
  | 'addRecurring'          // add a recurring session into a tight schedule
  | 'shaveDown'             // trim over-served supervision to free capacity
  | 'fillSchedule'          // maximize direct-service case utilization toward 100%
  | 'maximizeDirectHours'   // alias for fillSchedule used by Claude scheduler
  | 'freeform';             // anything else, described in the note

export interface WishRequest {
  kind: WishKind;
  note?: string;                 // free-text detail (always allowed)
  // vacation / general scope:
  dateStart?: string;            // YYYY-MM-DD
  dateEnd?: string;              // YYYY-MM-DD
  // clearWindow / addRecurring:
  weekday?: DayOfWeek;
  windowStart?: string;          // HH:MM (24h)
  windowEnd?: string;            // HH:MM
  everyOtherWeek?: boolean;      // e.g. "every other Friday"
  // addRecurring specifics:
  newType?: Appointment['type'];
  client?: string;               // client id/name the new session is for (optional)
  durationMins?: number;
  // How far forward the rework applies (weeks from today). Bounds the AI's scope
  // and the token budget. Default handled by the composer.
  horizonWeeks?: number;
  // "Shave down sessions where I can": when set, the AI is invited to trim
  // over-served supervision sessions from the preferred-max band down toward the
  // largest of (preferred min, company floor, BACB 5% for RBTs) to free capacity,
  // never dropping below that binding minimum. See claudeScheduler.buildWishPrompt.
  shaveDown?: boolean;
}

// ── "Fix It" — AI-assisted compliance remediation ───────────────────────────
// The wrench flow: the BCBA hands the AI their current compliance concerns and
// schedule warnings and asks for up to 3 ways to close the gaps. The toggles
// below tell the model which clinical tools it may reach for (and the excluded
// clients tell it whom to leave out), so the prompt stays parsimonious and the
// proposals stay within the BCBA's stated comfort zone. Output reuses the
// WishSolution op shape (move/add/remove/blackout), so the same apply/customize
// plumbing handles both flows.
export interface FixItOptions {
  // Propose supervision sessions that overlap a BT's direct (earns credit).
  includeBtSupervision: boolean;
  // Allow BCBA-solo supervision (no BT overlap) — does not earn supervision
  // credit, but can be paired with a direct to make it count.
  includeNoBtSupervision: boolean;
  // Parent-training that overlaps (runs inside) a direct session — earns credit
  // when it names the observed BT.
  includeInSessionParentTraining: boolean;
  // Parent-training scheduled outside any direct session (caregiver-only).
  includeOutSessionParentTraining: boolean;
  // Case-planning / coordination-of-care sessions.
  includeCasePlanning: boolean;
  // Permit proposals that drop the BCBA's weekly billable below the configured
  // minimum (otherwise the minimum is a hard constraint on the proposals).
  softenBillableMinimum: boolean;
  // Client ids to leave OUT of consideration (their gaps are ignored).
  excludedClientIds: string[];
  // Forward horizon in weeks (default handled by the composer).
  horizonWeeks?: number;
  // Weighting hints passed to the AI prompt.
  prioritizeBtSupervision?: boolean;
  prioritizeParentTraining?: boolean;
  // Scope the whole remediation to a single case: gaps, supervisable windows,
  // tech gaps, and diagnostics are all narrowed to this client. Used by the
  // per-case "Fix it" dialog on the Cases table.
  focusClientId?: string;
  // Free-text BCBA guidance, appended to the prompt (scrubbed for PII) so the
  // model resolves conflicts according to the BCBA's stated priorities.
  guidance?: string;
}

export const DEFAULT_FIXIT_OPTIONS: FixItOptions = {
  includeBtSupervision: true,
  includeNoBtSupervision: false,
  includeInSessionParentTraining: true,
  includeOutSessionParentTraining: false,
  includeCasePlanning: true,
  softenBillableMinimum: false,
  excludedClientIds: [],
  horizonWeeks: 4,
};

// One change the AI proposes. Tokens (APT_n/CLIENT_n/TECH_n) are de-anonymized to
// real ids/names before this struct is built (see src/wish.ts).
export type WishOp =
  | { op: 'move'; appointmentId: string; start: string; end: string }
  | { op: 'remove'; appointmentId: string }
  | { op: 'add'; title?: string; type: Appointment['type']; client?: string; technician?: string; start: string; end: string; recurring?: boolean; pattern?: StoredRecurrencePattern; seriesId?: string }
  | { op: 'blackout'; entityType: 'client' | 'technician'; entity: string; date: string; reason?: string }
  // Agentic command ops (sAssI). Each references only an appointment token plus
  // enums/booleans — no names — so anonymization guards never trip. They map to a
  // single full-appointment-replace `edit` DraftOp (see wish.ts / draft.ts) and,
  // carrying no start time, are never dropped by dropPastOps (a lock/complete/cancel
  // on a past session is legitimate).
  | { op: 'setFixed'; appointmentId: string; isFixed: boolean }
  | { op: 'complete'; appointmentId: string }
  | { op: 'cancel'; appointmentId: string; source: CancellationSource; reason: CancellationReason; unplanned: boolean; noticeMet?: boolean; notes?: string }
  // Tidy-only: stamp a shared seriesId (+ recurringPattern annotation) onto existing
  // dated rows so they become a batch-editable series, WITHOUT collapsing them into a
  // single recurring template (which would be lossy here) and WITHOUT setting
  // isRecurring (which would change future builds). Carries no timestamp — like the
  // command ops above it maps to `edit` DraftOps and survives dropPastOps.
  | { op: 'regroup'; appointmentIds: string[]; seriesId: string; recurringPattern?: StoredRecurrencePattern }
  // Teach-the-assistant: record a lasting per-client placement preference the
  // builder honors ("AB does better with two short mid-day supervisions").
  // Carries only a client token + enums — anonymization guards never trip.
  // Non-appointment op: rides wishSolutionToDraft's side-channel (like
  // blackout), buffered in app.tsx and merge-patched on Accept.
  | { op: 'setHint'; client: string; supervisionStyle?: SupervisionStyle; preferredDaypart?: Daypart };

export interface WishSolution {
  id: string;
  summary: string;
  reasoning: string;
  ops: WishOp[];
}
