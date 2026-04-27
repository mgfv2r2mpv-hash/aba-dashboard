import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { BACB_RBT_SUPERVISION_MIN_PERCENT } from '../types';
import { v4 as uuidv4 } from 'uuid';
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
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
const cardStyle = {
    padding: '12px',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    backgroundColor: '#f9fafb',
};
export default function SetupWizard({ onComplete, onCancel }) {
    const [step, setStep] = useState('welcome');
    const [settings, setSettings] = useState({
        supervisionDirectHoursPercent: 5,
        supervisionRBTHoursPercent: BACB_RBT_SUPERVISION_MIN_PERCENT,
        parentTraining: {
            minimumHours: 1.5,
            targetMinHours: 2,
            targetMaxHours: 4,
            periodUnit: 'month',
        },
        clinicianAvailability: {
            Monday: [{ start: '09:00', end: '17:00' }],
            Tuesday: [{ start: '09:00', end: '17:00' }],
            Wednesday: [{ start: '09:00', end: '17:00' }],
            Thursday: [{ start: '09:00', end: '17:00' }],
            Friday: [{ start: '09:00', end: '17:00' }],
        },
    });
    // String state for numeric inputs (allows clearing/editing without parseFloat || 0 trapping)
    const [supDirectStr, setSupDirectStr] = useState('5');
    const [supRBTStr, setSupRBTStr] = useState(String(BACB_RBT_SUPERVISION_MIN_PERCENT));
    const [rbtOverride, setRBTOverride] = useState(false);
    const [minHoursStr, setMinHoursStr] = useState('1.5');
    const [targetMinStr, setTargetMinStr] = useState('2');
    const [targetMaxStr, setTargetMaxStr] = useState('4');
    const [clients, setClients] = useState([]);
    const [technicians, setTechnicians] = useState([]);
    const [assignmentHoursStr, setAssignmentHoursStr] = useState({});
    const addClient = () => setClients([...clients, {
            id: uuidv4(),
            name: `Client ${clients.length + 1}`,
            availabilityWindows: {},
        }]);
    const updateClient = (id, patch) => {
        setClients(clients.map(c => c.id === id ? { ...c, ...patch } : c));
    };
    const removeClient = (id) => setClients(clients.filter(c => c.id !== id));
    const addTechnician = () => setTechnicians([...technicians, {
            id: uuidv4(),
            name: `Tech ${technicians.length + 1}`,
            isRBT: false,
            assignments: [],
            availability: {},
        }]);
    const updateTechnician = (id, patch) => {
        setTechnicians(technicians.map(t => t.id === id ? { ...t, ...patch } : t));
    };
    const removeTechnician = (id) => setTechnicians(technicians.filter(t => t.id !== id));
    const parseNumericString = (val, fallback = 0) => {
        const parsed = parseFloat(val);
        return isNaN(parsed) ? fallback : parsed;
    };
    const updateSettingsFromStrings = () => {
        const rbtValue = rbtOverride ? parseNumericString(supRBTStr, BACB_RBT_SUPERVISION_MIN_PERCENT) : BACB_RBT_SUPERVISION_MIN_PERCENT;
        return {
            ...settings,
            supervisionDirectHoursPercent: parseNumericString(supDirectStr, 5),
            supervisionRBTHoursPercent: rbtValue,
            parentTraining: {
                ...settings.parentTraining,
                minimumHours: parseNumericString(minHoursStr, 1.5),
                targetMinHours: parseNumericString(targetMinStr, 2),
                targetMaxHours: parseNumericString(targetMaxStr, 4),
            },
        };
    };
    const finish = () => {
        // Parse assignment hours from string state
        const techniciansWithParsedHours = technicians.map(t => ({
            ...t,
            assignments: t.assignments.map((a, idx) => {
                const assignmentKey = `${t.id}_${idx}`;
                const hoursStr = assignmentHoursStr[assignmentKey] ?? String(a.hoursPerWeek);
                return { ...a, hoursPerWeek: parseNumericString(hoursStr, 0) };
            }),
        }));
        const data = {
            id: uuidv4(),
            version: 1,
            clients,
            technicians: techniciansWithParsedHours,
            settings: updateSettingsFromStrings(),
            appointments: [],
            lastModified: new Date().toISOString(),
        };
        onComplete(data);
    };
    const stepIndex = ['welcome', 'company', 'clients', 'technicians', 'review'].indexOf(step);
    const totalSteps = 5;
    return (_jsx("div", { style: {
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        }, children: _jsxs("div", { style: {
                backgroundColor: 'white', borderRadius: '8px',
                width: 'min(720px, 100vw)', height: 'min(720px, 100vh)',
                overflow: 'hidden', display: 'flex', flexDirection: 'column',
                boxSizing: 'border-box',
            }, children: [_jsxs("div", { style: { padding: '20px 20px 0', flexShrink: 0 }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }, children: [_jsx("h2", { style: { fontSize: '20px', fontWeight: 'bold' }, children: "Setup Wizard" }), _jsx("button", { onClick: onCancel, style: { background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }, children: "\u2715" })] }), _jsx("div", { style: { display: 'flex', gap: '4px', marginBottom: '16px' }, children: Array.from({ length: totalSteps }).map((_, i) => (_jsx("div", { style: {
                                    flex: 1, height: '4px',
                                    backgroundColor: i <= stepIndex ? '#3b82f6' : '#e5e7eb',
                                    borderRadius: '2px',
                                } }, i))) })] }), _jsxs("div", { style: { flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: '0 20px 16px' }, children: [step === 'welcome' && (_jsxs("div", { children: [_jsx("h3", { style: { fontSize: '18px', marginBottom: '12px' }, children: "Welcome! Let's set up your dashboard." }), _jsx("p", { style: { color: '#6b7280', marginBottom: '12px' }, children: "We'll walk through 4 quick steps to configure your company:" }), _jsxs("ol", { style: { paddingLeft: '20px', color: '#374151', lineHeight: '1.8' }, children: [_jsx("li", { children: "Company supervision and training requirements" }), _jsx("li", { children: "Client list with availability windows" }), _jsx("li", { children: "Technicians with RBT status, availability, and assignments" }), _jsx("li", { children: "Review & create" })] }), _jsx("p", { style: { color: '#6b7280', marginTop: '12px', fontSize: '13px' }, children: "Use anonymized identifiers (e.g. \"Client A\") \u2014 never enter real names. You can add appointments after the wizard completes." })] })), step === 'company' && (_jsxs("div", { children: [_jsx("h3", { style: { fontSize: '18px', marginBottom: '12px' }, children: "Company Requirements" }), _jsx("p", { style: { color: '#6b7280', marginBottom: '16px', fontSize: '13px' }, children: "These are the constraints we'll check against. Defaults match BACB minimums and a common parent-training target." }), _jsxs("div", { style: { marginBottom: '16px', padding: '12px', backgroundColor: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '6px' }, children: [_jsx("label", { style: labelStyle, children: "Clinician (supervisor) availability" }), _jsx("p", { style: { fontSize: '12px', color: '#6b7280', marginBottom: '8px' }, children: "Sessions can't ethically be scheduled when you're not available to supervise. This sets the default visible range for the schedule grid (you can toggle 24h later for occasional late or early work)." }), _jsx(WeeklyAvailability, { availability: settings.clinicianAvailability || {}, onChange: (av) => setSettings({ ...settings, clinicianAvailability: av }) })] }), _jsxs("div", { style: { display: 'grid', gap: '12px' }, children: [_jsxs("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }, children: [_jsxs("div", { children: [_jsx("label", { style: labelStyle, children: "Supervision: % of direct hours" }), _jsx("input", { type: "number", step: "0.1", value: supDirectStr, onChange: (e) => setSupDirectStr(e.target.value), style: inputStyle })] }), _jsxs("div", { children: [_jsx("label", { style: labelStyle, children: "Supervision: % of RBT hours (BACB minimum)" }), _jsx("div", { style: { display: 'flex', gap: '8px', alignItems: 'flex-start' }, children: _jsx("div", { style: { flex: 1 }, children: _jsx("input", { type: "number", step: "0.1", value: rbtOverride ? supRBTStr : String(BACB_RBT_SUPERVISION_MIN_PERCENT), onChange: (e) => setSupRBTStr(e.target.value), disabled: !rbtOverride, style: { ...inputStyle, opacity: rbtOverride ? 1 : 0.6 } }) }) }), _jsxs("label", { style: { display: 'flex', gap: '6px', alignItems: 'center', fontSize: '12px', marginTop: '6px', cursor: 'pointer' }, children: [_jsx("input", { type: "checkbox", checked: rbtOverride, onChange: (e) => setRBTOverride(e.target.checked) }), _jsx("span", { children: "Override BACB minimum" })] }), _jsxs("p", { style: { fontSize: '11px', color: '#6b7280', marginTop: '4px' }, children: ["The BACB requires a minimum of ", BACB_RBT_SUPERVISION_MIN_PERCENT, "% for RBTs. Check the box to exceed this requirement."] })] })] }), _jsxs("div", { children: [_jsx("label", { style: labelStyle, children: "Parent training period" }), _jsxs("select", { value: settings.parentTraining.periodUnit, onChange: (e) => setSettings({
                                                        ...settings,
                                                        parentTraining: { ...settings.parentTraining, periodUnit: e.target.value },
                                                    }), style: inputStyle, children: [_jsx("option", { value: "week", children: "per week" }), _jsx("option", { value: "month", children: "per month" }), _jsx("option", { value: "sixMonths", children: "per 6 months" }), _jsx("option", { value: "year", children: "per year" })] })] }), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }, children: [_jsxs("div", { children: [_jsx("label", { style: labelStyle, children: "Min hours" }), _jsx("input", { type: "number", step: "0.1", value: minHoursStr, onChange: (e) => setMinHoursStr(e.target.value), style: inputStyle })] }), _jsxs("div", { children: [_jsx("label", { style: labelStyle, children: "Target min" }), _jsx("input", { type: "number", step: "0.5", value: targetMinStr, onChange: (e) => setTargetMinStr(e.target.value), style: inputStyle })] }), _jsxs("div", { children: [_jsx("label", { style: labelStyle, children: "Target max" }), _jsx("input", { type: "number", step: "0.5", value: targetMaxStr, onChange: (e) => setTargetMaxStr(e.target.value), style: inputStyle })] })] })] })] })), step === 'clients' && (_jsxs("div", { children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }, children: [_jsxs("h3", { style: { fontSize: '18px' }, children: ["Clients (", clients.length, ")"] }), _jsx("button", { onClick: addClient, style: {
                                                padding: '6px 12px', backgroundColor: '#3b82f6', color: 'white',
                                                border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px',
                                            }, children: "+ Add Client" })] }), _jsx("p", { style: { color: '#6b7280', fontSize: '13px', marginBottom: '12px' }, children: "Use anonymized identifiers (e.g. \"Client A\"). Set availability windows per day." }), _jsxs("div", { style: { display: 'grid', gap: '12px' }, children: [clients.map(c => (_jsxs("div", { style: cardStyle, children: [_jsxs("div", { style: { display: 'flex', gap: '8px', marginBottom: '8px' }, children: [_jsx("input", { value: c.name, onChange: (e) => updateClient(c.id, { name: e.target.value }), placeholder: "Client name (anonymized)", style: { ...inputStyle, flex: 1 } }), _jsx("button", { onClick: () => removeClient(c.id), style: {
                                                                padding: '6px 10px', backgroundColor: '#fee2e2', color: '#dc2626',
                                                                border: '1px solid #fca5a5', borderRadius: '4px', cursor: 'pointer',
                                                            }, children: "Remove" })] }), _jsxs("div", { style: { marginBottom: '8px' }, children: [_jsxs("label", { style: { ...labelStyle, fontSize: '12px' }, children: ["Parent-training max (per ", settings.parentTraining.periodUnit, ", optional)"] }), _jsx("input", { type: "number", step: "0.5", min: "0", placeholder: `e.g. ${settings.parentTraining.targetMaxHours}`, value: c.parentTrainingMaxHours ?? '', onChange: (e) => {
                                                                const v = e.target.value;
                                                                updateClient(c.id, {
                                                                    parentTrainingMaxHours: v === '' ? undefined : parseFloat(v) || 0,
                                                                });
                                                            }, style: { ...inputStyle, maxWidth: '180px' } }), _jsx("p", { style: { fontSize: '11px', color: '#6b7280', marginTop: '4px' }, children: "Hard cap for this case. If lower than the company target floor, this cap wins." })] }), _jsx(WeeklyAvailability, { availability: c.availabilityWindows, onChange: (av) => updateClient(c.id, { availabilityWindows: av }), defaultWindow: { start: '15:00', end: '19:00' } })] }, c.id))), clients.length === 0 && (_jsx("p", { style: { color: '#9ca3af', textAlign: 'center', padding: '20px' }, children: "No clients yet. Click \"+ Add Client\" to start." }))] })] })), step === 'technicians' && (_jsxs("div", { children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }, children: [_jsxs("h3", { style: { fontSize: '18px' }, children: ["Technicians (", technicians.length, ")"] }), _jsx("button", { onClick: addTechnician, style: {
                                                padding: '6px 12px', backgroundColor: '#3b82f6', color: 'white',
                                                border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px',
                                            }, children: "+ Add Technician" })] }), _jsx("p", { style: { color: '#6b7280', fontSize: '13px', marginBottom: '12px' }, children: "Mark RBT certification (affects supervision math). Add availability and client assignments." }), _jsxs("div", { style: { display: 'grid', gap: '12px' }, children: [technicians.map(t => (_jsxs("div", { style: cardStyle, children: [_jsxs("div", { style: { display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'center' }, children: [_jsx("input", { value: t.name, onChange: (e) => updateTechnician(t.id, { name: e.target.value }), placeholder: "Technician name", style: { ...inputStyle, flex: 1 } }), _jsxs("label", { style: { display: 'flex', gap: '4px', alignItems: 'center', whiteSpace: 'nowrap' }, children: [_jsx("input", { type: "checkbox", checked: t.isRBT, onChange: (e) => updateTechnician(t.id, { isRBT: e.target.checked }) }), _jsx("span", { children: "RBT" })] }), _jsx("button", { onClick: () => removeTechnician(t.id), style: {
                                                                padding: '6px 10px', backgroundColor: '#fee2e2', color: '#dc2626',
                                                                border: '1px solid #fca5a5', borderRadius: '4px', cursor: 'pointer',
                                                            }, children: "Remove" })] }), _jsx(WeeklyAvailability, { availability: t.availability, onChange: (av) => updateTechnician(t.id, { availability: av }), defaultWindow: { start: '15:00', end: '19:00' } }), _jsxs("div", { style: { marginTop: '8px' }, children: [_jsx("label", { style: labelStyle, children: "Assignments" }), t.assignments.length > 0 && (_jsxs("div", { style: { display: 'flex', gap: '6px', marginBottom: '4px' }, children: [_jsx("span", { style: { flex: 2, fontSize: '11px', color: '#6b7280', fontWeight: 600, paddingLeft: '2px' }, children: "Client" }), _jsx("span", { style: { flex: 1, fontSize: '11px', color: '#6b7280', fontWeight: 600, paddingLeft: '2px' }, children: "Hrs/wk" }), _jsx("span", { style: { width: '38px' } })] })), t.assignments.map((a, idx) => {
                                                            const assignmentKey = `${t.id}_${idx}`;
                                                            const hoursStr = assignmentHoursStr[assignmentKey] ?? String(a.hoursPerWeek);
                                                            return (_jsxs("div", { style: { display: 'flex', gap: '6px', marginBottom: '6px' }, children: [_jsxs("select", { value: a.clientId, onChange: (e) => {
                                                                            const updated = [...t.assignments];
                                                                            updated[idx] = { ...a, clientId: e.target.value };
                                                                            updateTechnician(t.id, { assignments: updated });
                                                                        }, style: { ...inputStyle, flex: 2 }, children: [_jsx("option", { value: "", children: "\u2014 Pick client \u2014" }), clients.map(c => _jsx("option", { value: c.name, children: c.name }, c.id))] }), _jsx("input", { type: "number", step: "0.5", value: hoursStr, onChange: (e) => setAssignmentHoursStr({ ...assignmentHoursStr, [assignmentKey]: e.target.value }), style: { ...inputStyle, flex: 1 } }), _jsx("button", { onClick: () => {
                                                                            const newAssignments = t.assignments.filter((_, i) => i !== idx);
                                                                            const newHoursStr = { ...assignmentHoursStr };
                                                                            delete newHoursStr[assignmentKey];
                                                                            setAssignmentHoursStr(newHoursStr);
                                                                            updateTechnician(t.id, { assignments: newAssignments });
                                                                        }, style: {
                                                                            padding: '4px 8px', backgroundColor: '#fee2e2', color: '#dc2626',
                                                                            border: '1px solid #fca5a5', borderRadius: '4px', cursor: 'pointer',
                                                                            alignSelf: 'center',
                                                                        }, children: "\u00D7" })] }, idx));
                                                        }), _jsx("button", { onClick: () => updateTechnician(t.id, {
                                                                assignments: [...t.assignments, { clientId: '', hoursPerWeek: 0, billable: true }],
                                                            }), style: {
                                                                padding: '4px 10px', backgroundColor: 'white', color: '#3b82f6',
                                                                border: '1px solid #3b82f6', borderRadius: '4px', cursor: 'pointer', fontSize: '12px',
                                                            }, children: "+ Assignment" })] })] }, t.id))), technicians.length === 0 && (_jsx("p", { style: { color: '#9ca3af', textAlign: 'center', padding: '20px' }, children: "No technicians yet. Click \"+ Add Technician\" to start." }))] })] })), step === 'review' && (_jsxs("div", { children: [_jsx("h3", { style: { fontSize: '18px', marginBottom: '12px' }, children: "Review & Create" }), _jsxs("div", { style: { display: 'grid', gap: '12px' }, children: [_jsxs("div", { style: cardStyle, children: [_jsx("strong", { children: "Company Settings" }), _jsxs("p", { style: { fontSize: '13px', color: '#6b7280', marginTop: '4px' }, children: ["Supervision: ", settings.supervisionDirectHoursPercent, "% direct + ", settings.supervisionRBTHoursPercent, "% RBT", _jsx("br", {}), "Parent training: ", settings.parentTraining.minimumHours, "h min, target ", settings.parentTraining.targetMinHours, "-", settings.parentTraining.targetMaxHours, "h/", settings.parentTraining.periodUnit] })] }), _jsxs("div", { style: cardStyle, children: [_jsxs("strong", { children: [clients.length, " client(s)"] }), _jsx("ul", { style: { fontSize: '13px', color: '#6b7280', marginTop: '4px', paddingLeft: '20px' }, children: clients.map(c => _jsx("li", { children: c.name }, c.id)) })] }), _jsxs("div", { style: cardStyle, children: [_jsxs("strong", { children: [technicians.length, " technician(s)"] }), _jsx("ul", { style: { fontSize: '13px', color: '#6b7280', marginTop: '4px', paddingLeft: '20px' }, children: technicians.map(t => _jsxs("li", { children: [t.name, " ", t.isRBT && '(RBT)', " - ", t.assignments.length, " assignment(s)"] }, t.id)) })] })] }), _jsx("p", { style: { marginTop: '12px', fontSize: '13px', color: '#6b7280' }, children: "Click Create to load this into the dashboard. You can add appointments after." })] }))] }), _jsxs("div", { style: {
                        display: 'flex', justifyContent: 'space-between',
                        padding: '12px 20px',
                        borderTop: '1px solid #e5e7eb',
                        flexShrink: 0,
                        backgroundColor: 'white',
                    }, children: [_jsx("button", { onClick: () => {
                                if (step === 'welcome')
                                    return onCancel();
                                const order = ['welcome', 'company', 'clients', 'technicians', 'review'];
                                const idx = order.indexOf(step);
                                if (idx > 0)
                                    setStep(order[idx - 1]);
                            }, style: {
                                padding: '8px 16px', border: '1px solid #d1d5db', borderRadius: '6px',
                                background: 'white', cursor: 'pointer',
                            }, children: step === 'welcome' ? 'Cancel' : 'Back' }), step === 'review' ? (_jsx("button", { onClick: finish, style: {
                                padding: '8px 16px', backgroundColor: '#10b981', color: 'white',
                                border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600',
                            }, children: "Create Dashboard" })) : (_jsx("button", { onClick: () => {
                                if (step === 'company') {
                                    setSettings(updateSettingsFromStrings());
                                }
                                const order = ['welcome', 'company', 'clients', 'technicians', 'review'];
                                const idx = order.indexOf(step);
                                if (idx < order.length - 1)
                                    setStep(order[idx + 1]);
                            }, style: {
                                padding: '8px 16px', backgroundColor: '#3b82f6', color: 'white',
                                border: 'none', borderRadius: '6px', cursor: 'pointer',
                            }, children: "Next" }))] })] }) }));
}
function WeeklyAvailability({ availability, onChange, defaultWindow = { start: '09:00', end: '17:00' } }) {
    const updateWindow = (day, idx, field, value) => {
        const next = { ...availability };
        const list = (next[day] || []).slice();
        list[idx] = { ...list[idx], [field]: value };
        next[day] = list;
        onChange(next);
    };
    const addWindow = (day) => {
        const next = { ...availability };
        next[day] = [...(next[day] || []), { ...defaultWindow }];
        onChange(next);
    };
    const removeWindow = (day, idx) => {
        const next = { ...availability };
        next[day] = (next[day] || []).filter((_, i) => i !== idx);
        if ((next[day] || []).length === 0)
            delete next[day];
        onChange(next);
    };
    const clearDay = (day) => {
        const next = { ...availability };
        delete next[day];
        onChange(next);
    };
    const copyMondayToWeekdays = () => {
        const monWindows = availability['Monday'] || [];
        const next = { ...availability };
        ['Tuesday', 'Wednesday', 'Thursday', 'Friday'].forEach(d => {
            if (monWindows.length === 0) {
                delete next[d];
            }
            else {
                next[d] = monWindows.map(w => ({ ...w }));
            }
        });
        onChange(next);
    };
    const setWeekdays = (start, end) => {
        const next = { ...availability };
        ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].forEach(d => {
            next[d] = [{ start, end }];
        });
        onChange(next);
    };
    const clearAll = () => onChange({});
    return (_jsxs("div", { children: [_jsxs("div", { style: { display: 'flex', gap: '6px', marginBottom: '8px', flexWrap: 'wrap', alignItems: 'center' }, children: [_jsx("button", { onClick: () => setWeekdays('09:00', '17:00'), style: presetBtn, title: "Set Mon-Fri 9 AM-5 PM", children: "Weekdays 9-5" }), _jsx("button", { onClick: () => setWeekdays('15:00', '19:00'), style: presetBtn, title: "Set Mon-Fri 3 PM-7 PM", children: "After-school 3-7" }), _jsx("button", { onClick: copyMondayToWeekdays, style: presetBtn, title: "Copy Monday's windows to Tue-Fri", children: "Copy Mon to Tue-Fri" }), _jsx("button", { onClick: clearAll, style: { ...presetBtn, color: '#dc2626', borderColor: '#fca5a5' }, children: "Clear all" })] }), _jsx("div", { style: { display: 'grid', gap: '4px' }, children: DAYS.map((day, dayIdx) => {
                    const windows = availability[day] || [];
                    return (_jsxs("div", { style: {
                            display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap',
                            padding: '6px 8px', borderRadius: '4px',
                            background: dayIdx % 2 === 0 ? '#f9fafb' : 'white',
                            border: '1px solid #e5e7eb',
                        }, children: [_jsx("span", { style: { fontSize: '13px', fontWeight: 600, color: '#374151', width: '36px', flexShrink: 0 }, children: day.slice(0, 3) }), windows.length === 0 ? (_jsx("span", { style: { fontSize: '12px', color: '#9ca3af', fontStyle: 'italic' }, children: "Off" })) : (windows.map((w, idx) => (_jsxs("span", { style: {
                                    display: 'inline-flex', alignItems: 'center', gap: '3px',
                                    backgroundColor: '#eff6ff', border: '1px solid #bfdbfe',
                                    borderRadius: '4px', padding: '2px 5px',
                                }, children: [_jsx("input", { type: "time", value: w.start, onChange: (e) => updateWindow(day, idx, 'start', e.target.value), style: timeInput }), _jsx("span", { style: { fontSize: '12px', color: '#93c5fd' }, children: "-" }), _jsx("input", { type: "time", value: w.end, onChange: (e) => updateWindow(day, idx, 'end', e.target.value), style: timeInput }), _jsx("button", { onClick: () => removeWindow(day, idx), style: removeWindowBtn, title: "Remove this window", children: "\u00D7" })] }, idx)))), _jsx("button", { onClick: () => addWindow(day), style: addWindowBtn, title: `Add a time window on ${day}`, children: "+ window" }), windows.length > 0 && (_jsx("button", { onClick: () => clearDay(day), style: { ...presetBtn, fontSize: '11px', padding: '2px 8px', marginLeft: 'auto' }, title: `Clear ${day}`, children: "Off" }))] }, day));
                }) })] }));
}
const presetBtn = {
    padding: '4px 10px',
    fontSize: '12px',
    border: '1px solid #d1d5db',
    borderRadius: '4px',
    background: 'white',
    cursor: 'pointer',
    color: '#374151',
};
const timeInput = {
    fontSize: '12px',
    padding: '1px 2px',
    border: 'none',
    background: 'transparent',
    fontFamily: 'inherit',
};
const addWindowBtn = {
    padding: '3px 8px',
    fontSize: '11px',
    border: '1px dashed #3b82f6',
    background: 'white',
    color: '#3b82f6',
    borderRadius: '4px',
    cursor: 'pointer',
};
const removeWindowBtn = {
    padding: '0 4px',
    fontSize: '13px',
    border: 'none',
    background: 'transparent',
    color: '#60a5fa',
    borderRadius: '2px',
    cursor: 'pointer',
    lineHeight: 1,
    fontWeight: 600,
};
//# sourceMappingURL=SetupWizard.js.map