// Local greedy compliance solver — runs entirely on-device, no Claude call.
//
// Fitness function (per user spec):
//   1. Maximize cases reaching the ideal supervision range (default 15-20%)
//   2. Maximize techs hitting BACB 5% + company target
//   3. BCBA weekly billable ≈ goal; 15-20% overage is acceptable as a
//      cancellation buffer — solutions should NOT be blocked by the billable cap
//   4. Preferred order: most out of compliance first
//
// The result can be used directly as a "Quick Fix" (no API needed), or passed
// as context to Claude so it validates and proposes 3 distinct variants instead
// of having to derive all placement logic from scratch.

import { ScheduleData, WishSolution, WishOp, Appointment } from './types';
import { CompliancePeriod } from './compliance';
import { buildComplianceFillContext, feasibleDirectWindows, _isBcbaBusyFn, _isBcbaAvailableAtFn } from './fillSchedule';
import { findAuthFor } from './authorization';
import { holidaysInRange, holidayAdjustTarget } from './holidayAdjust';
import { startOfWeek } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';

// Convert a millisecond timestamp to a local ISO datetime string (no Z suffix)
// so it matches the existing appointment format ("2026-06-19T09:00:00").
function toLocalIso(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
}

// Result from solveComplianceFill — same shape as WishSolution so it can be
// shown in the UI, accepted, or passed to Claude for refinement.
export interface LocalSolveResult {
  solution: WishSolution;
  casesHelped: number;
  totalCases: number;
  supHoursAdded: number;
  unblockedClients: string[];
  blockedClients: Array<{ name: string; reason: string }>;
}

// Greedy compliance fill: add supervision (and optionally PT) sessions to close
// each case's supervision gap, most out-of-compliance first. The result is a
// single optimal solution — Claude can then produce 3 variants with different
// priorities / session distributions.
export function solveComplianceFill(
  data: ScheduleData,
  period: CompliancePeriod,
  now: Date,
): LocalSolveResult {
  const ctx = buildComplianceFillContext(data, period, now);

  if (ctx.cases.length === 0) {
    return {
      solution: {
        id: uuidv4(),
        summary: 'All cases at or above ideal supervision range',
        reasoning: `All cases are already at or above the ideal supervision range (${ctx.idealMinPct}%–${ctx.idealMaxPct}%) for ${ctx.periodLabel}. Nothing to fill.`,
        ops: [],
      },
      casesHelped: 0,
      totalCases: 0,
      supHoursAdded: 0,
      unblockedClients: [],
      blockedClients: [],
    };
  }

  const isBusy = _isBcbaBusyFn(data);
  const isAvail = _isBcbaAvailableAtFn(data);

  // Mutable busy list — grows as we add ops to prevent double-booking within
  // the same solution.
  const busy: Array<{ s: number; e: number }> = data.appointments
    .filter(a => a.status !== 'canceled' && !a.isGhost &&
      ['supervision', 'parent-training', 'case-planning', 'reassessment'].includes(a.type))
    .map(a => ({ s: new Date(a.startTime).getTime(), e: new Date(a.endTime).getTime() }));

  const isSlotFree = (startMs: number, endMs: number) =>
    !busy.some(b => b.s < endMs && b.e > startMs);

  const ops: WishOp[] = [];
  const helpedIds = new Set<string>();
  const blockedClients: Array<{ name: string; reason: string }> = [];

  for (const c of ctx.cases) {
    let remainingMs = c.gapToIdealHrs * 3_600_000;
    if (remainingMs < 60_000) continue; // < 1 min, skip

    const caseWindows = ctx.directWindows.filter(
      w => w.clientId === c.clientId || w.clientName === c.clientName
    );

    if (caseWindows.length === 0) {
      blockedClients.push({ name: c.clientName, reason: 'no future direct sessions in scope' });
      continue;
    }

    let placed = false;
    for (const w of caseWindows) {
      if (remainingMs < 60_000) break;
      const winStart = new Date(w.start).getTime();
      const winEnd = new Date(w.end).getTime();

      if (!isAvail(w.start, w.end)) continue;
      if (!isSlotFree(winStart, winEnd)) continue;

      // Place supervision overlapping the full window (or remaining gap, whichever
      // is smaller). Using the full window is better for compliance credit.
      const supEndMs = Math.min(winEnd, winStart + remainingMs);
      const startIso = toLocalIso(winStart);
      const endIso = toLocalIso(supEndMs);

      const op: Extract<WishOp, { op: 'add' }> = {
        op: 'add',
        type: 'supervision',
        title: 'Supervision',
        client: c.clientId,
        technician: w.techId,  // BT name required for compliance credit
        start: startIso,
        end: endIso,
        recurring: false,
        pattern: undefined as any,
      };
      ops.push(op);
      busy.push({ s: winStart, e: supEndMs });
      remainingMs -= (supEndMs - winStart);
      placed = true;
      helpedIds.add(c.clientId);
    }

    if (!placed) {
      // All windows were blocked — diagnose
      const availCount = caseWindows.filter(w => isAvail(w.start, w.end)).length;
      if (availCount === 0) {
        blockedClients.push({ name: c.clientName, reason: `${caseWindows.length} direct session(s) but none overlap BCBA availability` });
      } else {
        blockedClients.push({ name: c.clientName, reason: `${availCount} slot(s) within BCBA availability, all blocked by existing BCBA appointments` });
      }
    }
  }

  const supHoursAdded = ops.reduce((sum, o) => {
    if (o.op !== 'add') return sum;
    return sum + (new Date(o.end).getTime() - new Date(o.start).getTime()) / 3_600_000;
  }, 0);

  const casesHelped = helpedIds.size;
  const unblockedClients = ctx.cases.filter(c => helpedIds.has(c.clientId)).map(c => c.clientName);

  let reasoning: string;
  if (ops.length === 0) {
    reasoning = `Could not place any supervision sessions. Blockers: ${blockedClients.map(b => `${b.name} — ${b.reason}`).join('; ')}.`;
  } else {
    const blockerNote = blockedClients.length
      ? ` Could not help: ${blockedClients.map(b => `${b.name} (${b.reason})`).join('; ')}.`
      : '';
    reasoning = `Added ${supHoursAdded.toFixed(1)}h supervision across ${casesHelped} case(s). Prioritized by compliance gap (largest first).${blockerNote}`;
  }

  return {
    solution: {
      id: uuidv4(),
      summary: ops.length === 0
        ? 'No slots available — see blockers'
        : `Local solve: +${supHoursAdded.toFixed(1)}h supervision, ${casesHelped}/${ctx.cases.length} cases`,
      reasoning,
      ops,
    },
    casesHelped,
    totalCases: ctx.cases.length,
    supHoursAdded,
    unblockedClients,
    blockedClients,
  };
}

// ── "Fix pace with SAssi" — case-scoped meet-pace solve (Phase 2) ────────────
// Deterministic seed for one case's rearrange. Objective (confirmed): hit the
// case's holiday-adjusted authorized DIRECT hours + target supervision % for the
// current week, spreading sessions across distinct days (distribution), and trim
// over-served supervision when the case is above the insurer cap. Emits WishOps
// the existing draft/grade/preview/commit pipeline already understands; moving /
// redistributing existing movable sessions is delegated to solveDraft's hill-climb
// at grade time, so this solver only ADDs and TRIMs to hit the numbers.
//
// Horizon is the current Monday-based week (aligning the placement window with
// feasibleDirectWindows). Direct/supervision targets mirror computeHomeTrends so
// the solver aims at exactly what the Home card shows.

const MAX_DIRECT_SESSION_HRS = 4;   // realistic direct block; also forces day-spread
const MIN_SESSION_HRS = 0.5;        // ignore remainders smaller than 30 min
const HR_MS = 3_600_000;

export interface MeetPaceResult {
  solution: WishSolution;
  intent: 'behind' | 'over' | 'ok';
  directHrsAdded: number;
  supHrsAdded: number;
  hrsTrimmed: number;
  daysTouched: number;        // distinct days the added direct sessions land on
  directGapRemaining: number;
  supGapRemaining: number;
  blocked: string[];
}

const ymd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function solveMeetPace(data: ScheduleData, clientRef: string, now: Date): MeetPaceResult {
  const client = data.clients.find(c => c.id === clientRef || c.name === clientRef);
  const blocked: string[] = [];
  const ops: WishOp[] = [];

  const finish = (
    intent: MeetPaceResult['intent'],
    m: Partial<MeetPaceResult>,
    summary: string,
    reasoning: string,
  ): MeetPaceResult => ({
    solution: { id: uuidv4(), summary, reasoning, ops },
    intent,
    directHrsAdded: 0, supHrsAdded: 0, hrsTrimmed: 0, daysTouched: 0,
    directGapRemaining: 0, supGapRemaining: 0, blocked,
    ...m,
  });

  if (!client) return finish('ok', {}, 'Unknown case', 'No matching client.');
  const cid = client.id;
  const cname = client.name;
  const matchesClient = (ref?: string) => ref === cid || ref === cname;

  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const nowMs = now.getTime();
  const weekStartMs = weekStart.getTime();
  const weekEndMs = weekEnd.getTime();
  const inWeek = (iso: string): boolean => {
    const t = new Date(iso).getTime();
    return t >= weekStartMs && t < weekEndMs;
  };
  const isLive = (a: Appointment) => a.status !== 'canceled' && !a.isGhost;
  const hrs = (a: Appointment) =>
    Math.max(0, new Date(a.endTime).getTime() - new Date(a.startTime).getTime()) / HR_MS;

  // ── Direct-hours target (holiday-adjusted authorized weekly direct) ──────────
  const authRec = findAuthFor(data, cid, ymd(weekStart)) || findAuthFor(data, cname, ymd(weekStart));
  const authWk = authRec?.weekly?.direct && authRec.weekly.direct > 0 ? authRec.weekly.direct : 0;
  const weekHolidays = holidaysInRange(data.companyHolidays, weekStart, weekEnd);
  const directTarget = holidayAdjustTarget({
    kind: 'hours', base: authWk, holidays: weekHolidays,
    enabled: data.settings.holidayAffectsBillable ?? false,
    perDayHours: data.settings.holidayBillableHoursPerDay ?? 8,
    expectedWorkdays: 5,
  });
  const scheduledDirect = data.appointments
    .filter(a => a.type === 'client-session' && isLive(a) && matchesClient(a.client) && inWeek(a.startTime))
    .reduce((s, a) => s + hrs(a), 0);
  const directGap0 = directTarget > 0 ? Math.max(0, directTarget - scheduledDirect) : 0;

  // ── Place direct sessions into feasible windows, distributed day-round-robin ─
  const daysSet = new Set<string>();
  let directGap = directGap0;
  if (directGap0 >= MIN_SESSION_HRS) {
    type Slot = { date: string; endMs: number; cursor: number; tech: string | undefined };
    const slots: Slot[] = feasibleDirectWindows(data, weekStart)
      .filter(w => w.clientId === cid || w.clientName === cname)
      .map(w => {
        const s = new Date(`${w.date}T${w.start}:00`).getTime();
        const e = new Date(`${w.date}T${w.end}:00`).getTime();
        return { date: w.date, endMs: e, cursor: Math.max(s, nowMs), tech: w.techs[0]?.name };
      })
      .filter(s => (s.endMs - s.cursor) / HR_MS >= MIN_SESSION_HRS);

    if (slots.length === 0) {
      blocked.push(`${cname}: no open direct windows this week`);
    } else {
      const byDate = new Map<string, Slot[]>();
      for (const s of slots) {
        const arr = byDate.get(s.date) ?? [];
        arr.push(s);
        byDate.set(s.date, arr);
      }
      const dates = [...byDate.keys()].sort();
      let progress = true;
      while (directGap >= MIN_SESSION_HRS && progress) {
        progress = false;
        for (const date of dates) {
          if (directGap < MIN_SESSION_HRS) break;
          const slot = byDate.get(date)!.find(s => (s.endMs - s.cursor) / HR_MS >= MIN_SESSION_HRS);
          if (!slot) continue;
          const capHrs = (slot.endMs - slot.cursor) / HR_MS;
          const sessHrs = Math.min(capHrs, directGap, MAX_DIRECT_SESSION_HRS);
          if (sessHrs < MIN_SESSION_HRS) continue;
          const sMs = slot.cursor;
          const eMs = sMs + sessHrs * HR_MS;
          ops.push({
            op: 'add', type: 'client-session', title: 'Session',
            client: cname, technician: slot.tech,
            start: toLocalIso(sMs), end: toLocalIso(eMs),
          });
          slot.cursor = eMs;
          directGap -= sessHrs;
          daysSet.add(date);
          progress = true;
        }
      }
      if (directGap >= MIN_SESSION_HRS) {
        blocked.push(`${cname}: ${directGap.toFixed(1)}h of the direct gap didn't fit the open windows`);
      }
    }
  }
  const directHrsAdded = +(directGap0 - directGap).toFixed(2);

  // ── Supervision target (% of post-fill direct, mirroring the Home card) ──────
  const targetPct = client.supervisionIdealPct ?? data.settings.supervisionDirectHoursPercent ?? 15;
  const directAfter = scheduledDirect + directHrsAdded;
  const supTarget = (directAfter * targetPct) / 100;
  const supCurrent = data.appointments
    .filter(a => a.type === 'supervision' && isLive(a) && matchesClient(a.client) && inWeek(a.startTime))
    .reduce((s, a) => s + hrs(a), 0);
  const supGap0 = Math.max(0, supTarget - supCurrent);

  // ── Place supervision overlapping direct sessions (existing + newly added) ───
  const isBcbaAvail = _isBcbaAvailableAtFn(data);
  const bcbaBusy = data.appointments
    .filter(a => isLive(a) && ['supervision', 'parent-training', 'case-planning', 'reassessment'].includes(a.type))
    .map(a => ({ s: new Date(a.startTime).getTime(), e: new Date(a.endTime).getTime() }));
  const bcbaFree = (s: number, e: number) => !bcbaBusy.some(b => b.s < e && b.e > s);

  let supGap = supGap0;
  if (supTarget > 0 && supGap0 >= MIN_SESSION_HRS) {
    const existing = data.appointments
      .filter(a => a.type === 'client-session' && isLive(a) && matchesClient(a.client)
        && inWeek(a.startTime) && new Date(a.startTime).getTime() >= nowMs)
      .map(a => ({ startMs: new Date(a.startTime).getTime(), endMs: new Date(a.endTime).getTime(), tech: a.technician, date: a.startTime.slice(0, 10) }));
    const added = ops
      .filter((o): o is Extract<WishOp, { op: 'add' }> => o.op === 'add' && o.type === 'client-session')
      .map(o => ({ startMs: new Date(o.start).getTime(), endMs: new Date(o.end).getTime(), tech: o.technician, date: o.start.slice(0, 10) }));
    const candidates = [...existing, ...added].sort((a, b) => a.startMs - b.startMs);

    const byDay = new Map<string, typeof candidates>();
    for (const c of candidates) {
      const arr = byDay.get(c.date) ?? [];
      arr.push(c);
      byDay.set(c.date, arr);
    }
    const days = [...byDay.keys()].sort();
    const used = new Set<number>();
    let progress = true;
    while (supGap >= MIN_SESSION_HRS && progress) {
      progress = false;
      for (const day of days) {
        if (supGap < MIN_SESSION_HRS) break;
        const cand = byDay.get(day)!.find(c => {
          if (used.has(c.startMs)) return false;
          const eMs = Math.min(c.endMs, c.startMs + supGap * HR_MS);
          return isBcbaAvail(toLocalIso(c.startMs), toLocalIso(eMs)) && bcbaFree(c.startMs, eMs);
        });
        if (!cand) continue;
        const supHrs = Math.min((cand.endMs - cand.startMs) / HR_MS, supGap);
        if (supHrs < MIN_SESSION_HRS) continue;
        const sMs = cand.startMs;
        const eMs = sMs + supHrs * HR_MS;
        ops.push({
          op: 'add', type: 'supervision', title: 'Supervision',
          client: cname, technician: cand.tech,
          start: toLocalIso(sMs), end: toLocalIso(eMs),
        });
        bcbaBusy.push({ s: sMs, e: eMs });
        used.add(cand.startMs);
        supGap -= supHrs;
        progress = true;
      }
    }
    if (supGap >= MIN_SESSION_HRS) {
      blocked.push(`${cname}: ${supGap.toFixed(1)}h of supervision couldn't be placed (BCBA availability / overlap)`);
    }
  }
  const supHrsAdded = +(supGap0 - supGap).toFixed(2);

  // ── Over-served: trim supervision above the insurer cap (shaveDown) ──────────
  let hrsTrimmed = 0;
  const behind = directHrsAdded > 0 || supHrsAdded > 0;
  const capPct = data.settings.supervisionMaxHoursPercent;
  if (!behind && capPct && directAfter > 0) {
    const capHrs = (directAfter * capPct) / 100;
    let excess = supCurrent - capHrs;
    if (excess >= MIN_SESSION_HRS) {
      const trimmable = data.appointments
        .filter(a => a.type === 'supervision' && isLive(a) && matchesClient(a.client)
          && inWeek(a.startTime) && !a.isFixed && new Date(a.startTime).getTime() >= nowMs)
        .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()); // newest first
      for (const a of trimmable) {
        if (excess < MIN_SESSION_HRS) break;
        const dur = hrs(a);
        if (dur <= excess + 0.01) {
          ops.push({ op: 'remove', appointmentId: a.id });
          excess -= dur;
          hrsTrimmed += dur;
        } else {
          const sMs = new Date(a.startTime).getTime();
          const eMs = sMs + (dur - excess) * HR_MS;
          ops.push({ op: 'move', appointmentId: a.id, start: toLocalIso(sMs), end: toLocalIso(eMs) });
          hrsTrimmed += excess;
          excess = 0;
        }
      }
    }
  }

  const intent: MeetPaceResult['intent'] = behind ? 'behind' : hrsTrimmed > 0 ? 'over' : 'ok';
  const metrics = {
    directHrsAdded, supHrsAdded, hrsTrimmed,
    daysTouched: daysSet.size,
    directGapRemaining: +Math.max(0, directGap).toFixed(2),
    supGapRemaining: +Math.max(0, supGap).toFixed(2),
  };

  let summary: string;
  let reasoning: string;
  if (intent === 'behind') {
    const parts: string[] = [];
    if (directHrsAdded > 0) parts.push(`+${directHrsAdded.toFixed(1)}h direct across ${daysSet.size} day(s)`);
    if (supHrsAdded > 0) parts.push(`+${supHrsAdded.toFixed(1)}h supervision`);
    summary = `Meet ${cname}'s pace: ${parts.join(', ')}`;
    reasoning = `Toward ${cname}'s week ideal (${directTarget.toFixed(1)}h direct, ${targetPct}% supervision).` +
      (blocked.length ? ` Couldn't fully close: ${blocked.join('; ')}.` : '');
  } else if (intent === 'over') {
    summary = `Trim ${cname}'s over-served supervision: −${hrsTrimmed.toFixed(1)}h`;
    reasoning = `${cname} is above the ${capPct}% supervision cap; trimmed ${hrsTrimmed.toFixed(1)}h to free capacity.`;
  } else {
    summary = blocked.length ? `Can't move ${cname}'s pace — see blockers` : `${cname} is already at pace`;
    reasoning = blocked.length
      ? blocked.join('; ')
      : `${cname} is within its direct-hours and supervision-% targets for the week.`;
  }

  return finish(intent, metrics, summary, reasoning);
}
