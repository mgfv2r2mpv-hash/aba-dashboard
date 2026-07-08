// The teach loop's confirmation chip: a detected correction pattern becomes a
// one-tap durable hint ("Remember for AB: prefer midday supervision"). Never
// silent — the owner is always the teacher. Stacks above the CommitToast so a
// commit receipt and a capture offer can coexist after an Accept.

import { HintSignal } from '../hintCapture';

interface CaptureChipProps {
  signal: HintSignal;
  /** How many more offers are queued behind this one. */
  remaining: number;
  onRemember: (signal: HintSignal) => void;
  onDismiss: () => void;
  compact: boolean;
}

export default function CaptureChip({ signal, remaining, onRemember, onDismiss, compact }: CaptureChipProps) {
  const verb = signal.kind === 'unsplit' ? 'Update' : 'Remember for';
  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        left: '50%',
        transform: 'translateX(-50%)',
        bottom: `calc(env(safe-area-inset-bottom, 0px) + ${compact ? 132 : 76}px)`,
        zIndex: 1200,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        maxWidth: 'min(92vw, 520px)',
        background: 'var(--sage-700, #3f4f43)',
        color: 'white',
        borderRadius: 10,
        padding: '10px 14px',
        boxShadow: '0 6px 24px rgba(0,0,0,0.25)',
        fontSize: 13,
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        💡 {verb} {signal.clientName}: {signal.detail}?
        {remaining > 0 && <span style={{ opacity: 0.7 }}> (+{remaining} more)</span>}
      </span>
      <button
        type="button"
        onClick={() => onRemember(signal)}
        style={{
          border: 'none', background: 'rgba(255,255,255,0.16)', color: 'white', fontWeight: 800,
          fontSize: 12.5, cursor: 'pointer', padding: '4px 10px', borderRadius: 6, flexShrink: 0,
        }}
      >
        {signal.kind === 'unsplit' ? 'Drop it' : 'Remember'}
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Not this time"
        title="Not this time"
        style={{
          border: 'none', background: 'none', color: 'rgba(255,255,255,0.6)',
          fontSize: 15, cursor: 'pointer', padding: 2, lineHeight: 1, flexShrink: 0,
        }}
      >
        ✕
      </button>
    </div>
  );
}
