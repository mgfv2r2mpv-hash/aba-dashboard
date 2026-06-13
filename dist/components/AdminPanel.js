import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useEffect } from 'react';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { AUTH_BUCKETS, SUPERVISION_CADENCES } from '../types';
import { computeAuthUsage, computeReportDates } from '../authorization';
import { PRESET_WINDOWS, PRESET_LABELS, isPresetActive, togglePreset } from '../availabilityUtils';
import { resolveUtilization } from '../utilization';
const API_BASE = '/api';
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export default function AdminPanel({ data, onDataChange, onImportFile, onRerunWizard }) {
    const [activeTab, setActiveTab] = useState('technicians');
    const [savingId, setSavingId] = useState(null);
    const [error, setError] = useState(null);
    const [reordering, setReordering] = useState(null);
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
    const addBlackout = async (blackout) => {
        setSavingId(blackout.id);
        setError(null);
        try {
            const res = await axios.post(`${API_BASE}/admin/blackout`, blackout);
            const saved = res.data.blackout || blackout;
            onDataChange({ ...data, blackouts: [...(data.blackouts || []), saved] });
        }
        catch (e) {
            setError(e.response?.data?.error || e.message);
        }
        finally {
            setSavingId(null);
        }
    };
    const removeBlackout = async (id) => {
        setSavingId(id);
        setError(null);
        try {
            await axios.delete(`${API_BASE}/admin/blackout/${id}`);
            onDataChange({ ...data, blackouts: (data.blackouts || []).filter(b => b.id !== id) });
        }
        catch (e) {
            setError(e.response?.data?.error || e.message);
        }
        finally {
            setSavingId(null);
        }
    };
    const persistSettings = async (next) => {
        setSavingId('settings');
        setError(null);
        try {
            const res = await axios.post(`${API_BASE}/admin/settings`, next);
            onDataChange({ ...data, settings: res.data.settings });
        }
        catch (e) {
            setError(e.response?.data?.error || e.message);
        }
        finally {
            setSavingId(null);
        }
    };
    const upsertAuth = async (auth) => {
        setSavingId(auth.id);
        setError(null);
        try {
            const res = await axios.post(`${API_BASE}/admin/authorization`, auth);
            const saved = res.data.authorization || auth;
            const list = data.authorizations || [];
            const next = list.some(a => a.id === saved.id)
                ? list.map(a => a.id === saved.id ? saved : a)
                : [...list, saved];
            onDataChange({ ...data, authorizations: next });
        }
        catch (e) {
            setError(e.response?.data?.error || e.message);
        }
        finally {
            setSavingId(null);
        }
    };
    const removeAuth = async (id) => {
        if (!confirm('Remove this authorization? Manual hour entries are kept.'))
            return;
        setSavingId(id);
        setError(null);
        try {
            await axios.delete(`${API_BASE}/admin/authorization/${id}`);
            onDataChange({ ...data, authorizations: (data.authorizations || []).filter(a => a.id !== id) });
        }
        catch (e) {
            setError(e.response?.data?.error || e.message);
        }
        finally {
            setSavingId(null);
        }
    };
    const upsertUsage = async (usage) => {
        setSavingId(usage.id);
        setError(null);
        try {
            const res = await axios.post(`${API_BASE}/admin/manual-usage`, usage);
            const saved = res.data.usage || usage;
            const list = data.manualUsage || [];
            const next = list.some(u => u.id === saved.id)
                ? list.map(u => u.id === saved.id ? saved : u)
                : [...list, saved];
            onDataChange({ ...data, manualUsage: next });
        }
        catch (e) {
            setError(e.response?.data?.error || e.message);
        }
        finally {
            setSavingId(null);
        }
    };
    const removeUsage = async (id) => {
        setSavingId(id);
        setError(null);
        try {
            await axios.delete(`${API_BASE}/admin/manual-usage/${id}`);
            onDataChange({ ...data, manualUsage: (data.manualUsage || []).filter(u => u.id !== id) });
        }
        catch (e) {
            setError(e.response?.data?.error || e.message);
        }
        finally {
            setSavingId(null);
        }
    };
    const reorderEntity = async (entity, orderedIds) => {
        setError(null);
        try {
            await axios.post(`${API_BASE}/admin/reorder`, { entity, order: orderedIds });
            const list = entity === 'clients' ? data.clients : data.technicians;
            const byId = new Map(list.map(x => [x.id, x]));
            const reordered = orderedIds.map(id => byId.get(id)).filter(Boolean);
            onDataChange({ ...data, [entity]: reordered });
        }
        catch (e) {
            setError(e.response?.data?.error || e.message);
        }
    };
    const sortEntityByName = (entity, dir) => {
        const list = entity === 'clients' ? data.clients : data.technicians;
        const ordered = [...list].sort((a, b) => dir === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name));
        reorderEntity(entity, ordered.map(x => x.id));
    };
    const tabStyle = (isActive) => ({
        padding: '12px 16px',
        backgroundColor: isActive ? '#ffffff' : '#f3f4f6',
        border: isActive ? '2px solid #3b82f6' : '1px solid #e5e7eb',
        borderBottom: 'none',
        cursor: 'pointer',
        fontWeight: isActive ? '600' : 'normal',
    });
    return (_jsxs("div", { style: { flex: 1, display: 'flex', flexDirection: 'column' }, children: [_jsxs("div", { style: { display: 'flex', borderBottom: '1px solid #e5e7eb', backgroundColor: '#f9f9f9' }, children: [_jsx("button", { onClick: () => setActiveTab('technicians'), style: tabStyle(activeTab === 'technicians'), children: "Technicians" }), _jsx("button", { onClick: () => setActiveTab('clients'), style: tabStyle(activeTab === 'clients'), children: "Clients" }), _jsx("button", { onClick: () => setActiveTab('auths'), style: tabStyle(activeTab === 'auths'), children: "Auths" }), _jsx("button", { onClick: () => setActiveTab('blackouts'), style: tabStyle(activeTab === 'blackouts'), children: "Blackouts" }), _jsx("button", { onClick: () => setActiveTab('settings'), style: tabStyle(activeTab === 'settings'), children: "Settings" })] }), error && (_jsx("div", { style: { padding: '8px 16px', backgroundColor: '#fee2e2', color: '#991b1b', fontSize: '13px' }, children: error })), _jsxs("div", { style: { flex: 1, overflow: 'auto', padding: '24px' }, children: [activeTab === 'technicians' && (_jsxs("div", { children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', gap: 8 }, children: [_jsxs("h3", { style: { fontSize: '18px', fontWeight: 'bold' }, children: ["Manage Technicians (", data.technicians.length, ")"] }), _jsxs("div", { style: { display: 'flex', gap: 8, alignItems: 'center' }, children: [data.technicians.length > 1 && (_jsx(SortMenu, { onSortAsc: () => sortEntityByName('technicians', 'asc'), onSortDesc: () => sortEntityByName('technicians', 'desc'), onReorder: () => setReordering('technicians') })), _jsx("button", { onClick: addTechnician, style: primaryBtn, children: "+ Add Technician" })] })] }), reordering === 'technicians' ? (_jsx(ReorderList, { items: data.technicians.map(t => ({ id: t.id, name: t.name, meta: t.isRBT ? 'RBT' : undefined })), onCommit: (ids) => { reorderEntity('technicians', ids); setReordering(null); }, onCancel: () => setReordering(null) })) : (_jsxs("div", { style: { display: 'grid', gap: '16px' }, children: [data.technicians.map(tech => (_jsx(TechnicianCard, { tech: tech, clients: data.clients, saving: savingId === tech.id, onChange: (patch) => persistTechnician(tech.id, patch), onRemove: () => removeTechnician(tech.id) }, tech.id))), data.technicians.length === 0 && (_jsx("p", { style: { color: '#9ca3af', textAlign: 'center', padding: '20px' }, children: "No technicians yet." }))] }))] })), activeTab === 'clients' && (_jsxs("div", { children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', gap: 8 }, children: [_jsxs("h3", { style: { fontSize: '18px', fontWeight: 'bold' }, children: ["Manage Clients (", data.clients.length, ")"] }), _jsxs("div", { style: { display: 'flex', gap: 8, alignItems: 'center' }, children: [data.clients.length > 1 && (_jsx(SortMenu, { onSortAsc: () => sortEntityByName('clients', 'asc'), onSortDesc: () => sortEntityByName('clients', 'desc'), onReorder: () => setReordering('clients') })), _jsx("button", { onClick: addClient, style: primaryBtn, children: "+ Add Client" })] })] }), reordering === 'clients' ? (_jsx(ReorderList, { items: data.clients.map(c => ({ id: c.id, name: c.name })), onCommit: (ids) => { reorderEntity('clients', ids); setReordering(null); }, onCancel: () => setReordering(null) })) : (_jsxs("div", { style: { display: 'grid', gap: '16px' }, children: [data.clients.map(client => (_jsx(ClientCard, { client: client, saving: savingId === client.id, onChange: (patch) => persistClient(client.id, patch), onRemove: () => removeClient(client.id) }, client.id))), data.clients.length === 0 && (_jsx("p", { style: { color: '#9ca3af', textAlign: 'center', padding: '20px' }, children: "No clients yet." }))] }))] })), activeTab === 'auths' && (_jsx(AuthsTab, { data: data, savingId: savingId, onUpsertAuth: upsertAuth, onRemoveAuth: removeAuth, onUpsertUsage: upsertUsage, onRemoveUsage: removeUsage })), activeTab === 'blackouts' && (_jsx(BlackoutsTab, { blackouts: data.blackouts || [], technicians: data.technicians, clients: data.clients, savingId: savingId, onAdd: addBlackout, onRemove: removeBlackout })), activeTab === 'settings' && (_jsx(SettingsEditor, { settings: data.settings, saving: savingId === 'settings', onSave: persistSettings, onImportFile: onImportFile, onRerunWizard: onRerunWizard }))] })] }));
}
function TechnicianCard({ tech, clients, saving, onChange, onRemove }) {
    const [name, setName] = useState(tech.name);
    const [editing, setEditing] = useState(false);
    const [collapsed, setCollapsed] = useState(true);
    const [hoursDraft, setHoursDraft] = useState({});
    const assignments = tech.assignments || [];
    const safeClients = clients || [];
    const updateAssignment = (idx, patch) => {
        const next = assignments.map((a, i) => i === idx ? { ...a, ...patch } : a);
        onChange({ assignments: next });
    };
    const addAssignment = () => {
        onChange({ assignments: [...assignments, { clientId: '', hoursPerWeek: 0, billable: true }] });
    };
    const removeAssignment = (idx) => {
        onChange({ assignments: assignments.filter((_, i) => i !== idx) });
        setHoursDraft(prev => {
            const next = { ...prev };
            delete next[idx];
            return next;
        });
    };
    const commitHours = (idx, raw) => {
        const parsed = parseFloat(raw);
        const hours = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
        if (hours !== assignments[idx]?.hoursPerWeek)
            updateAssignment(idx, { hoursPerWeek: hours });
        setHoursDraft(prev => {
            const next = { ...prev };
            delete next[idx];
            return next;
        });
    };
    const availDays = Object.values(tech.availability || {}).filter(w => w && w.length > 0).length;
    return (_jsxs("div", { style: cardStyle, children: [_jsx(CardHeader, { collapsed: collapsed, onToggle: () => setCollapsed(c => !c), name: tech.name, badges: tech.isRBT ? ['RBT'] : [], summary: `${availDays} day${availDays === 1 ? '' : 's'} avail · ${assignments.length} assignment${assignments.length === 1 ? '' : 's'}` }), !collapsed && (_jsxs(_Fragment, { children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'start', margin: '12px 0', gap: '8px', flexWrap: 'wrap' }, children: [_jsxs("div", { style: { flex: '1 1 200px', minWidth: 0 }, children: [_jsx("input", { value: name, onChange: (e) => setName(e.target.value), onBlur: () => { if (name !== tech.name)
                                            onChange({ name }); }, style: { ...inputStyle, fontWeight: 600, fontSize: '15px' } }), _jsxs("p", { style: { fontSize: '12px', color: '#6b7280', marginTop: '4px' }, children: ["ID: ", tech.id] })] }), _jsxs("label", { style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', whiteSpace: 'nowrap' }, children: [_jsx("input", { type: "checkbox", checked: tech.isRBT, onChange: (e) => onChange({ isRBT: e.target.checked }), style: { cursor: 'pointer', width: '18px', height: '18px' } }), _jsx("span", { children: "RBT" })] }), _jsx("button", { onClick: () => setEditing(!editing), style: chipBtn, children: editing ? 'Done' : 'Edit availability' }), _jsx("button", { onClick: onRemove, style: dangerBtn, children: "Remove" })] }), saving && _jsx("p", { style: { fontSize: '11px', color: '#3b82f6' }, children: "Saving\u2026" }), !editing ? (_jsx(AvailabilitySummary, { windows: tech.availability })) : (_jsx(AvailabilityEditor, { initial: tech.availability, onSave: (av) => { onChange({ availability: av }); setEditing(false); }, onCancel: () => setEditing(false) })), _jsxs("div", { style: { marginTop: '12px' }, children: [_jsx("p", { style: { fontWeight: 600, fontSize: '13px', marginBottom: '6px' }, children: "Assignments" }), assignments.length > 0 && (_jsxs("div", { style: { display: 'flex', gap: '6px', marginBottom: '4px' }, children: [_jsx("div", { style: { flex: 2, fontSize: '11px', color: '#6b7280', fontWeight: 600, minWidth: 0 }, children: "Client" }), _jsx("div", { style: { flex: 1, fontSize: '11px', color: '#6b7280', fontWeight: 600, minWidth: 0 }, children: "Hrs/wk" }), _jsx("div", { style: { width: '32px', flexShrink: 0 } })] })), assignments.map((a, idx) => (_jsxs("div", { style: { display: 'flex', gap: '6px', marginBottom: '6px', alignItems: 'center' }, children: [_jsxs("select", { value: a.clientId, onChange: (e) => updateAssignment(idx, { clientId: e.target.value }), style: { ...inputStyle, flex: 2, width: 'auto', minWidth: 0 }, children: [_jsx("option", { value: "", children: "\u2014 Pick client \u2014" }), safeClients.map(c => _jsx("option", { value: c.name, children: c.name }, c.id))] }), _jsx("input", { type: "number", step: "0.5", min: "0", value: hoursDraft[idx] ?? String(a.hoursPerWeek), onChange: (e) => setHoursDraft({ ...hoursDraft, [idx]: e.target.value }), onBlur: (e) => commitHours(idx, e.target.value), style: { ...inputStyle, flex: 1, width: 'auto', minWidth: 0 } }), _jsx("button", { onClick: () => removeAssignment(idx), style: {
                                            width: '32px', height: '32px', padding: 0, backgroundColor: '#fee2e2', color: '#dc2626',
                                            border: '1px solid #fca5a5', borderRadius: '4px', cursor: 'pointer', flexShrink: 0,
                                            fontSize: '18px', lineHeight: 1,
                                        }, "aria-label": "Remove assignment", children: "\u00D7" })] }, idx))), _jsx("button", { onClick: addAssignment, style: {
                                    padding: '6px 12px', fontSize: '13px', backgroundColor: 'white', color: '#3b82f6',
                                    border: '1px solid #3b82f6', borderRadius: '4px', cursor: 'pointer',
                                }, children: "+ Assignment" })] })] }))] }));
}
function CardHeader({ collapsed, onToggle, name, badges, summary }) {
    return (_jsxs("div", { onClick: onToggle, style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', minWidth: 0 }, children: [_jsx("span", { style: { fontSize: '12px', color: '#6b7280', width: '12px', flexShrink: 0 }, children: collapsed ? '▸' : '▾' }), _jsx("span", { style: { fontWeight: 600, fontSize: '15px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }, children: name || 'Unnamed' }), badges.map(b => (_jsx("span", { style: {
                    fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', padding: '1px 6px',
                    borderRadius: '8px', backgroundColor: '#dbeafe', color: '#1e40af', flexShrink: 0,
                }, children: b }, b))), collapsed && (_jsx("span", { style: { fontSize: '12px', color: '#6b7280', marginLeft: 'auto', whiteSpace: 'nowrap', flexShrink: 0 }, children: summary }))] }));
}
function SortMenu({ onSortAsc, onSortDesc, onReorder }) {
    const [open, setOpen] = useState(false);
    return (_jsxs("div", { style: { position: 'relative' }, children: [_jsx("button", { onClick: () => setOpen(o => !o), "aria-label": "Sort and reorder", title: "Sort / reorder", style: { ...chipBtn, fontSize: '15px', lineHeight: 1, padding: '5px 9px' }, children: "\u2699" }), open && (_jsxs(_Fragment, { children: [_jsx("div", { onClick: () => setOpen(false), style: { position: 'fixed', inset: 0, zIndex: 19 } }), _jsxs("div", { style: {
                            position: 'absolute', right: 0, top: '110%', zIndex: 20, background: 'white',
                            border: '1px solid #e5e7eb', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                            minWidth: 170, overflow: 'hidden',
                        }, children: [_jsx(MenuItem, { onClick: () => { setOpen(false); onSortAsc(); }, children: "Sort name A \u2192 Z" }), _jsx(MenuItem, { onClick: () => { setOpen(false); onSortDesc(); }, children: "Sort name Z \u2192 A" }), _jsx(MenuItem, { onClick: () => { setOpen(false); onReorder(); }, children: "Drag to reorder\u2026" })] })] }))] }));
}
function MenuItem({ onClick, children }) {
    return (_jsx("button", { onClick: onClick, style: {
            display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px',
            border: 'none', borderBottom: '1px solid #f3f4f6', background: 'white',
            cursor: 'pointer', fontSize: '13px', color: '#374151',
        }, children: children }));
}
// Touch-friendly drag-to-reorder list (pointer events, works on iOS). Renders a
// compact row per item with a ≡ handle; commits the final id order on Done.
function ReorderList({ items, onCommit, onCancel }) {
    const [order, setOrder] = useState(items);
    const [dragId, setDragId] = useState(null);
    useEffect(() => {
        if (!dragId)
            return;
        const onMove = (e) => {
            const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-rid]');
            const overId = el?.dataset.rid;
            if (!overId || overId === dragId)
                return;
            setOrder(prev => {
                const from = prev.findIndex(i => i.id === dragId);
                const to = prev.findIndex(i => i.id === overId);
                if (from < 0 || to < 0 || from === to)
                    return prev;
                const next = [...prev];
                const [moved] = next.splice(from, 1);
                next.splice(to, 0, moved);
                return next;
            });
        };
        const onUp = () => setDragId(null);
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
        return () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);
        };
    }, [dragId]);
    return (_jsxs("div", { children: [_jsxs("div", { style: { display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }, children: [_jsx("button", { onClick: () => onCommit(order.map(i => i.id)), style: primaryBtn, children: "Done" }), _jsx("button", { onClick: onCancel, style: chipBtn, children: "Cancel" }), _jsx("span", { style: { fontSize: 12, color: '#6b7280' }, children: "Drag the \u2261 handle to reorder" })] }), _jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: 6 }, children: order.map(it => (_jsxs("div", { "data-rid": it.id, style: {
                        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                        border: '1px solid #e5e7eb', borderRadius: 6,
                        background: dragId === it.id ? '#eff6ff' : 'white',
                        boxShadow: dragId === it.id ? '0 2px 8px rgba(0,0,0,0.12)' : 'none',
                        // Row stays scrollable on touch; only the ≡ handle suppresses
                        // scrolling so vertical drags reorder instead of pan.
                    }, children: [_jsx("span", { onPointerDown: (e) => { e.preventDefault(); setDragId(it.id); }, "aria-label": "Drag to reorder", style: { cursor: 'grab', fontSize: 20, color: '#9ca3af', touchAction: 'none', userSelect: 'none', lineHeight: 1 }, children: "\u2261" }), _jsx("span", { style: { fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: it.name || 'Unnamed' }), it.meta && (_jsx("span", { style: {
                                fontSize: 10, fontWeight: 700, textTransform: 'uppercase', padding: '1px 6px',
                                borderRadius: 8, backgroundColor: '#dbeafe', color: '#1e40af',
                            }, children: it.meta }))] }, it.id))) })] }));
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
    const clearDay = (day) => {
        const next = { ...draft };
        delete next[day];
        setDraft(next);
    };
    const copyMondayToWeekdays = () => {
        const monWindows = draft['Monday'] || [];
        const next = { ...draft };
        ['Tuesday', 'Wednesday', 'Thursday', 'Friday'].forEach(d => {
            if (monWindows.length === 0)
                delete next[d];
            else
                next[d] = monWindows.map(w => ({ ...w }));
        });
        setDraft(next);
    };
    const clearAll = () => setDraft({});
    const handleTogglePreset = (key) => {
        const preset = PRESET_WINDOWS[key];
        const active = isPresetActive(draft, preset);
        setDraft(togglePreset(draft, preset, !active));
    };
    return (_jsxs("div", { style: { width: '100%', overflowX: 'hidden', marginTop: '8px' }, children: [_jsxs("div", { style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px', alignItems: 'center' }, children: [Object.keys(PRESET_WINDOWS).map(key => (_jsxs("label", { style: { display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', cursor: 'pointer', userSelect: 'none' }, children: [_jsx("input", { type: "checkbox", checked: isPresetActive(draft, PRESET_WINDOWS[key]), onChange: () => handleTogglePreset(key), style: { cursor: 'pointer' } }), PRESET_LABELS[key]] }, key))), _jsx("button", { onClick: copyMondayToWeekdays, style: chipBtn, children: "Copy Mon \u2192 Tue\u2013Fri" }), _jsx("button", { onClick: clearAll, style: { ...chipBtn, color: '#dc2626', borderColor: '#fca5a5' }, children: "Clear all" })] }), _jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: '4px' }, children: DAYS.map((day, dayIdx) => {
                    const windows = draft[day] || [];
                    return (_jsxs("div", { style: {
                            display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap',
                            padding: '6px 8px', borderRadius: '4px',
                            background: dayIdx % 2 === 0 ? '#f9fafb' : 'white',
                            border: '1px solid #e5e7eb',
                            boxSizing: 'border-box', width: '100%', minWidth: 0,
                        }, children: [_jsx("span", { style: { width: '36px', flexShrink: 0, fontSize: '13px', fontWeight: 600 }, children: day.slice(0, 3) }), windows.length === 0 ? (_jsx("span", { style: { fontSize: '12px', color: '#9ca3af', fontStyle: 'italic' }, children: "Off" })) : (windows.map((w, idx) => (_jsxs("span", { style: { display: 'inline-flex', gap: '3px', alignItems: 'center' }, children: [_jsx("input", { type: "time", step: "900", value: w.start, onChange: (e) => setDayWindow(day, idx, 'start', e.target.value), style: editTimeInput }), _jsx("span", { style: { fontSize: '12px', color: '#6b7280' }, children: "\u2013" }), _jsx("input", { type: "time", step: "900", value: w.end, onChange: (e) => setDayWindow(day, idx, 'end', e.target.value), style: editTimeInput }), _jsx("button", { onClick: () => removeWindow(day, idx), style: { ...dangerBtn, padding: '2px 6px', fontSize: '11px' }, title: "Remove this window", children: "\u00D7" })] }, idx)))), _jsx("button", { onClick: () => addWindow(day), style: { ...chipBtn, padding: '2px 8px', fontSize: '11px' }, children: "+ window" }), windows.length > 0 && (_jsx("button", { onClick: () => clearDay(day), style: { ...chipBtn, fontSize: '11px', padding: '2px 8px', marginLeft: 'auto' }, title: `Clear ${day}`, children: "Off" }))] }, day));
                }) }), _jsxs("div", { style: { display: 'flex', gap: '8px', marginTop: '8px' }, children: [_jsx("button", { onClick: () => onSave(draft), style: primaryBtn, children: "Save" }), _jsx("button", { onClick: onCancel, style: chipBtn, children: "Cancel" })] })] }));
}
function ClientCard({ client, saving, onChange, onRemove }) {
    const [name, setName] = useState(client.name);
    const [maxStr, setMaxStr] = useState(client.parentTrainingMaxHours !== undefined ? String(client.parentTrainingMaxHours) : '');
    const [editing, setEditing] = useState(false);
    const [collapsed, setCollapsed] = useState(true);
    const commitMax = () => {
        const next = maxStr === '' ? undefined : parseFloat(maxStr);
        if (next !== client.parentTrainingMaxHours) {
            onChange({ parentTrainingMaxHours: Number.isFinite(next) ? next : undefined });
        }
    };
    const availDays = Object.values(client.availabilityWindows || {}).filter(w => w && w.length > 0).length;
    const ptMax = client.parentTrainingMaxHours;
    return (_jsxs("div", { style: cardStyle, children: [_jsx(CardHeader, { collapsed: collapsed, onToggle: () => setCollapsed(c => !c), name: client.name, badges: [], summary: `${availDays} day${availDays === 1 ? '' : 's'} avail${ptMax !== undefined ? ` · PT max ${ptMax}h` : ''}` }), !collapsed && (_jsxs(_Fragment, { children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'start', margin: '12px 0', gap: '8px', flexWrap: 'wrap' }, children: [_jsx("div", { style: { flex: '1 1 200px', minWidth: 0 }, children: _jsx("input", { value: name, onChange: (e) => setName(e.target.value), onBlur: () => { if (name !== client.name)
                                        onChange({ name }); }, style: { ...inputStyle, fontWeight: 600, fontSize: '15px' } }) }), _jsx("button", { onClick: () => setEditing(!editing), style: chipBtn, children: editing ? 'Done' : 'Edit availability' }), _jsx("button", { onClick: onRemove, style: dangerBtn, children: "Remove" })] }), saving && _jsx("p", { style: { fontSize: '11px', color: '#3b82f6' }, children: "Saving\u2026" }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }, children: [_jsx("label", { style: { fontSize: '12px', color: '#374151', whiteSpace: 'nowrap' }, children: "Parent-training max:" }), _jsx("input", { type: "number", step: "0.5", min: "0", value: maxStr, onChange: (e) => setMaxStr(e.target.value), onBlur: commitMax, placeholder: "\u2014", style: { ...inputStyle, width: '90px' } }), _jsx("span", { style: { fontSize: '11px', color: '#6b7280' }, children: "h per case-period" })] }), _jsxs("div", { style: { display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10, fontSize: 12, color: '#374151' }, children: [_jsxs("label", { style: { display: 'flex', alignItems: 'center', gap: 4 }, children: [_jsx("span", { children: "Supervision cadence:" }), _jsxs("select", { value: client.cadenceGoal || '', onChange: e => onChange({ cadenceGoal: (e.target.value || undefined) }), style: { ...inputStyle, width: 'auto' }, children: [_jsx("option", { value: "", children: "\u2014" }), SUPERVISION_CADENCES.map(c => _jsxs("option", { value: c.value, children: [c.value, " \u00B7 ", c.label] }, c.value))] })] }), _jsxs("label", { style: { display: 'flex', alignItems: 'center', gap: 4 }, title: "When OFF, parent training must coincide with a direct session.", children: [_jsx("input", { type: "checkbox", checked: client.parentAvailableOutsideSessions === true, onChange: e => onChange({ parentAvailableOutsideSessions: e.target.checked || undefined }) }), _jsx("span", { children: "Parent available outside sessions" })] }), _jsxs("label", { style: { display: 'flex', alignItems: 'center', gap: 4 }, title: "When OFF, the engine won't propose partial-staff coverage.", children: [_jsx("input", { type: "checkbox", checked: client.partialStaffAllowed !== false, onChange: e => onChange({ partialStaffAllowed: e.target.checked ? undefined : false }) }), _jsx("span", { children: "Partial staff allowed" })] }), _jsxs("label", { style: { display: 'flex', alignItems: 'center', gap: 4 }, children: [_jsx("input", { type: "checkbox", checked: client.isEI === true, onChange: e => onChange({ isEI: e.target.checked || undefined }) }), _jsx("span", { children: "EI case" })] }), client.isEI && (_jsxs("label", { style: { display: 'flex', alignItems: 'center', gap: 4 }, children: [_jsx("span", { children: "EI date:" }), _jsx("input", { type: "date", value: client.eiDate || '', onChange: e => onChange({ eiDate: e.target.value || undefined }), style: { ...inputStyle, width: 140 } })] })), _jsxs("label", { style: { display: 'flex', alignItems: 'center', gap: 4, flex: '1 1 180px' }, children: [_jsx("span", { style: { whiteSpace: 'nowrap' }, children: "Anticipated discharge:" }), _jsx("input", { value: client.anticipatedDischarge || '', onBlur: e => { if ((e.target.value || undefined) !== client.anticipatedDischarge)
                                            onChange({ anticipatedDischarge: e.target.value || undefined }); }, defaultValue: client.anticipatedDischarge || '', placeholder: "date / note", style: { ...inputStyle, flex: 1, minWidth: 0 } })] })] }), !editing ? (_jsx(AvailabilitySummary, { windows: client.availabilityWindows })) : (_jsx(AvailabilityEditor, { initial: client.availabilityWindows || {}, onSave: (av) => { onChange({ availabilityWindows: av }); setEditing(false); }, onCancel: () => setEditing(false) }))] }))] }));
}
function AuthsTab({ data, savingId, onUpsertAuth, onRemoveAuth, onUpsertUsage, onRemoveUsage }) {
    const auths = data.authorizations || [];
    const addAuthFor = (clientId) => {
        const start = todayStr();
        const end = new Date();
        end.setMonth(end.getMonth() + 6);
        onUpsertAuth({
            id: uuidv4(),
            clientId,
            startDate: start,
            endDate: `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`,
            buckets: {},
        });
    };
    return (_jsxs("div", { children: [_jsx("h3", { style: { marginBottom: '16px', fontSize: '18px', fontWeight: 'bold' }, children: "Authorizations" }), _jsxs("div", { style: { display: 'grid', gap: '16px' }, children: [data.clients.map(client => {
                        const clientAuths = auths.filter(a => a.clientId === client.id);
                        return (_jsxs("div", { style: cardStyle, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }, children: [_jsx("span", { style: { fontWeight: 600, fontSize: '15px' }, children: client.name }), _jsx("button", { onClick: () => addAuthFor(client.id), style: chipBtn, children: "+ Add authorization" })] }), clientAuths.length === 0 ? (_jsx("p", { style: { fontSize: '12px', color: '#9ca3af', fontStyle: 'italic', marginTop: 8 }, children: "No authorization on file." })) : [...clientAuths]
                                    .sort((a, b) => b.startDate.localeCompare(a.startDate))
                                    .map(auth => (_jsx(AuthRow, { data: data, auth: auth, saving: savingId === auth.id, onChange: (patch) => onUpsertAuth({ ...auth, ...patch }), onRemove: () => onRemoveAuth(auth.id), onUpsertUsage: onUpsertUsage, onRemoveUsage: onRemoveUsage }, auth.id)))] }, client.id));
                    }), data.clients.length === 0 && (_jsx("p", { style: { color: '#9ca3af', textAlign: 'center', padding: '20px' }, children: "No clients yet." }))] })] }));
}
// Collapsible summary row. Collapsed by default: shows label/date-range, the
// end-cliff date, and days-until-end. Expands to the full AuthCard editor.
function AuthRow(props) {
    const { data, auth } = props;
    const [collapsed, setCollapsed] = useState(true);
    const usage = computeAuthUsage(data, auth, new Date());
    const cliffColor = usage.daysLeft < 0 ? '#9ca3af' : usage.daysLeft <= 21 ? '#b91c1c' : usage.daysLeft <= 45 ? '#b45309' : '#15803d';
    const title = auth.label || `${auth.startDate} to ${auth.endDate}`;
    return (_jsxs("div", { style: { marginTop: 10, border: '1px solid #e5e7eb', borderRadius: 6, background: 'white' }, children: [_jsxs("div", { onClick: () => setCollapsed(c => !c), style: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', cursor: 'pointer', flexWrap: 'wrap' }, children: [_jsx("span", { style: { fontSize: 12, color: '#6b7280', width: 12, flexShrink: 0 }, children: collapsed ? '▸' : '▾' }), _jsx("span", { style: { fontWeight: 600, fontSize: 13, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: title }), _jsxs("span", { style: { fontSize: 12, color: '#6b7280', marginLeft: 'auto', whiteSpace: 'nowrap' }, children: ["ends ", auth.endDate] }), _jsx("span", { style: { fontSize: 12, fontWeight: 600, color: cliffColor, whiteSpace: 'nowrap' }, children: usage.daysLeft < 0 ? `expired ${-usage.daysLeft}d ago` : `${usage.daysLeft}d left` })] }), !collapsed && _jsx(AuthCard, { ...props })] }));
}
function AuthCard({ data, auth, saving, onChange, onRemove, onUpsertUsage, onRemoveUsage }) {
    const [label, setLabel] = useState(auth.label || '');
    const [bucketDrafts, setBucketDrafts] = useState({});
    // Manual entry add form
    const [mBucket, setMBucket] = useState('direct');
    const [mHours, setMHours] = useState('');
    const [mDate, setMDate] = useState(todayStr());
    const [mNote, setMNote] = useState('');
    const usage = computeAuthUsage(data, auth, new Date());
    const fmt = (n) => (Math.round(n * 10) / 10).toString();
    const cliffColor = usage.daysLeft < 0 ? '#9ca3af' : usage.daysLeft <= 21 ? '#b91c1c' : usage.daysLeft <= 45 ? '#b45309' : '#15803d';
    const commitBucket = (key, raw) => {
        const v = parseFloat(raw);
        const next = { ...auth.buckets };
        if (Number.isFinite(v) && v > 0)
            next[key] = v;
        else
            delete next[key];
        onChange({ buckets: next });
        setBucketDrafts(prev => ({ ...prev, [key]: undefined }));
    };
    const manualInSpan = (data.manualUsage || []).filter(u => u.clientId === auth.clientId && u.date >= auth.startDate && u.date <= auth.endDate);
    const addManual = () => {
        const h = parseFloat(mHours);
        if (!Number.isFinite(h) || h <= 0 || !mDate)
            return;
        onUpsertUsage({
            id: uuidv4(), clientId: auth.clientId, bucket: mBucket,
            hours: h, date: mDate, note: mNote.trim() || undefined,
        });
        setMHours('');
        setMNote('');
    };
    const reportDates = computeReportDates(auth, data.settings);
    return (_jsxs("div", { style: { padding: '0 12px 12px', borderTop: '1px solid #f3f4f6' }, children: [_jsxs("div", { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 10 }, children: [_jsxs("label", { style: { display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 140px', minWidth: 0 }, children: [_jsx("span", { style: { fontSize: 11, fontWeight: 600, color: '#374151' }, children: "Auth label / number" }), _jsx("input", { value: label, onChange: e => setLabel(e.target.value), onBlur: () => { if (label !== (auth.label || ''))
                                    onChange({ label: label || undefined }); }, placeholder: "optional", style: inputStyle })] }), _jsxs("label", { style: { display: 'flex', flexDirection: 'column', gap: 4, flex: '0 1 150px', minWidth: 120 }, children: [_jsx("span", { style: { fontSize: 11, fontWeight: 600, color: '#374151' }, children: "Start" }), _jsx("input", { type: "date", value: auth.startDate, onChange: e => onChange({ startDate: e.target.value }), style: inputStyle })] }), _jsxs("label", { style: { display: 'flex', flexDirection: 'column', gap: 4, flex: '0 1 150px', minWidth: 120 }, children: [_jsx("span", { style: { fontSize: 11, fontWeight: 600, color: '#374151' }, children: "End (cliff)" }), _jsx("input", { type: "date", value: auth.endDate, onChange: e => onChange({ endDate: e.target.value }), style: inputStyle })] })] }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }, children: [_jsx("p", { style: { fontSize: 12, fontWeight: 600, color: cliffColor, margin: 0 }, children: usage.daysLeft < 0 ? `Expired ${-usage.daysLeft} day(s) ago` : `${usage.daysLeft} day(s) until auth ends` }), _jsx("button", { onClick: onRemove, style: { ...dangerBtn, marginLeft: 'auto' }, children: "Remove" })] }), saving && _jsx("p", { style: { fontSize: 11, color: '#3b82f6' }, children: "Saving\u2026" }), _jsxs("div", { style: { marginTop: 8, paddingTop: 8, borderTop: '1px dashed #e5e7eb' }, children: [_jsxs("p", { style: { fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 6 }, children: ["Authorized weekly rates ", _jsx("span", { style: { fontWeight: 400, color: '#9ca3af' }, children: "(supervision cap \u2248 20% of direct)" })] }), _jsx("div", { style: { display: 'flex', gap: 8, flexWrap: 'wrap' }, children: [['direct', 'Direct'], ['supervision', 'Supervision'], ['parentTraining', 'Parent trng'], ['casePlanning', 'Case plan']].map(([key, lbl]) => (_jsxs("label", { style: { display: 'flex', flexDirection: 'column', gap: 2 }, children: [_jsxs("span", { style: { fontSize: 10, color: '#6b7280' }, children: [lbl, " h/wk"] }), _jsx("input", { type: "number", step: "0.5", min: "0", inputMode: "decimal", defaultValue: auth.weekly?.[key] !== undefined ? String(auth.weekly[key]) : '', onBlur: e => {
                                        const v = parseFloat(e.target.value);
                                        const next = { ...(auth.weekly || {}) };
                                        if (Number.isFinite(v) && v > 0)
                                            next[key] = v;
                                        else
                                            delete next[key];
                                        onChange({ weekly: Object.keys(next).length ? next : undefined });
                                    }, placeholder: "\u2014", style: { ...inputStyle, width: 64 } })] }, key))) }), _jsxs("div", { style: { display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 10 }, children: [_jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: 2 }, children: [_jsx("span", { style: { fontSize: 10, color: '#6b7280' }, children: "Initial draft due (internal)" }), _jsx("span", { style: { fontSize: 13, fontWeight: 600, color: '#374151' }, children: reportDates.initialDraftDue })] }), _jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: 2 }, children: [_jsx("span", { style: { fontSize: 10, color: '#6b7280' }, children: "Final draft due (internal)" }), _jsx("span", { style: { fontSize: 13, fontWeight: 600, color: '#374151' }, children: reportDates.finalDraftDue })] })] })] }), _jsx("div", { style: { marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }, children: AUTH_BUCKETS.map(({ key, label: bLabel }) => {
                    const b = usage.buckets.find(x => x.key === key).usage;
                    const over = b.authorized > 0 && b.remaining < -0.01;
                    const rowColor = over ? '#b91c1c' : '#374151';
                    return (_jsxs("div", { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }, children: [_jsx("span", { style: { flex: '1 1 150px', minWidth: 0, color: '#374151' }, children: bLabel }), _jsx("input", { type: "number", step: "0.5", min: "0", inputMode: "decimal", value: bucketDrafts[key] ?? (auth.buckets[key] !== undefined ? String(auth.buckets[key]) : ''), onChange: e => setBucketDrafts(prev => ({ ...prev, [key]: e.target.value })), onBlur: e => commitBucket(key, e.target.value), placeholder: "\u2014", style: { ...inputStyle, width: 70 } }), _jsx("span", { style: { color: rowColor, whiteSpace: 'nowrap' }, children: b.authorized > 0
                                    ? _jsxs(_Fragment, { children: ["used ", fmt(b.used), " \u00B7 sched ", fmt(b.scheduled), " \u00B7 ", _jsx("strong", { children: over ? `${fmt(-b.remaining)}h OVER` : `${fmt(b.remaining)}h left` })] })
                                    : _jsx("span", { style: { color: '#9ca3af' }, children: "not authorized" }) })] }, key));
                }) }), _jsxs("div", { style: { marginTop: 10, paddingTop: 8, borderTop: '1px dashed #e5e7eb' }, children: [_jsx("p", { style: { fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 6 }, children: "Prior hours used in auth (prior / outside SAssi, and not imported)" }), manualInSpan.map(u => (_jsxs("div", { style: { display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, marginBottom: 4, flexWrap: 'wrap' }, children: [_jsx("span", { style: { color: '#6b7280', whiteSpace: 'nowrap' }, children: u.date }), _jsxs("span", { style: { flex: '1 1 120px', minWidth: 0 }, children: [AUTH_BUCKETS.find(b => b.key === u.bucket)?.label || u.bucket, ": ", _jsxs("strong", { children: [u.hours, "h"] }), u.note ? _jsxs("span", { style: { color: '#9ca3af' }, children: [" \u00B7 ", u.note] }) : null] }), _jsx("button", { onClick: () => onRemoveUsage(u.id), style: { ...dangerBtn, padding: '2px 8px', fontSize: 11 }, children: "\u00D7" })] }, u.id))), _jsxs("div", { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }, children: [_jsx("select", { value: mBucket, onChange: e => setMBucket(e.target.value), style: { ...inputStyle, width: 'auto', flex: '1 1 130px', minWidth: 0 }, children: AUTH_BUCKETS.map(b => _jsx("option", { value: b.key, children: b.label }, b.key)) }), _jsx("input", { type: "number", step: "0.25", min: "0", placeholder: "hrs", value: mHours, onChange: e => setMHours(e.target.value), style: { ...inputStyle, width: 60 } }), _jsx("input", { type: "date", value: mDate, onChange: e => setMDate(e.target.value), style: { ...inputStyle, width: 130 } }), _jsx("input", { placeholder: "note (optional)", value: mNote, onChange: e => setMNote(e.target.value), style: { ...inputStyle, flex: '1 1 120px', minWidth: 0 } }), _jsx("button", { onClick: addManual, style: chipBtn, disabled: !mHours || !mDate, children: "+ Add" })] })] })] }));
}
function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// "2026-05-08" → "Thu, May 8, 2026" (parsed as a local day, no TZ shift).
function formatBlackoutDate(date) {
    const [y, m, d] = date.split('-').map(Number);
    if (!y || !m || !d)
        return date;
    return new Date(y, m - 1, d).toLocaleDateString(undefined, {
        weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
    });
}
function BlackoutsTab({ blackouts, technicians, clients, savingId, onAdd, onRemove }) {
    // entity picker value is "technician:<id>" / "client:<id>" so the two
    // namespaces can share one <select> without id collisions.
    const [entityKey, setEntityKey] = useState('');
    const [date, setDate] = useState(todayStr());
    const [reason, setReason] = useState('');
    const submit = () => {
        if (!entityKey || !date)
            return;
        const [entityType, entityId] = entityKey.split(':');
        const entityName = entityType === 'technician'
            ? technicians.find(t => t.id === entityId)?.name
            : clients.find(c => c.id === entityId)?.name;
        onAdd({
            id: uuidv4(),
            entityType,
            entityId,
            entityName,
            date,
            reason: reason.trim() || undefined,
            createdAt: new Date().toISOString(),
        });
        setReason('');
    };
    const today = todayStr();
    const sorted = [...blackouts].sort((a, b) => a.date.localeCompare(b.date));
    const upcoming = sorted.filter(b => b.date >= today);
    const past = sorted.filter(b => b.date < today).reverse();
    const nameFor = (b) => {
        const live = b.entityType === 'technician'
            ? technicians.find(t => t.id === b.entityId)?.name
            : clients.find(c => c.id === b.entityId)?.name;
        return live || b.entityName || b.entityId;
    };
    const renderRow = (b, dim) => (_jsxs("div", { style: {
            display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px',
            border: '1px solid #e5e7eb', borderRadius: '6px', backgroundColor: dim ? '#f9fafb' : 'white',
            opacity: dim ? 0.75 : 1, flexWrap: 'wrap',
        }, children: [_jsxs("div", { style: { flex: '1 1 200px', minWidth: 0 }, children: [_jsx("div", { style: { fontWeight: 600, fontSize: '14px', color: '#111827' }, children: formatBlackoutDate(b.date) }), _jsxs("div", { style: { fontSize: '13px', color: '#374151', marginTop: '2px' }, children: [_jsx("span", { style: {
                                    fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', padding: '1px 6px',
                                    borderRadius: '8px', marginRight: '6px',
                                    backgroundColor: b.entityType === 'technician' ? '#dbeafe' : '#fef3c7',
                                    color: b.entityType === 'technician' ? '#1e40af' : '#92400e',
                                }, children: b.entityType === 'technician' ? 'Staff' : 'Client' }), nameFor(b)] }), b.reason && (_jsx("div", { style: { fontSize: '12px', color: '#6b7280', marginTop: '2px', fontStyle: 'italic' }, children: b.reason }))] }), _jsx("button", { onClick: () => onRemove(b.id), style: dangerBtn, disabled: savingId === b.id, children: savingId === b.id ? '…' : 'Remove' })] }, b.id));
    return (_jsxs("div", { children: [_jsx("h3", { style: { marginBottom: '8px', fontSize: '18px', fontWeight: 'bold' }, children: "Blackout Days" }), _jsx("p", { style: { fontSize: '13px', color: '#6b7280', marginBottom: '16px' }, children: "Mark a staff member or client as away on a specific day (e.g. an appointment, PTO, travel). Sessions scheduled on a blackout day are flagged as conflicts, and the reason is kept here for review." }), _jsxs("div", { style: { ...cardStyle, marginBottom: '20px', display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'flex-end' }, children: [_jsxs("label", { style: { display: 'flex', flexDirection: 'column', gap: '4px', flex: '1 1 180px', minWidth: 0 }, children: [_jsx("span", { style: { fontSize: '12px', fontWeight: 600, color: '#374151' }, children: "Who" }), _jsxs("select", { value: entityKey, onChange: e => setEntityKey(e.target.value), style: inputStyle, children: [_jsx("option", { value: "", children: "\u2014 Pick staff or client \u2014" }), technicians.length > 0 && (_jsx("optgroup", { label: "Staff", children: technicians.map(t => _jsx("option", { value: `technician:${t.id}`, children: t.name }, t.id)) })), clients.length > 0 && (_jsx("optgroup", { label: "Clients", children: clients.map(c => _jsx("option", { value: `client:${c.id}`, children: c.name }, c.id)) }))] })] }), _jsxs("label", { style: { display: 'flex', flexDirection: 'column', gap: '4px', flex: '0 1 150px' }, children: [_jsx("span", { style: { fontSize: '12px', fontWeight: 600, color: '#374151' }, children: "Date" }), _jsx("input", { type: "date", value: date, onChange: e => setDate(e.target.value), style: inputStyle })] }), _jsxs("label", { style: { display: 'flex', flexDirection: 'column', gap: '4px', flex: '1 1 180px', minWidth: 0 }, children: [_jsx("span", { style: { fontSize: '12px', fontWeight: 600, color: '#374151' }, children: "Reason (optional)" }), _jsx("input", { type: "text", value: reason, onChange: e => setReason(e.target.value), placeholder: "e.g. dentist appointment", style: inputStyle, onKeyDown: e => { if (e.key === 'Enter')
                                    submit(); } })] }), _jsx("button", { onClick: submit, style: primaryBtn, disabled: !entityKey || !date, children: "+ Add blackout" })] }), blackouts.length === 0 ? (_jsx("p", { style: { color: '#9ca3af', textAlign: 'center', padding: '20px' }, children: "No blackout days recorded." })) : (_jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: '16px' }, children: [upcoming.length > 0 && (_jsxs("div", { children: [_jsxs("p", { style: { fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: '#6b7280', marginBottom: '8px' }, children: ["Upcoming (", upcoming.length, ")"] }), _jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: '8px' }, children: upcoming.map(b => renderRow(b, false)) })] })), past.length > 0 && (_jsxs("div", { children: [_jsxs("p", { style: { fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: '#6b7280', marginBottom: '8px' }, children: ["Past (", past.length, ")"] }), _jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: '8px' }, children: past.map(b => renderRow(b, true)) })] }))] }))] }));
}
function SettingsEditor({ settings, saving, onSave, onImportFile, onRerunWizard }) {
    const s = (n) => (n === undefined ? '' : String(n));
    const [directPct, setDirectPct] = useState(s(settings.supervisionDirectHoursPercent));
    const [rbtPct, setRbtPct] = useState(s(settings.supervisionRBTHoursPercent));
    const [techPct, setTechPct] = useState(s(settings.supervisionTechHoursPercent));
    const [maxPct, setMaxPct] = useState(s(settings.supervisionMaxHoursPercent));
    const [ptMin, setPtMin] = useState(s(settings.parentTraining.minimumHours));
    const [ptTargetMin, setPtTargetMin] = useState(s(settings.parentTraining.targetMinHours));
    const [ptTargetMax, setPtTargetMax] = useState(s(settings.parentTraining.targetMaxHours));
    const [periodUnit, setPeriodUnit] = useState(settings.parentTraining.periodUnit);
    const [unplannedHrs, setUnplannedHrs] = useState(s(settings.cancellationNotice?.unplannedHoursThreshold ?? 24));
    const [plannedDays, setPlannedDays] = useState(s(settings.cancellationNotice?.plannedDaysThreshold ?? 30));
    const u = resolveUtilization(settings.utilization);
    const [bcbaWeekly, setBcbaWeekly] = useState(s(u.bcbaWeeklyBillableHours));
    const [btWeekly, setBtWeekly] = useState(s(u.btWeeklyDirectHours));
    const [bcbaMonthly, setBcbaMonthly] = useState(s(u.bcbaMonthlyBillableHours));
    const [bcbaMonthly5, setBcbaMonthly5] = useState(s(u.bcbaMonthlyBillableHours5Week));
    const [minContacts, setMinContacts] = useState(s(settings.rbtMinContactsPerMonth ?? 2));
    const [floorPct, setFloorPct] = useState(s(settings.supervisionFloorPercent ?? 10));
    const [prefMinPct, setPrefMinPct] = useState(s(settings.supervisionPreferredMinPercent ?? 15));
    const [prefMaxPct, setPrefMaxPct] = useState(s(settings.supervisionPreferredMaxPercent ?? 20));
    const [draftLeadVal, setDraftLeadVal] = useState(s(settings.reportDraftLead?.value ?? 4));
    const [draftLeadUnit, setDraftLeadUnit] = useState(settings.reportDraftLead?.unit ?? 'weeks');
    const [finalLeadVal, setFinalLeadVal] = useState(s(settings.reportFinalLead?.value ?? 2));
    const [finalLeadUnit, setFinalLeadUnit] = useState(settings.reportFinalLead?.unit ?? 'weeks');
    const num = (str, fallback) => {
        const n = parseFloat(str);
        return Number.isFinite(n) ? n : fallback;
    };
    const optNum = (str) => {
        if (str.trim() === '')
            return undefined;
        const n = parseFloat(str);
        return Number.isFinite(n) ? n : undefined;
    };
    const save = () => {
        const next = {
            ...settings, // preserve clinicianAvailability + any legacy fields
            supervisionDirectHoursPercent: num(directPct, settings.supervisionDirectHoursPercent),
            supervisionRBTHoursPercent: num(rbtPct, settings.supervisionRBTHoursPercent),
            supervisionTechHoursPercent: optNum(techPct),
            supervisionMaxHoursPercent: optNum(maxPct),
            parentTraining: {
                minimumHours: num(ptMin, settings.parentTraining.minimumHours),
                targetMinHours: num(ptTargetMin, settings.parentTraining.targetMinHours),
                targetMaxHours: num(ptTargetMax, settings.parentTraining.targetMaxHours),
                periodUnit,
            },
            cancellationNotice: {
                unplannedHoursThreshold: num(unplannedHrs, 24),
                plannedDaysThreshold: num(plannedDays, 30),
            },
            utilization: {
                bcbaWeeklyBillableHours: num(bcbaWeekly, u.bcbaWeeklyBillableHours),
                btWeeklyDirectHours: num(btWeekly, u.btWeeklyDirectHours),
                bcbaMonthlyBillableHours: num(bcbaMonthly, u.bcbaMonthlyBillableHours),
                bcbaMonthlyBillableHours5Week: num(bcbaMonthly5, u.bcbaMonthlyBillableHours5Week),
            },
            rbtMinContactsPerMonth: num(minContacts, 2),
            supervisionFloorPercent: num(floorPct, 10),
            supervisionPreferredMinPercent: num(prefMinPct, 15),
            supervisionPreferredMaxPercent: num(prefMaxPct, 20),
            reportDraftLead: { value: num(draftLeadVal, 4), unit: draftLeadUnit },
            reportFinalLead: { value: num(finalLeadVal, 2), unit: finalLeadUnit },
        };
        onSave(next);
    };
    return (_jsxs("div", { style: { maxWidth: 640 }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', gap: 8, flexWrap: 'wrap' }, children: [_jsx("h3", { style: { fontSize: '18px', fontWeight: 'bold' }, children: "Company Settings" }), _jsx("button", { onClick: save, style: primaryBtn, disabled: saving, children: saving ? 'Saving…' : 'Save settings' })] }), _jsxs(SettingsSection, { title: "Supervision targets", children: [_jsx(NumField, { label: "Per-case (% of direct client hours)", value: directPct, onChange: setDirectPct, suffix: "%" }), _jsx(NumField, { label: "Per-RBT (% of that RBT's direct hours)", value: rbtPct, onChange: setRbtPct, suffix: "%", hint: "BACB floor is 5%." }), _jsx(NumField, { label: "Per non-RBT tech (% of hours, optional)", value: techPct, onChange: setTechPct, suffix: "%", placeholder: "\u2014" }), _jsx(NumField, { label: "RBT min supervision contact days per month", value: minContacts, onChange: setMinContacts, suffix: "days", hint: "BACB cadence: distinct days with observed supervision. Default 2." }), _jsx(NumField, { label: "Insurer cap on supervision:direct ratio (optional)", value: maxPct, onChange: setMaxPct, suffix: "%", placeholder: "\u2014", hint: "Over-cap ratios show as a warning; they don't change green/yellow/red status." })] }), _jsxs(SettingsSection, { title: "Correction engine supervision band", children: [_jsx(NumField, { label: "Floor (minimum % that must always be met)", value: floorPct, onChange: setFloorPct, suffix: "%", hint: "The engine never proposes shaving a case/BT below this. Default 10." }), _jsx(NumField, { label: "Preferred min (% the BCBA aims for)", value: prefMinPct, onChange: setPrefMinPct, suffix: "%", hint: "Default 15." }), _jsx(NumField, { label: "Preferred max / cap (% ceiling)", value: prefMaxPct, onChange: setPrefMaxPct, suffix: "%", hint: "Doubles as the cap when no insurer cap is set. Default 20." })] }), _jsxs(SettingsSection, { title: "Report due dates (before auth end)", children: [_jsx(LeadField, { label: "Initial draft due", value: draftLeadVal, unit: draftLeadUnit, onChangeValue: setDraftLeadVal, onChangeUnit: setDraftLeadUnit }), _jsx(LeadField, { label: "Final draft due", value: finalLeadVal, unit: finalLeadUnit, onChangeValue: setFinalLeadVal, onChangeUnit: setFinalLeadUnit })] }), _jsxs(SettingsSection, { title: "Parent training", children: [_jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: '4px' }, children: [_jsx("span", { style: { fontSize: '12px', fontWeight: 600, color: '#374151' }, children: "Period" }), _jsxs("select", { value: periodUnit, onChange: e => setPeriodUnit(e.target.value), style: inputStyle, children: [_jsx("option", { value: "week", children: "Per week" }), _jsx("option", { value: "month", children: "Per month" }), _jsx("option", { value: "sixMonths", children: "Per 6 months" }), _jsx("option", { value: "year", children: "Per year" })] })] }), _jsx(NumField, { label: `Minimum hours / ${periodUnit}`, value: ptMin, onChange: setPtMin, suffix: "h" }), _jsx(NumField, { label: `Target min hours / ${periodUnit}`, value: ptTargetMin, onChange: setPtTargetMin, suffix: "h" }), _jsx(NumField, { label: `Target max hours / ${periodUnit}`, value: ptTargetMax, onChange: setPtTargetMax, suffix: "h" })] }), _jsxs(SettingsSection, { title: "Cancellation notice thresholds", children: [_jsx(NumField, { label: "Unplanned: adequate notice if more than", value: unplannedHrs, onChange: setUnplannedHrs, suffix: "hours" }), _jsx(NumField, { label: "Planned: adequate notice if more than", value: plannedDays, onChange: setPlannedDays, suffix: "days" })] }), _jsxs(SettingsSection, { title: "Billable / utilization targets", children: [_jsx(NumField, { label: "BCBA fully-utilized weekly billables", value: bcbaWeekly, onChange: setBcbaWeekly, suffix: "h/wk" }), _jsx(NumField, { label: "BT fully-utilized weekly direct hours", value: btWeekly, onChange: setBtWeekly, suffix: "h/wk", hint: "Aggregate BT direct hours your caseload generates." }), _jsx(NumField, { label: "BCBA monthly goal (4-week month)", value: bcbaMonthly, onChange: setBcbaMonthly, suffix: "h/mo" }), _jsx(NumField, { label: "BCBA monthly goal (5-week month)", value: bcbaMonthly5, onChange: setBcbaMonthly5, suffix: "h/mo", hint: "Used when the month spans 5+ weeks." })] }), _jsx("p", { style: { fontSize: '12px', color: '#6b7280', marginTop: '4px' }, children: "Clinician availability is still configured in the Setup Wizard." }), (onImportFile || onRerunWizard) && (_jsxs(SettingsSection, { title: "Data", children: [_jsx("p", { style: { fontSize: '12px', color: '#6b7280', margin: 0 }, children: "Re-run the wizard to edit company settings, clients, and technicians (your appointments are kept), or load a different schedule file. Neither replaces your current data until you confirm." }), _jsxs("div", { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' }, children: [onRerunWizard && (_jsx("button", { onClick: onRerunWizard, style: {
                                    padding: '8px 14px', backgroundColor: '#8b5cf6', color: 'white',
                                    border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600,
                                }, children: "Re-run wizard" })), onImportFile && (_jsx("button", { onClick: onImportFile, style: {
                                    padding: '8px 14px', backgroundColor: '#3b82f6', color: 'white',
                                    border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600,
                                }, children: "Upload schedule\u2026" }))] })] }))] }));
}
function SettingsSection({ title, children }) {
    return (_jsxs("div", { style: { ...cardStyle, marginBottom: '16px' }, children: [_jsx("p", { style: { fontSize: '13px', fontWeight: 700, color: '#111827', marginBottom: '12px' }, children: title }), _jsx("div", { style: { display: 'grid', gap: '12px' }, children: children })] }));
}
function NumField({ label, value, onChange, suffix, hint, placeholder }) {
    return (_jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: '4px' }, children: [_jsx("span", { style: { fontSize: '12px', fontWeight: 600, color: '#374151' }, children: label }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: '8px' }, children: [_jsx("input", { type: "number", step: "0.5", min: "0", inputMode: "decimal", value: value, onChange: e => onChange(e.target.value), placeholder: placeholder, style: { ...inputStyle, width: '120px' } }), suffix && _jsx("span", { style: { fontSize: '12px', color: '#6b7280' }, children: suffix })] }), hint && _jsx("span", { style: { fontSize: '11px', color: '#9ca3af' }, children: hint })] }));
}
// A lead time before the auth end date: a number plus a days/weeks unit.
function LeadField({ label, value, unit, onChangeValue, onChangeUnit }) {
    return (_jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: '4px' }, children: [_jsx("span", { style: { fontSize: '12px', fontWeight: 600, color: '#374151' }, children: label }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: '8px' }, children: [_jsx("input", { type: "number", step: "1", min: "0", inputMode: "decimal", value: value, onChange: e => onChangeValue(e.target.value), style: { ...inputStyle, width: '80px' } }), _jsxs("select", { value: unit, onChange: e => onChangeUnit(e.target.value), style: { ...inputStyle, width: 'auto' }, children: [_jsx("option", { value: "weeks", children: "weeks" }), _jsx("option", { value: "days", children: "days" })] }), _jsx("span", { style: { fontSize: '12px', color: '#6b7280' }, children: "before auth end" })] })] }));
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
const editTimeInput = {
    fontSize: '13px',
    padding: '3px 6px',
    border: '1px solid #d1d5db',
    borderRadius: '4px',
    fontFamily: 'inherit',
    width: '75px',
    minWidth: 0,
};
//# sourceMappingURL=AdminPanel.js.map