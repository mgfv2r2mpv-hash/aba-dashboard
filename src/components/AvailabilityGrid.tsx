import React, { useState, useRef, useEffect, useMemo } from 'react';
import { DayOfWeek, TimeWindow } from '../types';

const DAYS: DayOfWeek[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOURS_PER_DAY = 24;

interface AvailabilityGridProps {
  availability: { [key in DayOfWeek]?: TimeWindow[] };
  onChange: (availability: { [key in DayOfWeek]?: TimeWindow[] }) => void;
}

type DragMode = 'select' | 'deselect' | null;
type Granularity = 15 | 30 | 60;

const formatSlot = (slot: number, slotsPerHour: number): string => {
  const minutesInDay = slot * (60 / slotsPerHour);
  const h = Math.floor(minutesInDay / 60);
  const m = Math.floor(minutesInDay % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

const timeStringToSlot = (time: string, slotsPerHour: number): number => {
  const [h, m] = time.split(':').map(Number);
  return h * slotsPerHour + Math.floor(m / (60 / slotsPerHour));
};

const windowsToMatrix = (
  availability: { [key in DayOfWeek]?: TimeWindow[] },
  slotsPerHour: number,
): boolean[][] => {
  const totalSlots = HOURS_PER_DAY * slotsPerHour;
  const matrix: boolean[][] = DAYS.map(() => new Array(totalSlots).fill(false));
  DAYS.forEach((day, dayIdx) => {
    (availability[day] || []).forEach(w => {
      const start = timeStringToSlot(w.start, slotsPerHour);
      const end = timeStringToSlot(w.end, slotsPerHour);
      for (let s = start; s < end; s++) {
        if (s >= 0 && s < totalSlots) matrix[dayIdx][s] = true;
      }
    });
  });
  return matrix;
};

const matrixToWindows = (
  matrix: boolean[][],
  slotsPerHour: number,
): { [key in DayOfWeek]?: TimeWindow[] } => {
  const totalSlots = HOURS_PER_DAY * slotsPerHour;
  const result: { [key in DayOfWeek]?: TimeWindow[] } = {};
  DAYS.forEach((day, dayIdx) => {
    const windows: TimeWindow[] = [];
    let runStart = -1;
    for (let s = 0; s < totalSlots; s++) {
      if (matrix[dayIdx][s] && runStart < 0) runStart = s;
      else if (!matrix[dayIdx][s] && runStart >= 0) {
        windows.push({ start: formatSlot(runStart, slotsPerHour), end: formatSlot(s, slotsPerHour) });
        runStart = -1;
      }
    }
    if (runStart >= 0) {
      windows.push({ start: formatSlot(runStart, slotsPerHour), end: formatSlot(totalSlots, slotsPerHour) });
    }
    if (windows.length > 0) result[day] = windows;
  });
  return result;
};

export default function AvailabilityGrid({ availability, onChange }: AvailabilityGridProps) {
  const [granularity, setGranularity] = useState<Granularity>(30);
  const slotsPerHour = 60 / granularity;
  const totalSlots = HOURS_PER_DAY * slotsPerHour;

  const [matrix, setMatrix] = useState<boolean[][]>(() => windowsToMatrix(availability, slotsPerHour));
  const dragStartRef = useRef<{ day: number; slot: number } | null>(null);
  const dragModeRef = useRef<DragMode>(null);
  const matrixRef = useRef<boolean[][]>(matrix);
  const baseRef = useRef<boolean[][] | null>(null);

  useEffect(() => {
    matrixRef.current = matrix;
  }, [matrix]);

  // Re-derive matrix from availability when prop or granularity changes
  useEffect(() => {
    setMatrix(windowsToMatrix(availability, slotsPerHour));
  }, [availability, slotsPerHour]);

  const commitMatrix = (m: boolean[][]) => {
    setMatrix(m);
    onChange(matrixToWindows(m, slotsPerHour));
  };

  const updateRange = (
    base: boolean[][],
    fromDay: number,
    fromSlot: number,
    toDay: number,
    toSlot: number,
    value: boolean,
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

  const handleStart = (day: number, slot: number) => {
    baseRef.current = matrixRef.current.map(row => row.slice());
    const currentlyOn = matrixRef.current[day][slot];
    const mode: DragMode = currentlyOn ? 'deselect' : 'select';
    dragModeRef.current = mode;
    dragStartRef.current = { day, slot };
    const next = updateRange(matrixRef.current, day, slot, day, slot, mode === 'select');
    matrixRef.current = next;
    setMatrix(next);
  };

  const handleMove = (day: number, slot: number) => {
    if (!dragModeRef.current || !dragStartRef.current || !baseRef.current) return;
    const start = dragStartRef.current;
    const value = dragModeRef.current === 'select';
    const next = updateRange(baseRef.current, start.day, start.slot, day, slot, value);
    matrixRef.current = next;
    setMatrix(next);
  };

  const handleEnd = () => {
    if (!dragModeRef.current) return;
    dragModeRef.current = null;
    dragStartRef.current = null;
    baseRef.current = null;
    onChange(matrixToWindows(matrixRef.current, slotsPerHour));
  };

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
      d === dayIdx ? new Array(totalSlots).fill(value) : row.slice(),
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

  const setStandardWeekdays = () => {
    // 9 AM – 5 PM, Mon-Fri only
    const off = new Array(totalSlots).fill(false);
    const start = 9 * slotsPerHour;
    const end = 17 * slotsPerHour;
    const work = off.slice();
    for (let s = start; s < end; s++) work[s] = true;
    const next = DAYS.map((_, d) => (d <= 4 ? work.slice() : off.slice()));
    matrixRef.current = next;
    commitMatrix(next);
  };

  const clearAll = () => {
    const next = DAYS.map(() => new Array(totalSlots).fill(false));
    matrixRef.current = next;
    commitMatrix(next);
  };

  // Cell sizing — horizontal layout. Each slot is small, hours are grouped.
  const slotWidth = granularity === 15 ? 8 : granularity === 30 ? 14 : 26;
  const cellHeight = 26;
  const dayLabelWidth = 44;

  // Pre-compute windows for the type-able editor
  const windowsByDay = useMemo(() => matrixToWindows(matrix, slotsPerHour), [matrix, slotsPerHour]);

  const updateWindow = (day: DayOfWeek, idx: number, field: 'start' | 'end', value: string) => {
    const next = { ...windowsByDay };
    const list = (next[day] || []).slice();
    list[idx] = { ...list[idx], [field]: value };
    next[day] = list;
    onChange(next);
  };

  const addWindow = (day: DayOfWeek) => {
    const next = { ...windowsByDay };
    next[day] = [...(next[day] || []), { start: '09:00', end: '17:00' }];
    onChange(next);
  };

  const removeWindow = (day: DayOfWeek, idx: number) => {
    const next = { ...windowsByDay };
    next[day] = (next[day] || []).filter((_, i) => i !== idx);
    if ((next[day] || []).length === 0) delete next[day];
    onChange(next);
  };

  return (
    <div style={{ marginTop: '12px' }}>
      {/* Action bar */}
      <div style={{
        display: 'flex', gap: '6px', marginBottom: '8px', flexWrap: 'wrap', alignItems: 'center',
      }}>
        <button onClick={setStandardWeekdays} style={chipBtn} title="Set Mon–Fri 9 AM–5 PM">
          Weekdays 9–5
        </button>
        <button onClick={copyMondayToWeekdays} style={chipBtn} title="Copy Monday's selection to Tue–Fri">
          Copy Mon → Tue–Fri
        </button>
        <button onClick={clearAll} style={{ ...chipBtn, color: '#dc2626', borderColor: '#fca5a5' }}>
          Clear all
        </button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '4px', alignItems: 'center', fontSize: '12px', color: '#6b7280' }}>
          <span>Snap:</span>
          {[15, 30, 60].map(g => (
            <button
              key={g}
              onClick={() => setGranularity(g as Granularity)}
              style={{
                ...chipBtn,
                padding: '2px 8px',
                background: granularity === g ? '#3b82f6' : 'white',
                color: granularity === g ? 'white' : '#374151',
                borderColor: granularity === g ? '#3b82f6' : '#d1d5db',
              }}
            >
              {g === 60 ? '1h' : `${g}m`}
            </button>
          ))}
        </div>
      </div>

      <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '6px' }}>
        Click and drag to paint availability. Click a day name to toggle the entire day. Or type exact times below.
      </div>

      {/* Horizontal grid: days = rows, hours = columns */}
      <div
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
          padding: '6px',
          backgroundColor: '#f9fafb',
          touchAction: 'none',
          userSelect: 'none',
        }}
      >
        {/* Hour header */}
        <div style={{ display: 'flex', marginBottom: '2px' }}>
          <div style={{ width: dayLabelWidth, flexShrink: 0 }} />
          {Array.from({ length: HOURS_PER_DAY }).map((_, h) => (
            <div
              key={h}
              style={{
                width: slotWidth * slotsPerHour,
                flexShrink: 0,
                fontSize: '10px',
                color: '#6b7280',
                textAlign: 'left',
                borderLeft: h === 0 ? 'none' : '1px solid #e5e7eb',
                paddingLeft: '2px',
                lineHeight: '14px',
              }}
            >
              {h % (granularity === 60 ? 1 : 2) === 0 ? `${h}` : ''}
            </div>
          ))}
        </div>

        {/* Day rows */}
        {DAYS.map((day, dayIdx) => {
          const allOn = matrix[dayIdx].every(v => v);
          return (
            <div key={day} style={{ display: 'flex', alignItems: 'center', marginBottom: '1px' }}>
              <button
                onClick={() => selectWholeDay(dayIdx, !allOn)}
                style={{
                  width: dayLabelWidth,
                  flexShrink: 0,
                  height: cellHeight,
                  fontSize: '11px',
                  fontWeight: 600,
                  border: '1px solid #d1d5db',
                  borderRadius: '3px',
                  background: 'white',
                  color: '#374151',
                  cursor: 'pointer',
                  marginRight: '2px',
                }}
                title={`Toggle entire ${day}`}
              >
                {DAY_LABELS[dayIdx]}
              </button>
              <div style={{ display: 'flex', flexShrink: 0 }}>
                {Array.from({ length: totalSlots }).map((_, slot) => {
                  const on = matrix[dayIdx][slot];
                  const isHourBoundary = slot % slotsPerHour === 0;
                  const isHalfHour = slotsPerHour > 1 && slot % slotsPerHour === slotsPerHour / 2;
                  return (
                    <div
                      key={slot}
                      data-cell={`${dayIdx}-${slot}`}
                      onMouseDown={(e) => { e.preventDefault(); handleStart(dayIdx, slot); }}
                      onMouseEnter={() => handleMove(dayIdx, slot)}
                      title={formatSlot(slot, slotsPerHour)}
                      style={{
                        width: slotWidth,
                        height: cellHeight,
                        backgroundColor: on ? '#3b82f6' : '#e5e7eb',
                        borderLeft: isHourBoundary
                          ? '1px solid #9ca3af'
                          : isHalfHour
                            ? '1px solid #d1d5db'
                            : '1px solid transparent',
                        cursor: 'pointer',
                      }}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Type-able editor */}
      <div style={{ marginTop: '12px' }}>
        <div style={{ fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>
          Or type exact times:
        </div>
        <div style={{ display: 'grid', gap: '4px' }}>
          {DAYS.map((day, dayIdx) => {
            const windows = windowsByDay[day] || [];
            return (
              <div
                key={day}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  flexWrap: 'wrap',
                  padding: '4px 6px',
                  borderRadius: '4px',
                  background: dayIdx % 2 === 0 ? '#f9fafb' : 'white',
                }}
              >
                <span style={{
                  fontSize: '12px', fontWeight: 600, color: '#374151',
                  width: '36px', flexShrink: 0,
                }}>
                  {DAY_LABELS[dayIdx]}
                </span>
                {windows.length === 0 ? (
                  <span style={{ fontSize: '12px', color: '#9ca3af', fontStyle: 'italic' }}>
                    Off
                  </span>
                ) : (
                  windows.map((w, idx) => (
                    <span key={idx} style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                      <input
                        type="time"
                        value={w.start}
                        onChange={(e) => updateWindow(day, idx, 'start', e.target.value)}
                        style={timeInputStyle}
                      />
                      <span style={{ fontSize: '12px', color: '#6b7280' }}>–</span>
                      <input
                        type="time"
                        value={w.end}
                        onChange={(e) => updateWindow(day, idx, 'end', e.target.value)}
                        style={timeInputStyle}
                      />
                      <button
                        onClick={() => removeWindow(day, idx)}
                        style={removeBtn}
                        title="Remove this window"
                      >×</button>
                    </span>
                  ))
                )}
                <button
                  onClick={() => addWindow(day)}
                  style={addBtn}
                  title={`Add a time window on ${day}`}
                >
                  + window
                </button>
              </div>
            );
          })}
        </div>
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

const timeInputStyle: React.CSSProperties = {
  fontSize: '13px',
  padding: '3px 6px',
  border: '1px solid #d1d5db',
  borderRadius: '4px',
  fontFamily: 'inherit',
};

const addBtn: React.CSSProperties = {
  padding: '3px 8px',
  fontSize: '11px',
  border: '1px dashed #3b82f6',
  background: 'white',
  color: '#3b82f6',
  borderRadius: '4px',
  cursor: 'pointer',
};

const removeBtn: React.CSSProperties = {
  padding: '1px 6px',
  fontSize: '12px',
  border: '1px solid #fca5a5',
  background: '#fee2e2',
  color: '#dc2626',
  borderRadius: '3px',
  cursor: 'pointer',
  lineHeight: 1,
};
