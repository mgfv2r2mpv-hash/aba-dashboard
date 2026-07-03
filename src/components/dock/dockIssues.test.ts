import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ScheduleConflict } from '../../types';
import type { ComplianceSummary } from '../../complianceCache';
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
});
