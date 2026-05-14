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

  // Same local-no-Z format the seeded sample uses, so the calendar's
  // `startTime.startsWith('yyyy-MM-dd')` filter doesn't shift across timezones.
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const formatLocalISO = (d: Date) =>
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;

  const buildAppointments = (): Appointment[] => {
    const base: Appointment = {
      id: appointment?.id || uuidv4(),
      title,
      description,
      type,
      technician: type === 'supervision' ? '' : technicianId,
      client: clientId,
      startTime,
      endTime,
      isFixed: appointment?.isFixed ?? false,
      isBillable,
      isRecurring: recurrence !== 'none',
      recurringPattern: recurrence === 'none' ? undefined : (recurrence as any),
    };

    if (recurrence === 'none') return [base];

    // Editing an existing record: save only this occurrence. Series are
    // stored as independent records; edits to a single one don't propagate.
    if (appointment?.id) return [base];

    const start = new Date(startTime);
    if (isNaN(start.getTime())) return [base];
    const duration = new Date(endTime).getTime() - start.getTime();
    // Fallback window if the user didn't pick an end — 90 days of weekly is
    // a reasonable seed without runaway records.
    const defaultEnd = new Date(start.getTime() + 90 * 24 * 60 * 60 * 1000);
    const end = recurrenceEnd ? new Date(`${recurrenceEnd}T23:59:59`) : defaultEnd;

    if (recurrence === 'weekly' || recurrence === 'biweekly' || recurrence === 'monthly') {
      const result: Appointment[] = [];
      let occStart = new Date(start);
      while (occStart <= end) {
        const occEnd = new Date(occStart.getTime() + duration);
        result.push({
          ...base,
          id: result.length === 0 ? base.id : uuidv4(),
          startTime: formatLocalISO(occStart),
          endTime: formatLocalISO(occEnd),
        });
        if (recurrence === 'monthly') {
          const next = new Date(occStart);
          next.setMonth(next.getMonth() + 1);
          occStart = next;
        } else {
          const stepDays = recurrence === 'weekly' ? 7 : 14;
          occStart = new Date(occStart.getTime() + stepDays * 24 * 60 * 60 * 1000);
        }
      }
      return result.length > 0 ? result : [base];
    }

    const result: Appointment[] = [];

    if (recurrence === 'custom-days') {
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dayName = DAYS[(d.getDay() + 6) % 7];
        if (dayName && selectedDays.has(dayName)) {
          const occStart = new Date(d);
          occStart.setHours(start.getHours(), start.getMinutes(), 0, 0);
          const occEnd = new Date(occStart.getTime() + duration);
          result.push({
            ...base,
            id: result.length === 0 ? base.id : uuidv4(),
            startTime: formatLocalISO(occStart),
            endTime: formatLocalISO(occEnd),
            isRecurring: true,
            recurringPattern: 'custom' as any,
          });
        }
      }
    } else if (recurrence === 'custom-dates') {
      const dates = customDates.split(/\s+/).filter(Boolean);
      for (const dateStr of dates) {
        const occStart = new Date(`${dateStr}T${pad2(start.getHours())}:${pad2(start.getMinutes())}:00`);
        if (isNaN(occStart.getTime())) continue;
        const occEnd = new Date(occStart.getTime() + duration);
        result.push({
          ...base,
          id: result.length === 0 ? base.id : uuidv4(),
          startTime: formatLocalISO(occStart),
          endTime: formatLocalISO(occEnd),
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
    // Supervision is always with a client (a tech may or may not be present).
    if (type === 'supervision' && !clientId) {
      alert('Supervision sessions must have a client. A technician is optional but a client is required.');
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
      padding: 'max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left))',
      boxSizing: 'border-box',
    }}>
      <div style={{
        backgroundColor: 'white', borderRadius: '8px', padding: '20px',
        width: '100%', maxWidth: 600, maxHeight: '100%', overflowY: 'auto',
        boxSizing: 'border-box',
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

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
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

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
            {type !== 'supervision' && (
              <div>
                <label style={labelStyle}>Technician</label>
                <select value={technicianId} onChange={(e) => setTechnicianId(e.target.value)} style={inputStyle}>
                  <option value="">— None —</option>
                  {technicians.map(t => <option key={t.id} value={t.name}>{t.name}{t.isRBT ? ' (RBT)' : ''}</option>)}
                </select>
              </div>
            )}
            <div>
              <label style={labelStyle}>Client {type === 'supervision' && '*'}</label>
              <select value={clientId} onChange={(e) => setClientId(e.target.value)} style={inputStyle}>
                <option value="">— None —</option>
                {clients.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
              {type === 'supervision' && (
                <p style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
                  Supervision is logged against the client only. The tech being supervised
                  is whoever has a direct session with this client during this time;
                  if no one does, this is BCBA-solo time and won't count toward compliance.
                </p>
              )}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
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
            </div>
          )}

          {/* End-of-recurrence input shared across every series-style recurrence. */}
          {(recurrence === 'weekly' || recurrence === 'biweekly' || recurrence === 'monthly' || recurrence === 'custom-days') && (
            <div>
              <label style={labelStyle}>End recurrence on (optional)</label>
              <input
                type="date"
                value={recurrenceEnd}
                onChange={(e) => setRecurrenceEnd(e.target.value)}
                style={inputStyle}
              />
              <p style={{ fontSize: '11px', color: '#6b7280', marginTop: 4 }}>
                The series starts at the Start date/time above and repeats until
                this date (or 90 days out if left blank). When editing an existing
                appointment, changes apply only to that single occurrence — the
                rest of the series is independent.
              </p>
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
