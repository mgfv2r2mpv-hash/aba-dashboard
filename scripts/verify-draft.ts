/**
 * Verification for the draft sandbox: ghost exclusion + solveDraft grading.
 * Run: npx tsx scripts/verify-draft.ts
 */
import { ScheduleData, Appointment, CompanySettings } from '../src/types';
import { computeOneClientCompliance, monthPeriod } from '../src/compliance';
import { ConstraintValidator } from '../src/constraintValidator';
import { rollupHours } from '../src/utilization';
import { findOpenSlots } from '../src/corrections';
import { solveDraft } from '../src/draftSolver';
import { applyOps, newAddOp, newRemoveOp } from '../src/draft';

const NOW = new Date(2026, 5, 15, 8, 0, 0); // Mon Jun 15 2026; week = Sun 14–Sat 20

let passed = 0, failed = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}

const localIso = (date: string, hhmm: string) => `${date}T${hhmm}:00`;
const weekday = { Monday: [{ start: '08:00', end: '18:00' }], Tuesday: [{ start: '08:00', end: '18:00' }],
  Wednesday: [{ start: '08:00', end: '18:00' }], Thursday: [{ start: '08:00', end: '18:00' }],
  Friday: [{ start: '08:00', end: '18:00' }] } as any;

let seq = 0;
function appt(p: Partial<Appointment> & { type: Appointment['type']; date: string; start: string; end: string }): Appointment {
  return {
    id: `a${++seq}`, title: p.title || p.type,
    technician: p.technician, client: p.client,
    startTime: localIso(p.date, p.start), endTime: localIso(p.date, p.end),
    isFixed: !!p.isFixed, isBillable: p.isBillable !== false, type: p.type,
    status: p.status, isGhost: p.isGhost,
  };
}

const baseSettings: CompanySettings = {
  supervisionDirectHoursPercent: 10,
  supervisionRBTHoursPercent: 10,
  parentTraining: { minimumHours: 1, targetMinHours: 2, targetMaxHours: 4, periodUnit: 'month' },
  clinicianAvailability: weekday,
};

function makeData(appts: Appointment[], util?: CompanySettings['utilization']): ScheduleData {
  return {
    id: 'd', version: 1,
    clients: [{ id: 'C1', name: 'C1', availabilityWindows: weekday }],
    technicians: [{ id: 'T1', name: 'T1', isRBT: true, assignments: [{ clientId: 'C1', hoursPerWeek: 10, billable: true }], availability: weekday }],
    settings: { ...baseSettings, utilization: util },
    appointments: appts,
    lastModified: NOW.toISOString(),
  };
}

// ---------------------------------------------------------------------------
console.log('Ghost exclusion');
{
  const direct = appt({ type: 'client-session', client: 'C1', technician: 'T1', date: '2026-06-17', start: '10:00', end: '12:00' });
  const withReal = makeData([direct]);
  const withGhost = makeData([{ ...direct, isGhost: true }]);
  const without = makeData([]);
  const period = monthPeriod(NOW);

  // Use projected scope (the session is future-dated relative to NOW).
  const realC = computeOneClientCompliance(withReal, withReal.clients[0], period, NOW);
  const ghostC = computeOneClientCompliance(withGhost, withGhost.clients[0], period, NOW);
  check('ghost contributes 0 direct hours (vs 2h real)', realC.projected.directHours === 2 && ghostC.projected.directHours === 0,
    `real=${realC.projected.directHours} ghost=${ghostC.projected.directHours}`);

  const wkStart = new Date(2026, 5, 14).getTime();
  const realBt = rollupHours(withReal.appointments, wkStart, wkStart + 7 * 86400000, 'bt');
  const ghostBt = rollupHours(withGhost.appointments, wkStart, wkStart + 7 * 86400000, 'bt');
  check('ghost excluded from utilization rollup', realBt.scheduled === 2 && ghostBt.scheduled === 0);

  const ghostConflicts = new ConstraintValidator(withGhost, NOW).validateSchedule();
  const withoutConflicts = new ConstraintValidator(without, NOW).validateSchedule();
  check('ghost yields same conflicts as absent', ghostConflicts.length === withoutConflicts.length);

  // A ghost must not block a slot search at its time. Constrain availability to
  // exactly the ghost's window so the ghost's slot is the ONLY candidate: with
  // the ghost ignored it's offered; a REAL session there would block it.
  const wedOnly = { Wednesday: [{ start: '10:00', end: '12:00' }] } as any;
  const narrow = (a: Appointment[]) => ({ ...makeData(a), clients: [{ id: 'C1', name: 'C1', availabilityWindows: wedOnly }], technicians: [{ id: 'T1', name: 'T1', isRBT: true, assignments: [], availability: wedOnly }] } as ScheduleData);
  const q = { durationMinutes: 120, clientId: 'C1', techId: 'T1', fromDate: NOW, weekendsOk: false } as const;
  const ghostSlots = findOpenSlots(narrow([{ ...direct, availabilityWindows: undefined } as any]), q, 20);
  const realSlots = findOpenSlots(narrow([direct]), q, 20);
  const ghostOffers = findOpenSlots(narrow([{ ...direct, isGhost: true }]), q, 20).some(s => s.date === '2026-06-17' && s.start === '10:00');
  check('ghost does not block its slot in findOpenSlots', ghostOffers && realSlots.every(s => !(s.date === '2026-06-17' && s.start === '10:00')),
    `ghostOffers=${ghostOffers} realSlots=${realSlots.length}`);
  void ghostSlots;
}

// ---------------------------------------------------------------------------
console.log('solveDraft grading');
{
  // GREEN: a clean BT add that fits, no BCBA billable impact.
  const green = makeData([]);
  const add = appt({ type: 'client-session', client: 'C1', technician: 'T1', date: '2026-06-17', start: '10:00', end: '12:00' });
  const sGreen = solveDraft(green, [newAddOp(add)], NOW, green.settings);
  check('clean add → green', sGreen.grade === 'green', `${sGreen.grade}/${sGreen.label}`);
  check('green carries a committable arrangement', !!sGreen.resolved);

  // RED: removing the only BCBA session drops billable below the floor.
  const bcbaSession = appt({ type: 'parent-training', client: 'C1', date: '2026-06-18', start: '10:00', end: '12:00' });
  const red = makeData([bcbaSession], { bcbaWeeklyBillableHours: 5, bcbaWeeklyBillableMin: 1.5 });
  const sRed = solveDraft(red, [newRemoveOp(bcbaSession.id)], NOW, red.settings);
  check('remove BCBA session below floor → red', sRed.grade === 'red' && sRed.label === 'billable below minimum', `${sRed.grade}/${sRed.label}`);
  check('red is AI-eligible', sRed.aiEligible);

  // PTO polish (Upgrade 1): the same removal on a week with enough BCBA leave to
  // zero out the floor is NOT red — leave lowers the requirement (2h PTO × 1.0 ≥
  // the 1.5h floor → reduced floor 0).
  const ptoCovered: ScheduleData = {
    ...makeData([bcbaSession], { bcbaWeeklyBillableHours: 5, bcbaWeeklyBillableMin: 1.5 }),
    timeOff: [{ id: 'pto1', date: '2026-06-16', hours: 2 }],
  };
  const sPto = solveDraft(ptoCovered, [newRemoveOp(bcbaSession.id)], NOW, ptoCovered.settings);
  check('remove BCBA session on a PTO-covered week → not red', sPto.grade !== 'red', `${sPto.grade}/${sPto.label}`);

  // YELLOW: adding a BCBA session pushes above target (no conflicts).
  const yellow = makeData([], { bcbaWeeklyBillableHours: 1, bcbaWeeklyBillableMin: 0 });
  const ptAdd = appt({ type: 'parent-training', client: 'C1', date: '2026-06-18', start: '10:00', end: '12:00' });
  const sYellow = solveDraft(yellow, [newAddOp(ptAdd)], NOW, yellow.settings);
  check('add above billable target → yellow (above hours)', sYellow.grade === 'yellow' && sYellow.label.includes('above hours'), `${sYellow.grade}/${sYellow.label}`);

  // Accepting the green arrangement introduces no scheduling (availability /
  // double-book) conflicts. Supervision-shortfall warnings are expected and are
  // a separate compliance axis, not what the badge grades.
  const committed = applyOps(green, [newAddOp(add)]);
  const sched = new ConstraintValidator(committed, NOW).validateSchedule().filter(c => c.type === 'availability-conflict');
  check('accepted green arrangement has no availability conflicts', sched.length === 0, `${sched.length}`);
}

// ---------------------------------------------------------------------------
// Historical (before-now) appointments: graded purely on hard timeslot conflicts
// (two billable activities can't share a slot); forward-looking floors/targets
// don't apply, so a clean past add is green and auto-commits in the app.
console.log('past-only drafts');
{
  const PAST = '2026-06-12'; // Fri, before NOW (Mon Jun 15)
  const existing = appt({ type: 'client-session', client: 'C1', technician: 'T1', date: PAST, start: '10:00', end: '12:00' });

  const noOverlap = appt({ type: 'client-session', client: 'C1', technician: 'T1', date: PAST, start: '13:00', end: '14:00' });
  let s = solveDraft(makeData([existing]), [newAddOp(noOverlap)], NOW, baseSettings);
  check('past add, no overlap → green', s.grade === 'green' && !!s.resolved, `${s.grade}/${s.label}`);

  // Force the floor that would red a future draft, to prove past adds ignore it.
  const lowFloor = { bcbaWeeklyBillableHours: 99, bcbaWeeklyBillableMin: 40 };
  s = solveDraft(makeData([existing], lowFloor), [newAddOp(noOverlap)], NOW, { ...baseSettings, utilization: lowFloor });
  check('past add ignores billable floor/target', s.grade === 'green', `${s.grade}/${s.label}`);

  const bothBillable = appt({ type: 'client-session', client: 'C1', technician: 'T1', date: PAST, start: '11:00', end: '13:00', isBillable: true });
  s = solveDraft(makeData([existing]), [newAddOp(bothBillable)], NOW, baseSettings);
  check('past add, two billable overlap → red (blocked)', s.grade === 'red' && s.label.includes('two billable'), `${s.grade}/${s.label}`);
  check('blocked past overlap is not AI-eligible', !s.aiEligible);

  const nonBillableOverlap = appt({ type: 'internal-task', technician: 'T1', date: PAST, start: '11:00', end: '13:00', isBillable: false });
  s = solveDraft(makeData([existing]), [newAddOp(nonBillableOverlap)], NOW, baseSettings);
  check('past add, billable+nonbillable overlap → green (allowed)', s.grade === 'green', `${s.grade}/${s.label}`);

  // BCBA concurrent care: a no-tech billable session (coordination-of-care /
  // parent-training / supervision) overlapping a BT direct session is legitimate —
  // the BCBA bills alongside the direct — so it must NOT be a double-book.
  for (const t of ['case-planning', 'parent-training', 'supervision'] as const) {
    const bcbaConcurrent = appt({ type: t, client: 'C1', date: PAST, start: '11:00', end: '13:00', isBillable: true });
    const r = solveDraft(makeData([existing]), [newAddOp(bcbaConcurrent)], NOW, baseSettings);
    check(`past add, BCBA ${t} overlapping a direct → green (concurrent care)`, r.grade === 'green', `${r.grade}/${r.label}`);
  }

  // But two BCBA (no-tech) billable sessions at once is still the BCBA double-booked.
  const bcbaA = appt({ type: 'case-planning', client: 'C1', date: PAST, start: '14:00', end: '15:00', isBillable: true });
  const bcbaB = appt({ type: 'parent-training', client: 'C1', date: PAST, start: '14:30', end: '15:30', isBillable: true });
  s = solveDraft(makeData([bcbaA]), [newAddOp(bcbaB)], NOW, baseSettings);
  check('past add, two BCBA billable overlap → red (BCBA double-booked)', s.grade === 'red' && s.label.includes('two billable'), `${s.grade}/${s.label}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
