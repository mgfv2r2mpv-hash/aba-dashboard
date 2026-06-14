import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from 'react';
import { clientPastel } from '../calendarColors';
import { format, isSameDay } from 'date-fns';
// Default content for the docked context pane on wide screens, shown when no
// appointment is selected and there's no draft/conflict to triage. Turns the
// otherwise-empty right rail into a useful "at a glance" view: the agenda for
// the day the calendar is focused on, plus the next few upcoming sessions.
export default function AgendaRail({ appointments, date, onSelect }) {
    const now = new Date();
    const active = appointments.filter(a => !a.isGhost);
    const byStart = (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
    const dayAppts = active
        .filter(a => isSameDay(new Date(a.startTime), date))
        .sort(byStart);
    const upcoming = active
        .filter(a => new Date(a.startTime).getTime() >= now.getTime()
        && a.status !== 'canceled' && !isSameDay(new Date(a.startTime), date))
        .sort(byStart)
        .slice(0, 6);
    const dayLabel = isSameDay(date, now) ? `Today · ${format(date, 'EEE, MMM d')}` : format(date, 'EEEE, MMM d');
    return (_jsxs("div", { style: { padding: 16, display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto' }, children: [_jsx(Section, { title: dayLabel, children: dayAppts.length === 0
                    ? _jsx(Empty, { children: "No sessions this day." })
                    : dayAppts.map(a => _jsx(AgendaRow, { a: a, onSelect: onSelect }, a.id)) }), upcoming.length > 0 && (_jsx(Section, { title: "Upcoming", children: upcoming.map(a => _jsx(AgendaRow, { a: a, onSelect: onSelect, withDate: true }, a.id)) })), _jsx("p", { style: { fontSize: 11, color: '#9ca3af', margin: 0 }, children: "Select a session to see details and actions here." })] }));
}
function Section({ title, children }) {
    return (_jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: 8 }, children: [_jsx("h3", { style: { margin: 0, fontSize: 13, fontWeight: 700, color: '#374151' }, children: title }), _jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: 6 }, children: children })] }));
}
function Empty({ children }) {
    return _jsx("div", { style: { fontSize: 12, color: '#9ca3af', fontStyle: 'italic' }, children: children });
}
function AgendaRow({ a, onSelect, withDate }) {
    const canceled = a.status === 'canceled';
    const completed = a.status === 'completed';
    const accent = a.client ? clientPastel(a.client) : '#e5e7eb';
    const who = [a.client, a.technician].filter(Boolean).join(' · ');
    const start = new Date(a.startTime);
    const end = new Date(a.endTime);
    return (_jsxs("button", { onClick: () => onSelect(a), style: {
            display: 'flex', alignItems: 'stretch', gap: 8, textAlign: 'left', cursor: 'pointer',
            background: 'white', border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 10px',
            opacity: canceled ? 0.6 : 1,
        }, children: [_jsx("span", { style: { width: 4, borderRadius: 3, background: accent, flexShrink: 0 } }), _jsxs("span", { style: { minWidth: 0, flex: 1 }, children: [_jsxs("span", { style: {
                            display: 'block', fontSize: 13, fontWeight: 600, color: '#111827',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            textDecoration: canceled ? 'line-through' : 'none',
                        }, children: [completed ? '✓ ' : canceled ? '✕ ' : '', a.title] }), _jsxs("span", { style: { display: 'block', fontSize: 11, color: '#6b7280', marginTop: 2 }, children: [withDate ? `${format(start, 'EEE')} · ` : '', format(start, 'h:mm'), "\u2013", format(end, 'h:mm a'), who ? ` · ${who}` : ''] })] })] }));
}
//# sourceMappingURL=AgendaRail.js.map