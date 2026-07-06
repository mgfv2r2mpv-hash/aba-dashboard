import {
  Appointment,
  Client,
  DayOfWeek,
  ScheduleData,
  Technician,
  TimeWindow,
} from './types';
import { monthPeriod } from './compliance';
import {
  CaseState,
  BtState,
  computeCaseState,
  computeBtState,
  weekRange,
} from './caseModel';
import { buildTravelContext, travelMinutes, TravelContext } from './travel';

// ---------------------------------------------------------------------------
// Diagnosis: a prioritized list of what needs fixing this period.
//   P0 — hard constraint that must never be violated by a proposal (the engine
//        enforces these as filters, so they don't appear as "needs").
//   P1 — monthly compliance floors (bind at the month cliff).
//   P2 — auth utilization / reassessment pacing (bind at the service-end cliff).
//   P3 — soft targets (preferred supervision, cadence, 75% staffing, PT goal).
// ---------------------------------------------------------------------------

export type NeedKind =
  | 'supervision-floor'      // P1 case below supervision floor
  | 'bt-supervision-floor'   // P1 BT below required %
  | 'bacb-contacts'          // P1 RBT below 2 observed contacts
  | 'auth-direct-makeup'     // P2 weekly direct under-delivered (make up before cliff)
  | 'reassessment-pace'      // P2 reassessment block behind its report deadline
  | 'supervision-preferred'  // P3 below preferred band
  | 'cadence'                // P3 supervision pacing behind cadence goal
  | 'staffing-75'            // P3 direct below 75% of authorized weekly
  | 'parent-training';       // P3 monthly PT goal short

export type NeedCause = 'bt-cancels' | 'understaffed' | 'capacity' | undefined;

export interface CorrectionNeed {
  priority: 0 | 1 | 2 | 3;
  kind: NeedKind;
  hard: boolean;             // true => binds; false => soft target
  clientId?: string;
  techId?: string;
  subject: string;           // client or tech display name
  detail: string;            // human-readable description
  deficitHours?: number;     // hours/contacts short, where applicable
  bindingDeadline?: string;  // YYYY-MM-DD this must be cured by
  bindingCliff: 'month-end' | 'service-end';
  cause?: NeedCause;
  note?: string;             // e.g. weekend make-ups allowed
}

// Per-supervision-appointment room to trim before a floor/cap/contact is hit.
export interface ShaveEntry {
  appointmentId: string;
  clientId?: string;
  shaveMinutes: number;      // minutes removable before SOME floor binds
  limitedBy: 'case-floor' | 'bt-floor' | 'bacb-contact' | 'none';
}

// A requirement that can't be auto-satisfied without a manual entry. We never
// propose stealing a booked session from another client or assuming a BT is
// free when they're booked; instead we surface the real open windows (client +
// BT + clinician all free) for the user to enter manually.
export interface CorrectionFlag {
  clientId?: string;
  techId?: string;
  concern: string;           // the need this addresses
  message: string;           // user-facing flag listing the open windows
  windows: SlotCandidate[];
}

export interface CorrectionReport {
  monthLabel: string;
  needs: CorrectionNeed[];   // sorted by priority asc, then deficit desc
  shaveRoom: ShaveEntry[];
  flags: CorrectionFlag[];   // joint BT+BCBA windows to enter manually
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toString();

export function analyzeCorrections(data: ScheduleData, now: Date = new Date()): CorrectionReport {
  const period = monthPeriod(now);
  const needs: CorrectionNeed[] = [];

  for (const client of data.clients) {
    const cs = computeCaseState(data, client, now);
    if (cs.supervision.directHoursMonth === 0 && cs.direct.actualThisWk === 0) continue;
    needs.push(...caseNeeds(data, cs, now));
  }
  for (const tech of data.technicians) {
    const bt = computeBtState(data, tech, now);
    if (bt.directHoursMonth === 0) continue;
    needs.push(...techNeeds(bt));
  }

  needs.sort((a, b) =>
    a.priority - b.priority ||
    Number(b.hard) - Number(a.hard) ||
    (b.deficitHours ?? 0) - (a.deficitHours ?? 0)
  );

  return {
    monthLabel: period.label,
    needs,
    shaveRoom: computeShaveRoom(data, now),
    flags: buildJointWindowFlags(data, needs, now),
  };
}

// For each P1 supervision-overlap need, a BT + BCBA session is required. We
// never propose moving someone off another client to create it (that would
// "steal" a session) and never assume a BT is free when they're booked.
// Instead we list the real open windows — client + BT + clinician all free —
// for manual entry. findOpenSlots already treats existing bookings, blackouts,
// and availability as hard constraints, so a window here never steals a slot.
function buildJointWindowFlags(data: ScheduleData, needs: CorrectionNeed[], now: Date): CorrectionFlag[] {
  const flags: CorrectionFlag[] = [];
  const seen = new Set<string>();

  for (const need of needs) {
    if (need.priority !== 1) continue;
    if (need.kind !== 'supervision-floor' && need.kind !== 'bt-supervision-floor' && need.kind !== 'bacb-contacts') continue;

    // Resolve the client + tech pair that the joint session would serve.
    let clientId = need.clientId;
    let techId = need.techId;
    if (clientId && !techId) techId = servingTechId(data, clientId, now);
    if (techId && !clientId) clientId = servedClientId(data, techId, now);
    if (!clientId || !techId) continue;

    const key = `${clientId}|${techId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const client = data.clients.find(c => c.id === clientId);
    const tech = data.technicians.find(t => t.id === techId);
    if (!client || !tech) continue;

    const windows = findOpenSlots(data, {
      durationMinutes: 60,
      clientId, techId,
      useClinicianAvailability: true,
      fromDate: now,
      throughDate: need.bindingDeadline,
    }, 6);

    const list = windows.length
      ? windows.map(w => `${w.day} ${w.date} ${w.start}-${w.end}`).join('; ')
      : 'no open windows found before the deadline';
    flags.push({
      clientId, techId,
      concern: need.detail,
      message: `To meet ${need.detail}, BT ${tech.name} and the BCBA would need a session in one of these windows in ${client.name}'s availability: ${list}. Enter it manually if a proposed override is possible.`,
      windows,
    });
  }
  return flags;
}

// A technician currently delivering direct service to this client this month.
function servingTechId(data: ScheduleData, clientId: string, now: Date): string | undefined {
  const period = monthPeriod(now);
  const client = data.clients.find(c => c.id === clientId);
  if (!client) return undefined;
  const direct = data.appointments.find(a =>
    a.type === 'client-session' && a.status !== 'canceled' && !a.isGhost && !!a.technician &&
    (a.client === client.id || a.client === client.name) &&
    new Date(a.startTime).getTime() >= period.start.getTime() &&
    new Date(a.startTime).getTime() < period.end.getTime()
  );
  if (!direct?.technician) return undefined;
  return data.technicians.find(t => t.id === direct.technician || t.name === direct.technician)?.id;
}

// A client this technician currently delivers direct service to this month.
function servedClientId(data: ScheduleData, techId: string, now: Date): string | undefined {
  const period = monthPeriod(now);
  const tech = data.technicians.find(t => t.id === techId);
  if (!tech) return undefined;
  const direct = data.appointments.find(a =>
    a.type === 'client-session' && a.status !== 'canceled' && !a.isGhost && !!a.client &&
    (a.technician === tech.id || a.technician === tech.name) &&
    new Date(a.startTime).getTime() >= period.start.getTime() &&
    new Date(a.startTime).getTime() < period.end.getTime()
  );
  if (!direct?.client) return undefined;
  return data.clients.find(c => c.id === direct.client || c.name === direct.client)?.id;
}

function caseNeeds(data: ScheduleData, cs: CaseState, now: Date): CorrectionNeed[] {
  const out: CorrectionNeed[] = [];
  const base = {
    clientId: cs.client.id,
    subject: cs.client.name,
    bindingDeadline: cs.cliffs.monthEnd,
    bindingCliff: 'month-end' as const,
  };

  // P1 — supervision floor (monthly, hard at month cliff)
  if (cs.supervision.gapToFloor > 0.01) {
    out.push({
      ...base, priority: 1, kind: 'supervision-floor', hard: true,
      deficitHours: cs.supervision.gapToFloor,
      detail: `${cs.client.name}: supervision ${fmt(cs.supervision.gapToFloor)}h below the ${cs.supervision.floorPct}% floor for ${cs.monthLabel}`,
    });
  }

  // P2 — weekly direct under-delivered: make up before the service cliff
  if (cs.direct.below75) {
    const deficit = Math.max(0, cs.direct.authPerWk - cs.direct.actualThisWk);
    const cause = caseCancelCause(data, cs.client, now);
    out.push({
      priority: 3, kind: 'staffing-75', hard: false,
      clientId: cs.client.id, subject: cs.client.name,
      deficitHours: deficit,
      bindingDeadline: cs.cliffs.serviceEnd || cs.cliffs.monthEnd,
      bindingCliff: cs.cliffs.serviceEnd ? 'service-end' : 'month-end',
      detail: `${cs.client.name}: direct ${fmt(cs.direct.actualThisWk)}h vs authorized ${fmt(cs.direct.authPerWk)}h/wk (${Math.round(cs.direct.pctOfAuth)}%, below 75%)`,
      cause,
      note: cause === 'bt-cancels'
        ? 'shortfall traced to BT cancellations — weekend make-ups may be proposed (flag in conversation)'
        : undefined,
    });
  }

  // P2 — reassessment pacing
  if (!cs.reassessment.paceOk) {
    out.push({
      priority: 2, kind: 'reassessment-pace', hard: false,
      clientId: cs.client.id, subject: cs.client.name,
      deficitHours: Math.max(0, cs.reassessment.blockH - cs.reassessment.usedH),
      bindingDeadline: cs.reassessment.initialDraftDue,
      bindingCliff: 'service-end',
      detail: `${cs.client.name}: reassessment ${fmt(cs.reassessment.usedH)}/${fmt(cs.reassessment.blockH)}h done; internal due ${cs.reassessment.initialDraftDue || '?'} (${cs.reassessment.daysToInternalDue ?? '?'} days)`,
    });
  }

  // P3 — preferred supervision band
  if (cs.supervision.gapToFloor <= 0.01 && cs.supervision.supHoursMonth + 0.01 < cs.supervision.preferredH) {
    out.push({
      ...base, priority: 3, kind: 'supervision-preferred', hard: false,
      deficitHours: cs.supervision.preferredH - cs.supervision.supHoursMonth,
      detail: `${cs.client.name}: supervision ${fmt(cs.supervision.pct)}% — below preferred ${cs.supervision.preferredMinPct}–${cs.supervision.preferredMaxPct}%`,
    });
  }

  // P3 — cadence pacing
  if (cs.supervision.contactsRequiredByCadence !== undefined &&
      cs.supervision.contactsThisMonth < cs.supervision.contactsRequiredByCadence) {
    out.push({
      ...base, priority: 3, kind: 'cadence', hard: false,
      detail: `${cs.client.name}: ${cs.supervision.contactsThisMonth} supervision contact(s) vs ${cs.supervision.cadenceGoal} pacing goal (${cs.supervision.contactsRequiredByCadence})`,
    });
  }

  // P3 — parent-training monthly goal
  if (cs.parentTraining.gap > 0.01) {
    out.push({
      ...base, priority: 3, kind: 'parent-training', hard: false,
      deficitHours: cs.parentTraining.gap,
      detail: `${cs.client.name}: parent training ${fmt(cs.parentTraining.deliveredMonth)}/${fmt(cs.parentTraining.goalMonth)}h this month${cs.parentTraining.parentOutsideOk ? '' : ' (parent only available during sessions)'}`,
    });
  }

  return out;
}

function techNeeds(bt: BtState): CorrectionNeed[] {
  const out: CorrectionNeed[] = [];
  if (bt.gapToRequired > 0.01) {
    out.push({
      priority: 1, kind: 'bt-supervision-floor', hard: true,
      techId: bt.tech.id, subject: bt.tech.name,
      deficitHours: bt.gapToRequired, bindingCliff: 'month-end',
      detail: `${bt.tech.name}${bt.tech.isRBT ? ' (RBT)' : ''}: supervision ${fmt(bt.gapToRequired)}h below the required ${bt.requiredPct}%`,
    });
  }
  if (bt.contactsRequired > 0 && bt.contactsThisMonth < bt.contactsRequired) {
    out.push({
      priority: 1, kind: 'bacb-contacts', hard: true,
      techId: bt.tech.id, subject: bt.tech.name,
      deficitHours: bt.contactsRequired - bt.contactsThisMonth, bindingCliff: 'month-end',
      detail: `${bt.tech.name} (RBT): ${bt.contactsThisMonth} observed contact day(s) vs BACB minimum ${bt.contactsRequired}`,
    });
  }
  return out;
}

// Did this case's recent direct shortfall trace to BT-sourced cancellations?
function caseCancelCause(data: ScheduleData, client: Client, now: Date): NeedCause {
  const wk = weekRange(now);
  const btCanceled = data.appointments.some(a =>
    a.type === 'client-session' && a.status === 'canceled' &&
    a.cancellation?.source === 'bt' &&
    (a.client === client.id || a.client === client.name) &&
    new Date(a.startTime).getTime() >= wk.start.getTime() &&
    new Date(a.startTime).getTime() < wk.end.getTime()
  );
  return btCanceled ? 'bt-cancels' : undefined;
}

// Room to trim each supervision session before a floor/contact would break.
// A conservative, per-session estimate using the case it's tagged to.
// Corrections operate on now-and-future only: a PAST supervision session is
// never offered for trimming (we don't rewrite history to make numbers work).
function computeShaveRoom(data: ScheduleData, now: Date): ShaveEntry[] {
  const period = monthPeriod(now);
  const caseStates = new Map<string, CaseState>();
  for (const c of data.clients) caseStates.set(c.id, computeCaseState(data, c, now));

  return data.appointments
    .filter(a => a.type === 'supervision' && a.status !== 'canceled' && !a.isGhost &&
      new Date(a.startTime).getTime() >= Math.max(period.start.getTime(), now.getTime()) &&
      new Date(a.startTime).getTime() < period.end.getTime())
    .map(sup => {
      const client = data.clients.find(c => c.id === sup.client || c.name === sup.client);
      const cs = client ? caseStates.get(client.id) : undefined;
      const slackH = cs ? cs.supervision.slackAboveFloor : 0;
      const supDur = (new Date(sup.endTime).getTime() - new Date(sup.startTime).getTime()) / 3_600_000;
      // Can't shave more than the session length, nor past the case floor.
      const shaveH = Math.max(0, Math.min(slackH, supDur));
      return {
        appointmentId: sup.id,
        clientId: client?.id,
        shaveMinutes: Math.round(shaveH * 60),
        limitedBy: (shaveH <= 0.01 ? 'case-floor' : 'none') as ShaveEntry['limitedBy'],
      };
    });
}

// ---------------------------------------------------------------------------
// Slot search: open windows that satisfy the hard (P0) constraints.
// ---------------------------------------------------------------------------

export interface SlotQuery {
  durationMinutes: number;
  clientId?: string;         // resolve client availability + blackouts
  techId?: string;          // resolve tech availability + blackouts
  useClinicianAvailability?: boolean; // intersect with settings.clinicianAvailability (supervision)
  clinicianBusy?: boolean;  // also treat the BCBA's own sessions as busy (BCBA can't double-book)
  anchorTechId?: string;    // restrict mustOverlapDirect anchors to THIS tech's directs (supervision credit)
  fromDate?: Date;          // default: now
  throughDate?: string;     // YYYY-MM-DD hard deadline (default: month end)
  weekendsOk?: boolean;     // default false
  mustOverlapDirect?: boolean; // PT with parent-not-available-outside-sessions
}

export interface SlotCandidate {
  date: string;   // YYYY-MM-DD
  day: DayOfWeek;
  start: string;  // HH:MM
  end: string;    // HH:MM
}

const DAY_NAMES: DayOfWeek[] = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as any;

export function findOpenSlots(data: ScheduleData, q: SlotQuery, limit = 8): SlotCandidate[] {
  const from = q.fromDate || new Date();
  const period = monthPeriod(from);
  // Hard month boundary unless a later deadline is explicitly given AND still
  // capped by the auth (the caller passes serviceEnd for auth make-ups).
  const monthEnd = new Date(period.end.getTime() - 1);
  const deadline = q.throughDate ? new Date(`${q.throughDate}T23:59:59`) : monthEnd;
  const last = deadline.getTime() < monthEnd.getTime() ? deadline : monthEnd;

  const client = q.clientId ? data.clients.find(c => c.id === q.clientId) : undefined;
  const tech = q.techId ? data.technicians.find(t => t.id === q.techId) : undefined;
  const anchorTech = q.anchorTechId ? data.technicians.find(t => t.id === q.anchorTechId) : undefined;
  // BCBA travel context — only used when the query treats the clinician as busy
  // (a BCBA-session search); self-disables when travel is off.
  const travelCtx = q.clinicianBusy ? buildTravelContext(data) : undefined;
  const out: SlotCandidate[] = [];

  // Corrections operate on now-and-future only. Never propose a slot that has
  // already begun today; the cursor itself only moves forward from `from`.
  const fromMinToday = from.getHours() * 60 + from.getMinutes();
  const todayStr = ymd(from);

  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  while (cursor.getTime() <= last.getTime() && out.length < limit) {
    const dow = cursor.getDay();
    const day = DAY_NAMES[dow];
    const dateStr = ymd(cursor);
    const isWeekend = dow === 0 || dow === 6;
    if ((!isWeekend || q.weekendsOk) && !blackedOut(data, dateStr, client, tech)) {
      let windows = intersectAvailability(data, day, client, tech, q.useClinicianAvailability);
      // Trim any part of today's windows that lies in the past.
      if (dateStr === todayStr) {
        windows = windows
          .map(w => ({ start: Math.max(w.start, fromMinToday), end: w.end }))
          .filter(w => w.end > w.start);
      }
      // When PT must coincide with a direct session, the client's own directs
      // are NOT treated as busy — parent-training is allowed to run alongside
      // them (the parent is present). Other appointments still block.
      const busy = busyIntervals(data, dateStr, client, tech, q.mustOverlapDirect === true, q.clinicianBusy === true, travelCtx);
      const directIntervals = q.mustOverlapDirect ? directIntervalsFor(data, dateStr, client, anchorTech) : null;
      for (const w of windows) {
        // PT-coincides mode: anchor candidates to the direct sessions so the
        // slot actually overlaps one. Otherwise fill the earliest free gaps.
        const slots = directIntervals
          ? anchoredSlots(w, busy, directIntervals, q.durationMinutes)
          : carveSlots(w, busy, q.durationMinutes);
        for (const slot of slots) {
          out.push({ date: dateStr, day, start: minToTime(slot.start), end: minToTime(slot.end) });
          if (out.length >= limit) break;
        }
        if (out.length >= limit) break;
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

interface Interval { start: number; end: number } // minutes from midnight

function intersectAvailability(
  data: ScheduleData, day: DayOfWeek, client: Client | undefined, tech: Technician | undefined,
  useClinician?: boolean,
): Interval[] {
  let acc: Interval[] | null = null;
  const merge = (windows: TimeWindow[] | undefined) => {
    const ivs = (windows || []).map(w => ({ start: toMin(w.start), end: toMin(w.end) })).filter(i => i.end > i.start);
    acc = acc === null ? ivs : intersect(acc, ivs);
  };
  if (client) merge((client.availabilityWindows as any)[day]);
  if (tech) merge((tech.availability as any)[day]);
  if (useClinician) merge((data.settings.clinicianAvailability as any)?.[day]);
  return acc || [];
}

function intersect(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const x of a) for (const y of b) {
    const s = Math.max(x.start, y.start), e = Math.min(x.end, y.end);
    if (e > s) out.push({ start: s, end: e });
  }
  return out;
}

// BCBA-led session types — these occupy the supervising clinician, so when
// `clinicianBusy` is set they block a new BCBA slot even if they belong to a
// different client/tech (the BCBA can't be in two places at once).
const CLINICIAN_TYPES: readonly Appointment['type'][] = ['supervision', 'parent-training', 'case-planning', 'reassessment'];

function busyIntervals(
  data: ScheduleData, dateStr: string, client: Client | undefined, tech: Technician | undefined,
  allowOverlapClientDirect = false, includeClinician = false, travelCtx?: TravelContext,
): Interval[] {
  const dayMs = new Date(`${dateStr}T00:00:00`).getTime();
  const idOf = (ref?: string): string | undefined =>
    ref ? data.clients.find(c => c.id === ref || c.name === ref)?.id : undefined;
  return data.appointments
    .filter(a => a.status !== 'canceled' && !a.isGhost && a.startTime.slice(0, 10) === dateStr && (
      (client && (a.client === client.id || a.client === client.name)) ||
      (tech && (a.technician === tech.id || a.technician === tech.name)) ||
      (includeClinician && CLINICIAN_TYPES.includes(a.type))
    ))
    // PT-coincides-with-direct mode: don't let the client's own direct sessions
    // block the slot (they are the slots we want to land on).
    .filter(a => !(allowOverlapClientDirect && a.type === 'client-session' &&
      client && (a.client === client.id || a.client === client.name)))
    .map(a => {
      let start = minutesOfDay(a.startTime);
      let end = minutesOfDay(a.endTime);
      // Travel buffer: only BCBA (clinician-type) sessions represent the single
      // body's prior/next location. Inflate each by drive time to/from the
      // candidate client's city so a proposed slot leaves realistic travel room.
      // travelMinutes self-zeroes for same-site, unknown city, or travel-off.
      if (travelCtx && client && CLINICIAN_TYPES.includes(a.type)) {
        const loc = idOf(a.client);
        start -= travelMinutes(client.id, loc, dayMs + start * 60_000, travelCtx);
        end += travelMinutes(loc, client.id, dayMs + end * 60_000, travelCtx);
      }
      return { start, end };
    })
    .sort((x, y) => x.start - y.start);
}

function directIntervalsFor(
  data: ScheduleData, dateStr: string, client: Client | undefined, tech?: Technician | undefined,
): Interval[] {
  if (!client) return [];
  return data.appointments
    .filter(a => a.type === 'client-session' && a.status !== 'canceled' && !a.isGhost && a.startTime.slice(0, 10) === dateStr &&
      (a.client === client.id || a.client === client.name) &&
      (!tech || a.technician === tech.id || a.technician === tech.name))
    .map(a => ({ start: minutesOfDay(a.startTime), end: minutesOfDay(a.endTime) }));
}

// Open sub-slots of `window` (minus busy) that fit `durationMinutes`.
function carveSlots(window: Interval, busy: Interval[], durationMinutes: number): Interval[] {
  const within = busy.filter(b => b.end > window.start && b.start < window.end)
    .map(b => ({ start: Math.max(b.start, window.start), end: Math.min(b.end, window.end) }))
    .sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  let pos = window.start;
  for (const b of within) {
    if (b.start - pos >= durationMinutes) out.push({ start: pos, end: pos + durationMinutes });
    pos = Math.max(pos, b.end);
  }
  if (window.end - pos >= durationMinutes) out.push({ start: pos, end: pos + durationMinutes });
  return out;
}

// Slots that fit `durationMinutes`, lie within `window`, are free of `busy`,
// and overlap at least one of `directs` (for PT that must coincide with a
// direct session). Anchored to each direct's start, clamped into the window.
function anchoredSlots(window: Interval, busy: Interval[], directs: Interval[], durationMinutes: number): Interval[] {
  const out: Interval[] = [];
  for (const d of directs) {
    const start = Math.max(window.start, d.start);
    const slot = { start, end: start + durationMinutes };
    if (slot.end > window.end) continue;
    if (!overlaps(slot, d)) continue;
    if (busy.some(b => overlaps(slot, b))) continue;
    out.push(slot);
  }
  return out;
}

function blackedOut(data: ScheduleData, dateStr: string, client: Client | undefined, tech: Technician | undefined): boolean {
  return (data.blackouts || []).some(b => b.date === dateStr && (
    (client && b.entityType === 'client' && b.entityId === client.id) ||
    (tech && b.entityType === 'technician' && b.entityId === tech.id)
  ));
}

function overlaps(a: Interval, b: Interval): boolean {
  return Math.min(a.end, b.end) > Math.max(a.start, b.start);
}

// --- small date/time helpers ---
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function toMin(hhmm: string): number { const [h, m] = hhmm.split(':').map(Number); return (h || 0) * 60 + (m || 0); }
function minToTime(min: number): string { return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`; }
function minutesOfDay(iso: string): number { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes(); }
