import {
  Appointment,
  Authorization,
  Client,
  ScheduleData,
  Technician,
  SupervisionCadence,
  SUPERVISION_CADENCES,
  BACB_RBT_SUPERVISION_MIN_PERCENT,
  countsAsSupervision,
} from './types';
import {
  CompliancePeriod,
  monthPeriod,
  computeClientCompliance,
  computeTechCompliance,
  computeTechContactDays,
} from './compliance';
import { computeAuthUsage, computeReportDates, findAuthFor, inAuthSpan } from './authorization';

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

export interface WeekRange {
  start: Date; // Sunday 00:00 local
  end: Date;   // following Sunday 00:00 (exclusive)
  label: string;
}

// The Sunday-based calendar week containing `ref` (matches the validator's
// weekly parent-training period boundary).
export function weekRange(ref: Date): WeekRange {
  const start = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() - ref.getDay());
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { start, end, label: `Week of ${toYMD(start)}` };
}

function toYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function durationHours(a: Appointment): number {
  const ms = new Date(a.endTime).getTime() - new Date(a.startTime).getTime();
  return ms > 0 ? ms / 3_600_000 : 0;
}

function matchesClient(a: Appointment, client: Client): boolean {
  return a.client === client.id || a.client === client.name;
}

function inRange(a: Appointment, start: Date, end: Date): boolean {
  const t = new Date(a.startTime).getTime();
  return t >= start.getTime() && t < end.getTime();
}

// Days from `now` to a YYYY-MM-DD deadline (negative = past). Whole days.
function daysUntil(dateStr: string | undefined, now: Date): number | undefined {
  if (!dateStr) return undefined;
  const end = new Date(`${dateStr}T23:59:59`);
  return Math.floor((end.getTime() - now.getTime()) / 86_400_000);
}

function expectedContactsForCadence(cadence: SupervisionCadence | undefined): number | undefined {
  if (!cadence) return undefined;
  return SUPERVISION_CADENCES.find(c => c.value === cadence)?.contactsPerMonth;
}

// ---------------------------------------------------------------------------
// Per-case state
// ---------------------------------------------------------------------------

export interface CaseDirectState {
  authPerWk: number;        // authorized weekly direct (0 if unknown)
  idealPerWk: number;       // schedulable max = sum of this week's non-canceled directs' planned hours
  actualThisWk: number;     // delivered (completed) + still-scheduled this week
  pctOfAuth: number;        // actualThisWk / authPerWk * 100 (0 if no auth)
  below75: boolean;         // actualThisWk < 75% of authPerWk (only meaningful when authPerWk > 0)
}

export interface CaseSupervisionState {
  directHoursMonth: number;
  supHoursMonth: number;
  pct: number;              // supHoursMonth / directHoursMonth * 100
  floorPct: number;
  preferredMinPct: number;
  preferredMaxPct: number;  // == cap
  floorH: number;           // hours needed to reach the floor this month
  preferredH: number;       // hours to reach preferredMin
  capH: number;             // hours at the cap (preferredMax)
  gapToFloor: number;       // max(0, floorH - supHoursMonth)
  slackAboveFloor: number;  // max(0, supHoursMonth - floorH) — room to shave
  slackToCap: number;       // max(0, capH - supHoursMonth) — room to add before cap
  overCap: boolean;
  cadenceGoal?: SupervisionCadence;
  contactsThisMonth: number;       // projected distinct contact days w/ this case's overlapping techs
  contactsRequiredByCadence?: number;
}

export interface CaseParentTrainingState {
  authPerWk: number;
  deliveredMonth: number;
  goalMonth: number;        // company target (or per-case cap) for the month
  gap: number;
  parentOutsideOk: boolean; // false => PT must coincide with parent availability / a direct session
}

export interface CaseReassessmentState {
  blockH: number;           // authorized reassessment hours (buckets.reassessment)
  usedH: number;            // delivered reassessment hours in the auth span
  initialDraftDue?: string; // internal initial-draft deadline (the earlier one)
  finalDraftDue?: string;   // internal final-draft deadline
  daysToInternalDue?: number;           // to the earliest (initial-draft) milestone
  paceOk: boolean;          // false when behind: block not done and a milestone is near/past
}

export interface CaseCliffs {
  serviceEnd?: string;      // auth.endDate
  monthEnd: string;
  daysToServiceEnd?: number;
  daysToMonthEnd: number;
  // Which cliff binds first for this case (drives engine ordering).
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

export function computeCaseState(
  data: ScheduleData,
  client: Client,
  now: Date = new Date(),
): CaseState {
  const period = monthPeriod(now);
  const wk = weekRange(now);
  const settings = data.settings;

  // Auth covering "now" for this case (soonest-ending wins — that's the cliff).
  const auth = findAuthFor(data, client.id, toYMD(now))
    || (data.authorizations || []).find(a => a.clientId === client.id);
  const weekly = auth?.weekly || {};

  // ---- Direct (weekly 75% staffing) ----
  const directThisWk = data.appointments.filter(a =>
    a.type === 'client-session' && a.status !== 'canceled' && matchesClient(a, client) && inRange(a, wk.start, wk.end)
  );
  const actualThisWk = directThisWk.reduce((s, a) => s + durationHours(a), 0);
  const idealPerWk = actualThisWk; // schedulable max from this week's planned blocks
  const authDirectPerWk = weekly.direct ?? 0;
  const direct: CaseDirectState = {
    authPerWk: authDirectPerWk,
    idealPerWk,
    actualThisWk,
    pctOfAuth: authDirectPerWk > 0 ? (actualThisWk / authDirectPerWk) * 100 : 0,
    below75: authDirectPerWk > 0 && actualThisWk < 0.75 * authDirectPerWk,
  };

  // ---- Supervision (monthly %, floor/preferred/cap) ----
  const cc = computeClientCompliance(data, period, now).find(c => c.client.id === client.id);
  const directHoursMonth = cc?.projected.directHours ?? 0;
  const supHoursMonth = cc?.projected.supervisionHours ?? 0;
  const floorPct = settings.supervisionFloorPercent ?? 10;
  const preferredMinPct = settings.supervisionPreferredMinPercent ?? 15;
  const preferredMaxPct = settings.supervisionPreferredMaxPercent ?? settings.supervisionMaxHoursPercent ?? 20;
  const floorH = (directHoursMonth * floorPct) / 100;
  const preferredH = (directHoursMonth * preferredMinPct) / 100;
  const capH = (directHoursMonth * preferredMaxPct) / 100;
  const contactsThisMonth = countCaseContacts(data, client, period);
  const supervision: CaseSupervisionState = {
    directHoursMonth,
    supHoursMonth,
    pct: directHoursMonth > 0 ? (supHoursMonth / directHoursMonth) * 100 : 0,
    floorPct, preferredMinPct, preferredMaxPct,
    floorH, preferredH, capH,
    gapToFloor: Math.max(0, floorH - supHoursMonth),
    slackAboveFloor: Math.max(0, supHoursMonth - floorH),
    slackToCap: Math.max(0, capH - supHoursMonth),
    overCap: capH > 0 && supHoursMonth > capH + 0.01,
    cadenceGoal: client.cadenceGoal,
    contactsThisMonth,
    contactsRequiredByCadence: expectedContactsForCadence(client.cadenceGoal),
  };

  // ---- Parent training (monthly goal) ----
  const ptDeliveredMonth = data.appointments.filter(a =>
    a.type === 'parent-training' && a.status !== 'canceled' && matchesClient(a, client) && inRange(a, period.start, period.end)
  ).reduce((s, a) => s + durationHours(a), 0);
  const ptTarget = client.parentTrainingMaxHours !== undefined
    ? client.parentTrainingMaxHours
    : (settings.parentTraining?.targetMinHours ?? 0);
  const parentTraining: CaseParentTrainingState = {
    authPerWk: weekly.parentTraining ?? 0,
    deliveredMonth: ptDeliveredMonth,
    goalMonth: ptTarget,
    gap: Math.max(0, ptTarget - ptDeliveredMonth),
    parentOutsideOk: client.parentAvailableOutsideSessions === true,
  };

  // ---- Reassessment block + report pacing ----
  const reassessment = computeReassessment(data, client, auth, settings, now);

  // ---- Cliffs ----
  const monthEndDate = new Date(period.end.getTime() - 1);
  const monthEnd = toYMD(monthEndDate);
  const daysToMonthEnd = Math.floor((period.end.getTime() - now.getTime()) / 86_400_000);
  const daysToServiceEnd = daysUntil(auth?.endDate, now);
  const binding: CaseCliffs['binding'] =
    daysToServiceEnd !== undefined && daysToServiceEnd < daysToMonthEnd ? 'service-end' : 'month-end';

  return {
    client,
    auth,
    monthLabel: period.label,
    weekLabel: wk.label,
    direct,
    supervision,
    parentTraining,
    casePlanningAuthPerWk: weekly.casePlanning ?? 0,
    reassessment,
    cliffs: { serviceEnd: auth?.endDate, monthEnd, daysToServiceEnd, daysToMonthEnd, binding },
  };
}

function computeReassessment(
  data: ScheduleData,
  client: Client,
  auth: Authorization | undefined,
  settings: ScheduleData['settings'],
  now: Date,
): CaseReassessmentState {
  const blockH = auth?.buckets.reassessment ?? 0;
  let usedH = 0;
  if (auth) {
    usedH = data.appointments.filter(a =>
      a.type === 'reassessment' && a.status !== 'canceled' && matchesClient(a, client) &&
      inAuthSpan(a.startTime.slice(0, 10), auth)
    ).reduce((s, a) => s + durationHours(a), 0);
    usedH += (data.manualUsage || []).filter(m =>
      m.clientId === auth.clientId && m.bucket === 'reassessment' && inAuthSpan(m.date, auth)
    ).reduce((s, m) => s + m.hours, 0);
  }

  // Both report milestones are internal, computed back from the auth end date
  // using company policy (initial draft earlier than final draft).
  let initialDraftDue: string | undefined;
  let finalDraftDue: string | undefined;
  if (auth) {
    const dates = computeReportDates(auth, settings);
    initialDraftDue = dates.initialDraftDue;
    finalDraftDue = dates.finalDraftDue;
  }

  const daysToInternalDue = daysUntil(initialDraftDue, now);
  // Behind pace when there's an authorized block not fully delivered and the
  // earliest internal milestone is within ~3 weeks (or already passed).
  const paceOk = !(blockH > 0 && usedH < blockH - 0.01 && daysToInternalDue !== undefined && daysToInternalDue <= 21);

  return {
    blockH, usedH,
    initialDraftDue, finalDraftDue,
    daysToInternalDue, paceOk,
  };
}

// Distinct calendar days this month where a supervision-counting session tagged
// with this case overlaps the NAMED BT's direct session for the same case.
function countCaseContacts(
  data: ScheduleData,
  client: Client,
  period: CompliancePeriod,
): number {
  const directs = data.appointments.filter(a =>
    a.type === 'client-session' && a.status !== 'canceled' && matchesClient(a, client) && inRange(a, period.start, period.end)
  );
  const sups = data.appointments.filter(a =>
    countsAsSupervision(a) && a.status !== 'canceled' && matchesClient(a, client) && inRange(a, period.start, period.end)
  );
  const days = new Set<string>();
  for (const sup of sups) {
    const ss = new Date(sup.startTime).getTime();
    const se = new Date(sup.endTime).getTime();
    if (directs.some(d => {
      if (d.technician !== sup.technician) return false; // only the observed BT's direct
      const ds = new Date(d.startTime).getTime();
      const de = new Date(d.endTime).getTime();
      return Math.min(se, de) > Math.max(ss, ds);
    })) {
      days.add(sup.startTime.slice(0, 10));
    }
  }
  return days.size;
}

// ---------------------------------------------------------------------------
// Per-BT state (across that BT's cases)
// ---------------------------------------------------------------------------

export interface BtState {
  tech: Technician;
  directHoursMonth: number;
  supHoursMonth: number;
  pct: number;
  requiredPct: number;       // max(BACB 5% for RBT, company floor)
  gapToRequired: number;
  contactsThisMonth: number; // projected distinct supervision contact days
  contactsRequired: number;  // BACB cadence (default 2) for RBTs, else 0
  directHoursWeek: number;
}

export function computeBtState(
  data: ScheduleData,
  tech: Technician,
  now: Date = new Date(),
): BtState {
  const period = monthPeriod(now);
  const wk = weekRange(now);
  const tc = computeTechCompliance(data, period, now).find(t => t.tech.id === tech.id);
  const directHoursMonth = tc?.projected.directHours ?? 0;
  const supHoursMonth = tc?.projected.supervisionHours ?? 0;
  const floorPct = data.settings.supervisionFloorPercent ?? 10;
  const requiredPct = tech.isRBT
    ? Math.max(BACB_RBT_SUPERVISION_MIN_PERCENT, tc?.projected.companyRequiredPct ?? floorPct)
    : (tc?.projected.companyRequiredPct ?? 0);
  const requiredH = (directHoursMonth * requiredPct) / 100;

  const directHoursWeek = data.appointments.filter(a =>
    a.type === 'client-session' && a.status !== 'canceled' &&
    (a.technician === tech.id || a.technician === tech.name) && inRange(a, wk.start, wk.end)
  ).reduce((s, a) => s + durationHours(a), 0);

  return {
    tech,
    directHoursMonth, supHoursMonth,
    pct: directHoursMonth > 0 ? (supHoursMonth / directHoursMonth) * 100 : 0,
    requiredPct,
    gapToRequired: Math.max(0, requiredH - supHoursMonth),
    contactsThisMonth: computeTechContactDays(data, tech, period, 'projected', now),
    contactsRequired: tech.isRBT ? (data.settings.rbtMinContactsPerMonth ?? 2) : 0,
    directHoursWeek,
  };
}
