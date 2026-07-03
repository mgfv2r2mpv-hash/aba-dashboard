import type { CSSProperties } from 'react';

/**
 * Toggle — the settings switch (Face ID, opt-ins). 48×28 track, 20×20 knob,
 * sage when on, calm slide. Controlled via `checked` / `onChange`.
 */
export interface ToggleProps {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
  id?: string;
  style?: CSSProperties;
}

export function Toggle({ checked = false, onChange, disabled = false, label, id, style }: ToggleProps) {
  const toggleId = id || (label ? `tg-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined);
  const sw = (
    <button
      type="button"
      role="switch"
      id={toggleId}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange?.(!checked)}
      style={{
        position: 'relative',
        width: 48,
        height: 28,
        flexShrink: 0,
        border: 'none',
        borderRadius: 'var(--radius-pill)',
        background: checked ? 'var(--brand-primary)' : 'var(--slate-300)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        padding: 0,
        transition: 'background-color var(--duration-base) var(--ease-standard)',
        ...style,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 4,
          left: checked ? 24 : 4,
          width: 20,
          height: 20,
          borderRadius: '50%',
          background: 'var(--white)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          transition: 'left var(--duration-base) var(--ease-standard)',
        }}
      />
    </button>
  );
  if (!label) return sw;
  return (
    <label
      htmlFor={toggleId}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {sw}
      <span style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--weight-semibold)', color: 'var(--text-body)' }}>
        {label}
      </span>
    </label>
  );
}
