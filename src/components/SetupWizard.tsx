import React, { useState } from 'react';
import {
  ScheduleData, Client, Technician, CompanySettings, DayOfWeek,
  BACB_RBT_SUPERVISION_MIN_PERCENT, DEFAULT_CANCELLATION_NOTICE, TrainingPeriodUnit,
} from '../types';
import { v4 as uuidv4 } from 'uuid';
import { PRESET_WINDOWS, WEEKDAYS, mergeWindows } from '../availabilityUtils';
import { useMinWidth } from '../useMediaQuery';
import { checkIdentifier } from '../identifierPolicy';
import {
  SectionBand, Row, Pills, Disclosure, Callout, WeeklyAvailability, IdentifierField, inputStyle,
} from './setup/SetupControls';

interface SetupWizardProps {
  onComplete: (data: ScheduleData) => void;
  onCancel: () => void;
  // When re-run from an existing schedule, prefill the form with current data.
  // Company/clients/technicians are editable here; appointments and the
  // authorization/blackout records are carried through untouched on finish.
  initialData?: ScheduleData;
}

// Setup is ONE scrolling page: practice, cases and staff are all visible at
// once and a single button at the foot creates the schedule. There is no step
// machine — a clinician can see everything setup will ask for before they
// answer any of it, and can go back to an earlier answer by scrolling.
//
// Identity note: every case and every technician is minted with a uuid here,
// and every link (assignment, appointment) carries that uuid. The name is a
// display label the clinician may change at any time without breaking a link,
// and is never what leaves this device. See identifierPolicy.ts.
export default function SetupWizard({ onComplete, onCancel, initialData }: SetupWizardProps) {
  const wide = useMinWidth(760);
  const seed = initialData?.settings;

  const [practiceName, setPracticeName] = useState(seed?.practiceName ?? '');
  const [settings, setSettings] = useState<CompanySettings>(seed ?? {
    supervisionDirectHoursPercent: 5,
    supervisionRBTHoursPercent: BACB_RBT_SUPERVISION_MIN_PERCENT,
    parentTraining: {
      minimumHours: 1.5,
      targetMinHours: 2,
      targetMaxHours: 4,
      periodUnit: 'month',
    },
    clinicianAvailability: Object.fromEntries(
      WEEKDAYS.map(d => [d, mergeWindows(Object.values(PRESET_WINDOWS).map(w => ({ ...w })))]),
    ),
  });

  // Policy numbers are held as strings while being typed so a half-entered
  // "1." does not round-trip through parseFloat and fight the caret.
  const [supDirectStr, setSupDirectStr] = useState(seed ? String(seed.supervisionDirectHoursPercent) : '5');
  const [supRBTStr, setSupRBTStr] = useState(seed ? String(seed.supervisionRBTHoursPercent) : String(BACB_RBT_SUPERVISION_MIN_PERCENT));
  const [rbtOverride, setRBTOverride] = useState(!!seed && seed.supervisionRBTHoursPercent !== BACB_RBT_SUPERVISION_MIN_PERCENT);
  const [supTechStr, setSupTechStr] = useState(seed?.supervisionTechHoursPercent != null ? String(seed.supervisionTechHoursPercent) : '0');
  const [supMaxStr, setSupMaxStr] = useState(seed ? (seed.supervisionMaxHoursPercent != null ? String(seed.supervisionMaxHoursPercent) : '') : '20');
  const [minHoursStr, setMinHoursStr] = useState(seed ? String(seed.parentTraining.minimumHours) : '1.5');
  const [targetMinStr, setTargetMinStr] = useState(seed ? String(seed.parentTraining.targetMinHours) : '2');
  const [targetMaxStr, setTargetMaxStr] = useState(seed ? String(seed.parentTraining.targetMaxHours) : '4');
  const [unplannedHoursStr, setUnplannedHoursStr] = useState(String(seed?.cancellationNotice?.unplannedHoursThreshold ?? DEFAULT_CANCELLATION_NOTICE.unplannedHoursThreshold));
  const [plannedDaysStr, setPlannedDaysStr] = useState(String(seed?.cancellationNotice?.plannedDaysThreshold ?? DEFAULT_CANCELLATION_NOTICE.plannedDaysThreshold));

  const [clients, setClients] = useState<Client[]>(initialData ? initialData.clients.map(c => ({ ...c })) : []);
  const [technicians, setTechnicians] = useState<Technician[]>(initialData ? initialData.technicians.map(t => ({ ...t })) : []);
  const [assignmentHoursStr, setAssignmentHoursStr] = useState<{ [key: string]: string }>({});

  const addClient = () => setClients([...clients, { id: uuidv4(), name: '', availabilityWindows: {} }]);
  const updateClient = (id: string, patch: Partial<Client>) =>
    setClients(clients.map(c => c.id === id ? { ...c, ...patch } : c));
  const removeClient = (id: string) => setClients(clients.filter(c => c.id !== id));

  const addTechnician = () => setTechnicians([...technicians, {
    id: uuidv4(), name: '', isRBT: false, assignments: [], availability: {},
  }]);
  const updateTechnician = (id: string, patch: Partial<Technician>) =>
    setTechnicians(technicians.map(t => t.id === id ? { ...t, ...patch } : t));
  const removeTechnician = (id: string) => setTechnicians(technicians.filter(t => t.id !== id));

  const num = (val: string, fallback = 0): number => {
    const parsed = parseFloat(val);
    return isNaN(parsed) ? fallback : parsed;
  };

  const composeSettings = (): CompanySettings => ({
    ...settings,
    practiceName: practiceName.trim() || undefined,
    supervisionDirectHoursPercent: num(supDirectStr, 5),
    supervisionRBTHoursPercent: rbtOverride
      ? num(supRBTStr, BACB_RBT_SUPERVISION_MIN_PERCENT)
      : BACB_RBT_SUPERVISION_MIN_PERCENT,
    supervisionTechHoursPercent: num(supTechStr, 0),
    supervisionMaxHoursPercent: supMaxStr.trim() === '' ? undefined : num(supMaxStr, 20),
    parentTraining: {
      ...settings.parentTraining,
      minimumHours: num(minHoursStr, 1.5),
      targetMinHours: num(targetMinStr, 2),
      targetMaxHours: num(targetMaxStr, 4),
    },
    cancellationNotice: {
      unplannedHoursThreshold: num(unplannedHoursStr, DEFAULT_CANCELLATION_NOTICE.unplannedHoursThreshold),
      plannedDaysThreshold: num(plannedDaysStr, DEFAULT_CANCELLATION_NOTICE.plannedDaysThreshold),
    },
  });

  const finish = () => {
    const techniciansWithParsedHours = technicians.map(t => ({
      ...t,
      assignments: t.assignments.map((a, idx) => ({
        ...a,
        hoursPerWeek: num(assignmentHoursStr[`${t.id}_${idx}`] ?? String(a.hoursPerWeek), 0),
      })),
    }));
    onComplete({
      // Re-running on an existing schedule edits only company/clients/techs;
      // appointments and the auth/blackout/usage records carry through so
      // setup never silently drops the calendar.
      id: initialData?.id ?? uuidv4(),
      version: initialData?.version ?? 1,
      clients,
      technicians: techniciansWithParsedHours,
      settings: composeSettings(),
      appointments: initialData?.appointments ?? [],
      blackouts: initialData?.blackouts,
      authorizations: initialData?.authorizations,
      manualUsage: initialData?.manualUsage,
      lastModified: new Date().toISOString(),
    });
  };

  const twoCol: React.CSSProperties = wide
    ? { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }
    : { display: 'grid', gap: '14px' };

  const rowProps = { narrow: !wide };
  const entryCard: React.CSSProperties = {
    padding: '14px',
    border: '1px solid var(--border-default)',
    borderRadius: 'var(--radius-md)',
    background: 'var(--surface-sunken)',
    marginBottom: '12px',
    minWidth: 0,
  };
  const addBtn: React.CSSProperties = {
    padding: '8px 14px',
    fontSize: '13px',
    fontWeight: 700,
    cursor: 'pointer',
    background: 'var(--surface-card)',
    color: 'var(--text-link)',
    border: '1px solid var(--sage-500)',
    borderRadius: 'var(--radius-md)',
  };
  const removeBtn: React.CSSProperties = {
    width: '32px', height: '32px', padding: 0, flexShrink: 0, cursor: 'pointer',
    background: 'var(--status-behind-bg)', color: 'var(--status-behind)',
    border: '1px solid var(--red-300)', borderRadius: 'var(--radius-sm)',
    fontSize: '18px', lineHeight: 1,
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'var(--surface-page)',
      overflowY: 'auto', overflowX: 'hidden',
      paddingTop: 'env(safe-area-inset-top)',
      paddingBottom: 'env(safe-area-inset-bottom)',
    }}>
      <div style={{
        maxWidth: '880px', margin: '0 auto', padding: '26px 20px 40px',
        boxSizing: 'border-box', minWidth: 0,
      }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: '22px', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
              Set up your schedule
            </h2>
            <p style={{ fontSize: '13.5px', color: 'var(--text-muted)', margin: '6px 0 0' }}>
              Everything on one page. Nothing here is permanent — all of it stays editable in Admin
              afterwards.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel setup"
            style={{ background: 'none', border: 'none', fontSize: '22px', cursor: 'pointer', lineHeight: 1, color: 'var(--text-muted)', flexShrink: 0 }}
          >✕</button>
        </div>

        {/* ── Practice ── */}
        <SectionBand>Practice</SectionBand>

        <Row {...rowProps} label="Practice name" htmlFor="setup-practice"
          explainer="Used to name the backup file you download.">
          <input
            id="setup-practice"
            value={practiceName}
            onChange={e => setPracticeName(e.target.value)}
            placeholder="e.g. Riverbend ABA"
            style={inputStyle}
          />
        </Row>

        <Row {...rowProps} label="Your availability"
          explainer="When you, the supervising analyst, can be scheduled. Sessions cannot ethically be placed outside these windows.">
          <WeeklyAvailability
            idPrefix="clinician"
            availability={settings.clinicianAvailability || {}}
            onChange={av => setSettings({ ...settings, clinicianAvailability: av })}
            defaultWindow={{ start: '09:00', end: '17:00' }}
          />
        </Row>

        <Disclosure summary="Policy settings — supervision percentages, parent training, cancellation notice">
          <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', margin: '0 0 14px', lineHeight: 1.5 }}>
            These are pre-filled to BACB-aligned defaults and stay editable in Admin. Open this only if
            your practice differs from the defaults.
          </p>

          <div style={twoCol}>
            <div>
              <label htmlFor="sup-direct" style={labelSm}>Supervision: % of direct hours</label>
              <input id="sup-direct" type="number" step="0.1" value={supDirectStr}
                onChange={e => setSupDirectStr(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label htmlFor="sup-rbt" style={labelSm}>Supervision: % of RBT hours</label>
              <input id="sup-rbt" type="number" step="0.1" disabled={!rbtOverride}
                value={rbtOverride ? supRBTStr : String(BACB_RBT_SUPERVISION_MIN_PERCENT)}
                onChange={e => setSupRBTStr(e.target.value)}
                style={{ ...inputStyle, opacity: rbtOverride ? 1 : 0.6 }} />
              <label style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '12px', marginTop: '6px', cursor: 'pointer' }}>
                <input type="checkbox" checked={rbtOverride} onChange={e => setRBTOverride(e.target.checked)} />
                <span>Override the BACB {BACB_RBT_SUPERVISION_MIN_PERCENT}% minimum</span>
              </label>
            </div>
            <div>
              <label htmlFor="sup-tech" style={labelSm}>Supervision: % of non-RBT BT hours</label>
              <input id="sup-tech" type="number" step="0.1" min="0" value={supTechStr}
                onChange={e => setSupTechStr(e.target.value)} style={inputStyle} />
              <p style={hintSm}>No BACB rule applies. 0 skips the check.</p>
            </div>
            <div>
              <label htmlFor="sup-max" style={labelSm}>Supervision cap (insurer max %)</label>
              <input id="sup-max" type="number" step="0.1" min="0" placeholder="e.g. 20" value={supMaxStr}
                onChange={e => setSupMaxStr(e.target.value)} style={inputStyle} />
              <p style={hintSm}>Blank disables the cap warning.</p>
            </div>
          </div>

          <div style={{ marginTop: '16px' }}>
            <label style={labelSm}>Parent training period</label>
            <Pills
              ariaLabel="Parent training period"
              value={settings.parentTraining.periodUnit}
              onChange={(v: TrainingPeriodUnit) => setSettings({
                ...settings, parentTraining: { ...settings.parentTraining, periodUnit: v },
              })}
              options={[
                { value: 'week' as TrainingPeriodUnit, label: 'per week' },
                { value: 'month' as TrainingPeriodUnit, label: 'per month' },
                { value: 'sixMonths' as TrainingPeriodUnit, label: 'per 6 months' },
                { value: 'year' as TrainingPeriodUnit, label: 'per year' },
              ]}
            />
          </div>

          <div style={{ ...twoCol, marginTop: '14px' }}>
            <div>
              <label htmlFor="pt-min" style={labelSm}>Parent training: min hours</label>
              <input id="pt-min" type="number" step="0.1" value={minHoursStr}
                onChange={e => setMinHoursStr(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label htmlFor="pt-tmin" style={labelSm}>Target min</label>
              <input id="pt-tmin" type="number" step="0.5" value={targetMinStr}
                onChange={e => setTargetMinStr(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label htmlFor="pt-tmax" style={labelSm}>Target max</label>
              <input id="pt-tmax" type="number" step="0.5" value={targetMaxStr}
                onChange={e => setTargetMaxStr(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label htmlFor="cancel-hours" style={labelSm}>Unplanned cancellation: hours of notice</label>
              <input id="cancel-hours" type="number" step="1" min="0" value={unplannedHoursStr}
                onChange={e => setUnplannedHoursStr(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label htmlFor="cancel-days" style={labelSm}>Planned cancellation: days of notice</label>
              <input id="cancel-days" type="number" step="1" min="0" value={plannedDaysStr}
                onChange={e => setPlannedDaysStr(e.target.value)} style={inputStyle} />
            </div>
          </div>
        </Disclosure>

        {/* ── Cases ── */}
        <SectionBand>Cases</SectionBand>

        <Callout tone="info" title="Use an anonymised identifier.">
          Initials, a case code, or a first name and last initial — whatever you would write on a
          whiteboard. SAssi links every session to a hidden ID, so you can rename a case at any time
          without breaking anything.
        </Callout>

        <Row {...rowProps} label={`Cases (${clients.length})`}
          explainer="One entry per client, with the windows they are available for sessions.">
          <div>
            {clients.map(c => (
              <div key={c.id} style={entryCard}>
                <IdentifierField
                  label="Case identifier"
                  placeholder="Case identifier, e.g. SB-04"
                  value={c.name}
                  entityId={c.id}
                  verdict={checkIdentifier(c.name)}
                  onChange={v => updateClient(c.id, { name: v })}
                  onRemove={() => removeClient(c.id)}
                  removeLabel="Remove case"
                />
                <label style={labelSm}>
                  Parent-training max (per {settings.parentTraining.periodUnit}, optional)
                </label>
                <input
                  type="number" step="0.5" min="0"
                  placeholder={`e.g. ${settings.parentTraining.targetMaxHours}`}
                  value={c.parentTrainingMaxHours ?? ''}
                  onChange={e => updateClient(c.id, {
                    parentTrainingMaxHours: e.target.value === '' ? undefined : parseFloat(e.target.value) || 0,
                  })}
                  style={{ ...inputStyle, maxWidth: '180px', marginBottom: '12px' }}
                />
                <WeeklyAvailability
                  idPrefix={`client-${c.id}`}
                  availability={c.availabilityWindows}
                  onChange={av => updateClient(c.id, { availabilityWindows: av })}
                  defaultWindow={{ start: '15:00', end: '19:00' }}
                />
              </div>
            ))}
            {clients.length === 0 && (
              <p style={{ color: 'var(--text-faint)', fontSize: '13px', margin: '0 0 12px' }}>
                No cases yet.
              </p>
            )}
            <button type="button" onClick={addClient} style={addBtn}>+ Add case</button>
          </div>
        </Row>

        {/* ── Staff ── */}
        <SectionBand>Staff</SectionBand>

        <Row {...rowProps} label={`Technicians (${technicians.length})`}
          explainer="Same naming guidance as cases. Tick the ones who are credentialed RBTs — that changes the supervision maths.">
          <div>
            {technicians.map(t => (
              <div key={t.id} style={entryCard}>
                <IdentifierField
                  label="Staff identifier"
                  placeholder="Staff identifier, e.g. TT"
                  value={t.name}
                  entityId={t.id}
                  verdict={checkIdentifier(t.name)}
                  onChange={v => updateTechnician(t.id, { name: v })}
                  onRemove={() => removeTechnician(t.id)}
                  removeLabel="Remove technician"
                >
                  <label style={{ display: 'flex', gap: '5px', alignItems: 'center', whiteSpace: 'nowrap', fontSize: '13px', cursor: 'pointer' }}>
                    <input type="checkbox" checked={t.isRBT}
                      onChange={e => updateTechnician(t.id, { isRBT: e.target.checked })} />
                    <span>RBT</span>
                  </label>
                </IdentifierField>
                <WeeklyAvailability
                  idPrefix={`tech-${t.id}`}
                  availability={t.availability}
                  onChange={av => updateTechnician(t.id, { availability: av })}
                  defaultWindow={{ start: '15:00', end: '19:00' }}
                />
                <div style={{ marginTop: '12px' }}>
                  <label style={labelSm}>Assignments</label>
                  {t.assignments.map((a, idx) => {
                    const key = `${t.id}_${idx}`;
                    return (
                      <div key={idx} style={{ display: 'flex', gap: '7px', marginBottom: '7px', alignItems: 'center' }}>
                        <select
                          value={a.clientId}
                          aria-label="Assigned case"
                          onChange={e => {
                            const updated = [...t.assignments];
                            updated[idx] = { ...a, clientId: e.target.value };
                            updateTechnician(t.id, { assignments: updated });
                          }}
                          style={{ ...inputStyle, flex: 2, width: 'auto' }}
                        >
                          <option value="">— Pick a case —</option>
                          {clients.map(c => (
                            <option key={c.id} value={c.id}>{c.name || 'Unnamed case'}</option>
                          ))}
                        </select>
                        <input
                          type="number" step="0.5" aria-label="Hours per week"
                          value={assignmentHoursStr[key] ?? String(a.hoursPerWeek)}
                          onChange={e => setAssignmentHoursStr({ ...assignmentHoursStr, [key]: e.target.value })}
                          style={{ ...inputStyle, flex: 1, width: 'auto' }}
                        />
                        <button
                          type="button"
                          aria-label="Remove assignment"
                          onClick={() => {
                            const nextHours = { ...assignmentHoursStr };
                            delete nextHours[key];
                            setAssignmentHoursStr(nextHours);
                            updateTechnician(t.id, { assignments: t.assignments.filter((_, i) => i !== idx) });
                          }}
                          style={removeBtn}
                        >×</button>
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => updateTechnician(t.id, {
                      assignments: [...t.assignments, { clientId: '', hoursPerWeek: 0, billable: true }],
                    })}
                    style={{ ...addBtn, padding: '5px 11px', fontSize: '12px' }}
                  >+ Assignment</button>
                </div>
              </div>
            ))}
            {technicians.length === 0 && (
              <p style={{ color: 'var(--text-faint)', fontSize: '13px', margin: '0 0 12px' }}>
                No technicians yet.
              </p>
            )}
            <button type="button" onClick={addTechnician} style={addBtn}>+ Add staff</button>
          </div>
        </Row>

        {/* ── Foot ── */}
        <div style={{
          display: 'flex', justifyContent: 'flex-end', gap: '12px',
          marginTop: '26px', paddingTop: '20px', borderTop: '1px solid var(--border-default)',
        }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              padding: '10px 18px', border: '1px solid var(--border-strong)',
              borderRadius: 'var(--radius-md)', background: 'var(--surface-card)',
              color: 'var(--text-body)', cursor: 'pointer', fontSize: '14px',
            }}
          >Cancel</button>
          <button
            type="button"
            onClick={finish}
            style={{
              padding: '10px 20px', border: 'none', borderRadius: 'var(--radius-md)',
              background: 'var(--sage-500)', color: 'var(--brand-primary-text)',
              cursor: 'pointer', fontWeight: 700, fontSize: '14px',
            }}
          >Create schedule</button>
        </div>
      </div>
    </div>
  );
}

const labelSm: React.CSSProperties = {
  display: 'block', fontWeight: 700, fontSize: '12.5px',
  color: 'var(--text-primary)', marginBottom: '5px',
};

const hintSm: React.CSSProperties = {
  fontSize: '11.5px', color: 'var(--text-muted)', margin: '4px 0 0', lineHeight: 1.45,
};
