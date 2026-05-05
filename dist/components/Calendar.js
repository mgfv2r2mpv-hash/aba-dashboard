import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek, endOfWeek, format, isSameMonth, addMonths, subMonths } from 'date-fns';
export default function Calendar({ appointments, technicians, clients, onAppointmentChange, onSelectAppointment, }) {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [selectedDate, setSelectedDate] = useState(null);
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(monthStart);
    const calendarStart = startOfWeek(monthStart);
    const calendarEnd = endOfWeek(monthEnd);
    const calendarDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd });
    const getAppointmentsForDate = (date) => {
        const dateStr = format(date, 'yyyy-MM-dd');
        return appointments.filter(a => a.startTime.startsWith(dateStr));
    };
    const getTechnicianName = (id) => {
        if (!id)
            return 'Unknown';
        const tech = technicians.find(t => t.id === id || t.name === id);
        return tech?.name || id;
    };
    const getTypeColor = (type, isFixed) => {
        if (isFixed)
            return '#ef4444';
        switch (type) {
            case 'supervision':
                return '#10b981';
            case 'parent-training':
                return '#3b82f6';
            case 'client-session':
                return '#8b5cf6';
            case 'internal-task':
                return '#6b7280';
            default:
                return '#9ca3af';
        }
    };
    const goToPreviousMonth = () => setCurrentDate(subMonths(currentDate, 1));
    const goToNextMonth = () => setCurrentDate(addMonths(currentDate, 1));
    return (_jsxs("div", { style: { padding: 'clamp(8px, 3vw, 24px)', maxWidth: '100%', boxSizing: 'border-box' }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }, children: [_jsx("button", { onClick: goToPreviousMonth, style: {
                            padding: '8px 12px',
                            backgroundColor: '#e5e7eb',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                        }, children: "\u2190 Previous" }), _jsx("h2", { style: { fontSize: '20px', fontWeight: 'bold' }, children: format(currentDate, 'MMMM yyyy') }), _jsx("button", { onClick: goToNextMonth, style: {
                            padding: '8px 12px',
                            backgroundColor: '#e5e7eb',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                        }, children: "Next \u2192" })] }), _jsx("div", { style: {
                    display: 'grid',
                    gridTemplateColumns: 'repeat(7, 1fr)',
                    gap: '1px',
                    backgroundColor: '#e5e7eb',
                    marginBottom: '1px',
                }, children: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (_jsx("div", { style: {
                        padding: '12px 8px',
                        backgroundColor: '#f9f9f9',
                        fontWeight: '600',
                        textAlign: 'center',
                        fontSize: '13px',
                    }, children: day }, day))) }), _jsx("div", { style: {
                    display: 'grid',
                    gridTemplateColumns: 'repeat(7, 1fr)',
                    gap: '1px',
                    backgroundColor: '#e5e7eb',
                }, children: calendarDays.map(day => {
                    const dayAppointments = getAppointmentsForDate(day);
                    const isCurrentMonth = isSameMonth(day, monthStart);
                    const isToday = format(day, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');
                    return (_jsxs("div", { style: {
                            backgroundColor: isCurrentMonth ? '#ffffff' : '#f3f4f6',
                            minHeight: '120px',
                            padding: '8px',
                            cursor: 'pointer',
                            opacity: isCurrentMonth ? 1 : 0.5,
                        }, onClick: () => setSelectedDate(day), children: [_jsx("div", { style: {
                                    fontWeight: isToday ? 'bold' : 'normal',
                                    marginBottom: '4px',
                                    color: isToday ? '#3b82f6' : '#374151',
                                    fontSize: '13px',
                                }, children: format(day, 'd') }), _jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: '2px' }, children: [dayAppointments.slice(0, 3).map(apt => (_jsx("div", { onClick: e => {
                                            e.stopPropagation();
                                            onSelectAppointment(apt);
                                        }, style: {
                                            backgroundColor: getTypeColor(apt.type, apt.isFixed),
                                            color: 'white',
                                            padding: '3px 4px',
                                            borderRadius: '3px',
                                            fontSize: '10px',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                            cursor: 'pointer',
                                            border: apt.isFixed ? '2px solid #dc2626' : 'none',
                                        }, title: apt.title, children: apt.title }, apt.id))), dayAppointments.length > 3 && (_jsxs("div", { style: { fontSize: '10px', color: '#9ca3af' }, children: ["+", dayAppointments.length - 3, " more"] }))] })] }, format(day, 'yyyy-MM-dd')));
                }) })] }));
}
//# sourceMappingURL=Calendar.js.map