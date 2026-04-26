import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
const API_BASE = '/api';
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export default function AdminPanel({ data, onDataChange }) {
    const [activeTab, setActiveTab] = useState('technicians');
    const [savingId, setSavingId] = useState(null);
    const [error, setError] = useState(null);
    const persistTechnician = async (id, patch) => {
        setSavingId(id);
        setError(null);
        try {
            const res = await axios.post(`${API_BASE}/admin/technician/${id}`, patch);
            const updated = { ...data };
            const idx = updated.technicians.findIndex(t => t.id === id);
            if (idx >= 0)
                updated.technicians[idx] = res.data.technician;
            onDataChange(updated);
        }
        catch (e) {
            setError(e.response?.data?.error || e.message);
        }
        finally {
            setSavingId(null);
        }
    };
    const persistClient = async (id, patch) => {
        setSavingId(id);
        setError(null);
        try {
            const res = await axios.post(`${API_BASE}/admin/client/${id}`, patch);
            const updated = { ...data };
            const idx = updated.clients.findIndex(c => c.id === id);
            if (idx >= 0)
                updated.clients[idx] = res.data.client;
            onDataChange(updated);
        }
        catch (e) {
            setError(e.response?.data?.error || e.message);
        }
        finally {
            setSavingId(null);
        }
    };
    const addTechnician = async () => {
        const newTech = {
            id: uuidv4(),
            name: `Tech ${data.technicians.length + 1}`,
            isRBT: false,
            assignments: [],
            availability: {},
        };
        setSavingId(newTech.id);
        setError(null);
        try {
            const res = await axios.post(`${API_BASE}/admin/technicians`, newTech);
            onDataChange({ ...data, technicians: [...data.technicians, res.data.technician] });
        }
        catch (e) {
            setError(e.response?.data?.error || e.message);
        }
        finally {
            setSavingId(null);
        }
    };
    const addClient = async () => {
        const newClient = {
            id: uuidv4(),
            name: `Client ${data.clients.length + 1}`,
            availabilityWindows: {},
        };
        setSavingId(newClient.id);
        setError(null);
        try {
            const res = await axios.post(`${API_BASE}/admin/clients`, newClient);
            onDataChange({ ...data, clients: [...data.clients, res.data.client] });
        }
        catch (e) {
            setError(e.response?.data?.error || e.message);
        }
        finally {
            setSavingId(null);
        }
    };
    const removeTechnician = async (id) => {
        if (!confirm('Remove this technician? This does not delete their appointments.'))
            return;
        setSavingId(id);
        setError(null);
        try {
            await axios.delete(`${API_BASE}/admin/technician/${id}`);
            onDataChange({ ...data, technicians: data.technicians.filter(t => t.id !== id) });
        }
        catch (e) {
            setError(e.response?.data?.error || e.message);
        }
        finally {
            setSavingId(null);
        }
    };
    const removeClient = async (id) => {
        if (!confirm('Remove this client? This does not delete their appointments.'))
            return;
        setSavingId(id);
        setError(null);
        try {
            await axios.delete(`${API_BASE}/admin/client/${id}`);
            onDataChange({ ...data, clients: data.clients.filter(c => c.id !== id) });
        }
        catch (e) {
            setError(e.response?.data?.error || e.message);
        }
        finally {
            setSavingId(null);
        }
    };
    const tabStyle = (isActive) => ({
        padding: '12px 16px',
        backgroundColor: isActive ? '#ffffff' : '#f3f4f6',
        border: isActive ? '2px solid #3b82f6' : '1px solid #e5e7eb',
        borderBottom: 'none',
        cursor: 'pointer',
        fontWeight: isActive ? '600' : 'normal',
    });
    return (_jsxs("div", { style: { flex: 1, display: 'flex', flexDirection: 'column' }, children: [_jsxs("div", { style: { display: 'flex', borderBottom: '1px solid #e5e7eb', backgroundColor: '#f9f9f9' }, children: [_jsx("button", { onClick: () => setActiveTab('technicians'), style: tabStyle(activeTab === 'technicians'), children: "Technicians" }), _jsx("button", { onClick: () => setActiveTab('clients'), style: tabStyle(activeTab === 'clients'), children: "Clients" }), _jsx("button", { onClick: () => setActiveTab('settings'), style: tabStyle(activeTab === 'settings'), children: "Settings" })] }), error && (_jsx("div", { style: { padding: '8px 16px', backgroundColor: '#fee2e2', color: '#991b1b', fontSize: '13px' }, children: error })), _jsxs("div", { style: { flex: 1, overflow: 'auto', padding: '24px' }, children: [activeTab === 'technicians' && (_jsxs("div", { children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }, children: [_jsxs("h3", { style: { fontSize: '18px', fontWeight: 'bold' }, children: ["Manage Technicians (", data.technicians.length, ")"] }), _jsx("button", { onClick: addTechnician, style: primaryBtn, children: "+ Add Technician" })] }), _jsxs("div", { style: { display: 'grid', gap: '16px' }, children: [data.technicians.map(tech => (_jsx(TechnicianCard, { tech: tech, saving: savingId === tech.id, onChange: (patch) => persistTechnician(tech.id, patch), onRemove: () => removeTechnician(tech.id) }, tech.id))), data.technicians.length === 0 && (_jsx("p", { style: { color: '#9ca3af', textAlign: 'center', padding: '20px' }, children: "No technicians yet." }))] })] })), activeTab === 'clients' && (_jsxs("div", { children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }, children: [_jsxs("h3", { style: { fontSize: '18px', fontWeight: 'bold' }, children: ["Manage Clients (", data.clients.length, ")"] }), _jsx("button", { onClick: addClient, style: primaryBtn, children: "+ Add Client" })] }), _jsxs("div", { style: { display: 'grid', gap: '16px' }, children: [data.clients.map(client => (_jsx(ClientCard, { client: client, saving: savingId === client.id, onChange: (patch) => persistClient(client.id, patch), onRemove: () => removeClient(client.id) }, client.id))), data.clients.length === 0 && (_jsx("p", { style: { color: '#9ca3af', textAlign: 'center', padding: '20px' }, children: "No clients yet." }))] })] })), activeTab === 'settings' && (_jsxs("div", { children: [_jsx("h3", { style: { marginBottom: '16px', fontSize: '18px', fontWeight: 'bold' }, children: "Company Settings" }), _jsxs("div", { style: {
                                    backgroundColor: '#f9f9f9', border: '1px solid #e5e7eb', borderRadius: '8px',
                                    padding: '16px', display: 'grid', gap: '16px',
                                }, children: [_jsx(SettingRow, { label: "Supervision \u2014 Direct Hours", value: `${data.settings.supervisionDirectHoursPercent}% of direct client hours` }), _jsx(SettingRow, { label: "Supervision \u2014 RBT Hours", value: `${data.settings.supervisionRBTHoursPercent}% of RBT hours` }), _jsx(SettingRow, { label: "Parent Training", value: `Min: ${data.settings.parentTraining.minimumHours}h/${data.settings.parentTraining.periodUnit} · Target: ${data.settings.parentTraining.targetMinHours}–${data.settings.parentTraining.targetMaxHours}h/${data.settings.parentTraining.periodUnit}` }), _jsx("p", { style: { fontSize: '12px', color: '#6b7280' }, children: "Settings are configured in the Setup Wizard. Re-run the wizard to change them." })] })] }))] })] }));
}
function TechnicianCard({ tech, saving, onChange, onRemove }) {
    const [name, setName] = useState(tech.name);
    const [editing, setEditing] = useState(false);
    return (_jsxs("div", { style: cardStyle, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '12px', gap: '8px', flexWrap: 'wrap' }, children: [_jsxs("div", { style: { flex: '1 1 200px', minWidth: 0 }, children: [_jsx("input", { value: name, onChange: (e) => setName(e.target.value), onBlur: () => { if (name !== tech.name)
                                    onChange({ name }); }, style: { ...inputStyle, fontWeight: 600, fontSize: '15px' } }), _jsxs("p", { style: { fontSize: '12px', color: '#6b7280', marginTop: '4px' }, children: ["ID: ", tech.id] })] }), _jsxs("label", { style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', whiteSpace: 'nowrap' }, children: [_jsx("input", { type: "checkbox", checked: tech.isRBT, onChange: (e) => onChange({ isRBT: e.target.checked }), style: { cursor: 'pointer', width: '18px', height: '18px' } }), _jsx("span", { children: "RBT" })] }), _jsx("button", { onClick: () => setEditing(!editing), style: chipBtn, children: editing ? 'Done' : 'Edit availability' }), _jsx("button", { onClick: onRemove, style: dangerBtn, children: "Remove" })] }), saving && _jsx("p", { style: { fontSize: '11px', color: '#3b82f6' }, children: "Saving\u2026" }), !editing ? (_jsx(AvailabilitySummary, { windows: tech.availability })) : (_jsx(AvailabilityEditor, { initial: tech.availability, onSave: (av) => { onChange({ availability: av }); setEditing(false); }, onCancel: () => setEditing(false) })), tech.assignments && tech.assignments.length > 0 && (_jsxs("div", { style: { fontSize: '13px', color: '#6b7280', marginTop: '8px' }, children: [_jsx("p", { style: { marginBottom: '4px', fontWeight: '600' }, children: "Assignments:" }), tech.assignments.map((a, idx) => (_jsxs("p", { children: ["\u2022 ", a.clientId || '(unassigned)', ": ", a.hoursPerWeek, "h/week"] }, idx)))] }))] }));
}
function AvailabilitySummary({ windows }) {
    const entries = Object.entries(windows || {}).filter(([, w]) => w && w.length > 0);
    if (entries.length === 0) {
        return _jsx("p", { style: { fontSize: '13px', color: '#6b7280', fontStyle: 'italic' }, children: "No availability set." });
    }
    return (_jsx("div", { style: { fontSize: '13px', color: '#6b7280' }, children: entries.map(([day, w]) => (_jsxs("p", { children: [day, ": ", w.map(x => `${x.start}–${x.end}`).join(', ')] }, day))) }));
}
function AvailabilityEditor({ initial, onSave, onCancel }) {
    const [draft, setDraft] = useState(initial || {});
    const setDayWindow = (day, idx, field, value) => {
        const next = { ...draft };
        const list = (next[day] || []).slice();
        list[idx] = { ...list[idx], [field]: value };
        next[day] = list;
        setDraft(next);
    };
    const addWindow = (day) => {
        const next = { ...draft };
        next[day] = [...(next[day] || []), { start: '09:00', end: '17:00' }];
        setDraft(next);
    };
    const removeWindow = (day, idx) => {
        const next = { ...draft };
        next[day] = (next[day] || []).filter((_, i) => i !== idx);
        if ((next[day] || []).length === 0)
            delete next[day];
        setDraft(next);
    };
    return (_jsxs("div", { style: { display: 'grid', gap: '8px', marginTop: '8px' }, children: [DAYS.map(day => (_jsxs("div", { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }, children: [_jsx("span", { style: { width: '40px', fontSize: '12px', fontWeight: 600 }, children: day.slice(0, 3) }), (draft[day] || []).map((w, idx) => (_jsxs("span", { style: { display: 'inline-flex', gap: '4px', alignItems: 'center' }, children: [_jsx("input", { type: "time", value: w.start, onChange: (e) => setDayWindow(day, idx, 'start', e.target.value), style: { fontSize: '12px' } }), _jsx("span", { children: "\u2013" }), _jsx("input", { type: "time", value: w.end, onChange: (e) => setDayWindow(day, idx, 'end', e.target.value), style: { fontSize: '12px' } }), _jsx("button", { onClick: () => removeWindow(day, idx), style: { ...dangerBtn, padding: '2px 6px', fontSize: '10px' }, children: "\u00D7" })] }, idx))), _jsx("button", { onClick: () => addWindow(day), style: { ...chipBtn, padding: '2px 8px', fontSize: '11px' }, children: "+ window" })] }, day))), _jsxs("div", { style: { display: 'flex', gap: '8px' }, children: [_jsx("button", { onClick: () => onSave(draft), style: primaryBtn, children: "Save" }), _jsx("button", { onClick: onCancel, style: chipBtn, children: "Cancel" })] })] }));
}
function ClientCard({ client, saving, onChange, onRemove }) {
    const [name, setName] = useState(client.name);
    const [maxStr, setMaxStr] = useState(client.parentTrainingMaxHours !== undefined ? String(client.parentTrainingMaxHours) : '');
    const [editing, setEditing] = useState(false);
    const commitMax = () => {
        const next = maxStr === '' ? undefined : parseFloat(maxStr);
        if (next !== client.parentTrainingMaxHours) {
            onChange({ parentTrainingMaxHours: Number.isFinite(next) ? next : undefined });
        }
    };
    return (_jsxs("div", { style: cardStyle, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '12px', gap: '8px', flexWrap: 'wrap' }, children: [_jsx("div", { style: { flex: '1 1 200px', minWidth: 0 }, children: _jsx("input", { value: name, onChange: (e) => setName(e.target.value), onBlur: () => { if (name !== client.name)
                                onChange({ name }); }, style: { ...inputStyle, fontWeight: 600, fontSize: '15px' } }) }), _jsx("button", { onClick: () => setEditing(!editing), style: chipBtn, children: editing ? 'Done' : 'Edit availability' }), _jsx("button", { onClick: onRemove, style: dangerBtn, children: "Remove" })] }), saving && _jsx("p", { style: { fontSize: '11px', color: '#3b82f6' }, children: "Saving\u2026" }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }, children: [_jsx("label", { style: { fontSize: '12px', color: '#374151', whiteSpace: 'nowrap' }, children: "Parent-training max:" }), _jsx("input", { type: "number", step: "0.5", min: "0", value: maxStr, onChange: (e) => setMaxStr(e.target.value), onBlur: commitMax, placeholder: "\u2014", style: { ...inputStyle, width: '90px' } }), _jsx("span", { style: { fontSize: '11px', color: '#6b7280' }, children: "h per case-period" })] }), !editing ? (_jsx(AvailabilitySummary, { windows: client.availabilityWindows })) : (_jsx(AvailabilityEditor, { initial: client.availabilityWindows || {}, onSave: (av) => { onChange({ availabilityWindows: av }); setEditing(false); }, onCancel: () => setEditing(false) }))] }));
}
function SettingRow({ label, value }) {
    return (_jsxs("div", { children: [_jsx("p", { style: { fontSize: '13px', fontWeight: '600', marginBottom: '4px' }, children: label }), _jsx("p", { style: { color: '#6b7280' }, children: value })] }));
}
const cardStyle = {
    backgroundColor: '#f9f9f9',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    padding: '16px',
};
const inputStyle = {
    padding: '6px 10px',
    border: '1px solid #d1d5db',
    borderRadius: '4px',
    fontSize: '13px',
    width: '100%',
    boxSizing: 'border-box',
};
const primaryBtn = {
    padding: '6px 12px',
    backgroundColor: '#3b82f6',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '13px',
};
const dangerBtn = {
    padding: '6px 10px',
    backgroundColor: '#fee2e2',
    color: '#dc2626',
    border: '1px solid #fca5a5',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '13px',
};
const chipBtn = {
    padding: '4px 10px',
    fontSize: '12px',
    border: '1px solid #d1d5db',
    borderRadius: '4px',
    background: 'white',
    cursor: 'pointer',
    color: '#374151',
};
//# sourceMappingURL=AdminPanel.js.map