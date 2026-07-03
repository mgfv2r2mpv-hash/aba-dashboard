import type { CSSProperties, ReactNode } from 'react';

/**
 * SegmentedControl — the view / lens switcher (Day/Week/Month, ritual days,
 * settings choices). A track of options; the active one fills with the accent
 * (sage `--brand-accent` by default). Controlled: pass `value` + `onChange`.
 */
export type SegmentedOption =
  | string
  | { value: string; label: string; icon?: ReactNode };

export interface SegmentedControlProps {
  options: SegmentedOption[];
  value: string;
  onChange?: (value: string) => void;
  accent?: string;
  size?: 'sm' | 'md';
  style?: CSSProperties;
  ariaLabel?: string;
}

export function SegmentedControl({
  options,
  value,
  onChange,
  accent = 'var(--brand-accent)',
  size = 'md',
  style,
  ariaLabel,
}: SegmentedControlProps) {
  const pad = size === 'sm' ? '4px 10px' : '6px 12px';
  const fontSize = size === 'sm' ? 'var(--text-base)' : 'var(--text-md)';
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      style={{
        display: 'inline-flex',
        gap: 2,
        padding: 2,
        background: 'var(--slate-100)',
        borderRadius: 'var(--radius-md)',
        ...style,
      }}
    >
      {options.map((opt) => {
        const val = typeof opt === 'string' ? opt : opt.value;
        const labelText = typeof opt === 'string' ? opt : opt.label;
        const icon = typeof opt === 'string' ? null : opt.icon;
        const active = val === value;
        return (
          <button
            key={val}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange?.(val)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: pad,
              fontSize,
              fontFamily: 'var(--font-sans)',
              fontWeight: 'var(--weight-semibold)',
              lineHeight: 1.2,
              whiteSpace: 'nowrap',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              color: active ? 'var(--white)' : 'var(--slate-500)',
              background: active ? accent : 'transparent',
              transition: 'background-color var(--duration-fast) var(--ease-standard)',
            }}
          >
            {icon && <span aria-hidden="true">{icon}</span>}
            {labelText}
          </button>
        );
      })}
    </div>
  );
}
