import { Enso, SAssiWord } from './SAssiMark';

/**
 * DockChip — the collapsed SAssi dock at tablet-portrait width. It sits as the
 * merged right cell beside the CommandBar + ZenStrip rows (see app shell), so the
 * ensō + wordmark stay visible while the calendar reclaims full width. Tapping it
 * rolls the full dock open (DockOverlay).
 */
export interface DockChipProps {
  issueCount: number;
  onOpen: () => void;
  /** id of the overlay this chip controls, for aria-controls. */
  controlsId?: string;
}

export function DockChip({ issueCount, onOpen, controlsId }: DockChipProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={issueCount > 0 ? `Open SAssi — ${issueCount} open items` : 'Open SAssi'}
      aria-expanded={false}
      aria-controls={controlsId}
      style={{
        alignSelf: 'stretch',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        minWidth: 44,
        minHeight: 44,
        padding: 'calc(env(safe-area-inset-top) + 10px) 16px 10px',
        border: 'none',
        borderLeft: '1px solid var(--sage-200)',
        background: 'var(--white)',
        cursor: 'pointer',
        fontFamily: 'var(--font-sans)',
        textAlign: 'left',
      }}
    >
      <Enso count={issueCount} size={30} />
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)' }}>
          <SAssiWord ai={issueCount > 0} />
        </span>
        <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>
          {issueCount > 0 ? `${issueCount} open` : 'All clear'}
        </span>
      </span>
    </button>
  );
}
