// windows — the shared feasible-window geometry for direct-service placement.
//
// Two callers answer "when could this client be seen, and by which BT?": the live
// builder (builderOccupancy.feasibleWindowsLive, reading a MUTABLE occupancy that
// grows as it places) and the static single-snapshot resolver
// (fillSchedule.feasibleDirectWindows, RESCANNING the schedule each call). They
// differ only in where "busy" comes from and how a BT is keyed (occ-by-name vs
// scan-by-id) — the interval geometry between them is identical. That geometry
// lives here so the two can never silently drift apart.

import { Interval, MIN_SLOT_MINS, intersect, subtract } from '../intervals';

export interface WindowTech {
  id: string;
  name: string;
}

// One BT's availability + occupancy for a single client-day, already resolved by
// the caller (occupancy lookup vs schedule rescan). An empty caseAvail means the
// BT can't take this client that day and is skipped.
export interface TechFeasibility {
  tech: WindowTech;
  caseAvail: Interval[]; // this BT's case availability for the client/day
  busy: Interval[]; // this BT's booked intervals that day (minutes-of-day)
}

// An open window (minutes-of-day) with the BTs free for its whole span.
export interface WindowSlot {
  start: number;
  end: number;
  techs: WindowTech[];
}

// client availability ∩ each BT's case availability − (clientBusy ∪ that BT's
// busy), keeping only spans ≥ MIN_SLOT_MINS, grouped so each distinct window lists
// every BT who can cover it end-to-end. Pure geometry: no schedule, occupancy, or
// blackout knowledge — callers resolve those and pass the resulting intervals in.
// BTs are visited in the given order and windows are emitted in first-seen order
// (callers that need a stable ordering sort the result themselves).
export function computeWindowSlots(
  clientAvail: Interval[],
  clientBusy: Interval[],
  techs: TechFeasibility[],
): WindowSlot[] {
  if (clientAvail.length === 0) return [];

  const windowTechs = new Map<string, WindowTech[]>(); // `${start}-${end}` → techs
  for (const t of techs) {
    if (t.caseAvail.length === 0) continue;
    let free = intersect(clientAvail, t.caseAvail);
    free = subtract(free, [...clientBusy, ...t.busy]);
    for (const seg of free) {
      if (seg.end - seg.start < MIN_SLOT_MINS) continue;
      const key = `${seg.start}-${seg.end}`;
      const arr = windowTechs.get(key) ?? [];
      arr.push(t.tech);
      windowTechs.set(key, arr);
    }
  }

  const out: WindowSlot[] = [];
  for (const [key, techs] of windowTechs) {
    const [start, end] = key.split('-').map(Number);
    out.push({ start, end, techs });
  }
  return out;
}
