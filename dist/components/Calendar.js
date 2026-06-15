import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React, { useState, useEffect } from 'react';
import { rollupHours, resolveUtilization, ptoHoursInRange, reduceRequirementForPto } from '../utilization';
import { tileStyle, clientPastel, clientDarkBorder, legendStripeStyle } from '../calendarColors';
import { useMinWidth, useIsLandscape } from '../useMediaQuery';
import { startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek, endOfWeek, format, isSameMonth, isSameDay, addMonths, subMonths, addWeeks, subWeeks, addDays, getDay, } from 'date-fns';
const VISIBLE_START_HOUR = 6;
const VISIBLE_END_HOUR = 22;
const HOUR_HEIGHT = 40;
const HOUR_HEIGHT_WIDE = 56; // roomier hour rows on iPad and up
const TIME_AXIS_WIDTH = 52;
const TIME_AXIS_WIDTH_WIDE = 64;
// Snap drag movements to 15-minute slots — matches typical scheduling resolution.
const SNAP_MINUTES = 15;
export default function Calendar({ appointments, technicians: _technicians, clients: _clients, settings, timeOff, onAppointmentChange, onSelectAppointment, onViewDateChange, onLensChange, hideTotals, draftMarks, onAddAppointment, }) {
    const [view, setView] = useState('month');
    const [lens, setLens] = useState('bcba');
    const [currentDate, setCurrentDate] = useState(new Date());
    const [pickedDay, setPickedDay] = useState(null);
    const isLandscape = useIsLandscape();
    // iPad and up: roomier rows, wider time axis, richer tiles, taller month cells.
    const roomy = useMinWidth(820);
    const hourHeight = roomy ? HOUR_HEIGHT_WIDE : HOUR_HEIGHT;
    const axisWidth = roomy ? TIME_AXIS_WIDTH_WIDE : TIME_AXIS_WIDTH;
    // From the month grid, tapping a day offers a jump to that day's week or day
    // view. Both set the anchor date first, then switch the view.
    const openDayIn = (target) => {
        if (pickedDay)
            setCurrentDate(pickedDay);
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
    const lensAppts = appointments.filter(a => a.isBillable === false || (lens === 'bt' ? !!a.technician : !a.technician));
    // When a schedule loads with no appointments in the currently-shown range,
    // jump to the earliest appointment so users see their data.
    useEffect(() => {
        if (appointments.length === 0)
            return;
        const inRange = appointments.some(a => {
            const d = new Date(a.startTime);
            return view === 'month'
                ? isSameMonth(d, currentDate)
                : d >= startOfWeek(currentDate, { weekStartsOn: 1 }) && d <= endOfWeek(currentDate, { weekStartsOn: 1 });
        });
        if (inRange)
            return;
        const earliest = appointments
            .map(a => new Date(a.startTime))
            .filter(d => !isNaN(d.getTime()))
            .sort((a, b) => a.getTime() - b.getTime())[0];
        if (earliest)
            setCurrentDate(earliest);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [appointments, view]);
    const goPrev = () => setCurrentDate(view === 'month' ? subMonths(currentDate, 1)
        : view === 'week' ? subWeeks(currentDate, 1)
            : addDays(currentDate, -1));
    const goNext = () => setCurrentDate(view === 'month' ? addMonths(currentDate, 1)
        : view === 'week' ? addWeeks(currentDate, 1)
            : addDays(currentDate, 1));
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
    return (_jsxs("div", { style: { padding: 'clamp(8px, 3vw, 24px)', maxWidth: '100%', boxSizing: 'border-box' }, children: [_jsxs("div", { style: {
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    marginBottom: 16, gap: 8, flexWrap: 'wrap',
                }, children: [_jsxs("div", { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }, children: [onAddAppointment && (_jsx("button", { onClick: onAddAppointment, "aria-label": "Add appointment", title: "Add appointment", style: {
                                    padding: '5px 10px', backgroundColor: '#3b82f6', color: 'white',
                                    border: 'none', borderRadius: 5, cursor: 'pointer',
                                    fontSize: 16, fontWeight: 700, lineHeight: 1,
                                }, children: "+" })), _jsxs("div", { style: { display: 'flex', gap: 4, border: '1px solid #d1d5db', borderRadius: 6, overflow: 'hidden' }, children: [_jsx(ViewBtn, { active: view === 'month', onClick: () => setView('month'), children: "Month" }), _jsx(ViewBtn, { active: view === 'week', onClick: () => setView('week'), children: "Week" }), _jsx(ViewBtn, { active: view === 'day', onClick: () => setView('day'), children: "Day" })] }), _jsxs("div", { style: { display: 'flex', gap: 4, border: '1px solid #d1d5db', borderRadius: 6, overflow: 'hidden' }, children: [_jsx(ViewBtn, { active: lens === 'bcba', onClick: () => setLens('bcba'), children: "BCBA" }), _jsx(ViewBtn, { active: lens === 'bt', onClick: () => setLens('bt'), children: "BT" })] })] }), _jsxs("div", { style: { display: 'flex', gap: 6, alignItems: 'center' }, children: [_jsx(NavBtn, { onClick: goPrev, children: "\u2190" }), _jsx(NavBtn, { onClick: goToday, children: "Today" }), _jsx(NavBtn, { onClick: goNext, children: "\u2192" })] }), _jsx("h2", { style: { fontSize: 18, fontWeight: 700, margin: 0, flex: '1 1 100%', textAlign: 'center' }, children: headerLabel })] }), view === 'month' && (_jsx(MonthView, { currentDate: currentDate, appointments: lensAppts, lens: lens, settings: settings, timeOff: timeOff, onSelectAppointment: onSelectAppointment, onPickDay: setPickedDay, draftMarks: draftMarks, roomy: roomy })), view === 'month' && !hideTotals && (_jsx("div", { style: { marginTop: 16 }, children: _jsx(HoursSummary, { appointments: appointments, lens: lens, settings: settings, timeOff: timeOff, currentDate: currentDate }) })), view === 'week' && (_jsx(TimeGrid, { days: Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(currentDate, { weekStartsOn: 1 }), i)), appointments: lensAppts, onSelectAppointment: onSelectAppointment, onAppointmentChange: onAppointmentChange, dragEnabled: isLandscape, draftMarks: draftMarks, hourHeight: hourHeight, axisWidth: axisWidth, roomy: roomy })), view === 'day' && (_jsx(TimeGrid, { days: [currentDate], appointments: lensAppts, onSelectAppointment: onSelectAppointment, onAppointmentChange: onAppointmentChange, dragEnabled: isLandscape, draftMarks: draftMarks, hourHeight: hourHeight, axisWidth: axisWidth, roomy: roomy })), (view === 'week' || view === 'day') && !isLandscape && (_jsx("p", { style: { fontSize: 11, color: '#9ca3af', textAlign: 'center', marginTop: 8 }, children: "Rotate to landscape to drag appointments to a new time." })), pickedDay && (_jsx("div", { onClick: () => setPickedDay(null), style: {
                    position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.35)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1400, padding: 16,
                }, children: _jsxs("div", { onClick: e => e.stopPropagation(), style: {
                        background: 'white', borderRadius: 8, padding: 16, maxWidth: 320, width: '100%',
                        boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
                    }, children: [_jsx("div", { style: { fontWeight: 700, fontSize: 15, marginBottom: 12 }, children: format(pickedDay, 'EEEE, MMM d, yyyy') }), _jsxs("div", { style: { display: 'flex', gap: 8 }, children: [_jsx("button", { onClick: () => openDayIn('week'), style: {
                                        flex: 1, padding: '10px 12px', borderRadius: 6, border: '1px solid #d1d5db',
                                        background: '#f9fafb', cursor: 'pointer', fontSize: 14, fontWeight: 600,
                                    }, children: "Week view" }), _jsx("button", { onClick: () => openDayIn('day'), style: {
                                        flex: 1, padding: '10px 12px', borderRadius: 6, border: '1px solid #3b82f6',
                                        background: '#3b82f6', color: 'white', cursor: 'pointer', fontSize: 14, fontWeight: 600,
                                    }, children: "Day view" })] }), _jsx("button", { onClick: () => setPickedDay(null), style: {
                                marginTop: 12, width: '100%', padding: '8px 12px', borderRadius: 6,
                                border: 'none', background: 'transparent', color: '#6b7280', cursor: 'pointer', fontSize: 13,
                            }, children: "Cancel" })] }) }))] }));
}
// ---------- Month View ----------
function MonthView({ currentDate, appointments, lens, settings, timeOff, onSelectAppointment, onPickDay, draftMarks, roomy }) {
    const maxChips = roomy ? 6 : 3;
    // Minimum readable width per day column. Below 7×this, the grid scrolls
    // horizontally inside its panel rather than smushing columns / pushing
    // weekend days off-screen.
    const colMin = roomy ? 108 : 92;
    // Which grid week-rows are expanded to reveal every appointment. Tapping a
    // cell's "+N more" expands the whole row downward (the CSS grid stretches
    // sibling cells to match), and a "Show less" control collapses it again.
    const [expandedRows, setExpandedRows] = useState(() => new Set());
    const toggleRow = (r) => setExpandedRows(prev => {
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
    return (_jsxs("div", { style: { overflowX: 'auto', WebkitOverflowScrolling: 'touch', border: '1px solid #e5e7eb', borderRadius: 6 }, children: [_jsx("div", { style: {
                    display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 1,
                    backgroundColor: '#e5e7eb', marginBottom: 1, minWidth: colMin * 7,
                }, children: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (_jsx("div", { style: {
                        padding: '10px 8px', backgroundColor: '#f9f9f9',
                        fontWeight: 600, textAlign: 'center', fontSize: roomy ? 15 : 13,
                    }, children: d }, d))) }), _jsx("div", { style: {
                    display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 1, backgroundColor: '#e5e7eb', minWidth: colMin * 7,
                }, children: days.map((day, idx) => {
                    const dayAppts = appointmentsOn(appointments, day);
                    const inCurrentMonth = isSameMonth(day, monthStart);
                    const isToday = isSameDay(day, new Date());
                    const dow = getDay(day); // 0 = Sun (now the rightmost column)
                    const weekStart = startOfWeek(day, { weekStartsOn: 1 });
                    const rowIdx = Math.floor(idx / 7);
                    const expanded = expandedRows.has(rowIdx);
                    return (_jsxs("div", { onClick: () => onPickDay(day), title: "Open week or day view", style: {
                            backgroundColor: inCurrentMonth ? '#ffffff' : '#f3f4f6',
                            minHeight: roomy ? 168 : 110, padding: roomy ? 8 : 6, opacity: inCurrentMonth ? 1 : 0.5,
                            cursor: 'pointer', overflow: 'hidden',
                        }, children: [_jsx("div", { style: {
                                    fontWeight: isToday ? 700 : 400,
                                    marginBottom: 4, color: isToday ? '#3b82f6' : '#374151', fontSize: roomy ? 15 : 12,
                                }, children: format(day, 'd') }), dow === 0 && (_jsx(SundayTotal, { lens: lens, hours: rollupHours(appointments, weekStart.getTime(), addDays(weekStart, 7).getTime(), lens), target: lens === 'bcba'
                                    ? reduceRequirementForPto(weeklyTarget, ptoHoursInRange(timeOff, weekStart.getTime(), addDays(weekStart, 7).getTime()), settings?.ptoBillableDeductionRatio)
                                    : weeklyTarget })), _jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: 2 }, children: [(expanded ? dayAppts : dayAppts.slice(0, maxChips)).map(apt => (_jsx(AppointmentChip, { apt: apt, mark: draftMarks?.get(apt.id), onClick: () => onSelectAppointment(apt) }, apt.id))), dayAppts.length > maxChips && !expanded && (_jsxs("div", { onClick: e => { e.stopPropagation(); toggleRow(rowIdx); }, style: { fontSize: 10, color: '#3b82f6', fontWeight: 600, cursor: 'pointer' }, children: ["+", dayAppts.length - maxChips, " more \u25BE"] })), dayAppts.length > maxChips && expanded && (_jsx("div", { onClick: e => { e.stopPropagation(); toggleRow(rowIdx); }, style: { fontSize: 10, color: '#3b82f6', fontWeight: 600, cursor: 'pointer' }, children: "Show less \u25B4" }))] })] }, format(day, 'yyyy-MM-dd')));
                }) })] }));
}
// ---------- Hours totals (BT direct / BCBA billable) ----------
// Self-contained monthly hours summary: one card per grid week + a month total.
// Computes its own rollups from the (unfiltered) appointments + lens so it can
// be rendered either inline under the month grid (narrow screens) or docked in
// the side pane (wide screens). rollupHours filters by lens internally.
export function HoursSummary({ appointments, lens, settings, timeOff, currentDate }) {
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
        if (row.some(d => isSameMonth(d, monthStart)))
            inMonthWeeks++;
        const weekdaysInMonth = row.filter(d => isSameMonth(d, monthStart) && getDay(d) >= 1 && getDay(d) <= 5).length;
        if (weekdaysInMonth >= 3)
            workWeeks++;
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
    return (_jsx(WeekRibbon, { lens: lens, weeks: weekSummaries, weeklyTarget: weeklyTarget, timeOff: timeOff, ptoRatio: ptoRatio, monthHours: monthHours, monthlyGoal: lens === 'bcba' ? monthlyGoal : undefined, monthWeeks: lens === 'bcba' ? workWeeks : inMonthWeeks }));
}
// Round to ≤1 decimal, dropping a trailing .0.
function fmtH(n) {
    const r = Math.round(n * 10) / 10;
    return Number.isInteger(r) ? String(r) : r.toFixed(1);
}
// On-track color from completed-vs-target, allowing scheduled to "rescue" it.
function trackColor(hours, target) {
    const projected = hours.completed + hours.scheduled;
    if (hours.completed >= target)
        return '#15803d'; // met
    if (projected >= target)
        return '#b45309'; // on pace
    return '#b91c1c'; // behind
}
// Compact weekly total printed inside the Sunday cell. Headlines the live total
// (completed + scheduled) so booked-but-not-yet-done hours are visible, with the
// ✓completed / ◻scheduled / ✕canceled breakdown and a cap gauge.
function SundayTotal({ lens, hours, target }) {
    const live = hours.completed + hours.scheduled;
    const color = trackColor(hours, target);
    return (_jsxs("div", { style: { marginTop: 4, marginBottom: 5, fontSize: 9, lineHeight: 1.25 }, title: `${lens === 'bt' ? 'BT direct' : 'BCBA billable'} this week: ${fmtH(hours.completed)}h completed, ${fmtH(hours.scheduled)}h scheduled, ${fmtH(hours.canceled)}h canceled — target ${fmtH(target)}h`, children: [_jsx("div", { style: { fontWeight: 700, color: '#374151' }, children: lens === 'bt' ? 'BT wk' : 'BCBA wk' }), _jsxs("div", { style: { fontWeight: 600, color }, children: [fmtH(live), "/", fmtH(target), "h"] }), _jsxs("div", { style: { color: '#6b7280' }, children: ["\u2713", fmtH(hours.completed), " \u25FB", fmtH(hours.scheduled), hours.canceled > 0 ? ` ✕${fmtH(hours.canceled)}` : ''] }), _jsx(CapBar, { hours: hours, target: target })] }));
}
// Usage gauge. Full width = target (e.g., 165h goal). Segments left→right:
// completed (green), scheduled (gray), then canceled — family (orange) and
// staff (red) — to the RIGHT of a black "cap" line drawn at the live total
// (completed + scheduled). As sessions cancel, the live total drops, the black
// cap line shifts left, and the canceled hours show the lost ceiling.
function CapBar({ hours, target }) {
    const denom = target > 0
        ? target
        : Math.max(hours.completed + hours.scheduled + hours.canceled, 1);
    const pct = (h) => Math.max(0, Math.min(100, (h / denom) * 100));
    const capPct = Math.max(0, Math.min(100, ((hours.completed + hours.scheduled) / denom) * 100));
    return (_jsxs("div", { style: { position: 'relative', marginTop: 4 }, children: [_jsxs("div", { style: { height: 8, background: '#e5e7eb', borderRadius: 3, overflow: 'hidden', display: 'flex' }, children: [_jsx("div", { style: { width: `${pct(hours.completed)}%`, background: '#16a34a' } }), _jsx("div", { style: { width: `${pct(hours.scheduled)}%`, background: '#9ca3af' } }), _jsx("div", { style: { width: `${pct(hours.canceledFamily)}%`, background: '#f97316' } }), _jsx("div", { style: { width: `${pct(hours.canceledStaff)}%`, background: '#dc2626' } })] }), _jsx("div", { style: { position: 'absolute', top: -1, bottom: -1, left: `${capPct}%`, width: 2, background: '#111827', transform: 'translateX(-1px)' }, title: "Scheduled cap (completed + scheduled)" })] }));
}
// Vertical ribbon beside the grid: one row per in-month week + a month total.
function WeekRibbon({ lens, weeks, weeklyTarget, timeOff, ptoRatio, monthHours, monthlyGoal, monthWeeks }) {
    return (_jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: 8 }, children: [_jsx("div", { style: { fontSize: 12, fontWeight: 700, color: '#111827' }, children: lens === 'bt' ? 'BT direct hours' : 'BCBA billable hours' }), _jsxs("div", { style: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'stretch' }, children: [weeks.filter(w => w.inMonth).map((w, i) => {
                        // BCBA leave this week lowers the requirement; BT direct is unaffected.
                        const ptoH = lens === 'bcba' ? ptoHoursInRange(timeOff, w.weekStart.getTime(), addDays(w.weekStart, 7).getTime()) : 0;
                        const target = reduceRequirementForPto(weeklyTarget, ptoH, ptoRatio);
                        const color = trackColor(w.hours, target);
                        const live = w.hours.completed + w.hours.scheduled;
                        return (_jsxs("div", { style: { flex: '1 1 200px', minWidth: 180, border: '1px solid #e5e7eb', borderRadius: 6, padding: '6px 8px', background: '#fff' }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 6 }, children: [_jsxs("span", { style: { fontSize: 11, fontWeight: 600, color: '#374151' }, children: ["Wk ", format(w.weekStart, 'M/d')] }), _jsxs("span", { style: { fontSize: 11, fontWeight: 700, color }, children: [fmtH(live), "/", fmtH(target), "h"] })] }), _jsx(CapBar, { hours: w.hours, target: target }), _jsxs("div", { style: { fontSize: 10, color: '#6b7280', marginTop: 3 }, children: ["\u2713", fmtH(w.hours.completed), " \u00B7 \u25FB", fmtH(w.hours.scheduled), w.hours.canceled > 0 ? ` · ✕${fmtH(w.hours.canceled)}` : '', ptoH > 0 && _jsxs("span", { style: { color: '#7c3aed', fontWeight: 600 }, children: [" \u00B7 \uD83C\uDF34", fmtH(ptoH), "h PTO \u2212", fmtH(weeklyTarget - target), "h"] })] })] }, i));
                    }), _jsx("div", { style: { flex: '1 1 200px', minWidth: 180 }, children: _jsx(MonthTotalRow, { lens: lens, hours: monthHours, goal: monthlyGoal, weeklyTarget: weeklyTarget, monthWeeks: monthWeeks }) })] }), _jsx(Legend, {})] }));
}
function MonthTotalRow({ lens, hours, goal, weeklyTarget, monthWeeks }) {
    const live = hours.completed + hours.scheduled;
    // BCBA has an explicit monthly goal; BT rolls up against weeks × weekly target.
    const denom = goal ?? weeklyTarget * monthWeeks;
    const color = goal !== undefined
        ? (hours.completed >= goal ? '#15803d' : live >= goal ? '#b45309' : '#b91c1c')
        : trackColor(hours, denom);
    return (_jsxs("div", { style: { border: '1px solid #d1d5db', borderRadius: 6, padding: '8px', background: '#f9fafb' }, children: [_jsxs("div", { style: { fontSize: 11, fontWeight: 700, color: '#111827' }, children: ["Month total", goal !== undefined ? ` (${monthWeeks}-wk goal)` : ''] }), _jsxs("div", { style: { fontSize: 13, fontWeight: 700, color, marginTop: 2 }, children: [fmtH(live), "/", fmtH(denom), "h"] }), _jsx(CapBar, { hours: hours, target: denom }), _jsxs("div", { style: { fontSize: 10, color: '#6b7280', marginTop: 4 }, children: ["\u2713", fmtH(hours.completed), "h done \u00B7 \u25FB", fmtH(hours.scheduled), "h sched", hours.canceled > 0 ? ` · ✕${fmtH(hours.canceled)}h canc` : ''] })] }));
}
function Legend() {
    const items = [
        { c: '#9ca3af', label: 'Pending' },
        { c: '#16a34a', label: 'Completed' },
        { c: '#f97316', label: 'Family cancel' },
        { c: '#dc2626', label: 'Staff cancel' },
    ];
    return (_jsxs("div", { style: { display: 'flex', flexWrap: 'wrap', gap: '4px 10px', fontSize: 10, color: '#6b7280', marginTop: 2 }, children: [items.map(it => (_jsxs("span", { style: { display: 'inline-flex', alignItems: 'center', gap: 4 }, children: [_jsx("span", { style: { width: 9, height: 9, borderRadius: 2, background: it.c, display: 'inline-block' } }), it.label] }, it.label))), _jsxs("span", { style: { display: 'inline-flex', alignItems: 'center', gap: 4 }, children: [_jsx("span", { style: { width: 2, height: 11, background: '#111827', display: 'inline-block' } }), "Scheduled cap"] })] }));
}
// ---------- Time grid (Week + Day views) ----------
// Shared columned timeline used by both Week (7 days) and Day (1 day) views.
// Tiles are color-coded (client pastel background + staff diagonal stripes),
// the time axis is frozen on side-scroll, and tapping a tile pops a small
// dialog to view the session in the detail panel.
function TimeGrid({ days, appointments, onSelectAppointment, onAppointmentChange, dragEnabled, draftMarks, hourHeight = HOUR_HEIGHT, axisWidth = TIME_AXIS_WIDTH, roomy = false }) {
    const hours = Array.from({ length: VISIBLE_END_HOUR - VISIBLE_START_HOUR }, (_, i) => VISIBLE_START_HOUR + i);
    const totalHeight = (VISIBLE_END_HOUR - VISIBLE_START_HOUR) * hourHeight;
    const today = new Date();
    const minWidth = days.length > 1 ? (roomy ? 980 : 760) : undefined;
    // The tapped tile (shows a small "view session" dialog). Distinct from drag.
    const [tapped, setTapped] = useState(null);
    // Active drag — only one appointment moves at a time. dragState tracks
    // the snapped delta so we can show a floating preview tooltip and apply
    // the change on pointer release.
    const [dragState, setDragState] = useState(null);
    // Window-level pointer listeners so the drag survives when the cursor
    // leaves the original block.
    useEffect(() => {
        if (!dragState)
            return;
        const onMove = (e) => {
            const deltaY = e.clientY - dragState.startY;
            const rawMin = (deltaY / hourHeight) * 60;
            const snappedMin = Math.round(rawMin / SNAP_MINUTES) * SNAP_MINUTES;
            // Use elementFromPoint to detect which day column the cursor is over.
            // Each day column carries a data-day-iso attribute.
            const el = document.elementFromPoint(e.clientX, e.clientY);
            const dayEl = el?.closest('[data-day-iso]');
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
            if (!ds)
                return;
            const newStart = computeDraggedStart(ds.apt, ds.deltaMin, ds.targetDayISO);
            const newEnd = computeDraggedEnd(ds.apt, ds.deltaMin, ds.targetDayISO);
            if (newStart === ds.apt.startTime && newEnd === ds.apt.endTime)
                return;
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
    const beginDrag = (apt, e) => {
        if (!dragEnabled)
            return;
        // Locked = canceled or completed. The legacy isFixed field is ignored.
        if (apt.status === 'canceled' || apt.status === 'completed')
            return;
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
    const stickyAxis = {
        width: axisWidth, flexShrink: 0,
        position: 'sticky', left: 0, zIndex: 3, backgroundColor: 'white',
    };
    return (_jsxs("div", { style: { overflowX: 'auto' }, children: [_jsxs("div", { style: { display: 'flex', minWidth, borderBottom: '1px solid #e5e7eb' }, children: [_jsx("div", { style: { ...stickyAxis, borderRight: '1px solid #e5e7eb' } }), days.map(day => {
                        const isToday = isSameDay(day, today);
                        return (_jsxs("div", { style: {
                                flex: 1, textAlign: 'center', padding: '8px 4px',
                                fontSize: 12, fontWeight: 600,
                                color: isToday ? '#3b82f6' : '#374151',
                                backgroundColor: isToday ? '#eff6ff' : 'transparent',
                                borderLeft: '1px solid #f3f4f6',
                            }, children: [_jsx("div", { children: format(day, 'EEE') }), _jsx("div", { style: { fontSize: 16 }, children: format(day, 'd') })] }, day.toISOString()));
                    })] }), _jsxs("div", { style: { display: 'flex', minWidth, height: totalHeight, position: 'relative' }, children: [_jsx("div", { style: { ...stickyAxis, borderRight: '1px solid #e5e7eb' }, children: hours.map(h => (_jsx("div", { style: {
                                position: 'absolute', top: (h - VISIBLE_START_HOUR) * hourHeight,
                                fontSize: 10, color: '#6b7280', padding: '2px 4px', right: 4,
                            }, children: formatHourLabel(h) }, h))) }), days.map(day => {
                        const dayISO = format(day, 'yyyy-MM-dd');
                        const dayAppts = appointmentsOn(appointments, day);
                        const laid = layoutAppointments(dayAppts);
                        const isToday = isSameDay(day, today);
                        return (_jsxs("div", { "data-day-iso": dayISO, style: {
                                flex: 1, position: 'relative', borderLeft: '1px solid #f3f4f6',
                                backgroundColor: isToday ? '#fafbff' : 'transparent',
                            }, children: [hours.map(h => {
                                    const base = (h - VISIBLE_START_HOUR) * hourHeight;
                                    return (_jsxs(React.Fragment, { children: [_jsx(GridLine, { top: base, color: "#e5e7eb" }), _jsx(GridLine, { top: base + hourHeight / 4, color: "#f5f6f7" }), _jsx(GridLine, { top: base + hourHeight / 2, color: "#eef0f2" }), _jsx(GridLine, { top: base + (hourHeight * 3) / 4, color: "#f5f6f7" })] }, h));
                                }), laid.map(({ appt, lane, lanes }) => {
                                    const layout = appointmentLayout(appt, hourHeight);
                                    if (!layout)
                                        return null;
                                    const widthPct = 100 / lanes;
                                    const beingDragged = dragState?.apt.id === appt.id;
                                    const mark = draftMarks?.get(appt.id);
                                    const draggable = dragEnabled && appt.status !== 'canceled' && appt.status !== 'completed'
                                        && !appt.isGhost && mark !== 'remove';
                                    return (_jsx(AppointmentBlock, { apt: appt, mark: mark, roomy: roomy, onClick: () => setTapped(appt), onPointerDown: draggable ? (e) => beginDrag(appt, e) : undefined, dragHandle: draggable, style: {
                                            position: 'absolute',
                                            top: layout.top,
                                            height: layout.height,
                                            left: `calc(${lane * widthPct}% + 2px)`,
                                            width: `calc(${widthPct}% - 4px)`,
                                            opacity: beingDragged ? 0.4 : 1,
                                        } }, appt.id));
                                })] }, dayISO));
                    })] }), _jsx(TileLegend, { appointments: appointments.filter(a => days.some(d => isSameDay(d, new Date(a.startTime)))) }), tapped && (_jsx("div", { onClick: () => setTapped(null), style: {
                    position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.35)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1400, padding: 16,
                }, children: _jsxs("div", { onClick: e => e.stopPropagation(), style: {
                        background: 'white', borderRadius: 8, padding: 16, maxWidth: 320, width: '100%',
                        boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
                    }, children: [_jsx("div", { style: { fontWeight: 700, fontSize: 15, marginBottom: 4 }, children: tapped.title }), _jsxs("div", { style: { fontSize: 12, color: '#6b7280', marginBottom: 12 }, children: [format(new Date(tapped.startTime), 'EEE M/d, h:mm'), "\u2013", format(new Date(tapped.endTime), 'h:mm a'), tapped.client && _jsxs(_Fragment, { children: [" \u00B7 ", tapped.client] }), tapped.technician && _jsxs(_Fragment, { children: [" \u00B7 ", tapped.technician] })] }), _jsxs("div", { style: { display: 'flex', gap: 8, justifyContent: 'flex-end' }, children: [_jsx("button", { onClick: () => setTapped(null), style: {
                                        padding: '6px 12px', border: '1px solid #d1d5db', borderRadius: 6,
                                        background: 'white', cursor: 'pointer', fontSize: 13,
                                    }, children: "Close" }), _jsx("button", { onClick: () => { const a = tapped; setTapped(null); onSelectAppointment(a); }, style: {
                                        padding: '6px 12px', border: 'none', borderRadius: 6,
                                        background: '#3b82f6', color: 'white', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                                    }, children: "Select / View" })] })] }) })), dragState && (() => {
                const newStart = computeDraggedStart(dragState.apt, dragState.deltaMin, dragState.targetDayISO);
                const d = new Date(newStart);
                return (_jsx("div", { style: {
                        position: 'fixed',
                        top: dragState.cursorY + 14,
                        left: dragState.cursorX + 14,
                        background: '#1f2937', color: 'white',
                        padding: '6px 10px', borderRadius: 4, fontSize: 12,
                        pointerEvents: 'none', zIndex: 1500, boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
                        whiteSpace: 'nowrap',
                    }, children: format(d, 'EEE M/d, h:mm a') }));
            })()] }));
}
// A single horizontal grid line at `top` px.
function GridLine({ top, color }) {
    return (_jsx("div", { style: { position: 'absolute', top, left: 0, right: 0, borderTop: `1px solid ${color}` } }));
}
// Legend mapping client background colors (solid squares) and staff stripe
// colors (diagonal stripes on white) for the sessions currently in view.
function TileLegend({ appointments }) {
    const clients = Array.from(new Set(appointments.map(a => a.client).filter((c) => !!c)));
    const staff = Array.from(new Set(appointments.map(a => a.technician).filter((t) => !!t)));
    if (clients.length === 0 && staff.length === 0)
        return null;
    return (_jsxs("div", { style: { display: 'flex', flexWrap: 'wrap', gap: '6px 14px', fontSize: 11, color: '#374151', marginTop: 10 }, children: [clients.map(c => (_jsxs("span", { style: { display: 'inline-flex', alignItems: 'center', gap: 5 }, children: [_jsx("span", { style: { width: 12, height: 12, borderRadius: 3, backgroundColor: clientPastel(c), border: '1px solid rgba(0,0,0,0.1)', display: 'inline-block' } }), c] }, `c-${c}`))), staff.map(t => (_jsxs("span", { style: { display: 'inline-flex', alignItems: 'center', gap: 5 }, children: [_jsx("span", { style: { width: 12, height: 12, borderRadius: 3, border: '1px solid rgba(0,0,0,0.1)', display: 'inline-block', ...legendStripeStyle(t) } }), t] }, `t-${t}`)))] }));
}
// Returns the new ISO startTime if we apply the snapped time delta and the
// targeted day column. Preserves the original time-of-day baseline + applies
// the minute offset, then changes the date to the target day.
function computeDraggedStart(apt, deltaMin, targetDayISO) {
    const original = new Date(apt.startTime);
    const target = new Date(`${targetDayISO}T00:00:00`);
    // Use the original's hours/minutes as the baseline, shifted by deltaMin.
    const newDate = new Date(target);
    newDate.setHours(original.getHours(), original.getMinutes() + deltaMin, 0, 0);
    return formatLocalISO(newDate);
}
function computeDraggedEnd(apt, deltaMin, targetDayISO) {
    const original = new Date(apt.startTime);
    const originalEnd = new Date(apt.endTime);
    const durationMs = originalEnd.getTime() - original.getTime();
    const start = new Date(computeDraggedStart(apt, deltaMin, targetDayISO));
    return formatLocalISO(new Date(start.getTime() + durationMs));
}
// Match the `YYYY-MM-DDTHH:MM:SS` format used by the seeder so calendar
// `startTime.startsWith('YYYY-MM-DD')` filters keep working.
function formatLocalISO(d) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
// ---------- Shared chip / block / helpers ----------
function appointmentsOn(appointments, date) {
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
function appointmentLook(apt, mark) {
    const canceled = apt.status === 'canceled';
    const completed = apt.status === 'completed';
    let background = '#9ca3af'; // pending
    if (completed)
        background = '#16a34a';
    else if (canceled)
        background = apt.cancellation?.source === 'family' ? '#f97316' : '#dc2626';
    let color = 'white';
    let border = '1px solid rgba(0,0,0,0.05)';
    let opacity = canceled ? 0.85 : 1;
    let strike = canceled;
    let prefix = '';
    // Ghost = wished-for, never placed: a faint dashed reminder.
    if (apt.isGhost) {
        background = '#f3f4f6';
        color = '#6b7280';
        border = '1px dashed #9ca3af';
        opacity = 0.9;
        prefix = '👻 ';
    }
    else if (mark) {
        // Draft (uncommitted) styling. Removes are tombstoned; the rest are
        // "proposed" with a dashed blue outline so they read as not-yet-saved.
        if (mark === 'remove') {
            background = '#fee2e2';
            color = '#b91c1c';
            border = '1px dashed #fca5a5';
            opacity = 0.7;
            strike = true;
            prefix = '🗑 ';
        }
        else {
            background = '#dbeafe';
            color = '#1e3a8a';
            border = '1px dashed #2563eb';
            opacity = 0.95;
            prefix = mark === 'add' ? '＋ ' : mark === 'shorten' ? '✂ ' : '✎ ';
        }
    }
    return {
        canceled, completed,
        background, color, border, opacity, strike, prefix,
        statusIcon: canceled ? '✕' : completed ? '✓' : null,
        statusColor: apt.isGhost || mark ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.95)',
    };
}
function AppointmentChip({ apt, mark, onClick }) {
    const look = appointmentLook(apt, mark);
    return (_jsxs("div", { onClick: e => { e.stopPropagation(); onClick(); }, style: {
            background: look.background, color: look.color,
            padding: '3px 4px', borderRadius: 3, fontSize: 10,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            cursor: 'pointer',
            textDecoration: look.strike ? 'line-through' : 'none',
            opacity: look.opacity,
            border: look.border,
            boxSizing: 'border-box',
        }, title: apt.title + (look.canceled ? ' (canceled)' : look.completed ? ' (completed)' : ''), children: [look.prefix, apt.title] }));
}
// Status / draft coding for a time-grid tile. The CLIENT pastel + STAFF stripe
// coding is the base; status (completed / canceled / ghost / draft) is folded
// into the border, opacity, strike, and a corner icon rather than overriding
// the color, so client/staff stay identifiable at a glance.
function blockLook(apt, mark) {
    const canceled = apt.status === 'canceled';
    const completed = apt.status === 'completed';
    const tile = tileStyle(apt.client, apt.technician);
    let border = '1px solid rgba(0,0,0,0.15)';
    let opacity = 1;
    let strike = false;
    let prefix = '';
    let statusIcon = null;
    if (completed) {
        border = `2px solid ${clientDarkBorder(apt.client)}`;
    }
    else if (canceled) {
        border = `2px solid ${apt.cancellation?.source === 'family' ? '#f97316' : '#dc2626'}`;
        opacity = 0.55;
        strike = true;
    }
    if (apt.isGhost) {
        border = '1px dashed #9ca3af';
        opacity = 0.5;
        prefix = '👻 ';
    }
    else if (mark) {
        if (mark === 'remove') {
            border = '1px dashed #fca5a5';
            opacity = 0.6;
            strike = true;
            prefix = '🗑 ';
        }
        else {
            border = '1px dashed #2563eb';
            prefix = mark === 'add' ? '＋ ' : mark === 'shorten' ? '✂ ' : '✎ ';
        }
    }
    return {
        canceled, completed,
        backgroundColor: tile.backgroundColor,
        backgroundImage: tile.backgroundImage,
        border, opacity, strike, prefix,
        color: '#1f2937',
    };
}
function AppointmentBlock({ apt, mark, onClick, onPointerDown, dragHandle, style, roomy }) {
    const look = blockLook(apt, mark);
    // When drag is enabled, suppress the click (click fires after pointerup
    // and would re-open the detail panel after a drag). Track whether the
    // pointer moved meaningfully between down and up to distinguish tap vs drag.
    const movedRef = React.useRef(false);
    return (_jsxs("div", { onPointerDown: (e) => {
            movedRef.current = false;
            if (onPointerDown)
                onPointerDown(e);
        }, onPointerMove: () => { movedRef.current = true; }, onClick: e => {
            e.stopPropagation();
            if (movedRef.current && dragHandle)
                return; // it was a drag, not a tap
            onClick();
        }, style: {
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
        }, title: apt.title + (look.canceled ? ' (canceled)' : look.completed ? ' (completed)' : ''), children: [_jsx("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 4 }, children: _jsxs("span", { style: { fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }, children: [look.prefix, apt.title] }) }), _jsxs("div", { style: { fontSize: roomy ? 12 : 10, opacity: 0.85, marginTop: 2 }, children: [format(new Date(apt.startTime), 'h:mm'), "\u2013", format(new Date(apt.endTime), 'h:mm a')] }), roomy && (apt.client || apt.technician) && (_jsx("div", { style: { fontSize: 11, opacity: 0.8, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: [apt.client, apt.technician].filter(Boolean).join(' · ') }))] }));
}
// Returns the {top, height} of an appointment in pixels within the week-view
// time grid, or null if it falls entirely outside the visible hour range.
function appointmentLayout(apt, hourHeight = HOUR_HEIGHT) {
    const start = new Date(apt.startTime);
    const end = new Date(apt.endTime);
    if (isNaN(start.getTime()) || isNaN(end.getTime()))
        return null;
    const startHrs = start.getHours() + start.getMinutes() / 60;
    const endHrs = end.getHours() + end.getMinutes() / 60;
    if (endHrs <= VISIBLE_START_HOUR || startHrs >= VISIBLE_END_HOUR)
        return null;
    const clampedStart = Math.max(startHrs, VISIBLE_START_HOUR);
    const clampedEnd = Math.min(endHrs, VISIBLE_END_HOUR);
    const top = (clampedStart - VISIBLE_START_HOUR) * hourHeight;
    const height = Math.max(28, (clampedEnd - clampedStart) * hourHeight);
    return { top, height };
}
// Greedy lane assignment for overlapping appointments. Within each cluster of
// overlapping events, every event gets a lane index 0..N-1 and N is recorded
// so the renderer can size each event to (1/N) of the column width.
function layoutAppointments(appts) {
    const sorted = [...appts].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    const result = [];
    let cluster = [];
    let clusterEnd = -Infinity;
    const flush = () => {
        if (!cluster.length)
            return;
        const laneEnds = [];
        const assigned = [];
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
        }
        else {
            clusterEnd = Math.max(clusterEnd, end);
        }
        cluster.push(a);
    }
    flush();
    return result;
}
function formatHourLabel(h) {
    if (h === 0)
        return '12a';
    if (h === 12)
        return '12p';
    if (h < 12)
        return `${h}a`;
    return `${h - 12}p`;
}
// ---------- Toolbar buttons ----------
function ViewBtn({ active, onClick, children }) {
    return (_jsx("button", { onClick: onClick, style: {
            padding: '6px 14px', border: 'none',
            backgroundColor: active ? '#3b82f6' : 'white',
            color: active ? 'white' : '#374151',
            cursor: 'pointer', fontSize: 13, fontWeight: 600,
        }, children: children }));
}
function NavBtn({ onClick, children }) {
    return (_jsx("button", { onClick: onClick, style: {
            padding: '6px 12px', backgroundColor: '#e5e7eb', border: 'none',
            borderRadius: 4, cursor: 'pointer', fontSize: 13,
        }, children: children }));
}
//# sourceMappingURL=Calendar.js.map