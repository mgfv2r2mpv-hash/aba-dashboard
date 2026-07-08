// Deterministic direct-schedule builder (Phase 1 — the "heart").
//
// Generalizes solveMeetPace (localSolver.ts) across ALL cases over a month, using
// live occupancy (builderOccupancy.ts) so it can place a whole caseload in one
// pass without double-booking. It emits a recurring weekly DIRECT backbone as
// WishOps that ride the existing wishSolutionToDraft → solveDraft → SolutionCard
// pipeline. Supervision, parent-training, and repair are later phases.
//
// Owner decisions honored:
//   - Deterministic core; Claude never places an appointment (it only turns
//     freeform intent into BuilderConfig and explains the result — wired later).
//   - Recurring weekly direct backbone; month self-check guards cross-week safety
//     the single-week solveDraft badge cannot see.
//   - Hard constraints (availability, no double-book, auth caps) are inviolable;
//     compliance floors are chased; unreachable ones are FLAGGED as ClientBlocks,
//     never silently missed. Everyone who CAN be placed is placed (partial
//     success, never total failure).

import { ScheduleData, Client, WishOp, WishSolution, DayOfWeek } from './types';
import { findAuthFor } from './authorization';
import { DAYS, toMin, minToClock, Interval, intersect, subtract, normalize, windowsToIntervals, btCaseAvailability } from './intervals';
import { Occupancy, LiveWindow, seedOccupancy, feasibleWindowsLive, reserve, dayOfWeekOf } from './builderOccupancy';
import { monthPeriod } from './compliance';
import { resolveUtilization } from './utilization';
import { placeSupervision, SupervisionMetrics, EMPTY_SUPERVISION_METRICS } from './builderSupervision';
import { placeParentTraining, ParentTrainingMetrics, EMPTY_PARENT_TRAINING_METRICS } from './builderPT';
import { buildDirectCalendar, seedBcbaBusy } from './builderBcba';
import { startOfWeek, startOfDay, addWeeks } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';

const MAX_DIRECT_SESSION_HRS = 4;   // realistic direct block; also forces day-spread
const MIN_SESSION_HRS = 0.5;        // ignore remainders smaller than 30 min
const HR_MS = 3_600_000;

export interface BuilderConfig {
  weekStart: string;                    // ISO Monday — the recurring "template" week
  monthHorizon: { start: string; end: string };  // for the cross-week self-check
  bcbaWeeklyBillableTarget: number;     // carried for later phases (supervision)
  chaseDirect: boolean;                 // Phase 1 uses only this
  chaseSupervision?: boolean;
  chasePT?: boolean;
  clientOverrides?: Record<string, { directTarget?: number; maxSessionHrs?: number; skip?: boolean }>;
}

export interface ClientBlock {
  clientId: string;
  clientName: string;
  directGapRemaining: number;
  // `bcba-availability` (supervision) and `pt-availability` (parent training) are
  // BCBA-time shortfalls — the BCBA couldn't reach the case's supervision floor /
  // cadence or its PT hours goal. Both are tracked separately from the direct-
  // staffing gap (via supervisionGapRemaining / ptGapRemaining) so casesFullyStaffed
  // keys only off direct blocks.
  bindingConstraint: 'availability' | 'tech-contention' | 'auth-cap' | 'bcba-availability' | 'pt-availability' | 'no-authorization' | 'none';
  detail: string;
  supervisionGapRemaining?: number;
  ptGapRemaining?: number;
  // Set on PER-OCCURRENCE blocks (one failed weekly materialization), so the
  // readout can collapse a case's many identical week-failures into a single
  // dated summary instead of one card per week. Absent on case-level blocks.
  occurrenceDate?: string; // 'YYYY-MM-DD'
}

export interface BuildResult {
  solution: WishSolution;               // ops → wishSolutionToDraft
  blocks: ClientBlock[];
  metrics: {
    directHrsPlaced: number;
    casesFullyStaffed: number;
    totalCases: number;
    // Which passes actually ran (drive the display; a supervision-only build
    // legitimately places 0h of direct, a direct-only build places 0 supervision).
    directBuilt: boolean;
    supervisionBuilt: boolean;
    ptBuilt: boolean;
  } & SupervisionMetrics & ParentTrainingMetrics;
}

// ── date helpers (local, no TZ suffix — matches appointment format) ────────────
const pad = (n: number) => String(n).padStart(2, '0');
const parseLocalDate = (iso: string): Date => new Date(`${iso.slice(0, 10)}T00:00:00`);
const isoOf = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d: Date, n: number): Date => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const hoursBetween = (startIso: string, endIso: string): number =>
  Math.max(0, new Date(endIso).getTime() - new Date(startIso).getTime()) / HR_MS;

// Compact title for a builder-placed session: the first two letters of the
// client's FIRST name and the first letter of each part of the technician's name
// — e.g. client "Archie Client" + tech "Mike Technician" → "AR / MT". Gives the
// BCBA an at-a-glance who/who on each placed block without spelling out names.
// Safe: the anonymizer already drops every title from prompts (anonymizer.ts), so
// these initials never leave the device.
export function sessionTitle(clientName: string, techName?: string): string {
  // First name only (first whitespace-delimited token), first two letters — no spaces.
  const firstName = (clientName || '').trim().split(/\s+/)[0] ?? '';
  const cl = firstName.slice(0, 2).toUpperCase();
  const bt = (techName || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w[0])
    .join('')
    .toUpperCase();
  return bt ? `${cl} / ${bt}` : cl;
}

interface CasePlan {
  client: Client;
  target: number;         // weekly direct target (auth, clamped by override)
  gap: number;            // target − already-scheduled this template week
  seedWindowMins: number; // total feasible window minutes on the SEED board (MRV)
  authClamped: boolean;   // an override.directTarget below auth was the binding cap
}

interface ExtendResult {
  gap: number;            // weekly gap left after extensions
  ops: WishOp[];          // per-instance resize (move) ops across the horizon
  weeklyHrsAdded: number; // hours added per week (for the template-week accounting)
  horizonHrsAdded: number;// hours added across all resized future instances
  days: Set<string>;      // template-week dates an extension grew into
}

const isResizable = (a: { status?: string; isGhost?: boolean }): boolean =>
  // Active and not a past fact — status is often UNDEFINED for a plain scheduled
  // row (the codebase treats unset as active); completed/canceled is history.
  a.status !== 'canceled' && a.status !== 'completed' && !a.isGhost;

// The STEADY-STATE weekly occupancy: every recurring direct contributes its
// time-of-day to its weekday (it materializes into every week), and every future
// one-off contributes its own weekday. Keyed by client id and by tech ref. Because
// a resize moves EVERY instance of a series uniformly, checking a grown span
// against this union-over-all-weeks footprint guarantees the span is free in EVERY
// week — the template-week-only `occ` misses recurring rows anchored in other weeks
// (which still materialize into the template week), and move ops bypass the
// materializer's own collision guard, so this is what keeps resizes double-book-safe.
//
// NB: this must mirror what buildDirectCalendar actually MATERIALIZES, which clones
// forward every non-canceled recurring row — INCLUDING completed ones (a completed
// recurring session still occupies its weekday in future weeks). That's a broader
// set than `isResizable` (which excludes completed, since we must never MOVE a
// completed fact). BUT the materializer's collision guard DROPS a completed clone
// where it overlaps the solid backbone (a scheduled row that ran longer leaves a
// completed 15:30–18:00 over a scheduled 15:30–17:30 — the clone collides and is
// dropped). Counting such a clone would wrongly block a resize into space that is
// actually free. So: solid backbone (scheduled + future one-offs) always counts; a
// completed-recurring clone counts ONLY where it is disjoint from the same client's
// solid backbone (like a separate standing session at a different time, which DOES
// materialize forward).
function buildWeeklyFootprint(data: ScheduleData, now: Date): Occupancy {
  const fp: Occupancy = { tech: new Map(), client: new Map() };
  const nowMs = now.getTime();
  const add = (map: Map<string, Partial<Record<DayOfWeek, Interval[]>>>, key: string, day: DayOfWeek, iv: Interval) => {
    const rec = map.get(key) ?? {};
    rec[day] = normalize([...(rec[day] ?? []), iv]);
    map.set(key, rec);
  };
  const clientIdOf = (a: { client?: string }) => data.clients.find(c => c.id === a.client || c.name === a.client)?.id ?? a.client;
  const dayIv = (a: { startTime: string; endTime: string }): { day: DayOfWeek; iv: Interval } => {
    const s = new Date(a.startTime), e = new Date(a.endTime);
    return { day: dayOfWeekOf(s), iv: { start: s.getHours() * 60 + s.getMinutes(), end: e.getHours() * 60 + e.getMinutes() } };
  };

  // Pass 1: solid backbone = scheduled recurring + future one-offs, per client/weekday.
  const solidClient = new Map<string, Partial<Record<DayOfWeek, Interval[]>>>();
  for (const a of data.appointments) {
    if (a.type !== 'client-session' || a.status === 'canceled' || a.status === 'completed' || a.isGhost) continue;
    if (!a.isRecurring && new Date(a.endTime).getTime() < nowMs) continue; // past one-off — won't recur
    const { day, iv } = dayIv(a);
    const cid = clientIdOf(a);
    if (cid) add(solidClient, cid, day, iv);
    if (cid) add(fp.client, cid, day, iv);
    if (a.technician) add(fp.tech, a.technician, day, iv);
  }

  // Pass 2: completed-recurring clones — count only where disjoint from the client's
  // solid backbone (an overlapping clone is dropped by the materializer, so it's free).
  for (const a of data.appointments) {
    if (a.type !== 'client-session' || !a.isRecurring || a.status !== 'completed' || a.isGhost) continue;
    const { day, iv } = dayIv(a);
    const cid = clientIdOf(a);
    const overlapsSolid = cid && (solidClient.get(cid)?.[day] ?? []).some(s => s.start < iv.end && iv.start < s.end);
    if (overlapsSolid) continue;
    if (cid) add(fp.client, cid, day, iv);
    if (a.technician) add(fp.tech, a.technician, day, iv);
  }
  return fp;
}

// Prefer GROWING an existing adjacent session over adding a fragment. For each of
// this case's scheduled directs in the template week, find the contiguous free
// window around it — client ∩ tech availability minus the steady-state weekly
// footprint (every other recurring/one-off booking, the seed itself excluded) — and
// lengthen it, later end first then earlier start ("a move with an earlier start and
// later end"), just enough to close the weekly gap, capped at the block max and that
// window. The resize is applied to EVERY future instance of the series (a move op
// each); the grown span is reserved into both the footprint (so later seeds see it)
// and `occ` (so the fill loop won't reuse it). Completed/past rows never move.
function extendAdjacentDirects(
  data: ScheduleData,
  client: Client,
  gap: number,
  maxSessionHrs: number,
  occ: Occupancy,
  footprint: Occupancy,
  weekStart: Date,
  now: Date,
): ExtendResult {
  const ops: WishOp[] = [];
  const days = new Set<string>();
  let weeklyHrsAdded = 0;
  let horizonHrsAdded = 0;
  if (gap < MIN_SESSION_HRS) return { gap, ops, weeklyHrsAdded, horizonHrsAdded, days };

  const startMs = weekStart.getTime();
  const endMs = startMs + 7 * 86_400_000;
  const nowMs = now.getTime();
  const forClient = (a: { client?: string }) => a.client === client.id || a.client === client.name;

  // Seeds = this case's scheduled directs sitting in the template week.
  const seeds = data.appointments.filter(a =>
    a.type === 'client-session' && isResizable(a) && forClient(a)
    && new Date(a.startTime).getTime() >= startMs && new Date(a.startTime).getTime() < endMs);
  // Longest block first — consolidating into the biggest session keeps the week tidy.
  seeds.sort((a, b) => hoursBetween(b.startTime, b.endTime) - hoursBetween(a.startTime, a.endTime));

  for (const seed of seeds) {
    if (gap < MIN_SESSION_HRS) break;
    const s = new Date(seed.startTime), e = new Date(seed.endTime);
    const day = dayOfWeekOf(s);
    const sMin = s.getHours() * 60 + s.getMinutes();
    const eMin = e.getHours() * 60 + e.getMinutes();
    if ((eMin - sMin) / 60 >= maxSessionHrs) continue; // already at the block cap
    const techName = seed.technician;
    if (!techName) continue;
    const tech = data.technicians.find(t => t.id === techName || t.name === techName);

    // Contiguous free window around the seed. The seed's own interval is excluded
    // (it's what we grow); every OTHER booking on client/tech that weekday blocks —
    // read from the steady-state footprint so a recurring row anchored elsewhere
    // still counts.
    const clientAvail = windowsToIntervals(client.availabilityWindows?.[day]);
    if (clientAvail.length === 0) continue; // client isn't open this weekday
    let techAvail: Interval[] = [{ start: 0, end: 1440 }];
    if (tech) {
      let ta = btCaseAvailability(tech, client.id, day);
      if (ta.length === 0) ta = btCaseAvailability(tech, client.name, day);
      techAvail = ta.length ? ta : [{ start: 0, end: 1440 }];
    }
    const seedIv: Interval = { start: sMin, end: eMin };
    const clientBusy = subtract(footprint.client.get(client.id)?.[day] ?? [], [seedIv]);
    const techBusy = subtract(footprint.tech.get(techName)?.[day] ?? [], [seedIv]);
    const free = subtract(intersect(clientAvail, techAvail), [...clientBusy, ...techBusy]);
    const seg = free.find(iv => iv.start <= sMin && iv.end >= eMin);
    if (!seg) continue;

    // Grow just enough to close the gap, capped at the block max and the segment.
    const capMin = Math.min(maxSessionHrs * 60, seg.end - seg.start);
    const wantMin = Math.min(Math.round((eMin - sMin) + gap * 60), capMin);
    if (wantMin - (eMin - sMin) < MIN_SESSION_HRS * 60) continue; // <30 min gain — skip
    // Later end first; if the tail runs out, take the rest from an earlier start.
    let newEnd = Math.min(seg.end, sMin + wantMin);
    let newStart = newEnd - wantMin;
    if (newStart < seg.start) { newStart = seg.start; newEnd = newStart + wantMin; }
    const addedHrs = ((newEnd - newStart) - (eMin - sMin)) / 60;
    if (addedHrs < MIN_SESSION_HRS) continue;

    // Resize every future instance of this series (same client, tech, weekday, and
    // original start/end time-of-day) to the grown span.
    let moved = 0;
    for (const inst of data.appointments) {
      if (inst.type !== 'client-session' || !isResizable(inst)) continue;
      if (!forClient(inst) || inst.technician !== techName) continue;
      const is = new Date(inst.startTime), ie = new Date(inst.endTime);
      if (is.getTime() < nowMs || dayOfWeekOf(is) !== day) continue; // never touch the past
      if (is.getHours() * 60 + is.getMinutes() !== sMin) continue;
      if (ie.getHours() * 60 + ie.getMinutes() !== eMin) continue;
      const d = inst.startTime.slice(0, 10);
      ops.push({ op: 'move', appointmentId: inst.id, start: `${d}T${minToClock(newStart)}:00`, end: `${d}T${minToClock(newEnd)}:00` });
      moved++;
    }
    if (moved === 0) continue;

    // Reserve the grown span in BOTH planes: the footprint (later seeds this run) and
    // occ (the fill loop). Reserve under the resolved tech name too when it differs
    // from the stored ref, so a case that looks the tech up by record name still sees it.
    const grown: Interval = { start: newStart, end: newEnd };
    reserve(occ, techName, client.id, day, grown);
    reserve(footprint, techName, client.id, day, grown);
    if (tech && tech.name !== techName) {
      reserve(occ, tech.name, client.id, day, grown);
      reserve(footprint, tech.name, client.id, day, grown);
    }
    gap = Math.max(0, gap - addedHrs);
    weeklyHrsAdded += addedHrs;
    horizonHrsAdded += addedHrs * moved;
    days.add(seed.startTime.slice(0, 10));
  }
  return { gap, ops, weeklyHrsAdded, horizonHrsAdded, days };
}

export function buildSchedule(data: ScheduleData, config: BuilderConfig, now: Date): BuildResult {
  const weekStart = parseLocalDate(config.weekStart);
  const weekDates = DAYS.map((day, d) => ({ day, date: isoOf(addDays(weekStart, d)) }));
  const occ = seedOccupancy(data, weekStart);
  const footprint = buildWeeklyFootprint(data, now); // steady-state weekly busy for safe resizes

  const startMs = weekStart.getTime();
  const endMs = startMs + 7 * 86_400_000;
  const inTemplateWeek = (iso: string): boolean => {
    const t = new Date(iso).getTime();
    return t >= startMs && t < endMs;
  };

  // Per-tech-per-case placed hours: load-balances tech selection and softly caps
  // at assignment.hoursPerWeek.
  const techCasePlaced = new Map<string, number>(); // `${techName}|${clientId}` → hrs
  const capKey = (techName: string, clientId: string) => `${techName}|${clientId}`;

  // Pick, among the BTs free for a window, the one with the most remaining weekly
  // capacity for this case (improves on solveMeetPace's techs[0]).
  const pickTech = (techs: LiveWindow['techs'], client: Client): LiveWindow['techs'][number] | null => {
    let best: LiveWindow['techs'][number] | null = null;
    let bestRemaining = -Infinity;
    for (const t of techs) {
      const tech = data.technicians.find(x => x.id === t.id);
      const asg = tech?.assignments.find(a => a.clientId === client.id || a.clientId === client.name);
      const cap = asg?.hoursPerWeek && asg.hoursPerWeek > 0 ? asg.hoursPerWeek : Infinity;
      const remaining = cap - (techCasePlaced.get(capKey(t.name, client.id)) ?? 0);
      if (remaining > bestRemaining) { bestRemaining = remaining; best = t; }
    }
    return best;
  };

  // ── Build per-client plans + MRV ordering ────────────────────────────────────
  const plans: CasePlan[] = [];
  const blocks: ClientBlock[] = [];
  for (const client of data.clients) {
    const override = config.clientOverrides?.[client.id];
    if (override?.skip) continue;

    const auth = findAuthFor(data, client.id, config.weekStart) || findAuthFor(data, client.name, config.weekStart);
    const authWeekly = auth?.weekly?.direct && auth.weekly.direct > 0 ? auth.weekly.direct : 0;

    let target = authWeekly;
    let authClamped = false;
    if (override?.directTarget != null && override.directTarget > 0) {
      target = authWeekly > 0 ? Math.min(authWeekly, override.directTarget) : override.directTarget;
      authClamped = authWeekly > 0 && override.directTarget < authWeekly;
    }
    if (target <= 0) {
      // Say WHY the case is skipped instead of silently vanishing — a wizard-only
      // schedule (no authorizations yet) used to read "everything is already at
      // target", the single worst from-scratch trap. Only the direct pass owns
      // this diagnosis (a sup/PT-only build would just repeat it as noise), and
      // directGapRemaining stays 0 so casesFullyStaffed semantics are unchanged.
      if (config.chaseDirect !== false) {
        blocks.push({
          clientId: client.id, clientName: client.name, directGapRemaining: 0,
          bindingConstraint: 'no-authorization',
          detail: auth
            ? `${client.name}'s authorization has no weekly direct hours — set one under Caseload → Auths.`
            : `${client.name} has no authorization covering the week of ${config.weekStart} — add one under Caseload → Auths.`,
        });
      }
      continue; // no authorization/target → nothing to build for this case
    }

    const scheduled = data.appointments
      .filter(a => a.type === 'client-session' && a.status !== 'canceled' && !a.isGhost
        && (a.client === client.id || a.client === client.name) && inTemplateWeek(a.startTime))
      .reduce((s, a) => s + hoursBetween(a.startTime, a.endTime), 0);
    const gap = Math.max(0, target - scheduled);

    const seedWindowMins = weekDates.reduce((sum, { day, date }) =>
      sum + feasibleWindowsLive(data, client, day, date, occ)
        .reduce((s, w) => s + (toMin(w.end) - toMin(w.start)), 0), 0);

    plans.push({ client, target, gap, seedWindowMins, authClamped });
  }

  // Most-constrained-first: least room relative to need goes first, so scarce
  // shared techs aren't consumed by an easy case. Tie-break by larger gap.
  const toFill = plans.filter(p => p.gap >= MIN_SESSION_HRS);
  toFill.sort((a, b) => {
    const ra = a.seedWindowMins / Math.max(1, a.gap * 60);
    const rb = b.seedWindowMins / Math.max(1, b.gap * 60);
    if (ra !== rb) return ra - rb;
    return b.gap - a.gap;
  });

  // ── Fill loop ────────────────────────────────────────────────────────────────
  const ops: WishOp[] = [];
  const extendOps: WishOp[] = []; // per-instance resizes of existing sessions (not materialized)
  let directHrsPlaced = 0;
  let extendedHorizonHrs = 0;     // hours the extension pass added across the horizon

  // Skip direct placement entirely for a standalone supervision build
  // (chaseDirect:false), which supervises over the existing/materialized directs.
  if (config.chaseDirect !== false) for (const plan of toFill) {
    const { client } = plan;
    const maxSessionHrs = config.clientOverrides?.[client.id]?.maxSessionHrs ?? MAX_DIRECT_SESSION_HRS;
    let gap = plan.gap;
    const daysUsed = new Set<string>();

    // Prefer growing an adjacent existing session over placing a new fragment.
    const ext = extendAdjacentDirects(data, client, gap, maxSessionHrs, occ, footprint, weekStart, now);
    if (ext.ops.length) {
      extendOps.push(...ext.ops);
      gap = ext.gap;
      extendedHorizonHrs += ext.horizonHrsAdded;
      for (const d of ext.days) daysUsed.add(d);
    }

    let progress = true;
    while (gap >= MIN_SESSION_HRS && progress) {
      progress = false;
      // Recompute against LIVE occupancy every pass (cheap; guarantees no stale slot).
      const windows = weekDates.flatMap(({ day, date }) => feasibleWindowsLive(data, client, day, date, occ));
      if (windows.length === 0) break;

      const byDate = new Map<string, LiveWindow[]>();
      for (const w of windows) { const arr = byDate.get(w.date) ?? []; arr.push(w); byDate.set(w.date, arr); }
      const dates = [...byDate.keys()].sort();
      // Prefer days not yet used this week (spread), then reuse.
      const order = [...dates.filter(d => !daysUsed.has(d)), ...dates.filter(d => daysUsed.has(d))];

      for (const date of order) {
        if (gap < MIN_SESSION_HRS) break;
        let placedOnDate = false;
        for (const w of byDate.get(date)!) {
          const capHrs = (toMin(w.end) - toMin(w.start)) / 60;
          if (capHrs < MIN_SESSION_HRS) continue;
          const tech = pickTech(w.techs, client);
          if (!tech) continue;
          const sessHrs = Math.min(capHrs, gap, maxSessionHrs);
          if (sessHrs < MIN_SESSION_HRS) continue;

          const startMin = toMin(w.start);
          const endMin = startMin + Math.round(sessHrs * 60);
          ops.push({
            op: 'add', type: 'client-session', title: sessionTitle(client.name, tech.name),
            client: client.name, technician: tech.name,
            start: `${date}T${w.start}:00`, end: `${date}T${minToClock(endMin)}:00`,
            recurring: true, pattern: 'weekly',
          });
          const iv: Interval = { start: startMin, end: endMin };
          reserve(occ, tech.name, client.id, w.day, iv);
          techCasePlaced.set(capKey(tech.name, client.id), (techCasePlaced.get(capKey(tech.name, client.id)) ?? 0) + sessHrs);
          gap -= sessHrs;
          directHrsPlaced += sessHrs;
          daysUsed.add(date);
          progress = true;
          placedOnDate = true;
          break; // one placement per date per pass
        }
        if (placedOnDate) break; // one placement per pass → recompute live windows (round-robin)
      }
    }

    if (gap >= MIN_SESSION_HRS) {
      const liveWindowsNow = weekDates.flatMap(({ day, date }) => feasibleWindowsLive(data, client, day, date, occ)).length;
      let binding: ClientBlock['bindingConstraint'];
      let detail: string;
      if (plan.seedWindowMins === 0) {
        binding = 'availability';
        detail = `No open direct window for ${client.name} — check client/BT availability overlap or blackouts.`;
      } else if (liveWindowsNow === 0) {
        binding = 'tech-contention';
        detail = `${client.name}'s windows were taken by other cases sharing the same BT(s) this week.`;
      } else if (plan.authClamped) {
        binding = 'auth-cap';
        detail = `${client.name} capped below its authorization by a per-case override.`;
      } else {
        binding = 'tech-contention';
        detail = `${gap.toFixed(1)}h of ${client.name}'s direct target didn't fit (BT weekly capacity / min-session size).`;
      }
      blocks.push({ clientId: client.id, clientName: client.name, directGapRemaining: +gap.toFixed(2), bindingConstraint: binding, detail });
    }
  }

  // ── Materialize the direct backbone + run the BCBA passes ────────────────────
  // Every build MATERIALIZES the direct backbone into dated rows ONCE (the app
  // never expands a `recurring` flag, so an unmaterialized direct is invisible past
  // week 1 and understates monthly compliance). When building directs the backbone
  // extends per-client out to the AUTHORIZATION END (buildDirectCalendar), while
  // the chase target slice stays monthly. Supervision then parent-training place
  // against that single calendar, threading ONE growing BCBA-busy plane so they
  // never double-book the one BCBA. Supervision runs first (the hard BACB floor
  // gets first claim on scarce BCBA time); PT fills the remaining free sub-slots.
  // Materialization is collision-aware, subsuming the recurring-only monthSelfCheck
  // (kept only for the degenerate no-flags-set case).
  const buildingDirects = config.chaseDirect !== false;
  const chaseSupervision = config.chaseSupervision === true;
  const chasePT = config.chasePT === true;
  let finalOps: WishOp[] = [...ops, ...extendOps];
  let supMetrics: SupervisionMetrics = EMPTY_SUPERVISION_METRICS;
  let ptMetrics: ParentTrainingMetrics = EMPTY_PARENT_TRAINING_METRICS;
  if (buildingDirects || chaseSupervision || chasePT) {
    const cal = buildDirectCalendar(data, ops, config, now);
    let bcbaBusy = seedBcbaBusy(data);
    blocks.push(...cal.blocks);
    const bcbaOps: WishOp[] = [];
    if (chaseSupervision) {
      const sup = placeSupervision(data, cal, bcbaBusy, now);
      bcbaBusy = sup.busyOut;
      bcbaOps.push(...sup.supOps);
      blocks.push(...sup.blocks);
      supMetrics = sup.metrics;
    }
    if (chasePT) {
      // Known limitation (accepted for v1 — the cross-pass reconciliation is
      // deferred): a PT session placed here overlaps a direct and names the BT, so
      // post-commit it ALSO earns supervision credit. In a combined build that can
      // lift a case the supervision pass reported floor-short (above) to/over its
      // floor — yet that bcba-availability block and casesMeetingFloor are NOT
      // walked back. The residual is therefore CONSERVATIVE (it can over-warn a
      // supervision shortfall PT actually covered, never a silent miss) and the
      // staged schedule is correct; the compliance dashboard is the source of truth.
      const pt = placeParentTraining(data, cal, bcbaBusy, now);
      bcbaBusy = pt.busyOut;
      bcbaOps.push(...pt.ptOps);
      blocks.push(...pt.blocks);
      ptMetrics = pt.metrics;
    }
    // Dated backbone emitted ONCE, plus the resizes of existing sessions (which
    // buildDirectCalendar doesn't materialize — they edit rows already on the board).
    finalOps = [...cal.directOps, ...bcbaOps, ...extendOps];
    directHrsPlaced = cal.directOpsHrs + extendedHorizonHrs; // materialized + grown
  } else {
    const selfCheckBlocks = monthSelfCheck(data, ops, config, weekStart);
    blocks.push(...selfCheckBlocks);
  }

  const totalCases = plans.length;
  // Only a DIRECT staffing gap un-staffs a case; the BCBA-time shortfalls
  // (bcba-availability / pt-availability) are separate, tracked via
  // supervisionGapRemaining / ptGapRemaining.
  const directBlocked = blocks.filter(b =>
    b.bindingConstraint !== 'bcba-availability' && b.bindingConstraint !== 'pt-availability'
    && b.directGapRemaining >= MIN_SESSION_HRS).length;
  const casesFullyStaffed = totalCases - directBlocked;
  const supPlaced = supMetrics.supervisionHrsPlaced;
  const ptPlaced = ptMetrics.ptHrsPlaced;

  // Composable BCBA tail so a directs-only, +supervision, +PT, or all-three build
  // each reads correctly.
  const bcbaTail =
    (chaseSupervision ? ` + ${supPlaced.toFixed(1)}h supervision` : '') +
    (chasePT ? ` + ${ptPlaced.toFixed(1)}h parent training` : '');
  const summary = finalOps.length === 0
    ? (blocks.length ? `Nothing placed — ${blocks.length} case(s) blocked` : 'Nothing to build — all cases already at target')
    : bcbaTail
      ? `Built ${directHrsPlaced.toFixed(1)}h direct${bcbaTail} across ${casesFullyStaffed}/${totalCases} case(s)`
      : `Built ${directHrsPlaced.toFixed(1)}h of direct backbone across ${casesFullyStaffed}/${totalCases} case(s)`;
  const reasoning = blocks.length
    ? `Placed ${directHrsPlaced.toFixed(1)}h direct${bcbaTail}. Residual: ${blocks.map(b => `${b.clientName} (${b.detail})`).join('; ')}.`
    : `Placed ${directHrsPlaced.toFixed(1)}h of direct${bcbaTail || ' backbone'} across ${casesFullyStaffed} case(s), most-constrained first, with no double-booking.`;

  return {
    solution: { id: uuidv4(), summary, reasoning, ops: finalOps },
    blocks,
    metrics: {
      directHrsPlaced: +directHrsPlaced.toFixed(2),
      casesFullyStaffed,
      totalCases,
      directBuilt: config.chaseDirect !== false,
      supervisionBuilt: chaseSupervision,
      ptBuilt: chasePT,
      ...supMetrics,
      ...ptMetrics,
    },
  };
}

// Expand each recurring op across the horizon and check every dated occurrence
// against the existing (non-generated) active appointments for a same-tech or
// same-client time overlap. Returns a block per colliding op (informational —
// the template-week placement itself is conflict-free by construction).
function monthSelfCheck(
  data: ScheduleData,
  ops: WishOp[],
  config: BuilderConfig,
  weekStart: Date,
): ClientBlock[] {
  const horizonStart = parseLocalDate(config.monthHorizon.start).getTime();
  const horizonEnd = parseLocalDate(config.monthHorizon.end).getTime();
  const existing = data.appointments
    .filter(a => a.status !== 'canceled' && !a.isGhost)
    .map(a => ({
      s: new Date(a.startTime).getTime(), e: new Date(a.endTime).getTime(),
      tech: a.technician, client: a.client,
    }));

  const out: ClientBlock[] = [];
  for (const op of ops) {
    if (op.op !== 'add' || !op.recurring) continue;
    const tplStart = new Date(op.start);
    const tplEnd = new Date(op.end);
    const startClock = { h: tplStart.getHours(), m: tplStart.getMinutes() };
    const durMs = tplEnd.getTime() - tplStart.getTime();

    // Occurrences: same weekday each week from the template date forward.
    for (let wk = 0; ; wk++) {
      const occStart = new Date(tplStart); occStart.setDate(occStart.getDate() + wk * 7);
      occStart.setHours(startClock.h, startClock.m, 0, 0);
      const occStartMs = occStart.getTime();
      if (occStartMs >= horizonEnd) break;
      if (occStartMs < horizonStart || occStartMs < weekStart.getTime()) continue;
      const occEndMs = occStartMs + durMs;
      const clash = existing.some(x =>
        x.s < occEndMs && x.e > occStartMs &&
        (x.tech === op.technician || (op.client != null && x.client === op.client)));
      if (clash) {
        out.push({
          clientId: op.client ?? '', clientName: op.client ?? '',
          directGapRemaining: 0, bindingConstraint: 'tech-contention',
          detail: `Recurring ${op.client ?? 'session'} on ${isoOf(occStart)} ${op.start.slice(11, 16)} overlaps an existing session that week — will need a per-week adjustment.`,
          occurrenceDate: isoOf(occStart),
        });
        break; // one flag per op is enough
      }
    }
  }
  return out;
}

// A sensible default config for the one-tap "Build direct schedule" action: the
// current week is the recurring template, the calendar month is the horizon, and
// the BCBA weekly billable target comes from settings. Direct backbone only (the
// builder's current capability — supervision/PT are later builder phases).
export function defaultBuilderConfig(data: ScheduleData, now: Date): BuilderConfig {
  const period = monthPeriod(now);
  // Anchor the recurring template on a FULLY-FUTURE week boundary. buildSchedule
  // places across the whole template week [weekStart, +7d) and does NOT itself
  // guard against `now`, so any weekStart that isn't strictly ahead of today would
  // land already-past slots that dropPastOps then silently drops — stranding cases
  // whose only window is on a passed day AND overstating the placed-hours metric.
  // The containing week always includes today (its Monday is <= today), so we take
  // the NEXT Monday: the soonest week that is entirely in the future.
  let weekStart = startOfWeek(now, { weekStartsOn: 1 });
  if (weekStart <= startOfDay(now)) weekStart = addWeeks(weekStart, 1);
  return {
    weekStart: isoOf(weekStart),
    monthHorizon: { start: isoOf(period.start), end: isoOf(period.end) },
    bcbaWeeklyBillableTarget: resolveUtilization(data.settings.utilization).bcbaWeeklyBillableHours,
    chaseDirect: true,
  };
}

// Standalone "Build supervision": chase the supervision floors/cadence over the
// existing (and materialized) directs WITHOUT placing new direct sessions.
// chaseDirect:false skips the fill loop; the supervision pass materializes any
// existing recurring directs into dated rows so later weeks are supervisable.
export function supervisionBuilderConfig(data: ScheduleData, now: Date): BuilderConfig {
  return { ...defaultBuilderConfig(data, now), chaseDirect: false, chaseSupervision: true };
}

// Standalone "Build parent training": chase every case to its monthly PT hours
// goal over the existing (and materialized) directs WITHOUT placing new directs or
// supervision. Same materialization path as the supervision standalone.
export function parentTrainingBuilderConfig(data: ScheduleData, now: Date): BuilderConfig {
  return { ...defaultBuilderConfig(data, now), chaseDirect: false, chasePT: true };
}

// Combined "build my month": place the direct backbone AND chase supervision AND
// parent training to their targets in one pass — the default chat workflow.
// Directs are materialized to dated weekly rows so both BCBA passes overlap real
// sessions and the monthly denominators reflect the whole month.
export function combinedBuilderConfig(data: ScheduleData, now: Date): BuilderConfig {
  return { ...defaultBuilderConfig(data, now), chaseDirect: true, chaseSupervision: true, chasePT: true };
}

// Human label for why a case couldn't be fully filled. Shared by the dock panel
// and the chat summary so the wording stays in one place.
export function bindingConstraintLabel(c: ClientBlock['bindingConstraint']): string {
  switch (c) {
    case 'availability': return 'No open availability';
    case 'tech-contention': return 'Assigned techs fully booked';
    case 'auth-cap': return 'At authorization cap';
    case 'bcba-availability': return 'BCBA unavailable to supervise';
    case 'pt-availability': return 'BCBA unavailable for parent training';
    case 'no-authorization': return 'No authorization on file';
    case 'none': return 'Fully placed';
  }
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

// A plain-text readout of a build for the sAssI chat transcript. Contains real
// client names, so it is DISPLAY-ONLY — the caller must keep it out of the token
// history replayed to the API (the deterministic builder, not Claude, produced it).
// `hasStaged` says whether the build actually put sessions in the draft tray, and
// drives the next-step cue in lockstep with BuildResultPanel's three-way messaging.
export function formatBuildSummary(result: BuildResult, hasStaged: boolean): string {
  const { metrics, blocks } = result;
  const blockLines = blocks.map(b => {
    // The BCBA-time blocks report their own shortfall; every other block reports
    // the direct-staffing gap.
    let short = '';
    if (b.bindingConstraint === 'bcba-availability') {
      short = b.supervisionGapRemaining && b.supervisionGapRemaining > 0 ? ` (${round1(b.supervisionGapRemaining)}h supervision short)` : '';
    } else if (b.bindingConstraint === 'pt-availability') {
      short = b.ptGapRemaining && b.ptGapRemaining > 0 ? ` (${round1(b.ptGapRemaining)}h parent training short)` : '';
    } else {
      short = b.directGapRemaining > 0 ? ` (${round1(b.directGapRemaining)}h short)` : '';
    }
    return `• ${b.clientName} — ${bindingConstraintLabel(b.bindingConstraint)}${short}`;
  });
  if (!hasStaged) {
    return blocks.length === 0
      ? 'Nothing to place — every case is already at its direct target.'
      : `No sessions could be placed:\n${blockLines.join('\n')}`;
  }
  let head = `Placed ${round1(metrics.directHrsPlaced)}h of direct across ${metrics.totalCases} case${metrics.totalCases === 1 ? '' : 's'} (${metrics.casesFullyStaffed}/${metrics.totalCases} fully staffed).`;
  if (metrics.supervisionBuilt) {
    head += ` Placed ${round1(metrics.supervisionHrsPlaced)}h of supervision (${metrics.casesMeetingFloor}/${metrics.floorTargetCases} case${metrics.floorTargetCases === 1 ? '' : 's'} at floor).`;
  }
  if (metrics.ptBuilt) {
    head += ` Placed ${round1(metrics.ptHrsPlaced)}h of parent training (${metrics.casesMeetingPtGoal}/${metrics.ptTargetCases} case${metrics.ptTargetCases === 1 ? '' : 's'} at goal).`;
  }
  head += ' Review the proposal in the tray, then Accept.';
  return blockLines.length === 0 ? head : `${head}\nCouldn’t fully fill:\n${blockLines.join('\n')}`;
}
