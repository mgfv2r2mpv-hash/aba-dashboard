import { Appointment, UtilizationSettings, TimeOff, DEFAULT_PTO_DEDUCTION_RATIO } from './types';

// Company defaults; overridable in Admin → Settings.
export const DEFAULT_UTILIZATION: Required<UtilizationSettings> = {
  bcbaWeeklyBillableHours: 25,
  btWeeklyDirectHours: 165,
  bcbaMonthlyBillableHours: 100,
  bcbaMonthlyBillableHours5Week: 125,
  bcbaWeeklyBillableMin: 25,
  clientUtilizationPercent: 80,
  minClientSessionHoursPerWeek: 10,
};

export function resolveUtilization(u?: UtilizationSettings): Required<UtilizationSettings> {
  const weekly = u?.bcbaWeeklyBillableHours ?? DEFAULT_UTILIZATION.bcbaWeeklyBillableHours;
  return {
    bcbaWeeklyBillableHours: weekly,
    btWeeklyDirectHours: u?.btWeeklyDirectHours ?? DEFAULT_UTILIZATION.btWeeklyDirectHours,
    bcbaMonthlyBillableHours: u?.bcbaMonthlyBillableHours ?? DEFAULT_UTILIZATION.bcbaMonthlyBillableHours,
    bcbaMonthlyBillableHours5Week: u?.bcbaMonthlyBillableHours5Week ?? DEFAULT_UTILIZATION.bcbaMonthlyBillableHours5Week,
    bcbaWeeklyBillableMin: u?.bcbaWeeklyBillableMin ?? weekly,
    clientUtilizationPercent: u?.clientUtilizationPercent ?? DEFAULT_UTILIZATION.clientUtilizationPercent,
    minClientSessionHoursPerWeek: u?.minClientSessionHoursPerWeek ?? DEFAULT_UTILIZATION.minClientSessionHoursPerWeek,
  };
}

// ── PTO → reduced billable requirement (Upgrade 1) ───────────────────────────
// BCBA leave shaves the billable requirement for the week(s) it lands in. The
// reduction is `ptoHours * ratio`, floored so a week never goes negative.

// Sum the leave hours that fall in [startMs, endMs). A multi-day vacation is
// stored one entry per day, so each lands in exactly one week.
export function ptoHoursInRange(timeOff: TimeOff[] | undefined, startMs: number, endMs: number): number {
  if (!timeOff?.length) return 0;
  let h = 0;
  for (const t of timeOff) {
    // Parse the YYYY-MM-DD as a LOCAL midnight so it buckets by the same wall
    // clock the week boundaries use (the calendar week starts on local Monday).
    const ms = localDayMs(t.date);
    if (ms === null || ms < startMs || ms >= endMs) continue;
    const v = Number(t.hours);
    if (Number.isFinite(v) && v > 0) h += v;
  }
  return h;
}

// "YYYY-MM-DD" → epoch ms at local midnight (null if unparseable).
function localDayMs(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date || '');
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

// The week's effective billable requirement after leave. `ratio` defaults to the
// 1:1 rule; pass settings.ptoBillableDeductionRatio to honor a company override.
export function reduceRequirementForPto(baseTarget: number, ptoHours: number, ratio?: number): number {
  if (!(ptoHours > 0) || !(baseTarget > 0)) return baseTarget;
  const r = ratio ?? DEFAULT_PTO_DEDUCTION_RATIO;
  return Math.max(0, baseTarget - ptoHours * r);
}

// completed = finalized; canceled = struck; scheduled = everything still on the
// books (future, or past-but-not-yet-finalized). Canceled is further split by
// who canceled so the gauge can color family vs staff losses.
export interface HoursByStatus {
  completed: number;
  scheduled: number;
  canceled: number;        // total (family + staff/other)
  canceledFamily: number;
  canceledStaff: number;   // BT/BCBA/admin or unspecified source
}

const EMPTY: HoursByStatus = { completed: 0, scheduled: 0, canceled: 0, canceledFamily: 0, canceledStaff: 0 };

function durationHours(a: Appointment): number {
  const ms = new Date(a.endTime).getTime() - new Date(a.startTime).getTime();
  return ms > 0 ? ms / 3_600_000 : 0;
}

// Billable work that counts toward utilization. Internal admin tasks and
// anything explicitly marked non-billable are excluded.
function isBillableWork(a: Appointment): boolean {
  return a.type !== 'internal-task' && a.isBillable !== false;
}

// Who the hours belong to. DIRECT service (a client-session a technician
// delivers) is BT work. Everything else billable is the BCBA's own — including
// supervision / parent-training / case-planning that NAME a supervised BT in the
// technician field (that tech is the observee, not the provider), so those never
// leak into BT direct hours.
export type UtilBucket = 'bt' | 'bcba';

const BCBA_SESSION_TYPES: ReadonlySet<Appointment['type']> = new Set([
  'supervision', 'parent-training', 'case-planning', 'reassessment',
]);

export function bucketOf(a: Appointment): UtilBucket | null {
  if (!isBillableWork(a)) return null;
  if (BCBA_SESSION_TYPES.has(a.type)) return 'bcba';
  // client-session / other: BT work when a technician delivers it.
  return a.technician ? 'bt' : 'bcba';
}

function statusOf(a: Appointment): keyof HoursByStatus {
  if (a.status === 'completed') return 'completed';
  if (a.status === 'canceled') return 'canceled';
  return 'scheduled';
}

// Sum hours for one bucket within [startMs, endMs), split by status.
export function rollupHours(
  appointments: Appointment[],
  startMs: number,
  endMs: number,
  bucket: UtilBucket,
): HoursByStatus {
  const out: HoursByStatus = { ...EMPTY };
  for (const a of appointments) {
    if (a.isGhost) continue; // ghosts are wished-for, never delivered — no hours
    const t = new Date(a.startTime).getTime();
    if (isNaN(t) || t < startMs || t >= endMs) continue;
    if (bucketOf(a) !== bucket) continue;
    const h = durationHours(a);
    const s = statusOf(a);
    if (s === 'canceled') {
      out.canceled += h;
      if (a.cancellation?.source === 'family') out.canceledFamily += h;
      else out.canceledStaff += h;
    } else {
      out[s] += h;
    }
  }
  return out;
}
