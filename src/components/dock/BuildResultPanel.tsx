import { bindingConstraintLabel, type BuildResult } from '../../scheduleBuilder';

/**
 * BuildResultPanel — the readout after a one-tap build: what the deterministic
 * builder placed (direct + supervision metrics) and, honestly, which cases it
 * COULDN'T fully fill or supervise and why (blocks). The proposed sessions
 * themselves preview in the draft tray/calendar above; this panel is the "did it
 * work, and where are the walls" summary so the BCBA never has to guess what the
 * engine gave up on.
 */
interface BuildResultPanelProps {
  result: BuildResult;
  /** Whether the build actually staged sessions into the draft tray. When false
   *  (everything blocked, or nothing to place) there is no tray to review. */
  hasStagedProposal: boolean;
  onDismiss: () => void;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function BuildResultPanel({ result, hasStagedProposal, onDismiss }: BuildResultPanelProps) {
  const { metrics, blocks } = result;
  const nextStep = hasStagedProposal
    ? 'Review the proposal in the tray, then Accept.'
    : blocks.length > 0
      ? 'Nothing could be placed — see the blocks below.'
      : 'Nothing to place — everything is already at target.';

  return (
    <section aria-label="Build result" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', color: 'var(--sage-700)' }}>
          Build result
        </span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss build result"
          style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 16, lineHeight: 1 }}
        >
          ✕
        </button>
      </header>

      <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
        {metrics.directBuilt && (
          <div>
            Placed <strong style={{ color: 'var(--text-primary)' }}>{round1(metrics.directHrsPlaced)}h</strong> of direct ·{' '}
            <strong style={{ color: 'var(--text-primary)' }}>{metrics.casesFullyStaffed}/{metrics.totalCases}</strong> cases fully staffed.
          </div>
        )}
        {metrics.supervisionBuilt && (
          <div>
            Placed <strong style={{ color: 'var(--text-primary)' }}>{round1(metrics.supervisionHrsPlaced)}h</strong> of supervision ·{' '}
            <strong style={{ color: 'var(--text-primary)' }}>{metrics.casesMeetingFloor}/{metrics.floorTargetCases}</strong> cases at floor
            {metrics.rbtFloorTargets > 0 && (
              <> · <strong style={{ color: 'var(--text-primary)' }}>{metrics.rbtsMeetingFloor}/{metrics.rbtFloorTargets}</strong> RBTs at floor</>
            )}.
          </div>
        )}
        {metrics.ptBuilt && (
          <div>
            Placed <strong style={{ color: 'var(--text-primary)' }}>{round1(metrics.ptHrsPlaced)}h</strong> of parent training ·{' '}
            <strong style={{ color: 'var(--text-primary)' }}>{metrics.casesMeetingPtGoal}/{metrics.ptTargetCases}</strong> cases at goal.
          </div>
        )}
        <div style={{ marginTop: 2 }}>{nextStep}</div>
      </div>

      {blocks.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--amber-700, #b45309)' }}>
            Couldn’t fully resolve {blocks.length} case{blocks.length === 1 ? '' : 's'}:
          </div>
          {blocks.map(b => {
            const isSup = b.bindingConstraint === 'bcba-availability';
            const isPt = b.bindingConstraint === 'pt-availability';
            const gap = isSup ? b.supervisionGapRemaining ?? 0
              : isPt ? b.ptGapRemaining ?? 0
              : b.directGapRemaining;
            const shortLabel = isSup ? 'supervision short' : isPt ? 'parent training short' : 'short';
            return (
              <div
                key={`${b.clientId}:${b.bindingConstraint}`}
                style={{
                  fontSize: 12, color: 'var(--text-body)', background: 'var(--sage-50)',
                  border: '1px solid var(--sage-100)', borderRadius: 8, padding: '6px 9px',
                }}
              >
                <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <strong style={{ color: 'var(--text-primary)' }}>{b.clientName}</strong>
                  <span style={{ fontSize: 11, color: 'var(--sage-700)' }}>{bindingConstraintLabel(b.bindingConstraint)}</span>
                  {gap > 0 && (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>· {round1(gap)}h {shortLabel}</span>
                  )}
                </div>
                {b.detail && <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--text-secondary)' }}>{b.detail}</div>}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
