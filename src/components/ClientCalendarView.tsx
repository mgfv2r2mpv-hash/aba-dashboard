// ClientCalendarView — top-level client-centric schedule view.
//
// Month sub-view: blackout dates only per client (no appointments).
// Day sub-view:   vertical time axis × horizontal client columns.
//   - Availability windows: translucent pastel vertical fills.
//   - Direct-service sessions (client-session): candy-stripe tileStyle.
//   - Other sessions (supervision, PT, case-planning…): solid fill.
//   - Heatmap toggle: 30-min slot row backgrounds show aggregate session density.
// Client filter: All / None / individual pills — defaults all selected.

import React, { useState, useEffect, useMemo } from 'react';
import {
  Client, Blackout, Appointment, DayOfWeek,
} from '../types';
import {
  clientPastel, clientDarkBorder, clientAvailBarStyle, tileStyle,
} from '../calendarColors';
import {
  format, addDays, subDays, addMonths, subMonths,
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, isSameDay, isSameMonth,
} from 'date-fns';

const DAY_START = 6;
const DAY_END   = 22;
const HOUR_PX   = 80;   // taller than BCBA calendar → more scroll, larger bands
const GUTTER    = 56;   // time axis width
const COL_MIN   = 140;  // min client column width

type Sub = 'month' | 'day';

interface Props {
  clients: Client[];
  appointments: Appointment[];
  blackouts: Blackout[];
}

export default function ClientCalendarView({ clients, appointments, blackouts }: Props) {
  const [sub, setSub]       = useState<Sub>('day');
  const [date, setDate]     = useState(new Date());
  const [heatmap, setHeatmap] = useState(false);
  const [selIds, setSelIds] = useState<Set<string>>(
    () => new Set(clients.map(c => c.id)),
  );

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

  const goPrev = () => setDate(d => sub === 'month' ? subMonths(d, 1) : subDays(d, 1));
  const goNext = () => setDate(d => sub === 'month' ? addMonths(d, 1) : addDays(d, 1));

  return (
    <div style={{ padding: 'clamp(8px,3vw,24px)', boxSizing: 'border-box' }}>

      {/* ── Toolbar ───────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>

        {/* Month / Day toggle */}
        <div style={{ display: 'flex', border: '1px solid #d1d5db', borderRadius: 6, overflow: 'hidden' }}>
          {(['month', 'day'] as Sub[]).map(v => (
            <button
              key={v}
              onClick={() => { setSub(v); if (v === 'month') setHeatmap(false); }}
              style={{
                padding: '6px 14px', border: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: 600,
                background: sub === v ? '#3b82f6' : 'white',
                color:      sub === v ? 'white'   : '#374151',
              }}
            >{v[0].toUpperCase() + v.slice(1)}</button>
          ))}
        </div>

        {/* Heatmap toggle (day only) */}
        {sub === 'day' && (
          <button
            onClick={() => setHeatmap(h => !h)}
            style={{
              padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 13,
              border:      `1px solid ${heatmap ? '#7c3aed' : '#d1d5db'}`,
              background:  heatmap ? '#f5f3ff' : 'white',
              color:       heatmap ? '#7c3aed' : '#374151',
              fontWeight:  heatmap ? 700 : 500,
            }}
          >🌡 Heatmap</button>
        )}

        {/* Date nav */}
        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
          {[
            { label: '←', fn: goPrev },
            { label: 'Today', fn: () => setDate(new Date()) },
            { label: '→', fn: goNext },
          ].map(({ label, fn }) => (
            <button key={label} onClick={fn} style={{
              padding: '6px 12px', background: '#e5e7eb', border: 'none',
              borderRadius: 4, cursor: 'pointer', fontSize: 13,
            }}>{label}</button>
          ))}
        </div>
      </div>

      {/* ── Date heading ──────────────────────────────────── */}
      <h2 style={{ fontSize: 17, fontWeight: 700, margin: '0 0 10px', textAlign: 'center', color: '#111827' }}>
        {sub === 'month'
          ? format(date, 'MMMM yyyy')
          : format(date, 'EEEE, MMMM d, yyyy')}
      </h2>

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
      {sub === 'month' && (
        <ClientMonthView
          date={date}
          blackouts={blackouts}
          clients={visible}
          onPickDay={d => { setDate(d); setSub('day'); }}
        />
      )}
      {sub === 'day' && (
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

// ── Day sub-view: vertical time × horizontal client columns ────────────────────

function ClientDayGrid({ date, clients, appointments, blackouts, heatmap }: {
  date: Date;
  clients: Client[];
  appointments: Appointment[];
  blackouts: Blackout[];
  heatmap: boolean;
}) {
  const iso      = format(date, 'yyyy-MM-dd');
  const dow      = format(date, 'EEEE') as DayOfWeek;
  const totalH   = (DAY_END - DAY_START) * HOUR_PX;
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

  // Helpers for converting time → pixel position
  const toTopPx = (h: number, m: number) => (h + m / 60 - DAY_START) * HOUR_PX;
  const apptTopPx = (a: Appointment) => {
    const d = new Date(a.startTime);
    return toTopPx(d.getHours(), d.getMinutes());
  };
  const apptHPx = (a: Appointment) => {
    const s = new Date(a.startTime);
    const e = new Date(a.endTime);
    return ((e.getTime() - s.getTime()) / 3_600_000) * HOUR_PX;
  };
  const winTopPx = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return toTopPx(h, m);
  };
  const winHPx = (start: string, end: string) => {
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    return ((eh + em / 60) - (sh + sm / 60)) * HOUR_PX;
  };
  const fmtTime = (d: Date) =>
    d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{
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
                  top: (h - DAY_START) * HOUR_PX - (h === DAY_START ? 0 : 6),
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
                      top: i * HOUR_PX / 2, height: HOUR_PX / 2,
                      background: intensity > 0
                        ? `rgba(234,88,12,${(0.06 + intensity * 0.44).toFixed(2)})`
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
                  top: (h - DAY_START) * HOUR_PX,
                  borderTop: `1px solid ${h % 3 === 0 ? '#d1d5db' : '#ececec'}`,
                }} />
              ))}
              {Array.from({ length: (DAY_END - DAY_START) * 2 }, (_, i) => i).map(i =>
                i % 2 === 1 ? (
                  <div key={i} style={{
                    position: 'absolute', left: 0, right: 0,
                    top: i * HOUR_PX / 2,
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
              background: 'linear-gradient(to right, rgba(234,88,12,0.1), rgba(234,88,12,0.55))' }} />
            Heatmap intensity (sessions/slot)
          </span>
        )}
      </div>
    </div>
  );
}
