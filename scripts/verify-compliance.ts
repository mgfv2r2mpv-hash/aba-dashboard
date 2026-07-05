/**
 * Verification for the provider-attributed supervision model:
 * a supervision-counting session (supervision / parent-training / case-planning /
 * reassessment) credits supervision only when it NAMES a BT and overlaps that
 * BT's direct session; partial overlap credits partially; the wrong BT / no BT
 * credits 0. (Supervision itself needs no named BT — credit is by overlap.)
 * Run: npx tsx scripts/verify-compliance.ts
 */
import { ScheduleData, Appointment } from '../src/types';
import { computeClientCompliance, computeTechCompliance, monthPeriod } from '../src/compliance';
import { bucketOf } from '../src/utilization';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

let seq = 0;
function appt(p: Partial<Appointment> & { type: Appointment['type']; date: string; start: string; end: string }): Appointment {
  return {
    id: `a${++seq}`, title: p.type, technician: p.technician, client: p.client,
    startTime: `${p.date}T${p.start}:00`, endTime: `${p.date}T${p.end}:00`,
    isFixed: false, isBillable: p.isBillable !== false, type: p.type, status: p.status,
  };
}

const NOW = new Date(2026, 6, 1); // Jul 1 — all June sessions are "actual"
const period = monthPeriod(new Date(2026, 5, 15));

function data(appts: Appointment[]): ScheduleData {
  return {
    id: 'd', version: 2,
    clients: [{ id: 'C1', name: 'C1', availabilityWindows: {} }],
    technicians: [
      { id: 'T1', name: 'T1', isRBT: true, assignments: [], availability: {} },
      { id: 'T2', name: 'T2', isRBT: true, assignments: [], availability: {} },
    ],
    settings: { supervisionDirectHoursPercent: 10, supervisionRBTHoursPercent: 10, parentTraining: { minimumHours: 1, targetMinHours: 2, targetMaxHours: 4, periodUnit: 'month' } },
    appointments: appts,
    lastModified: NOW.toISOString(),
  };
}
const supHours = (d: ScheduleData, clientId: string) =>
  computeClientCompliance(d, period, NOW).find(c => c.client.id === clientId)!.projected.supervisionHours;
const techSup = (d: ScheduleData, techId: string) =>
  computeTechCompliance(d, period, NOW).find(t => t.tech.id === techId)!.projected.supervisionHours;

const direct = () => appt({ type: 'client-session', client: 'C1', technician: 'T1', date: '2026-06-15', start: '10:00', end: '12:00' }); // 2h

console.log('bucket classification');
{
  check('parent-training WITH a supervised BT is still BCBA, not BT direct',
    bucketOf(appt({ type: 'parent-training', client: 'C1', technician: 'T1', date: '2026-06-15', start: '10:00', end: '11:00' })) === 'bcba');
  check('client-session with a tech is BT direct', bucketOf(direct()) === 'bt');
}

console.log('supervision is inferred (no BT needed)');
{
  const d = data([direct(), appt({ type: 'supervision', client: 'C1', date: '2026-06-15', start: '10:30', end: '11:30' })]); // 1h within
  check('per-client credits the 1h overlap with the case direct', near(supHours(d, 'C1'), 1));
  check('per-tech T1 (doing that direct) is credited', near(techSup(d, 'T1'), 1));
  check('per-tech T2 (no direct) gets nothing', near(techSup(d, 'T2'), 0));
}

console.log('parent-training needs an explicit BT');
{
  const noBt = data([direct(), appt({ type: 'parent-training', client: 'C1', date: '2026-06-15', start: '10:30', end: '11:30' })]);
  check('parent-training without a BT counts 0', near(supHours(noBt, 'C1'), 0));

  // PT 11:00–12:30 overlaps the 10:00–12:00 direct by 1h; the 12:00–12:30 tail (BT gone) doesn't count.
  const partial = data([direct(), appt({ type: 'parent-training', client: 'C1', technician: 'T1', date: '2026-06-15', start: '11:00', end: '12:30' })]);
  check('parent-training (BT named) credits only the overlapping hour', near(supHours(partial, 'C1'), 1));

  // Names T2, but only T1 is in the direct → no credit.
  const wrong = data([direct(), appt({ type: 'parent-training', client: 'C1', technician: 'T2', date: '2026-06-15', start: '10:30', end: '11:30' })]);
  check('parent-training naming a BT not in the direct counts 0', near(supHours(wrong, 'C1'), 0));
}

console.log('reassessment counts when the BT is present (BCBA-confirmed — like parent-training)');
{
  // BT named + overlapping that BT's direct → the BT is assisting (e.g. data
  // collection while the BCBA runs an assessment tool) → credit the overlap.
  const withBt = data([direct(), appt({ type: 'reassessment', client: 'C1', technician: 'T1', date: '2026-06-15', start: '10:30', end: '11:30' })]);
  check('reassessment (BT named) overlapping the direct credits the overlapping hour', near(supHours(withBt, 'C1'), 1));

  // No BT named (BCBA-only reassessment) → not supervision credit.
  const noBt = data([direct(), appt({ type: 'reassessment', client: 'C1', date: '2026-06-15', start: '10:30', end: '11:30' })]);
  check('reassessment without a BT counts 0', near(supHours(noBt, 'C1'), 0));

  // Names T2, but only T1 is in the direct → no credit.
  const wrong = data([direct(), appt({ type: 'reassessment', client: 'C1', technician: 'T2', date: '2026-06-15', start: '10:30', end: '11:30' })]);
  check('reassessment naming a BT not in the direct counts 0', near(supHours(wrong, 'C1'), 0));
}

console.log('genuinely non-counting types');
{
  // internal-task / other never earn supervision credit even overlapping a direct.
  const it = data([direct(), appt({ type: 'internal-task', client: 'C1', technician: 'T1', date: '2026-06-15', start: '10:30', end: '11:30' })]);
  check('internal-task overlapping a direct counts 0', near(supHours(it, 'C1'), 0));
}

console.log('touching sessions (end == next start) do not overlap');
{
  const d = data([
    direct(), // 10:00–12:00
    appt({ type: 'supervision', client: 'C1', date: '2026-06-15', start: '12:00', end: '13:00' }), // starts exactly when direct ends
  ]);
  check('a supervision starting when the direct ends earns 0 (no overlap)', near(supHours(d, 'C1'), 0));
}

console.log(`\n${failed === 0 ? 'ALL PASS' : 'FAILURES'} — ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
