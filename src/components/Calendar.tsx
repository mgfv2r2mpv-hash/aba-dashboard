import React, { useState, useEffect } from 'react';
import { Appointment, Technician, Client, CompanySettings } from '../types';
import { DraftMark } from '../draft';
import { rollupHours, resolveUtilization, HoursByStatus } from '../utilization';
import {
  startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek, endOfWeek,
  format, isSameMonth, isSameDay, addMonths, subMonths, addWeeks, subWeeks, addDays, getDay,
} from 'date-fns';

interface CalendarProps {
  appointments: Appointment[];
  technicians: Technician[];
  clients: Client[];
  settings?: CompanySettings;
  onAppointmentChange: (appointment: Appointment) => void;
  onSelectAppointment: (appointment: Appointment | null) => void;
  // Reports the currently-viewed date (month/week anchor) so the parent can
  // scope month-bound concerns (e.g. conflict checks) to what's on screen.
  onViewDateChange?: (date: Date) => void;
  // When a draft is open, marks staged appointments (add/move/shorten/remove)
  // so they render as "proposed"/tombstoned rather than committed sessions.
  draftMarks?: Map<string, DraftMark>;
}

type View = 'month' | 'week';
// Which slice of the schedule the calendar shows. BT = appointments assigned to
// a technician (direct service); BCBA = appointments with no technician (the
// clinician's own: supervision, BCBA-run parent training, etc.).
type Lens = 'bcba' | 'bt';

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
  settings,
  onAppointmentChange,
  onSelectAppointment,
  onViewDateChange,
  draftMarks,
}: CalendarProps) {
  const [view, setView] = useState<View>('month');
  const [lens, setLens] = useState<Lens>('bcba');
  const [currentDate, setCurrentDate] = useState(new Date());
  const isLandscape = useIsLandscape();

  // Surface the viewed anchor date to the parent whenever it changes.
  useEffect(() => {
    onViewDateChange?.(currentDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDate]);

  // The lens hides the other party's appointments: BT = has a technician,
  // BCBA = none. Totals are computed from these filtered appointments too.
  const lensAppts = appointments.filter(a => (lens === 'bt' ? !!a.technician : !a.technician));

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
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 4, border: '1px solid #d1d5db', borderRadius: 6, overflow: 'hidden' }}>
            <ViewBtn active={view === 'month'} onClick={() => setView('month')}>Month</ViewBtn>
            <ViewBtn active={view === 'week'} onClick={() => setView('week')}>Week</ViewBtn>
          </div>
          <div style={{ display: 'flex', gap: 4, border: '1px solid #d1d5db', borderRadius: 6, overflow: 'hidden' }}>
            <ViewBtn active={lens === 'bcba'} onClick={() => setLens('bcba')}>BCBA</ViewBtn>
            <ViewBtn active={lens === 'bt'} onClick={() => setLens('bt')}>BT</ViewBtn>
          </div>
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
        ? <MonthView currentDate={currentDate} appointments={lensAppts} lens={lens} settings={settings} onSelectAppointment={onSelectAppointment} draftMarks={draftMarks} />
        : <WeekView
            currentDate={currentDate}
            appointments={lensAppts}
            onSelectAppointment={onSelectAppointment}
            onAppointmentChange={onAppointmentChange}
            dragEnabled={isLandscape}
            draftMarks={draftMarks}
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

function MonthView({ currentDate, appointments, lens, settings, onSelectAppointment, draftMarks }: {
  currentDate: Date;
  appointments: Appointment[];
  lens: Lens;
  settings?: CompanySettings;
  onSelectAppointment: (a: Appointment) => void;
  draftMarks?: Map<string, DraftMark>;
}) {
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(monthStart);
  const calendarStart = startOfWeek(monthStart);
  const calendarEnd = endOfWeek(monthEnd);
  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  const util = resolveUtilization(settings?.utilization);
  const weeklyTarget = lens === 'bt' ? util.btWeeklyDirectHours : util.bcbaWeeklyBillableHours;

  const weekRows = days.length / 7;
  // Week rows that touch the month at all — drives the ribbon and the BT
  // monthly denominator (weeks present × weekly target).
  let inMonthWeeks = 0;
  // "Work weeks" for the BCBA monthly goal: a row only counts as a full work
  // week if it has 3+ of this month's weekdays. June 2026's trailing Mon/Tue
  // (Jun 29–30) is a 2-weekday stub, so June is a 4-week month, not 5.
  let workWeeks = 0;
  for (let r = 0; r < weekRows; r++) {
    const row = days.slice(r * 7, r * 7 + 7);
    if (row.some(d => isSameMonth(d, monthStart))) inMonthWeeks++;
    const weekdaysInMonth = row.filter(d => isSameMonth(d, monthStart) && getDay(d) >= 1 && getDay(d) <= 5).length;
    if (weekdaysInMonth >= 3) workWeeks++;
  }
  const monthlyGoal = workWeeks >= 5 ? util.bcbaMonthlyBillableHours5Week : util.bcbaMonthlyBillableHours;

  // One rollup per grid week, for the side ribbon.
  const weekSummaries = Array.from({ length: weekRows }, (_, r) => {
    const weekStart = days[r * 7];
    return {
      weekStart,
      inMonth: days.slice(r * 7, r * 7 + 7).some(d => isSameMonth(d, monthStart)),
      hours: rollupHours(appointments, weekStart.getTime(), addDays(weekStart, 7).getTime(), lens),
    };
  });
  const monthHours = rollupHours(appointments, monthStart.getTime(), monthEnd.getTime() + 1, lens);

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 260px', minWidth: 0 }}>
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
            const dow = getDay(day); // 0 = Sun
            const weekStart = startOfWeek(day);
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
                    <AppointmentChip key={apt.id} apt={apt} mark={draftMarks?.get(apt.id)} onClick={() => onSelectAppointment(apt)} />
                  ))}
                  {dayAppts.length > 3 && (
                    <div style={{ fontSize: 10, color: '#9ca3af' }}>+{dayAppts.length - 3} more</div>
                  )}
                </div>
                {inCurrentMonth && dow === 0 && (
                  <SundayTotal
                    lens={lens}
                    hours={rollupHours(appointments, weekStart.getTime(), addDays(weekStart, 7).getTime(), lens)}
                    target={weeklyTarget}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <WeekRibbon
        lens={lens}
        weeks={weekSummaries}
        weeklyTarget={weeklyTarget}
        monthHours={monthHours}
        monthlyGoal={lens === 'bcba' ? monthlyGoal : undefined}
        monthWeeks={lens === 'bcba' ? workWeeks : inMonthWeeks}
      />
    </div>
  );
}

// Round to ≤1 decimal, dropping a trailing .0.
function fmtH(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

// On-track color from completed-vs-target, allowing scheduled to "rescue" it.
function trackColor(hours: HoursByStatus, target: number): string {
  const projected = hours.completed + hours.scheduled;
  if (hours.completed >= target) return '#15803d'; // met
  if (projected >= target) return '#b45309';        // on pace
  return '#b91c1c';                                 // behind
}

// Compact weekly total printed inside the Sunday cell. Headlines the live total
// (completed + scheduled) so booked-but-not-yet-done hours are visible, with the
// ✓completed / ◻scheduled / ✕canceled breakdown and a cap gauge.
function SundayTotal({ lens, hours, target }: { lens: Lens; hours: HoursByStatus; target: number }) {
  const live = hours.completed + hours.scheduled;
  const color = trackColor(hours, target);
  return (
    <div
      style={{ marginTop: 4, fontSize: 9, lineHeight: 1.25 }}
      title={`${lens === 'bt' ? 'BT direct' : 'BCBA billable'} this week: ${fmtH(hours.completed)}h completed, ${fmtH(hours.scheduled)}h scheduled, ${fmtH(hours.canceled)}h canceled — target ${fmtH(target)}h`}
    >
      <div style={{ fontWeight: 700, color: '#374151' }}>{lens === 'bt' ? 'BT wk' : 'BCBA wk'}</div>
      <div style={{ fontWeight: 600, color }}>{fmtH(live)}/{fmtH(target)}h</div>
      <div style={{ color: '#6b7280' }}>
        ✓{fmtH(hours.completed)} ◻{fmtH(hours.scheduled)}{hours.canceled > 0 ? ` ✕${fmtH(hours.canceled)}` : ''}
      </div>
      <CapBar hours={hours} target={target} />
    </div>
  );
}

// Usage gauge. Full width = target (e.g., 165h goal). Segments left→right:
// completed (green), scheduled (gray), then canceled — family (orange) and
// staff (red) — to the RIGHT of a black "cap" line drawn at the live total
// (completed + scheduled). As sessions cancel, the live total drops, the black
// cap line shifts left, and the canceled hours show the lost ceiling.
function CapBar({ hours, target }: { hours: HoursByStatus; target: number }) {
  const denom = target > 0
    ? target
    : Math.max(hours.completed + hours.scheduled + hours.canceled, 1);
  const pct = (h: number) => Math.max(0, Math.min(100, (h / denom) * 100));
  const capPct = Math.max(0, Math.min(100, ((hours.completed + hours.scheduled) / denom) * 100));
  return (
    <div style={{ position: 'relative', marginTop: 4 }}>
      <div style={{ height: 8, background: '#e5e7eb', borderRadius: 3, overflow: 'hidden', display: 'flex' }}>
        <div style={{ width: `${pct(hours.completed)}%`, background: '#16a34a' }} />
        <div style={{ width: `${pct(hours.scheduled)}%`, background: '#9ca3af' }} />
        <div style={{ width: `${pct(hours.canceledFamily)}%`, background: '#f97316' }} />
        <div style={{ width: `${pct(hours.canceledStaff)}%`, background: '#dc2626' }} />
      </div>
      <div
        style={{ position: 'absolute', top: -1, bottom: -1, left: `${capPct}%`, width: 2, background: '#111827', transform: 'translateX(-1px)' }}
        title="Scheduled cap (completed + scheduled)"
      />
    </div>
  );
}

type WeekSummary = { weekStart: Date; inMonth: boolean; hours: HoursByStatus };

// Vertical ribbon beside the grid: one row per in-month week + a month total.
function WeekRibbon({ lens, weeks, weeklyTarget, monthHours, monthlyGoal, monthWeeks }: {
  lens: Lens;
  weeks: WeekSummary[];
  weeklyTarget: number;
  monthHours: HoursByStatus;
  monthlyGoal?: number;       // BCBA only
  monthWeeks: number;
}) {
  return (
    <div style={{ flex: '1 1 150px', minWidth: 140, maxWidth: 240, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#111827' }}>
        {lens === 'bt' ? 'BT direct hours' : 'BCBA billable hours'}
      </div>
      {weeks.filter(w => w.inMonth).map((w, i) => {
        const color = trackColor(w.hours, weeklyTarget);
        const live = w.hours.completed + w.hours.scheduled;
        return (
          <div key={i} style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: '6px 8px', background: '#fff' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#374151' }}>Wk {format(w.weekStart, 'M/d')}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color }}>{fmtH(live)}/{fmtH(weeklyTarget)}h</span>
            </div>
            <CapBar hours={w.hours} target={weeklyTarget} />
            <div style={{ fontSize: 10, color: '#6b7280', marginTop: 3 }}>
              ✓{fmtH(w.hours.completed)} · ◻{fmtH(w.hours.scheduled)}{w.hours.canceled > 0 ? ` · ✕${fmtH(w.hours.canceled)}` : ''}
            </div>
          </div>
        );
      })}

      <MonthTotalRow lens={lens} hours={monthHours} goal={monthlyGoal} weeklyTarget={weeklyTarget} monthWeeks={monthWeeks} />
      <Legend />
    </div>
  );
}

function MonthTotalRow({ lens, hours, goal, weeklyTarget, monthWeeks }: {
  lens: Lens;
  hours: HoursByStatus;
  goal?: number;
  weeklyTarget: number;
  monthWeeks: number;
}) {
  const live = hours.completed + hours.scheduled;
  // BCBA has an explicit monthly goal; BT rolls up against weeks × weekly target.
  const denom = goal ?? weeklyTarget * monthWeeks;
  const color = goal !== undefined
    ? (hours.completed >= goal ? '#15803d' : live >= goal ? '#b45309' : '#b91c1c')
    : trackColor(hours, denom);
  return (
    <div style={{ border: '1px solid #d1d5db', borderRadius: 6, padding: '8px', background: '#f9fafb' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#111827' }}>
        Month total{goal !== undefined ? ` (${monthWeeks}-wk goal)` : ''}
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color, marginTop: 2 }}>
        {fmtH(live)}/{fmtH(denom)}h
      </div>
      <CapBar hours={hours} target={denom} />
      <div style={{ fontSize: 10, color: '#6b7280', marginTop: 4 }}>
        ✓{fmtH(hours.completed)}h done · ◻{fmtH(hours.scheduled)}h sched{hours.canceled > 0 ? ` · ✕${fmtH(hours.canceled)}h canc` : ''}
      </div>
    </div>
  );
}

function Legend() {
  const items: { c: string; label: string }[] = [
    { c: '#9ca3af', label: 'Pending' },
    { c: '#16a34a', label: 'Completed' },
    { c: '#f97316', label: 'Family cancel' },
    { c: '#dc2626', label: 'Staff cancel' },
  ];
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', fontSize: 10, color: '#6b7280', marginTop: 2 }}>
      {items.map(it => (
        <span key={it.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: it.c, display: 'inline-block' }} />
          {it.label}
        </span>
      ))}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <span style={{ width: 2, height: 11, background: '#111827', display: 'inline-block' }} />
        Scheduled cap
      </span>
    </div>
  );
}

// ---------- Week View ----------

function WeekView({ currentDate, appointments, onSelectAppointment, onAppointmentChange, dragEnabled, draftMarks }: {
  currentDate: Date;
  appointments: Appointment[];
  onSelectAppointment: (a: Appointment) => void;
  onAppointmentChange: (a: Appointment) => void;
  dragEnabled: boolean;
  draftMarks?: Map<string, DraftMark>;
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
                const mark = draftMarks?.get(appt.id);
                const draggable = dragEnabled && appt.status !== 'canceled' && appt.status !== 'completed'
                  && !appt.isGhost && mark !== 'remove';
                return (
                  <AppointmentBlock
                    key={appt.id}
                    apt={appt}
                    mark={mark}
                    onClick={() => onSelectAppointment(appt)}
                    onPointerDown={draggable ? (e) => beginDrag(appt, e) : undefined}
                    dragHandle={draggable}
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

// Status-based coloring so cancellation trends are visible at a glance across a
// week: gray = pending, green = completed, and canceled splits by who canceled —
// orange-red for family, bright red for staff (BT/BCBA/admin). Appointment type
// is conveyed by the title text rather than color in this view.
function appointmentLook(apt: Appointment, mark?: DraftMark) {
  const canceled = apt.status === 'canceled';
  const completed = apt.status === 'completed';
  let background = '#9ca3af'; // pending
  if (completed) background = '#16a34a';
  else if (canceled) background = apt.cancellation?.source === 'family' ? '#f97316' : '#dc2626';

  let color = 'white';
  let border = '1px solid rgba(0,0,0,0.05)';
  let opacity = canceled ? 0.85 : 1;
  let strike = canceled;
  let prefix = '';

  // Ghost = wished-for, never placed: a faint dashed reminder.
  if (apt.isGhost) {
    background = '#f3f4f6'; color = '#6b7280'; border = '1px dashed #9ca3af';
    opacity = 0.9; prefix = '👻 ';
  } else if (mark) {
    // Draft (uncommitted) styling. Removes are tombstoned; the rest are
    // "proposed" with a dashed blue outline so they read as not-yet-saved.
    if (mark === 'remove') {
      background = '#fee2e2'; color = '#b91c1c'; border = '1px dashed #fca5a5';
      opacity = 0.7; strike = true; prefix = '🗑 ';
    } else {
      background = '#dbeafe'; color = '#1e3a8a'; border = '1px dashed #2563eb';
      opacity = 0.95; prefix = mark === 'add' ? '＋ ' : mark === 'shorten' ? '✂ ' : '✎ ';
    }
  }

  return {
    canceled, completed,
    background, color, border, opacity, strike, prefix,
    statusIcon: canceled ? '✕' : completed ? '✓' : null,
    statusColor: apt.isGhost || mark ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.95)',
  };
}

function AppointmentChip({ apt, mark, onClick }: { apt: Appointment; mark?: DraftMark; onClick: () => void }) {
  const look = appointmentLook(apt, mark);
  return (
    <div
      onClick={e => { e.stopPropagation(); onClick(); }}
      style={{
        background: look.background, color: look.color,
        padding: '3px 4px', borderRadius: 3, fontSize: 10,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        cursor: 'pointer', position: 'relative',
        paddingRight: look.statusIcon ? 14 : 4,
        textDecoration: look.strike ? 'line-through' : 'none',
        opacity: look.opacity,
        border: look.border,
        boxSizing: 'border-box',
      }}
      title={apt.title + (look.canceled ? ' (canceled)' : look.completed ? ' (completed)' : '')}
    >
      {look.prefix}{apt.title}
      {look.statusIcon && (
        <span style={{ position: 'absolute', top: 1, right: 3, fontSize: 10, fontWeight: 700, color: look.statusColor, lineHeight: 1 }}>
          {look.statusIcon}
        </span>
      )}
    </div>
  );
}

function AppointmentBlock({ apt, mark, onClick, onPointerDown, dragHandle, style }: {
  apt: Appointment;
  mark?: DraftMark;
  onClick: () => void;
  onPointerDown?: (e: React.PointerEvent) => void;
  dragHandle?: boolean;
  style: React.CSSProperties;
}) {
  const look = appointmentLook(apt, mark);
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
        border: look.border,
        opacity: look.opacity,
        textDecoration: look.strike ? 'line-through' : 'none',
        touchAction: dragHandle ? 'none' : 'manipulation',
      }}
      title={apt.title + (look.canceled ? ' (canceled)' : look.completed ? ' (completed)' : '')}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 4 }}>
        <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>{look.prefix}{apt.title}</span>
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
