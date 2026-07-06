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

import { ScheduleData, WishOp } from './types';
import { computeCaseState, computeBtState } from './caseModel';
import {
  DatedDirect, DirectCalendar, BcbaBusy,
  reserveBcba, placeBcbaSubinterval, contactsForCadence, cancellationRiskWeight, weeksForCadence, HR_MS,
} from './builderBcba';
import type { ClientBlock } from './scheduleBuilder';

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

// ── the pass ───────────────────────────────────────────────────────────────────
// Places supervision against the shared materialized `cal`, threading the BCBA
// plane `busyIn` → `busyOut`. Does NOT emit direct rows or re-materialize — the
// caller owns cal.directOps and adds cal.blocks once.
export function placeSupervision(
  data: ScheduleData,
  cal: DirectCalendar,
  busyIn: BcbaBusy,
  now: Date,
): SupervisionPlacement {
  const floorPct = data.settings.supervisionFloorPercent ?? 10;

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
  const entries = data.clients
    .map(client => {
      const directs = cal.byClient.get(client.id) ?? [];
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

    let placedForClient = 0;
    let contactsPlaced = 0;
    for (let k = 0; k < selectedWeeks.length; k++) {
      // Stop once BOTH the floor and the cadence count are satisfied (D1).
      const floorMetNow = existingSupH + placedForClient >= floorH - 0.01;
      const contactsMetNow = existingContacts + contactsPlaced >= requiredContacts;
      if (floorMetNow && contactsMetNow) break;

      const targetH = gapHrs * (weights[k] / wsum);
      // Prefer the direct whose BT is furthest behind their own floor (D4).
      const cands = (byWeek.get(selectedWeeks[k]) ?? []).slice().sort((x, y) => btBehind(y) - btBehind(x));
      for (const d of cands) {
        const slot = placeBcbaSubinterval(data, d, targetH, bcbaBusy);
        if (!slot) continue;
        supOps.push({ op: 'add', type: 'supervision', client: client.name, technician: d.techName, start: slot.startIso, end: slot.endIso });
        bcbaBusy = reserveBcba(bcbaBusy, slot.startMs, slot.endMs);
        const hrs = (slot.endMs - slot.startMs) / HR_MS;
        placedForClient += hrs;
        supervisionHrsPlaced += hrs;
        contactsPlaced++;
        if (d.techId) { const bs = btState.get(d.techId); if (bs) bs.placed += hrs; }
        break; // one contact per week
      }
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
