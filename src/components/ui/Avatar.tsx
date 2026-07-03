import type { CSSProperties } from 'react';

/**
 * Avatar — initials chip with a deterministic pastel fill derived from the
 * name (mirrors the calendar's per-client pastel assignment). No images in the
 * product, so this is initials-only.
 */
const PASTELS: Array<{ bg: string; fg: string }> = [
  { bg: '#ede9fe', fg: '#5b21b6' }, // violet
  { bg: '#dbeafe', fg: '#1e40af' }, // blue
  { bg: '#dcfce7', fg: '#166534' }, // green
  { bg: '#fef3c7', fg: '#92400e' }, // amber
  { bg: '#e0f2fe', fg: '#075985' }, // sky
  { bg: '#fee2e2', fg: '#991b1b' }, // red
  { bg: '#f3e8ff', fg: '#6b21a8' }, // purple
];

function hash(str = ''): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function initials(name = ''): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const SIZES: Record<'sm' | 'md' | 'lg', number> = { sm: 24, md: 32, lg: 40 };

export interface AvatarProps {
  name?: string;
  size?: 'sm' | 'md' | 'lg';
  /** Override the deterministic pastel with a solid fill (white text). */
  color?: string;
  style?: CSSProperties;
}

export function Avatar({ name = '', size = 'md', color, style }: AvatarProps) {
  const dim = SIZES[size] ?? SIZES.md;
  const pastel = color ? { bg: color, fg: 'var(--white)' } : PASTELS[hash(name) % PASTELS.length];
  return (
    <span
      title={name}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: dim,
        height: dim,
        flexShrink: 0,
        borderRadius: '50%',
        background: pastel.bg,
        color: pastel.fg,
        fontFamily: 'var(--font-sans)',
        fontSize: dim * 0.4,
        fontWeight: 'var(--weight-bold)',
        lineHeight: 1,
        userSelect: 'none',
        ...style,
      }}
    >
      {initials(name)}
    </span>
  );
}
