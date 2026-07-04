import type { ReactNode } from 'react';
import { useReducedMotion } from '../../useMediaQuery';

/**
 * DockOverlay — the expanded SAssi dock at tablet-portrait width. It rolls open
 * over the right side of the app from the top-right (where the collapsed DockChip
 * sits) with a "scroll unfurl": a clip-path reveal that unrolls top→bottom like a
 * window shade. Kept mounted so it rolls back up on collapse. Respects
 * prefers-reduced-motion (instant show/hide). A transparent full-area catcher
 * behind the panel collapses it on outside-tap — no dimming scrim, so the calendar
 * stays visible beneath.
 */
export interface DockOverlayProps {
  open: boolean;
  onClose: () => void;
  /** id used by the DockChip's aria-controls. */
  id?: string;
  children: ReactNode;
}

export function DockOverlay({ open, onClose, id, children }: DockOverlayProps) {
  const reduce = useReducedMotion();
  return (
    <>
      {open && (
        <div
          onClick={onClose}
          aria-hidden="true"
          style={{ position: 'absolute', inset: 0, zIndex: 60, background: 'transparent' }}
        />
      )}
      <div
        id={id}
        role="region"
        aria-label="SAssi assistant"
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          height: '100%',
          width: 'var(--dock-width)',
          maxWidth: '92vw',
          zIndex: 70,
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--white)',
          boxShadow: 'var(--shadow-pop, -8px 0 28px rgba(0,0,0,0.18))',
          // Scroll-unfurl: the panel unrolls top→bottom like a shade.
          clipPath: open ? 'inset(0 0 0 0)' : 'inset(0 0 100% 0)',
          transition: reduce ? 'none' : 'clip-path var(--duration-slow, 0.34s) var(--ease-standard, cubic-bezier(0.4, 0, 0.2, 1))',
          pointerEvents: open ? 'auto' : 'none',
          overflow: 'hidden',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Collapse SAssi"
          style={{
            position: 'absolute',
            top: 'calc(env(safe-area-inset-top) + 12px)',
            right: 12,
            zIndex: 2,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            fontSize: 20,
            lineHeight: 1,
            color: 'var(--text-muted)',
            padding: 4,
          }}
        >
          ⌃
        </button>
        {children}
      </div>
    </>
  );
}
