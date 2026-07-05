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

import { ScheduleData, Client, WishOp, WishSolution } from './types';
import { findAuthFor } from './authorization';
import { DAYS, toMin, minToClock, Interval } from './intervals';
import { Occupancy, LiveWindow, seedOccupancy, feasibleWindowsLive, reserve, dayOfWeekOf } from './builderOccupancy';
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
  bindingConstraint: 'availability' | 'tech-contention' | 'auth-cap' | 'none';
  detail: string;
}

export interface BuildResult {
  solution: WishSolution;               // ops → wishSolutionToDraft
  blocks: ClientBlock[];
  metrics: { directHrsPlaced: number; casesFullyStaffed: number; totalCases: number };
}

// ── date helpers (local, no TZ suffix — matches appointment format) ────────────
const pad = (n: number) => String(n).padStart(2, '0');
const parseLocalDate = (iso: string): Date => new Date(`${iso.slice(0, 10)}T00:00:00`);
const isoOf = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d: Date, n: number): Date => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const hoursBetween = (startIso: string, endIso: string): number =>
  Math.max(0, new Date(endIso).getTime() - new Date(startIso).getTime()) / HR_MS;

interface CasePlan {
  client: Client;
  target: number;         // weekly direct target (auth, clamped by override)
  gap: number;            // target − already-scheduled this template week
  seedWindowMins: number; // total feasible window minutes on the SEED board (MRV)
  authClamped: boolean;   // an override.directTarget below auth was the binding cap
}

export function buildSchedule(data: ScheduleData, config: BuilderConfig, now: Date): BuildResult {
  const weekStart = parseLocalDate(config.weekStart);
  const weekDates = DAYS.map((day, d) => ({ day, date: isoOf(addDays(weekStart, d)) }));
  const occ = seedOccupancy(data, weekStart);

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
    if (target <= 0) continue; // no authorization/target → nothing to build for this case

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
  const blocks: ClientBlock[] = [];
  let directHrsPlaced = 0;

  for (const plan of toFill) {
    const { client } = plan;
    const maxSessionHrs = config.clientOverrides?.[client.id]?.maxSessionHrs ?? MAX_DIRECT_SESSION_HRS;
    let gap = plan.gap;
    const daysUsed = new Set<string>();

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
            op: 'add', type: 'client-session', title: 'Session',
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

  // ── Cross-week self-check (the recurring-badge gap mitigation) ───────────────
  // Live occupancy prevents template-week double-books; this catches a recurring
  // slot colliding with an EXISTING dated session in a later horizon week, which
  // solveDraft (single-week-scoped) would miss. Flag, don't silently ship.
  const selfCheckBlocks = monthSelfCheck(data, ops, config, weekStart);
  blocks.push(...selfCheckBlocks);

  const totalCases = plans.length;
  const casesFullyStaffed = totalCases - blocks.filter(b => b.directGapRemaining >= MIN_SESSION_HRS).length;

  const summary = ops.length === 0
    ? (blocks.length ? `No direct sessions could be placed — ${blocks.length} case(s) blocked` : 'Nothing to build — all cases already at target')
    : `Built ${directHrsPlaced.toFixed(1)}h of direct backbone across ${casesFullyStaffed}/${totalCases} case(s)`;
  const reasoning = blocks.length
    ? `Placed ${directHrsPlaced.toFixed(1)}h. Could not fully staff: ${blocks.map(b => `${b.clientName} (${b.detail})`).join('; ')}.`
    : `Placed ${directHrsPlaced.toFixed(1)}h of recurring weekly direct sessions across ${casesFullyStaffed} case(s), most-constrained first, with no double-booking.`;

  return {
    solution: { id: uuidv4(), summary, reasoning, ops },
    blocks,
    metrics: { directHrsPlaced: +directHrsPlaced.toFixed(2), casesFullyStaffed, totalCases },
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
        });
        break; // one flag per op is enough
      }
    }
  }
  return out;
}
