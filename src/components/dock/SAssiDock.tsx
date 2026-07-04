import { useState, type ReactNode } from 'react';
import { AssistantDock } from '../shell';
import type { WishSolution } from '../../types';
import { IssueCard } from './IssueCard';
import { SolutionCard } from './SolutionCard';
import { useIssueQueue, type DockIssue } from './dockIssues';

/**
 * SAssiDock — the unified assistant surface. It folds the old Fix It (issue
 * remediation) and Wish It (propose something new) into one always-on dock:
 * a one-at-a-time issue queue with cycling, plus an "Ask SAssi…" thread that
 * turns a freeform wish into propose→confirm solution cards.
 */
export interface SAssiDockProps {
  issues: DockIssue[];
  /** Ensō/badge count — the granular open-item total (may exceed queue cards). */
  issueCount: number;
  aiEnabled: boolean;
  onReviewConflict: (issue: DockIssue) => void;
  onMuteConflict: (issue: DockIssue) => void;
  onFixCompliance: () => void;
  onGenerateWish: (note: string) => Promise<WishSolution[]>;
  onAcceptWish: (sol: WishSolution) => void;
  onCustomizeWish: (sol: WishSolution) => void;
  /** `column` = wide always-on rail; `sheet` = narrow slide-up. */
  variant?: 'column' | 'sheet';
  /**
   * Schedule-view context folded into the dock body atop the wish/issue queue:
   * hours totals, the draft tray, and draft-AI options. Undefined on other views.
   */
  contextTop?: ReactNode;
  /**
   * Selected-appointment detail/edit card, shown in the dock's pinned `selected`
   * slot above the body (column layouts only — the phone keeps its own sheet).
   */
  selected?: ReactNode;
}

type WishState =
  | { status: 'idle' }
  | { status: 'loading'; note: string }
  | { status: 'done'; note: string; solutions: WishSolution[] }
  | { status: 'error'; note: string; message: string };

export function SAssiDock({
  issues,
  issueCount,
  aiEnabled,
  onReviewConflict,
  onMuteConflict,
  onFixCompliance,
  onGenerateWish,
  onAcceptWish,
  onCustomizeWish,
  variant = 'column',
  contextTop,
  selected,
}: SAssiDockProps) {
  const queue = useIssueQueue(issues);
  const [wish, setWish] = useState<WishState>({ status: 'idle' });

  const handleWish = async (note: string) => {
    setWish({ status: 'loading', note });
    try {
      const solutions = await onGenerateWish(note);
      setWish({ status: 'done', note, solutions });
    } catch (e: any) {
      setWish({ status: 'error', note, message: e?.message || String(e) });
    }
  };

  const hasWish = wish.status !== 'idle';
  const body =
    contextTop || hasWish || queue.current ? (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {contextTop}
        {wish.status !== 'idle' && (
          <WishThread
            wish={wish}
            onAccept={onAcceptWish}
            onCustomize={onCustomizeWish}
            onClear={() => setWish({ status: 'idle' })}
          />
        )}
        {queue.current && (
          <IssueCard
            issue={queue.current}
            remaining={queue.remaining}
            onReviewConflict={onReviewConflict}
            onMuteConflict={onMuteConflict}
            onFixCompliance={onFixCompliance}
            onNotNow={queue.notNow}
          />
        )}
      </div>
    ) : undefined;

  return (
    <AssistantDock
      issueCount={issueCount}
      variant={variant}
      selected={selected}
      onWish={handleWish}
      wishDisabled={!aiEnabled}
      wishPlaceholder={aiEnabled ? undefined : 'Add a Claude API key in Settings to ask SAssi'}
    >
      {body}
    </AssistantDock>
  );
}

function WishThread({
  wish,
  onAccept,
  onCustomize,
  onClear,
}: {
  wish: Exclude<WishState, { status: 'idle' }>;
  onAccept: (sol: WishSolution) => void;
  onCustomize: (sol: WishSolution) => void;
  onClear: () => void;
}) {
  return (
    <section aria-label="Ask SAssi results" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: 'var(--tracking-wide)',
            color: 'var(--sage-700)',
          }}
        >
          Ask SAssi
        </span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear results"
          style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 16, lineHeight: 1 }}
        >
          ✕
        </button>
      </header>
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>“{wish.note}”</div>

      {wish.status === 'loading' && (
        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>SAssi is thinking…</div>
      )}
      {wish.status === 'error' && (
        <div style={{ fontSize: 12.5, color: 'var(--red-700)' }}>{wish.message}</div>
      )}
      {wish.status === 'done' && wish.solutions.length === 0 && (
        <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
          No options found. Try describing it differently, or narrow the window.
        </div>
      )}
      {wish.status === 'done' &&
        wish.solutions.map((s, i) => (
          <SolutionCard key={s.id} solution={s} index={i} onAccept={onAccept} onCustomize={onCustomize} />
        ))}
    </section>
  );
}
