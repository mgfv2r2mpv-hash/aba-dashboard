import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useRef } from 'react';
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const SLOTS_PER_HOUR = 4;
const HOURS_PER_DAY = 24;
const TOTAL_SLOTS = HOURS_PER_DAY * SLOTS_PER_HOUR; // 96
export default function AvailabilityGrid({ availability, onChange }) {
    const [selection, setSelection] = useState(null);
    const [isDragging, setIsDragging] = useState(false);
    const gridRef = useRef(null);
    const getSelectedSlots = () => {
        if (!selection)
            return [];
        const { start, end } = selection;
        const slots = [];
        for (let d = Math.min(start.day, end.day); d <= Math.max(start.day, end.day); d++) {
            const minSlot = d === start.day && d === end.day ? Math.min(start.slot, end.slot) : d === start.day ? start.slot : 0;
            const maxSlot = d === start.day && d === end.day ? Math.max(start.slot, end.slot) : d === end.day ? end.slot : TOTAL_SLOTS - 1;
            for (let s = minSlot; s <= maxSlot; s++) {
                slots.push({ day: d, slot: s });
            }
        }
        return slots;
    };
    const slotTimeToString = (slot) => {
        const hours = Math.floor(slot / SLOTS_PER_HOUR);
        const mins = (slot % SLOTS_PER_HOUR) * 15;
        return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
    };
    const handleMouseDown = (day, slot) => {
        setIsDragging(true);
        setSelection({ start: { day, slot }, end: { day, slot } });
    };
    const handleMouseEnter = (day, slot) => {
        if (!isDragging || !selection)
            return;
        setSelection({ ...selection, end: { day, slot } });
    };
    const handleMouseUp = () => {
        if (!isDragging || !selection) {
            setIsDragging(false);
            return;
        }
        setIsDragging(false);
        // Build windows from selection
        const selectedSlots = getSelectedSlots();
        if (selectedSlots.length === 0) {
            setSelection(null);
            return;
        }
        const newAvailability = { ...availability };
        const slotsByDay = {};
        selectedSlots.forEach(({ day, slot }) => {
            if (!slotsByDay[day])
                slotsByDay[day] = [];
            slotsByDay[day].push(slot);
        });
        Object.entries(slotsByDay).forEach(([dayStr, slots]) => {
            const day = DAYS[parseInt(dayStr)];
            const sortedSlots = slots.sort((a, b) => a - b);
            const windows = [];
            let windowStart = sortedSlots[0];
            let windowEnd = sortedSlots[0];
            for (let i = 1; i < sortedSlots.length; i++) {
                if (sortedSlots[i] === windowEnd + 1) {
                    windowEnd = sortedSlots[i];
                }
                else {
                    windows.push({
                        start: slotTimeToString(windowStart),
                        end: slotTimeToString(windowEnd + 1),
                    });
                    windowStart = sortedSlots[i];
                    windowEnd = sortedSlots[i];
                }
            }
            windows.push({
                start: slotTimeToString(windowStart),
                end: slotTimeToString(windowEnd + 1),
            });
            newAvailability[day] = windows;
        });
        onChange(newAvailability);
        setSelection(null);
    };
    const isSlotSelected = (day, slot) => {
        if (!selection)
            return false;
        const selectedSlots = getSelectedSlots();
        return selectedSlots.some(s => s.day === day && s.slot === slot);
    };
    const cellSize = 20;
    return (_jsxs("div", { style: { marginTop: '16px' }, children: [_jsx("div", { style: { fontSize: '13px', color: '#6b7280', marginBottom: '12px' }, children: "Click and drag to select availability windows. 15-minute granularity." }), _jsxs("div", { style: {
                    overflowX: 'auto',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    padding: '8px',
                    backgroundColor: '#f9fafb',
                }, ref: gridRef, onMouseLeave: handleMouseUp, children: [_jsxs("div", { style: { display: 'flex', gap: '2px' }, children: [_jsx("div", { style: { width: '40px' } }), DAYS.map((day, dayIdx) => (_jsx("div", { style: { textAlign: 'center', fontSize: '12px', fontWeight: '600', width: cellSize * 4 + 3 }, children: day.slice(0, 3) }, day)))] }), Array.from({ length: TOTAL_SLOTS }).map((_, slot) => (_jsxs("div", { style: { display: 'flex', gap: '2px', alignItems: 'center' }, children: [_jsx("div", { style: { width: '40px', fontSize: '10px', color: '#9ca3af', textAlign: 'right', paddingRight: '4px' }, children: slot % SLOTS_PER_HOUR === 0 && slotTimeToString(slot) }), DAYS.map((day, dayIdx) => (_jsx("div", { onMouseDown: () => handleMouseDown(dayIdx, slot), onMouseEnter: () => handleMouseEnter(dayIdx, slot), onMouseUp: handleMouseUp, style: {
                                    width: cellSize,
                                    height: cellSize,
                                    backgroundColor: isSlotSelected(dayIdx, slot) ? '#3b82f6' : '#e5e7eb',
                                    border: '1px solid #d1d5db',
                                    cursor: 'pointer',
                                    transition: 'background-color 0.05s',
                                } }, `${dayIdx}-${slot}`)))] }, slot)))] }), selection && (_jsxs("div", { style: { marginTop: '12px', padding: '12px', backgroundColor: '#f0f9ff', borderRadius: '6px', border: '1px solid #bfdbfe' }, children: [_jsx("div", { style: { fontSize: '12px', fontWeight: '600', marginBottom: '8px' }, children: "Refine times (optional):" }), _jsx("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }, children: Array.from(new Set(getSelectedSlots().map(s => s.day))).map(day => (_jsxs("div", { children: [_jsx("label", { style: { fontSize: '11px', color: '#6b7280' }, children: DAYS[day] }), _jsxs("div", { style: { display: 'flex', gap: '4px' }, children: [_jsx("input", { type: "time", defaultValue: slotTimeToString(Math.min(...getSelectedSlots().filter(s => s.day === day).map(s => s.slot))), style: { flex: 1, fontSize: '11px', padding: '4px' }, onChange: (e) => {
                                                const newAvailability = { ...availability };
                                                const daySlots = getSelectedSlots().filter(s => s.day === day);
                                                if (daySlots.length > 0) {
                                                    const endSlot = Math.max(...daySlots.map(s => s.slot)) + 1;
                                                    newAvailability[DAYS[day]] = [{ start: e.target.value, end: slotTimeToString(endSlot) }];
                                                    onChange(newAvailability);
                                                }
                                            } }), _jsx("input", { type: "time", defaultValue: slotTimeToString(Math.max(...getSelectedSlots().filter(s => s.day === day).map(s => s.slot)) + 1), style: { flex: 1, fontSize: '11px', padding: '4px' }, onChange: (e) => {
                                                const newAvailability = { ...availability };
                                                const daySlots = getSelectedSlots().filter(s => s.day === day);
                                                if (daySlots.length > 0) {
                                                    const startSlot = Math.min(...daySlots.map(s => s.slot));
                                                    newAvailability[DAYS[day]] = [{ start: slotTimeToString(startSlot), end: e.target.value }];
                                                    onChange(newAvailability);
                                                }
                                            } })] })] }, day))) }), _jsx("button", { onClick: () => setSelection(null), style: {
                            marginTop: '8px',
                            width: '100%',
                            padding: '6px',
                            backgroundColor: '#ef4444',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            fontSize: '12px',
                            cursor: 'pointer',
                        }, children: "Clear Selection" })] }))] }));
}
//# sourceMappingURL=AvailabilityGrid.js.map