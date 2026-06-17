// ClientCalendarView — client-centric schedule view.
//
// Month sub-view: client blackout dates per day cell.
// Week sub-view:  7-day time grid (styled like BCBA/BT calendars) + embedded
//   Availability & Schedule Matrix — a 30-min slot heatmap where clients are
//   ordered by schedule-overlap proximity (cosine similarity, greedy NN).
//   Click a client row in the matrix to dim unrelated sessions in both panels.

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Client, Blackout, Appointment, DayOfWeek } from '../types';
import {
  clientHue, clientDarkBorder, clientAvailBarStyle, tileStyle,
} from '../calendarColors';
import {
  format, addDays, addWeeks, subWeeks, addMonths, subMonths,
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, isSameDay, isSameMonth,
} from 'date-fns';

// ── Constants ──────────────────────────────────────────────────────────────────

const DAY_S    = 6;            // first visible hour
const DAY_E    = 22;           // last visible hour (exclusive)
const HOUR_PX  = 48;           // pixels per hour (matches BCBA/BT calendar)
const GUTTER   = 44;           // time-axis gutter width
const COL_MIN  = 88;           // min day-column width in week grid
const SLOT_PX  = 7;            // matrix: 30-min cell width
const ROW_H    = 26;           // matrix: row height per client
const LABEL_W  = 78;           // matrix: client label width
const META_W   = 98;           // matrix: right-side utilization meta width
const DAY_SEP  = 3;            // matrix: pixel gap between day groups
const TOTAL_H  = (DAY_E - DAY_S) * HOUR_PX;
const SPD      = (DAY_E - DAY_S) * 2; // slots per day (30-min)

const WEEK_DAYS: DayOfWeek[] = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
];
const SHORT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

type Sub = 'month' | 'week';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  clients: Client[];
  appointments: Appointment[];
  blackouts: Blackout[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getWeekDays(d: Date): Date[] {
  const mon = startOfWeek(d, { weekStartsOn: 1 });
  return Array.from({ length: 7 }, (_, i) => addDays(mon, i));
}

const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const toTopPx = (h: number, m: number) => (h + m / 60 - DAY_S) * HOUR_PX;
const fmtTime = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

// ── Main component ─────────────────────────────────────────────────────────────

export default function ClientCalendarView({ clients, appointments, blackouts }: Props) {
  const [sub, setSub]           = useState<Sub>('week');
  const [date, setDate]         = useState(new Date());
  const [selIds, setSelIds]     = useState<Set<string>>(() => new Set(clients.map(c => c.id)));
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

  const goPrev = () => setDate(d => sub === 'month' ? subMonths(d, 1) : subWeeks(d, 1));
  const goNext = () => setDate(d => sub === 'month' ? addMonths(d, 1) : addWeeks(d, 1));

  return (
    <div style={{ padding: 'clamp(8px,3vw,24px)', boxSizing: 'border-box' }}>

      {/* ── Toolbar ─────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ display: 'flex', border: '1px solid #d1d5db', borderRadius: 6, overflow: 'hidden' }}>
          {(['month', 'week'] as Sub[]).map(v => (
            <button key={v} onClick={() => setSub(v)} style={{
              padding: '6px 14px', border: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: 600,
              background: sub === v ? '#3b82f6' : 'white',
              color: sub === v ? 'white' : '#374151',
            }}>{v[0].toUpperCase() + v.slice(1)}</button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
          {[{ label: '←', fn: goPrev }, { label: 'Today', fn: () => setDate(new Date()) }, { label: '→', fn: goNext }].map(({ label, fn }) => (
            <button key={label} onClick={fn} style={{
              padding: '6px 12px', background: '#e5e7eb', border: 'none',
              borderRadius: 4, cursor: 'pointer', fontSize: 13,
            }}>{label}</button>
          ))}
        </div>
      </div>

      {/* ── Date heading ────────────────────────────── */}
      <h2 style={{ fontSize: 17, fontWeight: 700, margin: '0 0 10px', textAlign: 'center', color: '#111827' }}>
        {sub === 'month' ? format(date, 'MMMM yyyy') : weekLabel}
      </h2>

      {/* ── Client filter pills ──────────────────────── */}
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
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '4px 10px', borderRadius: 14, flexShrink: 0,
                border: on ? `2px solid ${s.borderColor}` : '1px solid #d1d5db',
                background: on ? s.backgroundColor : '#f9fafb',
                color: on ? s.color : '#6b7280',
                cursor: 'pointer', fontSize: 12, fontWeight: on ? 700 : 500,
                whiteSpace: 'nowrap',
              }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: on ? s.borderColor : '#d1d5db' }} />
              {c.name}
            </button>
          );
        })}
      </div>

      {/* ── Content ──────────────────────────────────── */}
      {sub === 'month' && (
        <ClientMonthView date={date} blackouts={blackouts} clients={visible}
          onPickDay={d => { setDate(d); setSub('week'); }} />
      )}
      {sub === 'week' && (
        <ClientWeekView
          days={weekDays}
          clients={visible}
          appointments={appointments}
          blackouts={blackouts}
          highlightId={highlightId}
          onHighlight={setHighlightId}
        />
      )}
    </div>
  );
}

// ── Pill ───────────────────────────────────────────────────────────────────────

function Pill({ active, color, onClick, children }: {
  active: boolean; color: string; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} style={{
      padding: '4px 12px', borderRadius: 14, flexShrink: 0, whiteSpace: 'nowrap',
      border: active ? 'none' : '1px solid #d1d5db',
      background: active ? color : '#f9fafb',
      color: active ? 'white' : '#374151',
      cursor: 'pointer', fontSize: 12, fontWeight: 600,
    }}>{children}</button>
  );
}

// ── Month sub-view ─────────────────────────────────────────────────────────────

function ClientMonthView({ date, blackouts, clients, onPickDay }: {
  date: Date; blackouts: Blackout[]; clients: Client[]; onPickDay: (d: Date) => void;
}) {
  const mStart    = startOfMonth(date);
  const mEnd      = endOfMonth(date);
  const gridStart = startOfWeek(mStart, { weekStartsOn: 1 });
  const gridEnd   = endOfWeek(mEnd, { weekStartsOn: 1 });
  const days      = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const clientIds = new Set(clients.map(c => c.id));

  if (clients.length === 0) return <EmptyState />;

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
        {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d => (
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
              background: inMonth ? '#fff' : '#f8f8f8', minHeight: 96, padding: '5px 5px 4px',
              cursor: 'pointer', opacity: inMonth ? 1 : 0.4,
              borderTop: isToday ? '3px solid #3b82f6' : '3px solid transparent',
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
                      background: s.backgroundColor, border: `1px solid ${s.borderColor}`,
                      color: s.color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
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

// ── Week view (orchestrator) ───────────────────────────────────────────────────

function ClientWeekView({ days, clients, appointments, blackouts, highlightId, onHighlight }: {
  days: Date[]; clients: Client[]; appointments: Appointment[]; blackouts: Blackout[];
  highlightId: string | null; onHighlight: (id: string | null) => void;
}) {
  const weekAppts = useMemo(() => {
    const s = format(days[0], 'yyyy-MM-dd');
    const e = format(days[6], 'yyyy-MM-dd');
    return appointments.filter(a =>
      a.startTime.slice(0, 10) >= s && a.startTime.slice(0, 10) <= e &&
      a.status !== 'canceled' && !a.isGhost,
    );
  }, [appointments, days]);

  if (clients.length === 0) return <EmptyState />;

  return (
    <div>
      <WeekTimeGrid days={days} clients={clients} appointments={weekAppts} blackouts={blackouts} highlightId={highlightId} />
      <AvailMatrix days={days} clients={clients} appointments={weekAppts} highlightId={highlightId} onHighlight={onHighlight} />
    </div>
  );
}

// ── Week time grid ─────────────────────────────────────────────────────────────

function WeekTimeGrid({ days, clients, appointments, blackouts, highlightId }: {
  days: Date[]; clients: Client[]; appointments: Appointment[]; blackouts: Blackout[];
  highlightId: string | null;
}) {
  const hours   = Array.from({ length: DAY_E - DAY_S }, (_, i) => DAY_S + i);
  const today   = new Date();
  const bodyRef = useRef<HTMLDivElement>(null);

  // Scroll to current time on mount
  useEffect(() => {
    if (!bodyRef.current) return;
    const now = new Date();
    const top = Math.max(0, toTopPx(now.getHours() - 1, now.getMinutes()));
    bodyRef.current.scrollTop = top;
  }, []);

  const aptTopPx  = (a: Appointment) => { const d = new Date(a.startTime); return toTopPx(d.getHours(), d.getMinutes()); };
  const aptHeightPx = (a: Appointment) => { const s = new Date(a.startTime), e = new Date(a.endTime); return Math.max(18, (e.getTime() - s.getTime()) / 3_600_000 * HOUR_PX); };

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', marginBottom: 12, background: 'white' }}>
      <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' as any }}>
        <div style={{ minWidth: GUTTER + days.length * COL_MIN, display: 'flex', flexDirection: 'column' }}>

          {/* Sticky day headers */}
          <div style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 10, borderBottom: '2px solid #d1d5db', background: '#f9fafb' }}>
            <div style={{ width: GUTTER, flexShrink: 0, borderRight: '2px solid #d1d5db', position: 'sticky', left: 0, zIndex: 2, background: '#f3f4f6' }} />
            {days.map((day, di) => {
              const isToday   = isSameDay(day, today);
              const iso       = format(day, 'yyyy-MM-dd');
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

          {/* Scrollable body */}
          <div ref={bodyRef} style={{ overflowY: 'auto', maxHeight: '52vh' }}>
            <div style={{ display: 'flex', position: 'relative' }}>

              {/* Sticky time gutter */}
              <div style={{ width: GUTTER, flexShrink: 0, position: 'sticky', left: 0, zIndex: 3, background: '#f9fafb', borderRight: '2px solid #d1d5db', height: TOTAL_H }}>
                {hours.map(h => (
                  <div key={h} style={{
                    position: 'absolute', top: (h - DAY_S) * HOUR_PX - (h === DAY_S ? 0 : 6),
                    width: '100%', textAlign: 'right', paddingRight: 6, fontSize: 10, fontWeight: 600, color: '#9ca3af',
                  }}>
                    {h === 12 ? '12p' : h > 12 ? `${h - 12}p` : `${h}a`}
                  </div>
                ))}
              </div>

              {/* Hour lines */}
              <div style={{ position: 'absolute', left: GUTTER, right: 0, top: 0, bottom: 0, zIndex: 0, pointerEvents: 'none' }}>
                {hours.map(h => h > DAY_S && (
                  <div key={h} style={{ position: 'absolute', left: 0, right: 0, top: (h - DAY_S) * HOUR_PX, borderTop: `1px solid ${h % 3 === 0 ? '#d1d5db' : '#eeeeee'}` }} />
                ))}
                {Array.from({ length: (DAY_E - DAY_S) * 2 }, (_, i) => i).map(i =>
                  i % 2 === 1 ? <div key={i} style={{ position: 'absolute', left: 0, right: 0, top: i * HOUR_PX / 2, borderTop: '1px dashed #f0f0f0' }} /> : null,
                )}
              </div>

              {/* Day columns */}
              {days.map((day, di) => {
                const iso     = format(day, 'yyyy-MM-dd');
                const dow     = WEEK_DAYS[di];
                const isToday = isSameDay(day, today);
                const dayAppts = appointments.filter(a => a.startTime.startsWith(iso));

                // Aggregate client availability per hour → ambient background
                const availFrac = hours.map(h => {
                  const slotMin = h * 60;
                  return clients.filter(c => (c.availabilityWindows[dow] ?? []).some(w =>
                    toMin(w.start) <= slotMin + 60 && toMin(w.end) > slotMin,
                  )).length / Math.max(1, clients.length);
                });

                // Current time needle
                const nowTop = isToday ? toTopPx(today.getHours(), today.getMinutes()) : -1;

                return (
                  <div key={iso} style={{ flex: 1, minWidth: COL_MIN, height: TOTAL_H, position: 'relative', zIndex: 1, borderLeft: di > 0 ? '1px solid #e5e7eb' : 'none' }}>

                    {/* Availability ambient tint */}
                    {hours.map((h, hi) => {
                      const frac = availFrac[hi];
                      if (frac === 0) return null;
                      const alpha = (0.04 + frac * 0.09).toFixed(2);
                      return <div key={h} style={{ position: 'absolute', left: 0, right: 0, top: (h - DAY_S) * HOUR_PX, height: HOUR_PX, background: `rgba(59,130,246,${alpha})`, pointerEvents: 'none' }} />;
                    })}

                    {/* Current time needle */}
                    {nowTop >= 0 && nowTop <= TOTAL_H && (
                      <div style={{ position: 'absolute', left: 0, right: 0, top: nowTop, zIndex: 4, pointerEvents: 'none' }}>
                        <div style={{ position: 'absolute', left: -3, top: -4, width: 8, height: 8, borderRadius: '50%', background: '#ef4444' }} />
                        <div style={{ height: 2, background: '#ef4444', borderRadius: 1 }} />
                      </div>
                    )}

                    {/* Sessions */}
                    {dayAppts.map(appt => {
                      const client = clients.find(c => c.id === appt.client || c.name === appt.client);
                      if (!client) return null;
                      const top  = aptTopPx(appt);
                      const h    = aptHeightPx(appt);
                      if (top >= TOTAL_H || top + h <= 0) return null;
                      const isLit = highlightId === null || highlightId === client.id;
                      const style = tileStyle(client.name, appt.technician);
                      return (
                        <div key={appt.id}
                          title={`${client.name}: ${appt.title}\n${fmtTime(new Date(appt.startTime))}–${fmtTime(new Date(appt.endTime))}`}
                          style={{
                            position: 'absolute', top: Math.max(0, top) + 1, left: 3, right: 3, height: h - 2,
                            ...style, border: `1.5px solid ${clientDarkBorder(client.name)}`,
                            borderRadius: 4, overflow: 'hidden', zIndex: 2,
                            padding: '2px 4px', boxSizing: 'border-box',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
                            opacity: isLit ? 1 : 0.18, transition: 'opacity 0.15s',
                          }}>
                          {h > 22 && (
                            <div style={{ fontSize: 10, fontWeight: 700, lineHeight: 1.2, color: '#1e3a5f', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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

      {/* Legend */}
      <div style={{ display: 'flex', gap: 14, padding: '6px 10px', borderTop: '1px solid #e5e7eb', background: '#fafafa', flexWrap: 'wrap', alignItems: 'center' }}>
        <Swatch color="rgba(59,130,246,0.10)" label="Clients available" />
        <Swatch color="#bfdbfe" stripe label="Direct session" />
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#6b7280' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} />
          Now
        </div>
      </div>
    </div>
  );
}

// ── Availability & Schedule Matrix ─────────────────────────────────────────────

function AvailMatrix({ days, clients, appointments, highlightId, onHighlight }: {
  days: Date[]; clients: Client[]; appointments: Appointment[];
  highlightId: string | null; onHighlight: (id: string | null) => void;
}) {
  const ordered = useMemo(() => clusterByOverlap(clients), [clients]);

  const rows = useMemo(() => ordered.map(client => {
    const hue = clientHue(client.name);
    let availSlots = 0, sessionSlots = 0;

    const slots = days.flatMap((day, di) => {
      const dow    = WEEK_DAYS[di];
      const iso    = format(day, 'yyyy-MM-dd');
      const wins   = client.availabilityWindows[dow] ?? [];
      const cAppts = appointments.filter(a =>
        a.startTime.startsWith(iso) && (a.client === client.id || a.client === client.name),
      );
      return Array.from({ length: SPD }, (_, si) => {
        const sStart = DAY_S * 60 + si * 30;
        const sEnd   = sStart + 30;
        const hasAvail  = wins.some(w => toMin(w.start) < sEnd && toMin(w.end) > sStart);
        const sessions  = cAppts.filter(a => {
          const as = new Date(a.startTime), ae = new Date(a.endTime);
          const aS = as.getHours() * 60 + as.getMinutes();
          const aE = ae.getHours() * 60 + ae.getMinutes();
          return aS < sEnd && aE > sStart;
        });
        const isDirect  = sessions.some(s => s.type === 'client-session');
        const hasOther  = sessions.length > 0 && !isDirect;
        if (hasAvail) availSlots++;
        if (sessions.length > 0) sessionSlots++;
        return { hasAvail, isDirect, hasOther };
      });
    });

    const utilPct     = availSlots > 0 ? Math.round(100 * sessionSlots / availSlots) : 0;
    const scheduledHrs = +(sessionSlots * 0.5).toFixed(1);
    const availHrs     = +(availSlots   * 0.5).toFixed(1);
    return { client, hue, slots, utilPct, scheduledHrs, availHrs };
  }), [ordered, days, appointments]);

  const totalW = LABEL_W + days.length * (SPD * SLOT_PX + DAY_SEP) + META_W;

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden', background: 'white' }}>
      {/* Panel header */}
      <div style={{
        padding: '8px 12px 6px', borderBottom: '1px solid #f0f0f0',
        background: 'linear-gradient(90deg,#f8fafc,#f1f5f9)',
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Availability &amp; Schedule Matrix
        </span>
        <span style={{ fontSize: 10, color: '#94a3b8' }}>sorted by schedule overlap · 30-min slots · click row to focus</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <MatrixSwatch bg="#e2e8f0"              label="Not available" />
          <MatrixSwatch bg="hsl(210 65% 87%)"    label="Available" />
          <MatrixSwatch bg="hsl(210 72% 65%)"    label="Other session" />
          <MatrixSwatch bg="hsl(210 72% 48%)"    label="Direct session" />
        </div>
      </div>

      <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' as any }}>
        <div style={{ minWidth: totalW }}>

          {/* Day header row */}
          <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
            <div style={{ width: LABEL_W, flexShrink: 0 }} />
            {days.map((day, di) => {
              const isToday = isSameDay(day, new Date());
              return (
                <React.Fragment key={di}>
                  <div style={{ width: DAY_SEP, flexShrink: 0, background: '#cbd5e1' }} />
                  <div style={{
                    width: SPD * SLOT_PX, flexShrink: 0, textAlign: 'center',
                    padding: '4px 0 2px', fontSize: 10, fontWeight: 700,
                    color: isToday ? '#3b82f6' : '#475569',
                    background: isToday ? '#eff6ff' : 'transparent',
                  }}>
                    {SHORT_DAYS[di]} {format(day, 'd')}
                  </div>
                </React.Fragment>
              );
            })}
            <div style={{ width: META_W, flexShrink: 0 }} />
          </div>

          {/* Time ruler */}
          <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0', background: '#f1f5f9' }}>
            <div style={{ width: LABEL_W, flexShrink: 0, fontSize: 9, color: '#94a3b8', padding: '2px 6px', display: 'flex', alignItems: 'center' }}>Client</div>
            {days.map((_, di) => (
              <React.Fragment key={di}>
                <div style={{ width: DAY_SEP, flexShrink: 0, background: '#cbd5e1' }} />
                <div style={{ width: SPD * SLOT_PX, flexShrink: 0, position: 'relative', height: 14 }}>
                  {Array.from({ length: SPD }, (_, si) => si).filter(si => si % 4 === 0).map(si => {
                    const hour = DAY_S + si / 2;
                    return (
                      <div key={si} style={{ position: 'absolute', left: si * SLOT_PX, fontSize: 8, color: '#94a3b8', lineHeight: '14px', whiteSpace: 'nowrap' }}>
                        {hour === 12 ? '12p' : hour > 12 ? `${hour - 12}p` : `${hour}a`}
                      </div>
                    );
                  })}
                </div>
              </React.Fragment>
            ))}
            <div style={{ width: META_W, flexShrink: 0 }} />
          </div>

          {/* Client rows */}
          {rows.map(({ client, hue, slots, utilPct, scheduledHrs, availHrs }) => {
            const isLit = highlightId === null || highlightId === client.id;
            const isFocused = highlightId === client.id;
            const utilColor = utilPct >= 70 ? '#059669' : utilPct >= 40 ? '#d97706' : '#94a3b8';
            return (
              <div key={client.id}
                onClick={() => onHighlight(isFocused ? null : client.id)}
                style={{
                  display: 'flex', alignItems: 'center',
                  borderBottom: '1px solid #f1f5f9', cursor: 'pointer',
                  background: isFocused ? `hsl(${hue} 70% 97%)` : 'white',
                  opacity: isLit ? 1 : 0.38,
                  transition: 'opacity 0.15s, background 0.15s',
                }}>

                {/* Client label */}
                <div style={{
                  width: LABEL_W, flexShrink: 0, height: ROW_H,
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '0 6px 0 8px',
                }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: `hsl(${hue} 65% 48%)`, flexShrink: 0 }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: `hsl(${hue} 40% 28%)`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {client.name}
                  </span>
                </div>

                {/* Slot cells */}
                <div style={{ display: 'flex', alignItems: 'center', height: ROW_H }}>
                  {slots.map((slot, si) => {
                    const di       = Math.floor(si / SPD);
                    const slotInDay = si % SPD;
                    const isNewDay  = slotInDay === 0;

                    let bg: string;
                    if (slot.isDirect)    bg = `hsl(${hue} 72% 48%)`;
                    else if (slot.hasOther)  bg = `hsl(${hue} 58% 65%)`;
                    else if (slot.hasAvail)  bg = `hsl(${hue} 65% 87%)`;
                    else                     bg = '#e2e8f0';

                    const hour  = DAY_S + Math.floor(slotInDay / 2);
                    const minLabel = (slotInDay % 2) * 30;
                    const status = slot.isDirect ? 'Direct session' : slot.hasOther ? 'Other session' : slot.hasAvail ? 'Available' : 'Not available';
                    const tipLabel = `${SHORT_DAYS[di]} ${hour}:${minLabel === 0 ? '00' : '30'} — ${status}`;

                    return (
                      <React.Fragment key={si}>
                        {isNewDay && <div style={{ width: DAY_SEP, height: ROW_H, background: '#cbd5e1', flexShrink: 0 }} />}
                        <div
                          title={tipLabel}
                          style={{ width: SLOT_PX, height: ROW_H - 2, background: bg, flexShrink: 0 }}
                        />
                      </React.Fragment>
                    );
                  })}
                </div>

                {/* Utilization meta */}
                <div style={{ width: META_W, flexShrink: 0, padding: '0 10px', fontSize: 10 }}>
                  <div style={{ fontWeight: 700, color: utilColor, fontSize: 12 }}>{utilPct}%</div>
                  <div style={{ height: 5, borderRadius: 3, background: '#e2e8f0', marginTop: 2, overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 3, width: `${Math.min(100, utilPct)}%`, background: utilColor, transition: 'width 0.3s' }} />
                  </div>
                  <div style={{ marginTop: 2, color: '#94a3b8' }}>{scheduledHrs}h / {availHrs}h</div>
                </div>
              </div>
            );
          })}

          {/* Summary footer: aggregate availability density per slot across all clients */}
          <div style={{ display: 'flex', alignItems: 'center', borderTop: '2px solid #e2e8f0', background: '#f8fafc', height: ROW_H }}>
            <div style={{ width: LABEL_W, flexShrink: 0, padding: '0 8px', fontSize: 9, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              All clients
            </div>
            <div style={{ display: 'flex', alignItems: 'center', height: ROW_H }}>
              {Array.from({ length: days.length * SPD }, (_, gi) => {
                const di       = Math.floor(gi / SPD);
                const slotInDay = gi % SPD;
                const isNewDay  = slotInDay === 0;
                // Count how many clients are available in this slot
                const count = rows.filter(r => r.slots[gi]?.hasAvail).length;
                const scheduled = rows.filter(r => r.slots[gi]?.isDirect || r.slots[gi]?.hasOther).length;
                const total = Math.max(1, rows.length);
                // Show intensity: fraction of clients available
                const alpha = count / total;
                const schedAlpha = scheduled / total;
                const bg = schedAlpha > 0
                  ? `hsl(215 80% ${Math.round(70 - schedAlpha * 25)}%)`
                  : count > 0 ? `hsl(215 65% ${Math.round(93 - alpha * 18)}%)` : '#e2e8f0';
                return (
                  <React.Fragment key={gi}>
                    {isNewDay && <div style={{ width: DAY_SEP, height: ROW_H, background: '#cbd5e1', flexShrink: 0 }} />}
                    <div style={{ width: SLOT_PX, height: ROW_H - 2, background: bg, flexShrink: 0 }}
                      title={`${SHORT_DAYS[di]} ${DAY_S + Math.floor(slotInDay / 2)}:${(slotInDay % 2) * 30 === 0 ? '00' : '30'} — ${count}/${rows.length} avail, ${scheduled} scheduled`}
                    />
                  </React.Fragment>
                );
              })}
            </div>
            <div style={{ width: META_W, flexShrink: 0, padding: '0 10px', fontSize: 10, color: '#64748b' }}>
              {rows.length} clients
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Overlap clustering ─────────────────────────────────────────────────────────

function clusterByOverlap(clients: Client[]): Client[] {
  if (clients.length <= 1) return clients;

  // Build binary availability vector per client (7 days × SPD slots)
  const vecs = clients.map(client =>
    WEEK_DAYS.flatMap(dow => {
      const wins = client.availabilityWindows[dow] ?? [];
      return Array.from({ length: SPD }, (_, si) => {
        const sStart = DAY_S * 60 + si * 30;
        const sEnd   = sStart + 30;
        return wins.some(w => toMin(w.start) < sEnd && toMin(w.end) > sStart) ? 1 : 0;
      });
    }),
  );

  const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);
  const mag = (a: number[]) => Math.sqrt(a.reduce((s, v) => s + v * v, 0));
  const sim = (a: number[], b: number[]) => {
    const ma = mag(a), mb = mag(b);
    return ma === 0 || mb === 0 ? 0 : dot(a, b) / (ma * mb);
  };

  // Greedy nearest-neighbor: start with the most-available client
  const remaining = clients.map((_, i) => i);
  const totalBits = (v: number[]) => v.reduce((s: number, x: number) => s + x, 0);
  remaining.sort((a, b) => totalBits(vecs[b]) - totalBits(vecs[a]));
  const ordered: number[] = [remaining.shift()!];
  while (remaining.length > 0) {
    const last = ordered[ordered.length - 1];
    let bestIdx = 0, bestSim = -1;
    for (let i = 0; i < remaining.length; i++) {
      const s = sim(vecs[last], vecs[remaining[i]]);
      if (s > bestSim) { bestSim = s; bestIdx = i; }
    }
    ordered.push(remaining.splice(bestIdx, 1)[0]);
  }
  return ordered.map(i => clients[i]);
}

// ── Small helpers ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, textAlign: 'center', padding: '64px 20px', color: '#9ca3af', fontSize: 14 }}>
      No clients selected. Choose clients using the filter above.
    </div>
  );
}

function Swatch({ color, stripe, label }: { color: string; stripe?: boolean; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#6b7280' }}>
      <span style={{
        display: 'inline-block', width: 14, height: 14, borderRadius: 3,
        background: color,
        backgroundImage: stripe ? 'repeating-linear-gradient(45deg,rgba(30,90,180,0.4) 0,rgba(30,90,180,0.4) 2px,transparent 2px,transparent 5px)' : undefined,
      }} />
      {label}
    </span>
  );
}

function MatrixSwatch({ bg, label }: { bg: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, color: '#64748b' }}>
      <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: bg }} />
      {label}
    </span>
  );
}
