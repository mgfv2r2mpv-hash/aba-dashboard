import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
// "16:30" → "4:30 PM". Availability windows and slot times are stored as 24h
// HH:MM; render them 12h to match the rest of the app's locale formatting.
function fmt12(hhmm) {
    const [hStr, mStr] = hhmm.split(':');
    const h = Number(hStr);
    const m = mStr ?? '00';
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${m} ${period}`;
}
function partyMark(status) {
    switch (status) {
        case 'ok': return { icon: '✓', color: '#15803d', label: 'available' };
        case 'outside': return { icon: '✗', color: '#dc2626', label: 'outside window' };
        case 'none': return { icon: '–', color: '#6b7280', label: 'no availability set' };
        case 'blackout': return { icon: '⛔', color: '#b91c1c', label: 'away (blackout)' };
    }
}
function windowsText(p) {
    if (p.status === 'blackout')
        return p.blackoutReason ? `Away — ${p.blackoutReason}` : 'Away (blackout)';
    if (!p.windows || p.windows.length === 0)
        return 'No windows this day';
    return p.windows.map(w => `${fmt12(w.start)} – ${fmt12(w.end)}`).join(', ');
}
export default function ConflictPanel({ conflicts, appointments = [], onSelectAppointment }) {
    const errorCount = conflicts.filter(c => c.severity === 'error').length;
    const warningCount = conflicts.filter(c => c.severity === 'warning').length;
    const getIcon = (severity) => {
        switch (severity) {
            case 'error':
                return '❌';
            case 'warning':
                return '⚠️';
            default:
                return 'ℹ️';
        }
    };
    const getSeverityColor = (severity) => {
        switch (severity) {
            case 'error':
                return '#dc2626';
            case 'warning':
                return '#f59e0b';
            default:
                return '#3b82f6';
        }
    };
    return (_jsxs("div", { style: { padding: '16px', borderBottom: '1px solid #e5e7eb' }, children: [_jsxs("h3", { style: { marginBottom: '12px', display: 'flex', gap: '8px', alignItems: 'center' }, children: ["Issues Found", errorCount > 0 && _jsxs("span", { style: { color: '#dc2626', fontWeight: 'bold' }, children: ["(", errorCount, " errors)"] }), warningCount > 0 && _jsxs("span", { style: { color: '#f59e0b', fontWeight: 'bold' }, children: ["(", warningCount, " warnings)"] })] }), _jsx("div", { style: { maxHeight: '300px', overflowY: 'auto' }, children: conflicts.map((conflict, idx) => {
                    const affectedAppts = (conflict.affectedAppointments || [])
                        .map(id => appointments.find(a => a.id === id))
                        .filter((a) => Boolean(a));
                    return (_jsxs("div", { style: {
                            padding: '12px',
                            marginBottom: '8px',
                            backgroundColor: conflict.severity === 'error' ? '#fee2e2' : '#fef3c7',
                            border: `1px solid ${getSeverityColor(conflict.severity)}`,
                            borderRadius: '6px',
                            fontSize: '12px',
                        }, children: [_jsxs("div", { style: { marginBottom: '4px', fontWeight: 'bold', display: 'flex', gap: '4px' }, children: [_jsx("span", { children: getIcon(conflict.severity) }), _jsx("span", { children: conflict.type })] }), _jsx("p", { style: { color: '#374151' }, children: conflict.message }), conflict.availabilityDetail && (() => {
                                const d = conflict.availabilityDetail;
                                return (_jsxs("div", { style: {
                                        marginTop: 8, padding: '8px 10px', backgroundColor: 'rgba(255,255,255,0.7)',
                                        border: '1px solid #e5e7eb', borderRadius: 5,
                                    }, children: [_jsxs("div", { style: { fontWeight: 600, color: '#374151', marginBottom: 6 }, children: [d.day, " \u00B7 ", fmt12(d.start), " \u2013 ", fmt12(d.end)] }), _jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: 5 }, children: d.parties.map((p, i) => {
                                                const mark = partyMark(p.status);
                                                return (_jsxs("div", { style: { display: 'flex', gap: 6, alignItems: 'baseline' }, children: [_jsx("span", { style: { color: mark.color, fontWeight: 700, width: 14, flexShrink: 0, textAlign: 'center' }, children: mark.icon }), _jsxs("div", { style: { minWidth: 0 }, children: [_jsxs("div", { style: { color: '#374151' }, children: [_jsx("strong", { children: p.name }), _jsxs("span", { style: { color: '#9ca3af' }, children: [" \u00B7 ", p.role] })] }), _jsx("div", { style: { color: mark.color }, children: windowsText(p) })] })] }, i));
                                            }) })] }));
                            })(), affectedAppts.length > 0 && (_jsx("div", { style: { marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }, children: affectedAppts.map(a => (_jsxs("button", { onClick: () => onSelectAppointment?.(a), style: {
                                        textAlign: 'left', background: 'transparent', border: 'none',
                                        padding: 0, color: '#1d4ed8', cursor: 'pointer',
                                        fontSize: 12, textDecoration: 'underline',
                                    }, children: ["\u2192 ", a.title, " (", new Date(a.startTime).toLocaleString(), ")"] }, a.id))) }))] }, idx));
                }) })] }));
}
//# sourceMappingURL=ConflictPanel.js.map