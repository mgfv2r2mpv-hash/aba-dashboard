import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
import { BACB_RBT_SUPERVISION_MIN_PERCENT } from '../types';
import { v4 as uuidv4 } from 'uuid';
import AvailabilityGrid from './AvailabilityGrid';
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
    // String state for assignment hours (keyed by techId_assignmentIdx)
    const [assignmentHoursStr, setAssignmentHoursStr] = useState({});
    // Toggle for grid view
    const [useGridView, setUseGridView] = useState(false);
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
    const setDayAvailability = (list, id, day, action, value) => {
        const updateWindowsForDay = (windows) => {
            if (action === 'clear') {
                return undefined;
            }
            else if (action === 'add') {
                return [...windows, { start: '09:00', end: '17:00' }];
            }
            else if (action === 'removeWindow') {
                const idx = value;
                const updated = windows.filter((_, i) => i !== idx);
                return updated.length === 0 ? undefined : updated;
            }
            else if (action.startsWith('windowIdx_')) {
                const [, idxStr, fieldName] = action.split('_');
                const idx = parseInt(idxStr);
                const updated = [...windows];
                updated[idx] = { ...updated[idx], [fieldName]: value };
                return updated;
            }
            return windows;
        };
        if (list === 'client') {
            const c = clients.find(c => c.id === id);
            if (!c)
                return;
            const win = { ...c.availabilityWindows };
            const windows = win[day] || [];
            win[day] = updateWindowsForDay(windows);
            if (win[day] === undefined)
                delete win[day];
            updateClient(id, { availabilityWindows: win });
        }
        else {
            const t = technicians.find(t => t.id === id);
            if (!t)
                return;
            const av = { ...t.availability };
            const windows = av[day] || [];
            av[day] = updateWindowsForDay(windows);
            if (av[day] === undefined)
                delete av[day];
            updateTechnician(id, { availability: av });
        }
    };
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
                backgroundColor: 'white', borderRadius: '8px', padding: '20px',
                width: 'min(720px, 95vw)', maxHeight: '90vh', overflowY: 'auto',
                boxSizing: 'border-box',
            }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }, children: [_jsx("h2", { style: { fontSize: '20px', fontWeight: 'bold' }, children: "Setup Wizard" }), _jsx("button", { onClick: onCancel, style: { background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }, children: "\u2715" })] }), _jsx("div", { style: { display: 'flex', gap: '4px', marginBottom: '20px' }, children: Array.from({ length: totalSteps }).map((_, i) => (_jsx("div", { style: {
                            flex: 1,
                            height: '4px',
                            backgroundColor: i <= stepIndex ? '#3b82f6' : '#e5e7eb',
                            borderRadius: '2px',
                        } }, i))) }), step === 'welcome' && (_jsxs("div", { children: [_jsx("h3", { style: { fontSize: '18px', marginBottom: '12px' }, children: "Welcome! Let's set up your dashboard." }), _jsx("p", { style: { color: '#6b7280', marginBottom: '12px' }, children: "We'll walk through 4 quick steps to configure your company:" }), _jsxs("ol", { style: { paddingLeft: '20px', color: '#374151', lineHeight: '1.8' }, children: [_jsx("li", { children: "Company supervision and training requirements" }), _jsx("li", { children: "Client list with availability windows" }), _jsx("li", { children: "Technicians with RBT status, availability, and assignments" }), _jsx("li", { children: "Review & create" })] }), _jsx("p", { style: { color: '#6b7280', marginTop: '12px', fontSize: '13px' }, children: "Use anonymized identifiers (e.g. \"Client A\") \u2014 never enter real names. You can add appointments after the wizard completes." })] })), step === 'company' && (_jsxs("div", { children: [_jsx("h3", { style: { fontSize: '18px', marginBottom: '12px' }, children: "Company Requirements" }), _jsx("p", { style: { color: '#6b7280', marginBottom: '16px', fontSize: '13px' }, children: "These are the constraints we'll check against. Defaults match BACB minimums and a common parent-training target." }), _jsxs("div", { style: { display: 'grid', gap: '12px' }, children: [_jsxs("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }, children: [_jsxs("div", { children: [_jsx("label", { style: labelStyle, children: "Supervision: % of direct hours" }), _jsx("input", { type: "number", step: "0.1", value: supDirectStr, onChange: (e) => setSupDirectStr(e.target.value), style: inputStyle })] }), _jsxs("div", { children: [_jsx("label", { style: labelStyle, children: "Supervision: % of RBT hours (BACB minimum)" }), _jsx("div", { style: { display: 'flex', gap: '8px', alignItems: 'flex-start' }, children: _jsx("div", { style: { flex: 1 }, children: _jsx("input", { type: "number", step: "0.1", value: rbtOverride ? supRBTStr : String(BACB_RBT_SUPERVISION_MIN_PERCENT), onChange: (e) => setSupRBTStr(e.target.value), disabled: !rbtOverride, style: { ...inputStyle, opacity: rbtOverride ? 1 : 0.6 } }) }) }), _jsxs("label", { style: { display: 'flex', gap: '6px', alignItems: 'center', fontSize: '12px', marginTop: '6px', cursor: 'pointer' }, children: [_jsx("input", { type: "checkbox", checked: rbtOverride, onChange: (e) => setRBTOverride(e.target.checked) }), _jsx("span", { children: "Override BACB minimum" })] }), _jsxs("p", { style: { fontSize: '11px', color: '#6b7280', marginTop: '4px' }, children: ["The BACB requires a minimum of ", BACB_RBT_SUPERVISION_MIN_PERCENT, "% for RBTs. Check the box to exceed this requirement."] })] })] }), _jsxs("div", { children: [_jsx("label", { style: labelStyle, children: "Parent training period" }), _jsxs("select", { value: settings.parentTraining.periodUnit, onChange: (e) => setSettings({
                                                ...settings,
                                                parentTraining: { ...settings.parentTraining, periodUnit: e.target.value },
                                            }), style: inputStyle, children: [_jsx("option", { value: "week", children: "per week" }), _jsx("option", { value: "month", children: "per month" }), _jsx("option", { value: "sixMonths", children: "per 6 months" }), _jsx("option", { value: "year", children: "per year" })] })] }), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }, children: [_jsxs("div", { children: [_jsx("label", { style: labelStyle, children: "Min hours" }), _jsx("input", { type: "number", step: "0.1", value: minHoursStr, onChange: (e) => setMinHoursStr(e.target.value), style: inputStyle })] }), _jsxs("div", { children: [_jsx("label", { style: labelStyle, children: "Target min" }), _jsx("input", { type: "number", step: "0.5", value: targetMinStr, onChange: (e) => setTargetMinStr(e.target.value), style: inputStyle })] }), _jsxs("div", { children: [_jsx("label", { style: labelStyle, children: "Target max" }), _jsx("input", { type: "number", step: "0.5", value: targetMaxStr, onChange: (e) => setTargetMaxStr(e.target.value), style: inputStyle })] })] })] })] })), step === 'clients' && (_jsxs("div", { children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }, children: [_jsxs("h3", { style: { fontSize: '18px' }, children: ["Clients (", clients.length, ")"] }), _jsx("button", { onClick: addClient, style: {
                                        padding: '6px 12px', backgroundColor: '#3b82f6', color: 'white',
                                        border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px',
                                    }, children: "+ Add Client" })] }), _jsx("p", { style: { color: '#6b7280', fontSize: '13px', marginBottom: '12px' }, children: "Use anonymized identifiers (e.g. \"Client A\"). Set availability windows per day." }), _jsxs("label", { style: { display: 'flex', gap: '6px', alignItems: 'center', fontSize: '13px', marginBottom: '12px', cursor: 'pointer' }, children: [_jsx("input", { type: "checkbox", checked: useGridView, onChange: (e) => setUseGridView(e.target.checked) }), _jsx("span", { children: "Use drag-select grid view" })] }), _jsxs("div", { style: { display: 'grid', gap: '12px' }, children: [clients.map(c => (_jsxs("div", { style: cardStyle, children: [_jsxs("div", { style: { display: 'flex', gap: '8px', marginBottom: '8px' }, children: [_jsx("input", { value: c.name, onChange: (e) => updateClient(c.id, { name: e.target.value }), placeholder: "Client name (anonymized)", style: { ...inputStyle, flex: 1 } }), _jsx("button", { onClick: () => removeClient(c.id), style: {
                                                        padding: '6px 10px', backgroundColor: '#fee2e2', color: '#dc2626',
                                                        border: '1px solid #fca5a5', borderRadius: '4px', cursor: 'pointer',
                                                    }, children: "Remove" })] }), _jsxs("div", { style: { marginBottom: '8px' }, children: [_jsxs("label", { style: { ...labelStyle, fontSize: '12px' }, children: ["Parent-training max (per ", settings.parentTraining.periodUnit, ", optional)"] }), _jsx("input", { type: "number", step: "0.5", min: "0", placeholder: `e.g. ${settings.parentTraining.targetMaxHours}`, value: c.parentTrainingMaxHours ?? '', onChange: (e) => {
                                                        const v = e.target.value;
                                                        updateClient(c.id, {
                                                            parentTrainingMaxHours: v === '' ? undefined : parseFloat(v) || 0,
                                                        });
                                                    }, style: { ...inputStyle, maxWidth: '180px' } }), _jsx("p", { style: { fontSize: '11px', color: '#6b7280', marginTop: '4px' }, children: "Hard cap for this case. If lower than the company target floor, this cap wins." })] }), useGridView ? (_jsx(AvailabilityGrid, { availability: c.availabilityWindows, onChange: (av) => updateClient(c.id, { availabilityWindows: av }) })) : (_jsx(DayAvailabilityRow, { availability: c.availabilityWindows, onChange: (day, field, value) => setDayAvailability('client', c.id, day, field, value) }))] }, c.id))), clients.length === 0 && (_jsx("p", { style: { color: '#9ca3af', textAlign: 'center', padding: '20px' }, children: "No clients yet. Click \"+ Add Client\" to start." }))] })] })), step === 'technicians' && (_jsxs("div", { children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }, children: [_jsxs("h3", { style: { fontSize: '18px' }, children: ["Technicians (", technicians.length, ")"] }), _jsx("button", { onClick: addTechnician, style: {
                                        padding: '6px 12px', backgroundColor: '#3b82f6', color: 'white',
                                        border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px',
                                    }, children: "+ Add Technician" })] }), _jsx("p", { style: { color: '#6b7280', fontSize: '13px', marginBottom: '12px' }, children: "Mark RBT certification (affects supervision math). Add availability and client assignments." }), _jsxs("label", { style: { display: 'flex', gap: '6px', alignItems: 'center', fontSize: '13px', marginBottom: '12px', cursor: 'pointer' }, children: [_jsx("input", { type: "checkbox", checked: useGridView, onChange: (e) => setUseGridView(e.target.checked) }), _jsx("span", { children: "Use drag-select grid view" })] }), _jsxs("div", { style: { display: 'grid', gap: '12px' }, children: [technicians.map(t => (_jsxs("div", { style: cardStyle, children: [_jsxs("div", { style: { display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'center' }, children: [_jsx("input", { value: t.name, onChange: (e) => updateTechnician(t.id, { name: e.target.value }), placeholder: "Technician name", style: { ...inputStyle, flex: 1 } }), _jsxs("label", { style: { display: 'flex', gap: '4px', alignItems: 'center', whiteSpace: 'nowrap' }, children: [_jsx("input", { type: "checkbox", checked: t.isRBT, onChange: (e) => updateTechnician(t.id, { isRBT: e.target.checked }) }), _jsx("span", { children: "RBT" })] }), _jsx("button", { onClick: () => removeTechnician(t.id), style: {
                                                        padding: '6px 10px', backgroundColor: '#fee2e2', color: '#dc2626',
                                                        border: '1px solid #fca5a5', borderRadius: '4px', cursor: 'pointer',
                                                    }, children: "Remove" })] }), useGridView ? (_jsx(AvailabilityGrid, { availability: t.availability, onChange: (av) => updateTechnician(t.id, { availability: av }) })) : (_jsx(DayAvailabilityRow, { availability: t.availability, onChange: (day, field, value) => setDayAvailability('tech', t.id, day, field, value) })), _jsxs("div", { style: { marginTop: '8px' }, children: [_jsx("label", { style: labelStyle, children: "Assignments" }), t.assignments.map((a, idx) => {
                                                    const assignmentKey = `${t.id}_${idx}`;
                                                    const hoursStr = assignmentHoursStr[assignmentKey] ?? String(a.hoursPerWeek);
                                                    return (_jsx("div", { children: _jsxs("div", { style: { display: 'flex', gap: '6px', marginBottom: '8px' }, children: [_jsxs("select", { value: a.clientId, onChange: (e) => {
                                                                        const updated = [...t.assignments];
                                                                        updated[idx] = { ...a, clientId: e.target.value };
                                                                        updateTechnician(t.id, { assignments: updated });
                                                                    }, style: { ...inputStyle, flex: 2 }, children: [_jsx("option", { value: "", children: "\u2014 Pick client \u2014" }), clients.map(c => _jsx("option", { value: c.name, children: c.name }, c.id))] }), _jsxs("div", { style: { flex: 1 }, children: [_jsx("label", { style: { ...labelStyle, marginBottom: '4px' }, children: "Hours/wk" }), _jsx("input", { type: "number", step: "0.5", value: hoursStr, onChange: (e) => setAssignmentHoursStr({ ...assignmentHoursStr, [assignmentKey]: e.target.value }), style: inputStyle })] }), _jsx("button", { onClick: () => {
                                                                        const newAssignments = t.assignments.filter((_, i) => i !== idx);
                                                                        const newHoursStr = { ...assignmentHoursStr };
                                                                        delete newHoursStr[assignmentKey];
                                                                        setAssignmentHoursStr(newHoursStr);
                                                                        updateTechnician(t.id, { assignments: newAssignments });
                                                                    }, style: {
                                                                        padding: '4px 8px', backgroundColor: '#fee2e2', color: '#dc2626',
                                                                        border: '1px solid #fca5a5', borderRadius: '4px', cursor: 'pointer',
                                                                    }, children: "\u00D7" })] }) }, idx));
                                                }), _jsx("button", { onClick: () => updateTechnician(t.id, {
                                                        assignments: [...t.assignments, { clientId: '', hoursPerWeek: 0, billable: true }],
                                                    }), style: {
                                                        padding: '4px 10px', backgroundColor: 'white', color: '#3b82f6',
                                                        border: '1px solid #3b82f6', borderRadius: '4px', cursor: 'pointer', fontSize: '12px',
                                                    }, children: "+ Assignment" })] })] }, t.id))), technicians.length === 0 && (_jsx("p", { style: { color: '#9ca3af', textAlign: 'center', padding: '20px' }, children: "No technicians yet. Click \"+ Add Technician\" to start." }))] })] })), step === 'review' && (_jsxs("div", { children: [_jsx("h3", { style: { fontSize: '18px', marginBottom: '12px' }, children: "Review & Create" }), _jsxs("div", { style: { display: 'grid', gap: '12px' }, children: [_jsxs("div", { style: cardStyle, children: [_jsx("strong", { children: "Company Settings" }), _jsxs("p", { style: { fontSize: '13px', color: '#6b7280', marginTop: '4px' }, children: ["Supervision: ", settings.supervisionDirectHoursPercent, "% direct + ", settings.supervisionRBTHoursPercent, "% RBT", _jsx("br", {}), "Parent training: ", settings.parentTraining.minimumHours, "h min, target ", settings.parentTraining.targetMinHours, "-", settings.parentTraining.targetMaxHours, "h/", settings.parentTraining.periodUnit] })] }), _jsxs("div", { style: cardStyle, children: [_jsxs("strong", { children: [clients.length, " client(s)"] }), _jsx("ul", { style: { fontSize: '13px', color: '#6b7280', marginTop: '4px', paddingLeft: '20px' }, children: clients.map(c => _jsx("li", { children: c.name }, c.id)) })] }), _jsxs("div", { style: cardStyle, children: [_jsxs("strong", { children: [technicians.length, " technician(s)"] }), _jsx("ul", { style: { fontSize: '13px', color: '#6b7280', marginTop: '4px', paddingLeft: '20px' }, children: technicians.map(t => _jsxs("li", { children: [t.name, " ", t.isRBT && '(RBT)', " - ", t.assignments.length, " assignment(s)"] }, t.id)) })] })] }), _jsx("p", { style: { marginTop: '12px', fontSize: '13px', color: '#6b7280' }, children: "Click Create to load this into the dashboard. You can add appointments after." })] })), _jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', marginTop: '20px' }, children: [_jsx("button", { onClick: () => {
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
function DayAvailabilityRow({ availability, onChange }) {
    return (_jsx("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', fontSize: '11px' }, children: DAYS.map(day => {
            const windows = availability[day] || [];
            return (_jsxs("div", { style: {
                    border: '1px solid #d1d5db',
                    borderRadius: '4px',
                    padding: '4px',
                    backgroundColor: windows.length > 0 ? 'white' : '#f3f4f6',
                }, children: [_jsx("div", { style: { fontWeight: '600', textAlign: 'center', marginBottom: '4px' }, children: day.slice(0, 3) }), windows.length > 0 ? (_jsxs(_Fragment, { children: [windows.map((window, idx) => (_jsxs("div", { style: { marginBottom: '4px', display: 'flex', gap: '2px' }, children: [_jsxs("div", { style: { flex: 1 }, children: [_jsx("input", { type: "time", value: window.start, onChange: (e) => onChange(day, `windowIdx_${idx}_start`, e.target.value), style: { width: '100%', fontSize: '10px', padding: '2px' } }), _jsx("input", { type: "time", value: window.end, onChange: (e) => onChange(day, `windowIdx_${idx}_end`, e.target.value), style: { width: '100%', fontSize: '10px', padding: '2px', marginTop: '1px' } })] }), windows.length > 1 && (_jsx("button", { onClick: () => onChange(day, 'removeWindow', idx), style: {
                                            padding: '1px 4px', fontSize: '9px',
                                            backgroundColor: '#fee2e2', color: '#dc2626', border: 'none',
                                            borderRadius: '2px', cursor: 'pointer', alignSelf: 'flex-start', marginTop: '2px',
                                        }, children: "\u00D7" }))] }, idx))), _jsx("button", { onClick: () => onChange(day, 'add'), style: {
                                    width: '100%', padding: '2px 0', fontSize: '9px',
                                    border: '1px solid #3b82f6', backgroundColor: 'white', color: '#3b82f6',
                                    borderRadius: '2px', cursor: 'pointer', marginBottom: '2px',
                                }, children: "+ window" }), _jsx("button", { onClick: () => onChange(day, 'clear'), style: {
                                    width: '100%', padding: '2px 0', fontSize: '9px', cursor: 'pointer',
                                    border: 'none', backgroundColor: '#fee2e2', color: '#dc2626',
                                    borderRadius: '2px',
                                }, children: "Off" })] })) : (_jsx("button", { onClick: () => onChange(day, 'add'), style: {
                            width: '100%', padding: '4px 0', fontSize: '11px',
                            border: 'none', backgroundColor: 'transparent',
                            color: '#3b82f6', cursor: 'pointer',
                        }, children: "+ add" }))] }, day));
        }) }));
}
//# sourceMappingURL=SetupWizard.js.map