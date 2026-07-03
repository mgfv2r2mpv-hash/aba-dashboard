import { useState, type ReactNode } from 'react';
import { Button } from '../ui';
import { Enso, SAssiWord } from './SAssiMark';

/**
 * AssistantDock — the always-present SAssi surface. Header carries the live ensō
 * + wordmark; the body shows the current issue (one at a time) or a calm empty
 * state; a wish input is pinned at the bottom for "propose something new".
 *
 * M2 provides the shell + live identity + wish input. The one-issue-at-a-time
 * queue (apply / cycle / customize) is wired in M3 via the `children` body.
 */
export interface AssistantDockProps {
  /** Number of open issues — drives the ensō state and wordmark. */
  issueCount: number;
  /** The one-issue-at-a-time body (rendered by the queue in M3). */
  children?: ReactNode;
  /** A selected-appointment card slot, shown above the queue body. */
  selected?: ReactNode;
  onWish: (text: string) => void;
  wishPlaceholder?: string;
  wishDisabled?: boolean;
}

export function AssistantDock({
  issueCount,
  children,
  selected,
  onWish,
  wishPlaceholder = 'Ask SAssi… e.g. “free Jordan Friday PM”',
  wishDisabled = false,
}: AssistantDockProps) {
  const [wish, setWish] = useState('');
  const subtitle =
    issueCount === 0
      ? 'No open items.'
      : issueCount === 1
        ? '1 open item.'
        : `${issueCount} open items — shown one at a time.`;

  const submit = () => {
    const text = wish.trim();
    if (!text) return;
    onWish(text);
    setWish('');
  };

  return (
    <aside
      aria-label="SAssi assistant"
      style={{
        width: 'var(--dock-width)',
        flexShrink: 0,
        background: 'var(--white)',
        borderLeft: '1px solid var(--sage-200)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: 'calc(env(safe-area-inset-top) + 16px) 18px 16px',
          borderBottom: '1px solid var(--sage-100)',
        }}
      >
        <Enso count={issueCount} />
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>
            <SAssiWord ai={issueCount > 0} />
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{subtitle}</div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 18, minHeight: 0 }}>
        {selected}
        {children ?? (
          <div style={{ textAlign: 'center', padding: '26px 10px', color: 'var(--sage-700)' }}>
            <div style={{ fontSize: 14.5, fontWeight: 800 }}>No open items.</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.55 }}>
              No conflicts, no compliance flags. Hours are within targets.
            </div>
          </div>
        )}
      </div>

      <div style={{ padding: 14, borderTop: '1px solid var(--sage-100)' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={wish}
            disabled={wishDisabled}
            onChange={(e) => setWish(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
            placeholder={wishPlaceholder}
            aria-label="Ask SAssi"
            style={{
              flex: 1,
              minWidth: 0,
              padding: '9px 12px',
              fontSize: 13,
              fontFamily: 'var(--font-sans)',
              border: '1px solid var(--sage-200)',
              borderRadius: 'var(--radius-md)',
              outline: 'none',
              background: 'var(--sage-50)',
            }}
          />
          <Button variant="primary" size="sm" onClick={submit} disabled={wishDisabled}>
            Ask
          </Button>
        </div>
      </div>
    </aside>
  );
}
