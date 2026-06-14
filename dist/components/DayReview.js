import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useState } from 'react';
import CompleteTimePrompt from './CompleteTimePrompt';
// End-of-day sweep: every past-dated session still marked "scheduled" gets a
// quick Complete / Cancel / Skip decision so actuals stay current without
// hunting through the calendar. Skip just hides the row for this sitting.
export default function DayReview({ appointments, onComplete, onRequestCancel, onClose }) {
    const [skipped, setSkipped] = useState(new Set());
    const visible = appointments.filter(a => !skipped.has(a.id));
    const skip = (id) => setSkipped(prev => new Set(prev).add(id));
    return (_jsx("div", { style: {
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 900,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 'max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left))',
            boxSizing: 'border-box',
        }, children: _jsxs("div", { style: {
                backgroundColor: 'white', borderRadius: 8, padding: 20,
                width: '100%', maxWidth: 560, maxHeight: '100%', overflowY: 'auto', boxSizing: 'border-box',
            }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }, children: [_jsx("h2", { style: { fontSize: 18, fontWeight: 700, margin: 0 }, children: "Day review" }), _jsx("button", { onClick: onClose, style: { background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }, children: "\u2715" })] }), _jsx("p", { style: { fontSize: 12, color: '#6b7280', marginBottom: 12 }, children: "Sessions up to now still marked scheduled. Complete or cancel each so this month's actuals are real; skip anything you're not sure about yet." }), visible.length === 0 ? (_jsx("p", { style: { color: '#15803d', fontWeight: 600, textAlign: 'center', padding: 16 }, children: "\u2713 All caught up." })) : (_jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: 8 }, children: visible.map(a => (_jsxs("div", { style: {
                            border: '1px solid #e5e7eb', borderRadius: 6, padding: '10px 12px',
                            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                        }, children: [_jsxs("div", { style: { flex: '1 1 200px', minWidth: 0 }, children: [_jsx("div", { style: { fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: a.title }), _jsxs("div", { style: { fontSize: 12, color: '#6b7280' }, children: [new Date(a.startTime).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }), ' → ', new Date(a.endTime).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }), a.technician ? ` · ${a.technician}` : '', a.client ? ` · ${a.client}` : ''] })] }), _jsxs("div", { style: { display: 'flex', gap: 6, flexWrap: 'wrap' }, children: [_jsx(CompleteTimePrompt, { a: a, onComplete: onComplete, flex: "0 0 auto" }, a.id), _jsx("button", { onClick: () => onRequestCancel(a), style: {
                                            padding: '6px 10px', backgroundColor: '#fee2e2', color: '#b91c1c',
                                            border: '1px solid #fca5a5', borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                                        }, children: "\u2715 Cancel" }), _jsx("button", { onClick: () => skip(a.id), style: {
                                            padding: '6px 10px', backgroundColor: 'white', color: '#6b7280',
                                            border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer', fontSize: 12,
                                        }, children: "Skip" })] })] }, a.id))) })), _jsx("div", { style: { display: 'flex', justifyContent: 'flex-end', marginTop: 16 }, children: _jsx("button", { onClick: onClose, style: {
                            padding: '8px 16px', border: '1px solid #d1d5db', borderRadius: 6,
                            background: 'white', cursor: 'pointer',
                        }, children: "Done" }) })] }) }));
}
//# sourceMappingURL=DayReview.js.map