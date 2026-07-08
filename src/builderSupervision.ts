// Deterministic supervision placement (Phase 3) — chase every case to its monthly
// supervision floor AND cadence contact count, and every RBT to its own floor, by
// placing DATED supervision sessions that overlap real direct sessions and name
// the supervising BT (the exact credit law in src/compliance.ts + src/caseModel.ts).
//
// `placeSupervision` receives an already-MATERIALIZED direct calendar and the
// current single-BCBA-busy plane (built once by buildSchedule, shared with the
// parent-training pass) and returns the supervision ops it placed plus the grown
// busy plane. The calendar materialization + BCBA primitives live in builderBcba.ts.
// Claude never places anything — this is pure and deterministic, unit-tested in
// scripts/verify-builder-sup.ts.

import { ScheduleData, WishOp, SupervisionCadence } from './types';
import { computeCaseState, computeBtState } from './caseModel';
import {
  DatedDirect, DirectCalendar, BcbaBusy,
  reserveBcba, contactsForCadence, cancellationRiskWeight, weeksForCadence, HR_MS, MIN_SUP_HRS,
} from './builderBcba';
import { pickBestSlot, compareCandidateDirects, SlotCandidate } from './builderScoring';
import { buildTravelContext } from './travel';
import { v4 as uuidv4 } from 'uuid';
import type { ClientBlock } from './scheduleBuilder';

// A builder-placed supervision series is a soft weekly cadence; EOW cases group as
// biweekly. The pattern only annotates the series (enables extendSeries cadence
// inference) — the seriesId alone unlocks the This/Following/All editor.
function cadencePattern(cadence?: SupervisionCadence): 'weekly' | 'biweekly' | 'monthly' {
  return cadence === 'EOW' ? 'biweekly' : 'weekly';
}

// Re-export the primitives the verify harness imports from here, so
// scripts/verify-builder-sup.ts keeps resolving unchanged after the extraction.
export { weeksForCadence, cancellationRiskWeight, isBcbaFree, reserveBcba, expandDirectOccurrences } from './builderBcba';

// ── metrics ─────────────────────────────────────────────────────────────────────
export interface SupervisionMetrics {
  supervisionHrsPlaced: number;
  casesMeetingFloor: number;
  floorTargetCases: number;
  rbtsMeetingFloor: number;
  rbtFloorTargets: number;
}

export const EMPTY_SUPERVISION_METRICS: SupervisionMetrics = {
  supervisionHrsPlaced: 0, casesMeetingFloor: 0, floorTargetCases: 0, rbtsMeetingFloor: 0, rbtFloorTargets: 0,
};

export interface SupervisionPlacement {
  supOps: WishOp[];      // dated supervision rows
  blocks: ClientBlock[]; // bcba-availability (supervision shortfall) blocks
  metrics: SupervisionMetrics;
  busyOut: BcbaBusy;     // the BCBA plane after this pass's reservations (thread into the next pass)
}

export interface SupervisionOptions {
  // A standalone "Add supervision" build (chaseDirect:false) must host supervision
  // ONLY over directs already on the board (materialized:false) and must never
  // fabricate a session over a projected/phantom future direct that won't be
  // committed — the exact off-direct/0-credit bug from device testing. A combined
  // build (chaseDirect:true) emits its materialized hosts concretely, so those are
  // valid to host over.
  buildingDirects: boolean;
  // Caller-owned map of clientId → the supervision seriesId this pass minted, so a
  // later fill pass can extend the SAME editable series for a case.
  caseSeriesId?: Map<string, string>;
}

// ── the pass ───────────────────────────────────────────────────────────────────
// Places supervision against the shared materialized `cal`, threading the BCBA
// plane `busyIn` → `busyOut`. Does NOT emit direct rows or re-materialize — the
// caller owns cal.directOps and adds cal.blocks once.
export function placeSupervision(
  data: ScheduleData,
  cal: DirectCalendar,
  busyIn: BcbaBusy,
  now: Date,
  opts: SupervisionOptions = { buildingDirects: true },
): SupervisionPlacement {
  const { buildingDirects } = opts;
  const caseSeriesId = opts.caseSeriesId ?? new Map<string, string>();
  const floorPct = data.settings.supervisionFloorPercent ?? 10;
  // Travel context (city centroids + routed cache) — enforces drive time between
  // the single BCBA's differently-located sessions. Self-disables when travel is off.
  const travelCtx = buildTravelContext(data);

  // Per-RBT floor state for D4 double-duty selection. computeBtState supplies the
  // required % and the existing supervision credit, but its direct-hours
  // denominator reads the UNMATERIALIZED data (understated the same ~4× the
  // per-client floor was corrected for) — so recompute each RBT's required hours
  // from the MATERIALIZED calendar. Otherwise every gap is ~0 on a fresh build and
  // "furthest behind" silently degrades to day-of-week order.
  const matDirectByTech = new Map<string, number>();
  for (const arr of cal.byClient.values()) {
    for (const d of arr) if (d.techId) matDirectByTech.set(d.techId, (matDirectByTech.get(d.techId) ?? 0) + d.hours);
  }
  const btState = new Map<string, { gapToRequired: number; placed: number; isTarget: boolean }>();
  for (const t of data.technicians) {
    const st = computeBtState(data, t, now);
    const matDirect = matDirectByTech.get(t.id) ?? 0;
    const requiredH = (matDirect * st.requiredPct) / 100;
    btState.set(t.id, {
      gapToRequired: Math.max(0, requiredH - st.supHoursMonth),
      placed: 0,
      isTarget: st.requiredPct > 0 && matDirect > 0.01,
    });
  }
  const btBehind = (d: DatedDirect): number => {
    if (!d.techId) return -1;
    const bs = btState.get(d.techId);
    if (!bs || !bs.isTarget) return 0;
    return Math.max(0, bs.gapToRequired - bs.placed);
  };

  // Cases that actually have directs to supervise, ordered riskiest/tightest first.
  // Archived cases are off the caseload — skip even if this month still holds
  // pre-archive directs (those don't earn new supervision).
  const entries = data.clients
    .filter(client => !client.archived)
    .map(client => {
      // Host set. A standalone supervision build (chaseDirect:false) supervises only
      // over directs already concrete on the board — never a projected/phantom future
      // occurrence whose direct row won't be committed (the off-direct/0-credit bug).
      const allDirects = cal.byClient.get(client.id) ?? [];
      const directs = buildingDirects ? allDirects : allDirects.filter(d => !d.materialized);
      const directHoursMonth = directs.reduce((s, d) => s + d.hours, 0);
      const cs = computeCaseState(data, client, now);
      return {
        client, cs, directs, directHoursMonth,
        floorH: (directHoursMonth * floorPct) / 100,
        risk: cancellationRiskWeight(client),
      };
    })
    .filter(e => e.directHoursMonth > 0.01);

  entries.sort((a, b) => {
    const ba = a.cs.cliffs.binding === 'service-end' ? 0 : 1;
    const bb = b.cs.cliffs.binding === 'service-end' ? 0 : 1;
    if (ba !== bb) return ba - bb;                       // service-end cliff first
    if (Math.abs(b.floorH - a.floorH) > 0.01) return b.floorH - a.floorH; // biggest floor next
    return b.risk - a.risk;                              // riskiest next
  });

  let bcbaBusy = busyIn;
  const supOps: WishOp[] = [];
  const blocks: ClientBlock[] = [];
  let supervisionHrsPlaced = 0;
  let casesMeetingFloor = 0;
  const floorTargetCases = entries.length;

  for (const e of entries) {
    const { client, cs, directs, floorH, risk } = e;
    const requiredContacts = cs.supervision.contactsRequiredByCadence ?? contactsForCadence(client.cadenceGoal) ?? 0;
    const existingSupH = cs.supervision.supHoursMonth;      // already-scheduled supervision (projected)
    const existingContacts = cs.supervision.contactsThisMonth;
    const gapHrs = Math.max(0, floorH - existingSupH);

    // Already compliant on both fronts → nothing to chase.
    if (gapHrs < 0.01 && existingContacts >= requiredContacts) { casesMeetingFloor++; continue; }

    // Candidate directs grouped by week.
    const byWeek = new Map<number, DatedDirect[]>();
    for (const d of directs) {
      const arr = byWeek.get(d.weekIndex) ?? [];
      arr.push(d);
      byWeek.set(d.weekIndex, arr);
    }
    const availableWeeks = [...byWeek.keys()].sort((a, b) => a - b);
    const selectedWeeks = weeksForCadence(client.cadenceGoal, availableWeeks, risk);

    // Front-loaded per-contact target sizing: each contact ∝ its week's direct
    // hours (D1: "sized to the direct it's accountable for"), biased earlier by risk.
    const n = selectedWeeks.length;
    const weekHrs = (wi: number) => (byWeek.get(wi) ?? []).reduce((s, d) => s + d.hours, 0);
    const weights = selectedWeeks.map((wi, k) => weekHrs(wi) * (1 + risk * (n > 1 ? (n - 1 - k) / (n - 1) : 0)));
    const wsum = weights.reduce((s, w) => s + w, 0) || 1;

    const hints = client.schedulingHints;
    const style = hints?.supervisionStyle ?? 'auto';
    let placedForClient = 0;
    let contactsPlaced = 0;

    // One editable series per case: every supervision this build places for the case
    // shares a seriesId (+ weekly/biweekly pattern) so the calendar's This/Following/
    // All editor groups them instead of forcing one-by-one edits.
    const seriesId = uuidv4();
    caseSeriesId.set(client.id, seriesId);
    const pattern = cadencePattern(client.cadenceGoal);

    // Commit one placed sub-slot on host direct `d` (shared by whole + split paths).
    const commitSlot = (d: DatedDirect, slot: SlotCandidate): number => {
      supOps.push({ op: 'add', type: 'supervision', client: client.name, technician: d.techName, start: slot.startIso, end: slot.endIso, seriesId, recurring: true, pattern });
      bcbaBusy = reserveBcba(bcbaBusy, slot.startMs, slot.endMs, d.clientId);
      const hrs = (slot.endMs - slot.startMs) / HR_MS;
      placedForClient += hrs;
      supervisionHrsPlaced += hrs;
      if (d.techId) { const bs = btState.get(d.techId); if (bs) bs.placed += hrs; }
      return hrs;
    };
    const dayKey = (ms: number) => { const dd = new Date(ms); return `${dd.getFullYear()}-${dd.getMonth()}-${dd.getDate()}`; };

    for (let k = 0; k < selectedWeeks.length; k++) {
      // Stop once BOTH the floor and the cadence count are satisfied (D1).
      const floorMetNow = existingSupH + placedForClient >= floorH - 0.01;
      const contactsMetNow = existingContacts + contactsPlaced >= requiredContacts;
      if (floorMetNow && contactsMetNow) break;

      const targetH = gapHrs * (weights[k] / wsum);
      // D4 stays the PRIMARY direct key (furthest-behind BT); taught preferences
      // (travel adjacency, preferred daypart) only break its ties.
      const cands = (byWeek.get(selectedWeeks[k]) ?? []).slice()
        .sort((x, y) => compareCandidateDirects(x, y, { btBehind, hints, busy: bcbaBusy, ctx: travelCtx }));
      let placedWeek = false;

      // ── one whole contact (auto default / explicit consolidate) ──────────────
      if (style !== 'split') {
        // Whole-fit pass: the first direct (D4 order) able to host the FULL
        // contact wins — never silently truncate when another direct has room.
        for (const d of cands) {
          const slot = pickBestSlot(data, d, targetH, bcbaBusy, travelCtx, hints);
          if (slot?.fitsWhole) { commitSlot(d, slot); placedWeek = true; break; }
        }
        // Explicit 'consolidate' keeps the one-block-even-if-short behavior
        // (the owner asked for a single visit; a residual shows in the block).
        if (!placedWeek && style === 'consolidate') {
          for (const d of cands) {
            const slot = pickBestSlot(data, d, targetH, bcbaBusy, travelCtx, hints);
            if (slot) { commitSlot(d, slot); placedWeek = true; break; }
          }
        }
      }

      // ── two shorter visits (hinted split, or auto when nothing fits whole) ───
      // The AB pattern: a client whose directs straddle busy dayparts is easier
      // to reach with two sub-contacts than one long block. Also recovers hours
      // the old first-fit silently truncated (gap shorter than target).
      if (!placedWeek && style !== 'consolidate' && targetH >= 2 * MIN_SUP_HRS) {
        const firstH = style === 'split' ? targetH / 2 : targetH;
        let first: { d: DatedDirect; hrs: number } | null = null;
        for (const d of cands) {
          const slot = pickBestSlot(data, d, firstH, bcbaBusy, travelCtx, hints);
          if (!slot) continue;
          first = { d, hrs: commitSlot(d, slot) };
          break;
        }
        if (first) {
          placedWeek = true;
          const remaining = targetH - first.hrs;
          if (remaining >= MIN_SUP_HRS) {
            // Second visit prefers a DIFFERENT day, then a different direct on
            // the same day, then (last resort) the first direct's leftover room
            // (freeGaps re-run against the grown busy plane handles that).
            const firstDay = dayKey(first.d.startMs);
            const ordered = [
              ...cands.filter(d => dayKey(d.startMs) !== firstDay),
              ...cands.filter(d => dayKey(d.startMs) === firstDay && d !== first!.d),
              first.d,
            ];
            for (const d of ordered) {
              const slot = pickBestSlot(data, d, remaining, bcbaBusy, travelCtx, hints);
              if (!slot) continue;
              commitSlot(d, slot);
              break;
            }
          }
        }
      }

      // Last resort (auto with a sub-2×MIN target, or a lone short gap): the
      // best single truncated block — the legacy behavior.
      if (!placedWeek) {
        for (const d of cands) {
          const slot = pickBestSlot(data, d, targetH, bcbaBusy, travelCtx, hints);
          if (slot) { commitSlot(d, slot); placedWeek = true; break; }
        }
      }

      // A split week still counts ONE cadence touchpoint: cadence is a weekly
      // pacing floor. The dashboard (countCaseContacts) counts distinct DAYS, so
      // a cross-day split can only overshoot the required minimum — never under.
      if (placedWeek) contactsPlaced++;
    }

    const totalSupH = existingSupH + placedForClient;
    const totalContacts = existingContacts + contactsPlaced;
    const floorMet = totalSupH >= floorH - 0.01;
    const contactsMet = totalContacts >= requiredContacts;
    if (floorMet && contactsMet) {
      casesMeetingFloor++;
    } else {
      const gap = Math.max(0, floorH - totalSupH);
      const contactShort = Math.max(0, requiredContacts - totalContacts);
      const parts = [];
      if (gap > 0.01) parts.push(`${gap.toFixed(1)}h`);
      if (contactShort > 0) parts.push(`${contactShort} contact${contactShort === 1 ? '' : 's'}`);
      blocks.push({
        clientId: client.id, clientName: client.name,
        directGapRemaining: 0, bindingConstraint: 'bcba-availability',
        supervisionGapRemaining: +gap.toFixed(2),
        detail: `${client.name} is short ${parts.join(' + ')} of supervision — the BCBA has no free, in-availability slot over a direct.`,
      });
    }
  }

  // Per-RBT floor outcome (D4).
  let rbtsMeetingFloor = 0;
  let rbtFloorTargets = 0;
  for (const bs of btState.values()) {
    if (!bs.isTarget) continue;
    rbtFloorTargets++;
    if (bs.gapToRequired - bs.placed <= 0.01) rbtsMeetingFloor++;
  }

  return {
    supOps,
    blocks,
    metrics: {
      supervisionHrsPlaced: +supervisionHrsPlaced.toFixed(2),
      casesMeetingFloor, floorTargetCases, rbtsMeetingFloor, rbtFloorTargets,
    },
    busyOut: bcbaBusy,
  };
}
