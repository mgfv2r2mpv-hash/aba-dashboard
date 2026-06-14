import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React from 'react';
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
export function conflictKey(c) {
    const appts = (c.affectedAppointments || []).join(',');
    const date = c.availabilityDetail?.date || '';
    return `${c.type}|${c.severity}|${appts}|${date}|${c.message}`;
}
// Human-readable title derived from conflict type + message content.
export function conflictTitle(c) {
    const msg = c.message.toLowerCase();
    switch (c.type) {
        case 'availability-conflict':
            return 'Availability Conflict';
        case 'training-violation':
            if (msg.includes('below') || msg.includes('minimum') || msg.includes('too low') || msg.includes('under'))
                return 'PT Below Minimum';
            if (msg.includes('above') || msg.includes('maximum') || msg.includes('exceeds') || msg.includes('over'))
                return 'PT Over Maximum';
            return 'Parent Training Issue';
        case 'supervision-violation':
            if (msg.includes('contact') || msg.includes('count'))
                return 'Supervision Contact Shortfall';
            if (msg.includes('percent') || msg.includes('%'))
                return 'Supervision % Gap';
            return 'Supervision Gap';
        case 'scheduling-impossible':
            if (msg.includes('no bt') || msg.includes('not assigned') || msg.includes('unstaff'))
                return 'No BT Assigned';
            if (msg.includes('utilization') || msg.includes('below') && msg.includes('%'))
                return 'Below Targeted Utilization';
            if (msg.includes('authorization') && (msg.includes('over') || msg.includes('exceed')))
                return 'Over Authorization';
            if (msg.includes('billable') && msg.includes('minimum'))
                return 'Below Billable Minimum';
            if (msg.includes('reassessment'))
                return 'Reassessment Pacing';
            if (msg.includes('double') || msg.includes('concurrent'))
                return 'Concurrent Booking';
            return 'Scheduling Issue';
        default:
            return c.type.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }
}
// Per-type ordering weight for sorting within a severity bucket.
function typeWeight(c) {
    switch (c.type) {
        case 'availability-conflict': return 0;
        case 'supervision-violation': return 1;
        case 'training-violation': return 2;
        case 'scheduling-impossible': {
            const msg = c.message.toLowerCase();
            if (msg.includes('no bt') || msg.includes('unstaff'))
                return 4;
            return 3;
        }
        default: return 5;
    }
}
function severityWeight(c) {
    switch (c.severity) {
        case 'error': return 0;
        case 'warning': return 1;
        default: return 2;
    }
}
function sortConflicts(cs) {
    return [...cs].sort((a, b) => {
        const sw = severityWeight(a) - severityWeight(b);
        if (sw !== 0)
            return sw;
        const tw = typeWeight(a) - typeWeight(b);
        if (tw !== 0)
            return tw;
        // More affected appointments = larger problem = first
        return (b.affectedAppointments?.length ?? 0) - (a.affectedAppointments?.length ?? 0);
    });
}
// Background color for each conflict type / sub-type.
function cardBackground(c) {
    if (c.type === 'training-violation') {
        const msg = c.message.toLowerCase();
        if (msg.includes('below') || msg.includes('minimum') || msg.includes('too low') || msg.includes('under'))
            return '#fff7ed'; // light orange for PT below minimum
        return '#fee2e2'; // light red for PT over maximum
    }
    if (c.severity === 'error')
        return '#fee2e2';
    if (c.severity === 'warning')
        return '#fef3c7';
    // Info — check sub-type
    const msg = c.message.toLowerCase();
    if (msg.includes('no bt') || msg.includes('unstaff'))
        return '#fefce8'; // light yellow
    return '#eff6ff'; // default info: light blue
}
export default function ConflictPanel({ conflicts, appointments = [], onSelectAppointment, fill, mutedKeys, onMute, onUnmute, onConfirmDismiss }) {
    const [showMuted, setShowMuted] = React.useState(false);
    const muted = new Set(mutedKeys || []);
    const active = sortConflicts(conflicts.filter(c => !muted.has(conflictKey(c))));
    const mutedConflicts = conflicts.filter(c => muted.has(conflictKey(c)));
    const errorCount = active.filter(c => c.severity === 'error').length;
    const warningCount = active.filter(c => c.severity === 'warning').length;
    const getIcon = (severity) => {
        switch (severity) {
            case 'error': return '❌';
            case 'warning': return '⚠️';
            default: return 'ℹ️';
        }
    };
    const getSeverityColor = (severity) => {
        switch (severity) {
            case 'error': return '#dc2626';
            case 'warning': return '#f59e0b';
            default: return '#3b82f6';
        }
    };
    const renderCard = (conflict, idx, isMuted) => {
        const key = conflictKey(conflict);
        const title = conflictTitle(conflict);
        const bg = cardBackground(conflict);
        const affectedAppts = (conflict.affectedAppointments || [])
            .map(id => appointments.find(a => a.id === id))
            .filter((a) => Boolean(a));
        const canDismiss = !!onConfirmDismiss && conflict.severity !== 'error';
        return (_jsxs("div", { style: {
                padding: '12px',
                marginBottom: '8px',
                backgroundColor: bg,
                border: `1px solid ${getSeverityColor(conflict.severity)}`,
                borderRadius: '6px',
                fontSize: '12px',
                opacity: isMuted ? 0.7 : 1,
            }, children: [_jsxs("div", { style: { marginBottom: '4px', fontWeight: 'bold', display: 'flex', gap: '6px', alignItems: 'center' }, children: [_jsx("span", { children: getIcon(conflict.severity) }), _jsx("span", { style: { color: '#1f2937' }, children: title })] }), _jsx("p", { style: { color: '#374151', margin: '4px 0' }, children: conflict.message }), conflict.availabilityDetail && (() => {
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
                        }, children: ["\u2192 ", a.title, " (", new Date(a.startTime).toLocaleString(), ")"] }, a.id))) })), (onMute || onUnmute || canDismiss) && (_jsx("div", { style: { marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }, children: isMuted
                        ? (onUnmute && _jsx("button", { onClick: () => onUnmute(key), style: actionBtn, children: "Unmute" }))
                        : (_jsxs(_Fragment, { children: [canDismiss && _jsx("button", { onClick: () => onConfirmDismiss(key), style: confirmBtn, children: "\u2713 Confirm & Dismiss" }), onMute && _jsx("button", { onClick: () => onMute(key), style: actionBtn, children: "\uD83D\uDD07 Mute" })] })) }))] }, idx));
    };
    return (_jsxs("div", { style: {
            padding: '16px', boxSizing: 'border-box',
            ...(fill ? { minHeight: '100%' } : { borderBottom: '1px solid #e5e7eb' }),
        }, children: [_jsxs("h3", { style: { marginBottom: '12px', display: 'flex', gap: '8px', alignItems: 'center' }, children: ["Issues Found", errorCount > 0 && _jsxs("span", { style: { color: '#dc2626', fontWeight: 'bold' }, children: ["(", errorCount, " error", errorCount !== 1 ? 's' : '', ")"] }), warningCount > 0 && _jsxs("span", { style: { color: '#f59e0b', fontWeight: 'bold' }, children: ["(", warningCount, " warning", warningCount !== 1 ? 's' : '', ")"] })] }), _jsxs("div", { children: [active.length === 0 && mutedConflicts.length > 0 && (_jsx("p", { style: { color: '#6b7280', fontSize: 12, margin: '0 0 8px' }, children: "No active issues \u2014 all muted below." })), active.map((conflict, idx) => renderCard(conflict, idx, false))] }), mutedConflicts.length > 0 && (_jsxs("div", { style: { marginTop: 8, borderTop: '1px dashed #d1d5db', paddingTop: 8 }, children: [_jsxs("button", { onClick: () => setShowMuted(s => !s), style: {
                            background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                            fontSize: 12, fontWeight: 700, color: '#6b7280',
                            display: 'flex', alignItems: 'center', gap: 6,
                        }, children: [_jsxs("span", { children: ["\uD83D\uDD07 Muted (", mutedConflicts.length, ")"] }), _jsx("span", { children: showMuted ? '▾' : '▸' })] }), showMuted && (_jsx("div", { style: { marginTop: 8 }, children: mutedConflicts.map((conflict, idx) => renderCard(conflict, idx, true)) }))] }))] }));
}
const actionBtn = {
    padding: '4px 10px', background: 'white', color: '#374151',
    border: '1px solid #d1d5db', borderRadius: 5, cursor: 'pointer', fontSize: 12, fontWeight: 600,
};
const confirmBtn = {
    padding: '4px 10px', background: '#dcfce7', color: '#15803d',
    border: '1px solid #86efac', borderRadius: 5, cursor: 'pointer', fontSize: 12, fontWeight: 600,
};
//# sourceMappingURL=ConflictPanel.js.map