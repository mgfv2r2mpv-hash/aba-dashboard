/** Round-trip check for the new auth/client/settings fields. Run: npx tsx scripts/verify-excel.ts */
import * as XLSX from 'xlsx';
import { ScheduleData } from '../src/types';
import { generateExcelFile, parseWorkbook } from '../src/excelHandler';

let passed = 0, failed = 0;
const check = (n: string, c: boolean, e?: string) => { c ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${e ? ` — ${e}` : ''}`)); };

const data: ScheduleData = {
  id: 'rt', version: 1,
  clients: [{
    id: 'C1', name: 'C1', availabilityWindows: {},
    cadenceGoal: 'EOW', isEI: true, eiDate: '2026-09-01',
    partialStaffAllowed: false, parentAvailableOutsideSessions: true,
    anticipatedDischarge: 'EI transition ~age 3',
  }],
  technicians: [],
  settings: {
    supervisionDirectHoursPercent: 10, supervisionRBTHoursPercent: 10,
    supervisionFloorPercent: 10, supervisionPreferredMinPercent: 15, supervisionPreferredMaxPercent: 20,
    reportLeadWeeksBackOffice: 4, reportLeadWeeksClinicalDirector: 1,
    parentTraining: { minimumHours: 1, targetMinHours: 4, targetMaxHours: 6, periodUnit: 'month' },
  },
  appointments: [],
  authorizations: [{
    id: 'AU1', clientId: 'C1', startDate: '2026-01-01', endDate: '2026-08-31',
    buckets: { reassessment: 8 },
    weekly: { direct: 20, supervision: 4, parentTraining: 1, casePlanning: 1 },
    reportFinalDue: '2026-07-06', reportDraftDue: '2026-06-29',
  }],
  manualUsage: [],
  lastModified: new Date().toISOString(),
};

const buf = generateExcelFile(data);
const wb = XLSX.read(buf, { type: 'buffer' });
const { data: rt } = parseWorkbook(wb);

const c = rt.clients[0];
check('client.cadenceGoal preserved', c.cadenceGoal === 'EOW');
check('client.isEI preserved', c.isEI === true);
check('client.eiDate preserved', c.eiDate === '2026-09-01');
check('client.partialStaffAllowed=false preserved', c.partialStaffAllowed === false);
check('client.parentAvailableOutsideSessions preserved', c.parentAvailableOutsideSessions === true);
check('client.anticipatedDischarge preserved', c.anticipatedDischarge === 'EI transition ~age 3');

const a = rt.authorizations![0];
check('auth.weekly.direct preserved', a.weekly?.direct === 20);
check('auth.weekly.supervision preserved', a.weekly?.supervision === 4);
check('auth.weekly.casePlanning preserved', a.weekly?.casePlanning === 1);
check('auth.buckets.reassessment preserved', a.buckets.reassessment === 8);
check('auth.reportFinalDue preserved', a.reportFinalDue === '2026-07-06');
check('auth.reportDraftDue preserved', a.reportDraftDue === '2026-06-29');

const st = rt.settings;
check('settings.supervisionFloorPercent preserved', st.supervisionFloorPercent === 10);
check('settings.supervisionPreferredMaxPercent preserved', st.supervisionPreferredMaxPercent === 20);
check('settings.reportLeadWeeksBackOffice preserved', st.reportLeadWeeksBackOffice === 4);
check('settings.reportLeadWeeksClinicalDirector preserved', st.reportLeadWeeksClinicalDirector === 1);

console.log(`\n${failed === 0 ? 'ALL PASS' : 'FAILURES'} — ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
