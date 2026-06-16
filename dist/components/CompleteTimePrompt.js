import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
// Inline "complete with confirmed times" control. Shows a ✓ Complete button that
// expands to start/end time inputs prefilled with the scheduled times, so the
// user nudges them to the actually-delivered minutes before accepting (one extra
// tap accepts unchanged). Shared by the calendar popover, the past-review modal,
// and the compliance dashboard so completing a session always confirms the real
// start/end rather than silently banking the scheduled block.
export default function CompleteTimePrompt({ a, onComplete, label = '✓ Complete', flex = '1 1 auto' }) {
    const [editing, setEditing] = useState(false);
    const [startClock, setStartClock] = useState(a.startTime.slice(11, 16));
    const [endClock, setEndClock] = useState(a.endTime.slice(11, 16));
    const accept = () => {
        const date = a.startTime.slice(0, 10);
        const newStart = `${date}T${startClock}:00`;
        const newEnd = `${date}T${endClock}:00`;
        if (newEnd <= newStart) {
            alert('End time must be after the start time.');
            return;
        }
        onComplete({ ...a, startTime: newStart, endTime: newEnd });
    };
    if (!editing) {
        return _jsx("button", { onClick: () => setEditing(true), style: { ...completeBtn, flex }, children: label });
    }
    return (_jsxs("div", { style: { flex: '1 1 100%', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }, children: [_jsxs("label", { style: lbl, children: ["Start", _jsx("input", { type: "time", step: "900", value: startClock, onChange: e => setStartClock(e.target.value), style: timeInput })] }), _jsxs("label", { style: lbl, children: ["End", _jsx("input", { type: "time", step: "900", value: endClock, onChange: e => setEndClock(e.target.value), style: timeInput })] }), _jsx("button", { onClick: accept, style: completeBtn, children: "Accept" }), _jsx("button", { onClick: () => setEditing(false), style: ghostBtn, children: "Cancel" })] }));
}
const completeBtn = {
    flex: '1 1 auto', padding: '6px 12px',
    backgroundColor: '#dcfce7', color: '#15803d',
    border: '1px solid #86efac', borderRadius: 4,
    cursor: 'pointer', fontSize: 13, fontWeight: 600,
};
const ghostBtn = {
    padding: '6px 12px', backgroundColor: 'white', color: '#6b7280',
    border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer', fontSize: 13,
};
const timeInput = {
    fontSize: 13, padding: '3px 6px', border: '1px solid #d1d5db', borderRadius: 4,
};
const lbl = {
    fontSize: 11, color: '#374151', display: 'flex', alignItems: 'center', gap: 4,
};
//# sourceMappingURL=CompleteTimePrompt.js.map