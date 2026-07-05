import { bindingConstraintLabel, type BuildResult } from '../../scheduleBuilder';

/**
 * BuildResultPanel — the readout after a one-tap "Build direct schedule": what the
 * deterministic builder placed (metrics) and, honestly, which cases it COULDN'T
 * fully fill and why (blocks). The proposed sessions themselves preview in the
 * draft tray/calendar above; this panel is the "did it work, and where are the
 * walls" summary so the BCBA never has to guess what the engine gave up on.
 */
interface BuildResultPanelProps {
  result: BuildResult;
  /** Whether the build actually staged sessions into the draft tray. When false
   *  (everything blocked, or nothing to place) there is no tray to review. */
  hasStagedProposal: boolean;
  onDismiss: () => void;
}

export function BuildResultPanel({ result, hasStagedProposal, onDismiss }: BuildResultPanelProps) {
  const { metrics, blocks } = result;
  const placed = Math.round(metrics.directHrsPlaced * 10) / 10;
  const nextStep = hasStagedProposal
    ? 'Review the proposal in the tray, then Accept.'
    : blocks.length > 0
      ? 'No sessions could be placed — see the blocks below.'
      : 'Nothing to place — every case is already at its direct target.';

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
        Placed <strong style={{ color: 'var(--text-primary)' }}>{placed}h</strong> of direct ·{' '}
        <strong style={{ color: 'var(--text-primary)' }}>{metrics.casesFullyStaffed}/{metrics.totalCases}</strong> cases fully staffed.
        {' '}{nextStep}
      </div>

      {blocks.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--amber-700, #b45309)' }}>
            Couldn’t fully fill {blocks.length} case{blocks.length === 1 ? '' : 's'}:
          </div>
          {blocks.map(b => (
            <div
              key={b.clientId}
              style={{
                fontSize: 12, color: 'var(--text-body)', background: 'var(--sage-50)',
                border: '1px solid var(--sage-100)', borderRadius: 8, padding: '6px 9px',
              }}
            >
              <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <strong style={{ color: 'var(--text-primary)' }}>{b.clientName}</strong>
                <span style={{ fontSize: 11, color: 'var(--sage-700)' }}>{bindingConstraintLabel(b.bindingConstraint)}</span>
                {b.directGapRemaining > 0 && (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>· {Math.round(b.directGapRemaining * 10) / 10}h short</span>
                )}
              </div>
              {b.detail && <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--text-secondary)' }}>{b.detail}</div>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
