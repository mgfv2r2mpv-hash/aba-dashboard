// Shared direct-session sizing rule + its bounds — the one place the two
// greedy direct-placement engines agree on.
//
// `buildSchedule` (whole-caseload recurring backbone, live mutable occupancy,
// capacity-aware tech pick) and `solveMeetPace` (single case, current week,
// single-shot windows, techs[0]) have deliberately different placement LOOPS —
// their occupancy models don't unify without changing behavior. But both size an
// individual block the same way and share the same min/max session bounds; those
// were copy-pasted constants (identical value AND comment) in each file, a silent
// divergence hazard if one were ever retuned. This module is that shared core;
// the min-session guard stays at each call site because it drives loop control
// (skip/continue), not sizing. Locked by src/kernel/placement.test.ts and, at the
// engine level, by src/localSolver.meetpace.test.ts + scripts/verify-builder.ts.

/** Largest single direct block we place — also forces day-spread across a week. */
export const MAX_DIRECT_SESSION_HRS = 4;

/** Smallest session worth placing; remainders below this are ignored. */
export const MIN_SESSION_HRS = 0.5;

/**
 * Hours for the next direct block: the largest session that fits the open
 * window (`capHrs`), doesn't overshoot the remaining need (`gapHrs`), and stays
 * within the per-session ceiling (`maxSessionHrs`, default MAX_DIRECT_SESSION_HRS
 * — callers may lower it via a per-case override). Callers still guard the result
 * against MIN_SESSION_HRS before placing.
 */
export function directBlockHours(
  capHrs: number,
  gapHrs: number,
  maxSessionHrs: number = MAX_DIRECT_SESSION_HRS,
): number {
  return Math.min(capHrs, gapHrs, maxSessionHrs);
}
