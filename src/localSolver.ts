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

import { ScheduleData, WishSolution, WishOp } from './types';
import { CompliancePeriod } from './compliance';
import { buildComplianceFillContext, _isBcbaBusyFn, _isBcbaAvailableAtFn } from './fillSchedule';
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
