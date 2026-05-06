import React, { useState, useEffect } from 'react';
import axios from 'axios';
import * as XLSX from 'xlsx';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { parseWorkbook } from './excelHandler';
import { ConstraintValidator } from './constraintValidator';
import { installNativeAdapter, setCurrentData as setNativeStore } from './nativeApi';
import { ScheduleData, Appointment, ScheduleConflict, ScheduleSolution, Cancellation } from './types';
import Calendar from './components/Calendar';
import ConflictPanel from './components/ConflictPanel';
import SolutionPanel from './components/SolutionPanel';
import AdminPanel from './components/AdminPanel';
import FileUpload from './components/FileUpload';
import Settings, { AISettings, ClaudeModel } from './components/Settings';
import AppointmentForm from './components/AppointmentForm';
import SetupWizard from './components/SetupWizard';
import CancellationDialog from './components/CancellationDialog';
import { encryptString, decryptString } from './clientCrypto';

// Route axios /api/* calls through an in-memory store on iOS/Android,
// since the Express server isn't reachable from inside the WebView.
if (Capacitor.isNativePlatform()) installNativeAdapter();

// Build stamp surfaced in the empty-state diagnostics banner so you can
// confirm the device is running this bundle and not a stale ios/App/App/public.
declare const __BUILD_TIME__: string;
const BUILD_STAMP = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : 'dev';

const API_BASE = '/api';

const SESSION_KEY = 'aba_ai_settings';

function loadSessionSettings(): AISettings {
  try {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (stored) return JSON.parse(stored);
  } catch (_e) { /* ignore */ }
  return { apiKey: '', model: 'claude-sonnet-4-6' };
}

function saveSessionSettings(settings: AISettings) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(settings));
  } catch (_e) { /* ignore */ }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      // Strip the "data:<mime>;base64," prefix that FileReader prepends.
      const comma = dataUrl.indexOf(',');
      resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
    };
    reader.readAsDataURL(blob);
  });
}

export default function App() {
  const [scheduleData, setScheduleData] = useState<ScheduleData | null>(null);
  const [conflicts, setConflicts] = useState<ScheduleConflict[]>([]);
  const [solutions, setSolutions] = useState<ScheduleSolution[]>([]);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [showAddAppointment, setShowAddAppointment] = useState(false);
  const [editingAppointment, setEditingAppointment] = useState<Appointment | null>(null);
  const [loading, setLoading] = useState(false);
  const [aiSettings, setAiSettings] = useState<AISettings>(loadSessionSettings);
  const [pendingEmbedBlob, setPendingEmbedBlob] = useState<string | undefined>(undefined);
  const [debugMsg, setDebugMsg] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Appointment | null>(null);
  const detailPanelRef = React.useRef<HTMLDivElement | null>(null);

  // On narrow screens the right-side detail panel wraps below the calendar.
  // When the user taps an appointment, scroll the detail into view so they
  // notice it actually opened.
  useEffect(() => {
    if (selectedAppointment && detailPanelRef.current) {
      detailPanelRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedAppointment]);

  const handleAISettingsSave = (settings: AISettings) => {
    setAiSettings(settings);
    saveSessionSettings(settings);
  };

  const handleClearKey = () => {
    const cleared = { ...aiSettings, apiKey: '' };
    setAiSettings(cleared);
    saveSessionSettings(cleared);
    setPendingEmbedBlob(undefined);
  };

  const handlePrepareEmbed = async (password: string) => {
    if (!aiSettings.apiKey) throw new Error('No API key set');
    const payload = JSON.stringify({ apiKey: aiSettings.apiKey, model: aiSettings.model });
    const blob = await encryptString(payload, password);
    setPendingEmbedBlob(blob);
  };

  const fetchSampleBlob = async (): Promise<Blob> => {
    const response = await fetch('sample_schedule.xlsx');
    if (!response.ok) throw new Error(`Sample fetch failed: ${response.status}`);
    return response.blob();
  };

  // On iOS/Android, drop the bundled sample into the app's Documents folder
  // on first launch so it shows up in the system file picker when the user
  // taps "Upload Schedule". No-op on web. Skips if already present.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let cancelled = false;
    (async () => {
      try {
        // Always overwrite: the bundled sample's appointment dates are
        // anchored to the build's current week, so a stale copy from a
        // previous launch would show as "no events this month".
        const blob = await fetchSampleBlob();
        const base64 = await blobToBase64(blob);
        if (cancelled) return;
        await Filesystem.writeFile({
          path: 'sample_schedule.xlsx',
          data: base64,
          directory: Directory.Documents,
        });
      } catch (e) {
        console.warn('Could not seed sample schedule:', e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const promptForEmbeddedKey = async (embeddedConfig: string) => {
    if (aiSettings.apiKey) return;
    const password = prompt('This file has an encrypted API key embedded. Enter the embed password to load it (or cancel to skip):');
    if (!password) return;
    try {
      const decrypted = await decryptString(embeddedConfig, password);
      const parsed = JSON.parse(decrypted) as { apiKey: string; model: ClaudeModel };
      const restored: AISettings = { apiKey: parsed.apiKey, model: parsed.model || 'claude-sonnet-4-6' };
      setAiSettings(restored);
      saveSessionSettings(restored);
      setPendingEmbedBlob(embeddedConfig);
    } catch (_e) {
      alert('Wrong password or corrupted blob - skipping embedded key.');
    }
  };

  const handleFileUpload = async (file: File) => {
    setLoading(true);
    try {
      if (Capacitor.isNativePlatform()) {
        // No server is reachable from inside the iOS/Android WebView, so do
        // the parse + validate entirely client-side, then prime the in-memory
        // store that nativeApi serves /api/* requests from.
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });
        const parsed = parseWorkbook(workbook);
        const conflicts = new ConstraintValidator(parsed.data).validateSchedule();
        setNativeStore(parsed.data);
        setScheduleData(parsed.data);
        setConflicts(conflicts);
        setSolutions([]);
        if (parsed.embeddedConfig) await promptForEmbeddedKey(parsed.embeddedConfig);
        return;
      }

      const response = await axios.post(`${API_BASE}/upload`, file, {
        headers: { 'Content-Type': 'application/octet-stream' },
      });
      setScheduleData(response.data.data);
      setConflicts(response.data.conflicts);
      setSolutions([]);
      if (response.data.embeddedConfig) await promptForEmbeddedKey(response.data.embeddedConfig);
    } catch (error: any) {
      const msg = error.response?.data?.error || error.message || String(error);
      console.error('[upload] failed', error);
      setDebugMsg(`Upload failed: ${msg}`);
      alert('Error uploading file: ' + msg);
    } finally {
      setLoading(false);
    }
  };

  const handleAppointmentChange = async (appointment: Appointment) => {
    setLoading(true);
    try {
      const headers: Record<string, string> = {};
      if (aiSettings.apiKey) headers['X-Claude-Api-Key'] = aiSettings.apiKey;
      if (aiSettings.model) headers['X-Claude-Model'] = aiSettings.model;

      const response = await axios.post(`${API_BASE}/appointment/${appointment.id}`, appointment, { headers });
      setSelectedAppointment(response.data.appointment);
      setConflicts(response.data.conflicts);
      setSolutions(response.data.solutions || []);

      if (response.data.claudeError) {
        console.warn('Claude error:', response.data.claudeError);
      }

      if (scheduleData) {
        const updated = { ...scheduleData };
        const idx = updated.appointments.findIndex(a => a.id === appointment.id);
        if (idx >= 0) {
          updated.appointments[idx] = response.data.appointment;
        }
        setScheduleData(updated);
      }
    } catch (error: any) {
      alert('Error updating appointment: ' + (error.response?.data?.error || error.message));
    } finally {
      setLoading(false);
    }
  };

  const persistAppointment = async (updated: Appointment) => {
    if (!scheduleData) return;
    try {
      await axios.post(`${API_BASE}/admin/appointment`, updated);
      const next: ScheduleData = {
        ...scheduleData,
        appointments: scheduleData.appointments.map(a => a.id === updated.id ? updated : a),
      };
      setScheduleData(next);
      setSelectedAppointment(updated);
      // Recompute conflicts so the side panel reflects the new lifecycle state
      // (canceled appointments are now excluded from compliance totals).
      setConflicts(new ConstraintValidator(next).validateSchedule());
    } catch (error: any) {
      const msg = error.response?.data?.error || error.message || String(error);
      setDebugMsg(`Update failed: ${msg}`);
      alert('Error updating appointment: ' + msg);
    }
  };

  const handleMarkComplete = (a: Appointment) =>
    persistAppointment({ ...a, status: 'completed', cancellation: undefined });

  const handleReopen = (a: Appointment) =>
    persistAppointment({ ...a, status: 'scheduled', cancellation: undefined });

  const handleConfirmCancel = (cancellation: Cancellation) => {
    if (!cancelTarget) return;
    persistAppointment({ ...cancelTarget, status: 'canceled', cancellation });
    setCancelTarget(null);
  };

  const handleApplySolution = async (solution: ScheduleSolution) => {
    setLoading(true);
    try {
      const response = await axios.post(`${API_BASE}/apply-solution`, {
        solutionId: solution.id,
        changes: solution.changes,
      });

      setScheduleData(response.data.data);
      setConflicts(response.data.conflicts);
      setSolutions([]);
      setSelectedAppointment(null);
    } catch (error: any) {
      alert('Error applying solution: ' + (error.response?.data?.error || error.message));
    } finally {
      setLoading(false);
    }
  };

  const handleAddAppointment = async (appointment: Appointment) => {
    try {
      await axios.post(`${API_BASE}/admin/appointment`, appointment);
      if (scheduleData) {
        const updated = { ...scheduleData };
        const idx = updated.appointments.findIndex(a => a.id === appointment.id);
        if (idx >= 0) {
          updated.appointments[idx] = appointment;
        } else {
          updated.appointments = [...updated.appointments, appointment];
        }
        setScheduleData(updated);
      }
      setShowAddAppointment(false);
      setEditingAppointment(null);
    } catch (error: any) {
      alert('Error saving appointment: ' + (error.response?.data?.error || error.message));
    }
  };

  const handleDeleteAppointment = async (id: string) => {
    if (!confirm('Delete this appointment?')) return;
    try {
      await axios.delete(`${API_BASE}/admin/appointment/${id}`);
      if (scheduleData) {
        setScheduleData({ ...scheduleData, appointments: scheduleData.appointments.filter(a => a.id !== id) });
      }
      setSelectedAppointment(null);
      setEditingAppointment(null);
    } catch (error: any) {
      alert('Error deleting appointment: ' + (error.response?.data?.error || error.message));
    }
  };

  const handleWizardComplete = async (data: ScheduleData) => {
    try {
      const response = await axios.post(`${API_BASE}/schedule`, data);
      setScheduleData(response.data.data);
      setConflicts(response.data.conflicts || []);
      setSolutions([]);
      setShowWizard(false);
      setDebugMsg(null);
    } catch (error: any) {
      const msg = error.response?.data?.error || error.message || String(error);
      console.error('[wizard] failed', error);
      setDebugMsg(`Wizard save failed: ${msg}`);
      alert('Error saving schedule: ' + msg);
    }
  };

  const handleDownload = async () => {
    try {
      const response = await axios.post(
        `${API_BASE}/download`,
        { embeddedConfig: pendingEmbedBlob },
        { responseType: 'blob' }
      );
      const blob = new Blob([response.data]);
      // Native /api/download bypasses the AES-CBC step (Node-only crypto), so
      // mark the file as plain so anyone receiving it doesn't try to decrypt.
      const filename = Capacitor.isNativePlatform() ? 'schedule.xlsx' : 'schedule.enc.xlsx';

      if (Capacitor.isNativePlatform()) {
        // iOS WKWebView ignores <a download>. Write the file to the app's
        // Cache directory and pop the iOS share sheet so the user can
        // Save to Files / AirDrop / email.
        const base64 = await blobToBase64(blob);
        const written = await Filesystem.writeFile({
          path: filename,
          data: base64,
          directory: Directory.Cache,
        });
        try {
          await Share.share({
            title: 'ABA Schedule',
            url: written.uri,
            dialogTitle: 'Save your schedule',
          });
        } catch (shareErr: any) {
          // User canceled the share sheet — not an error worth alerting on.
          if (!/cancel/i.test(shareErr?.message || '')) throw shareErr;
        }
      } else {
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', filename);
        document.body.appendChild(link);
        link.click();
        link.parentElement?.removeChild(link);
        window.URL.revokeObjectURL(url);
      }
    } catch (error: any) {
      alert('Error downloading file: ' + (error.message || error));
    }
  };

  const headerButton = (label: string, onClick: () => void, color: string) => (
    <button
      onClick={onClick}
      style={{
        padding: '8px 16px',
        backgroundColor: color,
        color: 'white',
        border: 'none',
        borderRadius: '6px',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ display: 'flex', height: '100vh', maxWidth: '100vw', overflowX: 'hidden', flexDirection: 'column' }}>
      <header style={{
        backgroundColor: '#1f2937',
        color: 'white',
        padding: '12px 16px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <h1 style={{ fontSize: '18px', fontWeight: 'bold' }}>ABA Schedule Assistant</h1>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            {/* AI status indicator */}
            <div style={{
              padding: '4px 10px',
              borderRadius: '12px',
              fontSize: '12px',
              backgroundColor: aiSettings.apiKey ? '#10b981' : '#6b7280',
            }}>
              {aiSettings.apiKey ? `AI: ${aiSettings.model.replace('claude-', '')}` : 'AI: Off'}
            </div>
            {headerButton('Settings', () => setShowSettings(true), '#374151')}
            {!scheduleData ? (
              <>
                {headerButton('Setup Wizard', () => setShowWizard(true), '#8b5cf6')}
                <FileUpload onUpload={handleFileUpload} loading={loading} />
              </>
            ) : (
              <>
                {headerButton('+ Appointment', () => setShowAddAppointment(true), '#3b82f6')}
                {headerButton(showAdmin ? 'Schedule' : 'Admin', () => setShowAdmin(!showAdmin), '#6366f1')}
                {headerButton('Download', handleDownload, '#10b981')}
              </>
            )}
          </div>
        </div>
      </header>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', flexWrap: 'wrap' }}>
        {scheduleData ? (
          <>
            {!showAdmin ? (
              <>
                <div style={{ flex: '1 1 320px', minWidth: 0, overflow: 'auto' }}>
                  <Calendar
                    appointments={scheduleData.appointments}
                    technicians={scheduleData.technicians}
                    clients={scheduleData.clients}
                    onAppointmentChange={handleAppointmentChange}
                    onSelectAppointment={setSelectedAppointment}
                  />
                </div>
                {(conflicts.length > 0 || solutions.length > 0 || selectedAppointment) && (
                  <div ref={detailPanelRef} style={{
                    flex: '0 0 auto',
                    width: 'min(350px, 100%)',
                    borderLeft: '1px solid #e5e7eb',
                    display: 'flex',
                    flexDirection: 'column',
                    overflowY: 'auto',
                  }}>
                    {conflicts.length > 0 && <ConflictPanel conflicts={conflicts} />}
                    {!aiSettings.apiKey && conflicts.length > 0 && (
                      <div style={{ padding: '12px', backgroundColor: '#fef3c7', fontSize: '12px', color: '#92400e' }}>
                        Add a Claude API key in Settings to get AI-powered solutions for these conflicts.
                      </div>
                    )}
                    {solutions.length > 0 && <SolutionPanel solutions={solutions} onApply={handleApplySolution} />}
                    {selectedAppointment && (() => {
                      const a = selectedAppointment;
                      const status = a.status || 'scheduled';
                      const statusColor = status === 'canceled' ? '#b91c1c' : status === 'completed' ? '#15803d' : '#374151';
                      const statusBg = status === 'canceled' ? '#fee2e2' : status === 'completed' ? '#dcfce7' : '#f3f4f6';
                      return (
                        <div style={{ padding: '16px', borderTop: '1px solid #e5e7eb' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', gap: 8 }}>
                            <h3 style={{ margin: 0 }}>Selected Appointment</h3>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{
                                fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
                                color: statusColor, backgroundColor: statusBg,
                                padding: '2px 8px', borderRadius: 10,
                              }}>{status}</span>
                              <button
                                onClick={() => setSelectedAppointment(null)}
                                aria-label="Close"
                                style={{
                                  background: 'none', border: 'none', color: '#6b7280',
                                  fontSize: 20, lineHeight: 1, cursor: 'pointer', padding: 4,
                                }}
                              >✕</button>
                            </div>
                          </div>
                          <p><strong>{a.title}</strong></p>
                          <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
                            {new Date(a.startTime).toLocaleString()} → {new Date(a.endTime).toLocaleString()}
                          </p>
                          {a.technician && (
                            <p style={{ fontSize: '12px', color: '#374151', marginTop: '4px' }}>
                              Tech: {a.technician}
                            </p>
                          )}
                          {a.isFixed && status === 'scheduled' && <p style={{ color: '#dc2626', marginTop: '4px' }}>🔒 Fixed</p>}
                          {a.cancellation && (
                            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6, lineHeight: 1.5 }}>
                              <div>Source: <strong>Cancel-{a.cancellation.source.toUpperCase()}</strong></div>
                              <div>Reason: <strong>{a.cancellation.reason.replace('_', ' ')}</strong></div>
                              <div>{a.cancellation.unplanned ? 'Unplanned' : 'Planned'} · notice met: <strong>{a.cancellation.noticeMet ? 'yes' : 'no'}</strong></div>
                              {a.cancellation.notes && <div>Notes: {a.cancellation.notes}</div>}
                            </div>
                          )}
                          <div style={{ display: 'flex', gap: '6px', marginTop: '12px', flexWrap: 'wrap' }}>
                            <button
                              onClick={() => setEditingAppointment(a)}
                              style={{
                                flex: '1 1 auto', padding: '6px 12px', backgroundColor: '#3b82f6', color: 'white',
                                border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px',
                              }}
                            >Edit</button>
                            {status === 'scheduled' && (
                              <>
                                <button
                                  onClick={() => handleMarkComplete(a)}
                                  style={{
                                    flex: '1 1 auto', padding: '6px 12px', backgroundColor: '#dcfce7', color: '#15803d',
                                    border: '1px solid #86efac', borderRadius: '4px', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
                                  }}
                                >✓ Complete</button>
                                <button
                                  onClick={() => setCancelTarget(a)}
                                  style={{
                                    flex: '1 1 auto', padding: '6px 12px', backgroundColor: '#fee2e2', color: '#b91c1c',
                                    border: '1px solid #fca5a5', borderRadius: '4px', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
                                  }}
                                >✕ Cancel</button>
                              </>
                            )}
                            {(status === 'completed' || status === 'canceled') && (
                              <button
                                onClick={() => handleReopen(a)}
                                style={{
                                  flex: '1 1 auto', padding: '6px 12px', backgroundColor: 'white', color: '#374151',
                                  border: '1px solid #d1d5db', borderRadius: '4px', cursor: 'pointer', fontSize: '13px',
                                }}
                              >Reopen</button>
                            )}
                            <button
                              onClick={() => handleDeleteAppointment(a.id)}
                              style={{
                                padding: '6px 12px', backgroundColor: 'white', color: '#6b7280',
                                border: '1px solid #d1d5db', borderRadius: '4px', cursor: 'pointer', fontSize: '13px',
                              }}
                            >Delete</button>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </>
            ) : (
              <AdminPanel data={scheduleData} onDataChange={setScheduleData} />
            )}
          </>
        ) : (
          <div style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#9ca3af',
            flexDirection: 'column',
            gap: '16px',
            padding: '0 24px',
            textAlign: 'center',
          }}>
            <p>Upload an Excel file or run the Setup Wizard to get started.</p>
            <p style={{ fontSize: '12px', maxWidth: '320px' }}>
              A sample schedule (<code>sample_schedule.xlsx</code>) is in this app's
              Documents folder — pick it from Files via Upload Schedule.
            </p>
            {debugMsg && (
              <p style={{ fontSize: '12px', color: '#b91c1c', maxWidth: '320px', backgroundColor: '#fee2e2', padding: '8px', borderRadius: '4px' }}>
                {debugMsg}
              </p>
            )}
            <p style={{ fontSize: '10px', color: '#d1d5db', fontFamily: 'monospace' }}>
              build {BUILD_STAMP} · native {String(Capacitor.isNativePlatform())}
            </p>
          </div>
        )}
      </div>

      {showSettings && (
        <Settings
          settings={aiSettings}
          onSave={handleAISettingsSave}
          onClose={() => setShowSettings(false)}
          onEmbedInExcel={handlePrepareEmbed}
          onClearKey={handleClearKey}
        />
      )}

      {showWizard && (
        <SetupWizard
          onComplete={handleWizardComplete}
          onCancel={() => setShowWizard(false)}
        />
      )}

      {cancelTarget && scheduleData && (
        <CancellationDialog
          appointment={cancelTarget}
          settings={scheduleData.settings}
          onConfirm={handleConfirmCancel}
          onCancel={() => setCancelTarget(null)}
        />
      )}

      {showAddAppointment && scheduleData && (
        <AppointmentForm
          technicians={scheduleData.technicians}
          clients={scheduleData.clients}
          onSave={handleAddAppointment}
          onCancel={() => setShowAddAppointment(false)}
        />
      )}

      {editingAppointment && scheduleData && (
        <AppointmentForm
          appointment={editingAppointment}
          technicians={scheduleData.technicians}
          clients={scheduleData.clients}
          onSave={handleAddAppointment}
          onCancel={() => setEditingAppointment(null)}
        />
      )}
    </div>
  );
}
