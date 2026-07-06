import { useState } from 'react';
import type { ScheduleConflict } from '../../types';
import type { ComplianceSummary } from '../../complianceCache';
import { conflictKey } from '../ConflictPanel';

/**
 * The dock speaks one language — DockIssue — over two live engine feeds:
 * hard scheduling conflicts (ConstraintValidator) and compliance pressure
 * (the summarized cache). The queue shows one at a time, worst first.
 */
export type DockIssueKind = 'conflict' | 'compliance';

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
}

const CONFLICT_TITLE: Record<ScheduleConflict['type'], string> = {
  'supervision-violation': 'Supervision gap',
  'training-violation': 'Parent-training gap',
  'availability-conflict': 'Availability conflict',
  'scheduling-impossible': 'Unschedulable session',
};

const SEVERITY_RANK: Record<DockIssue['severity'], number> = { error: 0, warning: 1, info: 2 };

/** Normalize the live conflict + compliance feeds into one queue, worst first. */
export function buildDockIssues(
  conflicts: ScheduleConflict[],
  compliance: ComplianceSummary | null,
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

  const attention = (compliance?.red ?? 0) + (compliance?.yellow ?? 0);
  const complianceIssue: DockIssue[] =
    attention > 0 && compliance
      ? [{
        id: 'compliance:summary',
        kind: 'compliance' as const,
        severity: compliance.red > 0 ? 'error' : 'warning',
        title: 'Compliance attention',
        detail: complianceDetail(compliance),
      }]
      : [];

  // Stable sort by severity keeps conflicts ahead of the compliance summary at
  // equal severity, so a red conflict still leads a red compliance flag.
  return [...fromConflicts, ...complianceIssue].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  );
}

function complianceDetail(c: ComplianceSummary): string {
  const parts: string[] = [];
  if (c.red > 0) parts.push(`${c.red} at risk`);
  if (c.yellow > 0) parts.push(`${c.yellow} to watch`);
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
