// Post-commit banner: "Saved — <label> · Undo". Floating bottom-center (NOT in
// the dock — the dock isn't mounted in all modes, and drag-commits happen with
// the phone sheet closed; a commit receipt must be visible wherever the gesture
// happened). While the entry is still the log head, Undo is a one-tap exact
// reversal; otherwise it stages the previewed undo (app.tsx undoFromToast).

interface CommitToastProps {
  label: string;
  onUndo: () => void;
  onDismiss: () => void;
  /** Lift above the bottom rail on phones. */
  compact: boolean;
}

export default function CommitToast({ label, onUndo, onDismiss, compact }: CommitToastProps) {
  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        left: '50%',
        transform: 'translateX(-50%)',
        bottom: `calc(env(safe-area-inset-bottom, 0px) + ${compact ? 76 : 20}px)`,
        zIndex: 1200,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        maxWidth: 'min(92vw, 480px)',
        background: 'var(--text-primary, #111827)',
        color: 'white',
        borderRadius: 10,
        padding: '10px 14px',
        boxShadow: '0 6px 24px rgba(0,0,0,0.25)',
        fontSize: 13,
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        Saved — {label}
      </span>
      <button
        type="button"
        onClick={onUndo}
        style={{
          border: 'none', background: 'none', color: '#93c5fd', fontWeight: 800,
          fontSize: 13, cursor: 'pointer', padding: '2px 4px', flexShrink: 0,
        }}
      >
        Undo
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
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
