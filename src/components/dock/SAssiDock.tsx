import { useState, useEffect, type ReactNode } from 'react';
import { AssistantDock } from '../shell';
import type { WishSolution, ScheduleData, CompanySettings } from '../../types';
import { wishSolutionToDraft, computeSolutionImpact } from '../../wish';
import { solveDraft } from '../../draftSolver';
import { IssueCard } from './IssueCard';
import { SolutionCard } from './SolutionCard';
import { SassiChat } from './SassiChat';
import type { SassiSession } from './sassiSession';
import type { ClaudeModel } from '../../claudeScheduler';
import { useIssueQueue, type DockIssue } from './dockIssues';

/** Multi-turn chat wiring folded into the dock (the "sAssI" conversational mode). */
export interface SassiChatBits {
  session: SassiSession;
  model: ClaudeModel;
  onToggleModel: () => void;
}

/** Context needed to badge solution cards with a feasibility grade + impact. */
export interface DockGraderCtx {
  data: ScheduleData;
  settings: CompanySettings;
  now: Date;
}

/** A pre-seeded, case-scoped "Fix pace with SAssi" request. Bump `token` to
 *  (re)trigger the solve — the dock resolves it and shows the solution cards. */
export interface MeetPaceSeed {
  clientId: string;
  label: string;
  token: number;
}

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
  /** Route the dock's freeform input into the sAssI conversation. */
  onAsk?: (text: string) => void;
  /** Multi-turn chat state; when active, the chat surface replaces the freeform thread. */
  chat?: SassiChatBits;
  onAcceptWish: (sol: WishSolution) => void;
  onCustomizeWish: (sol: WishSolution) => void;
  /** Case-scoped meet-pace request seeded from a Home card / issue CTA. */
  seedRequest?: MeetPaceSeed | null;
  /** Resolves a seeded meet-pace request into solution cards (deterministic +
   *  optional Claude variants). Required for `seedRequest` to do anything. */
  onSeedResolve?: (clientId: string) => Promise<WishSolution[]>;
  /** When present, solution cards show a green/yellow/red grade + impact. */
  graderCtx?: DockGraderCtx;
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
  onAsk,
  chat,
  onAcceptWish,
  onCustomizeWish,
  seedRequest,
  onSeedResolve,
  graderCtx,
  variant = 'column',
  contextTop,
  selected,
}: SAssiDockProps) {
  const queue = useIssueQueue(issues);
  // `wish` now backs only the seeded "Fix pace" quick-solve; the freeform input
  // opens the multi-turn sAssI conversation instead (see `chat`).
  const [wish, setWish] = useState<WishState>({ status: 'idle' });

  // A seeded "Fix pace with SAssi" request (token bumped on each tap) resolves
  // through the single-shot WishThread surface.
  const seedToken = seedRequest?.token;
  useEffect(() => {
    if (!seedRequest || !onSeedResolve) return;
    let cancelled = false;
    setWish({ status: 'loading', note: seedRequest.label });
    onSeedResolve(seedRequest.clientId)
      .then(solutions => { if (!cancelled) setWish({ status: 'done', note: seedRequest.label, solutions }); })
      .catch((e: any) => { if (!cancelled) setWish({ status: 'error', note: seedRequest.label, message: e?.message || String(e) }); });
    return () => { cancelled = true; };
    // Re-run only when a new request token arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedToken]);

  const hasWish = wish.status !== 'idle';
  const chatActive = !!chat && chat.session.active;
  const body =
    contextTop || chatActive || hasWish || queue.current ? (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {contextTop}
        {chatActive && (
          <SassiChat session={chat!.session} model={chat!.model} onToggleModel={chat!.onToggleModel} />
        )}
        {wish.status !== 'idle' && (
          <WishThread
            wish={wish}
            graderCtx={graderCtx}
            onAccept={onAcceptWish}
            onCustomize={onCustomizeWish}
            onClear={() => setWish({ status: 'idle' })}
          />
        )}
        {queue.current && (
          <IssueCard
            issue={queue.current}
            remaining={queue.remaining}
            position={queue.position}
            hasPrev={queue.hasPrev}
            hasNext={queue.hasNext}
            onPrev={queue.prev}
            onNext={queue.next}
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
      onWish={(text) => onAsk?.(text)}
      wishDisabled={!aiEnabled}
      wishPlaceholder={aiEnabled ? 'Ask sAssI… e.g. “fill my week to 25 hours”' : 'Add a Claude API key in Settings to ask sAssI'}
    >
      {body}
    </AssistantDock>
  );
}

function WishThread({
  wish,
  graderCtx,
  onAccept,
  onCustomize,
  onClear,
}: {
  wish: Exclude<WishState, { status: 'idle' }>;
  graderCtx?: DockGraderCtx;
  onAccept: (sol: WishSolution) => void;
  onCustomize: (sol: WishSolution) => void;
  onClear: () => void;
}) {
  // Grade + impact are best-effort: a solver hiccup on one card must not blank
  // the whole thread, so each computation is guarded.
  const gradeImpact = (sol: WishSolution) => {
    if (!graderCtx) return {};
    try {
      const { ops } = wishSolutionToDraft(sol, graderCtx.data);
      const grade = solveDraft(graderCtx.data, ops, graderCtx.now, graderCtx.settings).grade;
      const impact = computeSolutionImpact(graderCtx.data, sol);
      return { grade, impact };
    } catch {
      return {};
    }
  };
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
        wish.solutions.map((s, i) => {
          const { grade, impact } = gradeImpact(s);
          return (
            <SolutionCard key={s.id} solution={s} index={i} grade={grade} impact={impact} onAccept={onAccept} onCustomize={onCustomize} />
          );
        })}
    </section>
  );
}
