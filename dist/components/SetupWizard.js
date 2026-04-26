import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
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
        supervisionRBTHoursPercent: 5,
        parentTrainingHoursPerMonth: { minimum: 1.5, target: { min: 2, max: 4 } },
    });
    const [clients, setClients] = useState([]);
    const [technicians, setTechnicians] = useState([]);
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
    const setDayAvailability = (list, id, day, field, value) => {
        if (list === 'client') {
            const c = clients.find(c => c.id === id);
            if (!c)
                return;
            const win = { ...c.availabilityWindows };
            if (field === 'clear') {
                delete win[day];
            }
            else {
                const existing = win[day]?.[0] || { start: '09:00', end: '17:00' };
                win[day] = [{ ...existing, [field]: value }];
            }
            updateClient(id, { availabilityWindows: win });
        }
        else {
            const t = technicians.find(t => t.id === id);
            if (!t)
                return;
            const av = { ...t.availability };
            if (field === 'clear') {
                delete av[day];
            }
            else {
                const existing = av[day]?.[0] || { start: '09:00', end: '17:00' };
                av[day] = [{ ...existing, [field]: value }];
            }
            updateTechnician(id, { availability: av });
        }
    };
    const finish = () => {
        const data = {
            id: uuidv4(),
            version: 1,
            clients,
            technicians,
            settings,
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
                backgroundColor: 'white', borderRadius: '8px', padding: '24px',
                width: '720px', maxHeight: '90vh', overflowY: 'auto',
            }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }, children: [_jsx("h2", { style: { fontSize: '20px', fontWeight: 'bold' }, children: "Setup Wizard" }), _jsx("button", { onClick: onCancel, style: { background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }, children: "\u2715" })] }), _jsx("div", { style: { display: 'flex', gap: '4px', marginBottom: '20px' }, children: Array.from({ length: totalSteps }).map((_, i) => (_jsx("div", { style: {
                            flex: 1,
                            height: '4px',
                            backgroundColor: i <= stepIndex ? '#3b82f6' : '#e5e7eb',
                            borderRadius: '2px',
                        } }, i))) }), step === 'welcome' && (_jsxs("div", { children: [_jsx("h3", { style: { fontSize: '18px', marginBottom: '12px' }, children: "Welcome! Let's set up your dashboard." }), _jsx("p", { style: { color: '#6b7280', marginBottom: '12px' }, children: "We'll walk through 4 quick steps to configure your company:" }), _jsxs("ol", { style: { paddingLeft: '20px', color: '#374151', lineHeight: '1.8' }, children: [_jsx("li", { children: "Company supervision and training requirements" }), _jsx("li", { children: "Client list with availability windows" }), _jsx("li", { children: "Technicians with RBT status, availability, and assignments" }), _jsx("li", { children: "Review & create" })] }), _jsx("p", { style: { color: '#6b7280', marginTop: '12px', fontSize: '13px' }, children: "Use anonymized client info \u2014 this stays in your browser and your encrypted Excel file. You can add appointments after the wizard completes." })] })), step === 'company' && (_jsxs("div", { children: [_jsx("h3", { style: { fontSize: '18px', marginBottom: '12px' }, children: "Company Requirements" }), _jsx("p", { style: { color: '#6b7280', marginBottom: '16px', fontSize: '13px' }, children: "These are the constraints we'll check against. Defaults match BACB minimums and a common parent-training target." }), _jsxs("div", { style: { display: 'grid', gap: '12px' }, children: [_jsxs("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }, children: [_jsxs("div", { children: [_jsx("label", { style: labelStyle, children: "Supervision: % of direct hours" }), _jsx("input", { type: "number", step: "0.1", value: settings.supervisionDirectHoursPercent, onChange: (e) => setSettings({ ...settings, supervisionDirectHoursPercent: parseFloat(e.target.value) || 0 }), style: inputStyle })] }), _jsxs("div", { children: [_jsx("label", { style: labelStyle, children: "Supervision: % of RBT hours" }), _jsx("input", { type: "number", step: "0.1", value: settings.supervisionRBTHoursPercent, onChange: (e) => setSettings({ ...settings, supervisionRBTHoursPercent: parseFloat(e.target.value) || 0 }), style: inputStyle })] })] }), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }, children: [_jsxs("div", { children: [_jsx("label", { style: labelStyle, children: "Parent training min/month" }), _jsx("input", { type: "number", step: "0.1", value: settings.parentTrainingHoursPerMonth.minimum, onChange: (e) => setSettings({
                                                        ...settings,
                                                        parentTrainingHoursPerMonth: { ...settings.parentTrainingHoursPerMonth, minimum: parseFloat(e.target.value) || 0 },
                                                    }), style: inputStyle })] }), _jsxs("div", { children: [_jsx("label", { style: labelStyle, children: "Target min" }), _jsx("input", { type: "number", step: "0.5", value: settings.parentTrainingHoursPerMonth.target.min, onChange: (e) => setSettings({
                                                        ...settings,
                                                        parentTrainingHoursPerMonth: {
                                                            ...settings.parentTrainingHoursPerMonth,
                                                            target: { ...settings.parentTrainingHoursPerMonth.target, min: parseFloat(e.target.value) || 0 },
                                                        },
                                                    }), style: inputStyle })] }), _jsxs("div", { children: [_jsx("label", { style: labelStyle, children: "Target max" }), _jsx("input", { type: "number", step: "0.5", value: settings.parentTrainingHoursPerMonth.target.max, onChange: (e) => setSettings({
                                                        ...settings,
                                                        parentTrainingHoursPerMonth: {
                                                            ...settings.parentTrainingHoursPerMonth,
                                                            target: { ...settings.parentTrainingHoursPerMonth.target, max: parseFloat(e.target.value) || 0 },
                                                        },
                                                    }), style: inputStyle })] })] })] })] })), step === 'clients' && (_jsxs("div", { children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }, children: [_jsxs("h3", { style: { fontSize: '18px' }, children: ["Clients (", clients.length, ")"] }), _jsx("button", { onClick: addClient, style: {
                                        padding: '6px 12px', backgroundColor: '#3b82f6', color: 'white',
                                        border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px',
                                    }, children: "+ Add Client" })] }), _jsx("p", { style: { color: '#6b7280', fontSize: '13px', marginBottom: '12px' }, children: "Use anonymized identifiers (e.g. \"Client A\"). Set availability windows per day." }), _jsxs("div", { style: { display: 'grid', gap: '12px' }, children: [clients.map(c => (_jsxs("div", { style: cardStyle, children: [_jsxs("div", { style: { display: 'flex', gap: '8px', marginBottom: '8px' }, children: [_jsx("input", { value: c.name, onChange: (e) => updateClient(c.id, { name: e.target.value }), placeholder: "Client name (anonymized)", style: { ...inputStyle, flex: 1 } }), _jsx("button", { onClick: () => removeClient(c.id), style: {
                                                        padding: '6px 10px', backgroundColor: '#fee2e2', color: '#dc2626',
                                                        border: '1px solid #fca5a5', borderRadius: '4px', cursor: 'pointer',
                                                    }, children: "Remove" })] }), _jsx(DayAvailabilityRow, { availability: c.availabilityWindows, onChange: (day, field, value) => setDayAvailability('client', c.id, day, field, value) })] }, c.id))), clients.length === 0 && (_jsx("p", { style: { color: '#9ca3af', textAlign: 'center', padding: '20px' }, children: "No clients yet. Click \"+ Add Client\" to start." }))] })] })), step === 'technicians' && (_jsxs("div", { children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }, children: [_jsxs("h3", { style: { fontSize: '18px' }, children: ["Technicians (", technicians.length, ")"] }), _jsx("button", { onClick: addTechnician, style: {
                                        padding: '6px 12px', backgroundColor: '#3b82f6', color: 'white',
                                        border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px',
                                    }, children: "+ Add Technician" })] }), _jsx("p", { style: { color: '#6b7280', fontSize: '13px', marginBottom: '12px' }, children: "Mark RBT certification (affects supervision math). Add availability and client assignments." }), _jsxs("div", { style: { display: 'grid', gap: '12px' }, children: [technicians.map(t => (_jsxs("div", { style: cardStyle, children: [_jsxs("div", { style: { display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'center' }, children: [_jsx("input", { value: t.name, onChange: (e) => updateTechnician(t.id, { name: e.target.value }), placeholder: "Technician name", style: { ...inputStyle, flex: 1 } }), _jsxs("label", { style: { display: 'flex', gap: '4px', alignItems: 'center', whiteSpace: 'nowrap' }, children: [_jsx("input", { type: "checkbox", checked: t.isRBT, onChange: (e) => updateTechnician(t.id, { isRBT: e.target.checked }) }), _jsx("span", { children: "RBT" })] }), _jsx("button", { onClick: () => removeTechnician(t.id), style: {
                                                        padding: '6px 10px', backgroundColor: '#fee2e2', color: '#dc2626',
                                                        border: '1px solid #fca5a5', borderRadius: '4px', cursor: 'pointer',
                                                    }, children: "Remove" })] }), _jsx(DayAvailabilityRow, { availability: t.availability, onChange: (day, field, value) => setDayAvailability('tech', t.id, day, field, value) }), _jsxs("div", { style: { marginTop: '8px' }, children: [_jsx("label", { style: labelStyle, children: "Assignments" }), t.assignments.map((a, idx) => (_jsxs("div", { style: { display: 'flex', gap: '6px', marginBottom: '4px' }, children: [_jsxs("select", { value: a.clientId, onChange: (e) => {
                                                                const updated = [...t.assignments];
                                                                updated[idx] = { ...a, clientId: e.target.value };
                                                                updateTechnician(t.id, { assignments: updated });
                                                            }, style: { ...inputStyle, flex: 2 }, children: [_jsx("option", { value: "", children: "\u2014 Pick client \u2014" }), clients.map(c => _jsx("option", { value: c.name, children: c.name }, c.id))] }), _jsx("input", { type: "number", step: "0.5", placeholder: "Hours/wk", value: a.hoursPerWeek, onChange: (e) => {
                                                                const updated = [...t.assignments];
                                                                updated[idx] = { ...a, hoursPerWeek: parseFloat(e.target.value) || 0 };
                                                                updateTechnician(t.id, { assignments: updated });
                                                            }, style: { ...inputStyle, flex: 1 } }), _jsx("button", { onClick: () => {
                                                                updateTechnician(t.id, { assignments: t.assignments.filter((_, i) => i !== idx) });
                                                            }, style: {
                                                                padding: '4px 8px', backgroundColor: '#fee2e2', color: '#dc2626',
                                                                border: '1px solid #fca5a5', borderRadius: '4px', cursor: 'pointer',
                                                            }, children: "\u00D7" })] }, idx))), _jsx("button", { onClick: () => updateTechnician(t.id, {
                                                        assignments: [...t.assignments, { clientId: '', hoursPerWeek: 0, billable: true }],
                                                    }), style: {
                                                        padding: '4px 10px', backgroundColor: 'white', color: '#3b82f6',
                                                        border: '1px solid #3b82f6', borderRadius: '4px', cursor: 'pointer', fontSize: '12px',
                                                    }, children: "+ Assignment" })] })] }, t.id))), technicians.length === 0 && (_jsx("p", { style: { color: '#9ca3af', textAlign: 'center', padding: '20px' }, children: "No technicians yet. Click \"+ Add Technician\" to start." }))] })] })), step === 'review' && (_jsxs("div", { children: [_jsx("h3", { style: { fontSize: '18px', marginBottom: '12px' }, children: "Review & Create" }), _jsxs("div", { style: { display: 'grid', gap: '12px' }, children: [_jsxs("div", { style: cardStyle, children: [_jsx("strong", { children: "Company Settings" }), _jsxs("p", { style: { fontSize: '13px', color: '#6b7280', marginTop: '4px' }, children: ["Supervision: ", settings.supervisionDirectHoursPercent, "% direct + ", settings.supervisionRBTHoursPercent, "% RBT", _jsx("br", {}), "Parent training: ", settings.parentTrainingHoursPerMonth.minimum, "h min, target ", settings.parentTrainingHoursPerMonth.target.min, "-", settings.parentTrainingHoursPerMonth.target.max, "h/mo"] })] }), _jsxs("div", { style: cardStyle, children: [_jsxs("strong", { children: [clients.length, " client(s)"] }), _jsx("ul", { style: { fontSize: '13px', color: '#6b7280', marginTop: '4px', paddingLeft: '20px' }, children: clients.map(c => _jsx("li", { children: c.name }, c.id)) })] }), _jsxs("div", { style: cardStyle, children: [_jsxs("strong", { children: [technicians.length, " technician(s)"] }), _jsx("ul", { style: { fontSize: '13px', color: '#6b7280', marginTop: '4px', paddingLeft: '20px' }, children: technicians.map(t => _jsxs("li", { children: [t.name, " ", t.isRBT && '(RBT)', " - ", t.assignments.length, " assignment(s)"] }, t.id)) })] })] }), _jsx("p", { style: { marginTop: '12px', fontSize: '13px', color: '#6b7280' }, children: "Click Create to load this into the dashboard. You can add appointments after." })] })), _jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', marginTop: '20px' }, children: [_jsx("button", { onClick: () => {
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
            const window = availability[day]?.[0];
            return (_jsxs("div", { style: {
                    border: '1px solid #d1d5db',
                    borderRadius: '4px',
                    padding: '4px',
                    backgroundColor: window ? 'white' : '#f3f4f6',
                }, children: [_jsx("div", { style: { fontWeight: '600', textAlign: 'center', marginBottom: '2px' }, children: day.slice(0, 3) }), window ? (_jsxs(_Fragment, { children: [_jsx("input", { type: "time", value: window.start, onChange: (e) => onChange(day, 'start', e.target.value), style: { width: '100%', fontSize: '11px', padding: '2px' } }), _jsx("input", { type: "time", value: window.end, onChange: (e) => onChange(day, 'end', e.target.value), style: { width: '100%', fontSize: '11px', padding: '2px', marginTop: '2px' } }), _jsx("button", { onClick: () => onChange(day, 'clear'), style: {
                                    width: '100%', marginTop: '2px', padding: '2px',
                                    fontSize: '10px', cursor: 'pointer',
                                    border: 'none', backgroundColor: '#fee2e2', color: '#dc2626',
                                    borderRadius: '2px',
                                }, children: "Off" })] })) : (_jsx("button", { onClick: () => onChange(day, 'start', '09:00'), style: {
                            width: '100%', padding: '4px 0', fontSize: '11px',
                            border: 'none', backgroundColor: 'transparent',
                            color: '#3b82f6', cursor: 'pointer',
                        }, children: "+ add" }))] }, day));
        }) }));
}
//# sourceMappingURL=SetupWizard.js.map