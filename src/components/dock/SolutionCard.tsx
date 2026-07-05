import { Button } from '../ui';
import type { WishOp, WishSolution } from '../../types';
import type { DraftGrade } from '../../draftSolver';
import type { SolutionImpact } from '../../wish';

/**
 * SolutionCard — a single "propose something new" result from Ask SAssi. Shows
 * the summary, reasoning, and the concrete ops, then propose→confirm actions:
 * Accept commits, Customize loads it into the editable draft first. When the
 * dock supplies a grade + impact (Phase 2 meet-pace), it also badges the
 * green/yellow/red feasibility and the projected utilization change.
 */
export interface SolutionCardProps {
  solution: WishSolution;
  index: number;
  onAccept: (sol: WishSolution) => void;
  onCustomize: (sol: WishSolution) => void;
  /** Optional feasibility grade from solveDraft (green/yellow/red). */
  grade?: DraftGrade;
  /** Optional before→after compliance impact from computeSolutionImpact. */
  impact?: SolutionImpact;
}

const GRADE_STYLE: Record<DraftGrade, { label: string; bg: string; fg: string }> = {
  green: { label: 'Fits', bg: 'var(--status-met-bg, #dcfce7)', fg: 'var(--status-met, #15803d)' },
  yellow: { label: 'Needs a pick', bg: 'var(--amber-50, #fef9c3)', fg: 'var(--amber-700, #a16207)' },
  red: { label: 'Conflicts', bg: 'var(--status-over-bg, #fee2e2)', fg: 'var(--status-over, #b91c1c)' },
};

// One terse before→after line per meaningfully changed case (supervision %).
function impactLines(impact: SolutionImpact): string[] {
  return impact.clientImpacts
    .slice(0, 2)
    .map(ci => `${ci.client.name}: ${Math.round(ci.beforePct)}% → ${Math.round(ci.afterPct)}% supervision (${ci.deltaPct >= 0 ? '+' : ''}${ci.deltaPct.toFixed(0)}pp)`);
}

function opText(o: WishOp): string {
  const t = (iso: string) => {
    const d = new Date(iso);
    return isNaN(d.getTime())
      ? iso
      : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  };
  switch (o.op) {
    case 'move':
      return `Move ${o.appointmentId.slice(0, 6)} → ${t(o.start)}–${t(o.end)}`;
    case 'remove':
      return `Remove ${o.appointmentId.slice(0, 6)}`;
    case 'add':
      return `Add ${o.title || o.type}${o.client ? ` for ${o.client}` : ''} ${t(o.start)}${o.recurring ? ` (${o.pattern || 'weekly'})` : ''}`;
    case 'blackout':
      return `Block ${o.entity} on ${o.date}${o.reason ? ` — ${o.reason}` : ''}`;
  }
}

export function SolutionCard({ solution, index, onAccept, onCustomize, grade, impact }: SolutionCardProps) {
  const gradeStyle = grade ? GRADE_STYLE[grade] : null;
  const lines = impact ? impactLines(impact) : [];
  return (
    <div
      style={{
        border: '1px solid var(--sage-200)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--white)',
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <div style={{ flex: 1, fontSize: 13.5, fontWeight: 800, color: 'var(--text-primary)' }}>
          Option {index + 1}: {solution.summary}
        </div>
        {gradeStyle && (
          <span style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 800, color: gradeStyle.fg, background: gradeStyle.bg, borderRadius: 'var(--radius-sm)', padding: '1px 6px' }}>
            {gradeStyle.label}
          </span>
        )}
      </div>
      {lines.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {lines.map((l, i) => (
            <div key={i} style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--sage-700)' }}>{l}</div>
          ))}
        </div>
      )}
      {solution.reasoning && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          {solution.reasoning}
        </div>
      )}
      {solution.ops.length > 0 && (
        <ul style={{ margin: '2px 0 0', paddingLeft: 16, fontSize: 12, color: 'var(--text-secondary)' }}>
          {solution.ops.map((o, j) => (
            <li key={j}>{opText(o)}</li>
          ))}
        </ul>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
        <Button variant="primary" size="sm" onClick={() => onAccept(solution)}>
          Accept
        </Button>
        <Button variant="secondary" size="sm" onClick={() => onCustomize(solution)}>
          Customize &amp; accept
        </Button>
      </div>
    </div>
  );
}
