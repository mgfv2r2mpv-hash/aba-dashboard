import React, { useState } from 'react';
import { Appointment, Technician, Client, DayOfWeek } from '../types';
import { v4 as uuidv4 } from 'uuid';

interface AppointmentFormProps {
  appointment?: Appointment;
  technicians: Technician[];
  clients: Client[];
  onSave: (appointment: Appointment) => void;
  onCancel: () => void;
}

type RecurrencePattern =
  | 'none'
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'custom-days' // pick specific days of week
  | 'custom-dates'; // explicit list of dates

const DAYS: DayOfWeek[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export default function AppointmentForm({
  appointment,
  technicians,
  clients,
  onSave,
  onCancel,
}: AppointmentFormProps) {
  const [title, setTitle] = useState(appointment?.title || '');
  const [description, setDescription] = useState(appointment?.description || '');
  const [type, setType] = useState<Appointment['type']>(appointment?.type || 'client-session');
  const [technicianId, setTechnicianId] = useState(appointment?.technician || '');
  const [clientId, setClientId] = useState(appointment?.client || '');
  const [startTime, setStartTime] = useState(appointment?.startTime || '');
  const [endTime, setEndTime] = useState(appointment?.endTime || '');
  const [isFixed, setIsFixed] = useState(appointment?.isFixed || false);
  const [isBillable, setIsBillable] = useState(appointment?.isBillable ?? true);

  // Recurrence
  const [recurrence, setRecurrence] = useState<RecurrencePattern>(
    appointment?.isRecurring ? (appointment.recurringPattern as RecurrencePattern) : 'none'
  );
  const [selectedDays, setSelectedDays] = useState<Set<DayOfWeek>>(new Set());
  const [customDates, setCustomDates] = useState<string>(''); // newline-separated YYYY-MM-DD
  const [recurrenceEnd, setRecurrenceEnd] = useState<string>('');

  const toggleDay = (day: DayOfWeek) => {
    const next = new Set(selectedDays);
    if (next.has(day)) next.delete(day); else next.add(day);
    setSelectedDays(next);
  };

  const buildAppointments = (): Appointment[] => {
    const base: Appointment = {
      id: appointment?.id || uuidv4(),
      title,
      description,
      type,
      technician: technicianId,
      client: clientId,
      startTime,
      endTime,
      isFixed,
      isBillable,
      isRecurring: recurrence !== 'none',
      recurringPattern: recurrence === 'none' ? undefined : (recurrence as any),
    };

    // For simple recurrence, return a single record - the schedule renderer expands it.
    if (recurrence === 'none' || recurrence === 'weekly' || recurrence === 'biweekly' || recurrence === 'monthly') {
      return [base];
    }

    // For custom-days: generate one appointment per occurrence in window
    const result: Appointment[] = [];
    const start = new Date(startTime);
    const end = recurrenceEnd ? new Date(recurrenceEnd) : new Date(start.getTime() + 90 * 24 * 60 * 60 * 1000);
    const duration = new Date(endTime).getTime() - start.getTime();

    if (recurrence === 'custom-days') {
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dayName = DAYS[(d.getDay() + 6) % 7]; // convert Sun=0 to Mon=0
        if (dayName && selectedDays.has(dayName)) {
          const occStart = new Date(d);
          occStart.setHours(start.getHours(), start.getMinutes(), 0, 0);
          const occEnd = new Date(occStart.getTime() + duration);
          result.push({
            ...base,
            id: uuidv4(),
            startTime: occStart.toISOString(),
            endTime: occEnd.toISOString(),
            isRecurring: true,
            recurringPattern: 'custom' as any,
          });
        }
      }
    } else if (recurrence === 'custom-dates') {
      const dates = customDates.split(/\s+/).filter(Boolean);
      for (const dateStr of dates) {
        const occStart = new Date(`${dateStr}T${start.toTimeString().slice(0, 8)}`);
        if (isNaN(occStart.getTime())) continue;
        const occEnd = new Date(occStart.getTime() + duration);
        result.push({
          ...base,
          id: uuidv4(),
          startTime: occStart.toISOString(),
          endTime: occEnd.toISOString(),
          isRecurring: true,
          recurringPattern: 'custom' as any,
        });
      }
    }

    return result.length > 0 ? result : [base];
  };

  const handleSubmit = () => {
    if (!title || !startTime || !endTime) {
      alert('Title, start, and end time are required.');
      return;
    }
    const appointments = buildAppointments();
    appointments.forEach(a => onSave(a));
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 12px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    fontSize: '14px',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontWeight: '600',
    marginBottom: '6px',
    fontSize: '13px',
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div style={{
        backgroundColor: 'white', borderRadius: '8px', padding: '24px',
        width: '600px', maxHeight: '90vh', overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 'bold' }}>
            {appointment ? 'Edit Appointment' : 'Add Appointment'}
          </h2>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ display: 'grid', gap: '12px' }}>
          <div>
            <label style={labelStyle}>Title *</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle} />
          </div>

          <div>
            <label style={labelStyle}>Description</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} style={inputStyle} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={labelStyle}>Type</label>
              <select value={type} onChange={(e) => setType(e.target.value as any)} style={inputStyle}>
                <option value="client-session">Client Session</option>
                <option value="supervision">Supervision</option>
                <option value="parent-training">Parent Training</option>
                <option value="internal-task">Internal Task</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Recurrence</label>
              <select value={recurrence} onChange={(e) => setRecurrence(e.target.value as RecurrencePattern)} style={inputStyle}>
                <option value="none">One-time</option>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Every 2 weeks</option>
                <option value="monthly">Monthly</option>
                <option value="custom-days">Custom days of week</option>
                <option value="custom-dates">Specific dates</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={labelStyle}>Technician</label>
              <select value={technicianId} onChange={(e) => setTechnicianId(e.target.value)} style={inputStyle}>
                <option value="">— None —</option>
                {technicians.map(t => <option key={t.id} value={t.name}>{t.name}{t.isRBT ? ' (RBT)' : ''}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Client</label>
              <select value={clientId} onChange={(e) => setClientId(e.target.value)} style={inputStyle}>
                <option value="">— None —</option>
                {clients.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label style={labelStyle}>Start *</label>
              <input type="datetime-local" value={startTime} onChange={(e) => setStartTime(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>End *</label>
              <input type="datetime-local" value={endTime} onChange={(e) => setEndTime(e.target.value)} style={inputStyle} />
            </div>
          </div>

          {recurrence === 'custom-days' && (
            <div>
              <label style={labelStyle}>Days of week</label>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {DAYS.map(day => (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleDay(day)}
                    style={{
                      padding: '6px 10px',
                      border: '1px solid #d1d5db',
                      borderRadius: '4px',
                      backgroundColor: selectedDays.has(day) ? '#3b82f6' : 'white',
                      color: selectedDays.has(day) ? 'white' : '#374151',
                      cursor: 'pointer',
                      fontSize: '12px',
                    }}
                  >
                    {day.slice(0, 3)}
                  </button>
                ))}
              </div>
              <label style={{ ...labelStyle, marginTop: '12px' }}>Stop recurring on (optional)</label>
              <input type="date" value={recurrenceEnd} onChange={(e) => setRecurrenceEnd(e.target.value)} style={inputStyle} />
            </div>
          )}

          {recurrence === 'custom-dates' && (
            <div>
              <label style={labelStyle}>Specific dates (one per line, YYYY-MM-DD)</label>
              <textarea
                value={customDates}
                onChange={(e) => setCustomDates(e.target.value)}
                placeholder={'2025-05-05\n2025-05-19\n2025-06-02'}
                rows={5}
                style={{ ...inputStyle, fontFamily: 'monospace', resize: 'vertical' }}
              />
              <p style={{ fontSize: '11px', color: '#6b7280', marginTop: '4px' }}>
                Time of day comes from the Start field above. Useful for awkward / variable schedules.
              </p>
            </div>
          )}

          <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginTop: '4px' }}>
            <label style={{ display: 'flex', gap: '6px', alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={isFixed} onChange={(e) => setIsFixed(e.target.checked)} />
              <span>🔒 Fixed (cannot be moved)</span>
            </label>
            <label style={{ display: 'flex', gap: '6px', alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={isBillable} onChange={(e) => setIsBillable(e.target.checked)} />
              <span>Billable</span>
            </label>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '20px' }}>
          <button onClick={onCancel} style={{
            padding: '8px 16px', border: '1px solid #d1d5db', borderRadius: '6px',
            background: 'white', cursor: 'pointer',
          }}>Cancel</button>
          <button onClick={handleSubmit} style={{
            padding: '8px 16px', backgroundColor: '#3b82f6', color: 'white',
            border: 'none', borderRadius: '6px', cursor: 'pointer',
          }}>Save</button>
        </div>
      </div>
    </div>
  );
}
