import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export default function AppointmentForm({ appointment, technicians, clients, onSave, onCancel, }) {
    const [title, setTitle] = useState(appointment?.title || '');
    const [description, setDescription] = useState(appointment?.description || '');
    const [type, setType] = useState(appointment?.type || 'client-session');
    const [technicianId, setTechnicianId] = useState(appointment?.technician || '');
    const [clientId, setClientId] = useState(appointment?.client || '');
    const [startTime, setStartTime] = useState(appointment?.startTime || '');
    const [endTime, setEndTime] = useState(appointment?.endTime || '');
    const [isFixed, setIsFixed] = useState(appointment?.isFixed || false);
    const [isBillable, setIsBillable] = useState(appointment?.isBillable ?? true);
    // Recurrence
    const [recurrence, setRecurrence] = useState(appointment?.isRecurring ? appointment.recurringPattern : 'none');
    const [selectedDays, setSelectedDays] = useState(new Set());
    const [customDates, setCustomDates] = useState(''); // newline-separated YYYY-MM-DD
    const [recurrenceEnd, setRecurrenceEnd] = useState('');
    const toggleDay = (day) => {
        const next = new Set(selectedDays);
        if (next.has(day))
            next.delete(day);
        else
            next.add(day);
        setSelectedDays(next);
    };
    const buildAppointments = () => {
        const base = {
            id: appointment?.id || uuidv4(),
            title,
            description,
            type,
            technician: technicianId,
            client: clientId,
            startTime,
            endTime,
            isFixed,
            isBillable,
            isRecurring: recurrence !== 'none',
            recurringPattern: recurrence === 'none' ? undefined : recurrence,
        };
        // For simple recurrence, return a single record - the schedule renderer expands it.
        if (recurrence === 'none' || recurrence === 'weekly' || recurrence === 'biweekly' || recurrence === 'monthly') {
            return [base];
        }
        // For custom-days: generate one appointment per occurrence in window
        const result = [];
        const start = new Date(startTime);
        const end = recurrenceEnd ? new Date(recurrenceEnd) : new Date(start.getTime() + 90 * 24 * 60 * 60 * 1000);
        const duration = new Date(endTime).getTime() - start.getTime();
        if (recurrence === 'custom-days') {
            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                const dayName = DAYS[(d.getDay() + 6) % 7]; // convert Sun=0 to Mon=0
                if (dayName && selectedDays.has(dayName)) {
                    const occStart = new Date(d);
                    occStart.setHours(start.getHours(), start.getMinutes(), 0, 0);
                    const occEnd = new Date(occStart.getTime() + duration);
                    result.push({
                        ...base,
                        id: uuidv4(),
                        startTime: occStart.toISOString(),
                        endTime: occEnd.toISOString(),
                        isRecurring: true,
                        recurringPattern: 'custom',
                    });
                }
            }
        }
        else if (recurrence === 'custom-dates') {
            const dates = customDates.split(/\s+/).filter(Boolean);
            for (const dateStr of dates) {
                const occStart = new Date(`${dateStr}T${start.toTimeString().slice(0, 8)}`);
                if (isNaN(occStart.getTime()))
                    continue;
                const occEnd = new Date(occStart.getTime() + duration);
                result.push({
                    ...base,
                    id: uuidv4(),
                    startTime: occStart.toISOString(),
                    endTime: occEnd.toISOString(),
                    isRecurring: true,
                    recurringPattern: 'custom',
                });
            }
        }
        return result.length > 0 ? result : [base];
    };
    const handleSubmit = () => {
        if (!title || !startTime || !endTime) {
            alert('Title, start, and end time are required.');
            return;
        }
        const appointments = buildAppointments();
        appointments.forEach(a => onSave(a));
    };
    const inputStyle = {
        width: '100%',
        padding: '8px 12px',
        border: '1px solid #d1d5db',
        borderRadius: '6px',
        fontSize: '14px',
    };
    const labelStyle = {
        display: 'block',
        fontWeight: '600',
        marginBottom: '6px',
        fontSize: '13px',
    };
    return (_jsx("div", { style: {
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }, children: _jsxs("div", { style: {
                backgroundColor: 'white', borderRadius: '8px', padding: '24px',
                width: '600px', maxHeight: '90vh', overflowY: 'auto',
            }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }, children: [_jsx("h2", { style: { fontSize: '20px', fontWeight: 'bold' }, children: appointment ? 'Edit Appointment' : 'Add Appointment' }), _jsx("button", { onClick: onCancel, style: { background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }, children: "\u2715" })] }), _jsxs("div", { style: { display: 'grid', gap: '12px' }, children: [_jsxs("div", { children: [_jsx("label", { style: labelStyle, children: "Title *" }), _jsx("input", { value: title, onChange: (e) => setTitle(e.target.value), style: inputStyle })] }), _jsxs("div", { children: [_jsx("label", { style: labelStyle, children: "Description" }), _jsx("input", { value: description, onChange: (e) => setDescription(e.target.value), style: inputStyle })] }), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }, children: [_jsxs("div", { children: [_jsx("label", { style: labelStyle, children: "Type" }), _jsxs("select", { value: type, onChange: (e) => setType(e.target.value), style: inputStyle, children: [_jsx("option", { value: "client-session", children: "Client Session" }), _jsx("option", { value: "supervision", children: "Supervision" }), _jsx("option", { value: "parent-training", children: "Parent Training" }), _jsx("option", { value: "internal-task", children: "Internal Task" }), _jsx("option", { value: "other", children: "Other" })] })] }), _jsxs("div", { children: [_jsx("label", { style: labelStyle, children: "Recurrence" }), _jsxs("select", { value: recurrence, onChange: (e) => setRecurrence(e.target.value), style: inputStyle, children: [_jsx("option", { value: "none", children: "One-time" }), _jsx("option", { value: "weekly", children: "Weekly" }), _jsx("option", { value: "biweekly", children: "Every 2 weeks" }), _jsx("option", { value: "monthly", children: "Monthly" }), _jsx("option", { value: "custom-days", children: "Custom days of week" }), _jsx("option", { value: "custom-dates", children: "Specific dates" })] })] })] }), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }, children: [_jsxs("div", { children: [_jsx("label", { style: labelStyle, children: "Technician" }), _jsxs("select", { value: technicianId, onChange: (e) => setTechnicianId(e.target.value), style: inputStyle, children: [_jsx("option", { value: "", children: "\u2014 None \u2014" }), technicians.map(t => _jsxs("option", { value: t.name, children: [t.name, t.isRBT ? ' (RBT)' : ''] }, t.id))] })] }), _jsxs("div", { children: [_jsx("label", { style: labelStyle, children: "Client" }), _jsxs("select", { value: clientId, onChange: (e) => setClientId(e.target.value), style: inputStyle, children: [_jsx("option", { value: "", children: "\u2014 None \u2014" }), clients.map(c => _jsx("option", { value: c.name, children: c.name }, c.id))] })] })] }), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }, children: [_jsxs("div", { children: [_jsx("label", { style: labelStyle, children: "Start *" }), _jsx("input", { type: "datetime-local", value: startTime, onChange: (e) => setStartTime(e.target.value), style: inputStyle })] }), _jsxs("div", { children: [_jsx("label", { style: labelStyle, children: "End *" }), _jsx("input", { type: "datetime-local", value: endTime, onChange: (e) => setEndTime(e.target.value), style: inputStyle })] })] }), recurrence === 'custom-days' && (_jsxs("div", { children: [_jsx("label", { style: labelStyle, children: "Days of week" }), _jsx("div", { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' }, children: DAYS.map(day => (_jsx("button", { type: "button", onClick: () => toggleDay(day), style: {
                                            padding: '6px 10px',
                                            border: '1px solid #d1d5db',
                                            borderRadius: '4px',
                                            backgroundColor: selectedDays.has(day) ? '#3b82f6' : 'white',
                                            color: selectedDays.has(day) ? 'white' : '#374151',
                                            cursor: 'pointer',
                                            fontSize: '12px',
                                        }, children: day.slice(0, 3) }, day))) }), _jsx("label", { style: { ...labelStyle, marginTop: '12px' }, children: "Stop recurring on (optional)" }), _jsx("input", { type: "date", value: recurrenceEnd, onChange: (e) => setRecurrenceEnd(e.target.value), style: inputStyle })] })), recurrence === 'custom-dates' && (_jsxs("div", { children: [_jsx("label", { style: labelStyle, children: "Specific dates (one per line, YYYY-MM-DD)" }), _jsx("textarea", { value: customDates, onChange: (e) => setCustomDates(e.target.value), placeholder: '2025-05-05\n2025-05-19\n2025-06-02', rows: 5, style: { ...inputStyle, fontFamily: 'monospace', resize: 'vertical' } }), _jsx("p", { style: { fontSize: '11px', color: '#6b7280', marginTop: '4px' }, children: "Time of day comes from the Start field above. Useful for awkward / variable schedules." })] })), _jsxs("div", { style: { display: 'flex', gap: '16px', alignItems: 'center', marginTop: '4px' }, children: [_jsxs("label", { style: { display: 'flex', gap: '6px', alignItems: 'center', cursor: 'pointer' }, children: [_jsx("input", { type: "checkbox", checked: isFixed, onChange: (e) => setIsFixed(e.target.checked) }), _jsx("span", { children: "\uD83D\uDD12 Fixed (cannot be moved)" })] }), _jsxs("label", { style: { display: 'flex', gap: '6px', alignItems: 'center', cursor: 'pointer' }, children: [_jsx("input", { type: "checkbox", checked: isBillable, onChange: (e) => setIsBillable(e.target.checked) }), _jsx("span", { children: "Billable" })] })] })] }), _jsxs("div", { style: { display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '20px' }, children: [_jsx("button", { onClick: onCancel, style: {
                                padding: '8px 16px', border: '1px solid #d1d5db', borderRadius: '6px',
                                background: 'white', cursor: 'pointer',
                            }, children: "Cancel" }), _jsx("button", { onClick: handleSubmit, style: {
                                padding: '8px 16px', backgroundColor: '#3b82f6', color: 'white',
                                border: 'none', borderRadius: '6px', cursor: 'pointer',
                            }, children: "Save" })] })] }) }));
}
//# sourceMappingURL=AppointmentForm.js.map