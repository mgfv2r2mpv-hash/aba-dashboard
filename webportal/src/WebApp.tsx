import React, { useCallback, useEffect, useRef, useState } from 'react';
import { isEncryptedSchedule } from '@shared/clientCrypto';
import { ScheduleData, Appointment } from '@shared/types';
import { ComplianceCache } from '@shared/complianceCache';
import Calendar from '@shared/components/Calendar';
import ComplianceDashboard from '@shared/components/ComplianceDashboard';
import CaseloadView from '@shared/components/CaseloadView';
import AgendaRail from '@shared/components/AgendaRail';
import { useMinWidth } from '@shared/useMediaQuery';
import { format } from 'date-fns';
import UploadZone from './UploadZone';
import type { WorkerResponse } from './parse.worker';

type Phase = 'upload' | 'password' | 'decrypting' | 'ready';
type Tab = 'calendar' | 'compliance' | 'caseload';

const NOOP = () => {};

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'calendar',   label: 'Calendar',   icon: '📅' },
  { id: 'compliance', label: 'Compliance',  icon: '📊' },
  { id: 'caseload',   label: 'Caseload',    icon: '👥' },
];

// ─── Appointment detail sheet ────────────────────────────────────────────────

function ApptDetail({ appt, onClose }: { appt: Appointment; onClose: () => void }) {
  const start = new Date(appt.startTime);
  const end   = new Date(appt.endTime);
  const dur   = Math.round((end.getTime() - start.getTime()) / 60000);
  const rows: [string, string | undefined][] = [
    ['Date',        format(start, 'EEEE, MMMM d, yyyy')],
    ['Time',        `${format(start, 'h:mm a')} – ${format(end, 'h:mm a')} (${dur} min)`],
    ['Type',        appt.type],
    ['Client',      appt.client],
    ['Technician',  appt.technician],
    ['Description', appt.description],
    appt.status === 'canceled' && appt.cancellationReason
      ? ['Reason', appt.cancellationReason]
      : undefined,
    appt.isRecurring ? ['Recurring', appt.recurringPattern ?? 'Yes'] : undefined,
  ].filter((r): r is [string, string | undefined] => !!r);

  const badgeCls = `appt-status-badge ${appt.status}`;

  // Trap focus & close on Escape
  const overlayRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      ref={overlayRef}
      className="appt-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="appt-title"
      onClick={e => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className="appt-sheet">
        <div className="appt-sheet-handle" aria-hidden="true" />
        <div className="appt-sheet-hd">
          <div>
            <div className="appt-sheet-title" id="appt-title">{appt.title}</div>
            <span className={badgeCls} style={{ marginTop: 4, display: 'inline-block' }}>
              {appt.status}
            </span>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="appt-detail-grid">
          {rows.map(([key, val]) =>
            val ? (
              <div className="appt-detail-row" key={key}>
                <span className="appt-detail-key">{key}</span>
                <span className="appt-detail-val">{val}</span>
              </div>
            ) : null
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Ready view (tabs + content) ─────────────────────────────────────────────

function ReadyView({
  scheduleData,
  compCache,
  onReset,
}: {
  scheduleData: ScheduleData;
  compCache: ComplianceCache;
  onReset: () => void;
}) {
  const [tab, setTab] = useState<Tab>('calendar');
  const [calDate, setCalDate] = useState(new Date());
  const [selectedAppt, setSelectedAppt] = useState<Appointment | null>(null);
  const isDesktop = useMinWidth(1024);
  const isTablet  = useMinWidth(640);

  const handleSelectAppt = useCallback((a: Appointment | null) => setSelectedAppt(a), []);

  const showRail = isDesktop && tab === 'calendar';

  return (
    <div className="portal">
      {/* ── Header ── */}
      <header className="portal-header">
        <span className="portal-wordmark">ABA <span>Portal</span></span>
        <span className="portal-spacer" />

        {/* Desktop: inline tabs */}
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
      </header>

      {/* ── Body ── */}
      <div className={`portal-body${showRail ? ' two-pane' : ''}`}>

        {/* Desktop agenda rail (Calendar tab only) */}
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
              onAppointmentChange={NOOP}
              onSelectAppointment={handleSelectAppt}
              onViewDateChange={setCalDate}
            />
          )}
          {tab === 'compliance' && (
            <ComplianceDashboard
              data={scheduleData}
              cache={compCache}
              onMarkComplete={NOOP}
              onRequestCancel={NOOP}
              onSelectAppointment={handleSelectAppt}
            />
          )}
          {tab === 'caseload' && (
            <CaseloadView data={scheduleData} />
          )}
        </main>
      </div>

      {/* ── Mobile bottom nav ── */}
      {!isTablet && (
        <nav className="bottom-nav" aria-label="Views">
          {TABS.map(t => (
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

      {/* Appointment detail sheet */}
      {selectedAppt && (
        <ApptDetail appt={selectedAppt} onClose={() => setSelectedAppt(null)} />
      )}
    </div>
  );
}

// ─── Password form ────────────────────────────────────────────────────────────

function PasswordForm({
  onSubmit,
  onCancel,
  error,
  isLoading,
}: {
  onSubmit: (pwd: string) => void;
  onCancel: () => void;
  error: string | null;
  isLoading: boolean;
}) {
  const [pwd, setPwd] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  return (
    <div className="portal centered-screen">
      <form
        className="password-card"
        onSubmit={e => { e.preventDefault(); if (pwd) onSubmit(pwd); }}
        noValidate
      >
        <h2>Enter Schedule Password</h2>
        <p>
          Enter the password you set when exporting this file from the ABA Dashboard app.
          It never leaves your device.
        </p>

        {/* Hidden username field for password manager AutoFill */}
        <input
          type="text" name="username" value="aba-schedule"
          autoComplete="username" readOnly tabIndex={-1}
          className="sr-only" aria-hidden="true"
        />

        <label htmlFor="pwd" className="form-label">Schedule password</label>
        <input
          ref={inputRef}
          id="pwd"
          type="password"
          name="schedule-password"
          autoComplete="current-password"
          value={pwd}
          onChange={e => { setPwd(e.target.value); }}
          placeholder="Password"
          className={`form-input${error ? ' has-error' : ''}`}
          aria-describedby={error ? 'pwd-error' : undefined}
          aria-invalid={!!error}
          disabled={isLoading}
        />

        <div id="pwd-error" className="form-error" role="alert" aria-live="polite">
          {error ?? ''}
        </div>

        <div className="form-actions">
          <button type="button" className="btn-ghost" onClick={onCancel} disabled={isLoading}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={!pwd || isLoading}>
            {isLoading ? 'Decrypting…' : 'Open'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function WebApp() {
  const [phase, setPhase] = useState<Phase>('upload');
  const [fileBytes, setFileBytes] = useState<Uint8Array | null>(null);
  const [scheduleData, setScheduleData] = useState<ScheduleData | null>(null);
  const [compCache, setCompCache] = useState<ComplianceCache | null>(null);
  const [uploadError, setUploadError]   = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const workerRef = useRef<Worker | null>(null);

  const getWorker = useCallback(() => {
    if (!workerRef.current) {
      workerRef.current = new Worker(new URL('./parse.worker.ts', import.meta.url), { type: 'module' });
    }
    return workerRef.current;
  }, []);

  const handleFile = useCallback(async (file: File) => {
    setUploadError(null);
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      setUploadError('Could not read the file. Please try again.');
      return;
    }
    if (!isEncryptedSchedule(bytes)) {
      setUploadError(
        'This file is not encrypted. Export from the ABA Dashboard app with a schedule password, then try again.'
      );
      return;
    }
    setFileBytes(bytes);
    setPasswordError(null);
    setPhase('password');
  }, []);

  const handlePasswordSubmit = useCallback((password: string) => {
    if (!fileBytes) return;
    setPhase('decrypting');
    setPasswordError(null);

    const worker = getWorker();

    const onMessage = (e: MessageEvent<WorkerResponse>) => {
      worker.removeEventListener('message', onMessage);
      const res = e.data;
      if (res.ok) {
        setScheduleData(res.data);
        setCompCache(res.cache);
        setPhase('ready');
      } else if (res.isDOMException) {
        setPasswordError('Incorrect password. Please try again.');
        setPhase('password');
      } else {
        setUploadError(`Failed to parse schedule: ${res.message}`);
        setFileBytes(null);
        setPhase('upload');
      }
    };

    worker.addEventListener('message', onMessage);
    worker.postMessage({ bytes: fileBytes, password });
  }, [fileBytes, getWorker]);

  const reset = useCallback(() => {
    setPhase('upload');
    setFileBytes(null);
    setScheduleData(null);
    setCompCache(null);
    setUploadError(null);
    setPasswordError(null);
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  if (phase === 'ready' && scheduleData && compCache) {
    return <ReadyView scheduleData={scheduleData} compCache={compCache} onReset={reset} />;
  }

  if (phase === 'decrypting') {
    return (
      <div className="portal centered-screen">
        <div className="spinner-wrap">
          <div className="spinner" aria-hidden="true" />
          <p className="spinner-label">Decrypting and loading schedule…</p>
        </div>
      </div>
    );
  }

  if (phase === 'password') {
    return (
      <PasswordForm
        onSubmit={handlePasswordSubmit}
        onCancel={reset}
        error={passwordError}
        isLoading={false}
      />
    );
  }

  // Upload phase
  return (
    <div className="portal">
      <UploadZone onFile={handleFile} error={uploadError} />
    </div>
  );
}
