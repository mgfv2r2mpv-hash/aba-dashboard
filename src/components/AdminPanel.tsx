import React, { useState } from 'react';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { ScheduleData, Technician, Client, DayOfWeek, TimeWindow } from '../types';

interface AdminPanelProps {
  data: ScheduleData;
  onDataChange: (data: ScheduleData) => void;
}

const API_BASE = '/api';
const DAYS: DayOfWeek[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function mergeWindows(windows: TimeWindow[]): TimeWindow[] {
  if (windows.length === 0) return [];
  const sorted = [...windows].sort((a, b) => a.start.localeCompare(b.start));
  const result: TimeWindow[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = result[result.length - 1]!;
    if (sorted[i].start <= last.end) {
      if (sorted[i].end > last.end) last.end = sorted[i].end;
    } else {
      result.push({ ...sorted[i] });
    }
  }
  return result;
}

export default function AdminPanel({ data, onDataChange }: AdminPanelProps) {
  const [activeTab, setActiveTab] = useState<'technicians' | 'clients' | 'settings'>('technicians');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const persistTechnician = async (id: string, patch: Partial<Technician>) => {
    setSavingId(id);
    setError(null);
    try {
      const res = await axios.post(`${API_BASE}/admin/technician/${id}`, patch);
      const updated = { ...data };
      const idx = updated.technicians.findIndex(t => t.id === id);
      if (idx >= 0) updated.technicians[idx] = res.data.technician;
      onDataChange(updated);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setSavingId(null);
    }
  };

  const persistClient = async (id: string, patch: Partial<Client>) => {
    setSavingId(id);
    setError(null);
    try {
      const res = await axios.post(`${API_BASE}/admin/client/${id}`, patch);
      const updated = { ...data };
      const idx = updated.clients.findIndex(c => c.id === id);
      if (idx >= 0) updated.clients[idx] = res.data.client;
      onDataChange(updated);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setSavingId(null);
    }
  };

  const addTechnician = async () => {
    const newTech: Technician = {
      id: uuidv4(),
      name: `Tech ${data.technicians.length + 1}`,
      isRBT: false,
      assignments: [],
      availability: {},
    };
    setSavingId(newTech.id);
    setError(null);
    try {
      const res = await axios.post(`${API_BASE}/admin/technicians`, newTech);
      onDataChange({ ...data, technicians: [...data.technicians, res.data.technician] });
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setSavingId(null);
    }
  };

  const addClient = async () => {
    const newClient: Client = {
      id: uuidv4(),
      name: `Client ${data.clients.length + 1}`,
      availabilityWindows: {},
    };
    setSavingId(newClient.id);
    setError(null);
    try {
      const res = await axios.post(`${API_BASE}/admin/clients`, newClient);
      onDataChange({ ...data, clients: [...data.clients, res.data.client] });
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setSavingId(null);
    }
  };

  const removeTechnician = async (id: string) => {
    if (!confirm('Remove this technician? This does not delete their appointments.')) return;
    setSavingId(id);
    setError(null);
    try {
      await axios.delete(`${API_BASE}/admin/technician/${id}`);
      onDataChange({ ...data, technicians: data.technicians.filter(t => t.id !== id) });
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setSavingId(null);
    }
  };

  const removeClient = async (id: string) => {
    if (!confirm('Remove this client? This does not delete their appointments.')) return;
    setSavingId(id);
    setError(null);
    try {
      await axios.delete(`${API_BASE}/admin/client/${id}`);
      onDataChange({ ...data, clients: data.clients.filter(c => c.id !== id) });
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setSavingId(null);
    }
  };

  const tabStyle = (isActive: boolean) => ({
    padding: '12px 16px',
    backgroundColor: isActive ? '#ffffff' : '#f3f4f6',
    border: isActive ? '2px solid #3b82f6' : '1px solid #e5e7eb',
    borderBottom: 'none',
    cursor: 'pointer',
    fontWeight: isActive ? '600' : 'normal',
  } as React.CSSProperties);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb', backgroundColor: '#f9f9f9' }}>
        <button onClick={() => setActiveTab('technicians')} style={tabStyle(activeTab === 'technicians')}>Technicians</button>
        <button onClick={() => setActiveTab('clients')} style={tabStyle(activeTab === 'clients')}>Clients</button>
        <button onClick={() => setActiveTab('settings')} style={tabStyle(activeTab === 'settings')}>Settings</button>
      </div>

      {error && (
        <div style={{ padding: '8px 16px', backgroundColor: '#fee2e2', color: '#991b1b', fontSize: '13px' }}>
          {error}
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
        {activeTab === 'technicians' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '18px', fontWeight: 'bold' }}>Manage Technicians ({data.technicians.length})</h3>
              <button onClick={addTechnician} style={primaryBtn}>+ Add Technician</button>
            </div>
            <div style={{ display: 'grid', gap: '16px' }}>
              {data.technicians.map(tech => (
                <TechnicianCard
                  key={tech.id}
                  tech={tech}
                  clients={data.clients}
                  saving={savingId === tech.id}
                  onChange={(patch) => persistTechnician(tech.id, patch)}
                  onRemove={() => removeTechnician(tech.id)}
                />
              ))}
              {data.technicians.length === 0 && (
                <p style={{ color: '#9ca3af', textAlign: 'center', padding: '20px' }}>No technicians yet.</p>
              )}
            </div>
          </div>
        )}

        {activeTab === 'clients' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontSize: '18px', fontWeight: 'bold' }}>Manage Clients ({data.clients.length})</h3>
              <button onClick={addClient} style={primaryBtn}>+ Add Client</button>
            </div>
            <div style={{ display: 'grid', gap: '16px' }}>
              {data.clients.map(client => (
                <ClientCard
                  key={client.id}
                  client={client}
                  saving={savingId === client.id}
                  onChange={(patch) => persistClient(client.id, patch)}
                  onRemove={() => removeClient(client.id)}
                />
              ))}
              {data.clients.length === 0 && (
                <p style={{ color: '#9ca3af', textAlign: 'center', padding: '20px' }}>No clients yet.</p>
              )}
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div>
            <h3 style={{ marginBottom: '16px', fontSize: '18px', fontWeight: 'bold' }}>Company Settings</h3>
            <div style={{
              backgroundColor: '#f9f9f9', border: '1px solid #e5e7eb', borderRadius: '8px',
              padding: '16px', display: 'grid', gap: '16px',
            }}>
              <SettingRow label="Supervision — Direct Hours" value={`${data.settings.supervisionDirectHoursPercent}% of direct client hours`} />
              <SettingRow label="Supervision — RBT Hours" value={`${data.settings.supervisionRBTHoursPercent}% of RBT hours`} />
              <SettingRow label="Parent Training" value={
                `Min: ${data.settings.parentTraining.minimumHours}h/${data.settings.parentTraining.periodUnit} · Target: ${data.settings.parentTraining.targetMinHours}–${data.settings.parentTraining.targetMaxHours}h/${data.settings.parentTraining.periodUnit}`
              } />
              <p style={{ fontSize: '12px', color: '#6b7280' }}>
                Settings are configured in the Setup Wizard. Re-run the wizard to change them.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TechnicianCard({ tech, clients, saving, onChange, onRemove }: {
  tech: Technician;
  clients: Client[];
  saving: boolean;
  onChange: (patch: Partial<Technician>) => void;
  onRemove: () => void;
}) {
  const [name, setName] = useState(tech.name);
  const [editing, setEditing] = useState(false);
  const [hoursDraft, setHoursDraft] = useState<{ [idx: number]: string }>({});

  const assignments = tech.assignments || [];
  const updateAssignment = (idx: number, patch: Partial<Technician['assignments'][number]>) => {
    const next = assignments.map((a, i) => i === idx ? { ...a, ...patch } : a);
    onChange({ assignments: next });
  };
  const addAssignment = () => {
    onChange({ assignments: [...assignments, { clientId: '', hoursPerWeek: 0, billable: true }] });
  };
  const removeAssignment = (idx: number) => {
    onChange({ assignments: assignments.filter((_, i) => i !== idx) });
    setHoursDraft(prev => {
      const next = { ...prev };
      delete next[idx];
      return next;
    });
  };
  const commitHours = (idx: number, raw: string) => {
    const parsed = parseFloat(raw);
    const hours = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    if (hours !== assignments[idx]?.hoursPerWeek) updateAssignment(idx, { hoursPerWeek: hours });
    setHoursDraft(prev => {
      const next = { ...prev };
      delete next[idx];
      return next;
    });
  };
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '12px', gap: '8px', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => { if (name !== tech.name) onChange({ name }); }}
            style={{ ...inputStyle, fontWeight: 600, fontSize: '15px' }}
          />
          <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>ID: {tech.id}</p>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          <input
            type="checkbox"
            checked={tech.isRBT}
            onChange={(e) => onChange({ isRBT: e.target.checked })}
            style={{ cursor: 'pointer', width: '18px', height: '18px' }}
          />
          <span>RBT</span>
        </label>
        <button onClick={() => setEditing(!editing)} style={chipBtn}>
          {editing ? 'Done' : 'Edit availability'}
        </button>
        <button onClick={onRemove} style={dangerBtn}>Remove</button>
      </div>
      {saving && <p style={{ fontSize: '11px', color: '#3b82f6' }}>Saving…</p>}

      {!editing ? (
        <AvailabilitySummary windows={tech.availability} />
      ) : (
        <AvailabilityEditor
          initial={tech.availability}
          onSave={(av) => { onChange({ availability: av }); setEditing(false); }}
          onCancel={() => setEditing(false)}
        />
      )}

      <div style={{ marginTop: '12px' }}>
        <p style={{ fontWeight: 600, fontSize: '13px', marginBottom: '6px' }}>Assignments</p>
        {assignments.length > 0 && (
          <div style={{ display: 'flex', gap: '6px', marginBottom: '4px' }}>
            <div style={{ flex: 2, fontSize: '11px', color: '#6b7280', fontWeight: 600, minWidth: 0 }}>Client</div>
            <div style={{ flex: 1, fontSize: '11px', color: '#6b7280', fontWeight: 600, minWidth: 0 }}>Hrs/wk</div>
            <div style={{ width: '32px', flexShrink: 0 }} />
          </div>
        )}
        {assignments.map((a, idx) => (
          <div key={idx} style={{ display: 'flex', gap: '6px', marginBottom: '6px', alignItems: 'center' }}>
            <select
              value={a.clientId}
              onChange={(e) => updateAssignment(idx, { clientId: e.target.value })}
              style={{ ...inputStyle, flex: 2, width: 'auto', minWidth: 0 }}
            >
              <option value="">— Pick client —</option>
              {clients.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
            <input
              type="number"
              step="0.5"
              min="0"
              value={hoursDraft[idx] ?? String(a.hoursPerWeek)}
              onChange={(e) => setHoursDraft({ ...hoursDraft, [idx]: e.target.value })}
              onBlur={(e) => commitHours(idx, e.target.value)}
              style={{ ...inputStyle, flex: 1, width: 'auto', minWidth: 0 }}
            />
            <button
              onClick={() => removeAssignment(idx)}
              style={{
                width: '32px', height: '32px', padding: 0, backgroundColor: '#fee2e2', color: '#dc2626',
                border: '1px solid #fca5a5', borderRadius: '4px', cursor: 'pointer', flexShrink: 0,
                fontSize: '18px', lineHeight: 1,
              }}
              aria-label="Remove assignment"
            >×</button>
          </div>
        ))}
        <button
          onClick={addAssignment}
          style={{
            padding: '6px 12px', fontSize: '13px', backgroundColor: 'white', color: '#3b82f6',
            border: '1px solid #3b82f6', borderRadius: '4px', cursor: 'pointer',
          }}
        >+ Assignment</button>
      </div>
    </div>
  );
}

function AvailabilitySummary({ windows }: { windows?: { [key in DayOfWeek]?: TimeWindow[] } }) {
  const entries = Object.entries(windows || {}).filter(([, w]) => w && w.length > 0);
  if (entries.length === 0) {
    return <p style={{ fontSize: '13px', color: '#6b7280', fontStyle: 'italic' }}>No availability set.</p>;
  }
  return (
    <div style={{ fontSize: '13px', color: '#6b7280' }}>
      {entries.map(([day, w]) => (
        <p key={day}>{day}: {(w as TimeWindow[]).map(x => `${x.start}–${x.end}`).join(', ')}</p>
      ))}
    </div>
  );
}

function AvailabilityEditor({ initial, onSave, onCancel }: {
  initial: { [key in DayOfWeek]?: TimeWindow[] };
  onSave: (av: { [key in DayOfWeek]?: TimeWindow[] }) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<{ [key in DayOfWeek]?: TimeWindow[] }>(initial || {});
  const [presets, setPresets] = useState({ mornings: false, midday: false, evenings: false });

  const setDayWindow = (day: DayOfWeek, idx: number, field: 'start' | 'end', value: string) => {
    const next = { ...draft };
    const list = (next[day] || []).slice();
    list[idx] = { ...list[idx], [field]: value };
    next[day] = list;
    setDraft(next);
  };
  const addWindow = (day: DayOfWeek) => {
    const next = { ...draft };
    next[day] = [...(next[day] || []), { start: '09:00', end: '17:00' }];
    setDraft(next);
  };
  const removeWindow = (day: DayOfWeek, idx: number) => {
    const next = { ...draft };
    next[day] = (next[day] || []).filter((_, i) => i !== idx);
    if ((next[day] || []).length === 0) delete next[day];
    setDraft(next);
  };
  const clearDay = (day: DayOfWeek) => {
    const next = { ...draft };
    delete next[day];
    setDraft(next);
  };
  const copyMondayToWeekdays = () => {
    const monWindows = draft['Monday'] || [];
    const next = { ...draft };
    (['Tuesday', 'Wednesday', 'Thursday', 'Friday'] as DayOfWeek[]).forEach(d => {
      if (monWindows.length === 0) delete next[d];
      else next[d] = monWindows.map(w => ({ ...w }));
    });
    setDraft(next);
  };
  const clearAll = () => { setPresets({ mornings: false, midday: false, evenings: false }); setDraft({}); };

  const togglePreset = (key: 'mornings' | 'midday' | 'evenings') => {
    const next = { ...presets, [key]: !presets[key] };
    setPresets(next);
    const windows: TimeWindow[] = [];
    if (next.mornings) windows.push({ start: '07:00', end: '12:00' });
    if (next.midday) windows.push({ start: '10:00', end: '15:00' });
    if (next.evenings) windows.push({ start: '15:00', end: '20:00' });
    const merged = mergeWindows(windows);
    const nextDraft = { ...draft };
    (['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] as DayOfWeek[]).forEach(d => {
      if (merged.length === 0) delete nextDraft[d];
      else nextDraft[d] = merged.map(w => ({ ...w }));
    });
    setDraft(nextDraft);
  };

  return (
    <div style={{ width: '100%', overflowX: 'hidden', marginTop: '8px' }}>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px', alignItems: 'center' }}>
        {(['mornings', 'midday', 'evenings'] as const).map(key => {
          const label = key === 'mornings' ? 'Mornings 7–12' : key === 'midday' ? 'Midday 10–3' : 'Evenings 3–8';
          return (
            <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', cursor: 'pointer', userSelect: 'none' }}>
              <input type="checkbox" checked={presets[key]} onChange={() => togglePreset(key)} style={{ cursor: 'pointer' }} />
              {label}
            </label>
          );
        })}
        <button onClick={copyMondayToWeekdays} style={chipBtn}>Copy Mon → Tue–Fri</button>
        <button onClick={clearAll} style={{ ...chipBtn, color: '#dc2626', borderColor: '#fca5a5' }}>Clear all</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {DAYS.map((day, dayIdx) => {
          const windows = draft[day] || [];
          return (
            <div
              key={day}
              style={{
                display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap',
                padding: '6px 8px', borderRadius: '4px',
                background: dayIdx % 2 === 0 ? '#f9fafb' : 'white',
                border: '1px solid #e5e7eb',
                boxSizing: 'border-box', width: '100%', minWidth: 0,
              }}
            >
              <span style={{ width: '36px', flexShrink: 0, fontSize: '13px', fontWeight: 600 }}>{day.slice(0, 3)}</span>
              {windows.length === 0 ? (
                <span style={{ fontSize: '12px', color: '#9ca3af', fontStyle: 'italic' }}>Off</span>
              ) : (
                windows.map((w, idx) => (
                  <span key={idx} style={{ display: 'inline-flex', gap: '3px', alignItems: 'center' }}>
                    <input
                      type="time"
                      step="900"
                      value={w.start}
                      onChange={(e) => setDayWindow(day, idx, 'start', e.target.value)}
                      style={editTimeInput}
                    />
                    <span style={{ fontSize: '12px', color: '#6b7280' }}>–</span>
                    <input
                      type="time"
                      step="900"
                      value={w.end}
                      onChange={(e) => setDayWindow(day, idx, 'end', e.target.value)}
                      style={editTimeInput}
                    />
                    <button
                      onClick={() => removeWindow(day, idx)}
                      style={{ ...dangerBtn, padding: '2px 6px', fontSize: '11px' }}
                      title="Remove this window"
                    >×</button>
                  </span>
                ))
              )}
              <button
                onClick={() => addWindow(day)}
                style={{ ...chipBtn, padding: '2px 8px', fontSize: '11px' }}
              >+ window</button>
              {windows.length > 0 && (
                <button
                  onClick={() => clearDay(day)}
                  style={{ ...chipBtn, fontSize: '11px', padding: '2px 8px', marginLeft: 'auto' }}
                  title={`Clear ${day}`}
                >Off</button>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
        <button onClick={() => onSave(draft)} style={primaryBtn}>Save</button>
        <button onClick={onCancel} style={chipBtn}>Cancel</button>
      </div>
    </div>
  );
}

function ClientCard({ client, saving, onChange, onRemove }: {
  client: Client;
  saving: boolean;
  onChange: (patch: Partial<Client>) => void;
  onRemove: () => void;
}) {
  const [name, setName] = useState(client.name);
  const [maxStr, setMaxStr] = useState(client.parentTrainingMaxHours !== undefined ? String(client.parentTrainingMaxHours) : '');
  const [editing, setEditing] = useState(false);

  const commitMax = () => {
    const next = maxStr === '' ? undefined : parseFloat(maxStr);
    if (next !== client.parentTrainingMaxHours) {
      onChange({ parentTrainingMaxHours: Number.isFinite(next as number) ? next : undefined });
    }
  };

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '12px', gap: '8px', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => { if (name !== client.name) onChange({ name }); }}
            style={{ ...inputStyle, fontWeight: 600, fontSize: '15px' }}
          />
        </div>
        <button onClick={() => setEditing(!editing)} style={chipBtn}>
          {editing ? 'Done' : 'Edit availability'}
        </button>
        <button onClick={onRemove} style={dangerBtn}>Remove</button>
      </div>
      {saving && <p style={{ fontSize: '11px', color: '#3b82f6' }}>Saving…</p>}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
        <label style={{ fontSize: '12px', color: '#374151', whiteSpace: 'nowrap' }}>
          Parent-training max:
        </label>
        <input
          type="number" step="0.5" min="0"
          value={maxStr}
          onChange={(e) => setMaxStr(e.target.value)}
          onBlur={commitMax}
          placeholder="—"
          style={{ ...inputStyle, width: '90px' }}
        />
        <span style={{ fontSize: '11px', color: '#6b7280' }}>h per case-period</span>
      </div>
      {!editing ? (
        <AvailabilitySummary windows={client.availabilityWindows} />
      ) : (
        <AvailabilityEditor
          initial={client.availabilityWindows || {}}
          onSave={(av) => { onChange({ availabilityWindows: av }); setEditing(false); }}
          onCancel={() => setEditing(false)}
        />
      )}
    </div>
  );
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p style={{ fontSize: '13px', fontWeight: '600', marginBottom: '4px' }}>{label}</p>
      <p style={{ color: '#6b7280' }}>{value}</p>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  backgroundColor: '#f9f9f9',
  border: '1px solid #e5e7eb',
  borderRadius: '8px',
  padding: '16px',
};

const inputStyle: React.CSSProperties = {
  padding: '6px 10px',
  border: '1px solid #d1d5db',
  borderRadius: '4px',
  fontSize: '13px',
  width: '100%',
  boxSizing: 'border-box',
};

const primaryBtn: React.CSSProperties = {
  padding: '6px 12px',
  backgroundColor: '#3b82f6',
  color: 'white',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '13px',
};

const dangerBtn: React.CSSProperties = {
  padding: '6px 10px',
  backgroundColor: '#fee2e2',
  color: '#dc2626',
  border: '1px solid #fca5a5',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '13px',
};

const chipBtn: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: '12px',
  border: '1px solid #d1d5db',
  borderRadius: '4px',
  background: 'white',
  cursor: 'pointer',
  color: '#374151',
};

const editTimeInput: React.CSSProperties = {
  fontSize: '13px',
  padding: '3px 6px',
  border: '1px solid #d1d5db',
  borderRadius: '4px',
  fontFamily: 'inherit',
  width: '75px',
  minWidth: 0,
};
