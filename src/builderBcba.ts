// Shared BCBA-pass primitives (Phase 4 extraction).
//
// Both the supervision pass (src/builderSupervision.ts) and the parent-training
// pass (src/builderPT.ts) chase per-client BCBA time against a MATERIALIZED dated
// direct calendar, placing sub-slots inside real directs on a SINGLE, shared,
// growing BCBA-busy plane. This module owns the pieces neither pass should own
// alone: the dated-direct calendar, the BCBA occupancy primitive, the in-direct
// slot finder, occurrence stepping, and the cadence/front-load policy helpers.
//
// The load-bearing rule (see ~/.claude/plans): BCBA credit earns ONLY against a
// REAL dated direct row, and nothing in the app expands recurrence. So a combined
// build must MATERIALIZE the direct backbone into dated per-week rows ONCE and let
// every BCBA pass place against that same calendar (never re-materialize, or it
// would emit duplicate dated direct rows and double-book the one BCBA).

import {
  ScheduleData, Client, WishOp, Appointment, Authorization,
  SupervisionCadence, SUPERVISION_CADENCES, TimeWindow, DayOfWeek,
} from './types';
import { toMin, DAYS, Interval, windowsToIntervals, intersect, btCaseAvailability } from './intervals';
import { inAuthSpan } from './authorization';
import { travelMinutes, TravelContext, LocKey } from './travel';
import type { BuilderConfig, ClientBlock } from './scheduleBuilder';

export const HR_MS = 3_600_000;
const WEEK_MS = 7 * 86_400_000;
const DAY_MS = 86_400_000;
// A BCBA touch (supervision or parent-training) is meaningful from 15 min; a
// single block is capped at 2h.
export const MIN_SUP_HRS = 0.25;
export const MAX_SUP_HRS = 2;
// getDay() (0=Sun) → the DayOfWeek key clinicianAvailability is stored under.
const DAY_OF_WEEK: DayOfWeek[] = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const BCBA_TYPES = new Set<Appointment['type']>(['supervision', 'parent-training', 'case-planning', 'reassessment']);

// ── date helpers (local, no TZ suffix — matches the appointment/op format) ─────
const pad = (n: number) => String(n).padStart(2, '0');
export const isoLocal = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
export const parseLocalDate = (iso: string): Date => new Date(`${iso.slice(0, 10)}T00:00:00`);

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

// A reserved slice of the single BCBA's day. `loc` tags WHERE the BCBA is during
// it (a client id, the literal 'HOME', or undefined for a location-neutral
// session like case-planning) so travel time between differently-located blocks
// can be enforced. Absent loc = no travel constraint (legacy-safe).
export type BcbaBusy = { s: number; e: number; loc?: LocKey }[];

// ── single-BCBA occupancy primitive (immutable) ────────────────────────────────
// Raw overlap test (no travel notion) — the BCBA can't be in two sessions at once.
export function isBcbaFree(busy: BcbaBusy, sMs: number, eMs: number): boolean {
  return !busy.some(b => b.s < eMs && b.e > sMs);
}
export function reserveBcba(busy: BcbaBusy, sMs: number, eMs: number, loc?: LocKey): BcbaBusy {
  return [...busy, { s: sMs, e: eMs, loc }];
}

// ── cadence policy ─────────────────────────────────────────────────────────────
export function contactsForCadence(cadence: SupervisionCadence | undefined): number | undefined {
  if (!cadence) return undefined;
  return SUPERVISION_CADENCES.find(c => c.value === cadence)?.contactsPerMonth;
}

// Deterministic, VISIBLE cancellation-risk weight in [0,1] used to front-load BCBA
// time toward early-month as a buffer. Two proxies (D1):
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

// Which of the weeks that HAVE a candidate direct get a contact.
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
export interface Occ { startMs: number; endMs: number; startIso: string; endIso: string; weekIndex: number; }

// Project a recurring template (the weekday + clock of `templateStart`, length
// `durMs`) into dated weekly occurrences in [lowerMs, horizonEndMs). weekIndex is
// weeks since `weekStartMs` (the config template Monday, at local midnight).
// DST-safe week index: whole calendar days between two local midnights ÷ 7. A
// fixed-ms week miscounts across a spring-forward / fall-back transition (a 167h
// or 169h week), collapsing two real weeks into one bucket.
export function weekIndexFor(startMs: number, weekStartMs: number): number {
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

// Every week of the month horizon (from the soonest future day to month end),
// keyed by the SAME weekIndex the direct calendar uses, with the calendar dates in
// that week. Lets a post-pass find weeks a case has NO direct in (unstaffed) and
// still place a caregiver contact there. DST-safe: steps by calendar day.
export function enumerateHorizonWeeks(config: BuilderConfig, now: Date): { weekIndex: number; dates: Date[] }[] {
  const lowerMs = Math.max(now.getTime(), parseLocalDate(config.monthHorizon.start).getTime());
  const monthEndMs = parseLocalDate(config.monthHorizon.end).getTime();
  const weekStartMs = parseLocalDate(config.weekStart).getTime();
  const byWeek = new Map<number, Date[]>();
  const d = new Date(lowerMs); d.setHours(0, 0, 0, 0);
  while (d.getTime() < monthEndMs) {
    const wi = weekIndexFor(d.getTime(), weekStartMs);
    const arr = byWeek.get(wi) ?? [];
    arr.push(new Date(d));
    byWeek.set(wi, arr);
    d.setDate(d.getDate() + 1);
  }
  return [...byWeek.entries()].sort((a, b) => a[0] - b[0]).map(([weekIndex, dates]) => ({ weekIndex, dates }));
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

export interface DirectCalendar {
  byClient: Map<string, DatedDirect[]>;
  directOps: WishOp[];
  directOpsHrs: number;
  blocks: ClientBlock[];
}

export function buildDirectCalendar(
  data: ScheduleData,
  recurringDirectOps: WishOp[],
  config: BuilderConfig,
  now: Date,
): DirectCalendar {
  const horizonStartMs = parseLocalDate(config.monthHorizon.start).getTime();
  const monthEndMs = parseLocalDate(config.monthHorizon.end).getTime();
  const weekStartMs = parseLocalDate(config.weekStart).getTime();
  const lowerMs = Math.max(now.getTime(), horizonStartMs); // never materialize a past week
  const resolveTech = makeResolver(data.technicians);
  const resolveClient = makeResolver(data.clients);
  const clientById = new Map(data.clients.map(c => [c.id, c]));

  // The DIRECT backbone extends per-client out to the client's authorization
  // coverage (the direct schedule is a long-lived commitment), while the CHASE
  // target slice (byClient, consumed by the supervision/PT passes) stays limited to
  // the current month (monthEndMs) — those are monthly targets. When we are NOT
  // building directs (a standalone supervision/PT run, chaseDirect:false), directs
  // stay month-scoped so a chase never lays down a full backbone.
  //
  // directEndFor is the loop's UPPER bound only — it reaches the furthest authorized
  // date (so back-to-back renewals are covered). The precise boundary is enforced
  // per-occurrence by the auth guard in emitDated (auth caps never bypass): a week
  // is materialized only if some authorization actually spans that date, so a
  // mid-month auth end, a gap between auths, or an unauthorized tail is never placed.
  // No authorization at all → the current month (owner decision; legacy/manual
  // recurring directs). expandDirectOccurrences' own loop guard caps the far horizon.
  const buildingDirects = config.chaseDirect !== false;
  const clientAuths = new Map<string, Authorization[]>();
  for (const a of (data.authorizations ?? [])) {
    const cid = resolveClient(a.clientId);
    if (!cid || !a.endDate) continue;
    const arr = clientAuths.get(cid) ?? [];
    arr.push(a);
    clientAuths.set(cid, arr);
  }
  const directEndCache = new Map<string, number>();
  const directEndFor = (cid: string): number => {
    if (!buildingDirects) return monthEndMs;
    const cached = directEndCache.get(cid);
    if (cached !== undefined) return cached;
    const auths = clientAuths.get(cid);
    const end = auths && auths.length
      ? Math.max(...auths.map(a => parseLocalDate(a.endDate).getTime() + DAY_MS)) // whole last authorized day
      : monthEndMs;
    directEndCache.set(cid, end);
    return end;
  };
  // Skip an occurrence whose date lies outside every one of the client's auth spans.
  // Clients with no authorization at all fall through (month-scoped legacy case).
  const authorizedOn = (cid: string, ymd: string): boolean => {
    const auths = clientAuths.get(cid);
    return !auths || auths.length === 0 || auths.some(a => inAuthSpan(ymd, a));
  };

  // Availability guard: a materialized occurrence must fall inside a real feasible
  // window (client availability ∩ the assigned BT's case availability) for its
  // weekday. This stops an existing recurring session — e.g. a one-off Saturday
  // makeup mis-flagged recurring, or an early pre-window session — from being cloned
  // forward onto days/times the BT does not actually work. Mirrors the fill loop's
  // feasibleWindowsLive geometry (same intersect), just checked per occurrence.
  const availCache = new Map<string, Interval[]>();
  const availableOn = (cid: string, tid: string | undefined, occ: Occ): boolean => {
    const client = clientById.get(cid);
    if (!client) return true; // can't evaluate the client → defer to other guards
    // Match the tech by id OR name — a session may store a short ref ("Sidiatu")
    // while the roster record is "Sidiatu K", in which case resolveTech hands back
    // the raw string and this find misses. That's fine: the CLIENT gate below still
    // applies, so an unresolved tech never bypasses availability (the bug that let a
    // completed Saturday session clone forward onto a day the client isn't open).
    const tech = tid ? data.technicians.find(t => t.id === tid || t.name === tid) : undefined;
    const jsDay = new Date(occ.startMs).getDay();
    const day = (jsDay === 0 ? DAYS[6] : DAYS[jsDay - 1]) as DayOfWeek; // Monday-first
    const key = `${cid}|${tech?.id ?? tid ?? '?'}|${day}`;
    let feasible = availCache.get(key);
    if (!feasible) {
      const clientAvail = windowsToIntervals(client.availabilityWindows?.[day]);
      const clientHasAvail = DAYS.some(d => (client.availabilityWindows?.[d]?.length ?? 0) > 0);
      if (tech) {
        let techAvail = btCaseAvailability(tech, cid, day);
        if (techAvail.length === 0) techAvail = btCaseAvailability(tech, client.name, day);
        feasible = intersect(clientAvail, techAvail);
      } else {
        // Tech unresolved: honor the client's windows alone. A client with defined
        // availability but none this weekday is closed (drops the stray Saturday /
        // early-start clones); a client with no windows at all is open all day.
        feasible = clientHasAvail ? clientAvail : [{ start: 0, end: 24 * 60 }];
      }
      availCache.set(key, feasible);
    }
    if (feasible.length === 0) return false;
    const s = new Date(occ.startMs), e = new Date(occ.endMs);
    const sMin = s.getHours() * 60 + s.getMinutes();
    const eMin = e.getHours() * 60 + e.getMinutes();
    return feasible.some(iv => sMin >= iv.start && eMin <= iv.end);
  };

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
    // Auth caps never bypass: never materialize a direct on a date the client isn't
    // authorized for (mid-month auth end, gap between renewals, or an out-of-span tail).
    if (!authorizedOn(cid, occ.startIso.slice(0, 10))) return;
    // Availability never bypass: never clone a session onto a day/time the client or
    // the assigned BT isn't actually available (drops mis-flagged makeups, early rows).
    if (!availableOn(cid, tid, occ)) return;
    if (collides(existing, occ.startMs, occ.endMs, tid, cid)) {
      const cname = clientById.get(cid)?.name ?? clientRef ?? '';
      blocks.push({
        clientId: cid, clientName: cname, directGapRemaining: 0, bindingConstraint: 'tech-contention',
        detail: `A ${cname} session on ${occ.startIso.slice(0, 10)} couldn't be materialized — it overlaps an existing session that week.`,
        occurrenceDate: occ.startIso.slice(0, 10),
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
    // Only current-month occurrences are chase targets (supervision/PT are monthly);
    // the backbone itself can run past the month to the auth end.
    if (occ.startMs < monthEndMs) {
      pushTarget({
        clientId: cid, clientName: client?.name ?? clientRef ?? '', techId: tid, techName: tech?.name ?? techRef,
        startMs: occ.startMs, endMs: occ.endMs, hours, weekIndex: occ.weekIndex, materialized: true,
      });
    }
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

    // The concrete row itself is a target when it falls in the current month.
    if (startMs >= lowerMs && startMs < monthEndMs) {
      pushTarget({
        clientId: cid, clientName: client?.name ?? a.client ?? '', techId: resolveTech(a.technician), techName: tech?.name ?? a.technician,
        startMs, endMs, hours: (endMs - startMs) / HR_MS, weekIndex: weekIndexOf(startMs), materialized: false,
      });
    }
    // Source B: a recurring existing direct — materialize its OTHER weeks out to the
    // client's direct-end (its own week is already the concrete row above; skip it).
    if (a.isRecurring) {
      const ownWeek = weekIndexOf(startMs);
      for (const occ of expandDirectOccurrences(new Date(a.startTime), endMs - startMs, weekStartMs, lowerMs, directEndFor(cid))) {
        if (occ.weekIndex === ownWeek) continue;
        emitDated(a.client, a.technician, a.title, occ);
      }
    }
  }

  // Source C: the NEW recurring direct ops from this build → dated every week out to
  // the client's direct-end (auth end when building directs, else the month).
  for (const op of recurringDirectOps) {
    if (op.op !== 'add' || op.type !== 'client-session' || !op.recurring) continue;
    const cid = resolveClient(op.client);
    if (!cid) continue;
    const durMs = new Date(op.end).getTime() - new Date(op.start).getTime();
    for (const occ of expandDirectOccurrences(new Date(op.start), durMs, weekStartMs, lowerMs, directEndFor(cid))) {
      emitDated(op.client, op.technician, op.title, occ);
    }
  }

  for (const arr of byClient.values()) arr.sort((x, y) => x.startMs - y.startMs);
  return { byClient, directOps, directOpsHrs, blocks };
}

// ── BCBA availability windows on a given date (ms bounds) ──────────────────────
// Exported for builderScoring.ts (the scored slot enumerator shares this geometry).
export function clinicianWindowsForDate(data: ScheduleData, date: Date): { s: number; e: number }[] {
  const avail = data.settings.clinicianAvailability as Record<string, TimeWindow[]> | undefined;
  const day0 = new Date(date); day0.setHours(0, 0, 0, 0);
  if (!avail) return [{ s: day0.getTime(), e: day0.getTime() + DAY_MS }]; // unset → available all day
  const ws = avail[DAY_OF_WEEK[date.getDay()]];
  if (!ws || ws.length === 0) return [];
  return ws.map(w => ({ s: day0.getTime() + toMin(w.start) * 60_000, e: day0.getTime() + toMin(w.end) * 60_000 }));
}

// Free sub-gaps of [s,e) after removing the BCBA-busy intervals. When a travel
// context is supplied AND a candidate location `thisLoc` is given, each busy
// block is INFLATED by the drive time between its location and the candidate's —
// a block at a different city reserves not just its own time but the minutes the
// BCBA needs to reach it (before) and leave it (after). travelMinutes self-guards
// (returns 0 when travel is disabled, same-site, or a location is unknown), so
// with no ctx this is the plain overlap subtraction it always was.
// Exported for builderScoring.ts (candidate enumeration reuses the same
// travel-inflated feasibility geometry — scoring must never relax it).
export function freeGaps(
  s: number, e: number, busy: BcbaBusy, thisLoc?: LocKey, ctx?: TravelContext,
): { s: number; e: number }[] {
  let cur = [{ s, e }];
  for (const b of busy) {
    let bs = b.s, be = b.e;
    if (ctx) {
      bs -= travelMinutes(thisLoc, b.loc, b.s, ctx) * 60_000; // time to ARRIVE at b before it starts
      be += travelMinutes(b.loc, thisLoc, b.e, ctx) * 60_000; // time to LEAVE b after it ends
    }
    const next: { s: number; e: number }[] = [];
    for (const seg of cur) {
      if (be <= seg.s || bs >= seg.e) { next.push(seg); continue; }
      if (bs > seg.s) next.push({ s: seg.s, e: bs });
      if (be < seg.e) next.push({ s: be, e: seg.e });
    }
    cur = next;
  }
  return cur;
}

// The earliest BCBA subinterval of ~desiredH inside `d` that is within BCBA
// availability AND BCBA-free. Returns null when no ≥ MIN_SUP_HRS slot fits. Used by
// both the supervision and parent-training passes (the placed session overlaps the
// direct `d` and, when it names the direct's BT, earns supervision credit).
// When `ctx` is supplied, the slot must also leave enough drive time to/from any
// differently-located BCBA block (the "same human body" can't teleport).
export function placeBcbaSubinterval(
  data: ScheduleData, d: DatedDirect, desiredH: number, bcbaBusy: BcbaBusy, ctx?: TravelContext,
): { startMs: number; endMs: number; startIso: string; endIso: string } | null {
  const desMs = Math.max(MIN_SUP_HRS, Math.min(desiredH, MAX_SUP_HRS)) * HR_MS;
  const minMs = MIN_SUP_HRS * HR_MS;
  for (const w of clinicianWindowsForDate(data, new Date(d.startMs))) {
    const segS = Math.max(d.startMs, w.s);
    const segE = Math.min(d.endMs, w.e);
    if (segE - segS < minMs) continue;
    for (const g of freeGaps(segS, segE, bcbaBusy, d.clientId, ctx)) {
      if (g.e - g.s < minMs) continue;
      const startMs = g.s;
      const endMs = Math.min(g.e, startMs + desMs);
      if (endMs - startMs < minMs) continue;
      return { startMs, endMs, startIso: isoLocal(new Date(startMs)), endIso: isoLocal(new Date(endMs)) };
    }
  }
  return null;
}

// Seed the plane with existing BCBA sessions, each tagged with the client whose
// site it happens at (so travel is enforced against them). Client-less BCBA work
// (case-planning, internal) is location-neutral → loc undefined.
export function seedBcbaBusy(data: ScheduleData): BcbaBusy {
  const idOf = (ref?: string): string | undefined =>
    ref ? data.clients.find(c => c.id === ref || c.name === ref)?.id : undefined;
  return data.appointments
    .filter(a => isActive(a) && BCBA_TYPES.has(a.type))
    .map(a => ({ s: new Date(a.startTime).getTime(), e: new Date(a.endTime).getTime(), loc: idOf(a.client) }));
}
