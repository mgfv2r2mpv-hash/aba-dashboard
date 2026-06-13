/** Round-trip check for the v2 normalized workbook format. Run: npx tsx scripts/verify-excel.ts */
import * as XLSX from 'xlsx';
import { ScheduleData } from '../src/types';
import { generateExcelFile, parseWorkbook, SCHEMA_VERSION } from '../src/excelHandler';
import { deepEqual } from './migrate-legacy-xlsx';

let passed = 0, failed = 0;
const check = (n: string, c: boolean, e?: string) => { c ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${e ? ` — ${e}` : ''}`)); };

const data: ScheduleData = {
  id: 'rt', version: SCHEMA_VERSION,
  clients: [{
    id: 'C1', name: 'Client One',
    // Multi-window day exercises the normalized Availability sheet.
    availabilityWindows: { Monday: [{ start: '09:00', end: '11:00' }, { start: '13:00', end: '15:00' }], Saturday: [{ start: '10:00', end: '12:00' }] },
    cadenceGoal: 'EOW', isEI: true, eiDate: '2026-09-01',
    partialStaffAllowed: false, parentAvailableOutsideSessions: true,
    anticipatedDischarge: 'EI transition ~age 3', notes: 'note',
  }],
  technicians: [{
    id: 'T1', name: 'Tech One', isRBT: true,
    assignments: [{ clientId: 'C1', hoursPerWeek: 12, billable: true }, { clientId: 'C1', hoursPerWeek: 3, billable: false }],
    availability: { Tuesday: [{ start: '15:00', end: '19:00' }] },
  }],
  settings: {
    supervisionDirectHoursPercent: 10, supervisionRBTHoursPercent: 10, supervisionTechHoursPercent: 8,
    supervisionMaxHoursPercent: 20, supervisionFloorPercent: 10, supervisionPreferredMinPercent: 15, supervisionPreferredMaxPercent: 20,
    rbtMinContactsPerMonth: 2,
    parentTraining: { minimumHours: 1, targetMinHours: 4, targetMaxHours: 6, periodUnit: 'month' },
    clinicianAvailability: { Monday: [{ start: '08:00', end: '14:00' }, { start: '15:00', end: '19:00' }] },
    utilization: { bcbaWeeklyBillableHours: 25, btWeeklyDirectHours: 165, bcbaMonthlyBillableHours: 100, bcbaMonthlyBillableHours5Week: 125, bcbaWeeklyBillableMin: 22 },
    cancellationNotice: { unplannedHoursThreshold: 24, plannedDaysThreshold: 30 },
    reportDraftLead: { value: 4, unit: 'weeks' }, reportFinalLead: { value: 2, unit: 'weeks' },
  },
  appointments: [
    { id: 'A1', title: 'Direct', technician: 'T1', client: 'C1', startTime: '2026-06-01T09:00:00', endTime: '2026-06-01T11:00:00', isFixed: false, isBillable: true, type: 'client-session', isRecurring: true, recurringPattern: 'weekly', seriesId: 'S1' },
    { id: 'A2', title: 'Canceled', technician: 'T1', client: 'C1', startTime: '2026-06-02T09:00:00', endTime: '2026-06-02T10:00:00', isFixed: false, isBillable: true, type: 'client-session', isRecurring: false, status: 'canceled', cancellation: { source: 'family', reason: 'sick', unplanned: true, noticeMet: false, canceledAt: '2026-06-01T20:00:00', notes: 'called out' } },
  ],
  blackouts: [{ id: 'B1', entityType: 'client', entityId: 'C1', entityName: 'Client One', date: '2026-07-04', reason: 'holiday' }],
  authorizations: [{
    id: 'AU1', clientId: 'C1', label: 'Payer-123', startDate: '2026-01-01', endDate: '2026-08-31',
    buckets: { reassessment: 8, direct: 400 }, weekly: { direct: 20, supervision: 4, parentTraining: 1, casePlanning: 1 },
    reportFinalDue: '2026-07-06', reportDraftDue: '2026-06-29',
  }],
  manualUsage: [{ id: 'U1', clientId: 'C1', bucket: 'direct', hours: 5, date: '2026-05-15', note: 'prior' }],
  lastModified: '2026-06-13T00:00:00.000Z',
};

const buf = generateExcelFile(data);
const wb = XLSX.read(buf, { type: 'buffer' });
const { data: rt } = parseWorkbook(wb);

// Targeted field checks (normalized sheets + new columns).
const c = rt.clients[0];
check('client multi-window Monday preserved', JSON.stringify(c.availabilityWindows.Monday) === JSON.stringify(data.clients[0].availabilityWindows.Monday));
check('client.cadenceGoal/isEI/eiDate', c.cadenceGoal === 'EOW' && c.isEI === true && c.eiDate === '2026-09-01');
check('client.partialStaffAllowed=false', c.partialStaffAllowed === false);
check('client.parentAvailableOutsideSessions', c.parentAvailableOutsideSessions === true);

const t = rt.technicians[0];
check('tech.isRBT + availability', t.isRBT === true && t.availability.Tuesday?.[0].end === '19:00');
check('tech.assignments (incl. billable=false)', t.assignments.length === 2 && t.assignments[1].billable === false && t.assignments[0].hoursPerWeek === 12);

const a = rt.authorizations![0];
check('auth weekly + buckets + dates', a.weekly?.direct === 20 && a.buckets.reassessment === 8 && a.reportDraftDue === '2026-06-29' && a.label === 'Payer-123');

const st = rt.settings;
check('settings clinicianAvailability multi-window', st.clinicianAvailability?.Monday?.length === 2);
check('settings utilization columns', st.utilization?.bcbaWeeklyBillableMin === 22 && st.utilization?.btWeeklyDirectHours === 165);
check('settings cancellationNotice columns', st.cancellationNotice?.unplannedHoursThreshold === 24);
check('settings report leads', st.reportDraftLead?.value === 4 && st.reportFinalLead?.unit === 'weeks');

const cx = rt.appointments.find(x => x.id === 'A2')!;
check('appointment cancellation (separate sheet)', cx.status === 'canceled' && cx.cancellation?.source === 'family' && cx.cancellation?.noticeMet === false && cx.cancellation?.notes === 'called out');
check('appointment recurring metadata', rt.appointments[0].seriesId === 'S1' && rt.appointments[0].recurringPattern === 'weekly');

check('schemaVersion = 2', rt.version === SCHEMA_VERSION);
check('blackout + manualUsage', rt.blackouts![0].reason === 'holiday' && rt.manualUsage![0].hours === 5);

// Full structural round-trip (ignoring volatile lastModified).
const norm = (d: ScheduleData) => { const x: any = JSON.parse(JSON.stringify(d)); delete x.lastModified; return x; };
const diff = deepEqual(norm(data), norm(rt));
check('full structural round-trip', diff === null, diff || undefined);

console.log(`\n${failed === 0 ? 'ALL PASS' : 'FAILURES'} — ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
