import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useRef, useEffect } from 'react';
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const SLOTS_PER_HOUR = 4;
const HOURS_PER_DAY = 24;
const TOTAL_SLOTS = HOURS_PER_DAY * SLOTS_PER_HOUR; // 96
const slotTimeToString = (slot) => {
    const hours = Math.floor(slot / SLOTS_PER_HOUR);
    const mins = (slot % SLOTS_PER_HOUR) * 15;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
};
const timeStringToSlot = (time) => {
    const [h, m] = time.split(':').map(Number);
    return h * SLOTS_PER_HOUR + Math.floor(m / 15);
};
// Build a 7x96 boolean matrix from a windows map
const windowsToMatrix = (availability) => {
    const matrix = DAYS.map(() => new Array(TOTAL_SLOTS).fill(false));
    DAYS.forEach((day, dayIdx) => {
        (availability[day] || []).forEach(w => {
            const start = timeStringToSlot(w.start);
            const end = timeStringToSlot(w.end);
            for (let s = start; s < end; s++) {
                if (s >= 0 && s < TOTAL_SLOTS)
                    matrix[dayIdx][s] = true;
            }
        });
    });
    return matrix;
};
// Convert a 7x96 boolean matrix back into windows
const matrixToWindows = (matrix) => {
    const result = {};
    DAYS.forEach((day, dayIdx) => {
        const windows = [];
        let runStart = -1;
        for (let s = 0; s < TOTAL_SLOTS; s++) {
            if (matrix[dayIdx][s] && runStart < 0)
                runStart = s;
            else if (!matrix[dayIdx][s] && runStart >= 0) {
                windows.push({ start: slotTimeToString(runStart), end: slotTimeToString(s) });
                runStart = -1;
            }
        }
        if (runStart >= 0) {
            windows.push({ start: slotTimeToString(runStart), end: slotTimeToString(TOTAL_SLOTS) });
        }
        if (windows.length > 0)
            result[day] = windows;
    });
    return result;
};
export default function AvailabilityGrid({ availability, onChange, clinicianAvailability }) {
    const [matrix, setMatrix] = useState(() => windowsToMatrix(availability));
    const [dragMode, setDragMode] = useState(null);
    const [showAllHours, setShowAllHours] = useState(false);
    const dragStartRef = useRef(null);
    const dragModeRef = useRef(null);
    const matrixRef = useRef(matrix);
    const gridRef = useRef(null);
    const cellLookupRef = useRef(new Map());
    // Default visible slot range: derived from the clinician's weekly availability
    // (sessions can't be scheduled outside it). Falls back to 06:00–22:00 if no
    // clinician availability is configured.
    const clinicianRange = computeClinicianSlotRange(clinicianAvailability);
    const fallbackStart = 6 * SLOTS_PER_HOUR;
    const fallbackEnd = 22 * SLOTS_PER_HOUR;
    const defaultStart = clinicianRange ? clinicianRange.start : fallbackStart;
    const defaultEnd = clinicianRange ? clinicianRange.end : fallbackEnd;
    const visibleStart = showAllHours ? 0 : defaultStart;
    const visibleEnd = showAllHours ? TOTAL_SLOTS : defaultEnd;
    // Auto-show 24h if any selected availability falls outside the clinician's
    // window, so users can see and edit those late/early windows.
    const hasOutsideClinicianRange = matrix.some(row => row.some((on, s) => on && (s < defaultStart || s >= defaultEnd)));
    const effectiveStart = hasOutsideClinicianRange ? 0 : visibleStart;
    const effectiveEnd = hasOutsideClinicianRange ? TOTAL_SLOTS : visibleEnd;
    // Keep matrixRef in sync with state for use in event handlers that close over old state
    useEffect(() => {
        matrixRef.current = matrix;
    }, [matrix]);
    // Sync inbound prop changes (e.g., reset by parent)
    useEffect(() => {
        setMatrix(windowsToMatrix(availability));
    }, [availability]);
    const commitMatrix = (m) => {
        setMatrix(m);
        onChange(matrixToWindows(m));
    };
    const updateRange = (base, fromDay, fromSlot, toDay, toSlot, value) => {
        const next = base.map(row => row.slice());
        const dStart = Math.min(fromDay, toDay);
        const dEnd = Math.max(fromDay, toDay);
        const sStart = Math.min(fromSlot, toSlot);
        const sEnd = Math.max(fromSlot, toSlot);
        for (let d = dStart; d <= dEnd; d++) {
            for (let s = sStart; s <= sEnd; s++) {
                next[d][s] = value;
            }
        }
        return next;
    };
    const beginDrag = (day, slot) => {
        const currentlyOn = matrixRef.current[day][slot];
        const mode = currentlyOn ? 'deselect' : 'select';
        dragModeRef.current = mode;
        setDragMode(mode);
        dragStartRef.current = { day, slot };
        const next = updateRange(matrixRef.current, day, slot, day, slot, mode === 'select');
        matrixRef.current = next;
        setMatrix(next);
    };
    const continueDrag = (day, slot) => {
        if (!dragStartRef.current || !dragModeRef.current)
            return;
        const start = dragStartRef.current;
        // Recompute from the original matrix (snapshot before drag) by merging cleanly:
        // Simpler: rebuild from previous-committed state plus the rect under drag.
        // To avoid storing snapshot, just do toggle on rect from start->current.
        const value = dragModeRef.current === 'select';
        // Use matrixRef (already updated by previous moves) is wrong; use baseSnapshot.
        // Simpler approach: use `baseRef` snapshot taken at drag start.
        const next = updateRange(baseRef.current, start.day, start.slot, day, slot, value);
        matrixRef.current = next;
        setMatrix(next);
    };
    const baseRef = useRef(null);
    const handleStart = (day, slot) => {
        baseRef.current = matrixRef.current.map(row => row.slice());
        beginDrag(day, slot);
    };
    const handleMove = (day, slot) => {
        if (!dragModeRef.current)
            return;
        continueDrag(day, slot);
    };
    const handleEnd = () => {
        if (!dragModeRef.current)
            return;
        dragModeRef.current = null;
        setDragMode(null);
        dragStartRef.current = null;
        baseRef.current = null;
        onChange(matrixToWindows(matrixRef.current));
    };
    // Touch support: derive cell from touch coordinates
    const getCellFromTouch = (touch) => {
        const el = document.elementFromPoint(touch.clientX, touch.clientY);
        if (!el)
            return null;
        const cellAttr = el.dataset.cell || el.closest('[data-cell]')?.dataset.cell;
        if (!cellAttr)
            return null;
        const [d, s] = cellAttr.split('-').map(Number);
        return { day: d, slot: s };
    };
    const handleTouchStart = (e) => {
        const touch = e.touches[0];
        const cell = getCellFromTouch(touch);
        if (cell) {
            e.preventDefault();
            handleStart(cell.day, cell.slot);
        }
    };
    const handleTouchMove = (e) => {
        if (!dragModeRef.current)
            return;
        e.preventDefault();
        const touch = e.touches[0];
        const cell = getCellFromTouch(touch);
        if (cell)
            handleMove(cell.day, cell.slot);
    };
    const selectWholeDay = (dayIdx, value) => {
        const next = matrixRef.current.map((row, d) => d === dayIdx ? new Array(TOTAL_SLOTS).fill(value) : row.slice());
        matrixRef.current = next;
        commitMatrix(next);
    };
    const copyMondayToWeekdays = () => {
        const monRow = matrixRef.current[0].slice();
        const next = matrixRef.current.map((row, d) => (d >= 1 && d <= 4 ? monRow.slice() : row.slice()));
        matrixRef.current = next;
        commitMatrix(next);
    };
    const clearAll = () => {
        const next = DAYS.map(() => new Array(TOTAL_SLOTS).fill(false));
        matrixRef.current = next;
        commitMatrix(next);
    };
    const cellSize = 18;
    const dayColWidth = cellSize;
    // Helper used above; declared here so nothing in JSX needs a forward ref.
    // (computeClinicianSlotRange is a module-level pure function; see bottom.)
    return (_jsxs("div", { style: { marginTop: '16px' }, children: [_jsx("div", { style: { fontSize: '13px', color: '#6b7280', marginBottom: '8px' }, children: "Drag to select (or deselect, if starting on a selected cell). 15-minute granularity." }), _jsxs("div", { style: { display: 'flex', gap: '6px', marginBottom: '8px', flexWrap: 'wrap', alignItems: 'center' }, children: [_jsx("button", { onClick: copyMondayToWeekdays, style: chipBtn, children: "Copy Mon \u2192 Tue\u2013Fri" }), _jsx("button", { onClick: clearAll, style: { ...chipBtn, color: '#dc2626', borderColor: '#fca5a5' }, children: "Clear all" }), _jsxs("label", { style: { display: 'flex', gap: '4px', alignItems: 'center', fontSize: '12px', cursor: hasOutsideClinicianRange ? 'not-allowed' : 'pointer', marginLeft: 'auto' }, children: [_jsx("input", { type: "checkbox", checked: showAllHours || hasOutsideClinicianRange, disabled: hasOutsideClinicianRange, onChange: (e) => setShowAllHours(e.target.checked) }), _jsxs("span", { children: ["24h", hasOutsideClinicianRange ? ' (auto)' : ''] })] })] }), _jsxs("div", { ref: gridRef, onMouseLeave: handleEnd, onMouseUp: handleEnd, onTouchStart: handleTouchStart, onTouchMove: handleTouchMove, onTouchEnd: handleEnd, onTouchCancel: handleEnd, style: {
                    overflowX: 'auto',
                    // No vertical inner scroll: nested scroll-with-touch-action:none traps users on iOS.
                    // Keep the grid compact via working-hours default + 18px cells, then let the modal
                    // / page scroll naturally past it.
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    padding: '8px',
                    backgroundColor: '#f9fafb',
                    touchAction: 'none', // prevent scroll while dragging
                    userSelect: 'none',
                }, children: [_jsxs("div", { style: { display: 'flex', gap: '2px', marginBottom: '2px' }, children: [_jsx("div", { style: { width: '40px' } }), DAYS.map((day, dayIdx) => {
                                const allOn = matrix[dayIdx].every(v => v);
                                return (_jsx("button", { onClick: () => selectWholeDay(dayIdx, !allOn), style: {
                                        textAlign: 'center',
                                        fontSize: '11px',
                                        fontWeight: '600',
                                        width: dayColWidth,
                                        padding: '2px 0',
                                        border: '1px solid #d1d5db',
                                        borderRadius: '3px',
                                        background: 'white',
                                        cursor: 'pointer',
                                    }, title: `Toggle entire ${day}`, children: day.slice(0, 1) }, day));
                            })] }), Array.from({ length: effectiveEnd - effectiveStart }).map((_, i) => {
                        const slot = effectiveStart + i;
                        return (_jsxs("div", { style: { display: 'flex', gap: '2px', alignItems: 'center' }, children: [_jsx("div", { style: {
                                        width: '40px', fontSize: '10px', color: '#9ca3af', textAlign: 'right', paddingRight: '4px',
                                        height: cellSize - 1, lineHeight: `${cellSize - 1}px`,
                                    }, children: slot % SLOTS_PER_HOUR === 0 && slotTimeToString(slot) }), DAYS.map((_day, dayIdx) => {
                                    const on = matrix[dayIdx][slot];
                                    const isHourBoundary = slot % SLOTS_PER_HOUR === 0;
                                    return (_jsx("div", { "data-cell": `${dayIdx}-${slot}`, onMouseDown: (e) => { e.preventDefault(); handleStart(dayIdx, slot); }, onMouseEnter: () => handleMove(dayIdx, slot), style: {
                                            width: cellSize,
                                            height: cellSize - 1,
                                            backgroundColor: on ? '#3b82f6' : '#e5e7eb',
                                            borderTop: isHourBoundary ? '1px solid #9ca3af' : '1px solid transparent',
                                            borderBottom: '1px solid transparent',
                                            cursor: 'pointer',
                                        } }, `${dayIdx}-${slot}`));
                                })] }, slot));
                    })] }), _jsxs("div", { style: { marginTop: '12px', display: 'grid', gap: '6px' }, children: [_jsx("div", { style: { fontSize: '12px', fontWeight: '600', color: '#374151' }, children: "Refine to the minute:" }), DAYS.map((day, dayIdx) => {
                        const windows = matrixToWindows(matrix)[day] || [];
                        if (windows.length === 0)
                            return null;
                        return (_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }, children: [_jsx("div", { style: { fontSize: '11px', color: '#6b7280', width: '36px' }, children: day.slice(0, 3) }), windows.map((w, idx) => (_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: '2px' }, children: [_jsx("input", { type: "time", value: w.start, onChange: (e) => {
                                                const updated = { ...availability };
                                                const list = (updated[day] || []).slice();
                                                list[idx] = { ...list[idx], start: e.target.value };
                                                updated[day] = list;
                                                onChange(updated);
                                            }, style: { fontSize: '11px', padding: '2px 4px' } }), _jsx("span", { style: { fontSize: '11px', color: '#6b7280' }, children: "\u2013" }), _jsx("input", { type: "time", value: w.end, onChange: (e) => {
                                                const updated = { ...availability };
                                                const list = (updated[day] || []).slice();
                                                list[idx] = { ...list[idx], end: e.target.value };
                                                updated[day] = list;
                                                onChange(updated);
                                            }, style: { fontSize: '11px', padding: '2px 4px' } })] }, idx)))] }, day));
                    }), Object.keys(matrixToWindows(matrix)).length === 0 && (_jsx("div", { style: { fontSize: '11px', color: '#9ca3af' }, children: "No availability set yet." }))] })] }));
}
const chipBtn = {
    padding: '4px 10px',
    fontSize: '12px',
    border: '1px solid #d1d5db',
    borderRadius: '4px',
    background: 'white',
    cursor: 'pointer',
    color: '#374151',
};
// Compute the union earliest-start and latest-end (in 15-minute slots) across
// the clinician's weekly availability. Returns null if the clinician has no
// availability set so callers can fall back to a default range.
function computeClinicianSlotRange(clinician) {
    if (!clinician)
        return null;
    let minStart = Infinity;
    let maxEnd = -Infinity;
    Object.values(clinician).forEach(windows => {
        (windows || []).forEach(w => {
            const s = timeStringToSlot(w.start);
            const e = timeStringToSlot(w.end);
            if (s < minStart)
                minStart = s;
            if (e > maxEnd)
                maxEnd = e;
        });
    });
    if (!Number.isFinite(minStart) || !Number.isFinite(maxEnd))
        return null;
    // Snap to hour boundaries so the time-label column always aligns.
    const startHour = Math.floor(minStart / SLOTS_PER_HOUR) * SLOTS_PER_HOUR;
    const endHour = Math.ceil(maxEnd / SLOTS_PER_HOUR) * SLOTS_PER_HOUR;
    return { start: startHour, end: Math.max(endHour, startHour + SLOTS_PER_HOUR) };
}
//# sourceMappingURL=AvailabilityGrid.js.map