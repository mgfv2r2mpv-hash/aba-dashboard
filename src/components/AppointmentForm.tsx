import React, { useState } from 'react';
import { Appointment, Technician, Client, DayOfWeek, Authorization, ScheduleData, CompanySettings, BcbaSessionDefaults, DEFAULT_BCBA_SESSION_DEFAULTS, StoredRecurrencePattern } from '../types';
import { makeupCandidates, findAuthFor } from '../authorization';
import { overlapHours } from '../compliance';
import { nameOf } from '../entityRefs';
import { seriesProfileOf } from '../seriesProfile';
import { buildSeriesEdit, summarizeSeriesEdit, SeriesCadence } from '../seriesEdit';
import { materializeSeries } from '../seriesMaterialize';
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
  // signature returns the full list of upserts to apply, plus the ids a series
  // re-space / truncate / collapse removes (staged as remove ops by the caller).
  onSave: (appointments: Appointment[], removeIds?: string[]) => void;
  // Delete is scope-aware too — returns the ids to remove (empty array on cancel).
  onDelete?: (ids: string[]) => void;
  onCancel: () => void;
  // Extend a recurring series forward: materialize missing occurrences (staged for
  // review). Only offered when editing an occurrence that carries a seriesId.
  onExtendSeries?: (seriesId: string, endDateISO: string) => void;
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
  onExtendSeries,
  variant = 'modal',
}: AppointmentFormProps) {
  const [title, setTitle] = useState(appointment?.title || '');
  const [description, setDescription] = useState(appointment?.description || '');
  const [type, setType] = useState<Appointment['type']>(appointment?.type || initialType || 'client-session');
  // Parent-training / case-planning can be caregiver-only sessions, so they carry
  // an OPTIONAL "supervised BT" — the technician field names the BT being observed
  // (not a provider), and the overlap with that BT's direct earns supervision.
  // Supervision itself stays client-only (the BT is inferred from the overlap).
  const needsSupervisedBt = type === 'parent-training' || type === 'case-planning' || type === 'reassessment';
  const [technicianId, setTechnicianId] = useState(appointment?.technician || '');
  const [clientId, setClientId] = useState(appointment?.client || '');
  // btPresent: for non-direct non-supervision types, whether a BT is named on the session.
  // Initialized true when editing an appointment that already has a technician set.
  const [btPresent, setBtPresent] = useState(() =>
    !!appointment?.id && !!appointment.technician && appointment.type !== 'client-session'
  );
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
  // Locked = the auto-scheduler and draft engine won't move this session. Defaults
  // off; previously only preserved (no edit control), now directly togglable.
  const [isFixed, setIsFixed] = useState(appointment?.isFixed ?? false);

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

  // BTs filtered to those assigned to this client, or all BTs if no client or no assignments.
  const techsForClient = (clientRef: string): Technician[] => {
    const client = clients.find(c => c.id === clientRef);
    if (!client) return technicians;
    const filtered = technicians.filter(t => t.assignments?.some(a => a.clientId === client.id));
    return filtered.length > 0 ? filtered : technicians;
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
    if (t !== 'client-session') {
      setBtPresent(false);
      setTechnicianId('');
    }
    applyAuthDefaultEnd(t, clientId, startClock, date);
  };

  const handleClientChange = (c: string) => {
    setClientId(c);
    // Reset BT if they're no longer in the filtered set for the new client.
    if (technicianId) {
      const client = clients.find(cl => cl.id === c);
      if (client) {
        const filtered = technicians.filter(t => t.assignments?.some(a => a.clientId === client.id));
        if (filtered.length > 0 && !filtered.find(t => t.id === technicianId)) {
          setTechnicianId('');
        }
      }
    }
    applyAuthDefaultEnd(type, c, startClock, date);
  };

  // Inline conflict warning for direct service: another client-session for the same
  // client that overlaps this appointment's time slot.
  const conflictingDirectAppt = (type === 'client-session' && clientId && startTime && endTime)
    ? (allAppointments || []).find(a =>
        a.id !== appointment?.id &&
        a.type === 'client-session' &&
        a.client === clientId &&
        a.status !== 'canceled' &&
        overlapHours(a, { startTime, endTime } as Appointment) > 0
      )
    : undefined;

  // Canceled, not-fully-made-up sessions for this client within the auth
  // covering the chosen date (same calendar month when no auth covers it).
  const makeupOptions = (isMakeUp && clientId && date)
    ? makeupCandidates(
        { appointments: allAppointments || [], authorizations: authorizations || [], clients } as unknown as ScheduleData,
        clientId, date, appointment?.id,
      )
    : [];

  // All other occurrences sharing this appointment's seriesId. When editing,
  // the scope picker only matters if there's a real series to act on.
  const siblings = (appointment?.seriesId && allAppointments)
    ? allAppointments.filter(a => a.seriesId === appointment.seriesId)
    : [];
  const hasSeries = siblings.length > 1;
  // The series' MEASURED profile — pattern from the members' own dates (the
  // single cadence oracle), not the stored isRecurring label, which can lie.
  const seriesProfile = (hasSeries && appointment?.seriesId && allAppointments)
    ? seriesProfileOf(allAppointments, appointment.seriesId)
    : null;

  // Recurrence — seeded from the measured profile: a real series shows its real
  // cadence; a one-time (or stale flag-only) row honestly shows One-time.
  const [recurrence, setRecurrence] = useState<RecurrencePattern>(() => {
    if (!appointment) return 'none';
    if (seriesProfile) return seriesProfile.pattern === 'custom' ? 'custom-days' : seriesProfile.pattern;
    return 'none';
  });
  const [selectedDays, setSelectedDays] = useState<Set<DayOfWeek>>(() => new Set(
    seriesProfile?.pattern === 'custom' ? seriesProfile.weekdays.map(w => DAYS[(w + 6) % 7]) : [],
  ));
  const [customDates, setCustomDates] = useState<string>(''); // newline-separated YYYY-MM-DD
  const [recurrenceEnd, setRecurrenceEnd] = useState<string>('');
  const [editScope, setEditScope] = useState<EditScope>('instance');
  // Extend-series horizon defaults to the client's authorization end (never schedule
  // past auth); the user can shorten it. Empty when the client has no auth on file.
  const [extendThrough, setExtendThrough] = useState<string>(() => {
    const cid = appointment?.client;
    const auth = (authorizations || []).filter(a => a.clientId === cid).sort((a, b) => b.endDate.localeCompare(a.endDate))[0];
    return auth?.endDate ?? '';
  });

  const toggleDay = (day: DayOfWeek) => {
    const next = new Set(selectedDays);
    if (next.has(day)) next.delete(day); else next.add(day);
    setSelectedDays(next);
  };

  // The cadence directive for a series-scope edit: null = unchanged (a plain
  // shift/retime/field edit), 'none' = One-time selected (truncate/collapse),
  // else the new pattern spec. Derived by comparing the select against the
  // MEASURED profile so re-selecting the current cadence stays a no-op.
  const seriesCadence: SeriesCadence = (() => {
    if (!hasSeries || !seriesProfile) return null;
    if (recurrence === 'none') return 'none';
    const uiPattern: StoredRecurrencePattern = recurrence === 'custom-days' ? 'custom' : recurrence as StoredRecurrencePattern;
    const weekdays = [...selectedDays].map(d => (DAYS.indexOf(d) + 1) % 7).sort((a, b) => a - b);
    if (uiPattern === seriesProfile.pattern) {
      if (uiPattern !== 'custom') return null;
      // Same 'custom' pattern but a different weekday set is still a re-space.
      if (JSON.stringify(weekdays) === JSON.stringify(seriesProfile.weekdays)) return null;
    }
    return uiPattern === 'custom' ? { pattern: 'custom', weekdays } : { pattern: uiPattern };
  })();

  // The edited occurrence as the form currently describes it (same id).
  const editedForm = (): Appointment | null => {
    if (!appointment || !startTime || !endTime) return null;
    return {
      ...appointment,
      title, description, type,
      technician: type === 'supervision' ? '' : technicianId,
      client: clientId,
      isBillable,
      startTime, endTime,
    };
  };

  // Live preview of a series-scope edit — the consequence is visible BEFORE
  // Save ("Removes 6 upcoming sessions", "Moves 5 upcoming sessions to
  // Wednesday", …). Only shown when the edit actually rewrites the series.
  const seriesPreview = (() => {
    if (!appointment || !hasSeries || editScope === 'instance' || isMakeUp) return null;
    const edited = editedForm();
    if (!edited) return null;
    const dateChanged = date !== appointment.startTime.slice(0, 10);
    if (seriesCadence === null && !dateChanged) return null;
    try {
      return summarizeSeriesEdit(buildSeriesEdit({
        all: allAppointments || [], original: appointment, edited,
        scope: editScope, cadence: seriesCadence,
      }));
    } catch { return null; }
  })();

  const buildAppointments = (): { appointments: Appointment[]; removeIds: string[] } => {
    const editing = !!appointment?.id;

    // Series-scope edits ride the real series engine: day-delta shifts, cadence
    // re-materialization, truncate/collapse — facts always spared. A make-up is
    // never part of a series, so series-scope edits don't apply.
    if (editing && hasSeries && editScope !== 'instance' && !isMakeUp) {
      const edited = editedForm();
      if (!edited) return { appointments: [], removeIds: [] };
      const r = buildSeriesEdit({
        all: allAppointments || [], original: appointment!, edited,
        scope: editScope, cadence: seriesCadence,
      });
      return { appointments: r.upserts, removeIds: r.removeIds };
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
      isFixed,
      isBillable,
      isMakeUp: isMakeUp || undefined,
      makeupForId: isMakeUp && makeupForId ? makeupForId : undefined,
      // Instance edit preserves the stored trio VERBATIM (the cadence select is
      // disabled under "just this", so nothing here can drift) — except a
      // make-up conversion, which is inherently a one-off and drops the series.
      isRecurring: isMakeUp ? undefined : appointment?.isRecurring,
      recurringPattern: isMakeUp ? undefined : appointment?.recurringPattern,
      seriesId: isMakeUp ? undefined : appointment?.seriesId,
    };

    // A make-up is a single dated session; never expands.
    if (isMakeUp) return { appointments: [base], removeIds: [] };

    // Instance-scope edit on a series member: just this row, trio preserved.
    if (editing && hasSeries) return { appointments: [base], removeIds: [] };

    if (recurrence === 'none') return { appointments: [base], removeIds: [] };

    // New recurring appointment OR a one-time→recurring conversion on an
    // existing non-series row (base keeps its id): materialize the bounded
    // series — every occurrence born with the full trio.
    const authEnd = (() => {
      if (!clientId || !date) return undefined;
      const auth = findAuthFor(
        { appointments: allAppointments || [], authorizations: authorizations || [], clients } as unknown as ScheduleData,
        clientId, date,
      );
      return auth?.endDate;
    })();
    return {
      appointments: materializeSeries({
        base, recurrence,
        selectedDays: [...selectedDays],
        customDates: customDates.split(/\s+/).filter(Boolean),
        recurrenceEnd: recurrenceEnd || undefined,
        authEnd,
      }),
      removeIds: [],
    };
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
    const { appointments, removeIds } = buildAppointments();
    if (appointments.length > 0 || removeIds.length > 0) onSave(appointments, removeIds);
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
    padding: '10px 12px',
    border: 'var(--border-control)',
    borderRadius: 'var(--radius-lg)',
    fontSize: '15px',
    color: 'var(--text-primary)',
    background: 'var(--surface-card)',
    boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontWeight: 700,
    marginBottom: '5px',
    fontSize: '11px',
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    color: '#6b7280',
  };

  // Subtle group heading that segments the form into sections.
  const groupHeader = (label: string, first = false): React.CSSProperties => ({
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: '0.07em',
    textTransform: 'uppercase',
    color: '#9ca3af',
    marginTop: first ? 0 : 8,
    paddingTop: first ? 0 : 12,
    borderTop: first ? 'none' : '1px solid #f1f5f9',
  });

  // Accent color keyed to the session type, echoed in the header bar.
  const typeAccent = type === 'client-session' ? 'var(--type-direct)'
    : type === 'supervision' ? 'var(--type-supervision)'
    : type === 'parent-training' ? 'var(--type-parent-training)'
    : type === 'reassessment' ? 'var(--type-reassessment)'
    : type === 'case-planning' ? 'var(--type-case-planning)'
    : 'var(--type-admin)';

  // Assignment section varies by type.
  const assignmentSection = (() => {
    // Client dropdown — shared by all types.
    const clientDropdown = (
      <div>
        <label style={labelStyle}>Client {type === 'supervision' && '*'}</label>
        <select value={clientId} onChange={(e) => handleClientChange(e.target.value)} style={inputStyle}>
          <option value="">— None —</option>
          {/* Archived cases are off the caseload — hide them, but keep the current
              selection so editing an existing session isn't broken. */}
          {clients.filter(c => !c.archived || c.id === clientId).map(c => <option key={c.id} value={c.id}>{c.name}{c.archived ? ' (archived)' : ''}</option>)}
        </select>
        {type === 'supervision' && (
          <p style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
            Supervision is logged against the client. The BT being supervised is
            inferred from whoever has a direct session with this client during this
            time; if no one does, it's BCBA-solo time and won't count toward compliance.
          </p>
        )}
      </div>
    );

    if (type === 'supervision') {
      return clientDropdown;
    }

    const filteredTechs = techsForClient(clientId);
    const btDropdown = (
      <div>
        <label style={labelStyle}>
          {needsSupervisedBt ? 'Supervised BT (optional)' : 'Technician (optional)'}
        </label>
        <select value={technicianId} onChange={(e) => setTechnicianId(e.target.value)} style={inputStyle}>
          <option value="">— None —</option>
          {filteredTechs.map(t => <option key={t.id} value={t.id}>{t.name}{t.isRBT ? ' (RBT)' : ''}</option>)}
        </select>
      </div>
    );

    if (type === 'client-session') {
      return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
          {clientDropdown}
          {btDropdown}
        </div>
      );
    }

    // All other types: client first, then optional BT via checkbox.
    return (
      <div style={{ display: 'grid', gap: '12px' }}>
        {clientDropdown}
        <label style={{ display: 'flex', gap: '6px', alignItems: 'center', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={btPresent}
            onChange={(e) => {
              setBtPresent(e.target.checked);
              if (!e.target.checked) setTechnicianId('');
            }}
          />
          <span style={{ fontSize: 13 }}>BT present?</span>
        </label>
        {btPresent && btDropdown}
      </div>
    );
  })();

  const content = (
    <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <span style={{ width: 4, alignSelf: 'stretch', minHeight: 28, borderRadius: 2, background: typeAccent }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: typeAccent }}>
              {appointment ? 'Edit session' : 'New session'}
            </div>
            <h2 style={{ fontSize: 19, fontWeight: 800, color: '#111827', margin: 0, lineHeight: 1.2 }}>
              {title || (appointment ? 'Appointment' : 'Add appointment')}
            </h2>
          </div>
          <button className="af-btn" onClick={onCancel} aria-label="Close" style={{
            background: '#f3f4f6', border: 'none', width: 30, height: 30, borderRadius: 8,
            fontSize: 16, cursor: 'pointer', color: '#6b7280', flexShrink: 0,
          }}>✕</button>
        </div>

        {appointment && hasSeries && (
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-body)', display: 'block', marginBottom: 6 }}>
              Apply changes to
            </label>
            <ScopePicker value={editScope} onChange={setEditScope} />
            <p style={{ fontSize: 11, color: '#6b7280', marginTop: 6 }}>
              {editScope === 'instance' && 'Only this occurrence will change.'}
              {editScope === 'following' && `This and ${siblings.filter(s => new Date(s.startTime).getTime() >= new Date(appointment.startTime).getTime()).length - 1} future occurrence(s) in the series will change. A date change moves each occurrence by the same number of days; completed/canceled sessions are never touched.`}
              {editScope === 'all' && `All ${siblings.length} occurrences in the series will change. A date change moves each occurrence by the same number of days; completed/canceled sessions are never touched.`}
            </p>
          </div>
        )}

        <div style={{ display: 'grid', gap: '12px' }}>
          <div style={groupHeader('Details', true)}>Details</div>
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
              {/* A make-up is one-off by definition — force and lock it to One-time
                  so a recurring series of make-ups can't be created. On a series
                  member the select is scope-gated: cadence is a SERIES property,
                  so "just this" can't change it (that path used to mint flag-only
                  half-states). */}
              <select
                value={isMakeUp ? 'none' : recurrence}
                onChange={(e) => setRecurrence(e.target.value as RecurrencePattern)}
                disabled={isMakeUp || (hasSeries && editScope === 'instance')}
                style={{ ...inputStyle, ...(isMakeUp || (hasSeries && editScope === 'instance') ? { opacity: 0.6, cursor: 'not-allowed' } : {}) }}
                title={isMakeUp ? 'Make-up sessions are always one-time.'
                  : hasSeries && editScope === 'instance' ? "Switch to 'This + Following' or 'All in Series' to change how often this repeats." : undefined}
              >
                <option value="none">One-time</option>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Every 2 weeks</option>
                <option value="monthly">Monthly</option>
                <option value="custom-days">Custom days of week</option>
                {/* Re-spacing a series onto an explicit date list isn't a cadence —
                    only offered when creating / converting, not on a series member. */}
                {!hasSeries && <option value="custom-dates">Specific dates</option>}
              </select>
              {hasSeries && editScope === 'instance' && !isMakeUp && (
                <p style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
                  Switch to “This + Following” or “All in Series” to change how often this repeats.
                </p>
              )}
              {seriesPreview && (
                <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--status-behind, #b45309)', marginTop: 6 }}>
                  {seriesPreview}
                </p>
              )}
            </div>
          </div>

          {appointment?.seriesId && hasSeries && onExtendSeries && (
            <div style={{ padding: '10px 12px', background: 'var(--surface-sunken)', border: 'var(--border-hairline)', borderRadius: 'var(--radius-md)', marginTop: 8 }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-body)', marginBottom: 4 }}>Extend this recurring series</p>
              <p style={{ fontSize: 11, color: '#6b7280', marginBottom: 8 }}>
                Fills in the missing occurrences forward through the date below — staged in the dock for review, not committed. Defaults to the client’s authorization end.
              </p>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  type="date"
                  value={extendThrough}
                  min={date || undefined}
                  onChange={(e) => setExtendThrough(e.target.value)}
                  style={{ ...inputStyle, flex: '1 1 140px' }}
                />
                <button
                  type="button"
                  onClick={() => { if (appointment.seriesId && extendThrough) onExtendSeries(appointment.seriesId, extendThrough); }}
                  disabled={!extendThrough}
                  style={{ background: 'var(--sage-600, #4d7c4d)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', padding: '8px 14px', fontWeight: 600, cursor: extendThrough ? 'pointer' : 'not-allowed', opacity: extendThrough ? 1 : 0.6 }}
                >Extend series →</button>
              </div>
            </div>
          )}

          <div style={groupHeader('Assignment')}>Assignment</div>
          {assignmentSection}

          <div style={groupHeader('Options')}>Options</div>
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginTop: '4px', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', gap: '6px', alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={isBillable} onChange={(e) => setIsBillable(e.target.checked)} />
              <span>Billable</span>
            </label>
            <label style={{ display: 'flex', gap: '6px', alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={isMakeUp} onChange={(e) => { setIsMakeUp(e.target.checked); if (!e.target.checked) setMakeupForId(''); }} />
              <span>Make-up session</span>
            </label>
            <label style={{ display: 'flex', gap: '6px', alignItems: 'center', cursor: 'pointer' }} title="Lock this session so the scheduler and drafts won't move it.">
              <input type="checkbox" checked={isFixed} onChange={(e) => setIsFixed(e.target.checked)} />
              <span>Locked (don’t move)</span>
            </label>
          </div>

          {isMakeUp && (
            <div style={{ padding: '10px 12px', background: 'var(--surface-sunken)', border: 'var(--border-hairline)', borderRadius: 'var(--radius-md)' }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-body)', marginBottom: 6 }}>
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
                        <span style={{ color: 'var(--status-behind)', fontWeight: 600 }}>
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

          <div style={groupHeader('Schedule')}>Schedule</div>
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
                    disabled={hasSeries && editScope === 'instance'}
                    onClick={() => toggleDay(day)}
                    style={{
                      padding: '6px 10px',
                      border: 'var(--border-control)',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: selectedDays.has(day) ? 'var(--brand-primary)' : 'var(--surface-card)',
                      color: selectedDays.has(day) ? 'var(--brand-primary-text)' : 'var(--text-body)',
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

          {/* End-of-recurrence input for a NEW series (or a one-time→recurring
              conversion). An existing series' horizon is grown via Extend above. */}
          {!hasSeries && (recurrence === 'weekly' || recurrence === 'biweekly' || recurrence === 'monthly' || recurrence === 'custom-days') && (
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
                this date (or the client's auth end date if left blank; falls back to 90 days if no auth).
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

        </div>

        {conflictingDirectAppt && (
          <div style={{
            marginTop: 12, padding: '8px 12px',
            background: '#fffbeb', border: '1px solid #fbbf24',
            borderRadius: 'var(--radius-md)', fontSize: 13, color: '#92400e',
          }}>
            ⚠ {nameOf(clients, clientId)}{conflictingDirectAppt.technician ? ` / ${nameOf(technicians, conflictingDirectAppt.technician)}` : ''} is assigned to a Direct Service appointment at this time:{' '}
            {conflictingDirectAppt.startTime.slice(11, 16)}–{conflictingDirectAppt.endTime.slice(11, 16)}
          </div>
        )}

        <div style={{
          display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap',
          position: 'sticky', bottom: 0, marginTop: 18, paddingTop: 14,
          // In the phone slide-up sheet this sticky row pins to the bottom of a
          // fixed panel, so it must inset itself past the home indicator / bottom
          // nav — the outer sheet padding doesn't reach a nested sticky element.
          paddingBottom: variant === 'inline' ? 'max(14px, env(safe-area-inset-bottom))' : undefined,
          borderTop: 'var(--border-hairline)',
          background: 'var(--surface-card)',
        }}>
          {appointment && onDelete && (
            <button className="af-btn" onClick={handleDelete} style={{
              padding: '10px 16px', border: '1px solid var(--red-300)', borderRadius: 'var(--radius-lg)',
              background: 'var(--status-behind-bg)', color: 'var(--status-behind)', cursor: 'pointer', fontWeight: 700, fontSize: 14,
            }}>Delete</button>
          )}
          <div style={{ flex: 1 }} />
          <button className="af-btn" onClick={onCancel} style={{
            padding: '10px 18px', border: 'var(--border-control)', borderRadius: 'var(--radius-lg)',
            background: 'var(--surface-card)', cursor: 'pointer', fontWeight: 600, fontSize: 14, color: 'var(--text-body)',
          }}>Cancel</button>
          <button className="af-btn" onClick={handleSubmit} style={{
            padding: '10px 22px', backgroundColor: typeAccent, color: 'white',
            border: 'none', borderRadius: 'var(--radius-lg)', cursor: 'pointer', fontWeight: 700, fontSize: 14,
            boxShadow: 'var(--shadow-sm)',
          }}>{appointment ? 'Save changes' : 'Add session'}</button>
        </div>
    </>
  );

  if (variant === 'inline') {
    return (
      <div className="af-form" style={{
        height: '100%', overflowY: 'auto', padding: 16, paddingBottom: 20,
        boxSizing: 'border-box', background: '#fff',
        WebkitOverflowScrolling: 'touch' as any,
      }}>
        {content}
      </div>
    );
  }

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(17,24,39,0.55)', backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      padding: 'max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left))',
      boxSizing: 'border-box',
    }}>
      <div className="af-form" style={{
        backgroundColor: 'var(--surface-card)', borderRadius: 'var(--radius-xl)', padding: '20px', paddingBottom: 20,
        width: '100%', maxWidth: 600, maxHeight: '100%', overflowY: 'auto',
        boxSizing: 'border-box', boxShadow: 'var(--shadow-pop)',
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
      display: 'flex', borderRadius: 'var(--radius-md)', overflow: 'hidden',
      border: 'var(--border-control)', maxWidth: '100%',
    }}>
      {opts.map(o => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          style={{
            flex: 1, padding: '6px 8px', fontSize: 12, fontWeight: 600,
            border: 'none', cursor: 'pointer',
            backgroundColor: o.value === value ? 'var(--brand-primary)' : 'var(--surface-card)',
            color: o.value === value ? 'var(--brand-primary-text)' : 'var(--text-body)',
            whiteSpace: 'nowrap',
          }}
        >{o.label}</button>
      ))}
    </div>
  );
}
