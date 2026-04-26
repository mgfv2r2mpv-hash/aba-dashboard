import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import axios from 'axios';
import Calendar from './components/Calendar';
import ConflictPanel from './components/ConflictPanel';
import SolutionPanel from './components/SolutionPanel';
import AdminPanel from './components/AdminPanel';
import FileUpload from './components/FileUpload';
import Settings from './components/Settings';
import AppointmentForm from './components/AppointmentForm';
import SetupWizard from './components/SetupWizard';
import { encryptString, decryptString } from './clientCrypto';
const API_BASE = '/api';
const SESSION_KEY = 'aba_ai_settings';
function loadSessionSettings() {
    try {
        const stored = sessionStorage.getItem(SESSION_KEY);
        if (stored)
            return JSON.parse(stored);
    }
    catch (_e) { /* ignore */ }
    return { apiKey: '', model: 'claude-sonnet-4-6' };
}
function saveSessionSettings(settings) {
    try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(settings));
    }
    catch (_e) { /* ignore */ }
}
export default function App() {
    const [scheduleData, setScheduleData] = useState(null);
    const [conflicts, setConflicts] = useState([]);
    const [solutions, setSolutions] = useState([]);
    const [selectedAppointment, setSelectedAppointment] = useState(null);
    const [showAdmin, setShowAdmin] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [showWizard, setShowWizard] = useState(false);
    const [showAddAppointment, setShowAddAppointment] = useState(false);
    const [loading, setLoading] = useState(false);
    const [aiSettings, setAiSettings] = useState(loadSessionSettings);
    const [pendingEmbedBlob, setPendingEmbedBlob] = useState(undefined);
    const handleAISettingsSave = (settings) => {
        setAiSettings(settings);
        saveSessionSettings(settings);
    };
    const handleClearKey = () => {
        const cleared = { ...aiSettings, apiKey: '' };
        setAiSettings(cleared);
        saveSessionSettings(cleared);
        setPendingEmbedBlob(undefined);
    };
    const handlePrepareEmbed = async (password) => {
        if (!aiSettings.apiKey)
            throw new Error('No API key set');
        const payload = JSON.stringify({ apiKey: aiSettings.apiKey, model: aiSettings.model });
        const blob = await encryptString(payload, password);
        setPendingEmbedBlob(blob);
    };
    const handleFileUpload = async (file) => {
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
                        const parsed = JSON.parse(decrypted);
                        const restored = { apiKey: parsed.apiKey, model: parsed.model || 'claude-sonnet-4-6' };
                        setAiSettings(restored);
                        saveSessionSettings(restored);
                        // Keep blob so a subsequent download re-embeds it (still encrypted with old password)
                        setPendingEmbedBlob(response.data.embeddedConfig);
                    }
                    catch (_e) {
                        alert('Wrong password or corrupted blob - skipping embedded key.');
                    }
                }
            }
        }
        catch (error) {
            alert('Error uploading file: ' + (error.response?.data?.error || error.message));
        }
        finally {
            setLoading(false);
        }
    };
    const handleAppointmentChange = async (appointment) => {
        setLoading(true);
        try {
            const headers = {};
            if (aiSettings.apiKey)
                headers['X-Claude-Api-Key'] = aiSettings.apiKey;
            if (aiSettings.model)
                headers['X-Claude-Model'] = aiSettings.model;
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
        }
        catch (error) {
            alert('Error updating appointment: ' + (error.response?.data?.error || error.message));
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
            alert('Error applying solution: ' + (error.response?.data?.error || error.message));
        }
        finally {
            setLoading(false);
        }
    };
    const handleAddAppointment = async (appointment) => {
        try {
            await axios.post(`${API_BASE}/admin/appointment`, appointment);
            if (scheduleData) {
                const updated = { ...scheduleData };
                updated.appointments = [...updated.appointments, appointment];
                setScheduleData(updated);
            }
            setShowAddAppointment(false);
        }
        catch (error) {
            alert('Error adding appointment: ' + (error.response?.data?.error || error.message));
        }
    };
    const handleWizardComplete = (data) => {
        setScheduleData(data);
        setShowWizard(false);
    };
    const handleDownload = async () => {
        try {
            const response = await axios.post(`${API_BASE}/download`, { embeddedConfig: pendingEmbedBlob }, { responseType: 'blob' });
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', 'schedule.enc.xlsx');
            document.body.appendChild(link);
            link.click();
            link.parentElement?.removeChild(link);
        }
        catch (error) {
            alert('Error downloading file: ' + error.message);
        }
    };
    const headerButton = (label, onClick, color) => (_jsx("button", { onClick: onClick, style: {
            padding: '8px 16px',
            backgroundColor: color,
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
        }, children: label }));
    return (_jsxs("div", { style: { display: 'flex', height: '100vh', flexDirection: 'column' }, children: [_jsx("header", { style: {
                    backgroundColor: '#1f2937',
                    color: 'white',
                    padding: '12px 16px',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                }, children: _jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }, children: [_jsx("h1", { style: { fontSize: '18px', fontWeight: 'bold' }, children: "ABA Schedule Assistant" }), _jsxs("div", { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }, children: [_jsx("div", { style: {
                                        padding: '4px 10px',
                                        borderRadius: '12px',
                                        fontSize: '12px',
                                        backgroundColor: aiSettings.apiKey ? '#10b981' : '#6b7280',
                                    }, children: aiSettings.apiKey ? `AI: ${aiSettings.model.replace('claude-', '')}` : 'AI: Off' }), headerButton('Settings', () => setShowSettings(true), '#374151'), !scheduleData ? (_jsxs(_Fragment, { children: [headerButton('Setup Wizard', () => setShowWizard(true), '#8b5cf6'), _jsx(FileUpload, { onUpload: handleFileUpload, loading: loading })] })) : (_jsxs(_Fragment, { children: [headerButton('+ Appointment', () => setShowAddAppointment(true), '#3b82f6'), headerButton(showAdmin ? 'Schedule' : 'Admin', () => setShowAdmin(!showAdmin), '#6366f1'), headerButton('Download', handleDownload, '#10b981')] }))] })] }) }), _jsx("div", { style: { display: 'flex', flex: 1, overflow: 'hidden', flexWrap: 'wrap' }, children: scheduleData ? (_jsx(_Fragment, { children: !showAdmin ? (_jsxs(_Fragment, { children: [_jsx("div", { style: { flex: '1 1 320px', minWidth: 0, overflow: 'auto' }, children: _jsx(Calendar, { appointments: scheduleData.appointments, technicians: scheduleData.technicians, clients: scheduleData.clients, onAppointmentChange: handleAppointmentChange, onSelectAppointment: setSelectedAppointment }) }), (conflicts.length > 0 || solutions.length > 0 || selectedAppointment) && (_jsxs("div", { style: {
                                    flex: '0 0 auto',
                                    width: 'min(350px, 100%)',
                                    borderLeft: '1px solid #e5e7eb',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    overflowY: 'auto',
                                }, children: [conflicts.length > 0 && _jsx(ConflictPanel, { conflicts: conflicts }), !aiSettings.apiKey && conflicts.length > 0 && (_jsx("div", { style: { padding: '12px', backgroundColor: '#fef3c7', fontSize: '12px', color: '#92400e' }, children: "Add a Claude API key in Settings to get AI-powered solutions for these conflicts." })), solutions.length > 0 && _jsx(SolutionPanel, { solutions: solutions, onApply: handleApplySolution }), selectedAppointment && (_jsxs("div", { style: { padding: '16px', borderTop: '1px solid #e5e7eb' }, children: [_jsx("h3", { style: { marginBottom: '12px' }, children: "Selected Appointment" }), _jsx("p", { children: _jsx("strong", { children: selectedAppointment.title }) }), _jsx("p", { children: selectedAppointment.startTime }), selectedAppointment.isFixed && _jsx("span", { style: { color: '#dc2626' }, children: "\uD83D\uDD12 Fixed" })] }))] }))] })) : (_jsx(AdminPanel, { data: scheduleData })) })) : (_jsx("div", { style: {
                        flex: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#9ca3af',
                        flexDirection: 'column',
                        gap: '16px',
                    }, children: _jsx("p", { children: "Upload an Excel file or run the Setup Wizard to get started." }) })) }), showSettings && (_jsx(Settings, { settings: aiSettings, onSave: handleAISettingsSave, onClose: () => setShowSettings(false), onEmbedInExcel: handlePrepareEmbed, onClearKey: handleClearKey })), showWizard && (_jsx(SetupWizard, { onComplete: handleWizardComplete, onCancel: () => setShowWizard(false) })), showAddAppointment && scheduleData && (_jsx(AppointmentForm, { technicians: scheduleData.technicians, clients: scheduleData.clients, onSave: handleAddAppointment, onCancel: () => setShowAddAppointment(false) }))] }));
}
//# sourceMappingURL=app.js.map