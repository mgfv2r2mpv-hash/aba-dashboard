import React, { useState, useRef } from 'react';
import { DayOfWeek, TimeWindow } from '../types';

const DAYS: DayOfWeek[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const SLOTS_PER_HOUR = 4;
const HOURS_PER_DAY = 24;
const TOTAL_SLOTS = HOURS_PER_DAY * SLOTS_PER_HOUR; // 96

interface AvailabilityGridProps {
  availability: { [key in DayOfWeek]?: TimeWindow[] };
  onChange: (availability: { [key in DayOfWeek]?: TimeWindow[] }) => void;
}

interface Selection {
  start: { day: number; slot: number };
  end: { day: number; slot: number };
}

export default function AvailabilityGrid({ availability, onChange }: AvailabilityGridProps) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

  const getSelectedSlots = (): { day: number; slot: number }[] => {
    if (!selection) return [];
    const { start, end } = selection;
    const slots: { day: number; slot: number }[] = [];

    for (let d = Math.min(start.day, end.day); d <= Math.max(start.day, end.day); d++) {
      const minSlot = d === start.day && d === end.day ? Math.min(start.slot, end.slot) : d === start.day ? start.slot : 0;
      const maxSlot = d === start.day && d === end.day ? Math.max(start.slot, end.slot) : d === end.day ? end.slot : TOTAL_SLOTS - 1;
      for (let s = minSlot; s <= maxSlot; s++) {
        slots.push({ day: d, slot: s });
      }
    }
    return slots;
  };

  const slotTimeToString = (slot: number): string => {
    const hours = Math.floor(slot / SLOTS_PER_HOUR);
    const mins = (slot % SLOTS_PER_HOUR) * 15;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  };

  const handleMouseDown = (day: number, slot: number) => {
    setIsDragging(true);
    setSelection({ start: { day, slot }, end: { day, slot } });
  };

  const handleMouseEnter = (day: number, slot: number) => {
    if (!isDragging || !selection) return;
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
    const slotsByDay: { [day: number]: number[] } = {};
    selectedSlots.forEach(({ day, slot }) => {
      if (!slotsByDay[day]) slotsByDay[day] = [];
      slotsByDay[day].push(slot);
    });

    Object.entries(slotsByDay).forEach(([dayStr, slots]) => {
      const day = DAYS[parseInt(dayStr)];
      const sortedSlots = slots.sort((a, b) => a - b);
      const windows: TimeWindow[] = [];
      let windowStart = sortedSlots[0];
      let windowEnd = sortedSlots[0];

      for (let i = 1; i < sortedSlots.length; i++) {
        if (sortedSlots[i] === windowEnd + 1) {
          windowEnd = sortedSlots[i];
        } else {
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

  const isSlotSelected = (day: number, slot: number): boolean => {
    if (!selection) return false;
    const selectedSlots = getSelectedSlots();
    return selectedSlots.some(s => s.day === day && s.slot === slot);
  };

  const cellSize = 20;

  return (
    <div style={{ marginTop: '16px' }}>
      <div style={{ fontSize: '13px', color: '#6b7280', marginBottom: '12px' }}>
        Click and drag to select availability windows. 15-minute granularity.
      </div>
      <div style={{
        overflowX: 'auto',
        border: '1px solid #d1d5db',
        borderRadius: '6px',
        padding: '8px',
        backgroundColor: '#f9fafb',
      }} ref={gridRef} onMouseLeave={handleMouseUp}>
        <div style={{ display: 'flex', gap: '2px' }}>
          {/* Day headers */}
          <div style={{ width: '40px' }} />
          {DAYS.map((day, dayIdx) => (
            <div key={day} style={{ textAlign: 'center', fontSize: '12px', fontWeight: '600', width: cellSize * 4 + 3 }}>
              {day.slice(0, 3)}
            </div>
          ))}
        </div>

        {/* Grid rows */}
        {Array.from({ length: TOTAL_SLOTS }).map((_, slot) => (
          <div key={slot} style={{ display: 'flex', gap: '2px', alignItems: 'center' }}>
            {/* Time label */}
            <div style={{ width: '40px', fontSize: '10px', color: '#9ca3af', textAlign: 'right', paddingRight: '4px' }}>
              {slot % SLOTS_PER_HOUR === 0 && slotTimeToString(slot)}
            </div>

            {/* Cells */}
            {DAYS.map((day, dayIdx) => (
              <div
                key={`${dayIdx}-${slot}`}
                onMouseDown={() => handleMouseDown(dayIdx, slot)}
                onMouseEnter={() => handleMouseEnter(dayIdx, slot)}
                onMouseUp={handleMouseUp}
                style={{
                  width: cellSize,
                  height: cellSize,
                  backgroundColor: isSlotSelected(dayIdx, slot) ? '#3b82f6' : '#e5e7eb',
                  border: '1px solid #d1d5db',
                  cursor: 'pointer',
                  transition: 'background-color 0.05s',
                }}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Text refinement inputs */}
      {selection && (
        <div style={{ marginTop: '12px', padding: '12px', backgroundColor: '#f0f9ff', borderRadius: '6px', border: '1px solid #bfdbfe' }}>
          <div style={{ fontSize: '12px', fontWeight: '600', marginBottom: '8px' }}>Refine times (optional):</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            {Array.from(new Set(getSelectedSlots().map(s => s.day))).map(day => (
              <div key={day}>
                <label style={{ fontSize: '11px', color: '#6b7280' }}>{DAYS[day]}</label>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <input
                    type="time"
                    defaultValue={slotTimeToString(
                      Math.min(...getSelectedSlots().filter(s => s.day === day).map(s => s.slot))
                    )}
                    style={{ flex: 1, fontSize: '11px', padding: '4px' }}
                    onChange={(e) => {
                      const newAvailability = { ...availability };
                      const daySlots = getSelectedSlots().filter(s => s.day === day);
                      if (daySlots.length > 0) {
                        const endSlot = Math.max(...daySlots.map(s => s.slot)) + 1;
                        newAvailability[DAYS[day]] = [{ start: e.target.value, end: slotTimeToString(endSlot) }];
                        onChange(newAvailability);
                      }
                    }}
                  />
                  <input
                    type="time"
                    defaultValue={slotTimeToString(
                      Math.max(...getSelectedSlots().filter(s => s.day === day).map(s => s.slot)) + 1
                    )}
                    style={{ flex: 1, fontSize: '11px', padding: '4px' }}
                    onChange={(e) => {
                      const newAvailability = { ...availability };
                      const daySlots = getSelectedSlots().filter(s => s.day === day);
                      if (daySlots.length > 0) {
                        const startSlot = Math.min(...daySlots.map(s => s.slot));
                        newAvailability[DAYS[day]] = [{ start: slotTimeToString(startSlot), end: e.target.value }];
                        onChange(newAvailability);
                      }
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
          <button
            onClick={() => setSelection(null)}
            style={{
              marginTop: '8px',
              width: '100%',
              padding: '6px',
              backgroundColor: '#ef4444',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            Clear Selection
          </button>
        </div>
      )}
    </div>
  );
}
