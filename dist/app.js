import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { ConstraintValidator } from './constraintValidator';
import { installNativeAdapter, setCurrentData as setNativeStore } from './nativeApi';
import { cancellationReasonLabel } from './types';
import Calendar, { HoursSummary } from './components/Calendar';
import ConflictPanel, { conflictKey } from './components/ConflictPanel';
import SolutionPanel from './components/SolutionPanel';
import WishComposer from './components/WishComposer';
import AdminPanel from './components/AdminPanel';
import ComplianceDashboard from './components/ComplianceDashboard';
import CaseloadView from './components/CaseloadView';
import FileUpload from './components/FileUpload';
import AppointmentForm from './components/AppointmentForm';
import SetupWizard from './components/SetupWizard';
import CancellationDialog from './components/CancellationDialog';
import DayReview from './components/DayReview';
import CompleteTimePrompt from './components/CompleteTimePrompt';
import AgendaRail from './components/AgendaRail';
import ImportPreview from './components/ImportPreview';
import { useMinWidth, useIsTablet, useIsLandscape } from './useMediaQuery';
import LockScreen from './components/LockScreen';
import PasswordPrompt from './components/PasswordPrompt';
import { hasPin, setPin, verifyPin, changePin, saveSchedule, loadSchedule, saveAIConfig, loadAIConfig, clearAIConfig, isFaceIdEnabled, enableFaceId, disableFaceId, recoverPinViaBiometric, } from './appLock';
import { checkBiometryFull, biometricAuthenticate } from './biometric';
import { pastIncompleteAppointments } from './compliance';
import { buildCache, recomputeCache, summarize, } from './complianceCache';
import { obfuscateKey, deobfuscateKey, encryptBytes, decryptBytes, isEncryptedSchedule, } from './clientCrypto';
import { applyOps, renderList, newAddOp, newMoveOp, newShortenOp, newRemoveOp, } from './draft';
import { solveDraft } from './draftSolver';
import DraftTray from './components/DraftTray';
import { ClaudeScheduler } from './claudeScheduler';
import { applyWishSolution, wishSolutionToDraft } from './wish';
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
    // Per-instance conflict triage. Muted conflicts drop into the minimized bin
    // (session-scoped, clears on reload). Confirmed-and-dismissed conflicts are
    // hidden outright and persisted in scheduleData.confirmedConflicts so they
    // survive page reloads and round-trip through the Excel export.
    const [mutedConflicts, setMutedConflicts] = useState([]);
    const [solutions, setSolutions] = useState([]);
    const [selectedAppointment, setSelectedAppointment] = useState(null);
    const [view, setView] = useState('schedule');
    const [showWizard, setShowWizard] = useState(false);
    const [showAddAppointment, setShowAddAppointment] = useState(false);
    // Wish view is now a full page (view === 'wish') rather than a modal.
    const [editingAppointment, setEditingAppointment] = useState(null);
    // Whether the selected appointment's detail panel is expanded into its inline
    // edit form (slide-up), replacing the old edit modal on the schedule view.
    const [inlineEdit, setInlineEdit] = useState(false);
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
    // Active calendar lens (bcba/bt), surfaced from <Calendar> so the docked pane
    // can render the matching hours totals.
    const [calLens, setCalLens] = useState('bcba');
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
    const headerRef = React.useRef(null);
    const [panelCollapsed, setPanelCollapsed] = useState(false);
    const mainScrollLastRef = React.useRef(0);
    const [headerHeight, setHeaderHeight] = useState(56);
    const isLandscape = useIsLandscape();
    // ---- App lock (native only) ----------------------------------------------
    // On a cold launch a PIN gates the app; the schedule is restored from an
    // at-rest blob encrypted under that PIN. `lockReady` gates the first render so
    // the main UI never flashes before we know whether to lock.
    const isNative = Capacitor.isNativePlatform();
    const [lockReady, setLockReady] = useState(!isNative);
    const [locked, setLocked] = useState(false);
    const [lockMode, setLockMode] = useState('unlock');
    const [changingPin, setChangingPin] = useState(false);
    const [faceIdAvailable, setFaceIdAvailable] = useState(false);
    const [faceIdEnabled, setFaceIdEnabled] = useState(false);
    // What to call the device's biometry in UI copy ("Face ID" / "Touch ID").
    const [biometryLabel, setBiometryLabel] = useState('biometric unlock');
    // The unlocked PIN, kept in memory only, so we can re-encrypt on each change.
    const unlockedPinRef = React.useRef(null);
    // Schedule-decrypt password modal (replaces window.prompt for AutoFill).
    const [pwPrompt, setPwPrompt] = useState(null);
    const pwResolverRef = React.useRef(null);
    const askPassword = (title, message, opts) => new Promise((resolve) => {
        pwResolverRef.current = resolve;
        setPwPrompt({ title, message, ...opts });
    });
    const resolvePassword = (pw) => {
        setPwPrompt(null);
        const r = pwResolverRef.current;
        pwResolverRef.current = null;
        r?.(pw);
    };
    const compSummary = scheduleData && compCache ? summarize(compCache, scheduleData) : null;
    // Conflict triage: confirmed-and-dismissed are hidden outright (persisted);
    // muted are moved to the bin (session-only).
    const confirmedSet = new Set(scheduleData?.confirmedConflicts ?? []);
    const mutedSet = new Set(mutedConflicts);
    const visibleConflicts = conflicts.filter(c => !confirmedSet.has(conflictKey(c)));
    const activeConflicts = visibleConflicts.filter(c => !mutedSet.has(conflictKey(c)));
    const muteConflict = (key) => setMutedConflicts(prev => (prev.includes(key) ? prev : [...prev, key]));
    const unmuteConflict = (key) => setMutedConflicts(prev => prev.filter(k => k !== key));
    const confirmDismissConflict = (key) => {
        if (!scheduleData)
            return;
        const prev = scheduleData.confirmedConflicts ?? [];
        if (prev.includes(key))
            return;
        commitFull({ ...scheduleData, confirmedConflicts: [...prev, key] });
    };
    const unconfirmConflict = (key) => {
        if (!scheduleData)
            return;
        commitFull({ ...scheduleData, confirmedConflicts: (scheduleData.confirmedConflicts ?? []).filter(k => k !== key) });
    };
    // "Fix It" is actionable when there's anything to fix — active calendar
    // conflicts (errors/warnings, minus muted/dismissed) and/or compliance
    // attention (clients/techs behind target). The wrench disables when 0.
    const attentionCount = compSummary ? compSummary.red + compSummary.yellow : 0;
    const issueCount = activeConflicts.length + attentionCount;
    const hasIssues = issueCount > 0;
    // Past-dated sessions still marked scheduled — the day-review queue.
    const pendingReview = scheduleData ? pastIncompleteAppointments(scheduleData) : [];
    // iPad (portrait and up) keeps the context pane permanently docked beside the
    // calendar: hours totals on top, conflicts/agenda filling the middle, and the
    // selected session sliding up from the bottom. Belt-and-suspenders: any tablet
    // docks regardless of width (`isTablet`, fused from the native Device plugin +
    // a UA/touch heuristic), AND any window ≥744px docks — so the width query still
    // drives web, rotation and iPad multitasking, while real iPad hardware (incl. a
    // hypothetical narrow one, or an iPad mini's 744 portrait) never falls through
    // to the phone shell. Phones in portrait keep the single-column slide-up sheet.
    const isTablet = useIsTablet();
    const dockPane = useMinWidth(744) || isTablet;
    // Wide screens in the schedule view get a two-pane split with independent
    // scrolling (calendar | bounded context pane). Other views and narrow screens
    // keep the single page-scroll layout.
    const splitView = dockPane && view === 'schedule';
    // Draft sandbox derivations. The Sched view renders the PREVIEW (staged ops
    // applied) with per-appointment marks; the status badge grades it.
    const draftActive = !!scheduleData && draftOps.length > 0;
    const draftRender = React.useMemo(() => (scheduleData && draftActive ? renderList(scheduleData, draftOps) : null), [scheduleData, draftOps, draftActive]);
    const draftStatus = React.useMemo(() => (scheduleData && draftActive ? solveDraft(scheduleData, draftOps, new Date(), scheduleData.settings) : null), [scheduleData, draftOps, draftActive]);
    const calendarAppointments = draftRender ? draftRender.appointments : (scheduleData?.appointments || []);
    const calendarMarks = draftRender ? draftRender.marks : undefined;
    // Measure the header height (for the portrait fixed-header layout) and keep
    // it updated if the content/safe-area changes (e.g. data load changes toolbar).
    useEffect(() => {
        const el = headerRef.current;
        if (!el)
            return;
        const ro = new ResizeObserver(() => {
            setHeaderHeight(el.offsetHeight);
        });
        ro.observe(el);
        setHeaderHeight(el.offsetHeight);
        return () => ro.disconnect();
    });
    const handleMainScroll = (e) => {
        mainScrollLastRef.current = e.currentTarget.scrollTop;
    };
    // On narrow screens the right-side detail panel wraps below the calendar.
    // When the user taps an appointment, scroll the detail into view so they
    // notice it actually opened.
    useEffect(() => {
        if (selectedAppointment) {
            setPanelCollapsed(false); // auto-expand right panel when an appointment is opened
            if (detailPanelRef.current) {
                detailPanelRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }
    }, [selectedAppointment]);
    // A new selection (or clearing it) always starts on the read-only detail, not
    // mid-edit, so the panel collapses back from any prior expanded edit form.
    useEffect(() => { setInlineEdit(false); }, [selectedAppointment?.id]);
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
        // Seal the key under the unlocked PIN so it persists across cold launches.
        // (Native + unlocked only; web has no at-rest store.)
        const pin = unlockedPinRef.current;
        if (isNative && pin) {
            if (settings.apiKey)
                void saveAIConfig({ apiKey: settings.apiKey, model: settings.model, schedulePassword: settings.schedulePassword }, pin);
            else
                void clearAIConfig();
        }
    };
    const handleClearKey = () => {
        const cleared = { ...aiSettings, apiKey: '' };
        setAiSettings(cleared);
        saveSessionSettings(cleared);
        if (isNative)
            void clearAIConfig();
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
            // Route through the saver so the imported key is also sealed under the PIN
            // at rest (native) — otherwise it would survive this session but not a
            // cold launch, the same gap that made keys feel "not maintained".
            handleAISettingsSave(restored);
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
    // Decide the cold-launch lock state. Native always lands locked: into "create"
    // mode if no PIN exists yet (first run), otherwise "unlock". Web has no lock.
    // All three reads are independent so we fire them in parallel to minimize the
    // time to first render of the PIN screen.
    useEffect(() => {
        if (!isNative)
            return;
        (async () => {
            const [has, biometry, faceIdOn] = await Promise.all([
                hasPin(),
                checkBiometryFull(),
                isFaceIdEnabled(),
            ]);
            setLockMode(has ? 'unlock' : 'create');
            setFaceIdAvailable(biometry.available);
            if (biometry.available)
                setBiometryLabel(biometry.label);
            setFaceIdEnabled(faceIdOn);
            setLocked(true);
            setLockReady(true);
        })();
    }, [isNative]);
    // Restore the at-rest schedule with the just-entered PIN and drop the gate.
    const unlockWith = async (pin) => {
        unlockedPinRef.current = pin;
        const restored = await loadSchedule(pin);
        if (restored) {
            setNativeStore(restored);
            commitFull(restored);
        }
        // Recover the API key + model that were sealed under this same PIN, so the
        // key is "maintained" across cold launches without ever sitting in plaintext.
        const aiConfig = await loadAIConfig(pin);
        if (aiConfig?.apiKey) {
            const restoredSettings = {
                ...aiSettings,
                apiKey: aiConfig.apiKey,
                model: aiConfig.model || aiSettings.model || 'claude-sonnet-4-6',
                schedulePassword: aiConfig.schedulePassword,
            };
            setAiSettings(restoredSettings);
            saveSessionSettings(restoredSettings);
        }
        setLocked(false);
    };
    const handleCreatePin = async (pin) => {
        await setPin(pin);
        unlockedPinRef.current = pin;
        setLockMode('unlock');
        setLocked(false);
    };
    const handleVerifyPin = async (pin) => {
        if (!(await verifyPin(pin)))
            return false;
        await unlockWith(pin);
        return true;
    };
    const handleBiometricUnlock = async () => {
        if (!(await biometricAuthenticate('Unlock ABA Schedule')))
            return false;
        const pin = await recoverPinViaBiometric();
        if (!pin)
            return false;
        await unlockWith(pin);
        return true;
    };
    // Re-key to a new PIN from inside the app (already authenticated by being in).
    const handleChangePin = async (pin) => {
        await changePin(pin, scheduleData);
        // Re-seal the AI config under the new PIN so it stays recoverable on unlock.
        if (aiSettings.apiKey)
            await saveAIConfig({ apiKey: aiSettings.apiKey, model: aiSettings.model, schedulePassword: aiSettings.schedulePassword }, pin);
        else
            await clearAIConfig();
        unlockedPinRef.current = pin;
        setChangingPin(false);
    };
    const handleToggleFaceId = async (on) => {
        if (on) {
            const pin = unlockedPinRef.current;
            if (!pin)
                return;
            if (!(await biometricAuthenticate('Enable Face ID for ABA Schedule')))
                return;
            await enableFaceId(pin);
            setFaceIdEnabled(true);
        }
        else {
            await disableFaceId();
            setFaceIdEnabled(false);
        }
    };
    // Re-auth gate for revealing/replacing the stored API key. On native the key
    // is sealed under the PIN, so replacing it requires the same proof that opens
    // the app: Face ID (if enabled) or the PIN. Web has no lock, so it's allowed
    // outright. Returns true when the user is authorized to edit the key.
    const authenticateForKey = async () => {
        if (!isNative)
            return true;
        if (faceIdEnabled && await biometricAuthenticate('Unlock to replace API key'))
            return true;
        const pin = await askPassword('Enter your PIN', 'Enter your app PIN to replace the saved Claude API key.', { placeholder: 'App PIN', submitLabel: 'Unlock' });
        if (!pin)
            return false;
        return verifyPin(pin);
    };
    // Persist the schedule (encrypted under the unlocked PIN) on every change, so
    // the next cold launch restores exactly this state. Native + unlocked only.
    // Debounced so a burst of edits (e.g. a calendar drag) coalesces into one
    // PBKDF2 + encrypt pass rather than one per keystroke.
    useEffect(() => {
        if (!isNative || locked)
            return;
        const pin = unlockedPinRef.current;
        if (!pin || !scheduleData)
            return;
        const t = setTimeout(() => { void saveSchedule(scheduleData, pin); }, 400);
        return () => clearTimeout(t);
    }, [scheduleData, locked, isNative]);
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
                    || (await askPassword('Schedule is password-protected', 'Enter the schedule password to open this file.')) || '';
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
                // An encrypted file in → re-encrypt on export with the same password by
                // default, so a round-trip stays protected without re-entering it.
                if (password !== aiSettings.schedulePassword) {
                    handleAISettingsSave({ ...aiSettings, schedulePassword: password });
                }
            }
            // Parse client-side (cheap, pure) — same parser the server/native use.
            // Dynamic import keeps SheetJS (~800 KB) out of the critical startup bundle.
            const [{ default: XLSX }, { parseWorkbook }] = await Promise.all([import('xlsx'), import('./excelHandler')]);
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
    // Wish It: Accept applies the whole solution (ops + any blackouts); Customize
    // loads the appointment ops into the editable draft (and commits any blackouts,
    // which aren't editable in the tray) so the BCBA can tweak before accepting.
    const acceptWish = async (sol) => {
        if (!scheduleData)
            return;
        await commitScheduleData(applyWishSolution(scheduleData, sol));
        setView('schedule');
        setSelectedAppointment(null);
    };
    const customizeWish = (sol) => {
        if (!scheduleData)
            return;
        const { ops, blackouts } = wishSolutionToDraft(sol, scheduleData);
        if (blackouts.length)
            commitScheduleData({ ...scheduleData, blackouts: [...(scheduleData.blackouts || []), ...blackouts] });
        stageOps(ops);
        setView('schedule');
    };
    // "Fix It" produces WishSolutions too, so accept/customize reuse the Wish
    // plumbing — but they live on the Compliance tab, so after staging we jump to
    // the Schedule view where the draft tray (Customize) or the committed change
    // (Accept) is visible.
    const acceptFix = async (sol) => {
        if (!scheduleData)
            return;
        await commitScheduleData(applyWishSolution(scheduleData, sol));
        setView('schedule');
    };
    const customizeFix = (sol) => {
        if (!scheduleData)
            return;
        const { ops, blackouts } = wishSolutionToDraft(sol, scheduleData);
        if (blackouts.length)
            commitScheduleData({ ...scheduleData, blackouts: [...(scheduleData.blackouts || []), ...blackouts] });
        stageOps(ops);
        setView('schedule');
    };
    // "Clear loaded data" (Admin → Settings). Drops the working schedule from the
    // UI and returns to the upload/wizard empty state. The user is nudged to
    // download first since this is destructive for unsaved changes.
    const handleClearData = () => {
        if (!confirm('Clear all loaded schedule data from the app? Download your schedule first if you haven\'t saved it — this cannot be undone.'))
            return;
        setScheduleData(null);
        setCompCache(null);
        setConflicts([]);
        setSolutions([]);
        setDraftOps([]);
        setSelectedAppointment(null);
        setView('schedule');
    };
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
    const handleSaveAppointments = async (apps) => {
        if (apps.length === 0 || !scheduleData)
            return;
        const ops = apps.map(a => scheduleData.appointments.some(x => x.id === a.id) ? newMoveOp(a) : newAddOp(a));
        // Historical sessions already happened — there's nothing to reschedule. When
        // every staged session is in the past, solveDraft grades it purely on hard
        // timeslot conflicts (two billable activities can't share a slot). If it
        // comes back clean (green), commit straight away so compliance/goals update
        // without a draft round-trip; a blocking overlap still falls through to the
        // tray for the user to resolve.
        const nowMs = Date.now();
        const allPast = ops.every(o => {
            const iso = o.appt?.startTime;
            return !!iso && new Date(iso).getTime() < nowMs;
        });
        if (allPast) {
            const status = solveDraft(scheduleData, ops, new Date(), scheduleData.settings);
            if (status.grade === 'green') {
                await commitScheduleData(status.resolved || applyOps(scheduleData, ops));
                setSelectedAppointment(null);
                setShowAddAppointment(false);
                setEditingAppointment(null);
                return;
            }
        }
        stageOps(ops);
        setShowAddAppointment(false);
        setEditingAppointment(null);
        setInlineEdit(false);
    };
    // Delete → stage remove op(s) (a tombstone shows in the preview until commit).
    const handleDeleteAppointments = (ids) => {
        if (ids.length === 0 || !scheduleData)
            return;
        stageOps(ids.map(id => newRemoveOp(id)));
        if (selectedAppointment && ids.includes(selectedAppointment.id))
            setSelectedAppointment(null);
        setEditingAppointment(null);
        setInlineEdit(false);
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
    const compactBtn = (label, ariaLabel, onClick, color = '#374151', disabled = false) => (_jsx("button", { onClick: onClick, "aria-label": ariaLabel, title: ariaLabel, disabled: disabled, style: {
            padding: '5px 9px',
            backgroundColor: disabled ? '#4b5563' : color,
            color: disabled ? '#9ca3af' : 'white',
            border: 'none',
            borderRadius: 5,
            cursor: disabled ? 'not-allowed' : 'pointer',
            fontSize: 13,
            fontWeight: 600,
            whiteSpace: 'nowrap',
            lineHeight: 1.2,
            opacity: disabled ? 0.6 : 1,
        }, children: label }));
    // Brief dark splash while we decide whether to lock — avoids flashing the
    // (empty) main UI before the gate appears on native.
    if (!lockReady) {
        return _jsx("div", { style: { position: 'fixed', inset: 0, backgroundColor: '#1f2937' } });
    }
    if (locked) {
        return (_jsx(LockScreen, { mode: lockMode, onCreate: handleCreatePin, onVerify: handleVerifyPin, onBiometric: lockMode === 'unlock' && faceIdEnabled && faceIdAvailable ? handleBiometricUnlock : undefined, biometricAuto: true, biometryLabel: biometryLabel }));
    }
    // The selected-appointment detail card. Extracted so it can render either in
    // the on-demand narrow pane or pinned to the bottom of the docked wide pane.
    const renderSelectedDetail = (a) => {
        const status = a.status || 'scheduled';
        const locked = status === 'canceled' || status === 'completed';
        const statusColor = status === 'canceled' ? '#b91c1c' : status === 'completed' ? '#15803d' : '#374151';
        const statusBg = status === 'canceled' ? '#fee2e2' : status === 'completed' ? '#dcfce7' : '#f3f4f6';
        return (_jsxs("div", { style: { padding: '16px', borderTop: '1px solid #e5e7eb' }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', gap: 8 }, children: [_jsx("h3", { style: { margin: 0 }, children: "Selected Appointment" }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8 }, children: [_jsx("span", { style: {
                                        fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
                                        color: statusColor, backgroundColor: statusBg,
                                        padding: '2px 8px', borderRadius: 10,
                                    }, children: status }), _jsx("button", { onClick: () => setSelectedAppointment(null), "aria-label": "Close", style: {
                                        background: 'none', border: 'none', color: '#6b7280',
                                        fontSize: 20, lineHeight: 1, cursor: 'pointer', padding: 4,
                                    }, children: "\u2715" })] })] }), _jsx("p", { children: _jsx("strong", { children: a.title }) }), _jsxs("p", { style: { fontSize: '12px', color: '#6b7280', marginTop: '4px' }, children: [new Date(a.startTime).toLocaleString(), " \u2192 ", new Date(a.endTime).toLocaleString()] }), a.technician && (_jsxs("p", { style: { fontSize: '12px', color: '#374151', marginTop: '4px' }, children: ["Tech: ", a.technician] })), (status === 'canceled' || status === 'completed') && (_jsx("p", { style: { color: '#6b7280', marginTop: '4px', fontSize: 12 }, children: "\uD83D\uDD12 Locked \u2014 reopen to edit time, status, or assignment" })), a.cancellation && (_jsxs("div", { style: { fontSize: 12, color: '#6b7280', marginTop: 6, lineHeight: 1.5 }, children: [_jsxs("div", { children: ["Source: ", _jsxs("strong", { children: ["Cancel-", a.cancellation.source.toUpperCase()] })] }), _jsxs("div", { children: ["Reason: ", _jsx("strong", { children: cancellationReasonLabel(a.cancellation.reason, scheduleData?.settings) })] }), _jsxs("div", { children: [a.cancellation.unplanned ? 'Unplanned' : 'Planned', " \u00B7 notice met: ", _jsx("strong", { children: a.cancellation.noticeMet ? 'yes' : 'no' })] }), a.cancellation.notes && _jsxs("div", { children: ["Notes: ", a.cancellation.notes] })] })), (() => {
                    const apptConflicts = conflicts.filter(c => c.affectedAppointments?.includes(a.id));
                    const dismissed = apptConflicts.filter(c => confirmedSet.has(conflictKey(c)));
                    const muted = apptConflicts.filter(c => mutedSet.has(conflictKey(c)));
                    const conflictTitle = (c) => {
                        if (c.type === 'availability-conflict')
                            return 'Availability Conflict';
                        if (c.type === 'training-violation')
                            return c.message.toLowerCase().includes('below') ? 'PT Below Minimum' : 'PT Over Maximum';
                        if (c.type === 'supervision-violation')
                            return 'Supervision Gap';
                        return c.message.split(':')[0].trim() || c.type;
                    };
                    return (_jsxs(_Fragment, { children: [dismissed.length > 0 && (_jsxs("details", { style: { marginTop: 10, fontSize: 12 }, children: [_jsxs("summary", { style: { cursor: 'pointer', color: '#6b7280', fontWeight: 600 }, children: ["Dismissed Issues (", dismissed.length, ")"] }), _jsx("div", { style: { paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }, children: dismissed.map((c, i) => (_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, background: '#f9fafb', borderRadius: 4, padding: '4px 8px' }, children: [_jsx("span", { style: { color: '#374151' }, children: conflictTitle(c) }), _jsx("button", { onClick: () => unconfirmConflict(conflictKey(c)), style: { border: '1px solid #d1d5db', borderRadius: 4, background: 'white', cursor: 'pointer', fontSize: 11, padding: '2px 6px' }, children: "Un-dismiss" })] }, i))) })] })), muted.length > 0 && (_jsxs("details", { style: { marginTop: 6, fontSize: 12 }, children: [_jsxs("summary", { style: { cursor: 'pointer', color: '#6b7280', fontWeight: 600 }, children: ["Muted Issues (", muted.length, ")"] }), _jsx("div", { style: { paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }, children: muted.map((c, i) => (_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, background: '#f9fafb', borderRadius: 4, padding: '4px 8px' }, children: [_jsx("span", { style: { color: '#374151' }, children: conflictTitle(c) }), _jsx("button", { onClick: () => unmuteConflict(conflictKey(c)), style: { border: '1px solid #d1d5db', borderRadius: 4, background: 'white', cursor: 'pointer', fontSize: 11, padding: '2px 6px' }, children: "Un-mute" })] }, i))) })] }))] }));
                })(), a.isGhost ? (_jsxs("div", { style: { display: 'flex', gap: '6px', marginTop: '12px', flexWrap: 'wrap' }, children: [_jsx("button", { onClick: () => promoteGhost(a), style: {
                                flex: '1 1 auto', padding: '6px 12px', backgroundColor: '#3b82f6', color: 'white',
                                border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
                            }, children: "Promote" }), _jsx("button", { onClick: () => dismissGhost(a), style: {
                                flex: '1 1 auto', padding: '6px 12px', backgroundColor: 'white', color: '#6b7280',
                                border: '1px solid #d1d5db', borderRadius: '4px', cursor: 'pointer', fontSize: '13px',
                            }, children: "Dismiss" })] })) : (_jsxs("div", { style: { display: 'flex', gap: '6px', marginTop: '12px', flexWrap: 'wrap' }, children: [_jsx("button", { onClick: () => !locked && setInlineEdit(true), disabled: locked, title: locked ? 'Reopen to edit' : undefined, style: {
                                flex: '1 1 auto', padding: '6px 12px',
                                backgroundColor: locked ? '#e5e7eb' : '#3b82f6', color: locked ? '#9ca3af' : 'white',
                                border: 'none', borderRadius: '4px', cursor: locked ? 'not-allowed' : 'pointer', fontSize: '13px',
                            }, children: "Edit" }), status === 'scheduled' && (_jsxs(_Fragment, { children: [_jsx(CompleteTimePrompt, { a: a, onComplete: handleMarkComplete }, a.id), _jsx("button", { onClick: () => setCancelTarget(a), style: {
                                        flex: '1 1 auto', padding: '6px 12px', backgroundColor: '#fee2e2', color: '#b91c1c',
                                        border: '1px solid #fca5a5', borderRadius: '4px', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
                                    }, children: "\u2715 Cancel" })] })), (status === 'completed' || status === 'canceled') && (_jsx("button", { onClick: () => handleReopen(a), style: {
                                flex: '1 1 auto', padding: '6px 12px', backgroundColor: 'white', color: '#374151',
                                border: '1px solid #d1d5db', borderRadius: '4px', cursor: 'pointer', fontSize: '13px',
                            }, children: "Reopen" })), _jsx("button", { onClick: () => handleDeleteAppointment(a.id), style: {
                                padding: '6px 12px', backgroundColor: 'white', color: '#6b7280',
                                border: '1px solid #d1d5db', borderRadius: '4px', cursor: 'pointer', fontSize: '13px',
                            }, children: "Delete" })] }))] }));
    };
    // The bottom region of the context panel: the read-only detail, or — once the
    // user taps Edit — the inline edit form (same component as the add modal, just
    // rendered to fill the expanded panel instead of a popup).
    const renderDetailOrEdit = (a) => {
        const locked = a.status === 'canceled' || a.status === 'completed';
        if (inlineEdit && !locked && scheduleData) {
            return (_jsx(AppointmentForm, { variant: "inline", appointment: a, allAppointments: scheduleData.appointments, authorizations: scheduleData.authorizations, technicians: scheduleData.technicians, clients: scheduleData.clients, settings: scheduleData.settings, onSave: handleSaveAppointments, onDelete: handleDeleteAppointments, onCancel: () => setInlineEdit(false) }));
        }
        return renderSelectedDetail(a);
    };
    return (_jsxs("div", { style: {
            display: 'flex', height: '100vh', maxWidth: '100vw',
            overflowX: 'hidden', flexDirection: 'column',
            // Side insets matter on landscape iPhones with a notch so chrome
            // doesn't slip under the camera housing.
            paddingLeft: 'env(safe-area-inset-left)',
            paddingRight: 'env(safe-area-inset-right)',
        }, children: [_jsxs("header", { ref: headerRef, style: {
                    backgroundColor: '#1f2937',
                    color: 'white',
                    // Top padding includes the iOS status bar / notch inset so the
                    // title doesn't sit under the time/carrier indicators.
                    padding: 'calc(env(safe-area-inset-top) + 6px) 12px 6px',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                    // Both orientations: sticky/fixed at top, never scrolls off-screen.
                    position: isLandscape ? 'sticky' : 'fixed',
                    top: 0,
                    left: isLandscape ? undefined : 0,
                    right: isLandscape ? undefined : 0,
                    width: isLandscape ? undefined : '100%',
                    zIndex: 10,
                    flexShrink: 0,
                    boxSizing: 'border-box',
                }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }, children: [_jsx("img", { src: "/logo.png", alt: "SAssi", style: { width: 22, height: 22, borderRadius: 5, flexShrink: 0 } }), _jsx("h1", { style: { fontSize: '14px', fontWeight: 700, margin: 0, whiteSpace: 'nowrap' }, children: "SAssi - ABA Calendar" }), _jsx("span", { title: aiSettings.apiKey ? `AI: ${aiSettings.model}` : 'No AI key set — add in Settings', style: {
                                    width: 8, height: 8, borderRadius: '50%',
                                    backgroundColor: aiSettings.apiKey ? '#10b981' : '#ef4444',
                                    display: 'inline-block', flexShrink: 0,
                                } })] }), _jsx("div", { style: { display: 'flex', gap: '4px', alignItems: 'center' }, children: !scheduleData ? (_jsxs(_Fragment, { children: [compactBtn('Wizard', 'Setup Wizard', () => setShowWizard(true), '#8b5cf6'), _jsx(FileUpload, { onUpload: handleFileUpload, loading: loading })] })) : (_jsx(NavButtons, { view: view, onChange: setView, compSummary: compSummary, conflictCount: activeConflicts.length, conflictHasError: activeConflicts.some(c => c.severity === 'error') })) })] }), _jsx("div", { onScroll: handleMainScroll, style: {
                    display: 'flex', flex: 1, minHeight: 0,
                    // Narrow / non-schedule views keep a single scroll region for the whole
                    // post-header area: each child reports its natural height instead of
                    // carving out its own scrollbox — this fixes the "stuck mid-page" trap
                    // on iPhone where the calendar and issues pane were independent scroll
                    // panes and tapping ✕ on the appointment panel left no way to scroll up.
                    // On wide schedule view we split instead: the calendar and the docked
                    // pane each scroll independently inside a bounded height, so the pane's
                    // violations list fills the space and the appointment detail can open
                    // below it without growing the page.
                    flexWrap: splitView ? 'nowrap' : 'wrap',
                    overflowY: splitView ? 'hidden' : 'auto',
                    overflowX: 'hidden',
                    WebkitOverflowScrolling: 'touch',
                    paddingBottom: splitView ? 0 : 'env(safe-area-inset-bottom)',
                    // Fixed header in portrait mode: push content down so it doesn't hide
                    // behind the header. In landscape the header is sticky (in flow).
                    paddingTop: isLandscape ? 0 : headerHeight,
                }, children: scheduleData ? (_jsxs(_Fragment, { children: [view === 'schedule' && (_jsxs(_Fragment, { children: [_jsxs("div", { style: {
                                        flex: '1 1 320px', minWidth: 0,
                                        ...(splitView ? { overflowY: 'auto', minHeight: 0, WebkitOverflowScrolling: 'touch' } : {}),
                                    }, children: [pendingReview.length > 0 && (_jsxs("button", { onClick: () => setShowDayReview(true), style: {
                                                display: 'block', width: 'calc(100% - 16px)', margin: '8px',
                                                padding: '8px 12px', backgroundColor: '#fef3c7',
                                                border: '1px solid #fcd34d', borderRadius: 6, cursor: 'pointer',
                                                fontSize: 13, fontWeight: 600, color: '#92400e', textAlign: 'left',
                                            }, children: ["\uD83D\uDCCB ", pendingReview.length, " past session", pendingReview.length === 1 ? '' : 's', " awaiting review \u2014 complete or cancel them"] })), _jsx(Calendar, { appointments: calendarAppointments, technicians: scheduleData.technicians, clients: scheduleData.clients, settings: scheduleData.settings, timeOff: scheduleData.timeOff, onAppointmentChange: handleAppointmentChange, onSelectAppointment: setSelectedAppointment, onViewDateChange: setViewDate, onLensChange: setCalLens, hideTotals: dockPane, draftMarks: calendarMarks, onAddAppointment: () => setShowAddAppointment(true) })] }), (() => {
                                    // Draft tray / conflicts / AI options / idle agenda — the
                                    // middle of the docked pane (and the only content of the narrow
                                    // in-flow pane; the selected appointment is a slide-up sheet there).
                                    const middle = (_jsxs(_Fragment, { children: [draftActive && draftStatus && (_jsx(DraftTray, { base: scheduleData, ops: draftOps, status: draftStatus, hasApiKey: !!aiSettings.apiKey, aiLoading: aiLoading, onResetOp: resetOp, onResetAll: cancelDraft, onCancel: cancelDraft, onAccept: acceptDraft, onSaveAnyway: saveAnyway, onAI: runDraftAI, onPickChoice: pickChoice, onLogGhosts: logAddsAsGhosts })), !draftActive && visibleConflicts.length > 0 && (_jsx(ConflictPanel, { conflicts: visibleConflicts, appointments: scheduleData?.appointments, onSelectAppointment: setSelectedAppointment, fill: splitView && solutions.length === 0, mutedKeys: mutedConflicts, onMute: muteConflict, onUnmute: unmuteConflict, onConfirmDismiss: confirmDismissConflict })), solutions.length > 0 && (_jsx(SolutionPanel, { solutions: solutions, heading: "AI options (within the month)", onAccept: acceptAiSolution, onCustomize: customizeAiSolution, onReject: rejectAiSet })), !draftActive && visibleConflicts.length === 0 && solutions.length === 0 && !selectedAppointment && (_jsx(AgendaRail, { appointments: scheduleData.appointments, date: viewDate, onSelect: setSelectedAppointment }))] }));
                                    // Wide: a frozen, full-height pane. Totals pinned to the top
                                    // (≤25%), conflicts/agenda filling the remaining ~75%, and the
                                    // selected appointment sliding up from the bottom — 25% for the
                                    // read-only detail, expanding to 50% (shrinking the middle) for
                                    // inline edits, all animated. Overflow in any band scrolls
                                    // within the band, never growing the frozen pane.
                                    if (splitView) {
                                        const canCollapse = true;
                                        const collapsed = panelCollapsed;
                                        return (_jsxs("div", { style: {
                                                position: 'relative',
                                                flex: '0 0 auto',
                                                width: collapsed ? 20 : 400,
                                                transition: 'width 0.25s ease',
                                                minHeight: 0, height: '100%',
                                                overflow: 'hidden',
                                            }, children: [canCollapse && (_jsx("button", { onClick: () => setPanelCollapsed(c => !c), "aria-label": collapsed ? 'Expand panel' : 'Collapse panel', style: {
                                                        position: 'absolute', left: 0, top: 40,
                                                        width: 20, height: 48, zIndex: 20,
                                                        clipPath: 'polygon(100% 0%, 0% 50%, 100% 100%)',
                                                        backgroundColor: '#94a3b8',
                                                        border: 'none', cursor: 'pointer', padding: 0,
                                                    } })), _jsxs("div", { ref: detailPanelRef, style: {
                                                        position: 'absolute',
                                                        left: 20, top: 0, bottom: 0,
                                                        width: 380,
                                                        borderLeft: '1px solid #e5e7eb',
                                                        display: 'flex', flexDirection: 'column',
                                                        minHeight: 0, overflow: 'hidden',
                                                    }, children: [!draftActive && (_jsx("div", { style: { flexShrink: 0, maxHeight: 'max(160px, 25%)', overflowY: 'auto', padding: '10px 14px', borderBottom: '1px solid #e5e7eb', WebkitOverflowScrolling: 'touch' }, children: _jsx(HoursSummary, { appointments: calendarAppointments, lens: calLens, settings: scheduleData.settings, timeOff: scheduleData.timeOff, currentDate: viewDate }) })), _jsx("div", { style: { flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }, children: middle }), _jsx("div", { style: {
                                                                flexShrink: 0, overflow: 'hidden',
                                                                display: 'flex', flexDirection: 'column',
                                                                borderTop: selectedAppointment ? '1px solid #e5e7eb' : 'none',
                                                                maxHeight: selectedAppointment ? (inlineEdit ? '50%' : '25%') : 0,
                                                                transition: 'max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                                            }, children: _jsx("div", { style: { flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }, children: selectedAppointment && renderDetailOrEdit(selectedAppointment) }) })] })] }));
                                    }
                                    // Narrow: issues flow under the calendar (the selected
                                    // appointment is handled by the slide-up sheet below).
                                    if (draftActive || visibleConflicts.length > 0 || solutions.length > 0) {
                                        return (_jsx("div", { ref: detailPanelRef, style: {
                                                flex: '0 0 auto', width: 'min(350px, 100%)', borderLeft: '1px solid #e5e7eb',
                                                display: 'flex', flexDirection: 'column',
                                            }, children: middle }));
                                    }
                                    return null;
                                })(), !splitView && (_jsx("div", { style: {
                                        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 1050,
                                        background: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16,
                                        boxShadow: selectedAppointment ? '0 -6px 24px rgba(0,0,0,0.18)' : 'none',
                                        display: 'flex', flexDirection: 'column', overflow: 'hidden',
                                        maxHeight: selectedAppointment ? (inlineEdit ? '92vh' : '60vh') : 0,
                                        transform: selectedAppointment ? 'translateY(0)' : 'translateY(100%)',
                                        transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                        paddingBottom: 'env(safe-area-inset-bottom)',
                                    }, children: _jsx("div", { style: { flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }, children: selectedAppointment && renderDetailOrEdit(selectedAppointment) }) }))] })), view === 'admin' && (_jsx(AdminPanel, { data: scheduleData, onDataChange: commitFull, onImportFile: triggerImportPicker, onRerunWizard: () => setShowWizard(true), onDownload: handleDownload, onClearData: handleClearData })), view === 'compliance' && (_jsx(ComplianceDashboard, { data: scheduleData, cache: compCache, conflicts: visibleConflicts, aiSettings: aiSettings, mutedConflictKeys: mutedConflicts, onMuteConflict: muteConflict, onUnmuteConflict: unmuteConflict, onConfirmDismissConflict: confirmDismissConflict, onMarkComplete: handleMarkComplete, onRequestCancel: (a) => setCancelTarget(a), onSelectAppointment: (a) => { setView('schedule'); setSelectedAppointment(a); }, onAcceptFix: acceptFix, onCustomizeFix: customizeFix })), view === 'caseload' && (_jsx(CaseloadView, { data: scheduleData, now: viewDate })), view === 'wish' && (_jsx(WishComposer, { data: scheduleData, aiSettings: aiSettings, onAccept: acceptWish, onCustomize: customizeWish, onClose: () => setView('schedule') }))] })) : (_jsxs("div", { style: {
                        flex: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#9ca3af',
                        flexDirection: 'column',
                        gap: '16px',
                        padding: '0 24px',
                        textAlign: 'center',
                    }, children: [_jsx("p", { children: "Upload an Excel file or run the Setup Wizard to get started." }), _jsxs("p", { style: { fontSize: '12px', maxWidth: '320px' }, children: ["A sample schedule (", _jsx("code", { children: "sample_schedule.xlsx" }), ") is in this app's Documents folder \u2014 pick it from Files via Upload Schedule."] }), debugMsg && (_jsx("p", { style: { fontSize: '12px', color: '#b91c1c', maxWidth: '320px', backgroundColor: '#fee2e2', padding: '8px', borderRadius: '4px' }, children: debugMsg })), _jsxs("p", { style: { fontSize: '10px', color: '#d1d5db', fontFamily: 'monospace' }, children: ["build ", BUILD_STAMP, " \u00B7 native ", String(Capacitor.isNativePlatform())] })] })) }), showWizard && (_jsx(SetupWizard, { onComplete: handleWizardComplete, onCancel: () => setShowWizard(false), initialData: scheduleData || undefined })), _jsx("input", { ref: importInputRef, type: "file", accept: ".xlsx,.xls", style: { display: 'none' }, onChange: e => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file)
                        handleFileUpload(file);
                } }), pendingImport && scheduleData && (_jsx(ImportPreview, { current: scheduleData, next: pendingImport.data, fileName: pendingImport.fileName, onConfirm: confirmPendingImport, onCancel: () => setPendingImport(null) })), cancelTarget && scheduleData && (_jsx(CancellationDialog, { appointment: cancelTarget, settings: scheduleData.settings, onConfirm: handleConfirmCancel, onCancel: () => setCancelTarget(null) })), showAddAppointment && scheduleData && (_jsx(AppointmentForm, { allAppointments: scheduleData.appointments, authorizations: scheduleData.authorizations, technicians: scheduleData.technicians, clients: scheduleData.clients, settings: scheduleData.settings, initialType: calLens === 'bcba' ? 'supervision' : 'client-session', onSave: handleSaveAppointments, onCancel: () => setShowAddAppointment(false) })), editingAppointment && scheduleData && (_jsx(AppointmentForm, { appointment: editingAppointment, allAppointments: scheduleData.appointments, authorizations: scheduleData.authorizations, technicians: scheduleData.technicians, clients: scheduleData.clients, settings: scheduleData.settings, onSave: handleSaveAppointments, onDelete: handleDeleteAppointments, onCancel: () => setEditingAppointment(null) })), showDayReview && scheduleData && (_jsx(DayReview, { appointments: pendingReview, onComplete: handleMarkComplete, onRequestCancel: (a) => setCancelTarget(a), onClose: () => setShowDayReview(false) })), pwPrompt && (_jsx(PasswordPrompt, { title: pwPrompt.title, message: pwPrompt.message, placeholder: pwPrompt.placeholder, submitLabel: pwPrompt.submitLabel, onSubmit: (pw) => resolvePassword(pw), onCancel: () => resolvePassword(null) })), changingPin && (_jsx(LockScreen, { mode: "create", onCreate: handleChangePin }))] }));
}
// Three-way segmented control for the active view. Sits inline in the header
// at compact-button size so it doesn't blow up the chrome.
function NavButtons({ view, onChange, compSummary, conflictCount, conflictHasError }) {
    const compRed = compSummary?.red ?? 0;
    const compYellow = compSummary?.yellow ?? 0;
    const badgeCount = (conflictCount ?? 0) + compRed + compYellow;
    const badgeColor = (conflictHasError || compRed > 0) ? '#ef4444'
        : badgeCount > 0 ? '#f59e0b' : '#10b981';
    const btn = (label, key, badge) => {
        const active = view === key;
        return (_jsxs("button", { onClick: () => onChange(key), "aria-label": label, title: label, style: {
                padding: '5px 10px', border: 'none', borderRadius: 5,
                backgroundColor: active ? '#6366f1' : '#374151',
                color: 'white', cursor: 'pointer',
                fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
                display: 'inline-flex', alignItems: 'center', gap: 4,
            }, children: [badge, label] }, key));
    };
    return (_jsxs(_Fragment, { children: [btn('📅 Cal', 'schedule'), btn('Fix', 'compliance', (_jsx("span", { style: {
                    minWidth: 18, height: 18, padding: '0 4px', borderRadius: 9,
                    backgroundColor: badgeColor, color: 'white',
                    fontSize: 11, fontWeight: 700,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }, children: badgeCount }))), btn('✨Wish', 'wish'), btn('⚙️Admin', 'admin')] }));
}
//# sourceMappingURL=app.js.map