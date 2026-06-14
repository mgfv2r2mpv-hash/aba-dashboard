import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React, { useState } from 'react';
import { DEFAULT_BCBA_SESSION_DEFAULTS } from '../types';
import { makeupCandidates, findAuthFor } from '../authorization';
import { v4 as uuidv4 } from 'uuid';
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
// HH:MM helpers for the start/end clock fields. Shifts stay within one day
// (appointments never cross midnight).
function clockToMin(clock) {
    const [h, m] = clock.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
}
function minToClock(total) {
    const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(total)));
    return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}
export default function AppointmentForm({ appointment, allAppointments, authorizations, technicians, clients, settings, initialType, onSave, onDelete, onCancel, variant = 'modal', }) {
    const [title, setTitle] = useState(appointment?.title || '');
    const [description, setDescription] = useState(appointment?.description || '');
    const [type, setType] = useState(appointment?.type || initialType || 'client-session');
    // Parent-training / case-planning can be caregiver-only sessions, so they carry
    // an OPTIONAL "supervised BT" — the technician field names the BT being observed
    // (not a provider), and the overlap with that BT's direct earns supervision.
    // Supervision itself stays client-only (the BT is inferred from the overlap).
    const needsSupervisedBt = type === 'parent-training' || type === 'case-planning';
    const [technicianId, setTechnicianId] = useState(appointment?.technician || '');
    const [clientId, setClientId] = useState(appointment?.client || '');
    // An appointment is a single calendar day plus a start and end clock time —
    // sessions never cross midnight (insurance is billed per-day). We keep the
    // canonical model as full local-ISO startTime/endTime strings (the rest of
    // the app depends on them) but compose them from one date + two times.
    const [date, setDate] = useState(appointment?.startTime ? appointment.startTime.slice(0, 10) : '');
    const [startClock, setStartClock] = useState(appointment?.startTime ? appointment.startTime.slice(11, 16) : '');
    const [endClock, setEndClock] = useState(appointment?.endTime ? appointment.endTime.slice(11, 16) : '');
    const startTime = date && startClock ? `${date}T${startClock}:00` : '';
    const endTime = date && endClock ? `${date}T${endClock}:00` : '';
    const [isBillable, setIsBillable] = useState(appointment?.isBillable ?? true);
    const [isMakeUp, setIsMakeUp] = useState(appointment?.isMakeUp ?? false);
    const [makeupForId, setMakeupForId] = useState(appointment?.makeupForId || '');
    const isNew = !appointment?.id;
    // "Move end time with start time": preserve the current duration when the
    // start shifts. Default checked on every fresh open/select.
    const [moveEndWithStart, setMoveEndWithStart] = useState(true);
    // Whether the user has hand-edited the end time. Until they do, a new
    // appointment auto-fills the end from the type's authorized weekly hours.
    const [endManual, setEndManual] = useState(!!appointment?.endTime);
    // BCBA session-length defaults (preselected in Admin → Settings).
    const bcbaDefaults = settings?.bcbaSessionDefaults || DEFAULT_BCBA_SESSION_DEFAULTS;
    // The client's authorized weekly DIRECT hours for the chosen date (drives both
    // the direct-session default duration and the supervision % default).
    const weeklyDirectHours = (clientArg, dateArg) => {
        if (!clientArg || !dateArg)
            return undefined;
        const auth = findAuthFor({ appointments: allAppointments || [], authorizations: authorizations || [], clients }, clientArg, dateArg);
        const h = auth?.weekly?.direct;
        return h && h > 0 ? h : undefined;
    };
    // Default duration (hours) for a new session by type. Direct draws from the
    // client's authorized weekly direct rate; BCBA (non-direct) types use the
    // preselected defaults — supervision as a % of weekly direct, the rest fixed.
    const defaultHoursForType = (typeArg, clientArg, dateArg) => {
        switch (typeArg) {
            case 'client-session':
                return weeklyDirectHours(clientArg, dateArg);
            case 'supervision': {
                const wk = weeklyDirectHours(clientArg, dateArg);
                return wk !== undefined ? (wk * bcbaDefaults.supervisionPercentOfWeeklyDirect) / 100 : undefined;
            }
            case 'reassessment': return bcbaDefaults.reassessmentHours;
            case 'case-planning': return bcbaDefaults.casePlanningHours;
            case 'parent-training': return bcbaDefaults.parentTrainingHours;
            case 'other': return bcbaDefaults.otherHours;
            default: return undefined; // internal-task: no auto default
        }
    };
    // Apply the default duration for a new appointment when the end is still empty
    // or auto-managed and we have a start + type (+ client for the auth-based types).
    const applyAuthDefaultEnd = (typeArg, clientArg, startArg, dateArg) => {
        if (!isNew || endManual)
            return;
        if (!startArg)
            return;
        const h = defaultHoursForType(typeArg, clientArg, dateArg);
        if (h === undefined || h <= 0)
            return;
        setEndClock(minToClock(clockToMin(startArg) + h * 60));
    };
    const handleStartChange = (newStart) => {
        const prevDuration = startClock && endClock ? clockToMin(endClock) - clockToMin(startClock) : undefined;
        setStartClock(newStart);
        if (!newStart)
            return;
        // Move end with start: keep the existing duration.
        if (moveEndWithStart && prevDuration !== undefined && prevDuration > 0) {
            setEndClock(minToClock(clockToMin(newStart) + prevDuration));
            return;
        }
        applyAuthDefaultEnd(type, clientId, newStart, date);
    };
    const handleTypeChange = (t) => {
        setType(t);
        applyAuthDefaultEnd(t, clientId, startClock, date);
    };
    const handleClientChange = (c) => {
        setClientId(c);
        applyAuthDefaultEnd(type, c, startClock, date);
    };
    // Canceled, not-fully-made-up sessions for this client within the auth
    // covering the chosen date (same calendar month when no auth covers it).
    const makeupOptions = (isMakeUp && clientId && date)
        ? makeupCandidates({ appointments: allAppointments || [], authorizations: authorizations || [], clients }, clientId, date, appointment?.id)
        : [];
    // Recurrence
    const [recurrence, setRecurrence] = useState(appointment?.isRecurring ? appointment.recurringPattern : 'none');
    const [selectedDays, setSelectedDays] = useState(new Set());
    const [customDates, setCustomDates] = useState(''); // newline-separated YYYY-MM-DD
    const [recurrenceEnd, setRecurrenceEnd] = useState('');
    const [editScope, setEditScope] = useState('instance');
    // All other occurrences sharing this appointment's seriesId. When editing,
    // the scope picker only matters if there's a real series to act on.
    const siblings = (appointment?.seriesId && allAppointments)
        ? allAppointments.filter(a => a.seriesId === appointment.seriesId)
        : [];
    const hasSeries = siblings.length > 1;
    const toggleDay = (day) => {
        const next = new Set(selectedDays);
        if (next.has(day))
            next.delete(day);
        else
            next.add(day);
        setSelectedDays(next);
    };
    // Same local-no-Z format the seeded sample uses, so the calendar's
    // `startTime.startsWith('yyyy-MM-dd')` filter doesn't shift across timezones.
    const pad2 = (n) => String(n).padStart(2, '0');
    const formatLocalISO = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
    // Edit on an existing series with scope > instance: take this occurrence's
    // edits and propagate to the relevant siblings. Title/desc/type/tech/client/
    // isBillable replace 1:1. Time-of-day is applied as HH:MM to each sibling
    // while preserving that sibling's date, and the duration becomes the new
    // (endTime - startTime). Status / cancellation stay per-instance.
    const buildSeriesEdit = () => {
        if (!appointment)
            return [];
        const newStart = new Date(startTime);
        const newEnd = new Date(endTime);
        if (isNaN(newStart.getTime()) || isNaN(newEnd.getTime()))
            return [appointment];
        const newDurationMs = newEnd.getTime() - newStart.getTime();
        const newHour = newStart.getHours();
        const newMin = newStart.getMinutes();
        const newSec = newStart.getSeconds();
        const cutoff = new Date(appointment.startTime).getTime();
        const targets = siblings.filter(s => editScope === 'all' || new Date(s.startTime).getTime() >= cutoff);
        return targets.map(sib => {
            const sibDate = new Date(sib.startTime);
            const updatedStart = new Date(sibDate);
            updatedStart.setHours(newHour, newMin, newSec, 0);
            const updatedEnd = new Date(updatedStart.getTime() + newDurationMs);
            return {
                ...sib,
                title,
                description,
                type,
                technician: type === 'supervision' ? '' : technicianId,
                client: clientId,
                isBillable,
                startTime: formatLocalISO(updatedStart),
                endTime: formatLocalISO(updatedEnd),
            };
        });
    };
    const buildAppointments = () => {
        const editing = !!appointment?.id;
        // Scope-aware edit branches before the build-from-scratch logic.
        if (editing && hasSeries && editScope !== 'instance') {
            const updates = buildSeriesEdit();
            return updates.length > 0 ? updates : [];
        }
        const base = {
            id: appointment?.id || uuidv4(),
            title,
            description,
            type,
            technician: type === 'supervision' ? '' : technicianId,
            client: clientId,
            startTime,
            endTime,
            isFixed: appointment?.isFixed ?? false,
            isBillable,
            isMakeUp: isMakeUp || undefined,
            makeupForId: isMakeUp && makeupForId ? makeupForId : undefined,
            isRecurring: recurrence !== 'none',
            recurringPattern: recurrence === 'none' ? undefined : recurrence,
            // Preserve series membership on single-instance edit so the slider
            // stays meaningful for future opens.
            seriesId: appointment?.seriesId,
        };
        if (recurrence === 'none')
            return [base];
        // Editing an existing record with scope === 'instance': only this one.
        if (editing)
            return [base];
        const start = new Date(startTime);
        if (isNaN(start.getTime()))
            return [base];
        const duration = new Date(endTime).getTime() - start.getTime();
        // Fallback window if the user didn't pick an end — 90 days of weekly is
        // a reasonable seed without runaway records.
        const defaultEnd = new Date(start.getTime() + 90 * 24 * 60 * 60 * 1000);
        const end = recurrenceEnd ? new Date(`${recurrenceEnd}T23:59:59`) : defaultEnd;
        // One seriesId for all instances of this new series, so future edits can
        // target "this and following" or "all in series".
        const seriesId = uuidv4();
        if (recurrence === 'weekly' || recurrence === 'biweekly' || recurrence === 'monthly') {
            const result = [];
            let occStart = new Date(start);
            while (occStart <= end) {
                const occEnd = new Date(occStart.getTime() + duration);
                result.push({
                    ...base,
                    id: result.length === 0 ? base.id : uuidv4(),
                    startTime: formatLocalISO(occStart),
                    endTime: formatLocalISO(occEnd),
                    seriesId,
                });
                if (recurrence === 'monthly') {
                    const next = new Date(occStart);
                    next.setMonth(next.getMonth() + 1);
                    occStart = next;
                }
                else {
                    const stepDays = recurrence === 'weekly' ? 7 : 14;
                    occStart = new Date(occStart.getTime() + stepDays * 24 * 60 * 60 * 1000);
                }
            }
            return result.length > 0 ? result : [{ ...base, seriesId }];
        }
        const result = [];
        if (recurrence === 'custom-days') {
            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                const dayName = DAYS[(d.getDay() + 6) % 7];
                if (dayName && selectedDays.has(dayName)) {
                    const occStart = new Date(d);
                    occStart.setHours(start.getHours(), start.getMinutes(), 0, 0);
                    const occEnd = new Date(occStart.getTime() + duration);
                    result.push({
                        ...base,
                        id: result.length === 0 ? base.id : uuidv4(),
                        startTime: formatLocalISO(occStart),
                        endTime: formatLocalISO(occEnd),
                        isRecurring: true,
                        recurringPattern: 'custom',
                        seriesId,
                    });
                }
            }
        }
        else if (recurrence === 'custom-dates') {
            const dates = customDates.split(/\s+/).filter(Boolean);
            for (const dateStr of dates) {
                const occStart = new Date(`${dateStr}T${pad2(start.getHours())}:${pad2(start.getMinutes())}:00`);
                if (isNaN(occStart.getTime()))
                    continue;
                const occEnd = new Date(occStart.getTime() + duration);
                result.push({
                    ...base,
                    id: result.length === 0 ? base.id : uuidv4(),
                    startTime: formatLocalISO(occStart),
                    endTime: formatLocalISO(occEnd),
                    isRecurring: true,
                    recurringPattern: 'custom',
                    seriesId,
                });
            }
        }
        return result.length > 0 ? result : [{ ...base, seriesId }];
    };
    // Delete is also scope-aware. Completed and canceled siblings are spared
    // when deleting a series — they're records of fact, not just future intent.
    const buildDeleteIds = () => {
        if (!appointment)
            return [];
        if (editScope === 'instance' || !hasSeries)
            return [appointment.id];
        const cutoff = new Date(appointment.startTime).getTime();
        return siblings
            .filter(s => editScope === 'all' || new Date(s.startTime).getTime() >= cutoff)
            .filter(s => s.status !== 'completed' && s.status !== 'canceled')
            .map(s => s.id);
    };
    const handleSubmit = () => {
        if (!title || !date || !startClock || !endClock) {
            alert('Title, date, start time, and end time are required.');
            return;
        }
        if (endTime <= startTime) {
            alert('End time must be after the start time (an appointment stays within one day).');
            return;
        }
        // Supervision is always with a client (a tech may or may not be present).
        if (type === 'supervision' && !clientId) {
            alert('Supervision sessions must have a client. A technician is optional but a client is required.');
            return;
        }
        const appointments = buildAppointments();
        if (appointments.length > 0)
            onSave(appointments);
    };
    const handleDelete = () => {
        if (!onDelete || !appointment)
            return;
        const ids = buildDeleteIds();
        if (ids.length === 0) {
            alert('No matching incomplete appointments to delete.');
            return;
        }
        const noun = ids.length === 1 ? 'appointment' : `${ids.length} appointments`;
        const scopeLabel = editScope === 'all' ? ' from the series' :
            editScope === 'following' ? ' from this date forward in the series' :
                '';
        if (!confirm(`Delete ${noun}${scopeLabel}? Completed and canceled appointments will be kept.`))
            return;
        onDelete(ids);
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
    const content = (_jsxs(_Fragment, { children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }, children: [_jsx("h2", { style: { fontSize: '20px', fontWeight: 'bold' }, children: appointment ? 'Edit Appointment' : 'Add Appointment' }), _jsx("button", { onClick: onCancel, style: { background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }, children: "\u2715" })] }), appointment && hasSeries && (_jsxs("div", { style: { marginBottom: 16 }, children: [_jsx("label", { style: { fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }, children: "Apply changes to" }), _jsx(ScopePicker, { value: editScope, onChange: setEditScope }), _jsxs("p", { style: { fontSize: 11, color: '#6b7280', marginTop: 6 }, children: [editScope === 'instance' && 'Only this occurrence will change.', editScope === 'following' && `This and ${siblings.filter(s => new Date(s.startTime).getTime() >= new Date(appointment.startTime).getTime()).length - 1} future occurrence(s) in the series will change. Time-of-day edits keep each occurrence's original date.`, editScope === 'all' && `All ${siblings.length} occurrences in the series will change. Time-of-day edits keep each occurrence's original date.`] })] })), _jsxs("div", { style: { display: 'grid', gap: '12px' }, children: [_jsxs("div", { children: [_jsx("label", { style: labelStyle, children: "Title *" }), _jsx("input", { value: title, onChange: (e) => setTitle(e.target.value), style: inputStyle })] }), _jsxs("div", { children: [_jsx("label", { style: labelStyle, children: "Description" }), _jsx("input", { value: description, onChange: (e) => setDescription(e.target.value), style: inputStyle })] }), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }, children: [_jsxs("div", { children: [_jsx("label", { style: labelStyle, children: "Type" }), _jsxs("select", { value: type, onChange: (e) => handleTypeChange(e.target.value), style: inputStyle, children: [_jsx("option", { value: "client-session", children: "Direct Service" }), _jsx("option", { value: "supervision", children: "Supervision" }), _jsx("option", { value: "parent-training", children: "Parent Training / Coord. of Care" }), _jsx("option", { value: "reassessment", children: "Reassessment" }), _jsx("option", { value: "case-planning", children: "Case Planning" }), _jsx("option", { value: "internal-task", children: "Admin Work" }), _jsx("option", { value: "other", children: "Meeting" })] })] }), _jsxs("div", { children: [_jsx("label", { style: labelStyle, children: "Recurrence" }), _jsxs("select", { value: recurrence, onChange: (e) => setRecurrence(e.target.value), style: inputStyle, children: [_jsx("option", { value: "none", children: "One-time" }), _jsx("option", { value: "weekly", children: "Weekly" }), _jsx("option", { value: "biweekly", children: "Every 2 weeks" }), _jsx("option", { value: "monthly", children: "Monthly" }), _jsx("option", { value: "custom-days", children: "Custom days of week" }), _jsx("option", { value: "custom-dates", children: "Specific dates" })] })] })] }), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }, children: [type !== 'supervision' && (_jsxs("div", { children: [_jsx("label", { style: labelStyle, children: needsSupervisedBt ? 'Supervised BT (optional)' : 'Technician (Optional)' }), _jsxs("select", { value: technicianId, onChange: (e) => setTechnicianId(e.target.value), style: inputStyle, children: [_jsx("option", { value: "", children: "\u2014 None \u2014" }), technicians.map(t => _jsxs("option", { value: t.name, children: [t.name, t.isRBT ? ' (RBT)' : ''] }, t.id))] })] })), _jsxs("div", { children: [_jsxs("label", { style: labelStyle, children: ["Client ", type === 'supervision' && '*'] }), _jsxs("select", { value: clientId, onChange: (e) => handleClientChange(e.target.value), style: inputStyle, children: [_jsx("option", { value: "", children: "\u2014 None \u2014" }), clients.map(c => _jsx("option", { value: c.name, children: c.name }, c.id))] }), type === 'supervision' && (_jsx("p", { style: { fontSize: 11, color: '#6b7280', marginTop: 4 }, children: "Supervision is logged against the client. The BT being supervised is inferred from whoever has a direct session with this client during this time; if no one does, it's BCBA-solo time and won't count toward compliance." }))] })] }), _jsxs("div", { children: [_jsx("label", { style: labelStyle, children: "Date *" }), _jsx("input", { type: "date", value: date, onChange: (e) => setDate(e.target.value), style: inputStyle })] }), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '16px' }, children: [_jsxs("div", { children: [_jsx("label", { style: labelStyle, children: "Start time *" }), _jsx("input", { type: "time", step: "900", value: startClock, onChange: (e) => handleStartChange(e.target.value), style: inputStyle })] }), _jsxs("div", { children: [_jsx("label", { style: labelStyle, children: "End time *" }), _jsx("input", { type: "time", step: "900", value: endClock, onChange: (e) => { setEndClock(e.target.value); setEndManual(true); }, style: inputStyle })] })] }), _jsxs("label", { style: { display: 'flex', gap: '6px', alignItems: 'center', cursor: 'pointer', fontSize: 13 }, children: [_jsx("input", { type: "checkbox", checked: moveEndWithStart, onChange: (e) => setMoveEndWithStart(e.target.checked) }), _jsx("span", { children: "Move end time with start time" })] }), recurrence === 'custom-days' && (_jsxs("div", { children: [_jsx("label", { style: labelStyle, children: "Days of week" }), _jsx("div", { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' }, children: DAYS.map(day => (_jsx("button", { type: "button", onClick: () => toggleDay(day), style: {
                                        padding: '6px 10px',
                                        border: '1px solid #d1d5db',
                                        borderRadius: '4px',
                                        backgroundColor: selectedDays.has(day) ? '#3b82f6' : 'white',
                                        color: selectedDays.has(day) ? 'white' : '#374151',
                                        cursor: 'pointer',
                                        fontSize: '12px',
                                    }, children: day.slice(0, 3) }, day))) })] })), (recurrence === 'weekly' || recurrence === 'biweekly' || recurrence === 'monthly' || recurrence === 'custom-days') && (_jsxs("div", { children: [_jsx("label", { style: labelStyle, children: "End recurrence on (optional)" }), _jsx("input", { type: "date", value: recurrenceEnd, onChange: (e) => setRecurrenceEnd(e.target.value), style: inputStyle }), _jsx("p", { style: { fontSize: '11px', color: '#6b7280', marginTop: 4 }, children: "The series starts on the Date at the Start time above and repeats until this date (or 90 days out if left blank). When editing an existing appointment, changes apply only to that single occurrence \u2014 the rest of the series is independent." })] })), recurrence === 'custom-dates' && (_jsxs("div", { children: [_jsx("label", { style: labelStyle, children: "Specific dates (one per line, YYYY-MM-DD)" }), _jsx("textarea", { value: customDates, onChange: (e) => setCustomDates(e.target.value), placeholder: '2025-05-05\n2025-05-19\n2025-06-02', rows: 5, style: { ...inputStyle, fontFamily: 'monospace', resize: 'vertical' } }), _jsx("p", { style: { fontSize: '11px', color: '#6b7280', marginTop: '4px' }, children: "Time of day comes from the Start time above. Useful for awkward / variable schedules." })] })), _jsxs("div", { style: { display: 'flex', gap: '16px', alignItems: 'center', marginTop: '4px', flexWrap: 'wrap' }, children: [_jsxs("label", { style: { display: 'flex', gap: '6px', alignItems: 'center', cursor: 'pointer' }, children: [_jsx("input", { type: "checkbox", checked: isBillable, onChange: (e) => setIsBillable(e.target.checked) }), _jsx("span", { children: "Billable" })] }), _jsxs("label", { style: { display: 'flex', gap: '6px', alignItems: 'center', cursor: 'pointer' }, children: [_jsx("input", { type: "checkbox", checked: isMakeUp, onChange: (e) => { setIsMakeUp(e.target.checked); if (!e.target.checked)
                                            setMakeupForId(''); } }), _jsx("span", { children: "Make-up session" })] })] }), isMakeUp && (_jsxs("div", { style: { padding: '10px 12px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6 }, children: [_jsx("p", { style: { fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }, children: "Making up which canceled session?" }), !clientId || !date ? (_jsx("p", { style: { fontSize: 12, color: '#9ca3af' }, children: "Pick a client and date first." })) : makeupOptions.length === 0 ? (_jsx("p", { style: { fontSize: 12, color: '#9ca3af' }, children: "No canceled, not-yet-made-up sessions for this client in this auth period. Saving as a general make-up." })) : (_jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: 4 }, children: [_jsxs("label", { style: { display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, cursor: 'pointer' }, children: [_jsx("input", { type: "radio", name: "makeupFor", checked: makeupForId === '', onChange: () => setMakeupForId('') }), _jsx("span", { style: { color: '#6b7280' }, children: "General make-up (not tied to one cancellation)" })] }), makeupOptions.map(opt => (_jsxs("label", { style: { display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, cursor: 'pointer' }, children: [_jsx("input", { type: "radio", name: "makeupFor", checked: makeupForId === opt.appointment.id, onChange: () => setMakeupForId(opt.appointment.id) }), _jsxs("span", { children: [opt.appointment.title, " \u2014 ", new Date(opt.appointment.startTime).toLocaleDateString(), ' ', _jsxs("span", { style: { color: '#b91c1c', fontWeight: 600 }, children: [Math.round(opt.remainingHours * 10) / 10, "h not made up"] }), opt.madeUpHours > 0 && _jsxs("span", { style: { color: '#6b7280' }, children: [" (of ", Math.round(opt.hours * 10) / 10, "h)"] })] })] }, opt.appointment.id)))] }))] }))] }), _jsxs("div", { style: { display: 'flex', gap: '8px', alignItems: 'center', marginTop: '20px', flexWrap: 'wrap' }, children: [appointment && onDelete && (_jsx("button", { onClick: handleDelete, style: {
                            padding: '8px 14px', border: '1px solid #fca5a5', borderRadius: '6px',
                            background: '#fee2e2', color: '#b91c1c', cursor: 'pointer', fontWeight: 600,
                        }, children: "Delete" })), _jsx("div", { style: { flex: 1 } }), _jsx("button", { onClick: onCancel, style: {
                            padding: '8px 16px', border: '1px solid #d1d5db', borderRadius: '6px',
                            background: 'white', cursor: 'pointer',
                        }, children: "Cancel" }), _jsx("button", { onClick: handleSubmit, style: {
                            padding: '8px 16px', backgroundColor: '#3b82f6', color: 'white',
                            border: 'none', borderRadius: '6px', cursor: 'pointer',
                        }, children: "Save" })] })] }));
    if (variant === 'inline') {
        return (_jsx("div", { style: {
                height: '100%', overflowY: 'auto', padding: 16, boxSizing: 'border-box',
                background: '#fff', WebkitOverflowScrolling: 'touch',
            }, children: content }));
    }
    return (_jsx("div", { style: {
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
            padding: 'max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left))',
            boxSizing: 'border-box',
        }, children: _jsx("div", { style: {
                backgroundColor: 'white', borderRadius: '8px', padding: '20px',
                width: '100%', maxWidth: 600, maxHeight: '100%', overflowY: 'auto',
                boxSizing: 'border-box',
            }, children: content }) }));
}
function ScopePicker({ value, onChange }) {
    const opts = [
        { value: 'instance', label: 'This' },
        { value: 'following', label: 'This + Following' },
        { value: 'all', label: 'All in Series' },
    ];
    return (_jsx("div", { style: {
            display: 'flex', borderRadius: 6, overflow: 'hidden',
            border: '1px solid #d1d5db', maxWidth: '100%',
        }, children: opts.map(o => (_jsx("button", { type: "button", onClick: () => onChange(o.value), style: {
                flex: 1, padding: '6px 8px', fontSize: 12, fontWeight: 600,
                border: 'none', cursor: 'pointer',
                backgroundColor: o.value === value ? '#3b82f6' : 'white',
                color: o.value === value ? 'white' : '#374151',
                whiteSpace: 'nowrap',
            }, children: o.label }, o.value))) }));
}
//# sourceMappingURL=AppointmentForm.js.map