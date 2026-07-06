import React from 'react';
import { ScheduleData, cancellationReasonLabel } from '../types';
import { DraftOp } from '../draft';
import { DraftStatus, PrioritizationChoice } from '../draftSolver';

interface DraftTrayProps {
  base: ScheduleData;
  ops: DraftOp[];
  status: DraftStatus;
  hasApiKey: boolean;
  onResetOp: (opId: string) => void;
  onResetAll: () => void;
  onCancel: () => void;
  onAccept: () => void;       // commit the engine's resolved arrangement
  onSaveAnyway: () => void;   // override: commit the preview as-is
  onAI: () => void;
  onPickChoice: (choice: PrioritizationChoice) => void;
  onLogGhosts: () => void;    // refuse and log staged adds as ghosts
  aiLoading?: boolean;
}

const BADGE: Record<DraftStatus['grade'], { color: string; symbol: string }> = {
  green: { color: '#16a34a', symbol: '✔' },
  yellow: { color: '#f59e0b', symbol: '!' },
  red: { color: '#dc2626', symbol: '✕' },
};

function opLabel(op: DraftOp, base: ScheduleData): string {
  const fmt = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    // Include the calendar date, not just the weekday — a build materializes the
    // same weekly session across many weeks, so "Thu 10:00" alone reads identical
    // on every row. "Thu, Jul 9, 10:00" tells them apart.
    const date = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    return `${date}, ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const titleOf = (id?: string) => base.appointments.find(a => a.id === id)?.title || op.appt?.title || 'session';
  switch (op.kind) {
    case 'add': return `Add ${op.appt?.title || op.appt?.client || 'session'} · ${fmt(op.appt?.startTime)}`;
    case 'move': return `Move ${op.appt?.title || titleOf(op.targetId)} → ${fmt(op.appt?.startTime)}`;
    case 'shorten': return `Shorten ${op.appt?.title || titleOf(op.targetId)}`;
    case 'remove': return `Remove ${titleOf(op.targetId)}`;
    case 'edit': {
      // An edit carries a fully-patched appointment — name the change by diffing
      // it against the base (pin/unpin, complete, cancel).
      const title = op.appt?.title || titleOf(op.targetId);
      const before = base.appointments.find(a => a.id === op.targetId);
      const a = op.appt;
      if (a?.status === 'canceled' && before?.status !== 'canceled') {
        const reason = a.cancellation ? cancellationReasonLabel(a.cancellation.reason, base.settings) : '';
        return `Cancel ${title}${reason ? ` (${reason})` : ''}`;
      }
      if (a?.status === 'completed' && before?.status !== 'completed') return `Complete ${title}`;
      if (a && before && a.isFixed !== before.isFixed) return a.isFixed ? `Lock ${title}` : `Unlock ${title}`;
      return `Edit ${title}`;
    }
  }
}

export default function DraftTray({
  base, ops, status, hasApiKey,
  onResetOp, onResetAll, onCancel, onAccept, onSaveAnyway, onAI, onPickChoice, onLogGhosts, aiLoading,
}: DraftTrayProps) {
  const badge = BADGE[status.grade];
  const acceptEnabled = status.grade === 'green' || (status.grade === 'yellow' && !status.needsChoice);
  const aiEnabled = status.aiEligible && hasApiKey && !aiLoading;
  const canLogGhosts = status.grade === 'red' && ops.some(o => o.kind === 'add');

  return (
    <div style={{
      borderTop: '2px solid #e5e7eb', background: '#ffffff',
      padding: '12px', display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      {/* Status row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{
          width: 22, height: 22, borderRadius: '50%', background: badge.color, color: 'white',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 800, flexShrink: 0,
        }}>{badge.symbol}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>{status.label}</span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#6b7280' }}>
          {ops.length} change{ops.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* Staged ops */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {ops.map(op => (
          <div key={op.id} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 12, color: '#374151',
            background: '#f9fafb', border: '1px solid #f3f4f6', borderRadius: 4, padding: '5px 8px',
          }}>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {opLabel(op, base)}
            </span>
            <button
              onClick={() => onResetOp(op.id)}
              aria-label="Reset this change"
              style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 2 }}
            >✕</button>
          </div>
        ))}
      </div>

      {/* Engine relocations note */}
      {status.movedIds.length > 0 && (
        <div style={{ fontSize: 11, color: '#6b7280' }}>
          Accepting also moves {status.movedIds.length} other session{status.movedIds.length === 1 ? '' : 's'} to fit.
        </div>
      )}

      {/* Prioritization choices (yellow) */}
      {status.choices.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#92400e' }}>Pick one to resolve:</div>
          {status.choices.map(ch => (
            <button
              key={ch.appointmentId + ch.kind}
              onClick={() => onPickChoice(ch)}
              style={{
                textAlign: 'left', fontSize: 12, padding: '6px 8px',
                background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 4,
                color: '#92400e', cursor: 'pointer',
              }}
            >{ch.label}</button>
          ))}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button
          onClick={onAccept}
          disabled={!acceptEnabled}
          style={{
            flex: '1 1 auto', padding: '8px 12px', borderRadius: 5, border: 'none', fontSize: 13, fontWeight: 600,
            cursor: acceptEnabled ? 'pointer' : 'not-allowed',
            background: acceptEnabled ? '#16a34a' : '#e5e7eb',
            color: acceptEnabled ? 'white' : '#9ca3af',
          }}
        >Accept</button>
        <button
          onClick={onAI}
          disabled={!aiEnabled}
          title={!hasApiKey ? 'Add a Claude API key in Settings' : status.aiEligible ? 'Find a solution with AI' : 'Available when there is no in-week solution'}
          style={{
            flex: '0 0 auto', padding: '8px 12px', borderRadius: 5, border: 'none', fontSize: 13, fontWeight: 600,
            cursor: aiEnabled ? 'pointer' : 'not-allowed',
            background: aiEnabled ? '#6366f1' : '#e5e7eb',
            color: aiEnabled ? 'white' : '#9ca3af',
          }}
        >{aiLoading ? '…' : 'AI'}</button>
        {status.grade !== 'green' && (
          <button
            onClick={onSaveAnyway}
            style={{
              flex: '0 0 auto', padding: '8px 12px', borderRadius: 5, fontSize: 13, fontWeight: 600,
              background: 'white', color: '#b45309', border: '1px solid #fcd34d', cursor: 'pointer',
            }}
          >Save anyway</button>
        )}
        {canLogGhosts && (
          <button
            onClick={onLogGhosts}
            title="Keep the requested session as a ghost reminder"
            style={{
              flex: '0 0 auto', padding: '8px 12px', borderRadius: 5, fontSize: 13,
              background: 'white', color: '#6b7280', border: '1px solid #d1d5db', cursor: 'pointer',
            }}
          >Log as ghost</button>
        )}
        <button
          onClick={onResetAll}
          style={{
            flex: '0 0 auto', padding: '8px 12px', borderRadius: 5, fontSize: 13,
            background: 'white', color: '#6b7280', border: '1px solid #d1d5db', cursor: 'pointer',
          }}
        >Reset</button>
        <button
          onClick={onCancel}
          style={{
            flex: '0 0 auto', padding: '8px 12px', borderRadius: 5, fontSize: 13,
            background: 'white', color: '#6b7280', border: '1px solid #d1d5db', cursor: 'pointer',
          }}
        >Cancel</button>
      </div>
    </div>
  );
}
