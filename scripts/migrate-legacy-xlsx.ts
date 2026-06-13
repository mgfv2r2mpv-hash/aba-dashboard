// One-off migration: legacy v1 workbook -> normalized v2 workbook.
//
// The shipped parser (src/excelHandler.ts) understands v2 only. This script
// carries a SELF-CONTAINED reader for the old flat layout (per-day Start/End/
// Windows columns, client1..hours10 assignments, JSON-packed Settings, inline
// cancellation columns) so existing files + the bundled sample can be upgraded
// once. Legacy report-lead weeks are folded into the modern reportDraftLead /
// reportFinalLead fields; truly dead fields are dropped.
//
// Usage:
//   npx tsx scripts/migrate-legacy-xlsx.ts <input.xlsx> <output.xlsx> [data.json]
//
import * as XLSX from 'xlsx';
import { writeFileSync, readFileSync, statSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { generateExcelFile, parseWorkbook } from '../src/excelHandler';
import { AUTH_BUCKETS, ScheduleData, DayOfWeek } from '../src/types';

const DAYS: DayOfWeek[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function normDate(raw: any): string {
  if (raw instanceof Date) {
    return `${raw.getFullYear()}-${String(raw.getMonth() + 1).padStart(2, '0')}-${String(raw.getDate()).padStart(2, '0')}`;
  }
  const s = String(raw).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : s;
}
const sheet = (wb: XLSX.WorkBook, n: string) => (wb.Sheets[n] ? XLSX.utils.sheet_to_json(wb.Sheets[n]) as any[] : []);

function legacyAvailability(row: any): { [k: string]: any[] } {
  const av: { [k: string]: any[] } = {};
  for (const day of DAYS) {
    const raw = row[`${day}Windows`];
    if (typeof raw === 'string' && raw.trim()) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length) { av[day] = parsed.filter((w: any) => w && w.start && w.end); continue; }
      } catch { /* fall through */ }
    }
    if (row[`${day}Start`] && row[`${day}End`]) av[day] = [{ start: row[`${day}Start`], end: row[`${day}End`] }];
  }
  return av;
}

function legacyParse(wb: XLSX.WorkBook): ScheduleData {
  const clients = sheet(wb, 'Clients').map((r: any) => {
    const c: any = { id: r.id || uuidv4(), name: r.name, availabilityWindows: legacyAvailability(r), notes: r.notes };
    const pt = r.parentTrainingMaxHours; if (pt !== '' && pt != null && Number.isFinite(parseFloat(pt))) c.parentTrainingMaxHours = parseFloat(pt);
    if (['W', 'EOW', '3o4'].includes(r.cadenceGoal)) c.cadenceGoal = r.cadenceGoal;
    if (r.isEI === 'TRUE' || r.isEI === true) c.isEI = true;
    if (r.eiDate) c.eiDate = normDate(r.eiDate);
    if (r.partialStaffAllowed === 'FALSE' || r.partialStaffAllowed === false) c.partialStaffAllowed = false;
    else if (r.partialStaffAllowed === 'TRUE' || r.partialStaffAllowed === true) c.partialStaffAllowed = true;
    if (r.parentAvailableOutsideSessions === 'TRUE' || r.parentAvailableOutsideSessions === true) c.parentAvailableOutsideSessions = true;
    if (r.anticipatedDischarge) c.anticipatedDischarge = String(r.anticipatedDischarge);
    return c;
  });

  const technicians = sheet(wb, 'Technicians').map((r: any) => {
    const assignments = [];
    for (let i = 1; i <= 10; i++) if (r[`client${i}`]) assignments.push({ clientId: r[`client${i}`], hoursPerWeek: parseFloat(r[`hours${i}`]) || 0, billable: true });
    return { id: r.id || uuidv4(), name: r.name, isRBT: r.isRBT === 'TRUE' || r.isRBT === true, assignments, availability: legacyAvailability(r), notes: r.notes };
  });

  const sr = sheet(wb, 'Settings')[0] || {};
  const jsonOf = (v: any) => { if (typeof v === 'string' && v.trim()) { try { return JSON.parse(v); } catch { return undefined; } } return undefined; };
  const settings: any = {
    supervisionDirectHoursPercent: parseFloat(sr.supervisionDirectHoursPercent) || 5,
    supervisionRBTHoursPercent: parseFloat(sr.supervisionRBTHoursPercent) || 5,
    parentTraining: {
      minimumHours: parseFloat(sr.parentTrainingMinimum) || 1.5,
      targetMinHours: parseFloat(sr.parentTrainingTargetMin) || 2,
      targetMaxHours: parseFloat(sr.parentTrainingTargetMax) || 4,
      periodUnit: sr.parentTrainingPeriodUnit || 'month',
    },
  };
  const clin = jsonOf(sr.clinicianAvailability); if (clin) settings.clinicianAvailability = clin;
  for (const k of ['supervisionTechHoursPercent', 'supervisionMaxHoursPercent', 'rbtMinContactsPerMonth', 'supervisionFloorPercent', 'supervisionPreferredMinPercent', 'supervisionPreferredMaxPercent']) {
    const v = parseFloat(sr[k]); if (Number.isFinite(v)) settings[k] = v;
  }
  const util = jsonOf(sr.utilization); if (util) settings.utilization = util;
  const cn = jsonOf(sr.cancellationNotice); if (cn) settings.cancellationNotice = cn;
  // Fold legacy report-lead weeks into the modern fields (weeks).
  const bo = parseFloat(sr.reportLeadWeeksBackOffice); if (Number.isFinite(bo) && !settings.reportDraftLead) settings.reportDraftLead = { value: bo, unit: 'weeks' };
  const cd = parseFloat(sr.reportLeadWeeksClinicalDirector); if (Number.isFinite(cd) && !settings.reportFinalLead) settings.reportFinalLead = { value: cd, unit: 'weeks' };

  const appointments = sheet(wb, 'Appointments').map((r: any) => {
    const a: any = {
      id: r.id || uuidv4(), title: r.title, description: r.description, technician: r.technician, client: r.client,
      startTime: r.startTime, endTime: r.endTime,
      isFixed: r.isFixed === 'TRUE' || r.isFixed === true, isBillable: r.isBillable === 'TRUE' || r.isBillable === true,
      type: r.type || 'other', isRecurring: r.isRecurring === 'TRUE' || r.isRecurring === true,
      recurringPattern: r.recurringPattern, seriesId: r.seriesId || undefined,
      isMakeUp: r.isMakeUp === 'TRUE' || r.isMakeUp === true || undefined,
      makeupForId: r.makeupForId || undefined, isGhost: r.isGhost === 'TRUE' || r.isGhost === true || undefined,
    };
    if (r.status === 'completed' || r.status === 'canceled') a.status = r.status;
    if (r.cancellationSource && r.cancellationReason) {
      a.cancellation = {
        source: r.cancellationSource, reason: r.cancellationReason,
        unplanned: r.cancellationUnplanned === 'TRUE' || r.cancellationUnplanned === true,
        noticeMet: r.cancellationNoticeMet === 'TRUE' || r.cancellationNoticeMet === true ? true
          : r.cancellationNoticeMet === 'FALSE' || r.cancellationNoticeMet === false ? false : undefined,
        canceledAt: r.cancellationAt || undefined, notes: r.cancellationNotes || undefined,
      };
    }
    return a;
  });

  const blackouts = sheet(wb, 'Blackouts').filter((r: any) => r.entityId && r.date).map((r: any) => ({
    id: r.id || uuidv4(), entityType: r.entityType === 'client' ? 'client' : 'technician', entityId: String(r.entityId),
    entityName: r.entityName || undefined, date: normDate(r.date), reason: r.reason || undefined, createdAt: r.createdAt || undefined,
  }));

  const authorizations = sheet(wb, 'Authorizations').filter((r: any) => r.clientId && r.startDate && r.endDate).map((r: any) => {
    const buckets: any = {}; for (const { key } of AUTH_BUCKETS) { const v = parseFloat(r[key]); if (Number.isFinite(v) && v > 0) buckets[key] = v; }
    const weekly: any = {}; for (const wk of ['direct', 'supervision', 'parentTraining', 'casePlanning']) { const v = parseFloat(r[`weekly${wk[0].toUpperCase()}${wk.slice(1)}`]); if (Number.isFinite(v) && v > 0) weekly[wk] = v; }
    const a: any = { id: r.id || uuidv4(), clientId: String(r.clientId), label: r.label || undefined, startDate: normDate(r.startDate), endDate: normDate(r.endDate), buckets };
    if (Object.keys(weekly).length) a.weekly = weekly;
    if (r.reportFinalDue) a.reportFinalDue = normDate(r.reportFinalDue);
    if (r.reportDraftDue) a.reportDraftDue = normDate(r.reportDraftDue);
    return a;
  });

  const manualUsage = sheet(wb, 'ManualUsage').filter((r: any) => r.clientId && r.bucket && r.date).map((r: any) => ({
    id: r.id || uuidv4(), clientId: String(r.clientId), bucket: r.bucket, hours: parseFloat(r.hours) || 0, date: normDate(r.date), note: r.note || undefined,
  }));

  return { id: uuidv4(), version: 2, clients, technicians, settings, appointments, blackouts, authorizations, manualUsage, lastModified: new Date().toISOString() } as ScheduleData;
}

// Recursively drop undefined / null / '' (keep false, 0, [], {}).
function clean<T>(v: T): T {
  if (Array.isArray(v)) return v.map(clean) as any;
  if (v && typeof v === 'object') {
    const out: any = {};
    for (const [k, val] of Object.entries(v)) {
      if (val === undefined || val === null || val === '') continue;
      out[k] = clean(val);
    }
    return out;
  }
  return v;
}

export function migrateWorkbook(wb: XLSX.WorkBook): ScheduleData {
  return clean(legacyParse(wb));
}

// Structural deep-equal that treats undefined/absent as equal.
export function deepEqual(a: any, b: any, path = ''): string | null {
  if (a === b) return null;
  if (typeof a !== typeof b) return `${path}: type ${typeof a} != ${typeof b}`;
  if (a && b && typeof a === 'object') {
    if (Array.isArray(a) !== Array.isArray(b)) return `${path}: array mismatch`;
    if (Array.isArray(a)) {
      if (a.length !== b.length) return `${path}: length ${a.length} != ${b.length}`;
      for (let i = 0; i < a.length; i++) { const r = deepEqual(a[i], b[i], `${path}[${i}]`); if (r) return r; }
      return null;
    }
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      if (a[k] === undefined && b[k] === undefined) continue;
      const r = deepEqual(a[k], b[k], path ? `${path}.${k}` : k); if (r) return r;
    }
    return null;
  }
  return `${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`;
}

// CLI
const [, , inPath, outPath, jsonPath] = process.argv;
if (inPath && outPath) {
  const data = migrateWorkbook(XLSX.read(readFileSync(inPath), { type: 'buffer' }));
  writeFileSync(outPath, generateExcelFile(data));
  if (jsonPath) writeFileSync(jsonPath, JSON.stringify(data, null, 2));
  // Self-check: round-trip the freshly written file and compare (ignoring volatile meta).
  const back = parseWorkbook(XLSX.read(readFileSync(outPath), { type: 'buffer' })).data;
  const norm = (d: ScheduleData) => { const c: any = clean(d); delete c.id; delete c.lastModified; delete c.version; return c; };
  const diff = deepEqual(norm(data), norm(back));
  const size = (statSync(outPath).size / 1024).toFixed(1);
  console.log(`migrated ${inPath} -> ${outPath} (${size} KB)`);
  console.log(`  clients ${data.clients.length}, techs ${data.technicians.length}, appts ${data.appointments.length}, auths ${(data.authorizations || []).length}`);
  console.log(diff ? `  ROUND-TRIP MISMATCH: ${diff}` : '  round-trip: lossless ✓');
}
