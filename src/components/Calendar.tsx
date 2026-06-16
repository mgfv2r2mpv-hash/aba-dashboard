import React, { useState, useEffect } from 'react';
import { Appointment, Technician, Client, CompanySettings, TimeOff, DayOfWeek } from '../types';
import { DraftMark } from '../draft';
import { rollupHours, resolveUtilization, HoursByStatus, ptoHoursInRange, reduceRequirementForPto } from '../utilization';
import { tileStyle, clientPastel, clientDarkBorder, legendStripeStyle, clientAvailBarStyle } from '../calendarColors';
import { useMinWidth, useIsLandscape } from '../useMediaQuery';
import {
  startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek, endOfWeek,
  format, isSameMonth, isSameDay, addMonths, subMonths, addWeeks, subWeeks, addDays, getDay,
} from 'date-fns';

interface CalendarProps {
  appointments: Appointment[];
  technicians: Technician[];
  clients: Client[];
  settings?: CompanySettings;
  // BCBA leave; reduces the BCBA weekly/monthly billable requirement shown in
  // the hours ribbon and the in-grid Sunday total (Upgrade 1).
  timeOff?: TimeOff[];
  onAppointmentChange: (appointment: Appointment) => void;
  onSelectAppointment: (appointment: Appointment | null) => void;
  // Reports the currently-viewed date (month/week anchor) so the parent can
  // scope month-bound concerns (e.g. conflict checks) to what's on screen.
  onViewDateChange?: (date: Date) => void;
  // Reports the active lens (bcba/bt) so the parent can render the hours
  // totals in a docked side pane instead of inline.
  onLensChange?: (lens: 'bcba' | 'bt') => void;
  // When true, the parent renders the hours totals in the docked pane, so the
  // calendar suppresses its own inline ribbon.
  hideTotals?: boolean;
  // When a draft is open, marks staged appointments (add/move/shorten/remove)
  // so they render as "proposed"/tombstoned rather than committed sessions.
  draftMarks?: Map<string, DraftMark>;
  // Opens the add-appointment form; surfaced in the calendar toolbar.
  onAddAppointment?: () => void;
}

type View = 'month' | 'week' | 'day' | 'clients';
// Which slice of the schedule the calendar shows. BT = appointments assigned to
// a technician (direct service); BCBA = appointments with no technician (the
// clinician's own: supervision, BCBA-run parent training, etc.).
type Lens = 'bcba' | 'bt';

const VISIBLE_START_HOUR = 6;
const VISIBLE_END_HOUR = 22;
const HOUR_HEIGHT = 40;
const HOUR_HEIGHT_WIDE = 56;      // roomier hour rows on iPad and up
const TIME_AXIS_WIDTH = 52;
const TIME_AXIS_WIDTH_WIDE = 64;
// Snap drag movements to 15-minute slots — matches typical scheduling resolution.
const SNAP_MINUTES = 15;


export default function Calendar({
  appointments,
  technicians: _technicians,
  clients,
  settings,
  timeOff,
  onAppointmentChange,
  onSelectAppointment,
  onViewDateChange,
  onLensChange,
  hideTotals,
  draftMarks,
  onAddAppointment,
}: CalendarProps) {
  const [view, setView] = useState<View>('month');
  const [lens, setLens] = useState<Lens>('bcba');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [pickedDay, setPickedDay] = useState<Date | null>(null);
  const [selectedClientIds, setSelectedClientIds] = useState<string[]>([]);
  const isLandscape = useIsLandscape();
  // iPad and up: roomier rows, wider time axis, richer tiles, taller month cells.
  const roomy = useMinWidth(820);
  const hourHeight = roomy ? HOUR_HEIGHT_WIDE : HOUR_HEIGHT;
  const axisWidth = roomy ? TIME_AXIS_WIDTH_WIDE : TIME_AXIS_WIDTH;

  // From the month grid, tapping a day offers a jump to that day's week or day
  // view. Both set the anchor date first, then switch the view.
  const openDayIn = (target: View) => {
    if (pickedDay) setCurrentDate(pickedDay);
    setView(target);
    setPickedDay(null);
  };

  // Surface the viewed anchor date to the parent whenever it changes.
  useEffect(() => {
    onViewDateChange?.(currentDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDate]);

  // Surface the active lens so the parent can dock the hours totals.
  useEffect(() => {
    onLensChange?.(lens);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lens]);

  // The lens hides the other party's appointments: BT = has a technician,
  // BCBA = none. Non-billable appointments (admin tasks, etc.) show in both lenses.
  const lensAppts = appointments.filter(a =>
    a.isBillable === false || (lens === 'bt' ? !!a.technician : !a.technician)
  );

  // When a schedule loads with no appointments in the currently-shown range,
  // jump to the earliest appointment so users see their data.
  useEffect(() => {
    if (appointments.length === 0) return;
    const inRange = appointments.some(a => {
      const d = new Date(a.startTime);
      return view === 'month'
        ? isSameMonth(d, currentDate)
        : d >= startOfWeek(currentDate, { weekStartsOn: 1 }) && d <= endOfWeek(currentDate, { weekStartsOn: 1 });
    });
    if (inRange) return;
    const earliest = appointments
      .map(a => new Date(a.startTime))
      .filter(d => !isNaN(d.getTime()))
      .sort((a, b) => a.getTime() - b.getTime())[0];
    if (earliest) setCurrentDate(earliest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointments, view]);

  const goPrev = () => setCurrentDate(
    view === 'month' ? subMonths(currentDate, 1)
    : (view === 'week' || view === 'clients') ? subWeeks(currentDate, 1)
    : addDays(currentDate, -1)
  );
  const goNext = () => setCurrentDate(
    view === 'month' ? addMonths(currentDate, 1)
    : (view === 'week' || view === 'clients') ? addWeeks(currentDate, 1)
    : addDays(currentDate, 1)
  );
  const goToday = () => setCurrentDate(new Date());

  const headerLabel = view === 'month'
    ? format(currentDate, 'MMMM yyyy')
    : view === 'day'
    ? format(currentDate, 'EEEE, MMM d, yyyy')
    : (() => {
        const ws = startOfWeek(currentDate, { weekStartsOn: 1 });
        const we = endOfWeek(currentDate, { weekStartsOn: 1 });
        const sameMonth = isSameMonth(ws, we);
        return sameMonth
          ? `${format(ws, 'MMM d')} to ${format(we, 'd, yyyy')}`
          : `${format(ws, 'MMM d')} to ${format(we, 'MMM d, yyyy')}`;
      })();

  const weekDays = Array.from({ length: 7 }, (_, i) =>
    addDays(startOfWeek(currentDate, { weekStartsOn: 1 }), i)
  );
  const filteredClients = selectedClientIds.length === 0
    ? clients
    : clients.filter(c => selectedClientIds.includes(c.id));

  return (
    <div style={{ padding: 'clamp(8px, 3vw, 24px)', maxWidth: '100%', boxSizing: 'border-box' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 16, gap: 8, flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {onAddAppointment && (
            <button
              onClick={onAddAppointment}
              aria-label="Add appointment"
              title="Add appointment"
              style={{
                padding: '5px 10px', backgroundColor: '#3b82f6', color: 'white',
                border: 'none', borderRadius: 5, cursor: 'pointer',
                fontSize: 16, fontWeight: 700, lineHeight: 1,
              }}
            >+</button>
          )}
          <div style={{ display: 'flex', gap: 4, border: '1px solid #d1d5db', borderRadius: 6, overflow: 'hidden' }}>
            <ViewBtn active={view === 'month'} onClick={() => setView('month')}>Month</ViewBtn>
            <ViewBtn active={view === 'week'} onClick={() => setView('week')}>Week</ViewBtn>
            <ViewBtn active={view === 'day'} onClick={() => setView('day')}>Day</ViewBtn>
            <ViewBtn active={view === 'clients'} onClick={() => setView('clients')}>Clients</ViewBtn>
          </div>
          {view !== 'clients' && (
            <div style={{ display: 'flex', gap: 4, border: '1px solid #d1d5db', borderRadius: 6, overflow: 'hidden' }}>
              <ViewBtn active={lens === 'bcba'} onClick={() => setLens('bcba')}>BCBA</ViewBtn>
              <ViewBtn active={lens === 'bt'} onClick={() => setLens('bt')}>BT</ViewBtn>
            </div>
          )}
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

      {view === 'clients' && (
        <div style={{
          display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 8, marginBottom: 8,
          alignItems: 'center', WebkitOverflowScrolling: 'touch' as any, flexWrap: 'nowrap',
        }}>
          <button
            onClick={() => setSelectedClientIds([])}
            style={{
              padding: '4px 12px', borderRadius: 14,
              border: selectedClientIds.length === 0 ? 'none' : '1px solid #d1d5db',
              backgroundColor: selectedClientIds.length === 0 ? '#3b82f6' : '#f9fafb',
              color: selectedClientIds.length === 0 ? 'white' : '#374151',
              cursor: 'pointer', fontSize: 12, fontWeight: 600, flexShrink: 0, whiteSpace: 'nowrap',
            }}
          >All clients</button>
          {clients.map(c => {
            const selected = selectedClientIds.includes(c.id);
            const hasWindows = Object.values(c.availabilityWindows).some(w => w && w.length > 0);
            const s = clientAvailBarStyle(c.name);
            return (
              <button
                key={c.id}
                onClick={() => setSelectedClientIds(prev =>
                  prev.includes(c.id) ? prev.filter(id => id !== c.id) : [...prev, c.id]
                )}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '4px 10px', borderRadius: 14,
                  border: selected ? `2px solid ${s.borderColor}` : '1px solid #d1d5db',
                  backgroundColor: selected ? s.backgroundColor : '#f9fafb',
                  color: selected ? s.color : hasWindows ? '#374151' : '#9ca3af',
                  cursor: 'pointer', fontSize: 12, fontWeight: selected ? 700 : 500,
                  flexShrink: 0, whiteSpace: 'nowrap', opacity: hasWindows ? 1 : 0.6,
                }}
              >
                <span style={{
                  width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                  backgroundColor: hasWindows ? s.borderColor : '#d1d5db',
                  display: 'inline-block',
                }} />
                {c.name}
                {selected && <span style={{ fontSize: 9, marginLeft: 2 }}>✕</span>}
              </button>
            );
          })}
        </div>
      )}

      {view === 'month' && (
        <MonthView currentDate={currentDate} appointments={lensAppts} lens={lens} settings={settings} timeOff={timeOff} onSelectAppointment={onSelectAppointment} onPickDay={setPickedDay} draftMarks={draftMarks} roomy={roomy} />
      )}
      {view === 'month' && !hideTotals && (
        <div style={{ marginTop: 16 }}>
          <HoursSummary appointments={appointments} lens={lens} settings={settings} timeOff={timeOff} currentDate={currentDate} />
        </div>
      )}
      {view === 'week' && (
        <TimeGrid
          days={weekDays}
          appointments={lensAppts}
          onSelectAppointment={onSelectAppointment}
          onAppointmentChange={onAppointmentChange}
          dragEnabled={true}
          draftMarks={draftMarks}
          hourHeight={hourHeight}
          axisWidth={axisWidth}
          roomy={roomy}
        />
      )}
      {view === 'day' && (
        <TimeGrid
          days={[currentDate]}
          appointments={lensAppts}
          onSelectAppointment={onSelectAppointment}
          onAppointmentChange={onAppointmentChange}
          dragEnabled={true}
          draftMarks={draftMarks}
          hourHeight={hourHeight}
          axisWidth={axisWidth}
          roomy={roomy}
        />
      )}
      {view === 'clients' && (
        <ClientAvailMatrix
          clients={filteredClients}
          weekDays={weekDays}
          appointments={appointments}
        />
      )}
      {(view === 'week' || view === 'day') && !isLandscape && (
        <p style={{ fontSize: 11, color: '#9ca3af', textAlign: 'center', marginTop: 8 }}>
          Rotate to landscape to drag appointments to a new time.
        </p>
      )}

      {pickedDay && (
        <div
          onClick={() => setPickedDay(null)}
          style={{
            position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1400, padding: 16,
          }}
        >
          <div onClick={e => e.stopPropagation()} style={{
            background: 'white', borderRadius: 8, padding: 16, maxWidth: 320, width: '100%',
            boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
          }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>
              {format(pickedDay, 'EEEE, MMM d, yyyy')}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => openDayIn('week')}
                style={{
                  flex: 1, padding: '10px 12px', borderRadius: 6, border: '1px solid #d1d5db',
                  background: '#f9fafb', cursor: 'pointer', fontSize: 14, fontWeight: 600,
                }}
              >
                Week view
              </button>
              <button
                onClick={() => openDayIn('day')}
                style={{
                  flex: 1, padding: '10px 12px', borderRadius: 6, border: '1px solid #3b82f6',
                  background: '#3b82f6', color: 'white', cursor: 'pointer', fontSize: 14, fontWeight: 600,
                }}
              >
                Day view
              </button>
            </div>
            <button
              onClick={() => setPickedDay(null)}
              style={{
                marginTop: 12, width: '100%', padding: '8px 12px', borderRadius: 6,
                border: 'none', background: 'transparent', color: '#6b7280', cursor: 'pointer', fontSize: 13,
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Month View ----------

function MonthView({ currentDate, appointments, lens, settings, timeOff, onSelectAppointment, onPickDay, draftMarks, roomy }: {
  currentDate: Date;
  appointments: Appointment[];
  lens: Lens;
  settings?: CompanySettings;
  timeOff?: TimeOff[];
  onSelectAppointment: (a: Appointment) => void;
  onPickDay: (day: Date) => void;
  draftMarks?: Map<string, DraftMark>;
  roomy?: boolean;
}) {
  const maxChips = roomy ? 6 : 3;
  // Minimum readable width per day column. Below 7×this, the grid scrolls
  // horizontally inside its panel rather than smushing columns / pushing
  // weekend days off-screen.
  const colMin = roomy ? 108 : 92;
  // Which grid week-rows are expanded to reveal every appointment. Tapping a
  // cell's "+N more" expands the whole row downward (the CSS grid stretches
  // sibling cells to match), and a "Show less" control collapses it again.
  const [expandedRows, setExpandedRows] = useState<Set<number>>(() => new Set());
  const toggleRow = (r: number) => setExpandedRows(prev => {
    const next = new Set(prev);
    next.has(r) ? next.delete(r) : next.add(r);
    return next;
  });

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(monthStart);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd });

  const util = resolveUtilization(settings?.utilization);
  const weeklyTarget = lens === 'bt' ? util.btWeeklyDirectHours : util.bcbaWeeklyBillableHours;

  // Collapse all rows when navigating to a different month.
  const monthKey = format(monthStart, 'yyyy-MM');
  useEffect(() => { setExpandedRows(new Set()); }, [monthKey]);

  return (
      <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' as any, border: '1px solid #e5e7eb', borderRadius: 6 }}>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 1,
          backgroundColor: '#e5e7eb', marginBottom: 1, minWidth: colMin * 7,
        }}>
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
            <div key={d} style={{
              padding: '10px 8px', backgroundColor: '#f9f9f9',
              fontWeight: 600, textAlign: 'center', fontSize: roomy ? 15 : 13,
            }}>{d}</div>
          ))}
        </div>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 1, backgroundColor: '#e5e7eb', minWidth: colMin * 7,
        }}>
          {days.map((day, idx) => {
            const dayAppts = appointmentsOn(appointments, day);
            const inCurrentMonth = isSameMonth(day, monthStart);
            const isToday = isSameDay(day, new Date());
            const dow = getDay(day); // 0 = Sun (now the rightmost column)
            const weekStart = startOfWeek(day, { weekStartsOn: 1 });
            const rowIdx = Math.floor(idx / 7);
            const expanded = expandedRows.has(rowIdx);
            return (
              <div
                key={format(day, 'yyyy-MM-dd')}
                onClick={() => onPickDay(day)}
                title="Open week or day view"
                style={{
                  backgroundColor: inCurrentMonth ? '#ffffff' : '#f3f4f6',
                  minHeight: roomy ? 168 : 110, padding: roomy ? 8 : 6, opacity: inCurrentMonth ? 1 : 0.5,
                  cursor: 'pointer', overflow: 'hidden',
                }}
              >
                <div style={{
                  fontWeight: isToday ? 700 : 400,
                  marginBottom: 4, color: isToday ? '#3b82f6' : '#374151', fontSize: roomy ? 15 : 12,
                }}>{format(day, 'd')}</div>
                {/* Sunday: weekly totals always appear at the top, before appointments. */}
                {dow === 0 && (
                  <SundayTotal
                    lens={lens}
                    hours={rollupHours(appointments, weekStart.getTime(), addDays(weekStart, 7).getTime(), lens)}
                    target={lens === 'bcba'
                      ? reduceRequirementForPto(weeklyTarget, ptoHoursInRange(timeOff, weekStart.getTime(), addDays(weekStart, 7).getTime()), settings?.ptoBillableDeductionRatio)
                      : weeklyTarget}
                  />
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {(expanded ? dayAppts : dayAppts.slice(0, maxChips)).map(apt => (
                    <AppointmentChip key={apt.id} apt={apt} mark={draftMarks?.get(apt.id)} onClick={() => onSelectAppointment(apt)} />
                  ))}
                  {dayAppts.length > maxChips && !expanded && (
                    <div
                      onClick={e => { e.stopPropagation(); toggleRow(rowIdx); }}
                      style={{ fontSize: 10, color: '#3b82f6', fontWeight: 600, cursor: 'pointer' }}
                    >+{dayAppts.length - maxChips} more ▾</div>
                  )}
                  {dayAppts.length > maxChips && expanded && (
                    <div
                      onClick={e => { e.stopPropagation(); toggleRow(rowIdx); }}
                      style={{ fontSize: 10, color: '#3b82f6', fontWeight: 600, cursor: 'pointer' }}
                    >Show less ▴</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
  );
}

// ---------- Hours totals (BT direct / BCBA billable) ----------

// Self-contained monthly hours summary: one card per grid week + a month total.
// Computes its own rollups from the (unfiltered) appointments + lens so it can
// be rendered either inline under the month grid (narrow screens) or docked in
// the side pane (wide screens). rollupHours filters by lens internally.
export function HoursSummary({ appointments, lens, settings, timeOff, currentDate }: {
  appointments: Appointment[];
  lens: Lens;
  settings?: CompanySettings;
  timeOff?: TimeOff[];
  currentDate: Date;
}) {
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(monthStart);
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
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
  const monthlyGoalBase = workWeeks >= 5 ? util.bcbaMonthlyBillableHours5Week : util.bcbaMonthlyBillableHours;
  // BCBA leave taken within the month proper shaves the monthly goal too, by the
  // same ratio. BT direct hours are unaffected by the BCBA's PTO.
  const ptoRatio = settings?.ptoBillableDeductionRatio;
  const monthPtoHours = ptoHoursInRange(timeOff, monthStart.getTime(), monthEnd.getTime() + 1);
  const monthlyGoal = lens === 'bcba'
    ? reduceRequirementForPto(monthlyGoalBase, monthPtoHours, ptoRatio)
    : monthlyGoalBase;

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
    <WeekRibbon
      lens={lens}
      weeks={weekSummaries}
      weeklyTarget={weeklyTarget}
      timeOff={timeOff}
      ptoRatio={ptoRatio}
      monthHours={monthHours}
      monthlyGoal={lens === 'bcba' ? monthlyGoal : undefined}
      monthWeeks={lens === 'bcba' ? workWeeks : inMonthWeeks}
    />
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
      style={{ marginTop: 4, marginBottom: 5, fontSize: 9, lineHeight: 1.25 }}
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
function WeekRibbon({ lens, weeks, weeklyTarget, timeOff, ptoRatio, monthHours, monthlyGoal, monthWeeks }: {
  lens: Lens;
  weeks: WeekSummary[];
  weeklyTarget: number;
  timeOff?: TimeOff[];
  ptoRatio?: number;
  monthHours: HoursByStatus;
  monthlyGoal?: number;       // BCBA only
  monthWeeks: number;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#111827' }}>
        {lens === 'bt' ? 'BT direct hours' : 'BCBA billable hours'}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'stretch' }}>
      {weeks.filter(w => w.inMonth).map((w, i) => {
        // BCBA leave this week lowers the requirement; BT direct is unaffected.
        const ptoH = lens === 'bcba' ? ptoHoursInRange(timeOff, w.weekStart.getTime(), addDays(w.weekStart, 7).getTime()) : 0;
        const target = reduceRequirementForPto(weeklyTarget, ptoH, ptoRatio);
        const color = trackColor(w.hours, target);
        const live = w.hours.completed + w.hours.scheduled;
        return (
          <div key={i} style={{ flex: '1 1 200px', minWidth: 180, border: '1px solid #e5e7eb', borderRadius: 6, padding: '6px 8px', background: '#fff' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#374151' }}>Wk {format(w.weekStart, 'M/d')}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color }}>{fmtH(live)}/{fmtH(target)}h</span>
            </div>
            <CapBar hours={w.hours} target={target} />
            <div style={{ fontSize: 10, color: '#6b7280', marginTop: 3 }}>
              ✓{fmtH(w.hours.completed)} · ◻{fmtH(w.hours.scheduled)}{w.hours.canceled > 0 ? ` · ✕${fmtH(w.hours.canceled)}` : ''}
              {ptoH > 0 && <span style={{ color: '#7c3aed', fontWeight: 600 }}> · 🌴{fmtH(ptoH)}h PTO −{fmtH(weeklyTarget - target)}h</span>}
            </div>
          </div>
        );
      })}
      <div style={{ flex: '1 1 200px', minWidth: 180 }}>
        <MonthTotalRow lens={lens} hours={monthHours} goal={monthlyGoal} weeklyTarget={weeklyTarget} monthWeeks={monthWeeks} />
      </div>
      </div>
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

// ---------- Time grid (Week + Day views) ----------

// Shared columned timeline used by both Week (7 days) and Day (1 day) views.
// Tiles are color-coded (client pastel background + staff diagonal stripes),
// the time axis is frozen on side-scroll, and tapping a tile pops a small
// dialog to view the session in the detail panel.
function TimeGrid({ days, appointments, onSelectAppointment, onAppointmentChange, dragEnabled, draftMarks, hourHeight = HOUR_HEIGHT, axisWidth = TIME_AXIS_WIDTH, roomy = false }: {
  days: Date[];
  appointments: Appointment[];
  onSelectAppointment: (a: Appointment) => void;
  onAppointmentChange: (a: Appointment) => void;
  dragEnabled: boolean;
  draftMarks?: Map<string, DraftMark>;
  hourHeight?: number;
  axisWidth?: number;
  roomy?: boolean;
}) {
  const hours = Array.from({ length: VISIBLE_END_HOUR - VISIBLE_START_HOUR }, (_, i) => VISIBLE_START_HOUR + i);
  const totalHeight = (VISIBLE_END_HOUR - VISIBLE_START_HOUR) * hourHeight;
  const today = new Date();
  const minWidth = days.length > 1 ? (roomy ? 980 : 760) : undefined;
  // The tapped tile (shows a small "view session" dialog). Distinct from drag.
  const [tapped, setTapped] = useState<Appointment | null>(null);

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
      const rawMin = (deltaY / hourHeight) * 60;
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
  }, [dragState, onAppointmentChange, hourHeight]);

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

  // Sticky cells keep the time axis pinned to the left while day columns
  // scroll horizontally. Opaque background so columns don't show through.
  const stickyAxis: React.CSSProperties = {
    width: axisWidth, flexShrink: 0,
    position: 'sticky', left: 0, zIndex: 3, backgroundColor: 'white',
  };

  return (
    <div style={{ overflowX: 'auto' }}>
      {/* Day header */}
      <div style={{ display: 'flex', minWidth, borderBottom: '1px solid #e5e7eb' }}>
        <div style={{ ...stickyAxis, borderRight: '1px solid #e5e7eb' }} />
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

      {/* Body: frozen time axis + day columns */}
      <div style={{ display: 'flex', minWidth, height: totalHeight, position: 'relative' }}>
        {/* Time axis */}
        <div style={{ ...stickyAxis, borderRight: '1px solid #e5e7eb' }}>
          {hours.map(h => (
            <div key={h} style={{
              position: 'absolute', top: (h - VISIBLE_START_HOUR) * hourHeight,
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
              {/* Hour / half-hour / quarter-hour grid lines (decreasing weight). */}
              {hours.map(h => {
                const base = (h - VISIBLE_START_HOUR) * hourHeight;
                return (
                  <React.Fragment key={h}>
                    <GridLine top={base} color="#e5e7eb" />
                    <GridLine top={base + hourHeight / 4} color="#f5f6f7" />
                    <GridLine top={base + hourHeight / 2} color="#eef0f2" />
                    <GridLine top={base + (hourHeight * 3) / 4} color="#f5f6f7" />
                  </React.Fragment>
                );
              })}
              {/* Appointments */}
              {laid.map(({ appt, lane, lanes }) => {
                const layout = appointmentLayout(appt, hourHeight);
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
                    roomy={roomy}
                    onClick={() => setTapped(appt)}
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

      <TileLegend appointments={appointments.filter(a => days.some(d => isSameDay(d, new Date(a.startTime))))} />

      {/* Tap dialog: session name + view button (opens the detail panel). */}
      {tapped && (
        <div
          onClick={() => setTapped(null)}
          style={{
            position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1400, padding: 16,
          }}
        >
          <div onClick={e => e.stopPropagation()} style={{
            background: 'white', borderRadius: 8, padding: 16, maxWidth: 320, width: '100%',
            boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
          }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{tapped.title}</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>
              {format(new Date(tapped.startTime), 'EEE M/d, h:mm')}–{format(new Date(tapped.endTime), 'h:mm a')}
              {tapped.client && <> · {tapped.client}</>}
              {tapped.technician && <> · {tapped.technician}</>}
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setTapped(null)} style={{
                padding: '6px 12px', border: '1px solid #d1d5db', borderRadius: 6,
                background: 'white', cursor: 'pointer', fontSize: 13,
              }}>Close</button>
              <button onClick={() => { const a = tapped; setTapped(null); onSelectAppointment(a); }} style={{
                padding: '6px 12px', border: 'none', borderRadius: 6,
                background: '#3b82f6', color: 'white', cursor: 'pointer', fontSize: 13, fontWeight: 600,
              }}>Select / View</button>
            </div>
          </div>
        </div>
      )}

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

// A single horizontal grid line at `top` px.
function GridLine({ top, color }: { top: number; color: string }) {
  return (
    <div style={{ position: 'absolute', top, left: 0, right: 0, borderTop: `1px solid ${color}` }} />
  );
}

// Legend mapping client background colors (solid squares) and staff stripe
// colors (diagonal stripes on white) for the sessions currently in view.
function TileLegend({ appointments }: { appointments: Appointment[] }) {
  const clients = Array.from(new Set(appointments.map(a => a.client).filter((c): c is string => !!c)));
  const staff = Array.from(new Set(appointments.map(a => a.technician).filter((t): t is string => !!t)));
  if (clients.length === 0 && staff.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', fontSize: 11, color: '#374151', marginTop: 10 }}>
      {clients.map(c => (
        <span key={`c-${c}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: clientPastel(c), border: '1px solid rgba(0,0,0,0.1)', display: 'inline-block' }} />
          {c}
        </span>
      ))}
      {staff.map(t => (
        <span key={`t-${t}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, border: '1px solid rgba(0,0,0,0.1)', display: 'inline-block', ...legendStripeStyle(t) }} />
          {t}
        </span>
      ))}
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
  // Sessions in a day cell are always listed by start time, ascending (month,
  // week, and day views all read through here).
  return appointments
    .filter(a => a.startTime.startsWith(dateStr))
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
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
        cursor: 'pointer',
        textDecoration: look.strike ? 'line-through' : 'none',
        opacity: look.opacity,
        border: look.border,
        boxSizing: 'border-box',
      }}
      title={apt.title + (look.canceled ? ' (canceled)' : look.completed ? ' (completed)' : '')}
    >
      {look.prefix}{apt.title}
    </div>
  );
}

// Status / draft coding for a time-grid tile. The CLIENT pastel + STAFF stripe
// coding is the base; status (completed / canceled / ghost / draft) is folded
// into the border, opacity, strike, and a corner icon rather than overriding
// the color, so client/staff stay identifiable at a glance.
function blockLook(apt: Appointment, mark?: DraftMark) {
  const canceled = apt.status === 'canceled';
  const completed = apt.status === 'completed';
  const tile = tileStyle(apt.client, apt.technician);

  let border = '1px solid rgba(0,0,0,0.15)';
  let opacity = 1;
  let strike = false;
  let prefix = '';
  let statusIcon: string | null = null;

  if (completed) { border = `2px solid ${clientDarkBorder(apt.client)}`; }
  else if (canceled) {
    border = `2px solid ${apt.cancellation?.source === 'family' ? '#f97316' : '#dc2626'}`;
    opacity = 0.55; strike = true;
  }

  if (apt.isGhost) {
    border = '1px dashed #9ca3af'; opacity = 0.5; prefix = '👻 ';
  } else if (mark) {
    if (mark === 'remove') { border = '1px dashed #fca5a5'; opacity = 0.6; strike = true; prefix = '🗑 '; }
    else { border = '1px dashed #2563eb'; prefix = mark === 'add' ? '＋ ' : mark === 'shorten' ? '✂ ' : '✎ '; }
  }

  return {
    canceled, completed,
    backgroundColor: tile.backgroundColor,
    backgroundImage: tile.backgroundImage,
    border, opacity, strike, prefix,
    color: '#1f2937',
  };
}

function AppointmentBlock({ apt, mark, onClick, onPointerDown, dragHandle, style, roomy }: {
  apt: Appointment;
  mark?: DraftMark;
  onClick: () => void;
  onPointerDown?: (e: React.PointerEvent) => void;
  dragHandle?: boolean;
  style: React.CSSProperties;
  roomy?: boolean;
}) {
  const look = blockLook(apt, mark);
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
        backgroundColor: look.backgroundColor,
        backgroundImage: look.backgroundImage,
        color: look.color,
        padding: roomy ? '5px 8px' : '4px 6px', borderRadius: 4, fontSize: roomy ? 13 : 11,
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
      </div>
      <div style={{ fontSize: roomy ? 12 : 10, opacity: 0.85, marginTop: 2 }}>
        {format(new Date(apt.startTime), 'h:mm')}–{format(new Date(apt.endTime), 'h:mm a')}
      </div>
      {roomy && (apt.client || apt.technician) && (
        <div style={{ fontSize: 11, opacity: 0.8, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {[apt.client, apt.technician].filter(Boolean).join(' · ')}
        </div>
      )}
    </div>
  );
}

// Returns the {top, height} of an appointment in pixels within the week-view
// time grid, or null if it falls entirely outside the visible hour range.
function appointmentLayout(apt: Appointment, hourHeight: number = HOUR_HEIGHT): { top: number; height: number } | null {
  const start = new Date(apt.startTime);
  const end = new Date(apt.endTime);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
  const startHrs = start.getHours() + start.getMinutes() / 60;
  const endHrs = end.getHours() + end.getMinutes() / 60;
  if (endHrs <= VISIBLE_START_HOUR || startHrs >= VISIBLE_END_HOUR) return null;
  const clampedStart = Math.max(startHrs, VISIBLE_START_HOUR);
  const clampedEnd = Math.min(endHrs, VISIBLE_END_HOUR);
  const top = (clampedStart - VISIBLE_START_HOUR) * hourHeight;
  const height = Math.max(28, (clampedEnd - clampedStart) * hourHeight);
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

// ---------- Client Availability Matrix ----------

const AVAIL_CELL_START_MINS = VISIBLE_START_HOUR * 60;
const AVAIL_CELL_TOTAL_MINS = (VISIBLE_END_HOUR - VISIBLE_START_HOUR) * 60;
const AVAIL_ROW_HEIGHT = 48;
const AVAIL_LABEL_WIDTH = 128;

function ClientAvailMatrix({ clients, weekDays, appointments }: {
  clients: Client[];
  weekDays: Date[];
  appointments: Appointment[];
}) {
  const today = new Date();

  if (clients.length === 0) {
    return (
      <div style={{ textAlign: 'center', color: '#6b7280', padding: '48px 20px', fontSize: 14 }}>
        No clients to display. Add clients via Admin or adjust the filter above.
      </div>
    );
  }

  return (
    <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' as any, border: '1px solid #e5e7eb', borderRadius: 6 }}>
      <div style={{ minWidth: 560 }}>
        {/* Header row */}
        <div style={{ display: 'flex', borderBottom: '2px solid #e5e7eb', backgroundColor: '#f9fafb' }}>
          <div style={{ width: AVAIL_LABEL_WIDTH, flexShrink: 0 }} />
          {weekDays.map(day => {
            const isToday = isSameDay(day, today);
            return (
              <div key={day.toISOString()} style={{
                flex: 1, textAlign: 'center', padding: '6px 4px',
                fontSize: 11, fontWeight: 600,
                color: isToday ? '#3b82f6' : '#374151',
                backgroundColor: isToday ? '#eff6ff' : 'transparent',
                borderLeft: '1px solid #e5e7eb',
              }}>
                <div>{format(day, 'EEE')}</div>
                <div style={{ fontSize: 15 }}>{format(day, 'd')}</div>
              </div>
            );
          })}
        </div>

        {/* Client rows */}
        {clients.map((client, idx) => {
          const s = clientAvailBarStyle(client.name);
          return (
            <div key={client.id} style={{
              display: 'flex',
              borderTop: idx > 0 ? '1px solid #e5e7eb' : undefined,
            }}>
              {/* Client label */}
              <div style={{
                width: AVAIL_LABEL_WIDTH, flexShrink: 0,
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '0 8px', height: AVAIL_ROW_HEIGHT,
                backgroundColor: '#f9fafb', borderRight: '1px solid #e5e7eb',
              }}>
                <span style={{
                  width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                  backgroundColor: s.backgroundColor,
                  border: `2px solid ${s.borderColor}`,
                  display: 'inline-block',
                }} />
                <span style={{
                  fontSize: 11, fontWeight: 600, color: '#374151',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{client.name}</span>
              </div>

              {/* Day cells */}
              {weekDays.map(day => {
                const dateISO = format(day, 'yyyy-MM-dd');
                const dayAppts = appointments.filter(a =>
                  (a.client === client.name || a.client === client.id) &&
                  a.startTime.startsWith(dateISO) &&
                  a.status !== 'canceled'
                );
                return (
                  <ClientAvailCell
                    key={day.toISOString()}
                    client={client}
                    date={day}
                    appointments={dayAppts}
                    isToday={isSameDay(day, today)}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ClientAvailCell({ client, date, appointments, isToday }: {
  client: Client;
  date: Date;
  appointments: Appointment[];
  isToday: boolean;
}) {
  const dayOfWeek = format(date, 'EEEE') as DayOfWeek;
  const windows = client.availabilityWindows[dayOfWeek] ?? [];
  const s = clientAvailBarStyle(client.name);

  const toMins = (hhmm: string): number => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + (m || 0);
  };

  const barLeft = (startHHMM: string): string => {
    const pct = Math.max(0, (toMins(startHHMM) - AVAIL_CELL_START_MINS) / AVAIL_CELL_TOTAL_MINS * 100);
    return `${pct}%`;
  };
  const barWidth = (startHHMM: string, endHHMM: string): string => {
    const s0 = Math.max(toMins(startHHMM), AVAIL_CELL_START_MINS);
    const e0 = Math.min(toMins(endHHMM), AVAIL_CELL_START_MINS + AVAIL_CELL_TOTAL_MINS);
    return `${Math.max(0, (e0 - s0) / AVAIL_CELL_TOTAL_MINS * 100)}%`;
  };

  const fmtHHMM = (hhmm: string): string => {
    const [h, m] = hhmm.split(':').map(Number);
    const suffix = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return m ? `${h12}:${String(m).padStart(2, '0')} ${suffix}` : `${h12} ${suffix}`;
  };

  return (
    <div style={{
      flex: 1, height: AVAIL_ROW_HEIGHT, position: 'relative',
      borderLeft: '1px solid #e5e7eb',
      backgroundColor: isToday ? '#fafbff' : '#fff',
      overflow: 'hidden',
    }}>
      {/* Availability windows */}
      {windows.map((w, i) => (
        <div
          key={i}
          title={`${client.name} · ${fmtHHMM(w.start)} – ${fmtHHMM(w.end)}`}
          style={{
            position: 'absolute',
            top: 7, bottom: 7,
            left: barLeft(w.start),
            width: barWidth(w.start, w.end),
            backgroundColor: s.backgroundColor,
            border: `1px solid ${s.borderColor}`,
            borderRadius: 4,
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            paddingLeft: 5,
            boxSizing: 'border-box',
            minWidth: 4,
          }}
        >
          <span style={{
            fontSize: 10, fontWeight: 700, color: s.color,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            userSelect: 'none',
          }}>
            {client.name}
          </span>
        </div>
      ))}

      {/* Booked appointments — darker overlay on top of availability bars */}
      {appointments.map((apt, i) => {
        const start = new Date(apt.startTime);
        const end = new Date(apt.endTime);
        const startMins = start.getHours() * 60 + start.getMinutes();
        const endMins = end.getHours() * 60 + end.getMinutes();
        const clampedStart = Math.max(startMins, AVAIL_CELL_START_MINS);
        const clampedEnd = Math.min(endMins, AVAIL_CELL_START_MINS + AVAIL_CELL_TOTAL_MINS);
        if (clampedEnd <= clampedStart) return null;
        const left = `${(clampedStart - AVAIL_CELL_START_MINS) / AVAIL_CELL_TOTAL_MINS * 100}%`;
        const width = `${(clampedEnd - clampedStart) / AVAIL_CELL_TOTAL_MINS * 100}%`;
        return (
          <div
            key={apt.id || i}
            title={`Booked: ${apt.title} · ${format(start, 'h:mm')}–${format(end, 'h:mm a')}`}
            style={{
              position: 'absolute',
              top: 11, bottom: 11,
              left, width,
              backgroundColor: s.borderColor,
              opacity: 0.5,
              borderRadius: 3,
              zIndex: 1,
              boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            }}
          />
        );
      })}
    </div>
  );
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
