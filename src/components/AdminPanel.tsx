import React, { useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { validatePassword } from '../passwordPolicy';
import { loadPasswordDict } from '../passwordDictLoader';
import { ScheduleData, Technician, Client, DayOfWeek, TimeWindow, Blackout, CompanySettings, TrainingPeriodUnit, Authorization, ManualUsage, AuthBucketKey, AUTH_BUCKETS, SupervisionCadence, SUPERVISION_CADENCES, CancellationCode, resolveCancellationCodes, slugifyCancellationCode, TimeOff, PtoBucket, PtoConfig, AccrualRule, AccrualKind, PtoOpeningBalance, DEFAULT_PTO_DEDUCTION_RATIO, BcbaSessionDefaults, DEFAULT_BCBA_SESSION_DEFAULTS, Appointment, CompanyHoliday, TravelSettings, DEFAULT_TRAVEL_SETTINGS, HomeBase, SchedulingHints, SupervisionStyle, Daypart, resolveMinSessionMinutes } from '../types';
import { AISettings, ClaudeModel } from './Settings';
import { GoogleRoutingProvider, refreshTravelTimes } from '../routing';
import { resolvePtoConfig, activeBuckets, ptoBucketLabel, computePtoBalances } from '../pto';
import { computeAuthUsage, computeReportDates } from '../authorization';
import { PRESET_WINDOWS, PRESET_LABELS, PresetKey, isPresetActive, togglePreset } from '../availabilityUtils';
import { resolveUtilization } from '../utilization';
import { planArchive, unarchiveClient, sessionsCutByArchive } from '../clientArchive';

// Platform-specific persistence adapter. Each method is optional: absent = apply
// change locally only (webportal saves via encrypted download; native app must
// provide all methods so changes reach the Express server).
export interface AdminPersist {
  technician?(id: string, full: Technician): Promise<Technician>;
  addTechnician?(t: Technician): Promise<Technician>;
  deleteTechnician?(id: string): Promise<void>;
  client?(id: string, full: Client): Promise<Client>;
  addClient?(c: Client): Promise<Client>;
  deleteClient?(id: string): Promise<void>;
  blackout?(b: Blackout): Promise<Blackout>;
  deleteBlackout?(id: string): Promise<void>;
  timeOff?(t: TimeOff): Promise<TimeOff>;
  deleteTimeOff?(id: string): Promise<void>;
  companyHoliday?(h: CompanyHoliday): Promise<CompanyHoliday>;
  deleteCompanyHoliday?(id: string): Promise<void>;
  settings?(s: CompanySettings): Promise<CompanySettings>;
  auth?(a: Authorization): Promise<Authorization>;
  deleteAuth?(id: string): Promise<void>;
  usage?(u: ManualUsage): Promise<ManualUsage>;
  deleteUsage?(id: string): Promise<void>;
  reorder?(entity: 'clients' | 'technicians', ids: string[]): Promise<void>;
}

// The inner sections of the admin surface. Roster/auth sections are also mounted
// (scoped to a single tab) inside the C&C hub; settings/time-off/cancellation
// settings stay under the ⚙️ Admin view.
export type AdminTab = 'settings' | 'bts' | 'clients' | 'auths' | 'daysoff' | 'candc';
const ALL_ADMIN_TABS: AdminTab[] = ['bts', 'clients', 'auths', 'daysoff', 'candc', 'settings'];
const ADMIN_TAB_LABELS: Record<AdminTab, string> = {
  bts: 'BTs', clients: 'Clients', auths: 'Auths', daysoff: 'Time Off', candc: 'C&C', settings: 'Settings',
};

interface AdminPanelProps {
  data: ScheduleData;
  onDataChange: (data: ScheduleData) => void;
  // Restrict which sections render (and in what order). Defaults to all six.
  // When exactly one tab is shown the internal tab bar is hidden, letting a
  // parent (the C&C hub) own the chrome.
  tabs?: AdminTab[];
  // Commit a whole-state change with an Activity-log entry (archive/unarchive a
  // case). Needed because those actions delete appointments, which a plain
  // Partial<Client> onChange can't express.
  onCommitLogged?: (next: ScheduleData, label: string, undoable?: boolean) => void;
  // Which tab to open on mount; falls back to the first visible tab.
  initialTab?: AdminTab;
  // Platform-specific persistence; absent = local state only (webportal mode).
  persist?: AdminPersist;
  // Data-lifecycle actions surfaced at the bottom of the Settings tab.
  onImportFile?: () => void;
  onRerunWizard?: () => void;
  // Download the current schedule (moved here from the top bar).
  onDownload?: () => void;
  // Encrypted-JSON backup (lossless, migration-aware) of the current schedule.
  onBackup?: () => void;
  // Clear the loaded schedule from the app (confirmed before wiping).
  onClearData?: () => void;
  // AI settings and security/auth handlers.
  aiSettings?: AISettings;
  onSaveAISettings?: (settings: AISettings) => void | Promise<void>;
  onClearKey?: () => void;
  onRequestUnlock?: () => Promise<boolean>;
  faceIdAvailable?: boolean;
  faceIdEnabled?: boolean;
  biometryLabel?: string;
  onToggleFaceId?: (on: boolean) => void;
  onChangePin?: () => void;
  onOpenAISettings?: () => void;
}
const DAYS: DayOfWeek[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// Local YYYY-MM-DD (the archive as-of date lives in the local calendar, not UTC).
const ymdLocal = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function AdminPanel({ data, onDataChange, onCommitLogged, tabs, initialTab, persist, onImportFile, onRerunWizard, onDownload, onBackup, onClearData, onOpenAISettings, aiSettings, onSaveAISettings, onClearKey, onRequestUnlock, faceIdAvailable, faceIdEnabled, biometryLabel, onToggleFaceId, onChangePin }: AdminPanelProps) {
  const visibleTabs = (tabs && tabs.length > 0 ? tabs : ALL_ADMIN_TABS);
  const showTabBar = visibleTabs.length > 1;
  const [activeTab, setActiveTab] = useState<AdminTab>(
    initialTab && visibleTabs.includes(initialTab) ? initialTab : visibleTabs[0]
  );
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reordering, setReordering] = useState<null | 'clients' | 'technicians'>(null);

  const persistTechnician = async (id: string, patch: Partial<Technician>) => {
    setSavingId(id);
    setError(null);
    try {
      const idx = data.technicians.findIndex(t => t.id === id);
      if (idx < 0) return;
      let merged: Technician = { ...data.technicians[idx], ...patch };
      if (persist?.technician) merged = await persist.technician(id, merged);
      const technicians = data.technicians.map((t, i) => i === idx ? merged : t);
      onDataChange({ ...data, technicians });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingId(null);
    }
  };

  const persistClient = async (id: string, patch: Partial<Client>) => {
    setSavingId(id);
    setError(null);
    try {
      const idx = data.clients.findIndex(c => c.id === id);
      if (idx < 0) return;
      let merged: Client = { ...data.clients[idx], ...patch };
      if (persist?.client) merged = await persist.client(id, merged);
      const clients = data.clients.map((c, i) => i === idx ? merged : c);
      onDataChange({ ...data, clients });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingId(null);
    }
  };

  const addTechnician = async () => {
    const newTech: Technician = { id: uuidv4(), name: `Tech ${data.technicians.length + 1}`, isRBT: false, assignments: [], availability: {} };
    setSavingId(newTech.id);
    setError(null);
    try {
      const saved = persist?.addTechnician ? await persist.addTechnician(newTech) : newTech;
      onDataChange({ ...data, technicians: [...data.technicians, saved] });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingId(null);
    }
  };

  const addClient = async () => {
    const newClient: Client = { id: uuidv4(), name: `Client ${data.clients.length + 1}`, availabilityWindows: {} };
    setSavingId(newClient.id);
    setError(null);
    try {
      const saved = persist?.addClient ? await persist.addClient(newClient) : newClient;
      onDataChange({ ...data, clients: [...data.clients, saved] });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingId(null);
    }
  };

  const removeTechnician = async (id: string) => {
    if (!confirm('Remove this technician? This does not delete their appointments.')) return;
    setSavingId(id);
    setError(null);
    try {
      await persist?.deleteTechnician?.(id);
      onDataChange({ ...data, technicians: data.technicians.filter(t => t.id !== id) });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingId(null);
    }
  };

  const removeClient = async (id: string) => {
    if (!confirm('Remove this client? This does not delete their appointments.')) return;
    setSavingId(id);
    setError(null);
    try {
      await persist?.deleteClient?.(id);
      onDataChange({ ...data, clients: data.clients.filter(c => c.id !== id) });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingId(null);
    }
  };

  const addBlackout = async (blackout: Blackout) => {
    setSavingId(blackout.id);
    setError(null);
    try {
      const saved = persist?.blackout ? await persist.blackout(blackout) : blackout;
      onDataChange({ ...data, blackouts: [...(data.blackouts || []), saved] });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingId(null);
    }
  };

  const removeBlackout = async (id: string) => {
    setSavingId(id);
    setError(null);
    try {
      await persist?.deleteBlackout?.(id);
      onDataChange({ ...data, blackouts: (data.blackouts || []).filter(b => b.id !== id) });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingId(null);
    }
  };

  const addCompanyHoliday = async (h: CompanyHoliday) => {
    setSavingId(h.id);
    setError(null);
    try {
      const saved = persist?.companyHoliday ? await persist.companyHoliday(h) : h;
      onDataChange({ ...data, companyHolidays: [...(data.companyHolidays || []), saved] });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingId(null);
    }
  };

  const removeCompanyHoliday = async (id: string) => {
    setSavingId(id);
    setError(null);
    try {
      await persist?.deleteCompanyHoliday?.(id);
      onDataChange({ ...data, companyHolidays: (data.companyHolidays || []).filter(h => h.id !== id) });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingId(null);
    }
  };

  const addTimeOff = async (t: TimeOff) => {
    setSavingId(t.id);
    setError(null);
    try {
      const saved = persist?.timeOff ? await persist.timeOff(t) : t;
      onDataChange({ ...data, timeOff: [...(data.timeOff || []), saved] });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingId(null);
    }
  };

  const removeTimeOff = async (id: string) => {
    setSavingId(id);
    setError(null);
    try {
      await persist?.deleteTimeOff?.(id);
      onDataChange({ ...data, timeOff: (data.timeOff || []).filter(t => t.id !== id) });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingId(null);
    }
  };

  const persistSettings = async (next: CompanySettings): Promise<boolean> => {
    setSavingId('settings');
    setError(null);
    try {
      const saved = persist?.settings ? await persist.settings(next) : next;
      onDataChange({ ...data, settings: saved });
      return true;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setSavingId(null);
    }
  };

  const upsertAuth = async (auth: Authorization) => {
    setSavingId(auth.id);
    setError(null);
    try {
      const saved = persist?.auth ? await persist.auth(auth) : auth;
      const list = data.authorizations || [];
      const next = list.some(a => a.id === saved.id)
        ? list.map(a => a.id === saved.id ? saved : a)
        : [...list, saved];
      onDataChange({ ...data, authorizations: next });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingId(null);
    }
  };

  const removeAuth = async (id: string) => {
    if (!confirm('Remove this authorization? Manual hour entries are kept.')) return;
    setSavingId(id);
    setError(null);
    try {
      await persist?.deleteAuth?.(id);
      onDataChange({ ...data, authorizations: (data.authorizations || []).filter(a => a.id !== id) });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingId(null);
    }
  };

  const upsertUsage = async (usage: ManualUsage) => {
    setSavingId(usage.id);
    setError(null);
    try {
      const saved = persist?.usage ? await persist.usage(usage) : usage;
      const list = data.manualUsage || [];
      const next = list.some(u => u.id === saved.id)
        ? list.map(u => u.id === saved.id ? saved : u)
        : [...list, saved];
      onDataChange({ ...data, manualUsage: next });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingId(null);
    }
  };

  const removeUsage = async (id: string) => {
    setSavingId(id);
    setError(null);
    try {
      await persist?.deleteUsage?.(id);
      onDataChange({ ...data, manualUsage: (data.manualUsage || []).filter(u => u.id !== id) });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingId(null);
    }
  };

  const reorderEntity = async (entity: 'clients' | 'technicians', orderedIds: string[]) => {
    setError(null);
    try {
      await persist?.reorder?.(entity, orderedIds);
      const list = entity === 'clients' ? data.clients : data.technicians;
      const byId = new Map(list.map(x => [x.id, x]));
      const reordered = orderedIds.map(id => byId.get(id)).filter(Boolean);
      onDataChange({ ...data, [entity]: reordered } as ScheduleData);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
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
    backgroundColor: isActive ? 'var(--surface-card)' : 'var(--surface-sunken)',
    border: isActive ? `2px solid var(--brand-primary)` : 'var(--border-hairline)',
    borderBottom: 'none',
    cursor: 'pointer',
    fontWeight: isActive ? '600' : 'normal',
  } as React.CSSProperties);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      {/* Tabs — hidden when the parent (C&C hub) scopes us to a single section. */}
      {showTabBar && (
        <div style={{ display: 'flex', borderBottom: 'var(--border-hairline)', backgroundColor: 'var(--surface-sunken)' }}>
          {visibleTabs.map(t => (
            <button key={t} onClick={() => setActiveTab(t)} style={tabStyle(activeTab === t)}>
              {t === 'candc' ? 'C&C' : ADMIN_TAB_LABELS[t]}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div style={{ padding: '8px 16px', backgroundColor: 'var(--status-behind-bg)', color: 'var(--red-800)', fontSize: '13px' }}>
          {error}
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
        {activeTab === 'bts' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', gap: 8 }}>
              <h3 style={{ fontSize: '18px', fontWeight: 'bold' }}>Manage BTs ({data.technicians.length})</h3>
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
                  <p style={{ color: 'var(--text-faint)', textAlign: 'center', padding: '20px' }}>No technicians yet.</p>
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
                    technicians={data.technicians}
                    saving={savingId === client.id}
                    onChange={(patch) => persistClient(client.id, patch)}
                    onRemove={() => removeClient(client.id)}
                    onArchive={onCommitLogged ? (asOf) => {
                      const { next, removedCount } = planArchive(data, client.id, asOf);
                      onCommitLogged(next, `Archived ${client.name}${removedCount ? ` — ${removedCount} session${removedCount === 1 ? '' : 's'} removed` : ''}`, false);
                    } : undefined}
                    onUnarchive={onCommitLogged ? () => onCommitLogged(unarchiveClient(data, client.id), `Reactivated ${client.name}`, false) : undefined}
                    countCut={(asOf) => sessionsCutByArchive(data, client.id, asOf).length}
                  />
                ))}
                {data.clients.length === 0 && (
                  <p style={{ color: 'var(--text-faint)', textAlign: 'center', padding: '20px' }}>No clients yet.</p>
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

        {activeTab === 'daysoff' && (
          <>
            <PtoEditor
              settings={data.settings}
              saving={savingId === 'settings'}
              onSave={persistSettings}
            />
            <div style={{ marginTop: 32, paddingTop: 24, borderTop: '2px solid var(--border-default)' }}>
              <ClinicianAvailEditor
                settings={data.settings}
                saving={savingId === 'settings'}
                onSave={persistSettings}
              />
            </div>
            <div style={{ marginTop: 32, paddingTop: 24, borderTop: '2px solid var(--border-default)' }}>
              <CompanyHolidaysTab
                holidays={data.companyHolidays || []}
                savingId={savingId}
                onAdd={addCompanyHoliday}
                onRemove={removeCompanyHoliday}
              />
            </div>
            <div style={{ marginTop: 32, paddingTop: 24, borderTop: '2px solid var(--border-default)' }}>
              <BlackoutsTab
                blackouts={data.blackouts || []}
                technicians={data.technicians}
                clients={data.clients}
                savingId={savingId}
                onAdd={addBlackout}
                onRemove={removeBlackout}
              />
            </div>
            <div style={{ marginTop: 32, paddingTop: 24, borderTop: '2px solid var(--border-default)' }}>
              <TimeOffTab
                timeOff={data.timeOff || []}
                settings={data.settings}
                appointments={data.appointments}
                savingId={savingId}
                onAdd={addTimeOff}
                onRemove={removeTimeOff}
              />
            </div>
          </>
        )}

        {activeTab === 'candc' && (
          <CandcEditor
            settings={data.settings}
            saving={savingId === 'settings'}
            onSave={persistSettings}
          />
        )}

        {activeTab === 'settings' && (
          <TravelSettingsEditor
            data={data}
            saving={savingId === 'settings'}
            onSave={persistSettings}
            aiSettings={aiSettings}
            onSaveAISettings={onSaveAISettings}
            onRequestUnlock={onRequestUnlock}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsEditor
            settings={data.settings}
            saving={savingId === 'settings'}
            onSave={persistSettings}
            onImportFile={onImportFile}
            onRerunWizard={onRerunWizard}
            onDownload={onDownload}
            onBackup={onBackup}
            onClearData={onClearData}
            aiSettings={aiSettings}
            onSaveAISettings={onSaveAISettings}
            onClearKey={onClearKey}
            onRequestUnlock={onRequestUnlock}
            faceIdAvailable={faceIdAvailable}
            faceIdEnabled={faceIdEnabled}
            biometryLabel={biometryLabel}
            onToggleFaceId={onToggleFaceId}
            onChangePin={onChangePin}
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
  // Which assignment row (if any) is editing its per-case availability.
  const [availIdx, setAvailIdx] = useState<number | null>(null);

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

  const noClients = assignments.length === 0;

  return (
    <div style={cardStyle}>
      <CardHeader
        collapsed={collapsed}
        onToggle={() => setCollapsed(c => !c)}
        name={tech.name}
        badges={[...(tech.isRBT ? ['RBT'] : []), ...(noClients ? ['(!) No Clients'] : [])]}
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
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
          {!editing && (
            <button onClick={() => setEditing(true)} style={chipBtn}>Edit availability</button>
          )}
          <button onClick={onRemove} style={dangerBtn}>Remove</button>
        </div>
      </div>
      {saving && <p style={{ fontSize: '11px', color: 'var(--brand-primary)' }}>Saving…</p>}

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
        {assignments.map((a, idx) => {
          const caseDays = Object.values(a.availability || {}).filter(w => w && (w as TimeWindow[]).length > 0).length;
          const isEditingAvail = availIdx === idx;
          return (
            <div key={idx} style={{ border: 'var(--border-hairline)', borderRadius: 'var(--radius-lg)', padding: '8px', marginBottom: '8px', background: 'var(--surface-card)' }}>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <select
                  value={a.clientId}
                  onChange={(e) => updateAssignment(idx, { clientId: e.target.value })}
                  style={{ ...inputStyle, flex: 2, width: 'auto', minWidth: 0 }}
                >
                  <option value="">— Pick client —</option>
                  {safeClients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
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
                    width: '32px', height: '32px', padding: 0, backgroundColor: 'var(--status-behind-bg)', color: 'var(--status-behind)',
                    border: '1px solid var(--red-300)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', flexShrink: 0,
                    fontSize: '18px', lineHeight: 1,
                  }}
                  aria-label="Remove assignment"
                >×</button>
              </div>

              {/* Per-case availability — when this BT can only serve THIS client at
                  specific times (beyond their general availability). */}
              <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, color: caseDays > 0 ? 'var(--brand-primary)' : 'var(--text-faint)', fontWeight: 600 }}>
                  {caseDays > 0
                    ? `Case-specific availability · ${caseDays} day${caseDays === 1 ? '' : 's'}`
                    : 'Uses general availability for this case'}
                </span>
                {!isEditingAvail && (
                  <button onClick={() => setAvailIdx(idx)} style={{ ...chipBtn, padding: '3px 8px', fontSize: 11 }}>
                    {caseDays > 0 ? 'Edit case hours' : '+ Limit to specific times'}
                  </button>
                )}
                {caseDays > 0 && !isEditingAvail && (
                  <button
                    onClick={() => updateAssignment(idx, { availability: undefined })}
                    style={{ background: 'none', border: 'none', color: 'var(--text-faint)', fontSize: 11, cursor: 'pointer', textDecoration: 'underline' }}
                  >Clear</button>
                )}
              </div>
              {caseDays > 0 && !isEditingAvail && (
                <div style={{ marginTop: 4 }}>
                  <AvailabilitySummary windows={a.availability} />
                </div>
              )}
              {isEditingAvail && (
                <div style={{ marginTop: 6 }}>
                  <AvailabilityEditor
                    initial={a.availability || {}}
                    onSave={(av) => {
                      const hasAny = Object.values(av).some(w => w && (w as TimeWindow[]).length > 0);
                      updateAssignment(idx, { availability: hasAny ? av : undefined });
                      setAvailIdx(null);
                    }}
                    onCancel={() => setAvailIdx(null)}
                  />
                </div>
              )}
            </div>
          );
        })}
        <button
          onClick={addAssignment}
          style={{
            padding: '6px 12px', fontSize: '13px', backgroundColor: 'white', color: 'var(--brand-primary)',
            border: '1px solid var(--brand-primary)', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
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
      {badges.map(b => {
        const isAlert = b.startsWith('(!)');
        return (
          <span key={b} style={{
            fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', padding: '1px 6px',
            borderRadius: '8px', flexShrink: 0,
            backgroundColor: isAlert ? 'var(--status-behind-bg)' : 'var(--blue-100)',
            color: isAlert ? 'var(--status-behind)' : 'var(--blue-900)',
          }}>{b}</span>
        );
      })}
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
            border: 'var(--border-hairline)', borderRadius: 'var(--radius-md)', boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
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
        border: 'none', borderBottom: '1px solid var(--surface-sunken)', background: 'var(--surface-card)',
        cursor: 'pointer', fontSize: '13px', color: 'var(--text-body)',
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
              border: 'var(--border-hairline)', borderRadius: 'var(--radius-md)',
              background: dragId === it.id ? 'var(--sage-50)' : 'white',
              boxShadow: dragId === it.id ? '0 2px 8px rgba(0,0,0,0.12)' : 'none',
              // Row stays scrollable on touch; only the ≡ handle suppresses
              // scrolling so vertical drags reorder instead of pan.
            }}
          >
            <span
              onPointerDown={(e) => { e.preventDefault(); setDragId(it.id); }}
              aria-label="Drag to reorder"
              style={{ cursor: 'grab', fontSize: 20, color: 'var(--text-faint)', touchAction: 'none', userSelect: 'none', lineHeight: 1 }}
            >≡</span>
            <span style={{ fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {it.name || 'Unnamed'}
            </span>
            {it.meta && (
              <span style={{
                fontSize: 10, fontWeight: 700, textTransform: 'uppercase', padding: '1px 6px',
                borderRadius: 'var(--radius-lg)', backgroundColor: 'var(--blue-100)', color: 'var(--blue-900)',
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
        <button onClick={clearAll} style={{ ...chipBtn, color: 'var(--status-behind)', borderColor: 'var(--red-300)' }}>Clear all</button>
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
                background: dayIdx % 2 === 0 ? 'var(--surface-sunken)' : 'var(--surface-card)',
                border: 'var(--border-hairline)',
                boxSizing: 'border-box', width: '100%', minWidth: 0,
              }}
            >
              <span style={{ width: '36px', flexShrink: 0, fontSize: '13px', fontWeight: 600 }}>{day.slice(0, 3)}</span>
              {windows.length === 0 ? (
                <span style={{ fontSize: '12px', color: 'var(--text-faint)', fontStyle: 'italic' }}>Off</span>
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

function ClientCard({ client, technicians, saving, onChange, onRemove, onArchive, onUnarchive, countCut }: {
  client: Client;
  technicians?: Technician[];
  saving: boolean;
  onChange: (patch: Partial<Client>) => void;
  onRemove: () => void;
  // Archive off the active caseload (deletes sessions on/after the as-of date).
  onArchive?: (asOf: string) => void;
  onUnarchive?: () => void;
  countCut?: (asOf: string) => number;
}) {
  const [name, setName] = useState(client.name);
  const [archiving, setArchiving] = useState(false);
  const [asOf, setAsOf] = useState(ymdLocal(new Date()));
  const [maxStr, setMaxStr] = useState(client.parentTrainingMaxHours !== undefined ? String(client.parentTrainingMaxHours) : '');
  const [utilStr, setUtilStr] = useState(client.directUtilizationTarget !== undefined ? String(client.directUtilizationTarget) : '');
  const [supIdealStr, setSupIdealStr] = useState(client.supervisionIdealPct !== undefined ? String(client.supervisionIdealPct) : '');
  const [dischargeStr, setDischargeStr] = useState(client.anticipatedDischarge || '');
  const [cityStr, setCityStr] = useState(client.city || '');
  const [hintNoteStr, setHintNoteStr] = useState(client.schedulingHints?.note || '');
  const [editing, setEditing] = useState(false);
  const [collapsed, setCollapsed] = useState(true);

  // Merge-patch schedulingHints; drop the object entirely when every field
  // empties so an untouched client stays byte-identical (Excel round-trip).
  const patchHints = (patch: Partial<SchedulingHints>) => {
    const merged: SchedulingHints = { ...client.schedulingHints, ...patch, source: 'manual' as const, updatedAt: new Date().toISOString().slice(0, 10) };
    for (const k of Object.keys(merged) as (keyof SchedulingHints)[]) {
      if (merged[k] === undefined || merged[k] === '') delete merged[k];
    }
    const hasContent = merged.supervisionStyle || merged.preferredDaypart || merged.note;
    onChange({ schedulingHints: hasContent ? merged : undefined });
  };

  const noStaff = !(technicians ?? []).some(t =>
    t.assignments.some(a => a.clientId === client.id || a.clientId === client.name)
  );

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
        badges={client.archived ? [`Archived${client.archivedAsOf ? ` ${client.archivedAsOf}` : ''}`] : (noStaff ? ['(!) No Staff'] : [])}
        summary={client.archived ? 'Off the active caseload' : `${availDays} day${availDays === 1 ? '' : 's'} avail${ptMax !== undefined ? ` · PT max ${ptMax}h` : ''}`}
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
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0 }}>
          {!editing && !client.archived && (
            <button onClick={() => setEditing(true)} style={chipBtn}>Edit availability</button>
          )}
          {client.archived
            ? (onUnarchive && <button onClick={onUnarchive} style={chipBtn}>Unarchive</button>)
            : (onArchive && <button onClick={() => { setAsOf(ymdLocal(new Date())); setArchiving(true); }} style={chipBtn}>Archive</button>)}
          <button onClick={onRemove} style={dangerBtn}>Remove</button>
        </div>
      </div>

      {archiving && onArchive && (() => {
        const cut = countCut ? countCut(asOf) : 0;
        return (
          <div style={{ border: '1px solid #fca5a5', background: '#fef2f2', borderRadius: 8, padding: 12, margin: '4px 0 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontWeight: 700, color: '#991b1b', fontSize: 13 }}>Archive {client.name}?</div>
            <label style={{ fontSize: 12, color: 'var(--text-body)' }}>
              Archive as of
              <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} style={{ ...inputStyle, marginTop: 4 }} />
            </label>
            <div style={{ fontSize: 12.5, color: '#7f1d1d', lineHeight: 1.5 }}>
              This permanently deletes <b>{cut} session{cut === 1 ? '' : 's'}</b> on or after {asOf} and removes {client.name} from your caseload (gone from compliance, counts, and the builder). Past sessions are kept. You can Unarchive later — the schedule comes back empty.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { onArchive(asOf); setArchiving(false); }} style={dangerBtn}>
                {cut > 0 ? `Delete ${cut} & archive` : 'Archive'}
              </button>
              <button onClick={() => setArchiving(false)} style={chipBtn}>Cancel</button>
            </div>
          </div>
        );
      })()}
      {saving && <p style={{ fontSize: '11px', color: 'var(--brand-primary)' }}>Saving…</p>}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
        <label style={{ fontSize: '12px', color: 'var(--text-body)', whiteSpace: 'nowrap' }}>
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
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '8px', fontSize: '12px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }} title="Completely exempts this client from parent-training minimum requirements.">
          <input type="checkbox" checked={client.disablePTRequirements === true}
            onChange={e => onChange({ disablePTRequirements: e.target.checked || undefined })} />
          <span>Disable PT Requirements</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: 'var(--text-body)', whiteSpace: 'nowrap' }}>Direct utilization target:</span>
          <input
            type="number" step="1" min="1" max="100"
            value={utilStr}
            onChange={(e) => setUtilStr(e.target.value)}
            onBlur={() => {
              const v = utilStr === '' ? undefined : parseFloat(utilStr);
              if (v !== client.directUtilizationTarget) onChange({ directUtilizationTarget: Number.isFinite(v as number) ? v : undefined });
            }}
            placeholder="75"
            style={{ ...inputStyle, width: '70px' }}
          />
          <span style={{ color: '#6b7280' }}>%</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }} title="Ideal supervision % for this case. Overrides the company default on the Compliance dashboard.">
          <span style={{ color: 'var(--text-body)', whiteSpace: 'nowrap' }}>Ideal supervision:</span>
          <input
            type="number" step="0.5" min="0" max="100"
            value={supIdealStr}
            onChange={(e) => setSupIdealStr(e.target.value)}
            onBlur={() => {
              const v = supIdealStr === '' ? undefined : parseFloat(supIdealStr);
              if (v !== client.supervisionIdealPct) onChange({ supervisionIdealPct: Number.isFinite(v as number) ? v : undefined });
            }}
            placeholder={`company default`}
            style={{ ...inputStyle, width: '70px' }}
          />
          <span style={{ color: '#6b7280' }}>%</span>
        </label>
      </div>

      {/* Per-case clinical / scheduling metadata (feeds the correction engine) */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10, fontSize: 12, color: 'var(--text-body)' }}>
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
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }} title="When ON, parent training can be scheduled outside the client's set availability and need not coincide with a direct session (tentative, pending BCBA confirmation).">
          <input type="checkbox" checked={client.parentAvailableOutsideSessions === true}
            onChange={e => onChange({ parentAvailableOutsideSessions: e.target.checked || undefined })} />
          <span>Parent available outside scheduled availability</span>
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
          <input value={dischargeStr}
            onChange={e => setDischargeStr(e.target.value)}
            onBlur={() => { const v = dischargeStr.trim() || undefined; if (v !== client.anticipatedDischarge) onChange({ anticipatedDischarge: v }); }}
            placeholder="date / note" style={{ ...inputStyle, flex: 1, minWidth: 0 }} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, flex: '1 1 160px' }}
          title="Coarse locality — a CITY only, never a street address. Used to estimate the BCBA's drive time between sessions. Run 'Refresh travel times' in Settings after adding cities.">
          <span style={{ whiteSpace: 'nowrap' }}>City:</span>
          <input value={cityStr}
            onChange={e => setCityStr(e.target.value)}
            onBlur={() => { const v = cityStr.trim() || undefined; if (v !== client.city) onChange({ city: v }); }}
            placeholder="e.g. Springfield, IL" style={{ ...inputStyle, flex: 1, minWidth: 0 }} />
        </label>
      </div>

      {/* Scheduling hints — placement heuristics the builder honors (taught
          scheduler knowledge: hand-set here, via sAssI chat, or learned from
          a confirmed correction). */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10, fontSize: 12, color: 'var(--text-body)' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}
          title="How the builder shapes supervision for this case. Auto lets the engine pick; 'Two shorter visits' suits cases whose sessions straddle busy dayparts.">
          <span style={{ whiteSpace: 'nowrap' }}>Supervision style:</span>
          <select
            value={client.schedulingHints?.supervisionStyle || ''}
            onChange={e => patchHints({ supervisionStyle: (e.target.value || undefined) as SupervisionStyle | undefined })}
            style={{ ...inputStyle, width: 'auto' }}
          >
            <option value="">— (auto)</option>
            <option value="consolidate">One longer visit</option>
            <option value="split">Two shorter visits</option>
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}
          title="Preferred time of day for BCBA-facing sessions (supervision / parent training) on this case.">
          <span style={{ whiteSpace: 'nowrap' }}>Preferred time of day:</span>
          <select
            value={client.schedulingHints?.preferredDaypart || ''}
            onChange={e => patchHints({ preferredDaypart: (e.target.value || undefined) as Daypart | undefined })}
            style={{ ...inputStyle, width: 'auto' }}
          >
            <option value="">—</option>
            <option value="morning">Morning</option>
            <option value="midday">Midday</option>
            <option value="afternoon">Afternoon</option>
            <option value="evening">Evening</option>
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, flex: '1 1 200px' }}>
          <span style={{ whiteSpace: 'nowrap' }}>Hint note:</span>
          <input value={hintNoteStr}
            onChange={e => setHintNoteStr(e.target.value)}
            onBlur={() => { const v = hintNoteStr.trim() || undefined; if (v !== client.schedulingHints?.note) patchHints({ note: v }); }}
            placeholder="e.g. wedge between nearby morning clients" style={{ ...inputStyle, flex: 1, minWidth: 0 }} />
        </label>
        {client.schedulingHints?.source === 'learned' && (
          <span style={{ color: 'var(--text-muted, #9ca3af)', fontSize: 11 }}
            title="This hint was captured from one of your schedule corrections and confirmed by you.">
            learned from your correction{client.schedulingHints.updatedAt ? ` · ${client.schedulingHints.updatedAt}` : ''}
          </span>
        )}
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
      <h3 style={{ marginBottom: '16px', fontSize: '18px', fontWeight: 'bold' }}>Authorizations</h3>
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
                <p style={{ fontSize: '12px', color: 'var(--text-faint)', fontStyle: 'italic', marginTop: 8 }}>No authorization on file.</p>
              ) : [...clientAuths]
                  .sort((a, b) => b.startDate.localeCompare(a.startDate))
                  .map(auth => (
                <AuthRow
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
          <p style={{ color: 'var(--text-faint)', textAlign: 'center', padding: '20px' }}>No clients yet.</p>
        )}
      </div>
    </div>
  );
}

interface AuthCardProps {
  data: ScheduleData;
  auth: Authorization;
  saving: boolean;
  onChange: (patch: Partial<Authorization>) => void;
  onRemove: () => void;
  onUpsertUsage: (u: ManualUsage) => void;
  onRemoveUsage: (id: string) => void;
}

// Collapsible summary row. Collapsed by default: shows label/date-range, the
// end-cliff date, and days-until-end. Expands to the full AuthCard editor.
function AuthRow(props: AuthCardProps) {
  const { data, auth } = props;
  const [collapsed, setCollapsed] = useState(true);
  const usage = computeAuthUsage(data, auth, new Date());
  const cliffColor = usage.daysLeft < 0 ? 'var(--text-faint)' : usage.daysLeft <= 21 ? 'var(--status-behind)' : usage.daysLeft <= 45 ? 'var(--status-pace)' : 'var(--status-met)';
  const title = auth.label || `${auth.startDate} to ${auth.endDate}`;
  return (
    <div style={{ marginTop: 10, border: 'var(--border-hairline)', borderRadius: 'var(--radius-md)', background: 'white' }}>
      <div
        onClick={() => setCollapsed(c => !c)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', cursor: 'pointer', flexWrap: 'wrap' }}
      >
        <span style={{ fontSize: 12, color: '#6b7280', width: 12, flexShrink: 0 }}>{collapsed ? '▸' : '▾'}</span>
        <span style={{ fontWeight: 600, fontSize: 13, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {title}
        </span>
        <span style={{ fontSize: 12, color: '#6b7280', marginLeft: 'auto', whiteSpace: 'nowrap' }}>ends {auth.endDate}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: cliffColor, whiteSpace: 'nowrap' }}>
          {usage.daysLeft < 0 ? `expired ${-usage.daysLeft}d ago` : `${usage.daysLeft}d left`}
        </span>
      </div>
      {!collapsed && <AuthCard {...props} />}
    </div>
  );
}

function AuthCard({ data, auth, saving, onChange, onRemove, onUpsertUsage, onRemoveUsage }: AuthCardProps) {
  const [label, setLabel] = useState(auth.label || '');
  const [bucketDrafts, setBucketDrafts] = useState<{ [k in AuthBucketKey]?: string }>({});
  // Manual entry add form
  const [mBucket, setMBucket] = useState<AuthBucketKey>('direct');
  const [mHours, setMHours] = useState('');
  const [mDate, setMDate] = useState(todayStr());
  const [mNote, setMNote] = useState('');

  const usage = computeAuthUsage(data, auth, new Date());
  const fmt = (n: number) => (Math.round(n * 10) / 10).toString();
  const cliffColor = usage.daysLeft < 0 ? 'var(--text-faint)' : usage.daysLeft <= 21 ? 'var(--status-behind)' : usage.daysLeft <= 45 ? 'var(--status-pace)' : 'var(--status-met)';

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

  const reportDates = computeReportDates(auth, data.settings);

  return (
    <div style={{ padding: '0 12px 12px', borderTop: 'var(--border-hairline)' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 10 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 140px', minWidth: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-body)' }}>Auth label / number</span>
          <input value={label} onChange={e => setLabel(e.target.value)}
            onBlur={() => { if (label !== (auth.label || '')) onChange({ label: label || undefined }); }}
            placeholder="optional" style={inputStyle} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '0 1 150px', minWidth: 120 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-body)' }}>Start</span>
          <input type="date" value={auth.startDate} onChange={e => onChange({ startDate: e.target.value })} style={inputStyle} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '0 1 150px', minWidth: 120 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-body)' }}>End (cliff)</span>
          <input type="date" value={auth.endDate} onChange={e => onChange({ endDate: e.target.value })} style={inputStyle} />
        </label>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
        <p style={{ fontSize: 12, fontWeight: 600, color: cliffColor, margin: 0 }}>
          {usage.daysLeft < 0 ? `Expired ${-usage.daysLeft} day(s) ago` : `${usage.daysLeft} day(s) until auth ends`}
        </p>
        <button onClick={onRemove} style={{ ...dangerBtn, marginLeft: 'auto' }}>Remove</button>
      </div>
      {saving && <p style={{ fontSize: 11, color: 'var(--brand-primary)' }}>Saving…</p>}

      {/* Per-week authorized rates — what the correction engine reasons over. */}
      <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed var(--border-default)' }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-body)', marginBottom: 6 }}>
          Authorized weekly rates <span style={{ fontWeight: 400, color: 'var(--text-faint)' }}>(supervision cap ≈ 20% of direct)</span>
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
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 10, color: '#6b7280' }}>Initial draft due (internal)</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-body)' }}>{reportDates.initialDraftDue}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 10, color: '#6b7280' }}>Final draft due (internal)</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-body)' }}>{reportDates.finalDraftDue}</span>
          </div>
        </div>
      </div>

      {/* Bucket table: authorized input + usage readout */}
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {AUTH_BUCKETS.map(({ key, label: bLabel }) => {
          const b = usage.buckets.find(x => x.key === key)!.usage;
          const over = b.authorized > 0 && b.remaining < -0.01;
          const rowColor = over ? 'var(--status-behind)' : 'var(--text-body)';
          return (
            <div key={key} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
              <span style={{ flex: '1 1 150px', minWidth: 0, color: 'var(--text-body)' }}>{bLabel}</span>
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
                  : <span style={{ color: 'var(--text-faint)' }}>not authorized</span>}
              </span>
            </div>
          );
        })}
      </div>

      {/* Manual (outside-system) hours */}
      <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px dashed var(--border-default)' }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-body)', marginBottom: 6 }}>Prior hours used in auth (prior / outside SAssi, and not imported)</p>
        {manualInSpan.map(u => (
          <div key={u.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, marginBottom: 4, flexWrap: 'wrap' }}>
            <span style={{ color: '#6b7280', whiteSpace: 'nowrap' }}>{u.date}</span>
            <span style={{ flex: '1 1 120px', minWidth: 0 }}>
              {AUTH_BUCKETS.find(b => b.key === u.bucket)?.label || u.bucket}: <strong>{u.hours}h</strong>
              {u.note ? <span style={{ color: 'var(--text-faint)' }}> · {u.note}</span> : null}
            </span>
            <button onClick={() => onRemoveUsage(u.id)} style={{ ...dangerBtn, padding: '2px 8px', fontSize: 11 }}>×</button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
          <select value={mBucket} onChange={e => setMBucket(e.target.value as AuthBucketKey)} style={{ ...inputStyle, width: 'auto', flex: '1 1 130px', minWidth: 0 }}>
            {AUTH_BUCKETS.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
          </select>
          <input type="number" step="0.25" min="0" placeholder="hrs" value={mHours} onChange={e => setMHours(e.target.value)} style={{ ...inputStyle, width: 60, minWidth: 0 }} />
          <input type="date" value={mDate} onChange={e => setMDate(e.target.value)} style={{ ...inputStyle, width: 130, minWidth: 0 }} />
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

function CompanyHolidaysTab({ holidays, savingId, onAdd, onRemove }: {
  holidays: CompanyHoliday[];
  savingId: string | null;
  onAdd: (h: CompanyHoliday) => void;
  onRemove: (id: string) => void;
}) {
  const [date, setDate] = useState(todayStr());
  const [name, setName] = useState('');

  const submit = () => {
    if (!date || !name.trim()) return;
    onAdd({ id: uuidv4(), date, name: name.trim(), createdAt: new Date().toISOString() });
    setName('');
  };

  const today = todayStr();
  const sorted = [...holidays].sort((a, b) => a.date.localeCompare(b.date));
  const upcoming = sorted.filter(h => h.date >= today);
  const past = sorted.filter(h => h.date < today).reverse();

  const renderRow = (h: CompanyHoliday, dim: boolean) => (
    <div key={h.id} style={{
      display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px',
      border: 'var(--border-hairline)', borderRadius: 'var(--radius-md)',
      backgroundColor: dim ? 'var(--surface-sunken)' : 'var(--surface-card)',
      opacity: dim ? 0.75 : 1, flexWrap: 'wrap',
    }}>
      <div style={{ flex: '1 1 200px', minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '14px', color: '#111827' }}>
          {formatBlackoutDate(h.date)}
        </div>
        <div style={{ fontSize: '13px', color: 'var(--text-body)', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{
            fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', padding: '1px 6px',
            borderRadius: '8px', backgroundColor: 'var(--green-100)', color: 'var(--green-700)',
          }}>Holiday</span>
          {h.name}
        </div>
      </div>
      <button onClick={() => onRemove(h.id)} style={dangerBtn} disabled={savingId === h.id}>
        {savingId === h.id ? '…' : 'Remove'}
      </button>
    </div>
  );

  return (
    <div>
      <h3 style={{ marginBottom: '8px', fontSize: '18px', fontWeight: 'bold' }}>Company Holidays</h3>
      <p style={{ fontSize: '13px', color: '#6b7280', marginBottom: '16px' }}>
        Company-wide non-working days. Any session on a holiday is flagged with a green star.
        Holidays also act as a blanket blackout for every tech and client.
        These ship in the Excel workbook so the same list travels with the schedule file.
      </p>

      <div style={{ ...cardStyle, marginBottom: '20px', display: 'flex', flexWrap: 'wrap', gap: '14px 16px', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '1 1 150px', minWidth: 0 }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-body)' }}>Date</span>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '2 1 200px', minWidth: 0 }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-body)' }}>Holiday name</span>
          <input
            type="text" value={name} onChange={e => setName(e.target.value)}
            placeholder="e.g. Thanksgiving" style={inputStyle}
            onKeyDown={e => { if (e.key === 'Enter') submit(); }}
          />
        </label>
        <button onClick={submit} style={{ ...primaryBtn, flex: '0 0 auto' }} disabled={!date || !name.trim()}>
          + Add holiday
        </button>
      </div>

      {holidays.length === 0 ? (
        <p style={{ color: 'var(--text-faint)', textAlign: 'center', padding: '20px' }}>No company holidays configured.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {upcoming.length > 0 && (
            <div>
              <p style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: '#6b7280', marginBottom: '8px' }}>
                Upcoming ({upcoming.length})
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {upcoming.map(h => renderRow(h, false))}
              </div>
            </div>
          )}
          {past.length > 0 && (
            <div>
              <p style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: '#6b7280', marginBottom: '8px' }}>
                Past ({past.length})
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {past.map(h => renderRow(h, true))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
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
      border: 'var(--border-hairline)', borderRadius: 'var(--radius-md)', backgroundColor: dim ? 'var(--surface-sunken)' : 'var(--surface-card)',
      opacity: dim ? 0.75 : 1, flexWrap: 'wrap',
    }}>
      <div style={{ flex: '1 1 200px', minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '14px', color: '#111827' }}>
          {formatBlackoutDate(b.date)}
        </div>
        <div style={{ fontSize: '13px', color: 'var(--text-body)', marginTop: '2px' }}>
          <span style={{
            fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', padding: '1px 6px',
            borderRadius: '8px', marginRight: '6px',
            backgroundColor: b.entityType === 'technician' ? 'var(--blue-100)' : 'var(--amber-100)',
            color: b.entityType === 'technician' ? 'var(--blue-900)' : 'var(--amber-700)',
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

      {/* Add form. Each field gets minWidth:0 so it shrinks instead of overflowing
          into its neighbor (the iOS date control has a wide intrinsic size), and a
          generous row/column gap keeps them from crowding when wrapped. */}
      <div style={{ ...cardStyle, marginBottom: '20px', display: 'flex', flexWrap: 'wrap', gap: '14px 16px', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '1 1 200px', minWidth: 0 }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-body)' }}>Who</span>
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
        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '1 1 150px', minWidth: 0 }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-body)' }}>Date</span>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '2 1 200px', minWidth: 0 }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-body)' }}>Reason (optional)</span>
          <input
            type="text" value={reason} onChange={e => setReason(e.target.value)}
            placeholder="e.g. dentist appointment" style={inputStyle}
            onKeyDown={e => { if (e.key === 'Enter') submit(); }}
          />
        </label>
        <button onClick={submit} style={{ ...primaryBtn, flex: '0 0 auto' }} disabled={!entityKey || !date}>+ Add blackout</button>
      </div>

      {blackouts.length === 0 ? (
        <p style={{ color: 'var(--text-faint)', textAlign: 'center', padding: '20px' }}>No blackout days recorded.</p>
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

function TimeOffTab({ timeOff, settings, appointments, savingId, onAdd, onRemove }: {
  timeOff: TimeOff[];
  settings: CompanySettings;
  appointments: Appointment[];
  savingId: string | null;
  onAdd: (t: TimeOff) => void;
  onRemove: (id: string) => void;
}) {
  const cfg = resolvePtoConfig(settings.pto);
  const buckets = activeBuckets(cfg);
  // Pass appointments so per-converted accrual reflects completed billable hours
  // live — completing or reopening a session moves the balance. Goals feed the
  // "percent above goal" bonus criterion.
  const u = resolveUtilization(settings.utilization);
  const balances = computePtoBalances(cfg, timeOff, appointments, new Date(), { week: u.bcbaWeeklyBillableHours, month: u.bcbaMonthlyBillableHours });
  // A multi-day vacation is entered as a date range and expanded to one entry
  // per weekday so each lands in the right ISO week. Single day = same start/end.
  const [start, setStart] = useState(todayStr());
  const [end, setEnd] = useState(todayStr());
  const [hours, setHours] = useState('8');
  const [bucket, setBucket] = useState<PtoBucket>(buckets[0]);
  const [note, setNote] = useState('');
  const [skipWeekends, setSkipWeekends] = useState(true);

  // Keep the picked bucket valid if the config's bucket set changes.
  useEffect(() => { if (!buckets.includes(bucket)) setBucket(buckets[0]); }, [buckets.join(','), bucket]);

  const ratio = settings.ptoBillableDeductionRatio ?? DEFAULT_PTO_DEDUCTION_RATIO;
  const perDay = Number(hours);

  const submit = () => {
    const h = Number(hours);
    if (!start || !end || !(h > 0) || end < start) return;
    const days = eachDateInclusive(start, end).filter(d => !skipWeekends || !isWeekendStr(d));
    if (days.length === 0) return;
    const now = new Date().toISOString();
    for (const d of days) {
      onAdd({ id: uuidv4(), date: d, hours: h, bucket, note: note.trim() || undefined, createdAt: now });
    }
    setNote('');
  };

  const today = todayStr();
  const sorted = [...timeOff].sort((a, b) => a.date.localeCompare(b.date));
  const upcoming = sorted.filter(t => t.date >= today);
  const past = sorted.filter(t => t.date < today).reverse();
  const renderRow = (t: TimeOff, dim: boolean) => (
    <div key={t.id} style={{
      display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px',
      border: 'var(--border-hairline)', borderRadius: 'var(--radius-md)', backgroundColor: dim ? 'var(--surface-sunken)' : 'var(--surface-card)',
      opacity: dim ? 0.75 : 1, flexWrap: 'wrap',
    }}>
      <div style={{ flex: '1 1 200px', minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '14px', color: '#111827' }}>
          {formatBlackoutDate(t.date)} · {fmtHours(t.hours)}h
          <span style={{ color: 'var(--violet-600)', fontWeight: 600 }}> (−{fmtHours(t.hours * ratio)}h req.)</span>
        </div>
        <div style={{ fontSize: '13px', color: 'var(--text-body)', marginTop: '2px' }}>
          <span style={{
            fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', padding: '1px 6px',
            borderRadius: 'var(--radius-lg)', marginRight: '6px', backgroundColor: 'var(--violet-100)', color: 'var(--violet-700)',
          }}>{ptoBucketLabel(t.bucket || 'combined')}</span>
          {t.note && <span style={{ color: '#6b7280', fontStyle: 'italic' }}>{t.note}</span>}
        </div>
      </div>
      <button onClick={() => onRemove(t.id)} style={dangerBtn} disabled={savingId === t.id}>
        {savingId === t.id ? '…' : 'Remove'}
      </button>
    </div>
  );

  return (
    <div>
      <h3 style={{ marginBottom: '8px', fontSize: '18px', fontWeight: 'bold' }}>BCBA Time Off</h3>
      <p style={{ fontSize: '13px', color: '#6b7280', marginBottom: '12px' }}>
        Log your leave below. Each day's hours lower that week's billable requirement by{' '}
        <strong>{fmtHours(ratio)}h per PTO hour</strong> (so {fmtHours(8)}h off ={' '}
        −{fmtHours(8 * ratio)}h).
      </p>

      {/* Where the setup lives — this tab shows balances + logs leave; the rules,
          buckets, mode, and ratio are configured under Settings. */}
      <div style={{ ...cardStyle, marginBottom: '16px', padding: '10px 12px', background: 'var(--violet-50)', borderColor: 'var(--violet-200)' }}>
        <div style={{ fontSize: '12px', color: 'var(--violet-700)' }}>
          <strong>Accrual setup is in Admin → Settings → "Time off."</strong> There you choose the
          mode ({cfg.mode === 'accrual' ? 'currently Accrual' : 'currently Unlimited'}), buckets, the
          deduction ratio, and—in accrual mode—your accrual rules and opening balances. This tab is
          where you log leave and read the resulting balances.
        </div>
      </div>

      {/* Balances per bucket. Unlimited mode shows leave taken; accrual mode adds
          opening + accrued − remaining. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '20px' }}>
        {balances.map(b => (
          <div key={b.bucket} style={{ ...cardStyle, flex: '1 1 150px', minWidth: 140, padding: '10px 12px' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--violet-700)' }}>{ptoBucketLabel(b.bucket)}</div>
            {cfg.mode === 'accrual' ? (
              <>
                <div style={{ fontSize: '20px', fontWeight: 700, color: (b.remaining ?? 0) < 0 ? '#dc2626' : '#111827' }}>
                  {fmtHours(b.remaining ?? 0)}h <span style={{ fontSize: '11px', fontWeight: 500, color: '#6b7280' }}>left</span>
                </div>
                <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '2px' }}>
                  {fmtHours(b.opening ?? 0)} opening + {fmtHours(b.accrued ?? 0)} accrued − {fmtHours(b.used)} used
                </div>
              </>
            ) : (
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#111827' }}>
                {fmtHours(b.used)}h <span style={{ fontSize: '11px', fontWeight: 500, color: '#6b7280' }}>used</span>
              </div>
            )}
          </div>
        ))}
        {cfg.mode !== 'accrual' && (
          <div style={{ flex: '1 1 100%', fontSize: '12px', color: 'var(--text-faint)' }}>
            Unlimited mode — tracking leave taken only. Turn on accrual in <strong>Settings → Time off</strong> to see remaining balances.
          </div>
        )}
      </div>

      {/* Add form. minWidth:0 on every field so the wide iOS date control shrinks
          instead of crowding its neighbor; generous row/column gap when wrapped. */}
      <div style={{ ...cardStyle, marginBottom: '20px', display: 'flex', flexWrap: 'wrap', gap: '14px 16px', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '1 1 150px', minWidth: 0 }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-body)' }}>From</span>
          <input type="date" value={start} onChange={e => { setStart(e.target.value); if (end < e.target.value) setEnd(e.target.value); }} style={inputStyle} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '1 1 150px', minWidth: 0 }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-body)' }}>To</span>
          <input type="date" value={end} min={start} onChange={e => setEnd(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '0 1 120px', minWidth: 0 }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-body)' }}>Hours / day</span>
          <input type="number" min="0" step="0.25" value={hours} onChange={e => setHours(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '0 1 150px', minWidth: 0 }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-body)' }}>Bucket</span>
          <select value={bucket} onChange={e => setBucket(e.target.value as PtoBucket)} style={inputStyle}>
            {buckets.map(b => <option key={b} value={b}>{ptoBucketLabel(b)}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '2 1 180px', minWidth: 0 }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-body)' }}>Note (optional)</span>
          <input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. beach trip" style={inputStyle}
            onKeyDown={e => { if (e.key === 'Enter') submit(); }} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: '0 1 auto', fontSize: '13px', color: 'var(--text-body)' }}>
          <input type="checkbox" checked={skipWeekends} onChange={e => setSkipWeekends(e.target.checked)} />
          Skip weekends
        </label>
        <button onClick={submit} style={{ ...primaryBtn, flex: '0 0 auto' }} disabled={!start || !end || !(perDay > 0) || end < start}>+ Add time off</button>
      </div>

      {timeOff.length === 0 ? (
        <p style={{ color: 'var(--text-faint)', textAlign: 'center', padding: '20px' }}>No time off recorded.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {upcoming.length > 0 && (
            <div>
              <p style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: '#6b7280', marginBottom: '8px' }}>
                Upcoming ({upcoming.length})
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {upcoming.map(t => renderRow(t, false))}
              </div>
            </div>
          )}
          {past.length > 0 && (
            <div>
              <p style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: '#6b7280', marginBottom: '8px' }}>
                Past ({past.length})
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {past.map(t => renderRow(t, true))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Inclusive list of YYYY-MM-DD strings between two dates (local calendar days).
function eachDateInclusive(start: string, end: string): string[] {
  const out: string[] = [];
  const s = parseLocalDate(start);
  const e = parseLocalDate(end);
  if (!s || !e) return out;
  for (let d = s; d.getTime() <= e.getTime(); d.setDate(d.getDate() + 1)) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  return out;
}
function parseLocalDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
function isWeekendStr(s: string): boolean {
  const d = parseLocalDate(s);
  if (!d) return false;
  const day = d.getDay();
  return day === 0 || day === 6;
}
function fmtHours(n: number): string {
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? String(r) : String(r);
}

const ACCRUAL_KIND_LABEL: Record<AccrualKind, string> = {
  semimonthly: '1st & 15th of month',
  everyNWeeks: 'Every N weeks on a day',
  perConvertedHours: 'Per converted (completed) hours',
  perConvertedBonus: 'Per converted + bonus',
};
const WEEKDAYS: DayOfWeek[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// Editor for the whole PTO config (mode / buckets / unpaid / accrual rules +
// opening balances). Operates on a PtoConfig value; the parent folds it into the
// settings save. Kept self-contained so the rest of SettingsEditor is untouched.
function PtoConfigEditor({ value, onChange }: { value: PtoConfig; onChange: (c: PtoConfig) => void }) {
  const cfg = resolvePtoConfig(value);
  const set = (patch: Partial<PtoConfig>) => onChange({ ...cfg, ...patch });
  const buckets = activeBuckets(cfg);

  const updateRule = (id: string, patch: Partial<AccrualRule>) =>
    set({ accruals: (cfg.accruals || []).map(r => r.id === id ? { ...r, ...patch } : r) });
  const addRule = () =>
    set({ accruals: [...(cfg.accruals || []), { id: uuidv4(), kind: 'semimonthly', bucket: buckets[0], hours: 4 }] });
  const removeRule = (id: string) => set({ accruals: (cfg.accruals || []).filter(r => r.id !== id) });

  const addBalance = () =>
    set({ openingBalances: [...(cfg.openingBalances || []), { bucket: buckets[0], hours: 0, asOf: todayStr() }] });
  const updateBalance = (i: number, patch: Partial<PtoOpeningBalance>) =>
    set({ openingBalances: (cfg.openingBalances || []).map((b, j) => j === i ? { ...b, ...patch } : b) });
  const removeBalance = (i: number) => set({ openingBalances: (cfg.openingBalances || []).filter((_, j) => j !== i) });

  const radioRow = (label: string, options: { v: string; l: string }[], current: string, onPick: (v: string) => void) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-body)' }}>{label}</span>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {options.map(o => (
          <button key={o.v} onClick={() => onPick(o.v)} style={{
            padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px',
            border: `1px solid ${current === o.v ? 'var(--violet-600)' : 'var(--border-strong)'}`,
            background: current === o.v ? 'var(--violet-100)' : 'var(--surface-card)',
            color: current === o.v ? 'var(--violet-700)' : 'var(--text-body)', fontWeight: current === o.v ? 700 : 400,
          }}>{o.l}</button>
        ))}
      </div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', borderTop: '1px dashed var(--border-default)', paddingTop: '12px', marginTop: '4px' }}>
      {radioRow('Tracking mode', [
        { v: 'unlimited', l: 'Unlimited (used only)' },
        { v: 'accrual', l: 'Accrual + balances' },
      ], cfg.mode, v => set({ mode: v as PtoConfig['mode'] }))}

      {radioRow('Buckets', [
        { v: 'combined', l: 'One combined pool' },
        { v: 'separate', l: 'Separate sick / vacation' },
      ], cfg.buckets, v => set({ buckets: v as PtoConfig['buckets'] }))}

      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-body)' }}>
        <input type="checkbox" checked={!!cfg.unpaidEnabled} onChange={e => set({ unpaidEnabled: e.target.checked })} />
        Track a separate Unpaid bucket
      </label>

      {cfg.mode === 'accrual' && (
        <>
          <div>
            <div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: '#6b7280', marginBottom: '6px' }}>Accrual rules</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {(cfg.accruals || []).map(r => {
                return (
                  <div key={r.id} style={{ ...cardStyle, padding: '10px 12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-body)' }}>Accrual rule</span>
                      <button onClick={() => removeRule(r.id)} style={dangerBtn}>Remove</button>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'flex-end' }}>
                      <label style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: '1 1 180px', minWidth: 0 }}>
                        <span style={{ fontSize: '11px', color: '#6b7280' }}>Rule</span>
                        <select value={r.kind} onChange={e => updateRule(r.id, { kind: e.target.value as AccrualKind })} style={inputStyle}>
                          {(Object.keys(ACCRUAL_KIND_LABEL) as AccrualKind[]).map(k => <option key={k} value={k}>{ACCRUAL_KIND_LABEL[k]}</option>)}
                        </select>
                      </label>
                      <label style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: '0 1 120px', minWidth: 0 }}>
                        <span style={{ fontSize: '11px', color: '#6b7280' }}>Bucket</span>
                        <select value={r.bucket} onChange={e => updateRule(r.id, { bucket: e.target.value as PtoBucket })} style={inputStyle}>
                          {buckets.map(b => <option key={b} value={b}>{ptoBucketLabel(b)}</option>)}
                        </select>
                      </label>
                      <label style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: '0 1 90px', minWidth: 0 }}>
                        <span style={{ fontSize: '11px', color: '#6b7280' }}>Hours</span>
                        <input type="text" inputMode="decimal" key={r.id + '-h'} defaultValue={r.hours || ''} onBlur={e => updateRule(r.id, { hours: parseFloat(e.target.value) || 0 })} placeholder="0" style={inputStyle} />
                      </label>
                      {r.kind === 'everyNWeeks' && (
                        <>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: '0 1 90px', minWidth: 0 }}>
                            <span style={{ fontSize: '11px', color: '#6b7280' }}>Every (wks)</span>
                            <input type="text" inputMode="numeric" key={r.id + '-ew'} defaultValue={String(r.everyWeeks ?? 1)} onBlur={e => { const v = Math.max(1, parseInt(e.target.value) || 1); updateRule(r.id, { everyWeeks: v }); if (!e.target.value || parseInt(e.target.value) < 1) e.target.value = String(v); }} placeholder="1" style={inputStyle} />
                          </label>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: '0 1 110px', minWidth: 0 }}>
                            <span style={{ fontSize: '11px', color: '#6b7280' }}>On</span>
                            <select value={r.weekday ?? 'Friday'} onChange={e => updateRule(r.id, { weekday: e.target.value as DayOfWeek })} style={inputStyle}>
                              {WEEKDAYS.map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                          </label>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: '0 1 150px', minWidth: 0 }}>
                            <span style={{ fontSize: '11px', color: '#6b7280' }}>From (anchor)</span>
                            <input type="date" value={r.anchor ?? ''} onChange={e => updateRule(r.id, { anchor: e.target.value })} style={inputStyle} />
                          </label>
                          {/* Force Waiting period + Active onto their own row — date picker is wide enough to warrant this break */}
                          <div aria-hidden="true" style={{ flex: '1 1 100%', height: 0 }} />
                          {!r.anchor && (
                            <span style={{ fontSize: '11px', color: 'var(--status-behind)', flex: '1 1 100%' }}>
                              ⚠ Anchor date required — without it no hours will accrue.
                            </span>
                          )}
                        </>
                      )}
                      {(r.kind === 'perConvertedHours' || r.kind === 'perConvertedBonus') && (
                        <label style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: '0 1 130px', minWidth: 0 }}>
                          <span style={{ fontSize: '11px', color: '#6b7280' }}>Per converted hrs</span>
                          <input type="text" inputMode="decimal" key={r.id + '-ph'} defaultValue={r.perHours || ''} onBlur={e => updateRule(r.id, { perHours: parseFloat(e.target.value) || 0 })} placeholder="0" style={inputStyle} />
                        </label>
                      )}
                      {r.kind === 'perConvertedBonus' && (
                        <>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: '0 1 90px', minWidth: 0 }}>
                            <span style={{ fontSize: '11px', color: '#6b7280' }}>Bonus hrs (Z)</span>
                            <input type="text" inputMode="decimal" key={r.id + '-bh'} defaultValue={r.bonusHours || ''} onBlur={e => updateRule(r.id, { bonusHours: parseFloat(e.target.value) || 0 })} placeholder="0" style={inputStyle} />
                          </label>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: '0 1 100px', minWidth: 0 }}>
                            <span style={{ fontSize: '11px', color: '#6b7280' }}>Per</span>
                            <select value={r.bonusInterval ?? 'week'} onChange={e => updateRule(r.id, { bonusInterval: e.target.value as 'week' | 'month' })} style={inputStyle}>
                              <option value="week">week</option>
                              <option value="month">month</option>
                            </select>
                          </label>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: '0 1 120px', minWidth: 0 }}>
                            <span style={{ fontSize: '11px', color: '#6b7280' }}>Consecutive (M)</span>
                            <input type="text" inputMode="numeric" key={r.id + '-bci'} defaultValue={String(r.bonusConsecutiveIntervals ?? 1)} onBlur={e => { const v = Math.max(1, parseInt(e.target.value) || 1); updateRule(r.id, { bonusConsecutiveIntervals: v }); if (!e.target.value || parseInt(e.target.value) < 1) e.target.value = String(v); }} placeholder="1" style={inputStyle} />
                          </label>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: '0 1 140px', minWidth: 0 }}>
                            <span style={{ fontSize: '11px', color: '#6b7280' }}>At criterion when</span>
                            <select value={r.bonusCriterion ?? 'hours'} onChange={e => updateRule(r.id, { bonusCriterion: e.target.value as 'hours' | 'percentAboveGoal' })} style={inputStyle}>
                              <option value="hours">converted ≥ hours</option>
                              <option value="percentAboveGoal">% above goal</option>
                            </select>
                          </label>
                          {(r.bonusCriterion ?? 'hours') === 'hours' ? (
                            <label style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: '0 1 110px', minWidth: 0 }}>
                              <span style={{ fontSize: '11px', color: '#6b7280' }}>Hours (Y′)</span>
                              <input type="text" inputMode="decimal" key={r.id + '-bpe'} defaultValue={r.bonusPerExtraHours || ''} onBlur={e => updateRule(r.id, { bonusPerExtraHours: parseFloat(e.target.value) || 0 })} placeholder="0" style={inputStyle} />
                            </label>
                          ) : (
                            <label style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: '0 1 110px', minWidth: 0 }}>
                              <span style={{ fontSize: '11px', color: '#6b7280' }}>% above goal</span>
                              <input type="text" inputMode="decimal" key={r.id + '-bpg'} defaultValue={r.bonusPercentAboveGoal || ''} onBlur={e => updateRule(r.id, { bonusPercentAboveGoal: parseFloat(e.target.value) || 0 })} placeholder="0" style={inputStyle} />
                            </label>
                          )}
                        </>
                      )}
                      {(r.kind === 'perConvertedHours' || r.kind === 'perConvertedBonus') && (
                        <span style={{ fontSize: '11px', color: '#6b7280', flex: '1 1 100%' }}>
                          "Converted" = your completed billable hours since the opening-balance date; balances move as sessions are completed or reopened.
                          {r.kind === 'perConvertedBonus' && ' Bonus pays out each time you string together M at-criterion intervals (then the streak resets).'}
                        </span>
                      )}
                      <label style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: '0 1 130px', minWidth: 0 }}>
                        <span style={{ fontSize: '11px', color: '#6b7280' }}>Waiting period (days)</span>
                        <input
                          type="text" inputMode="numeric"
                          key={r.id + '-wpd'}
                          placeholder="0 (none)"
                          defaultValue={r.waitingPeriodDays !== undefined ? String(r.waitingPeriodDays) : ''}
                          onBlur={e => {
                            const v = e.target.value === '' ? undefined : (parseInt(e.target.value) || 0);
                            updateRule(r.id, { waitingPeriodDays: v });
                          }}
                          style={inputStyle}
                        />
                      </label>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-body)', flex: '0 0 auto', alignSelf: 'flex-end', paddingBottom: '4px' }}>
                        <input
                          type="checkbox"
                          checked={r.enabled !== false}
                          onChange={e => updateRule(r.id, { enabled: e.target.checked })}
                        />
                        Active
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
            <button onClick={addRule} style={{ ...primaryBtn, marginTop: '8px' }}>+ Add accrual rule</button>
          </div>

          <div>
            <div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: '#6b7280', marginBottom: '6px' }}>
              Balance caps <span style={{ fontWeight: 400, textTransform: 'none' }}>(optional — stop accruing once a bucket reaches this ceiling)</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {buckets.map(b => (
                <label key={b} style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: '0 1 140px' }}>
                  <span style={{ fontSize: '11px', color: '#6b7280' }}>{ptoBucketLabel(b)} max (hrs)</span>
                  <input
                    type="number" min="0" step="0.0001"
                    placeholder="No cap"
                    key={`mb-${b}`}
                    defaultValue={cfg.maxBalances?.[b] ?? ''}
                    onBlur={e => {
                      const v = e.target.value === '' ? undefined : (parseFloat(e.target.value) || 0);
                      const existing = cfg.maxBalances || {};
                      const next: Partial<Record<PtoBucket, number>> = { ...existing };
                      if (v === undefined) { delete next[b]; } else { next[b] = v; }
                      set({ maxBalances: Object.keys(next).length ? next : undefined });
                    }}
                    style={inputStyle}
                  />
                </label>
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', color: '#6b7280', marginBottom: '6px' }}>
              Opening balances <span style={{ fontWeight: 400, textTransform: 'none' }}>(starting point; accrual sums forward from each date)</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {(cfg.openingBalances || []).map((b, i) => (
                <div key={i} style={{ ...cardStyle, padding: '10px 12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-body)' }}>Opening balance</span>
                    <button onClick={() => removeBalance(i)} style={dangerBtn}>Remove</button>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'flex-end' }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: '0 1 120px', minWidth: 0 }}>
                      <span style={{ fontSize: '11px', color: '#6b7280' }}>Bucket</span>
                      <select value={b.bucket} onChange={e => updateBalance(i, { bucket: e.target.value as PtoBucket })} style={inputStyle}>
                        {buckets.map(x => <option key={x} value={x}>{ptoBucketLabel(x)}</option>)}
                      </select>
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: '0 1 90px', minWidth: 0 }}>
                      <span style={{ fontSize: '11px', color: '#6b7280' }}>Hours</span>
                      <input type="text" inputMode="decimal" key={`ob-${i}-h`} defaultValue={b.hours || ''} onBlur={e => updateBalance(i, { hours: parseFloat(e.target.value) || 0 })} placeholder="0" style={inputStyle} />
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: '0 1 150px', minWidth: 0 }}>
                      <span style={{ fontSize: '11px', color: '#6b7280' }}>As of</span>
                      <input type="date" value={b.asOf} onChange={e => updateBalance(i, { asOf: e.target.value })} style={inputStyle} />
                    </label>
                  </div>
                </div>
              ))}
            </div>
            <button onClick={addBalance} style={{ ...primaryBtn, marginTop: '8px' }}>+ Add opening balance</button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Company & Compliance tab ──────────────────────────────────────────────────

function CandcEditor({ settings, saving, onSave }: {
  settings: CompanySettings;
  saving: boolean;
  onSave: (next: CompanySettings) => void | Promise<boolean | void>;
}) {
  const [justSaved, setJustSaved] = useState(false);
  const s = (n: number | undefined) => (n === undefined ? '' : String(n));
  const u = resolveUtilization(settings.utilization);
  // Supervision
  const [directPct, setDirectPct] = useState(s(settings.supervisionDirectHoursPercent));
  const [rbtPct, setRbtPct] = useState(s(settings.supervisionRBTHoursPercent));
  const [techPct, setTechPct] = useState(s(settings.supervisionTechHoursPercent));
  const [maxPct, setMaxPct] = useState(s(settings.supervisionMaxHoursPercent));
  const [prefMinPct, setPrefMinPct] = useState(s(settings.supervisionPreferredMinPercent ?? 15));
  const [prefMaxPct, setPrefMaxPct] = useState(s(settings.supervisionPreferredMaxPercent ?? 20));
  const [minContacts, setMinContacts] = useState(s(settings.rbtMinContactsPerMonth ?? 2));
  const [techMinContacts, setTechMinContacts] = useState(s(settings.techMinContactsPerMonth ?? 1));
  const [contactsSeparateDays, setContactsSeparateDays] = useState(settings.contactsMustOccurOnSeparateDays ?? true);
  const [pendingUncheck, setPendingUncheck] = useState(false);
  // Parent Training
  const [periodUnit, setPeriodUnit] = useState<TrainingPeriodUnit>(settings.parentTraining.periodUnit);
  const [ptMin, setPtMin] = useState(s(settings.parentTraining.minimumHours));
  const [ptTargetMin, setPtTargetMin] = useState(s(settings.parentTraining.targetMinHours));
  const [ptTargetMax, setPtTargetMax] = useState(s(settings.parentTraining.targetMaxHours));
  // Billable
  const [bcbaWeekly, setBcbaWeekly] = useState(s(u.bcbaWeeklyBillableHours));
  const [btWeekly, setBtWeekly] = useState(s(u.btWeeklyDirectHours));
  const [bcbaMonthly, setBcbaMonthly] = useState(s(u.bcbaMonthlyBillableHours));
  const [bcbaMonthly5, setBcbaMonthly5] = useState(s(u.bcbaMonthlyBillableHours5Week));
  const [clientUtilPct, setClientUtilPct] = useState(s(settings.utilization?.clientUtilizationPercent ?? 80));
  const [minClientSessionHrs, setMinClientSessionHrs] = useState(s(settings.utilization?.minClientSessionHoursPerWeek ?? 10));
  // Minimum session length (minutes) per type — a grow-toward/flag target, not a gate.
  const msm = resolveMinSessionMinutes(settings);
  const [minSupMin, setMinSupMin] = useState(s(msm.supervision));
  const [minPtMin, setMinPtMin] = useState(s(msm.parentTraining));
  const [minCpMin, setMinCpMin] = useState(s(msm.casePlanning));
  const [minDirectMin, setMinDirectMin] = useState(s(msm.clientSession));
  // Cancellation
  const [codes, setCodes] = useState<CancellationCode[]>(() => resolveCancellationCodes(settings).map(c => ({ ...c })));
  const [unplannedHrs, setUnplannedHrs] = useState(s(settings.cancellationNotice?.unplannedHoursThreshold ?? 24));
  const [plannedDays, setPlannedDays] = useState(s(settings.cancellationNotice?.plannedDaysThreshold ?? 30));

  const num = (str: string, fallback: number) => { const n = parseFloat(str); return Number.isFinite(n) ? n : fallback; };
  const optNum = (str: string) => { if (str.trim() === '') return undefined; const n = parseFloat(str); return Number.isFinite(n) ? n : undefined; };

  const save = async () => {
    const next: CompanySettings = {
      ...settings,
      supervisionDirectHoursPercent: num(directPct, settings.supervisionDirectHoursPercent),
      supervisionRBTHoursPercent: num(rbtPct, settings.supervisionRBTHoursPercent),
      supervisionTechHoursPercent: optNum(techPct),
      supervisionMaxHoursPercent: optNum(maxPct),
      supervisionPreferredMinPercent: num(prefMinPct, 15),
      supervisionPreferredMaxPercent: num(prefMaxPct, 20),
      rbtMinContactsPerMonth: num(minContacts, 2),
      techMinContactsPerMonth: num(techMinContacts, 1),
      contactsMustOccurOnSeparateDays: contactsSeparateDays,
      parentTraining: {
        minimumHours: num(ptMin, settings.parentTraining.minimumHours),
        targetMinHours: num(ptTargetMin, settings.parentTraining.targetMinHours),
        targetMaxHours: num(ptTargetMax, settings.parentTraining.targetMaxHours),
        periodUnit,
      },
      minSessionMinutes: {
        supervision: num(minSupMin, msm.supervision),
        parentTraining: num(minPtMin, msm.parentTraining),
        casePlanning: num(minCpMin, msm.casePlanning),
        clientSession: num(minDirectMin, msm.clientSession),
      },
      utilization: {
        bcbaWeeklyBillableHours: num(bcbaWeekly, u.bcbaWeeklyBillableHours),
        btWeeklyDirectHours: num(btWeekly, u.btWeeklyDirectHours),
        bcbaMonthlyBillableHours: num(bcbaMonthly, u.bcbaMonthlyBillableHours),
        bcbaMonthlyBillableHours5Week: num(bcbaMonthly5, u.bcbaMonthlyBillableHours5Week),
        clientUtilizationPercent: num(clientUtilPct, 80),
        minClientSessionHoursPerWeek: num(minClientSessionHrs, 10),
      },
      cancellationReasons: codes,
      cancellationNotice: {
        unplannedHoursThreshold: num(unplannedHrs, 24),
        plannedDaysThreshold: num(plannedDays, 30),
      },
    };
    setJustSaved(false);
    const ok = await onSave(next);
    if (ok !== false) { setJustSaved(true); window.setTimeout(() => setJustSaved(false), 2500); }
  };

  const saveBar = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <button onClick={save} style={primaryBtn} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      {justSaved && <span style={{ color: 'var(--status-met)', fontWeight: 600, fontSize: 13 }}>✓ Saved</span>}
    </div>
  );

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', gap: 8, flexWrap: 'wrap' }}>
        <h3 style={{ fontSize: '18px', fontWeight: 'bold' }}>Company and Compliance</h3>
        {saveBar}
      </div>

      <SettingsSection title="Supervision Targets">
        <NumField label="Per-case Company Min. (% of Direct Service Hours)" value={directPct} onChange={setDirectPct} suffix="%" defaultValue={5} />
        <NumField label="Per-Credentialed BT Company Min. (% of Direct Service Hours)" value={rbtPct} onChange={setRbtPct} suffix="%" defaultValue={5} hint="BACB floor is 5%." />
        <NumField label="Per-BT Company Min. (% of Direct Service Hours)" value={techPct} onChange={setTechPct} suffix="%" placeholder="—" />
        <NumField label="Per-Credentialed BT Min. Contacts Count" value={minContacts} onChange={setMinContacts} suffix="contacts" defaultValue={2} hint="BACB cadence requires at least 2/month." />
        <NumField label="Per-BT Company Min. Monthly Contacts Count" value={techMinContacts} onChange={setTechMinContacts} suffix="contacts" defaultValue={1} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={pendingUncheck ? true : contactsSeparateDays}
              onChange={e => {
                if (!e.target.checked) { setPendingUncheck(true); }
                else { setContactsSeparateDays(true); setPendingUncheck(false); }
              }}
              style={{ width: 15, height: 15 }}
            />
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-body)' }}>Contacts Must Occur on Separate Days?</span>
          </label>
          {pendingUncheck && (
            <div style={{ marginLeft: 23, padding: '8px 10px', backgroundColor: 'var(--amber-100)', border: '1px solid var(--amber-300)', borderRadius: 'var(--radius-md)', fontSize: 12, color: 'var(--amber-700)' }}>
              <p style={{ margin: '0 0 6px' }}>
                Unchecking means multiple supervision sessions on the same calendar day, for the same technician, will each count as a separate contact toward the monthly minimum.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { setContactsSeparateDays(false); setPendingUncheck(false); }} style={{ padding: '4px 10px', fontSize: 12, fontWeight: 600, backgroundColor: 'var(--status-pace)', color: 'var(--white)', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}>Confirm</button>
                <button onClick={() => setPendingUncheck(false)} style={{ padding: '4px 10px', fontSize: 12, fontWeight: 600, backgroundColor: 'var(--border-default)', color: 'var(--text-body)', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
        <NumField label="Insurer Max. Supervision % (% of Direct Service Hours)" value={maxPct} onChange={setMaxPct} suffix="%" placeholder="—" />
        <NumField label="BCBA Preferred Sup. Min. (% of Direct Hours)" value={prefMinPct} onChange={setPrefMinPct} suffix="%" defaultValue={15} />
        <NumField label="BCBA Preferred Sup. Max. (% of Direct Hours)" value={prefMaxPct} onChange={setPrefMaxPct} suffix="%" defaultValue={20} />
      </SettingsSection>

      <SettingsSection title="Parent Training Targets">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-body)' }}>Period</span>
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

      <SettingsSection title="Minimum Session Length">
        <p style={{ margin: '0 0 4px', fontSize: '12px', color: 'var(--text-muted)' }}>
          The builder flags proposed sessions shorter than these so you can review them (grow, or run as telehealth). Shorter sessions are still placed, never dropped.
        </p>
        <NumField label="Supervision" value={minSupMin} onChange={setMinSupMin} suffix="min" />
        <NumField label="Parent training" value={minPtMin} onChange={setMinPtMin} suffix="min" />
        <NumField label="Case planning" value={minCpMin} onChange={setMinCpMin} suffix="min" />
        <NumField label="Direct session" value={minDirectMin} onChange={setMinDirectMin} suffix="min" />
      </SettingsSection>

      <SettingsSection title="Billable &amp; Utilization Targets">
        <NumField label="BCBA fully-utilized weekly billables" value={bcbaWeekly} onChange={setBcbaWeekly} suffix="h/wk" />
        <NumField label="BT fully-utilized weekly direct hours" value={btWeekly} onChange={setBtWeekly} suffix="h/wk" hint="Aggregate BT direct hours your caseload generates." />
        <NumField label="BCBA monthly goal (4-week month)" value={bcbaMonthly} onChange={setBcbaMonthly} suffix="h/mo" />
        <NumField label="BCBA monthly goal (5-week month)" value={bcbaMonthly5} onChange={setBcbaMonthly5} suffix="h/mo" hint="Used when the month spans 5+ weeks." />
        <NumField label="Client utilization % (direct service hrs in auth)" value={clientUtilPct} onChange={setClientUtilPct} suffix="%" defaultValue={80} hint="Target % of authorized direct-service hours to fill. Default 80%." />
        <NumField label="Min client session hours / wk" value={minClientSessionHrs} onChange={setMinClientSessionHrs} suffix="h/wk" defaultValue={10} hint="Minimum weekly direct-service hours per client. Default 10 h." />
      </SettingsSection>

      <SettingsSection title="Cancellation Codes">
        <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 4px' }}>
          Added, edited, or retired codes apply to the cancel dialog once you press <strong>Save</strong>.
        </p>
        <CancellationCodesEditor codes={codes} onChange={setCodes} />
      </SettingsSection>

      <SettingsSection title="Cancellation Notice">
        <NumField label="Unplanned: adequate notice if more than" value={unplannedHrs} onChange={setUnplannedHrs} suffix="hours" />
        <NumField label="Planned: adequate notice if more than" value={plannedDays} onChange={setPlannedDays} suffix="days" />
      </SettingsSection>

      <div style={{ marginTop: '8px', paddingTop: '12px', borderTop: 'var(--border-hairline)' }}>
        {saveBar}
      </div>
    </div>
  );
}

// ── Travel-time grounding (Settings tab) ──────────────────────────────────────
// Home base, the travel-model tunables, the Google Maps key, and a "Refresh
// travel times" action that geocodes cities + warms the routed-duration cache.
// Only public city centroids + the home address + times are ever sent to Google.
function TravelSettingsEditor({ data, saving, onSave, aiSettings, onSaveAISettings, onRequestUnlock }: {
  data: ScheduleData;
  saving: boolean;
  onSave: (next: CompanySettings) => Promise<boolean>;
  aiSettings?: AISettings;
  onSaveAISettings?: (s: AISettings) => void | Promise<void>;
  onRequestUnlock?: () => Promise<boolean>;
}) {
  const settings = data.settings;
  const tv = { ...DEFAULT_TRAVEL_SETTINGS, ...(settings.travel || {}) };
  const home = settings.homeBase || {};
  const str = (n?: number) => (n === undefined ? '' : String(n));

  const [enabled, setEnabled] = useState(tv.enabled);
  const [withinCity, setWithinCity] = useState(String(tv.withinCityMin));
  const [pad, setPad] = useState(String(tv.padPercent));
  const [speed, setSpeed] = useState(String(tv.avgSpeedMph));
  const [unknownMin, setUnknownMin] = useState(String(tv.defaultUnknownMin));
  const [hbLabel, setHbLabel] = useState(home.label || '');
  const [hbAddress, setHbAddress] = useState(home.address || '');
  const [hbCity, setHbCity] = useState(home.city || '');
  const [hbLat, setHbLat] = useState(str(home.lat));
  const [hbLng, setHbLng] = useState(str(home.lng));

  const hasMapsKey = !!aiSettings?.mapsApiKey;
  const [replacingKey, setReplacingKey] = useState(!hasMapsKey);
  const [mapsKeyInput, setMapsKeyInput] = useState('');

  const [busy, setBusy] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const num = (s: string, fb: number) => { const n = parseFloat(s); return Number.isFinite(n) ? n : fb; };

  const draftSettings = (): CompanySettings => {
    const homeBase: HomeBase = {};
    if (hbLabel.trim()) homeBase.label = hbLabel.trim();
    if (hbAddress.trim()) homeBase.address = hbAddress.trim();
    if (hbCity.trim()) homeBase.city = hbCity.trim();
    if (hbLat.trim() !== '' && Number.isFinite(parseFloat(hbLat))) homeBase.lat = parseFloat(hbLat);
    if (hbLng.trim() !== '' && Number.isFinite(parseFloat(hbLng))) homeBase.lng = parseFloat(hbLng);
    const travel: TravelSettings = {
      enabled,
      withinCityMin: num(withinCity, DEFAULT_TRAVEL_SETTINGS.withinCityMin),
      padPercent: num(pad, DEFAULT_TRAVEL_SETTINGS.padPercent),
      avgSpeedMph: num(speed, DEFAULT_TRAVEL_SETTINGS.avgSpeedMph),
      defaultUnknownMin: num(unknownMin, DEFAULT_TRAVEL_SETTINGS.defaultUnknownMin),
      hourBucketSize: tv.hourBucketSize,
    };
    return { ...settings, homeBase: Object.keys(homeBase).length ? homeBase : undefined, travel };
  };

  // Persist the maps key (replace-gated) and return the effective key. Blank on
  // replace keeps the existing key.
  const persistMapsKey = async (): Promise<string | undefined> => {
    if (!replacingKey) return aiSettings?.mapsApiKey;
    const key = mapsKeyInput.trim();
    if (!key) return aiSettings?.mapsApiKey;
    if (onSaveAISettings && aiSettings) await onSaveAISettings({ ...aiSettings, mapsApiKey: key });
    return key;
  };

  const saveAll = async () => {
    setJustSaved(false);
    await persistMapsKey();
    const ok = await onSave(draftSettings());
    if (ok !== false) { setJustSaved(true); setReplacingKey(false); setMapsKeyInput(''); window.setTimeout(() => setJustSaved(false), 2500); }
  };

  const doRefresh = async () => {
    const key = await persistMapsKey();
    if (!key) { setLog(['Set a Google Maps API key first, then Refresh.']); return; }
    setBusy(true); setLog(['Refreshing travel times…']);
    try {
      const draft = draftSettings();
      const provider = new GoogleRoutingProvider(key);
      const res = await refreshTravelTimes({ ...data, settings: draft }, provider, new Date());
      await onSave({ ...draft, cityCenters: res.cityCenters, travelCache: res.travelCache });
      setReplacingKey(false); setMapsKeyInput('');
      setLog([...res.log, `Now caching ${res.cityCenters.length} city centroids and ${res.travelCache.length} routed times.`]);
    } catch {
      setLog(['Travel refresh failed — check the Maps key and connection. Sessions without a routed time use an offline estimate.']);
    } finally { setBusy(false); }
  };

  const revealReplace = async () => {
    if (onRequestUnlock && !(await onRequestUnlock())) return;
    setReplacingKey(true);
  };

  const cityCount = (settings.cityCenters || []).length;
  const cacheCount = (settings.travelCache || []).length;
  const clientCities = new Set((data.clients || []).map(c => (c.city || '').trim().toLowerCase()).filter(Boolean)).size;
  const fieldRow: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-body)' };

  return (
    <div style={{ marginBottom: 16 }}>
      <SettingsSection title="Travel Time — BCBA drive between sessions">
        <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 8px' }}>
          Grounds the schedule so the single BCBA has realistic drive time between sessions at different clients.
          Each client carries a <strong>city only</strong> (set per client under Caseload → Clients); your home base is the one exact address.
          Only public city centroids + your home address + times are ever sent to Google.
        </p>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 8 }}>
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
          Enforce travel time when building &amp; suggesting schedules
        </label>
        <NumField label="Same-city trip (flat)" value={withinCity} onChange={setWithinCity} suffix="min" defaultValue={15} hint="Two clients in one city share a centroid, so same-city hops use this flat floor." />
        <NumField label="Pad on routed times" value={pad} onChange={setPad} suffix="%" defaultValue={5} hint="Added to each Google drive time for the last mile from the city centroid to the real site." />
        <NumField label="Offline fallback speed" value={speed} onChange={setSpeed} suffix="mph" defaultValue={30} hint="Estimates a cross-city drive when no routed time is cached." />
        <NumField label="Fallback when a city can't be located" value={unknownMin} onChange={setUnknownMin} suffix="min" defaultValue={45} />
      </SettingsSection>

      <SettingsSection title="Home Base">
        <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 8px' }}>Your day's start/end point — an exact address is fine here (it's yours, not a client's). Lat/Lng auto-fill on Refresh.</p>
        <div style={fieldRow}><span style={{ width: 64 }}>Label</span><input value={hbLabel} onChange={e => setHbLabel(e.target.value)} placeholder="Home" style={{ ...inputStyle, flex: 1, minWidth: 120 }} /></div>
        <div style={fieldRow}><span style={{ width: 64 }}>Address</span><input value={hbAddress} onChange={e => setHbAddress(e.target.value)} placeholder="123 Main St, City, ST" style={{ ...inputStyle, flex: 1, minWidth: 160 }} /></div>
        <div style={fieldRow}>
          <span style={{ width: 64 }}>City</span><input value={hbCity} onChange={e => setHbCity(e.target.value)} placeholder="City, ST" style={{ ...inputStyle, flex: 1, minWidth: 120 }} />
          <span>Lat</span><input value={hbLat} onChange={e => setHbLat(e.target.value)} placeholder="auto" style={{ ...inputStyle, width: 90 }} />
          <span>Lng</span><input value={hbLng} onChange={e => setHbLng(e.target.value)} placeholder="auto" style={{ ...inputStyle, width: 90 }} />
        </div>
      </SettingsSection>

      <SettingsSection title="Google Maps API Key &amp; Refresh">
        {hasMapsKey && !replacingKey ? (
          <div style={{ ...fieldRow, gap: 10 }}>
            <span style={{ color: 'var(--status-met)', fontWeight: 600 }}>🔒 Maps key is set</span>
            <button onClick={revealReplace} style={chipBtn}>Replace</button>
          </div>
        ) : (
          <div style={fieldRow}>
            <span style={{ width: 64 }}>Maps key</span>
            <input type="password" value={mapsKeyInput} onChange={e => setMapsKeyInput(e.target.value)} placeholder={hasMapsKey ? 'blank = keep existing' : 'AIza…'} autoComplete="off" style={{ ...inputStyle, flex: 1, minWidth: 160 }} />
          </div>
        )}
        <p style={{ fontSize: 11, color: '#6b7280', margin: '4px 0 8px' }}>
          Predictive traffic uses Google's Routes API. Restrict the key (API + referrer) in Google Cloud. Caching {cityCount} city centroids / {cacheCount} routed times for {clientCities} client {clientCities === 1 ? 'city' : 'cities'}.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={saveAll} style={primaryBtn} disabled={saving || busy}>{saving ? 'Saving…' : 'Save travel settings'}</button>
          <button onClick={doRefresh} style={chipBtn} disabled={busy || saving}>{busy ? 'Refreshing…' : '↻ Refresh travel times'}</button>
          {justSaved && <span style={{ color: 'var(--status-met)', fontWeight: 600, fontSize: 13 }}>✓ Saved</span>}
        </div>
        {log.length > 0 && (
          <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none', fontSize: 11, color: 'var(--text-body)' }}>
            {log.map((l, i) => <li key={i}>• {l}</li>)}
          </ul>
        )}
      </SettingsSection>
    </div>
  );
}

// ── PTO config (Time Off tab) ─────────────────────────────────────────────────

function PtoEditor({ settings, saving, onSave }: {
  settings: CompanySettings;
  saving: boolean;
  onSave: (next: CompanySettings) => void | Promise<boolean | void>;
}) {
  const [justSaved, setJustSaved] = useState(false);
  const s = (n: number | undefined) => (n === undefined ? '' : String(n));
  const [ptoRatio, setPtoRatio] = useState(s(settings.ptoBillableDeductionRatio ?? DEFAULT_PTO_DEDUCTION_RATIO));
  const [ptoCfg, setPtoCfg] = useState<PtoConfig>(() => resolvePtoConfig(settings.pto));
  const [holAffects, setHolAffects] = useState<boolean>(settings.holidayAffectsBillable ?? false);
  const [holPerDay, setHolPerDay] = useState(s(settings.holidayBillableHoursPerDay ?? 8));

  const num = (str: string, fallback: number) => { const n = parseFloat(str); return Number.isFinite(n) ? n : fallback; };

  const save = async () => {
    const next: CompanySettings = {
      ...settings,
      ptoBillableDeductionRatio: num(ptoRatio, DEFAULT_PTO_DEDUCTION_RATIO),
      holidayAffectsBillable: holAffects,
      holidayBillableHoursPerDay: num(holPerDay, 8),
      pto: ptoCfg,
    };
    setJustSaved(false);
    const ok = await onSave(next);
    if (ok !== false) { setJustSaved(true); window.setTimeout(() => setJustSaved(false), 2500); }
  };

  return (
    <div>
      <SettingsSection title="Accrual Rules">
        <NumField
          label="Billable requirement removed per PTO hour"
          value={ptoRatio}
          onChange={setPtoRatio}
          suffix="h / PTO h"
          hint={`1 = every leave hour drops the week's requirement by an hour. Set 0.625 if an 8h day should remove 5 billable hours (~3 non-billable hours/day assumed). Currently 8h off = −${(() => { const r = parseFloat(ptoRatio); return Number.isFinite(r) ? Math.round(8 * r * 100) / 100 : 8; })()}h.`}
        />
        <PtoConfigEditor value={ptoCfg} onChange={setPtoCfg} />
      </SettingsSection>
      <SettingsSection title="Holidays">
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--text-body)' }}>
          <input type="checkbox" checked={holAffects} onChange={e => setHolAffects(e.target.checked)} />
          Holidays reduce billable targets
        </label>
        {holAffects && (
          <NumField
            label="Billable hours removed per holiday day"
            value={holPerDay}
            onChange={setHolPerDay}
            defaultValue={8}
            suffix="h / holiday"
            hint="A company holiday in the week or month lowers billable targets by this many hours per day, and shrinks hours targets (client direct, technician direct) proportionally to the working days lost."
          />
        )}
      </SettingsSection>
      <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={save} style={primaryBtn} disabled={saving}>{saving ? 'Saving…' : 'Save accrual rules'}</button>
        {justSaved && <span style={{ color: 'var(--status-met)', fontWeight: 600, fontSize: 13 }}>✓ Saved</span>}
      </div>
    </div>
  );
}

// ── BCBA clinician availability (Time Off tab) ────────────────────────────────

const availTimeInput: React.CSSProperties = {
  fontSize: '12px', padding: '2px 4px', border: '1px solid #d1d5db',
  borderRadius: 3, width: 70, boxSizing: 'border-box',
};

function ClinicianAvailEditor({ settings, saving, onSave }: {
  settings: CompanySettings;
  saving: boolean;
  onSave: (next: CompanySettings) => void | Promise<boolean | void>;
}) {
  const [justSaved, setJustSaved] = useState(false);
  const [avail, setAvail] = useState<{ [key in DayOfWeek]?: TimeWindow[] }>(
    () => settings.clinicianAvailability ?? {}
  );

  const updateWindow = (day: DayOfWeek, idx: number, field: 'start' | 'end', value: string) => {
    const next = { ...avail };
    const list = (next[day] || []).slice();
    list[idx] = { ...list[idx], [field]: value };
    next[day] = list;
    setAvail(next);
  };
  const addWindow = (day: DayOfWeek) => {
    const next = { ...avail };
    next[day] = [...(next[day] || []), { start: '09:00', end: '17:00' }];
    setAvail(next);
  };
  const removeWindow = (day: DayOfWeek, idx: number) => {
    const next = { ...avail };
    next[day] = (next[day] || []).filter((_, i) => i !== idx);
    if ((next[day] || []).length === 0) delete next[day];
    setAvail(next);
  };
  const clearDay = (day: DayOfWeek) => {
    const next = { ...avail };
    delete next[day];
    setAvail(next);
  };
  const copyMondayToWeekdays = () => {
    const monWindows = avail['Monday'] || [];
    const next = { ...avail };
    (['Tuesday', 'Wednesday', 'Thursday', 'Friday'] as DayOfWeek[]).forEach(d => {
      if (monWindows.length === 0) { delete next[d]; }
      else { next[d] = monWindows.map(w => ({ ...w })); }
    });
    setAvail(next);
  };

  const handleTogglePreset = (key: PresetKey) => {
    const preset = PRESET_WINDOWS[key];
    const active = isPresetActive(avail, preset);
    setAvail(togglePreset(avail, preset, !active));
  };

  const save = async () => {
    const next: CompanySettings = { ...settings, clinicianAvailability: avail };
    setJustSaved(false);
    const ok = await onSave(next);
    if (ok !== false) { setJustSaved(true); window.setTimeout(() => setJustSaved(false), 2500); }
  };

  return (
    <div>
      <SettingsSection title="BCBA Availability">
        <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 8px' }}>
          Sets the grid range for the Case calendar. Sessions outside these windows fall outside BCBA coverage.
        </p>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          {(Object.keys(PRESET_WINDOWS) as PresetKey[]).map(key => (
            <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', cursor: 'pointer', userSelect: 'none' }}>
              <input type="checkbox" checked={isPresetActive(avail, PRESET_WINDOWS[key])} onChange={() => handleTogglePreset(key)} style={{ cursor: 'pointer' }} />
              {PRESET_LABELS[key]}
            </label>
          ))}
          <button onClick={copyMondayToWeekdays} style={chipBtn}>Copy Mon → Tue–Fri</button>
          <button onClick={() => setAvail({})} style={{ ...chipBtn, color: 'var(--status-behind)', borderColor: 'var(--red-300)' }}>Clear all</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {DAYS.map((day, dayIdx) => {
            const windows = avail[day] || [];
            return (
              <div key={day} style={{
                display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap',
                padding: '6px 8px', borderRadius: '4px',
                background: dayIdx % 2 === 0 ? 'var(--surface-sunken)' : 'var(--surface-card)',
                border: '1px solid #e5e7eb', boxSizing: 'border-box', width: '100%', minWidth: 0,
              }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-body)', width: '36px', flexShrink: 0 }}>{day.slice(0, 3)}</span>
                {windows.length === 0 && <span style={{ fontSize: '12px', color: '#9ca3af', fontStyle: 'italic' }}>Off</span>}
                {windows.map((w, idx) => (
                  <span key={idx} style={{
                    display: 'inline-flex', alignItems: 'center', gap: '3px',
                    backgroundColor: 'var(--sage-50)', border: '1px solid var(--sage-200)',
                    borderRadius: 'var(--radius-sm)', padding: '2px 6px',
                  }}>
                    <input type="time" step="900" value={w.start} onChange={e => updateWindow(day, idx, 'start', e.target.value)} style={availTimeInput} />
                    <span style={{ fontSize: '12px', color: '#6b7280' }}>–</span>
                    <input type="time" step="900" value={w.end} onChange={e => updateWindow(day, idx, 'end', e.target.value)} style={availTimeInput} />
                    <button onClick={() => removeWindow(day, idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#9ca3af', padding: '0 2px', lineHeight: 1 }} title="Remove">×</button>
                  </span>
                ))}
                <button onClick={() => addWindow(day)} style={{ ...chipBtn, fontSize: '11px', padding: '2px 8px' }}>+ window</button>
                {windows.length > 0 && (
                  <button onClick={() => clearDay(day)} style={{ ...chipBtn, fontSize: '11px', padding: '2px 8px', marginLeft: 'auto' }}>Off</button>
                )}
              </div>
            );
          })}
        </div>
      </SettingsSection>
      <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={save} style={primaryBtn} disabled={saving}>{saving ? 'Saving…' : 'Save availability'}</button>
        {justSaved && <span style={{ color: 'var(--status-met)', fontWeight: 600, fontSize: 13 }}>✓ Saved</span>}
      </div>
    </div>
  );
}

// ── Settings editor (residual: Data, AI, Lock, Report dates, Session defaults) ─

function SettingsEditor({ settings, saving, onSave, onImportFile, onRerunWizard, onDownload, onBackup, onClearData,
  aiSettings, onSaveAISettings, onClearKey, onRequestUnlock,
  faceIdAvailable, faceIdEnabled, biometryLabel, onToggleFaceId, onChangePin
}: {
  settings: CompanySettings;
  saving: boolean;
  onSave: (next: CompanySettings) => void | Promise<boolean | void>;
  onImportFile?: () => void;
  onRerunWizard?: () => void;
  onDownload?: () => void;
  onBackup?: () => void;
  onClearData?: () => void;
  aiSettings?: AISettings;
  onSaveAISettings?: (settings: AISettings) => void | Promise<void>;
  onClearKey?: () => void;
  onRequestUnlock?: () => Promise<boolean>;
  faceIdAvailable?: boolean;
  faceIdEnabled?: boolean;
  biometryLabel?: string;
  onToggleFaceId?: (on: boolean) => void;
  onChangePin?: () => void;
}) {
  const [justSaved, setJustSaved] = useState(false);
  const s = (n: number | undefined) => (n === undefined ? '' : String(n));
  const [draftLeadVal, setDraftLeadVal] = useState(s(settings.reportDraftLead?.value ?? 4));
  const [draftLeadUnit, setDraftLeadUnit] = useState<'days' | 'weeks'>(settings.reportDraftLead?.unit ?? 'weeks');
  const [finalLeadVal, setFinalLeadVal] = useState(s(settings.reportFinalLead?.value ?? 2));
  const [finalLeadUnit, setFinalLeadUnit] = useState<'days' | 'weeks'>(settings.reportFinalLead?.unit ?? 'weeks');

  // BCBA (non-direct) session-length defaults — auto-fill a new appointment's end.
  const bsd = settings.bcbaSessionDefaults || DEFAULT_BCBA_SESSION_DEFAULTS;
  const [supPct, setSupPct] = useState(s(bsd.supervisionPercentOfWeeklyDirect));
  const [reassessHrs, setReassessHrs] = useState(s(bsd.reassessmentHours));
  const [casePlanHrs, setCasePlanHrs] = useState(s(bsd.casePlanningHours));
  const [parentTrainHrs, setParentTrainHrs] = useState(s(bsd.parentTrainingHours));
  const [otherHrs, setOtherHrs] = useState(s(bsd.otherHours));

  // AI settings, schedule password, and PIN/Face ID
  const [model, setModel] = useState<ClaudeModel>(aiSettings?.model ?? 'claude-sonnet-4-6');
  const [showKey, setShowKey] = useState(false);
  const hasExistingKey = !!aiSettings?.apiKey;
  const [replacingKey, setReplacingKey] = useState(!hasExistingKey);
  const [apiKey, setApiKey] = useState('');
  const [unlockError, setUnlockError] = useState<string | null>(null);

  const hasExistingPw = !!aiSettings?.schedulePassword;
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [changingPw, setChangingPw] = useState(!hasExistingPw);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwDict, setPwDict] = useState<ReadonlySet<string> | null>(null);
  useEffect(() => { loadPasswordDict().then(setPwDict); }, []);

  // Track whether key state has been saved to know when to move AI settings position.
  // Also reset replacingKey when the key is cleared externally (e.g. via Clear button).
  const [keySavedState, setKeySavedState] = useState(hasExistingKey);
  useEffect(() => {
    setKeySavedState(hasExistingKey);
    if (!hasExistingKey) setReplacingKey(true);
  }, [hasExistingKey]);

  const num = (str: string, fallback: number) => {
    const n = parseFloat(str);
    return Number.isFinite(n) ? n : fallback;
  };

  const save = async () => {
    const next: CompanySettings = {
      ...settings,
      reportDraftLead: { value: num(draftLeadVal, 4), unit: draftLeadUnit },
      reportFinalLead: { value: num(finalLeadVal, 2), unit: finalLeadUnit },
      bcbaSessionDefaults: {
        supervisionPercentOfWeeklyDirect: num(supPct, DEFAULT_BCBA_SESSION_DEFAULTS.supervisionPercentOfWeeklyDirect),
        reassessmentHours: num(reassessHrs, DEFAULT_BCBA_SESSION_DEFAULTS.reassessmentHours),
        casePlanningHours: num(casePlanHrs, DEFAULT_BCBA_SESSION_DEFAULTS.casePlanningHours),
        parentTrainingHours: num(parentTrainHrs, DEFAULT_BCBA_SESSION_DEFAULTS.parentTrainingHours),
        otherHours: num(otherHrs, DEFAULT_BCBA_SESSION_DEFAULTS.otherHours),
      },
    };
    // Validate schedule password change before saving
    let schedulePassword = aiSettings?.schedulePassword;
    if (changingPw) {
      if (hasExistingPw && currentPw !== aiSettings?.schedulePassword) {
        setPwError('Current password is incorrect.');
        return;
      }
      const trimmed = newPw.trim();
      if (trimmed && !validatePassword(trimmed, pwDict ?? undefined).valid) {
        setPwError('New password does not meet the requirements below.');
        return;
      }
      schedulePassword = trimmed || undefined;
    }

    setJustSaved(false);
    const ok = await onSave(next);
    if (ok !== false) {
      // Resolve final API key
      const finalKey = replacingKey ? (apiKey.trim() || aiSettings?.apiKey || '') : (aiSettings?.apiKey || '');
      const finalModel = model;

      // Save AI settings (key, model, schedulePassword) in one shot
      if (onSaveAISettings && (finalKey !== aiSettings?.apiKey || finalModel !== aiSettings?.model || schedulePassword !== aiSettings?.schedulePassword)) {
        await onSaveAISettings({ apiKey: finalKey, model: finalModel, schedulePassword });
      }

      if (replacingKey && apiKey.trim()) {
        setKeySavedState(true);
        setReplacingKey(false);
        setApiKey('');
      } else if (replacingKey && !apiKey.trim() && hasExistingKey) {
        setReplacingKey(false);
      }
      if (changingPw) {
        setChangingPw(false);
        setCurrentPw('');
        setNewPw('');
      }
      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), 2500);
    } else if (changingPw) {
      // Save was rejected (e.g. the schedule failed to load, so the settings
      // write threw). Don't leave the password form looking unchanged as if it
      // saved — say so where the user is editing it. The global error banner
      // carries the underlying message but can be scrolled off-screen.
      setPwError('Couldn’t save — re-import your schedule and try again.');
    }
  };

  // Shared save control — rendered at the top AND bottom so the long form can be
  // saved without scrolling back up, with an inline confirmation (the global
  // error banner sits at the top of the panel, easy to miss when scrolled down).
  const saveBar = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <button onClick={save} style={primaryBtn} disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button>
      {justSaved && <span style={{ color: 'var(--status-met)', fontWeight: 600, fontSize: 13 }}>✓ Saved</span>}
      <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>Saves everything on this tab, including cancellation codes &amp; time-off rules.</span>
    </div>
  );

  const aiSection = (
    <AISettingsSection
      model={model}
      onModelChange={setModel}
      hasExistingKey={hasExistingKey}
      replacingKey={replacingKey}
      apiKey={apiKey}
      onApiKeyChange={setApiKey}
      showKey={showKey}
      onShowKeyChange={setShowKey}
      onReplaceKey={async () => {
        if (onRequestUnlock && !(await onRequestUnlock())) {
          setUnlockError('Could not verify — key unchanged.');
          return;
        }
        setApiKey('');
        setShowKey(false);
        setReplacingKey(true);
        setUnlockError(null);
      }}
      onClearKey={onClearKey}
      unlockError={unlockError}
    />
  );

  const schedulePwSection = (
    <SettingsSection title="Schedule Password (HIPAA 😇)">
      <div style={{ padding: '12px', backgroundColor: 'var(--surface-sunken)', borderRadius: 'var(--radius-md)', fontSize: '13px' }}>
        <p style={{ marginBottom: '12px', color: '#6b7280', fontSize: '12px' }}>
          Encrypts your downloaded schedule file. Leave blank for a normal readable file.
        </p>
        {hasExistingPw && !changingPw ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-body)' }}>🔒 Password is set.</span>
            <button
              onClick={() => { setChangingPw(true); setPwError(null); }}
              style={{
                padding: '6px 12px', border: 'var(--border-control)', borderRadius: 'var(--radius-md)',
                background: 'white', cursor: 'pointer', fontSize: '13px',
              }}
            >
              Change…
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {hasExistingPw && (
              <input
                type={showPw ? 'text' : 'password'}
                placeholder="Current password"
                value={currentPw}
                onChange={(e) => { setCurrentPw(e.target.value); setPwError(null); }}
                autoComplete="off"
                style={{ padding: '8px 12px', border: 'var(--border-control)', borderRadius: 'var(--radius-md)', fontSize: '13px' }}
              />
            )}
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type={showPw ? 'text' : 'password'}
                placeholder={hasExistingPw ? 'New password (blank to remove)' : 'Leave blank for no encryption'}
                value={newPw}
                onChange={(e) => { setNewPw(e.target.value); setPwError(null); }}
                autoComplete="off"
                style={{ flex: 1, padding: '8px 12px', border: 'var(--border-control)', borderRadius: 'var(--radius-md)', fontSize: '13px' }}
              />
              <button
                onClick={() => setShowPw(!showPw)}
                style={{
                  padding: '8px 12px', border: 'var(--border-control)', borderRadius: 'var(--radius-md)',
                  background: 'white', cursor: 'pointer', fontSize: '13px',
                }}
              >
                {showPw ? 'Hide' : 'Show'}
              </button>
            </div>
            {changingPw && newPw.length > 0 && (
              <ul style={{ listStyle: 'none', padding: 0, margin: '2px 0 0', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {validatePassword(newPw, pwDict ?? undefined).rules.map((r) => (
                  <li key={r.id} style={{ display: 'flex', gap: 6, alignItems: 'baseline', fontSize: 11.5, color: r.ok ? 'var(--text-muted, #6b7280)' : 'var(--text, #374151)' }}>
                    <span aria-hidden="true" style={{ fontWeight: 700, color: r.ok ? '#16a34a' : '#9ca3af' }}>{r.ok ? '✓' : '○'}</span>
                    {r.label}
                  </li>
                ))}
              </ul>
            )}
            {pwError && <p style={{ fontSize: '12px', color: 'var(--status-behind)', margin: 0 }}>{pwError}</p>}
          </div>
        )}
      </div>
    </SettingsSection>
  );

  const appLockSection = faceIdAvailable !== undefined ? (
    <SettingsSection title="App Lock (HIPAA 😇)">
      <div style={{ padding: '12px', backgroundColor: 'var(--surface-sunken)', borderRadius: 'var(--radius-md)', fontSize: '13px' }}>
        <p style={{ marginBottom: '12px', color: '#6b7280', fontSize: '12px' }}>
          A PIN locks the app on launch. There is no recovery if you forget it.
        </p>
        <button
          onClick={onChangePin}
          style={{
            padding: '8px 12px', border: 'var(--border-control)', borderRadius: 'var(--radius-md)',
            background: 'white', cursor: 'pointer', fontSize: '13px',
          }}
        >
          Change PIN
        </button>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={faceIdEnabled || false}
            onChange={(e) => onToggleFaceId?.(e.target.checked)}
          />
          <span style={{ fontSize: '13px' }}>Unlock with {biometryLabel || 'Face ID / Touch ID'}</span>
        </label>
        {!faceIdAvailable && (
          <p style={{ fontSize: '11px', color: 'var(--text-faint)', marginTop: '4px', lineHeight: 1.4 }}>
            Tap above to request Face ID access. If previously denied, go to Settings → Face ID &amp; Passcode → Other Apps to enable this app.
          </p>
        )}
      </div>
    </SettingsSection>
  ) : null;

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', gap: 8, flexWrap: 'wrap' }}>
        <h3 style={{ fontSize: '18px', fontWeight: 'bold' }}>SAssi App Settings</h3>
        {saveBar}
      </div>

      {/* ── TOP: Data always first ── */}
      {(onImportFile || onRerunWizard || onDownload || onBackup || onClearData) && (
        <SettingsSection title="Data">
          <p style={{ fontSize: '12px', color: '#6b7280', margin: 0 }}>
            Re-run the wizard to edit company settings, clients, and technicians
            (your appointments are kept), or load a different schedule file.
            Neither replaces your current data until you confirm. Upload restores
            either an <strong>.xlsx</strong> or an encrypted <strong>.json backup</strong>.
          </p>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {onRerunWizard && (
              <button
                onClick={onRerunWizard}
                style={{
                  padding: '8px 14px', backgroundColor: 'var(--brand-ai)', color: 'var(--brand-primary-text)',
                  border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                }}
              >Re-run wizard</button>
            )}
            {onImportFile && (
              <button
                onClick={onImportFile}
                style={{
                  padding: '8px 14px', backgroundColor: 'var(--brand-primary)', color: 'var(--brand-primary-text)',
                  border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                }}
              >Upload schedule…</button>
            )}
            {onDownload && (
              <button
                onClick={onDownload}
                style={{
                  padding: '8px 14px', backgroundColor: 'var(--brand-primary)', color: 'var(--brand-primary-text)',
                  border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                }}
              >↓ Download schedule</button>
            )}
            {onBackup && (
              <button
                onClick={onBackup}
                title="Save a lossless, password-encrypted .json backup of the full schedule."
                style={{
                  padding: '8px 14px', backgroundColor: 'var(--surface-raised)', color: 'var(--text-body)',
                  border: 'var(--border-hairline)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                }}
              >⤓ Backup (encrypted)</button>
            )}
          </div>
          {onClearData && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: 'var(--border-hairline)' }}>
              <p style={{ fontSize: '12px', color: '#6b7280', margin: '0 0 6px' }}>
                Clearing wipes the schedule loaded in the app. If you haven't saved
                your work, <strong>download it first</strong> — this can't be undone.
              </p>
              {onDownload && (
                <div style={{ marginBottom: 8 }}>
                  <button
                    onClick={onDownload}
                    style={{
                      background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                      fontSize: 12, color: 'var(--status-behind)', textDecoration: 'underline', fontWeight: 600,
                    }}
                  >↓ Download schedule first</button>
                </div>
              )}
              <button
                onClick={onClearData}
                style={{
                  padding: '8px 14px', backgroundColor: 'var(--status-behind-bg)', color: 'var(--status-behind)',
                  border: '1px solid var(--red-300)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                }}
              >Clear loaded data</button>
            </div>
          )}
        </SettingsSection>
      )}

      {/* AI Integration CTA — top when not yet configured */}
      {!keySavedState && aiSettings && onSaveAISettings && aiSection}

      {/* Schedule Password CTA — top when not set */}
      {!hasExistingPw && schedulePwSection}

      {/* App Lock — always visible on native */}
      {appLockSection}

      {/* ── BOTTOM: already-configured security items (management) ── */}

      {/* AI Integration — bottom when key is set */}
      {keySavedState && aiSettings && onSaveAISettings && aiSection}

      {/* Schedule Password — bottom management when set */}
      {hasExistingPw && schedulePwSection}

      <SettingsSection title="Report due dates (before auth end)">
        <LeadField label="Initial draft due" value={draftLeadVal} unit={draftLeadUnit} onChangeValue={setDraftLeadVal} onChangeUnit={setDraftLeadUnit} />
        <LeadField label="Final draft due" value={finalLeadVal} unit={finalLeadUnit} onChangeValue={setFinalLeadVal} onChangeUnit={setFinalLeadUnit} />
      </SettingsSection>

      <SettingsSection title="BCBA session-length defaults">
        <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 4px' }}>
          Auto-fills a new appointment's end time the moment you pick its type.
        </p>
        <NumField label="Supervision (% of weekly direct hours)" value={supPct} onChange={setSupPct} suffix="%" hint="Default 20%. Computed per case from the client's authorized weekly direct hours." />
        <NumField label="Reassessment" value={reassessHrs} onChange={setReassessHrs} suffix="h" />
        <NumField label="Case planning" value={casePlanHrs} onChange={setCasePlanHrs} suffix="h" />
        <NumField label="Parent training / coordination of care" value={parentTrainHrs} onChange={setParentTrainHrs} suffix="h" />
        <NumField label="Other" value={otherHrs} onChange={setOtherHrs} suffix="h" />
      </SettingsSection>

      <div style={{ marginTop: '8px', paddingTop: '12px', borderTop: 'var(--border-hairline)' }}>
        {saveBar}
      </div>
    </div>
  );
}

function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ ...cardStyle, marginBottom: '16px' }}>
      <p style={{ fontSize: '11px', fontWeight: 800, letterSpacing: 'var(--tracking-wide, .06em)', textTransform: 'uppercase', color: 'var(--sage-700)', marginBottom: '12px' }}>{title}</p>
      <div style={{ display: 'grid', gap: '12px' }}>{children}</div>
    </div>
  );
}

const MODEL_OPTIONS: { value: ClaudeModel; label: string; description: string }[] = [
  {
    value: 'claude-opus-4-8',
    label: 'Opus 4.8',
    description: 'Best for complex multi-week scheduling. Slower, more expensive.',
  },
  {
    value: 'claude-sonnet-4-6',
    label: 'Sonnet 4.6',
    description: 'Balanced quality, speed, and cost. Recommended for most cases.',
  },
  {
    value: 'claude-haiku-4-5-20251001',
    label: 'Haiku 4.5',
    description: 'Fastest and cheapest. Good for simple single-week conflicts.',
  },
];

function AISettingsSection({ model, onModelChange, hasExistingKey, replacingKey, apiKey, onApiKeyChange, showKey, onShowKeyChange, onReplaceKey, onClearKey, unlockError }: {
  model: ClaudeModel;
  onModelChange: (m: ClaudeModel) => void;
  hasExistingKey: boolean;
  replacingKey: boolean;
  apiKey: string;
  onApiKeyChange: (key: string) => void;
  showKey: boolean;
  onShowKeyChange: (show: boolean) => void;
  onReplaceKey: () => void;
  onClearKey?: () => void;
  unlockError: string | null;
}) {
  return (
    <SettingsSection title="AI Integration">
      <div>
        <label style={{ display: 'block', fontWeight: '600', marginBottom: '8px', fontSize: '13px' }}>Claude Model</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {MODEL_OPTIONS.map(opt => (
            <label
              key={opt.value}
              style={{
                display: 'flex',
                gap: '10px',
                padding: '10px',
                border: model === opt.value ? '2px solid var(--brand-primary)' : 'var(--border-hairline)',
                borderRadius: '6px',
                cursor: 'pointer',
                backgroundColor: model === opt.value ? 'var(--sage-50)' : 'white',
              }}
            >
              <input
                type="radio"
                name="model"
                value={opt.value}
                checked={model === opt.value}
                onChange={() => onModelChange(opt.value)}
                style={{ marginTop: '4px' }}
              />
              <div>
                <div style={{ fontWeight: '600', fontSize: '13px' }}>{opt.label}</div>
                <div style={{ fontSize: '12px', color: '#6b7280' }}>{opt.description}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label style={{ display: 'block', fontWeight: '600', marginBottom: '8px', fontSize: '13px' }}>Claude API Key</label>
        {hasExistingKey && !replacingKey ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px', color: 'var(--text-body)' }}>🔒 API key is set.</span>
            <button
              onClick={onReplaceKey}
              style={{
                padding: '6px 12px', border: 'var(--border-control)', borderRadius: 'var(--radius-md)',
                background: 'white', cursor: 'pointer', fontSize: '13px',
              }}
            >
              Replace…
            </button>
            {onClearKey && (
              <button
                onClick={() => { onClearKey(); onApiKeyChange(''); }}
                style={{
                  padding: '6px 12px',
                  background: 'var(--status-behind-bg)',
                  color: 'var(--status-behind)',
                  border: '1px solid var(--red-300)',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '13px',
                }}
              >
                Clear stored key
              </button>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => onApiKeyChange(e.target.value)}
              placeholder={hasExistingKey ? 'Enter a new key' : 'sk-ant-...'}
              autoComplete="off"
              style={{
                flex: 1,
                padding: '8px 12px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                fontSize: '13px',
                fontFamily: 'monospace',
              }}
            />
            <button
              onClick={() => onShowKeyChange(!showKey)}
              style={{
                padding: '8px 12px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                background: 'white',
                cursor: 'pointer',
                fontSize: '13px',
              }}
            >
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
        )}
        {unlockError && (
          <p style={{ fontSize: '12px', color: 'var(--status-behind)', marginTop: '6px' }}>{unlockError}</p>
        )}
        <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '6px' }}>
          Your key is sent per-request via header and never stored on the server.
        </p>
      </div>
    </SettingsSection>
  );
}

// Add / rename / retire the cancellation reason codes offered in the cancel
// dialog. Retiring keeps a code resolvable for historical records but hides it
// from new cancellations; the stable `value` id is never changed once created
// (renaming edits only the human label) so existing records keep resolving.
function CancellationCodesEditor({ codes, onChange }: {
  codes: CancellationCode[];
  onChange: (next: CancellationCode[]) => void;
}) {
  const [newLabel, setNewLabel] = useState('');

  const update = (idx: number, patch: Partial<CancellationCode>) =>
    onChange(codes.map((c, i) => (i === idx ? { ...c, ...patch } : c)));

  const toggleRetired = (idx: number) =>
    update(idx, { retired: !codes[idx].retired });

  const addCode = () => {
    const label = newLabel.trim();
    if (!label) return;
    const base = slugifyCancellationCode(label) || 'code';
    // Keep the value id unique even if two labels slugify the same.
    let value = base;
    let n = 2;
    const taken = new Set(codes.map(c => c.value));
    while (taken.has(value)) value = `${base}_${n++}`;
    onChange([...codes, { value, label }]);
    setNewLabel('');
  };

  return (
    <div style={{ display: 'grid', gap: '8px' }}>
      {codes.length > 0 && (
        <div style={{ display: 'flex', gap: '6px', fontSize: '11px', color: '#6b7280', fontWeight: 600 }}>
          <div style={{ flex: 2, minWidth: 0 }}>Label</div>
          <div style={{ flex: 1, minWidth: 0 }}>Code</div>
          <div style={{ width: '76px', flexShrink: 0 }} />
        </div>
      )}
      {codes.map((c, idx) => (
        <div key={c.value} style={{ display: 'flex', gap: '6px', alignItems: 'center', opacity: c.retired ? 0.55 : 1 }}>
          <input
            value={c.label}
            onChange={e => update(idx, { label: e.target.value })}
            placeholder="Label"
            style={{ ...inputStyle, flex: 2, width: 'auto', minWidth: 0 }}
          />
          <code style={{ flex: 1, minWidth: 0, fontSize: '12px', color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {c.value}{c.retired ? ' · retired' : ''}
          </code>
          <button
            onClick={() => toggleRetired(idx)}
            title={c.retired ? 'Restore — offer this code again' : 'Retire — hide from new cancellations, keep history'}
            style={{
              width: '76px', flexShrink: 0, padding: '6px 8px', fontSize: '12px', cursor: 'pointer',
              borderRadius: 4, border: '1px solid #d1d5db',
              background: c.retired ? 'var(--green-50)' : 'var(--surface-card)', color: c.retired ? 'var(--status-met)' : 'var(--status-pace)',
            }}
          >{c.retired ? 'Restore' : 'Retire'}</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '4px' }}>
        <input
          value={newLabel}
          onChange={e => setNewLabel(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCode(); } }}
          placeholder="New reason label (e.g. Transportation)"
          style={{ ...inputStyle, flex: 1, width: 'auto', minWidth: 0 }}
        />
        <button
          onClick={addCode}
          disabled={!newLabel.trim()}
          style={{
            flexShrink: 0, padding: '8px 12px', fontSize: '13px', fontWeight: 600,
            borderRadius: 6, border: 'none', cursor: newLabel.trim() ? 'pointer' : 'not-allowed',
            background: newLabel.trim() ? 'var(--brand-primary)' : 'var(--border-default)', color: newLabel.trim() ? 'var(--brand-primary-text)' : 'var(--text-faint)',
          }}
        >+ Add</button>
      </div>
      <p style={{ fontSize: '11px', color: 'var(--text-faint)', margin: '2px 0 0' }}>
        Retiring keeps a code on past cancellations but removes it from the cancel
        picker. Renaming changes only the label. Changes save with “Save settings”.
      </p>
    </div>
  );
}

function NumField({ label, value, onChange, suffix, hint, placeholder, defaultValue }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
  hint?: string;
  placeholder?: string;
  defaultValue?: number;
}) {
  const handleBlur = () => {
    if (defaultValue !== undefined && value.trim() === '') onChange(String(defaultValue));
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-body)' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <input
          type="number" step="0.5" min="0" inputMode="decimal"
          value={value} onChange={e => onChange(e.target.value)} onBlur={handleBlur}
          placeholder={placeholder ?? (defaultValue !== undefined ? String(defaultValue) : undefined)}
          style={{ ...inputStyle, width: '120px' }}
        />
        {suffix && <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{suffix}</span>}
      </div>
      {hint && <span style={{ fontSize: '11px', color: 'var(--text-faint)' }}>{hint}</span>}
    </div>
  );
}

// A lead time before the auth end date: a number plus a days/weeks unit.
function LeadField({ label, value, unit, onChangeValue, onChangeUnit }: {
  label: string;
  value: string;
  unit: 'days' | 'weeks';
  onChangeValue: (v: string) => void;
  onChangeUnit: (u: 'days' | 'weeks') => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-body)' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <input
          type="number" step="1" min="0" inputMode="decimal"
          value={value} onChange={e => onChangeValue(e.target.value)}
          style={{ ...inputStyle, width: '80px' }}
        />
        <select value={unit} onChange={e => onChangeUnit(e.target.value as 'days' | 'weeks')} style={{ ...inputStyle, width: 'auto' }}>
          <option value="weeks">weeks</option>
          <option value="days">days</option>
        </select>
        <span style={{ fontSize: '12px', color: '#6b7280' }}>before auth end</span>
      </div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  backgroundColor: 'var(--surface-sunken)',
  border: 'var(--border-hairline)',
  borderRadius: 'var(--radius-lg)',
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
  backgroundColor: 'var(--brand-primary)',
  color: 'var(--brand-primary-text)',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
  fontSize: '13px',
};

const dangerBtn: React.CSSProperties = {
  padding: '6px 10px',
  backgroundColor: 'var(--status-behind-bg)',
  color: 'var(--status-behind)',
  border: '1px solid var(--red-300)',
  borderRadius: 'var(--radius-sm)',
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
  color: 'var(--text-body)',
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
