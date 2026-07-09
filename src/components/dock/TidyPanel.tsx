import type { WishOp } from '../../types';
import type { TidyResult, TidyRuleId, TidySuggestion } from '../../tidy';

/**
 * TidyPanel — the readout after a one-tap "Tidy schedule": a semantic-equivalence
 * badge for the auto cleanups (which preview in the draft tray/calendar above) and
 * a review list of everything the pass would NOT change silently — duplicates
 * (they'd shift double-counted hours), a detected recurring series to group, odd
 * timestamps to snap, and double-book / near-adjacent flags. Each review item the
 * user can Apply on its own; flags carry no ops (resolve them via Fix It / by hand).
 */
interface TidyPanelProps {
  result: TidyResult;
  onApplySuggestion: (ops: WishOp[]) => void;
  onDismiss: () => void;
}

const RULE_LABEL: Record<TidyRuleId, string> = {
  merge: 'Merge',
  degenerate: 'Degenerate',
  dedup: 'Duplicate',
  grouping: 'Series',
  seriesConsolidate: 'Split series',
  snap: 'Snap',
  doubleBook: 'Conflict',
};

export function TidyPanel({ result, onApplySuggestion, onDismiss }: TidyPanelProps) {
  const { metrics, equivalence, suggestions } = result;
  const autoCount = metrics.autoOpCount;

  // The badge reflects the AUTO set: green when verified equivalent, red when the
  // combined-set gate refused to stage it (an emitter bug can't slip through).
  const badge = autoCount > 0
    ? { text: `✓ ${autoCount} auto cleanup${autoCount === 1 ? '' : 's'} — verified equivalent`, bg: 'var(--sage-100)', fg: 'var(--sage-700)' }
    : !equivalence.equivalent
      ? { text: '⚠ auto tidy blocked — not equivalent', bg: 'var(--amber-100, #fef3c7)', fg: 'var(--amber-700, #b45309)' }
      : null;

  const cardStyle = {
    display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--text-body)',
    background: 'var(--sage-50)', border: '1px solid var(--sage-100)', borderRadius: 8, padding: '7px 9px',
  } as const;

  return (
    <section aria-label="Tidy result" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', color: 'var(--sage-700)' }}>
          Tidy
        </span>
        {badge && (
          <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: badge.bg, color: badge.fg }}>
            {badge.text}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss tidy result"
          style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 16, lineHeight: 1 }}
        >
          ✕
        </button>
      </header>

      <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>
        Scanned <strong style={{ color: 'var(--text-primary)' }}>{metrics.scanned}</strong> pending session{metrics.scanned === 1 ? '' : 's'}.
        {autoCount > 0 && <> Review the staged cleanups in the tray, then Accept.</>}
        {autoCount === 0 && suggestions.length === 0 && <> Nothing to tidy — the schedule is already clean.</>}
      </div>

      {suggestions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>
            {suggestions.length} to review (not applied automatically):
          </div>
          {suggestions.map((s: TidySuggestion, i) => (
            <div key={i} style={cardStyle}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)', color: 'var(--sage-700)' }}>
                  {RULE_LABEL[s.ruleId]}
                </span>
                {s.metricDelta && (
                  <span style={{ fontSize: 10.5, fontWeight: 600, padding: '1px 6px', borderRadius: 999, background: 'var(--amber-100, #fef3c7)', color: 'var(--amber-700, #b45309)' }}>
                    {s.metricDelta}
                  </span>
                )}
                <span style={{ flex: 1 }} />
                {s.ops.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onApplySuggestion(s.ops)}
                    style={{ border: '1px solid var(--sage-300, var(--sage-200))', background: 'var(--surface, #fff)', color: 'var(--sage-700)', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 'var(--radius-sm, 6px)', cursor: 'pointer' }}
                  >
                    Apply
                  </button>
                )}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>{s.rationale}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
