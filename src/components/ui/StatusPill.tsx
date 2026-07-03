import type { CSSProperties, ReactNode } from 'react';

/**
 * StatusPill — uppercase, tracked, pill-shaped status label. Two families:
 * lifecycle (`scheduled | completed | canceled`) and compliance
 * (`behind | pace | met | over`), plus generic feedback intents. Pass an
 * explicit `intent` to select the colour pair.
 */
export type PillIntent =
  | 'scheduled'
  | 'completed'
  | 'canceled'
  | 'met'
  | 'pace'
  | 'behind'
  | 'over'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'neutral';

const INTENTS: Record<PillIntent, { fg: string; bg: string }> = {
  scheduled: { fg: 'var(--slate-700)', bg: 'var(--slate-100)' },
  completed: { fg: 'var(--green-800)', bg: 'var(--green-100)' },
  canceled: { fg: 'var(--red-700)', bg: 'var(--red-100)' },
  met: { fg: 'var(--status-met)', bg: 'var(--status-met-bg)' },
  pace: { fg: 'var(--status-pace)', bg: 'var(--status-pace-bg)' },
  behind: { fg: 'var(--status-behind)', bg: 'var(--status-behind-bg)' },
  over: { fg: 'var(--status-over)', bg: 'var(--status-over-bg)' },
  success: { fg: 'var(--green-800)', bg: 'var(--green-100)' },
  warning: { fg: 'var(--amber-700)', bg: 'var(--amber-100)' },
  danger: { fg: 'var(--red-700)', bg: 'var(--red-100)' },
  info: { fg: 'var(--blue-600)', bg: 'var(--blue-50)' },
  neutral: { fg: 'var(--slate-700)', bg: 'var(--slate-100)' },
};

export interface StatusPillProps {
  children: ReactNode;
  intent?: PillIntent;
  dot?: boolean;
  style?: CSSProperties;
}

export function StatusPill({ children, intent = 'neutral', dot = false, style }: StatusPillProps) {
  const c = INTENTS[intent] ?? INTENTS.neutral;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontSize: 'var(--text-xs)',
        fontFamily: 'var(--font-sans)',
        fontWeight: 'var(--weight-bold)',
        textTransform: 'uppercase',
        letterSpacing: 'var(--tracking-wide)',
        lineHeight: 1,
        whiteSpace: 'nowrap',
        color: c.fg,
        background: c.bg,
        padding: '3px 9px',
        borderRadius: 'var(--radius-pill)',
        ...style,
      }}
    >
      {dot && (
        <span
          aria-hidden="true"
          style={{ width: 6, height: 6, borderRadius: '50%', background: c.fg }}
        />
      )}
      {children}
    </span>
  );
}
