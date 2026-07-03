import { useState, type CSSProperties, type InputHTMLAttributes } from 'react';

/**
 * Input — labelled text field. Slate border, 6px radius, sage focus ring.
 * Pass `mono` for PIN/key fields. Set `invalid` to show the danger state.
 */
export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'style'> {
  label?: string;
  hint?: string;
  mono?: boolean;
  invalid?: boolean;
  style?: CSSProperties;
  containerStyle?: CSSProperties;
}

export function Input({
  label,
  hint,
  id,
  mono = false,
  invalid = false,
  type = 'text',
  style,
  containerStyle,
  ...rest
}: InputProps) {
  const [focus, setFocus] = useState(false);
  const inputId = id || (label ? `in-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined);
  const borderColor = invalid ? 'var(--red-300)' : focus ? 'var(--border-focus)' : 'var(--slate-300)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, ...containerStyle }}>
      {label && (
        <label
          htmlFor={inputId}
          style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--text-body)' }}
        >
          {label}
        </label>
      )}
      <input
        id={inputId}
        type={type}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: '8px 12px',
          fontSize: 'var(--text-md)',
          fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)',
          color: 'var(--text-primary)',
          background: 'var(--white)',
          border: `1px solid ${borderColor}`,
          borderRadius: 'var(--radius-md)',
          outline: 'none',
          boxShadow: focus ? 'var(--shadow-focus)' : 'none',
          transition:
            'border-color var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard)',
          ...style,
        }}
        {...rest}
      />
      {hint && (
        <span style={{ fontSize: 'var(--text-sm)', color: invalid ? 'var(--red-700)' : 'var(--text-muted)' }}>
          {hint}
        </span>
      )}
    </div>
  );
}
