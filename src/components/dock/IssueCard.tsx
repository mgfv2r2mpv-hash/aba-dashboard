import { Button, StatusPill } from '../ui';
import type { PillIntent } from '../ui/StatusPill';
import type { DockIssue } from './dockIssues';

/**
 * IssueCard — the single dock issue on show. Kind pill + title + plain-language
 * detail, then the affordances: a fix path (review in place for a conflict; a
 * CASE-SCOPED "Fix pace with SAssi" on per-client compliance cards; "Open
 * compliance" navigation on the aggregate tail) and "Not now" to cycle. A
 * footer counts what's queued behind it.
 */
export interface IssueCardProps {
  issue: DockIssue;
  /** Total items in the rotation, including this one. */
  remaining: number;
  /** 1-based position of this card in the rotation, for the pager. */
  position: number;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onReviewConflict: (issue: DockIssue) => void;
  onMuteConflict: (issue: DockIssue) => void;
  onFixCompliance: () => void;
  /** Case-scoped fix — seeds the meet-pace solve for issue.clientId. */
  onFixPace?: (clientId: string) => void;
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
  position,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onReviewConflict,
  onMuteConflict,
  onFixCompliance,
  onFixPace,
  onNotNow,
}: IssueCardProps) {
  const isConflict = issue.kind === 'conflict';
  const caseScoped = !isConflict && !!issue.clientId && !!onFixPace;

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
        ) : caseScoped ? (
          <Button variant="sassi" size="sm" onClick={() => onFixPace!(issue.clientId!)}>
            Fix pace with SAssi
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={onFixCompliance}>
            Open compliance
          </Button>
        )}
        {remaining > 1 && (
          <Button variant="ghost" size="sm" onClick={onNotNow}>
            Not now
          </Button>
        )}
      </div>

      {remaining > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--text-muted)', fontWeight: 700 }}>
          <button type="button" onClick={onPrev} disabled={!hasPrev} aria-label="Previous item" style={pagerBtnStyle(hasPrev)}>‹</button>
          <span>{position} of {remaining}</span>
          <button type="button" onClick={onNext} disabled={!hasNext} aria-label="Next item" style={pagerBtnStyle(hasNext)}>›</button>
          <span style={{ flex: 1 }} />
          <span style={{ fontWeight: 600 }}>browse — no change</span>
        </div>
      )}
    </div>
  );
}

// Chevron pager button — subtle, disabled at the ends. Browsing never mutates the
// queue, so these are visually quieter than the action buttons above.
function pagerBtnStyle(enabled: boolean) {
  return {
    border: '1px solid var(--sage-200)',
    background: enabled ? 'var(--white)' : 'transparent',
    color: enabled ? 'var(--text-secondary)' : 'var(--text-muted)',
    borderRadius: 6, width: 26, height: 26, padding: 0, lineHeight: 1, fontSize: 15, fontWeight: 800,
    cursor: enabled ? 'pointer' : 'default', opacity: enabled ? 1 : 0.4,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  } as const;
}
