// A small floating affordance shown over a calendar grid while it is pinch-zoomed.
// Shows the current zoom level and resets to 1× on tap (mirrors the three-finger
// reset gesture for users who'd rather tap).

import React from 'react';

interface ZoomResetPillProps {
  scale: number;
  onReset: () => void;
}

export default function ZoomResetPill({ scale, onReset }: ZoomResetPillProps) {
  return (
    <button
      type="button"
      onClick={onReset}
      style={{
        position: 'fixed',
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1600,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '8px 14px',
        borderRadius: 999,
        border: 'none',
        background: 'rgba(31,41,55,0.92)',
        color: 'white',
        fontSize: 13,
        fontWeight: 600,
        cursor: 'pointer',
        boxShadow: '0 4px 16px rgba(0,0,0,0.28)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
      }}
    >
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{Math.round(scale * 100)}%</span>
      <span style={{ opacity: 0.7 }}>·</span>
      <span>Reset zoom</span>
    </button>
  );
}
