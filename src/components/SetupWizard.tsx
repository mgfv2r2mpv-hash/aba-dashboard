import React, { useState } from 'react';
import { ScheduleData, Client, Technician, CompanySettings, DayOfWeek, TimeWindow, BACB_RBT_SUPERVISION_MIN_PERCENT } from '../types';
import { v4 as uuidv4 } from 'uuid';

interface SetupWizardProps {
  onComplete: (data: ScheduleData) => void;
  onCancel: () => void;
}

type Step = 'welcome' | 'company' | 'clients' | 'technicians' | 'review';

const DAYS: DayOfWeek[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  border: '1px solid #d1d5db',
  borderRadius: '6px',
  fontSize: '14px',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontWeight: '600',
  marginBottom: '6px',
  fontSize: '13px',
};

const cardStyle: React.CSSProperties = {
  padding: '12px',
  border: '1px solid #e5e7eb',
  borderRadius: '6px',
  backgroundColor: '#f9fafb',
};

export default function SetupWizard({ onComplete, onCancel }: SetupWizardProps) {
  const [step, setStep] = useState<Step>('welcome');

  const [settings, setSettings] = useState<CompanySettings>({
    supervisionDirectHoursPercent: 5,
    supervisionRBTHoursPercent: BACB_RBT_SUPERVISION_MIN_PERCENT,
    parentTraining: {
      minimumHours: 1.5,
      targetMinHours: 2,
      targetMaxHours: 4,
      periodUnit: 'month',
    },
    clinicianAvailability: {
      Monday: [{ start: '09:00', end: '17:00' }],
      Tuesday: [{ start: '09:00', end: '17:00' }],
      Wednesday: [{ start: '09:00', end: '17:00' }],
      Thursday: [{ start: '09:00', end: '17:00' }],
      Friday: [{ start: '09:00', end: '17:00' }],
    },
  });

  const [supDirectStr, setSupDirectStr] = useState('5');
  const [supRBTStr, setSupRBTStr] = useState(String(BACB_RBT_SUPERVISION_MIN_PERCENT));
  const [rbtOverride, setRBTOverride] = useState(false);
  const [minHoursStr, setMinHoursStr] = useState('1.5');
  const [targetMinStr, setTargetMinStr] = useState('2');
  const [targetMaxStr, setTargetMaxStr] = useState('4');

  const [clients, setClients] = useState<Client[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [assignmentHoursStr, setAssignmentHoursStr] = useState<{ [key: string]: string }>({});

  const addClient = () => setClients([...clients, {
    id: uuidv4(),
    name: `Client ${clients.length + 1}`,
    availabilityWindows: {},
  }]);

  const updateClient = (id: string, patch: Partial<Client>) => {
    setClients(clients.map(c => c.id === id ? { ...c, ...patch } : c));
  };

  const removeClient = (id: string) => setClients(clients.filter(c => c.id !== id));

  const addTechnician = () => setTechnicians([...technicians, {
    id: uuidv4(),
    name: `Tech ${technicians.length + 1}`,
    isRBT: false,
    assignments: [],
    availability: {},
  }]);

  const updateTechnician = (id: string, patch: Partial<Technician>) => {
    setTechnicians(technicians.map(t => t.id === id ? { ...t, ...patch } : t));
  };

  const removeTechnician = (id: string) => setTechnicians(technicians.filter(t => t.id !== id));

  const parseNumericString = (val: string, fallback: number = 0): number => {
    const parsed = parseFloat(val);
    return isNaN(parsed) ? fallback : parsed;
  };

  const updateSettingsFromStrings = (): CompanySettings => {
    const rbtValue = rbtOverride ? parseNumericString(supRBTStr, BACB_RBT_SUPERVISION_MIN_PERCENT) : BACB_RBT_SUPERVISION_MIN_PERCENT;
    return {
      ...settings,
      supervisionDirectHoursPercent: parseNumericString(supDirectStr, 5),
      supervisionRBTHoursPercent: rbtValue,
      parentTraining: {
        ...settings.parentTraining,
        minimumHours: parseNumericString(minHoursStr, 1.5),
        targetMinHours: parseNumericString(targetMinStr, 2),
        targetMaxHours: parseNumericString(targetMaxStr, 4),
      },
    };
  };

  const finish = () => {
    const techniciansWithParsedHours = technicians.map(t => ({
      ...t,
      assignments: t.assignments.map((a, idx) => {
        const assignmentKey = `${t.id}_${idx}`;
        const hoursStr = assignmentHoursStr[assignmentKey] ?? String(a.hoursPerWeek);
        return { ...a, hoursPerWeek: parseNumericString(hoursStr, 0) };
      }),
    }));
    const data: ScheduleData = {
      id: uuidv4(),
      version: 1,
      clients,
      technicians: techniciansWithParsedHours,
      settings: updateSettingsFromStrings(),
      appointments: [],
      lastModified: new Date().toISOString(),
    };
    onComplete(data);
  };

  const stepIndex = ['welcome', 'company', 'clients', 'technicians', 'review'].indexOf(step);
  const totalSteps = 5;

  const goNext = () => {
    if (step === 'company') {
      setSettings(updateSettingsFromStrings());
    }
    const order: Step[] = ['welcome', 'company', 'clients', 'technicians', 'review'];
    const idx = order.indexOf(step);
    if (idx < order.length - 1) setStep(order[idx + 1]!);
  };

  const goBack = () => {
    if (step === 'welcome') return onCancel();
    const order: Step[] = ['welcome', 'company', 'clients', 'technicians', 'review'];
    const idx = order.indexOf(step);
    if (idx > 0) setStep(order[idx - 1]!);
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div style={{
        backgroundColor: 'white',
        borderRadius: '8px',
        width: 'min(720px, 100vw)',
        height: 'min(720px, 100vh)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}>
        <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid #e5e7eb', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 'bold', margin: 0 }}>Setup Wizard</h2>
            <button onClick={onCancel} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', lineHeight: 1, padding: 0 }}>×</button>
          </div>
          <div style={{ display: 'flex', gap: '4px' }}>
            {Array.from({ length: totalSteps }).map((_, i) => (
              <div key={i} style={{
                flex: 1,
                height: '4px',
                backgroundColor: i <= stepIndex ? '#3b82f6' : '#e5e7eb',
                borderRadius: '2px',
              }} />
            ))}
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', padding: '16px 20px' }}>
          {step === 'welcome' && (
            <div>
              <h3 style={{ fontSize: '18px', marginBottom: '12px' }}>Welcome! Let's set up your dashboard.</h3>
              <p style={{ color: '#6b7280', marginBottom: '12px' }}>
                We'll walk through 4 quick steps to configure your company:
              </p>
              <ol style={{ paddingLeft: '20px', color: '#374151', lineHeight: '1.8' }}>
                <li>Company supervision and training requirements</li>
                <li>Client list with availability windows</li>
                <li>Technicians with RBT status, availability, and assignments</li>
                <li>Review &amp; create</li>
              </ol>
              <p style={{ color: '#6b7280', marginTop: '12px', fontSize: '13px' }}>
                Use anonymized identifiers (e.g. "Client A") — never enter real names.
                You can add appointments after the wizard completes.
              </p>
            </div>
          )}

          {step === 'company' && (
            <div>
              <h3 style={{ fontSize: '18px', marginBottom: '12px' }}>Company Requirements</h3>
              <p style={{ color: '#6b7280', marginBottom: '16px', fontSize: '13px' }}>
                These are the constraints we'll check against. Defaults match BACB minimums and a common parent-training target.
              </p>
              <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '6px' }}>
                <label style={labelStyle}>BCBA (supervisor) availability</label>
                <p style={{ fontSize: '12px', color: '#6b7280', marginBottom: '8px' }}>
                  Sessions can't ethically be scheduled when you're not available to supervise.
                </p>
                <WeeklyAvailability
                  availability={settings.clinicianAvailability || {}}
                  onChange={(av) => setSettings({ ...settings, clinicianAvailability: av })}
                  defaultWindow={{ start: '09:00', end: '17:00' }}
                />
              </div>
              <div style={{ display: 'grid', gap: '12px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <label style={labelStyle}>Supervision: % of direct hours</label>
                    <input
                      type="number" step="0.1"
                      value={supDirectStr}
                      onChange={(e) => setSupDirectStr(e.target.value)}
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Supervision: % of RBT hours (BACB minimum)</label>
                    <input
                      type="number" step="0.1"
                      value={rbtOverride ? supRBTStr : String(BACB_RBT_SUPERVISION_MIN_PERCENT)}
                      onChange={(e) => setSupRBTStr(e.target.value)}
                      disabled={!rbtOverride}
                      style={{ ...inputStyle, opacity: rbtOverride ? 1 : 0.6 }}
                    />
                    <label style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '12px', marginTop: '6px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={rbtOverride}
                        onChange={(e) => setRBTOverride(e.target.checked)}
                      />
                      <span>Override BACB minimum</span>
                    </label>
                    <p style={{ fontSize: '11px', color: '#6b7280', marginTop: '4px' }}>
                      The BACB requires a minimum of {BACB_RBT_SUPERVISION_MIN_PERCENT}% for RBTs. Check the box to exceed this requirement.
                    </p>
                  </div>
                </div>
                <div>
                  <label style={labelStyle}>Parent training period</label>
                  <select
                    value={settings.parentTraining.periodUnit}
                    onChange={(e) => setSettings({
                      ...settings,
                      parentTraining: { ...settings.parentTraining, periodUnit: e.target.value as any },
                    })}
                    style={inputStyle}
                  >
                    <option value="week">per week</option>
                    <option value="month">per month</option>
                    <option value="sixMonths">per 6 months</option>
                    <option value="year">per year</option>
                  </select>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
                  <div>
                    <label style={labelStyle}>Min hours</label>
                    <input
                      type="number" step="0.1"
                      value={minHoursStr}
                      onChange={(e) => setMinHoursStr(e.target.value)}
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Target min</label>
                    <input
                      type="number" step="0.5"
                      value={targetMinStr}
                      onChange={(e) => setTargetMinStr(e.target.value)}
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Target max</label>
                    <input
                      type="number" step="0.5"
                      value={targetMaxStr}
                      onChange={(e) => setTargetMaxStr(e.target.value)}
                      style={inputStyle}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 'clients' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', gap: '8px' }}>
                <h3 style={{ fontSize: '18px', margin: 0 }}>Clients ({clients.length})</h3>
                <button onClick={addClient} style={{
                  padding: '6px 12px', backgroundColor: '#3b82f6', color: 'white',
                  border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px',
                  whiteSpace: 'nowrap',
                }}>+ Add Client</button>
              </div>
              <p style={{ color: '#6b7280', fontSize: '13px', marginBottom: '12px' }}>
                Use anonymized identifiers (e.g. "Client A"). Set availability windows per day.
              </p>
              <div style={{ display: 'grid', gap: '12px' }}>
                {clients.map(c => (
                  <div key={c.id} style={cardStyle}>
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                      <input
                        value={c.name}
                        onChange={(e) => updateClient(c.id, { name: e.target.value })}
                        placeholder="Client name (anonymized)"
                        style={{ ...inputStyle, flex: 1, minWidth: 0 }}
                      />
                      <button onClick={() => removeClient(c.id)} style={{
                        padding: '6px 10px', backgroundColor: '#fee2e2', color: '#dc2626',
                        border: '1px solid #fca5a5', borderRadius: '4px', cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}>Remove</button>
                    </div>
                    <div style={{ marginBottom: '8px' }}>
                      <label style={{ ...labelStyle, fontSize: '12px' }}>
                        Parent-training max (per {settings.parentTraining.periodUnit}, optional)
                      </label>
                      <input
                        type="number" step="0.5" min="0"
                        placeholder={`e.g. ${settings.parentTraining.targetMaxHours}`}
                        value={c.parentTrainingMaxHours ?? ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          updateClient(c.id, {
                            parentTrainingMaxHours: v === '' ? undefined : parseFloat(v) || 0,
                          });
                        }}
                        style={{ ...inputStyle, maxWidth: '180px' }}
                      />
                    </div>
                    <WeeklyAvailability
                      availability={c.availabilityWindows}
                      onChange={(av) => updateClient(c.id, { availabilityWindows: av })}
                      defaultWindow={{ start: '15:00', end: '19:00' }}
                    />
                  </div>
                ))}
                {clients.length === 0 && (
                  <p style={{ color: '#9ca3af', textAlign: 'center', padding: '20px' }}>
                    No clients yet. Click "+ Add Client" to start.
                  </p>
                )}
              </div>
            </div>
          )}

          {step === 'technicians' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', gap: '8px' }}>
                <h3 style={{ fontSize: '18px', margin: 0 }}>Technicians ({technicians.length})</h3>
                <button onClick={addTechnician} style={{
                  padding: '6px 12px', backgroundColor: '#3b82f6', color: 'white',
                  border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px',
                  whiteSpace: 'nowrap',
                }}>+ Add Technician</button>
              </div>
              <p style={{ color: '#6b7280', fontSize: '13px', marginBottom: '12px' }}>
                Mark RBT certification (affects supervision math). Add availability and client assignments.
              </p>
              <div style={{ display: 'grid', gap: '12px' }}>
                {technicians.map(t => (
                  <div key={t.id} style={cardStyle}>
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <input
                        value={t.name}
                        onChange={(e) => updateTechnician(t.id, { name: e.target.value })}
                        placeholder="Technician name"
                        style={{ ...inputStyle, flex: '1 1 140px', minWidth: 0 }}
                      />
                      <label style={{ display: 'flex', gap: '4px', alignItems: 'center', whiteSpace: 'nowrap', fontSize: '13px' }}>
                        <input
                          type="checkbox"
                          checked={t.isRBT}
                          onChange={(e) => updateTechnician(t.id, { isRBT: e.target.checked })}
                        />
                        <span>RBT</span>
                      </label>
                      <button onClick={() => removeTechnician(t.id)} style={{
                        padding: '6px 10px', backgroundColor: '#fee2e2', color: '#dc2626',
                        border: '1px solid #fca5a5', borderRadius: '4px', cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}>Remove</button>
                    </div>
                    <WeeklyAvailability
                      availability={t.availability}
                      onChange={(av) => updateTechnician(t.id, { availability: av })}
                      defaultWindow={{ start: '15:00', end: '19:00' }}
                    />
                    <div style={{ marginTop: '10px' }}>
                      <label style={labelStyle}>Assignments</label>
                      {t.assignments.map((a, idx) => {
                        const assignmentKey = `${t.id}_${idx}`;
                        const hoursStr = assignmentHoursStr[assignmentKey] ?? String(a.hoursPerWeek);
                        return (
                          <div key={idx} style={{ display: 'flex', gap: '6px', marginBottom: '6px', alignItems: 'center' }}>
                            <select
                              value={a.clientId}
                              onChange={(e) => {
                                const updated = [...t.assignments];
                                updated[idx] = { ...a, clientId: e.target.value };
                                updateTechnician(t.id, { assignments: updated });
                              }}
                              style={{ ...inputStyle, flex: 2, minWidth: 0 }}
                            >
                              <option value="">— Pick client —</option>
                              {clients.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                            </select>
                            <input
                              type="number" step="0.5"
                              placeholder="hrs/wk"
                              value={hoursStr}
                              onChange={(e) => setAssignmentHoursStr({ ...assignmentHoursStr, [assignmentKey]: e.target.value })}
                              style={{ ...inputStyle, flex: 1, minWidth: 0 }}
                            />
                            <button onClick={() => {
                              const newAssignments = t.assignments.filter((_, i) => i !== idx);
                              const newHoursStr = { ...assignmentHoursStr };
                              delete newHoursStr[assignmentKey];
                              setAssignmentHoursStr(newHoursStr);
                              updateTechnician(t.id, { assignments: newAssignments });
                            }} style={{
                              padding: '4px 8px', backgroundColor: '#fee2e2', color: '#dc2626',
                              border: '1px solid #fca5a5', borderRadius: '4px', cursor: 'pointer',
                              flexShrink: 0,
                            }}>×</button>
                          </div>
                        );
                      })}
                      <button onClick={() => updateTechnician(t.id, {
                        assignments: [...t.assignments, { clientId: '', hoursPerWeek: 0, billable: true }],
                      })} style={{
                        padding: '4px 10px', backgroundColor: 'white', color: '#3b82f6',
                        border: '1px solid #3b82f6', borderRadius: '4px', cursor: 'pointer', fontSize: '12px',
                      }}>+ Assignment</button>
                    </div>
                  </div>
                ))}
                {technicians.length === 0 && (
                  <p style={{ color: '#9ca3af', textAlign: 'center', padding: '20px' }}>
                    No technicians yet. Click "+ Add Technician" to start.
                  </p>
                )}
              </div>
            </div>
          )}

          {step === 'review' && (
            <div>
              <h3 style={{ fontSize: '18px', marginBottom: '12px' }}>Review &amp; Create</h3>
              <div style={{ display: 'grid', gap: '12px' }}>
                <div style={cardStyle}>
                  <strong>Company Settings</strong>
                  <p style={{ fontSize: '13px', color: '#6b7280', marginTop: '4px' }}>
                    Supervision: {settings.supervisionDirectHoursPercent}% direct + {settings.supervisionRBTHoursPercent}% RBT<br />
                    Parent training: {settings.parentTraining.minimumHours}h min,
                    target {settings.parentTraining.targetMinHours}-{settings.parentTraining.targetMaxHours}h/{settings.parentTraining.periodUnit}
                  </p>
                </div>
                <div style={cardStyle}>
                  <strong>{clients.length} client(s)</strong>
                  <ul style={{ fontSize: '13px', color: '#6b7280', marginTop: '4px', paddingLeft: '20px' }}>
                    {clients.map(c => <li key={c.id}>{c.name}</li>)}
                  </ul>
                </div>
                <div style={cardStyle}>
                  <strong>{technicians.length} technician(s)</strong>
                  <ul style={{ fontSize: '13px', color: '#6b7280', marginTop: '4px', paddingLeft: '20px' }}>
                    {technicians.map(t => <li key={t.id}>{t.name} {t.isRBT && '(RBT)'} - {t.assignments.length} assignment(s)</li>)}
                  </ul>
                </div>
              </div>
              <p style={{ marginTop: '12px', fontSize: '13px', color: '#6b7280' }}>
                Click Create to load this into the dashboard. You can add appointments after.
              </p>
            </div>
          )}
        </div>

        <div style={{
          display: 'flex', justifyContent: 'space-between', gap: '8px',
          padding: '12px 20px', borderTop: '1px solid #e5e7eb',
          background: 'white', flexShrink: 0,
        }}>
          <button onClick={goBack} style={{
            padding: '8px 16px', border: '1px solid #d1d5db', borderRadius: '6px',
            background: 'white', cursor: 'pointer',
          }}>{step === 'welcome' ? 'Cancel' : 'Back'}</button>

          {step === 'review' ? (
            <button onClick={finish} style={{
              padding: '8px 16px', backgroundColor: '#10b981', color: 'white',
              border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600',
            }}>Create Dashboard</button>
          ) : (
            <button onClick={goNext} style={{
              padding: '8px 16px', backgroundColor: '#3b82f6', color: 'white',
              border: 'none', borderRadius: '6px', cursor: 'pointer',
            }}>Next</button>
          )}
        </div>
      </div>
    </div>
  );
}

interface WeeklyAvailabilityProps {
  availability: { [key in DayOfWeek]?: TimeWindow[] };
  onChange: (availability: { [key in DayOfWeek]?: TimeWindow[] }) => void;
  defaultWindow?: TimeWindow;
}

function WeeklyAvailability({ availability, onChange, defaultWindow }: WeeklyAvailabilityProps) {
  const seedWindow: TimeWindow = defaultWindow ?? { start: '09:00', end: '17:00' };

  const updateWindow = (day: DayOfWeek, idx: number, field: 'start' | 'end', value: string) => {
    const next = { ...availability };
    const list = (next[day] || []).slice();
    list[idx] = { ...list[idx]!, [field]: value } as TimeWindow;
    next[day] = list;
    onChange(next);
  };

  const addWindow = (day: DayOfWeek) => {
    const next = { ...availability };
    next[day] = [...(next[day] || []), { ...seedWindow }];
    onChange(next);
  };

  const removeWindow = (day: DayOfWeek, idx: number) => {
    const next = { ...availability };
    next[day] = (next[day] || []).filter((_, i) => i !== idx);
    if ((next[day] || []).length === 0) delete next[day];
    onChange(next);
  };

  const clearDay = (day: DayOfWeek) => {
    const next = { ...availability };
    delete next[day];
    onChange(next);
  };

  const setWeekdays = (window: TimeWindow) => {
    const next = { ...availability };
    (['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] as DayOfWeek[]).forEach(d => {
      next[d] = [{ ...window }];
    });
    onChange(next);
  };

  const copyMondayToWeekdays = () => {
    const monWindows = availability['Monday'] || [];
    const next = { ...availability };
    (['Tuesday', 'Wednesday', 'Thursday', 'Friday'] as DayOfWeek[]).forEach(d => {
      if (monWindows.length === 0) {
        delete next[d];
      } else {
        next[d] = monWindows.map(w => ({ ...w }));
      }
    });
    onChange(next);
  };

  const clearAll = () => onChange({});

  return (
    <div>
      <div style={{
        display: 'flex', gap: '6px', marginBottom: '8px', flexWrap: 'wrap', alignItems: 'center',
      }}>
        <button onClick={() => setWeekdays({ start: '09:00', end: '17:00' })} style={presetBtn} title="Mon–Fri 9 AM–5 PM">
          Weekdays 9–5
        </button>
        <button onClick={() => setWeekdays({ start: '15:00', end: '19:00' })} style={presetBtn} title="Mon–Fri 3 PM–7 PM">
          After-school 3–7
        </button>
        <button onClick={copyMondayToWeekdays} style={presetBtn} title="Copy Monday to Tue–Fri">
          Copy Mon → Tue–Fri
        </button>
        <button onClick={clearAll} style={{ ...presetBtn, color: '#dc2626', borderColor: '#fca5a5' }}>
          Clear all
        </button>
      </div>
      <div style={{ display: 'grid', gap: '4px' }}>
        {DAYS.map(day => {
          const windows = availability[day] || [];
          return (
            <div
              key={day}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                flexWrap: 'wrap',
                padding: '6px 8px',
                borderRadius: '6px',
                background: 'white',
                border: '1px solid #e5e7eb',
              }}
            >
              <span style={{
                fontSize: '13px', fontWeight: 600, color: '#374151',
                width: '36px', flexShrink: 0,
              }}>
                {day.slice(0, 3)}
              </span>
              {windows.length === 0 && (
                <span style={{ fontSize: '12px', color: '#9ca3af', fontStyle: 'italic' }}>
                  Off
                </span>
              )}
              {windows.map((w, idx) => (
                <span key={idx} style={windowChipStyle}>
                  <input
                    type="time"
                    value={w.start}
                    onChange={(e) => updateWindow(day, idx, 'start', e.target.value)}
                    style={chipTimeInput}
                  />
                  <span style={{ fontSize: '12px', color: '#6b7280' }}>–</span>
                  <input
                    type="time"
                    value={w.end}
                    onChange={(e) => updateWindow(day, idx, 'end', e.target.value)}
                    style={chipTimeInput}
                  />
                  <button
                    onClick={() => removeWindow(day, idx)}
                    style={chipRemoveBtn}
                    title="Remove this window"
                    aria-label="Remove time window"
                  >×</button>
                </span>
              ))}
              <button
                onClick={() => addWindow(day)}
                style={addWindowBtn}
                title={`Add a time window on ${day}`}
              >+ window</button>
              {windows.length > 0 && (
                <button
                  onClick={() => clearDay(day)}
                  style={offBtn}
                  title={`Clear ${day}`}
                >Off</button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const presetBtn: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: '12px',
  border: '1px solid #d1d5db',
  borderRadius: '999px',
  background: 'white',
  cursor: 'pointer',
  color: '#374151',
};

const windowChipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  padding: '2px 4px 2px 6px',
  background: '#eff6ff',
  border: '1px solid #bfdbfe',
  borderRadius: '999px',
};

const chipTimeInput: React.CSSProperties = {
  fontSize: '12px',
  padding: '2px 4px',
  border: '1px solid #bfdbfe',
  borderRadius: '4px',
  fontFamily: 'inherit',
  background: 'white',
};

const addWindowBtn: React.CSSProperties = {
  padding: '3px 8px',
  fontSize: '11px',
  border: '1px dashed #3b82f6',
  background: 'white',
  color: '#3b82f6',
  borderRadius: '999px',
  cursor: 'pointer',
};

const offBtn: React.CSSProperties = {
  padding: '2px 8px',
  fontSize: '11px',
  border: '1px solid #d1d5db',
  borderRadius: '999px',
  background: 'white',
  cursor: 'pointer',
  color: '#374151',
};

const chipRemoveBtn: React.CSSProperties = {
  padding: '0 5px',
  fontSize: '14px',
  border: 'none',
  background: 'transparent',
  color: '#6b7280',
  borderRadius: '999px',
  cursor: 'pointer',
  lineHeight: 1,
};
