import React, { useState } from 'react';
import { ScheduleData, Client, Technician, CompanySettings, DayOfWeek } from '../types';
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
    supervisionRBTHoursPercent: 5,
    parentTraining: {
      minimumHours: 1.5,
      targetMinHours: 2,
      targetMaxHours: 4,
      periodUnit: 'month',
    },
  });

  const [clients, setClients] = useState<Client[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);

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

  const setDayAvailability = (
    list: 'client' | 'tech',
    id: string,
    day: DayOfWeek,
    field: 'start' | 'end' | 'clear',
    value?: string
  ) => {
    if (list === 'client') {
      const c = clients.find(c => c.id === id);
      if (!c) return;
      const win = { ...c.availabilityWindows };
      if (field === 'clear') {
        delete win[day];
      } else {
        const existing = win[day]?.[0] || { start: '09:00', end: '17:00' };
        win[day] = [{ ...existing, [field]: value }];
      }
      updateClient(id, { availabilityWindows: win });
    } else {
      const t = technicians.find(t => t.id === id);
      if (!t) return;
      const av = { ...t.availability };
      if (field === 'clear') {
        delete av[day];
      } else {
        const existing = av[day]?.[0] || { start: '09:00', end: '17:00' };
        av[day] = [{ ...existing, [field]: value }];
      }
      updateTechnician(id, { availability: av });
    }
  };

  const finish = () => {
    const data: ScheduleData = {
      id: uuidv4(),
      version: 1,
      clients,
      technicians,
      settings,
      appointments: [],
      lastModified: new Date().toISOString(),
    };
    onComplete(data);
  };

  const stepIndex = ['welcome', 'company', 'clients', 'technicians', 'review'].indexOf(step);
  const totalSteps = 5;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div style={{
        backgroundColor: 'white', borderRadius: '8px', padding: '20px',
        width: 'min(720px, 95vw)', maxHeight: '90vh', overflowY: 'auto',
        boxSizing: 'border-box',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 'bold' }}>Setup Wizard</h2>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }}>✕</button>
        </div>

        {/* Progress bar */}
        <div style={{ display: 'flex', gap: '4px', marginBottom: '20px' }}>
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div key={i} style={{
              flex: 1,
              height: '4px',
              backgroundColor: i <= stepIndex ? '#3b82f6' : '#e5e7eb',
              borderRadius: '2px',
            }} />
          ))}
        </div>

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
            <div style={{ display: 'grid', gap: '12px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <label style={labelStyle}>Supervision: % of direct hours</label>
                  <input
                    type="number" step="0.1"
                    value={settings.supervisionDirectHoursPercent}
                    onChange={(e) => setSettings({ ...settings, supervisionDirectHoursPercent: parseFloat(e.target.value) || 0 })}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Supervision: % of RBT hours</label>
                  <input
                    type="number" step="0.1"
                    value={settings.supervisionRBTHoursPercent}
                    onChange={(e) => setSettings({ ...settings, supervisionRBTHoursPercent: parseFloat(e.target.value) || 0 })}
                    style={inputStyle}
                  />
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
                    value={settings.parentTraining.minimumHours}
                    onChange={(e) => setSettings({
                      ...settings,
                      parentTraining: { ...settings.parentTraining, minimumHours: parseFloat(e.target.value) || 0 },
                    })}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Target min</label>
                  <input
                    type="number" step="0.5"
                    value={settings.parentTraining.targetMinHours}
                    onChange={(e) => setSettings({
                      ...settings,
                      parentTraining: { ...settings.parentTraining, targetMinHours: parseFloat(e.target.value) || 0 },
                    })}
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Target max</label>
                  <input
                    type="number" step="0.5"
                    value={settings.parentTraining.targetMaxHours}
                    onChange={(e) => setSettings({
                      ...settings,
                      parentTraining: { ...settings.parentTraining, targetMaxHours: parseFloat(e.target.value) || 0 },
                    })}
                    style={inputStyle}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {step === 'clients' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h3 style={{ fontSize: '18px' }}>Clients ({clients.length})</h3>
              <button onClick={addClient} style={{
                padding: '6px 12px', backgroundColor: '#3b82f6', color: 'white',
                border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px',
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
                      style={{ ...inputStyle, flex: 1 }}
                    />
                    <button onClick={() => removeClient(c.id)} style={{
                      padding: '6px 10px', backgroundColor: '#fee2e2', color: '#dc2626',
                      border: '1px solid #fca5a5', borderRadius: '4px', cursor: 'pointer',
                    }}>Remove</button>
                  </div>
                  <DayAvailabilityRow
                    availability={c.availabilityWindows}
                    onChange={(day, field, value) => setDayAvailability('client', c.id, day, field, value)}
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h3 style={{ fontSize: '18px' }}>Technicians ({technicians.length})</h3>
              <button onClick={addTechnician} style={{
                padding: '6px 12px', backgroundColor: '#3b82f6', color: 'white',
                border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px',
              }}>+ Add Technician</button>
            </div>
            <p style={{ color: '#6b7280', fontSize: '13px', marginBottom: '12px' }}>
              Mark RBT certification (affects supervision math). Add availability and client assignments.
            </p>
            <div style={{ display: 'grid', gap: '12px' }}>
              {technicians.map(t => (
                <div key={t.id} style={cardStyle}>
                  <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'center' }}>
                    <input
                      value={t.name}
                      onChange={(e) => updateTechnician(t.id, { name: e.target.value })}
                      placeholder="Technician name"
                      style={{ ...inputStyle, flex: 1 }}
                    />
                    <label style={{ display: 'flex', gap: '4px', alignItems: 'center', whiteSpace: 'nowrap' }}>
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
                    }}>Remove</button>
                  </div>
                  <DayAvailabilityRow
                    availability={t.availability}
                    onChange={(day, field, value) => setDayAvailability('tech', t.id, day, field, value)}
                  />
                  <div style={{ marginTop: '8px' }}>
                    <label style={labelStyle}>Assignments</label>
                    {t.assignments.map((a, idx) => (
                      <div key={idx} style={{ display: 'flex', gap: '6px', marginBottom: '4px' }}>
                        <select
                          value={a.clientId}
                          onChange={(e) => {
                            const updated = [...t.assignments];
                            updated[idx] = { ...a, clientId: e.target.value };
                            updateTechnician(t.id, { assignments: updated });
                          }}
                          style={{ ...inputStyle, flex: 2 }}
                        >
                          <option value="">— Pick client —</option>
                          {clients.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                        </select>
                        <input
                          type="number" step="0.5" placeholder="Hours/wk"
                          value={a.hoursPerWeek}
                          onChange={(e) => {
                            const updated = [...t.assignments];
                            updated[idx] = { ...a, hoursPerWeek: parseFloat(e.target.value) || 0 };
                            updateTechnician(t.id, { assignments: updated });
                          }}
                          style={{ ...inputStyle, flex: 1 }}
                        />
                        <button onClick={() => {
                          updateTechnician(t.id, { assignments: t.assignments.filter((_, i) => i !== idx) });
                        }} style={{
                          padding: '4px 8px', backgroundColor: '#fee2e2', color: '#dc2626',
                          border: '1px solid #fca5a5', borderRadius: '4px', cursor: 'pointer',
                        }}>×</button>
                      </div>
                    ))}
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

        {/* Navigation */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '20px' }}>
          <button onClick={() => {
            if (step === 'welcome') return onCancel();
            const order: Step[] = ['welcome', 'company', 'clients', 'technicians', 'review'];
            const idx = order.indexOf(step);
            if (idx > 0) setStep(order[idx - 1]!);
          }} style={{
            padding: '8px 16px', border: '1px solid #d1d5db', borderRadius: '6px',
            background: 'white', cursor: 'pointer',
          }}>{step === 'welcome' ? 'Cancel' : 'Back'}</button>

          {step === 'review' ? (
            <button onClick={finish} style={{
              padding: '8px 16px', backgroundColor: '#10b981', color: 'white',
              border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '600',
            }}>Create Dashboard</button>
          ) : (
            <button onClick={() => {
              const order: Step[] = ['welcome', 'company', 'clients', 'technicians', 'review'];
              const idx = order.indexOf(step);
              if (idx < order.length - 1) setStep(order[idx + 1]!);
            }} style={{
              padding: '8px 16px', backgroundColor: '#3b82f6', color: 'white',
              border: 'none', borderRadius: '6px', cursor: 'pointer',
            }}>Next</button>
          )}
        </div>
      </div>
    </div>
  );
}

interface DayAvailabilityRowProps {
  availability: { [key in DayOfWeek]?: { start: string; end: string }[] };
  onChange: (day: DayOfWeek, field: 'start' | 'end' | 'clear', value?: string) => void;
}

function DayAvailabilityRow({ availability, onChange }: DayAvailabilityRowProps) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', fontSize: '11px' }}>
      {DAYS.map(day => {
        const window = availability[day]?.[0];
        return (
          <div key={day} style={{
            border: '1px solid #d1d5db',
            borderRadius: '4px',
            padding: '4px',
            backgroundColor: window ? 'white' : '#f3f4f6',
          }}>
            <div style={{ fontWeight: '600', textAlign: 'center', marginBottom: '2px' }}>
              {day.slice(0, 3)}
            </div>
            {window ? (
              <>
                <input
                  type="time"
                  value={window.start}
                  onChange={(e) => onChange(day, 'start', e.target.value)}
                  style={{ width: '100%', fontSize: '11px', padding: '2px' }}
                />
                <input
                  type="time"
                  value={window.end}
                  onChange={(e) => onChange(day, 'end', e.target.value)}
                  style={{ width: '100%', fontSize: '11px', padding: '2px', marginTop: '2px' }}
                />
                <button
                  onClick={() => onChange(day, 'clear')}
                  style={{
                    width: '100%', marginTop: '2px', padding: '2px',
                    fontSize: '10px', cursor: 'pointer',
                    border: 'none', backgroundColor: '#fee2e2', color: '#dc2626',
                    borderRadius: '2px',
                  }}
                >Off</button>
              </>
            ) : (
              <button
                onClick={() => onChange(day, 'start', '09:00')}
                style={{
                  width: '100%', padding: '4px 0', fontSize: '11px',
                  border: 'none', backgroundColor: 'transparent',
                  color: '#3b82f6', cursor: 'pointer',
                }}
              >+ add</button>
            )}
          </div>
        );
      })}
    </div>
  );
}
