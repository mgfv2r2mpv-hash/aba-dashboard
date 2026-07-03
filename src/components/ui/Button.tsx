import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react';

/**
 * Button — No Outcome ABA's primary action control.
 * Styling is driven entirely by design-system CSS custom properties. Hover
 * darkens the fill one step (never scales); disabled drops to a grey fill at
 * reduced opacity, matching the shipped app.
 */
export type ButtonVariant =
  | 'primary'
  | 'neutral'
  | 'secondary'
  | 'ghost'
  | 'danger'
  | 'ai'
  | 'sassi'
  | 'fix'
  | 'success';

export type ButtonSize = 'sm' | 'md' | 'lg';

interface VariantStyle {
  bg: string;
  hover: string;
  fg: string;
  border: string;
}

const VARIANTS: Record<ButtonVariant, VariantStyle> = {
  primary: { bg: 'var(--brand-primary)', hover: 'var(--brand-primary-hover)', fg: 'var(--white)', border: 'transparent' },
  neutral: { bg: 'var(--slate-700)', hover: 'var(--slate-800)', fg: 'var(--white)', border: 'transparent' },
  secondary: { bg: 'var(--white)', hover: 'var(--slate-50)', fg: 'var(--slate-700)', border: 'var(--slate-300)' },
  ghost: { bg: 'transparent', hover: 'var(--slate-100)', fg: 'var(--slate-700)', border: 'transparent' },
  danger: { bg: 'var(--red-100)', hover: '#fecaca', fg: 'var(--red-700)', border: 'var(--red-300)' },
  ai: { bg: 'var(--violet-600)', hover: 'var(--violet-700)', fg: 'var(--white)', border: 'transparent' },
  // sassi — merged assistant CTA: brand-ink fill; pair with an sAssI label
  // (A + I in var(--ai-bright)) to signal an appointment headed into SAssi.
  sassi: { bg: '#3a4448', hover: '#2c363b', fg: 'var(--white)', border: 'transparent' },
  fix: { bg: 'var(--orange-600)', hover: '#c2410c', fg: 'var(--white)', border: 'transparent' },
  success: { bg: 'var(--green-600)', hover: 'var(--green-800)', fg: 'var(--white)', border: 'transparent' },
};

const SIZES: Record<ButtonSize, { padding: string; fontSize: string; radius: string }> = {
  sm: { padding: '5px 10px', fontSize: 'var(--text-base)', radius: 'var(--radius-sm)' },
  md: { padding: '8px 14px', fontSize: 'var(--text-md)', radius: 'var(--radius-md)' },
  lg: { padding: '11px 18px', fontSize: 'var(--text-lg)', radius: 'var(--radius-md)' },
};

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  fullWidth?: boolean;
  type?: 'button' | 'submit' | 'reset';
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  icon,
  disabled = false,
  fullWidth = false,
  type = 'button',
  onClick,
  style,
  ...rest
}: ButtonProps) {
  const [hover, setHover] = useState(false);
  const v = VARIANTS[variant] ?? VARIANTS.primary;
  const s = SIZES[size] ?? SIZES.md;
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        width: fullWidth ? '100%' : undefined,
        padding: s.padding,
        fontSize: s.fontSize,
        fontFamily: 'var(--font-sans)',
        fontWeight: 'var(--weight-semibold)',
        lineHeight: 1.2,
        whiteSpace: 'nowrap',
        color: disabled ? 'var(--slate-400)' : v.fg,
        backgroundColor: disabled ? 'var(--slate-200)' : hover ? v.hover : v.bg,
        border: `1px solid ${disabled ? 'var(--slate-200)' : v.border}`,
        borderRadius: s.radius,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.7 : 1,
        transition: 'background-color var(--duration-fast) var(--ease-standard)',
        ...style,
      }}
      {...rest}
    >
      {icon != null && (
        <span aria-hidden="true" style={{ fontSize: '1.05em', lineHeight: 1 }}>
          {icon}
        </span>
      )}
      {children}
    </button>
  );
}
