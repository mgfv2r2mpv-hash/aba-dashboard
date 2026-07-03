import type { CSSProperties, ReactNode } from 'react';

/**
 * Card — the canonical surface. White fill, hairline border, 8px radius,
 * 12–16px padding; leans on the border more than shadow. Optional 4px coloured
 * left accent bar shows lifecycle/type (pass `accent` a colour token).
 */
export interface CardProps {
  children: ReactNode;
  /** Colour of the 4px left accent bar (e.g. 'var(--type-direct)'). Omit for none. */
  accent?: string;
  /** Raise with --shadow-md instead of the default resting border-only look. */
  elevated?: boolean;
  padding?: number | string;
  radius?: string;
  style?: CSSProperties;
  onClick?: () => void;
}

export function Card({
  children,
  accent,
  elevated = false,
  padding = 'var(--space-6)',
  radius = 'var(--radius-lg)',
  style,
  onClick,
}: CardProps) {
  return (
    <div
      onClick={onClick}
      style={{
        position: 'relative',
        background: 'var(--surface-card)',
        border: 'var(--border-hairline)',
        borderRadius: radius,
        boxShadow: elevated ? 'var(--shadow-md)' : 'none',
        padding,
        overflow: 'hidden',
        cursor: onClick ? 'pointer' : undefined,
        ...style,
      }}
    >
      {accent && (
        <span
          aria-hidden="true"
          style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, background: accent }}
        />
      )}
      {children}
    </div>
  );
}
