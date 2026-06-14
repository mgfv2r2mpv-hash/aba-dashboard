import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from 'react';
const BADGE = {
    green: { color: '#16a34a', symbol: '✔' },
    yellow: { color: '#f59e0b', symbol: '!' },
    red: { color: '#dc2626', symbol: '✕' },
};
function opLabel(op, base) {
    const fmt = (iso) => {
        if (!iso)
            return '';
        const d = new Date(iso);
        return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    };
    const titleOf = (id) => base.appointments.find(a => a.id === id)?.title || op.appt?.title || 'session';
    switch (op.kind) {
        case 'add': return `Add ${op.appt?.title || op.appt?.client || 'session'} · ${fmt(op.appt?.startTime)}`;
        case 'move': return `Move ${op.appt?.title || titleOf(op.targetId)} → ${fmt(op.appt?.startTime)}`;
        case 'shorten': return `Shorten ${op.appt?.title || titleOf(op.targetId)}`;
        case 'remove': return `Remove ${titleOf(op.targetId)}`;
    }
}
export default function DraftTray({ base, ops, status, hasApiKey, onResetOp, onResetAll, onCancel, onAccept, onSaveAnyway, onAI, onPickChoice, onLogGhosts, aiLoading, }) {
    const badge = BADGE[status.grade];
    const acceptEnabled = status.grade === 'green' || (status.grade === 'yellow' && !status.needsChoice);
    const aiEnabled = status.aiEligible && hasApiKey && !aiLoading;
    const canLogGhosts = status.grade === 'red' && ops.some(o => o.kind === 'add');
    return (_jsxs("div", { style: {
            borderTop: '2px solid #e5e7eb', background: '#ffffff',
            padding: '12px', display: 'flex', flexDirection: 'column', gap: 10,
        }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 10 }, children: [_jsx("span", { style: {
                            width: 22, height: 22, borderRadius: '50%', background: badge.color, color: 'white',
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 13, fontWeight: 800, flexShrink: 0,
                        }, children: badge.symbol }), _jsx("span", { style: { fontSize: 13, fontWeight: 600, color: '#374151' }, children: status.label }), _jsxs("span", { style: { marginLeft: 'auto', fontSize: 12, color: '#6b7280' }, children: [ops.length, " change", ops.length === 1 ? '' : 's'] })] }), _jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: 4 }, children: ops.map(op => (_jsxs("div", { style: {
                        display: 'flex', alignItems: 'center', gap: 8,
                        fontSize: 12, color: '#374151',
                        background: '#f9fafb', border: '1px solid #f3f4f6', borderRadius: 4, padding: '5px 8px',
                    }, children: [_jsx("span", { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: opLabel(op, base) }), _jsx("button", { onClick: () => onResetOp(op.id), "aria-label": "Reset this change", style: { background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 2 }, children: "\u2715" })] }, op.id))) }), status.movedIds.length > 0 && (_jsxs("div", { style: { fontSize: 11, color: '#6b7280' }, children: ["Accepting also moves ", status.movedIds.length, " other session", status.movedIds.length === 1 ? '' : 's', " to fit."] })), status.choices.length > 0 && (_jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: 4 }, children: [_jsx("div", { style: { fontSize: 11, fontWeight: 600, color: '#92400e' }, children: "Pick one to resolve:" }), status.choices.map(ch => (_jsx("button", { onClick: () => onPickChoice(ch), style: {
                            textAlign: 'left', fontSize: 12, padding: '6px 8px',
                            background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 4,
                            color: '#92400e', cursor: 'pointer',
                        }, children: ch.label }, ch.appointmentId + ch.kind)))] })), _jsxs("div", { style: { display: 'flex', gap: 6, flexWrap: 'wrap' }, children: [_jsx("button", { onClick: onAccept, disabled: !acceptEnabled, style: {
                            flex: '1 1 auto', padding: '8px 12px', borderRadius: 5, border: 'none', fontSize: 13, fontWeight: 600,
                            cursor: acceptEnabled ? 'pointer' : 'not-allowed',
                            background: acceptEnabled ? '#16a34a' : '#e5e7eb',
                            color: acceptEnabled ? 'white' : '#9ca3af',
                        }, children: "Accept" }), _jsx("button", { onClick: onAI, disabled: !aiEnabled, title: !hasApiKey ? 'Add a Claude API key in Settings' : status.aiEligible ? 'Find a solution with AI' : 'Available when there is no in-week solution', style: {
                            flex: '0 0 auto', padding: '8px 12px', borderRadius: 5, border: 'none', fontSize: 13, fontWeight: 600,
                            cursor: aiEnabled ? 'pointer' : 'not-allowed',
                            background: aiEnabled ? '#6366f1' : '#e5e7eb',
                            color: aiEnabled ? 'white' : '#9ca3af',
                        }, children: aiLoading ? '…' : 'AI' }), status.grade !== 'green' && (_jsx("button", { onClick: onSaveAnyway, style: {
                            flex: '0 0 auto', padding: '8px 12px', borderRadius: 5, fontSize: 13, fontWeight: 600,
                            background: 'white', color: '#b45309', border: '1px solid #fcd34d', cursor: 'pointer',
                        }, children: "Save anyway" })), canLogGhosts && (_jsx("button", { onClick: onLogGhosts, title: "Keep the requested session as a ghost reminder", style: {
                            flex: '0 0 auto', padding: '8px 12px', borderRadius: 5, fontSize: 13,
                            background: 'white', color: '#6b7280', border: '1px solid #d1d5db', cursor: 'pointer',
                        }, children: "Log as ghost" })), _jsx("button", { onClick: onResetAll, style: {
                            flex: '0 0 auto', padding: '8px 12px', borderRadius: 5, fontSize: 13,
                            background: 'white', color: '#6b7280', border: '1px solid #d1d5db', cursor: 'pointer',
                        }, children: "Reset" }), _jsx("button", { onClick: onCancel, style: {
                            flex: '0 0 auto', padding: '8px 12px', borderRadius: 5, fontSize: 13,
                            background: 'white', color: '#6b7280', border: '1px solid #d1d5db', cursor: 'pointer',
                        }, children: "Cancel" })] })] }));
}
//# sourceMappingURL=DraftTray.js.map