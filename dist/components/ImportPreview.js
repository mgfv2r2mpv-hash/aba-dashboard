import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import React from 'react';
import { diffSchedule, isEmptyDiff } from '../scheduleDiff';
// Modal shown after a user picks a different Excel file from Admin → Settings.
// It does NOT replace the loaded schedule until the user confirms — so an
// accidental pick (or a file that's missing half the roster) can be backed out
// of without losing the current data.
export default function ImportPreview({ current, next, fileName, onConfirm, onCancel }) {
    const diff = diffSchedule(current, next);
    const noChange = isEmptyDiff(diff);
    return (_jsx("div", { style: overlay, onClick: onCancel, children: _jsxs("div", { style: modal, onClick: e => e.stopPropagation(), children: [_jsx("h2", { style: { fontSize: 18, fontWeight: 700, margin: '0 0 4px' }, children: "Replace current schedule?" }), _jsxs("p", { style: { fontSize: 12, color: '#6b7280', margin: '0 0 16px' }, children: [fileName ? _jsxs(_Fragment, { children: ["From ", _jsx("strong", { children: fileName }), ". "] }) : null, "This will overwrite the schedule you have loaded. Nothing changes until you choose ", _jsx("strong", { children: "Replace" }), "."] }), noChange ? (_jsx("p", { style: { fontSize: 13, color: '#6b7280', backgroundColor: '#f3f4f6', padding: 12, borderRadius: 6 }, children: "This file looks identical to what's already loaded \u2014 no changes detected." })) : (_jsxs("div", { style: { display: 'grid', gap: 12 }, children: [_jsx(DeltaCard, { title: "Clients", delta: diff.clients }), _jsx(DeltaCard, { title: "Technicians", delta: diff.technicians }), _jsxs("div", { style: card, children: [_jsx("div", { style: cardTitle, children: "Appointments" }), _jsxs("div", { style: { fontSize: 13, color: '#374151' }, children: [diff.appointments.current, " \u2192 ", _jsx("strong", { children: diff.appointments.next }), diff.appointments.delta !== 0 && (_jsxs("span", { style: { marginLeft: 6, color: diff.appointments.delta > 0 ? '#15803d' : '#b91c1c' }, children: ["(", diff.appointments.delta > 0 ? '+' : '', diff.appointments.delta, ")"] }))] })] }), diff.settingsChanged && (_jsxs("div", { style: card, children: [_jsx("div", { style: cardTitle, children: "Company settings" }), _jsx("div", { style: { fontSize: 13, color: '#a16207' }, children: "Settings differ and will be replaced." })] }))] })), _jsxs("div", { style: { display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }, children: [_jsx("button", { onClick: onCancel, style: btnSecondary, children: "Cancel" }), _jsx("button", { onClick: onConfirm, style: btnDanger, children: "Replace current data" })] })] }) }));
}
function DeltaCard({ title, delta }) {
    const none = delta.added.length === 0 && delta.removed.length === 0 && delta.changed.length === 0;
    return (_jsxs("div", { style: card, children: [_jsx("div", { style: cardTitle, children: title }), none ? (_jsx("div", { style: { fontSize: 13, color: '#6b7280' }, children: "No changes" })) : (_jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }, children: [delta.added.length > 0 && _jsx(Line, { color: "#15803d", label: "Added", names: delta.added }), delta.removed.length > 0 && _jsx(Line, { color: "#b91c1c", label: "Removed", names: delta.removed }), delta.changed.length > 0 && _jsx(Line, { color: "#a16207", label: "Changed", names: delta.changed })] }))] }));
}
function Line({ color, label, names }) {
    return (_jsxs("div", { children: [_jsxs("span", { style: { color, fontWeight: 600 }, children: [label, " (", names.length, "):"] }), ' ', _jsx("span", { style: { color: '#374151' }, children: names.join(', ') })] }));
}
const overlay = {
    position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16,
};
const modal = {
    backgroundColor: 'white', borderRadius: 12, padding: 20,
    width: 'min(520px, 100%)', maxHeight: '90vh', overflowY: 'auto',
    boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
};
const card = {
    border: '1px solid #e5e7eb', borderRadius: 8, padding: 10,
};
const cardTitle = {
    fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#6b7280', marginBottom: 6,
};
const btnSecondary = {
    padding: '8px 14px', backgroundColor: '#e5e7eb', color: '#374151',
    border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600,
};
const btnDanger = {
    padding: '8px 14px', backgroundColor: '#b91c1c', color: 'white',
    border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600,
};
//# sourceMappingURL=ImportPreview.js.map