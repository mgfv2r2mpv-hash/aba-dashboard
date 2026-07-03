import { Button } from '../ui';
import type { WishOp, WishSolution } from '../../types';

/**
 * SolutionCard — a single "propose something new" result from Ask SAssi. Shows
 * the summary, reasoning, and the concrete ops, then propose→confirm actions:
 * Accept commits, Customize loads it into the editable draft first.
 */
export interface SolutionCardProps {
  solution: WishSolution;
  index: number;
  onAccept: (sol: WishSolution) => void;
  onCustomize: (sol: WishSolution) => void;
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

export function SolutionCard({ solution, index, onAccept, onCustomize }: SolutionCardProps) {
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
      <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--text-primary)' }}>
        Option {index + 1}: {solution.summary}
      </div>
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
