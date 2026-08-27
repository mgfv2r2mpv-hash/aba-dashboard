import React from 'react';
import { DayOfWeek, TimeWindow } from '../../types';
import { PRESET_WINDOWS, PresetKey, PRESET_LABELS, isPresetActive, togglePreset } from '../../availabilityUtils';

// Presentation primitives for the one-page setup surface.
//
// The idiom is a single scrolling form: a sandy band names each section, and
// every control sits in a two-column row with its label and an italic
// explainer on the left. Nothing is hidden behind a step, so a clinician can
// see the whole shape of what setup asks for before answering any of it.

export const DAYS: DayOfWeek[] = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
];

export const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius-md)',
  fontSize: '14px',
  fontFamily: 'inherit',
  background: 'var(--surface-card)',
  color: 'var(--text-primary)',
  boxSizing: 'border-box',
  minWidth: 0,
};

export function SectionBand({ children }: { children: React.ReactNode }) {
  return (
    <h3 style={{
      margin: '30px 0 2px',
      padding: '8px 13px',
      borderRadius: 'var(--radius-md)',
      fontSize: '11.5px',
      fontWeight: 800,
      letterSpacing: '0.09em',
      textTransform: 'uppercase',
      color: 'var(--sage-700)',
      background: 'var(--sage-100)',
      border: '1px solid var(--sage-300)',
    }}>{children}</h3>
  );
}

// A label/explainer pair on the left, the control on the right. Collapses to a
// single column on narrow viewports so the phone layout stays readable.
export function Row({
  label, explainer, htmlFor, narrow, children,
}: {
  label: string;
  explainer?: React.ReactNode;
  htmlFor?: string;
  narrow?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="setup-row" style={{
      display: 'grid',
      gridTemplateColumns: narrow ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) minmax(0, 1.35fr)',
      gap: '20px',
      padding: '16px 0',
      borderBottom: '1px solid var(--border-default)',
      alignItems: 'start',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 }}>
        <label htmlFor={htmlFor} style={{ fontWeight: 700, fontSize: '14px', color: 'var(--text-primary)' }}>
          {label}
        </label>
        {explainer && (
          <span style={{ fontSize: '12.5px', color: 'var(--text-muted)', fontStyle: 'italic', lineHeight: 1.45 }}>
            {explainer}
          </span>
        )}
      </div>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

// Discrete choices read faster as visible pills than as a dropdown the user
// has to open to discover the options.
export function Pills<T extends string | number>({
  options, value, onChange, ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} style={{ display: 'flex', gap: '7px', flexWrap: 'wrap' }}>
      {options.map(o => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            style={{
              padding: '6px 13px',
              borderRadius: 'var(--radius-pill)',
              fontSize: '12.5px',
              fontWeight: 700,
              cursor: 'pointer',
              background: on ? 'var(--sage-500)' : 'var(--surface-card)',
              color: on ? 'var(--brand-primary-text)' : 'var(--text-body)',
              border: `1px solid ${on ? 'var(--sage-600)' : 'var(--border-strong)'}`,
            }}
          >{o.label}</button>
        );
      })}
    </div>
  );
}

export function Disclosure({ summary, children }: { summary: string; children: React.ReactNode }) {
  return (
    <details style={{
      margin: '14px 0 4px',
      border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-md)',
      background: 'var(--surface-sunken)',
      overflow: 'hidden',
    }}>
      <summary style={{ cursor: 'pointer', padding: '11px 14px', fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
        {summary}
      </summary>
      <div style={{ padding: '4px 14px 14px' }}>{children}</div>
    </details>
  );
}

export function Callout({ tone, title, children }: {
  tone: 'info' | 'warn';
  title: string;
  children: React.ReactNode;
}) {
  const c = tone === 'info'
    ? { bg: 'var(--intent-info-bg)', line: 'var(--intent-info)', ink: 'var(--blue-700)' }
    : { bg: 'var(--intent-warning-bg)', line: 'var(--intent-warning)', ink: 'var(--amber-700)' };
  return (
    <div style={{
      background: c.bg,
      border: `1px solid ${c.line}`,
      borderLeft: `3px solid ${c.line}`,
      borderRadius: 'var(--radius-md)',
      padding: '11px 14px',
      fontSize: '12.5px',
      lineHeight: 1.5,
      color: 'var(--text-body)',
      margin: '12px 0',
    }}>
      <strong style={{ color: c.ink }}>{title}</strong>{' '}{children}
    </div>
  );
}

// The availability control: one row per day with a checkbox and the times
// beside it, so a clinician reads the week at a glance instead of opening
// each day. Multiple windows per day are still supported — the extra windows
// stack inside the day's row.
export function WeeklyAvailability({
  availability, onChange, defaultWindow = { start: '09:00', end: '17:00' }, idPrefix,
}: {
  availability: { [key in DayOfWeek]?: TimeWindow[] };
  onChange: (availability: { [key in DayOfWeek]?: TimeWindow[] }) => void;
  defaultWindow?: TimeWindow;
  idPrefix: string;
}) {
  const setDay = (day: DayOfWeek, windows: TimeWindow[]) => {
    const next = { ...availability };
    if (windows.length === 0) delete next[day];
    else next[day] = windows;
    onChange(next);
  };

  const toggleDay = (day: DayOfWeek, on: boolean) =>
    setDay(day, on ? [{ ...defaultWindow }] : []);

  const updateWindow = (day: DayOfWeek, idx: number, field: 'start' | 'end', value: string) => {
    const list = (availability[day] || []).slice();
    list[idx] = { ...list[idx]!, [field]: value };
    setDay(day, list);
  };

  return (
    <div style={{ width: '100%', minWidth: 0 }}>
      <div style={{ display: 'flex', gap: '7px', flexWrap: 'wrap', marginBottom: '10px' }}>
        {(Object.keys(PRESET_WINDOWS) as PresetKey[]).map(key => {
          const on = isPresetActive(availability, PRESET_WINDOWS[key]);
          return (
            <button
              key={key}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(togglePreset(availability, PRESET_WINDOWS[key], !on))}
              style={{
                padding: '5px 11px',
                borderRadius: 'var(--radius-pill)',
                fontSize: '11.5px',
                fontWeight: 700,
                cursor: 'pointer',
                background: on ? 'var(--sage-500)' : 'var(--surface-card)',
                color: on ? 'var(--brand-primary-text)' : 'var(--text-body)',
                border: `1px solid ${on ? 'var(--sage-600)' : 'var(--border-strong)'}`,
              }}
            >{PRESET_LABELS[key]}</button>
          );
        })}
        <button
          type="button"
          onClick={() => onChange({})}
          style={{
            padding: '5px 11px', borderRadius: 'var(--radius-pill)', fontSize: '11.5px',
            cursor: 'pointer', background: 'var(--surface-card)', color: 'var(--text-muted)',
            border: '1px solid var(--border-strong)',
          }}
        >Clear all</button>
      </div>

      <table style={{
        width: '100%',
        borderCollapse: 'collapse',
        fontSize: '13px',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
      }}>
        <tbody>
          {DAYS.map(day => {
            const windows = availability[day] || [];
            const on = windows.length > 0;
            const id = `${idPrefix}-${day}`;
            return (
              <tr key={day} style={{ borderBottom: '1px solid var(--border-default)' }}>
                <td style={{ padding: '7px 12px', width: '38%', whiteSpace: 'nowrap' }}>
                  <label htmlFor={id} style={{ display: 'flex', alignItems: 'center', gap: '9px', cursor: 'pointer', fontWeight: 700, color: 'var(--text-primary)' }}>
                    <input
                      id={id}
                      type="checkbox"
                      checked={on}
                      onChange={e => toggleDay(day, e.target.checked)}
                    />
                    {day.slice(0, 3)}
                  </label>
                </td>
                <td style={{ padding: '7px 12px' }}>
                  {!on && <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Off</span>}
                  {windows.map((w, idx) => (
                    <span key={idx} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', marginRight: '8px' }}>
                      <input
                        type="time" step="900" value={w.start} aria-label={`${day} start`}
                        onChange={e => updateWindow(day, idx, 'start', e.target.value)}
                        style={{ ...inputStyle, width: 'auto', padding: '3px 6px', fontSize: '12px' }}
                      />
                      <span style={{ color: 'var(--text-muted)' }}>–</span>
                      <input
                        type="time" step="900" value={w.end} aria-label={`${day} end`}
                        onChange={e => updateWindow(day, idx, 'end', e.target.value)}
                        style={{ ...inputStyle, width: 'auto', padding: '3px 6px', fontSize: '12px' }}
                      />
                      {windows.length > 1 && (
                        <button
                          type="button"
                          aria-label={`Remove this ${day} window`}
                          onClick={() => setDay(day, windows.filter((_, i) => i !== idx))}
                          style={{ border: 'none', background: 'transparent', color: 'var(--text-link)', cursor: 'pointer', fontSize: '13px' }}
                        >×</button>
                      )}
                    </span>
                  ))}
                  {on && (
                    <button
                      type="button"
                      onClick={() => setDay(day, [...windows, { ...defaultWindow }])}
                      style={{
                        padding: '3px 9px', fontSize: '11px', cursor: 'pointer',
                        border: '1px dashed var(--sage-500)', background: 'transparent',
                        color: 'var(--text-link)', borderRadius: 'var(--radius-sm)',
                      }}
                    >+ window</button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
