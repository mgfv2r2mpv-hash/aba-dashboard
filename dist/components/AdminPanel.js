import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
export default function AdminPanel({ data }) {
    const [activeTab, setActiveTab] = useState('technicians');
    const [editingTech, setEditingTech] = useState(null);
    const [editingClient, setEditingClient] = useState(null);
    const handleTechnicianRBTChange = (tech, isRBT) => {
        setEditingTech({ ...tech, isRBT });
    };
    const handleClientAvailabilityChange = (client, day, start, end) => {
        const updated = { ...client };
        updated.availabilityWindows = { ...updated.availabilityWindows };
        updated.availabilityWindows[day] = [{ start, end }];
        setEditingClient(updated);
    };
    const tabStyle = (isActive) => ({
        padding: '12px 16px',
        backgroundColor: isActive ? '#ffffff' : '#f3f4f6',
        border: isActive ? '2px solid #3b82f6' : '1px solid #e5e7eb',
        borderBottom: 'none',
        cursor: 'pointer',
        fontWeight: isActive ? '600' : 'normal',
    });
    return (_jsxs("div", { style: { flex: 1, display: 'flex', flexDirection: 'column' }, children: [_jsxs("div", { style: { display: 'flex', borderBottom: '1px solid #e5e7eb', backgroundColor: '#f9f9f9' }, children: [_jsx("button", { onClick: () => setActiveTab('technicians'), style: tabStyle(activeTab === 'technicians'), children: "Technicians" }), _jsx("button", { onClick: () => setActiveTab('clients'), style: tabStyle(activeTab === 'clients'), children: "Clients" }), _jsx("button", { onClick: () => setActiveTab('settings'), style: tabStyle(activeTab === 'settings'), children: "Settings" })] }), _jsxs("div", { style: { flex: 1, overflow: 'auto', padding: '24px' }, children: [activeTab === 'technicians' && (_jsxs("div", { children: [_jsx("h3", { style: { marginBottom: '16px', fontSize: '18px', fontWeight: 'bold' }, children: "Manage Technicians" }), _jsx("div", { style: { display: 'grid', gap: '16px' }, children: data.technicians.map(tech => (_jsxs("div", { style: {
                                        backgroundColor: '#f9f9f9',
                                        border: '1px solid #e5e7eb',
                                        borderRadius: '8px',
                                        padding: '16px',
                                    }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '12px' }, children: [_jsxs("div", { children: [_jsx("h4", { style: { marginBottom: '4px', fontWeight: '600' }, children: tech.name }), _jsxs("p", { style: { fontSize: '13px', color: '#6b7280' }, children: ["ID: ", tech.id] })] }), _jsxs("label", { style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }, children: [_jsx("input", { type: "checkbox", checked: tech.isRBT, onChange: (e) => handleTechnicianRBTChange(tech, e.target.checked), style: { cursor: 'pointer', width: '18px', height: '18px' } }), _jsx("span", { children: "RBT Certified" })] })] }), tech.assignments && tech.assignments.length > 0 && (_jsxs("div", { style: { fontSize: '13px', color: '#6b7280' }, children: [_jsx("p", { style: { marginBottom: '4px', fontWeight: '600' }, children: "Assignments:" }), tech.assignments.map((assign, idx) => (_jsxs("p", { children: ["\u2022 ", assign.clientId, ": ", assign.hoursPerWeek, "h/week"] }, idx)))] }))] }, tech.id))) })] })), activeTab === 'clients' && (_jsxs("div", { children: [_jsx("h3", { style: { marginBottom: '16px', fontSize: '18px', fontWeight: 'bold' }, children: "Manage Clients" }), _jsx("div", { style: { display: 'grid', gap: '16px' }, children: data.clients.map(client => (_jsxs("div", { style: {
                                        backgroundColor: '#f9f9f9',
                                        border: '1px solid #e5e7eb',
                                        borderRadius: '8px',
                                        padding: '16px',
                                    }, children: [_jsx("h4", { style: { marginBottom: '12px', fontWeight: '600' }, children: client.name }), _jsxs("div", { style: { fontSize: '13px', color: '#6b7280' }, children: [_jsx("p", { style: { marginBottom: '8px', fontWeight: '600' }, children: "Availability:" }), Object.entries(client.availabilityWindows || {}).map(([day, windows]) => (windows && windows.length > 0 && (_jsxs("p", { children: [day, ": ", windows[0]?.start, " - ", windows[0]?.end] }, day))))] })] }, client.id))) })] })), activeTab === 'settings' && (_jsxs("div", { children: [_jsx("h3", { style: { marginBottom: '16px', fontSize: '18px', fontWeight: 'bold' }, children: "Company Settings" }), _jsxs("div", { style: {
                                    backgroundColor: '#f9f9f9',
                                    border: '1px solid #e5e7eb',
                                    borderRadius: '8px',
                                    padding: '16px',
                                    display: 'grid',
                                    gap: '16px',
                                }, children: [_jsxs("div", { children: [_jsx("p", { style: { fontSize: '13px', fontWeight: '600', marginBottom: '4px' }, children: "Supervision - Direct Hours" }), _jsxs("p", { style: { color: '#6b7280' }, children: [data.settings.supervisionDirectHoursPercent, "% of direct client hours"] })] }), _jsxs("div", { children: [_jsx("p", { style: { fontSize: '13px', fontWeight: '600', marginBottom: '4px' }, children: "Supervision - RBT Hours" }), _jsxs("p", { style: { color: '#6b7280' }, children: [data.settings.supervisionRBTHoursPercent, "% of RBT hours"] })] }), _jsxs("div", { children: [_jsx("p", { style: { fontSize: '13px', fontWeight: '600', marginBottom: '4px' }, children: "Parent Training" }), _jsxs("p", { style: { color: '#6b7280' }, children: ["Minimum: ", data.settings.parentTrainingHoursPerMonth.minimum, "h/month", _jsx("br", {}), "Target: ", data.settings.parentTrainingHoursPerMonth.target.min, "-", data.settings.parentTrainingHoursPerMonth.target.max, "h/month"] })] })] })] }))] })] }));
}
//# sourceMappingURL=AdminPanel.js.map