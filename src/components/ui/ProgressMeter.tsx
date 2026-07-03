import type { CSSProperties } from 'react';

/**
 * ProgressMeter — a 6–8px segmented meter on a slate track with an optional
 * hard cap marker (e.g. a target or ceiling). Fill colour is caller-driven
 * (usually a status colour). Values are clamped to [0, max].
 */
export interface ProgressMeterProps {
  value: number;
  max: number;
  /** Draw a hard cap marker at this value (target / ceiling). */
  cap?: number;
  /** Fill colour token, e.g. 'var(--status-met)'. */
  color?: string;
  height?: number;
  trackColor?: string;
  ariaLabel?: string;
  style?: CSSProperties;
}

function pct(value: number, max: number): number {
  if (!(max > 0)) return 0;
  return Math.max(0, Math.min(1, value / max)) * 100;
}

export function ProgressMeter({
  value,
  max,
  cap,
  color = 'var(--brand-primary)',
  height = 8,
  trackColor = 'var(--slate-200)',
  ariaLabel,
  style,
}: ProgressMeterProps) {
  return (
    <div
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      style={{
        position: 'relative',
        width: '100%',
        height,
        background: trackColor,
        borderRadius: 'var(--radius-pill)',
        overflow: 'hidden',
        ...style,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: `${pct(value, max)}%`,
          background: color,
          borderRadius: 'var(--radius-pill)',
          transition: 'width var(--duration-base) var(--ease-standard)',
        }}
      />
      {cap != null && cap > 0 && cap < max && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: -1,
            bottom: -1,
            left: `${pct(cap, max)}%`,
            width: 2,
            background: 'var(--slate-900)',
            transform: 'translateX(-1px)',
          }}
        />
      )}
    </div>
  );
}
