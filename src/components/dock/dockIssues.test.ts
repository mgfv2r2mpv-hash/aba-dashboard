import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ScheduleConflict } from '../../types';
import type { ComplianceSummary, ComplianceAttention } from '../../complianceCache';
import { buildDockIssues, useIssueQueue, type DockIssue } from './dockIssues';

const conflict = (
  type: ScheduleConflict['type'],
  severity: ScheduleConflict['severity'],
  message: string,
  affectedAppointments?: string[],
): ScheduleConflict => ({ type, severity, message, affectedAppointments });

const summary = (red: number, yellow: number): ComplianceSummary => ({
  red,
  yellow,
  worst: red > 0 ? 'red' : yellow > 0 ? 'yellow' : 'green',
});

describe('buildDockIssues', () => {
  it('returns an empty queue when nothing is wrong', () => {
    expect(buildDockIssues([], summary(0, 0))).toEqual([]);
    expect(buildDockIssues([], null)).toEqual([]);
  });

  it('maps a conflict to a titled issue carrying its appointments and key', () => {
    const c = conflict('supervision-violation', 'error', 'Jordan under supervision target', ['a1', 'a2']);
    const [issue] = buildDockIssues([c], null);
    expect(issue.kind).toBe('conflict');
    expect(issue.title).toBe('Supervision gap');
    expect(issue.detail).toBe('Jordan under supervision target');
    expect(issue.appointmentIds).toEqual(['a1', 'a2']);
    expect(issue.conflictKey).toContain('supervision-violation');
  });

  it('orders worst-first: errors ahead of warnings', () => {
    const warn = conflict('training-violation', 'warning', 'w');
    const err = conflict('availability-conflict', 'error', 'e');
    const issues = buildDockIssues([warn, err], null);
    expect(issues.map((i) => i.severity)).toEqual(['error', 'warning']);
  });

  it('appends one compliance summary issue when entities need attention', () => {
    const issues = buildDockIssues([], summary(2, 3));
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe('compliance');
    expect(issues[0].severity).toBe('error'); // red > 0
    expect(issues[0].detail).toContain('2 at risk');
    expect(issues[0].detail).toContain('3 to watch');
  });

  it('marks compliance as a warning when only yellow entities exist', () => {
    const [issue] = buildDockIssues([], summary(0, 4));
    expect(issue.severity).toBe('warning');
    expect(issue.detail).toContain('4 to watch');
    expect(issue.detail).not.toContain('at risk');
  });

  it('keeps a conflict ahead of an equal-severity compliance flag', () => {
    const err = conflict('availability-conflict', 'error', 'e');
    const issues = buildDockIssues([err], summary(1, 0));
    expect(issues.map((i) => i.kind)).toEqual(['conflict', 'compliance']);
  });

  // ── per-case cards (attention list) ──────────────────────────────────────
  const att = (kind: 'client' | 'tech', id: string, status: 'red' | 'yellow', hoursToGo = 1): ComplianceAttention =>
    ({ kind, id, name: `Name ${id}`, status, detail: `d-${id}`, hoursToGo });

  it('emits per-case cards with clientId, capped, plus a counting tail', () => {
    const attention = [
      att('client', 'c1', 'red', 3), att('client', 'c2', 'red', 2),
      att('client', 'c3', 'yellow', 1), att('client', 'c4', 'yellow', 0.5),
      att('tech', 't1', 'yellow', 1),
    ];
    const issues = buildDockIssues([], summary(2, 3), attention, 3);
    const cases = issues.filter(i => i.id.startsWith('compliance:case:'));
    expect(cases).toHaveLength(3);
    expect(cases.map(i => i.clientId)).toEqual(['c1', 'c2', 'c3']);
    expect(cases[0].severity).toBe('error');
    expect(cases[2].severity).toBe('warning');
    expect(cases[0].title).toBe('Name c1 off pace');
    const tail = issues.find(i => i.id === 'compliance:summary');
    expect(tail).toBeDefined();
    expect(tail!.clientId).toBeUndefined();
    expect(tail!.detail).toContain('2 more');
  });

  it('techs never become per-case cards (they fold into the tail)', () => {
    const issues = buildDockIssues([], summary(1, 0), [att('tech', 't1', 'red', 2)], 3);
    expect(issues.filter(i => i.id.startsWith('compliance:case:'))).toHaveLength(0);
    expect(issues.find(i => i.id === 'compliance:summary')?.detail).toContain('1 more');
  });

  it('no tail when every attention entry fits as a case card', () => {
    const issues = buildDockIssues([], summary(1, 0), [att('client', 'c1', 'red')], 3);
    expect(issues.filter(i => i.kind === 'compliance')).toHaveLength(1);
    expect(issues[0].clientId).toBe('c1');
  });

  it('falls back to the single aggregate while the cache is rebuilding (empty attention, non-empty summary)', () => {
    const issues = buildDockIssues([], summary(2, 1), [], 3);
    expect(issues).toHaveLength(1);
    expect(issues[0].id).toBe('compliance:summary');
    expect(issues[0].detail).toContain('2 at risk');
  });

  it('a series-ending prompt rides the queue as info, ranked after errors and warnings', () => {
    const warn = conflict('training-violation', 'warning', 'w');
    const ending = {
      seriesId: 'SER-1', clientName: 'Jordan', title: 'Session',
      lastOccurrence: '2026-07-13', suggestedThrough: '2026-08-31', pendingCount: 2,
    };
    const issues = buildDockIssues([warn], summary(1, 0), [att('client', 'c1', 'red')], 3, [ending]);
    const card = issues.find(i => i.kind === 'series-ending');
    expect(card).toBeDefined();
    expect(card!.severity).toBe('info');
    expect(card!.seriesId).toBe('SER-1');
    expect(card!.suggestedThrough).toBe('2026-08-31');
    expect(card!.title).toContain('Jordan');
    expect(card!.detail).toContain('2026-08-31');
    // info ranks last — a courtesy prompt never outranks a real problem.
    expect(issues[issues.length - 1].kind).toBe('series-ending');
  });

  it('a red case card ranks ahead of a yellow conflict', () => {
    const warn = conflict('training-violation', 'warning', 'w');
    const issues = buildDockIssues([warn], summary(1, 0), [att('client', 'c1', 'red')], 3);
    expect(issues.map(i => i.id.startsWith('compliance:case:'))).toEqual([true, false]);
  });
});

describe('useIssueQueue', () => {
  const mk = (id: string): DockIssue => ({
    id,
    kind: 'conflict',
    severity: 'warning',
    title: id,
    detail: id,
  });

  it('shows the first issue and counts the rest', () => {
    const issues = [mk('a'), mk('b'), mk('c')];
    const { result } = renderHook(() => useIssueQueue(issues));
    expect(result.current.current?.id).toBe('a');
    expect(result.current.remaining).toBe(3);
  });

  it('rotates the current issue to the back on "not now"', () => {
    const issues = [mk('a'), mk('b'), mk('c')];
    const { result } = renderHook(() => useIssueQueue(issues));
    act(() => result.current.notNow());
    expect(result.current.current?.id).toBe('b');
    act(() => result.current.notNow());
    expect(result.current.current?.id).toBe('c');
    act(() => result.current.notNow());
    expect(result.current.current?.id).toBe('a'); // full cycle back
  });

  it('is a no-op when only one issue remains', () => {
    const { result } = renderHook(() => useIssueQueue([mk('solo')]));
    act(() => result.current.notNow());
    expect(result.current.current?.id).toBe('solo');
    expect(result.current.remaining).toBe(1);
  });

  it('drops a deferred issue that gets resolved elsewhere', () => {
    const issues = [mk('a'), mk('b')];
    const { result, rerender } = renderHook(({ list }) => useIssueQueue(list), {
      initialProps: { list: issues },
    });
    act(() => result.current.notNow()); // defer 'a', now showing 'b'
    expect(result.current.current?.id).toBe('b');
    // 'a' resolves and leaves the feed entirely.
    rerender({ list: [mk('b')] });
    expect(result.current.current?.id).toBe('b');
    expect(result.current.remaining).toBe(1);
  });

  it('clears to null when the feed empties', () => {
    const { result, rerender } = renderHook(({ list }) => useIssueQueue(list), {
      initialProps: { list: [mk('a')] },
    });
    rerender({ list: [] as DockIssue[] });
    expect(result.current.current).toBeNull();
    expect(result.current.remaining).toBe(0);
  });

  it('browses forward and back without reordering the queue', () => {
    const issues = [mk('a'), mk('b'), mk('c')];
    const { result } = renderHook(() => useIssueQueue(issues));
    expect(result.current.position).toBe(1);
    expect(result.current.hasPrev).toBe(false);
    act(() => result.current.next());
    expect(result.current.current?.id).toBe('b');
    expect(result.current.position).toBe(2);
    expect(result.current.hasPrev).toBe(true);
    expect(result.current.hasNext).toBe(true);
    act(() => result.current.next());
    expect(result.current.current?.id).toBe('c');
    expect(result.current.hasNext).toBe(false);
    // Paging back reaches 'a' again — the order was never touched.
    act(() => result.current.prev());
    act(() => result.current.prev());
    expect(result.current.current?.id).toBe('a');
    expect(result.current.position).toBe(1);
  });

  it('clamps browsing at both ends', () => {
    const { result } = renderHook(() => useIssueQueue([mk('a'), mk('b')]));
    act(() => result.current.prev()); // already at the first card
    expect(result.current.current?.id).toBe('a');
    act(() => result.current.next());
    act(() => result.current.next()); // past the last card
    expect(result.current.current?.id).toBe('b');
    expect(result.current.hasNext).toBe(false);
  });

  it('defers the browsed-to card, not just the head', () => {
    const issues = [mk('a'), mk('b'), mk('c')];
    const { result } = renderHook(() => useIssueQueue(issues));
    act(() => result.current.next()); // now showing 'b'
    act(() => result.current.notNow()); // defer 'b', not 'a'
    expect(result.current.current?.id).toBe('c');
    expect(result.current.remaining).toBe(3);
    act(() => result.current.next()); // the deferred 'b' sits at the back
    expect(result.current.current?.id).toBe('b');
  });
});
