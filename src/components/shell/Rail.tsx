import { useState } from 'react';
import { LogoMark } from './LogoMark';

/**
 * Rail — the primary navigation. A 64px vertical strip on wide layouts
 * (Teams-style: sage-100 field, white active pill), and a horizontal bottom
 * bar on phones. Emoji icons over tiny labels; one glyph per item.
 */
export type RailKey = 'home' | 'calendar' | 'caseload' | 'cpr' | 'setup' | 'settings';

export interface RailItem {
  key: RailKey;
  icon: string;
  label: string;
  badge?: number;
}

export interface RailProps {
  items: RailItem[];
  active: RailKey | null;
  onSelect: (key: RailKey) => void;
  orientation?: 'vertical' | 'bottom';
}

export function Rail({ items, active, onSelect, orientation = 'vertical' }: RailProps) {
  const bottom = orientation === 'bottom';
  return (
    <nav
      aria-label="Main navigation"
      style={
        bottom
          ? {
              display: 'flex',
              justifyContent: 'space-around',
              alignItems: 'stretch',
              gap: 2,
              background: 'var(--sage-100)',
              borderTop: '1px solid var(--sage-200)',
              padding: '4px 6px calc(4px + env(safe-area-inset-bottom))',
              flexShrink: 0,
            }
          : {
              width: 'var(--rail-width)',
              flexShrink: 0,
              background: 'var(--sage-100)',
              borderRight: '1px solid var(--sage-200)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              padding: 'calc(env(safe-area-inset-top) + 10px) 0 10px',
              gap: 4,
            }
      }
    >
      {!bottom && (
        <div style={{ marginBottom: 10 }}>
          <LogoMark size={34} />
        </div>
      )}
      {items.map((it) => (
        <RailButton
          key={it.key}
          item={it}
          active={active === it.key}
          bottom={bottom}
          onSelect={onSelect}
        />
      ))}
    </nav>
  );
}

function RailButton({
  item,
  active,
  bottom,
  onSelect,
}: {
  item: RailItem;
  active: boolean;
  bottom: boolean;
  onSelect: (key: RailKey) => void;
}) {
  const [hover, setHover] = useState(false);
  const bg = active ? 'var(--white)' : hover ? 'var(--sage-200)' : 'transparent';
  return (
    <button
      type="button"
      aria-label={item.label}
      aria-current={active ? 'page' : undefined}
      title={item.label}
      onClick={() => onSelect(item.key)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        width: bottom ? undefined : 52,
        flex: bottom ? '1 1 0' : undefined,
        minWidth: bottom ? 0 : undefined,
        minHeight: 'var(--tap-target)',
        padding: bottom ? '6px 4px' : '8px 0 6px',
        border: 'none',
        background: bg,
        borderRadius: 'var(--radius-lg)',
        boxShadow: active ? 'var(--shadow-sm)' : 'none',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 3,
        color: active ? 'var(--sage-700)' : 'var(--slate-500)',
        fontFamily: 'var(--font-sans)',
        transition: 'background-color var(--duration-fast) var(--ease-standard)',
      }}
    >
      <span aria-hidden="true" style={{ fontSize: 19, lineHeight: 1 }}>
        {item.icon}
      </span>
      <span style={{ fontSize: 9.5, fontWeight: 700, lineHeight: 1 }}>{item.label}</span>
      {item.badge != null && item.badge > 0 && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: bottom ? 2 : 4,
            right: bottom ? '50%' : 6,
            transform: bottom ? 'translateX(14px)' : 'none',
            minWidth: 16,
            height: 16,
            padding: '0 4px',
            borderRadius: 'var(--radius-pill)',
            background: 'var(--red-500)',
            color: 'var(--white)',
            fontSize: 10,
            fontWeight: 800,
            lineHeight: '16px',
            textAlign: 'center',
          }}
        >
          {item.badge}
        </span>
      )}
    </button>
  );
}
