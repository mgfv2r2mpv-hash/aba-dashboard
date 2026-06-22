/**
 * Verification for the cancel-statistics engine (consecutive runs + rolling-30
 * windows) and the streak milestone tiers.
 *
 * These are the BCBA-confirmed rules for "same participants in a row" and the
 * four independent 30-day cancel windows. Tune the fixtures here if the desired
 * semantics ever change.
 *
 * Run: npx tsx scripts/verify-cancel-stats.ts
 */
import { Appointment, CancellationSource } from '../src/types';
import { computeCancelContext } from '../src/cancelStats';
import { streakEmoji, isStreakMilestone } from '../src/sessionFlags';

let seq = 0;
function appt(
  date: string,
  status: 'completed' | 'canceled' | 'scheduled',
  overrides: Partial<Appointment> = {},
): Appointment {
  return {
    id: `ap${++seq}`,
    title: 'Session',
    startTime: `${date}T09:00:00`,
    endTime: `${date}T10:00:00`,
    isFixed: false,
    isBillable: true,
    type: 'client-session',
    status,
    ...overrides,
  };
}
const canceled = (
  date: string, source: CancellationSource, tech?: string, client?: string,
  overrides: Partial<Appointment> = {},
) => appt(date, 'canceled', { technician: tech, client, cancellation: { source, reason: 'other', unplanned: true }, ...overrides });
const completed = (date: string, tech?: string, client?: string, overrides: Partial<Appointment> = {}) =>
  appt(date, 'completed', { technician: tech, client, ...overrides });

let passed = 0, failed = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}

// ── Suite 1: BT direct consecutive (same tech + client), reset by completion ──
console.log('\ncalculation: bt direct — consecutive run keyed on tech + client');
{
  const apts = [
    canceled('2026-06-01', 'bt', 'T1', 'C1'), // run 1
    canceled('2026-06-08', 'bt', 'T1', 'C1'), // run 2
    completed('2026-06-15', 'T1', 'C1'),       // resets
    canceled('2026-06-22', 'bt', 'T1', 'C1'), // run 1 again
  ];
  const ctx = computeCancelContext(apts);
  check('2nd bt cancel: consecutiveForSource=2', ctx.get(apts[1].id)?.consecutiveForSource === 2, JSON.stringify(ctx.get(apts[1].id)));
  check('post-completion cancel: run resets to 1', ctx.get(apts[3].id)?.consecutiveForSource === 1, JSON.stringify(ctx.get(apts[3].id)));
}

// ── Suite 2: different client breaks the BT run ───────────────────────────────
console.log('\ncalculation: bt cancels for a different client are a separate run');
{
  const apts = [
    canceled('2026-06-01', 'bt', 'T1', 'C1'), // C1 run 1
    canceled('2026-06-02', 'bt', 'T1', 'C2'), // C2 run 1
    canceled('2026-06-08', 'bt', 'T1', 'C1'), // C1 run 2 (C2 cancel doesn't count)
  ];
  const ctx = computeCancelContext(apts);
  check('C1 second cancel: consecutive=2 despite C2 between', ctx.get(apts[2].id)?.consecutiveForSource === 2);
  check('C2 cancel: consecutive=1', ctx.get(apts[1].id)?.consecutiveForSource === 1);
}

// ── Suite 3: family groups by client; different source resets the family run ──
console.log('\ncalculation: family — consecutive keyed on client, source-specific');
{
  const apts = [
    canceled('2026-06-01', 'family', 'T1', 'C1'), // family run 1
    canceled('2026-06-08', 'bt', 'T1', 'C1'),     // breaks family run (different source)
    canceled('2026-06-15', 'family', 'T1', 'C1'), // family run 1 again
  ];
  const ctx = computeCancelContext(apts);
  check('family run resets after a bt cancel', ctx.get(apts[2].id)?.family.consecutive === 1, JSON.stringify(ctx.get(apts[2].id)?.family));
  check('the bt cancel itself: bt.withClientConsecutive=1', ctx.get(apts[1].id)?.bt.withClientConsecutive === 1);
}

// ── Suite 4: rolling-30 windows (per-case vs BT-all-clients) ──────────────────
console.log('\ncalculation: rolling-30 — per-case vs BT-across-all-clients');
{
  const apts = [
    canceled('2026-05-01', 'bt', 'T1', 'C1'), // >30 days before anchor → excluded
    canceled('2026-06-10', 'bt', 'T1', 'C1'), // in window
    canceled('2026-06-12', 'bt', 'T1', 'C2'), // in window, different client
    canceled('2026-06-20', 'bt', 'T1', 'C1'), // anchor
  ];
  const ctx = computeCancelContext(apts);
  const a = ctx.get(apts[3].id)!;
  check('per-bt-case rolling30 = 2 (C1 only, May excluded)', a.bt.perBtCaseRolling30 === 2, JSON.stringify(a.bt));
  check('bt-all-clients rolling30 = 3 (C1+C2, May excluded)', a.bt.btRolling30 === 3, JSON.stringify(a.bt));
}

// ── Suite 5: supervision grouping flips with source ───────────────────────────
console.log('\ncalculation: supervision — bt/bcba key on BT+client, family keys on client');
{
  const sup = (date: string, source: CancellationSource, tech?: string, client?: string) =>
    canceled(date, source, tech, client, { type: 'supervision' });
  const apts = [
    sup('2026-06-01', 'bcba', 'T1', 'C1'), // bcba run 1 (ct group)
    sup('2026-06-08', 'bcba', 'T2', 'C1'), // different BT → separate ct group → run 1
    sup('2026-06-15', 'bcba', 'T1', 'C1'), // back to T1 — C1+T1 group: prior T1 cancel + this = 2
  ];
  const ctx = computeCancelContext(apts);
  check('bcba supervision keys on BT+client (T2 between does not advance T1 run)', ctx.get(apts[2].id)?.bcba.consecutive === 2, JSON.stringify(ctx.get(apts[2].id)?.bcba));
}

// ── Suite 6: ghosts excluded ──────────────────────────────────────────────────
console.log('\ncalculation: ghost sessions never count');
{
  const apts = [
    canceled('2026-06-01', 'bt', 'T1', 'C1', { isGhost: true }),
    canceled('2026-06-08', 'bt', 'T1', 'C1'),
  ];
  const ctx = computeCancelContext(apts);
  check('ghost not in map', ctx.get(apts[0].id) === undefined);
  check('real cancel after a ghost: consecutive=1', ctx.get(apts[1].id)?.consecutiveForSource === 1);
}

// ── Suite 7: streak emoji tiers + milestones ──────────────────────────────────
console.log('\ncalculation: streak emoji tiers and milestone dots');
{
  check('streak 1 → no emoji', streakEmoji(1) === null);
  check('streak 3 → 🟢', streakEmoji(3) === '🟢');
  check('streak 5 → ⭐️', streakEmoji(5) === '⭐️');
  check('streak 12 → 🌟', streakEmoji(12) === '🌟');
  check('streak 18 → ✨', streakEmoji(18) === '✨');
  check('streak 25 → 🤩', streakEmoji(25) === '🤩');
  check('milestones at 2,5,10,15,20,25', [2, 5, 10, 15, 20, 25].every(isStreakMilestone));
  check('non-milestones 3,4,7,11,22 are false', [3, 4, 7, 11, 22].every(s => !isStreakMilestone(s)));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
