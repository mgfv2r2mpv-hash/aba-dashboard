import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { ConstraintValidator } from './constraintValidator';
import { installNativeAdapter, setCurrentData as setNativeStore } from './nativeApi';
import { ScheduleData, Appointment, ScheduleConflict, ScheduleSolution, WishSolution, WishOp, Cancellation, Blackout, cancellationReasonLabel, DEFAULT_FIXIT_OPTIONS, ActionLogEntry, SchedulingHints } from './types';
import { deriveActionEntry, viewOnlyEntry, pruneLog, buildInverse, summarizeOps, type ActionMeta } from './actionLog';
import { detectHintSignals, type HintSignal } from './hintCapture';
import ActivityLog from './components/ActivityLog';
import CommitToast from './components/CommitToast';
import UndoPreview from './components/UndoPreview';
import CaptureChip from './components/CaptureChip';
import { solveMeetPace } from './localSolver';
import { buildDossier, type Dossier } from './dossier';
import Calendar, { HoursSummary } from './components/Calendar';
import { conflictKey } from './components/ConflictPanel';
import SolutionPanel from './components/SolutionPanel';
import type { AdminPersist, AdminTab } from './components/AdminPanel';
import FileUpload from './components/FileUpload';
import { AISettings, ClaudeModel } from './components/Settings';
import AppointmentForm from './components/AppointmentForm';
import CancellationDialog from './components/CancellationDialog';
import DayReview from './components/DayReview';
import CompleteTimePrompt from './components/CompleteTimePrompt';
import AgendaRail from './components/AgendaRail';
import ImportPreview from './components/ImportPreview';
import { Button } from './components/ui';
import { Rail, CommandBar, ZenStrip, DockChip, DockOverlay, resolveDockMode } from './components/shell';
import type { RailItem, RailKey } from './components/shell';
import { SAssiDock, buildDockIssues, useSassiSession, BuildResultPanel, TidyPanel } from './components/dock';
import type { DockIssue, MeetPaceSeed } from './components/dock';
import { buildSchedule, defaultBuilderConfig, supervisionBuilderConfig, parentTrainingBuilderConfig, combinedBuilderConfig, type BuildResult } from './scheduleBuilder';
import { analyzeTidy, defaultTidyConfig, type TidyResult } from './tidy';
import { extendSeries } from './seriesExtend';
import { buildSeriesEdit, summarizeSeriesEdit } from './seriesEdit';
import { findEndingSeries } from './seriesHorizon';
import { useHomeTodos } from './hooks/useHomeTodos';
import type { HomeTodo } from './hooks/useHomeTodos';
import { backupFilename } from './lib/backupFilename';
import type { RitualAction } from './components/HomeView';

const HomeView = React.lazy(() => import('./components/HomeView'));
const AdminPanel = React.lazy(() => import('./components/AdminPanel'));
const CCHub = React.lazy(() => import('./components/CCHub'));
import type { HubTab } from './components/CCHub';
const CaseloadView = React.lazy(() => import('./components/CaseloadView'));
const SetupWizard = React.lazy(() => import('./components/SetupWizard'));
const CprView = React.lazy(() => import('./components/CprView'));
import { useMinWidth, useMaxWidth, useIsTablet, useIsLandscape } from './useMediaQuery';
import LockScreen from './components/LockScreen';
import LaunchSplash from './components/LaunchSplash';
import PasswordPrompt from './components/PasswordPrompt';
import {
  hasPin, setPin, verifyPin, changePin,
  saveSchedule, loadSchedule,
  saveAIConfig, loadAIConfig, clearAIConfig,
  isFaceIdEnabled, enableFaceId, disableFaceId, recoverPinViaBiometric,
  clearStaleAtRest,
} from './appLock';
import { migrateScheduleData, wrapEnvelope, unwrapBackup, collectUnresolvedRefs } from './scheduleMigrations';
import { validatePassword } from './passwordPolicy';
import { loadPasswordDict } from './passwordDictLoader';
import { nameOf } from './entityRefs';
import { RosterProvider } from './rosterContext';
import { resolveAtRestAIConfig } from './aiConfigPolicy';
import { isBiometricAvailable, checkBiometryFull, biometricAuthenticate, getBiometryLabel, BiometryLabel, getCachedBiometryAvailable, getCachedBiometryLabel } from './biometric';
import { pastIncompleteAppointments } from './compliance';
import {
  ComplianceCache, ComplianceSummary, ApptChange,
  buildCache, recomputeCache, summarize, attentionList,
} from './complianceCache';
import {
  obfuscateKey, deobfuscateKey, encryptBytes, decryptBytes, isEncryptedSchedule,
} from './clientCrypto';
import {
  DraftOp, applyOps, renderList, newAddOp, newMoveOp, newShortenOp, newRemoveOp,
} from './draft';
import { solveDraft, DraftStatus, PrioritizationChoice } from './draftSolver';
import DraftTray from './components/DraftTray';
import FindTimeModal from './components/FindTimeModal';
import { wishSolutionToDraft, dropPastOps, dropInfeasibleTravelOps, dropDoubleBookedOps, applyHintChanges, type WishDraft } from './wish';
import { consolidateAdjacentBcba } from './builderConsolidate';
import { computeSessionFlags, SessionFlags, streakEmoji } from './sessionFlags';

// Route axios /api/* calls through an in-memory store on EVERY platform. Native
// (WebView at capacitor://localhost) has no Express server; the web build is served
// statically (Cloudflare Pages) with no Node backend either. The same in-memory
// adapter backs both, so the deterministic builder + all edits work serverlessly.
// src/server.ts remains only for legacy/self-hosted runs.
installNativeAdapter();

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

// A JSON backup envelope begins with '{' (after optional whitespace); an .xlsx is a
// PK zip (0x50 0x4B). Sniff the leading bytes to tell them apart on import.
function looksLikeJsonEnvelope(bytes: Uint8Array): boolean {
  for (let i = 0; i < Math.min(bytes.length, 64); i++) {
    const b = bytes[i];
    if (b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d) continue; // skip whitespace
    return b === 0x7b; // '{'
  }
  return false;
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
  const [view, setView] = useState<'home' | 'schedule' | 'admin' | 'compliance' | 'caseload' | 'cpr'>('schedule');
  // Which Admin section opens on entry. The C&C hub's view-only settings popup
  // deep-links to the editable 'candc' tab; normal Admin entry resets to settings.
  const [adminInitialTab, setAdminInitialTab] = useState<AdminTab>('settings');
  const [showWizard, setShowWizard] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAddAppointment, setShowAddAppointment] = useState(false);
  // Home to-dos (net-new, local-only) + the seed for "Start → session": an
  // id-less appointment the form treats as new and prefills from the to-do.
  const homeTodos = useHomeTodos();
  const [sessionSeed, setSessionSeed] = useState<Partial<Appointment> | null>(null);
  const [startedTodoId, setStartedTodoId] = useState<string | null>(null);
  // Narrow-screen SAssi dock: below 1024 the always-on column has no room, so
  // the same dock opens from a FAB as a slide-up sheet.
  const [dockSheetOpen, setDockSheetOpen] = useState(false);
  // Tablet-portrait: the dock collapses to a top-right chip; this tracks whether
  // it's currently rolled open over the right side.
  const [dockOpen, setDockOpen] = useState(false);
  // "Fix pace with SAssi" (Phase 2): a case-scoped meet-pace request seeded into
  // the dock. Bumping the token re-triggers the solve for the same or a new case.
  const [meetPaceSeed, setMeetPaceSeed] = useState<MeetPaceSeed | null>(null);
  const meetPaceTokenRef = React.useRef(0);
  // "Doctor my schedule" — a local, AI-free diagnosis of whatever's in focus
  // (the selected appointment / its case). Cleared when the focus changes so it
  // never lingers stale over a different session.
  const [dossier, setDossier] = useState<Dossier | null>(null);
  // A stale dossier over a different session is misleading — drop it whenever the
  // focused appointment changes (opening the doctor sets it without changing focus).
  // MUST stay above the lock/splash early returns — a hook below them changes the
  // hook count between the locked and unlocked renders and blanks the tree.
  React.useEffect(() => { setDossier(null); }, [selectedAppointment?.id]);
  // Which Caseload sub-tab to open — the dock's "fix compliance" routes to Issues,
  // where per-case compliance cards hand off to the SAssi dock for remediation.
  const [ccInitialTab, setCcInitialTab] = useState<HubTab>('cases');
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
  // Day-offs sAssI proposed alongside the current draft. Buffered here (not
  // committed) and merged into the schedule when the draft is accepted, so a
  // proposal can't mutate the base mid-conversation and reset the chat session.
  const [sassiBlackouts, setSassiBlackouts] = useState<Blackout[]>([]);
  // Per-client scheduling-hint patches sAssI proposed (setHint ops — the taught
  // heuristics). Same buffer-and-commit-on-Accept lifecycle as the blackouts.
  const [sassiHints, setSassiHints] = useState<WishDraft['hintChanges']>([]);
  // Metrics + unfillable-case blocks from the last deterministic "Build direct
  // schedule" run, shown alongside the staged draft; cleared when the draft ends.
  const [buildResult, setBuildResult] = useState<BuildResult | null>(null);
  // Equivalence-verified auto cleanups + review suggestions from the last "Tidy
  // schedule" run; shown alongside the staged draft, cleared when the draft ends.
  const [tidyResult, setTidyResult] = useState<TidyResult | null>(null);
  // ── Action log / undo (see src/actionLog.ts) ─────────────────────────────
  // Post-commit toast: the head log entry + a one-tap exact undo while nothing
  // else has committed. Replaced by each new logged commit; auto-dismisses.
  const [undoToast, setUndoToast] = useState<{ entryId: string; label: string } | null>(null);
  const undoToastTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // A selective undo staged into the draft tray: which entry, plus the parts
  // DraftOps can't model (blackout removals, hint restores) applied on Accept.
  const [pendingUndo, setPendingUndo] = useState<{
    entryId: string; label: string; superseded: string[];
    removeBlackoutIds: string[]; hintRestores: { clientId: string; hints?: SchedulingHints }[];
  } | null>(null);
  const [showActivity, setShowActivity] = useState(false);
  // Teach-loop offers detected at Accept (corrections of builder-placed
  // supervision → "Remember for <client>" chips), shown one at a time.
  const [hintSignals, setHintSignals] = useState<HintSignal[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<Appointment | null>(null);
  const [recoveryTarget, setRecoveryTarget] = useState<Appointment | null>(null);
  // Local "find a spot" rescheduler target (Move This / Replace This).
  const [findTime, setFindTime] = useState<{ apt: Appointment; mode: 'move' | 'replace' } | null>(null);
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
  const [pwPrompt, setPwPrompt] = useState<{ title: string; message: string; placeholder?: string; submitLabel?: string; policy?: boolean } | null>(null);
  const pwResolverRef = React.useRef<((pw: string | null) => void) | null>(null);
  const askPassword = (title: string, message: string, opts?: { placeholder?: string; submitLabel?: string; policy?: boolean }) =>
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
  // Shell layout: phones (≤639) drop the vertical rail for a bottom nav; the
  // always-on SAssi dock only appears when there's room for it (≥1024).
  const compactRail = useMaxWidth(639);
  const showDock = useMinWidth(1024);
  // The SAssi dock has three presentations by width: a phone slide-up sheet, a
  // tablet-portrait collapsible chip that rolls open over the right side, and the
  // desktop permanent column (see resolveDockMode).
  const dockMode = resolveDockMode({ compactRail, showDock });
  // Only the permanent column splits the schedule view into two independently-
  // scrolling panes; the chip/sheet modes keep the calendar as one full-width page.
  const splitView = dockMode === 'column' && view === 'schedule';

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

  // ── sAssI conversation ─────────────────────────────────────────────────────
  // A sAssI proposal REPLACES the live draft preview (the chat owns the draft
  // while a conversation is open); accepting/discarding the draft ends it.
  const stageSassiOps = React.useCallback((ops: WishOp[]) => {
    const base = scheduleData;
    if (!base) return;
    // Hard real-world guards: a suggestion can never place/move a session into the
    // past, double-book the single BCBA, nor land two BCBA sessions with no time to
    // drive between them. Then fuse any adjacent BCBA fragments (from the build OR a
    // free-authored edit) so no split sliver reaches the tray — "tidy the draft".
    const safe = consolidateAdjacentBcba(dropDoubleBookedOps(dropInfeasibleTravelOps(dropPastOps(ops), base), base), base);
    const { ops: draftOps, blackouts, hintChanges } = wishSolutionToDraft({ id: 'sassi', summary: '', reasoning: '', ops: safe }, base);
    // Blackouts + hint patches aren't part of the editable draft (DraftOps model
    // appointments only), so buffer them and commit WITH the draft on Accept —
    // committing mid-conversation would replace scheduleData and reset the
    // sAssI session (fresh anonymization map + wiped history). sAssI re-emits the
    // COMPLETE proposal each turn, so REPLACE both buffers (dedup at commit).
    setSassiBlackouts(blackouts);
    setSassiHints(hintChanges);
    setDraftOps(draftOps);
  }, [scheduleData]);

  // THE one-tap assistant move: directs → supervision → parent training in a
  // single pass (the same engine the chat's "build my month" routes to), staged
  // as one reviewable draft. The three pass buttons below remain for partial
  // rebuilds.
  const handleBuildCombined = () => {
    if (!scheduleData) return;
    const now = new Date();
    const result = buildSchedule(scheduleData, combinedBuilderConfig(scheduleData, now), now);
    stageSassiOps(result.solution.ops);
    setBuildResult(result);
  };
  // One-tap deterministic build: the engine (never Claude) places a recurring
  // direct backbone for the month and stages it through the normal draft pipeline;
  // the BuildResultPanel surfaces what it placed and which cases it couldn't fill.
  const handleBuildDirect = () => {
    if (!scheduleData) return;
    const now = new Date();
    const result = buildSchedule(scheduleData, defaultBuilderConfig(scheduleData, now), now);
    stageSassiOps(result.solution.ops);
    setBuildResult(result);
  };
  // Standalone supervision pass: chase every case to its supervision floor/cadence
  // over the existing directs (materializing them to dated rows so later weeks are
  // supervisable), through the same draft pipeline. Run it after a direct build.
  const handleBuildSupervision = () => {
    if (!scheduleData) return;
    const now = new Date();
    const result = buildSchedule(scheduleData, supervisionBuilderConfig(scheduleData, now), now);
    stageSassiOps(result.solution.ops);
    setBuildResult(result);
  };
  // Standalone parent-training pass: chase every case to its monthly PT hours goal
  // over the existing/materialized directs (each PT session overlaps a real direct
  // and names its BT), through the same draft pipeline. Run it after a direct build.
  const handleBuildParentTraining = () => {
    if (!scheduleData) return;
    const now = new Date();
    const result = buildSchedule(scheduleData, parentTrainingBuilderConfig(scheduleData, now), now);
    stageSassiOps(result.solution.ops);
    setBuildResult(result);
  };
  // One-tap deterministic tidy: find behavior-preserving cleanups and stage ONLY
  // the equivalence-verified auto set into the draft; the TidyPanel surfaces the
  // badge + review-only suggestions. Staged WITHOUT dropInfeasibleTravelOps — tidy
  // never introduces a travel leg (merges keep the footprint, removes drop rows,
  // regroup/snap don't relocate to a new site), and the travel guard could drop a
  // merge's `move` while keeping its `remove`s → orphaned hours. The equivalence
  // oracle inside analyzeTidy is the authority; dropPastOps stays (harmless).
  const handleTidy = () => {
    if (!scheduleData) return;
    const result = analyzeTidy(scheduleData, defaultTidyConfig(), new Date());
    const { ops, blackouts } = wishSolutionToDraft({ id: 'tidy', summary: '', reasoning: '', ops: dropPastOps(result.auto.ops) }, scheduleData);
    setSassiBlackouts(blackouts);
    setDraftOps(ops);
    setTidyResult(result);
  };
  // Extend a recurring series forward (from the Edit panel): materialize the missing
  // occurrences up to the chosen date under the same seriesId, folding in stray
  // lone-recurring rows, and stage them through the normal draft pipeline for review.
  const handleExtendSeries = (seriesId: string, endDateISO: string) => {
    if (!scheduleData) return;
    const result = extendSeries(scheduleData, seriesId, endDateISO, new Date());
    setEditingAppointment(null);
    if (result.ops.length === 0) { setDebugMsg(result.reason ?? 'Nothing to extend for this series.'); return; }
    stageSassiOps(result.ops);
    const relinkNote = result.relinked ? `, relinked ${result.relinked} stray session${result.relinked === 1 ? '' : 's'}` : '';
    setDebugMsg(`Extended series: +${result.added} session${result.added === 1 ? '' : 's'}${relinkNote} through ${result.through}. Review in the dock, then Accept.`);
  };
  const sassi = useSassiSession({
    getSchedule: () => scheduleData,
    apiKey: aiSettings.apiKey,
    model: aiSettings.model,
    onProposal: stageSassiOps,
    getFocusedAppointmentId: () => selectedAppointment?.id ?? null,
  });
  // Per-session cost lever: flip the chat between Sonnet (reasoning) and Haiku
  // (cheap iterating) without dropping the conversation.
  const toggleSassiModel = () => {
    setAiSettings(prev => ({
      ...prev,
      model: prev.model === 'claude-haiku-4-5-20251001' ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001',
    }));
  };
  const sassiChat = { session: sassi, model: aiSettings.model, onToggleModel: toggleSassiModel };
  const detailFlags = React.useMemo<Map<string, SessionFlags>>(
    () => scheduleData
      ? computeSessionFlags(scheduleData.appointments, scheduleData.companyHolidays ?? [])
      : new Map(),
    [scheduleData],
  );
  // Series about to run off their materialized horizon — feeds the dock's
  // info-level "extend?" prompts. MUST live above the lockReady/locked early
  // returns with the other hooks: a hook below them runs only after unlock,
  // and the changed hook count across that transition crashes React (the
  // white-screen-after-Face-ID bug).
  const endingSeries = React.useMemo(
    () => (scheduleData ? findEndingSeries(scheduleData, new Date()) : []),
    [scheduleData],
  );

  // Measure the header height (for the portrait fixed-header layout) and keep
  // it updated if the content/safe-area changes (e.g. data load changes toolbar).
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setHeaderHeight(el.getBoundingClientRect().bottom);
    });
    ro.observe(el);
    setHeaderHeight(el.getBoundingClientRect().bottom);
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
      if (dockMode !== 'sheet') {
        // Chip/column show the detail in the dock's selected slot — roll the chip
        // open if it's collapsed, then scroll the detail into view.
        if (dockMode === 'chip') setDockOpen(true);
        if (detailPanelRef.current) {
          detailPanelRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      } else {
        savedScrollRef.current = mainScrollRef.current?.scrollTop ?? 0;
      }
    } else if (dockMode === 'sheet') {
      const saved = savedScrollRef.current;
      const scrollEl = mainScrollRef.current;
      // Delay matches the sheet close animation (300ms) so the scroll happens
      // after the sheet is off-screen, not while it's still visible.
      setTimeout(() => { if (scrollEl) scrollEl.scrollTop = saved; }, 320);
    }
  }, [selectedAppointment, dockMode]);

  // A new selection (or clearing it) always starts on the read-only detail, not
  // mid-edit, so the panel collapses back from any prior expanded edit form.
  useEffect(() => { setInlineEdit(false); }, [selectedAppointment?.id]);

  // On phones the schedule dock lives behind a FAB, so a freshly staged draft
  // (typically a drag-to-reschedule) would be silent — auto-open the sheet so the
  // DraftTray is visible. Closing the sheet leaves the draft staged.
  useEffect(() => {
    if (!draftActive || view !== 'schedule') return;
    // A freshly staged draft (usually a drag-to-reschedule) must not be silent:
    // phones open the sheet, tablet-portrait rolls the chip open. The permanent
    // column is always visible, so it needs nothing.
    if (dockMode === 'sheet') setDockSheetOpen(true);
    else if (dockMode === 'chip') setDockOpen(true);
  }, [draftActive, view, dockMode]);

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
      // Persist whenever there's a key OR a schedule password — never let an
      // empty key wipe a just-set password from the at-rest config.
      const action = resolveAtRestAIConfig(settings);
      if (action.kind === 'save') void saveAIConfig(action.config, pin);
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
      const parsed = JSON.parse(decrypted) as { apiKey: string; model: ClaudeModel; mapsApiKey?: string };
      const restored: AISettings = {
        ...aiSettings,
        apiKey: parsed.apiKey,
        model: parsed.model || aiSettings.model || 'claude-sonnet-4-6',
        mapsApiKey: parsed.mapsApiKey ?? aiSettings.mapsApiKey,
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
    // Any real schedule change (accept/save/AI-accept, import, wizard) invalidates
    // the last build snapshot — clear it here so the panel can never describe a
    // schedule that no longer exists. No-commit discards (cancel, per-op reset)
    // clear it at their own call sites.
    setBuildResult(null);
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
    if (aiConfig?.apiKey || aiConfig?.mapsApiKey || aiConfig?.schedulePassword) {
      const restoredSettings: AISettings = {
        ...aiSettings,
        apiKey: aiConfig.apiKey || aiSettings.apiKey,
        model: (aiConfig.model as ClaudeModel) || aiSettings.model || 'claude-sonnet-4-6',
        schedulePassword: aiConfig.schedulePassword,
        mapsApiKey: aiConfig.mapsApiKey,
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
    if (aiSettings.apiKey || aiSettings.mapsApiKey || aiSettings.schedulePassword) {
      await saveAIConfig({ apiKey: aiSettings.apiKey, model: aiSettings.model, schedulePassword: aiSettings.schedulePassword, mapsApiKey: aiSettings.mapsApiKey }, pin);
    } else await clearAIConfig();
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

  // Apply an already-parsed import as the working schedule. The in-memory adapter
  // is the store on every platform, so prime it directly rather than round-tripping
  // the decrypted bytes through /api/upload. Migrate/backfill to the current schema
  // so new fields are present even when the source predates them.
  const applyImported = async (_bytes: Uint8Array, data: ScheduleData, embeddedConfig?: string) => {
    const base = migrateScheduleData(data);
    // A wholesale replace: log a view-only marker (op diffs vs. the previous
    // schedule would be noise, and inverse ops across an import are wrong).
    const migrated: ScheduleData = {
      ...base,
      actionLog: pruneLog([...(base.actionLog ?? []), viewOnlyEntry(base, { label: 'Imported schedule file', source: 'import' })]),
    };
    setNativeStore(migrated);
    commitFull(migrated);
    setSolutions([]);
    // Surface any references the ID migration couldn't heal (a since-deleted entity,
    // or an ambiguous stale name) so the user can reassign those sessions in Admin —
    // rather than letting them silently orphan as before.
    const orphans = collectUnresolvedRefs(migrated);
    if (orphans.length) {
      const total = orphans.reduce((n, o) => n + o.count, 0);
      const head = orphans.slice(0, 8).map(o => `"${o.ref}" (${o.kind}×${o.count})`).join(', ');
      console.warn('[import] unresolved entity references after ID migration:', orphans);
      setDebugMsg(`${total} session/link reference${total === 1 ? '' : 's'} couldn't be matched to a current client/technician: ${head}${orphans.length > 8 ? ` +${orphans.length - 8} more` : ''}. Reassign them in Admin.`);
    }
    if (embeddedConfig) await loadEmbeddedKey(embeddedConfig);
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

      // After any decryption the bytes are either an .xlsx workbook (a PK zip) or
      // a JSON backup envelope ('{'). Route an envelope through the lossless
      // migration path; everything else stays on the xlsx parser.
      if (looksLikeJsonEnvelope(bytes)) {
        // A JSON backup may carry the AI settings (obfuscated) so they restore on
        // import — the same round-trip the retired .xlsx _Config gave, now portable
        // between the app and the web portal.
        const { data, aiConfig } = unwrapBackup(new TextDecoder().decode(bytes));
        if (scheduleData) {
          setPendingImport({ bytes, fileName: file.name, data, embeddedConfig: aiConfig });
          return;
        }
        await applyImported(bytes, data, aiConfig);
        return;
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
  // Dragging a SERIES MEMBER first asks for scope (This / This+Following / All)
  // — series scopes apply the same day+time delta to every pending occurrence
  // via buildSeriesEdit (user decision: ask on drop, never silently move one
  // row out of its series). One-time rows keep the instant single-move.
  const [dragScopePrompt, setDragScopePrompt] = useState<{ original: Appointment; moved: Appointment } | null>(null);
  const handleAppointmentChange = (appointment: Appointment) => {
    const original = scheduleData?.appointments.find(a => a.id === appointment.id);
    const isSeriesMember = !!original?.seriesId
      && scheduleData!.appointments.filter(a => a.seriesId === original.seriesId).length > 1;
    if (original && isSeriesMember) {
      setDragScopePrompt({ original, moved: appointment });
      return;
    }
    stageOps([newMoveOp(appointment)]);
  };
  const resolveDragScope = (scope: 'instance' | 'following' | 'all' | 'cancel') => {
    if (!dragScopePrompt || !scheduleData) { setDragScopePrompt(null); return; }
    const { original, moved } = dragScopePrompt;
    setDragScopePrompt(null);
    if (scope === 'cancel') return;
    if (scope === 'instance') { stageOps([newMoveOp(moved)]); return; }
    const r = buildSeriesEdit({ all: scheduleData.appointments, original, edited: moved, scope, cadence: null });
    stageOps([
      ...r.upserts.map(u => (scheduleData.appointments.some(x => x.id === u.id) ? newMoveOp(u) : newAddOp(u))),
      ...r.removeIds.map(id => newRemoveOp(id)),
    ]);
  };

  // Apply one tidy review suggestion — append its ops to the current draft (same
  // no-travel-guard rationale as handleTidy; each suggestion is a single group and
  // user-reviewed, so appending is safe).
  const applyTidySuggestion = (ops: WishOp[]) => {
    if (!scheduleData) return;
    const { ops: draftOps, blackouts } = wishSolutionToDraft({ id: 'tidy-sug', summary: '', reasoning: '', ops: dropPastOps(ops) }, scheduleData);
    if (blackouts.length) setSassiBlackouts(prev => [...prev, ...blackouts]);
    stageOps(draftOps);
  };

  // Sync the in-memory store to a full replacement, then commit to React state +
  // rebuild the compliance cache. The adapter serves this store on every platform.
  //
  // When `log` metadata is supplied, the TRUE committed delta (prev vs next —
  // including engine relocations and side-channel merges) is derived into an
  // append-only ActionLogEntry riding inside the schedule itself, and the
  // post-commit Undo toast is armed. Callers without metadata (unlock, raw
  // store syncs) commit silently, exactly as before.
  const showUndoToast = (entryId: string, label: string) => {
    if (undoToastTimer.current) clearTimeout(undoToastTimer.current);
    setUndoToast({ entryId, label });
    undoToastTimer.current = setTimeout(() => setUndoToast(null), 8000);
  };
  const commitScheduleData = async (next: ScheduleData, log?: ActionMeta) => {
    let final = next;
    if (log && scheduleData) {
      const entry = deriveActionEntry(scheduleData, next, log);
      if (entry) {
        final = { ...next, actionLog: pruneLog([...(next.actionLog ?? scheduleData.actionLog ?? []), entry]) };
        if (entry.undoable) showUndoToast(entry.id, entry.label);
      }
    }
    setNativeStore(final);
    commitFull(final);
  };

  // Admin-driven whole-state change (archive / unarchive a case) with an Activity
  // entry. Archive passes undoable:false — the session deletions are permanent by
  // design (Unarchive is the reversal), so we record it without offering a
  // half-undo that would restore sessions but leave the client archived.
  const commitLogged = (next: ScheduleData, label: string, undoable = true) =>
    commitScheduleData(next, { label, source: 'admin', undoable });

  // Fold any sAssI-buffered day-offs into the schedule being committed, deduped by
  // (entity, date) so a proposal that persisted across turns can't double-log them.
  const withSassiBlackouts = (next: ScheduleData): ScheduleData => {
    if (!sassiBlackouts.length) return next;
    const existing = next.blackouts || [];
    const fresh = sassiBlackouts.filter(b => !existing.some(e => e.entityType === b.entityType && e.entityId === b.entityId && e.date === b.date));
    return fresh.length ? { ...next, blackouts: [...existing, ...fresh] } : next;
  };

  // Fold any sAssI-proposed scheduling-hint patches (setHint ops) into the commit.
  const withSassiHints = (next: ScheduleData): ScheduleData =>
    sassiHints.length ? { ...next, clients: applyHintChanges(next.clients, sassiHints) } : next;

  // Undo-specific parts DraftOps can't model, folded in at Accept: strip the
  // entry's added blackouts, restore the entry's before-hints.
  const withUndoExtras = (next: ScheduleData): ScheduleData => {
    if (!pendingUndo) return next;
    let out = next;
    if (pendingUndo.removeBlackoutIds.length) {
      out = { ...out, blackouts: (out.blackouts ?? []).filter(b => !pendingUndo.removeBlackoutIds.includes(b.id)) };
    }
    if (pendingUndo.hintRestores.length) {
      out = {
        ...out,
        clients: out.clients.map(c => {
          const h = pendingUndo.hintRestores.find(x => x.clientId === c.id);
          return h ? { ...c, schedulingHints: h.hints } : c;
        }),
      };
    }
    return out;
  };

  // What kind of change is this draft, for the log line. Undo > build > tidy >
  // chat > manual (a chat proposal stages through stageSassiOps like builds do).
  const draftMeta = (): ActionMeta => {
    if (pendingUndo) return { label: `Undid: ${pendingUndo.label}`, source: 'undo' };
    if (buildResult) return { label: `Build — ${summarizeOps(draftOps)}`, source: 'build' };
    if (tidyResult) return { label: `Tidy — ${summarizeOps(draftOps)}`, source: 'tidy' };
    if (sassi.active) return { label: `sAssI — ${summarizeOps(draftOps)}`, source: 'chat' };
    return { label: summarizeOps(draftOps), source: 'manual' };
  };

  const acceptDraft = async () => {
    if (!scheduleData || !draftStatus) return;
    const next = withUndoExtras(withSassiHints(withSassiBlackouts(draftStatus.resolved || applyOps(scheduleData, draftOps))));
    // Teach loop: when a BUILD staged this draft, diff the builder's original
    // supervision intent against what the user actually accepted — a
    // recognizable correction (daypart move / split / unsplit) becomes a
    // one-tap "Remember for <client>" offer. Confirmation only, never silent.
    if (buildResult) {
      try { setHintSignals(detectHintSignals(buildResult.solution.ops, next)); } catch { /* detection must never block a commit */ }
    }
    await commitScheduleData(next, draftMeta());
    setDraftOps([]); setSolutions([]); setSelectedAppointment(null); setSassiBlackouts([]); setSassiHints([]); setTidyResult(null); setPendingUndo(null); sassi.reset();
  };

  // One-tap hint capture from the chip: patch the client's schedulingHints with
  // provenance 'learned' and log it (so even teaching is undoable).
  const rememberHint = async (signal: HintSignal) => {
    if (!scheduleData) return;
    const next: ScheduleData = {
      ...scheduleData,
      clients: scheduleData.clients.map(c => c.id === signal.clientId
        ? { ...c, schedulingHints: { ...c.schedulingHints, ...signal.suggest, source: 'learned' as const, updatedAt: new Date().toISOString().slice(0, 10) } }
        : c),
    };
    await commitScheduleData(next, { label: `Hint: ${signal.clientName} — ${signal.detail}`, source: 'manual' });
    setHintSignals(sig => sig.filter(s => s !== signal));
  };

  const saveAnyway = async () => {
    if (!scheduleData) return;
    if (!confirm('Save this schedule as-is, with the flagged conflicts?')) return;
    const meta = draftMeta();
    await commitScheduleData(withUndoExtras(withSassiHints(withSassiBlackouts(applyOps(scheduleData, draftOps)))), { ...meta, label: `${meta.label} (saved with conflicts)` });
    setDraftOps([]); setSolutions([]); setSelectedAppointment(null); setSassiBlackouts([]); setSassiHints([]); setTidyResult(null); setPendingUndo(null); sassi.reset();
  };

  const cancelDraft = () => { setDraftOps([]); setSolutions([]); setSassiBlackouts([]); setSassiHints([]); setBuildResult(null); setTidyResult(null); setPendingUndo(null); sassi.reset(); };
  const resetOp = (opId: string) => {
    setDraftOps(ops => ops.filter(o => o.id !== opId));
    // Removing the last staged op empties the draft (no commit fires), so the
    // build snapshot is now stale — clear it alongside.
    if (draftOps.length <= 1) setBuildResult(null);
  };

  // ── Selective undo (nonlinear) ───────────────────────────────────────────
  // Stage entry K's inverse ops into the NORMAL draft pipeline: the tray is the
  // blast-radius preview (op list + per-op ✕, solveDraft grade, and the
  // UndoPreview panel's superseded warnings + per-entity impact). Accept then
  // commits through the same gates as any draft and logs a new 'undo' entry.
  const stageUndo = (entry: ActionLogEntry) => {
    if (!scheduleData || !entry.undoable) return;
    if (draftOps.length > 0 && !confirm('Discard the currently staged changes and stage this undo instead?')) return;
    const inv = buildInverse(entry, scheduleData);
    if (inv.ops.length === 0 && inv.removeBlackoutIds.length === 0 && inv.hintRestores.length === 0) {
      setDebugMsg('Nothing left to undo — every change in that entry was already superseded or removed.');
      return;
    }
    cancelDraft();
    setDraftOps(inv.ops);
    setPendingUndo({
      entryId: entry.id, label: entry.label, superseded: inv.superseded,
      removeBlackoutIds: inv.removeBlackoutIds, hintRestores: inv.hintRestores,
    });
    setShowActivity(false);
    setView('schedule');
  };

  // Toast Undo: while the entry is still the log head and no draft is open, the
  // inverse is exact by construction → commit immediately (one tap). Any other
  // state falls through to the previewed stageUndo path. One inverse
  // implementation, two entry points.
  const undoFromToast = async () => {
    if (!scheduleData || !undoToast) return;
    const log = scheduleData.actionLog ?? [];
    const head = log.length ? log[log.length - 1] : undefined;
    const toast = undoToast;
    setUndoToast(null);
    if (!head || head.id !== toast.entryId || !head.undoable) return;
    const inv = buildInverse(head, scheduleData);
    if (inv.superseded.length === 0 && draftOps.length === 0) {
      let next = applyOps(scheduleData, inv.ops);
      if (inv.removeBlackoutIds.length) {
        next = { ...next, blackouts: (next.blackouts ?? []).filter(b => !inv.removeBlackoutIds.includes(b.id)) };
      }
      if (inv.hintRestores.length) {
        next = {
          ...next,
          clients: next.clients.map(c => {
            const h = inv.hintRestores.find(x => x.clientId === c.id);
            return h ? { ...c, schedulingHints: h.hints } : c;
          }),
        };
      }
      await commitScheduleData(next, { label: `Undid: ${head.label}`, source: 'undo' });
    } else {
      stageUndo(head);
    }
  };

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
  // Every AI solution (Wish It / Fix It) converts to draft ops through here; strip
  // any past-dated add/move first so a suggestion can never land a session before
  // now — the same real-world guard the sAssI chat uses (dropPastOps).
  const draftFromSolution = (sol: WishSolution, base: ScheduleData) =>
    wishSolutionToDraft({ ...sol, ops: consolidateAdjacentBcba(dropDoubleBookedOps(dropInfeasibleTravelOps(dropPastOps(sol.ops), base), base), base) }, base);

  const commitWishLikeSolution = async (sol: WishSolution): Promise<boolean> => {
    if (!scheduleData) return false;
    const { ops, blackouts, hintChanges } = draftFromSolution(sol, scheduleData);
    const status = solveDraft(scheduleData, ops, new Date(), scheduleData.settings);
    if (status.grade === 'red') {
      if (blackouts.length || hintChanges.length) {
        let side = { ...scheduleData, blackouts: [...(scheduleData.blackouts || []), ...blackouts] };
        side = { ...side, clients: applyHintChanges(side.clients, hintChanges) };
        await commitScheduleData(side, { label: 'Day-offs / preferences recorded', source: 'wish' });
      }
      stageOps(ops);
      return false;
    }
    const resolved = status.resolved || applyOps(scheduleData, ops);
    let next = blackouts.length ? { ...resolved, blackouts: [...(resolved.blackouts || []), ...blackouts] } : resolved;
    if (hintChanges.length) next = { ...next, clients: applyHintChanges(next.clients, hintChanges) };
    await commitScheduleData(next, { label: sol.summary?.trim() || `Wish — ${summarizeOps(ops)}`, source: 'wish' });
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
    const { ops, blackouts, hintChanges } = draftFromSolution(sol, scheduleData);
    if (blackouts.length || hintChanges.length) {
      commitScheduleData(
        { ...scheduleData, blackouts: [...(scheduleData.blackouts || []), ...blackouts], clients: applyHintChanges(scheduleData.clients, hintChanges) },
        { label: 'Day-offs / preferences recorded', source: 'wish' },
      );
    }
    stageOps(ops);
    setView('schedule');
  };

  // ---- Move This / Replace This / Cancel Recovery ----
  const runRecoveryAI = async (
    kind: 'move' | 'replace' | 'cancel',
    apt: Appointment,
    title: string,
    range?: { dateStart: string; dateEnd: string },
  ) => {
    if (!scheduleData || !aiSettings.apiKey) return;
    setAiLoading(true);
    try {
      const { ClaudeScheduler } = await import('./claudeScheduler');
      const scheduler = new ClaudeScheduler(aiSettings.apiKey, scheduleData, aiSettings.model);
      const aptDate = apt.startTime.slice(0, 10);
      const dateStart = range?.dateStart ?? aptDate;
      const dateEnd = range?.dateEnd ?? aptDate;
      const noteMap = {
        move: `Move this ${apt.type} appointment on ${aptDate} to a suitable time`,
        replace: `Replace this ${apt.type} appointment on ${aptDate} with a suitable alternative`,
        cancel: `Recover from the cancellation of this ${apt.type} appointment on ${aptDate} — suggest a make-up`,
      } as const;
      const sols = await scheduler.generateWishSolutions({ kind: 'freeform', note: noteMap[kind], dateStart, dateEnd });
      if (sols.length === 0) {
        // debugMsg only renders in the empty (no-schedule) state, so once a
        // schedule is loaded it's swallowed — surface a visible notice instead
        // so the action never reads as a silent no-op.
        alert('No AI options found for this appointment. Try adjusting availability, or use Wish It for a broader rework.');
      } else {
        setRecoverySolutions({ title, solutions: sols });
      }
    } catch (error: any) {
      alert('AI error: ' + (error.message || error));
    } finally {
      setAiLoading(false);
    }
  };

  // Move This / Replace This open the LOCAL find-a-spot picker (no AI needed).
  // The picker offers an AI escape hatch only when the local search comes up empty.
  const handleMoveThis = (apt: Appointment) => setFindTime({ apt, mode: 'move' });

  const handleReplaceThis = (apt: Appointment) => setFindTime({ apt, mode: 'replace' });

  // Picker "Use this time" / "Set time" → stage the move into the draft tray.
  const applyFindTime = (moved: Appointment) => {
    stageOps([newMoveOp(moved)]);
    setFindTime(null);
    setSelectedAppointment(null);
    setView('schedule');
  };

  // Picker escape hatch: ask AI to search the rest of the month (now → month end).
  const askFindTimeAi = () => {
    if (!findTime) return;
    const now = new Date();
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const pad = (n: number) => String(n).padStart(2, '0');
    const dateStart = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const dateEnd = `${monthEnd.getFullYear()}-${pad(monthEnd.getMonth() + 1)}-${pad(monthEnd.getDate())}`;
    const { apt, mode } = findTime;
    const title = mode === 'replace' ? `Replacement options — ${apt.title || apt.type}` : `Move options — ${apt.title || apt.type}`;
    setFindTime(null);
    runRecoveryAI(mode, apt, title, { dateStart, dateEnd });
  };

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
    setSassiBlackouts([]);
    setBuildResult(null);
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
    await commitScheduleData(next, { label: `Logged ${ghosts.length} request${ghosts.length === 1 ? '' : 's'} as ghost${ghosts.length === 1 ? '' : 's'}`, source: 'manual' });
    setDraftOps([]); setSolutions([]); setSelectedAppointment(null); setSassiBlackouts([]);
  };

  // ---- Ghost lifecycle (committed) ------------------------------------------
  const promoteGhost = (a: Appointment) => {
    stageOps([newMoveOp({ ...a, isGhost: false })]);
    setSelectedAppointment(null);
  };

  const dismissGhost = async (a: Appointment) => {
    if (!scheduleData) return;
    await axios.delete(`${API_BASE}/admin/appointment/${a.id}`);
    let next = { ...scheduleData, appointments: scheduleData.appointments.filter(x => x.id !== a.id) };
    const entry = deriveActionEntry(scheduleData, next, { label: `Dismissed ghost ${a.title || 'request'}`, source: 'manual' });
    if (entry) next = { ...next, actionLog: pruneLog([...(scheduleData.actionLog ?? []), entry]) };
    setScheduleData(next);
    setCompCache(prev => recomputeCache(prev, scheduleData, next, [{ before: a, after: undefined }]));
    setSelectedAppointment(null);
  };

  const persistAppointment = async (updated: Appointment) => {
    if (!scheduleData) return;
    try {
      const before = scheduleData.appointments.find(a => a.id === updated.id);
      await axios.post(`${API_BASE}/admin/appointment`, updated);
      let next: ScheduleData = {
        ...scheduleData,
        appointments: scheduleData.appointments.map(a => a.id === updated.id ? updated : a),
      };
      // Log the lifecycle change (this path bypasses commitScheduleData to keep
      // the incremental compliance-cache recompute below).
      const lifecycle = updated.status === 'completed' && before?.status !== 'completed' ? 'Completed'
        : updated.status === 'canceled' && before?.status !== 'canceled' ? 'Canceled'
          : updated.status === 'scheduled' && before?.status && before.status !== 'scheduled' ? 'Reopened'
            : 'Edited';
      const entry = deriveActionEntry(scheduleData, next, { label: `${lifecycle} ${updated.title || 'session'}`, source: 'manual' });
      if (entry) {
        next = { ...next, actionLog: pruneLog([...(scheduleData.actionLog ?? []), entry]) };
        if (entry.undoable) showUndoToast(entry.id, entry.label);
      }
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
  // until the user Accepts or overrides in the DraftTray. A series-scope edit
  // can also REMOVE rows (re-space surplus, truncate, collapse) — those ride
  // along as remove ops and always go through the tray.
  const handleSaveAppointments = async (apps: Appointment[], removeIds: string[] = []) => {
    if ((apps.length === 0 && removeIds.length === 0) || !scheduleData) return;
    const ops = [
      ...apps.map(a =>
        scheduleData.appointments.some(x => x.id === a.id) ? newMoveOp(a) : newAddOp(a)
      ),
      ...removeIds.map(id => newRemoveOp(id)),
    ];
    // Historical sessions already happened — there's nothing to reschedule. When
    // every staged session is in the past, solveDraft grades it purely on hard
    // timeslot conflicts (two billable activities can't share a slot). If it
    // comes back clean (green), commit straight away so compliance/goals update
    // without a draft round-trip; a blocking overlap still falls through to the
    // tray for the user to resolve. Removals always go to the tray (a deletion
    // deserves the review step).
    const nowMs = Date.now();
    const allPast = removeIds.length === 0 && ops.every(o => {
      const iso = o.appt?.startTime;
      return !!iso && new Date(iso).getTime() < nowMs;
    });
    if (allPast) {
      const status = solveDraft(scheduleData, ops, new Date(), scheduleData.settings);
      if (status.grade === 'green') {
        await commitScheduleData(status.resolved || applyOps(scheduleData, ops), { label: `Logged past session${ops.length === 1 ? '' : 's'} — ${summarizeOps(ops)}`, source: 'manual' });
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
      const built: ScheduleData = response.data.data;
      commitFull({
        ...built,
        actionLog: pruneLog([...(built.actionLog ?? []), viewOnlyEntry(built, { label: 'Setup wizard created the schedule', source: 'admin' })]),
      });
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

  // Save raw bytes to the device. iOS WKWebView ignores <a download>, so on native
  // we write to the Cache dir and pop the share sheet; on web we click a blob link.
  const saveBytesToDevice = async (bytes: Uint8Array, filename: string) => {
    const blob = new Blob([bytes as any]);
    if (Capacitor.isNativePlatform()) {
      const base64 = await blobToBase64(blob);
      const written = await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
      try {
        await Share.share({ title: 'SAssi Cal backup', url: written.uri, dialogTitle: 'Save your backup' });
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
  };

  // Encrypted .sassi backup — the app's ONLY export (the plaintext .xlsx download
  // was removed: it could leave the device carrying real client names). This is
  // the full versioned envelope — lossless and migration-aware — and it is ALWAYS
  // password-encrypted; a plaintext backup must never hit disk (CLAUDE.md §2).
  // Restored through the normal upload picker, which sniffs the decrypted bytes
  // and routes an envelope through unwrapEnvelope; .xlsx remains import-only.
  const handleBackupDownload = async () => {
    if (!scheduleData) return;
    try {
      // Enforce the file-password policy on every backup write: reuse the saved
      // schedule password only when it already complies, otherwise require a strong
      // one through the policy-gated prompt.
      const dict = await loadPasswordDict();
      const reusable = aiSettings.schedulePassword && validatePassword(aiSettings.schedulePassword, dict).valid
        ? aiSettings.schedulePassword
        : null;
      const password = reusable
        || (await askPassword(
          'Backup password',
          'This backup contains client data. Choose a strong password to encrypt it — you\'ll need the same password to restore.',
          { placeholder: 'Backup password', submitLabel: 'Encrypt & save', policy: true }));
      if (!password) return; // never emit an unencrypted backup
      // Carry the AI settings (obfuscated) so they restore on the other side — the
      // portable equivalent of the retired .xlsx _Config. The schedule password is
      // never embedded (it is the file's own key).
      const embeddedConfig = (aiSettings.apiKey || aiSettings.mapsApiKey)
        ? await obfuscateKey(JSON.stringify({ apiKey: aiSettings.apiKey, model: aiSettings.model, mapsApiKey: aiSettings.mapsApiKey }))
        : undefined;
      const json = wrapEnvelope(scheduleData, embeddedConfig);
      const bytes = await encryptBytes(new TextEncoder().encode(json), password);
      await saveBytesToDevice(bytes, backupFilename(scheduleData.settings.practiceName));
    } catch (error: any) {
      alert('Error creating backup: ' + (error.message || error));
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

  // Branded launch splash while we decide whether to lock — matches the native
  // storyboard and the pre-React HTML splash (same #333f45), so there's no
  // black/color flash before the gate appears on native.
  if (!lockReady) {
    return <LaunchSplash />;
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
          {a.client && <span style={metaChip}>👤 {nameOf(scheduleData?.clients ?? [], a.client)}</span>}
          {a.technician && <span style={metaChip}>🧑‍⚕️ {nameOf(scheduleData?.technicians ?? [], a.technician)}</span>}
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
          if ((flags.clientCompletedStreak ?? 0) >= 2) {
            const s = flags.clientCompletedStreak!;
            items.push(<span key="cstreak" style={{ ...metaChip, background: '#dcfce7', color: '#166534' }}>{streakEmoji(s)} {s} w/ this client</span>);
          }
          if ((flags.completedStreak ?? 0) >= 2) {
            const s = flags.completedStreak!;
            items.push(<span key="streak" style={{ ...metaChip, background: '#d1fae5', color: '#065f46' }}>{streakEmoji(s)} {s} overall</span>);
          }
          if (flags.isHoliday) {
            items.push(<span key="holiday" style={{ ...metaChip, background: '#dcfce7', color: '#15803d' }}>✦ {flags.holidayName ?? 'Holiday'}</span>);
          }
          if (items.length === 0) return null;
          return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>{items}</div>;
        })()}
        {(() => {
          // Cancel-pressure breakdown — four independent windows (consecutive run
          // + trailing-30-day count) for the participants touching this session.
          const ctx = detailFlags.get(a.id)?.cancelCtx;
          if (!ctx) return null;
          const dim: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.04em' };
          const stat = (label: string, run: number, roll: number, wDays: number, key: string) => (
            <div key={key} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '3px 0' }}>
              <span style={{ ...dim, minWidth: 92, flexShrink: 0 }}>{label}</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: run >= 2 ? '#b91c1c' : '#374151' }}>{run} in a row</span>
              <span style={{ fontSize: 12, color: '#6b7280' }}>· {roll} in {wDays}d</span>
            </div>
          );
          const rows: React.ReactNode[] = [];
          if (a.technician) {
            rows.push(
              <div key="bt" style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '3px 0' }}>
                <span style={{ ...dim, minWidth: 92, flexShrink: 0 }}>BT · this client</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: ctx.bt.withClientConsecutive >= 2 ? '#b91c1c' : '#374151' }}>{ctx.bt.withClientConsecutive} in a row</span>
                <span style={{ fontSize: 12, color: '#6b7280' }}>· {ctx.bt.perBtCaseRolling30} in {ctx.family.windowDays}d · BT all: {ctx.bt.btRolling30} in {ctx.family.windowDays}d</span>
              </div>,
            );
          }
          if (ctx.family.consecutive || ctx.family.rolling30 || ctx.source === 'family') rows.push(stat('Family', ctx.family.consecutive, ctx.family.rolling30, ctx.family.windowDays, 'fam'));
          if (ctx.bcba.consecutive || ctx.bcba.rolling30 || ctx.source === 'bcba') rows.push(stat('BCBA', ctx.bcba.consecutive, ctx.bcba.rolling30, ctx.bcba.windowDays, 'bcba'));
          if (ctx.admin.consecutive || ctx.admin.rolling30 || ctx.source === 'admin') rows.push(stat('Admin', ctx.admin.consecutive, ctx.admin.rolling30, ctx.admin.windowDays, 'admin'));
          return (
            <div style={{ marginTop: 10, padding: '8px 10px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#b91c1c', marginBottom: 2 }}>⚠ Cancellation pressure</div>
              {rows}
            </div>
          );
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
                flex: '1 1 auto', padding: '6px 12px', backgroundColor: 'var(--brand-primary)', color: 'white',
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
              backgroundColor: locked ? 'var(--slate-200)' : 'var(--brand-primary)', color: locked ? 'var(--slate-400)' : 'white',
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
              <button
                onClick={() => handleMoveThis(a)}
                style={{
                  flex: '1 1 auto', padding: '6px 12px', backgroundColor: '#f5f3ff', color: '#5b21b6',
                  border: '1px solid #c4b5fd', borderRadius: '4px', cursor: 'pointer', fontSize: '13px',
                }}
              >Move This</button>
              {new Date(a.endTime).getTime() >= Date.now() && (
                <button
                  onClick={() => handleReplaceThis(a)}
                  style={{
                    flex: '1 1 auto', padding: '6px 12px', backgroundColor: '#f0f9ff', color: '#0369a1',
                    border: '1px solid #7dd3fc', borderRadius: '4px', cursor: 'pointer', fontSize: '13px',
                  }}
                >Replace This</button>
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
          onExtendSeries={handleExtendSeries}
        />
      );
    }
    return renderSelectedDetail(a);
  };

  // ── Shell derivations (M2) ─────────────────────────────────────────────
  // Map the string view-state onto the left rail, and route rail taps back.
  const activeRail: RailKey =
    view === 'home' ? 'home'
      : view === 'compliance' || view === 'caseload' ? 'caseload'
        : view === 'cpr' ? 'cpr'
          : view === 'admin' ? 'settings'
            : 'calendar';

  const onRailSelect = (key: RailKey) => {
    setDockSheetOpen(false);
    switch (key) {
      case 'home': setView('home'); break;
      case 'calendar': setView('schedule'); break;
      case 'caseload': setCcInitialTab('cases'); setView('compliance'); break;
      case 'cpr': setView('cpr'); break;
      case 'setup': setShowWizard(true); break;
      case 'settings': setAdminInitialTab('settings'); setView('admin'); break;
    }
  };

  const caseloadBadge = activeConflicts.length + attentionCount;
  const railItems: RailItem[] = [
    { key: 'home', icon: '🧭', label: 'Home' },
    { key: 'calendar', icon: '📅', label: 'Calendar' },
    { key: 'caseload', icon: '📊', label: 'Caseload', badge: caseloadBadge > 0 ? caseloadBadge : undefined },
    { key: 'cpr', icon: '📈', label: 'CPR' },
    { key: 'setup', icon: '🌱', label: 'Setup' },
    { key: 'settings', icon: '⚙️', label: 'Settings' },
  ];

  const viewTitle =
    view === 'home' ? 'Home'
      : view === 'schedule' ? 'Calendar'
        : view === 'compliance' || view === 'caseload' ? 'Caseload'
          : view === 'cpr' ? 'CPR & analysis'
            : view === 'admin' ? 'Settings'
              : 'SAssi';

  // Command-bar actions are contextual: onboarding entries before data loads,
  // "new session" once a schedule is in hand.
  // "Activity" (the committed-change history + undo) is reachable from every
  // view once data exists — reversibility shouldn't require remembering where
  // the button lives.
  const activityBtn = scheduleData
    ? compactBtn('🕘', 'Activity — committed changes & undo', () => setShowActivity(true), '#374151')
    : null;
  const commandActions = !scheduleData ? (
    <>
      {compactBtn('Wizard', 'Setup Wizard', () => setShowWizard(true), 'var(--brand-ai)')}
      <FileUpload onUpload={handleFileUpload} loading={loading} />
      {compactBtn('CPR', 'CPR & Analysis', () => setView('cpr'), view === 'cpr' ? 'var(--brand-accent)' : '#374151')}
    </>
  ) : view === 'schedule' ? (
    <>
      {activityBtn}
      <Button variant="primary" size="sm" onClick={() => setShowAddAppointment(true)} aria-label="Add appointment">
        + New session
      </Button>
    </>
  ) : activityBtn;

  const hereText = new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const nextText = pendingReview.length > 0
    ? `Next: ${pendingReview.length} past session${pendingReview.length === 1 ? '' : 's'} to review`
    : undefined;
  const aiActive = !!aiSettings.apiKey;
  const aiTitle = aiActive ? `AI: ${aiSettings.model}` : 'No AI key set — add in Settings';

  // ── Dock feed (M3) ─────────────────────────────────────────────────────
  // Normalize the live conflict + compliance feeds into the one-at-a-time queue.
  // Per-case cards (worst clients first, each with a case-scoped fix) + a tail
  // aggregate; the bare summary covers the async cache-rebuild window. Series
  // about to run off their materialized horizon (endingSeries, memoized above
  // the lock gate) ride along as info-level "extend?" prompts (user decision:
  // prompt, never silent adds).
  const dockIssues = buildDockIssues(
    activeConflicts,
    compSummary,
    scheduleData && compCache ? attentionList(compCache, scheduleData) : [],
    undefined,
    endingSeries,
  );

  const reviewConflictIssue = (issue: DockIssue) => {
    const id = issue.appointmentIds?.[0];
    const appt = id ? scheduleData?.appointments.find(a => a.id === id) ?? null : null;
    setView('schedule');
    if (appt) setSelectedAppointment(appt);
  };

  const muteConflictIssue = (issue: DockIssue) => {
    if (issue.conflictKey) muteConflict(issue.conflictKey);
  };

  // "Fix pace with SAssi" (Phase 2): resolve a case-scoped meet-pace request into
  // solution cards. The deterministic solveMeetPace always yields an instant,
  // offline proposal; when a Claude key is present we append up to 2 case-scoped
  // Fix It variants for distribution alternatives. Claude failures degrade to the
  // local proposal so the CTA is never a dead end.
  const resolveMeetPace = async (clientId: string): Promise<WishSolution[]> => {
    if (!scheduleData) return [];
    const local = solveMeetPace(scheduleData, clientId, viewDate);
    const solutions: WishSolution[] = [local.solution];
    // Claude adds distribution alternatives only for the fill ("behind") case;
    // the over-served trim is handled deterministically above.
    if (aiSettings.apiKey && local.intent === 'behind' && local.solution.ops.length > 0) {
      try {
        const { ClaudeScheduler } = await import('./claudeScheduler');
        const scheduler = new ClaudeScheduler(aiSettings.apiKey, scheduleData, aiSettings.model);
        const variants = await scheduler.generateFixSolutions(
          { ...DEFAULT_FIXIT_OPTIONS, focusClientId: clientId },
          [],
        );
        solutions.push(...variants);
      } catch { /* keep the local proposal */ }
    }
    return solutions.slice(0, 3);
  };

  const openMeetPace = (clientId: string, _intent: 'behind' | 'over') => {
    if (!scheduleData) return;
    meetPaceTokenRef.current += 1;
    const client = scheduleData.clients.find(c => c.id === clientId);
    setMeetPaceSeed({ clientId, label: `Fix ${client?.name ?? 'this case'}'s pace`, token: meetPaceTokenRef.current });
    // Surface the dock on whichever presentation this width uses (the column is
    // already on screen on the Home view at ≥1024).
    if (dockMode === 'sheet') setDockSheetOpen(true);
    else if (dockMode === 'chip') setDockOpen(true);
  };

  const meetPaceGraderCtx = scheduleData
    ? { data: scheduleData, settings: scheduleData.settings, now: viewDate }
    : undefined;

  // "Doctor my schedule with me": the quick "what's wrong here?" diagnosis of the
  // selected appointment (and its case). Facts are local — no key needed — so the
  // read is honest and instant. With a key, "dig in" hands the case to the chat.
  const openDoctor = () => {
    if (!scheduleData || !selectedAppointment) return;
    const d = buildDossier(scheduleData, { kind: 'appointment', appointmentId: selectedAppointment.id }, viewDate, activeConflicts);
    setDossier(d);
    if (dockMode === 'sheet') setDockSheetOpen(true);
    else if (dockMode === 'chip') setDockOpen(true);
  };

  // Hand the diagnosed session off to the sAssI chat. The focused appointment id
  // rides the conversation deictically (sassiSession appends its token), so no
  // client name ever leaves the device — the prompt itself is generic.
  const askAboutFocus = () => {
    if (!selectedAppointment) return;
    void sassi.send("What's wrong with this appointment, and how would you fix it?");
  };

  const canDoctor = !!selectedAppointment;

  // ── Home wiring (M4) ───────────────────────────────────────────────────
  // Ritual/flag routing: the SAssi dock is wide-only (>=1024) and already on
  // screen there, so 'assistant' only needs a fallback on narrow widths.
  const homeGo = (action: RitualAction) => {
    switch (action) {
      case 'assistant': if (!showDock) setView('caseload'); break;
      case 'week': setView('schedule'); break;
      case 'home':
      case 'todos': break; // handled within HomeView
    }
  };

  // "Start → session": seed the appointment form (client + type) and remember
  // which to-do to mark done once the block is confirmed onto the calendar.
  const startSessionFromTodo = (todo: HomeTodo) => {
    // The appointment form keys its client <select> by name, so resolve the
    // to-do's client id → name for the prefill to take.
    const c = scheduleData?.clients.find(cl => cl.id === todo.clientId);
    setSessionSeed({
      title: todo.text,
      client: c?.name ?? todo.clientId,
      type: todo.sessionType || 'client-session',
    });
    setStartedTodoId(todo.id);
  };
  const clearSessionSeed = () => { setSessionSeed(null); setStartedTodoId(null); };

  // ── Schedule view: dock context (M5 P5b) ───────────────────────────────
  // The old inline pane's content, folded into the SAssi dock body: hours
  // totals, the draft tray, and draft-AI options up top; the day's agenda as the
  // calm idle state. Conflicts now flow through the dock's issue queue, and the
  // selected appointment rides the dock's `selected` slot (column) or its own
  // phone sheet — so neither of those renders here.
  const scheduleContextTop = view === 'schedule' && scheduleData ? (
    <>
      {!draftActive && calLens !== 'client' && (
        <HoursSummary appointments={calendarAppointments} lens={calLens} settings={scheduleData.settings} timeOff={scheduleData.timeOff} currentDate={viewDate} />
      )}
      {!draftActive && (
        <button
          type="button"
          onClick={handleBuildCombined}
          title="One pass: place directs, supervision, and parent training for the month — staged as a single reviewable draft"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '11px 12px', borderRadius: 'var(--radius-md)', border: 'none',
            background: 'var(--sage-600)', color: 'var(--white, #fff)', fontSize: 13.5, fontWeight: 800, cursor: 'pointer',
          }}
        >
          ⚙︎ Build month
        </button>
      )}
      {!draftActive && (
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            onClick={handleBuildDirect}
            title="Let the engine place a compliant recurring direct schedule for the month"
            style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '9px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--sage-200)',
              background: 'var(--sage-50)', color: 'var(--sage-700)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
            }}
          >
            ⚙︎ Build direct schedule
          </button>
          <button
            type="button"
            onClick={handleBuildSupervision}
            title="Chase every case to its supervision floor and cadence over the existing directs"
            style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '9px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--sage-200)',
              background: 'var(--sage-50)', color: 'var(--sage-700)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
            }}
          >
            ⚙︎ Build supervision
          </button>
          <button
            type="button"
            onClick={handleBuildParentTraining}
            title="Chase every case to its monthly parent-training hours goal over the existing directs"
            style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '9px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--sage-200)',
              background: 'var(--sage-50)', color: 'var(--sage-700)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
            }}
          >
            ⚙︎ Build parent training
          </button>
        </div>
      )}
      {!draftActive && (
        <button
          type="button"
          onClick={handleTidy}
          title="Find behavior-preserving cleanups (merge split sessions, drop empty/duplicate rows, group a recurring pattern) — every auto change is equivalence-verified and previewed before commit"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '9px 12px', borderRadius: 'var(--radius-md)', border: '1px dashed var(--sage-300, var(--sage-200))',
            background: 'transparent', color: 'var(--sage-700)', fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}
        >
          🩺 Tidy schedule
        </button>
      )}
      {draftActive && pendingUndo && scheduleData && (
        <UndoPreview
          base={scheduleData}
          ops={draftOps}
          label={pendingUndo.label}
          superseded={pendingUndo.superseded.filter(id => draftOps.some(o => o.id === id))}
          removedBlackouts={pendingUndo.removeBlackoutIds.length}
          restoredHints={pendingUndo.hintRestores.length}
        />
      )}
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
      {buildResult && (
        <BuildResultPanel result={buildResult} hasStagedProposal={draftActive} onDismiss={() => setBuildResult(null)} />
      )}
      {tidyResult && (
        <TidyPanel result={tidyResult} onApplySuggestion={applyTidySuggestion} onDismiss={() => setTidyResult(null)} />
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
      {!draftActive && solutions.length === 0 && dockIssues.length === 0 && !selectedAppointment && (
        <AgendaRail
          appointments={scheduleData.appointments}
          date={viewDate}
          onSelect={setSelectedAppointment}
        />
      )}
    </>
  ) : null;

  return (
    <RosterProvider clients={scheduleData?.clients ?? []} technicians={scheduleData?.technicians ?? []}>
    <div style={{
      display: 'flex', height: '100vh', maxWidth: '100vw',
      position: 'relative',
      overflowX: 'clip' as any, flexDirection: compactRail ? 'column' : 'row',
      // Side insets matter on landscape iPhones with a notch so chrome
      // doesn't slip under the camera housing.
      paddingLeft: 'env(safe-area-inset-left)',
      paddingRight: 'env(safe-area-inset-right)',
    }}>
      {/* Wide/tablet: vertical rail on the left; phones get a bottom bar below. */}
      {!compactRail && (
        <Rail items={railItems} active={activeRail} onSelect={onRailSelect} orientation="vertical" />
      )}

      {/* Main column: command bar + zen strip + the scrolling view region. */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0 }}>
        <div
          ref={headerRef as React.RefObject<HTMLDivElement>}
          style={{
            flexShrink: 0, zIndex: 10,
            display: dockMode === 'chip' ? 'flex' : undefined,
            alignItems: dockMode === 'chip' ? 'stretch' : undefined,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <CommandBar title={viewTitle} actions={commandActions} aiActive={aiActive} aiTitle={aiTitle} />
            <ZenStrip
              hereText={hereText}
              nextText={nextText}
              conflictCount={activeConflicts.length}
              complianceCount={attentionCount}
              onFlagClick={() => setView('compliance')}
            />
          </div>
          {/* Tablet-portrait: the collapsed dock sits as the merged right cell
              beside the two header rows; tapping it rolls the overlay open. */}
          {dockMode === 'chip' && scheduleData && !dockOpen && (
            <DockChip issueCount={issueCount} onOpen={() => setDockOpen(true)} controlsId="sassi-dock-overlay" />
          )}
        </div>

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
          overflowX: 'clip' as any,
          WebkitOverflowScrolling: 'touch' as any,
          paddingBottom: splitView ? 0 : 'env(safe-area-inset-bottom)',
          // Header is now position:sticky in both orientations so it takes up
          // space in the flex column — no paddingTop needed, and the calendar
          // toolbar sticks at top:0 relative to this scroll container.
          ['--cal-sticky-top' as any]: '0px',
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
                    hideTotals={dockMode === 'column'}
                    draftMarks={calendarMarks}
                    onMoveThis={handleMoveThis}
                    onReplaceThis={handleReplaceThis}
                    notice={pendingReview.length > 0 ? (
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
                    ) : undefined}
                  />
                </div>
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
                  tabs={['settings', 'daysoff', 'candc']}
                  initialTab={adminInitialTab}
                  persist={serverPersist}
                  onImportFile={triggerImportPicker}
                  onRerunWizard={() => setShowWizard(true)}
                  onBackup={handleBackupDownload}
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
                <CCHub
                  initialTab={ccInitialTab}
                  data={scheduleData}
                  onDataChange={commitFull}
                  onCommitLogged={commitLogged}
                  persist={serverPersist}
                  now={viewDate}
                  cache={compCache}
                  conflicts={visibleConflicts}
                  conflictCount={activeConflicts.length}
                  mutedConflictKeys={mutedConflicts}
                  onMuteConflict={muteConflict}
                  onUnmuteConflict={unmuteConflict}
                  onConfirmDismissConflict={confirmDismissConflict}
                  onMarkComplete={handleMarkComplete}
                  onRequestCancel={(a) => setCancelTarget(a)}
                  onSelectAppointment={(a) => { setView('schedule'); setSelectedAppointment(a); }}
                  onFixPace={(id) => openMeetPace(id, 'behind')}
                  onOpenAdminCandC={() => { setAdminInitialTab('candc'); setView('admin'); }}
                />
              </React.Suspense>
            )}
            {view === 'caseload' && (
              <React.Suspense fallback={null}>
                <CaseloadView data={scheduleData} now={viewDate} />
              </React.Suspense>
            )}
            {view === 'home' && (
              <React.Suspense fallback={null}>
                <HomeView
                  data={scheduleData}
                  now={viewDate}
                  conflictCount={activeConflicts.length}
                  complianceFlagCount={attentionCount}
                  todos={homeTodos.todos}
                  onAddTodo={homeTodos.add}
                  onStartSession={startSessionFromTodo}
                  onGo={homeGo}
                  onMeetPace={openMeetPace}
                  onOpenActivity={() => setShowActivity(true)}
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
      </div>{/* /main column */}

      {/* The always-on SAssi dock column — beside every view when there's room
          (schedule: ≥744/tablet; others: ≥1024). On the schedule view it also
          carries the folded-in hours totals, draft tray, day agenda, and the
          selected-session detail/edit (P5b — replaces the old inline pane). */}
      {dockMode === 'column' && (view !== 'schedule' || scheduleData) && (
        <SAssiDock
          issues={view === 'schedule' && draftActive ? [] : dockIssues}
          issueCount={issueCount}
          aiEnabled={aiActive}
          contextTop={scheduleContextTop}
          selected={view === 'schedule' && selectedAppointment ? renderDetailOrEdit(selectedAppointment) : undefined}
          onReviewConflict={reviewConflictIssue}
          onMuteConflict={muteConflictIssue}
          onFixCompliance={() => { setCcInitialTab('issues'); setView('compliance'); }}
          onFixPace={(id) => openMeetPace(id, 'behind')}
          onExtendSeries={handleExtendSeries}
          dossier={dossier}
          canDoctor={canDoctor}
          onDoctor={openDoctor}
          onClearDossier={() => setDossier(null)}
          onAskAboutFocus={askAboutFocus}
          seedRequest={meetPaceSeed}
          onSeedResolve={resolveMeetPace}
          graderCtx={meetPaceGraderCtx}
          onAsk={sassi.send}
          chat={sassiChat}
          onAcceptWish={acceptWish}
          onCustomizeWish={customizeWish}
        />
      )}

      {/* Narrow: the same dock reached from a FAB as a slide-up sheet, so
          phone users get the assistant on every view — schedule included (P5b).
          On schedule the draft tray rides in here; a staged draft auto-opens it. */}
      {dockMode === 'sheet' && scheduleData && (
        <>
          {/* Hide the FAB while the appointment detail sheet is up, so it doesn't
              float over the open detail. */}
          {!(view === 'schedule' && selectedAppointment) && (
          <button
            type="button"
            onClick={() => setDockSheetOpen(true)}
            aria-label={issueCount > 0 ? `Open SAssi — ${issueCount} open items` : 'Open SAssi'}
            style={{
              position: 'fixed', right: 16,
              bottom: compactRail ? 'calc(env(safe-area-inset-bottom) + 76px)' : 'calc(env(safe-area-inset-bottom) + 20px)',
              zIndex: 1080, width: 56, height: 56, borderRadius: '50%',
              background: 'var(--sage-600)', color: 'var(--white)', border: 'none',
              boxShadow: 'var(--shadow-pop, 0 8px 24px rgba(0,0,0,0.22))', cursor: 'pointer',
              fontSize: 24, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <span aria-hidden="true">✨</span>
            {issueCount > 0 && (
              <span aria-hidden="true" style={{
                position: 'absolute', top: -2, right: -2, minWidth: 20, height: 20, padding: '0 5px',
                borderRadius: 'var(--radius-pill)', background: 'var(--red-500)', color: 'var(--white)',
                fontSize: 11, fontWeight: 800, lineHeight: '20px', textAlign: 'center', border: '2px solid var(--white)',
              }}>{issueCount}</span>
            )}
          </button>
          )}

          {/* Backdrop */}
          <div
            onClick={() => setDockSheetOpen(false)}
            style={{
              position: 'fixed', inset: 0, zIndex: 1090, background: 'rgba(0,0,0,0.4)',
              opacity: dockSheetOpen ? 1 : 0, pointerEvents: dockSheetOpen ? 'auto' : 'none',
              transition: 'opacity var(--duration-normal, 0.25s) var(--ease-standard, ease)',
            }}
          />

          {/* Slide-up sheet — kept mounted so it animates in/out. */}
          <div style={{
            position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 1100, height: '82vh',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
            background: 'var(--white)', borderTopLeftRadius: 16, borderTopRightRadius: 16,
            boxShadow: '0 -6px 24px rgba(0,0,0,0.18)',
            transform: dockSheetOpen ? 'translateY(0)' : 'translateY(100%)',
            transition: 'transform var(--duration-normal, 0.3s) var(--ease-standard, cubic-bezier(0.4,0,0.2,1))',
            paddingBottom: 'env(safe-area-inset-bottom)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '6px 10px 0' }}>
              <button
                type="button"
                onClick={() => setDockSheetOpen(false)}
                aria-label="Close SAssi"
                style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--text-muted)', lineHeight: 1, padding: 4 }}
              >✕</button>
            </div>
            <SAssiDock
              variant="sheet"
              issues={view === 'schedule' && draftActive ? [] : dockIssues}
              issueCount={issueCount}
              aiEnabled={aiActive}
              contextTop={scheduleContextTop}
              onReviewConflict={(i) => { setDockSheetOpen(false); reviewConflictIssue(i); }}
              onMuteConflict={muteConflictIssue}
              onFixCompliance={() => { setDockSheetOpen(false); setCcInitialTab('issues'); setView('compliance'); }}
              onFixPace={(id) => openMeetPace(id, 'behind')}
              onExtendSeries={(sid, end) => { setDockSheetOpen(false); handleExtendSeries(sid, end); }}
              dossier={dossier}
              canDoctor={canDoctor}
              onDoctor={openDoctor}
              onClearDossier={() => setDossier(null)}
              onAskAboutFocus={askAboutFocus}
              seedRequest={meetPaceSeed}
              onSeedResolve={resolveMeetPace}
              graderCtx={meetPaceGraderCtx}
              onAsk={sassi.send}
              chat={sassiChat}
              onAcceptWish={acceptWish}
              onCustomizeWish={customizeWish}
            />
          </div>
        </>
      )}

      {/* Tablet-portrait: the dock's collapsed chip lives in the header; here it
          rolls open as an overlay over the right side (same dock, every view). */}
      {dockMode === 'chip' && scheduleData && (
        <DockOverlay id="sassi-dock-overlay" open={dockOpen} onClose={() => setDockOpen(false)}>
          <SAssiDock
            issues={view === 'schedule' && draftActive ? [] : dockIssues}
            issueCount={issueCount}
            aiEnabled={aiActive}
            contextTop={scheduleContextTop}
            selected={view === 'schedule' && selectedAppointment ? renderDetailOrEdit(selectedAppointment) : undefined}
            onReviewConflict={reviewConflictIssue}
            onMuteConflict={muteConflictIssue}
            onFixCompliance={() => { setDockOpen(false); setCcInitialTab('issues'); setView('compliance'); }}
            onFixPace={(id) => openMeetPace(id, 'behind')}
            onExtendSeries={handleExtendSeries}
            dossier={dossier}
            canDoctor={canDoctor}
            onDoctor={openDoctor}
            onClearDossier={() => setDossier(null)}
            onAskAboutFocus={askAboutFocus}
            seedRequest={meetPaceSeed}
            onSeedResolve={resolveMeetPace}
            graderCtx={meetPaceGraderCtx}
            onAsk={sassi.send}
            chat={sassiChat}
            onAcceptWish={acceptWish}
            onCustomizeWish={customizeWish}
          />
        </DockOverlay>
      )}

      {/* Phones: rail collapses to a bottom bar. */}
      {compactRail && (
        <Rail items={railItems} active={activeRail} onSelect={onRailSelect} orientation="bottom" />
      )}

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
        accept=".xlsx,.xls,.json,.sassi"
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

      {/* Drag scope prompt — a series member was dragged; ask how far the move reaches */}
      {dragScopePrompt && scheduleData && (
        <div
          onClick={() => resolveDragScope('cancel')}
          style={{
            position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1400, padding: 16,
          }}
        >
          <div onClick={e => e.stopPropagation()} style={{
            background: 'white', borderRadius: 10, padding: 20, maxWidth: 360, width: '100%',
            boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
          }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>Move recurring session</div>
            <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 14 }}>
              {(() => {
                try {
                  const preview = summarizeSeriesEdit(buildSeriesEdit({
                    all: scheduleData.appointments,
                    original: dragScopePrompt.original,
                    edited: dragScopePrompt.moved,
                    scope: 'following', cadence: null,
                  }));
                  return `This session repeats. Move just this one, or shift the series by the same amount? (${preview.replace(/\.$/, '')} under “This + following”.)`;
                } catch {
                  return 'This session repeats. Move just this one, or shift the series by the same amount?';
                }
              })()}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                onClick={() => resolveDragScope('instance')}
                style={{ padding: '9px 14px', border: '1px solid #d1d5db', borderRadius: 6, background: 'white', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
              >Just this session</button>
              <button
                onClick={() => resolveDragScope('following')}
                style={{ padding: '9px 14px', border: 'none', borderRadius: 6, background: '#6366f1', color: 'white', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
              >This + following</button>
              <button
                onClick={() => resolveDragScope('all')}
                style={{ padding: '9px 14px', border: '1px solid #6366f1', borderRadius: 6, background: 'white', color: '#6366f1', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
              >All in series</button>
              <button
                onClick={() => resolveDragScope('cancel')}
                style={{ padding: '7px 14px', border: 'none', borderRadius: 6, background: 'transparent', color: '#6b7280', cursor: 'pointer', fontSize: 13 }}
              >Cancel — put it back</button>
            </div>
          </div>
        </div>
      )}

      {/* Activity — the committed-change history with selective, previewed undo */}
      {showActivity && scheduleData && (
        <ActivityLog
          data={scheduleData}
          onUndo={stageUndo}
          onClose={() => setShowActivity(false)}
        />
      )}

      {/* Post-commit receipt + one-tap undo (exact while nothing else committed) */}
      {undoToast && (
        <CommitToast
          label={undoToast.label}
          compact={compactRail}
          onUndo={undoFromToast}
          onDismiss={() => setUndoToast(null)}
        />
      )}

      {/* Teach-loop offer: a detected correction becomes a durable hint on tap */}
      {hintSignals.length > 0 && (
        <CaptureChip
          signal={hintSignals[0]}
          remaining={hintSignals.length - 1}
          compact={compactRail}
          onRemember={rememberHint}
          onDismiss={() => setHintSignals(sig => sig.slice(1))}
        />
      )}

      {/* Local find-a-spot rescheduler (Move This / Replace This) */}
      {findTime && scheduleData && (
        <FindTimeModal
          appointment={findTime.apt}
          mode={findTime.mode}
          scheduleData={scheduleData}
          aiAvailable={!!aiSettings.apiKey}
          aiLoading={aiLoading}
          onApply={applyFindTime}
          onAskAi={askFindTimeAi}
          onClose={() => setFindTime(null)}
        />
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
                    style={{ padding: '5px 12px', border: 'none', borderRadius: 6, background: 'var(--brand-primary)', color: 'white', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
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

      {/* Home "Start → session": the seed is an id-less appointment the form
          treats as new and prefills from the to-do; saving marks the to-do done. */}
      {sessionSeed && scheduleData && (
        <AppointmentForm
          appointment={sessionSeed as Appointment}
          allAppointments={scheduleData.appointments}
          authorizations={scheduleData.authorizations}
          technicians={scheduleData.technicians}
          clients={scheduleData.clients}
          settings={scheduleData.settings}
          onSave={(apps, removeIds) => {
            handleSaveAppointments(apps, removeIds);
            if (startedTodoId) homeTodos.markDone(startedTodoId);
            clearSessionSeed();
          }}
          onCancel={clearSessionSeed}
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
          onExtendSeries={handleExtendSeries}
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
          policy={pwPrompt.policy}
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
    </RosterProvider>
  );
}
