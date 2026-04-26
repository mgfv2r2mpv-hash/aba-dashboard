import React, { useState, useRef, useEffect } from 'react';
import { DayOfWeek, TimeWindow } from '../types';

const DAYS: DayOfWeek[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const SLOTS_PER_HOUR = 4;
const HOURS_PER_DAY = 24;
const TOTAL_SLOTS = HOURS_PER_DAY * SLOTS_PER_HOUR; // 96

interface AvailabilityGridProps {
  availability: { [key in DayOfWeek]?: TimeWindow[] };
  onChange: (availability: { [key in DayOfWeek]?: TimeWindow[] }) => void;
}

type DragMode = 'select' | 'deselect' | null;

const slotTimeToString = (slot: number): string => {
  const hours = Math.floor(slot / SLOTS_PER_HOUR);
  const mins = (slot % SLOTS_PER_HOUR) * 15;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
};

const timeStringToSlot = (time: string): number => {
  const [h, m] = time.split(':').map(Number);
  return h * SLOTS_PER_HOUR + Math.floor(m / 15);
};

// Build a 7x96 boolean matrix from a windows map
const windowsToMatrix = (availability: { [key in DayOfWeek]?: TimeWindow[] }): boolean[][] => {
  const matrix: boolean[][] = DAYS.map(() => new Array(TOTAL_SLOTS).fill(false));
  DAYS.forEach((day, dayIdx) => {
    (availability[day] || []).forEach(w => {
      const start = timeStringToSlot(w.start);
      const end = timeStringToSlot(w.end);
      for (let s = start; s < end; s++) {
        if (s >= 0 && s < TOTAL_SLOTS) matrix[dayIdx][s] = true;
      }
    });
  });
  return matrix;
};

// Convert a 7x96 boolean matrix back into windows
const matrixToWindows = (matrix: boolean[][]): { [key in DayOfWeek]?: TimeWindow[] } => {
  const result: { [key in DayOfWeek]?: TimeWindow[] } = {};
  DAYS.forEach((day, dayIdx) => {
    const windows: TimeWindow[] = [];
    let runStart = -1;
    for (let s = 0; s < TOTAL_SLOTS; s++) {
      if (matrix[dayIdx][s] && runStart < 0) runStart = s;
      else if (!matrix[dayIdx][s] && runStart >= 0) {
        windows.push({ start: slotTimeToString(runStart), end: slotTimeToString(s) });
        runStart = -1;
      }
    }
    if (runStart >= 0) {
      windows.push({ start: slotTimeToString(runStart), end: slotTimeToString(TOTAL_SLOTS) });
    }
    if (windows.length > 0) result[day] = windows;
  });
  return result;
};

export default function AvailabilityGrid({ availability, onChange }: AvailabilityGridProps) {
  const [matrix, setMatrix] = useState<boolean[][]>(() => windowsToMatrix(availability));
  const [dragMode, setDragMode] = useState<DragMode>(null);
  const dragStartRef = useRef<{ day: number; slot: number } | null>(null);
  const dragModeRef = useRef<DragMode>(null);
  const matrixRef = useRef<boolean[][]>(matrix);
  const gridRef = useRef<HTMLDivElement>(null);
  const cellLookupRef = useRef<Map<string, HTMLDivElement>>(new Map());

  // Keep matrixRef in sync with state for use in event handlers that close over old state
  useEffect(() => {
    matrixRef.current = matrix;
  }, [matrix]);

  // Sync inbound prop changes (e.g., reset by parent)
  useEffect(() => {
    setMatrix(windowsToMatrix(availability));
  }, [availability]);

  const commitMatrix = (m: boolean[][]) => {
    setMatrix(m);
    onChange(matrixToWindows(m));
  };

  const updateRange = (
    base: boolean[][],
    fromDay: number,
    fromSlot: number,
    toDay: number,
    toSlot: number,
    value: boolean
  ): boolean[][] => {
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

  const beginDrag = (day: number, slot: number) => {
    const currentlyOn = matrixRef.current[day][slot];
    const mode: DragMode = currentlyOn ? 'deselect' : 'select';
    dragModeRef.current = mode;
    setDragMode(mode);
    dragStartRef.current = { day, slot };
    const next = updateRange(matrixRef.current, day, slot, day, slot, mode === 'select');
    matrixRef.current = next;
    setMatrix(next);
  };

  const continueDrag = (day: number, slot: number) => {
    if (!dragStartRef.current || !dragModeRef.current) return;
    const start = dragStartRef.current;
    // Recompute from the original matrix (snapshot before drag) by merging cleanly:
    // Simpler: rebuild from previous-committed state plus the rect under drag.
    // To avoid storing snapshot, just do toggle on rect from start->current.
    const value = dragModeRef.current === 'select';
    // Use matrixRef (already updated by previous moves) is wrong; use baseSnapshot.
    // Simpler approach: use `baseRef` snapshot taken at drag start.
    const next = updateRange(baseRef.current!, start.day, start.slot, day, slot, value);
    matrixRef.current = next;
    setMatrix(next);
  };

  const baseRef = useRef<boolean[][] | null>(null);

  const handleStart = (day: number, slot: number) => {
    baseRef.current = matrixRef.current.map(row => row.slice());
    beginDrag(day, slot);
  };

  const handleMove = (day: number, slot: number) => {
    if (!dragModeRef.current) return;
    continueDrag(day, slot);
  };

  const handleEnd = () => {
    if (!dragModeRef.current) return;
    dragModeRef.current = null;
    setDragMode(null);
    dragStartRef.current = null;
    baseRef.current = null;
    onChange(matrixToWindows(matrixRef.current));
  };

  // Touch support: derive cell from touch coordinates
  const getCellFromTouch = (touch: React.Touch | Touch): { day: number; slot: number } | null => {
    const el = document.elementFromPoint(touch.clientX, touch.clientY) as HTMLElement | null;
    if (!el) return null;
    const cellAttr = el.dataset.cell || el.closest<HTMLElement>('[data-cell]')?.dataset.cell;
    if (!cellAttr) return null;
    const [d, s] = cellAttr.split('-').map(Number);
    return { day: d, slot: s };
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    const cell = getCellFromTouch(touch);
    if (cell) {
      e.preventDefault();
      handleStart(cell.day, cell.slot);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!dragModeRef.current) return;
    e.preventDefault();
    const touch = e.touches[0];
    const cell = getCellFromTouch(touch);
    if (cell) handleMove(cell.day, cell.slot);
  };

  const selectWholeDay = (dayIdx: number, value: boolean) => {
    const next = matrixRef.current.map((row, d) =>
      d === dayIdx ? new Array(TOTAL_SLOTS).fill(value) : row.slice()
    );
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

  const cellSize = 20;
  const dayColWidth = cellSize;

  return (
    <div style={{ marginTop: '16px' }}>
      <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '8px' }}>
        Drag to select (or deselect, if starting on a selected cell). 15-minute granularity.
      </div>
      <div style={{ display: 'flex', gap: '6px', marginBottom: '8px', flexWrap: 'wrap' }}>
        <button onClick={copyMondayToWeekdays} style={chipBtn}>Copy Mon → Tue–Fri</button>
        <button onClick={clearAll} style={{ ...chipBtn, color: '#dc2626', borderColor: '#fca5a5' }}>Clear all</button>
      </div>
      <div
        ref={gridRef}
        onMouseLeave={handleEnd}
        onMouseUp={handleEnd}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleEnd}
        onTouchCancel={handleEnd}
        style={{
          overflowX: 'auto',
          border: '1px solid #d1d5db',
          borderRadius: '6px',
          padding: '8px',
          backgroundColor: '#f9fafb',
          touchAction: 'none', // prevent scroll while dragging
          userSelect: 'none',
        }}
      >
        {/* Day headers (clickable to toggle whole day) */}
        <div style={{ display: 'flex', gap: '2px', marginBottom: '2px' }}>
          <div style={{ width: '40px' }} />
          {DAYS.map((day, dayIdx) => {
            const allOn = matrix[dayIdx].every(v => v);
            return (
              <button
                key={day}
                onClick={() => selectWholeDay(dayIdx, !allOn)}
                style={{
                  textAlign: 'center',
                  fontSize: '11px',
                  fontWeight: '600',
                  width: dayColWidth,
                  padding: '2px 0',
                  border: '1px solid #d1d5db',
                  borderRadius: '3px',
                  background: 'white',
                  cursor: 'pointer',
                }}
                title={`Toggle entire ${day}`}
              >
                {day.slice(0, 1)}
              </button>
            );
          })}
        </div>

        {/* Grid rows */}
        {Array.from({ length: TOTAL_SLOTS }).map((_, slot) => (
          <div key={slot} style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
            <div style={{
              width: '40px', fontSize: '10px', color: '#9ca3af', textAlign: 'right', paddingRight: '4px',
              height: cellSize - 1, lineHeight: `${cellSize - 1}px`,
            }}>
              {slot % SLOTS_PER_HOUR === 0 && slotTimeToString(slot)}
            </div>
            {DAYS.map((_day, dayIdx) => {
              const on = matrix[dayIdx][slot];
              const isHourBoundary = slot % SLOTS_PER_HOUR === 0;
              return (
                <div
                  key={`${dayIdx}-${slot}`}
                  data-cell={`${dayIdx}-${slot}`}
                  onMouseDown={(e) => { e.preventDefault(); handleStart(dayIdx, slot); }}
                  onMouseEnter={() => handleMove(dayIdx, slot)}
                  style={{
                    width: cellSize,
                    height: cellSize - 1,
                    backgroundColor: on ? '#3b82f6' : '#e5e7eb',
                    borderTop: isHourBoundary ? '1px solid #9ca3af' : '1px solid transparent',
                    borderBottom: '1px solid transparent',
                    cursor: 'pointer',
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>

      {/* Per-day text refinement (always visible, reflects committed state) */}
      <div style={{ marginTop: '12px', display: 'grid', gap: '6px' }}>
        <div style={{ fontSize: '12px', fontWeight: '600', color: '#374151' }}>Refine to the minute:</div>
        {DAYS.map((day, dayIdx) => {
          const windows = matrixToWindows(matrix)[day] || [];
          if (windows.length === 0) return null;
          return (
            <div key={day} style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <div style={{ fontSize: '11px', color: '#6b7280', width: '36px' }}>{day.slice(0, 3)}</div>
              {windows.map((w, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                  <input
                    type="time"
                    value={w.start}
                    onChange={(e) => {
                      const updated = { ...availability };
                      const list = (updated[day] || []).slice();
                      list[idx] = { ...list[idx], start: e.target.value };
                      updated[day] = list;
                      onChange(updated);
                    }}
                    style={{ fontSize: '11px', padding: '2px 4px' }}
                  />
                  <span style={{ fontSize: '11px', color: '#6b7280' }}>–</span>
                  <input
                    type="time"
                    value={w.end}
                    onChange={(e) => {
                      const updated = { ...availability };
                      const list = (updated[day] || []).slice();
                      list[idx] = { ...list[idx], end: e.target.value };
                      updated[day] = list;
                      onChange(updated);
                    }}
                    style={{ fontSize: '11px', padding: '2px 4px' }}
                  />
                </div>
              ))}
            </div>
          );
        })}
        {Object.keys(matrixToWindows(matrix)).length === 0 && (
          <div style={{ fontSize: '11px', color: '#9ca3af' }}>No availability set yet.</div>
        )}
      </div>
    </div>
  );
}

const chipBtn: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: '12px',
  border: '1px solid #d1d5db',
  borderRadius: '4px',
  background: 'white',
  cursor: 'pointer',
  color: '#374151',
};
