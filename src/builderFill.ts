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
  DirectCalendar, BcbaBusy, BCBA_TYPES, enumerateHorizonWeeks,
  reserveBcba, freeGaps, clinicianWindowsForDate, isoLocal, HR_MS, MIN_SUP_HRS, MAX_SUP_HRS,
} from './builderBcba';
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
