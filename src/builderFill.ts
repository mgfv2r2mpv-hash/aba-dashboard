// Post-pass BCBA fill (runs AFTER supervision + parent-training, so it sees every
// op those passes placed and never double-counts a case's PT goal or the BCBA's
// billable total).
//
// Two concerns, in the user's real cascade order:
//   1. Unstaffed-week contact — a week with NO direct at all still needs the client
//      seen. The caregiver is always present, so place a parent-training (caregiver)
//      session in the client's availability (counts toward the PT goal + weekly
//      contact); only if the case's PT goal is already met, a no-BT supervision
//      (protocol revision). Never fabricates a family-present DIRECT.
//   2. Fill to the billable target — Commit C (supervision-to-cap → case-planning).
//
// Every placed session is client-availability + BCBA-availability + BCBA-free, on
// the shared growing busy plane. No `technician` is named (there is no BT), so by
// compliance law these earn BCBA billable but not supervision-floor credit — the
// correct, conservative behavior for an unstaffed week.

import { ScheduleData, WishOp, Client, Appointment } from './types';
import { computeCaseState } from './caseModel';
import {
  DirectCalendar, BcbaBusy, BCBA_TYPES, enumerateHorizonWeeks, weekIndexFor, parseLocalDate,
  reserveBcba, freeGaps, clinicianWindowsForDate, isoLocal, HR_MS, MIN_SUP_HRS, MAX_SUP_HRS,
} from './builderBcba';
import { pickBestSlot } from './builderScoring';
import { resolveUtilization, reduceRequirementForPto, ptoHoursInRange } from './utilization';
import { DAYS, windowsToIntervals } from './intervals';
import { buildTravelContext, TravelContext } from './travel';
import { v4 as uuidv4 } from 'uuid';
import type { BuilderConfig, ClientBlock } from './scheduleBuilder';

export interface FillResult {
  ops: WishOp[];
  blocks: ClientBlock[];
  busyOut: BcbaBusy;
}

const isActive = (a: Appointment) => a.status !== 'canceled' && !a.isGhost;
const DAY_MS = 86_400_000;
const apptHours = (a: Appointment) => (new Date(a.endTime).getTime() - new Date(a.startTime).getTime()) / HR_MS;
const opHours = (o: any) => (new Date(o.end).getTime() - new Date(o.start).getTime()) / HR_MS;

// [firstDay 00:00, lastDay+1day) for a week's dates.
function weekBounds(dates: Date[]): { s: number; e: number } {
  const s = new Date(dates[0]); s.setHours(0, 0, 0, 0);
  const last = new Date(dates[dates.length - 1]); last.setHours(0, 0, 0, 0);
  return { s: s.getTime(), e: last.getTime() + DAY_MS };
}

function makeIdOf(data: ScheduleData): (ref?: string) => string | undefined {
  return (ref?: string) => (ref ? (data.clients.find(c => c.id === ref || c.name === ref)?.id) : undefined);
}

// The earliest ~desiredH BCBA-availability slot on `date` that is BCBA-free — a
// solo, location-neutral session (case-planning). No client/BT, no cap.
function placeCasePlanningSlot(
  data: ScheduleData, date: Date, desiredH: number, busy: BcbaBusy, ctx?: TravelContext,
): { startMs: number; endMs: number; startIso: string; endIso: string } | null {
  const desMs = Math.max(MIN_SUP_HRS, Math.min(desiredH, MAX_SUP_HRS)) * HR_MS;
  const minMs = MIN_SUP_HRS * HR_MS;
  for (const bw of clinicianWindowsForDate(data, date)) {
    for (const g of freeGaps(bw.s, bw.e, busy, undefined, ctx)) {
      if (g.e - g.s < minMs) continue;
      const startMs = g.s;
      const endMs = Math.min(g.e, startMs + desMs);
      if (endMs - startMs < minMs) continue;
      return { startMs, endMs, startIso: isoLocal(new Date(startMs)), endIso: isoLocal(new Date(endMs)) };
    }
  }
  return null;
}

// Client availability windows on a date, as absolute-ms bounds (mirrors
// clinicianWindowsForDate for the client side; Monday-first weekday key).
function clientWindowsForDate(client: Client, date: Date): { s: number; e: number }[] {
  const jsDay = date.getDay();
  const day = (jsDay === 0 ? DAYS[6] : DAYS[jsDay - 1]);
  const ivs = windowsToIntervals(client.availabilityWindows?.[day]);
  const day0 = new Date(date); day0.setHours(0, 0, 0, 0);
  return ivs.map(iv => ({ s: day0.getTime() + iv.start * 60_000, e: day0.getTime() + iv.end * 60_000 }));
}

// The earliest ~desiredH slot on `date` inside client availability ∩ BCBA
// availability that is BCBA-free (travel-aware). No host direct — this is a
// standalone caregiver/protocol session. Returns null when none ≥ MIN fits.
function placeInClientAvailability(
  data: ScheduleData, client: Client, date: Date, desiredH: number, busy: BcbaBusy, ctx?: TravelContext,
): { startMs: number; endMs: number; startIso: string; endIso: string } | null {
  const desMs = Math.max(MIN_SUP_HRS, Math.min(desiredH, MAX_SUP_HRS)) * HR_MS;
  const minMs = MIN_SUP_HRS * HR_MS;
  for (const cw of clientWindowsForDate(client, date)) {
    for (const bw of clinicianWindowsForDate(data, date)) {
      const segS = Math.max(cw.s, bw.s);
      const segE = Math.min(cw.e, bw.e);
      if (segE - segS < minMs) continue;
      for (const g of freeGaps(segS, segE, busy, client.id, ctx)) {
        if (g.e - g.s < minMs) continue;
        const startMs = g.s;
        const endMs = Math.min(g.e, startMs + desMs);
        if (endMs - startMs < minMs) continue;
        return { startMs, endMs, startIso: isoLocal(new Date(startMs)), endIso: isoLocal(new Date(endMs)) };
      }
    }
  }
  return null;
}

// ── unstaffed-week caregiver contact ────────────────────────────────────────────
// For every active case, ensure each horizon week that has NO direct still gets a
// caregiver contact. Prefers parent-training (toward the PT goal), falling back to
// a no-BT supervision once the PT goal is met.
export function placeUnstaffedContact(
  data: ScheduleData,
  cal: DirectCalendar,
  busyIn: BcbaBusy,
  now: Date,
  config: BuilderConfig,
  placedOps: WishOp[],
  caseSeriesId: Map<string, string>,
): FillResult {
  const travelCtx = buildTravelContext(data);
  const weeks = enumerateHorizonWeeks(config, now);
  let bcbaBusy = busyIn;
  const ops: WishOp[] = [];
  const blocks: ClientBlock[] = [];

  const idOf = (ref?: string): string | undefined =>
    ref ? (data.clients.find(c => c.id === ref || c.name === ref)?.id) : undefined;

  // PT hours already placed for a client by the sup/PT passes this build (ops carry
  // client NAME) — subtracted from the case's remaining PT gap so we never overshoot.
  const placedPtFor = (clientId: string): number =>
    placedOps
      .filter(o => o.op === 'add' && o.type === 'parent-training' && idOf(o.client) === clientId)
      .reduce((s, o: any) => s + (new Date(o.end).getTime() - new Date(o.start).getTime()) / HR_MS, 0);

  for (const client of data.clients) {
    if (client.archived) continue;
    const allDirects = cal.byClient.get(client.id) ?? [];
    if (allDirects.length === 0) continue; // inactive/no-service case — never fabricate contact
    const staffedWeeks = new Set(allDirects.map(d => d.weekIndex));
    // Only INTERIOR gaps count as "unstaffed": a week with no direct that falls
    // BETWEEN the case's first and last direct week (a blackout / no-BT gap in an
    // otherwise-staffed span). Weeks before the first direct (the pre-anchor partial
    // week) or after the last (auth ended) are not "the case should have been seen".
    const directWeekIdx = allDirects.map(d => d.weekIndex);
    const firstDirectWeek = Math.min(...directWeekIdx);
    const lastDirectWeek = Math.max(...directWeekIdx);

    const cs = computeCaseState(data, client, now);
    let ptGapRemaining = Math.max(0, cs.parentTraining.gap - placedPtFor(client.id));
    const distinctDirectWeeks = staffedWeeks.size || 1;
    const avgWeeklyDirect = allDirects.reduce((s, d) => s + d.hours, 0) / distinctDirectWeeks;
    const supSize = Math.max(MIN_SUP_HRS, Math.min(MAX_SUP_HRS, 0.2 * avgWeeklyDirect));

    // Existing on-board caregiver contacts, per week (so we don't stack a second).
    const existingContactMs = data.appointments
      .filter(a => isActive(a) && BCBA_TYPES.has(a.type) && idOf(a.client) === client.id)
      .map(a => new Date(a.startTime).getTime());

    const seriesId = caseSeriesId.get(client.id) ?? uuidv4();
    caseSeriesId.set(client.id, seriesId);

    for (const wk of weeks) {
      if (wk.weekIndex < firstDirectWeek || wk.weekIndex > lastDirectWeek) continue; // outside the active span
      if (staffedWeeks.has(wk.weekIndex)) continue; // staffed → the client already sees the BT
      const wkS = (() => { const d = new Date(wk.dates[0]); d.setHours(0, 0, 0, 0); return d.getTime(); })();
      const wkE = (() => { const d = new Date(wk.dates[wk.dates.length - 1]); d.setHours(0, 0, 0, 0); return d.getTime() + DAY_MS; })();
      if (existingContactMs.some(ms => ms >= wkS && ms < wkE)) continue; // already has a contact this week

      const placePT = ptGapRemaining >= MIN_SUP_HRS;
      const desired = placePT ? Math.min(ptGapRemaining, MAX_SUP_HRS) : supSize;
      let slot: ReturnType<typeof placeInClientAvailability> = null;
      for (const date of wk.dates) {
        slot = placeInClientAvailability(data, client, date, desired, bcbaBusy, travelCtx);
        if (slot) break;
      }
      if (!slot) {
        blocks.push({
          clientId: client.id, clientName: client.name, directGapRemaining: 0,
          bindingConstraint: 'bcba-availability',
          detail: `${client.name} has no BT that week — plan a caregiver session in advance (no client+BCBA availability overlap found).`,
        });
        continue;
      }
      const hrs = (slot.endMs - slot.startMs) / HR_MS;
      ops.push({
        op: 'add', type: placePT ? 'parent-training' : 'supervision',
        client: client.name, start: slot.startIso, end: slot.endIso,
        seriesId, recurring: true, pattern: 'weekly',
      });
      bcbaBusy = reserveBcba(bcbaBusy, slot.startMs, slot.endMs, client.id);
      if (placePT) ptGapRemaining -= hrs;
    }
  }

  return { ops, blocks, busyOut: bcbaBusy };
}

// ── fill to the BCBA billable target (the user's cascade top-off) ───────────────
// Runs LAST in a combined "build my month". After floors/goals/unstaffed contact,
// tops the BCBA up to the weekly minimum (each week) and the monthly target using,
// in order: (1) more supervision over directs up to each case's 20% cap, then
// (2) solo case-planning (no client/BT, bounded by the case's weekly case-planning
// authorization). Never exceeds a case's supervision cap; never fabricates a
// family-present session. Purely additive.
export function fillToBillableTarget(
  data: ScheduleData,
  cal: DirectCalendar,
  busyIn: BcbaBusy,
  now: Date,
  config: BuilderConfig,
  placedOps: WishOp[],
  caseSeriesId: Map<string, string>,
): FillResult {
  const util = resolveUtilization(data.settings.utilization);
  const ratio = data.settings.ptoBillableDeductionRatio;
  const travelCtx = buildTravelContext(data);
  const weekStartMs = parseLocalDate(config.weekStart).getTime();
  const wIdx = (ms: number) => weekIndexFor(ms, weekStartMs);
  const idOf = makeIdOf(data);
  const futureWeeks = enumerateHorizonWeeks(config, now);
  if (futureWeeks.length === 0) return { ops: [], blocks: [], busyOut: busyIn };

  // Running BCBA billable per week: existing on-board + everything placed so far.
  const billableByWeek = new Map<number, number>();
  const bump = (wi: number, h: number) => billableByWeek.set(wi, (billableByWeek.get(wi) ?? 0) + h);
  for (const a of data.appointments) if (isActive(a) && BCBA_TYPES.has(a.type)) bump(wIdx(new Date(a.startTime).getTime()), apptHours(a));
  for (const o of placedOps as any[]) if (o.op === 'add' && BCBA_TYPES.has(o.type)) bump(wIdx(new Date(o.start).getTime()), opHours(o));

  // Per-case cap headroom (supervision hours still addable before the 20% cap) and
  // weekly case-planning authorization.
  interface CaseFill { client: Client; slackToCap: number; capPlanPerWk: number; }
  const cases: CaseFill[] = [];
  for (const client of data.clients) {
    if (client.archived) continue;
    if ((cal.byClient.get(client.id) ?? []).length === 0) continue;
    const cs = computeCaseState(data, client, now);
    const supPlaced = (placedOps as any[])
      .filter(o => o.op === 'add' && o.type === 'supervision' && idOf(o.client) === client.id)
      .reduce((s, o) => s + opHours(o), 0);
    cases.push({ client, slackToCap: Math.max(0, cs.supervision.slackToCap - supPlaced), capPlanPerWk: cs.casePlanningAuthPerWk });
  }

  let bcbaBusy = busyIn;
  const ops: WishOp[] = [];
  const casePlanByWk = new Map<string, number>(); // `${clientId}|${weekIndex}` → placed case-planning hrs

  // Grow one week's billable toward targetH via Tier 1 then Tier 3; returns hrs added.
  const fillWeek = (wk: { weekIndex: number; dates: Date[] }, targetH: number): number => {
    let have = billableByWeek.get(wk.weekIndex) ?? 0;
    if (have >= targetH - 0.01) return 0;
    let added = 0;

    // Tier 1 — supervision to cap over this week's directs (one contact per case).
    for (const info of cases) {
      if (have >= targetH - 0.01) break;
      if (info.slackToCap < MIN_SUP_HRS) continue;
      const ds = (cal.byClient.get(info.client.id) ?? []).filter(d => d.weekIndex === wk.weekIndex);
      if (ds.length === 0) continue;
      const want = Math.min(info.slackToCap, targetH - have, MAX_SUP_HRS);
      let hit: { d: typeof ds[number]; slot: NonNullable<ReturnType<typeof pickBestSlot>> } | null = null;
      for (const d of ds) { const slot = pickBestSlot(data, d, want, bcbaBusy, travelCtx, info.client.schedulingHints); if (slot) { hit = { d, slot }; break; } }
      if (!hit) continue;
      const hrs = (hit.slot.endMs - hit.slot.startMs) / HR_MS;
      const seriesId = caseSeriesId.get(info.client.id) ?? uuidv4();
      caseSeriesId.set(info.client.id, seriesId);
      ops.push({ op: 'add', type: 'supervision', client: info.client.name, technician: hit.d.techName, start: hit.slot.startIso, end: hit.slot.endIso, seriesId, recurring: true, pattern: 'weekly' });
      bcbaBusy = reserveBcba(bcbaBusy, hit.slot.startMs, hit.slot.endMs, hit.d.clientId);
      info.slackToCap -= hrs; have += hrs; added += hrs; bump(wk.weekIndex, hrs);
    }

    // Tier 3 — solo case-planning, bounded by each case's weekly authorization.
    for (const info of cases) {
      if (have >= targetH - 0.01) break;
      if (info.capPlanPerWk < MIN_SUP_HRS) continue;
      const key = `${info.client.id}|${wk.weekIndex}`;
      const room = info.capPlanPerWk - (casePlanByWk.get(key) ?? 0);
      if (room < MIN_SUP_HRS) continue;
      const want = Math.min(room, targetH - have, MAX_SUP_HRS);
      let slot: ReturnType<typeof placeCasePlanningSlot> = null;
      for (const date of wk.dates) { slot = placeCasePlanningSlot(data, date, want, bcbaBusy, travelCtx); if (slot) break; }
      if (!slot) continue;
      const hrs = (slot.endMs - slot.startMs) / HR_MS;
      ops.push({ op: 'add', type: 'case-planning', client: info.client.name, start: slot.startIso, end: slot.endIso });
      bcbaBusy = reserveBcba(bcbaBusy, slot.startMs, slot.endMs, undefined);
      casePlanByWk.set(key, (casePlanByWk.get(key) ?? 0) + hrs);
      have += hrs; added += hrs; bump(wk.weekIndex, hrs);
    }
    return added;
  };

  // Weekly minimum first (PTO-shaved), then push the monthly total to target.
  for (const wk of futureWeeks) {
    const floor = reduceRequirementForPto(util.bcbaWeeklyBillableMin, ptoHoursInRange(data.timeOff, weekBounds(wk.dates).s, weekBounds(wk.dates).e), ratio);
    if (floor > 0) fillWeek(wk, floor);
  }

  const monthStart = parseLocalDate(config.monthHorizon.start);
  const monthEnd = parseLocalDate(config.monthHorizon.end);
  const monthWeeks = enumerateHorizonWeeks(config, monthStart).length;
  const monthlyBase = monthWeeks >= 5 ? util.bcbaMonthlyBillableHours5Week : util.bcbaMonthlyBillableHours;
  const monthlyTarget = reduceRequirementForPto(monthlyBase, ptoHoursInRange(data.timeOff, monthStart.getTime(), monthEnd.getTime()), ratio);
  const monthTotal = () => [...billableByWeek.values()].reduce((s, h) => s + h, 0);
  for (let guard = 0; monthTotal() < monthlyTarget - 0.01 && guard < 100; guard++) {
    let progressed = false;
    for (const wk of futureWeeks) {
      if (monthTotal() >= monthlyTarget - 0.01) break;
      if (fillWeek(wk, (billableByWeek.get(wk.weekIndex) ?? 0) + MAX_SUP_HRS) > 0.01) progressed = true;
    }
    if (!progressed) break;
  }

  return { ops, blocks: [], busyOut: bcbaBusy };
}
