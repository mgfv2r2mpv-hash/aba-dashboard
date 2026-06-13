// Company defaults; overridable in Admin → Settings.
export const DEFAULT_UTILIZATION = {
    bcbaWeeklyBillableHours: 25,
    btWeeklyDirectHours: 165,
    bcbaMonthlyBillableHours: 100,
    bcbaMonthlyBillableHours5Week: 125,
    bcbaWeeklyBillableMin: 25,
};
export function resolveUtilization(u) {
    const weekly = u?.bcbaWeeklyBillableHours ?? DEFAULT_UTILIZATION.bcbaWeeklyBillableHours;
    return {
        bcbaWeeklyBillableHours: weekly,
        btWeeklyDirectHours: u?.btWeeklyDirectHours ?? DEFAULT_UTILIZATION.btWeeklyDirectHours,
        bcbaMonthlyBillableHours: u?.bcbaMonthlyBillableHours ?? DEFAULT_UTILIZATION.bcbaMonthlyBillableHours,
        bcbaMonthlyBillableHours5Week: u?.bcbaMonthlyBillableHours5Week ?? DEFAULT_UTILIZATION.bcbaMonthlyBillableHours5Week,
        // Floor defaults to the weekly target when unset.
        bcbaWeeklyBillableMin: u?.bcbaWeeklyBillableMin ?? weekly,
    };
}
const EMPTY = { completed: 0, scheduled: 0, canceled: 0, canceledFamily: 0, canceledStaff: 0 };
function durationHours(a) {
    const ms = new Date(a.endTime).getTime() - new Date(a.startTime).getTime();
    return ms > 0 ? ms / 3600000 : 0;
}
// Billable work that counts toward utilization. Internal admin tasks and
// anything explicitly marked non-billable are excluded.
function isBillableWork(a) {
    return a.type !== 'internal-task' && a.isBillable !== false;
}
export function bucketOf(a) {
    if (!isBillableWork(a))
        return null;
    return a.technician ? 'bt' : 'bcba';
}
function statusOf(a) {
    if (a.status === 'completed')
        return 'completed';
    if (a.status === 'canceled')
        return 'canceled';
    return 'scheduled';
}
// Sum hours for one bucket within [startMs, endMs), split by status.
export function rollupHours(appointments, startMs, endMs, bucket) {
    const out = { ...EMPTY };
    for (const a of appointments) {
        if (a.isGhost)
            continue; // ghosts are wished-for, never delivered — no hours
        const t = new Date(a.startTime).getTime();
        if (isNaN(t) || t < startMs || t >= endMs)
            continue;
        if (bucketOf(a) !== bucket)
            continue;
        const h = durationHours(a);
        const s = statusOf(a);
        if (s === 'canceled') {
            out.canceled += h;
            if (a.cancellation?.source === 'family')
                out.canceledFamily += h;
            else
                out.canceledStaff += h;
        }
        else {
            out[s] += h;
        }
    }
    return out;
}
//# sourceMappingURL=utilization.js.map