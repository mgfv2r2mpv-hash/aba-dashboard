/**
 * Stress test for the per-case decision model + correction engine.
 * Run: npx tsx scripts/verify-casemodel.ts
 *
 * Mirrors the §2 stress test in the plan: builds a representative caseload and
 * asserts the model's diagnosis, slot search, shave-room, and QC behaviour.
 */
import { ScheduleData, Appointment, Client, CompanySettings, Technician } from '../src/types';
import { computeCaseState, computeBtState } from '../src/caseModel';
import { analyzeCorrections, findOpenSlots } from '../src/corrections';
import { qcSchedule } from '../src/qc';

// Wednesday, mid-month. June 2026: the 14th is a Sunday, so "this week" is 14–21.
const NOW = new Date(2026, 5, 17, 10, 0, 0);

let passed = 0, failed = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}

function iso(dateStr: string, hhmm: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  return new Date(y, m - 1, d, h, mi).toISOString();
}

let seq = 0;
function appt(p: Partial<Appointment> & { type: Appointment['type']; date: string; start: string; end: string }): Appointment {
  return {
    id: `a${++seq}`,
    title: p.type,
    technician: p.technician,
    client: p.client,
    startTime: iso(p.date, p.start),
    endTime: iso(p.date, p.end),
    isFixed: false,
    isBillable: true,
    type: p.type,
    status: p.status,
    cancellation: p.cancellation,
  };
}

const allDay = { Monday: [{ start: '08:00', end: '18:00' }], Tuesday: [{ start: '08:00', end: '18:00' }],
  Wednesday: [{ start: '08:00', end: '18:00' }], Thursday: [{ start: '08:00', end: '18:00' }],
  Friday: [{ start: '08:00', end: '18:00' }], Saturday: [{ start: '09:00', end: '15:00' }],
  Sunday: [{ start: '09:00', end: '15:00' }] } as any;

const settings: CompanySettings = {
  supervisionDirectHoursPercent: 10,
  supervisionRBTHoursPercent: 10,
  supervisionFloorPercent: 10,
  supervisionPreferredMinPercent: 15,
  supervisionPreferredMaxPercent: 20,
  supervisionMaxHoursPercent: 20,
  reportLeadWeeksBackOffice: 4,
  reportLeadWeeksClinicalDirector: 1,
  rbtMinContactsPerMonth: 2,
  parentTraining: { minimumHours: 1, targetMinHours: 4, targetMaxHours: 6, periodUnit: 'month' },
  clinicianAvailability: allDay,
};

function mkClient(id: string, extra: Partial<Client> = {}): Client {
  return { id, name: id, availabilityWindows: allDay, ...extra };
}

// ── Clients ────────────────────────────────────────────────────────────────
const somerville = mkClient('Somerville');                       // below-75 staffing
const floorCase = mkClient('FloorCase');                         // supervision floor gap
const eowCase = mkClient('EowCase', { cadenceGoal: 'EOW' });     // cadence pacing
const reassess = mkClient('ReassessCase');                       // reassessment pacing
const shaveCase = mkClient('ShaveCase');                         // well above floor (shave room)
const ptBound = mkClient('PtBoundCase', { parentAvailableOutsideSessions: false });

const techRBT: Technician = {
  id: 'rbt1', name: 'HannahRBT', isRBT: true,
  assignments: [{ clientId: 'Somerville', hoursPerWeek: 20, billable: true }],
  availability: allDay,
};

const appointments: Appointment[] = [];

// Somerville: authorized 20h/wk direct; only 11.5h scheduled THIS week → 57.5% (below 75).
appointments.push(appt({ type: 'client-session', client: 'Somerville', technician: 'rbt1', date: '2026-06-15', start: '09:00', end: '13:00' })); // 4h
appointments.push(appt({ type: 'client-session', client: 'Somerville', technician: 'rbt1', date: '2026-06-16', start: '09:00', end: '13:00' })); // 4h
appointments.push(appt({ type: 'client-session', client: 'Somerville', technician: 'rbt1', date: '2026-06-17', start: '09:00', end: '12:30' })); // 3.5h
// a BT-sourced cancellation this week → cause = bt-cancels
appointments.push(appt({ type: 'client-session', client: 'Somerville', technician: 'rbt1', date: '2026-06-18', start: '09:00', end: '13:00', status: 'canceled', cancellation: { source: 'bt', reason: 'sick', unplanned: true } }));

// FloorCase: 40h direct this month, only 2h supervision overlap → 5% (floor 10%).
for (const d of ['2026-06-02', '2026-06-04', '2026-06-09', '2026-06-11', '2026-06-16', '2026-06-18', '2026-06-23', '2026-06-25', '2026-06-29', '2026-06-30']) {
  appointments.push(appt({ type: 'client-session', client: 'FloorCase', technician: 'rbt1', date: d, start: '13:00', end: '17:00' })); // 4h each = 40h
}
appointments.push(appt({ type: 'supervision', client: 'FloorCase', date: '2026-06-16', start: '13:00', end: '15:00' })); // 2h overlap

// EowCase: directs + a single supervision contact this month (cadence EOW needs 2).
appointments.push(appt({ type: 'client-session', client: 'EowCase', technician: 'rbt1', date: '2026-06-15', start: '09:00', end: '14:00' }));
appointments.push(appt({ type: 'supervision', client: 'EowCase', date: '2026-06-15', start: '09:00', end: '11:00' }));

// ReassessCase: 8h reassessment block, none done. Auth ends 2026-07-15 so the
// internal initial-draft milestone (auth end minus the 4-week draft lead) lands
// on/just before NOW → behind pace.
appointments.push(appt({ type: 'client-session', client: 'ReassessCase', technician: 'rbt1', date: '2026-06-15', start: '09:00', end: '13:00' }));

// ShaveCase: 20h direct, well above the 10% floor → shave room > 0. A past
// supervision covers the actual roll; a FUTURE supervision is the one the
// shave-room offers (past sessions are never proposed for trimming).
for (const d of ['2026-06-08', '2026-06-15', '2026-06-22', '2026-06-29']) {
  appointments.push(appt({ type: 'client-session', client: 'ShaveCase', technician: 'rbt1', date: d, start: '09:00', end: '14:00' }));
}
appointments.push(appt({ type: 'supervision', client: 'ShaveCase', date: '2026-06-15', start: '09:00', end: '13:00' })); // 4h past (actual)
const shaveSup = appt({ type: 'supervision', client: 'ShaveCase', date: '2026-06-22', start: '09:00', end: '13:00' }); // 4h future (shaveable)
appointments.push(shaveSup);

// PtBoundCase: a direct session window on the 17th (parent present only then).
appointments.push(appt({ type: 'client-session', client: 'PtBoundCase', technician: 'rbt1', date: '2026-06-17', start: '10:00', end: '14:00' }));

const data: ScheduleData = {
  id: 'test', version: 1,
  clients: [somerville, floorCase, eowCase, reassess, shaveCase, ptBound],
  technicians: [techRBT],
  settings,
  appointments,
  authorizations: [
    { id: 'au1', clientId: 'Somerville', startDate: '2026-01-01', endDate: '2026-12-31', buckets: {}, weekly: { direct: 20, supervision: 4, parentTraining: 1, casePlanning: 1 } },
    { id: 'au2', clientId: 'FloorCase', startDate: '2026-01-01', endDate: '2026-12-31', buckets: {}, weekly: { direct: 20 } },
    { id: 'au3', clientId: 'EowCase', startDate: '2026-01-01', endDate: '2026-12-31', buckets: {}, weekly: { direct: 10 } },
    { id: 'au4', clientId: 'ReassessCase', startDate: '2026-01-01', endDate: '2026-07-15', buckets: { reassessment: 8 }, weekly: { direct: 15 } },
    { id: 'au5', clientId: 'ShaveCase', startDate: '2026-01-01', endDate: '2026-12-31', buckets: {}, weekly: { direct: 20 } },
    { id: 'au6', clientId: 'PtBoundCase', startDate: '2026-01-01', endDate: '2026-12-31', buckets: {}, weekly: { direct: 15, parentTraining: 1 } },
  ],
  manualUsage: [],
  lastModified: NOW.toISOString(),
};

console.log('\n[1] Per-case state');
const somervilleState = computeCaseState(data, somerville, NOW);
check('Somerville direct below 75% of authorized weekly', somervilleState.direct.below75,
  `actual=${somervilleState.direct.actualThisWk} auth=${somervilleState.direct.authPerWk}`);
check('Somerville actual this week = 11.5h', Math.abs(somervilleState.direct.actualThisWk - 11.5) < 0.01,
  `got ${somervilleState.direct.actualThisWk}`);

const floorState = computeCaseState(data, floorCase, NOW);
check('FloorCase supervision below floor (gapToFloor > 0)', floorState.supervision.gapToFloor > 0.01,
  `pct=${floorState.supervision.pct.toFixed(1)} gap=${floorState.supervision.gapToFloor}`);

const shaveState = computeCaseState(data, shaveCase, NOW);
check('ShaveCase has slack above floor', shaveState.supervision.slackAboveFloor > 0.01,
  `slack=${shaveState.supervision.slackAboveFloor}`);

console.log('\n[2] Correction diagnosis (priority + hard/soft)');
const report = analyzeCorrections(data, NOW);
const find = (kind: string, subject: string) => report.needs.find(n => n.kind === kind && n.subject === subject);

const floorNeed = find('supervision-floor', 'FloorCase');
check('FloorCase → supervision-floor need, P1, hard', !!floorNeed && floorNeed.priority === 1 && floorNeed.hard === true);

const staffNeed = find('staffing-75', 'Somerville');
check('Somerville → staffing-75 need, soft', !!staffNeed && staffNeed.hard === false);
check('Somerville staffing need flagged bt-cancels with weekend note',
  !!staffNeed && staffNeed.cause === 'bt-cancels' && !!staffNeed.note);

const cadenceNeed = find('cadence', 'EowCase');
check('EowCase → cadence need (EOW pacing), soft', !!cadenceNeed && cadenceNeed.hard === false);

const reassessNeed = find('reassessment-pace', 'ReassessCase');
check('ReassessCase → reassessment-pace need, P2', !!reassessNeed && reassessNeed.priority === 2);

check('needs sorted hard P1 before soft P3', report.needs.length >= 2 &&
  report.needs[0].priority <= report.needs[report.needs.length - 1].priority);

console.log('\n[3] Shave-room map');
const shaveEntry = report.shaveRoom.find(s => s.appointmentId === shaveSup.id);
check('ShaveCase supervision session has shave room > 0', !!shaveEntry && shaveEntry.shaveMinutes > 0,
  `mins=${shaveEntry?.shaveMinutes}`);
const floorSup = report.shaveRoom.find(s => s.clientId === 'FloorCase');
// FloorCase's only supervision is in the past (not offered for shaving) and the
// case is at/below floor anyway — either way there is no room to trim.
check('FloorCase supervision has no shave room (at/below floor)', !floorSup || floorSup.shaveMinutes === 0);

console.log('\n[4] Slot search — hard constraints');
const weekdaySlots = findOpenSlots(data, { durationMinutes: 60, clientId: 'Somerville', techId: 'rbt1', fromDate: NOW });
check('weekday slot search returns options', weekdaySlots.length > 0);
check('no weekend slots when weekendsOk=false', weekdaySlots.every(s => s.day !== 'Saturday' && s.day !== 'Sunday'));

const weekendSlots = findOpenSlots(data, { durationMinutes: 60, clientId: 'Somerville', techId: 'rbt1', fromDate: NOW, weekendsOk: true });
check('weekend slots appear only when weekendsOk=true (BT-cancel make-up)',
  weekendSlots.some(s => s.day === 'Saturday' || s.day === 'Sunday'));

const acrossBoundary = findOpenSlots(data, { durationMinutes: 60, clientId: 'Somerville', techId: 'rbt1', fromDate: NOW, throughDate: '2026-07-20' });
check('slot search never crosses the month boundary (hard)', acrossBoundary.every(s => s.date <= '2026-06-30'),
  acrossBoundary.map(s => s.date).join(','));

const ptSlots = findOpenSlots(data, { durationMinutes: 60, clientId: 'PtBoundCase', fromDate: NOW, useClinicianAvailability: true, mustOverlapDirect: true });
check('PT (parent-not-outside) slots all overlap a direct session (17th, 10:00–14:00)',
  ptSlots.length > 0 && ptSlots.every(s => s.date === '2026-06-17' && s.start >= '10:00' && s.end <= '14:00'),
  ptSlots.map(s => `${s.date} ${s.start}-${s.end}`).join(','));

console.log('\n[5] Per-BT state');
const btState = computeBtState(data, techRBT, NOW);
check('RBT direct hours rolled up across cases', btState.directHoursMonth > 0);
check('RBT contacts-required = 2 (BACB)', btState.contactsRequired === 2);

console.log('\n[6] QC harness');
// Proposed: add an in-window supervision for FloorCase overlapping a direct → cures floor, no hard violations.
const cure: Appointment = appt({ type: 'supervision', client: 'FloorCase', date: '2026-06-23', start: '13:00', end: '16:00' });
const goodProposed: ScheduleData = { ...data, appointments: [...data.appointments, cure] };
const goodQc = qcSchedule(goodProposed, data, NOW);
check('QC: valid in-window supervision make-up passes', goodQc.pass, JSON.stringify(goodQc.hardViolations.map(v => v.message)));
check('QC: residual floor need cleared by the cure', !goodQc.residuals.some(r => r.includes('FloorCase')));

// Proposed: push Somerville direct over the authorized 20h/wk → over-auth warning (unbillable).
const over: Appointment = appt({ type: 'client-session', client: 'Somerville', technician: 'rbt1', date: '2026-06-19', start: '09:00', end: '19:00' }); // +10h → 21.5h
const badProposed: ScheduleData = { ...data, appointments: [...data.appointments, over] };
const badQc = qcSchedule(badProposed, data, NOW);
check('QC: over-authorized weekly direct fails (new soft violation)', !badQc.pass,
  `newSoft=${badQc.newSoftViolations.length}`);

console.log(`\n${failed === 0 ? 'ALL PASS' : 'FAILURES'} — ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
