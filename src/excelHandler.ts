import * as XLSX from 'xlsx';
import {
  ScheduleData, Appointment, Technician, Client, CompanySettings, DayOfWeek,
  Blackout, Authorization, ManualUsage, Cancellation, CancellationCode, AUTH_BUCKETS, TimeOff,
  PtoConfig, AccrualRule, AccrualKind, PtoBucket, PtoOpeningBalance,
  BcbaSessionDefaults, DEFAULT_BCBA_SESSION_DEFAULTS,
} from './types';
import { v4 as uuidv4 } from 'uuid';

// Workbook schema version. v2 = normalized relational sheets (Availability,
// Assignments, Cancellations as child sheets; narrow Clients/Technicians; Settings
// fully de-JSON'd). The parser understands v2 only — legacy v1 files are migrated
// once via scripts/migrate-legacy-xlsx.ts. See CLAUDE.md.
export const SCHEMA_VERSION = 2;

const DAYS: DayOfWeek[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export interface ParsedSchedule {
  data: ScheduleData;
  embeddedConfig?: string; // Encrypted blob containing API key + model preferences
}

// ---------------------------------------------------------------------------
// Cell helpers
// ---------------------------------------------------------------------------

const isBlank = (v: any) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
// TRUE/true → true; FALSE/false → false; blank → undefined (three-state).
function bool3(v: any): boolean | undefined {
  if (v === true || v === 'TRUE') return true;
  if (v === false || v === 'FALSE') return false;
  return undefined;
}
const truthy = (v: any) => v === true || v === 'TRUE';
function num(v: any): number | undefined {
  if (isBlank(v)) return undefined;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
}
const text = (v: any): string | undefined => (isBlank(v) ? undefined : String(v).trim());
// For writing: blank cell for nullish/empty, value otherwise.
const W = (v: any): any => (v === undefined || v === null ? '' : v);
const WB = (v: boolean | undefined): string => (v === true ? 'TRUE' : v === false ? 'FALSE' : '');
const WT = (v: boolean | undefined): string => (v ? 'TRUE' : ''); // true-or-nothing flags

function rowsOf(workbook: XLSX.WorkBook, name: string): any[] {
  const sheet = workbook.Sheets[name];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet) as any[];
}

// Resolve an entity reference (id preferred, name fallback) to a stable key used
// for grouping child rows. Returns the matched entity's id, or the raw value.
function makeResolver(entities: { id: string; name: string }[]) {
  const byId = new Map(entities.map(e => [e.id, e]));
  const byName = new Map(entities.map(e => [e.name, e]));
  return (ref: any): { id: string } | undefined => {
    if (isBlank(ref)) return undefined;
    const v = String(ref);
    return byId.get(v) || byName.get(v);
  };
}

// Accept an ISO string, a YYYY-MM-DD string, or an Excel-parsed Date and
// return a YYYY-MM-DD local-day string.
function normalizeDateString(raw: any): string {
  if (raw instanceof Date) {
    const y = raw.getFullYear();
    const m = String(raw.getMonth() + 1).padStart(2, '0');
    const d = String(raw.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(raw).trim();
  const match = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : s;
}

// ===========================================================================
// PARSE  (v2 workbook -> ScheduleData)
// ===========================================================================

export function parseExcelFile(filePath: string): ParsedSchedule {
  return parseWorkbook(XLSX.readFile(filePath));
}

export function parseWorkbook(workbook: XLSX.WorkBook): ParsedSchedule {
  const meta = rowsOf(workbook, '_Meta')[0] || {};

  const clients = parseClients(workbook);
  const technicians = parseTechnicians(workbook);

  // Normalized child sheets fanned back onto their parents.
  const { clinicianAvailability } = applyAvailability(workbook, clients, technicians);
  applyAssignments(workbook, technicians, clients);

  const settings = parseSettings(workbook, clinicianAvailability);
  const appointments = parseAppointments(workbook);
  applyCancellations(workbook, appointments);

  return {
    data: {
      id: text(meta.id) || uuidv4(),
      version: num(meta.schemaVersion) || SCHEMA_VERSION,
      clients,
      technicians,
      settings,
      appointments,
      blackouts: parseBlackouts(workbook),
      timeOff: parseTimeOff(workbook),
      authorizations: parseAuthorizations(workbook),
      manualUsage: parseManualUsage(workbook),
      lastModified: text(meta.lastModified) || new Date().toISOString(),
    },
    embeddedConfig: rowsOf(workbook, '_Config')[0]?.encryptedBlob,
  };
}

function parseClients(workbook: XLSX.WorkBook): Client[] {
  return rowsOf(workbook, 'Clients').map((row: any) => {
    const client: Client = {
      id: text(row.id) || uuidv4(),
      name: text(row.name) || '',
      availabilityWindows: {},
    };
    const ptMax = num(row.parentTrainingMaxHours);
    if (ptMax !== undefined) client.parentTrainingMaxHours = ptMax;
    if (row.cadenceGoal === 'W' || row.cadenceGoal === 'EOW' || row.cadenceGoal === '3o4') client.cadenceGoal = row.cadenceGoal;
    if (truthy(row.isEI)) client.isEI = true;
    if (!isBlank(row.eiDate)) client.eiDate = normalizeDateString(row.eiDate);
    const partial = bool3(row.partialStaffAllowed);
    if (partial !== undefined) client.partialStaffAllowed = partial;
    if (truthy(row.parentAvailableOutsideSessions)) client.parentAvailableOutsideSessions = true;
    if (!isBlank(row.anticipatedDischarge)) client.anticipatedDischarge = String(row.anticipatedDischarge);
    const notes = text(row.notes);
    if (notes) client.notes = notes;
    const supIdeal = num(row.supervisionIdealPct);
    if (supIdeal !== undefined) client.supervisionIdealPct = supIdeal;
    return client;
  });
}

function parseTechnicians(workbook: XLSX.WorkBook): Technician[] {
  return rowsOf(workbook, 'Technicians').map((row: any) => {
    const tech: Technician = {
      id: text(row.id) || uuidv4(),
      name: text(row.name) || '',
      isRBT: truthy(row.isRBT),
      assignments: [],
      availability: {},
    };
    const notes = text(row.notes);
    if (notes) tech.notes = notes;
    return tech;
  });
}

// Availability sheet -> client.availabilityWindows / technician.availability /
// settings.clinicianAvailability. One row per window.
function applyAvailability(
  workbook: XLSX.WorkBook, clients: Client[], technicians: Technician[],
): { clinicianAvailability?: CompanySettings['clinicianAvailability'] } {
  const clientOf = makeResolver(clients);
  const techOf = makeResolver(technicians);
  const clientMap = new Map(clients.map(c => [c.id, c]));
  const techMap = new Map(technicians.map(t => [t.id, t]));
  let clinician: CompanySettings['clinicianAvailability'] | undefined;

  for (const row of rowsOf(workbook, 'Availability')) {
    const day = text(row.day) as DayOfWeek | undefined;
    const start = text(row.start);
    const end = text(row.end);
    if (!day || !start || !end) continue;
    const win = { start, end };
    const ownerType = text(row.ownerType);
    if (ownerType === 'clinician') {
      clinician = clinician || {};
      (clinician[day] ||= []).push(win);
    } else if (ownerType === 'technician') {
      const t = techOf(row.ownerId); const tech = t && techMap.get(t.id);
      if (tech) (tech.availability[day] ||= []).push(win);
    } else {
      const c = clientOf(row.ownerId); const client = c && clientMap.get(c.id);
      if (client) (client.availabilityWindows[day] ||= []).push(win);
    }
  }
  return { clinicianAvailability: clinician };
}

// Assignments sheet -> technician.assignments. One row per assignment.
function applyAssignments(workbook: XLSX.WorkBook, technicians: Technician[], _clients: Client[]) {
  const techOf = makeResolver(technicians);
  const techMap = new Map(technicians.map(t => [t.id, t]));
  for (const row of rowsOf(workbook, 'Assignments')) {
    const t = techOf(row.techId); const tech = t && techMap.get(t.id);
    if (!tech || isBlank(row.clientId)) continue;
    tech.assignments.push({
      clientId: String(row.clientId),
      hoursPerWeek: num(row.hoursPerWeek) ?? 0,
      billable: bool3(row.billable) ?? true,
    });
  }
}

function parseAppointments(workbook: XLSX.WorkBook): Appointment[] {
  return rowsOf(workbook, 'Appointments').map((row: any) => {
    const appt: Appointment = {
      id: text(row.id) || uuidv4(),
      title: text(row.title) || '',
      technician: text(row.technician),
      client: text(row.client),
      startTime: String(row.startTime),
      endTime: String(row.endTime),
      isFixed: truthy(row.isFixed),
      isBillable: truthy(row.isBillable),
      type: row.type || 'other',
      isRecurring: bool3(row.isRecurring) ?? false,
    };
    const desc = text(row.description);
    if (desc) appt.description = desc;
    if (!isBlank(row.recurringPattern)) appt.recurringPattern = row.recurringPattern;
    if (!isBlank(row.seriesId)) appt.seriesId = String(row.seriesId);
    if (truthy(row.isMakeUp)) appt.isMakeUp = true;
    if (!isBlank(row.makeupForId)) appt.makeupForId = String(row.makeupForId);
    if (truthy(row.isGhost)) appt.isGhost = true;
    if (row.status === 'completed' || row.status === 'canceled') appt.status = row.status;
    return appt;
  });
}

// Cancellations child sheet -> appointment.cancellation, keyed by appointmentId.
function applyCancellations(workbook: XLSX.WorkBook, appointments: Appointment[]) {
  const byId = new Map(appointments.map(a => [a.id, a]));
  for (const row of rowsOf(workbook, 'Cancellations')) {
    const appt = byId.get(String(row.appointmentId));
    if (!appt || isBlank(row.source) || isBlank(row.reason)) continue;
    const cancellation: Cancellation = {
      source: row.source,
      reason: row.reason,
      unplanned: truthy(row.unplanned),
    };
    const noticeMet = bool3(row.noticeMet);
    if (noticeMet !== undefined) cancellation.noticeMet = noticeMet;
    if (!isBlank(row.canceledAt)) cancellation.canceledAt = String(row.canceledAt);
    const notes = text(row.notes);
    if (notes) cancellation.notes = notes;
    appt.cancellation = cancellation;
  }
}

function parseSettings(
  workbook: XLSX.WorkBook, clinicianAvailability?: CompanySettings['clinicianAvailability'],
): CompanySettings {
  const row = rowsOf(workbook, 'Settings')[0] || {};

  const settings: CompanySettings = {
    supervisionDirectHoursPercent: num(row.supervisionDirectHoursPercent) ?? 5,
    supervisionRBTHoursPercent: num(row.supervisionRBTHoursPercent) ?? 5,
    parentTraining: {
      minimumHours: num(row.parentTrainingMinimum) ?? 1.5,
      targetMinHours: num(row.parentTrainingTargetMin) ?? 2,
      targetMaxHours: num(row.parentTrainingTargetMax) ?? 4,
      periodUnit: (row.parentTrainingPeriodUnit as any) || 'month',
    },
  };
  if (clinicianAvailability) settings.clinicianAvailability = clinicianAvailability;

  for (const key of [
    'supervisionTechHoursPercent', 'supervisionMaxHoursPercent', 'supervisionFloorPercent',
    'supervisionPreferredMinPercent', 'supervisionPreferredMaxPercent', 'rbtMinContactsPerMonth',
    'techMinContactsPerMonth', 'ptoBillableDeductionRatio',
  ] as const) {
    const v = num(row[key]);
    if (v !== undefined) (settings as any)[key] = v;
  }

  // Utilization targets (own columns).
  const util: any = {};
  for (const key of [
    'bcbaWeeklyBillableHours', 'btWeeklyDirectHours', 'bcbaMonthlyBillableHours',
    'bcbaMonthlyBillableHours5Week', 'bcbaWeeklyBillableMin',
  ]) {
    const v = num(row[key]);
    if (v !== undefined) util[key] = v;
  }
  if (Object.keys(util).length) settings.utilization = util;

  // Boolean setting: contacts must occur on separate days.
  const sepDays = text(row.contactsMustOccurOnSeparateDays);
  if (sepDays !== undefined) settings.contactsMustOccurOnSeparateDays = sepDays === 'TRUE';

  // Cancellation-notice thresholds (own columns).
  const unplanned = num(row.cancellationUnplannedHoursThreshold);
  const planned = num(row.cancellationPlannedDaysThreshold);
  if (unplanned !== undefined || planned !== undefined) {
    settings.cancellationNotice = {
      unplannedHoursThreshold: unplanned ?? 24,
      plannedDaysThreshold: planned ?? 30,
    };
  }

  // Reassessment report lead times (value + unit columns).
  const draftVal = num(row.reportDraftLeadValue);
  if (draftVal !== undefined) settings.reportDraftLead = { value: draftVal, unit: row.reportDraftLeadUnit === 'days' ? 'days' : 'weeks' };
  const finalVal = num(row.reportFinalLeadValue);
  if (finalVal !== undefined) settings.reportFinalLead = { value: finalVal, unit: row.reportFinalLeadUnit === 'days' ? 'days' : 'weeks' };

  // PTO config (Upgrade 2): scalar mode columns + two child sheets. Only attach
  // settings.pto when something is actually configured, so a schedule with no PTO
  // setup round-trips as `pto: undefined` rather than a synthesized object.
  const pto = parsePtoConfig(workbook, row);
  if (pto) settings.pto = pto;

  // BCBA session-length defaults (own columns). Only attach when any are present,
  // backfilling the rest from the defaults so a partial file still round-trips.
  const bsd: Partial<BcbaSessionDefaults> = {};
  const bsdMap: [string, keyof BcbaSessionDefaults][] = [
    ['bcbaSupervisionPctOfDirect', 'supervisionPercentOfWeeklyDirect'],
    ['bcbaReassessmentHours', 'reassessmentHours'],
    ['bcbaCasePlanningHours', 'casePlanningHours'],
    ['bcbaParentTrainingHours', 'parentTrainingHours'],
    ['bcbaOtherHours', 'otherHours'],
  ];
  for (const [col, key] of bsdMap) { const v = num(row[col]); if (v !== undefined) bsd[key] = v; }
  if (Object.keys(bsd).length) settings.bcbaSessionDefaults = { ...DEFAULT_BCBA_SESSION_DEFAULTS, ...bsd };

  // Custom cancellation reason codes (own child sheet).
  const codeRows = rowsOf(workbook, 'CancellationCodes').filter(r => r && !isBlank(r.value));
  if (codeRows.length) {
    settings.cancellationReasons = codeRows.map((r: any): CancellationCode => {
      const code: CancellationCode = { value: String(r.value), label: text(r.label) || String(r.value) };
      if (truthy(r.retired)) code.retired = true;
      return code;
    });
  }

  return settings;
}

function parseBlackouts(workbook: XLSX.WorkBook): Blackout[] {
  return rowsOf(workbook, 'Blackouts')
    .filter(row => row && !isBlank(row.entityId) && !isBlank(row.date))
    .map((row: any) => {
      const b: Blackout = {
        id: text(row.id) || uuidv4(),
        entityType: row.entityType === 'client' ? 'client' : 'technician',
        entityId: String(row.entityId),
        date: normalizeDateString(row.date),
      };
      if (!isBlank(row.entityName)) b.entityName = String(row.entityName);
      if (!isBlank(row.reason)) b.reason = String(row.reason);
      if (!isBlank(row.createdAt)) b.createdAt = String(row.createdAt);
      return b;
    });
}

function parseTimeOff(workbook: XLSX.WorkBook): TimeOff[] {
  return rowsOf(workbook, 'TimeOff')
    .filter(row => row && !isBlank(row.date) && num(row.hours) !== undefined)
    .map((row: any) => {
      const t: TimeOff = {
        id: text(row.id) || uuidv4(),
        date: normalizeDateString(row.date),
        hours: num(row.hours) ?? 0,
      };
      const b = text(row.bucket);
      if (b === 'sick' || b === 'vacation' || b === 'combined' || b === 'unpaid') t.bucket = b;
      if (!isBlank(row.note)) t.note = String(row.note);
      if (!isBlank(row.createdAt)) t.createdAt = String(row.createdAt);
      return t;
    });
}

const PTO_BUCKET_VALUES: PtoBucket[] = ['sick', 'vacation', 'combined', 'unpaid'];
const ACCRUAL_KINDS: AccrualKind[] = ['semimonthly', 'everyNWeeks', 'perConvertedHours', 'perConvertedBonus'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function parsePtoConfig(workbook: XLSX.WorkBook, settingsRow: any): PtoConfig | undefined {
  const accrualRows = rowsOf(workbook, 'PtoAccruals')
    .filter(r => r && ACCRUAL_KINDS.includes(text(r.kind) as AccrualKind) && PTO_BUCKET_VALUES.includes(text(r.bucket) as PtoBucket));
  const balanceRows = rowsOf(workbook, 'PtoOpeningBalances')
    .filter(r => r && PTO_BUCKET_VALUES.includes(text(r.bucket) as PtoBucket) && num(r.hours) !== undefined);

  const modeCell = text(settingsRow.ptoMode);
  const bucketsCell = text(settingsRow.ptoBuckets);
  const unpaidCell = bool3(settingsRow.ptoUnpaidEnabled);
  // Nothing configured at all → leave settings.pto undefined (the default).
  if (!modeCell && !bucketsCell && unpaidCell === undefined && accrualRows.length === 0 && balanceRows.length === 0) {
    return undefined;
  }

  const pto: PtoConfig = {
    mode: modeCell === 'accrual' ? 'accrual' : 'unlimited',
    buckets: bucketsCell === 'separate' ? 'separate' : 'combined',
  };
  if (unpaidCell === true) pto.unpaidEnabled = true;

  if (accrualRows.length) {
    pto.accruals = accrualRows.map((r: any): AccrualRule => {
      const rule: AccrualRule = {
        id: text(r.id) || uuidv4(),
        kind: text(r.kind) as AccrualKind,
        bucket: text(r.bucket) as PtoBucket,
        hours: num(r.hours) ?? 0,
      };
      const everyWeeks = num(r.everyWeeks); if (everyWeeks !== undefined) rule.everyWeeks = everyWeeks;
      const wd = text(r.weekday); if (wd && DAY_NAMES.includes(wd)) rule.weekday = wd as AccrualRule['weekday'];
      if (!isBlank(r.anchor)) rule.anchor = normalizeDateString(r.anchor);
      const perHours = num(r.perHours); if (perHours !== undefined) rule.perHours = perHours;
      const bonusHours = num(r.bonusHours); if (bonusHours !== undefined) rule.bonusHours = bonusHours;
      const bonusInterval = text(r.bonusInterval); if (bonusInterval === 'week' || bonusInterval === 'month') rule.bonusInterval = bonusInterval;
      const bonusConsec = num(r.bonusConsecutiveIntervals); if (bonusConsec !== undefined) rule.bonusConsecutiveIntervals = bonusConsec;
      const bonusCriterion = text(r.bonusCriterion); if (bonusCriterion === 'hours' || bonusCriterion === 'percentAboveGoal') rule.bonusCriterion = bonusCriterion;
      const bonusPer = num(r.bonusPerExtraHours); if (bonusPer !== undefined) rule.bonusPerExtraHours = bonusPer;
      const bonusPct = num(r.bonusPercentAboveGoal); if (bonusPct !== undefined) rule.bonusPercentAboveGoal = bonusPct;
      const enabled = bool3(r.enabled); if (enabled !== undefined) rule.enabled = enabled;
      return rule;
    });
  }
  if (balanceRows.length) {
    pto.openingBalances = balanceRows.map((r: any): PtoOpeningBalance => ({
      bucket: text(r.bucket) as PtoBucket,
      hours: num(r.hours) ?? 0,
      asOf: normalizeDateString(r.asOf),
    }));
  }
  return pto;
}

function parseAuthorizations(workbook: XLSX.WorkBook): Authorization[] {
  return rowsOf(workbook, 'Authorizations')
    .filter(row => row && !isBlank(row.clientId) && !isBlank(row.startDate) && !isBlank(row.endDate))
    .map((row: any) => {
      const buckets: Authorization['buckets'] = {};
      for (const { key } of AUTH_BUCKETS) {
        const v = num(row[key]);
        if (v !== undefined && v > 0) buckets[key] = v;
      }
      const weekly: NonNullable<Authorization['weekly']> = {};
      for (const wk of ['direct', 'supervision', 'parentTraining', 'casePlanning'] as const) {
        const v = num(row[`weekly${wk.charAt(0).toUpperCase()}${wk.slice(1)}`]);
        if (v !== undefined && v > 0) weekly[wk] = v;
      }
      const auth: Authorization = {
        id: text(row.id) || uuidv4(),
        clientId: String(row.clientId),
        startDate: normalizeDateString(row.startDate),
        endDate: normalizeDateString(row.endDate),
        buckets,
      };
      if (!isBlank(row.label)) auth.label = String(row.label);
      if (Object.keys(weekly).length > 0) auth.weekly = weekly;
      if (!isBlank(row.reportFinalDue)) auth.reportFinalDue = normalizeDateString(row.reportFinalDue);
      if (!isBlank(row.reportDraftDue)) auth.reportDraftDue = normalizeDateString(row.reportDraftDue);
      return auth;
    });
}

function parseManualUsage(workbook: XLSX.WorkBook): ManualUsage[] {
  return rowsOf(workbook, 'ManualUsage')
    .filter(row => row && !isBlank(row.clientId) && !isBlank(row.bucket) && !isBlank(row.date))
    .map((row: any) => {
      const u: ManualUsage = {
        id: text(row.id) || uuidv4(),
        clientId: String(row.clientId),
        bucket: row.bucket,
        hours: num(row.hours) ?? 0,
        date: normalizeDateString(row.date),
      };
      if (!isBlank(row.note)) u.note = String(row.note);
      return u;
    });
}

// ===========================================================================
// GENERATE  (ScheduleData -> v2 workbook). aoa_to_sheet keeps column order
// stable; compression:true so the zip is actually compressed (~5x smaller).
// ===========================================================================

function buildWorkbook(data: ScheduleData, embeddedConfig?: string): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const add = (name: string, headers: string[], rows: any[][]) =>
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...rows]), name);

  // _Meta — format marker + provenance.
  add('_Meta', ['schemaVersion', 'id', 'lastModified', 'exportedAt', 'appName'],
    [[SCHEMA_VERSION, W(data.id), W(data.lastModified), new Date().toISOString(), 'aba-dashboard']]);

  if (embeddedConfig) add('_Config', ['encryptedBlob'], [[embeddedConfig]]);

  // Clients (scalars only).
  add('Clients',
    ['id', 'name', 'parentTrainingMaxHours', 'cadenceGoal', 'isEI', 'eiDate',
      'partialStaffAllowed', 'parentAvailableOutsideSessions', 'anticipatedDischarge', 'notes',
      'supervisionIdealPct'],
    data.clients.map(c => [
      c.id, c.name, W(c.parentTrainingMaxHours), W(c.cadenceGoal), WT(c.isEI), W(c.eiDate),
      WB(c.partialStaffAllowed), WT(c.parentAvailableOutsideSessions), W(c.anticipatedDischarge), W(c.notes),
      W(c.supervisionIdealPct),
    ]));

  // Technicians (scalars only).
  add('Technicians', ['id', 'name', 'isRBT', 'notes'],
    data.technicians.map(t => [t.id, t.name, WB(t.isRBT), W(t.notes)]));

  // Availability (normalized: clients + technicians + clinician).
  const availRows: any[][] = [];
  const emitAvail = (ownerType: string, ownerId: string, ownerName: string, av?: { [k: string]: any[] }) => {
    if (!av) return;
    for (const day of DAYS) for (const w of (av[day] || [])) availRows.push([ownerType, ownerId, ownerName, day, w.start, w.end]);
  };
  data.clients.forEach(c => emitAvail('client', c.id, c.name, c.availabilityWindows));
  data.technicians.forEach(t => emitAvail('technician', t.id, t.name, t.availability));
  emitAvail('clinician', '', 'Clinician', data.settings.clinicianAvailability);
  add('Availability', ['ownerType', 'ownerId', 'ownerName', 'day', 'start', 'end'], availRows);

  // Assignments (normalized).
  const clientName = makeNameLookup(data.clients);
  const asgRows: any[][] = [];
  data.technicians.forEach(t => (t.assignments || []).forEach(a =>
    asgRows.push([t.id, t.name, a.clientId, clientName(a.clientId), W(a.hoursPerWeek), WB(a.billable)])));
  add('Assignments', ['techId', 'techName', 'clientId', 'clientName', 'hoursPerWeek', 'billable'], asgRows);

  // Settings (single row, de-JSON'd).
  const s = data.settings; const u = s.utilization || {}; const cn = s.cancellationNotice;
  add('Settings',
    ['supervisionDirectHoursPercent', 'supervisionRBTHoursPercent', 'supervisionTechHoursPercent',
      'supervisionMaxHoursPercent', 'supervisionFloorPercent', 'supervisionPreferredMinPercent',
      'supervisionPreferredMaxPercent', 'rbtMinContactsPerMonth', 'techMinContactsPerMonth',
      'contactsMustOccurOnSeparateDays', 'parentTrainingMinimum',
      'parentTrainingTargetMin', 'parentTrainingTargetMax', 'parentTrainingPeriodUnit',
      'bcbaWeeklyBillableHours', 'btWeeklyDirectHours', 'bcbaMonthlyBillableHours',
      'bcbaMonthlyBillableHours5Week', 'bcbaWeeklyBillableMin',
      'cancellationUnplannedHoursThreshold', 'cancellationPlannedDaysThreshold',
      'reportDraftLeadValue', 'reportDraftLeadUnit', 'reportFinalLeadValue', 'reportFinalLeadUnit',
      'ptoBillableDeductionRatio', 'ptoMode', 'ptoBuckets', 'ptoUnpaidEnabled',
      'bcbaSupervisionPctOfDirect', 'bcbaReassessmentHours', 'bcbaCasePlanningHours',
      'bcbaParentTrainingHours', 'bcbaOtherHours'],
    [[
      s.supervisionDirectHoursPercent, s.supervisionRBTHoursPercent, W(s.supervisionTechHoursPercent),
      W(s.supervisionMaxHoursPercent), W(s.supervisionFloorPercent), W(s.supervisionPreferredMinPercent),
      W(s.supervisionPreferredMaxPercent), W(s.rbtMinContactsPerMonth), W(s.techMinContactsPerMonth),
      WB(s.contactsMustOccurOnSeparateDays), s.parentTraining.minimumHours,
      s.parentTraining.targetMinHours, s.parentTraining.targetMaxHours, s.parentTraining.periodUnit,
      W(u.bcbaWeeklyBillableHours), W(u.btWeeklyDirectHours), W(u.bcbaMonthlyBillableHours),
      W(u.bcbaMonthlyBillableHours5Week), W(u.bcbaWeeklyBillableMin),
      W(cn?.unplannedHoursThreshold), W(cn?.plannedDaysThreshold),
      W(s.reportDraftLead?.value), W(s.reportDraftLead?.unit), W(s.reportFinalLead?.value), W(s.reportFinalLead?.unit),
      W(s.ptoBillableDeductionRatio), W(s.pto?.mode), W(s.pto?.buckets), WB(s.pto?.unpaidEnabled),
      W(s.bcbaSessionDefaults?.supervisionPercentOfWeeklyDirect), W(s.bcbaSessionDefaults?.reassessmentHours),
      W(s.bcbaSessionDefaults?.casePlanningHours), W(s.bcbaSessionDefaults?.parentTrainingHours),
      W(s.bcbaSessionDefaults?.otherHours),
    ]]);

  // Appointments (cancellation columns split out).
  add('Appointments',
    ['id', 'title', 'description', 'technician', 'client', 'startTime', 'endTime', 'isFixed',
      'isBillable', 'type', 'isMakeUp', 'makeupForId', 'isGhost', 'isRecurring', 'recurringPattern',
      'seriesId', 'status'],
    data.appointments.map(a => [
      a.id, a.title, W(a.description), W(a.technician), W(a.client), a.startTime, a.endTime,
      WB(a.isFixed), WB(a.isBillable), a.type, WT(a.isMakeUp), W(a.makeupForId), WT(a.isGhost),
      WB(a.isRecurring), W(a.recurringPattern), W(a.seriesId), a.status || 'scheduled',
    ]));

  // Cancellations (child of canceled appointments).
  const cxRows: any[][] = [];
  data.appointments.forEach(a => {
    const c = a.cancellation;
    if (c) cxRows.push([a.id, c.source, c.reason, WB(c.unplanned), WB(c.noticeMet), W(c.canceledAt), W(c.notes)]);
  });
  add('Cancellations', ['appointmentId', 'source', 'reason', 'unplanned', 'noticeMet', 'canceledAt', 'notes'], cxRows);

  // Company-customized cancellation reason codes (one row per code). Absent /
  // empty falls back to the built-in defaults at read time.
  add('CancellationCodes', ['value', 'label', 'retired'],
    (s.cancellationReasons || []).map(c => [c.value, c.label, WB(!!c.retired)]));

  // Blackouts.
  add('Blackouts', ['id', 'entityType', 'entityId', 'entityName', 'date', 'reason', 'createdAt'],
    (data.blackouts || []).map(b => [b.id, b.entityType, b.entityId, W(b.entityName), b.date, W(b.reason), W(b.createdAt)]));

  // BCBA time off (one row per leave day). Drives the billable-requirement
  // deduction (Settings.ptoBillableDeductionRatio); bucket is recorded for the
  // forthcoming accrual/balance tracking.
  add('TimeOff', ['id', 'date', 'hours', 'bucket', 'note', 'createdAt'],
    (data.timeOff || []).map(t => [t.id, t.date, t.hours, W(t.bucket), W(t.note), W(t.createdAt)]));

  // PTO accrual rules + opening balances (Upgrade 2). One row each; absent =
  // unlimited mode with no balances.
  add('PtoAccruals',
    ['id', 'kind', 'bucket', 'hours', 'everyWeeks', 'weekday', 'anchor', 'perHours',
      'bonusHours', 'bonusInterval', 'bonusConsecutiveIntervals', 'bonusCriterion',
      'bonusPerExtraHours', 'bonusPercentAboveGoal', 'enabled'],
    (data.settings.pto?.accruals || []).map(r => [
      r.id, r.kind, r.bucket, r.hours, W(r.everyWeeks), W(r.weekday), W(r.anchor), W(r.perHours),
      W(r.bonusHours), W(r.bonusInterval), W(r.bonusConsecutiveIntervals), W(r.bonusCriterion),
      W(r.bonusPerExtraHours), W(r.bonusPercentAboveGoal), r.enabled === undefined ? '' : WB(r.enabled),
    ]));
  add('PtoOpeningBalances', ['bucket', 'hours', 'asOf'],
    (data.settings.pto?.openingBalances || []).map(b => [b.bucket, b.hours, b.asOf]));

  // Authorizations (bucket + weekly columns).
  add('Authorizations',
    ['id', 'clientId', 'label', 'startDate', 'endDate', ...AUTH_BUCKETS.map(b => b.key),
      'weeklyDirect', 'weeklySupervision', 'weeklyParentTraining', 'weeklyCasePlanning',
      'reportFinalDue', 'reportDraftDue'],
    (data.authorizations || []).map(a => [
      a.id, a.clientId, W(a.label), a.startDate, a.endDate,
      ...AUTH_BUCKETS.map(b => W(a.buckets[b.key])),
      W(a.weekly?.direct), W(a.weekly?.supervision), W(a.weekly?.parentTraining), W(a.weekly?.casePlanning),
      W(a.reportFinalDue), W(a.reportDraftDue),
    ]));

  // ManualUsage.
  add('ManualUsage', ['id', 'clientId', 'bucket', 'hours', 'date', 'note'],
    (data.manualUsage || []).map(u => [u.id, u.clientId, u.bucket, u.hours, u.date, W(u.note)]));

  return wb;
}

// Node.js path — used by the Express server and native build scripts.
export function generateExcelFile(data: ScheduleData, embeddedConfig?: string): Buffer {
  return XLSX.write(buildWorkbook(data, embeddedConfig), { bookType: 'xlsx', type: 'buffer', compression: true });
}

// Browser/worker path — returns Uint8Array so no Node Buffer polyfill is needed.
export function generateExcelBytes(data: ScheduleData, embeddedConfig?: string): Uint8Array {
  return new Uint8Array(
    XLSX.write(buildWorkbook(data, embeddedConfig), { bookType: 'xlsx', type: 'array', compression: true })
  );
}

function makeNameLookup(clients: { id: string; name: string }[]) {
  const byId = new Map(clients.map(c => [c.id, c.name]));
  const byName = new Map(clients.map(c => [c.name, c.name]));
  return (ref: string): string => byId.get(ref) || byName.get(ref) || ref;
}
