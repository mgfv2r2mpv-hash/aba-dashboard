// PTO buckets, accrual & balances (Upgrade 2).
//
// Two modes (CompanySettings.pto.mode):
//   'unlimited' — the app only tallies leave TAKEN (used hours); no accrual, no
//                 remaining balance, never blocks. The safe default, and the home
//                 for anyone whose real accrual rule isn't supported yet.
//   'accrual'   — also accrues hours over time and reports remaining = opening +
//                 accrued − used.
//
// Accrual kinds, all computed:
//   semimonthly       — fixed hours on the 1st and 15th of every month.
//   everyNWeeks       — fixed hours every N weeks on a weekday, from an anchor.
//   perConvertedHours — `hours` per `perHours` of CONVERTED billable hours, where
//                       "converted" = the BCBA's COMPLETED billable hours (a
//                       scheduled session that was delivered/billed). Balances
//                       therefore move as sessions are completed or reopened
//                       (unconverted).
//   perConvertedBonus — the per-converted base PLUS a bonus `bonusHours` once the
//                       converted total since the opening date clears the
//                       `bonusPerExtraHours` threshold. (A transparent reading of
//                       the "extra hours" reward; the interval/"M consecutive"
//                       cadence variant is a later refinement.)

import { PtoConfig, PtoBucket, AccrualRule, TimeOff, Appointment, DEFAULT_PTO_CONFIG, DATE_BASED_ACCRUALS, DayOfWeek } from './types';
import { rollupHours } from './utilization';

export function resolvePtoConfig(c?: PtoConfig): PtoConfig {
  if (!c) return { ...DEFAULT_PTO_CONFIG };
  return {
    mode: c.mode === 'accrual' ? 'accrual' : 'unlimited',
    buckets: c.buckets === 'separate' ? 'separate' : 'combined',
    unpaidEnabled: !!c.unpaidEnabled,
    accruals: c.accruals || [],
    openingBalances: c.openingBalances || [],
  };
}

// The buckets that actually hold hours under a given config, in display order.
export function activeBuckets(c: PtoConfig): PtoBucket[] {
  const paid: PtoBucket[] = c.buckets === 'separate' ? ['vacation', 'sick'] : ['combined'];
  return c.unpaidEnabled ? [...paid, 'unpaid'] : paid;
}

const PTO_BUCKET_LABEL: Record<PtoBucket, string> = {
  combined: 'PTO', vacation: 'Vacation', sick: 'Sick', unpaid: 'Unpaid',
};
export function ptoBucketLabel(b: PtoBucket): string { return PTO_BUCKET_LABEL[b] || 'PTO'; }

// Map a leave entry onto the canonical bucket for the current config, so entries
// tagged under a different scheme (e.g. 'vacation' while in combined mode) still
// land somewhere sensible.
export function canonicalBucket(entryBucket: PtoBucket | undefined, c: PtoConfig): PtoBucket {
  const active = activeBuckets(c);
  if (entryBucket && active.includes(entryBucket)) return entryBucket;
  if (entryBucket === 'unpaid') return c.unpaidEnabled ? 'unpaid' : (c.buckets === 'separate' ? 'vacation' : 'combined');
  // Paid leave with a non-matching tag folds into the primary paid bucket.
  if (c.buckets === 'separate') return entryBucket === 'sick' ? 'sick' : 'vacation';
  return 'combined';
}

// "YYYY-MM-DD" → local-midnight Date (null if unparseable).
function parseDay(s?: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
const DAY_MS = 86_400_000;
const WEEKDAY_INDEX: Record<DayOfWeek, number> = {
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6,
};

// The BCBA's CONVERTED hours in (since, asOf] — completed billable BCBA hours
// (a delivered/billed session). Drives the per-converted accrual kinds, so the
// number rises when a session is completed and falls when it's reopened.
export function convertedBcbaHours(appointments: Appointment[] | undefined, since: Date | null, asOf: Date): number {
  if (!appointments?.length) return 0;
  const sinceMs = since ? since.getTime() : -8.64e15; // ~ -Infinity, but a real ms
  return rollupHours(appointments, sinceMs, asOf.getTime(), 'bcba').completed;
}

// Hours a single rule grants in (since, asOf]. Date-based kinds use the calendar;
// the per-converted kinds use `convertedHours` (completed billable BCBA hours in
// the same window) supplied by the caller.
export function accruedForRule(rule: AccrualRule, since: Date | null, asOf: Date, convertedHours = 0): number {
  if (rule.enabled === false) return 0;
  const hours = Number(rule.hours);

  if (!DATE_BASED_ACCRUALS.includes(rule.kind)) {
    // perConvertedHours / perConvertedBonus.
    const per = Number(rule.perHours);
    let granted = (Number.isFinite(hours) && hours > 0 && Number.isFinite(per) && per > 0)
      ? Math.floor(convertedHours / per) * hours
      : 0;
    if (rule.kind === 'perConvertedBonus') {
      const bonus = Number(rule.bonusHours);
      const threshold = Number(rule.bonusPerExtraHours);
      if (Number.isFinite(bonus) && bonus > 0 && Number.isFinite(threshold) && threshold > 0 && convertedHours >= threshold) {
        granted += bonus;
      }
    }
    return granted;
  }

  if (!Number.isFinite(hours) || hours <= 0) return 0;
  const sinceMs = since ? since.getTime() : -Infinity;
  const asOfMs = asOf.getTime();

  if (rule.kind === 'semimonthly') {
    // Count the 1st and 15th in (since, asOf]. Walk months from the lower bound.
    let count = 0;
    const start = since ? new Date(since.getFullYear(), since.getMonth(), 1) : new Date(asOf.getFullYear(), asOf.getMonth(), 1);
    for (let y = start.getFullYear(), m = start.getMonth(); ; ) {
      for (const day of [1, 15]) {
        const t = new Date(y, m, day).getTime();
        if (t > sinceMs && t <= asOfMs) count++;
      }
      // advance a month
      m++; if (m > 11) { m = 0; y++; }
      if (new Date(y, m, 1).getTime() > asOfMs) break;
    }
    return count * hours;
  }

  // everyNWeeks: events on `anchor`, then every everyWeeks*7 days. If a weekday is
  // set, snap the anchor forward to that weekday first.
  const everyWeeks = Math.max(1, Math.floor(Number(rule.everyWeeks) || 1));
  let anchor = parseDay(rule.anchor);
  if (!anchor) return 0; // no anchor → can't place the cadence
  if (rule.weekday) {
    const want = WEEKDAY_INDEX[rule.weekday];
    const delta = (want - anchor.getDay() + 7) % 7;
    anchor = new Date(anchor.getTime() + delta * DAY_MS);
  }
  const stepMs = everyWeeks * 7 * DAY_MS;
  let count = 0;
  for (let t = anchor.getTime(); t <= asOfMs; t += stepMs) {
    if (t > sinceMs) count++;
  }
  return count * hours;
}

export interface BucketBalance {
  bucket: PtoBucket;
  used: number;                 // leave taken (always tracked)
  opening?: number;             // accrual mode only
  accrued?: number;             // accrual mode only
  remaining?: number;           // opening + accrued − used (accrual mode only)
}

// Per-bucket balances as of `asOf` (defaults to now). In unlimited mode only
// `used` is populated; in accrual mode opening/accrued/remaining are too.
// `appointments` feeds the per-converted accrual kinds (completed billable BCBA
// hours), so balances react to sessions being completed/reopened.
export function computePtoBalances(
  config: PtoConfig | undefined,
  timeOff: TimeOff[] | undefined,
  appointments?: Appointment[],
  asOf: Date = new Date(),
): BucketBalance[] {
  const c = resolvePtoConfig(config);
  const buckets = activeBuckets(c);
  const entries = timeOff || [];
  const asOfMs = asOf.getTime();

  return buckets.map(bucket => {
    let used = 0;
    for (const t of entries) {
      const d = parseDay(t.date);
      if (!d || d.getTime() > asOfMs) continue;
      if (canonicalBucket(t.bucket, c) !== bucket) continue;
      const v = Number(t.hours);
      if (Number.isFinite(v) && v > 0) used += v;
    }
    const out: BucketBalance = { bucket, used };
    if (c.mode !== 'accrual') return out;

    // Opening balance: latest opening for this bucket sets the accrual floor.
    const openings = (c.openingBalances || []).filter(o => o.bucket === bucket);
    const opening = openings.reduce((s, o) => s + (Number(o.hours) || 0), 0);
    const since = openings
      .map(o => parseDay(o.asOf))
      .filter((d): d is Date => !!d)
      .sort((a, b) => b.getTime() - a.getTime())[0] || null;
    const converted = convertedBcbaHours(appointments, since, asOf);

    const rules = (c.accruals || []).filter(r => r.bucket === bucket);
    const accrued = rules.reduce((s, r) => s + accruedForRule(r, since, asOf, converted), 0);

    out.opening = opening;
    out.accrued = accrued;
    out.remaining = opening + accrued - used;
    return out;
  });
}
