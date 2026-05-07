import React, { useState, useEffect } from 'react';
import { Appointment, Technician, Client } from '../types';
import {
  startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek, endOfWeek,
  format, isSameMonth, isSameDay, addMonths, subMonths, addWeeks, subWeeks, addDays,
} from 'date-fns';

interface CalendarProps {
  appointments: Appointment[];
  technicians: Technician[];
  clients: Client[];
  onAppointmentChange: (appointment: Appointment) => void;
  onSelectAppointment: (appointment: Appointment | null) => void;
}

type View = 'month' | 'week';

const VISIBLE_START_HOUR = 6;
const VISIBLE_END_HOUR = 22;
const HOUR_HEIGHT = 40;
const TIME_AXIS_WIDTH = 52;
// Snap drag movements to 15-minute slots — matches typical scheduling resolution.
const SNAP_MINUTES = 15;

function useIsLandscape(): boolean {
  const [landscape, setLandscape] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia('(orientation: landscape)').matches
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(orientation: landscape)');
    const handler = (e: MediaQueryListEvent) => setLandscape(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return landscape;
}

export default function Calendar({
  appointments,
  technicians: _technicians,
  clients: _clients,
  onAppointmentChange,
  onSelectAppointment,
}: CalendarProps) {
  const [view, setView] = useState<View>('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  const isLandscape = useIsLandscape();

  // When a schedule loads with no appointments in the currently-shown range,
  // jump to the earliest appointment so users see their data.
  useEffect(() => {
    if (appointments.length === 0) return;
    const inRange = appointments.some(a => {
      const d = new Date(a.startTime);
      return view === 'month'
        ? isSameMonth(d, currentDate)
        : d >= startOfWeek(currentDate) && d <= endOfWeek(currentDate);
    });
    if (inRange) return;
    const earliest = appointments
      .map(a => new Date(a.startTime))
      .filter(d => !isNaN(d.getTime()))
      .sort((a, b) => a.getTime() - b.getTime())[0];
    if (earliest) setCurrentDate(earliest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointments, view]);

  const goPrev = () => setCurrentDate(view === 'month' ? subMonths(currentDate, 1) : subWeeks(currentDate, 1));
  const goNext = () => setCurrentDate(view === 'month' ? addMonths(currentDate, 1) : addWeeks(currentDate, 1));
  const goToday = () => setCurrentDate(new Date());

  const headerLabel = view === 'month'
    ? format(currentDate, 'MMMM yyyy')
    : (() => {
        const ws = startOfWeek(currentDate);
        const we = endOfWeek(currentDate);
        const sameMonth = isSameMonth(ws, we);
        return sameMonth
          ? `${format(ws, 'MMM d')}–${format(we, 'd, yyyy')}`
          : `${format(ws, 'MMM d')} – ${format(we, 'MMM d, yyyy')}`;
      })();

  return (
    <div style={{ padding: 'clamp(8px, 3vw, 24px)', maxWidth: '100%', boxSizing: 'border-box' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 16, gap: 8, flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', gap: 4, border: '1px solid #d1d5db', borderRadius: 6, overflow: 'hidden' }}>
          <ViewBtn active={view === 'month'} onClick={() => setView('month')}>Month</ViewBtn>
          <ViewBtn active={view === 'week'} onClick={() => setView('week')}>Week</ViewBtn>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <NavBtn onClick={goPrev}>←</NavBtn>
          <NavBtn onClick={goToday}>Today</NavBtn>
          <NavBtn onClick={goNext}>→</NavBtn>
        </div>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, flex: '1 1 100%', textAlign: 'center' }}>
          {headerLabel}
        </h2>
      </div>

      {view === 'month'
        ? <MonthView currentDate={currentDate} appointments={appointments} onSelectAppointment={onSelectAppointment} />
        : <WeekView
            currentDate={currentDate}
            appointments={appointments}
            onSelectAppointment={onSelectAppointment}
            onAppointmentChange={onAppointmentChange}
            dragEnabled={isLandscape}
          />
      }
      {view === 'week' && !isLandscape && (
        <p style={{ fontSize: 11, color: '#9ca3af', textAlign: 'center', marginTop: 8 }}>
          Rotate to landscape to drag appointments to a new time.
        </p>
      )}
    </div>
  );
}

// ---------- Month View ----------

function MonthView({ currentDate, appointments, onSelectAppointment }: {
  currentDate: Date;
  appointments: Appointment[];
  onSelectAppointment: (a: Appointment) => void;
}) {
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(monthStart);
  const calendarStart = startOfWeek(monthStart);
  const calendarEnd = endOfWeek(monthEnd);
  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  return (
    <>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1,
        backgroundColor: '#e5e7eb', marginBottom: 1,
      }}>
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
          <div key={d} style={{
            padding: '10px 8px', backgroundColor: '#f9f9f9',
            fontWeight: 600, textAlign: 'center', fontSize: 13,
          }}>{d}</div>
        ))}
      </div>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, backgroundColor: '#e5e7eb',
      }}>
        {days.map(day => {
          const dayAppts = appointmentsOn(appointments, day);
          const inCurrentMonth = isSameMonth(day, monthStart);
          const isToday = isSameDay(day, new Date());
          return (
            <div key={format(day, 'yyyy-MM-dd')} style={{
              backgroundColor: inCurrentMonth ? '#ffffff' : '#f3f4f6',
              minHeight: 110, padding: 6, opacity: inCurrentMonth ? 1 : 0.5,
            }}>
              <div style={{
                fontWeight: isToday ? 700 : 400,
                marginBottom: 4, color: isToday ? '#3b82f6' : '#374151', fontSize: 12,
              }}>{format(day, 'd')}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {dayAppts.slice(0, 3).map(apt => (
                  <AppointmentChip key={apt.id} apt={apt} onClick={() => onSelectAppointment(apt)} />
                ))}
                {dayAppts.length > 3 && (
                  <div style={{ fontSize: 10, color: '#9ca3af' }}>+{dayAppts.length - 3} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ---------- Week View ----------

function WeekView({ currentDate, appointments, onSelectAppointment, onAppointmentChange, dragEnabled }: {
  currentDate: Date;
  appointments: Appointment[];
  onSelectAppointment: (a: Appointment) => void;
  onAppointmentChange: (a: Appointment) => void;
  dragEnabled: boolean;
}) {
  const weekStart = startOfWeek(currentDate);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const hours = Array.from({ length: VISIBLE_END_HOUR - VISIBLE_START_HOUR }, (_, i) => VISIBLE_START_HOUR + i);
  const totalHeight = (VISIBLE_END_HOUR - VISIBLE_START_HOUR) * HOUR_HEIGHT;
  const today = new Date();

  // Active drag — only one appointment moves at a time. dragState tracks
  // the snapped delta so we can show a floating preview tooltip and apply
  // the change on pointer release.
  const [dragState, setDragState] = useState<null | {
    apt: Appointment;
    startY: number;
    deltaMin: number;       // minutes shifted (snapped to SNAP_MINUTES)
    targetDayISO: string;   // ISO date of the column the pointer is over
    cursorX: number;
    cursorY: number;
  }>(null);

  // Window-level pointer listeners so the drag survives when the cursor
  // leaves the original block.
  useEffect(() => {
    if (!dragState) return;
    const onMove = (e: PointerEvent) => {
      const deltaY = e.clientY - dragState.startY;
      const rawMin = (deltaY / HOUR_HEIGHT) * 60;
      const snappedMin = Math.round(rawMin / SNAP_MINUTES) * SNAP_MINUTES;
      // Use elementFromPoint to detect which day column the cursor is over.
      // Each day column carries a data-day-iso attribute.
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const dayEl = el?.closest('[data-day-iso]') as HTMLElement | null;
      const targetDayISO = dayEl?.dataset.dayIso || dragState.targetDayISO;
      setDragState(prev => prev && {
        ...prev,
        deltaMin: snappedMin,
        targetDayISO,
        cursorX: e.clientX,
        cursorY: e.clientY,
      });
    };
    const onUp = () => {
      const ds = dragState;
      setDragState(null);
      if (!ds) return;
      const newStart = computeDraggedStart(ds.apt, ds.deltaMin, ds.targetDayISO);
      const newEnd = computeDraggedEnd(ds.apt, ds.deltaMin, ds.targetDayISO);
      if (newStart === ds.apt.startTime && newEnd === ds.apt.endTime) return;
      onAppointmentChange({ ...ds.apt, startTime: newStart, endTime: newEnd });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragState, onAppointmentChange]);

  const beginDrag = (apt: Appointment, e: React.PointerEvent) => {
    if (!dragEnabled) return;
    // Locked = canceled or completed. The legacy isFixed field is ignored.
    if (apt.status === 'canceled' || apt.status === 'completed') return;
    e.preventDefault();
    e.stopPropagation();
    const day = apt.startTime.slice(0, 10);
    setDragState({
      apt, startY: e.clientY, deltaMin: 0,
      targetDayISO: day, cursorX: e.clientX, cursorY: e.clientY,
    });
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      {/* Day header */}
      <div style={{ display: 'flex', minWidth: 560, borderBottom: '1px solid #e5e7eb' }}>
        <div style={{ width: TIME_AXIS_WIDTH, flexShrink: 0 }} />
        {days.map(day => {
          const isToday = isSameDay(day, today);
          return (
            <div key={day.toISOString()} style={{
              flex: 1, textAlign: 'center', padding: '8px 4px',
              fontSize: 12, fontWeight: 600,
              color: isToday ? '#3b82f6' : '#374151',
              backgroundColor: isToday ? '#eff6ff' : 'transparent',
              borderLeft: '1px solid #f3f4f6',
            }}>
              <div>{format(day, 'EEE')}</div>
              <div style={{ fontSize: 16 }}>{format(day, 'd')}</div>
            </div>
          );
        })}
      </div>

      {/* Body: time axis + 7 day columns */}
      <div style={{ display: 'flex', minWidth: 560, height: totalHeight, position: 'relative' }}>
        {/* Time axis */}
        <div style={{ width: TIME_AXIS_WIDTH, flexShrink: 0, position: 'relative', borderRight: '1px solid #e5e7eb' }}>
          {hours.map(h => (
            <div key={h} style={{
              position: 'absolute', top: (h - VISIBLE_START_HOUR) * HOUR_HEIGHT,
              fontSize: 10, color: '#6b7280', padding: '2px 4px', right: 4,
            }}>{formatHourLabel(h)}</div>
          ))}
        </div>

        {/* Day columns */}
        {days.map(day => {
          const dayISO = format(day, 'yyyy-MM-dd');
          const dayAppts = appointmentsOn(appointments, day);
          const laid = layoutAppointments(dayAppts);
          const isToday = isSameDay(day, today);
          return (
            <div key={dayISO}
              data-day-iso={dayISO}
              style={{
                flex: 1, position: 'relative', borderLeft: '1px solid #f3f4f6',
                backgroundColor: isToday ? '#fafbff' : 'transparent',
              }}>
              {/* Hour grid lines */}
              {hours.map(h => (
                <div key={h} style={{
                  position: 'absolute', top: (h - VISIBLE_START_HOUR) * HOUR_HEIGHT,
                  left: 0, right: 0, borderTop: '1px solid #f3f4f6',
                }} />
              ))}
              {/* Appointments */}
              {laid.map(({ appt, lane, lanes }) => {
                const layout = appointmentLayout(appt);
                if (!layout) return null;
                const widthPct = 100 / lanes;
                const beingDragged = dragState?.apt.id === appt.id;
                return (
                  <AppointmentBlock
                    key={appt.id}
                    apt={appt}
                    onClick={() => onSelectAppointment(appt)}
                    onPointerDown={dragEnabled ? (e) => beginDrag(appt, e) : undefined}
                    dragHandle={dragEnabled && appt.status !== 'canceled' && appt.status !== 'completed'}
                    style={{
                      position: 'absolute',
                      top: layout.top,
                      height: layout.height,
                      left: `calc(${lane * widthPct}% + 2px)`,
                      width: `calc(${widthPct}% - 4px)`,
                      opacity: beingDragged ? 0.4 : 1,
                    }}
                  />
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Floating drag preview tooltip */}
      {dragState && (() => {
        const newStart = computeDraggedStart(dragState.apt, dragState.deltaMin, dragState.targetDayISO);
        const d = new Date(newStart);
        return (
          <div style={{
            position: 'fixed',
            top: dragState.cursorY + 14,
            left: dragState.cursorX + 14,
            background: '#1f2937', color: 'white',
            padding: '6px 10px', borderRadius: 4, fontSize: 12,
            pointerEvents: 'none', zIndex: 1500, boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
            whiteSpace: 'nowrap',
          }}>
            {format(d, 'EEE M/d, h:mm a')}
          </div>
        );
      })()}
    </div>
  );
}

// Returns the new ISO startTime if we apply the snapped time delta and the
// targeted day column. Preserves the original time-of-day baseline + applies
// the minute offset, then changes the date to the target day.
function computeDraggedStart(apt: Appointment, deltaMin: number, targetDayISO: string): string {
  const original = new Date(apt.startTime);
  const target = new Date(`${targetDayISO}T00:00:00`);
  // Use the original's hours/minutes as the baseline, shifted by deltaMin.
  const newDate = new Date(target);
  newDate.setHours(original.getHours(), original.getMinutes() + deltaMin, 0, 0);
  return formatLocalISO(newDate);
}

function computeDraggedEnd(apt: Appointment, deltaMin: number, targetDayISO: string): string {
  const original = new Date(apt.startTime);
  const originalEnd = new Date(apt.endTime);
  const durationMs = originalEnd.getTime() - original.getTime();
  const start = new Date(computeDraggedStart(apt, deltaMin, targetDayISO));
  return formatLocalISO(new Date(start.getTime() + durationMs));
}

// Match the `YYYY-MM-DDTHH:MM:SS` format used by the seeder so calendar
// `startTime.startsWith('YYYY-MM-DD')` filters keep working.
function formatLocalISO(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ---------- Shared chip / block / helpers ----------

function appointmentsOn(appointments: Appointment[], date: Date): Appointment[] {
  const dateStr = format(date, 'yyyy-MM-dd');
  return appointments.filter(a => a.startTime.startsWith(dateStr));
}

function getTypeColor(type: string): string {
  switch (type) {
    case 'supervision': return '#10b981';
    case 'parent-training': return '#3b82f6';
    case 'client-session': return '#8b5cf6';
    case 'internal-task': return '#6b7280';
    default: return '#9ca3af';
  }
}

// Returns background, color, status icon, etc., consistent across views.
function appointmentLook(apt: Appointment) {
  const canceled = apt.status === 'canceled';
  const completed = apt.status === 'completed';
  const baseColor = getTypeColor(apt.type);
  const stripeBg = canceled
    ? 'repeating-linear-gradient(45deg, #fca5a5, #fca5a5 6px, #9ca3af 6px, #9ca3af 12px)'
    : completed
    ? 'repeating-linear-gradient(45deg, #86efac, #86efac 6px, #ffffff 6px, #ffffff 12px)'
    : undefined;
  return {
    canceled, completed,
    background: stripeBg ?? baseColor,
    color: canceled || completed ? '#1f2937' : 'white',
    statusIcon: canceled ? '✕' : completed ? '✓' : null,
    statusColor: canceled ? '#b91c1c' : '#15803d',
  };
}

function AppointmentChip({ apt, onClick }: { apt: Appointment; onClick: () => void }) {
  const look = appointmentLook(apt);
  return (
    <div
      onClick={e => { e.stopPropagation(); onClick(); }}
      style={{
        background: look.background, color: look.color,
        padding: '3px 4px', borderRadius: 3, fontSize: 10,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        cursor: 'pointer', position: 'relative',
        paddingRight: look.statusIcon ? 14 : 4,
        textDecoration: look.canceled ? 'line-through' : 'none',
        opacity: look.canceled ? 0.85 : 1,
        border: 'none',
      }}
      title={apt.title + (look.canceled ? ' (canceled)' : look.completed ? ' (completed)' : '')}
    >
      {apt.title}
      {look.statusIcon && (
        <span style={{ position: 'absolute', top: 1, right: 3, fontSize: 10, fontWeight: 700, color: look.statusColor, lineHeight: 1 }}>
          {look.statusIcon}
        </span>
      )}
    </div>
  );
}

function AppointmentBlock({ apt, onClick, onPointerDown, dragHandle, style }: {
  apt: Appointment;
  onClick: () => void;
  onPointerDown?: (e: React.PointerEvent) => void;
  dragHandle?: boolean;
  style: React.CSSProperties;
}) {
  const look = appointmentLook(apt);
  // When drag is enabled, suppress the click (click fires after pointerup
  // and would re-open the detail panel after a drag). Track whether the
  // pointer moved meaningfully between down and up to distinguish tap vs drag.
  const movedRef = React.useRef(false);
  return (
    <div
      onPointerDown={(e) => {
        movedRef.current = false;
        if (onPointerDown) onPointerDown(e);
      }}
      onPointerMove={() => { movedRef.current = true; }}
      onClick={e => {
        e.stopPropagation();
        if (movedRef.current && dragHandle) return; // it was a drag, not a tap
        onClick();
      }}
      style={{
        ...style,
        background: look.background, color: look.color,
        padding: '4px 6px', borderRadius: 4, fontSize: 11,
        overflow: 'hidden', cursor: dragHandle ? 'grab' : 'pointer', boxSizing: 'border-box',
        border: '1px solid rgba(0,0,0,0.05)',
        textDecoration: look.canceled ? 'line-through' : 'none',
        touchAction: dragHandle ? 'none' : 'manipulation',
      }}
      title={apt.title + (look.canceled ? ' (canceled)' : look.completed ? ' (completed)' : '')}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 4 }}>
        <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{apt.title}</span>
        {look.statusIcon && (
          <span style={{ fontSize: 11, fontWeight: 700, color: look.statusColor, lineHeight: 1, flexShrink: 0 }}>
            {look.statusIcon}
          </span>
        )}
      </div>
      <div style={{ fontSize: 10, opacity: 0.85, marginTop: 2 }}>
        {format(new Date(apt.startTime), 'h:mm')}–{format(new Date(apt.endTime), 'h:mm a')}
      </div>
    </div>
  );
}

// Returns the {top, height} of an appointment in pixels within the week-view
// time grid, or null if it falls entirely outside the visible hour range.
function appointmentLayout(apt: Appointment): { top: number; height: number } | null {
  const start = new Date(apt.startTime);
  const end = new Date(apt.endTime);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
  const startHrs = start.getHours() + start.getMinutes() / 60;
  const endHrs = end.getHours() + end.getMinutes() / 60;
  if (endHrs <= VISIBLE_START_HOUR || startHrs >= VISIBLE_END_HOUR) return null;
  const clampedStart = Math.max(startHrs, VISIBLE_START_HOUR);
  const clampedEnd = Math.min(endHrs, VISIBLE_END_HOUR);
  const top = (clampedStart - VISIBLE_START_HOUR) * HOUR_HEIGHT;
  const height = Math.max(20, (clampedEnd - clampedStart) * HOUR_HEIGHT);
  return { top, height };
}

// Greedy lane assignment for overlapping appointments. Within each cluster of
// overlapping events, every event gets a lane index 0..N-1 and N is recorded
// so the renderer can size each event to (1/N) of the column width.
function layoutAppointments(appts: Appointment[]): { appt: Appointment; lane: number; lanes: number }[] {
  const sorted = [...appts].sort((a, b) =>
    new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );
  const result: { appt: Appointment; lane: number; lanes: number }[] = [];
  let cluster: Appointment[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    if (!cluster.length) return;
    const laneEnds: number[] = [];
    const assigned: number[] = [];
    for (const a of cluster) {
      const start = new Date(a.startTime).getTime();
      let lane = laneEnds.findIndex(e => e <= start);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(0);
      }
      laneEnds[lane] = new Date(a.endTime).getTime();
      assigned.push(lane);
    }
    const lanes = laneEnds.length;
    cluster.forEach((a, i) => result.push({ appt: a, lane: assigned[i], lanes }));
    cluster = [];
  };

  for (const a of sorted) {
    const start = new Date(a.startTime).getTime();
    const end = new Date(a.endTime).getTime();
    if (start >= clusterEnd) {
      flush();
      clusterEnd = end;
    } else {
      clusterEnd = Math.max(clusterEnd, end);
    }
    cluster.push(a);
  }
  flush();
  return result;
}

function formatHourLabel(h: number): string {
  if (h === 0) return '12a';
  if (h === 12) return '12p';
  if (h < 12) return `${h}a`;
  return `${h - 12}p`;
}

// ---------- Toolbar buttons ----------

function ViewBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      padding: '6px 14px', border: 'none',
      backgroundColor: active ? '#3b82f6' : 'white',
      color: active ? 'white' : '#374151',
      cursor: 'pointer', fontSize: 13, fontWeight: 600,
    }}>{children}</button>
  );
}

function NavBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      padding: '6px 12px', backgroundColor: '#e5e7eb', border: 'none',
      borderRadius: 4, cursor: 'pointer', fontSize: 13,
    }}>{children}</button>
  );
}
