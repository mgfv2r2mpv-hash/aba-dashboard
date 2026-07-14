/** Round-trip check for the v2 normalized workbook format. Run: npx tsx scripts/verify-excel.ts */
import * as XLSX from 'xlsx';
import { ScheduleData } from '../src/types';
import { generateExcelFile, parseWorkbook, SCHEMA_VERSION } from '../src/excelHandler';
import { migrateScheduleData } from '../src/scheduleMigrations';
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
    city: 'Springfield',
    // Exported hint fields only — source/updatedAt provenance is device-local
    // (deliberately dropped by the xlsx writer) so it must NOT appear here or
    // the full structural round-trip below would rightly fail.
    schedulingHints: { supervisionStyle: 'split', preferredDaypart: 'midday', note: 'wedge between morning clients' },
  }],
  technicians: [{
    id: 'T1', name: 'Tech One', isRBT: true,
    assignments: [{ clientId: 'C1', hoursPerWeek: 12, billable: true }, { clientId: 'C1', hoursPerWeek: 3, billable: false }],
    availability: { Tuesday: [{ start: '15:00', end: '19:00' }] },
  }],
  settings: {
    practiceName: 'Sunrise ABA',
    supervisionDirectHoursPercent: 10, supervisionRBTHoursPercent: 10, supervisionTechHoursPercent: 8,
    supervisionMaxHoursPercent: 20, supervisionFloorPercent: 10, supervisionPreferredMinPercent: 15, supervisionPreferredMaxPercent: 20,
    rbtMinContactsPerMonth: 2,
    parentTraining: { minimumHours: 1, targetMinHours: 4, targetMaxHours: 6, periodUnit: 'month' },
    minSessionMinutes: { supervision: 45, parentTraining: 30, casePlanning: 20, clientSession: 60 },
    clinicianAvailability: { Monday: [{ start: '08:00', end: '14:00' }, { start: '15:00', end: '19:00' }] },
    utilization: { bcbaWeeklyBillableHours: 25, btWeeklyDirectHours: 165, bcbaMonthlyBillableHours: 100, bcbaMonthlyBillableHours5Week: 125, bcbaWeeklyBillableMin: 22 },
    cancellationNotice: { unplannedHoursThreshold: 24, plannedDaysThreshold: 30 },
    reportDraftLead: { value: 4, unit: 'weeks' }, reportFinalLead: { value: 2, unit: 'weeks' },
    ptoBillableDeductionRatio: 0.625,
    pto: {
      mode: 'accrual', buckets: 'separate', unpaidEnabled: true,
      accruals: [
        { id: 'AC1', kind: 'semimonthly', bucket: 'vacation', hours: 4 },
        { id: 'AC2', kind: 'everyNWeeks', bucket: 'sick', hours: 2, everyWeeks: 2, weekday: 'Friday', anchor: '2026-01-02', enabled: true },
        { id: 'AC3', kind: 'perConvertedBonus', bucket: 'vacation', hours: 1, perHours: 30, bonusHours: 2, bonusInterval: 'week', bonusConsecutiveIntervals: 3, bonusCriterion: 'percentAboveGoal', bonusPercentAboveGoal: 5 },
      ],
      openingBalances: [{ bucket: 'vacation', hours: 10, asOf: '2026-01-01' }],
    },
    // Travel grounding: home base (exact address ok), tunables, geocode cache, routed cache.
    homeBase: { label: 'Home', address: '1 Main St', city: 'Hometown', lat: 40.0, lng: -75.0 },
    travel: { enabled: true, withinCityMin: 15, padPercent: 5, avgSpeedMph: 30, defaultUnknownMin: 45, hourBucketSize: 1 },
    cityCenters: [{ city: 'springfield', lat: 40.1, lng: -75.1 }, { city: 'hometown', lat: 40.0, lng: -75.0 }],
    travelCache: [{ from: 'HOME', to: 'springfield', dow: 2, hour: 10, minutes: 22 }],
  },
  appointments: [
    { id: 'A1', title: 'Direct', technician: 'T1', client: 'C1', startTime: '2026-06-01T09:00:00', endTime: '2026-06-01T11:00:00', isFixed: false, isBillable: true, type: 'client-session', isRecurring: true, recurringPattern: 'weekly', seriesId: 'S1' },
    { id: 'A2', title: 'Canceled', technician: 'T1', client: 'C1', startTime: '2026-06-02T09:00:00', endTime: '2026-06-02T10:00:00', isFixed: false, isBillable: true, type: 'client-session', isRecurring: false, status: 'canceled', cancellation: { source: 'family', reason: 'sick', unplanned: true, noticeMet: false, canceledAt: '2026-06-01T20:00:00', notes: 'called out' } },
  ],
  blackouts: [{ id: 'B1', entityType: 'client', entityId: 'C1', entityName: 'Client One', date: '2026-07-04', reason: 'holiday' }],
  timeOff: [{ id: 'PTO1', date: '2026-06-15', hours: 8, bucket: 'vacation', note: 'beach', createdAt: '2026-06-01T12:00:00.000Z' }],
  companyHolidays: [{ id: 'H1', date: '2026-07-04', name: 'Independence Day', createdAt: '2026-01-01T00:00:00.000Z' }],
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
check('settings minSessionMinutes round-trips', st.minSessionMinutes?.supervision === 45 && st.minSessionMinutes?.parentTraining === 30
  && st.minSessionMinutes?.casePlanning === 20 && st.minSessionMinutes?.clientSession === 60);
check('settings cancellationNotice columns', st.cancellationNotice?.unplannedHoursThreshold === 24);
check('settings report leads', st.reportDraftLead?.value === 4 && st.reportFinalLead?.unit === 'weeks');

check('client.city round-trips', c.city === 'Springfield');
check('client.schedulingHints round-trips (style/daypart/note)',
  c.schedulingHints?.supervisionStyle === 'split' && c.schedulingHints?.preferredDaypart === 'midday'
  && c.schedulingHints?.note === 'wedge between morning clients');
check('client.schedulingHints provenance stays device-local',
  c.schedulingHints?.source === undefined && c.schedulingHints?.updatedAt === undefined);
check('settings.homeBase (address + coords)', st.homeBase?.address === '1 Main St' && st.homeBase?.city === 'Hometown' && st.homeBase?.lat === 40.0 && st.homeBase?.lng === -75.0);
check('settings.travel tunables', st.travel?.enabled === true && st.travel?.withinCityMin === 15 && st.travel?.padPercent === 5 && st.travel?.hourBucketSize === 1);
check('settings.cityCenters child sheet', st.cityCenters?.length === 2 && st.cityCenters?.[0].city === 'springfield' && st.cityCenters?.[0].lat === 40.1);
check('settings.travelCache child sheet', st.travelCache?.length === 1 && st.travelCache?.[0].from === 'HOME' && st.travelCache?.[0].to === 'springfield' && st.travelCache?.[0].minutes === 22 && st.travelCache?.[0].dow === 2);

const cx = rt.appointments.find(x => x.id === 'A2')!;
check('appointment cancellation (separate sheet)', cx.status === 'canceled' && cx.cancellation?.source === 'family' && cx.cancellation?.noticeMet === false && cx.cancellation?.notes === 'called out');
check('appointment recurring metadata', rt.appointments[0].seriesId === 'S1' && rt.appointments[0].recurringPattern === 'weekly');

check('schemaVersion = 2', rt.version === SCHEMA_VERSION);
check('blackout + manualUsage', rt.blackouts![0].reason === 'holiday' && rt.manualUsage![0].hours === 5);
check('companyHolidays round-trip', rt.companyHolidays?.[0].name === 'Independence Day' && rt.companyHolidays?.[0].date === '2026-07-04');
check('timeOff + pto deduction ratio',
  rt.timeOff![0].hours === 8 && rt.timeOff![0].bucket === 'vacation' && rt.timeOff![0].note === 'beach'
  && st.ptoBillableDeductionRatio === 0.625);
check('pto config (mode/buckets/unpaid/accruals/openings)',
  st.pto?.mode === 'accrual' && st.pto?.buckets === 'separate' && st.pto?.unpaidEnabled === true
  && st.pto?.accruals?.length === 3 && st.pto?.accruals?.[1].weekday === 'Friday' && st.pto?.accruals?.[1].everyWeeks === 2
  && st.pto?.accruals?.[2].kind === 'perConvertedBonus' && st.pto?.accruals?.[2].bonusInterval === 'week'
  && st.pto?.accruals?.[2].bonusConsecutiveIntervals === 3 && st.pto?.accruals?.[2].bonusCriterion === 'percentAboveGoal'
  && st.pto?.accruals?.[2].bonusPercentAboveGoal === 5
  && st.pto?.openingBalances?.[0].hours === 10 && st.pto?.openingBalances?.[0].asOf === '2026-01-01');

// Full structural round-trip (ignoring volatile lastModified).
const norm = (d: ScheduleData) => { const x: any = JSON.parse(JSON.stringify(d)); delete x.lastModified; return x; };
const diff = deepEqual(norm(data), norm(rt));
check('full structural round-trip', diff === null, diff || undefined);

console.log('recurrence pattern vocabulary at the import boundary');
{
  const mini: ScheduleData = {
    ...data,
    appointments: [
      // 'custom' is a first-class stored pattern — must round-trip.
      { id: 'CU1', title: 'MWF', technician: 'T1', client: 'C1', startTime: '2026-06-01T09:00:00', endTime: '2026-06-01T10:00:00', isFixed: false, isBillable: true, type: 'client-session', isRecurring: true, recurringPattern: 'custom', seriesId: 'S-CU' },
      // Garbage from a hand-edited workbook — must be DROPPED on import, not stored.
      { id: 'GX1', title: 'Bad', technician: 'T1', client: 'C1', startTime: '2026-06-02T09:00:00', endTime: '2026-06-02T10:00:00', isFixed: false, isBillable: true, type: 'client-session', isRecurring: true, recurringPattern: 'fortnightly' as any },
    ],
  };
  const rt2 = parseWorkbook(XLSX.read(generateExcelFile(mini), { type: 'buffer' })).data;
  check("'custom' pattern round-trips", rt2.appointments.find(a => a.id === 'CU1')?.recurringPattern === 'custom');
  check('garbage pattern dropped on import', rt2.appointments.find(a => a.id === 'GX1')?.recurringPattern === undefined,
    String(rt2.appointments.find(a => a.id === 'GX1')?.recurringPattern));
}

console.log('imported workbook half-states heal via migrateScheduleData (v0 → current)');
{
  const halfStates: ScheduleData = {
    ...data,
    appointments: [
      // Half-state A: recurring-labeled, no series.
      { id: 'HA', title: 'Lone', technician: 'T1', client: 'C1', startTime: '2026-06-01T09:00:00', endTime: '2026-06-01T10:00:00', isFixed: false, isBillable: true, type: 'client-session', isRecurring: true, recurringPattern: 'weekly' },
      // Half-state B: unlabeled biweekly-gapped series (heal must MEASURE).
      { id: 'HB1', title: 'S', technician: 'T1', client: 'C1', startTime: '2026-06-01T13:00:00', endTime: '2026-06-01T14:00:00', isFixed: false, isBillable: true, type: 'client-session', seriesId: 'S-HB' },
      { id: 'HB2', title: 'S', technician: 'T1', client: 'C1', startTime: '2026-06-15T13:00:00', endTime: '2026-06-15T14:00:00', isFixed: false, isBillable: true, type: 'client-session', seriesId: 'S-HB' },
      { id: 'HB3', title: 'S', technician: 'T1', client: 'C1', startTime: '2026-06-29T13:00:00', endTime: '2026-06-29T14:00:00', isFixed: false, isBillable: true, type: 'client-session', seriesId: 'S-HB' },
    ],
  };
  const imported = parseWorkbook(XLSX.read(generateExcelFile(halfStates), { type: 'buffer' })).data;
  const healed = migrateScheduleData(imported);
  const ha = healed.appointments.find(a => a.id === 'HA')!;
  check('imported lone-recurring row healed to one-time', !ha.isRecurring && ha.recurringPattern === undefined);
  const hb = healed.appointments.filter(a => a.seriesId === 'S-HB');
  check('imported unlabeled series healed with measured biweekly trio',
    hb.length === 3 && hb.every(a => a.isRecurring === true && a.recurringPattern === 'biweekly'),
    hb.map(a => `${a.isRecurring}/${a.recurringPattern}`).join(','));
}

console.log(`\n${failed === 0 ? 'ALL PASS' : 'FAILURES'} — ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
