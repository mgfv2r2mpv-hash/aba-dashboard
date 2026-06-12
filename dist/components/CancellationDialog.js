import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { CANCELLATION_SOURCES, CANCELLATION_REASONS, DEFAULT_CANCELLATION_NOTICE, } from '../types';
// For client-session/internal-task: BCBA isn't a participant, so don't offer
// Cancel-BCBA. For everything else (supervision, parent-training, other) all
// four sources are valid. The data model holds all four either way; the UI
// just hides the irrelevant option.
function applicableSources(apptType) {
    if (apptType === 'client-session' || apptType === 'internal-task') {
        return CANCELLATION_SOURCES.filter(s => s.value !== 'bcba');
    }
    return CANCELLATION_SOURCES;
}
export default function CancellationDialog({ appointment, settings, onConfirm, onCancel }) {
    const [source, setSource] = useState('bt');
    const [reason, setReason] = useState('sick');
    const [unplanned, setUnplanned] = useState(true);
    const [noticeMet, setNoticeMet] = useState(false);
    const [notes, setNotes] = useState('');
    const notice = settings.cancellationNotice || DEFAULT_CANCELLATION_NOTICE;
    const sources = applicableSources(appointment.type);
    // Keep source valid if appointment type changes the available list.
    if (!sources.some(s => s.value === source)) {
        setSource(sources[0].value);
    }
    const noticeQuestion = unplanned
        ? `>${notice.unplannedHoursThreshold} hour notice given?`
        : `>${notice.plannedDaysThreshold} day notice given?`;
    const submit = () => {
        onConfirm({
            source,
            reason,
            unplanned,
            noticeMet,
            canceledAt: new Date().toISOString(),
            notes: notes.trim() || undefined,
        });
    };
    return (_jsx("div", { style: overlay, children: _jsxs("div", { style: modal, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }, children: [_jsx("h3", { style: { fontSize: 18, fontWeight: 700, margin: 0 }, children: "Cancel appointment" }), _jsx("button", { onClick: onCancel, style: closeBtn, children: "\u2715" })] }), _jsx("p", { style: { fontSize: 13, color: '#6b7280', marginBottom: 16 }, children: appointment.title }), _jsx("label", { style: label, children: "Source" }), _jsx("div", { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }, children: sources.map(s => (_jsx("button", { onClick: () => setSource(s.value), style: {
                            ...chip,
                            backgroundColor: source === s.value ? '#3b82f6' : 'white',
                            color: source === s.value ? 'white' : '#374151',
                            borderColor: source === s.value ? '#3b82f6' : '#d1d5db',
                        }, children: s.label }, s.value))) }), _jsx("label", { style: label, children: "Reason" }), _jsx("select", { value: reason, onChange: e => setReason(e.target.value), style: input, children: CANCELLATION_REASONS.map(r => (_jsx("option", { value: r.value, children: r.label }, r.value))) }), _jsxs("label", { style: { ...checkbox, marginTop: 12 }, children: [_jsx("input", { type: "checkbox", checked: unplanned, onChange: e => setUnplanned(e.target.checked) }), _jsx("span", { children: "Unplanned?" })] }), _jsxs("label", { style: checkbox, children: [_jsx("input", { type: "checkbox", checked: noticeMet, onChange: e => setNoticeMet(e.target.checked) }), _jsx("span", { children: noticeQuestion })] }), _jsx("label", { style: label, children: "Notes (optional)" }), _jsx("textarea", { value: notes, onChange: e => setNotes(e.target.value), rows: 2, style: { ...input, fontFamily: 'inherit', resize: 'vertical' } }), _jsxs("div", { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }, children: [_jsx("button", { onClick: onCancel, style: secondaryBtn, children: "Back" }), _jsx("button", { onClick: submit, style: dangerBtn, children: "Mark canceled" })] })] }) }));
}
const overlay = {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex',
    alignItems: 'center', justifyContent: 'center', zIndex: 1100,
    padding: 16,
};
const modal = {
    backgroundColor: 'white', borderRadius: 8, padding: 20,
    width: '100%', maxWidth: 420, maxHeight: '90vh', overflowY: 'auto',
};
const label = {
    display: 'block', fontSize: 13, fontWeight: 600, marginTop: 12, marginBottom: 6,
};
const input = {
    width: '100%', padding: '8px 10px', border: '1px solid #d1d5db',
    borderRadius: 6, fontSize: 14, boxSizing: 'border-box',
};
const chip = {
    padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 4,
    fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap',
};
const checkbox = {
    display: 'flex', gap: 8, alignItems: 'center', marginTop: 8,
    fontSize: 13, cursor: 'pointer',
};
const secondaryBtn = {
    padding: '8px 14px', border: '1px solid #d1d5db', borderRadius: 6,
    background: 'white', cursor: 'pointer', fontSize: 14,
};
const dangerBtn = {
    padding: '8px 14px', border: 'none', borderRadius: 6,
    background: '#dc2626', color: 'white', cursor: 'pointer', fontSize: 14, fontWeight: 600,
};
const closeBtn = {
    background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', padding: 4,
};
//# sourceMappingURL=CancellationDialog.js.map