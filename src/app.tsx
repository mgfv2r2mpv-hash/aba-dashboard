import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { ScheduleData, Appointment, ScheduleConflict, ScheduleSolution } from './types';
import Calendar from './components/Calendar';
import ConflictPanel from './components/ConflictPanel';
import SolutionPanel from './components/SolutionPanel';
import AdminPanel from './components/AdminPanel';
import FileUpload from './components/FileUpload';

const API_BASE = 'http://localhost:5000/api';

export default function App() {
  const [scheduleData, setScheduleData] = useState<ScheduleData | null>(null);
  const [conflicts, setConflicts] = useState<ScheduleConflict[]>([]);
  const [solutions, setSolutions] = useState<ScheduleSolution[]>([]);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [showAdmin, setShowAdmin] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleFileUpload = async (file: File) => {
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await axios.post(`${API_BASE}/upload`, file, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
      });

      setScheduleData(response.data.data);
      setConflicts(response.data.conflicts);
      setSolutions([]);
    } catch (error: any) {
      alert('Error uploading file: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAppointmentChange = async (appointment: Appointment) => {
    setLoading(true);
    try {
      const response = await axios.post(`${API_BASE}/appointment/${appointment.id}`, appointment);
      setSelectedAppointment(response.data.appointment);
      setConflicts(response.data.conflicts);
      setSolutions(response.data.solutions || []);

      // Update local data
      if (scheduleData) {
        const updated = { ...scheduleData };
        const idx = updated.appointments.findIndex(a => a.id === appointment.id);
        if (idx >= 0) {
          updated.appointments[idx] = response.data.appointment;
        }
        setScheduleData(updated);
      }
    } catch (error: any) {
      alert('Error updating appointment: ' + error.message);
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
      alert('Error applying solution: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    try {
      const response = await axios.get(`${API_BASE}/download`, {
        responseType: 'blob',
      });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'schedule.xlsx');
      document.body.appendChild(link);
      link.click();
      link.parentElement?.removeChild(link);
    } catch (error: any) {
      alert('Error downloading file: ' + error.message);
    }
  };

  return (
    <div style={{ display: 'flex', height: '100vh', flexDirection: 'column' }}>
      {/* Header */}
      <header style={{
        backgroundColor: '#1f2937',
        color: 'white',
        padding: '16px 24px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ fontSize: '24px', fontWeight: 'bold' }}>ABA Schedule Assistant</h1>
          <div style={{ display: 'flex', gap: '12px' }}>
            {!scheduleData ? (
              <FileUpload onUpload={handleFileUpload} loading={loading} />
            ) : (
              <>
                <button
                  onClick={() => setShowAdmin(!showAdmin)}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#6366f1',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                  }}
                >
                  {showAdmin ? 'Schedule' : 'Admin'}
                </button>
                <button
                  onClick={handleDownload}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: '#10b981',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                  }}
                >
                  Download
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {scheduleData ? (
          <>
            {!showAdmin ? (
              <>
                <div style={{ flex: 1, overflow: 'auto' }}>
                  <Calendar
                    appointments={scheduleData.appointments}
                    technicians={scheduleData.technicians}
                    clients={scheduleData.clients}
                    onAppointmentChange={handleAppointmentChange}
                    onSelectAppointment={setSelectedAppointment}
                  />
                </div>
                <div style={{ width: '350px', borderLeft: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column' }}>
                  {conflicts.length > 0 && (
                    <ConflictPanel conflicts={conflicts} />
                  )}
                  {solutions.length > 0 && (
                    <SolutionPanel solutions={solutions} onApply={handleApplySolution} />
                  )}
                  {selectedAppointment && (
                    <div style={{ padding: '16px', borderTop: '1px solid #e5e7eb' }}>
                      <h3 style={{ marginBottom: '12px' }}>Selected Appointment</h3>
                      <p><strong>{selectedAppointment.title}</strong></p>
                      <p>{selectedAppointment.startTime}</p>
                      {selectedAppointment.isFixed && <span style={{ color: '#dc2626' }}>🔒 Fixed</span>}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <AdminPanel data={scheduleData} />
            )}
          </>
        ) : (
          <div style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#9ca3af',
          }}>
            <div style={{ textAlign: 'center' }}>
              <p>Upload an Excel file to get started</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
