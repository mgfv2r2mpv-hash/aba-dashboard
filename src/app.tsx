import React, { useState, useEffect } from 'react';
import axios from 'axios';
import * as XLSX from 'xlsx';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { parseWorkbook } from './excelHandler';
import { ConstraintValidator } from './constraintValidator';
import { installNativeAdapter, setCurrentData as setNativeStore } from './nativeApi';
import { ScheduleData, Appointment, ScheduleConflict, ScheduleSolution, Cancellation, cancellationReasonLabel } from './types';
import Calendar, { HoursSummary } from './components/Calendar';
import ConflictPanel from './components/ConflictPanel';
import SolutionPanel from './components/SolutionPanel';
import AdminPanel from './components/AdminPanel';
import ComplianceDashboard from './components/ComplianceDashboard';
import CaseloadView from './components/CaseloadView';
import FileUpload from './components/FileUpload';
import Settings, { AISettings, ClaudeModel } from './components/Settings';
import AppointmentForm from './components/AppointmentForm';
import SetupWizard from './components/SetupWizard';
import CancellationDialog from './components/CancellationDialog';
import DayReview from './components/DayReview';
import CompleteTimePrompt from './components/CompleteTimePrompt';
import AgendaRail from './components/AgendaRail';
import ImportPreview from './components/ImportPreview';
import { useMinWidth, useIsTablet } from './useMediaQuery';
import LockScreen from './components/LockScreen';
import PasswordPrompt from './components/PasswordPrompt';
import {
  hasPin, setPin, verifyPin, changePin,
  saveSchedule, loadSchedule,
  isFaceIdEnabled, enableFaceId, disableFaceId, recoverPinViaBiometric,
} from './appLock';
import { isBiometricAvailable, biometricAuthenticate } from './biometric';
import { pastIncompleteAppointments } from './compliance';
import {
  ComplianceCache, ComplianceSummary, ApptChange,
  buildCache, recomputeCache, summarize,
} from './complianceCache';
import {
  obfuscateKey, deobfuscateKey, encryptBytes, decryptBytes, isEncryptedSchedule,
} from './clientCrypto';
import {
  DraftOp, applyOps, renderList, newAddOp, newMoveOp, newShortenOp, newRemoveOp,
} from './draft';
import { solveDraft, DraftStatus, PrioritizationChoice } from './draftSolver';
import DraftTray from './components/DraftTray';
import { ClaudeScheduler } from './claudeScheduler';

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

// Local-day ISO without timezone suffix — matches the seeder/Calendar format so
// `startTime.startsWith('YYYY-MM-DD')` filters keep working.
function formatLocalISO(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// Apply an AI solution's time-move changes onto a schedule (pure).
function applySolutionChanges(data: ScheduleData, sol: ScheduleSolution): ScheduleData {
  const appointments = data.appointments.map(a => {
    const ch = sol.changes.find(c => c.appointmentId === a.id);
    return ch ? { ...a, startTime: ch.newTime.start, endTime: ch.newTime.end } : a;
  });
  return { ...data, appointments };
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
  const [view, setView] = useState<'schedule' | 'admin' | 'compliance' | 'caseload'>('schedule');
  const [showSettings, setShowSettings] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [showAddAppointment, setShowAddAppointment] = useState(false);
  const [editingAppointment, setEditingAppointment] = useState<Appointment | null>(null);
  // Whether the selected appointment's detail panel is expanded into its inline
  // edit form (slide-up), replacing the old edit modal on the schedule view.
  const [inlineEdit, setInlineEdit] = useState(false);
  const [loading, setLoading] = useState(false);
  const [aiSettings, setAiSettings] = useState<AISettings>(loadSessionSettings);
  const [debugMsg, setDebugMsg] = useState<string | null>(null);
  // Staged, uncommitted schedule edits (the draft sandbox). Nothing here touches
  // the live schedule until the user Accepts or overrides (Save anyway).
  const [draftOps, setDraftOps] = useState<DraftOp[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<Appointment | null>(null);
  // The month/week the calendar is showing. Conflicts are scoped to this so the
  // Issues panel reflects what you're looking at, not just today.
  const [viewDate, setViewDate] = useState<Date>(new Date());
  // Active calendar lens (bcba/bt), surfaced from <Calendar> so the docked pane
  // can render the matching hours totals.
  const [calLens, setCalLens] = useState<'bcba' | 'bt'>('bcba');
  const [showDayReview, setShowDayReview] = useState(false);
  // Per-entity supervision-compliance cache for the current month. Recomputed
  // incrementally (only the affected clients/techs) on each appointment change
  // so the Comp-tab badge and dashboard stay live without a full pass.
  const [compCache, setCompCache] = useState<ComplianceCache | null>(null);
  // A file picked from Admin → "Upload schedule", parsed but not yet applied:
  // the user reviews the delta and confirms before it replaces current data.
  // `bytes` are the DECRYPTED workbook bytes (so the web upload re-POSTs plain).
  const [pendingImport, setPendingImport] = useState<{ bytes: Uint8Array; fileName: string; data: ScheduleData; embeddedConfig?: string } | null>(null);
  const detailPanelRef = React.useRef<HTMLDivElement | null>(null);
  const importInputRef = React.useRef<HTMLInputElement | null>(null);

  // ---- App lock (native only) ----------------------------------------------
  // On a cold launch a PIN gates the app; the schedule is restored from an
  // at-rest blob encrypted under that PIN. `lockReady` gates the first render so
  // the main UI never flashes before we know whether to lock.
  const isNative = Capacitor.isNativePlatform();
  const [lockReady, setLockReady] = useState(!isNative);
  const [locked, setLocked] = useState(false);
  const [lockMode, setLockMode] = useState<'create' | 'unlock'>('unlock');
  const [changingPin, setChangingPin] = useState(false);
  const [faceIdAvailable, setFaceIdAvailable] = useState(false);
  const [faceIdEnabled, setFaceIdEnabled] = useState(false);
  // The unlocked PIN, kept in memory only, so we can re-encrypt on each change.
  const unlockedPinRef = React.useRef<string | null>(null);

  // Schedule-decrypt password modal (replaces window.prompt for AutoFill).
  const [pwPrompt, setPwPrompt] = useState<{ title: string; message: string } | null>(null);
  const pwResolverRef = React.useRef<((pw: string | null) => void) | null>(null);
  const askPassword = (title: string, message: string) =>
    new Promise<string | null>((resolve) => {
      pwResolverRef.current = resolve;
      setPwPrompt({ title, message });
    });
  const resolvePassword = (pw: string | null) => {
    setPwPrompt(null);
    const r = pwResolverRef.current;
    pwResolverRef.current = null;
    r?.(pw);
  };

  const compSummary: ComplianceSummary | null =
    scheduleData && compCache ? summarize(compCache, scheduleData) : null;

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
  const draftRender = React.useMemo(
    () => (scheduleData && draftActive ? renderList(scheduleData, draftOps) : null),
    [scheduleData, draftOps, draftActive],
  );
  const draftStatus: DraftStatus | null = React.useMemo(
    () => (scheduleData && draftActive ? solveDraft(scheduleData, draftOps, new Date(), scheduleData.settings) : null),
    [scheduleData, draftOps, draftActive],
  );
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

  const handleAISettingsSave = (settings: AISettings) => {
    setAiSettings(settings);
    saveSessionSettings(settings);
  };

  const handleClearKey = () => {
    const cleared = { ...aiSettings, apiKey: '' };
    setAiSettings(cleared);
    saveSessionSettings(cleared);
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

  // The API key rides inside the workbook only lightly obfuscated (app key, no
  // user password), so it loads automatically with no prompt. Real protection
  // is the whole-file schedule password.
  const loadEmbeddedKey = async (embeddedConfig: string) => {
    if (aiSettings.apiKey) return;
    try {
      const decrypted = await deobfuscateKey(embeddedConfig);
      const parsed = JSON.parse(decrypted) as { apiKey: string; model: ClaudeModel };
      const restored: AISettings = {
        ...aiSettings,
        apiKey: parsed.apiKey,
        model: parsed.model || aiSettings.model || 'claude-sonnet-4-6',
      };
      setAiSettings(restored);
      saveSessionSettings(restored);
    } catch (_e) {
      // Corrupt/foreign blob — ignore silently; the user can paste a key.
    }
  };

  // Replace the whole schedule and rebuild the compliance cache from scratch.
  // Used on first load, wizard finish, applied AI solutions, and admin edits —
  // anything that can shift many entities at once. (Conflicts are recomputed by
  // the scheduleData/viewDate effect, so we don't set them here.)
  const commitFull = (next: ScheduleData) => {
    setScheduleData(next);
    setCompCache(buildCache(next));
  };

  // Decide the cold-launch lock state. Native always lands locked: into "create"
  // mode if no PIN exists yet (first run), otherwise "unlock". Web has no lock.
  useEffect(() => {
    if (!isNative) return;
    (async () => {
      const has = await hasPin();
      setLockMode(has ? 'unlock' : 'create');
      setFaceIdAvailable(await isBiometricAvailable());
      setFaceIdEnabled(await isFaceIdEnabled());
      setLocked(true);
      setLockReady(true);
    })();
  }, [isNative]);

  // Restore the at-rest schedule with the just-entered PIN and drop the gate.
  const unlockWith = async (pin: string) => {
    unlockedPinRef.current = pin;
    const restored = await loadSchedule(pin);
    if (restored) {
      setNativeStore(restored);
      commitFull(restored);
    }
    setLocked(false);
  };

  const handleCreatePin = async (pin: string) => {
    await setPin(pin);
    unlockedPinRef.current = pin;
    setLockMode('unlock');
    setLocked(false);
  };

  const handleVerifyPin = async (pin: string): Promise<boolean> => {
    if (!(await verifyPin(pin))) return false;
    await unlockWith(pin);
    return true;
  };

  const handleBiometricUnlock = async (): Promise<boolean> => {
    if (!(await biometricAuthenticate('Unlock ABA Schedule'))) return false;
    const pin = await recoverPinViaBiometric();
    if (!pin) return false;
    await unlockWith(pin);
    return true;
  };

  // Re-key to a new PIN from inside the app (already authenticated by being in).
  const handleChangePin = async (pin: string) => {
    await changePin(pin, scheduleData);
    unlockedPinRef.current = pin;
    setChangingPin(false);
  };

  const handleToggleFaceId = async (on: boolean) => {
    if (on) {
      const pin = unlockedPinRef.current;
      if (!pin) return;
      if (!(await biometricAuthenticate('Enable Face ID for ABA Schedule'))) return;
      await enableFaceId(pin);
      setFaceIdEnabled(true);
    } else {
      await disableFaceId();
      setFaceIdEnabled(false);
    }
  };

  // Persist the schedule (encrypted under the unlocked PIN) on every change, so
  // the next cold launch restores exactly this state. Native + unlocked only.
  // Debounced so a burst of edits (e.g. a calendar drag) coalesces into one
  // PBKDF2 + encrypt pass rather than one per keystroke.
  useEffect(() => {
    if (!isNative || locked) return;
    const pin = unlockedPinRef.current;
    if (!pin || !scheduleData) return;
    const t = setTimeout(() => { void saveSchedule(scheduleData, pin); }, 400);
    return () => clearTimeout(t);
  }, [scheduleData, locked, isNative]);

  // Apply an already-parsed import as the working schedule. On native we prime
  // the in-memory store nativeApi serves from; on web we POST the (decrypted,
  // plain) bytes so the Express server's store is the source of truth.
  const applyImported = async (bytes: Uint8Array, data: ScheduleData, embeddedConfig?: string) => {
    if (Capacitor.isNativePlatform()) {
      setNativeStore(data);
      commitFull(data);
      setSolutions([]);
      if (embeddedConfig) await loadEmbeddedKey(embeddedConfig);
      return;
    }
    const response = await axios.post(`${API_BASE}/upload`, new Blob([bytes as any]), {
      headers: { 'Content-Type': 'application/octet-stream' },
    });
    commitFull(response.data.data);
    setSolutions([]);
    if (response.data.embeddedConfig) await loadEmbeddedKey(response.data.embeddedConfig);
  };

  const handleFileUpload = async (file: File) => {
    setLoading(true);
    try {
      let bytes: Uint8Array = new Uint8Array(await file.arrayBuffer());

      // Whole-file encryption: a foreign/encrypted schedule is opaque until the
      // owner's password decrypts it. Prefer the session password, else prompt.
      if (isEncryptedSchedule(bytes)) {
        const password = aiSettings.schedulePassword
          || (await askPassword(
            'Schedule is password-protected',
            'Enter the schedule password to open this file.')) || '';
        if (!password) { setLoading(false); return; }
        try {
          bytes = await decryptBytes(bytes, password);
        } catch (_e) {
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
      const workbook = XLSX.read(bytes, { type: 'array' });
      const parsed = parseWorkbook(workbook);

      if (scheduleData) {
        // Replacing a loaded schedule — stage it and let the user confirm.
        setPendingImport({ bytes, fileName: file.name, data: parsed.data, embeddedConfig: parsed.embeddedConfig });
        return;
      }
      await applyImported(bytes, parsed.data, parsed.embeddedConfig);
    } catch (error: any) {
      const msg = error.response?.data?.error || error.message || String(error);
      console.error('[upload] failed', error);
      setDebugMsg(`Upload failed: ${msg}`);
      alert('Error uploading file: ' + msg);
    } finally {
      setLoading(false);
    }
  };

  // Hidden file input fired by Admin → "Upload schedule…".
  const triggerImportPicker = () => importInputRef.current?.click();

  const confirmPendingImport = async () => {
    if (!pendingImport) return;
    setLoading(true);
    try {
      await applyImported(pendingImport.bytes, pendingImport.data, pendingImport.embeddedConfig);
      setPendingImport(null);
      setView('schedule');
    } catch (error: any) {
      const msg = error.response?.data?.error || error.message || String(error);
      setDebugMsg(`Import failed: ${msg}`);
      alert('Error importing file: ' + msg);
    } finally {
      setLoading(false);
    }
  };

  // ---- Draft staging --------------------------------------------------------
  // Add/replace ops, collapsing any prior op that targets the same appointment
  // so the latest edit wins (matches applyOps).
  const stageOps = (incoming: DraftOp[]) => {
    const idOf = (o: DraftOp) => (o.kind === 'add' ? o.appt?.id : o.targetId);
    const ids = new Set(incoming.map(idOf));
    setDraftOps(prev => [...prev.filter(o => !ids.has(idOf(o))), ...incoming]);
  };

  // Calendar drag → stage a move (uncommitted). No server call, no auto-AI.
  const handleAppointmentChange = (appointment: Appointment) => {
    stageOps([newMoveOp(appointment)]);
  };

  // Sync the live store (native in-memory / Express) to a full replacement, then
  // commit to React state + rebuild the compliance cache.
  const commitScheduleData = async (next: ScheduleData) => {
    if (Capacitor.isNativePlatform()) {
      setNativeStore(next);
      commitFull(next);
      return;
    }
    const response = await axios.post(`${API_BASE}/schedule`, next);
    commitFull(response.data.data);
  };

  const acceptDraft = async () => {
    if (!scheduleData || !draftStatus) return;
    const next = draftStatus.resolved || applyOps(scheduleData, draftOps);
    await commitScheduleData(next);
    setDraftOps([]); setSolutions([]); setSelectedAppointment(null);
  };

  const saveAnyway = async () => {
    if (!scheduleData) return;
    if (!confirm('Save this schedule as-is, with the flagged conflicts?')) return;
    await commitScheduleData(applyOps(scheduleData, draftOps));
    setDraftOps([]); setSolutions([]); setSelectedAppointment(null);
  };

  const cancelDraft = () => { setDraftOps([]); setSolutions([]); };
  const resetOp = (opId: string) => setDraftOps(ops => ops.filter(o => o.id !== opId));

  // Picking a yellow trade-off stages the corresponding op so the next solve
  // can clear the conflict. "Shorten" trims the session by 30 min (a starting
  // point the BCBA can fine-tune); "move-family" stages a relocation to its
  // first open in-week slot — left as a move the user can drag.
  const pickChoice = (choice: PrioritizationChoice) => {
    if (!scheduleData) return;
    const preview = applyOps(scheduleData, draftOps);
    const a = preview.appointments.find(x => x.id === choice.appointmentId);
    if (!a) return;
    if (choice.kind === 'shorten') {
      const end = new Date(new Date(a.endTime).getTime() - 30 * 60000);
      if (end.getTime() <= new Date(a.startTime).getTime()) return;
      stageOps([newShortenOp({ ...a, endTime: formatLocalISO(end) })]);
    } else {
      stageOps([newMoveOp({ ...a })]);
    }
  };

  // ---- AI escalation (browser-side ClaudeScheduler over the preview) --------
  const runDraftAI = async () => {
    if (!scheduleData || !aiSettings.apiKey) return;
    const preview = applyOps(scheduleData, draftOps);
    const changed = draftOps.find(o => o.appt)?.appt || preview.appointments[0];
    if (!changed) return;
    setAiLoading(true);
    try {
      const messages = new ConstraintValidator(preview).validateSchedule().map(c => c.message);
      const scheduler = new ClaudeScheduler(aiSettings.apiKey, preview, aiSettings.model);
      const sols = await scheduler.generateSolutions(changed, messages);
      setSolutions(sols);
      if (sols.length === 0) setDebugMsg('AI returned no in-month options.');
    } catch (error: any) {
      alert('AI error: ' + (error.message || error));
    } finally {
      setAiLoading(false);
    }
  };

  const acceptAiSolution = async (sol: ScheduleSolution) => {
    if (!scheduleData) return;
    const next = applySolutionChanges(applyOps(scheduleData, draftOps), sol);
    await commitScheduleData(next);
    setDraftOps([]); setSolutions([]); setSelectedAppointment(null);
  };

  const customizeAiSolution = (sol: ScheduleSolution) => {
    if (!scheduleData) return;
    const preview = applyOps(scheduleData, draftOps);
    const moves: DraftOp[] = [];
    for (const ch of sol.changes) {
      const a = preview.appointments.find(x => x.id === ch.appointmentId);
      if (a) moves.push(newMoveOp({ ...a, startTime: ch.newTime.start, endTime: ch.newTime.end }));
    }
    stageOps(moves);
    setSolutions([]);
  };

  const rejectAiSet = () => setSolutions([]);

  // Refuse and log: commit the staged ADD requests as ghosts (visible reminders)
  // and discard the rest of the draft.
  const logAddsAsGhosts = async () => {
    if (!scheduleData) return;
    const ghosts = draftOps
      .filter(o => o.kind === 'add' && o.appt)
      .map(o => ({ ...o.appt!, isGhost: true }));
    const next = ghosts.length
      ? { ...scheduleData, appointments: [...scheduleData.appointments, ...ghosts] }
      : scheduleData;
    await commitScheduleData(next);
    setDraftOps([]); setSolutions([]); setSelectedAppointment(null);
  };

  // ---- Ghost lifecycle (committed) ------------------------------------------
  const promoteGhost = (a: Appointment) => {
    stageOps([newMoveOp({ ...a, isGhost: false })]);
    setSelectedAppointment(null);
  };

  const dismissGhost = async (a: Appointment) => {
    if (!scheduleData) return;
    await axios.delete(`${API_BASE}/admin/appointment/${a.id}`);
    const next = { ...scheduleData, appointments: scheduleData.appointments.filter(x => x.id !== a.id) };
    setScheduleData(next);
    setCompCache(prev => recomputeCache(prev, scheduleData, next, [{ before: a, after: undefined }]));
    setSelectedAppointment(null);
  };

  const persistAppointment = async (updated: Appointment) => {
    if (!scheduleData) return;
    try {
      const before = scheduleData.appointments.find(a => a.id === updated.id);
      await axios.post(`${API_BASE}/admin/appointment`, updated);
      const next: ScheduleData = {
        ...scheduleData,
        appointments: scheduleData.appointments.map(a => a.id === updated.id ? updated : a),
      };
      setScheduleData(next);
      setSelectedAppointment(updated);
      setCompCache(prev => recomputeCache(prev, scheduleData, next, [{ before, after: updated }]));
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

  // Add (new id) or edit (existing id) → stage as draft ops. Nothing commits
  // until the user Accepts or overrides in the DraftTray.
  const handleSaveAppointments = async (apps: Appointment[]) => {
    if (apps.length === 0 || !scheduleData) return;
    const ops = apps.map(a =>
      scheduleData.appointments.some(x => x.id === a.id) ? newMoveOp(a) : newAddOp(a)
    );
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
  const handleDeleteAppointments = (ids: string[]) => {
    if (ids.length === 0 || !scheduleData) return;
    stageOps(ids.map(id => newRemoveOp(id)));
    if (selectedAppointment && ids.includes(selectedAppointment.id)) setSelectedAppointment(null);
    setEditingAppointment(null);
    setInlineEdit(false);
  };

  const handleDeleteAppointment = (id: string) => handleDeleteAppointments([id]);

  const handleWizardComplete = async (data: ScheduleData) => {
    try {
      const response = await axios.post(`${API_BASE}/schedule`, data);
      commitFull(response.data.data);
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
      // Layer 1: the API key (if any) rides inside the workbook, app-obfuscated
      // (no user password) so it loads automatically on re-import.
      const embeddedConfig = aiSettings.apiKey
        ? await obfuscateKey(JSON.stringify({ apiKey: aiSettings.apiKey, model: aiSettings.model }))
        : undefined;

      const response = await axios.post(
        `${API_BASE}/download`,
        { embeddedConfig },
        { responseType: 'blob' }
      );
      let bytes: Uint8Array = new Uint8Array(await (response.data as Blob).arrayBuffer());

      // Layer 2: if a schedule password is set, encrypt the whole file so it's
      // opaque in a file browser and unopenable without the password.
      const password = aiSettings.schedulePassword;
      if (password) bytes = await encryptBytes(bytes, password);
      const filename = password ? 'schedule.enc.xlsx' : 'schedule.xlsx';
      const blob = new Blob([bytes as any]);

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

  const compactBtn = (label: string, ariaLabel: string, onClick: () => void, color = '#374151') => (
    <button
      onClick={onClick}
      aria-label={ariaLabel}
      title={ariaLabel}
      style={{
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
      }}
    >
      {label}
    </button>
  );

  // Brief dark splash while we decide whether to lock — avoids flashing the
  // (empty) main UI before the gate appears on native.
  if (!lockReady) {
    return <div style={{ position: 'fixed', inset: 0, backgroundColor: '#1f2937' }} />;
  }

  if (locked) {
    return (
      <LockScreen
        mode={lockMode}
        onCreate={handleCreatePin}
        onVerify={handleVerifyPin}
        onBiometric={lockMode === 'unlock' && faceIdEnabled && faceIdAvailable ? handleBiometricUnlock : undefined}
        biometricAuto
      />
    );
  }

  // The selected-appointment detail card. Extracted so it can render either in
  // the on-demand narrow pane or pinned to the bottom of the docked wide pane.
  const renderSelectedDetail = (a: Appointment) => {
    const status = a.status || 'scheduled';
    const locked = status === 'canceled' || status === 'completed';
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
        {(status === 'canceled' || status === 'completed') && (
          <p style={{ color: '#6b7280', marginTop: '4px', fontSize: 12 }}>
            🔒 Locked — reopen to edit time, status, or assignment
          </p>
        )}
        {a.cancellation && (
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 6, lineHeight: 1.5 }}>
            <div>Source: <strong>Cancel-{a.cancellation.source.toUpperCase()}</strong></div>
            <div>Reason: <strong>{cancellationReasonLabel(a.cancellation.reason, scheduleData?.settings)}</strong></div>
            <div>{a.cancellation.unplanned ? 'Unplanned' : 'Planned'} · notice met: <strong>{a.cancellation.noticeMet ? 'yes' : 'no'}</strong></div>
            {a.cancellation.notes && <div>Notes: {a.cancellation.notes}</div>}
          </div>
        )}
        {a.isGhost ? (
          <div style={{ display: 'flex', gap: '6px', marginTop: '12px', flexWrap: 'wrap' }}>
            <button
              onClick={() => promoteGhost(a)}
              style={{
                flex: '1 1 auto', padding: '6px 12px', backgroundColor: '#3b82f6', color: 'white',
                border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
              }}
            >Promote</button>
            <button
              onClick={() => dismissGhost(a)}
              style={{
                flex: '1 1 auto', padding: '6px 12px', backgroundColor: 'white', color: '#6b7280',
                border: '1px solid #d1d5db', borderRadius: '4px', cursor: 'pointer', fontSize: '13px',
              }}
            >Dismiss</button>
          </div>
        ) : (
        <div style={{ display: 'flex', gap: '6px', marginTop: '12px', flexWrap: 'wrap' }}>
          <button
            onClick={() => !locked && setInlineEdit(true)}
            disabled={locked}
            title={locked ? 'Reopen to edit' : undefined}
            style={{
              flex: '1 1 auto', padding: '6px 12px',
              backgroundColor: locked ? '#e5e7eb' : '#3b82f6', color: locked ? '#9ca3af' : 'white',
              border: 'none', borderRadius: '4px', cursor: locked ? 'not-allowed' : 'pointer', fontSize: '13px',
            }}
          >Edit</button>
          {status === 'scheduled' && (
            <>
              <CompleteTimePrompt key={a.id} a={a} onComplete={handleMarkComplete} />
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
        )}
      </div>
    );
  };

  // The bottom region of the context panel: the read-only detail, or — once the
  // user taps Edit — the inline edit form (same component as the add modal, just
  // rendered to fill the expanded panel instead of a popup).
  const renderDetailOrEdit = (a: Appointment) => {
    const locked = a.status === 'canceled' || a.status === 'completed';
    if (inlineEdit && !locked && scheduleData) {
      return (
        <AppointmentForm
          variant="inline"
          appointment={a}
          allAppointments={scheduleData.appointments}
          authorizations={scheduleData.authorizations}
          technicians={scheduleData.technicians}
          clients={scheduleData.clients}
          onSave={handleSaveAppointments}
          onDelete={handleDeleteAppointments}
          onCancel={() => setInlineEdit(false)}
        />
      );
    }
    return renderSelectedDetail(a);
  };

  return (
    <div style={{
      display: 'flex', height: '100vh', maxWidth: '100vw',
      overflowX: 'hidden', flexDirection: 'column',
      // Side insets matter on landscape iPhones with a notch so chrome
      // doesn't slip under the camera housing.
      paddingLeft: 'env(safe-area-inset-left)',
      paddingRight: 'env(safe-area-inset-right)',
    }}>
      <header style={{
        backgroundColor: '#1f2937',
        color: 'white',
        // Top padding includes the iOS status bar / notch inset so the
        // title doesn't sit under the time/carrier indicators.
        padding: 'calc(env(safe-area-inset-top) + 6px) 12px 6px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        position: 'sticky', top: 0, zIndex: 10,
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
          <h1 style={{ fontSize: '14px', fontWeight: 700, margin: 0, whiteSpace: 'nowrap' }}>ABA Schedule</h1>
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
            {/* AI status: tiny dot only when on, hidden when off (it's not actionable info at a glance). */}
            {aiSettings.apiKey && (
              <span title={`AI: ${aiSettings.model}`} style={{
                width: 8, height: 8, borderRadius: '50%',
                backgroundColor: '#10b981', display: 'inline-block',
              }} />
            )}
            {compactBtn('⚙', 'Settings', () => setShowSettings(true))}
            {!scheduleData ? (
              <>
                {compactBtn('Wizard', 'Setup Wizard', () => setShowWizard(true), '#8b5cf6')}
                <FileUpload onUpload={handleFileUpload} loading={loading} />
              </>
            ) : (
              <>
                {compactBtn('+', 'Add appointment', () => setShowAddAppointment(true), '#3b82f6')}
                <ViewTabs view={view} onChange={setView} compSummary={compSummary} />
                {compactBtn('↓', 'Download', handleDownload, '#10b981')}
              </>
            )}
          </div>
        </div>
      </header>

      <div style={{
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
        WebkitOverflowScrolling: 'touch' as any,
        paddingBottom: splitView ? 0 : 'env(safe-area-inset-bottom)',
      }}>
        {scheduleData ? (
          <>
            {view === 'schedule' && (
              <>
                <div style={{
                  flex: '1 1 320px', minWidth: 0,
                  ...(splitView ? { overflowY: 'auto', minHeight: 0, WebkitOverflowScrolling: 'touch' as any } : {}),
                }}>
                  {pendingReview.length > 0 && (
                    <button
                      onClick={() => setShowDayReview(true)}
                      style={{
                        display: 'block', width: 'calc(100% - 16px)', margin: '8px',
                        padding: '8px 12px', backgroundColor: '#fef3c7',
                        border: '1px solid #fcd34d', borderRadius: 6, cursor: 'pointer',
                        fontSize: 13, fontWeight: 600, color: '#92400e', textAlign: 'left',
                      }}
                    >
                      📋 {pendingReview.length} past session{pendingReview.length === 1 ? '' : 's'} awaiting review — complete or cancel them
                    </button>
                  )}
                  <Calendar
                    appointments={calendarAppointments}
                    technicians={scheduleData.technicians}
                    clients={scheduleData.clients}
                    settings={scheduleData.settings}
                    onAppointmentChange={handleAppointmentChange}
                    onSelectAppointment={setSelectedAppointment}
                    onViewDateChange={setViewDate}
                    onLensChange={setCalLens}
                    hideTotals={dockPane}
                    draftMarks={calendarMarks}
                  />
                </div>
                {(() => {
                  // Draft tray / conflicts / AI options / idle agenda — the
                  // middle of the docked pane (and the only content of the narrow
                  // in-flow pane; the selected appointment is a slide-up sheet there).
                  const middle = (
                    <>
                    {draftActive && draftStatus && (
                      <DraftTray
                        base={scheduleData}
                        ops={draftOps}
                        status={draftStatus}
                        hasApiKey={!!aiSettings.apiKey}
                        aiLoading={aiLoading}
                        onResetOp={resetOp}
                        onResetAll={cancelDraft}
                        onCancel={cancelDraft}
                        onAccept={acceptDraft}
                        onSaveAnyway={saveAnyway}
                        onAI={runDraftAI}
                        onPickChoice={pickChoice}
                        onLogGhosts={logAddsAsGhosts}
                      />
                    )}
                    {!draftActive && conflicts.length > 0 && (
                      <ConflictPanel
                        conflicts={conflicts}
                        appointments={scheduleData?.appointments}
                        onSelectAppointment={setSelectedAppointment}
                      />
                    )}
                    {solutions.length > 0 && (
                      <SolutionPanel
                        solutions={solutions}
                        heading="AI options (within the month)"
                        onAccept={acceptAiSolution}
                        onCustomize={customizeAiSolution}
                        onReject={rejectAiSet}
                      />
                    )}
                    {!draftActive && conflicts.length === 0 && solutions.length === 0 && !selectedAppointment && (
                      <AgendaRail
                        appointments={scheduleData.appointments}
                        date={viewDate}
                        onSelect={setSelectedAppointment}
                      />
                    )}
                    </>
                  );

                  // Wide: a frozen, full-height pane. Totals pinned to the top
                  // (≤25%), conflicts/agenda filling the remaining ~75%, and the
                  // selected appointment sliding up from the bottom — 25% for the
                  // read-only detail, expanding to 50% (shrinking the middle) for
                  // inline edits, all animated. Overflow in any band scrolls
                  // within the band, never growing the frozen pane.
                  if (splitView) {
                    return (
                      <div ref={detailPanelRef} style={{
                        flex: '0 0 auto', width: 380, borderLeft: '1px solid #e5e7eb',
                        display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%',
                      }}>
                        {!draftActive && (
                          <div style={{ flexShrink: 0, maxHeight: '25%', overflowY: 'auto', padding: '10px 14px', borderBottom: '1px solid #e5e7eb', WebkitOverflowScrolling: 'touch' as any }}>
                            <HoursSummary appointments={calendarAppointments} lens={calLens} settings={scheduleData.settings} currentDate={viewDate} />
                          </div>
                        )}
                        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch' as any }}>
                          {middle}
                        </div>
                        <div style={{
                          flexShrink: 0, overflow: 'hidden',
                          display: 'flex', flexDirection: 'column',
                          borderTop: selectedAppointment ? '1px solid #e5e7eb' : 'none',
                          maxHeight: selectedAppointment ? (inlineEdit ? '50%' : '25%') : 0,
                          transition: 'max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                        }}>
                          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch' as any }}>
                            {selectedAppointment && renderDetailOrEdit(selectedAppointment)}
                          </div>
                        </div>
                      </div>
                    );
                  }

                  // Narrow: issues flow under the calendar (the selected
                  // appointment is handled by the slide-up sheet below).
                  if (draftActive || conflicts.length > 0 || solutions.length > 0) {
                    return (
                      <div ref={detailPanelRef} style={{
                        flex: '0 0 auto', width: 'min(350px, 100%)', borderLeft: '1px solid #e5e7eb',
                        display: 'flex', flexDirection: 'column',
                      }}>
                        {middle}
                      </div>
                    );
                  }
                  return null;
                })()}

                {/* Narrow: the selected appointment's detail / inline edit as a
                    slide-up bottom sheet (replaces the old edit modal on phones).
                    Kept mounted so it animates in and out. */}
                {!splitView && (
                  <div style={{
                    position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 1050,
                    background: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16,
                    boxShadow: selectedAppointment ? '0 -6px 24px rgba(0,0,0,0.18)' : 'none',
                    display: 'flex', flexDirection: 'column', overflow: 'hidden',
                    maxHeight: selectedAppointment ? (inlineEdit ? '92vh' : '60vh') : 0,
                    transform: selectedAppointment ? 'translateY(0)' : 'translateY(100%)',
                    transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                    paddingBottom: 'env(safe-area-inset-bottom)',
                  }}>
                    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch' as any }}>
                      {selectedAppointment && renderDetailOrEdit(selectedAppointment)}
                    </div>
                  </div>
                )}
              </>
            )}
            {view === 'admin' && (
              <AdminPanel
                data={scheduleData}
                onDataChange={commitFull}
                onImportFile={triggerImportPicker}
                onRerunWizard={() => setShowWizard(true)}
              />
            )}
            {view === 'compliance' && (
              <ComplianceDashboard
                data={scheduleData}
                cache={compCache}
                onMarkComplete={handleMarkComplete}
                onRequestCancel={(a) => setCancelTarget(a)}
                onSelectAppointment={(a) => { setView('schedule'); setSelectedAppointment(a); }}
              />
            )}
            {view === 'caseload' && (
              <CaseloadView data={scheduleData} now={viewDate} />
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
          onClearKey={handleClearKey}
          lock={isNative ? {
            faceIdAvailable,
            faceIdEnabled,
            onChangePin: () => { setShowSettings(false); setChangingPin(true); },
            onToggleFaceId: handleToggleFaceId,
          } : undefined}
        />
      )}

      {showWizard && (
        <SetupWizard
          onComplete={handleWizardComplete}
          onCancel={() => setShowWizard(false)}
          initialData={scheduleData || undefined}
        />
      )}

      {/* Hidden picker for Admin → "Upload schedule…". The header FileUpload
          handles the first-run case; this covers replacing a loaded schedule. */}
      <input
        ref={importInputRef}
        type="file"
        accept=".xlsx,.xls"
        style={{ display: 'none' }}
        onChange={e => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) handleFileUpload(file);
        }}
      />

      {pendingImport && scheduleData && (
        <ImportPreview
          current={scheduleData}
          next={pendingImport.data}
          fileName={pendingImport.fileName}
          onConfirm={confirmPendingImport}
          onCancel={() => setPendingImport(null)}
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
          allAppointments={scheduleData.appointments}
          authorizations={scheduleData.authorizations}
          technicians={scheduleData.technicians}
          clients={scheduleData.clients}
          onSave={handleSaveAppointments}
          onCancel={() => setShowAddAppointment(false)}
        />
      )}

      {editingAppointment && scheduleData && (
        <AppointmentForm
          appointment={editingAppointment}
          allAppointments={scheduleData.appointments}
          authorizations={scheduleData.authorizations}
          technicians={scheduleData.technicians}
          clients={scheduleData.clients}
          onSave={handleSaveAppointments}
          onDelete={handleDeleteAppointments}
          onCancel={() => setEditingAppointment(null)}
        />
      )}

      {showDayReview && scheduleData && (
        <DayReview
          appointments={pendingReview}
          onComplete={handleMarkComplete}
          onRequestCancel={(a) => setCancelTarget(a)}
          onClose={() => setShowDayReview(false)}
        />
      )}

      {pwPrompt && (
        <PasswordPrompt
          title={pwPrompt.title}
          message={pwPrompt.message}
          onSubmit={(pw) => resolvePassword(pw)}
          onCancel={() => resolvePassword(null)}
        />
      )}

      {/* Re-key flow launched from Settings → App Lock. */}
      {changingPin && (
        <LockScreen mode="create" onCreate={handleChangePin} />
      )}
    </div>
  );
}

// Three-way segmented control for the active view. Sits inline in the header
// at compact-button size so it doesn't blow up the chrome.
function ViewTabs({ view, onChange, compSummary }: {
  view: 'schedule' | 'admin' | 'compliance' | 'caseload';
  onChange: (v: 'schedule' | 'admin' | 'compliance' | 'caseload') => void;
  compSummary?: ComplianceSummary | null;
}) {
  const tabs: { key: 'schedule' | 'admin' | 'compliance' | 'caseload'; label: string; aria: string }[] = [
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
  return (
    <div style={{ display: 'flex', borderRadius: 5, overflow: 'hidden', border: '1px solid #4b5563' }}>
      {tabs.map(t => {
        const active = t.key === view;
        const showBadge = t.key === 'compliance' && !!compSummary;
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            aria-label={showBadge && attention > 0 ? `${t.aria} — ${attention} need attention` : t.aria}
            title={showBadge && attention > 0 ? `${attention} client(s)/tech(s) need attention this month` : t.aria}
            style={{
              position: 'relative',
              padding: '5px 9px', border: 'none',
              backgroundColor: active ? '#6366f1' : 'transparent',
              color: 'white', cursor: 'pointer',
              fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', lineHeight: 1.2,
              display: 'inline-flex', alignItems: 'center', gap: 5,
            }}
          >
            {t.label}
            {showBadge && (
              attention > 0 ? (
                <span style={{
                  minWidth: 15, height: 15, padding: '0 4px', borderRadius: 8,
                  backgroundColor: badgeColor, color: 'white',
                  fontSize: 10, fontWeight: 700, lineHeight: '15px', textAlign: 'center',
                }}>{attention}</span>
              ) : (
                <span style={{
                  width: 8, height: 8, borderRadius: '50%',
                  backgroundColor: badgeColor, display: 'inline-block',
                }} />
              )
            )}
          </button>
        );
      })}
    </div>
  );
}
