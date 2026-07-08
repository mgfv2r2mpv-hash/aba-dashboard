// Blast-radius preview for a staged selective undo, shown above the DraftTray.
// Changes are linear but reversal is nonlinear: this panel shows WHAT undoing
// the entry does to the CURRENT schedule — which reversals would overwrite a
// later change (superseded, ✕-able in the tray below) and the before→after
// impact on every affected entity's numbers (the same ImpactSummary the
// solution cards use). The tray's grade + Accept gating still apply.

import { useMemo } from 'react';
import { ScheduleData } from '../types';
import { DraftOp } from '../draft';
import { computeOpsImpact } from '../wish';
import ImpactSummary from './ImpactSummary';

interface UndoPreviewProps {
  base: ScheduleData;
  ops: DraftOp[];
  label: string;
  /** Inverse-op ids whose target changed again since the entry was committed. */
  superseded: string[];
  removedBlackouts: number;
  restoredHints: number;
}

export default function UndoPreview({ base, ops, label, superseded, removedBlackouts, restoredHints }: UndoPreviewProps) {
  // One compliance double-walk per staging, not per render of parents.
  const impact = useMemo(() => {
    try { return computeOpsImpact(base, ops); } catch { return null; }
  }, [base, ops]);

  const extras: string[] = [];
  if (removedBlackouts > 0) extras.push(`${removedBlackouts} day-off${removedBlackouts === 1 ? '' : 's'} removed`);
  if (restoredHints > 0) extras.push(`${restoredHints} scheduling hint${restoredHints === 1 ? '' : 's'} restored`);

  return (
    <section
      aria-label="Undo preview"
      style={{
        border: '1px solid var(--sage-200, #e5e7eb)',
        borderRadius: 'var(--radius-lg, 10px)',
        background: 'var(--white, #fff)',
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide, .05em)', color: 'var(--sage-700, #374151)' }}>
          ↩︎ Undoing
        </span>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary, #111827)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </span>
      </div>

      {superseded.length > 0 && (
        <div style={{ fontSize: 12, lineHeight: 1.5, color: '#92400e', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 6, padding: '6px 8px' }}>
          {superseded.length} of {ops.length} change{ops.length === 1 ? '' : 's'} {superseded.length === 1 ? 'was' : 'were'} modified
          again after this entry — undoing them overwrites the newer state. Remove any you want to keep (✕ in the list below).
        </div>
      )}

      {extras.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-secondary, #4b5563)' }}>
          Also: {extras.join(' · ')} on Accept.
        </div>
      )}

      {impact && <ImpactSummary impact={impact} />}
    </section>
  );
}
