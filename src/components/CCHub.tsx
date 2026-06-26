import { useState } from 'react';
import { Appointment, ScheduleData, ScheduleConflict, WishSolution } from '../types';
import { ComplianceCache } from '../complianceCache';
import { AISettings } from './Settings';
import { AdminPersist } from './AdminPanel';
import AdminPanel from './AdminPanel';
import ComplianceDashboard from './ComplianceDashboard';
import CaseloadView from './CaseloadView';
import CCSettingsPopup from './CCSettingsPopup';

// Consolidated "C&C" hub — the single home for compliance & cases. Replaces the
// old "Fix" tab. Home is the cases summary (CaseloadView for now; CasesHome in
// Phase 2). Roster (clients/technicians) and auths are mounted here by scoping
// AdminPanel to a single section, pulling them out of the ⚙️ Admin view.
type HubTab = 'cases' | 'issues' | 'clients' | 'technicians' | 'auths';

interface Props {
  data: ScheduleData;
  onDataChange: (data: ScheduleData) => void;
  persist?: AdminPersist;
  now: Date;
  // Compliance/issues wiring (threaded straight to ComplianceDashboard).
  cache?: ComplianceCache | null;
  conflicts?: ScheduleConflict[];
  conflictCount?: number;
  aiSettings?: AISettings;
  mutedConflictKeys?: string[];
  onMuteConflict?: (key: string) => void;
  onUnmuteConflict?: (key: string) => void;
  onConfirmDismissConflict?: (key: string) => void;
  onMarkComplete: (a: Appointment) => void;
  onRequestCancel: (a: Appointment) => void;
  onSelectAppointment: (a: Appointment) => void;
  onAcceptFix?: (sol: WishSolution) => void | Promise<void>;
  onCustomizeFix?: (sol: WishSolution) => void;
  // Jump to Admin's editable C&C settings tab (from the view-only popup).
  onOpenAdminCandC: () => void;
}

export default function CCHub(props: Props) {
  const { data, onDataChange, persist, now, conflictCount, onOpenAdminCandC } = props;
  const [tab, setTab] = useState<HubTab>('cases');
  const [showSettings, setShowSettings] = useState(false);

  const tabs: { key: HubTab; label: string; badge?: number }[] = [
    { key: 'cases', label: 'Cases' },
    { key: 'issues', label: 'Issues', badge: conflictCount },
    { key: 'clients', label: 'Clients' },
    { key: 'technicians', label: 'Technicians' },
    { key: 'auths', label: 'Auths' },
  ];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      {/* Sub-tab bar + settings gear */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px clamp(8px, 3vw, 24px)', borderBottom: 'var(--border-hairline)', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', background: '#f3f4f6', borderRadius: 6, padding: 2, gap: 2, flexWrap: 'wrap' }}>
          {tabs.map(t => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                style={{
                  padding: '5px 14px', border: 'none', borderRadius: 5, cursor: 'pointer',
                  fontSize: 13, fontWeight: 600,
                  background: active ? '#1d4ed8' : 'transparent',
                  color: active ? 'white' : '#374151',
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                }}
              >
                {t.label}
                {!!t.badge && t.badge > 0 && (
                  <span style={{
                    minWidth: 16, height: 16, padding: '0 4px', borderRadius: 8,
                    background: active ? 'rgba(255,255,255,0.3)' : '#ef4444', color: 'white',
                    fontSize: 10, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}>{t.badge}</span>
                )}
              </button>
            );
          })}
        </div>
        <button
          onClick={() => setShowSettings(true)}
          aria-label="C&C settings"
          title="C&C settings"
          style={{ marginLeft: 'auto', padding: '5px 10px', border: 'var(--border-hairline)', borderRadius: 6, background: 'white', cursor: 'pointer', fontSize: 14 }}
        >⚙️</button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', minWidth: 0 }}>
        {tab === 'cases' && (
          <CaseloadView data={data} now={now} />
        )}
        {tab === 'issues' && (
          <ComplianceDashboard
            data={data}
            cache={props.cache}
            conflicts={props.conflicts}
            aiSettings={props.aiSettings}
            mutedConflictKeys={props.mutedConflictKeys}
            onMuteConflict={props.onMuteConflict}
            onUnmuteConflict={props.onUnmuteConflict}
            onConfirmDismissConflict={props.onConfirmDismissConflict}
            onMarkComplete={props.onMarkComplete}
            onRequestCancel={props.onRequestCancel}
            onSelectAppointment={props.onSelectAppointment}
            onAcceptFix={props.onAcceptFix}
            onCustomizeFix={props.onCustomizeFix}
          />
        )}
        {tab === 'clients' && (
          <AdminPanel data={data} onDataChange={onDataChange} persist={persist} tabs={['clients']} />
        )}
        {tab === 'technicians' && (
          <AdminPanel data={data} onDataChange={onDataChange} persist={persist} tabs={['bts']} />
        )}
        {tab === 'auths' && (
          <AdminPanel data={data} onDataChange={onDataChange} persist={persist} tabs={['auths']} />
        )}
      </div>

      {showSettings && (
        <CCSettingsPopup
          settings={data.settings}
          onClose={() => setShowSettings(false)}
          onEdit={onOpenAdminCandC}
        />
      )}
    </div>
  );
}
