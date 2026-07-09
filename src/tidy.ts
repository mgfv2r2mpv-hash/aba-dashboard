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

import { ScheduleData, Appointment, WishOp, WishSolution, StoredRecurrencePattern, SUPERVISION_COUNTING_TYPES } from './types';
import { applyWishSolution } from './wish';
import { checkEquivalence, summarizeDiffs, EquivReport } from './tidyEquivalence';
import { measurePattern } from './seriesProfile';
import { v4 as uuidv4 } from 'uuid';

const MS_PER_MIN = 60_000;
const MS_PER_DAY = 86_400_000;
const MIN_SERIES_LEN = 3;         // ≥ this many occurrences before suggesting a series
const SNAP_GRID_MIN = 15;         // snap timestamps to :00 / :15 / :30 / :45
const SNAP_MAX_SHIFT_MIN = 5;     // …but only when the row is within this of the grid
const NEAR_ADJACENT_GAP_MIN = 15; // a real gap ≤ this flags a "could merge" review

export type TidyRuleId = 'merge' | 'degenerate' | 'dedup' | 'grouping' | 'seriesConsolidate' | 'snap' | 'doubleBook';

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
  return { rules: { merge: true, degenerate: true, dedup: true, grouping: true, seriesConsolidate: true, snap: true, doubleBook: true } };
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
// fixed-ness. seriesId is deliberately NOT part of identity, and for BCBA sessions
// it is not a merge barrier either — two occurrences that meet ON A DATE fuse even
// when they came from different builds' series (seriesId is internal). The survivor
// keeps the LARGER series so the recurring pattern on other dates is untouched, and
// the equivalence oracle verifies the edit is credit-neutral. Real schedules are
// mostly recurring dated occurrences, so merge must NOT skip recurring rows.
const identityKey = (a: Appointment): string => [a.type, a.client ?? '', a.technician ?? '', billable(a), a.isFixed].join('|');

const overlaps = (a: Appointment, b: Appointment): boolean => ms(a.startTime) < ms(b.endTime) && ms(b.startTime) < ms(a.endTime);
// The BCBA-run session types (supervision / parent-training / case-planning /
// reassessment). These INTENTIONALLY overlap a BT's direct — concurrent care, not a
// double-book — so the conflict scan never crosses a direct with one of these.
const BCBA_SESSION_TYPES = new Set<Appointment['type']>(SUPERVISION_COUNTING_TYPES);

// ── rule 1: merge contiguous / overlapping fragments (auto) ─────────────────
// Adjacent same-identity fragments fuse into one session; the redundant occurrence
// is dropped, and the survivor keeps the LARGEST series so the recurring pattern on
// other dates is untouched. For BCBA session types (builder-placed supervision/PT/
// etc. that legitimately splinter across repeated builds) seriesId is an internal
// tag, NOT a run barrier — fragments that meet on a date fuse even across different
// series, and a run absorbs genuine OVERLAP, not just an exact touch. Directs keep
// strict adjacency AND cap a run at one series, so a deliberate recurring commitment
// or a real double-book is never silently fused. Every candidate still passes the
// equivalence oracle in analyzeTidy before it auto-applies.
function ruleMerge(elig: Appointment[], names: Names): Candidate[] {
  const out: Candidate[] = [];
  // Occurrence count per series (over the eligible set) → pick the survivor from the
  // biggest series so a lone orphan sliver is the row that gets dropped.
  const seriesSize = new Map<string, number>();
  for (const a of elig) if (a.seriesId) seriesSize.set(a.seriesId, (seriesSize.get(a.seriesId) ?? 0) + 1);
  const sizeOf = (a: Appointment): number => (a.seriesId ? seriesSize.get(a.seriesId) ?? 0 : 0);
  const sameSpan = (a: Appointment, b: Appointment): boolean => ms(a.startTime) === ms(b.startTime) && ms(a.endTime) === ms(b.endTime);

  const groups = groupBy(elig, identityKey);
  for (const rows of groups.values()) {
    const bcba = rows.length > 0 && BCBA_SESSION_TYPES.has(rows[0].type);
    // Drop zero-length rows. For BCBA keep partial overlaps (we coalesce them) but
    // leave EXACT-duplicate spans to ruleDedup; for directs exclude any overlap —
    // ambiguous (double-book / dup), belongs to dedup/doubleBook, not merge.
    const clean = rows.filter(a => {
      if (ms(a.endTime) <= ms(a.startTime)) return false;
      if (bcba) return !rows.some(b => b !== a && sameSpan(a, b));
      return !rows.some(b => b !== a && overlaps(a, b));
    });
    const sorted = [...clean].sort((x, y) => ms(x.startTime) - ms(y.startTime));
    let i = 0;
    while (i < sorted.length) {
      let j = i;
      let runEnd = ms(sorted[i].endTime);
      // Directs cap a run at ONE distinct series (a deliberate recurring commitment
      // is never silently cross-merged); BCBA sessions ignore seriesId entirely.
      const runSeries = new Set<string>();
      if (!bcba && sorted[i].seriesId) runSeries.add(sorted[i].seriesId!);
      // Extend the run while the next row abuts (directs) or abuts-or-overlaps (BCBA)
      // the running span.
      while (j + 1 < sorted.length) {
        const nextStart = ms(sorted[j + 1].startTime);
        if (bcba ? nextStart > runEnd : nextStart !== runEnd) break;
        if (!bcba) {
          const next = sorted[j + 1].seriesId;
          if (next && runSeries.size >= 1 && !runSeries.has(next)) break; // 2nd distinct series
          if (next) runSeries.add(next);
        }
        runEnd = Math.max(runEnd, ms(sorted[j + 1].endTime));
        j++;
      }
      if (j > i) {
        const run = sorted.slice(i, j + 1);
        // Survivor keeps series membership; prefer the row in the LARGEST series so
        // the recurring pattern survives (stable sort keeps the earliest row on ties).
        const survivor = [...run].sort((a, b) => sizeOf(b) - sizeOf(a))[0];
        const start = run[0].startTime;
        const end = run.reduce((acc, r) => (ms(r.endTime) > ms(acc) ? r.endTime : acc), run[0].endTime);
        out.push({
          ruleId: 'merge', preferReview: false,
          ops: [
            { op: 'move', appointmentId: survivor.id, start, end },
            ...run.filter(r => r !== survivor).map((r): WishOp => ({ op: 'remove', appointmentId: r.id })),
          ],
          rationale: `Merge ${run.length} ${survivor.type} fragments (${names.client(survivor.client)} / ${names.tech(survivor.technician)}) into one ${clock(start)}–${clock(end)} session.`,
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
// Two-stage series detection on the full pattern vocabulary. A bucket is
// identity + clock — the weekday is deliberately NOT in the key, so a Mon–Fri
// custom series is ONE bucket (the old per-weekday key surfaced it as five
// separate "weekly series" cards).
//   Stage 0: monthly runs on the whole bucket (28–35-day gaps) — a same-date
//            monthly series wobbles across weekdays and would shatter under a
//            per-weekday split; measurePattern names the flavor (same-date /
//            first-Tuesday / last-Friday) for the rationale.
//   Stage 1: per-weekday runs of consistent 7- or 14-day steps.
//   Stage 2: 7-day runs that overlap in calendar time (same bucket = same
//            clock) union into ONE 'custom' weekday-set candidate.
interface SeriesRun { rows: Appointment[]; pattern: StoredRecurrencePattern; weekdays: number[]; label: string }

const SHORT_DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayMsOf = (iso: string): number => { const d = new Date(iso); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };

// Maximal runs over date-sorted rows where every consecutive gap satisfies `accept`.
function runsWhere(sorted: Appointment[], accept: (gapDays: number) => boolean): Appointment[][] {
  const out: Appointment[][] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && accept(Math.round((dayMsOf(sorted[j + 1].startTime) - dayMsOf(sorted[j].startTime)) / MS_PER_DAY))) j++;
    if (j > i) { out.push(sorted.slice(i, j + 1)); i = j + 1; }
    else i += 1;
  }
  return out;
}

function weekdaySetLabel(weekdays: number[]): string {
  const names = weekdays.map(w => SHORT_DAY[w]);
  // Contiguous span (Mon–Fri) reads better than a slash list.
  const contiguous = weekdays.length >= 3 && weekdays.every((w, i) => i === 0 || w === weekdays[i - 1] + 1);
  return contiguous ? `${names[0]}–${names[names.length - 1]}` : names.join('/');
}

function monthlyLabel(rows: Appointment[]): string {
  const m = measurePattern(rows.map(r => r.startTime));
  if (m.monthlyFlavor === 'nth-weekday') {
    const wd = WEEKDAYS[new Date(rows[0].startTime).getDay()];
    const nth = m.nth === 'last' ? 'last' : ['', 'first', 'second', 'third', 'fourth', 'fifth'][m.nth as number] ?? `${m.nth}th`;
    return `the ${nth} ${wd} of each month`;
  }
  return `the ${new Date(rows[0].startTime).getDate()}th of each month`;
}

function detectSeriesRuns(rows: Appointment[]): SeriesRun[] {
  const out: SeriesRun[] = [];
  const sorted = [...rows].sort((x, y) => ms(x.startTime) - ms(y.startTime));

  // Stage 0 — monthly (before any weekday split).
  const monthlyRows = new Set<Appointment>();
  for (const run of runsWhere(sorted, g => g >= 28 && g <= 35)) {
    if (run.length < MIN_SERIES_LEN) continue;
    if (measurePattern(run.map(r => r.startTime)).pattern !== 'monthly') continue;
    run.forEach(r => monthlyRows.add(r));
    out.push({
      rows: run, pattern: 'monthly',
      weekdays: [...new Set(run.map(r => new Date(r.startTime).getDay()))].sort((a, b) => a - b),
      label: `on ${monthlyLabel(run)}`,
    });
  }
  const rest = sorted.filter(r => !monthlyRows.has(r));

  // Stage 1 — per-weekday 7/14-day runs.
  interface WRun { weekday: number; rows: Appointment[]; step: 7 | 14; firstMs: number; lastMs: number }
  const wruns: WRun[] = [];
  for (const [wd, wrows] of groupBy(rest, a => String(new Date(a.startTime).getDay()))) {
    const wsorted = [...wrows].sort((x, y) => ms(x.startTime) - ms(y.startTime));
    for (const step of [7, 14] as const) {
      // 7-day runs first; whatever they consume can't re-run at 14.
      const consumed = new Set(wruns.flatMap(r => r.rows));
      const open = wsorted.filter(r => !consumed.has(r));
      for (const run of runsWhere(open, g => g === step)) {
        if (run.length < 2) continue;
        wruns.push({
          weekday: Number(wd), rows: run, step,
          firstMs: dayMsOf(run[0].startTime), lastMs: dayMsOf(run[run.length - 1].startTime),
        });
      }
    }
  }

  // Stage 2 — cluster CALENDAR-OVERLAPPING weekly (7-day) runs into one custom
  // weekday-set series; a lone weekly run stays weekly. Biweekly runs stand alone.
  const weekly = wruns.filter(r => r.step === 7).sort((a, b) => a.firstMs - b.firstMs);
  const SLACK = 6 * MS_PER_DAY; // same-week runs may not strictly overlap
  const clusters: WRun[][] = [];
  for (const run of weekly) {
    const cur = clusters[clusters.length - 1];
    if (cur && run.firstMs <= Math.max(...cur.map(r => r.lastMs)) + SLACK) cur.push(run);
    else clusters.push([run]);
  }
  for (const cluster of clusters) {
    const weekdays = [...new Set(cluster.map(r => r.weekday))].sort((a, b) => a - b);
    const crows = cluster.flatMap(r => r.rows).sort((x, y) => ms(x.startTime) - ms(y.startTime));
    if (weekdays.length >= 2 && crows.length >= MIN_SERIES_LEN) {
      out.push({ rows: crows, pattern: 'custom', weekdays, label: `every ${weekdaySetLabel(weekdays)}` });
    } else if (weekdays.length === 1 && crows.length >= MIN_SERIES_LEN) {
      out.push({ rows: crows, pattern: 'weekly', weekdays, label: `every ${WEEKDAYS[weekdays[0]]}` });
    }
  }
  for (const run of wruns.filter(r => r.step === 14)) {
    if (run.rows.length < MIN_SERIES_LEN) continue;
    out.push({ rows: run.rows, pattern: 'biweekly', weekdays: [run.weekday], label: `every other ${WEEKDAYS[run.weekday]}` });
  }
  return out;
}

const seriesBucketKey = (a: Appointment): string =>
  [a.type, a.client ?? '', a.technician ?? '', billable(a), clock(a.startTime), clock(a.endTime)].join('|');

function ruleGrouping(elig: Appointment[], names: Names): Candidate[] {
  // Series-less rows only — INCLUDING lone-recurring pre-heal rows (a flag with
  // no series behind it is exactly what grouping repairs).
  const groups = groupBy(elig.filter(a => !a.seriesId), seriesBucketKey);
  const out: Candidate[] = [];
  for (const rows of groups.values()) {
    if (rows.length < MIN_SERIES_LEN) continue;
    for (const run of detectSeriesRuns(rows)) {
      const first = run.rows[0];
      out.push({
        ruleId: 'grouping', preferReview: true,
        ops: [{ op: 'regroup', appointmentIds: run.rows.map(r => r.id), seriesId: uuidv4(), recurringPattern: run.pattern }],
        rationale: `${run.rows.length} ${first.type} sessions ${run.label} ${clock(first.startTime)}–${clock(first.endTime)} (${names.client(first.client)} / ${names.tech(first.technician)}) look like one ${run.pattern === 'custom' ? `${weekdaySetLabel(run.weekdays)} ` : ''}${run.pattern} series — group for batch (This / Following / All) edits.`,
      });
    }
  }
  return out;
}

// ── rule 4b: consolidate SPLIT series (review — a judgment call) ─────────────
// Rows that already carry ≥2 different seriesIds but measure as ONE logical
// series — e.g. the builder materialized Mon..Fri as five weekly series, or an
// extend bug split one weekly line across two ids. One regroup onto the LARGEST
// series' id with the measured pattern. Review-only; pending/future rows only,
// so the losing series' completed/canceled facts keep their old seriesId
// (history intact — scope edits spare facts anyway).
function ruleSeriesConsolidate(elig: Appointment[], names: Names): Candidate[] {
  const groups = groupBy(elig.filter(a => a.seriesId), seriesBucketKey);
  const out: Candidate[] = [];
  for (const rows of groups.values()) {
    const seriesIds = new Set(rows.map(r => r.seriesId!));
    if (seriesIds.size < 2 || rows.length < MIN_SERIES_LEN) continue;
    // Coherence bar: ONE detected run must cover EVERY row in the bucket —
    // partial matches stay separate series (never force-fuse).
    const covering = detectSeriesRuns(rows).find(r => r.rows.length === rows.length);
    if (!covering) continue;
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.seriesId!, (counts.get(r.seriesId!) ?? 0) + 1);
    const target = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const first = rows[0];
    out.push({
      ruleId: 'seriesConsolidate', preferReview: true,
      ops: [{ op: 'regroup', appointmentIds: covering.rows.map(r => r.id), seriesId: target, recurringPattern: covering.pattern }],
      rationale: `${rows.length} ${first.type} sessions (${names.client(first.client)} / ${names.tech(first.technician)}) sit in ${seriesIds.size} separate series but look like ONE ${covering.pattern === 'custom' ? `${weekdaySetLabel(covering.weekdays)} ` : ''}${covering.pattern} series ${covering.label} ${clock(first.startTime)}–${clock(first.endTime)} — consolidate so This / Following / All edits reach every occurrence.`,
    });
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
  const scan = (rows: Appointment[], reason: (a: Appointment) => string, skipSameIdentity = false) => {
    const s = [...rows].sort((x, y) => ms(x.startTime) - ms(y.startTime));
    for (let i = 0; i < s.length - 1; i++) {
      for (let j = i + 1; j < s.length && ms(s[j].startTime) < ms(s[i].endTime); j++) {
        if (!overlaps(s[i], s[j])) continue;
        // Same-identity BCBA overlaps are coalescable duplicates (ruleMerge owns
        // them), not a genuine analyst conflict — only cross-client/cross-tech
        // BCBA overlaps are a real double-book of the single analyst.
        if (skipSameIdentity && identityKey(s[i]) === identityKey(s[j])) continue;
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
  scan(bcba, () => `Double-book — two overlapping supervising-analyst sessions`, true);

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
  if (config.rules.seriesConsolidate) candidates.push(...ruleSeriesConsolidate(elig, names));
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
