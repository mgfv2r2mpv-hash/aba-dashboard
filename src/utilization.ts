import { Appointment, UtilizationSettings } from './types';

// Company defaults; overridable in Admin → Settings.
export const DEFAULT_UTILIZATION: Required<UtilizationSettings> = {
  bcbaWeeklyBillableHours: 25,
  btWeeklyDirectHours: 165,
  bcbaMonthlyBillableHours: 100,
  bcbaMonthlyBillableHours5Week: 125,
};

export function resolveUtilization(u?: UtilizationSettings): Required<UtilizationSettings> {
  return {
    bcbaWeeklyBillableHours: u?.bcbaWeeklyBillableHours ?? DEFAULT_UTILIZATION.bcbaWeeklyBillableHours,
    btWeeklyDirectHours: u?.btWeeklyDirectHours ?? DEFAULT_UTILIZATION.btWeeklyDirectHours,
    bcbaMonthlyBillableHours: u?.bcbaMonthlyBillableHours ?? DEFAULT_UTILIZATION.bcbaMonthlyBillableHours,
    bcbaMonthlyBillableHours5Week: u?.bcbaMonthlyBillableHours5Week ?? DEFAULT_UTILIZATION.bcbaMonthlyBillableHours5Week,
  };
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

// Who the hours belong to: an appointment assigned to a technician is BT direct
// work; one with no technician (supervision, BCBA-run parent training, etc.) is
// BCBA billable time.
export type UtilBucket = 'bt' | 'bcba';

export function bucketOf(a: Appointment): UtilBucket | null {
  if (!isBillableWork(a)) return null;
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
