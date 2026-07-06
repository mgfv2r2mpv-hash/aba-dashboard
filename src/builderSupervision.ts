// Deterministic supervision pass (Phase 3) — chase every case to its monthly
// supervision floor AND cadence contact count, and every RBT to its own floor,
// by placing DATED supervision sessions that overlap real direct sessions and
// name the supervising BT (the exact credit law in src/compliance.ts +
// src/caseModel.ts). Runs after the direct fill loop, gated on
// config.chaseSupervision. Claude never places anything — this is pure and
// deterministic, unit-tested in scripts/verify-builder-sup.ts.
//
// The load-bearing rule (see ~/.claude/plans): supervision earns credit ONLY
// against a REAL dated direct row, and nothing in the app expands recurrence.
// So this pass MATERIALIZES the direct backbone into dated per-week rows first:
//   - the new recurring direct ops from this build → emitted as dated weekly adds;
//   - existing recurring direct appts → dated adds for their OTHER horizon weeks
//     (the row itself already covers its own week — no double-count, non-destructive);
//   - existing dated directs → used as supervision targets as-is.
// The floor denominator is recomputed from this materialized calendar (NOT the
// ~1-week value on CaseSupervisionState, which understates it ~4×).

import {
  ScheduleData, Client, WishOp, Appointment,
  SupervisionCadence, SUPERVISION_CADENCES, TimeWindow, DayOfWeek,
} from './types';
import { computeCaseState, computeBtState } from './caseModel';
import { toMin, DAYS } from './intervals';
import type { BuilderConfig, ClientBlock } from './scheduleBuilder';

const HR_MS = 3_600_000;
const WEEK_MS = 7 * 86_400_000;
const DAY_MS = 86_400_000;
// A supervision touch is meaningful from 15 min; a single block is capped at 2h.
const MIN_SUP_HRS = 0.25;
const MAX_SUP_HRS = 2;
// getDay() (0=Sun) → the DayOfWeek key clinicianAvailability is stored under.
const DAY_OF_WEEK: DayOfWeek[] = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const BCBA_TYPES = new Set<Appointment['type']>(['supervision', 'parent-training', 'case-planning', 'reassessment']);

// ── date helpers (local, no TZ suffix — matches the appointment/op format) ─────
const pad = (n: number) => String(n).padStart(2, '0');
const isoLocal = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const parseLocalDate = (iso: string): Date => new Date(`${iso.slice(0, 10)}T00:00:00`);

// ── exported types ────────────────────────────────────────────────────────────
export interface DatedDirect {
  clientId: string;
  clientName: string;
  techId?: string;
  techName?: string;
  startMs: number;
  endMs: number;
  hours: number;
  weekIndex: number;      // weeks since the config template Monday (can be <0 for the pre-anchor week)
  materialized: boolean;  // true = this occurrence is a NEW dated add this pass emitted
}

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

export interface SupervisionPassResult {
  directOps: WishOp[];   // dated direct rows to emit (materialized backbone)
  directOpsHrs: number;  // total direct hours across directOps (drives the "placed" metric)
  supOps: WishOp[];      // dated supervision rows
  blocks: ClientBlock[]; // bcba-availability (supervision) + materialization-skip blocks
  metrics: SupervisionMetrics;
}

export type BcbaBusy = { s: number; e: number }[];

// ── single-BCBA occupancy primitive (immutable) ────────────────────────────────
export function isBcbaFree(busy: BcbaBusy, sMs: number, eMs: number): boolean {
  return !busy.some(b => b.s < eMs && b.e > sMs);
}
export function reserveBcba(busy: BcbaBusy, sMs: number, eMs: number): BcbaBusy {
  return [...busy, { s: sMs, e: eMs }];
}

// ── cadence policy ─────────────────────────────────────────────────────────────
function contactsForCadence(cadence: SupervisionCadence | undefined): number | undefined {
  if (!cadence) return undefined;
  return SUPERVISION_CADENCES.find(c => c.value === cadence)?.contactsPerMonth;
}

// Deterministic, VISIBLE cancellation-risk weight in [0,1] used to front-load
// supervision toward early-month as a buffer. Two proxies (D1):
//   - cadence slowness: EOW/3o4 get fewer planned supervision chances than weekly;
//   - session frequency: fewer distinct days the client can be seen = fewer make-up
//     options if a session cancels late.
// STUB SEAM: a future actuarial cancellation-trends model would refine this. It is
// deterministic and visible ONLY — it must NEVER influence scheduling via hidden
// statistics (owner constraint), so the weight lives entirely in this one function.
export function cancellationRiskWeight(client: Client): number {
  const cadenceRisk = client.cadenceGoal === 'EOW' ? 1 : client.cadenceGoal === '3o4' ? 0.5 : 0;
  const daysAvail = DAYS.filter(day => (client.availabilityWindows?.[day]?.length ?? 0) > 0).length;
  const freqRisk = Math.max(0, Math.min(1, (5 - daysAvail) / 5));
  return Math.max(0, Math.min(1, 0.5 * cadenceRisk + 0.5 * freqRisk));
}

// Which of the weeks that HAVE a candidate direct get a supervision contact.
// `W`→every available week, `EOW`→2, `3o4`→3, undefined→every available week
// (the per-contact sizing still targets the floor, so extra weeks place small).
// Front-loaded by `risk`: at risk 0 the picks spread evenly (EOW over 4 weeks →
// weeks 0 & 2); at risk 1 they pack toward the front (weeks 0 & 1) for buffer.
export function weeksForCadence(
  cadence: SupervisionCadence | undefined,
  availableWeeks: number[],
  risk: number,
): number[] {
  const N = availableWeeks.length;
  if (N === 0) return [];
  let count = contactsForCadence(cadence) ?? N;
  count = Math.min(count, N);
  if (count <= 0) return [];
  if (count >= N) return [...availableWeeks];

  const picks = new Set<number>(); // positions into availableWeeks
  for (let k = 0; k < count; k++) {
    const evenPos = Math.round((k * N) / count);      // spread: 0, N/count, 2N/count, …
    const frontPos = k;                                // packed at the front
    let pos = Math.round(evenPos * (1 - risk) + frontPos * risk);
    pos = Math.max(0, Math.min(N - 1, pos));
    let guard = 0;
    while (picks.has(pos) && guard++ < N) pos = (pos + 1) % N;
    picks.add(pos);
  }
  return [...picks].sort((a, b) => a - b).map(p => availableWeeks[p]);
}

// ── occurrence stepping (shared, DRY) ──────────────────────────────────────────
interface Occ { startMs: number; endMs: number; startIso: string; endIso: string; weekIndex: number; }

// Project a recurring template (the weekday + clock of `templateStart`, length
// `durMs`) into dated weekly occurrences in [lowerMs, horizonEndMs). weekIndex is
// weeks since `weekStartMs` (the config template Monday, at local midnight).
// DST-safe week index: whole calendar days between two local midnights ÷ 7. A
// fixed-ms week miscounts across a spring-forward / fall-back transition (a 167h
// or 169h week), collapsing two real weeks into one bucket.
function weekIndexFor(startMs: number, weekStartMs: number): number {
  const dm = new Date(startMs); dm.setHours(0, 0, 0, 0);
  return Math.floor(Math.round((dm.getTime() - weekStartMs) / DAY_MS) / 7);
}

export function expandDirectOccurrences(
  templateStart: Date,
  durMs: number,
  weekStartMs: number,
  lowerMs: number,
  horizonEndMs: number,
): Occ[] {
  const h = templateStart.getHours(), mi = templateStart.getMinutes(), se = templateStart.getSeconds();
  // Fast-forward to the week near lowerMs so a stale recurring anchor (an existing
  // series whose start is many months back) can't exhaust the guard before it
  // reaches the horizon. The −1 keeps the occurrence straddling lowerMs in range.
  const startWk = Math.max(0, Math.floor((lowerMs - templateStart.getTime()) / WEEK_MS) - 1);
  const out: Occ[] = [];
  for (let wk = startWk; wk < startWk + 70; wk++) {
    const d = new Date(templateStart);
    d.setDate(d.getDate() + wk * 7);
    d.setHours(h, mi, se, 0);          // re-anchor the clock (DST-safe, mirrors monthSelfCheck)
    const startMs = d.getTime();
    if (startMs >= horizonEndMs) break;
    if (startMs < lowerMs) continue;
    const endMs = startMs + durMs;
    out.push({ startMs, endMs, startIso: isoLocal(d), endIso: isoLocal(new Date(endMs)), weekIndex: weekIndexFor(startMs, weekStartMs) });
  }
  return out;
}

// ── entity resolution (id-or-name → stable id), mirrors compliance.ts ──────────
function makeResolver(list: { id: string; name: string }[]): (ref?: string) => string | undefined {
  const byId = new Map(list.map(x => [x.id, x.id]));
  const byName = new Map(list.map(x => [x.name, x.id]));
  return (ref?: string) => (ref ? (byId.get(ref) ?? byName.get(ref) ?? ref) : undefined);
}

const isActive = (a: Appointment) => a.status !== 'canceled' && !a.isGhost;

// ── the direct calendar: merge existing + materialize into dated rows ──────────
interface Busy { s: number; e: number; tech?: string; client?: string; }
function collides(existing: Busy[], sMs: number, eMs: number, tech?: string, client?: string): boolean {
  return existing.some(x =>
    x.s < eMs && x.e > sMs &&
    ((tech !== undefined && x.tech === tech) || (client !== undefined && x.client === client)));
}

interface DirectCalendar {
  byClient: Map<string, DatedDirect[]>;
  directOps: WishOp[];
  directOpsHrs: number;
  blocks: ClientBlock[];
}

function buildDirectCalendar(
  data: ScheduleData,
  recurringDirectOps: WishOp[],
  config: BuilderConfig,
  now: Date,
): DirectCalendar {
  const horizonStartMs = parseLocalDate(config.monthHorizon.start).getTime();
  const horizonEndMs = parseLocalDate(config.monthHorizon.end).getTime();
  const weekStartMs = parseLocalDate(config.weekStart).getTime();
  const lowerMs = Math.max(now.getTime(), horizonStartMs); // never materialize a past week
  const resolveTech = makeResolver(data.technicians);
  const resolveClient = makeResolver(data.clients);
  const clientById = new Map(data.clients.map(c => [c.id, c]));

  const byClient = new Map<string, DatedDirect[]>();
  const directOps: WishOp[] = [];
  const blocks: ClientBlock[] = [];
  let directOpsHrs = 0;

  // Collision plane seeded from ALL active appts (so materialized rows never
  // double-book anything), grown as we emit.
  const existing: Busy[] = data.appointments
    .filter(isActive)
    .map(a => ({
      s: new Date(a.startTime).getTime(), e: new Date(a.endTime).getTime(),
      tech: resolveTech(a.technician), client: resolveClient(a.client),
    }));

  const pushTarget = (dd: DatedDirect): void => {
    const arr = byClient.get(dd.clientId) ?? [];
    arr.push(dd);
    byClient.set(dd.clientId, arr);
  };
  const emitDated = (
    clientRef: string | undefined, techRef: string | undefined, title: string | undefined,
    occ: Occ,
  ): void => {
    const cid = resolveClient(clientRef);
    const tid = resolveTech(techRef);
    if (!cid) return;
    if (collides(existing, occ.startMs, occ.endMs, tid, cid)) {
      const cname = clientById.get(cid)?.name ?? clientRef ?? '';
      blocks.push({
        clientId: cid, clientName: cname, directGapRemaining: 0, bindingConstraint: 'tech-contention',
        detail: `A ${cname} session on ${occ.startIso.slice(0, 10)} couldn't be materialized — it overlaps an existing session that week.`,
      });
      return;
    }
    const client = clientById.get(cid);
    const tech = data.technicians.find(t => t.id === tid || t.name === techRef);
    directOps.push({
      op: 'add', type: 'client-session', title: title || undefined,
      client: client?.name ?? clientRef, technician: tech?.name ?? techRef,
      start: occ.startIso, end: occ.endIso,
    });
    const hours = (occ.endMs - occ.startMs) / HR_MS;
    directOpsHrs += hours;
    existing.push({ s: occ.startMs, e: occ.endMs, tech: tid, client: cid });
    pushTarget({
      clientId: cid, clientName: client?.name ?? clientRef ?? '', techId: tid, techName: tech?.name ?? techRef,
      startMs: occ.startMs, endMs: occ.endMs, hours, weekIndex: occ.weekIndex, materialized: true,
    });
  };

  const weekIndexOf = (startMs: number): number => weekIndexFor(startMs, weekStartMs);

  // Source A + B: existing directs already on the schedule.
  for (const a of data.appointments) {
    if (a.type !== 'client-session' || !isActive(a)) continue;
    const cid = resolveClient(a.client);
    if (!cid) continue;
    const startMs = new Date(a.startTime).getTime();
    const endMs = new Date(a.endTime).getTime();
    const client = clientById.get(cid);
    const tech = data.technicians.find(t => t.id === resolveTech(a.technician) || t.name === a.technician);

    // The concrete row itself is a target when it falls in the reachable horizon.
    if (startMs >= lowerMs && startMs < horizonEndMs) {
      pushTarget({
        clientId: cid, clientName: client?.name ?? a.client ?? '', techId: resolveTech(a.technician), techName: tech?.name ?? a.technician,
        startMs, endMs, hours: (endMs - startMs) / HR_MS, weekIndex: weekIndexOf(startMs), materialized: false,
      });
    }
    // Source B: a recurring existing direct — materialize its OTHER horizon weeks
    // (its own week is already the concrete row above; skip it to avoid double-count).
    if (a.isRecurring) {
      const ownWeek = weekIndexOf(startMs);
      for (const occ of expandDirectOccurrences(new Date(a.startTime), endMs - startMs, weekStartMs, lowerMs, horizonEndMs)) {
        if (occ.weekIndex === ownWeek) continue;
        emitDated(a.client, a.technician, a.title, occ);
      }
    }
  }

  // Source C: the NEW recurring direct ops from this build → dated every horizon week.
  for (const op of recurringDirectOps) {
    if (op.op !== 'add' || op.type !== 'client-session' || !op.recurring) continue;
    const durMs = new Date(op.end).getTime() - new Date(op.start).getTime();
    for (const occ of expandDirectOccurrences(new Date(op.start), durMs, weekStartMs, lowerMs, horizonEndMs)) {
      emitDated(op.client, op.technician, op.title, occ);
    }
  }

  for (const arr of byClient.values()) arr.sort((x, y) => x.startMs - y.startMs);
  return { byClient, directOps, directOpsHrs, blocks };
}

// ── BCBA availability windows on a given date (ms bounds) ──────────────────────
function clinicianWindowsForDate(data: ScheduleData, date: Date): { s: number; e: number }[] {
  const avail = data.settings.clinicianAvailability as Record<string, TimeWindow[]> | undefined;
  const day0 = new Date(date); day0.setHours(0, 0, 0, 0);
  if (!avail) return [{ s: day0.getTime(), e: day0.getTime() + DAY_MS }]; // unset → available all day
  const ws = avail[DAY_OF_WEEK[date.getDay()]];
  if (!ws || ws.length === 0) return [];
  return ws.map(w => ({ s: day0.getTime() + toMin(w.start) * 60_000, e: day0.getTime() + toMin(w.end) * 60_000 }));
}

// Free sub-gaps of [s,e) after removing the BCBA-busy intervals.
function freeGaps(s: number, e: number, busy: BcbaBusy): { s: number; e: number }[] {
  let cur = [{ s, e }];
  for (const b of busy) {
    const next: { s: number; e: number }[] = [];
    for (const seg of cur) {
      if (b.e <= seg.s || b.s >= seg.e) { next.push(seg); continue; }
      if (b.s > seg.s) next.push({ s: seg.s, e: b.s });
      if (b.e < seg.e) next.push({ s: b.e, e: seg.e });
    }
    cur = next;
  }
  return cur;
}

// The earliest supervision subinterval of ~desiredH inside `d` that is within BCBA
// availability AND BCBA-free. Returns null when no ≥ MIN_SUP_HRS slot fits.
function placeSupSubinterval(
  data: ScheduleData, d: DatedDirect, desiredH: number, bcbaBusy: BcbaBusy,
): { startMs: number; endMs: number; startIso: string; endIso: string } | null {
  const desMs = Math.max(MIN_SUP_HRS, Math.min(desiredH, MAX_SUP_HRS)) * HR_MS;
  const minMs = MIN_SUP_HRS * HR_MS;
  for (const w of clinicianWindowsForDate(data, new Date(d.startMs))) {
    const segS = Math.max(d.startMs, w.s);
    const segE = Math.min(d.endMs, w.e);
    if (segE - segS < minMs) continue;
    for (const g of freeGaps(segS, segE, bcbaBusy)) {
      if (g.e - g.s < minMs) continue;
      const startMs = g.s;
      const endMs = Math.min(g.e, startMs + desMs);
      if (endMs - startMs < minMs) continue;
      return { startMs, endMs, startIso: isoLocal(new Date(startMs)), endIso: isoLocal(new Date(endMs)) };
    }
  }
  return null;
}

function seedBcbaBusy(data: ScheduleData): BcbaBusy {
  return data.appointments
    .filter(a => isActive(a) && BCBA_TYPES.has(a.type))
    .map(a => ({ s: new Date(a.startTime).getTime(), e: new Date(a.endTime).getTime() }));
}

// ── the pass ───────────────────────────────────────────────────────────────────
export function chaseSupervisionPass(
  data: ScheduleData,
  recurringDirectOps: WishOp[],
  config: BuilderConfig,
  now: Date,
): SupervisionPassResult {
  const cal = buildDirectCalendar(data, recurringDirectOps, config, now);
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

  let bcbaBusy = seedBcbaBusy(data);
  const supOps: WishOp[] = [];
  const blocks: ClientBlock[] = [...cal.blocks];
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
        const slot = placeSupSubinterval(data, d, targetH, bcbaBusy);
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
    directOps: cal.directOps,
    directOpsHrs: cal.directOpsHrs,
    supOps,
    blocks,
    metrics: {
      supervisionHrsPlaced: +supervisionHrsPlaced.toFixed(2),
      casesMeetingFloor, floorTargetCases, rbtsMeetingFloor, rbtFloorTargets,
    },
  };
}
