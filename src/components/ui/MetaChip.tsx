import type { CSSProperties, ReactNode } from 'react';

/**
 * MetaChip — a small inline meta pair: a leading emoji/glyph + text, used for
 * detail meta (🦸 client, 🧑‍⚕️ technician, 🕐 date · time). Sunken chip fill,
 * single-line. One glyph per chip.
 */
export interface MetaChipProps {
  icon?: ReactNode;
  children: ReactNode;
  /** Tint the chip (bg + fg). Defaults to the neutral sunken chip. */
  bg?: string;
  fg?: string;
  style?: CSSProperties;
}

export function MetaChip({ icon, children, bg = 'var(--surface-sunken)', fg = 'var(--text-muted)', style }: MetaChipProps) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        maxWidth: '100%',
        padding: '3px 8px',
        fontSize: 'var(--text-xs)',
        fontFamily: 'var(--font-sans)',
        fontWeight: 'var(--weight-semibold)',
        lineHeight: 1.2,
        color: fg,
        background: bg,
        borderRadius: 'var(--radius-sm)',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        ...style,
      }}
    >
      {icon != null && <span aria-hidden="true">{icon}</span>}
      {children}
    </span>
  );
}
