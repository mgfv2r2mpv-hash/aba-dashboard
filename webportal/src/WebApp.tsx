import React, { useState, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import { isEncryptedSchedule, decryptBytes } from '@shared/clientCrypto';
import { parseWorkbook } from '@shared/excelHandler';
import { buildCache } from '@shared/complianceCache';
import { ScheduleData } from '@shared/types';
import { ComplianceCache } from '@shared/complianceCache';
import Calendar from '@shared/components/Calendar';
import ComplianceDashboard from '@shared/components/ComplianceDashboard';
import CaseloadView from '@shared/components/CaseloadView';
import UploadZone from './UploadZone';

type Phase = 'upload' | 'password' | 'decrypting' | 'ready';
type Tab = 'calendar' | 'compliance' | 'caseload';

const NOOP = () => {};

export default function WebApp() {
  const [phase, setPhase] = useState<Phase>('upload');
  const [fileBytes, setFileBytes] = useState<Uint8Array | null>(null);
  const [scheduleData, setScheduleData] = useState<ScheduleData | null>(null);
  const [compCache, setCompCache] = useState<ComplianceCache | null>(null);
  const [tab, setTab] = useState<Tab>('calendar');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const passwordInputRef = useRef<HTMLInputElement>(null);

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
        'This file is not encrypted. Export from the ABA Dashboard app with a schedule password set, then try again.'
      );
      return;
    }
    setFileBytes(bytes);
    setPasswordError(null);
    setPassword('');
    setPhase('password');
    setTimeout(() => passwordInputRef.current?.focus(), 50);
  }, []);

  const handlePasswordSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fileBytes || !password) return;
    setPhase('decrypting');
    try {
      const plain = await decryptBytes(fileBytes, password);
      const wb = XLSX.read(plain, { type: 'array' });
      const { data } = parseWorkbook(wb);
      const cache = buildCache(data);
      setScheduleData(data);
      setCompCache(cache);
      setPhase('ready');
    } catch (err) {
      if (err instanceof DOMException) {
        setPasswordError('Incorrect password. Please try again.');
        setPhase('password');
        setTimeout(() => passwordInputRef.current?.focus(), 50);
      } else {
        setUploadError(
          `Failed to load schedule: ${err instanceof Error ? err.message : String(err)}`
        );
        setPhase('upload');
        setFileBytes(null);
      }
    }
  }, [fileBytes, password]);

  const reset = useCallback(() => {
    setPhase('upload');
    setFileBytes(null);
    setScheduleData(null);
    setCompCache(null);
    setUploadError(null);
    setPasswordError(null);
    setPassword('');
  }, []);

  if (phase === 'ready' && scheduleData) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        <header style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 16px', backgroundColor: 'white',
          borderBottom: '1px solid #e5e7eb', gap: 12, flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['calendar', 'compliance', 'caseload'] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
                  fontSize: 13, fontWeight: 500,
                  backgroundColor: tab === t ? '#3b82f6' : '#f3f4f6',
                  color: tab === t ? 'white' : '#374151',
                }}
              >
                {t === 'calendar' ? 'Calendar' : t === 'compliance' ? 'Compliance' : 'Caseload'}
              </button>
            ))}
          </div>
          <button
            onClick={reset}
            style={{
              padding: '6px 12px', border: '1px solid #d1d5db', borderRadius: 6,
              background: 'white', cursor: 'pointer', fontSize: 12, color: '#6b7280',
            }}
          >
            Close file
          </button>
        </header>

        <main style={{ flex: 1, overflow: 'auto' }}>
          {tab === 'calendar' && (
            <Calendar
              appointments={scheduleData.appointments}
              technicians={scheduleData.technicians}
              clients={scheduleData.clients}
              settings={scheduleData.settings}
              onAppointmentChange={NOOP}
              onSelectAppointment={NOOP}
            />
          )}
          {tab === 'compliance' && (
            <ComplianceDashboard
              data={scheduleData}
              cache={compCache}
              onMarkComplete={NOOP}
              onRequestCancel={NOOP}
              onSelectAppointment={NOOP}
            />
          )}
          {tab === 'caseload' && (
            <CaseloadView data={scheduleData} />
          )}
        </main>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div style={{ marginBottom: 40, textAlign: 'center' }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827' }}>ABA Dashboard Portal</h1>
        <p style={{ fontSize: 13, color: '#6b7280', marginTop: 6 }}>Read-only view • Encrypted files only</p>
      </div>

      {phase === 'upload' && (
        <UploadZone onFile={handleFile} error={uploadError} />
      )}

      {phase === 'password' && (
        <form
          onSubmit={handlePasswordSubmit}
          style={{
            backgroundColor: 'white', borderRadius: 10, padding: 28,
            width: '100%', maxWidth: 400, boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
          }}
        >
          <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Enter Schedule Password</h2>
          <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16, lineHeight: 1.5 }}>
            Enter the password you set when exporting this file from the ABA Dashboard app.
          </p>

          {/* Hidden username for password manager association */}
          <input
            type="text"
            name="username"
            value="aba-schedule"
            autoComplete="username"
            readOnly
            tabIndex={-1}
            style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
          />

          <input
            ref={passwordInputRef}
            type="password"
            name="schedule-password"
            autoComplete="current-password"
            value={password}
            onChange={e => { setPassword(e.target.value); setPasswordError(null); }}
            placeholder="Schedule password"
            style={{
              width: '100%', padding: '10px 12px', fontSize: 15,
              border: `1px solid ${passwordError ? '#f87171' : '#d1d5db'}`,
              borderRadius: 6, boxSizing: 'border-box',
            }}
          />

          {passwordError && (
            <p style={{ fontSize: 12, color: '#dc2626', marginTop: 6 }}>{passwordError}</p>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
            <button
              type="button"
              onClick={reset}
              style={{
                padding: '8px 16px', border: '1px solid #d1d5db',
                borderRadius: 6, background: 'white', cursor: 'pointer', fontSize: 13,
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!password}
              style={{
                padding: '8px 16px', borderRadius: 6, border: 'none', fontSize: 13,
                backgroundColor: password ? '#3b82f6' : '#93c5fd',
                color: 'white', cursor: password ? 'pointer' : 'default',
              }}
            >
              Open
            </button>
          </div>
        </form>
      )}

      {phase === 'decrypting' && (
        <div style={{ textAlign: 'center', color: '#6b7280', fontSize: 14 }}>
          Decrypting and loading schedule…
        </div>
      )}
    </div>
  );
}
