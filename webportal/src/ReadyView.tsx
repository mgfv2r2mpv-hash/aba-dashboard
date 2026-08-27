import React, { useCallback, useMemo, useState } from 'react';
import { ScheduleData, Appointment } from '@shared/types';
import { ComplianceCache } from '@shared/complianceCache';
import { ConstraintValidator } from '@shared/constraintValidator';
import Calendar from '@shared/components/Calendar';
import ComplianceDashboard from '@shared/components/ComplianceDashboard';
import CasesHome from '@shared/components/CasesHome';
import AgendaRail from '@shared/components/AgendaRail';
import AdminPanel from '@shared/components/AdminPanel';
import BuildPanel from './BuildPanel';
import { useMinWidth } from '@shared/useMediaQuery';
import ApptDetail from './ApptDetail';
import SaveBar from './SaveBar';
import LogoutLink from './LogoutLink';
import type { AiConfig } from './parse.worker';

export type Tab = 'calendar' | 'build' | 'compliance' | 'caseload' | 'admin' | 'settings';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'calendar',   label: 'Calendar',   icon: '📅' },
  { id: 'build',      label: 'Build',      icon: '🧱' },
  { id: 'compliance', label: 'Compliance',  icon: '📊' },
  { id: 'caseload',   label: 'Caseload',    icon: '👥' },
  { id: 'admin',      label: 'Admin',       icon: '⚙️' },
  { id: 'settings',   label: 'Settings',    icon: '🔑' },
];

const MOBILE_TABS = TABS.slice(0, 4);

export default function ReadyView({
  scheduleData,
  compCache,
  isDirty,
  isSaving,
  saveError,
  aiConfig,
  initialTab = 'calendar',
  onDataChange,
  onAiConfigChange,
  onSave,
  onReset,
}: {
  scheduleData: ScheduleData;
  compCache: ComplianceCache;
  isDirty: boolean;
  isSaving: boolean;
  saveError: string | null;
  aiConfig: AiConfig | null;
  /** Where to land. A schedule that just came out of setup opens on Build. */
  initialTab?: Tab;
  onDataChange: (next: ScheduleData) => void;
  onAiConfigChange: (next: AiConfig | null) => void;
  onSave: () => void;
  onReset: () => void;
}) {
  const apiKey = aiConfig?.apiKey || null;
  const [tab, setTab]             = useState<Tab>(initialTab);
  const [calDate, setCalDate]     = useState(new Date());
  const [selectedAppt, setSelectedAppt] = useState<Appointment | null>(null);
  const [apiKeyDraft, setApiKeyDraft]   = useState(apiKey ?? '');
  const [apiKeyMasked, setApiKeyMasked] = useState(!!apiKey);

  const isDesktop = useMinWidth(1024);
  const isTablet  = useMinWidth(640);
  const showRail  = isDesktop && tab === 'calendar';

  // The conflicts the Compliance tab reads. Recomputed against the viewed month,
  // the way the app does it - the portal used to pass an empty array, so every
  // conflict the validator found went unsaid.
  const conflicts = useMemo(
    () => new ConstraintValidator(scheduleData, calDate).validateSchedule(),
    [scheduleData, calDate],
  );

  const handleSelectAppt = useCallback((a: Appointment | null) => setSelectedAppt(a), []);

  const handleApptChange = useCallback((appt: Appointment) => {
    const appointments = scheduleData.appointments.map(a => a.id === appt.id ? appt : a);
    const next = { ...scheduleData, appointments };
    onDataChange({ ...next, settings: next.settings });
  }, [scheduleData, onDataChange]);

  const handleMarkComplete = useCallback((appt: Appointment) => {
    handleApptChange({ ...appt, status: 'completed' });
  }, [handleApptChange]);

  const handleRequestCancel = useCallback((appt: Appointment) => {
    const reason = window.prompt('Cancellation reason (optional):') ?? '';
    handleApptChange({
      ...appt,
      status: 'canceled',
      cancellation: {
        source: 'family',
        reason: reason || 'canceled',
        unplanned: false,
        canceledAt: new Date().toISOString(),
      },
    });
  }, [handleApptChange]);

  const handleAdminDataChange = useCallback((next: ScheduleData) => {
    onDataChange({ ...next });
  }, [onDataChange]);

  const handleSaveApiKey = () => {
    const trimmed = apiKeyDraft.trim();
    // Preserve the app's model/maps key across the round-trip; clearing the Claude
    // key keeps the rest only if there is still a maps key to carry, else drops config.
    onAiConfigChange(
      trimmed
        ? { apiKey: trimmed, model: aiConfig?.model ?? 'claude-sonnet-4-6', mapsApiKey: aiConfig?.mapsApiKey }
        : (aiConfig?.mapsApiKey ? { ...aiConfig, apiKey: '' } : null),
    );
    setApiKeyMasked(!!trimmed);
  };

  const handleReplaceApiKey = () => {
    setApiKeyDraft('');
    setApiKeyMasked(false);
  };

  return (
    <div className="portal">
      <SaveBar isDirty={isDirty} isSaving={isSaving} error={saveError} onSave={onSave} />

      {/* ── Header ── */}
      <header className="portal-header">
        <span className="portal-wordmark">ABA <span>Portal</span></span>
        <span className="portal-spacer" />

        {isTablet && (
          <nav className="portal-tabs" aria-label="Views">
            {TABS.map(t => (
              <button
                key={t.id}
                className={`portal-tab${tab === t.id ? ' active' : ''}`}
                onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? 'page' : undefined}
              >
                <span aria-hidden="true">{t.icon}</span>
                {t.label}
              </button>
            ))}
          </nav>
        )}

        <button className="btn-ghost" onClick={onReset} aria-label="Close file">
          ✕ Close
        </button>
        <LogoutLink />
      </header>

      {/* ── Body ── */}
      <div className={`portal-body${showRail ? ' two-pane' : ''}`}>

        {showRail && (
          <aside className="portal-rail" aria-label="Agenda">
            <div className="portal-rail-heading">Agenda</div>
            <AgendaRail
              appointments={scheduleData.appointments}
              date={calDate}
              onSelect={handleSelectAppt}
            />
          </aside>
        )}

        <main className="portal-main" id="main-content">
          {tab === 'calendar' && (
            <Calendar
              appointments={scheduleData.appointments}
              technicians={scheduleData.technicians}
              clients={scheduleData.clients}
              settings={scheduleData.settings}
              timeOff={scheduleData.timeOff}
              onAppointmentChange={handleApptChange}
              onSelectAppointment={handleSelectAppt}
              onViewDateChange={setCalDate}
            />
          )}

          {tab === 'compliance' && (
            <ComplianceDashboard
              data={scheduleData}
              cache={compCache}
              conflicts={conflicts}
              onMarkComplete={handleMarkComplete}
              onRequestCancel={handleRequestCancel}
              onSelectAppointment={handleSelectAppt}
            />
          )}

          {tab === 'build' && (
            <BuildPanel data={scheduleData} onApply={onDataChange} />
          )}

          {tab === 'caseload' && (
            <CasesHome data={scheduleData} />
          )}

          {tab === 'admin' && (
            <div className="portal-admin-wrap">
              <AdminPanel
                data={scheduleData}
                onDataChange={handleAdminDataChange}
              />
            </div>
          )}

          {tab === 'settings' && (
            <div className="portal-settings-wrap">
              <h2 className="settings-heading">Settings</h2>

              <section className="settings-section">
                <h3 className="settings-section-title">Claude API Key</h3>
                <p className="settings-section-desc">
                  Enables AI features (Fix It / Wish It) on the Compliance tab. The key is held in
                  memory and embedded (obfuscated) in the encrypted backup you download, so it
                  restores automatically the next time you open that file — here or in the app.
                </p>

                {apiKeyMasked ? (
                  <div className="api-key-set-row">
                    <span className="api-key-set-label">🔒 API key is set</span>
                    <button className="btn-ghost" onClick={handleReplaceApiKey}>Replace…</button>
                    <button className="btn-ghost danger" onClick={() => { onAiConfigChange(aiConfig?.mapsApiKey ? { ...aiConfig, apiKey: '' } : null); setApiKeyDraft(''); setApiKeyMasked(false); }}>
                      Clear
                    </button>
                  </div>
                ) : (
                  <div className="api-key-form">
                    <label htmlFor="api-key-input" className="form-label">
                      Anthropic API key
                    </label>
                    <input
                      id="api-key-input"
                      type="password"
                      autoComplete="off"
                      className="form-input"
                      placeholder="sk-ant-…"
                      value={apiKeyDraft}
                      onChange={e => setApiKeyDraft(e.target.value)}
                    />
                    <button
                      className="btn-primary"
                      onClick={handleSaveApiKey}
                      disabled={!apiKeyDraft.trim()}
                    >
                      Save key
                    </button>
                  </div>
                )}
              </section>

              <section className="settings-section settings-section--danger">
                <h3 className="settings-section-title">File</h3>
                <button className="btn-ghost danger" onClick={onReset}>
                  ✕ Close this file
                </button>
              </section>
            </div>
          )}
        </main>
      </div>

      {/* ── Mobile bottom nav ── */}
      {!isTablet && (
        <nav className="bottom-nav" aria-label="Views">
          {MOBILE_TABS.map(t => (
            <button
              key={t.id}
              className={`bottom-nav-btn${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? 'page' : undefined}
            >
              <span className="bottom-nav-icon" aria-hidden="true">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </nav>
      )}

      {selectedAppt && (
        <ApptDetail appt={selectedAppt} onClose={() => setSelectedAppt(null)} />
      )}
    </div>
  );
}
