import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { ScheduleData, Appointment, ScheduleConflict, ScheduleSolution } from './types';
import Calendar from './components/Calendar';
import ConflictPanel from './components/ConflictPanel';
import SolutionPanel from './components/SolutionPanel';
import AdminPanel from './components/AdminPanel';
import FileUpload from './components/FileUpload';
import Settings, { AISettings, ClaudeModel } from './components/Settings';
import AppointmentForm from './components/AppointmentForm';
import SetupWizard from './components/SetupWizard';
import { encryptString, decryptString } from './clientCrypto';

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

  const handleFileUpload = async (file: File) => {
    setLoading(true);
    try {
      const response = await axios.post(`${API_BASE}/upload`, file, {
        headers: {
          'Content-Type': 'application/octet-stream',
        },
      });

      setScheduleData(response.data.data);
      setConflicts(response.data.conflicts);
      setSolutions([]);

      // If file has embedded config, prompt user for the embed password
      if (response.data.embeddedConfig && !aiSettings.apiKey) {
        const password = prompt('This file has an encrypted API key embedded. Enter the embed password to load it (or cancel to skip):');
        if (password) {
          try {
            const decrypted = await decryptString(response.data.embeddedConfig, password);
            const parsed = JSON.parse(decrypted) as { apiKey: string; model: ClaudeModel };
            const restored: AISettings = { apiKey: parsed.apiKey, model: parsed.model || 'claude-sonnet-4-6' };
            setAiSettings(restored);
            saveSessionSettings(restored);
            // Keep blob so a subsequent download re-embeds it (still encrypted with old password)
            setPendingEmbedBlob(response.data.embeddedConfig);
          } catch (_e) {
            alert('Wrong password or corrupted blob - skipping embedded key.');
          }
        }
      }
    } catch (error: any) {
      alert('Error uploading file: ' + (error.response?.data?.error || error.message));
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

  const handleWizardComplete = (data: ScheduleData) => {
    setScheduleData(data);
    setShowWizard(false);
  };

  const handleDownload = async () => {
    try {
      const response = await axios.post(
        `${API_BASE}/download`,
        { embeddedConfig: pendingEmbedBlob },
        { responseType: 'blob' }
      );

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'schedule.enc.xlsx');
      document.body.appendChild(link);
      link.click();
      link.parentElement?.removeChild(link);
    } catch (error: any) {
      alert('Error downloading file: ' + error.message);
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
    <div style={{ display: 'flex', height: '100vh', flexDirection: 'column' }}>
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
                  <div style={{
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
                    {selectedAppointment && (
                      <div style={{ padding: '16px', borderTop: '1px solid #e5e7eb' }}>
                        <h3 style={{ marginBottom: '12px' }}>Selected Appointment</h3>
                        <p><strong>{selectedAppointment.title}</strong></p>
                        <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
                          {new Date(selectedAppointment.startTime).toLocaleString()} →{' '}
                          {new Date(selectedAppointment.endTime).toLocaleString()}
                        </p>
                        {selectedAppointment.technician && (
                          <p style={{ fontSize: '12px', color: '#374151', marginTop: '4px' }}>
                            Tech: {selectedAppointment.technician}
                          </p>
                        )}
                        {selectedAppointment.isFixed && <p style={{ color: '#dc2626', marginTop: '4px' }}>🔒 Fixed</p>}
                        <div style={{ display: 'flex', gap: '6px', marginTop: '12px' }}>
                          <button
                            onClick={() => setEditingAppointment(selectedAppointment)}
                            style={{
                              flex: 1, padding: '6px 12px', backgroundColor: '#3b82f6', color: 'white',
                              border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px',
                            }}
                          >Edit</button>
                          <button
                            onClick={() => handleDeleteAppointment(selectedAppointment.id)}
                            style={{
                              padding: '6px 12px', backgroundColor: '#fee2e2', color: '#dc2626',
                              border: '1px solid #fca5a5', borderRadius: '4px', cursor: 'pointer', fontSize: '13px',
                            }}
                          >Delete</button>
                        </div>
                      </div>
                    )}
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
          }}>
            <p>Upload an Excel file or run the Setup Wizard to get started.</p>
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
