import React, { useState } from 'react';
import { Appointment, Technician, Client, DayOfWeek, Authorization, ScheduleData, CompanySettings, BcbaSessionDefaults, DEFAULT_BCBA_SESSION_DEFAULTS } from '../types';
import { makeupCandidates, findAuthFor } from '../authorization';
import { v4 as uuidv4 } from 'uuid';

interface AppointmentFormProps {
  appointment?: Appointment;
  // All current appointments: resolves siblings for series-scoped edit/delete
  // and canceled sessions for the make-up picker.
  allAppointments?: Appointment[];
  // Authorizations scope the make-up picker to "same auth period".
  authorizations?: Authorization[];
  technicians: Technician[];
  clients: Client[];
  // Company settings — supplies the BCBA session-length defaults used to auto-fill
  // a new appointment's end time when its type is chosen.
  settings?: CompanySettings;
  // Pre-select a type on new appointments (e.g. based on the calendar lens).
  initialType?: Appointment['type'];
  // Save can affect more than one record when editing with scope > instance;
  // signature returns the full list of upserts to apply.
  onSave: (appointments: Appointment[]) => void;
  // Delete is scope-aware too — returns the ids to remove (empty array on cancel).
  onDelete?: (ids: string[]) => void;
  onCancel: () => void;
  // 'modal' (default) renders the full-screen overlay; 'inline' renders just the
  // form body to fill its container (used by the slide-up edit panel/sheet).
  variant?: 'modal' | 'inline';
}

type EditScope = 'instance' | 'following' | 'all';

type RecurrencePattern =
  | 'none'
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'custom-days' // pick specific days of week
  | 'custom-dates'; // explicit list of dates

const DAYS: DayOfWeek[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// HH:MM helpers for the start/end clock fields. Shifts stay within one day
// (appointments never cross midnight).
function clockToMin(clock: string): number {
  const [h, m] = clock.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
function minToClock(total: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(total)));
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

export default function AppointmentForm({
  appointment,
  allAppointments,
  authorizations,
  technicians,
  clients,
  settings,
  initialType,
  onSave,
  onDelete,
  onCancel,
  variant = 'modal',
}: AppointmentFormProps) {
  const [title, setTitle] = useState(appointment?.title || '');
  const [description, setDescription] = useState(appointment?.description || '');
  const [type, setType] = useState<Appointment['type']>(appointment?.type || initialType || 'client-session');
  // Parent-training / case-planning can be caregiver-only sessions, so they carry
  // an OPTIONAL "supervised BT" — the technician field names the BT being observed
  // (not a provider), and the overlap with that BT's direct earns supervision.
  // Supervision itself stays client-only (the BT is inferred from the overlap).
  const needsSupervisedBt = type === 'parent-training' || type === 'case-planning';
  const [technicianId, setTechnicianId] = useState(appointment?.technician || '');
  const [clientId, setClientId] = useState(appointment?.client || '');
  // An appointment is a single calendar day plus a start and end clock time —
  // sessions never cross midnight (insurance is billed per-day). We keep the
  // canonical model as full local-ISO startTime/endTime strings (the rest of
  // the app depends on them) but compose them from one date + two times.
  const [date, setDate] = useState(appointment?.startTime ? appointment.startTime.slice(0, 10) : '');
  const [startClock, setStartClock] = useState(appointment?.startTime ? appointment.startTime.slice(11, 16) : '');
  const [endClock, setEndClock] = useState(appointment?.endTime ? appointment.endTime.slice(11, 16) : '');
  const startTime = date && startClock ? `${date}T${startClock}:00` : '';
  const endTime = date && endClock ? `${date}T${endClock}:00` : '';
  const [isBillable, setIsBillable] = useState(appointment?.isBillable ?? true);
  const [isMakeUp, setIsMakeUp] = useState(appointment?.isMakeUp ?? false);
  const [makeupForId, setMakeupForId] = useState(appointment?.makeupForId || '');

  const isNew = !appointment?.id;
  // "Move end time with start time": preserve the current duration when the
  // start shifts. Default checked on every fresh open/select.
  const [moveEndWithStart, setMoveEndWithStart] = useState(true);
  // Whether the user has hand-edited the end time. Until they do, a new
  // appointment auto-fills the end from the type's authorized weekly hours.
  const [endManual, setEndManual] = useState(!!appointment?.endTime);

  // BCBA session-length defaults (preselected in Admin → Settings).
  const bcbaDefaults: BcbaSessionDefaults = settings?.bcbaSessionDefaults || DEFAULT_BCBA_SESSION_DEFAULTS;

  // The client's authorized weekly DIRECT hours for the chosen date (drives both
  // the direct-session default duration and the supervision % default).
  const weeklyDirectHours = (clientArg: string, dateArg: string): number | undefined => {
    if (!clientArg || !dateArg) return undefined;
    const auth = findAuthFor(
      { appointments: allAppointments || [], authorizations: authorizations || [], clients } as unknown as ScheduleData,
      clientArg, dateArg,
    );
    const h = auth?.weekly?.direct;
    return h && h > 0 ? h : undefined;
  };

  // Default duration (hours) for a new session by type. Direct draws from the
  // client's authorized weekly direct rate; BCBA (non-direct) types use the
  // preselected defaults — supervision as a % of weekly direct, the rest fixed.
  const defaultHoursForType = (typeArg: Appointment['type'], clientArg: string, dateArg: string): number | undefined => {
    switch (typeArg) {
      case 'client-session':
        return weeklyDirectHours(clientArg, dateArg);
      case 'supervision': {
        const wk = weeklyDirectHours(clientArg, dateArg);
        return wk !== undefined ? (wk * bcbaDefaults.supervisionPercentOfWeeklyDirect) / 100 : undefined;
      }
      case 'reassessment': return bcbaDefaults.reassessmentHours;
      case 'case-planning': return bcbaDefaults.casePlanningHours;
      case 'parent-training': return bcbaDefaults.parentTrainingHours;
      case 'other': return bcbaDefaults.otherHours;
      default: return undefined; // internal-task: no auto default
    }
  };

  // Apply the default duration for a new appointment when the end is still empty
  // or auto-managed and we have a start + type (+ client for the auth-based types).
  const applyAuthDefaultEnd = (typeArg: Appointment['type'], clientArg: string, startArg: string, dateArg: string) => {
    if (!isNew || endManual) return;
    if (!startArg) return;
    const h = defaultHoursForType(typeArg, clientArg, dateArg);
    if (h === undefined || h <= 0) return;
    setEndClock(minToClock(clockToMin(startArg) + h * 60));
  };

  const handleStartChange = (newStart: string) => {
    const prevDuration = startClock && endClock ? clockToMin(endClock) - clockToMin(startClock) : undefined;
    setStartClock(newStart);
    if (!newStart) return;
    // Move end with start: keep the existing duration.
    if (moveEndWithStart && prevDuration !== undefined && prevDuration > 0) {
      setEndClock(minToClock(clockToMin(newStart) + prevDuration));
      return;
    }
    applyAuthDefaultEnd(type, clientId, newStart, date);
  };

  const handleTypeChange = (t: Appointment['type']) => {
    setType(t);
    applyAuthDefaultEnd(t, clientId, startClock, date);
  };

  const handleClientChange = (c: string) => {
    setClientId(c);
    applyAuthDefaultEnd(type, c, startClock, date);
  };

  // Canceled, not-fully-made-up sessions for this client within the auth
  // covering the chosen date (same calendar month when no auth covers it).
  const makeupOptions = (isMakeUp && clientId && date)
    ? makeupCandidates(
        { appointments: allAppointments || [], authorizations: authorizations || [], clients } as unknown as ScheduleData,
        clientId, date, appointment?.id,
      )
    : [];

  // Recurrence
  const [recurrence, setRecurrence] = useState<RecurrencePattern>(
    appointment?.isRecurring ? (appointment.recurringPattern as RecurrencePattern) : 'none'
  );
  const [selectedDays, setSelectedDays] = useState<Set<DayOfWeek>>(new Set());
  const [customDates, setCustomDates] = useState<string>(''); // newline-separated YYYY-MM-DD
  const [recurrenceEnd, setRecurrenceEnd] = useState<string>('');
  const [editScope, setEditScope] = useState<EditScope>('instance');

  // All other occurrences sharing this appointment's seriesId. When editing,
  // the scope picker only matters if there's a real series to act on.
  const siblings = (appointment?.seriesId && allAppointments)
    ? allAppointments.filter(a => a.seriesId === appointment.seriesId)
    : [];
  const hasSeries = siblings.length > 1;

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

  // Edit on an existing series with scope > instance: take this occurrence's
  // edits and propagate to the relevant siblings. Title/desc/type/tech/client/
  // isBillable replace 1:1. Time-of-day is applied as HH:MM to each sibling
  // while preserving that sibling's date, and the duration becomes the new
  // (endTime - startTime). Status / cancellation stay per-instance.
  const buildSeriesEdit = (): Appointment[] => {
    if (!appointment) return [];
    const newStart = new Date(startTime);
    const newEnd = new Date(endTime);
    if (isNaN(newStart.getTime()) || isNaN(newEnd.getTime())) return [appointment];
    const newDurationMs = newEnd.getTime() - newStart.getTime();
    const newHour = newStart.getHours();
    const newMin = newStart.getMinutes();
    const newSec = newStart.getSeconds();

    const cutoff = new Date(appointment.startTime).getTime();
    const targets = siblings.filter(s =>
      editScope === 'all' || new Date(s.startTime).getTime() >= cutoff
    );

    return targets.map(sib => {
      const sibDate = new Date(sib.startTime);
      const updatedStart = new Date(sibDate);
      updatedStart.setHours(newHour, newMin, newSec, 0);
      const updatedEnd = new Date(updatedStart.getTime() + newDurationMs);
      return {
        ...sib,
        title,
        description,
        type,
        technician: type === 'supervision' ? '' : technicianId,
        client: clientId,
        isBillable,
        startTime: formatLocalISO(updatedStart),
        endTime: formatLocalISO(updatedEnd),
      };
    });
  };

  const buildAppointments = (): Appointment[] => {
    const editing = !!appointment?.id;

    // Scope-aware edit branches before the build-from-scratch logic.
    if (editing && hasSeries && editScope !== 'instance') {
      const updates = buildSeriesEdit();
      return updates.length > 0 ? updates : [];
    }

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
      isMakeUp: isMakeUp || undefined,
      makeupForId: isMakeUp && makeupForId ? makeupForId : undefined,
      isRecurring: recurrence !== 'none',
      recurringPattern: recurrence === 'none' ? undefined : (recurrence as any),
      // Preserve series membership on single-instance edit so the slider
      // stays meaningful for future opens.
      seriesId: appointment?.seriesId,
    };

    if (recurrence === 'none') return [base];

    // Editing an existing record with scope === 'instance': only this one.
    if (editing) return [base];

    const start = new Date(startTime);
    if (isNaN(start.getTime())) return [base];
    const duration = new Date(endTime).getTime() - start.getTime();
    // Fallback window if the user didn't pick an end — 90 days of weekly is
    // a reasonable seed without runaway records.
    const defaultEnd = new Date(start.getTime() + 90 * 24 * 60 * 60 * 1000);
    const end = recurrenceEnd ? new Date(`${recurrenceEnd}T23:59:59`) : defaultEnd;
    // One seriesId for all instances of this new series, so future edits can
    // target "this and following" or "all in series".
    const seriesId = uuidv4();

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
          seriesId,
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
      return result.length > 0 ? result : [{ ...base, seriesId }];
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
            seriesId,
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
          seriesId,
        });
      }
    }

    return result.length > 0 ? result : [{ ...base, seriesId }];
  };

  // Delete is also scope-aware. Completed and canceled siblings are spared
  // when deleting a series — they're records of fact, not just future intent.
  const buildDeleteIds = (): string[] => {
    if (!appointment) return [];
    if (editScope === 'instance' || !hasSeries) return [appointment.id];
    const cutoff = new Date(appointment.startTime).getTime();
    return siblings
      .filter(s => editScope === 'all' || new Date(s.startTime).getTime() >= cutoff)
      .filter(s => s.status !== 'completed' && s.status !== 'canceled')
      .map(s => s.id);
  };

  const handleSubmit = () => {
    if (!title || !date || !startClock || !endClock) {
      alert('Title, date, start time, and end time are required.');
      return;
    }
    if (endTime <= startTime) {
      alert('End time must be after the start time (an appointment stays within one day).');
      return;
    }
    // Supervision is always with a client (a tech may or may not be present).
    if (type === 'supervision' && !clientId) {
      alert('Supervision sessions must have a client. A technician is optional but a client is required.');
      return;
    }
    const appointments = buildAppointments();
    if (appointments.length > 0) onSave(appointments);
  };

  const handleDelete = () => {
    if (!onDelete || !appointment) return;
    const ids = buildDeleteIds();
    if (ids.length === 0) {
      alert('No matching incomplete appointments to delete.');
      return;
    }
    const noun = ids.length === 1 ? 'appointment' : `${ids.length} appointments`;
    const scopeLabel =
      editScope === 'all' ? ' from the series' :
      editScope === 'following' ? ' from this date forward in the series' :
      '';
    if (!confirm(`Delete ${noun}${scopeLabel}? Completed and canceled appointments will be kept.`)) return;
    onDelete(ids);
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

  const content = (
    <>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 'bold' }}>
            {appointment ? 'Edit Appointment' : 'Add Appointment'}
          </h2>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }}>✕</button>
        </div>

        {appointment && hasSeries && (
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>
              Apply changes to
            </label>
            <ScopePicker value={editScope} onChange={setEditScope} />
            <p style={{ fontSize: 11, color: '#6b7280', marginTop: 6 }}>
              {editScope === 'instance' && 'Only this occurrence will change.'}
              {editScope === 'following' && `This and ${siblings.filter(s => new Date(s.startTime).getTime() >= new Date(appointment.startTime).getTime()).length - 1} future occurrence(s) in the series will change. Time-of-day edits keep each occurrence's original date.`}
              {editScope === 'all' && `All ${siblings.length} occurrences in the series will change. Time-of-day edits keep each occurrence's original date.`}
            </p>
          </div>
        )}

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
              <select value={type} onChange={(e) => handleTypeChange(e.target.value as Appointment['type'])} style={inputStyle}>
                <option value="client-session">Direct Service</option>
                <option value="supervision">Supervision</option>
                <option value="parent-training">Parent Training / Coord. of Care</option>
                <option value="reassessment">Reassessment</option>
                <option value="case-planning">Case Planning</option>
                <option value="internal-task">Admin Work</option>
                <option value="other">Meeting</option>
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
                <label style={labelStyle}>
                  {needsSupervisedBt ? 'Supervised BT (optional)' : 'Technician (Optional)'}
                </label>
                <select value={technicianId} onChange={(e) => setTechnicianId(e.target.value)} style={inputStyle}>
                  <option value="">— None —</option>
                  {technicians.map(t => <option key={t.id} value={t.name}>{t.name}{t.isRBT ? ' (RBT)' : ''}</option>)}
                </select>
              </div>
            )}
            <div>
              <label style={labelStyle}>Client {type === 'supervision' && '*'}</label>
              <select value={clientId} onChange={(e) => handleClientChange(e.target.value)} style={inputStyle}>
                <option value="">— None —</option>
                {clients.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
              {type === 'supervision' && (
                <p style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
                  Supervision is logged against the client. The BT being supervised is
                  inferred from whoever has a direct session with this client during this
                  time; if no one does, it's BCBA-solo time and won't count toward compliance.
                </p>
              )}
            </div>
          </div>

          <div>
            <label style={labelStyle}>Date *</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '16px' }}>
            <div>
              <label style={labelStyle}>Start time *</label>
              <input type="time" step="900" value={startClock} onChange={(e) => handleStartChange(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>End time *</label>
              <input type="time" step="900" value={endClock} onChange={(e) => { setEndClock(e.target.value); setEndManual(true); }} style={inputStyle} />
            </div>
          </div>

          <label style={{ display: 'flex', gap: '6px', alignItems: 'center', cursor: 'pointer', fontSize: 13 }}>
            <input type="checkbox" checked={moveEndWithStart} onChange={(e) => setMoveEndWithStart(e.target.checked)} />
            <span>Move end time with start time</span>
          </label>

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
                The series starts on the Date at the Start time above and repeats until
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
                Time of day comes from the Start time above. Useful for awkward / variable schedules.
              </p>
            </div>
          )}

          <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginTop: '4px', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', gap: '6px', alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={isBillable} onChange={(e) => setIsBillable(e.target.checked)} />
              <span>Billable</span>
            </label>
            <label style={{ display: 'flex', gap: '6px', alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={isMakeUp} onChange={(e) => { setIsMakeUp(e.target.checked); if (!e.target.checked) setMakeupForId(''); }} />
              <span>Make-up session</span>
            </label>
          </div>

          {isMakeUp && (
            <div style={{ padding: '10px 12px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6 }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                Making up which canceled session?
              </p>
              {!clientId || !date ? (
                <p style={{ fontSize: 12, color: '#9ca3af' }}>Pick a client and date first.</p>
              ) : makeupOptions.length === 0 ? (
                <p style={{ fontSize: 12, color: '#9ca3af' }}>
                  No canceled, not-yet-made-up sessions for this client in this auth period. Saving as a general make-up.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, cursor: 'pointer' }}>
                    <input type="radio" name="makeupFor" checked={makeupForId === ''} onChange={() => setMakeupForId('')} />
                    <span style={{ color: '#6b7280' }}>General make-up (not tied to one cancellation)</span>
                  </label>
                  {makeupOptions.map(opt => (
                    <label key={opt.appointment.id} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, cursor: 'pointer' }}>
                      <input type="radio" name="makeupFor" checked={makeupForId === opt.appointment.id} onChange={() => setMakeupForId(opt.appointment.id)} />
                      <span>
                        {opt.appointment.title} — {new Date(opt.appointment.startTime).toLocaleDateString()}{' '}
                        <span style={{ color: '#b91c1c', fontWeight: 600 }}>
                          {Math.round(opt.remainingHours * 10) / 10}h not made up
                        </span>
                        {opt.madeUpHours > 0 && <span style={{ color: '#6b7280' }}> (of {Math.round(opt.hours * 10) / 10}h)</span>}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '20px', flexWrap: 'wrap' }}>
          {appointment && onDelete && (
            <button onClick={handleDelete} style={{
              padding: '8px 14px', border: '1px solid #fca5a5', borderRadius: '6px',
              background: '#fee2e2', color: '#b91c1c', cursor: 'pointer', fontWeight: 600,
            }}>Delete</button>
          )}
          <div style={{ flex: 1 }} />
          <button onClick={onCancel} style={{
            padding: '8px 16px', border: '1px solid #d1d5db', borderRadius: '6px',
            background: 'white', cursor: 'pointer',
          }}>Cancel</button>
          <button onClick={handleSubmit} style={{
            padding: '8px 16px', backgroundColor: '#3b82f6', color: 'white',
            border: 'none', borderRadius: '6px', cursor: 'pointer',
          }}>Save</button>
        </div>
    </>
  );

  if (variant === 'inline') {
    return (
      <div style={{
        height: '100%', overflowY: 'auto', padding: 16, boxSizing: 'border-box',
        background: '#fff', WebkitOverflowScrolling: 'touch' as any,
      }}>
        {content}
      </div>
    );
  }

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
        {content}
      </div>
    </div>
  );
}

function ScopePicker({ value, onChange }: { value: EditScope; onChange: (v: EditScope) => void }) {
  const opts: { value: EditScope; label: string }[] = [
    { value: 'instance', label: 'This' },
    { value: 'following', label: 'This + Following' },
    { value: 'all', label: 'All in Series' },
  ];
  return (
    <div style={{
      display: 'flex', borderRadius: 6, overflow: 'hidden',
      border: '1px solid #d1d5db', maxWidth: '100%',
    }}>
      {opts.map(o => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          style={{
            flex: 1, padding: '6px 8px', fontSize: 12, fontWeight: 600,
            border: 'none', cursor: 'pointer',
            backgroundColor: o.value === value ? '#3b82f6' : 'white',
            color: o.value === value ? 'white' : '#374151',
            whiteSpace: 'nowrap',
          }}
        >{o.label}</button>
      ))}
    </div>
  );
}
