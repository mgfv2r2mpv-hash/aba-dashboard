import { Button, StatusPill } from '../ui';
import type { PillIntent } from '../ui/StatusPill';
import type { DockIssue } from './dockIssues';

/**
 * IssueCard — the single dock issue on show. Kind pill + title + plain-language
 * detail, then the affordances: a fix path (review in place for a conflict, or
 * hand off to SAssi for compliance) and "Not now" to cycle. A footer counts
 * what's queued behind it.
 */
export interface IssueCardProps {
  issue: DockIssue;
  /** Total items in the rotation, including this one. */
  remaining: number;
  onReviewConflict: (issue: DockIssue) => void;
  onMuteConflict: (issue: DockIssue) => void;
  onFixCompliance: () => void;
  onNotNow: () => void;
}

const SEVERITY_INTENT: Record<DockIssue['severity'], PillIntent> = {
  error: 'danger',
  warning: 'warning',
  info: 'info',
};

export function IssueCard({
  issue,
  remaining,
  onReviewConflict,
  onMuteConflict,
  onFixCompliance,
  onNotNow,
}: IssueCardProps) {
  const behind = remaining - 1;
  const isConflict = issue.kind === 'conflict';

  return (
    <div
      style={{
        border: '1px solid var(--sage-200)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--white)',
        boxShadow: 'var(--shadow-sm)',
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <StatusPill intent={SEVERITY_INTENT[issue.severity]}>
          {isConflict ? 'Conflict' : 'Compliance'}
        </StatusPill>
        <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)' }}>
          {issue.title}
        </span>
      </div>

      <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: 'var(--text-secondary)' }}>
        {issue.detail}
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {isConflict ? (
          <>
            <Button variant="fix" size="sm" onClick={() => onReviewConflict(issue)}>
              Review in place
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onMuteConflict(issue)}>
              Snooze
            </Button>
          </>
        ) : (
          <Button variant="sassi" size="sm" onClick={onFixCompliance}>
            Fix pace with SAssi
          </Button>
        )}
        {remaining > 1 && (
          <Button variant="ghost" size="sm" onClick={onNotNow}>
            Not now
          </Button>
        )}
      </div>

      {behind > 0 && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700 }}>
          {behind} more after this
        </div>
      )}
    </div>
  );
}
