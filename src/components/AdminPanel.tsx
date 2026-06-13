import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { ScheduleData, Technician, Client, DayOfWeek, TimeWindow, Blackout, CompanySettings, TrainingPeriodUnit, Authorization, ManualUsage, AuthBucketKey, AUTH_BUCKETS, SupervisionCadence, SUPERVISION_CADENCES } from '../types';
import { computeAuthUsage } from '../authorization';
import { PRESET_WINDOWS, PRESET_LABELS, PresetKey, isPresetActive, togglePreset } from '../availabilityUtils';
import { resolveUtilization } from '../utilization';

interface AdminPanelProps {
  data: ScheduleData;
  onDataChange: (data: ScheduleData) => void;
  // Data-lifecycle actions surfaced at the bottom of the Settings tab.
  onImportFile?: () => void;
  onRerunWizard?: () => void;
}

const API_BASE = '/api';
const DAYS: DayOfWeek[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export default function AdminPanel({ data, onDataChange, onImportFile, onRerunWizard }: AdminPanelProps) {
  const [activeTab, setActiveTab] = useState<'technicians' | 'clients' | 'auths' | 'blackouts' | 'settings'>('technicians');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reordering, setReordering] = useState<null | 'clients' | 'technicians'>(null);

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

  const addBlackout = async (blackout: Blackout) => {
    setSavingId(blackout.id);
    setError(null);
    try {
      const res = await axios.post(`${API_BASE}/admin/blackout`, blackout);
      const saved: Blackout = res.data.blackout || blackout;
      onDataChange({ ...data, blackouts: [...(data.blackouts || []), saved] });
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setSavingId(null);
    }
  };

  const removeBlackout = async (id: string) => {
    setSavingId(id);
    setError(null);
    try {
      await axios.delete(`${API_BASE}/admin/blackout/${id}`);
      onDataChange({ ...data, blackouts: (data.blackouts || []).filter(b => b.id !== id) });
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setSavingId(null);
    }
  };

  const persistSettings = async (next: CompanySettings) => {
    setSavingId('settings');
    setError(null);
    try {
      const res = await axios.post(`${API_BASE}/admin/settings`, next);
      onDataChange({ ...data, settings: res.data.settings });
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setSavingId(null);
    }
  };

  const upsertAuth = async (auth: Authorization) => {
    setSavingId(auth.id);
    setError(null);
    try {
      const res = await axios.post(`${API_BASE}/admin/authorization`, auth);
      const saved: Authorization = res.data.authorization || auth;
      const list = data.authorizations || [];
      const next = list.some(a => a.id === saved.id)
        ? list.map(a => a.id === saved.id ? saved : a)
        : [...list, saved];
      onDataChange({ ...data, authorizations: next });
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setSavingId(null);
    }
  };

  const removeAuth = async (id: string) => {
    if (!confirm('Remove this authorization? Manual hour entries are kept.')) return;
    setSavingId(id);
    setError(null);
    try {
      await axios.delete(`${API_BASE}/admin/authorization/${id}`);
      onDataChange({ ...data, authorizations: (data.authorizations || []).filter(a => a.id !== id) });
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setSavingId(null);
    }
  };

  const upsertUsage = async (usage: ManualUsage) => {
    setSavingId(usage.id);
    setError(null);
    try {
      const res = await axios.post(`${API_BASE}/admin/manual-usage`, usage);
      const saved: ManualUsage = res.data.usage || usage;
      const list = data.manualUsage || [];
      const next = list.some(u => u.id === saved.id)
        ? list.map(u => u.id === saved.id ? saved : u)
        : [...list, saved];
      onDataChange({ ...data, manualUsage: next });
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setSavingId(null);
    }
  };

  const removeUsage = async (id: string) => {
    setSavingId(id);
    setError(null);
    try {
      await axios.delete(`${API_BASE}/admin/manual-usage/${id}`);
      onDataChange({ ...data, manualUsage: (data.manualUsage || []).filter(u => u.id !== id) });
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setSavingId(null);
    }
  };

  const reorderEntity = async (entity: 'clients' | 'technicians', orderedIds: string[]) => {
    setError(null);
    try {
      await axios.post(`${API_BASE}/admin/reorder`, { entity, order: orderedIds });
      const list = entity === 'clients' ? data.clients : data.technicians;
      const byId = new Map(list.map(x => [x.id, x]));
      const reordered = orderedIds.map(id => byId.get(id)).filter(Boolean);
      onDataChange({ ...data, [entity]: reordered } as ScheduleData);
    } catch (e: any) {
      setError(e.response?.data?.error || e.message);
    }
  };

  const sortEntityByName = (entity: 'clients' | 'technicians', dir: 'asc' | 'desc') => {
    const list = entity === 'clients' ? data.clients : data.technicians;
    const ordered = [...list].sort((a, b) =>
      dir === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name)
    );
    reorderEntity(entity, ordered.map(x => x.id));
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
        <button onClick={() => setActiveTab('auths')} style={tabStyle(activeTab === 'auths')}>Auths</button>
        <button onClick={() => setActiveTab('blackouts')} style={tabStyle(activeTab === 'blackouts')}>Blackouts</button>
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', gap: 8 }}>
              <h3 style={{ fontSize: '18px', fontWeight: 'bold' }}>Manage Technicians ({data.technicians.length})</h3>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {data.technicians.length > 1 && (
                  <SortMenu
                    onSortAsc={() => sortEntityByName('technicians', 'asc')}
                    onSortDesc={() => sortEntityByName('technicians', 'desc')}
                    onReorder={() => setReordering('technicians')}
                  />
                )}
                <button onClick={addTechnician} style={primaryBtn}>+ Add Technician</button>
              </div>
            </div>
            {reordering === 'technicians' ? (
              <ReorderList
                items={data.technicians.map(t => ({ id: t.id, name: t.name, meta: t.isRBT ? 'RBT' : undefined }))}
                onCommit={(ids) => { reorderEntity('technicians', ids); setReordering(null); }}
                onCancel={() => setReordering(null)}
              />
            ) : (
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
            )}
          </div>
        )}

        {activeTab === 'clients' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', gap: 8 }}>
              <h3 style={{ fontSize: '18px', fontWeight: 'bold' }}>Manage Clients ({data.clients.length})</h3>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {data.clients.length > 1 && (
                  <SortMenu
                    onSortAsc={() => sortEntityByName('clients', 'asc')}
                    onSortDesc={() => sortEntityByName('clients', 'desc')}
                    onReorder={() => setReordering('clients')}
                  />
                )}
                <button onClick={addClient} style={primaryBtn}>+ Add Client</button>
              </div>
            </div>
            {reordering === 'clients' ? (
              <ReorderList
                items={data.clients.map(c => ({ id: c.id, name: c.name }))}
                onCommit={(ids) => { reorderEntity('clients', ids); setReordering(null); }}
                onCancel={() => setReordering(null)}
              />
            ) : (
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
            )}
          </div>
        )}

        {activeTab === 'auths' && (
          <AuthsTab
            data={data}
            savingId={savingId}
            onUpsertAuth={upsertAuth}
            onRemoveAuth={removeAuth}
            onUpsertUsage={upsertUsage}
            onRemoveUsage={removeUsage}
          />
        )}

        {activeTab === 'blackouts' && (
          <BlackoutsTab
            blackouts={data.blackouts || []}
            technicians={data.technicians}
            clients={data.clients}
            savingId={savingId}
            onAdd={addBlackout}
            onRemove={removeBlackout}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsEditor
            settings={data.settings}
            saving={savingId === 'settings'}
            onSave={persistSettings}
            onImportFile={onImportFile}
            onRerunWizard={onRerunWizard}
          />
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
  const [collapsed, setCollapsed] = useState(true);
  const [hoursDraft, setHoursDraft] = useState<{ [idx: number]: string }>({});

  const assignments = tech.assignments || [];
  const safeClients = clients || [];
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
  const availDays = Object.values(tech.availability || {}).filter(w => w && (w as TimeWindow[]).length > 0).length;

  return (
    <div style={cardStyle}>
      <CardHeader
        collapsed={collapsed}
        onToggle={() => setCollapsed(c => !c)}
        name={tech.name}
        badges={tech.isRBT ? ['RBT'] : []}
        summary={`${availDays} day${availDays === 1 ? '' : 's'} avail · ${assignments.length} assignment${assignments.length === 1 ? '' : 's'}`}
      />

      {!collapsed && (<>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', margin: '12px 0', gap: '8px', flexWrap: 'wrap' }}>
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
              {safeClients.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
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
      </>)}
    </div>
  );
}

function CardHeader({ collapsed, onToggle, name, badges, summary }: {
  collapsed: boolean;
  onToggle: () => void;
  name: string;
  badges: string[];
  summary: string;
}) {
  return (
    <div
      onClick={onToggle}
      style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', minWidth: 0 }}
    >
      <span style={{ fontSize: '12px', color: '#6b7280', width: '12px', flexShrink: 0 }}>{collapsed ? '▸' : '▾'}</span>
      <span style={{ fontWeight: 600, fontSize: '15px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {name || 'Unnamed'}
      </span>
      {badges.map(b => (
        <span key={b} style={{
          fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', padding: '1px 6px',
          borderRadius: '8px', backgroundColor: '#dbeafe', color: '#1e40af', flexShrink: 0,
        }}>{b}</span>
      ))}
      {collapsed && (
        <span style={{ fontSize: '12px', color: '#6b7280', marginLeft: 'auto', whiteSpace: 'nowrap', flexShrink: 0 }}>
          {summary}
        </span>
      )}
    </div>
  );
}

function SortMenu({ onSortAsc, onSortDesc, onReorder }: {
  onSortAsc: () => void;
  onSortDesc: () => void;
  onReorder: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-label="Sort and reorder"
        title="Sort / reorder"
        style={{ ...chipBtn, fontSize: '15px', lineHeight: 1, padding: '5px 9px' }}
      >⚙</button>
      {open && (
        <>
          {/* Click-away backdrop */}
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 19 }} />
          <div style={{
            position: 'absolute', right: 0, top: '110%', zIndex: 20, background: 'white',
            border: '1px solid #e5e7eb', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
            minWidth: 170, overflow: 'hidden',
          }}>
            <MenuItem onClick={() => { setOpen(false); onSortAsc(); }}>Sort name A → Z</MenuItem>
            <MenuItem onClick={() => { setOpen(false); onSortDesc(); }}>Sort name Z → A</MenuItem>
            <MenuItem onClick={() => { setOpen(false); onReorder(); }}>Drag to reorder…</MenuItem>
          </div>
        </>
      )}
    </div>
  );
}

function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px',
        border: 'none', borderBottom: '1px solid #f3f4f6', background: 'white',
        cursor: 'pointer', fontSize: '13px', color: '#374151',
      }}
    >{children}</button>
  );
}

// Touch-friendly drag-to-reorder list (pointer events, works on iOS). Renders a
// compact row per item with a ≡ handle; commits the final id order on Done.
function ReorderList({ items, onCommit, onCancel }: {
  items: { id: string; name: string; meta?: string }[];
  onCommit: (orderedIds: string[]) => void;
  onCancel: () => void;
}) {
  const [order, setOrder] = useState(items);
  const [dragId, setDragId] = useState<string | null>(null);

  useEffect(() => {
    if (!dragId) return;
    const onMove = (e: PointerEvent) => {
      const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest('[data-rid]') as HTMLElement | null;
      const overId = el?.dataset.rid;
      if (!overId || overId === dragId) return;
      setOrder(prev => {
        const from = prev.findIndex(i => i.id === dragId);
        const to = prev.findIndex(i => i.id === overId);
        if (from < 0 || to < 0 || from === to) return prev;
        const next = [...prev];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return next;
      });
    };
    const onUp = () => setDragId(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragId]);

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <button onClick={() => onCommit(order.map(i => i.id))} style={primaryBtn}>Done</button>
        <button onClick={onCancel} style={chipBtn}>Cancel</button>
        <span style={{ fontSize: 12, color: '#6b7280' }}>Drag the ≡ handle to reorder</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {order.map(it => (
          <div
            key={it.id}
            data-rid={it.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
              border: '1px solid #e5e7eb', borderRadius: 6,
              background: dragId === it.id ? '#eff6ff' : 'white',
              boxShadow: dragId === it.id ? '0 2px 8px rgba(0,0,0,0.12)' : 'none',
              // Row stays scrollable on touch; only the ≡ handle suppresses
              // scrolling so vertical drags reorder instead of pan.
            }}
          >
            <span
              onPointerDown={(e) => { e.preventDefault(); setDragId(it.id); }}
              aria-label="Drag to reorder"
              style={{ cursor: 'grab', fontSize: 20, color: '#9ca3af', touchAction: 'none', userSelect: 'none', lineHeight: 1 }}
            >≡</span>
            <span style={{ fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {it.name || 'Unnamed'}
            </span>
            {it.meta && (
              <span style={{
                fontSize: 10, fontWeight: 700, textTransform: 'uppercase', padding: '1px 6px',
                borderRadius: 8, backgroundColor: '#dbeafe', color: '#1e40af',
              }}>{it.meta}</span>
            )}
          </div>
        ))}
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
  const clearAll = () => setDraft({});

  const handleTogglePreset = (key: PresetKey) => {
    const preset = PRESET_WINDOWS[key];
    const active = isPresetActive(draft, preset);
    setDraft(togglePreset(draft, preset, !active));
  };

  return (
    <div style={{ width: '100%', overflowX: 'hidden', marginTop: '8px' }}>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px', alignItems: 'center' }}>
        {(Object.keys(PRESET_WINDOWS) as PresetKey[]).map(key => (
          <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', cursor: 'pointer', userSelect: 'none' }}>
            <input
              type="checkbox"
              checked={isPresetActive(draft, PRESET_WINDOWS[key])}
              onChange={() => handleTogglePreset(key)}
              style={{ cursor: 'pointer' }}
            />
            {PRESET_LABELS[key]}
          </label>
        ))}
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
  const [collapsed, setCollapsed] = useState(true);

  const commitMax = () => {
    const next = maxStr === '' ? undefined : parseFloat(maxStr);
    if (next !== client.parentTrainingMaxHours) {
      onChange({ parentTrainingMaxHours: Number.isFinite(next as number) ? next : undefined });
    }
  };

  const availDays = Object.values(client.availabilityWindows || {}).filter(w => w && (w as TimeWindow[]).length > 0).length;
  const ptMax = client.parentTrainingMaxHours;

  return (
    <div style={cardStyle}>
      <CardHeader
        collapsed={collapsed}
        onToggle={() => setCollapsed(c => !c)}
        name={client.name}
        badges={[]}
        summary={`${availDays} day${availDays === 1 ? '' : 's'} avail${ptMax !== undefined ? ` · PT max ${ptMax}h` : ''}`}
      />

      {!collapsed && (<>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', margin: '12px 0', gap: '8px', flexWrap: 'wrap' }}>
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

      {/* Per-case clinical / scheduling metadata (feeds the correction engine) */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10, fontSize: 12, color: '#374151' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span>Supervision cadence:</span>
          <select
            value={client.cadenceGoal || ''}
            onChange={e => onChange({ cadenceGoal: (e.target.value || undefined) as SupervisionCadence | undefined })}
            style={{ ...inputStyle, width: 'auto' }}
          >
            <option value="">—</option>
            {SUPERVISION_CADENCES.map(c => <option key={c.value} value={c.value}>{c.value} · {c.label}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }} title="When OFF, parent training must coincide with a direct session.">
          <input type="checkbox" checked={client.parentAvailableOutsideSessions === true}
            onChange={e => onChange({ parentAvailableOutsideSessions: e.target.checked || undefined })} />
          <span>Parent available outside sessions</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }} title="When OFF, the engine won't propose partial-staff coverage.">
          <input type="checkbox" checked={client.partialStaffAllowed !== false}
            onChange={e => onChange({ partialStaffAllowed: e.target.checked ? undefined : false })} />
          <span>Partial staff allowed</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="checkbox" checked={client.isEI === true}
            onChange={e => onChange({ isEI: e.target.checked || undefined })} />
          <span>EI case</span>
        </label>
        {client.isEI && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>EI date:</span>
            <input type="date" value={client.eiDate || ''}
              onChange={e => onChange({ eiDate: e.target.value || undefined })} style={{ ...inputStyle, width: 140 }} />
          </label>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, flex: '1 1 180px' }}>
          <span style={{ whiteSpace: 'nowrap' }}>Anticipated discharge:</span>
          <input value={client.anticipatedDischarge || ''}
            onBlur={e => { if ((e.target.value || undefined) !== client.anticipatedDischarge) onChange({ anticipatedDischarge: e.target.value || undefined }); }}
            defaultValue={client.anticipatedDischarge || ''}
            placeholder="date / note" style={{ ...inputStyle, flex: 1, minWidth: 0 }} />
        </label>
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
      </>)}
    </div>
  );
}

function AuthsTab({ data, savingId, onUpsertAuth, onRemoveAuth, onUpsertUsage, onRemoveUsage }: {
  data: ScheduleData;
  savingId: string | null;
  onUpsertAuth: (a: Authorization) => void;
  onRemoveAuth: (id: string) => void;
  onUpsertUsage: (u: ManualUsage) => void;
  onRemoveUsage: (id: string) => void;
}) {
  const auths = data.authorizations || [];
  const addAuthFor = (clientId: string) => {
    const start = todayStr();
    const end = new Date();
    end.setMonth(end.getMonth() + 6);
    onUpsertAuth({
      id: uuidv4(),
      clientId,
      startDate: start,
      endDate: `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`,
      buckets: {},
    });
  };

  return (
    <div>
      <h3 style={{ marginBottom: '8px', fontSize: '18px', fontWeight: 'bold' }}>Authorizations</h3>
      <p style={{ fontSize: '13px', color: '#6b7280', marginBottom: '16px' }}>
        Set the authorized <strong>weekly rates</strong> (direct / supervision / parent-training / case-planning) —
        what the correction engine paces against; supervision ≈ 20% of direct is the insurer cap. Span-total
        buckets below remain for tracking + the per-auth reassessment block. Use manual entries for hours
        delivered before adopting this system (adopt-forward). The end date is the service / makeup cliff.
      </p>
      <div style={{ display: 'grid', gap: '16px' }}>
        {data.clients.map(client => {
          const clientAuths = auths.filter(a => a.clientId === client.id);
          return (
            <div key={client.id} style={cardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600, fontSize: '15px' }}>{client.name}</span>
                <button onClick={() => addAuthFor(client.id)} style={chipBtn}>+ Add authorization</button>
              </div>
              {clientAuths.length === 0 ? (
                <p style={{ fontSize: '12px', color: '#9ca3af', fontStyle: 'italic', marginTop: 8 }}>No authorization on file.</p>
              ) : clientAuths.map(auth => (
                <AuthCard
                  key={auth.id}
                  data={data}
                  auth={auth}
                  saving={savingId === auth.id}
                  onChange={(patch) => onUpsertAuth({ ...auth, ...patch })}
                  onRemove={() => onRemoveAuth(auth.id)}
                  onUpsertUsage={onUpsertUsage}
                  onRemoveUsage={onRemoveUsage}
                />
              ))}
            </div>
          );
        })}
        {data.clients.length === 0 && (
          <p style={{ color: '#9ca3af', textAlign: 'center', padding: '20px' }}>No clients yet.</p>
        )}
      </div>
    </div>
  );
}

function AuthCard({ data, auth, saving, onChange, onRemove, onUpsertUsage, onRemoveUsage }: {
  data: ScheduleData;
  auth: Authorization;
  saving: boolean;
  onChange: (patch: Partial<Authorization>) => void;
  onRemove: () => void;
  onUpsertUsage: (u: ManualUsage) => void;
  onRemoveUsage: (id: string) => void;
}) {
  const [label, setLabel] = useState(auth.label || '');
  const [bucketDrafts, setBucketDrafts] = useState<{ [k in AuthBucketKey]?: string }>({});
  // Manual entry add form
  const [mBucket, setMBucket] = useState<AuthBucketKey>('direct');
  const [mHours, setMHours] = useState('');
  const [mDate, setMDate] = useState(todayStr());
  const [mNote, setMNote] = useState('');

  const usage = computeAuthUsage(data, auth, new Date());
  const fmt = (n: number) => (Math.round(n * 10) / 10).toString();
  const cliffColor = usage.daysLeft < 0 ? '#9ca3af' : usage.daysLeft <= 21 ? '#b91c1c' : usage.daysLeft <= 45 ? '#b45309' : '#15803d';

  const commitBucket = (key: AuthBucketKey, raw: string) => {
    const v = parseFloat(raw);
    const next = { ...auth.buckets };
    if (Number.isFinite(v) && v > 0) next[key] = v;
    else delete next[key];
    onChange({ buckets: next });
    setBucketDrafts(prev => ({ ...prev, [key]: undefined }));
  };

  const manualInSpan = (data.manualUsage || []).filter(
    u => u.clientId === auth.clientId && u.date >= auth.startDate && u.date <= auth.endDate
  );

  const addManual = () => {
    const h = parseFloat(mHours);
    if (!Number.isFinite(h) || h <= 0 || !mDate) return;
    onUpsertUsage({
      id: uuidv4(), clientId: auth.clientId, bucket: mBucket,
      hours: h, date: mDate, note: mNote.trim() || undefined,
    });
    setMHours(''); setMNote('');
  };

  return (
    <div style={{ marginTop: 10, padding: '10px 12px', border: '1px solid #e5e7eb', borderRadius: 6, background: 'white' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 140px', minWidth: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#374151' }}>Auth label / number</span>
          <input value={label} onChange={e => setLabel(e.target.value)}
            onBlur={() => { if (label !== (auth.label || '')) onChange({ label: label || undefined }); }}
            placeholder="optional" style={inputStyle} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#374151' }}>Start</span>
          <input type="date" value={auth.startDate} onChange={e => onChange({ startDate: e.target.value })} style={inputStyle} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#374151' }}>End (cliff)</span>
          <input type="date" value={auth.endDate} onChange={e => onChange({ endDate: e.target.value })} style={inputStyle} />
        </label>
        <button onClick={onRemove} style={dangerBtn}>Remove</button>
      </div>
      <p style={{ fontSize: 12, fontWeight: 600, color: cliffColor, marginTop: 6 }}>
        {usage.daysLeft < 0 ? `Expired ${-usage.daysLeft} day(s) ago` : `${usage.daysLeft} day(s) until auth ends`}
      </p>
      {saving && <p style={{ fontSize: 11, color: '#3b82f6' }}>Saving…</p>}

      {/* Per-week authorized rates — what the correction engine reasons over. */}
      <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed #e5e7eb' }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 6 }}>
          Authorized weekly rates <span style={{ fontWeight: 400, color: '#9ca3af' }}>(supervision ≈ 20% of direct = the cap)</span>
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {([['direct', 'Direct'], ['supervision', 'Supervision'], ['parentTraining', 'Parent trng'], ['casePlanning', 'Case plan']] as const).map(([key, lbl]) => (
            <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 10, color: '#6b7280' }}>{lbl} h/wk</span>
              <input
                type="number" step="0.5" min="0" inputMode="decimal"
                defaultValue={auth.weekly?.[key] !== undefined ? String(auth.weekly[key]) : ''}
                onBlur={e => {
                  const v = parseFloat(e.target.value);
                  const next = { ...(auth.weekly || {}) };
                  if (Number.isFinite(v) && v > 0) next[key] = v; else delete next[key];
                  onChange({ weekly: Object.keys(next).length ? next : undefined });
                }}
                placeholder="—" style={{ ...inputStyle, width: 64 }}
              />
            </label>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 10, color: '#6b7280' }}>Report final due (insurer)</span>
            <input type="date" value={auth.reportFinalDue || ''}
              onChange={e => onChange({ reportFinalDue: e.target.value || undefined })} style={{ ...inputStyle, width: 150 }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 10, color: '#6b7280' }}>Report draft due (internal)</span>
            <input type="date" value={auth.reportDraftDue || ''}
              onChange={e => onChange({ reportDraftDue: e.target.value || undefined })} style={{ ...inputStyle, width: 150 }} />
          </label>
        </div>
      </div>

      {/* Bucket table: authorized input + usage readout */}
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {AUTH_BUCKETS.map(({ key, label: bLabel }) => {
          const b = usage.buckets.find(x => x.key === key)!.usage;
          const over = b.authorized > 0 && b.remaining < -0.01;
          const rowColor = over ? '#b91c1c' : '#374151';
          return (
            <div key={key} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
              <span style={{ flex: '1 1 150px', minWidth: 0, color: '#374151' }}>{bLabel}</span>
              <input
                type="number" step="0.5" min="0" inputMode="decimal"
                value={bucketDrafts[key] ?? (auth.buckets[key] !== undefined ? String(auth.buckets[key]) : '')}
                onChange={e => setBucketDrafts(prev => ({ ...prev, [key]: e.target.value }))}
                onBlur={e => commitBucket(key, e.target.value)}
                placeholder="—" style={{ ...inputStyle, width: 70 }}
              />
              <span style={{ color: rowColor, whiteSpace: 'nowrap' }}>
                {b.authorized > 0
                  ? <>used {fmt(b.used)} · sched {fmt(b.scheduled)} · <strong>{over ? `${fmt(-b.remaining)}h OVER` : `${fmt(b.remaining)}h left`}</strong></>
                  : <span style={{ color: '#9ca3af' }}>not authorized</span>}
              </span>
            </div>
          );
        })}
      </div>

      {/* Manual (outside-system) hours */}
      <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px dashed #e5e7eb' }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 6 }}>Manual hours (delivered outside this system)</p>
        {manualInSpan.map(u => (
          <div key={u.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, marginBottom: 4, flexWrap: 'wrap' }}>
            <span style={{ color: '#6b7280', whiteSpace: 'nowrap' }}>{u.date}</span>
            <span style={{ flex: '1 1 120px', minWidth: 0 }}>
              {AUTH_BUCKETS.find(b => b.key === u.bucket)?.label || u.bucket} — <strong>{u.hours}h</strong>
              {u.note ? <span style={{ color: '#9ca3af' }}> · {u.note}</span> : null}
            </span>
            <button onClick={() => onRemoveUsage(u.id)} style={{ ...dangerBtn, padding: '2px 8px', fontSize: 11 }}>×</button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
          <select value={mBucket} onChange={e => setMBucket(e.target.value as AuthBucketKey)} style={{ ...inputStyle, width: 'auto', flex: '1 1 130px', minWidth: 0 }}>
            {AUTH_BUCKETS.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
          </select>
          <input type="number" step="0.25" min="0" placeholder="hrs" value={mHours} onChange={e => setMHours(e.target.value)} style={{ ...inputStyle, width: 60 }} />
          <input type="date" value={mDate} onChange={e => setMDate(e.target.value)} style={{ ...inputStyle, width: 130 }} />
          <input placeholder="note (optional)" value={mNote} onChange={e => setMNote(e.target.value)} style={{ ...inputStyle, flex: '1 1 120px', minWidth: 0 }} />
          <button onClick={addManual} style={chipBtn} disabled={!mHours || !mDate}>+ Add</button>
        </div>
      </div>
    </div>
  );
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// "2026-05-08" → "Thu, May 8, 2026" (parsed as a local day, no TZ shift).
function formatBlackoutDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
  });
}

function BlackoutsTab({ blackouts, technicians, clients, savingId, onAdd, onRemove }: {
  blackouts: Blackout[];
  technicians: Technician[];
  clients: Client[];
  savingId: string | null;
  onAdd: (b: Blackout) => void;
  onRemove: (id: string) => void;
}) {
  // entity picker value is "technician:<id>" / "client:<id>" so the two
  // namespaces can share one <select> without id collisions.
  const [entityKey, setEntityKey] = useState('');
  const [date, setDate] = useState(todayStr());
  const [reason, setReason] = useState('');

  const submit = () => {
    if (!entityKey || !date) return;
    const [entityType, entityId] = entityKey.split(':') as ['technician' | 'client', string];
    const entityName = entityType === 'technician'
      ? technicians.find(t => t.id === entityId)?.name
      : clients.find(c => c.id === entityId)?.name;
    onAdd({
      id: uuidv4(),
      entityType,
      entityId,
      entityName,
      date,
      reason: reason.trim() || undefined,
      createdAt: new Date().toISOString(),
    });
    setReason('');
  };

  const today = todayStr();
  const sorted = [...blackouts].sort((a, b) => a.date.localeCompare(b.date));
  const upcoming = sorted.filter(b => b.date >= today);
  const past = sorted.filter(b => b.date < today).reverse();

  const nameFor = (b: Blackout): string => {
    const live = b.entityType === 'technician'
      ? technicians.find(t => t.id === b.entityId)?.name
      : clients.find(c => c.id === b.entityId)?.name;
    return live || b.entityName || b.entityId;
  };

  const renderRow = (b: Blackout, dim: boolean) => (
    <div key={b.id} style={{
      display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px',
      border: '1px solid #e5e7eb', borderRadius: '6px', backgroundColor: dim ? '#f9fafb' : 'white',
      opacity: dim ? 0.75 : 1, flexWrap: 'wrap',
    }}>
      <div style={{ flex: '1 1 200px', minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '14px', color: '#111827' }}>
          {formatBlackoutDate(b.date)}
        </div>
        <div style={{ fontSize: '13px', color: '#374151', marginTop: '2px' }}>
          <span style={{
            fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', padding: '1px 6px',
            borderRadius: '8px', marginRight: '6px',
            backgroundColor: b.entityType === 'technician' ? '#dbeafe' : '#fef3c7',
            color: b.entityType === 'technician' ? '#1e40af' : '#92400e',
          }}>{b.entityType === 'technician' ? 'Staff' : 'Client'}</span>
          {nameFor(b)}
        </div>
        {b.reason && (
          <div style={{ fontSize: '12px', color: '#6b7280', marginTop: '2px', fontStyle: 'italic' }}>
            {b.reason}
          </div>
        )}
      </div>
      <button onClick={() => onRemove(b.id)} style={dangerBtn} disabled={savingId === b.id}>
        {savingId === b.id ? '…' : 'Remove'}
      </button>
    </div>
  );

  return (
    <div>
      <h3 style={{ marginBottom: '8px', fontSize: '18px', fontWeight: 'bold' }}>Blackout Days</h3>
      <p style={{ fontSize: '13px', color: '#6b7280', marginBottom: '16px' }}>
        Mark a staff member or client as away on a specific day (e.g. an appointment, PTO, travel).
        Sessions scheduled on a blackout day are flagged as conflicts, and the reason is kept here for review.
      </p>

      {/* Add form */}
      <div style={{ ...cardStyle, marginBottom: '20px', display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '1 1 180px', minWidth: 0 }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: '#374151' }}>Who</span>
          <select value={entityKey} onChange={e => setEntityKey(e.target.value)} style={inputStyle}>
            <option value="">— Pick staff or client —</option>
            {technicians.length > 0 && (
              <optgroup label="Staff">
                {technicians.map(t => <option key={t.id} value={`technician:${t.id}`}>{t.name}</option>)}
              </optgroup>
            )}
            {clients.length > 0 && (
              <optgroup label="Clients">
                {clients.map(c => <option key={c.id} value={`client:${c.id}`}>{c.name}</option>)}
              </optgroup>
            )}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '0 1 150px' }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: '#374151' }}>Date</span>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '1 1 180px', minWidth: 0 }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: '#374151' }}>Reason (optional)</span>
          <input
            type="text" value={reason} onChange={e => setReason(e.target.value)}
            placeholder="e.g. dentist appointment" style={inputStyle}
            onKeyDown={e => { if (e.key === 'Enter') submit(); }}
          />
        </label>
        <button onClick={submit} style={primaryBtn} disabled={!entityKey || !date}>+ Add blackout</button>
      </div>

      {blackouts.length === 0 ? (
        <p style={{ color: '#9ca3af', textAlign: 'center', padding: '20px' }}>No blackout days recorded.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {upcoming.length > 0 && (
            <div>
              <p style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: '#6b7280', marginBottom: '8px' }}>
                Upcoming ({upcoming.length})
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {upcoming.map(b => renderRow(b, false))}
              </div>
            </div>
          )}
          {past.length > 0 && (
            <div>
              <p style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: '#6b7280', marginBottom: '8px' }}>
                Past ({past.length})
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {past.map(b => renderRow(b, true))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SettingsEditor({ settings, saving, onSave, onImportFile, onRerunWizard }: {
  settings: CompanySettings;
  saving: boolean;
  onSave: (next: CompanySettings) => void;
  onImportFile?: () => void;
  onRerunWizard?: () => void;
}) {
  const s = (n: number | undefined) => (n === undefined ? '' : String(n));
  const [directPct, setDirectPct] = useState(s(settings.supervisionDirectHoursPercent));
  const [rbtPct, setRbtPct] = useState(s(settings.supervisionRBTHoursPercent));
  const [techPct, setTechPct] = useState(s(settings.supervisionTechHoursPercent));
  const [maxPct, setMaxPct] = useState(s(settings.supervisionMaxHoursPercent));
  const [ptMin, setPtMin] = useState(s(settings.parentTraining.minimumHours));
  const [ptTargetMin, setPtTargetMin] = useState(s(settings.parentTraining.targetMinHours));
  const [ptTargetMax, setPtTargetMax] = useState(s(settings.parentTraining.targetMaxHours));
  const [periodUnit, setPeriodUnit] = useState<TrainingPeriodUnit>(settings.parentTraining.periodUnit);
  const [unplannedHrs, setUnplannedHrs] = useState(s(settings.cancellationNotice?.unplannedHoursThreshold ?? 24));
  const [plannedDays, setPlannedDays] = useState(s(settings.cancellationNotice?.plannedDaysThreshold ?? 30));
  const u = resolveUtilization(settings.utilization);
  const [bcbaWeekly, setBcbaWeekly] = useState(s(u.bcbaWeeklyBillableHours));
  const [btWeekly, setBtWeekly] = useState(s(u.btWeeklyDirectHours));
  const [bcbaMonthly, setBcbaMonthly] = useState(s(u.bcbaMonthlyBillableHours));
  const [bcbaMonthly5, setBcbaMonthly5] = useState(s(u.bcbaMonthlyBillableHours5Week));
  const [minContacts, setMinContacts] = useState(s(settings.rbtMinContactsPerMonth ?? 2));
  const [floorPct, setFloorPct] = useState(s(settings.supervisionFloorPercent ?? 10));
  const [prefMinPct, setPrefMinPct] = useState(s(settings.supervisionPreferredMinPercent ?? 15));
  const [prefMaxPct, setPrefMaxPct] = useState(s(settings.supervisionPreferredMaxPercent ?? 20));
  const [leadBO, setLeadBO] = useState(s(settings.reportLeadWeeksBackOffice ?? 4));
  const [leadCD, setLeadCD] = useState(s(settings.reportLeadWeeksClinicalDirector ?? 1));

  const num = (str: string, fallback: number) => {
    const n = parseFloat(str);
    return Number.isFinite(n) ? n : fallback;
  };
  const optNum = (str: string) => {
    if (str.trim() === '') return undefined;
    const n = parseFloat(str);
    return Number.isFinite(n) ? n : undefined;
  };

  const save = () => {
    const next: CompanySettings = {
      ...settings, // preserve clinicianAvailability + any legacy fields
      supervisionDirectHoursPercent: num(directPct, settings.supervisionDirectHoursPercent),
      supervisionRBTHoursPercent: num(rbtPct, settings.supervisionRBTHoursPercent),
      supervisionTechHoursPercent: optNum(techPct),
      supervisionMaxHoursPercent: optNum(maxPct),
      parentTraining: {
        minimumHours: num(ptMin, settings.parentTraining.minimumHours),
        targetMinHours: num(ptTargetMin, settings.parentTraining.targetMinHours),
        targetMaxHours: num(ptTargetMax, settings.parentTraining.targetMaxHours),
        periodUnit,
      },
      cancellationNotice: {
        unplannedHoursThreshold: num(unplannedHrs, 24),
        plannedDaysThreshold: num(plannedDays, 30),
      },
      utilization: {
        bcbaWeeklyBillableHours: num(bcbaWeekly, u.bcbaWeeklyBillableHours),
        btWeeklyDirectHours: num(btWeekly, u.btWeeklyDirectHours),
        bcbaMonthlyBillableHours: num(bcbaMonthly, u.bcbaMonthlyBillableHours),
        bcbaMonthlyBillableHours5Week: num(bcbaMonthly5, u.bcbaMonthlyBillableHours5Week),
      },
      rbtMinContactsPerMonth: num(minContacts, 2),
      supervisionFloorPercent: num(floorPct, 10),
      supervisionPreferredMinPercent: num(prefMinPct, 15),
      supervisionPreferredMaxPercent: num(prefMaxPct, 20),
      reportLeadWeeksBackOffice: num(leadBO, 4),
      reportLeadWeeksClinicalDirector: num(leadCD, 1),
    };
    onSave(next);
  };

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', gap: 8, flexWrap: 'wrap' }}>
        <h3 style={{ fontSize: '18px', fontWeight: 'bold' }}>Company Settings</h3>
        <button onClick={save} style={primaryBtn} disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button>
      </div>

      <SettingsSection title="Supervision targets">
        <NumField label="Per-case — % of direct client hours" value={directPct} onChange={setDirectPct} suffix="%" />
        <NumField label="Per-RBT — % of that RBT's direct hours" value={rbtPct} onChange={setRbtPct} suffix="%" hint="BACB floor is 5%." />
        <NumField label="Per non-RBT tech — % of hours (optional)" value={techPct} onChange={setTechPct} suffix="%" placeholder="—" />
        <NumField label="RBT — min supervision contact days per month" value={minContacts} onChange={setMinContacts} suffix="days" hint="BACB cadence: distinct days with observed supervision. Default 2." />
        <NumField label="Insurer cap — max supervision:direct ratio (optional)" value={maxPct} onChange={setMaxPct} suffix="%" placeholder="—" hint="Over-cap ratios show as a warning; they don't change green/yellow/red status." />
      </SettingsSection>

      <SettingsSection title="Correction engine — supervision band">
        <NumField label="Floor — minimum % that must always be met" value={floorPct} onChange={setFloorPct} suffix="%" hint="The engine never proposes shaving a case/BT below this. Default 10." />
        <NumField label="Preferred min — % the BCBA aims for" value={prefMinPct} onChange={setPrefMinPct} suffix="%" hint="Default 15." />
        <NumField label="Preferred max / cap — % ceiling" value={prefMaxPct} onChange={setPrefMaxPct} suffix="%" hint="Doubles as the cap when no insurer cap is set. Default 20." />
      </SettingsSection>

      <SettingsSection title="Reassessment report pacing">
        <NumField label="Final draft to back office — weeks before insurer due" value={leadBO} onChange={setLeadBO} suffix="wks" hint="Default 4." />
        <NumField label="To clinical director — weeks before that" value={leadCD} onChange={setLeadCD} suffix="wks" hint="Default 1 (so 5 weeks before the insurer due date)." />
      </SettingsSection>

      <SettingsSection title="Parent training">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: '#374151' }}>Period</span>
          <select value={periodUnit} onChange={e => setPeriodUnit(e.target.value as TrainingPeriodUnit)} style={inputStyle}>
            <option value="week">Per week</option>
            <option value="month">Per month</option>
            <option value="sixMonths">Per 6 months</option>
            <option value="year">Per year</option>
          </select>
        </div>
        <NumField label={`Minimum hours / ${periodUnit}`} value={ptMin} onChange={setPtMin} suffix="h" />
        <NumField label={`Target min hours / ${periodUnit}`} value={ptTargetMin} onChange={setPtTargetMin} suffix="h" />
        <NumField label={`Target max hours / ${periodUnit}`} value={ptTargetMax} onChange={setPtTargetMax} suffix="h" />
      </SettingsSection>

      <SettingsSection title="Cancellation notice thresholds">
        <NumField label="Unplanned: adequate notice if more than" value={unplannedHrs} onChange={setUnplannedHrs} suffix="hours" />
        <NumField label="Planned: adequate notice if more than" value={plannedDays} onChange={setPlannedDays} suffix="days" />
      </SettingsSection>

      <SettingsSection title="Billable / utilization targets">
        <NumField label="BCBA — fully-utilized weekly billables" value={bcbaWeekly} onChange={setBcbaWeekly} suffix="h/wk" />
        <NumField label="BT — fully-utilized weekly direct hours" value={btWeekly} onChange={setBtWeekly} suffix="h/wk" hint="Aggregate BT direct hours your caseload generates." />
        <NumField label="BCBA — monthly goal (4-week month)" value={bcbaMonthly} onChange={setBcbaMonthly} suffix="h/mo" />
        <NumField label="BCBA — monthly goal (5-week month)" value={bcbaMonthly5} onChange={setBcbaMonthly5} suffix="h/mo" hint="Used when the month spans 5+ weeks." />
      </SettingsSection>

      <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
        Clinician availability is still configured in the Setup Wizard.
      </p>

      {(onImportFile || onRerunWizard) && (
        <SettingsSection title="Data">
          <p style={{ fontSize: '12px', color: '#6b7280', margin: 0 }}>
            Re-run the wizard to edit company settings, clients, and technicians
            (your appointments are kept), or load a different schedule file.
            Neither replaces your current data until you confirm.
          </p>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {onRerunWizard && (
              <button
                onClick={onRerunWizard}
                style={{
                  padding: '8px 14px', backgroundColor: '#8b5cf6', color: 'white',
                  border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600,
                }}
              >Re-run wizard</button>
            )}
            {onImportFile && (
              <button
                onClick={onImportFile}
                style={{
                  padding: '8px 14px', backgroundColor: '#3b82f6', color: 'white',
                  border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600,
                }}
              >Upload schedule…</button>
            )}
          </div>
        </SettingsSection>
      )}
    </div>
  );
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ ...cardStyle, marginBottom: '16px' }}>
      <p style={{ fontSize: '13px', fontWeight: 700, color: '#111827', marginBottom: '12px' }}>{title}</p>
      <div style={{ display: 'grid', gap: '12px' }}>{children}</div>
    </div>
  );
}

function NumField({ label, value, onChange, suffix, hint, placeholder }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
  hint?: string;
  placeholder?: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <span style={{ fontSize: '12px', fontWeight: 600, color: '#374151' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <input
          type="number" step="0.5" min="0" inputMode="decimal"
          value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
          style={{ ...inputStyle, width: '120px' }}
        />
        {suffix && <span style={{ fontSize: '12px', color: '#6b7280' }}>{suffix}</span>}
      </div>
      {hint && <span style={{ fontSize: '11px', color: '#9ca3af' }}>{hint}</span>}
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
