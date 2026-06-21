// ClientCalendarView — top-level client-centric (Case) schedule view.
//
// Month sub-view: blackout dates only per client (no appointments).
// Day sub-view:   vertical time axis × horizontal client columns, with a
//                 translucent availability heat layer behind each column to make
//                 open replacement slots obvious, plus a tap/scrub time guide.
// Week sub-view:  vertical time axis × seven day columns. Within each day every
//                 selected client's availability + sessions overlap as translucent
//                 z-layers (availability backmost → direct → supervision → PT).
//
// Interaction (Day + Week):
//   - Frozen time gutter (sticky-left) stays put while scrolling across columns.
//   - Tap the time gutter to drop a dotted guide line and FOCUS every client
//     available at that time for direct service; tap-hold-slide to fine-tune.
//   - Tap a client pill to focus that client (additive); unfocused clients dim
//     rather than vanish. "Clear" resets focus. The "Clients ▾" dropdown filters
//     which clients are visible.
//   - Pinch to zoom the time axis (no drag).

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Client, Blackout, Appointment, DayOfWeek, CompanyHoliday,
} from '../types';
import {
  clientPastel, clientDarkBorder, clientAvailBarStyle, tileStyle, clientHue,
} from '../calendarColors';
import { computeSessionFlags, SessionFlags, streakEmoji, isStreakMilestone } from '../sessionFlags';
import {
  cancelBadgeText, cancelBar, tierOf, TIER_COLOR, TIER_LAYOUT, TIER_LABEL,
  clusterByOverlap, toMin, fmtMin, assignLanes,
} from './clientCalendarShared';
import { usePinchZoom } from '../hooks/usePinchZoom';
import ZoomResetPill from './ZoomResetPill';
import {
  format, addDays,
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, isSameDay, isSameMonth,
} from 'date-fns';

const DAY_START = 6;
const DAY_END   = 22;
const HOUR_PX   = 80;   // taller than BCBA calendar → more scroll, larger bands
const GUTTER    = 56;   // time axis width
const COL_MIN   = 140;  // min client column width (day view)
const WEEK_COL_MIN = 118; // min day column width (week view — 7 columns)
const MIN_DAY_START = DAY_START * 60;
const MIN_DAY_END   = DAY_END * 60;
const WEEK_DOWS: DayOfWeek[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

interface Props {
  clients: Client[];
  appointments: Appointment[];
  blackouts: Blackout[];
  view: 'month' | 'week' | 'day';
  date: Date;
  onPickDay: (d: Date) => void;
  companyHolidays?: CompanyHoliday[];
  onSelectAppointment?: (a: Appointment) => void;
}

// ── Shared time ⇄ pixel helpers (parametrized by the zoomed hour height) ───────
const toTopPx = (h: number, m: number, hourPx: number) => (h + m / 60 - DAY_START) * hourPx;
const apptTopPx = (a: Appointment, hourPx: number) => {
  const d = new Date(a.startTime);
  return toTopPx(d.getHours(), d.getMinutes(), hourPx);
};
const apptHPx = (a: Appointment, hourPx: number) => {
  const s = new Date(a.startTime);
  const e = new Date(a.endTime);
  return ((e.getTime() - s.getTime()) / 3_600_000) * hourPx;
};
const winTopPx = (t: string, hourPx: number) => {
  const [h, m] = t.split(':').map(Number);
  return toTopPx(h, m, hourPx);
};
const winHPx = (start: string, end: string, hourPx: number) => {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return ((eh + em / 60) - (sh + sm / 60)) * hourPx;
};
const minToPx = (min: number, hourPx: number) => (min / 60 - DAY_START) * hourPx;
const totalHpx = (hourPx: number) => (DAY_END - DAY_START) * hourPx;
const fmtTime = (d: Date) =>
  d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const HOURS = Array.from({ length: DAY_END - DAY_START + 1 }, (_, i) => DAY_START + i);

const apptStartMin = (a: Appointment) => { const d = new Date(a.startTime); return d.getHours() * 60 + d.getMinutes(); };
const apptEndMin   = (a: Appointment) => { const d = new Date(a.endTime);   return d.getHours() * 60 + d.getMinutes(); };

// Clients with an availability window covering `min` on any of the given days.
function clientsAvailableAt(clients: Client[], dows: DayOfWeek[], min: number): Set<string> {
  const set = new Set<string>();
  for (const c of clients) {
    for (const dow of dows) {
      const wins = c.availabilityWindows?.[dow] ?? [];
      if (wins.some(w => toMin(w.start) <= min && toMin(w.end) > min)) { set.add(c.id); break; }
    }
  }
  return set;
}

// ── Tap / press-slide time scrubber ────────────────────────────────────────────
// Attaches to the (frozen) time gutter. A tap drops the guide line at that time;
// holding and sliding fine-tunes it. Single-pointer only, so it never collides
// with the two-finger pinch on the scroll container.
function useTimeScrub(hourPx: number, onChange: (min: number | null) => void) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef(false);

  const minFrom = (clientY: number): number => {
    const el = elRef.current;
    if (!el) return MIN_DAY_START;
    const rect = el.getBoundingClientRect();
    const raw = MIN_DAY_START + ((clientY - rect.top) / hourPx) * 60;
    const snapped = Math.round(raw / 5) * 5; // 5-minute fine increment
    return Math.max(MIN_DAY_START, Math.min(MIN_DAY_END, snapped));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    dragging.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    onChange(minFrom(e.clientY));
    e.preventDefault();
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    onChange(minFrom(e.clientY));
    e.preventDefault();
  };
  const end = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  return { elRef, handlers: { onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end } };
}

export default function ClientCalendarView({
  clients, appointments, blackouts, view, date, onPickDay, companyHolidays, onSelectAppointment,
}: Props) {
  const sub: 'month' | 'week' | 'day' =
    view === 'month' ? 'month' : view === 'week' ? 'week' : 'day';

  // Session-flag annotations (holiday / makeup / streak / star / cancel-escalation)
  // computed once per appointment set + holidays, matching the BCBA/BT lenses.
  const sessionFlags = useMemo(
    () => computeSessionFlags(appointments, companyHolidays ?? []),
    [appointments, companyHolidays],
  );

  // Visibility filter (which clients appear) — driven by the Clients ▾ dropdown.
  const [selIds, setSelIds] = useState<Set<string>>(
    () => new Set(clients.map(c => c.id)),
  );
  // Keep any newly-added clients visible by default.
  useEffect(() => {
    setSelIds(prev => {
      const merged = new Set(prev);
      clients.forEach(c => merged.add(c.id));
      return merged;
    });
  }, [clients]);

  // Focus (opacity) state — additive client focus OR a tapped time band. The two
  // are mutually exclusive: tapping a client clears the band, scrubbing a time
  // clears manual focus.
  const [focusIds, setFocusIds] = useState<Set<string>>(new Set());
  const [bandMin, setBandMin] = useState<number | null>(null);

  const visible = clients.filter(c => selIds.has(c.id));

  const toggleFocus = (id: string) => {
    setBandMin(null);
    setFocusIds(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };
  const onScrub = (min: number | null) => { setFocusIds(new Set()); setBandMin(min); };
  const clearFocus = () => { setFocusIds(new Set()); setBandMin(null); };

  return (
    <div style={{ padding: 'clamp(8px,3vw,24px)', boxSizing: 'border-box' }}>

      {/* ── Filter + focus bar ──────────────────────────────── */}
      <div style={{
        display: 'flex', gap: 8, alignItems: 'center', paddingBottom: 8, marginBottom: 10,
        flexWrap: 'wrap',
      }}>
        <ClientsDropdown clients={clients} selIds={selIds} setSelIds={setSelIds} />
        <button onClick={clearFocus} disabled={focusIds.size === 0 && bandMin === null} style={{
          padding: '5px 12px', borderRadius: 14, whiteSpace: 'nowrap',
          border: '1px solid #d1d5db',
          background: (focusIds.size === 0 && bandMin === null) ? '#f9fafb' : '#eff6ff',
          color: (focusIds.size === 0 && bandMin === null) ? '#9ca3af' : '#1d4ed8',
          cursor: (focusIds.size === 0 && bandMin === null) ? 'default' : 'pointer',
          fontSize: 12, fontWeight: 600,
        }}>Clear focus</button>
        <div style={{
          display: 'flex', gap: 5, overflowX: 'auto', flex: 1, minWidth: 0,
          WebkitOverflowScrolling: 'touch' as any,
        }}>
          {visible.map(c => {
            const s  = clientAvailBarStyle(c.name);
            const on = focusIds.has(c.id);
            return (
              <button
                key={c.id}
                onClick={() => toggleFocus(c.id)}
                title={on ? 'Focused — tap to remove' : 'Tap to focus'}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '4px 10px', borderRadius: 14, flexShrink: 0,
                  border:      on ? `2px solid ${s.borderColor}` : '1px solid #d1d5db',
                  background:  on ? s.backgroundColor : '#f9fafb',
                  color:       on ? s.color : '#6b7280',
                  cursor: 'pointer', fontSize: 12, fontWeight: on ? 700 : 500,
                  whiteSpace: 'nowrap',
                }}
              >
                <span style={{
                  width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                  background: on ? s.borderColor : '#d1d5db',
                }} />
                {c.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Content ──────────────────────────────────────── */}
      {sub === 'month' && (
        <ClientMonthView
          date={date}
          blackouts={blackouts}
          clients={visible}
          onPickDay={onPickDay}
        />
      )}
      {sub === 'week' && (
        <ClientWeekGrid
          date={date}
          clients={visible}
          appointments={appointments}
          companyHolidays={companyHolidays ?? []}
          focusIds={focusIds}
          bandMin={bandMin}
          onScrub={onScrub}
          onPickDay={onPickDay}
          onSelectAppointment={onSelectAppointment}
        />
      )}
      {sub === 'day' && (
        <ClientDayGrid
          date={date}
          clients={visible}
          appointments={appointments}
          blackouts={blackouts}
          sessionFlags={sessionFlags}
          focusIds={focusIds}
          bandMin={bandMin}
          onScrub={onScrub}
          onSelectAppointment={onSelectAppointment}
        />
      )}
    </div>
  );
}

// ── Clients visibility dropdown ────────────────────────────────────────────────

function ClientsDropdown({ clients, selIds, setSelIds }: {
  clients: Client[];
  selIds: Set<string>;
  setSelIds: React.Dispatch<React.SetStateAction<Set<string>>>;
}) {
  const n = clients.filter(c => selIds.has(c.id)).length;
  return (
    <details style={{ position: 'relative' }}>
      <summary style={{
        listStyle: 'none', cursor: 'pointer', userSelect: 'none',
        padding: '5px 12px', borderRadius: 14, border: '1px solid #d1d5db',
        background: '#f9fafb', color: '#374151', fontSize: 12, fontWeight: 600,
        whiteSpace: 'nowrap',
      }}>
        Clients ({n}/{clients.length}) ▾
      </summary>
      <div style={{
        position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 50,
        background: 'white', border: '1px solid #e5e7eb', borderRadius: 8,
        boxShadow: '0 8px 24px rgba(0,0,0,0.18)', padding: 8, minWidth: 200,
        maxHeight: 320, overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <button onClick={() => setSelIds(new Set(clients.map(c => c.id)))} style={dropBtn}>Select all</button>
          <button onClick={() => setSelIds(new Set())} style={dropBtn}>Clear all</button>
        </div>
        {clients.map(c => {
          const s = clientAvailBarStyle(c.name);
          const on = selIds.has(c.id);
          return (
            <label key={c.id} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '4px 4px',
              cursor: 'pointer', fontSize: 13, color: '#374151',
            }}>
              <input
                type="checkbox"
                checked={on}
                onChange={() => setSelIds(prev => {
                  const next = new Set(prev);
                  next.has(c.id) ? next.delete(c.id) : next.add(c.id);
                  return next;
                })}
              />
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: s.borderColor, flexShrink: 0 }} />
              {c.name}
            </label>
          );
        })}
      </div>
    </details>
  );
}

const dropBtn: React.CSSProperties = {
  flex: 1, padding: '4px 8px', borderRadius: 6, border: '1px solid #d1d5db',
  background: '#f3f4f6', color: '#374151', cursor: 'pointer', fontSize: 11, fontWeight: 600,
};

// ── Session tile (day grid — per-client columns) ───────────────────────────────
// Renders a single absolutely-positioned session block, folding status (completed
// / canceled) and session flags into the tile — mirroring the BCBA/BT
// AppointmentBlock. Supports side-by-side lanes for same-column overlaps.
function SessionTile({ appt, flags, clientName, top, height, lane = 0, lanes = 1, baseInset = 3, onClick }: {
  appt: Appointment;
  flags?: SessionFlags;
  clientName?: string;
  top: number;
  height: number;
  lane?: number;
  lanes?: number;
  baseInset?: number;
  onClick?: () => void;
}) {
  const isDirect = appt.type === 'client-session';
  const canceled = appt.status === 'canceled';

  const base = isDirect
    ? tileStyle(clientName, appt.technician)
    : { backgroundColor: clientDarkBorder(clientName), backgroundImage: undefined as string | undefined };

  const border = canceled
    ? `2px solid ${cancelBar(appt.cancellation?.source)}`
    : `1.5px solid ${clientDarkBorder(clientName)}`;

  // Escalation darkening for canceled blocks (inset shadow overlay), driven by the
  // consecutive-cancel run. Starts at the first cancel.
  const escalationAlpha = canceled && (flags?.cancelEscalation ?? 0) >= 1
    ? flags!.cancelEscalation! * 0.06
    : 0;

  const fg = isDirect ? '#1e3a5f' : '#fff';
  const showText    = height > 22;
  const showMarkers = height > 34;
  const hasMarkers = flags && (
    flags.isHoliday || flags.isMakeup ||
    (flags.streakStarLevel ?? 0) > 0 || (flags.completedStreak ?? 0) >= 2
  );

  const flagTip: string[] = [];
  if ((flags?.cancelEscalation ?? 0) >= 1) flagTip.push(`${flags!.cancelEscalation} consecutive cancel${(flags!.cancelEscalation ?? 0) > 1 ? 's' : ''}${(flags!.cancelEscalation ?? 0) >= 2 ? ` ${cancelBadgeText(flags!.cancelEscalation!)}` : ''}`);
  if ((flags?.completedStreak ?? 0) >= 2) flagTip.push(`${streakEmoji(flags!.completedStreak!) ?? ''} ${flags!.completedStreak}-session streak`.trim());
  if (flags?.streakStarLevel) flagTip.push(`${flags.streakStarLevel} clean 2-week star${flags.streakStarLevel > 1 ? 's' : ''}`);
  if (flags?.isMakeup) flagTip.push(`Makeup${flags.makeupDates?.length ? ` of ${flags.makeupDates.join(', ')}` : ''}`);
  if (flags?.isHoliday) flagTip.push(flags.holidayName ?? 'Company holiday');

  const left  = `calc(${baseInset}px + ${lane} / ${lanes} * (100% - ${2 * baseInset}px))`;
  const width = `calc((100% - ${2 * baseInset}px) / ${lanes})`;

  return (
    <div
      onClick={onClick}
      title={[
        `${appt.title}${canceled ? ' (canceled)' : ''}`,
        `${fmtTime(new Date(appt.startTime))}–${fmtTime(new Date(appt.endTime))}`,
        ...flagTip,
      ].join('\n')}
      style={{
        position: 'absolute',
        top: top + 1, left, width,
        height: Math.max(height - 2, 16),
        ...base,
        border,
        borderRadius: 5, overflow: 'hidden',
        zIndex: 3, boxSizing: 'border-box',
        padding: '2px 5px',
        opacity: canceled ? 0.6 : 1,
        textDecoration: canceled ? 'line-through' : 'none',
        cursor: onClick ? 'pointer' : undefined,
        boxShadow: escalationAlpha > 0
          ? `inset 0 0 0 9999px rgba(0,0,0,${escalationAlpha})`
          : '0 1px 3px rgba(0,0,0,0.14)',
      }}
    >
      {showText && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 3 }}>
          <span style={{
            fontSize: 10, fontWeight: 700, lineHeight: 1.3, color: fg,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {appt.title}
          </span>
          {(flags?.cancelEscalation ?? 0) >= 2 && (
            <span style={{
              fontSize: 9, fontWeight: 800, background: 'rgba(0,0,0,0.18)', color: fg,
              padding: '0 3px', borderRadius: 3, flexShrink: 0, whiteSpace: 'nowrap',
              textDecoration: 'none',
            }}>
              {cancelBadgeText(flags!.cancelEscalation!)}
            </span>
          )}
        </div>
      )}
      {flags && ((flags.cancelEscalation ?? 0) >= 2 || isStreakMilestone(flags.completedStreak ?? 0) || flags.isHoliday) && (
        <div style={{ display: 'flex', gap: 2, marginTop: 2 }}>
          {(flags.cancelEscalation ?? 0) >= 2 && (
            <span style={{ width: 4, height: 4, borderRadius: '50%', background: cancelBar(appt.cancellation?.source), flexShrink: 0 }} />
          )}
          {isStreakMilestone(flags.completedStreak ?? 0) && (
            <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--green-600, #16a34a)', flexShrink: 0 }} />
          )}
          {flags.isHoliday && (
            <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--green-700, #15803d)', flexShrink: 0 }} />
          )}
        </div>
      )}
      {showMarkers && hasMarkers && (
        <div style={{ display: 'flex', gap: 3, alignItems: 'center', marginTop: 2, flexWrap: 'wrap' }}>
          {flags!.isHoliday && (
            <span style={{ fontSize: 10, color: 'var(--green-700)', fontWeight: 800 }} title={flags!.holidayName ?? 'Holiday'}>✦</span>
          )}
          {flags!.isMakeup && (
            <span style={{ fontSize: 10 }} title={`Makeup${flags!.makeupDates?.length ? ` of ${flags!.makeupDates.join(', ')}` : ''}`}>🌟</span>
          )}
          {(flags!.streakStarLevel ?? 0) > 0 && (
            <span style={{ fontSize: 10 }} title={`${flags!.streakStarLevel} clean 2-week period${(flags!.streakStarLevel ?? 0) > 1 ? 's' : ''}`}>⭐</span>
          )}
          {(flags!.completedStreak ?? 0) >= 2 && (
            <span style={{ fontSize: 9, fontWeight: 700, color: '#166534', background: 'rgba(22,163,74,0.14)', padding: '0 3px', borderRadius: 3 }}>
              {streakEmoji(flags!.completedStreak!)} {flags!.completedStreak}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// Shared full-width hour / half-hour rule lines for the time grids.
function GridRules({ hourPx }: { hourPx: number }) {
  return (
    <div style={{
      position: 'absolute', left: GUTTER, right: 0, top: 0, bottom: 0,
      zIndex: 1, pointerEvents: 'none',
    }}>
      {HOURS.map(h => h > DAY_START && (
        <div key={h} style={{
          position: 'absolute', left: 0, right: 0,
          top: (h - DAY_START) * hourPx,
          borderTop: `1px solid ${h % 3 === 0 ? '#d1d5db' : '#ececec'}`,
        }} />
      ))}
      {Array.from({ length: (DAY_END - DAY_START) * 2 }, (_, i) => i).map(i =>
        i % 2 === 1 ? (
          <div key={i} style={{
            position: 'absolute', left: 0, right: 0,
            top: i * hourPx / 2,
            borderTop: '1px dashed #f0f0f0',
          }} />
        ) : null,
      )}
    </div>
  );
}

// Frozen time gutter (hour labels) — sticky-left so it stays put while scrolling
// horizontally across columns, and the surface for the tap/scrub time guide.
function TimeGutter({ hourPx, scrubRef, scrubHandlers }: {
  hourPx: number;
  scrubRef?: React.RefObject<HTMLDivElement | null>;
  scrubHandlers?: React.DOMAttributes<HTMLDivElement>;
}) {
  return (
    <div
      ref={scrubRef}
      {...scrubHandlers}
      style={{
        width: GUTTER, flexShrink: 0,
        position: 'sticky', left: 0, zIndex: 16,
        height: totalHpx(hourPx),
        background: '#f9fafb', borderRight: '2px solid #d1d5db',
        touchAction: scrubHandlers ? 'none' : undefined,
        cursor: scrubHandlers ? 'ns-resize' : undefined,
      }}
    >
      {HOURS.map(h => (
        <div key={h} style={{
          position: 'absolute',
          top: (h - DAY_START) * hourPx - (h === DAY_START ? 0 : 6),
          width: '100%', textAlign: 'right',
          paddingRight: 7, fontSize: 11, fontWeight: 600, color: '#6b7280',
          pointerEvents: 'none',
        }}>
          {h === 12 ? '12p' : h > 12 ? `${h - 12}p` : `${h}a`}
        </div>
      ))}
    </div>
  );
}

// Dotted horizontal guide line + time chip rendered across the grid body.
function GuideLine({ min, hourPx }: { min: number; hourPx: number }) {
  const top = minToPx(min, hourPx);
  return (
    <div style={{ position: 'absolute', left: GUTTER, right: 0, top, zIndex: 60, pointerEvents: 'none' }}>
      <div style={{ borderTop: '2px dashed #2563eb' }} />
      <span style={{
        position: 'absolute', left: 4, top: -9, fontSize: 10, fontWeight: 800,
        color: '#1d4ed8', background: 'rgba(255,255,255,0.9)', padding: '0 4px', borderRadius: 4,
      }}>{fmtMin(min)}</span>
    </div>
  );
}

// ── Month sub-view: client blackout dates only ─────────────────────────────────

function ClientMonthView({ date, blackouts, clients, onPickDay }: {
  date: Date;
  blackouts: Blackout[];
  clients: Client[];
  onPickDay: (d: Date) => void;
}) {
  const mStart    = startOfMonth(date);
  const mEnd      = endOfMonth(date);
  const gridStart = startOfWeek(mStart, { weekStartsOn: 1 });
  const gridEnd   = endOfWeek(mEnd,   { weekStartsOn: 1 });
  const days      = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const clientIds = new Set(clients.map(c => c.id));

  if (clients.length === 0) {
    return <EmptyPanel />;
  }

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
      {/* Day-of-week header */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
        background: '#f9fafb', borderBottom: '2px solid #e5e7eb',
      }}>
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
          <div key={d} style={{
            padding: '8px 4px', textAlign: 'center',
            fontSize: 12, fontWeight: 700, color: '#374151',
          }}>{d}</div>
        ))}
      </div>

      {/* Day cells */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
        gap: 1, background: '#e5e7eb',
      }}>
        {days.map(day => {
          const iso      = format(day, 'yyyy-MM-dd');
          const dayouts  = blackouts.filter(b =>
            b.date === iso && b.entityType === 'client' && clientIds.has(b.entityId),
          );
          const inMonth  = isSameMonth(day, date);
          const isToday  = isSameDay(day, new Date());

          return (
            <div
              key={iso}
              onClick={() => onPickDay(day)}
              style={{
                background: inMonth ? '#fff' : '#f8f8f8',
                minHeight: 96, padding: '5px 5px 4px',
                cursor: 'pointer', opacity: inMonth ? 1 : 0.4,
                borderTop: isToday ? '3px solid #3b82f6' : '3px solid transparent',
              }}
            >
              <div style={{
                fontSize: 13, fontWeight: isToday ? 700 : 400,
                color: isToday ? '#3b82f6' : '#374151', marginBottom: 4,
              }}>
                {format(day, 'd')}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {dayouts.map(b => {
                  const client = clients.find(c => c.id === b.entityId);
                  if (!client) return null;
                  const s = clientAvailBarStyle(client.name);
                  return (
                    <div
                      key={b.id}
                      title={b.reason ? `Blackout: ${b.reason}` : 'Blackout'}
                      style={{
                        fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 8,
                        background: s.backgroundColor, border: `1px solid ${s.borderColor}`,
                        color: s.color, whiteSpace: 'nowrap',
                        overflow: 'hidden', textOverflow: 'ellipsis',
                      }}
                    >
                      🚫 {client.name}
                    </div>
                  );
                })}
                {dayouts.length === 0 && inMonth && (
                  <div style={{ fontSize: 10, color: '#e5e7eb', textAlign: 'center', marginTop: 6 }}>—</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EmptyPanel() {
  return (
    <div style={{
      border: '1px solid #e5e7eb', borderRadius: 8,
      textAlign: 'center', padding: '64px 20px', color: '#9ca3af', fontSize: 14,
    }}>
      No clients selected. Choose clients using the Clients ▾ dropdown above.
    </div>
  );
}

// ── Day sub-view: vertical time × horizontal client columns ────────────────────

function ClientDayGrid({ date, clients, appointments, blackouts, sessionFlags, focusIds, bandMin, onScrub, onSelectAppointment }: {
  date: Date;
  clients: Client[];
  appointments: Appointment[];
  blackouts: Blackout[];
  sessionFlags: Map<string, SessionFlags>;
  focusIds: Set<string>;
  bandMin: number | null;
  onScrub: (min: number | null) => void;
  onSelectAppointment?: (a: Appointment) => void;
}) {
  const iso      = format(date, 'yyyy-MM-dd');
  const dow      = format(date, 'EEEE') as DayOfWeek;

  const { ref: zoomRef, scale, zoomed, reset } = usePinchZoom<HTMLDivElement>();
  const hourPx = HOUR_PX * scale;
  const totalH = totalHpx(hourPx);
  const { elRef, handlers } = useTimeScrub(hourPx, onScrub);

  // Effective focus: a tapped time band focuses clients available then; otherwise
  // the manual focus set. Empty → everyone full opacity.
  const availableAtBand = useMemo(
    () => bandMin == null ? null : clientsAvailableAt(clients, [dow], bandMin),
    [bandMin, clients, dow],
  );
  const effFocus = availableAtBand ?? focusIds;
  const isDim = (id: string) => effFocus.size > 0 && !effFocus.has(id);

  // Include canceled sessions (so cancel-escalation severity shows); exclude ghosts.
  const dayAppts = useMemo(() =>
    appointments.filter(a => a.startTime.startsWith(iso) && !a.isGhost),
  [appointments, iso]);

  if (clients.length === 0) return <EmptyPanel />;

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', position: 'relative' }}>
      {zoomed && <ZoomResetPill scale={scale} onReset={reset} />}
      <div ref={zoomRef} style={{
        overflowY: 'auto', overflowX: 'auto', maxHeight: '75vh',
        WebkitOverflowScrolling: 'touch' as any,
      }}>
        {/* Inner wrapper enforces minimum total width */}
        <div style={{ minWidth: GUTTER + clients.length * COL_MIN, display: 'flex', flexDirection: 'column' }}>

          {/* ── Column headers (sticky top) ──────── */}
          <div style={{
            display: 'flex', position: 'sticky', top: 0, zIndex: 20,
            background: '#f9fafb', borderBottom: '2px solid #d1d5db',
            boxShadow: '0 2px 4px rgba(0,0,0,0.06)',
          }}>
            {/* Corner spacer aligns with time gutter */}
            <div style={{
              width: GUTTER, flexShrink: 0, position: 'sticky', left: 0, zIndex: 21,
              borderRight: '2px solid #d1d5db', background: '#f3f4f6',
            }} />

            {clients.map(c => {
              const s = clientAvailBarStyle(c.name);
              const hasBlackout = blackouts.some(
                b => b.date === iso && b.entityType === 'client' && b.entityId === c.id,
              );
              return (
                <div
                  key={c.id}
                  style={{
                    flex: `1 1 ${COL_MIN}px`, minWidth: COL_MIN,
                    padding: '7px 8px 6px', textAlign: 'center',
                    borderLeft: '1px solid #e5e7eb',
                    background: hasBlackout ? '#fef2f2' : 'transparent',
                    opacity: isDim(c.id) ? 0.4 : 1,
                  }}
                >
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, maxWidth: '100%' }}>
                    <span style={{
                      width: 10, height: 10, borderRadius: '50%',
                      background: s.borderColor, flexShrink: 0,
                      border: `1.5px solid ${s.borderColor}`,
                    }} />
                    <span style={{
                      fontSize: 12, fontWeight: 700, color: s.color,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {c.name}
                    </span>
                  </div>
                  {hasBlackout && (
                    <div style={{ fontSize: 9, color: '#b91c1c', fontWeight: 700, marginTop: 1 }}>
                      🚫 BLACKOUT
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* ── Grid body ─────────────────────────── */}
          <div style={{ display: 'flex', position: 'relative' }}>

            <TimeGutter hourPx={hourPx} scrubRef={elRef} scrubHandlers={handlers} />
            <GridRules hourPx={hourPx} />
            {bandMin != null && <GuideLine min={bandMin} hourPx={hourPx} />}

            {/* Client columns */}
            {clients.map((client, ci) => {
              const windows  = (client.availabilityWindows?.[dow]) ?? [];
              const cAppts   = dayAppts.filter(
                a => a.client === client.id || a.client === client.name,
              );
              const laned = assignLanes(cAppts.map(a => ({
                appt: a, startMin: apptStartMin(a), endMin: apptEndMin(a), sortKey: a.title,
              })));
              const dim = isDim(client.id);

              return (
                <div
                  key={client.id}
                  style={{
                    flex: `1 1 ${COL_MIN}px`, minWidth: COL_MIN,
                    height: totalH, position: 'relative',
                    borderLeft: ci > 0 ? '1px solid #e5e7eb' : undefined,
                    zIndex: 2, opacity: dim ? 0.25 : 1,
                    transition: 'opacity 0.15s',
                  }}
                >
                  {/* Availability heat layer */}
                  {windows.map((w, wi) => {
                    const top = winTopPx(w.start, hourPx);
                    const h   = winHPx(w.start, w.end, hourPx);
                    if (h <= 0 || top >= totalH || top + h <= 0) return null;
                    const clampedTop = Math.max(0, top);
                    const clampedH   = Math.min(h, totalH - clampedTop);
                    return (
                      <div
                        key={wi}
                        title={`Available ${w.start}–${w.end}`}
                        style={{
                          position: 'absolute',
                          top: clampedTop, left: 3, right: 3, height: clampedH,
                          background: clientPastel(client.name),
                          border:     `1px solid ${clientDarkBorder(client.name)}`,
                          borderRadius: 4, opacity: 0.45, zIndex: 1,
                        }}
                      />
                    );
                  })}

                  {/* Booked sessions (lane-separated) */}
                  {laned.map(({ appt, lane, lanes }) => {
                    const top  = apptTopPx(appt, hourPx);
                    const rawH = apptHPx(appt, hourPx);
                    const h    = Math.max(rawH, 18);
                    if (top >= totalH || top + h <= 0) return null;
                    const clampedTop = Math.max(0, top);
                    return (
                      <SessionTile
                        key={appt.id}
                        appt={appt}
                        flags={sessionFlags.get(appt.id)}
                        clientName={client.name}
                        top={clampedTop}
                        height={h}
                        lane={lane}
                        lanes={lanes}
                        onClick={onSelectAppointment ? () => onSelectAppointment(appt) : undefined}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <DayLegend />
    </div>
  );
}

// ── Week sub-view: vertical time × seven day columns, clients overlapping ──────

function ClientWeekGrid({ date, clients, appointments, companyHolidays, focusIds, bandMin, onScrub, onPickDay, onSelectAppointment }: {
  date: Date;
  clients: Client[];
  appointments: Appointment[];
  companyHolidays: CompanyHoliday[];
  focusIds: Set<string>;
  bandMin: number | null;
  onScrub: (min: number | null) => void;
  onPickDay: (d: Date) => void;
  onSelectAppointment?: (a: Appointment) => void;
}) {
  const weekStart = startOfWeek(date, { weekStartsOn: 1 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const holidayByDate = new Map(companyHolidays.map(h => [h.date, h.name]));

  const { ref: zoomRef, scale, zoomed, reset } = usePinchZoom<HTMLDivElement>();
  const hourPx = HOUR_PX * scale;
  const totalH = totalHpx(hourPx);
  const { elRef, handlers } = useTimeScrub(hourPx, onScrub);

  // Order clients so similar availability sits adjacent (consistent layering).
  const ordered = useMemo(() => clusterByOverlap(clients), [clients]);

  // A tapped time band focuses clients available then (any weekday); otherwise the
  // manual focus set.
  const availableAtBand = useMemo(
    () => bandMin == null ? null : clientsAvailableAt(clients, WEEK_DOWS, bandMin),
    [bandMin, clients],
  );
  const effFocus = availableAtBand ?? focusIds;
  const isDim = (id: string) => effFocus.size > 0 && !effFocus.has(id);
  const isFocused = (id: string) => effFocus.size > 0 && effFocus.has(id);

  // Sessions for visible clients, indexed by day ISO.
  const apptsByDay = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const a of appointments) {
      if (a.isGhost) continue;
      const match = clients.find(c => c.id === a.client || c.name === a.client);
      if (!match) continue;
      const iso = a.startTime.slice(0, 10);
      (map.get(iso) ?? map.set(iso, []).get(iso)!).push(a);
    }
    return map;
  }, [appointments, clients]);

  if (clients.length === 0) return <EmptyPanel />;

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', position: 'relative' }}>
      {zoomed && <ZoomResetPill scale={scale} onReset={reset} />}
      <div ref={zoomRef} style={{
        overflowY: 'auto', overflowX: 'auto', maxHeight: '75vh',
        WebkitOverflowScrolling: 'touch' as any,
      }}>
        <div style={{ minWidth: GUTTER + 7 * WEEK_COL_MIN, display: 'flex', flexDirection: 'column' }}>

          {/* ── Day headers (sticky top) ──────── */}
          <div style={{
            display: 'flex', position: 'sticky', top: 0, zIndex: 20,
            background: '#f9fafb', borderBottom: '2px solid #d1d5db',
            boxShadow: '0 2px 4px rgba(0,0,0,0.06)',
          }}>
            <div style={{ width: GUTTER, flexShrink: 0, position: 'sticky', left: 0, zIndex: 21, borderRight: '2px solid #d1d5db', background: '#f3f4f6' }} />
            {days.map(day => {
              const iso = format(day, 'yyyy-MM-dd');
              const isToday = isSameDay(day, new Date());
              const holiday = holidayByDate.get(iso);
              return (
                <button
                  key={iso}
                  onClick={() => onPickDay(day)}
                  title={holiday ?? format(day, 'EEEE, MMM d')}
                  style={{
                    flex: `1 1 ${WEEK_COL_MIN}px`, minWidth: WEEK_COL_MIN,
                    padding: '6px 6px 5px', textAlign: 'center', cursor: 'pointer',
                    border: 'none', borderLeft: '1px solid #e5e7eb',
                    background: holiday ? 'var(--green-50, #f0fdf4)' : 'transparent',
                    color: isToday ? '#3b82f6' : '#374151',
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                    {format(day, 'EEE')}
                  </div>
                  <div style={{ fontSize: 16, fontWeight: isToday ? 800 : 600 }}>
                    {format(day, 'd')}
                  </div>
                  {holiday && (
                    <div style={{ fontSize: 8.5, color: 'var(--green-700, #15803d)', fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      ✦ {holiday}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* ── Grid body ─────────────────────────── */}
          <div style={{ display: 'flex', position: 'relative' }}>
            <TimeGutter hourPx={hourPx} scrubRef={elRef} scrubHandlers={handlers} />
            <GridRules hourPx={hourPx} />
            {bandMin != null && <GuideLine min={bandMin} hourPx={hourPx} />}

            {days.map((day, di) => {
              const iso = format(day, 'yyyy-MM-dd');
              const dowName = WEEK_DOWS[di];
              const holiday = holidayByDate.get(iso);
              const dayAppts = apptsByDay.get(iso) ?? [];
              return (
                <div
                  key={iso}
                  style={{
                    flex: `1 1 ${WEEK_COL_MIN}px`, minWidth: WEEK_COL_MIN,
                    height: totalH, position: 'relative',
                    borderLeft: di > 0 ? '1px solid #e5e7eb' : undefined,
                    background: holiday ? 'rgba(34,197,94,0.06)' : undefined,
                    zIndex: 2,
                  }}
                >
                  {ordered.map(client => {
                    const dim = isDim(client.id);
                    const focused = isFocused(client.id);
                    const hue = clientHue(client.name);
                    const wins = (client.availabilityWindows?.[dowName]) ?? [];
                    const cAppts = dayAppts.filter(a => a.client === client.id || a.client === client.name);
                    const focusBoost = focused ? 20 : 0;
                    return (
                      <React.Fragment key={client.id}>
                        {/* Availability (backmost translucent layer) */}
                        {wins.map((w, wi) => {
                          const top = winTopPx(w.start, hourPx);
                          const h   = winHPx(w.start, w.end, hourPx);
                          if (h <= 0 || top >= totalH || top + h <= 0) return null;
                          const clampedTop = Math.max(0, top);
                          const clampedH   = Math.min(h, totalH - clampedTop);
                          return (
                            <div key={`a${wi}`} title={`${client.name} available ${w.start}–${w.end}`}
                              style={{
                                position: 'absolute', top: clampedTop, left: 2, right: 2, height: clampedH,
                                background: `hsl(${hue} 70% 88%)`, border: `1px solid hsl(${hue} 48% 76%)`,
                                borderRadius: 4, zIndex: 1 + focusBoost,
                                opacity: dim ? 0.1 : focused ? 0.7 : 0.4,
                                transition: 'opacity 0.15s',
                              }} />
                          );
                        })}
                        {/* Sessions layered by tier */}
                        {cAppts.map(appt => {
                          const top  = apptTopPx(appt, hourPx);
                          const rawH = apptHPx(appt, hourPx);
                          const h    = Math.max(rawH, 14);
                          if (top >= totalH || top + h <= 0) return null;
                          const clampedTop = Math.max(0, top);
                          const tier = tierOf(appt.type);
                          const { inset, z } = TIER_LAYOUT[tier];
                          const canceled = appt.status === 'canceled';
                          const color = tier === 'direct' ? `hsl(${hue} 72% 48%)` : TIER_COLOR[tier];
                          return (
                            <div key={appt.id}
                              onClick={onSelectAppointment ? () => onSelectAppointment(appt) : undefined}
                              title={`${client.name} · ${appt.title}\n${fmtTime(new Date(appt.startTime))}–${fmtTime(new Date(appt.endTime))} · ${TIER_LABEL[tier]}${canceled ? ' (canceled)' : ''}`}
                              style={{
                                position: 'absolute', top: clampedTop + 1, left: inset, right: inset,
                                height: Math.max(h - 2, 12), background: color,
                                border: canceled ? `1.5px solid ${cancelBar(appt.cancellation?.source)}` : '1px solid rgba(255,255,255,0.55)',
                                borderRadius: 3, zIndex: z + focusBoost,
                                opacity: dim ? 0.15 : canceled ? 0.55 : 1,
                                boxShadow: '0 0 0 1px rgba(255,255,255,0.4)',
                                cursor: onSelectAppointment ? 'pointer' : undefined,
                                overflow: 'hidden', boxSizing: 'border-box',
                                textDecoration: canceled ? 'line-through' : 'none',
                                transition: 'opacity 0.15s',
                              }}>
                              {h > 22 && (
                                <span style={{
                                  fontSize: 8.5, fontWeight: 800, color: '#fff', lineHeight: 1.2,
                                  padding: '1px 3px', display: 'block', whiteSpace: 'nowrap',
                                  overflow: 'hidden', textOverflow: 'ellipsis',
                                }}>{client.name}</span>
                              )}
                            </div>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <DayLegend />
    </div>
  );
}

// ── Shared legend ──────────────────────────────────────────────────────────────

function DayLegend() {
  return (
    <div style={{
      display: 'flex', gap: 16, padding: '8px 12px', borderTop: '1px solid #e5e7eb',
      background: '#fafafa', flexWrap: 'wrap', alignItems: 'center',
    }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Legend</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#374151' }}>
        <span style={{ display: 'inline-block', width: 18, height: 14, borderRadius: 3, background: '#d1d5db', opacity: 0.5 }} />
        Availability window
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#374151' }}>
        <span style={{ display: 'inline-block', width: 14, height: 14, borderRadius: 3, background: TIER_COLOR.direct }} /> Direct
        <span style={{ display: 'inline-block', width: 14, height: 14, borderRadius: 3, background: TIER_COLOR.supervision, marginLeft: 6 }} /> Supervision
        <span style={{ display: 'inline-block', width: 14, height: 14, borderRadius: 3, background: TIER_COLOR.parentTraining, marginLeft: 6 }} /> PT
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#374151' }}>
        ✦ Holiday · 🌟 Makeup · ⭐ 2-week star · 🟢 streak · <span style={{ fontWeight: 800 }}>2?</span> cancel run
      </span>
      <span style={{ fontSize: 11, color: '#9ca3af' }}>Tap the time axis to focus who's free · pinch to zoom</span>
    </div>
  );
}
