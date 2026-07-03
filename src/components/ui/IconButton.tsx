import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react';

/**
 * IconButton — a square, label-less control carrying a single emoji/glyph
 * (nav arrows, close, scroll-to-top). Always pass `label` for the accessible
 * name. Ghost by default; hover tints one step.
 */
export type IconButtonVariant = 'ghost' | 'sage' | 'danger';
export type IconButtonSize = 'sm' | 'md' | 'lg';

const HOVER_BG: Record<IconButtonVariant, string> = {
  ghost: 'var(--slate-100)',
  sage: 'var(--sage-100)',
  danger: 'var(--red-100)',
};

const DIM: Record<IconButtonSize, number> = { sm: 28, md: 32, lg: 40 };

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  icon: ReactNode;
  /** Accessible name — required (the button has no visible text). */
  label: string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
}

export function IconButton({
  icon,
  label,
  variant = 'ghost',
  size = 'md',
  disabled = false,
  onClick,
  style,
  ...rest
}: IconButtonProps) {
  const [hover, setHover] = useState(false);
  const dim = DIM[size] ?? DIM.md;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: dim,
        height: dim,
        flexShrink: 0,
        border: 'none',
        borderRadius: 'var(--radius-md)',
        background: hover && !disabled ? HOVER_BG[variant] : 'transparent',
        color: 'var(--slate-500)',
        fontSize: Math.round(dim * 0.47),
        lineHeight: 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background-color var(--duration-fast) var(--ease-standard)',
        ...style,
      }}
      {...rest}
    >
      <span aria-hidden="true">{icon}</span>
    </button>
  );
}
