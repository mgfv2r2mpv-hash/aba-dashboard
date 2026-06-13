import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import * as XLSX from 'xlsx';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { parseWorkbook } from './excelHandler';
import { ConstraintValidator } from './constraintValidator';
import { installNativeAdapter, setCurrentData as setNativeStore } from './nativeApi';
import Calendar from './components/Calendar';
import ConflictPanel from './components/ConflictPanel';
import SolutionPanel from './components/SolutionPanel';
import AdminPanel from './components/AdminPanel';
import ComplianceDashboard from './components/ComplianceDashboard';
import CaseloadView from './components/CaseloadView';
import FileUpload from './components/FileUpload';
import Settings from './components/Settings';
import AppointmentForm from './components/AppointmentForm';
import SetupWizard from './components/SetupWizard';
import CancellationDialog from './components/CancellationDialog';
import DayReview from './components/DayReview';
import ImportPreview from './components/ImportPreview';
import { pastIncompleteAppointments } from './compliance';
import { buildCache, recomputeCache, summarize, } from './complianceCache';
import { obfuscateKey, deobfuscateKey, encryptBytes, decryptBytes, isEncryptedSchedule, } from './clientCrypto';
import { applyOps, renderList, newAddOp, newMoveOp, newShortenOp, newRemoveOp, } from './draft';
import { solveDraft } from './draftSolver';
import DraftTray from './components/DraftTray';
import { ClaudeScheduler } from './claudeScheduler';
// Route axios /api/* calls through an in-memory store on iOS/Android,
// since the Express server isn't reachable from inside the WebView.
if (Capacitor.isNativePlatform())
    installNativeAdapter();
const BUILD_STAMP = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : 'dev';
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
// Local-day ISO without timezone suffix — matches the seeder/Calendar format so
// `startTime.startsWith('YYYY-MM-DD')` filters keep working.
function formatLocalISO(d) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
// Apply an AI solution's time-move changes onto a schedule (pure).
function applySolutionChanges(data, sol) {
    const appointments = data.appointments.map(a => {
        const ch = sol.changes.find(c => c.appointmentId === a.id);
        return ch ? { ...a, startTime: ch.newTime.start, endTime: ch.newTime.end } : a;
    });
    return { ...data, appointments };
}
function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(reader.error);
        reader.onloadend = () => {
            const dataUrl = reader.result;
            // Strip the "data:<mime>;base64," prefix that FileReader prepends.
            const comma = dataUrl.indexOf(',');
            resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
        };
        reader.readAsDataURL(blob);
    });
}
export default function App() {
    const [scheduleData, setScheduleData] = useState(null);
    const [conflicts, setConflicts] = useState([]);
    const [solutions, setSolutions] = useState([]);
    const [selectedAppointment, setSelectedAppointment] = useState(null);
    const [view, setView] = useState('schedule');
    const [showSettings, setShowSettings] = useState(false);
    const [showWizard, setShowWizard] = useState(false);
    const [showAddAppointment, setShowAddAppointment] = useState(false);
    const [editingAppointment, setEditingAppointment] = useState(null);
    const [loading, setLoading] = useState(false);
    const [aiSettings, setAiSettings] = useState(loadSessionSettings);
    const [debugMsg, setDebugMsg] = useState(null);
    // Staged, uncommitted schedule edits (the draft sandbox). Nothing here touches
    // the live schedule until the user Accepts or overrides (Save anyway).
    const [draftOps, setDraftOps] = useState([]);
    const [aiLoading, setAiLoading] = useState(false);
    const [cancelTarget, setCancelTarget] = useState(null);
    // The month/week the calendar is showing. Conflicts are scoped to this so the
    // Issues panel reflects what you're looking at, not just today.
    const [viewDate, setViewDate] = useState(new Date());
    const [showDayReview, setShowDayReview] = useState(false);
    // Per-entity supervision-compliance cache for the current month. Recomputed
    // incrementally (only the affected clients/techs) on each appointment change
    // so the Comp-tab badge and dashboard stay live without a full pass.
    const [compCache, setCompCache] = useState(null);
    // A file picked from Admin → "Upload schedule", parsed but not yet applied:
    // the user reviews the delta and confirms before it replaces current data.
    // `bytes` are the DECRYPTED workbook bytes (so the web upload re-POSTs plain).
    const [pendingImport, setPendingImport] = useState(null);
    const detailPanelRef = React.useRef(null);
    const importInputRef = React.useRef(null);
    const compSummary = scheduleData && compCache ? summarize(compCache, scheduleData) : null;
    // Past-dated sessions still marked scheduled — the day-review queue.
    const pendingReview = scheduleData ? pastIncompleteAppointments(scheduleData) : [];
    // Draft sandbox derivations. The Sched view renders the PREVIEW (staged ops
    // applied) with per-appointment marks; the status badge grades it.
    const draftActive = !!scheduleData && draftOps.length > 0;
    const draftRender = React.useMemo(() => (scheduleData && draftActive ? renderList(scheduleData, draftOps) : null), [scheduleData, draftOps, draftActive]);
    const draftStatus = React.useMemo(() => (scheduleData && draftActive ? solveDraft(scheduleData, draftOps, new Date(), scheduleData.settings) : null), [scheduleData, draftOps, draftActive]);
    const calendarAppointments = draftRender ? draftRender.appointments : (scheduleData?.appointments || []);
    const calendarMarks = draftRender ? draftRender.marks : undefined;
    // On narrow screens the right-side detail panel wraps below the calendar.
    // When the user taps an appointment, scroll the detail into view so they
    // notice it actually opened.
    useEffect(() => {
        if (selectedAppointment && detailPanelRef.current) {
            detailPanelRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }, [selectedAppointment]);
    // Keep conflicts in sync with the schedule AND the viewed month. Admin edits
    // (availability, blackouts, add/remove people) flow through setScheduleData
    // without their own revalidation; recomputing here means a newly-added
    // blackout flags any session that day the moment you switch back to the
    // Schedule view. Scoping to viewDate means navigating months re-scopes the
    // Issues panel to whatever's on screen.
    useEffect(() => {
        if (scheduleData) {
            setConflicts(new ConstraintValidator(scheduleData, viewDate).validateSchedule());
        }
    }, [scheduleData, viewDate]);
    const handleAISettingsSave = (settings) => {
        setAiSettings(settings);
        saveSessionSettings(settings);
    };
    const handleClearKey = () => {
        const cleared = { ...aiSettings, apiKey: '' };
        setAiSettings(cleared);
        saveSessionSettings(cleared);
    };
    const fetchSampleBlob = async () => {
        const response = await fetch('sample_schedule.xlsx');
        if (!response.ok)
            throw new Error(`Sample fetch failed: ${response.status}`);
        return response.blob();
    };
    // On iOS/Android, drop the bundled sample into the app's Documents folder
    // on first launch so it shows up in the system file picker when the user
    // taps "Upload Schedule". No-op on web. Skips if already present.
    useEffect(() => {
        if (!Capacitor.isNativePlatform())
            return;
        let cancelled = false;
        (async () => {
            try {
                // Always overwrite: the bundled sample's appointment dates are
                // anchored to the build's current week, so a stale copy from a
                // previous launch would show as "no events this month".
                const blob = await fetchSampleBlob();
                const base64 = await blobToBase64(blob);
                if (cancelled)
                    return;
                await Filesystem.writeFile({
                    path: 'sample_schedule.xlsx',
                    data: base64,
                    directory: Directory.Documents,
                });
            }
            catch (e) {
                console.warn('Could not seed sample schedule:', e);
            }
        })();
        return () => { cancelled = true; };
    }, []);
    // The API key rides inside the workbook only lightly obfuscated (app key, no
    // user password), so it loads automatically with no prompt. Real protection
    // is the whole-file schedule password.
    const loadEmbeddedKey = async (embeddedConfig) => {
        if (aiSettings.apiKey)
            return;
        try {
            const decrypted = await deobfuscateKey(embeddedConfig);
            const parsed = JSON.parse(decrypted);
            const restored = {
                ...aiSettings,
                apiKey: parsed.apiKey,
                model: parsed.model || aiSettings.model || 'claude-sonnet-4-6',
            };
            setAiSettings(restored);
            saveSessionSettings(restored);
        }
        catch (_e) {
            // Corrupt/foreign blob — ignore silently; the user can paste a key.
        }
    };
    // Replace the whole schedule and rebuild the compliance cache from scratch.
    // Used on first load, wizard finish, applied AI solutions, and admin edits —
    // anything that can shift many entities at once. (Conflicts are recomputed by
    // the scheduleData/viewDate effect, so we don't set them here.)
    const commitFull = (next) => {
        setScheduleData(next);
        setCompCache(buildCache(next));
    };
    // Apply an already-parsed import as the working schedule. On native we prime
    // the in-memory store nativeApi serves from; on web we POST the (decrypted,
    // plain) bytes so the Express server's store is the source of truth.
    const applyImported = async (bytes, data, embeddedConfig) => {
        if (Capacitor.isNativePlatform()) {
            setNativeStore(data);
            commitFull(data);
            setSolutions([]);
            if (embeddedConfig)
                await loadEmbeddedKey(embeddedConfig);
            return;
        }
        const response = await axios.post(`${API_BASE}/upload`, new Blob([bytes]), {
            headers: { 'Content-Type': 'application/octet-stream' },
        });
        commitFull(response.data.data);
        setSolutions([]);
        if (response.data.embeddedConfig)
            await loadEmbeddedKey(response.data.embeddedConfig);
    };
    const handleFileUpload = async (file) => {
        setLoading(true);
        try {
            let bytes = new Uint8Array(await file.arrayBuffer());
            // Whole-file encryption: a foreign/encrypted schedule is opaque until the
            // owner's password decrypts it. Prefer the session password, else prompt.
            if (isEncryptedSchedule(bytes)) {
                const password = aiSettings.schedulePassword
                    || prompt('This schedule is password-protected. Enter the schedule password to open it:') || '';
                if (!password) {
                    setLoading(false);
                    return;
                }
                try {
                    bytes = await decryptBytes(bytes, password);
                }
                catch (_e) {
                    alert('Wrong password — could not open this schedule.');
                    setLoading(false);
                    return;
                }
            }
            // Parse client-side (cheap, pure) — same parser the server/native use.
            const workbook = XLSX.read(bytes, { type: 'array' });
            const parsed = parseWorkbook(workbook);
            if (scheduleData) {
                // Replacing a loaded schedule — stage it and let the user confirm.
                setPendingImport({ bytes, fileName: file.name, data: parsed.data, embeddedConfig: parsed.embeddedConfig });
                return;
            }
            await applyImported(bytes, parsed.data, parsed.embeddedConfig);
        }
        catch (error) {
            const msg = error.response?.data?.error || error.message || String(error);
            console.error('[upload] failed', error);
            setDebugMsg(`Upload failed: ${msg}`);
            alert('Error uploading file: ' + msg);
        }
        finally {
            setLoading(false);
        }
    };
    // Hidden file input fired by Admin → "Upload schedule…".
    const triggerImportPicker = () => importInputRef.current?.click();
    const confirmPendingImport = async () => {
        if (!pendingImport)
            return;
        setLoading(true);
        try {
            await applyImported(pendingImport.bytes, pendingImport.data, pendingImport.embeddedConfig);
            setPendingImport(null);
            setView('schedule');
        }
        catch (error) {
            const msg = error.response?.data?.error || error.message || String(error);
            setDebugMsg(`Import failed: ${msg}`);
            alert('Error importing file: ' + msg);
        }
        finally {
            setLoading(false);
        }
    };
    // ---- Draft staging --------------------------------------------------------
    // Add/replace ops, collapsing any prior op that targets the same appointment
    // so the latest edit wins (matches applyOps).
    const stageOps = (incoming) => {
        const idOf = (o) => (o.kind === 'add' ? o.appt?.id : o.targetId);
        const ids = new Set(incoming.map(idOf));
        setDraftOps(prev => [...prev.filter(o => !ids.has(idOf(o))), ...incoming]);
    };
    // Calendar drag → stage a move (uncommitted). No server call, no auto-AI.
    const handleAppointmentChange = (appointment) => {
        stageOps([newMoveOp(appointment)]);
    };
    // Sync the live store (native in-memory / Express) to a full replacement, then
    // commit to React state + rebuild the compliance cache.
    const commitScheduleData = async (next) => {
        if (Capacitor.isNativePlatform()) {
            setNativeStore(next);
            commitFull(next);
            return;
        }
        const response = await axios.post(`${API_BASE}/schedule`, next);
        commitFull(response.data.data);
    };
    const acceptDraft = async () => {
        if (!scheduleData || !draftStatus)
            return;
        const next = draftStatus.resolved || applyOps(scheduleData, draftOps);
        await commitScheduleData(next);
        setDraftOps([]);
        setSolutions([]);
        setSelectedAppointment(null);
    };
    const saveAnyway = async () => {
        if (!scheduleData)
            return;
        if (!confirm('Save this schedule as-is, with the flagged conflicts?'))
            return;
        await commitScheduleData(applyOps(scheduleData, draftOps));
        setDraftOps([]);
        setSolutions([]);
        setSelectedAppointment(null);
    };
    const cancelDraft = () => { setDraftOps([]); setSolutions([]); };
    const resetOp = (opId) => setDraftOps(ops => ops.filter(o => o.id !== opId));
    // Picking a yellow trade-off stages the corresponding op so the next solve
    // can clear the conflict. "Shorten" trims the session by 30 min (a starting
    // point the BCBA can fine-tune); "move-family" stages a relocation to its
    // first open in-week slot — left as a move the user can drag.
    const pickChoice = (choice) => {
        if (!scheduleData)
            return;
        const preview = applyOps(scheduleData, draftOps);
        const a = preview.appointments.find(x => x.id === choice.appointmentId);
        if (!a)
            return;
        if (choice.kind === 'shorten') {
            const end = new Date(new Date(a.endTime).getTime() - 30 * 60000);
            if (end.getTime() <= new Date(a.startTime).getTime())
                return;
            stageOps([newShortenOp({ ...a, endTime: formatLocalISO(end) })]);
        }
        else {
            stageOps([newMoveOp({ ...a })]);
        }
    };
    // ---- AI escalation (browser-side ClaudeScheduler over the preview) --------
    const runDraftAI = async () => {
        if (!scheduleData || !aiSettings.apiKey)
            return;
        const preview = applyOps(scheduleData, draftOps);
        const changed = draftOps.find(o => o.appt)?.appt || preview.appointments[0];
        if (!changed)
            return;
        setAiLoading(true);
        try {
            const messages = new ConstraintValidator(preview).validateSchedule().map(c => c.message);
            const scheduler = new ClaudeScheduler(aiSettings.apiKey, preview, aiSettings.model);
            const sols = await scheduler.generateSolutions(changed, messages);
            setSolutions(sols);
            if (sols.length === 0)
                setDebugMsg('AI returned no in-month options.');
        }
        catch (error) {
            alert('AI error: ' + (error.message || error));
        }
        finally {
            setAiLoading(false);
        }
    };
    const acceptAiSolution = async (sol) => {
        if (!scheduleData)
            return;
        const next = applySolutionChanges(applyOps(scheduleData, draftOps), sol);
        await commitScheduleData(next);
        setDraftOps([]);
        setSolutions([]);
        setSelectedAppointment(null);
    };
    const customizeAiSolution = (sol) => {
        if (!scheduleData)
            return;
        const preview = applyOps(scheduleData, draftOps);
        const moves = [];
        for (const ch of sol.changes) {
            const a = preview.appointments.find(x => x.id === ch.appointmentId);
            if (a)
                moves.push(newMoveOp({ ...a, startTime: ch.newTime.start, endTime: ch.newTime.end }));
        }
        stageOps(moves);
        setSolutions([]);
    };
    const rejectAiSet = () => setSolutions([]);
    // Refuse and log: commit the staged ADD requests as ghosts (visible reminders)
    // and discard the rest of the draft.
    const logAddsAsGhosts = async () => {
        if (!scheduleData)
            return;
        const ghosts = draftOps
            .filter(o => o.kind === 'add' && o.appt)
            .map(o => ({ ...o.appt, isGhost: true }));
        const next = ghosts.length
            ? { ...scheduleData, appointments: [...scheduleData.appointments, ...ghosts] }
            : scheduleData;
        await commitScheduleData(next);
        setDraftOps([]);
        setSolutions([]);
        setSelectedAppointment(null);
    };
    // ---- Ghost lifecycle (committed) ------------------------------------------
    const promoteGhost = (a) => {
        stageOps([newMoveOp({ ...a, isGhost: false })]);
        setSelectedAppointment(null);
    };
    const dismissGhost = async (a) => {
        if (!scheduleData)
            return;
        await axios.delete(`${API_BASE}/admin/appointment/${a.id}`);
        const next = { ...scheduleData, appointments: scheduleData.appointments.filter(x => x.id !== a.id) };
        setScheduleData(next);
        setCompCache(prev => recomputeCache(prev, scheduleData, next, [{ before: a, after: undefined }]));
        setSelectedAppointment(null);
    };
    const persistAppointment = async (updated) => {
        if (!scheduleData)
            return;
        try {
            const before = scheduleData.appointments.find(a => a.id === updated.id);
            await axios.post(`${API_BASE}/admin/appointment`, updated);
            const next = {
                ...scheduleData,
                appointments: scheduleData.appointments.map(a => a.id === updated.id ? updated : a),
            };
            setScheduleData(next);
            setSelectedAppointment(updated);
            setCompCache(prev => recomputeCache(prev, scheduleData, next, [{ before, after: updated }]));
            // Recompute conflicts so the side panel reflects the new lifecycle state
            // (canceled appointments are now excluded from compliance totals).
            setConflicts(new ConstraintValidator(next).validateSchedule());
        }
        catch (error) {
            const msg = error.response?.data?.error || error.message || String(error);
            setDebugMsg(`Update failed: ${msg}`);
            alert('Error updating appointment: ' + msg);
        }
    };
    const handleMarkComplete = (a) => persistAppointment({ ...a, status: 'completed', cancellation: undefined });
    const handleReopen = (a) => persistAppointment({ ...a, status: 'scheduled', cancellation: undefined });
    const handleConfirmCancel = (cancellation) => {
        if (!cancelTarget)
            return;
        persistAppointment({ ...cancelTarget, status: 'canceled', cancellation });
        setCancelTarget(null);
    };
    // Add (new id) or edit (existing id) → stage as draft ops. Nothing commits
    // until the user Accepts or overrides in the DraftTray.
    const handleSaveAppointments = (apps) => {
        if (apps.length === 0 || !scheduleData)
            return;
        const ops = apps.map(a => scheduleData.appointments.some(x => x.id === a.id) ? newMoveOp(a) : newAddOp(a));
        stageOps(ops);
        setShowAddAppointment(false);
        setEditingAppointment(null);
    };
    // Delete → stage remove op(s) (a tombstone shows in the preview until commit).
    const handleDeleteAppointments = (ids) => {
        if (ids.length === 0 || !scheduleData)
            return;
        stageOps(ids.map(id => newRemoveOp(id)));
        if (selectedAppointment && ids.includes(selectedAppointment.id))
            setSelectedAppointment(null);
        setEditingAppointment(null);
    };
    const handleDeleteAppointment = (id) => handleDeleteAppointments([id]);
    const handleWizardComplete = async (data) => {
        try {
            const response = await axios.post(`${API_BASE}/schedule`, data);
            commitFull(response.data.data);
            setConflicts(response.data.conflicts || []);
            setSolutions([]);
            setShowWizard(false);
            setDebugMsg(null);
        }
        catch (error) {
            const msg = error.response?.data?.error || error.message || String(error);
            console.error('[wizard] failed', error);
            setDebugMsg(`Wizard save failed: ${msg}`);
            alert('Error saving schedule: ' + msg);
        }
    };
    const handleDownload = async () => {
        try {
            // Layer 1: the API key (if any) rides inside the workbook, app-obfuscated
            // (no user password) so it loads automatically on re-import.
            const embeddedConfig = aiSettings.apiKey
                ? await obfuscateKey(JSON.stringify({ apiKey: aiSettings.apiKey, model: aiSettings.model }))
                : undefined;
            const response = await axios.post(`${API_BASE}/download`, { embeddedConfig }, { responseType: 'blob' });
            let bytes = new Uint8Array(await response.data.arrayBuffer());
            // Layer 2: if a schedule password is set, encrypt the whole file so it's
            // opaque in a file browser and unopenable without the password.
            const password = aiSettings.schedulePassword;
            if (password)
                bytes = await encryptBytes(bytes, password);
            const filename = password ? 'schedule.enc.xlsx' : 'schedule.xlsx';
            const blob = new Blob([bytes]);
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
                }
                catch (shareErr) {
                    // User canceled the share sheet — not an error worth alerting on.
                    if (!/cancel/i.test(shareErr?.message || ''))
                        throw shareErr;
                }
            }
            else {
                const url = window.URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.setAttribute('download', filename);
                document.body.appendChild(link);
                link.click();
                link.parentElement?.removeChild(link);
                window.URL.revokeObjectURL(url);
            }
        }
        catch (error) {
            alert('Error downloading file: ' + (error.message || error));
        }
    };
    const compactBtn = (label, ariaLabel, onClick, color = '#374151') => (_jsx("button", { onClick: onClick, "aria-label": ariaLabel, title: ariaLabel, style: {
            padding: '5px 9px',
            backgroundColor: color,
            color: 'white',
            border: 'none',
            borderRadius: 5,
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600,
            whiteSpace: 'nowrap',
            lineHeight: 1.2,
        }, children: label }));
    return (_jsxs("div", { style: {
            display: 'flex', height: '100vh', maxWidth: '100vw',
            overflowX: 'hidden', flexDirection: 'column',
            // Side insets matter on landscape iPhones with a notch so chrome
            // doesn't slip under the camera housing.
            paddingLeft: 'env(safe-area-inset-left)',
            paddingRight: 'env(safe-area-inset-right)',
        }, children: [_jsx("header", { style: {
                    backgroundColor: '#1f2937',
                    color: 'white',
                    // Top padding includes the iOS status bar / notch inset so the
                    // title doesn't sit under the time/carrier indicators.
                    padding: 'calc(env(safe-area-inset-top) + 6px) 12px 6px',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                    position: 'sticky', top: 0, zIndex: 10,
                    flexShrink: 0,
                }, children: _jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }, children: [_jsx("h1", { style: { fontSize: '14px', fontWeight: 700, margin: 0, whiteSpace: 'nowrap' }, children: "ABA Schedule" }), _jsxs("div", { style: { display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }, children: [aiSettings.apiKey && (_jsx("span", { title: `AI: ${aiSettings.model}`, style: {
                                        width: 8, height: 8, borderRadius: '50%',
                                        backgroundColor: '#10b981', display: 'inline-block',
                                    } })), compactBtn('⚙', 'Settings', () => setShowSettings(true)), !scheduleData ? (_jsxs(_Fragment, { children: [compactBtn('Wizard', 'Setup Wizard', () => setShowWizard(true), '#8b5cf6'), _jsx(FileUpload, { onUpload: handleFileUpload, loading: loading })] })) : (_jsxs(_Fragment, { children: [compactBtn('+', 'Add appointment', () => setShowAddAppointment(true), '#3b82f6'), _jsx(ViewTabs, { view: view, onChange: setView, compSummary: compSummary }), compactBtn('↓', 'Download', handleDownload, '#10b981')] }))] })] }) }), _jsx("div", { style: {
                    display: 'flex', flex: 1, flexWrap: 'wrap',
                    // Single scroll region for the whole post-header area.
                    // Each child below reports its natural height instead of carving
                    // out its own scrollbox — fixes the "stuck mid-page" trap on iPhone
                    // where the calendar and issues pane were independent scroll panes
                    // and tapping ✕ on the appointment panel left no way to scroll back up.
                    overflowY: 'auto', overflowX: 'hidden',
                    WebkitOverflowScrolling: 'touch',
                    paddingBottom: 'env(safe-area-inset-bottom)',
                }, children: scheduleData ? (_jsxs(_Fragment, { children: [view === 'schedule' && (_jsxs(_Fragment, { children: [_jsxs("div", { style: { flex: '1 1 320px', minWidth: 0 }, children: [pendingReview.length > 0 && (_jsxs("button", { onClick: () => setShowDayReview(true), style: {
                                                display: 'block', width: 'calc(100% - 16px)', margin: '8px',
                                                padding: '8px 12px', backgroundColor: '#fef3c7',
                                                border: '1px solid #fcd34d', borderRadius: 6, cursor: 'pointer',
                                                fontSize: 13, fontWeight: 600, color: '#92400e', textAlign: 'left',
                                            }, children: ["\uD83D\uDCCB ", pendingReview.length, " past session", pendingReview.length === 1 ? '' : 's', " awaiting review \u2014 complete or cancel them"] })), _jsx(Calendar, { appointments: calendarAppointments, technicians: scheduleData.technicians, clients: scheduleData.clients, settings: scheduleData.settings, onAppointmentChange: handleAppointmentChange, onSelectAppointment: setSelectedAppointment, onViewDateChange: setViewDate, draftMarks: calendarMarks })] }), (draftActive || conflicts.length > 0 || solutions.length > 0 || selectedAppointment) && (_jsxs("div", { ref: detailPanelRef, style: {
                                        flex: '0 0 auto',
                                        width: 'min(350px, 100%)',
                                        borderLeft: '1px solid #e5e7eb',
                                        display: 'flex',
                                        flexDirection: 'column',
                                    }, children: [draftActive && draftStatus && (_jsx(DraftTray, { base: scheduleData, ops: draftOps, status: draftStatus, hasApiKey: !!aiSettings.apiKey, aiLoading: aiLoading, onResetOp: resetOp, onResetAll: cancelDraft, onCancel: cancelDraft, onAccept: acceptDraft, onSaveAnyway: saveAnyway, onAI: runDraftAI, onPickChoice: pickChoice, onLogGhosts: logAddsAsGhosts })), !draftActive && conflicts.length > 0 && (_jsx(ConflictPanel, { conflicts: conflicts, appointments: scheduleData?.appointments, onSelectAppointment: setSelectedAppointment })), solutions.length > 0 && (_jsx(SolutionPanel, { solutions: solutions, heading: "AI options (within the month)", onAccept: acceptAiSolution, onCustomize: customizeAiSolution, onReject: rejectAiSet })), selectedAppointment && (() => {
                                            const a = selectedAppointment;
                                            const status = a.status || 'scheduled';
                                            const statusColor = status === 'canceled' ? '#b91c1c' : status === 'completed' ? '#15803d' : '#374151';
                                            const statusBg = status === 'canceled' ? '#fee2e2' : status === 'completed' ? '#dcfce7' : '#f3f4f6';
                                            return (_jsxs("div", { style: { padding: '16px', borderTop: '1px solid #e5e7eb' }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', gap: 8 }, children: [_jsx("h3", { style: { margin: 0 }, children: "Selected Appointment" }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8 }, children: [_jsx("span", { style: {
                                                                            fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
                                                                            color: statusColor, backgroundColor: statusBg,
                                                                            padding: '2px 8px', borderRadius: 10,
                                                                        }, children: status }), _jsx("button", { onClick: () => setSelectedAppointment(null), "aria-label": "Close", style: {
                                                                            background: 'none', border: 'none', color: '#6b7280',
                                                                            fontSize: 20, lineHeight: 1, cursor: 'pointer', padding: 4,
                                                                        }, children: "\u2715" })] })] }), _jsx("p", { children: _jsx("strong", { children: a.title }) }), _jsxs("p", { style: { fontSize: '12px', color: '#6b7280', marginTop: '4px' }, children: [new Date(a.startTime).toLocaleString(), " \u2192 ", new Date(a.endTime).toLocaleString()] }), a.technician && (_jsxs("p", { style: { fontSize: '12px', color: '#374151', marginTop: '4px' }, children: ["Tech: ", a.technician] })), (status === 'canceled' || status === 'completed') && (_jsx("p", { style: { color: '#6b7280', marginTop: '4px', fontSize: 12 }, children: "\uD83D\uDD12 Locked \u2014 reopen to edit time, status, or assignment" })), a.cancellation && (_jsxs("div", { style: { fontSize: 12, color: '#6b7280', marginTop: 6, lineHeight: 1.5 }, children: [_jsxs("div", { children: ["Source: ", _jsxs("strong", { children: ["Cancel-", a.cancellation.source.toUpperCase()] })] }), _jsxs("div", { children: ["Reason: ", _jsx("strong", { children: a.cancellation.reason.replace('_', ' ') })] }), _jsxs("div", { children: [a.cancellation.unplanned ? 'Unplanned' : 'Planned', " \u00B7 notice met: ", _jsx("strong", { children: a.cancellation.noticeMet ? 'yes' : 'no' })] }), a.cancellation.notes && _jsxs("div", { children: ["Notes: ", a.cancellation.notes] })] })), a.isGhost ? (_jsxs("div", { style: { display: 'flex', gap: '6px', marginTop: '12px', flexWrap: 'wrap' }, children: [_jsx("button", { onClick: () => promoteGhost(a), style: {
                                                                    flex: '1 1 auto', padding: '6px 12px', backgroundColor: '#3b82f6', color: 'white',
                                                                    border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
                                                                }, children: "Promote" }), _jsx("button", { onClick: () => dismissGhost(a), style: {
                                                                    flex: '1 1 auto', padding: '6px 12px', backgroundColor: 'white', color: '#6b7280',
                                                                    border: '1px solid #d1d5db', borderRadius: '4px', cursor: 'pointer', fontSize: '13px',
                                                                }, children: "Dismiss" })] })) : (_jsxs("div", { style: { display: 'flex', gap: '6px', marginTop: '12px', flexWrap: 'wrap' }, children: [_jsx("button", { onClick: () => setEditingAppointment(a), style: {
                                                                    flex: '1 1 auto', padding: '6px 12px', backgroundColor: '#3b82f6', color: 'white',
                                                                    border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px',
                                                                }, children: "Edit" }), status === 'scheduled' && (_jsxs(_Fragment, { children: [_jsx("button", { onClick: () => handleMarkComplete(a), style: {
                                                                            flex: '1 1 auto', padding: '6px 12px', backgroundColor: '#dcfce7', color: '#15803d',
                                                                            border: '1px solid #86efac', borderRadius: '4px', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
                                                                        }, children: "\u2713 Complete" }), _jsx("button", { onClick: () => setCancelTarget(a), style: {
                                                                            flex: '1 1 auto', padding: '6px 12px', backgroundColor: '#fee2e2', color: '#b91c1c',
                                                                            border: '1px solid #fca5a5', borderRadius: '4px', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
                                                                        }, children: "\u2715 Cancel" })] })), (status === 'completed' || status === 'canceled') && (_jsx("button", { onClick: () => handleReopen(a), style: {
                                                                    flex: '1 1 auto', padding: '6px 12px', backgroundColor: 'white', color: '#374151',
                                                                    border: '1px solid #d1d5db', borderRadius: '4px', cursor: 'pointer', fontSize: '13px',
                                                                }, children: "Reopen" })), _jsx("button", { onClick: () => handleDeleteAppointment(a.id), style: {
                                                                    padding: '6px 12px', backgroundColor: 'white', color: '#6b7280',
                                                                    border: '1px solid #d1d5db', borderRadius: '4px', cursor: 'pointer', fontSize: '13px',
                                                                }, children: "Delete" })] }))] }));
                                        })()] }))] })), view === 'admin' && (_jsx(AdminPanel, { data: scheduleData, onDataChange: commitFull, onImportFile: triggerImportPicker, onRerunWizard: () => setShowWizard(true) })), view === 'compliance' && (_jsx(ComplianceDashboard, { data: scheduleData, cache: compCache, onMarkComplete: handleMarkComplete, onRequestCancel: (a) => setCancelTarget(a), onSelectAppointment: (a) => { setView('schedule'); setSelectedAppointment(a); } })), view === 'caseload' && (_jsx(CaseloadView, { data: scheduleData, now: viewDate }))] })) : (_jsxs("div", { style: {
                        flex: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#9ca3af',
                        flexDirection: 'column',
                        gap: '16px',
                        padding: '0 24px',
                        textAlign: 'center',
                    }, children: [_jsx("p", { children: "Upload an Excel file or run the Setup Wizard to get started." }), _jsxs("p", { style: { fontSize: '12px', maxWidth: '320px' }, children: ["A sample schedule (", _jsx("code", { children: "sample_schedule.xlsx" }), ") is in this app's Documents folder \u2014 pick it from Files via Upload Schedule."] }), debugMsg && (_jsx("p", { style: { fontSize: '12px', color: '#b91c1c', maxWidth: '320px', backgroundColor: '#fee2e2', padding: '8px', borderRadius: '4px' }, children: debugMsg })), _jsxs("p", { style: { fontSize: '10px', color: '#d1d5db', fontFamily: 'monospace' }, children: ["build ", BUILD_STAMP, " \u00B7 native ", String(Capacitor.isNativePlatform())] })] })) }), showSettings && (_jsx(Settings, { settings: aiSettings, onSave: handleAISettingsSave, onClose: () => setShowSettings(false), onClearKey: handleClearKey })), showWizard && (_jsx(SetupWizard, { onComplete: handleWizardComplete, onCancel: () => setShowWizard(false), initialData: scheduleData || undefined })), _jsx("input", { ref: importInputRef, type: "file", accept: ".xlsx,.xls", style: { display: 'none' }, onChange: e => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file)
                        handleFileUpload(file);
                } }), pendingImport && scheduleData && (_jsx(ImportPreview, { current: scheduleData, next: pendingImport.data, fileName: pendingImport.fileName, onConfirm: confirmPendingImport, onCancel: () => setPendingImport(null) })), cancelTarget && scheduleData && (_jsx(CancellationDialog, { appointment: cancelTarget, settings: scheduleData.settings, onConfirm: handleConfirmCancel, onCancel: () => setCancelTarget(null) })), showAddAppointment && scheduleData && (_jsx(AppointmentForm, { allAppointments: scheduleData.appointments, authorizations: scheduleData.authorizations, technicians: scheduleData.technicians, clients: scheduleData.clients, onSave: handleSaveAppointments, onCancel: () => setShowAddAppointment(false) })), editingAppointment && scheduleData && (_jsx(AppointmentForm, { appointment: editingAppointment, allAppointments: scheduleData.appointments, authorizations: scheduleData.authorizations, technicians: scheduleData.technicians, clients: scheduleData.clients, onSave: handleSaveAppointments, onDelete: handleDeleteAppointments, onCancel: () => setEditingAppointment(null) })), showDayReview && scheduleData && (_jsx(DayReview, { appointments: pendingReview, onComplete: handleMarkComplete, onRequestCancel: (a) => setCancelTarget(a), onClose: () => setShowDayReview(false) }))] }));
}
// Three-way segmented control for the active view. Sits inline in the header
// at compact-button size so it doesn't blow up the chrome.
function ViewTabs({ view, onChange, compSummary }) {
    const tabs = [
        { key: 'schedule', label: 'Sched', aria: 'Schedule' },
        { key: 'admin', label: 'Admin', aria: 'Admin' },
        { key: 'compliance', label: 'Comp', aria: 'Compliance' },
        { key: 'caseload', label: 'Cases', aria: 'Caseload' },
    ];
    // Live count of clients/techs needing attention this month, updated on every
    // appointment change. Red = behind even projected; amber = projected ok only.
    const attention = compSummary ? compSummary.red + compSummary.yellow : 0;
    const badgeColor = compSummary?.worst === 'red' ? '#ef4444'
        : compSummary?.worst === 'yellow' ? '#f59e0b' : '#10b981';
    return (_jsx("div", { style: { display: 'flex', borderRadius: 5, overflow: 'hidden', border: '1px solid #4b5563' }, children: tabs.map(t => {
            const active = t.key === view;
            const showBadge = t.key === 'compliance' && !!compSummary;
            return (_jsxs("button", { onClick: () => onChange(t.key), "aria-label": showBadge && attention > 0 ? `${t.aria} — ${attention} need attention` : t.aria, title: showBadge && attention > 0 ? `${attention} client(s)/tech(s) need attention this month` : t.aria, style: {
                    position: 'relative',
                    padding: '5px 9px', border: 'none',
                    backgroundColor: active ? '#6366f1' : 'transparent',
                    color: 'white', cursor: 'pointer',
                    fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', lineHeight: 1.2,
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                }, children: [t.label, showBadge && (attention > 0 ? (_jsx("span", { style: {
                            minWidth: 15, height: 15, padding: '0 4px', borderRadius: 8,
                            backgroundColor: badgeColor, color: 'white',
                            fontSize: 10, fontWeight: 700, lineHeight: '15px', textAlign: 'center',
                        }, children: attention })) : (_jsx("span", { style: {
                            width: 8, height: 8, borderRadius: '50%',
                            backgroundColor: badgeColor, display: 'inline-block',
                        } })))] }, t.key));
        }) }));
}
//# sourceMappingURL=app.js.map