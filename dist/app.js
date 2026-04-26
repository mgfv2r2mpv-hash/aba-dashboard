import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import axios from 'axios';
import Calendar from './components/Calendar';
import ConflictPanel from './components/ConflictPanel';
import SolutionPanel from './components/SolutionPanel';
import AdminPanel from './components/AdminPanel';
import FileUpload from './components/FileUpload';
const API_BASE = 'http://localhost:5000/api';
export default function App() {
    const [scheduleData, setScheduleData] = useState(null);
    const [conflicts, setConflicts] = useState([]);
    const [solutions, setSolutions] = useState([]);
    const [selectedAppointment, setSelectedAppointment] = useState(null);
    const [showAdmin, setShowAdmin] = useState(false);
    const [loading, setLoading] = useState(false);
    const handleFileUpload = async (file) => {
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
        }
        catch (error) {
            alert('Error uploading file: ' + error.message);
        }
        finally {
            setLoading(false);
        }
    };
    const handleAppointmentChange = async (appointment) => {
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
        }
        catch (error) {
            alert('Error updating appointment: ' + error.message);
        }
        finally {
            setLoading(false);
        }
    };
    const handleApplySolution = async (solution) => {
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
        }
        catch (error) {
            alert('Error applying solution: ' + error.message);
        }
        finally {
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
        }
        catch (error) {
            alert('Error downloading file: ' + error.message);
        }
    };
    return (_jsxs("div", { style: { display: 'flex', height: '100vh', flexDirection: 'column' }, children: [_jsx("header", { style: {
                    backgroundColor: '#1f2937',
                    color: 'white',
                    padding: '16px 24px',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                }, children: _jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' }, children: [_jsx("h1", { style: { fontSize: '24px', fontWeight: 'bold' }, children: "ABA Schedule Assistant" }), _jsx("div", { style: { display: 'flex', gap: '12px' }, children: !scheduleData ? (_jsx(FileUpload, { onUpload: handleFileUpload, loading: loading })) : (_jsxs(_Fragment, { children: [_jsx("button", { onClick: () => setShowAdmin(!showAdmin), style: {
                                            padding: '8px 16px',
                                            backgroundColor: '#6366f1',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '6px',
                                            cursor: 'pointer',
                                        }, children: showAdmin ? 'Schedule' : 'Admin' }), _jsx("button", { onClick: handleDownload, style: {
                                            padding: '8px 16px',
                                            backgroundColor: '#10b981',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '6px',
                                            cursor: 'pointer',
                                        }, children: "Download" })] })) })] }) }), _jsx("div", { style: { display: 'flex', flex: 1, overflow: 'hidden' }, children: scheduleData ? (_jsx(_Fragment, { children: !showAdmin ? (_jsxs(_Fragment, { children: [_jsx("div", { style: { flex: 1, overflow: 'auto' }, children: _jsx(Calendar, { appointments: scheduleData.appointments, technicians: scheduleData.technicians, clients: scheduleData.clients, onAppointmentChange: handleAppointmentChange, onSelectAppointment: setSelectedAppointment }) }), _jsxs("div", { style: { width: '350px', borderLeft: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column' }, children: [conflicts.length > 0 && (_jsx(ConflictPanel, { conflicts: conflicts })), solutions.length > 0 && (_jsx(SolutionPanel, { solutions: solutions, onApply: handleApplySolution })), selectedAppointment && (_jsxs("div", { style: { padding: '16px', borderTop: '1px solid #e5e7eb' }, children: [_jsx("h3", { style: { marginBottom: '12px' }, children: "Selected Appointment" }), _jsx("p", { children: _jsx("strong", { children: selectedAppointment.title }) }), _jsx("p", { children: selectedAppointment.startTime }), selectedAppointment.isFixed && _jsx("span", { style: { color: '#dc2626' }, children: "\uD83D\uDD12 Fixed" })] }))] })] })) : (_jsx(AdminPanel, { data: scheduleData })) })) : (_jsx("div", { style: {
                        flex: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#9ca3af',
                    }, children: _jsx("div", { style: { textAlign: 'center' }, children: _jsx("p", { children: "Upload an Excel file to get started" }) }) })) })] }));
}
//# sourceMappingURL=app.js.map