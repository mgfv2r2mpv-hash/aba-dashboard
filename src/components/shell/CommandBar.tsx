import type { ReactNode } from 'react';

/**
 * CommandBar — the top row of the main column: the view title, primary/secondary
 * actions, an optional right-aligned control slot (e.g. Day/Week/Month), and the
 * AI status dot. White surface, bottom hairline.
 */
export interface CommandBarProps {
  title: string;
  /** Actions rendered just after the title (e.g. New session, Today). */
  actions?: ReactNode;
  /** Right-aligned slot (e.g. a view SegmentedControl). */
  right?: ReactNode;
  aiActive: boolean;
  aiTitle?: string;
}

export function CommandBar({ title, actions, right, aiActive, aiTitle }: CommandBarProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
        padding: 'calc(env(safe-area-inset-top) + 12px) 20px 12px',
        background: 'var(--white)',
        borderBottom: '1px solid var(--sage-200)',
        flexShrink: 0,
      }}
    >
      <h1
        style={{
          fontSize: 18,
          fontWeight: 800,
          color: 'var(--text-primary)',
          margin: 0,
          whiteSpace: 'nowrap',
        }}
      >
        {title}
      </h1>
      {actions}
      <div style={{ flex: 1, minWidth: 8 }} />
      {right}
      <span
        title={aiTitle}
        aria-label={aiTitle}
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          flexShrink: 0,
          background: aiActive ? 'var(--intent-success)' : 'var(--red-500)',
        }}
      />
    </div>
  );
}
