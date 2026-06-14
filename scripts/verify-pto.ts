/**
 * Verification for PTO accrual & balances (Upgrade 2, Phase 1).
 * Run: npx tsx scripts/verify-pto.ts
 */
import { PtoConfig, TimeOff, Appointment } from '../src/types';
import { computePtoBalances, accruedForRule, activeBuckets, canonicalBucket, resolvePtoConfig, convertedBcbaHours } from '../src/pto';

// A completed (or scheduled) BCBA billable session — no technician = BCBA lens.
let aseq = 0;
function bcbaAppt(date: string, hours: number, status: 'completed' | 'scheduled'): Appointment {
  const end = new Date(`${date}T10:00:00`); end.setHours(10 + hours);
  return {
    id: `ap${++aseq}`, title: 'PT', startTime: `${date}T10:00:00`, endTime: `${date}T${String(10 + hours).padStart(2, '0')}:00:00`,
    isFixed: false, isBillable: true, type: 'parent-training', status,
  };
}

let passed = 0, failed = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const find = (bs: ReturnType<typeof computePtoBalances>, bucket: string) => bs.find(b => b.bucket === bucket)!;

console.log('config resolution + buckets');
{
  const def = resolvePtoConfig(undefined);
  check('default is unlimited / combined', def.mode === 'unlimited' && def.buckets === 'combined');
  check('combined active buckets', JSON.stringify(activeBuckets({ mode: 'unlimited', buckets: 'combined' })) === JSON.stringify(['combined']));
  check('separate + unpaid active buckets', JSON.stringify(activeBuckets({ mode: 'accrual', buckets: 'separate', unpaidEnabled: true })) === JSON.stringify(['vacation', 'sick', 'unpaid']));
  check('canonical: vacation entry in combined folds to combined', canonicalBucket('vacation', { mode: 'unlimited', buckets: 'combined' }) === 'combined');
  check('canonical: unpaid disabled folds to paid', canonicalBucket('unpaid', { mode: 'unlimited', buckets: 'combined' }) === 'combined');
}

console.log('semimonthly accrual');
{
  // 4h on the 1st and 15th. From opening asOf 2026-01-01 (exclusive) to 2026-03-01:
  // events at 1/15, 2/1, 2/15, 3/1 = 4 events × 4h = 16h. (1/1 excluded as <= since.)
  const rule = { id: 'r', kind: 'semimonthly' as const, bucket: 'vacation' as const, hours: 4 };
  const since = new Date(2026, 0, 1);
  const asOf = new Date(2026, 2, 1);
  check('semimonthly count in (since, asOf]', near(accruedForRule(rule, since, asOf), 16), String(accruedForRule(rule, since, asOf)));
  check('no history (since=null) only counts this month-to-date', accruedForRule(rule, null, new Date(2026, 0, 10)) === 4); // just the 1st
}

console.log('everyNWeeks accrual');
{
  // 2h every 2 weeks on Friday from anchor 2026-01-02 (a Friday). Fridays: 1/2,
  // 1/16, 1/30, 2/13, 2/27 ... up to 2026-03-01 → 5 events × 2h = 10h.
  const rule = { id: 'r', kind: 'everyNWeeks' as const, bucket: 'sick' as const, hours: 2, everyWeeks: 2, weekday: 'Friday' as const, anchor: '2026-01-02' };
  const got = accruedForRule(rule, null, new Date(2026, 2, 1));
  check('everyNWeeks Friday biweekly count', near(got, 10), String(got));
  check('disabled rule accrues 0', accruedForRule({ ...rule, enabled: false }, null, new Date(2026, 2, 1)) === 0);
}

console.log('per-converted (hours-based) accrual');
{
  const rule = { id: 'r', kind: 'perConvertedHours' as const, bucket: 'vacation' as const, hours: 1, perHours: 30 };
  check('perConvertedHours: floor(converted/per) * hours', accruedForRule(rule, null, new Date(2026, 2, 1), 65) === 2);
  check('perConvertedHours: 0 converted → 0', accruedForRule(rule, null, new Date(2026, 2, 1), 0) === 0);

  const bonus = { id: 'b', kind: 'perConvertedBonus' as const, bucket: 'vacation' as const, hours: 1, perHours: 30, bonusHours: 5, bonusPerExtraHours: 60 };
  check('perConvertedBonus: base + bonus once threshold cleared', accruedForRule(bonus, null, new Date(2026, 2, 1), 65) === 7); // floor(65/30)=2 + 5
  check('perConvertedBonus: base only below threshold', accruedForRule(bonus, null, new Date(2026, 2, 1), 50) === 1); // floor(50/30)=1, 50<60
}

console.log('convertedBcbaHours + balances react to completion/reopen');
{
  const since = new Date(2026, 0, 1);
  const asOf = new Date(2026, 2, 1);
  const completed = [bcbaAppt('2026-01-10', 2, 'completed'), bcbaAppt('2026-01-20', 2, 'completed')]; // 4h converted
  check('converted = completed billable BCBA hours', convertedBcbaHours(completed, since, asOf) === 4);
  // One reopened (scheduled) → only 2h converted.
  const oneReopened = [completed[0], bcbaAppt('2026-01-20', 2, 'scheduled')];
  check('reopening a session lowers converted hours', convertedBcbaHours(oneReopened, since, asOf) === 2);

  const cfg: PtoConfig = {
    mode: 'accrual', buckets: 'combined',
    accruals: [{ id: 'r', kind: 'perConvertedHours', bucket: 'combined', hours: 1, perHours: 2 }],
    openingBalances: [{ bucket: 'combined', hours: 0, asOf: '2026-01-01' }],
  };
  const full = computePtoBalances(cfg, [], completed, asOf)[0];
  check('4 converted / 2 per → 2 accrued', full.accrued === 2 && full.remaining === 2);
  const after = computePtoBalances(cfg, [], oneReopened, asOf)[0];
  check('after reopen: 2 converted / 2 per → 1 accrued', after.accrued === 1 && after.remaining === 1);
}

console.log('balances: unlimited mode tracks used only');
{
  const cfg: PtoConfig = { mode: 'unlimited', buckets: 'combined' };
  const off: TimeOff[] = [
    { id: '1', date: '2026-02-02', hours: 8, bucket: 'vacation' }, // folds to combined
    { id: '2', date: '2026-02-03', hours: 4 },                     // untagged → combined
    { id: '3', date: '2030-01-01', hours: 8 },                     // future, excluded
  ];
  const bs = computePtoBalances(cfg, off, [], new Date(2026, 5, 1));
  const c = find(bs, 'combined');
  check('used sums past entries only', c.used === 12, String(c.used));
  check('unlimited has no remaining', c.remaining === undefined && c.accrued === undefined);
}

console.log('balances: accrual mode = opening + accrued − used');
{
  const cfg: PtoConfig = {
    mode: 'accrual', buckets: 'separate', unpaidEnabled: false,
    accruals: [{ id: 'r', kind: 'semimonthly', bucket: 'vacation', hours: 4 }],
    openingBalances: [{ bucket: 'vacation', hours: 10, asOf: '2026-01-01' }],
  };
  const off: TimeOff[] = [{ id: '1', date: '2026-02-10', hours: 6, bucket: 'vacation' }];
  const bs = computePtoBalances(cfg, off, [], new Date(2026, 2, 1)); // asOf Mar 1
  const v = find(bs, 'vacation');
  // accrued = 16 (1/15,2/1,2/15,3/1), used = 6, opening = 10 → remaining 20.
  check('vacation accrued', near(v.accrued!, 16), String(v.accrued));
  check('vacation used', v.used === 6);
  check('vacation remaining = 10 + 16 − 6', near(v.remaining!, 20), String(v.remaining));
  const sick = find(bs, 'sick');
  check('sick bucket present with 0s', sick.used === 0 && near(sick.remaining!, 0));
}

console.log(`\n${failed === 0 ? 'ALL PASS' : 'FAILURES'} — ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
