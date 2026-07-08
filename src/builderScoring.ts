// Deterministic slot scoring for BCBA-touch placement (supervision / PT).
//
// The passes used to be pure FIRST-FIT: earliest clinician window, earliest
// BCBA-free gap, anchored at gap start — no scheduler judgment. This module
// turns each placement into a scored choice over the same feasibility geometry
// (freeGaps / clinicianWindowsForDate from builderBcba — scoring must NEVER
// relax feasibility, only rank within it).
//
// Ranking is LEXICOGRAPHIC, not weighted — deterministic and explainable:
//   ① fits the whole requested contact (consolidation: don't silently truncate)
//   ② longer placed duration (only differentiates truncated candidates —
//      recover as many hours as the week allows)
//   ③ least added drive time vs. the BCBA's existing route that day
//   ④ preferred-daypart match (only when the client hints one)
//   ⑤ earlier start (stability tiebreak — reduces churn between builds)
// With no travel context and no hints this degenerates to first-fit whenever
// the first gap fits whole — which is why the pre-existing fixtures hold.
//
// Per-client `schedulingHints` (types.ts) modulate the choice; they are the
// owner's taught scheduler knowledge (e.g. "mid-day client AB does better as
// two shorter visits wedged between nearby sessions").

import { ScheduleData, SchedulingHints, Daypart } from './types';
import {
  DatedDirect, BcbaBusy, MIN_SUP_HRS, MAX_SUP_HRS, HR_MS,
  isoLocal, freeGaps, clinicianWindowsForDate,
} from './builderBcba';
import { travelMinutes, TravelContext, LocKey, HOME_KEY } from './travel';

// Daypart bands in local minutes-of-day. Deliberately gapped before 06:00 and
// after 21:00 — placements out there match no daypart preference.
export const DAYPART_BANDS: Record<Daypart, { start: number; end: number }> = {
  morning: { start: 6 * 60, end: 11 * 60 },
  midday: { start: 11 * 60, end: 14 * 60 },
  afternoon: { start: 14 * 60, end: 17 * 60 },
  evening: { start: 17 * 60, end: 21 * 60 },
};

export function daypartOfMs(ms: number): Daypart | undefined {
  const d = new Date(ms);
  const mins = d.getHours() * 60 + d.getMinutes();
  for (const [part, band] of Object.entries(DAYPART_BANDS) as [Daypart, { start: number; end: number }][]) {
    if (mins >= band.start && mins < band.end) return part;
  }
  return undefined;
}

export interface SlotCandidate {
  startMs: number;
  endMs: number;
  startIso: string;
  endIso: string;
  /** The gap could host the WHOLE clamped request (no truncation). */
  fitsWhole: boolean;
  /** Whole minutes of drive the slot adds to the BCBA's existing day route. */
  addedTravelMin: number;
  /** Slot midpoint falls inside the client's preferred daypart. */
  daypartMatch: boolean;
}

const sameLocalDay = (a: number, b: number): boolean => {
  const da = new Date(a), db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
};

// Whole minutes of drive this slot ADDS to the day's route: the BCBA comes from
// the nearest earlier same-day block (or HOME when the day starts here) and
// continues to the nearest later same-day block (or HOME) — the detour is
// prev→here + here→next − prev→next. Clamped ≥ 0 (triangle inequality can be
// violated by the flat within-city floor). Zero without a travel context.
export function addedTravelMinutes(
  busy: BcbaBusy, loc: LocKey, slot: { startMs: number; endMs: number }, ctx?: TravelContext,
): number {
  if (!ctx || !ctx.settings.enabled) return 0;
  let prev: { e: number; loc?: LocKey } | undefined;
  let next: { s: number; loc?: LocKey } | undefined;
  for (const b of busy) {
    if (b.e <= slot.startMs && sameLocalDay(b.e, slot.startMs) && (!prev || b.e > prev.e)) prev = b;
    if (b.s >= slot.endMs && sameLocalDay(b.s, slot.startMs) && (!next || b.s < next.s)) next = b;
  }
  const prevLoc: LocKey = prev ? prev.loc : HOME_KEY;
  const nextLoc: LocKey = next ? next.loc : HOME_KEY;
  const detour =
    travelMinutes(prevLoc, loc, slot.startMs, ctx)
    + travelMinutes(loc, nextLoc, slot.endMs, ctx)
    - travelMinutes(prevLoc, nextLoc, slot.startMs, ctx);
  return Math.max(0, Math.round(detour));
}

// All feasible slot candidates of ~desiredH inside direct `d` — the exact
// geometry of placeBcbaSubinterval (windows ∩ direct ∩ freeGaps, clamped
// MIN/MAX), but collected instead of first-returned. When the client prefers a
// daypart, a gap that spans into the preferred band additionally yields a
// band-anchored candidate (e.g. a 09:00–13:00 gap offers an 11:00 start for a
// midday-preferring case, not just 09:00).
export function enumerateBcbaSlots(
  data: ScheduleData, d: DatedDirect, desiredH: number, busy: BcbaBusy,
  ctx?: TravelContext, hints?: SchedulingHints,
): SlotCandidate[] {
  const desMs = Math.max(MIN_SUP_HRS, Math.min(desiredH, MAX_SUP_HRS)) * HR_MS;
  const minMs = MIN_SUP_HRS * HR_MS;
  const out: SlotCandidate[] = [];
  const day0 = new Date(d.startMs); day0.setHours(0, 0, 0, 0);
  const band = hints?.preferredDaypart ? DAYPART_BANDS[hints.preferredDaypart] : undefined;
  const bandStartMs = band ? day0.getTime() + band.start * 60_000 : undefined;

  const push = (startMs: number, gapEnd: number) => {
    const endMs = Math.min(gapEnd, startMs + desMs);
    if (endMs - startMs < minMs) return;
    const slot = { startMs, endMs };
    out.push({
      ...slot,
      startIso: isoLocal(new Date(startMs)),
      endIso: isoLocal(new Date(endMs)),
      fitsWhole: endMs - startMs >= desMs,
      addedTravelMin: addedTravelMinutes(busy, d.clientId, slot, ctx),
      daypartMatch: daypartOfMs((startMs + endMs) / 2) === hints?.preferredDaypart && !!hints?.preferredDaypart,
    });
  };

  for (const w of clinicianWindowsForDate(data, new Date(d.startMs))) {
    const segS = Math.max(d.startMs, w.s);
    const segE = Math.min(d.endMs, w.e);
    if (segE - segS < minMs) continue;
    for (const g of freeGaps(segS, segE, busy, d.clientId, ctx)) {
      if (g.e - g.s < minMs) continue;
      push(g.s, g.e);
      // Band-anchored alternative inside the same gap.
      if (bandStartMs !== undefined && bandStartMs > g.s && bandStartMs < g.e) push(bandStartMs, g.e);
    }
  }
  return out;
}

// Lexicographic candidate order (see module header). Exported for tests.
export function compareSlots(a: SlotCandidate, b: SlotCandidate): number {
  if (a.fitsWhole !== b.fitsWhole) return a.fitsWhole ? -1 : 1;
  const durA = a.endMs - a.startMs, durB = b.endMs - b.startMs;
  if (durA !== durB) return durB - durA;
  if (a.addedTravelMin !== b.addedTravelMin) return a.addedTravelMin - b.addedTravelMin;
  if (a.daypartMatch !== b.daypartMatch) return a.daypartMatch ? -1 : 1;
  return a.startMs - b.startMs;
}

// The best slot of ~desiredH inside direct `d`, or null when none ≥ MIN fits.
// Drop-in scored sibling of placeBcbaSubinterval.
export function pickBestSlot(
  data: ScheduleData, d: DatedDirect, desiredH: number, busy: BcbaBusy,
  ctx?: TravelContext, hints?: SchedulingHints,
): SlotCandidate | null {
  const cands = enumerateBcbaSlots(data, d, desiredH, busy, ctx, hints);
  if (cands.length === 0) return null;
  cands.sort(compareSlots);
  return cands[0];
}

// Candidate-DIRECT comparator for a week's hosts. The per-RBT floor need
// (btBehind, D4) stays the untouched PRIMARY key — the taught preferences only
// break its ties: nearer the day's route first, then preferred-daypart span,
// then earliest start (the previous implicit stable-sort behavior).
export function compareCandidateDirects(
  a: DatedDirect, b: DatedDirect,
  args: { btBehind: (d: DatedDirect) => number; hints?: SchedulingHints; busy: BcbaBusy; ctx?: TravelContext },
): number {
  const behindA = args.btBehind(a), behindB = args.btBehind(b);
  if (behindA !== behindB) return behindB - behindA;
  if (args.ctx) {
    const travA = addedTravelMinutes(args.busy, a.clientId, { startMs: a.startMs, endMs: a.endMs }, args.ctx);
    const travB = addedTravelMinutes(args.busy, b.clientId, { startMs: b.startMs, endMs: b.endMs }, args.ctx);
    if (travA !== travB) return travA - travB;
  }
  const band = args.hints?.preferredDaypart ? DAYPART_BANDS[args.hints.preferredDaypart] : undefined;
  if (band) {
    const spans = (d: DatedDirect) => {
      const day0 = new Date(d.startMs); day0.setHours(0, 0, 0, 0);
      const bs = day0.getTime() + band.start * 60_000, be = day0.getTime() + band.end * 60_000;
      return d.startMs < be && d.endMs > bs ? 1 : 0;
    };
    const spanA = spans(a), spanB = spans(b);
    if (spanA !== spanB) return spanB - spanA;
  }
  return a.startMs - b.startMs;
}
