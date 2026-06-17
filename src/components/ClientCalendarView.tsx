// ClientCalendarView — client-centric (Case) calendar with three sub-views that
// mirror the BCBA/BT calendars:
//   Month — client blackout dates per day cell.
//   Week  — 7-day time grid + embedded Availability & Schedule heatmap.
//   Day   — single day, one column per client (availability fills + session tiles).
// Week and Day grids support scoped pinch-to-zoom (see usePinchZoom): two-finger
// pinch scales the hour height, three-finger tap / pill resets.

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Client, Blackout, Appointment } from '../types';
import { clientPastel, clientDarkBorder, clientAvailBarStyle, tileStyle } from '../calendarColors';
import {
  format, addDays, addWeeks, subWeeks, addMonths, subMonths,
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, isSameDay, isSameMonth,
} from 'date-fns';
import { DAY_S, DAY_E, WEEK_DAYS, SHORT_DAYS, toMin, fmtMin, assignLanes, tierOf, TIER_COLOR } from './clientCalendarShared';
import { usePinchZoom } from '../hooks/usePinchZoom';
import ZoomResetPill from './ZoomResetPill';
import AvailabilityHeatmap from './AvailabilityHeatmap';

const HOUR_PX = 48;     // base pixels per hour (× zoom)
const GUTTER  = 44;     // time-axis gutter width
const COL_MIN = 88;     // week: min day-column width
const DAY_COL_MIN = 116; // day: min client-column width

type Sub = 'month' | 'week' | 'day';

interface Props {
  clients: Client[];
  appointments: Appointment[];
  blackouts: Blackout[];
}

function getWeekDays(d: Date): Date[] {
  const mon = startOfWeek(d, { weekStartsOn: 1 });
  return Array.from({ length: 7 }, (_, i) => addDays(mon, i));
}

const fmtTime = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export default function ClientCalendarView({ clients, appointments, blackouts }: Props) {
  const [sub, setSub] = useState<Sub>('week');
  const [date, setDate] = useState(new Date());
  const [selIds, setSelIds] = useState<Set<string>>(() => new Set(clients.map(c => c.id)));
  const [highlightId, setHighlightId] = useState<string | null>(null);

  useEffect(() => {
    setSelIds(prev => {
      const merged = new Set(prev);
      clients.forEach(c => merged.add(c.id));
      return merged;
    });
  }, [clients]);

  const visible = clients.filter(c => selIds.has(c.id));
  const allSel  = clients.length > 0 && clients.every(c => selIds.has(c.id));
  const noneSel = selIds.size === 0;

  const weekDays = useMemo(() => getWeekDays(date), [date]);
  const weekLabel = (() => {
    const [s, e] = [weekDays[0], weekDays[6]];
    return s.getMonth() === e.getMonth()
      ? format(s, 'MMMM d') + '–' + format(e, 'd, yyyy')
      : format(s, 'MMM d') + ' – ' + format(e, 'MMM d, yyyy');
  })();

  const goPrev = () => setDate(d => sub === 'month' ? subMonths(d, 1) : sub === 'week' ? subWeeks(d, 1) : addDays(d, -1));
  const goNext = () => setDate(d => sub === 'month' ? addMonths(d, 1) : sub === 'week' ? addWeeks(d, 1) : addDays(d, 1));

  return (
    <div style={{ padding: 'clamp(8px,3vw,24px)', boxSizing: 'border-box' }}>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ display: 'flex', border: '1px solid #d1d5db', borderRadius: 6, overflow: 'hidden' }}>
          {(['month', 'week', 'day'] as Sub[]).map(v => (
            <button key={v} onClick={() => setSub(v)} style={{
              padding: '6px 14px', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
              background: sub === v ? '#3b82f6' : 'white', color: sub === v ? 'white' : '#374151',
            }}>{v[0].toUpperCase() + v.slice(1)}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
          {[{ label: '←', fn: goPrev }, { label: 'Today', fn: () => setDate(new Date()) }, { label: '→', fn: goNext }].map(({ label, fn }) => (
            <button key={label} onClick={fn} style={{
              padding: '6px 12px', background: '#e5e7eb', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13,
            }}>{label}</button>
          ))}
        </div>
      </div>

      {/* Heading */}
      <h2 style={{ fontSize: 17, fontWeight: 700, margin: '0 0 10px', textAlign: 'center', color: '#111827' }}>
        {sub === 'month' ? format(date, 'MMMM yyyy') : sub === 'week' ? weekLabel : format(date, 'EEEE, MMMM d, yyyy')}
      </h2>

      {/* Client filter pills */}
      <div style={{ display: 'flex', gap: 5, overflowX: 'auto', paddingBottom: 6, marginBottom: 10, flexWrap: 'nowrap', WebkitOverflowScrolling: 'touch' as any }}>
        <Pill active={allSel}  color="#3b82f6" onClick={() => setSelIds(new Set(clients.map(c => c.id)))}>All</Pill>
        <Pill active={noneSel} color="#6b7280" onClick={() => setSelIds(new Set())}>None</Pill>
        {clients.map(c => {
          const s = clientAvailBarStyle(c.name);
          const on = selIds.has(c.id);
          return (
            <button key={c.id}
              onClick={() => setSelIds(prev => { const n = new Set(prev); on ? n.delete(c.id) : n.add(c.id); return n; })}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 14, flexShrink: 0,
                border: on ? `2px solid ${s.borderColor}` : '1px solid #d1d5db',
                background: on ? s.backgroundColor : '#f9fafb', color: on ? s.color : '#6b7280',
                cursor: 'pointer', fontSize: 12, fontWeight: on ? 700 : 500, whiteSpace: 'nowrap',
              }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: on ? s.borderColor : '#d1d5db' }} />
              {c.name}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {sub === 'month' && (
        <ClientMonthView date={date} blackouts={blackouts} clients={visible}
          onPickDay={d => { setDate(d); setSub('day'); }} />
      )}
      {sub === 'week' && (
        <>
          <WeekTimeGrid days={weekDays} clients={visible} appointments={appointments} blackouts={blackouts} highlightId={highlightId} />
          <AvailabilityHeatmap days={weekDays} clients={visible} appointments={appointments} highlightId={highlightId} onHighlight={setHighlightId} />
        </>
      )}
      {sub === 'day' && (
        <DayClientGrid date={date} clients={visible} appointments={appointments} blackouts={blackouts} />
      )}
    </div>
  );
}

// ── Pill ─────────────────────────────────────────────────────────────────────
function Pill({ active, color, onClick, children }: {
  active: boolean; color: string; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} style={{
      padding: '4px 12px', borderRadius: 14, flexShrink: 0, whiteSpace: 'nowrap',
      border: active ? 'none' : '1px solid #d1d5db', background: active ? color : '#f9fafb',
      color: active ? 'white' : '#374151', cursor: 'pointer', fontSize: 12, fontWeight: 600,
    }}>{children}</button>
  );
}

// ── Month ───────────────────────────────────────────────────────────────────
function ClientMonthView({ date, blackouts, clients, onPickDay }: {
  date: Date; blackouts: Blackout[]; clients: Client[]; onPickDay: (d: Date) => void;
}) {
  const gridStart = startOfWeek(startOfMonth(date), { weekStartsOn: 1 });
  const gridEnd   = endOfWeek(endOfMonth(date), { weekStartsOn: 1 });
  const days      = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const clientIds = new Set(clients.map(c => c.id));

  if (clients.length === 0) return <EmptyState />;

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
          <div key={d} style={{ padding: '8px 4px', textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#374151' }}>{d}</div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, background: '#e5e7eb' }}>
        {days.map(day => {
          const iso     = format(day, 'yyyy-MM-dd');
          const dayouts = blackouts.filter(b => b.date === iso && b.entityType === 'client' && clientIds.has(b.entityId));
          const inMonth = isSameMonth(day, date);
          const isToday = isSameDay(day, new Date());
          return (
            <div key={iso} onClick={() => onPickDay(day)} style={{
              background: inMonth ? '#fff' : '#f8f8f8', minHeight: 96, padding: '5px 5px 4px', cursor: 'pointer',
              opacity: inMonth ? 1 : 0.4, borderTop: isToday ? '3px solid #3b82f6' : '3px solid transparent',
            }}>
              <div style={{ fontSize: 13, fontWeight: isToday ? 700 : 400, color: isToday ? '#3b82f6' : '#374151', marginBottom: 4 }}>
                {format(day, 'd')}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {dayouts.map(b => {
                  const client = clients.find(c => c.id === b.entityId);
                  if (!client) return null;
                  const s = clientAvailBarStyle(client.name);
                  return (
                    <div key={b.id} title={b.reason ? `Blackout: ${b.reason}` : 'Blackout'} style={{
                      fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 8,
                      background: s.backgroundColor, border: `1px solid ${s.borderColor}`, color: s.color,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>🚫 {client.name}</div>
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

// ── Week time grid (days as columns) ──────────────────────────────────────────
function WeekTimeGrid({ days, clients, appointments, blackouts, highlightId }: {
  days: Date[]; clients: Client[]; appointments: Appointment[]; blackouts: Blackout[]; highlightId: string | null;
}) {
  const { ref: zoomRef, scale: zoom, zoomed, reset } = usePinchZoom();
  const hourPx = HOUR_PX * zoom;
  const totalH = (DAY_E - DAY_S) * hourPx;
  const hours  = Array.from({ length: DAY_E - DAY_S }, (_, i) => DAY_S + i);
  const today  = new Date();
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!bodyRef.current) return;
    const now = new Date();
    bodyRef.current.scrollTop = Math.max(0, (now.getHours() - 1 - DAY_S) * hourPx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const weekAppts = useMemo(() => {
    const s = format(days[0], 'yyyy-MM-dd'), e = format(days[6], 'yyyy-MM-dd');
    return appointments.filter(a => {
      const d = a.startTime.slice(0, 10);
      return d >= s && d <= e && a.status !== 'canceled' && !a.isGhost;
    });
  }, [appointments, days]);

  if (clients.length === 0) return <EmptyState />;

  const topPx = (h: number, m: number) => (h + m / 60 - DAY_S) * hourPx;
  const aptTop = (a: Appointment) => { const d = new Date(a.startTime); return topPx(d.getHours(), d.getMinutes()); };
  const aptH = (a: Appointment) => Math.max(16, (new Date(a.endTime).getTime() - new Date(a.startTime).getTime()) / 3_600_000 * hourPx);

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', marginBottom: 12, background: 'white' }}>
      {zoomed && <ZoomResetPill scale={zoom} onReset={reset} />}
      <div ref={zoomRef} style={{ overflowX: 'auto', touchAction: 'pan-x pan-y', WebkitOverflowScrolling: 'touch' as any }}>
        <div style={{ minWidth: GUTTER + days.length * COL_MIN, display: 'flex', flexDirection: 'column' }}>

          {/* Sticky day headers */}
          <div style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #d1d5db', background: '#f9fafb' }}>
            <div style={{ width: GUTTER, flexShrink: 0, borderRight: '2px solid #d1d5db', position: 'sticky', left: 0, zIndex: 2, background: '#f3f4f6' }} />
            {days.map((day, di) => {
              const isToday = isSameDay(day, today);
              const iso = format(day, 'yyyy-MM-dd');
              const hasBlackout = clients.some(c => blackouts.some(b => b.date === iso && b.entityType === 'client' && b.entityId === c.id));
              return (
                <div key={iso} style={{
                  flex: 1, minWidth: COL_MIN, padding: '6px 4px', textAlign: 'center',
                  background: isToday ? '#eff6ff' : hasBlackout ? '#fef2f2' : 'white',
                  borderLeft: di > 0 ? '1px solid #e5e7eb' : 'none',
                }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: isToday ? '#3b82f6' : '#6b7280' }}>{SHORT_DAYS[di]}</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: isToday ? '#3b82f6' : '#1f2937' }}>{format(day, 'd')}</div>
                </div>
              );
            })}
          </div>

          {/* Body */}
          <div ref={bodyRef} style={{ overflowY: 'auto', maxHeight: '52vh' }}>
            <div style={{ display: 'flex', position: 'relative' }}>
              {/* gutter */}
              <div style={{ width: GUTTER, flexShrink: 0, position: 'sticky', left: 0, zIndex: 3, background: '#f9fafb', borderRight: '2px solid #d1d5db', height: totalH }}>
                {hours.map(h => (
                  <div key={h} style={{ position: 'absolute', top: (h - DAY_S) * hourPx - (h === DAY_S ? 0 : 6), width: '100%', textAlign: 'right', paddingRight: 6, fontSize: 10, fontWeight: 600, color: '#9ca3af' }}>
                    {h === 12 ? '12p' : h > 12 ? `${h - 12}p` : `${h}a`}
                  </div>
                ))}
              </div>
              {/* hour lines */}
              <div style={{ position: 'absolute', left: GUTTER, right: 0, top: 0, bottom: 0, zIndex: 0, pointerEvents: 'none' }}>
                {hours.map(h => h > DAY_S && <div key={h} style={{ position: 'absolute', left: 0, right: 0, top: (h - DAY_S) * hourPx, borderTop: `1px solid ${h % 3 === 0 ? '#d1d5db' : '#eee'}` }} />)}
              </div>
              {/* columns */}
              {days.map((day, di) => {
                const iso = format(day, 'yyyy-MM-dd');
                const dow = WEEK_DAYS[di];
                const isToday = isSameDay(day, today);
                const dayAppts = weekAppts.filter(a => a.startTime.startsWith(iso));
                const availFrac = hours.map(h => {
                  const slotMin = h * 60;
                  return clients.filter(c => (c.availabilityWindows[dow] ?? []).some(w => toMin(w.start) <= slotMin + 60 && toMin(w.end) > slotMin)).length / Math.max(1, clients.length);
                });
                const nowTop = isToday ? topPx(today.getHours(), today.getMinutes()) : -1;
                return (
                  <div key={iso} style={{ flex: 1, minWidth: COL_MIN, height: totalH, position: 'relative', zIndex: 1, borderLeft: di > 0 ? '1px solid #e5e7eb' : 'none' }}>
                    {hours.map((h, hi) => availFrac[hi] > 0 && (
                      <div key={h} style={{ position: 'absolute', left: 0, right: 0, top: (h - DAY_S) * hourPx, height: hourPx, background: `rgba(59,130,246,${(0.04 + availFrac[hi] * 0.09).toFixed(2)})`, pointerEvents: 'none' }} />
                    ))}
                    {nowTop >= 0 && nowTop <= totalH && (
                      <div style={{ position: 'absolute', left: 0, right: 0, top: nowTop, zIndex: 4, pointerEvents: 'none' }}>
                        <div style={{ position: 'absolute', left: -3, top: -4, width: 8, height: 8, borderRadius: '50%', background: '#ef4444' }} />
                        <div style={{ height: 2, background: '#ef4444' }} />
                      </div>
                    )}
                    {dayAppts.map(appt => {
                      const client = clients.find(c => c.id === appt.client || c.name === appt.client);
                      if (!client) return null;
                      const top = aptTop(appt), h = aptH(appt);
                      if (top >= totalH || top + h <= 0) return null;
                      const isLit = highlightId === null || highlightId === client.id;
                      return (
                        <div key={appt.id} title={`${client.name}: ${appt.title}\n${fmtTime(new Date(appt.startTime))}–${fmtTime(new Date(appt.endTime))}`}
                          style={{
                            position: 'absolute', top: Math.max(0, top) + 1, left: 3, right: 3, height: h - 2,
                            ...tileStyle(client.name, appt.technician), border: `1.5px solid ${clientDarkBorder(client.name)}`,
                            borderRadius: 4, overflow: 'hidden', zIndex: 2, padding: '2px 4px', boxSizing: 'border-box',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.12)', opacity: isLit ? 1 : 0.18, transition: 'opacity 0.15s',
                          }}>
                          {h > 22 && <div style={{ fontSize: 10, fontWeight: 700, lineHeight: 1.2, color: '#1e3a5f', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{client.name}</div>}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Day grid (clients as columns) ─────────────────────────────────────────────
function DayClientGrid({ date, clients, appointments, blackouts }: {
  date: Date; clients: Client[]; appointments: Appointment[]; blackouts: Blackout[];
}) {
  const { ref: zoomRef, scale: zoom, zoomed, reset } = usePinchZoom();
  const hourPx = HOUR_PX * zoom;
  const totalH = (DAY_E - DAY_S) * hourPx;
  const hours  = Array.from({ length: DAY_E - DAY_S }, (_, i) => DAY_S + i);
  const iso = format(date, 'yyyy-MM-dd');
  const dow = WEEK_DAYS[(date.getDay() + 6) % 7];
  const today = new Date();
  const isToday = isSameDay(date, today);

  const dayAppts = useMemo(() =>
    appointments.filter(a => a.startTime.startsWith(iso) && a.status !== 'canceled' && !a.isGhost),
  [appointments, iso]);

  if (clients.length === 0) return <EmptyState />;

  const topPx = (h: number, m: number) => (h + m / 60 - DAY_S) * hourPx;
  const winTop = (t: string) => { const [h, m] = t.split(':').map(Number); return topPx(h, m); };
  const winH = (s: string, e: string) => { const [sh, sm] = s.split(':').map(Number); const [eh, em] = e.split(':').map(Number); return ((eh + em / 60) - (sh + sm / 60)) * hourPx; };
  const aptTop = (a: Appointment) => { const d = new Date(a.startTime); return topPx(d.getHours(), d.getMinutes()); };
  const aptH = (a: Appointment) => Math.max(16, (new Date(a.endTime).getTime() - new Date(a.startTime).getTime()) / 3_600_000 * hourPx);
  const nowTop = isToday ? topPx(today.getHours(), today.getMinutes()) : -1;

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', background: 'white' }}>
      {zoomed && <ZoomResetPill scale={zoom} onReset={reset} />}
      <div ref={zoomRef} style={{ overflowX: 'auto', touchAction: 'pan-x pan-y', WebkitOverflowScrolling: 'touch' as any }}>
        <div style={{ minWidth: GUTTER + clients.length * DAY_COL_MIN, display: 'flex', flexDirection: 'column' }}>

          {/* Sticky client headers */}
          <div style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #d1d5db', background: '#f9fafb' }}>
            <div style={{ width: GUTTER, flexShrink: 0, borderRight: '2px solid #d1d5db', position: 'sticky', left: 0, zIndex: 2, background: '#f3f4f6' }} />
            {clients.map((c, ci) => {
              const s = clientAvailBarStyle(c.name);
              const hasBlackout = blackouts.some(b => b.date === iso && b.entityType === 'client' && b.entityId === c.id);
              // Availability window times live in the HEADER as text, so a
              // session card in the grid can never cover them.
              const wins = c.availabilityWindows[dow] ?? [];
              const winText = wins.length ? wins.map(w => `${fmtMin(toMin(w.start))}–${fmtMin(toMin(w.end))}`).join(' · ') : '—';
              return (
                <div key={c.id} style={{ flex: 1, minWidth: DAY_COL_MIN, padding: '6px 6px 5px', textAlign: 'center', borderLeft: ci > 0 ? '1px solid #e5e7eb' : 'none', background: hasBlackout ? '#fef2f2' : 'transparent' }}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, maxWidth: '100%' }}>
                    <span style={{ width: 9, height: 9, borderRadius: '50%', background: s.borderColor, flexShrink: 0 }} />
                    <span style={{ fontSize: 12, fontWeight: 700, color: s.color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                  </div>
                  {hasBlackout
                    ? <div style={{ fontSize: 9, color: '#b91c1c', fontWeight: 700, marginTop: 1 }}>🚫 BLACKOUT</div>
                    : <div style={{ fontSize: 9, color: '#64748b', marginTop: 1, lineHeight: 1.2 }}>{winText}</div>}
                </div>
              );
            })}
          </div>

          {/* Body */}
          <div style={{ overflowY: 'auto', maxHeight: '68vh' }}>
            <div style={{ display: 'flex', position: 'relative' }}>
              <div style={{ width: GUTTER, flexShrink: 0, position: 'sticky', left: 0, zIndex: 3, background: '#f9fafb', borderRight: '2px solid #d1d5db', height: totalH }}>
                {hours.map(h => (
                  <div key={h} style={{ position: 'absolute', top: (h - DAY_S) * hourPx - (h === DAY_S ? 0 : 6), width: '100%', textAlign: 'right', paddingRight: 6, fontSize: 10, fontWeight: 600, color: '#9ca3af' }}>
                    {h === 12 ? '12p' : h > 12 ? `${h - 12}p` : `${h}a`}
                  </div>
                ))}
              </div>
              <div style={{ position: 'absolute', left: GUTTER, right: 0, top: 0, bottom: 0, zIndex: 0, pointerEvents: 'none' }}>
                {hours.map(h => h > DAY_S && <div key={h} style={{ position: 'absolute', left: 0, right: 0, top: (h - DAY_S) * hourPx, borderTop: `1px solid ${h % 3 === 0 ? '#d1d5db' : '#eee'}` }} />)}
              </div>
              {clients.map((client, ci) => {
                const windows = client.availabilityWindows[dow] ?? [];
                const cAppts = dayAppts.filter(a => a.client === client.id || a.client === client.name);
                return (
                  <div key={client.id} style={{ flex: 1, minWidth: DAY_COL_MIN, height: totalH, position: 'relative', borderLeft: ci > 0 ? '1px solid #e5e7eb' : undefined, zIndex: 1 }}>
                    {windows.map((w, wi) => {
                      const top = winTop(w.start), h = winH(w.start, w.end);
                      if (h <= 0 || top >= totalH || top + h <= 0) return null;
                      const ct = Math.max(0, top);
                      return <div key={wi} title={`Available ${w.start}–${w.end}`} style={{ position: 'absolute', top: ct, left: 3, right: 3, height: Math.min(h, totalH - ct), background: clientPastel(client.name), border: `1px solid ${clientDarkBorder(client.name)}`, borderRadius: 4, opacity: 0.45, zIndex: 1 }} />;
                    })}
                    {nowTop >= 0 && nowTop <= totalH && (
                      <div style={{ position: 'absolute', left: 0, right: 0, top: nowTop, zIndex: 4, pointerEvents: 'none' }}>
                        <div style={{ height: 2, background: '#ef4444' }} />
                      </div>
                    )}
                    {laidOut(cAppts).map(item => {
                      const appt = item.appt;
                      const top = aptTop(appt), h = Math.max(aptH(appt), 16);
                      if (top >= totalH || top + h <= 0) return null;
                      const ct = Math.max(0, top);
                      const laneW = 100 / item.lanes;
                      const isDirect = appt.type === 'client-session';
                      const tier = tierOf(appt.type);
                      const borderColor = isDirect ? clientDarkBorder(client.name) : TIER_COLOR[tier];
                      const blockStyle = isDirect
                        ? tileStyle(client.name, appt.technician)
                        : { backgroundColor: TIER_COLOR[tier], backgroundImage: undefined as string | undefined };
                      const textColor = isDirect ? '#1e3a5f' : '#fff';
                      const marker = recurrenceMarker(appt, appointments, iso);
                      return (
                        <div key={appt.id} title={`${appt.title}\n${fmtTime(new Date(appt.startTime))}–${fmtTime(new Date(appt.endTime))}\n${marker}`}
                          style={{
                            position: 'absolute', top: ct + 1, height: Math.max(h - 2, 14),
                            left: `calc(${item.lane * laneW}% + 4px)`, width: `calc(${laneW}% - 6px)`,
                            ...blockStyle, border: `1.5px solid ${borderColor}`, borderRadius: 5,
                            overflow: 'hidden', zIndex: 3, boxSizing: 'border-box', padding: '2px 4px',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.14)',
                          }}>
                          {/* text foremost + clipped to this tile (never spills into another type's square) */}
                          <div style={{ position: 'relative', zIndex: 5, color: textColor, overflow: 'hidden' }}>
                            {h > 22 && <div style={{ fontSize: 9.5, fontWeight: 800, lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{appt.title}</div>}
                            <div style={{ fontSize: 8.5, fontWeight: 600, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{marker}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── helpers ───────────────────────────────────────────────────────────────────

// Lane-lay a day's sessions for one client so overlapping sessions sit
// side-by-side (ordered by start time, then alphabetically) rather than stacking
// on top of each other — so every tile keeps its own square and readable text.
function laidOut(appts: Appointment[]) {
  return assignLanes(appts.map(a => {
    const s = new Date(a.startTime), e = new Date(a.endTime);
    return {
      appt: a,
      startMin: s.getHours() * 60 + s.getMinutes(),
      endMin: e.getHours() * 60 + e.getMinutes(),
      sortKey: (a.title || a.type || '').toLowerCase(),
    };
  }));
}

const PATTERN_SHORT: Record<string, string> = { weekly: 'wk', biweekly: '2wk', monthly: 'mo' };

// One-time → 1️⃣. Recurring → "N 🔁 wk 8/14" = occurrences left from the viewed
// date · pattern · series end date. Counts/end come from sibling occurrences
// (same seriesId) in the full appointment list.
function recurrenceMarker(appt: Appointment, all: Appointment[], viewedISO: string): string {
  const recurring = appt.isRecurring || !!appt.seriesId;
  if (!recurring) return '1️⃣';
  const series = appt.seriesId ? all.filter(a => a.seriesId === appt.seriesId) : [appt];
  const future = series.filter(a => a.startTime.slice(0, 10) >= viewedISO && a.status !== 'canceled');
  const left = future.length || 1;
  const endISO = series.reduce((mx, a) => (a.startTime.slice(0, 10) > mx ? a.startTime.slice(0, 10) : mx), '');
  const pat = PATTERN_SHORT[appt.recurringPattern || 'weekly'] || 'wk';
  const end = endISO ? format(new Date(endISO + 'T00:00:00'), 'M/d') : '';
  return `${left} 🔁 ${pat}${end ? ` ${end}` : ''}`;
}

function EmptyState() {
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, textAlign: 'center', padding: '64px 20px', color: '#9ca3af', fontSize: 14 }}>
      No clients selected. Choose clients using the filter above.
    </div>
  );
}
