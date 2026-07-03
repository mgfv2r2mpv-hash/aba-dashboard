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
  below75: boolean;         // legacy alias for belowTarget
  belowTarget: boolean;     // actualThisWk < directUtilizationTarget% of authPerWk
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
    belowTarget: authDirectPerWk > 0 && actualThisWk < ((client.directUtilizationTarget ?? 75) / 100) * authDirectPerWk,
    get below75() { return this.belowTarget; },
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
      // Supervision (no BT named) infers from any of this case's directs; a
      // parent-training / case-planning counts only against its named BT's direct.
      if (sup.technician && d.technician !== sup.technician) return false;
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
    contactsRequired: tech.isRBT ? (data.settings.rbtMinContactsPerMonth ?? 2) : (data.settings.techMinContactsPerMonth ?? 1),
    directHoursWeek,
  };
}

// ---------------------------------------------------------------------------
// Home trend cards (M4)
// ---------------------------------------------------------------------------
// Pace-vs-actual-vs-projection cards for the Home view. Shares the same pace
// math as Caseload (computeCaseState / computeBtState) rather than duplicating
// it; derives an honest cumulative weekly (month) / daily (week) series from the
// real appointment feed. Persons with no target are omitted — no invented data.

export type TrendStatus = 'met' | 'pace' | 'behind' | 'over';
export interface TrendSeries { pace: number[]; actual: number[]; proj: number[]; }
export interface TrendWindow {
  target: number;          // hours the window aims for
  actual: number;          // booked (delivered + still-scheduled) to date
  proj: number;            // whole-window booked+scheduled trajectory
  status: TrendStatus;
  metric: 'hours';
  impact?: string;         // off-track note (week window only)
  series: TrendSeries;
}
export interface PersonTrend {
  id: string;
  who: string;
  role: 'client' | 'tech';
  subtitle: string;
  month: TrendWindow;
  week: TrendWindow;
}

const round1 = (x: number): number => Math.round(x * 10) / 10;

// Signed hours with the regulated glyphs: −6.5h / +2.0h.
function fmtSignedHours(h: number): string {
  return `${h < 0 ? '−' : '+'}${round1(Math.abs(h)).toFixed(1)}h`;
}

// 7-day cumulative bucket ends (exclusive) spanning [start, end).
function weekBoundsWithin(start: Date, end: Date): Date[] {
  const bounds: Date[] = [];
  let cur = new Date(start);
  let guard = 0;
  while (cur.getTime() < end.getTime() && guard++ < 8) {
    const next = new Date(cur);
    next.setDate(next.getDate() + 7);
    bounds.push(new Date(Math.min(next.getTime(), end.getTime())));
    cur = next;
  }
  return bounds.length ? bounds : [new Date(end)];
}

// Daily cumulative bucket ends across `count` days from `start`.
function dayBoundsFrom(start: Date, count: number): Date[] {
  const bounds: Date[] = [];
  for (let i = 1; i <= count; i++) {
    const b = new Date(start);
    b.setDate(b.getDate() + i);
    bounds.push(b);
  }
  return bounds;
}

// Build a window from appts already constrained to the window's period.
// `behindPct` is the fraction of target below which the person is "behind";
// `overAt` (optional, hours) flags an overage as "over".
function buildTrendWindow(params: {
  appts: Appointment[];
  bounds: Date[];
  now: Date;
  target: number;
  behindPct: number;
  overAt?: number;
  withImpact?: boolean;
}): TrendWindow {
  const { appts, bounds, now, target, behindPct, overAt, withImpact } = params;
  const n = bounds.length;
  const hoursBefore = (t: Date): number =>
    appts
      .filter(a => new Date(a.startTime).getTime() < t.getTime())
      .reduce((s, a) => s + durationHours(a), 0);

  const pace = bounds.map((_, i) => round1((target * (i + 1)) / n));
  let cur = bounds.findIndex(b => b.getTime() > now.getTime());
  if (cur < 0) cur = n - 1;
  const actualSeries = bounds.slice(0, cur + 1).map(b => round1(hoursBefore(b)));
  const projFinal = round1(hoursBefore(bounds[n - 1]));
  const actualToDate = actualSeries[actualSeries.length - 1] ?? 0;
  const proj = bounds.map((b, i) => {
    if (i <= cur) return round1(hoursBefore(b));
    const remain = n - 1 - cur;
    const step = remain > 0 ? (projFinal - actualToDate) / remain : 0;
    return round1(actualToDate + step * (i - cur));
  });

  const status: TrendStatus =
    overAt != null && projFinal > overAt + 0.01 ? 'over'
      : target <= 0 ? 'met'
        : projFinal >= target * 0.98 ? 'met'
          : projFinal >= target * (behindPct / 100) ? 'pace'
            : 'behind';

  let impact: string | undefined;
  if (withImpact && status !== 'met') {
    const delta = projFinal - target;
    impact = `${delta < 0 ? '↘' : '↗'} ${fmtSignedHours(delta)} vs plan this week`;
  }

  return {
    target: round1(target),
    actual: actualToDate,
    proj: projFinal,
    status,
    metric: 'hours',
    impact,
    series: { pace, actual: actualSeries, proj },
  };
}

export function computeHomeTrends(data: ScheduleData, now: Date = new Date()): PersonTrend[] {
  const period = monthPeriod(now);
  const wk = weekRange(now);
  const monthBounds = weekBoundsWithin(period.start, period.end);
  const numWeeks = monthBounds.length;
  const weekBounds = dayBoundsFrom(wk.start, 7);
  const trends: PersonTrend[] = [];

  const withinMonth = (a: Appointment) => inRange(a, period.start, period.end);
  const withinWeek = (a: Appointment) => inRange(a, wk.start, wk.end);

  for (const client of data.clients) {
    const cs = computeCaseState(data, client, now);

    // Direct hours card (weekly authorized × weeks-in-month).
    if (cs.direct.authPerWk > 0) {
      const directAll = data.appointments.filter(a =>
        a.type === 'client-session' && a.status !== 'canceled' && matchesClient(a, client));
      const utilPct = client.directUtilizationTarget ?? 75;
      trends.push({
        id: `${client.id}-direct`,
        who: client.name,
        role: 'client',
        subtitle: 'Client · direct hours',
        month: buildTrendWindow({
          appts: directAll.filter(withinMonth), bounds: monthBounds, now,
          target: cs.direct.authPerWk * numWeeks, behindPct: utilPct,
        }),
        week: buildTrendWindow({
          appts: directAll.filter(withinWeek), bounds: weekBounds, now,
          target: cs.direct.authPerWk, behindPct: utilPct, withImpact: true,
        }),
      });
    }

    // Supervision hours card (monthly floor/preferred/cap band).
    if (cs.supervision.directHoursMonth > 0 && cs.supervision.preferredH > 0) {
      const supAll = data.appointments.filter(a =>
        countsAsSupervision(a) && a.status !== 'canceled' && matchesClient(a, client));
      const behindPct = cs.supervision.preferredH > 0
        ? (cs.supervision.floorH / cs.supervision.preferredH) * 100
        : 100;
      trends.push({
        id: `${client.id}-supervision`,
        who: `${client.name} · supervision`,
        role: 'client',
        subtitle: 'Client · supervision',
        month: buildTrendWindow({
          appts: supAll.filter(withinMonth), bounds: monthBounds, now,
          target: cs.supervision.preferredH, behindPct, overAt: cs.supervision.capH,
        }),
        week: buildTrendWindow({
          appts: supAll.filter(withinWeek), bounds: weekBounds, now,
          target: cs.supervision.preferredH / numWeeks, behindPct,
          overAt: cs.supervision.capH / numWeeks, withImpact: true,
        }),
      });
    }
  }

  for (const tech of data.technicians) {
    const weeklyAssigned = (tech.assignments || []).reduce((s, x) => s + (x.hoursPerWeek || 0), 0);
    if (weeklyAssigned <= 0) continue;
    const directAll = data.appointments.filter(a =>
      a.type === 'client-session' && a.status !== 'canceled' &&
      (a.technician === tech.id || a.technician === tech.name));
    const BT_BEHIND_PCT = 80;
    trends.push({
      id: `${tech.id}-direct`,
      who: tech.name,
      role: 'tech',
      subtitle: tech.isRBT ? 'Credentialed BT' : 'Behavior technician',
      month: buildTrendWindow({
        appts: directAll.filter(withinMonth), bounds: monthBounds, now,
        target: weeklyAssigned * numWeeks, behindPct: BT_BEHIND_PCT,
      }),
      week: buildTrendWindow({
        appts: directAll.filter(withinWeek), bounds: weekBounds, now,
        target: weeklyAssigned, behindPct: BT_BEHIND_PCT, withImpact: true,
      }),
    });
  }

  return trends;
}
