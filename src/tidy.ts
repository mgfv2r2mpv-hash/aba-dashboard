// Tidy / Doctor a schedule — deterministic, equivalence-gated cleanup.
//
// After rounds of dev-and-rebuild a schedule collects noise: one session split
// into contiguous fragments, duplicate rows from repeated builder runs, zero-length
// ghosts, clusters of one-offs that are really a weekly series. `analyzeTidy` finds
// that noise and emits WishOps to fix it — mirroring src/scheduleBuilder.ts so the
// result rides the existing stageSassiOps → wishSolutionToDraft → DraftTray pipeline.
//
// TWO NON-NEGOTIABLES (see docs/schedule-tidy-stub.md):
//   1. Semantic equivalence. Every op-group is run through the equivalence oracle
//      (src/tidyEquivalence.ts). Only oracle-EQUIVALENT ops are auto-applied; an op
//      that changes any tracked metric is demoted to a review suggestion with the
//      delta shown. A rule marked review-only (grouping, snap, double-book flags) is
//      never auto-applied even when equivalent — it's a human judgment call.
//   2. Pending only. Tidy touches only pending (scheduled / undefined-status), non-
//      ghost, non-make-up, FUTURE (start >= now) rows. Completed / canceled / make-up
//      rows are records of fact — read for context, never edited. (This also makes
//      the records-of-fact equivalence invariant hold by construction.)
//
// Tidy never introduces a new BCBA travel leg (merges keep the existing footprint;
// removes drop rows; regroup/snap don't relocate to a new site), so the equivalence
// oracle — not the travel guard — is the authority; app.tsx stages tidy ops without
// dropInfeasibleTravelOps to avoid a partial drop that could orphan a merge's removes.

import { ScheduleData, Appointment, WishOp, WishSolution, SUPERVISION_COUNTING_TYPES } from './types';
import { applyWishSolution } from './wish';
import { checkEquivalence, summarizeDiffs, EquivReport } from './tidyEquivalence';
import { v4 as uuidv4 } from 'uuid';

const MS_PER_MIN = 60_000;
const MS_PER_DAY = 86_400_000;
const MIN_SERIES_LEN = 3;         // ≥ this many occurrences before suggesting a series
const SNAP_GRID_MIN = 15;         // snap timestamps to :00 / :15 / :30 / :45
const SNAP_MAX_SHIFT_MIN = 5;     // …but only when the row is within this of the grid
const NEAR_ADJACENT_GAP_MIN = 15; // a real gap ≤ this flags a "could merge" review

export type TidyRuleId = 'merge' | 'degenerate' | 'dedup' | 'grouping' | 'snap' | 'doubleBook';

export interface TidySuggestion {
  ruleId: TidyRuleId;
  ops: WishOp[];            // empty = a flag (nothing to apply)
  rationale: string;
  metricDelta?: string;    // set when applying the ops would change a tracked metric
}

export interface TidyResult {
  auto: WishSolution;      // oracle-verified equivalent ops, staged by default
  suggestions: TidySuggestion[];
  equivalence: EquivReport; // for the assembled auto set
  metrics: { scanned: number; autoOpCount: number; suggestionCount: number };
}

export interface TidyConfig { rules: Record<TidyRuleId, boolean>; }

export function defaultTidyConfig(): TidyConfig {
  return { rules: { merge: true, degenerate: true, dedup: true, grouping: true, snap: true, doubleBook: true } };
}

// ── helpers ─────────────────────────────────────────────────────────────────
const ms = (iso: string): number => new Date(iso).getTime();
const clock = (iso: string): string => iso.slice(11, 16);
const dayKey = (iso: string): string => iso.slice(0, 10);
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const weekdayOf = (iso: string): string => WEEKDAYS[new Date(iso).getDay()] ?? '';
const billable = (a: Appointment): boolean => a.isBillable !== false;

function isPendingFuture(a: Appointment, nowMs: number): boolean {
  if (a.isGhost || a.isMakeUp) return false;
  if (a.status === 'completed' || a.status === 'canceled') return false;
  const s = ms(a.startTime);
  return !Number.isNaN(s) && s >= nowMs;
}

function groupBy<T>(arr: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const t of arr) { const k = key(t); const a = m.get(k); if (a) a.push(t); else m.set(k, [t]); }
  return m;
}

interface Names { client: (ref?: string) => string; tech: (ref?: string) => string; }
function nameLookup(data: ScheduleData): Names {
  const c = new Map<string, string>();
  for (const x of data.clients) c.set(x.id, x.name);
  const t = new Map<string, string>();
  for (const x of data.technicians) t.set(x.id, x.name);
  return {
    client: r => (r ? (c.get(r) ?? r) : '—'),
    tech: r => (r ? (t.get(r) ?? r) : '—'),
  };
}

interface Candidate {
  ruleId: TidyRuleId;
  ops: WishOp[];
  rationale: string;
  preferReview: boolean;   // grouping / snap / flags — always review, even if equivalent
  metricHint?: string;     // preferred delta text when the oracle finds it non-equivalent
}
const flag = (ruleId: TidyRuleId, rationale: string): Candidate => ({ ruleId, ops: [], rationale, preferReview: true });

// Identity for a behavior-neutral merge: same client, tech, type, billable-ness,
// fixed-ness. seriesId is deliberately NOT part of identity so a series-less orphan
// can fold into an adjacent series occurrence (the survivor keeps the series tag).
// The run builder below still refuses to combine two DIFFERENT non-empty seriesIds,
// so a merge never silently crosses two distinct series. Real schedules are mostly
// recurring dated occurrences, so merge must NOT skip recurring rows — merging two
// contiguous occurrences ON A DATE is a safe local edit that the oracle verifies.
const identityKey = (a: Appointment): string => [a.type, a.client ?? '', a.technician ?? '', billable(a), a.isFixed].join('|');

const overlaps = (a: Appointment, b: Appointment): boolean => ms(a.startTime) < ms(b.endTime) && ms(b.startTime) < ms(a.endTime);
// The BCBA-run session types (supervision / parent-training / case-planning /
// reassessment). These INTENTIONALLY overlap a BT's direct — concurrent care, not a
// double-book — so the conflict scan never crosses a direct with one of these.
const BCBA_SESSION_TYPES = new Set<Appointment['type']>(SUPERVISION_COUNTING_TYPES);

// ── rule 1: merge exactly-contiguous fragments (auto) ───────────────────────
function ruleMerge(elig: Appointment[], names: Names): Candidate[] {
  const out: Candidate[] = [];
  const groups = groupBy(elig, identityKey);
  for (const rows of groups.values()) {
    // Merge only rows that don't overlap or duplicate ANOTHER row in the group —
    // those are ambiguous (double-books / dups) and belong to dedup/doubleBook, not
    // merge. Excluding just the ambiguous rows (not the whole group) lets a clean
    // contiguous run still merge even when unrelated noise sits in the same case.
    const clean = rows.filter(a => ms(a.endTime) > ms(a.startTime) && !rows.some(b => b !== a && overlaps(a, b)));
    const sorted = [...clean].sort((x, y) => ms(x.startTime) - ms(y.startTime));
    let i = 0;
    while (i < sorted.length) {
      let j = i;
      // Extend the run while each next row exactly abuts AND stays series-compatible:
      // the run may hold at most ONE distinct non-empty seriesId, so an orphan folds
      // into a series (or a run of orphans merges), but two different series never do.
      const runSeries = new Set<string>();
      if (sorted[i].seriesId) runSeries.add(sorted[i].seriesId!);
      while (j + 1 < sorted.length && ms(sorted[j].endTime) === ms(sorted[j + 1].startTime)) {
        const next = sorted[j + 1].seriesId;
        if (next && runSeries.size >= 1 && !runSeries.has(next)) break; // would be a 2nd distinct series
        if (next) runSeries.add(next);
        j++;
      }
      if (j > i) {
        const run = sorted.slice(i, j + 1);
        // Survivor keeps series membership: prefer a row carrying the seriesId so the
        // merged occurrence stays in its series (and recurring); else the earliest row.
        const survivor = run.find(r => r.seriesId) ?? run[0];
        const start = run[0].startTime, end = run[run.length - 1].endTime;
        out.push({
          ruleId: 'merge', preferReview: false,
          ops: [
            { op: 'move', appointmentId: survivor.id, start, end },
            ...run.filter(r => r !== survivor).map((r): WishOp => ({ op: 'remove', appointmentId: r.id })),
          ],
          rationale: `Merge ${run.length} contiguous ${survivor.type} fragments (${names.client(survivor.client)} / ${names.tech(survivor.technician)}) into one ${clock(start)}–${clock(end)} session.`,
        });
      }
      i = j + 1;
    }
  }
  return out;
}

// ── rule 2: drop zero/negative-length rows (auto) ───────────────────────────
function ruleDegenerate(elig: Appointment[], names: Names): Candidate[] {
  return elig
    .filter(a => ms(a.endTime) <= ms(a.startTime))
    .map((a): Candidate => ({
      ruleId: 'degenerate', preferReview: false,
      ops: [{ op: 'remove', appointmentId: a.id }],
      rationale: `Remove zero-length ${a.type} row (${names.client(a.client)} / ${names.tech(a.technician)}) at ${clock(a.startTime)} on ${dayKey(a.startTime)}.`,
    }));
}

// ── rule 3: de-duplicate identical rows (review — changes double-counted hours) ─
function ruleDedup(elig: Appointment[], names: Names): Candidate[] {
  const groups = groupBy(elig, a => [a.type, a.client ?? '', a.technician ?? '', a.startTime, a.endTime].join('|'));
  const out: Candidate[] = [];
  for (const rows of groups.values()) {
    if (rows.length < 2) continue;
    const extras = rows.slice(1);
    const durH = (ms(rows[0].endTime) - ms(rows[0].startTime)) / 3_600_000;
    out.push({
      ruleId: 'dedup', preferReview: false,
      ops: extras.map((r): WishOp => ({ op: 'remove', appointmentId: r.id })),
      rationale: `${rows.length} identical ${rows[0].type} rows (${names.client(rows[0].client)} / ${names.tech(rows[0].technician)}) at ${clock(rows[0].startTime)}–${clock(rows[0].endTime)} on ${dayKey(rows[0].startTime)} — likely repeated builder runs.`,
      metricHint: durH > 0 ? `removes ${extras.length} duplicate${extras.length > 1 ? 's' : ''} (−${(durH * extras.length).toFixed(1)}h double-counted)` : undefined,
    });
  }
  return out;
}

// ── rule 4: consolidate a recurring pattern (review — a judgment call) ───────
function cadenceRuns(sorted: Appointment[]): { rows: Appointment[]; pattern: 'weekly' | 'biweekly' }[] {
  const dayMs = (iso: string): number => { const d = new Date(iso); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
  const out: { rows: Appointment[]; pattern: 'weekly' | 'biweekly' }[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i, step: number | null = null;
    while (j + 1 < sorted.length) {
      const diff = Math.round((dayMs(sorted[j + 1].startTime) - dayMs(sorted[j].startTime)) / MS_PER_DAY);
      if (diff !== 7 && diff !== 14) break;
      if (step === null) step = diff; else if (diff !== step) break;
      j++;
    }
    if (step !== null && j > i) { out.push({ rows: sorted.slice(i, j + 1), pattern: step === 7 ? 'weekly' : 'biweekly' }); i = j + 1; }
    else i += 1;
  }
  return out;
}

function ruleGrouping(elig: Appointment[], names: Names): Candidate[] {
  const groups = groupBy(
    elig.filter(a => !a.isRecurring && !a.seriesId),
    a => [a.type, a.client ?? '', a.technician ?? '', billable(a), weekdayOf(a.startTime), clock(a.startTime), clock(a.endTime)].join('|'),
  );
  const out: Candidate[] = [];
  for (const rows of groups.values()) {
    if (rows.length < MIN_SERIES_LEN) continue;
    const sorted = [...rows].sort((x, y) => ms(x.startTime) - ms(y.startTime));
    for (const run of cadenceRuns(sorted)) {
      if (run.rows.length < MIN_SERIES_LEN) continue;
      const first = run.rows[0];
      out.push({
        ruleId: 'grouping', preferReview: true,
        ops: [{ op: 'regroup', appointmentIds: run.rows.map(r => r.id), seriesId: uuidv4(), recurringPattern: run.pattern }],
        rationale: `${run.rows.length} ${first.type} sessions every ${weekdayOf(first.startTime)} ${clock(first.startTime)}–${clock(first.endTime)} (${names.client(first.client)} / ${names.tech(first.technician)}) look like a ${run.pattern} series — group for batch (This / Following / All) edits.`,
      });
    }
  }
  return out;
}

// ── rule 5: snap odd timestamps (review — shifts coverage by minutes) ────────
function snapIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const min = d.getHours() * 60 + d.getMinutes();
  const grid = Math.round(min / SNAP_GRID_MIN) * SNAP_GRID_MIN;
  if (grid === min || grid >= 1440 || Math.abs(grid - min) > SNAP_MAX_SHIFT_MIN) return iso;
  return `${iso.slice(0, 11)}${String(Math.floor(grid / 60)).padStart(2, '0')}:${String(grid % 60).padStart(2, '0')}:00`;
}

function ruleSnap(elig: Appointment[], names: Names): Candidate[] {
  const out: Candidate[] = [];
  for (const a of elig) {
    if (a.isRecurring || a.seriesId) continue; // don't desync a series
    const s = snapIso(a.startTime), e = snapIso(a.endTime);
    if ((s === a.startTime && e === a.endTime) || ms(e) <= ms(s)) continue;
    const shift = Math.round((Math.abs(ms(s) - ms(a.startTime)) + Math.abs(ms(e) - ms(a.endTime))) / MS_PER_MIN);
    out.push({
      ruleId: 'snap', preferReview: true,
      ops: [{ op: 'move', appointmentId: a.id, start: s, end: e }],
      rationale: `Snap ${a.type} (${names.client(a.client)} / ${names.tech(a.technician)}) ${clock(a.startTime)}–${clock(a.endTime)} → ${clock(s)}–${clock(e)} on ${dayKey(a.startTime)}.`,
      metricHint: `shifts ${shift} min`,
    });
  }
  return out;
}

// ── rule 6: flag double-books & near-adjacent gaps (review — never auto) ─────
function ruleDoubleBook(elig: Appointment[], names: Names): Candidate[] {
  const out: Candidate[] = [];

  // CRITICAL service-model rule: an overlap is a genuine double-book ONLY between
  // two sessions that both require the SAME party's exclusive presence. A BCBA
  // session (supervision / parent-training / case-planning / reassessment) is
  // DESIGNED to overlap a BT's direct — that IS the model (the BCBA observing the BT
  // deliver service = concurrent care, and the credit engine depends on that
  // overlap). It is NEVER a conflict. So we partition by exclusive party and never
  // cross a direct with a BCBA session:
  //   • a BT can't deliver two DIRECTS at once      (directs sharing a technician)
  //   • a client can't sit in two DIRECTS at once    (directs sharing a client)
  //   • the single supervising analyst can't run two BCBA sessions at once
  const directs = elig.filter(a => a.type === 'client-session');
  const bcba = elig.filter(a => BCBA_SESSION_TYPES.has(a.type));
  const seen = new Set<string>();
  const scan = (rows: Appointment[], reason: (a: Appointment) => string) => {
    const s = [...rows].sort((x, y) => ms(x.startTime) - ms(y.startTime));
    for (let i = 0; i < s.length - 1; i++) {
      for (let j = i + 1; j < s.length && ms(s[j].startTime) < ms(s[i].endTime); j++) {
        if (!overlaps(s[i], s[j])) continue;
        const key = [s[i].id, s[j].id].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(flag('doubleBook', `${reason(s[i])}: ${clock(s[i].startTime)}–${clock(s[i].endTime)} overlaps ${clock(s[j].startTime)}–${clock(s[j].endTime)} on ${dayKey(s[i].startTime)}.`));
      }
    }
  };
  for (const rows of groupBy(directs.filter(a => a.technician), a => a.technician!).values())
    scan(rows, a => `Double-book — ${names.tech(a.technician)} has two overlapping direct sessions`);
  for (const rows of groupBy(directs.filter(a => a.client), a => a.client!).values())
    scan(rows, a => `Double-book — ${names.client(a.client)} has two overlapping direct sessions`);
  scan(bcba, () => `Double-book — two overlapping supervising-analyst sessions`);

  // Near-adjacent same-identity rows separated by a small real gap.
  for (const rows of groupBy(elig.filter(a => !a.isRecurring && !a.seriesId), identityKey).values()) {
    const s = [...rows].sort((x, y) => ms(x.startTime) - ms(y.startTime));
    for (let i = 0; i + 1 < s.length; i++) {
      const gap = (ms(s[i + 1].startTime) - ms(s[i].endTime)) / MS_PER_MIN;
      if (gap > 0 && gap <= NEAR_ADJACENT_GAP_MIN) {
        out.push(flag('doubleBook', `Near-adjacent ${s[i].type} (${names.client(s[i].client)} / ${names.tech(s[i].technician)}): ${clock(s[i].startTime)}–${clock(s[i].endTime)} then ${clock(s[i + 1].startTime)}–${clock(s[i + 1].endTime)} on ${dayKey(s[i].startTime)} — a ${gap}-min gap, merge only if it's really one session.`));
      }
    }
  }
  return out;
}

const wrap = (ops: WishOp[]): WishSolution => ({ id: 'tidy-probe', summary: '', reasoning: '', ops });

/**
 * Analyze a schedule for tidy opportunities. Pure and deterministic. Mirrors
 * scheduleBuilder.buildSchedule: returns an auto WishSolution (staged by default),
 * review-only suggestions, and the equivalence report for the auto set.
 */
export function analyzeTidy(data: ScheduleData, config: TidyConfig, now: Date): TidyResult {
  const nowMs = now.getTime();
  const elig = data.appointments.filter(a => isPendingFuture(a, nowMs));
  const names = nameLookup(data);

  const candidates: Candidate[] = [];
  if (config.rules.merge) candidates.push(...ruleMerge(elig, names));
  if (config.rules.degenerate) candidates.push(...ruleDegenerate(elig, names));
  if (config.rules.dedup) candidates.push(...ruleDedup(elig, names));
  if (config.rules.grouping) candidates.push(...ruleGrouping(elig, names));
  if (config.rules.snap) candidates.push(...ruleSnap(elig, names));
  if (config.rules.doubleBook) candidates.push(...ruleDoubleBook(elig, names));

  const autoOps: WishOp[] = [];
  const suggestions: TidySuggestion[] = [];
  for (const c of candidates) {
    if (c.ops.length === 0) { suggestions.push({ ruleId: c.ruleId, ops: [], rationale: c.rationale }); continue; }
    const eq = checkEquivalence(data, applyWishSolution(data, wrap(c.ops)), now);
    if (!c.preferReview && eq.equivalent) {
      autoOps.push(...c.ops);
    } else {
      suggestions.push({ ruleId: c.ruleId, ops: c.ops, rationale: c.rationale, metricDelta: eq.equivalent ? undefined : (c.metricHint ?? summarizeDiffs(eq.diffs)) });
    }
  }

  // Final combined-set gate: catches interaction effects between individually-safe
  // ops. If it fails, refuse to stage the auto set (an emitter bug can't commit a
  // non-equivalent edit) and surface the failure in `equivalence`.
  let equivalence: EquivReport = { equivalent: true, diffs: [] };
  let finalAuto = autoOps;
  if (autoOps.length) {
    equivalence = checkEquivalence(data, applyWishSolution(data, wrap(autoOps)), now);
    if (!equivalence.equivalent) finalAuto = [];
  }

  const auto: WishSolution = {
    id: uuidv4(),
    summary: finalAuto.length ? `Tidy: ${finalAuto.length} auto cleanup${finalAuto.length > 1 ? 's' : ''}` : 'Tidy: no auto cleanups',
    reasoning: 'Deterministic, equivalence-verified schedule cleanup.',
    ops: finalAuto,
  };

  return { auto, suggestions, equivalence, metrics: { scanned: elig.length, autoOpCount: finalAuto.length, suggestionCount: suggestions.length } };
}
