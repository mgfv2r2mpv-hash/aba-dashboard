// Deterministic parent-training placement (Phase 4) — chase every case to its
// monthly parent-training (PT / caregiver-training) HOURS goal by placing DATED
// `parent-training` sessions that overlap a real direct and name that direct's BT.
//
// PT is structurally simpler than supervision: a flat monthly hours gap, no
// cadence, no %-of-direct, no per-RBT dimension. The target is exactly the gap the
// Cases table already shows — `computeCaseState().parentTraining` (caseModel.ts):
//   goalMonth = client.parentTrainingMaxHours ?? settings.parentTraining.targetMinHours
//   gap       = max(0, goalMonth − deliveredThisMonth)
// Clients flagged `disablePTRequirements` are fully exempt (computeCaseState does
// NOT check that flag, so this pass must).
//
// Placement law: every builder-placed PT session overlaps a REAL dated direct
// (∩ BCBA availability, BCBA-free) and NAMES that direct's BT — so it earns
// double-duty supervision credit (countsAsSupervision returns true for
// parent-training when it names a tech, types.ts). `parentAvailableOutsideSessions`
// is a manual-scheduling notification-suppression flag and NEVER affects the
// builder — the builder always overlaps a direct. Runs AFTER supervision in a
// combined build, sharing the single materialized calendar + BCBA-busy plane so it
// never re-materializes directs or double-books the BCBA. Front-loaded (earliest
// direct-bearing weeks first) as a buffer against late cancellations. Claude never
// places anything; unit-tested in scripts/verify-builder-pt.ts.

import { ScheduleData, WishOp } from './types';
import { computeCaseState } from './caseModel';
import {
  DatedDirect, DirectCalendar, BcbaBusy,
  reserveBcba, HR_MS, MIN_SUP_HRS,
} from './builderBcba';
import { pickBestSlot, compareCandidateDirects } from './builderScoring';
import { buildTravelContext } from './travel';
import type { ClientBlock } from './scheduleBuilder';

// ── metrics ─────────────────────────────────────────────────────────────────────
export interface ParentTrainingMetrics {
  ptHrsPlaced: number;
  casesMeetingPtGoal: number;
  ptTargetCases: number;
}

export const EMPTY_PARENT_TRAINING_METRICS: ParentTrainingMetrics = {
  ptHrsPlaced: 0, casesMeetingPtGoal: 0, ptTargetCases: 0,
};

export interface ParentTrainingPlacement {
  ptOps: WishOp[];       // dated parent-training rows
  blocks: ClientBlock[]; // pt-availability (PT shortfall) blocks
  metrics: ParentTrainingMetrics;
  busyOut: BcbaBusy;     // the BCBA plane after this pass's reservations
}

// ── the pass ───────────────────────────────────────────────────────────────────
// Places parent training against the shared materialized `cal`, threading the BCBA
// plane `busyIn` → `busyOut`. Does NOT emit direct rows or re-materialize.
export function placeParentTraining(
  data: ScheduleData,
  cal: DirectCalendar,
  busyIn: BcbaBusy,
  now: Date,
): ParentTrainingPlacement {
  // Travel context — enforce BCBA drive time between differently-located sessions.
  const travelCtx = buildTravelContext(data);
  // Non-exempt cases that carry a PT target AND have directs to overlap, ordered
  // service-end cliff first then biggest gap (mirrors the supervision ordering so
  // scarce BCBA time serves the tightest case first). The `directs.length > 0` gate
  // mirrors the supervision pass (which only chases cases with directHoursMonth > 0):
  // computeCaseState defaults goalMonth to the company targetMinHours for EVERY
  // client, so without this an inactive/no-service roster client (no auth, no
  // directs) would become a phantom PT target and emit a spurious shortfall block.
  const entries = data.clients
    .filter(client => !client.disablePTRequirements && !client.archived)
    .map(client => {
      const cs = computeCaseState(data, client, now);
      const directs = cal.byClient.get(client.id) ?? [];
      return { client, cs, directs, goal: cs.parentTraining.goalMonth, gap: cs.parentTraining.gap };
    })
    .filter(e => e.goal > 0.01 && e.directs.length > 0);

  entries.sort((a, b) => {
    const ba = a.cs.cliffs.binding === 'service-end' ? 0 : 1;
    const bb = b.cs.cliffs.binding === 'service-end' ? 0 : 1;
    if (ba !== bb) return ba - bb;          // service-end cliff first
    return b.gap - a.gap;                   // biggest gap next
  });

  let bcbaBusy = busyIn;
  const ptOps: WishOp[] = [];
  const blocks: ClientBlock[] = [];
  let ptHrsPlaced = 0;
  let casesMeetingPtGoal = 0;
  const ptTargetCases = entries.length;

  for (const e of entries) {
    const { client, directs, gap } = e;
    let remaining = gap;

    // Already at goal, or a sub-schedulable residual (< a 15-min block) → done.
    if (remaining < MIN_SUP_HRS) { casesMeetingPtGoal++; continue; }

    // Candidate directs grouped by week; fill the gap greedily EARLIEST-week-first
    // (front-loaded buffer), one PT contact per week, each clamped to ≤ 2h by
    // placeBcbaSubinterval and to the remaining gap.
    const byWeek = new Map<number, DatedDirect[]>();
    for (const d of directs) {
      const arr = byWeek.get(d.weekIndex) ?? [];
      arr.push(d);
      byWeek.set(d.weekIndex, arr);
    }
    const weeks = [...byWeek.keys()].sort((a, b) => a - b);

    for (const wi of weeks) {
      // Stop once the remaining gap is below the minimum schedulable block:
      // placeBcbaSubinterval would round a sub-MIN request UP to MIN_SUP_HRS and
      // overshoot the goal — and since goalMonth == parentTrainingMaxHours when a
      // per-case max is set, that overshoot would breach the case cap (a
      // constraintValidator 'training-violation'). Requests ≥ MIN never overshoot.
      if (remaining < MIN_SUP_HRS) break;
      // Directs ranked by the scored comparator (no per-RBT dimension in PT →
      // zero btBehind, so travel adjacency / preferred daypart break ties and
      // start-time order is the final key — byte-identical to the old
      // start-time scan when travel is off and no hints exist). The slot inside
      // the winning direct is scored the same way. PT names that direct's BT.
      const ranked = (byWeek.get(wi) ?? []).slice()
        .sort((x, y) => compareCandidateDirects(x, y, { btBehind: () => 0, hints: client.schedulingHints, busy: bcbaBusy, ctx: travelCtx }));
      for (const d of ranked) {
        const slot = pickBestSlot(data, d, remaining, bcbaBusy, travelCtx, client.schedulingHints);
        if (!slot) continue;
        ptOps.push({ op: 'add', type: 'parent-training', client: client.name, technician: d.techName, start: slot.startIso, end: slot.endIso });
        bcbaBusy = reserveBcba(bcbaBusy, slot.startMs, slot.endMs, d.clientId);
        const hrs = (slot.endMs - slot.startMs) / HR_MS;
        remaining -= hrs;
        ptHrsPlaced += hrs;
        break; // one PT contact per week
      }
    }

    if (remaining < MIN_SUP_HRS) {
      casesMeetingPtGoal++;   // met, or the residual is too small to schedule
    } else {
      blocks.push({
        clientId: client.id, clientName: client.name,
        directGapRemaining: 0, bindingConstraint: 'pt-availability',
        ptGapRemaining: +remaining.toFixed(2),
        detail: `${client.name} is short ${remaining.toFixed(1)}h of parent training — no BCBA-free slot over a direct.`,
      });
    }
  }

  return {
    ptOps,
    blocks,
    metrics: {
      ptHrsPlaced: +ptHrsPlaced.toFixed(2),
      casesMeetingPtGoal, ptTargetCases,
    },
    busyOut: bcbaBusy,
  };
}
