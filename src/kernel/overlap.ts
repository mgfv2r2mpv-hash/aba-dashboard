// The one absolute-time (epoch-ms) overlap test used everywhere sessions compete
// for a resource — a BCBA, a technician, or a client can't be in two places at
// once. Before the kernel, this exact idiom (`b.s < end && b.e > start`) was
// re-inlined in builderBcba, localSolver, wish, tidy, corrections, draftSolver,
// and fillSchedule with subtly independent copies; this is the single source.
//
// STRICT overlap: two intervals that merely TOUCH (aEnd === bStart) do NOT
// overlap — a session may start exactly when another ends. This boundary is
// load-bearing (back-to-back sessions, adjacent-fragment fusion) and is locked
// by src/builderBcba.test.ts + src/kernel/overlap.test.ts. Do not loosen it to
// `<=`/`>=` without updating those.

/** True when [aStart, aEnd) and [bStart, bEnd) strictly overlap (touching = false). */
export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}

/** True when [start, end) strictly overlaps any busy interval. */
export function overlapsAny(
  start: number,
  end: number,
  busy: ReadonlyArray<{ s: number; e: number }>,
): boolean {
  return busy.some(b => overlaps(start, end, b.s, b.e));
}
