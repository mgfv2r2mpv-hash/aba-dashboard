import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { ConstraintValidator } from './constraintValidator';
import { installNativeAdapter, setCurrentData as setNativeStore } from './nativeApi';
import { ScheduleData, Appointment, ScheduleConflict, ScheduleSolution, WishSolution, Cancellation, cancellationReasonLabel } from './types';
import Calendar, { HoursSummary } from './components/Calendar';
import ConflictPanel, { conflictKey } from './components/ConflictPanel';
import SolutionPanel from './components/SolutionPanel';
import type { AdminPersist } from './components/AdminPanel';
import FileUpload from './components/FileUpload';
import { AISettings, ClaudeModel } from './components/Settings';
import AppointmentForm from './components/AppointmentForm';
import CancellationDialog from './components/CancellationDialog';
import DayReview from './components/DayReview';
import CompleteTimePrompt from './components/CompleteTimePrompt';
import AgendaRail from './components/AgendaRail';
import ImportPreview from './components/ImportPreview';

const WishComposer = React.lazy(() => import('./components/WishComposer'));
const AdminPanel = React.lazy(() => import('./components/AdminPanel'));
const ComplianceDashboard = React.lazy(() => import('./components/ComplianceDashboard'));
const CaseloadView = React.lazy(() => import('./components/CaseloadView'));
const SetupWizard = React.lazy(() => import('./components/SetupWizard'));
const CprView = React.lazy(() => import('./components/CprView'));
import { useMinWidth, useIsTablet, useIsLandscape } from './useMediaQuery';
import LockScreen from './components/LockScreen';
import PasswordPrompt from './components/PasswordPrompt';
import {
  hasPin, setPin, verifyPin, changePin,
  saveSchedule, loadSchedule,
  saveAIConfig, loadAIConfig, clearAIConfig,
  isFaceIdEnabled, enableFaceId, disableFaceId, recoverPinViaBiometric,
  clearStaleAtRest,
} from './appLock';
import { isBiometricAvailable, checkBiometryFull, biometricAuthenticate, getBiometryLabel, BiometryLabel, getCachedBiometryAvailable, getCachedBiometryLabel } from './biometric';
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
import { wishSolutionToDraft } from './wish';
import { computeSessionFlags, SessionFlags } from './sessionFlags';

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
  // Per-instance conflict triage. Muted conflicts drop into the minimized bin
  // (session-scoped, clears on reload). Confirmed-and-dismissed conflicts are
  // hidden outright and persisted in scheduleData.confirmedConflicts so they
  // survive page reloads and round-trip through the Excel export.
  const [mutedConflicts, setMutedConflicts] = useState<string[]>([]);
  const [solutions, setSolutions] = useState<ScheduleSolution[]>([]);
  const [selectedAppointment, setSelectedAppointment] = useState<Appointment | null>(null);
  const [view, setView] = useState<'schedule' | 'admin' | 'compliance' | 'caseload' | 'wish' | 'cpr'>('schedule');
  const [showWizard, setShowWizard] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAddAppointment, setShowAddAppointment] = useState(false);
  // Wish view is now a full page (view === 'wish') rather than a modal.
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
  const [recoveryTarget, setRecoveryTarget] = useState<Appointment | null>(null);
  const [recoverySolutions, setRecoverySolutions] = useState<{ title: string; solutions: WishSolution[] } | null>(null);
  // The month/week the calendar is showing. Conflicts are scoped to this so the
  // Issues panel reflects what you're looking at, not just today.
  const [viewDate, setViewDate] = useState<Date>(new Date());
  // Active calendar lens (bcba/bt), surfaced from <Calendar> so the docked pane
  // can render the matching hours totals.
  const [calLens, setCalLens] = useState<'bcba' | 'bt' | 'client'>('bcba');
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
  const headerRef = React.useRef<HTMLElement | null>(null);
  const mainScrollRef = React.useRef<HTMLDivElement | null>(null);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const mainScrollLastRef = React.useRef(0);
  const savedScrollRef = React.useRef<number>(0);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(56);
  const isLandscape = useIsLandscape();

  // ---- App lock (native only) ----------------------------------------------
  // On a cold launch a PIN gates the app; the schedule is restored from an
  // at-rest blob encrypted under that PIN. `lockReady` gates the first render so
  // the main UI never flashes before we know whether to lock.
  const isNative = Capacitor.isNativePlatform();
  const [lockReady, setLockReady] = useState(!isNative);
  const [locked, setLocked] = useState(false);
  const [lockMode, setLockMode] = useState<'create' | 'unlock'>('unlock');
  const [changingPin, setChangingPin] = useState(false);
  // Seed from localStorage cache so the toggle is visible immediately on cold
  // launch — the async check below will confirm/update, but this prevents the
  // toggle from vanishing on subsequent launches while LAContext warms up.
  const [faceIdAvailable, setFaceIdAvailable] = useState(() => isNative && getCachedBiometryAvailable());
  const [faceIdEnabled, setFaceIdEnabled] = useState(false);
  // What to call the device's biometry in UI copy ("Face ID" / "Touch ID").
  const [biometryLabel, setBiometryLabel] = useState<BiometryLabel>(() => isNative ? getCachedBiometryLabel() : 'biometric unlock');
  // The unlocked PIN, kept in memory only, so we can re-encrypt on each change.
  const unlockedPinRef = React.useRef<string | null>(null);

  // Schedule-decrypt password modal (replaces window.prompt for AutoFill).
  const [pwPrompt, setPwPrompt] = useState<{ title: string; message: string; placeholder?: string; submitLabel?: string } | null>(null);
  const pwResolverRef = React.useRef<((pw: string | null) => void) | null>(null);
  const askPassword = (title: string, message: string, opts?: { placeholder?: string; submitLabel?: string }) =>
    new Promise<string | null>((resolve) => {
      pwResolverRef.current = resolve;
      setPwPrompt({ title, message, ...opts });
    });
  const resolvePassword = (pw: string | null) => {
    setPwPrompt(null);
    const r = pwResolverRef.current;
    pwResolverRef.current = null;
    r?.(pw);
  };

  const compSummary: ComplianceSummary | null =
    scheduleData && compCache ? summarize(compCache, scheduleData) : null;

  // Conflict triage: confirmed-and-dismissed are hidden outright (persisted);
  // muted are moved to the bin (session-only).
  const confirmedSet = new Set(scheduleData?.confirmedConflicts ?? []);
  const mutedSet = new Set(mutedConflicts);
  const visibleConflicts = conflicts.filter(c => !confirmedSet.has(conflictKey(c)));
  const activeConflicts = visibleConflicts.filter(c => !mutedSet.has(conflictKey(c)));

  const muteConflict = (key: string) =>
    setMutedConflicts(prev => (prev.includes(key) ? prev : [...prev, key]));
  const unmuteConflict = (key: string) =>
    setMutedConflicts(prev => prev.filter(k => k !== key));
  const confirmDismissConflict = (key: string) => {
    if (!scheduleData) return;
    const prev = scheduleData.confirmedConflicts ?? [];
    if (prev.includes(key)) return;
    commitFull({ ...scheduleData, confirmedConflicts: [...prev, key] });
  };
  const unconfirmConflict = (key: string) => {
    if (!scheduleData) return;
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
  const detailFlags = React.useMemo<Map<string, SessionFlags>>(
    () => scheduleData
      ? computeSessionFlags(scheduleData.appointments, scheduleData.companyHolidays ?? [])
      : new Map(),
    [scheduleData],
  );

  // Measure the header height (for the portrait fixed-header layout) and keep
  // it updated if the content/safe-area changes (e.g. data load changes toolbar).
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setHeaderHeight(el.offsetHeight);
    });
    ro.observe(el);
    setHeaderHeight(el.offsetHeight);
    return () => ro.disconnect();
  });

  const handleMainScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const curr = e.currentTarget.scrollTop;
    const prev = mainScrollLastRef.current;
    // Show scroll-to-top when scrolling upward past the threshold (not in split view)
    if (!splitView) setShowScrollTop(curr > 180 && curr < prev);
    mainScrollLastRef.current = curr;
  };

  // On wide screens: scroll the docked pane into view when an appointment opens.
  // On narrow screens: the bottom sheet is position:fixed so no scroll is needed —
  // instead save the current scroll position so we can restore it when the sheet
  // closes, preventing the jarring "drag back up" experience on portrait iPhones.
  useEffect(() => {
    if (selectedAppointment) {
      setPanelCollapsed(false);
      if (dockPane) {
        if (detailPanelRef.current) {
          detailPanelRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      } else {
        savedScrollRef.current = mainScrollRef.current?.scrollTop ?? 0;
      }
    } else if (!dockPane) {
      const saved = savedScrollRef.current;
      const scrollEl = mainScrollRef.current;
      // Delay matches the sheet close animation (300ms) so the scroll happens
      // after the sheet is off-screen, not while it's still visible.
      setTimeout(() => { if (scrollEl) scrollEl.scrollTop = saved; }, 320);
    }
  }, [selectedAppointment, dockPane]);

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
    // Seal the key under the unlocked PIN so it persists across cold launches.
    // (Native + unlocked only; web has no at-rest store.)
    const pin = unlockedPinRef.current;
    if (isNative && pin) {
      if (settings.apiKey) void saveAIConfig({ apiKey: settings.apiKey, model: settings.model, schedulePassword: settings.schedulePassword }, pin);
      else void clearAIConfig();
    }
  };

  const handleClearKey = () => {
    const cleared = { ...aiSettings, apiKey: '' };
    setAiSettings(cleared);
    saveSessionSettings(cleared);
    if (isNative) void clearAIConfig();
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
      // Route through the saver so the imported key is also sealed under the PIN
      // at rest (native) — otherwise it would survive this session but not a
      // cold launch, the same gap that made keys feel "not maintained".
      handleAISettingsSave(restored);
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
    // Defer the compliance cache build to the next task so the schedule renders
    // first — buildCache can block the main thread for several seconds on large
    // appointment sets, which triggers iOS's "unresponsive WebContent" watchdog.
    setCompCache(null);
    setTimeout(() => setCompCache(buildCache(next)), 0);
  };

  const serverPersist: AdminPersist = {
    technician: async (id, full) => (await axios.post(`/api/admin/technician/${id}`, full)).data.technician,
    addTechnician: async (t) => (await axios.post('/api/admin/technicians', t)).data.technician,
    deleteTechnician: async (id) => { await axios.delete(`/api/admin/technician/${id}`); },
    client: async (id, full) => (await axios.post(`/api/admin/client/${id}`, full)).data.client,
    addClient: async (c) => (await axios.post('/api/admin/clients', c)).data.client,
    deleteClient: async (id) => { await axios.delete(`/api/admin/client/${id}`); },
    blackout: async (b) => (await axios.post('/api/admin/blackout', b)).data.blackout ?? b,
    deleteBlackout: async (id) => { await axios.delete(`/api/admin/blackout/${id}`); },
    timeOff: async (t) => (await axios.post('/api/admin/time-off', t)).data.timeOff ?? t,
    deleteTimeOff: async (id) => { await axios.delete(`/api/admin/time-off/${id}`); },
    companyHoliday: async (h) => (await axios.post('/api/admin/company-holiday', h)).data.holiday ?? h,
    deleteCompanyHoliday: async (id) => { await axios.delete(`/api/admin/company-holiday/${id}`); },
    settings: async (s) => (await axios.post('/api/admin/settings', s)).data.settings,
    auth: async (a) => (await axios.post('/api/admin/authorization', a)).data.authorization ?? a,
    deleteAuth: async (id) => { await axios.delete(`/api/admin/authorization/${id}`); },
    usage: async (u) => (await axios.post('/api/admin/manual-usage', u)).data.usage ?? u,
    deleteUsage: async (id) => { await axios.delete(`/api/admin/manual-usage/${id}`); },
    reorder: async (entity, ids) => { await axios.post('/api/admin/reorder', { entity, order: ids }); },
  };

  // Decide the cold-launch lock state. Native always lands locked: into "create"
  // mode if no PIN exists yet (first run), otherwise "unlock". Web has no lock.
  // All three reads are independent so we fire them in parallel to minimize the
  // time to first render of the PIN screen.
  useEffect(() => {
    if (!isNative) return;
    (async () => {
      const [has, biometry, faceIdOn] = await Promise.all([
        hasPin(),
        checkBiometryFull(),
        isFaceIdEnabled(),
      ]);
      setLockMode(has ? 'unlock' : 'create');
      setFaceIdAvailable(biometry.available);
      if (biometry.available) setBiometryLabel(biometry.label);
      setFaceIdEnabled(faceIdOn);
      setLocked(true);
      setLockReady(true);
    })();
  }, [isNative]);

  // Self-heal biometry availability when the app returns to the foreground. If a
  // cold-launch check ever lands wrong (the Face ID setting would vanish and the
  // unlock prompt wouldn't fire), re-checking on resume restores it.
  useEffect(() => {
    if (!isNative) return;
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      void checkBiometryFull().then(b => {
        setFaceIdAvailable(b.available);
        if (b.available) setBiometryLabel(b.label);
      });
    };
    document.addEventListener('visibilitychange', refresh);
    return () => document.removeEventListener('visibilitychange', refresh);
  }, [isNative]);

  // Restore the at-rest schedule with the just-entered PIN and drop the gate.
  const unlockWith = async (pin: string) => {
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
      const restoredSettings: AISettings = {
        ...aiSettings,
        apiKey: aiConfig.apiKey,
        model: (aiConfig.model as ClaudeModel) || aiSettings.model || 'claude-sonnet-4-6',
        schedulePassword: aiConfig.schedulePassword,
      };
      setAiSettings(restoredSettings);
      saveSessionSettings(restoredSettings);
    }
    setLocked(false);
  };

  const handleCreatePin = async (pin: string) => {
    // Creating a PIN means we found no readable verifier — treat this as a fresh
    // install. Wipe any orphaned at-rest blobs (sealed under a PIN we can't read,
    // so unrecoverable) and reset in-memory state so no stale schedule or API key
    // is shown under the new PIN. Errors surface to LockScreen (no silent fail).
    await clearStaleAtRest();
    await setPin(pin);
    unlockedPinRef.current = pin;
    const fresh: AISettings = { apiKey: '', model: aiSettings.model || 'claude-sonnet-4-6' };
    setScheduleData(null);
    setNativeStore(null as unknown as ScheduleData);
    setAiSettings(fresh);
    saveSessionSettings(fresh);
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
    // Re-seal the AI config under the new PIN so it stays recoverable on unlock.
    if (aiSettings.apiKey) await saveAIConfig({ apiKey: aiSettings.apiKey, model: aiSettings.model, schedulePassword: aiSettings.schedulePassword }, pin);
    else await clearAIConfig();
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
      // Biometric just succeeded — mark available so the help message clears.
      setFaceIdAvailable(true);
    } else {
      await disableFaceId();
      setFaceIdEnabled(false);
    }
  };

  // Re-auth gate for revealing/replacing the stored API key. On native the key
  // is sealed under the PIN, so replacing it requires the same proof that opens
  // the app: Face ID (if enabled) or the PIN. Web has no lock, so it's allowed
  // outright. Returns true when the user is authorized to edit the key.
  const authenticateForKey = async (): Promise<boolean> => {
    if (!isNative) return true;
    if (faceIdEnabled && await biometricAuthenticate('Unlock to replace API key')) return true;
    const pin = await askPassword(
      'Enter your PIN',
      'Enter your app PIN to replace the saved Claude API key.',
      { placeholder: 'App PIN', submitLabel: 'Unlock' });
    if (!pin) return false;
    return verifyPin(pin);
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
      // Dynamic import keeps SheetJS (~800 KB) out of the critical startup bundle.
      const { parseBytes } = await import('./excelHandler');
      const parsed = parseBytes(bytes);

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
      const { ClaudeScheduler } = await import('./claudeScheduler');
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

  // Shared by Wish It / Fix It Accept: the model's own ops can still
  // double-book a tech/BCBA/client against each other or the live schedule, so
  // run them through solveDraft (the same conflict check the draft tray uses)
  // before trusting an Accept to commit straight away. A red grade means a hard
  // conflict remains — stage it into the draft tray instead so the BCBA sees it
  // and must resolve or explicitly "Save Anyway", rather than silently landing
  // an overlapping appointment on the calendar.
  const commitWishLikeSolution = async (sol: WishSolution): Promise<boolean> => {
    if (!scheduleData) return false;
    const { ops, blackouts } = wishSolutionToDraft(sol, scheduleData);
    const status = solveDraft(scheduleData, ops, new Date(), scheduleData.settings);
    if (status.grade === 'red') {
      if (blackouts.length) await commitScheduleData({ ...scheduleData, blackouts: [...(scheduleData.blackouts || []), ...blackouts] });
      stageOps(ops);
      return false;
    }
    const resolved = status.resolved || applyOps(scheduleData, ops);
    const next = blackouts.length ? { ...resolved, blackouts: [...(resolved.blackouts || []), ...blackouts] } : resolved;
    await commitScheduleData(next);
    return true;
  };

  // Wish It: Accept applies the whole solution (ops + any blackouts); Customize
  // loads the appointment ops into the editable draft (and commits any blackouts,
  // which aren't editable in the tray) so the BCBA can tweak before accepting.
  const acceptWish = async (sol: WishSolution) => {
    if (!scheduleData) return;
    if (!(await commitWishLikeSolution(sol))) return;
    setView('schedule'); setSelectedAppointment(null);
  };

  const customizeWish = (sol: WishSolution) => {
    if (!scheduleData) return;
    const { ops, blackouts } = wishSolutionToDraft(sol, scheduleData);
    if (blackouts.length) commitScheduleData({ ...scheduleData, blackouts: [...(scheduleData.blackouts || []), ...blackouts] });
    stageOps(ops);
    setView('schedule');
  };

  // "Fix It" produces WishSolutions too, so accept/customize reuse the Wish
  // plumbing — but they live on the Compliance tab, so after staging we jump to
  // the Schedule view where the draft tray (Customize) or the committed change
  // (Accept) is visible.
  const acceptFix = async (sol: WishSolution) => {
    if (!scheduleData) return;
    await commitWishLikeSolution(sol);
    setView('schedule');
  };

  const customizeFix = (sol: WishSolution) => {
    if (!scheduleData) return;
    const { ops, blackouts } = wishSolutionToDraft(sol, scheduleData);
    if (blackouts.length) commitScheduleData({ ...scheduleData, blackouts: [...(scheduleData.blackouts || []), ...blackouts] });
    stageOps(ops);
    setView('schedule');
  };

  // ---- Move This / Replace This / Cancel Recovery ----
  const runRecoveryAI = async (
    kind: 'move' | 'replace' | 'cancel',
    apt: Appointment,
    title: string,
  ) => {
    if (!scheduleData || !aiSettings.apiKey) return;
    setAiLoading(true);
    try {
      const { ClaudeScheduler } = await import('./claudeScheduler');
      const scheduler = new ClaudeScheduler(aiSettings.apiKey, scheduleData, aiSettings.model);
      const aptDate = apt.startTime.slice(0, 10);
      const noteMap = {
        move: `Move this ${apt.type} appointment on ${aptDate} to a suitable time`,
        replace: `Replace this ${apt.type} appointment on ${aptDate} with a suitable alternative`,
        cancel: `Recover from the cancellation of this ${apt.type} appointment on ${aptDate} — suggest a make-up`,
      } as const;
      const sols = await scheduler.generateWishSolutions({ kind: 'freeform', note: noteMap[kind], dateStart: aptDate, dateEnd: aptDate });
      if (sols.length === 0) {
        setDebugMsg('AI found no options for this appointment.');
      } else {
        setRecoverySolutions({ title, solutions: sols });
      }
    } catch (error: any) {
      alert('AI error: ' + (error.message || error));
    } finally {
      setAiLoading(false);
    }
  };

  const handleMoveThis = (apt: Appointment) =>
    runRecoveryAI('move', apt, `Move options — ${apt.title || apt.type}`);

  const handleReplaceThis = (apt: Appointment) =>
    runRecoveryAI('replace', apt, `Replacement options — ${apt.title || apt.type}`);

  const handleFindReplacement = (apt: Appointment) => {
    setRecoveryTarget(null);
    runRecoveryAI('cancel', apt, `Recovery options — ${apt.title || apt.type}`);
  };

  // "Clear loaded data" (Admin → Settings). Drops the working schedule from the
  // UI and returns to the upload/wizard empty state. The user is nudged to
  // download first since this is destructive for unsaved changes.
  const handleClearData = () => {
    if (!confirm('Clear all loaded schedule data from the app? Download your schedule first if you haven\'t saved it — this cannot be undone.')) return;
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

  const handleConfirmCancel = async (cancellation: Cancellation) => {
    if (!cancelTarget) return;
    const target = cancelTarget;
    await persistAppointment({ ...target, status: 'canceled', cancellation });
    setCancelTarget(null);
    // Offer AI recovery only if the appointment was in the future and an API key is set.
    if (aiSettings.apiKey && new Date(target.startTime) > new Date()) {
      setRecoveryTarget(target);
    }
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

  const compactBtn = (label: string, ariaLabel: string, onClick: () => void, color = '#374151', disabled = false) => (
    <button
      onClick={onClick}
      aria-label={ariaLabel}
      title={ariaLabel}
      disabled={disabled}
      style={{
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
        onBiometric={lockMode === 'unlock' && faceIdEnabled ? handleBiometricUnlock : undefined}
        biometricAuto
        biometryLabel={biometryLabel}
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
    const typeAccent = a.type === 'client-session' ? '#7c3aed'
      : a.type === 'supervision' ? '#10b981'
      : a.type === 'parent-training' ? '#3b82f6'
      : a.type === 'reassessment' ? '#f59e0b'
      : a.type === 'case-planning' ? '#0ea5e9'
      : '#6b7280';
    const typeLabel = a.type === 'client-session' ? 'Direct service'
      : a.type === 'parent-training' ? 'Parent training / CoC'
      : a.type === 'internal-task' ? 'Admin work'
      : a.type === 'other' ? 'Meeting'
      : a.type.replace('-', ' ').replace(/^\w/, c => c.toUpperCase());
    const aStart = new Date(a.startTime), aEnd = new Date(a.endTime);
    const dateStr = aStart.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    const timeStr = `${aStart.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}–${aEnd.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    const metaChip: React.CSSProperties = {
      display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600,
      color: '#374151', background: '#f3f4f6', borderRadius: 8, padding: '3px 9px',
    };
    return (
      <div className="af-form" style={{ padding: '16px', borderTop: '1px solid #e5e7eb' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
          <span style={{ width: 4, alignSelf: 'stretch', minHeight: 34, borderRadius: 2, background: typeAccent, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: typeAccent }}>{typeLabel}</div>
            <h3 style={{ margin: '1px 0 0', fontSize: 16, fontWeight: 800, color: '#111827', lineHeight: 1.2 }}>{a.title}</h3>
          </div>
          <span style={{
            fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.03em',
            color: statusColor, backgroundColor: statusBg, padding: '3px 9px', borderRadius: 999, flexShrink: 0,
          }}>{status}</span>
          <button
            className="af-btn"
            onClick={() => setSelectedAppointment(null)}
            aria-label="Close"
            style={{ background: '#f3f4f6', border: 'none', width: 28, height: 28, borderRadius: 8, color: '#6b7280', fontSize: 15, lineHeight: 1, cursor: 'pointer', flexShrink: 0 }}
          >✕</button>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <span style={{ ...metaChip, background: '#eef2ff', color: '#4338ca' }}>🕐 {dateStr} · {timeStr}</span>
          {a.client && <span style={metaChip}>👤 {a.client}</span>}
          {a.technician && <span style={metaChip}>🧑‍⚕️ {a.technician}</span>}
          {a.isMakeUp && <span style={{ ...metaChip, background: '#fef9c3', color: '#854d0e' }}>↩︎ Make-up</span>}
          {a.isBillable
            ? <span style={{ ...metaChip, background: '#dcfce7', color: '#15803d' }}>Billable</span>
            : <span style={{ ...metaChip, background: '#f1f5f9', color: '#64748b' }}>Non-billable</span>
          }
        </div>
        {(() => {
          const flags = detailFlags.get(a.id);
          if (!flags) return null;
          const items: React.ReactNode[] = [];
          if ((flags.cancelEscalation ?? 0) >= 1) {
            const n = flags.cancelEscalation!;
            const suffix = n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th';
            items.push(<span key="cancel" style={{ ...metaChip, background: '#fee2e2', color: '#b91c1c' }}>⚠ {n}{suffix} consecutive cancel this month</span>);
          }
          if ((flags.completedStreak ?? 0) >= 2) {
            const s = flags.completedStreak!;
            if (s % 10 === 0) {
              items.push(<span key="streak-milestone" style={{ ...metaChip, background: '#fef9c3', color: '#854d0e' }}>🏆 {s}-session streak milestone!</span>);
            } else {
              items.push(<span key="streak" style={{ ...metaChip, background: '#fff7ed', color: '#92400e' }}>🔥 {s}-session streak</span>);
            }
          }
          if (flags.isHoliday) {
            items.push(<span key="holiday" style={{ ...metaChip, background: '#dcfce7', color: '#15803d' }}>✦ {flags.holidayName ?? 'Holiday'}</span>);
          }
          if (items.length === 0) return null;
          return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>{items}</div>;
        })()}

        {(status === 'canceled' || status === 'completed') && (
          <p style={{ color: '#6b7280', marginTop: 8, fontSize: 12 }}>
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
        {(() => {
          const apptConflicts = conflicts.filter(c => c.affectedAppointments?.includes(a.id));
          const dismissed = apptConflicts.filter(c => confirmedSet.has(conflictKey(c)));
          const muted = apptConflicts.filter(c => mutedSet.has(conflictKey(c)));
          const conflictTitle = (c: import('./types').ScheduleConflict) => {
            if (c.type === 'availability-conflict') return 'Availability Conflict';
            if (c.type === 'training-violation') return c.message.toLowerCase().includes('below') ? 'PT Below Minimum' : 'PT Over Maximum';
            if (c.type === 'supervision-violation') return 'Supervision Gap';
            return c.message.split(':')[0].trim() || c.type;
          };
          return (
            <>
              {dismissed.length > 0 && (
                <details style={{ marginTop: 10, fontSize: 12 }}>
                  <summary style={{ cursor: 'pointer', color: '#6b7280', fontWeight: 600 }}>
                    Dismissed Issues — permanent ({dismissed.length})
                  </summary>
                  <div style={{ paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {dismissed.map((c, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, background: '#f9fafb', borderRadius: 4, padding: '4px 8px' }}>
                        <span style={{ color: '#374151' }}>{conflictTitle(c)}</span>
                        <button onClick={() => unconfirmConflict(conflictKey(c))} style={{ border: '1px solid #d1d5db', borderRadius: 4, background: 'white', cursor: 'pointer', fontSize: 11, padding: '2px 6px' }}>Restore</button>
                      </div>
                    ))}
                  </div>
                </details>
              )}
              {muted.length > 0 && (
                <details style={{ marginTop: 6, fontSize: 12 }}>
                  <summary style={{ cursor: 'pointer', color: '#6b7280', fontWeight: 600 }}>
                    Snoozed Issues — clears on reload ({muted.length})
                  </summary>
                  <div style={{ paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {muted.map((c, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, background: '#f9fafb', borderRadius: 4, padding: '4px 8px' }}>
                        <span style={{ color: '#374151' }}>{conflictTitle(c)}</span>
                        <button onClick={() => unmuteConflict(conflictKey(c))} style={{ border: '1px solid #d1d5db', borderRadius: 4, background: 'white', cursor: 'pointer', fontSize: 11, padding: '2px 6px' }}>Unsnooze</button>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </>
          );
        })()}
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
              {aiSettings.apiKey && (
                <>
                  <button
                    onClick={() => handleMoveThis(a)}
                    style={{
                      flex: '1 1 auto', padding: '6px 12px', backgroundColor: '#f5f3ff', color: '#5b21b6',
                      border: '1px solid #c4b5fd', borderRadius: '4px', cursor: 'pointer', fontSize: '13px',
                    }}
                  >Move This</button>
                  <button
                    onClick={() => handleReplaceThis(a)}
                    style={{
                      flex: '1 1 auto', padding: '6px 12px', backgroundColor: '#f0f9ff', color: '#0369a1',
                      border: '1px solid #7dd3fc', borderRadius: '4px', cursor: 'pointer', fontSize: '13px',
                    }}
                  >Replace This</button>
                </>
              )}
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
          settings={scheduleData.settings}
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
      <header ref={headerRef as React.RefObject<HTMLElement>} style={{
        backgroundColor: 'var(--surface-header)',
        color: 'white',
        // Top padding includes the iOS status bar / notch inset so the
        // title doesn't sit under the time/carrier indicators.
        padding: 'calc(env(safe-area-inset-top) + 6px) 12px 6px',
        boxShadow: 'var(--shadow-sm)',
        // Both orientations: sticky/fixed at top, never scrolls off-screen.
        position: isLandscape ? 'sticky' : 'fixed',
        top: 0,
        left: isLandscape ? undefined : 0,
        right: isLandscape ? undefined : 0,
        width: isLandscape ? undefined : '100%',
        zIndex: 10,
        flexShrink: 0,
        boxSizing: 'border-box',
      }}>
        {/* Row 1: app name + AI status dot */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
          <h1 style={{ fontSize: '14px', fontWeight: 700, margin: 0, whiteSpace: 'nowrap', letterSpacing: '-0.01em' }}>SAssi · ABA Calendar</h1>
          <span
            title={aiSettings.apiKey ? `AI: ${aiSettings.model}` : 'No AI key set — add in Settings'}
            style={{
              width: 8, height: 8, borderRadius: '50%',
              backgroundColor: aiSettings.apiKey ? '#10b981' : '#ef4444',
              display: 'inline-block', flexShrink: 0,
            }}
          />
        </div>
        {/* Row 2: nav buttons */}
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
          {!scheduleData ? (
            <>
              {compactBtn('Wizard', 'Setup Wizard', () => setShowWizard(true), 'var(--brand-ai)')}
              <FileUpload onUpload={handleFileUpload} loading={loading} />
              {compactBtn('CPR', 'CPR & Analysis', () => setView('cpr'), view === 'cpr' ? 'var(--brand-accent)' : '#374151')}
            </>
          ) : (
            <>
              <button
                onClick={() => setShowAddAppointment(true)}
                aria-label="Add appointment"
                title="Add appointment"
                style={{
                  padding: '5px 10px', backgroundColor: 'var(--brand-primary)', color: 'white',
                  border: 'none', borderRadius: 5, cursor: 'pointer',
                  fontSize: 16, fontWeight: 700, lineHeight: 1,
                }}
              >+</button>
              <NavButtons view={view} onChange={setView} compSummary={compSummary}
                conflictCount={activeConflicts.length}
                conflictHasError={activeConflicts.some(c => c.severity === 'error')} />
            </>
          )}
        </div>
      </header>

      <div
        ref={mainScrollRef as React.RefObject<HTMLDivElement>}
        onScroll={handleMainScroll}
        style={{
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
          // Fixed header in portrait mode: push content down so it doesn't hide
          // behind the header. In landscape the header is sticky (in flow).
          paddingTop: isLandscape ? 0 : headerHeight,
        }}>
        {view === 'cpr' ? (
          <React.Suspense fallback={<div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af' }}>Loading…</div>}>
            <CprView />
          </React.Suspense>
        ) : scheduleData ? (
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
                    blackouts={scheduleData.blackouts}
                    settings={scheduleData.settings}
                    timeOff={scheduleData.timeOff}
                    companyHolidays={scheduleData.companyHolidays}
                    onAppointmentChange={handleAppointmentChange}
                    onSelectAppointment={setSelectedAppointment}
                    onViewDateChange={setViewDate}
                    onLensChange={setCalLens}
                    hideTotals={dockPane}
                    draftMarks={calendarMarks}
                    onMoveThis={aiSettings.apiKey ? handleMoveThis : undefined}
                    onReplaceThis={aiSettings.apiKey ? handleReplaceThis : undefined}
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
                    {!draftActive && visibleConflicts.length > 0 && (
                      <ConflictPanel
                        conflicts={visibleConflicts}
                        appointments={scheduleData?.appointments}
                        onSelectAppointment={setSelectedAppointment}
                        fill={splitView && solutions.length === 0}
                        mutedKeys={mutedConflicts}
                        onMute={muteConflict}
                        onUnmute={unmuteConflict}
                        onConfirmDismiss={confirmDismissConflict}
                        defaultCollapsed={!dockPane}
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
                    {!draftActive && visibleConflicts.length === 0 && solutions.length === 0 && !selectedAppointment && (
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
                    const canCollapse = true;
                    const collapsed = panelCollapsed;
                    return (
                      <div style={{
                        position: 'relative',
                        flex: '0 0 auto',
                        width: collapsed ? 20 : 400,
                        transition: 'width 0.25s ease',
                        minHeight: 0, height: '100%',
                        overflow: 'hidden',
                      }}>
                        {canCollapse && (
                          <button
                            onClick={() => setPanelCollapsed(c => !c)}
                            aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}
                            style={{
                              position: 'absolute', left: 0, top: 40,
                              width: 20, height: 48, zIndex: 20,
                              clipPath: 'polygon(100% 0%, 0% 50%, 100% 100%)',
                              backgroundColor: '#94a3b8',
                              border: 'none', cursor: 'pointer', padding: 0,
                            }}
                          />
                        )}
                        <div ref={detailPanelRef} style={{
                          position: 'absolute',
                          left: 20, top: 0, bottom: 0,
                          width: 380,
                          borderLeft: '1px solid #e5e7eb',
                          display: 'flex', flexDirection: 'column',
                          minHeight: 0, overflow: 'hidden',
                        }}>
                          {!draftActive && calLens !== 'client' && (
                            <div style={{ flexShrink: 0, maxHeight: 'max(160px, 25%)', overflowY: 'auto', padding: '10px 14px', borderBottom: '1px solid #e5e7eb', WebkitOverflowScrolling: 'touch' as any }}>
                              <HoursSummary appointments={calendarAppointments} lens={calLens} settings={scheduleData.settings} timeOff={scheduleData.timeOff} currentDate={viewDate} />
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
                      </div>
                    );
                  }

                  // Narrow: issues flow under the calendar (the selected
                  // appointment is handled by the slide-up sheet below).
                  if (draftActive || visibleConflicts.length > 0 || solutions.length > 0) {
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
                    boxShadow: '0 -6px 24px rgba(0,0,0,0.18)',
                    display: 'flex', flexDirection: 'column', overflow: 'hidden',
                    // Use a fixed height so translateY slides the whole panel in/out
                    // without animating height — prevents content from "jumping up"
                    // as maxHeight grows from 0 during open.
                    height: inlineEdit ? '92vh' : '60vh',
                    transform: selectedAppointment ? 'translateY(0)' : 'translateY(100%)',
                    transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), height 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
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
              <React.Suspense fallback={null}>
                <AdminPanel
                  data={scheduleData}
                  onDataChange={commitFull}
                  persist={serverPersist}
                  onImportFile={triggerImportPicker}
                  onRerunWizard={() => setShowWizard(true)}
                  onDownload={handleDownload}
                  onClearData={handleClearData}
                  aiSettings={aiSettings}
                  onSaveAISettings={handleAISettingsSave}
                  onClearKey={handleClearKey}
                  onRequestUnlock={authenticateForKey}
                  faceIdAvailable={isNative ? faceIdAvailable : undefined}
                  faceIdEnabled={faceIdEnabled}
                  biometryLabel={biometryLabel}
                  onToggleFaceId={handleToggleFaceId}
                  onChangePin={() => setChangingPin(true)}
                />
              </React.Suspense>
            )}
            {view === 'compliance' && (
              <React.Suspense fallback={null}>
                <ComplianceDashboard
                  data={scheduleData}
                  cache={compCache}
                  conflicts={visibleConflicts}
                  aiSettings={aiSettings}
                  mutedConflictKeys={mutedConflicts}
                  onMuteConflict={muteConflict}
                  onUnmuteConflict={unmuteConflict}
                  onConfirmDismissConflict={confirmDismissConflict}
                  onMarkComplete={handleMarkComplete}
                  onRequestCancel={(a) => setCancelTarget(a)}
                  onSelectAppointment={(a) => { setView('schedule'); setSelectedAppointment(a); }}
                  onAcceptFix={acceptFix}
                  onCustomizeFix={customizeFix}
                />
              </React.Suspense>
            )}
            {view === 'caseload' && (
              <React.Suspense fallback={null}>
                <CaseloadView data={scheduleData} now={viewDate} />
              </React.Suspense>
            )}
            {view === 'wish' && (
              <React.Suspense fallback={null}>
                <WishComposer
                  data={scheduleData}
                  aiSettings={aiSettings}
                  onAccept={acceptWish}
                  onCustomize={customizeWish}
                  onClose={() => setView('schedule')}
                />
              </React.Suspense>
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

      {showWizard && (
        <React.Suspense fallback={null}>
          <SetupWizard
            onComplete={handleWizardComplete}
            onCancel={() => setShowWizard(false)}
            initialData={scheduleData || undefined}
          />
        </React.Suspense>
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

      {/* Cancel recovery offer — shown after confirming a cancellation when AI is available */}
      {recoveryTarget && (
        <div
          onClick={() => setRecoveryTarget(null)}
          style={{
            position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1400, padding: 16,
          }}
        >
          <div onClick={e => e.stopPropagation()} style={{
            background: 'white', borderRadius: 10, padding: 20, maxWidth: 340, width: '100%',
            boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
          }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>Appointment canceled</div>
            <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
              Want to find a replacement session to keep this week's schedule on track?
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setRecoveryTarget(null)}
                style={{ padding: '7px 14px', border: '1px solid #d1d5db', borderRadius: 6, background: 'white', cursor: 'pointer', fontSize: 13 }}
              >Just Cancel</button>
              <button
                onClick={() => handleFindReplacement(recoveryTarget)}
                disabled={aiLoading}
                style={{ padding: '7px 14px', border: 'none', borderRadius: 6, background: '#6366f1', color: 'white', cursor: 'pointer', fontSize: 13, fontWeight: 600, opacity: aiLoading ? 0.6 : 1 }}
              >{aiLoading ? 'Searching…' : 'Find Replacement'}</button>
            </div>
          </div>
        </div>
      )}

      {/* AI recovery / move / replace solutions picker */}
      {recoverySolutions && (
        <div
          onClick={() => setRecoverySolutions(null)}
          style={{
            position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1400, padding: 16,
          }}
        >
          <div onClick={e => e.stopPropagation()} style={{
            background: 'white', borderRadius: 10, padding: 20, maxWidth: 420, width: '100%',
            boxShadow: '0 8px 32px rgba(0,0,0,0.25)', maxHeight: '80vh', overflowY: 'auto',
          }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{recoverySolutions.title}</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 14 }}>
              Select an option — Accept commits immediately; Customize stages it for review.
            </div>
            {recoverySolutions.solutions.map((sol, i) => (
              <div key={i} style={{
                border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, marginBottom: 10,
              }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{sol.summary}</div>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>{sol.reasoning}</div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button
                    onClick={() => { setRecoverySolutions(null); customizeWish(sol); }}
                    style={{ padding: '5px 12px', border: '1px solid #d1d5db', borderRadius: 6, background: 'white', cursor: 'pointer', fontSize: 12 }}
                  >Customize</button>
                  <button
                    onClick={() => { setRecoverySolutions(null); acceptWish(sol); }}
                    style={{ padding: '5px 12px', border: 'none', borderRadius: 6, background: '#3b82f6', color: 'white', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                  >Accept</button>
                </div>
              </div>
            ))}
            <div style={{ textAlign: 'right', marginTop: 4 }}>
              <button
                onClick={() => setRecoverySolutions(null)}
                style={{ padding: '6px 14px', border: '1px solid #d1d5db', borderRadius: 6, background: 'white', cursor: 'pointer', fontSize: 13 }}
              >Dismiss</button>
            </div>
          </div>
        </div>
      )}

      {showAddAppointment && scheduleData && (
        <AppointmentForm
          allAppointments={scheduleData.appointments}
          authorizations={scheduleData.authorizations}
          technicians={scheduleData.technicians}
          clients={scheduleData.clients}
          settings={scheduleData.settings}
          initialType={calLens === 'bcba' ? 'supervision' : 'client-session'}
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
          settings={scheduleData.settings}
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
          placeholder={pwPrompt.placeholder}
          submitLabel={pwPrompt.submitLabel}
          onSubmit={(pw) => resolvePassword(pw)}
          onCancel={() => resolvePassword(null)}
        />
      )}

      {/* Re-key flow launched from Settings → App Lock. */}
      {changingPin && (
        <LockScreen mode="create" onCreate={handleChangePin} />
      )}

      {/* Scroll-to-top button: appears when user scrolls up inside a content panel */}
      {showScrollTop && (
        <button
          onClick={() => mainScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="Scroll to top"
          style={{
            position: 'fixed',
            bottom: `calc(env(safe-area-inset-bottom) + 20px)`,
            right: 20,
            zIndex: 50,
            background: 'rgba(255,255,255,0.82)',
            border: '1px solid rgba(0,0,0,0.10)',
            borderRadius: 20,
            padding: '8px 14px',
            boxShadow: '0 2px 10px rgba(0,0,0,0.14)',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 500,
            color: '#374151',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            opacity: 0.88,
            pointerEvents: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 3,
          }}
        >
          <span style={{ fontSize: 11 }}>↑</span>
        </button>
      )}
    </div>
  );
}

// Three-way segmented control for the active view. Sits inline in the header
// at compact-button size so it doesn't blow up the chrome.
function NavButtons({ view, onChange, compSummary, conflictCount, conflictHasError }: {
  view: 'schedule' | 'admin' | 'compliance' | 'caseload' | 'wish' | 'cpr';
  onChange: (v: 'schedule' | 'admin' | 'compliance' | 'caseload' | 'wish' | 'cpr') => void;
  compSummary?: ComplianceSummary | null;
  conflictCount?: number;
  conflictHasError?: boolean;
}) {
  const compRed = compSummary?.red ?? 0;
  const compYellow = compSummary?.yellow ?? 0;
  const badgeCount = (conflictCount ?? 0) + compRed + compYellow;
  const badgeColor = (conflictHasError || compRed > 0) ? '#ef4444'
    : badgeCount > 0 ? '#f59e0b' : '#10b981';

  const btn = (
    label: string,
    key: 'schedule' | 'admin' | 'compliance' | 'caseload' | 'wish' | 'cpr',
    badge?: React.ReactNode,
  ) => {
    const active = view === key;
    return (
      <button
        key={key}
        onClick={() => onChange(key)}
        aria-label={label}
        title={label}
        style={{
          padding: '5px 10px', border: 'none', borderRadius: 5,
          backgroundColor: active ? 'var(--brand-accent)' : '#374151',
          color: 'white', cursor: 'pointer',
          fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
          display: 'inline-flex', alignItems: 'center', gap: 4,
        }}
      >
        {badge}
        {label}
      </button>
    );
  };

  return (
    <>
      {btn('📅 Cal', 'schedule')}
      {btn('Fix', 'compliance', (
        <span style={{
          minWidth: 18, height: 18, padding: '0 4px', borderRadius: 9,
          backgroundColor: badgeColor, color: 'white',
          fontSize: 11, fontWeight: 700,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}>{badgeCount}</span>
      ))}
      {btn('✨Wish', 'wish')}
      {btn('CPR', 'cpr')}
      {btn('⚙️Admin', 'admin')}
    </>
  );
}
