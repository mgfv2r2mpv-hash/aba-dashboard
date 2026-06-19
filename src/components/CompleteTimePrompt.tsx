import React, { useState } from 'react';
import { Appointment } from '../types';

// Inline "complete with confirmed times" control. Shows a ✓ Complete button that
// expands to start/end time inputs prefilled with the scheduled times, so the
// user nudges them to the actually-delivered minutes before accepting (one extra
// tap accepts unchanged). Shared by the calendar popover, the past-review modal,
// and the compliance dashboard so completing a session always confirms the real
// start/end rather than silently banking the scheduled block.
export default function CompleteTimePrompt({ a, onComplete, label = '✓ Complete', flex = '1 1 auto' }: {
  a: Appointment;
  onComplete: (a: Appointment) => void;
  label?: string;
  flex?: string;
}) {
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
    return <button onClick={() => setEditing(true)} style={{ ...completeBtn, flex }}>{label}</button>;
  }

  return (
    <div style={{ flex: '1 1 100%', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <label style={lbl}>
        Start
        <input type="time" step="900" value={startClock} onChange={e => setStartClock(e.target.value)} style={timeInput} />
      </label>
      <label style={lbl}>
        End
        <input type="time" step="900" value={endClock} onChange={e => setEndClock(e.target.value)} style={timeInput} />
      </label>
      <button onClick={accept} style={completeBtn}>Accept</button>
      <button onClick={() => setEditing(false)} style={ghostBtn}>Cancel</button>
    </div>
  );
}

const completeBtn: React.CSSProperties = {
  flex: '1 1 auto', padding: '6px 12px',
  backgroundColor: 'var(--status-met-bg)', color: 'var(--status-met)',
  border: '1px solid var(--green-200)', borderRadius: 'var(--radius-sm)',
  cursor: 'pointer', fontSize: 13, fontWeight: 600,
};
const ghostBtn: React.CSSProperties = {
  padding: '6px 12px', backgroundColor: 'var(--surface-card)', color: 'var(--text-muted)',
  border: 'var(--border-control)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontSize: 13,
};
const timeInput: React.CSSProperties = {
  fontSize: 13, padding: '3px 6px', border: 'var(--border-control)', borderRadius: 'var(--radius-sm)',
};
const lbl: React.CSSProperties = {
  fontSize: 11, color: 'var(--text-body)', display: 'flex', alignItems: 'center', gap: 4,
};
