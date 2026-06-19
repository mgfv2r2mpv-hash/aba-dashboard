// ClientCalendarView — top-level client-centric schedule view.
//
// Month sub-view: blackout dates only per client (no appointments).
// Day/Week sub-view: vertical time axis × horizontal client columns.
//   - Availability windows: translucent pastel vertical fills.
//   - Direct-service sessions (client-session): candy-stripe tileStyle.
//   - Other sessions (supervision, PT, case-planning…): solid fill.
//   - Heatmap always on in day/week views (red overlay shows busy slots).
// Client filter: All / None / individual pills — defaults all selected.
// Navigation is controlled entirely by the outer Calendar toolbar.

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Client, Blackout, Appointment, DayOfWeek,
} from '../types';
import {
  clientPastel, clientDarkBorder, clientAvailBarStyle, tileStyle,
} from '../calendarColors';
import {
  format, addDays,
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, isSameDay, isSameMonth,
} from 'date-fns';
import {
  DAY_S, DAY_E, WEEK_DAYS, SHORT_DAYS, toMin, tierOf, TIER_COLOR,
} from './clientCalendarShared';
import { usePinchZoom } from '../hooks/usePinchZoom';
import ZoomResetPill from './ZoomResetPill';
import AvailabilityHeatmap from './AvailabilityHeatmap';

const DAY_START = 6;
const DAY_END   = 22;
const HOUR_PX   = 80;   // taller than BCBA calendar → more scroll, larger bands
const GUTTER    = 56;   // time axis width
const COL_MIN   = 140;  // min client column width

interface Props {
  clients: Client[];
  appointments: Appointment[];
  blackouts: Blackout[];
  view: 'month' | 'week' | 'day';
  date: Date;
  onPickDay: (d: Date) => void;
}

export default function ClientCalendarView({ clients, appointments, blackouts, view, date, onPickDay }: Props) {
  // Heatmap is always on in day/week views — no toggle needed.
  const heatmap = view !== 'month';

  const [selIds, setSelIds] = useState<Set<string>>(
    () => new Set(clients.map(c => c.id)),
  );
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [fadedTier, setFadedTier] = useState<SessionTier | null>(null);
  const [fadedClients, setFadedClients] = useState<Set<string>>(new Set());

  const onFadeClient = (clientId: string) => {
    setFadedClients(prev => {
      const next = new Set(prev);
      if (next.size === 0) {
        // First selection: fade all except this client
        visible.forEach(c => {
          if (c.id !== clientId) next.add(c.id);
        });
      } else if (next.has(clientId)) {
        // Already faded: unfade it
        next.delete(clientId);
      } else {
        // Not faded: fade it
        next.add(clientId);
      }
      return next;
    });
  };

  const onClearFadedClients = () => {
    setFadedClients(new Set());
  };

  const weekDays = useMemo(() => {
    const mon = startOfWeek(date, { weekStartsOn: 1 });
    return Array.from({ length: 7 }, (_, i) => addDays(mon, i));
  }, [date]);

  // Keep any newly-added clients selected by default
  useEffect(() => {
    setSelIds(prev => {
      const merged = new Set(prev);
      clients.forEach(c => merged.add(c.id));
      return merged;
    });
  }, [clients]);

  const visible   = clients.filter(c => selIds.has(c.id));
  const allSel    = clients.length > 0 && clients.every(c => selIds.has(c.id));
  const noneSel   = selIds.size === 0;

  return (
    <div style={{ padding: 'clamp(8px,3vw,24px)', boxSizing: 'border-box' }}>

      {/* ── Client filter pills ────────────────────────────── */}
      <div style={{
        display: 'flex', gap: 5, overflowX: 'auto', paddingBottom: 6, marginBottom: 10,
        flexWrap: 'nowrap', WebkitOverflowScrolling: 'touch' as any,
      }}>
        <Pill active={allSel} color="#3b82f6"
          onClick={() => setSelIds(new Set(clients.map(c => c.id)))}>
          All
        </Pill>
        <Pill active={noneSel} color="#6b7280"
          onClick={() => setSelIds(new Set())}>
          None
        </Pill>
        {clients.map(c => {
          const s   = clientAvailBarStyle(c.name);
          const on  = selIds.has(c.id);
          return (
            <button
              key={c.id}
              onClick={() => setSelIds(prev => {
                const n = new Set(prev);
                on ? n.delete(c.id) : n.add(c.id);
                return n;
              })}
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

      {/* ── Content ──────────────────────────────────────── */}
      {view === 'month' && (
        <ClientMonthView
          date={date}
          blackouts={blackouts}
          clients={visible}
          onPickDay={onPickDay}
        />
      )}
      {view === 'week' && (
        <>
          <WeekTimeGrid
            days={weekDays}
            clients={visible}
            appointments={appointments}
            blackouts={blackouts}
            highlightId={highlightId}
            fadedTier={fadedTier}
            onFadeTier={setFadedTier}
          />
          <AvailabilityHeatmap
            days={weekDays}
            clients={visible}
            appointments={appointments}
            highlightId={highlightId}
            onHighlight={setHighlightId}
            fadedTier={fadedTier}
            onFadeTier={setFadedTier}
            fadedClients={fadedClients}
            onFadeClient={onFadeClient}
            onClearFadedClients={onClearFadedClients}
          />
        </>
      )}
      {view === 'day' && (
        <ClientDayGrid
          date={date}
          clients={visible}
          appointments={appointments}
          blackouts={blackouts}
          heatmap={heatmap}
        />
      )}
    </div>
  );
}

// ── Pill helper ────────────────────────────────────────────────────────────────

function Pill({ active, color, onClick, children }: {
  active: boolean; color: string; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} style={{
      padding: '4px 12px', borderRadius: 14, flexShrink: 0, whiteSpace: 'nowrap',
      border:      active ? 'none' : '1px solid #d1d5db',
      background:  active ? color : '#f9fafb',
      color:       active ? 'white' : '#374151',
      cursor: 'pointer', fontSize: 12, fontWeight: 600,
    }}>{children}</button>
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
    return (
      <div style={{
        border: '1px solid #e5e7eb', borderRadius: 8,
        textAlign: 'center', padding: '64px 20px', color: '#9ca3af', fontSize: 14,
      }}>
        No clients selected. Choose clients using the filter above.
      </div>
    );
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

// ── Week time grid (days as columns, dual heatmap: blue avail + red density) ──

const WEEK_HOUR_PX = 48;
const WEEK_GUTTER  = 44;
const WEEK_COL_MIN = 88;

function WeekTimeGrid({ days, clients, appointments, blackouts, highlightId, fadedTier, onFadeTier }: {
  days: Date[];
  clients: Client[];
  appointments: Appointment[];
  blackouts: Blackout[];
  highlightId: string | null;
}) {
  const { ref: zoomRef, scale: zoom, zoomed, reset } = usePinchZoom<HTMLDivElement>();
  const hourPx = WEEK_HOUR_PX * zoom;
  const totalH = (DAY_E - DAY_S) * hourPx;
  const hours  = Array.from({ length: DAY_E - DAY_S }, (_, i) => DAY_S + i);
  const today  = new Date();
  const bodyRef = useRef<HTMLDivElement>(null);

  // Scroll to current time on mount
  useEffect(() => {
    if (!bodyRef.current) return;
    const now = new Date();
    bodyRef.current.scrollTop = Math.max(0, (now.getHours() - 1 - DAY_S) * hourPx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const weekAppts = useMemo(() => {
    const s = format(days[0], 'yyyy-MM-dd');
    const e = format(days[6], 'yyyy-MM-dd');
    return appointments.filter(a => {
      const d = a.startTime.slice(0, 10);
      return d >= s && d <= e && a.status !== 'canceled' && !a.isGhost;
    });
  }, [appointments, days]);

  if (clients.length === 0) {
    return (
      <div style={{
        border: '1px solid #e5e7eb', borderRadius: 8,
        textAlign: 'center', padding: '64px 20px', color: '#9ca3af', fontSize: 14,
      }}>
        No clients selected. Choose clients using the filter above.
      </div>
    );
  }

  const topPx = (h: number, m: number) => (h + m / 60 - DAY_S) * hourPx;
  const aptTop = (a: Appointment) => { const d = new Date(a.startTime); return topPx(d.getHours(), d.getMinutes()); };
  const aptH   = (a: Appointment) => Math.max(16, (new Date(a.endTime).getTime() - new Date(a.startTime).getTime()) / 3_600_000 * hourPx);

  return (
    <div style={{ width: '100%', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', marginBottom: 12, background: 'white' }}>
      {zoomed && <ZoomResetPill scale={zoom} onReset={reset} />}
      <div ref={zoomRef} style={{ width: '100%', overflowX: 'auto', touchAction: 'pan-x pan-y', WebkitOverflowScrolling: 'touch' as any }}>
        <div style={{ minWidth: WEEK_GUTTER + days.length * WEEK_COL_MIN, display: 'flex', flexDirection: 'column' }}>

          {/* Sticky day headers */}
          <div style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #d1d5db', background: '#f9fafb' }}>
            <div style={{ width: WEEK_GUTTER, flexShrink: 0, borderRight: '2px solid #d1d5db', position: 'sticky', left: 0, zIndex: 2, background: '#f3f4f6' }} />
            {days.map((day, di) => {
              const isToday = isSameDay(day, today);
              const iso = format(day, 'yyyy-MM-dd');
              const hasBlackout = clients.some(c => blackouts.some(b => b.date === iso && b.entityType === 'client' && b.entityId === c.id));
              return (
                <div key={iso} style={{
                  flex: 1, minWidth: WEEK_COL_MIN, padding: '6px 4px', textAlign: 'center',
                  background: isToday ? '#eff6ff' : hasBlackout ? '#fef2f2' : 'white',
                  borderLeft: di > 0 ? '1px solid #e5e7eb' : 'none',
                }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: isToday ? '#3b82f6' : '#6b7280' }}>{SHORT_DAYS[di]}</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: isToday ? '#3b82f6' : '#1f2937' }}>{format(day, 'd')}</div>
                </div>
              );
            })}
          </div>

          {/* Scrollable body */}
          <div ref={bodyRef} style={{ overflowY: 'auto', maxHeight: '52vh' }}>
            <div style={{ display: 'flex', position: 'relative' }}>

              {/* Time gutter */}
              <div style={{ width: WEEK_GUTTER, flexShrink: 0, position: 'sticky', left: 0, zIndex: 3, background: '#f9fafb', borderRight: '2px solid #d1d5db', height: totalH }}>
                {hours.map(h => (
                  <div key={h} style={{ position: 'absolute', top: (h - DAY_S) * hourPx - (h === DAY_S ? 0 : 6), width: '100%', textAlign: 'right', paddingRight: 6, fontSize: 10, fontWeight: 600, color: '#9ca3af' }}>
                    {h === 12 ? '12p' : h > 12 ? `${h - 12}p` : `${h}a`}
                  </div>
                ))}
              </div>

              {/* Hour lines (full-width) */}
              <div style={{ position: 'absolute', left: WEEK_GUTTER, right: 0, top: 0, bottom: 0, zIndex: 0, pointerEvents: 'none' }}>
                {hours.map(h => h > DAY_S && (
                  <div key={h} style={{ position: 'absolute', left: 0, right: 0, top: (h - DAY_S) * hourPx, borderTop: `1px solid ${h % 3 === 0 ? '#d1d5db' : '#eee'}` }} />
                ))}
              </div>

              {/* Day columns */}
              {days.map((day, di) => {
                const iso = format(day, 'yyyy-MM-dd');
                const dow = WEEK_DAYS[di];
                const isToday = isSameDay(day, today);
                const dayAppts = weekAppts.filter(a => a.startTime.startsWith(iso));

                // Blue availability heatmap: fraction of clients available per hour slot
                const availFrac = hours.map(h => {
                  const slotMin = h * 60;
                  return clients.filter(c =>
                    (c.availabilityWindows[dow] ?? []).some(
                      w => toMin(w.start) <= slotMin + 60 && toMin(w.end) > slotMin,
                    ),
                  ).length / Math.max(1, clients.length);
                });

                // Red session density heatmap: count bookings per 30-min slot
                const slotCount = (DAY_E - DAY_S) * 2;
                const heatCounts = new Array(slotCount).fill(0);
                for (const a of dayAppts) {
                  const s = new Date(a.startTime);
                  const e = new Date(a.endTime);
                  const s0 = Math.max(0, Math.floor((s.getHours() * 60 + s.getMinutes() - DAY_S * 60) / 30));
                  const e0 = Math.min(slotCount, Math.ceil((e.getHours() * 60 + e.getMinutes() - DAY_S * 60) / 30));
                  for (let i = s0; i < e0; i++) heatCounts[i]++;
                }
                const maxHeat = Math.max(1, ...heatCounts);

                const nowTop = isToday ? topPx(today.getHours(), today.getMinutes()) : -1;

                return (
                  <div key={iso} style={{ flex: 1, minWidth: WEEK_COL_MIN, height: totalH, position: 'relative', zIndex: 1, borderLeft: di > 0 ? '1px solid #e5e7eb' : 'none' }}>

                    {/* Blue: availability heatmap */}
                    {hours.map((h, hi) => availFrac[hi] > 0 && (
                      <div key={`avail-${h}`} style={{
                        position: 'absolute', left: 0, right: 0,
                        top: (h - DAY_S) * hourPx, height: hourPx,
                        background: `rgba(59,130,246,${(0.04 + availFrac[hi] * 0.09).toFixed(2)})`,
                        pointerEvents: 'none',
                      }} />
                    ))}

                    {/* Red: session density heatmap */}
                    {heatCounts.map((count, i) => count > 0 && (
                      <div key={`heat-${i}`} style={{
                        position: 'absolute', left: 0, right: 0,
                        top: i * hourPx / 2, height: hourPx / 2,
                        background: `rgba(220,38,38,${(0.05 + (count / maxHeat) * 0.40).toFixed(2)})`,
                        pointerEvents: 'none',
                      }} />
                    ))}

                    {/* Now indicator */}
                    {nowTop >= 0 && nowTop <= totalH && (
                      <div style={{ position: 'absolute', left: 0, right: 0, top: nowTop, zIndex: 4, pointerEvents: 'none' }}>
                        <div style={{ position: 'absolute', left: -3, top: -4, width: 8, height: 8, borderRadius: '50%', background: '#ef4444' }} />
                        <div style={{ height: 2, background: '#ef4444' }} />
                      </div>
                    )}

                    {/* Appointment tiles */}
                    {dayAppts.map(appt => {
                      const client = clients.find(c => c.id === appt.client || c.name === appt.client);
                      if (!client) return null;
                      const top = aptTop(appt);
                      const h   = aptH(appt);
                      if (top >= totalH || top + h <= 0) return null;
                      const isLit = highlightId === null || highlightId === client.id;
                      const tier = tierOf(appt.type);
                      return (
                        <div
                          key={appt.id}
                          title={`${client.name}: ${appt.title}\n${new Date(appt.startTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}–${new Date(appt.endTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}
                          style={{
                            position: 'absolute', top: Math.max(0, top) + 1, left: 3, right: 3, height: h - 2,
                            ...(appt.type === 'client-session'
                              ? tileStyle(client.name, appt.technician)
                              : { backgroundColor: TIER_COLOR[tier] }),
                            border: `1.5px solid ${clientDarkBorder(client.name)}`,
                            borderRadius: 4, overflow: 'hidden', zIndex: 2,
                            padding: '2px 4px', boxSizing: 'border-box',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
                            opacity: (isLit ? 1 : 0.18) * (fadedTier === tier ? 0.25 : 1), transition: 'opacity 0.15s', cursor: 'pointer',
                          }}
                        >
                          {h > 22 && (
                            <div style={{ fontSize: 10, fontWeight: 700, lineHeight: 1.2, color: appt.type === 'client-session' ? '#1e3a5f' : '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {client.name}
                            </div>
                          )}
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

// ── Day sub-view: vertical time × horizontal client columns ────────────────────

function ClientDayGrid({ date, clients, appointments, blackouts, heatmap }: {
  date: Date;
  clients: Client[];
  appointments: Appointment[];
  blackouts: Blackout[];
  heatmap: boolean;
}) {
  const { ref: zoomRef, scale: zoom, zoomed, reset } = usePinchZoom<HTMLDivElement>();
  const scaledHourPx = HOUR_PX * zoom;
  const iso      = format(date, 'yyyy-MM-dd');
  const dow      = format(date, 'EEEE') as DayOfWeek;
  const totalH   = (DAY_END - DAY_START) * scaledHourPx;
  const hours    = Array.from({ length: DAY_END - DAY_START + 1 }, (_, i) => DAY_START + i);

  const dayAppts = useMemo(() =>
    appointments.filter(a =>
      a.startTime.startsWith(iso) && a.status !== 'canceled' && !a.isGhost,
    ),
  [appointments, iso]);

  // Heatmap: count visible-client sessions per 30-min slot
  const heatSlots = useMemo(() => {
    if (!heatmap || clients.length === 0) return null;
    const n      = (DAY_END - DAY_START) * 2;
    const counts = new Array(n).fill(0);
    for (const a of dayAppts) {
      const match = clients.find(c => c.id === a.client || c.name === a.client);
      if (!match) continue;
      const s  = new Date(a.startTime);
      const e  = new Date(a.endTime);
      const s0 = Math.max(0, Math.floor((s.getHours() * 60 + s.getMinutes() - DAY_START * 60) / 30));
      const e0 = Math.min(n, Math.ceil((e.getHours() * 60 + e.getMinutes() - DAY_START * 60) / 30));
      for (let i = s0; i < e0; i++) counts[i]++;
    }
    const maxC = Math.max(1, ...counts);
    return { counts, maxC };
  }, [heatmap, dayAppts, clients]);

  if (clients.length === 0) {
    return (
      <div style={{
        border: '1px solid #e5e7eb', borderRadius: 8,
        textAlign: 'center', padding: '64px 20px', color: '#9ca3af', fontSize: 14,
      }}>
        No clients selected. Choose clients using the filter above.
      </div>
    );
  }

  // Helpers for converting time → pixel position (use scaledHourPx for zoom support)
  const toTopPx = (h: number, m: number) => (h + m / 60 - DAY_START) * scaledHourPx;
  const apptTopPx = (a: Appointment) => {
    const d = new Date(a.startTime);
    return toTopPx(d.getHours(), d.getMinutes());
  };
  const apptHPx = (a: Appointment) => {
    const s = new Date(a.startTime);
    const e = new Date(a.endTime);
    return ((e.getTime() - s.getTime()) / 3_600_000) * scaledHourPx;
  };
  const winTopPx = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return toTopPx(h, m);
  };
  const winHPx = (start: string, end: string) => {
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    return ((eh + em / 60) - (sh + sm / 60)) * scaledHourPx;
  };
  const fmtTime = (d: Date) =>
    d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
      {zoomed && <ZoomResetPill scale={zoom} onReset={reset} />}
      <div ref={zoomRef} style={{
        overflowY: 'auto', overflowX: 'auto', maxHeight: '75vh',
        touchAction: 'pan-x pan-y', WebkitOverflowScrolling: 'touch' as any,
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
              width: GUTTER, flexShrink: 0,
              borderRight: '2px solid #d1d5db',
              background: '#f3f4f6',
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

            {/* Time gutter */}
            <div style={{
              width: GUTTER, flexShrink: 0,
              position: 'relative', height: totalH,
              background: '#f9fafb', borderRight: '2px solid #d1d5db',
            }}>
              {hours.map(h => (
                <div key={h} style={{
                  position: 'absolute',
                  top: (h - DAY_START) * scaledHourPx - (h === DAY_START ? 0 : 6),
                  width: '100%', textAlign: 'right',
                  paddingRight: 7, fontSize: 11, fontWeight: 600, color: '#6b7280',
                }}>
                  {h === 12 ? '12p' : h > 12 ? `${h - 12}p` : `${h}a`}
                </div>
              ))}
            </div>

            {/* Heatmap row backgrounds (behind everything) */}
            {heatmap && heatSlots && (
              <div style={{
                position: 'absolute', left: GUTTER, right: 0, top: 0, bottom: 0,
                zIndex: 0, pointerEvents: 'none',
              }}>
                {heatSlots.counts.map((count, i) => {
                  const intensity = count / heatSlots.maxC;
                  return (
                    <div key={i} style={{
                      position: 'absolute', left: 0, right: 0,
                      top: i * scaledHourPx / 2, height: scaledHourPx / 2,
                      background: intensity > 0
                        ? `rgba(220,38,38,${(0.05 + intensity * 0.40).toFixed(2)})`
                        : 'transparent',
                    }} />
                  );
                })}
              </div>
            )}

            {/* Full-width hour and half-hour lines */}
            <div style={{
              position: 'absolute', left: GUTTER, right: 0, top: 0, bottom: 0,
              zIndex: 1, pointerEvents: 'none',
            }}>
              {hours.map(h => h > DAY_START && (
                <div key={h} style={{
                  position: 'absolute', left: 0, right: 0,
                  top: (h - DAY_START) * scaledHourPx,
                  borderTop: `1px solid ${h % 3 === 0 ? '#d1d5db' : '#ececec'}`,
                }} />
              ))}
              {Array.from({ length: (DAY_END - DAY_START) * 2 }, (_, i) => i).map(i =>
                i % 2 === 1 ? (
                  <div key={i} style={{
                    position: 'absolute', left: 0, right: 0,
                    top: i * scaledHourPx / 2,
                    borderTop: '1px dashed #f0f0f0',
                  }} />
                ) : null,
              )}
            </div>

            {/* Client columns */}
            {clients.map((client, ci) => {
              const windows  = client.availabilityWindows[dow] ?? [];
              const cAppts   = dayAppts.filter(
                a => a.client === client.id || a.client === client.name,
              );

              return (
                <div
                  key={client.id}
                  style={{
                    flex: `1 1 ${COL_MIN}px`, minWidth: COL_MIN,
                    height: totalH, position: 'relative',
                    borderLeft: ci > 0 ? '1px solid #e5e7eb' : undefined,
                    zIndex: 2,
                  }}
                >
                  {/* Availability windows */}
                  {windows.map((w, wi) => {
                    const top = winTopPx(w.start);
                    const h   = winHPx(w.start, w.end);
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

                  {/* Booked sessions */}
                  {cAppts.map(appt => {
                    const top  = apptTopPx(appt);
                    const rawH = apptHPx(appt);
                    const h    = Math.max(rawH, 18);
                    if (top >= totalH || top + h <= 0) return null;
                    const clampedTop = Math.max(0, top);

                    const isDirect  = appt.type === 'client-session';
                    const blockStyle = isDirect
                      ? tileStyle(client.name, appt.technician)
                      : {
                          backgroundColor: clientDarkBorder(client.name),
                          backgroundImage: undefined as string | undefined,
                        };

                    return (
                      <div
                        key={appt.id}
                        title={`${appt.title}\n${fmtTime(new Date(appt.startTime))}–${fmtTime(new Date(appt.endTime))}`}
                        style={{
                          position: 'absolute',
                          top: clampedTop + 1, left: 5, right: 5,
                          height: Math.max(h - 2, 16),
                          ...blockStyle,
                          border:       `1.5px solid ${clientDarkBorder(client.name)}`,
                          borderRadius:  5, overflow: 'hidden',
                          zIndex: 3, boxSizing: 'border-box',
                          padding: '2px 5px',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.14)',
                        }}
                      >
                        {h > 22 && (
                          <div style={{
                            fontSize: 10, fontWeight: 700, lineHeight: 1.3,
                            color: isDirect ? '#1e3a5f' : '#fff',
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          }}>
                            {appt.title}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Legend */}
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
          <span style={{ display: 'inline-block', width: 18, height: 14, borderRadius: 3, background: '#93c5fd',
            backgroundImage: 'repeating-linear-gradient(45deg,rgba(30,90,180,0.4) 0,rgba(30,90,180,0.4) 3px,transparent 3px,transparent 7px)' }} />
          Direct session
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#374151' }}>
          <span style={{ display: 'inline-block', width: 18, height: 14, borderRadius: 3, background: '#6b7280' }} />
          Supervision / PT / other
        </span>
        {heatmap && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#374151' }}>
            <span style={{ display: 'inline-block', width: 18, height: 14, borderRadius: 3,
              background: 'linear-gradient(to right, rgba(220,38,38,0.08), rgba(220,38,38,0.45))' }} />
            Heatmap intensity (sessions/slot)
          </span>
        )}
      </div>
    </div>
  );
}
