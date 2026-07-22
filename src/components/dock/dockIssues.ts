import { useState } from 'react';
import type { ScheduleConflict } from '../../types';
import type { Agenda, TargetProgress } from '../../agenda';
import { conflictKey } from '../ConflictPanel';

/**
 * The dock speaks one language — DockIssue — over three live engine feeds:
 * hard scheduling conflicts (ConstraintValidator), compliance pressure, and
 * series-horizon prompts (a recurring series about to run off its materialized
 * end — recurrence is bounded dated rows, so an unextended series just stops).
 * Compliance surfaces as PER-CASE cards for the worst few clients (each with a
 * case-scoped fix CTA) plus one aggregate tail for the remainder; the queue
 * shows one at a time, worst first.
 */
export type DockIssueKind = 'conflict' | 'compliance' | 'series-ending';

export interface DockIssue {
  id: string;
  kind: DockIssueKind;
  severity: 'error' | 'warning' | 'info';
  title: string;
  detail: string;
  /** Appointments this issue points at, for "review in place". */
  appointmentIds?: string[];
  /** The conflict's stable key, for mute/dismiss. Absent on compliance items. */
  conflictKey?: string;
  /** Present on per-CASE compliance cards — drives the case-scoped fix CTA. */
  clientId?: string;
  /** Present on series-ending cards — drives the one-tap Extend CTA. */
  seriesId?: string;
  suggestedThrough?: string; // YYYY-MM-DD the Extend CTA materializes through
}

/** The slice of seriesHorizon.EndingSeries the dock card needs. */
export interface EndingSeriesCard {
  seriesId: string;
  clientName: string;
  title: string;
  lastOccurrence: string;
  suggestedThrough: string;
  pendingCount: number;
}

/** How many per-case compliance cards ride the queue before the tail aggregate. */
export const MAX_CASE_CARDS = 3;

const CONFLICT_TITLE: Record<ScheduleConflict['type'], string> = {
  'supervision-violation': 'Supervision gap',
  'training-violation': 'Parent-training gap',
  'availability-conflict': 'Availability conflict',
  'scheduling-impossible': 'Unschedulable session',
};

const SEVERITY_RANK: Record<DockIssue['severity'], number> = { error: 0, warning: 1, info: 2 };

/**
 * Normalize the live conflict + compliance feeds into one queue, worst first.
 * The compliance half arrives as the single `Agenda` (typed gaps + counts) that
 * every surface reads — the dock is just one more renderer of it.
 */
export function buildDockIssues(
  conflicts: ScheduleConflict[],
  agenda: Agenda | null,
  maxCaseCards = MAX_CASE_CARDS,
  endingSeries: EndingSeriesCard[] = [],
): DockIssue[] {
  const fromConflicts: DockIssue[] = conflicts.map((c) => {
    const key = conflictKey(c);
    return {
      id: `conflict:${key}`,
      kind: 'conflict' as const,
      severity: c.severity,
      title: CONFLICT_TITLE[c.type],
      detail: c.message,
      appointmentIds: c.affectedAppointments,
      conflictKey: key,
    };
  });

  const gaps = agenda?.gaps ?? [];
  const progress = agenda?.targetProgress;

  // Per-case cards for the worst few CLIENTS (each carries a case-scoped fix);
  // everything else (overflow clients + techs) folds into one aggregate tail.
  // The agenda couples gaps to counts, so they can't disagree — but if a caller
  // ever hands counts without gaps (a mid-rebuild snapshot), fall back to the
  // single aggregate so the queue never flickers empty.
  const caseCards: DockIssue[] = gaps
    .filter(g => g.entity === 'client')
    .slice(0, maxCaseCards)
    .map(g => ({
      id: `compliance:case:${g.id}`,
      kind: 'compliance' as const,
      severity: g.status === 'red' ? 'error' as const : 'warning' as const,
      title: `${g.name} off pace`,
      detail: g.detail,
      clientId: g.id,
    }));
  const remainder = gaps.length - caseCards.length;
  const summaryCount = (progress?.red ?? 0) + (progress?.yellow ?? 0);
  const tail: DockIssue[] = [];
  if (gaps.length > 0 && remainder > 0) {
    const worstLeft = gaps.slice(caseCards.length);
    tail.push({
      id: 'compliance:summary',
      kind: 'compliance' as const,
      severity: worstLeft.some(g => g.status === 'red') ? 'error' : 'warning',
      title: 'More compliance attention',
      detail: `${remainder} more ${remainder === 1 ? 'entity' : 'entities'} off pace — open the compliance view for the full picture.`,
    });
  } else if (gaps.length === 0 && summaryCount > 0 && progress) {
    tail.push({
      id: 'compliance:summary',
      kind: 'compliance' as const,
      severity: progress.red > 0 ? 'error' : 'warning',
      title: 'Compliance attention',
      detail: complianceDetail(progress),
    });
  }

  // Series about to run off their materialized horizon — a courtesy prompt
  // (severity 'info'), never outranking a real problem. CTA stages an extension
  // through suggestedThrough for review; nothing auto-commits.
  const seriesCards: DockIssue[] = endingSeries.map(s => ({
    id: `series-ending:${s.seriesId}`,
    kind: 'series-ending' as const,
    severity: 'info' as const,
    title: `${s.clientName} — series ending`,
    detail: `${s.title} last runs ${s.lastOccurrence} and has no sessions after that. Extend the series through ${s.suggestedThrough}? (Staged for review, not committed.)`,
    seriesId: s.seriesId,
    suggestedThrough: s.suggestedThrough,
  }));

  // Stable sort by severity keeps conflicts ahead of equal-severity compliance
  // cards, so a red conflict still leads a red compliance flag.
  return [...fromConflicts, ...caseCards, ...tail, ...seriesCards].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  );
}

function complianceDetail(p: TargetProgress): string {
  const parts: string[] = [];
  if (p.red > 0) parts.push(`${p.red} at risk`);
  if (p.yellow > 0) parts.push(`${p.yellow} to watch`);
  return `${parts.join(', ')} — supervision or hours off pace.`;
}

export interface IssueQueueState {
  /** The issue to show right now, or null when the queue is clear. */
  current: DockIssue | null;
  /** Total items in the active rotation, including the current one. */
  remaining: number;
  /** 1-based position of the shown card in the rotation (0 when empty). */
  position: number;
  /** Whether a previous / next card exists to browse to. */
  hasPrev: boolean;
  hasNext: boolean;
  /** Browse back / forward WITHOUT acting on or reordering the queue. */
  prev: () => void;
  next: () => void;
  /** Defer the shown item to the back of the rotation. */
  notNow: () => void;
}

/**
 * One-at-a-time cycling with a browse cursor. `prev`/`next` step through the
 * rotation without touching it — a read-only page through the queue. "Not now"
 * rotates the shown item to the back so the BCBA can pass on it without
 * dismissing it; new issues slot in ahead of any deferred ones, and deferred
 * items that get resolved elsewhere fall out.
 */
export function useIssueQueue(issues: DockIssue[]): IssueQueueState {
  const [deferred, setDeferred] = useState<string[]>([]);
  const [cursor, setCursor] = useState(0);
  const ids = issues.map((i) => i.id);
  const liveDeferred = deferred.filter((id) => ids.includes(id));
  const active = ids.filter((id) => !liveDeferred.includes(id));
  const order = [...active, ...liveDeferred];
  // The queue changes size as issues resolve/appear — clamp the browse cursor so
  // it always lands on a real card.
  const idx = order.length ? Math.min(cursor, order.length - 1) : 0;
  const currentId = order[idx] ?? null;
  const current = issues.find((i) => i.id === currentId) ?? null;

  const prev = () => setCursor(() => Math.max(idx - 1, 0));
  const next = () => setCursor(() => Math.min(idx + 1, order.length - 1));

  const notNow = () => {
    // Nothing to rotate to when it's the last card standing.
    if (!currentId || order.length < 2) return;
    setDeferred((d) => [...d.filter((x) => x !== currentId), currentId]);
    // The deferred card leaves this slot; keep the cursor on the slot (now the
    // next card), clamped to the shrunken active head.
    setCursor(() => Math.min(idx, order.length - 2));
  };

  return {
    current,
    remaining: order.length,
    position: order.length ? idx + 1 : 0,
    hasPrev: idx > 0,
    hasNext: idx < order.length - 1,
    prev,
    next,
    notNow,
  };
}
