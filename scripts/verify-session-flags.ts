/**
 * Verification for session flag engine — cancel escalation, streak, 2-week star,
 * makeup markers, and holiday flagging.
 *
 * Run: npx tsx scripts/verify-session-flags.ts
 */
import { Appointment, CompanyHoliday } from '../src/types';
import { computeSessionFlags } from '../src/sessionFlags';

// ── Fixture helpers ──────────────────────────────────────────────────────────

let seq = 0;
const pad = (n: number) => String(n).padStart(2, '0');

function appt(
  date: string,
  status: 'completed' | 'canceled' | 'scheduled',
  overrides: Partial<Appointment> = {},
): Appointment {
  const id = `ap${++seq}`;
  return {
    id,
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

function canceled(
  date: string,
  source: 'family' | 'bt' | 'bcba' | 'admin',
  techId?: string,
  clientId?: string,
): Appointment {
  return appt(date, 'canceled', {
    technician: techId,
    client: clientId,
    cancellation: { source, reason: 'other', unplanned: true },
  });
}

function completed(date: string, techId?: string, clientId?: string): Appointment {
  return appt(date, 'completed', { technician: techId, client: clientId });
}

// ── Test harness ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, extra?: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

// ── Suite 1: Cancel escalation = consecutive run (family → client) ───────────
// Escalation now tracks the CONSECUTIVE-cancel run for the participants + source
// (see cancelStats.ts), not a calendar-month count.

console.log('\ncalculation: cancel escalation — family consecutive run (by client)');
{
  const apts: Appointment[] = [
    canceled('2026-06-02', 'family', 'T1', 'C1'),   // run 1
    canceled('2026-06-09', 'family', 'T1', 'C1'),   // run 2
    canceled('2026-06-16', 'family', 'T1', 'C1'),   // run 3
  ];
  const flags = computeSessionFlags(apts, []);

  check('1st family cancel: escalation=1, source=family',
    flags.get(apts[0].id)?.cancelEscalation === 1 && flags.get(apts[0].id)?.cancelSource === 'family',
    JSON.stringify(flags.get(apts[0].id)));
  check('2nd family cancel: escalation=2', flags.get(apts[1].id)?.cancelEscalation === 2);
  check('3rd family cancel: escalation=3', flags.get(apts[2].id)?.cancelEscalation === 3);
}

// ── Suite 2: bt consecutive keyed on tech + client, capped at 5 ──────────────

console.log('\ncalculation: cancel escalation — bt consecutive (by tech + client)');
{
  const apts: Appointment[] = [
    canceled('2026-06-02', 'bt', 'T2', 'C2'),   // C2 run 1
    canceled('2026-06-09', 'bt', 'T2', 'C2'),   // C2 run 2
    canceled('2026-06-16', 'bt', 'T2', 'C3'),   // C3 run 1 (different client — separate run)
    canceled('2026-06-23', 'bt', 'T2', 'C2'),   // C2 run 3
    canceled('2026-06-24', 'bt', 'T2', 'C2'),   // C2 run 4
    canceled('2026-06-25', 'bt', 'T2', 'C2'),   // C2 run 5
    canceled('2026-06-26', 'bt', 'T2', 'C2'),   // C2 run 6 → escalation capped at 5
  ];
  const flags = computeSessionFlags(apts, []);

  check('different client is a separate run (C3 escalation=1)',
    flags.get(apts[2].id)?.cancelEscalation === 1);
  check('C2 4th cancel: escalation=4, source=bt',
    flags.get(apts[4].id)?.cancelEscalation === 4 && flags.get(apts[4].id)?.cancelSource === 'bt');
  check('C2 5th cancel: escalation=5', flags.get(apts[5].id)?.cancelEscalation === 5);
  check('C2 6th cancel: capped at 5 (raw consecutive=6)',
    flags.get(apts[6].id)?.cancelEscalation === 5 && flags.get(apts[6].id)?.cancelConsecutive === 6);
}

// ── Suite 3: bcba/admin now DO escalate (consecutive) ────────────────────────

console.log('\ncalculation: cancel escalation — bcba/admin consecutive runs');
{
  const apts: Appointment[] = [
    canceled('2026-06-02', 'bcba', 'T3', 'C4'),
    canceled('2026-06-09', 'admin', 'T3', 'C4'),
  ];
  const flags = computeSessionFlags(apts, []);

  // bcba on a direct session keys on tech+client; admin keys on client.
  check('bcba cancel: escalation=1, source=bcba',
    flags.get(apts[0].id)?.cancelEscalation === 1 && flags.get(apts[0].id)?.cancelSource === 'bcba');
  check('admin cancel: escalation=1, source=admin',
    flags.get(apts[1].id)?.cancelEscalation === 1 && flags.get(apts[1].id)?.cancelSource === 'admin');
}

// ── Suite 4: a non-matching occurrence breaks the run (no month reset) ───────

console.log('\ncalculation: cancel escalation — broken by a completion, not by month');
{
  const apts: Appointment[] = [
    canceled('2026-05-30', 'family', 'T4', 'C5'),   // run 1
    canceled('2026-05-31', 'family', 'T4', 'C5'),   // run 2
    canceled('2026-06-01', 'family', 'T4', 'C5'),   // run 3 (continues across the month)
  ];
  const flags = computeSessionFlags(apts, []);

  check('2nd consecutive family cancel: escalation=2', flags.get(apts[1].id)?.cancelEscalation === 2);
  check('cancel across a month boundary keeps the run: escalation=3', flags.get(apts[2].id)?.cancelEscalation === 3);
}

// ── Suite 5: Completed streak per tech ───────────────────────────────────────

console.log('\ncalculation: completed streak per tech');
{
  const apts: Appointment[] = [
    completed('2026-06-02', 'T5'),   // streak 1
    completed('2026-06-03', 'T5'),   // streak 2
    completed('2026-06-04', 'T5'),   // streak 3
    canceled('2026-06-05', 'bt', 'T5', 'C6'),   // reset
    completed('2026-06-06', 'T5'),   // streak 1 again
  ];
  const flags = computeSessionFlags(apts, []);

  check('1st completed: streak=1', flags.get(apts[0].id)?.completedStreak === 1);
  check('2nd completed: streak=2', flags.get(apts[1].id)?.completedStreak === 2);
  check('3rd completed: streak=3', flags.get(apts[2].id)?.completedStreak === 3);
  check('canceled session: no completedStreak',
    flags.get(apts[3].id)?.completedStreak === undefined);
  check('1st completed after cancel: streak resets to 1',
    flags.get(apts[4].id)?.completedStreak === 1);
}

// ── Suite 6: Streak is per-tech (independent counters) ───────────────────────

console.log('\ncalculation: streak is independent per tech');
{
  const apts: Appointment[] = [
    completed('2026-06-02', 'T6A'),   // T6A streak 1
    completed('2026-06-02', 'T6B'),   // T6B streak 1
    completed('2026-06-03', 'T6A'),   // T6A streak 2
    canceled('2026-06-03', 'bt', 'T6B', 'C7'),  // T6B reset
    completed('2026-06-04', 'T6A'),   // T6A streak 3
    completed('2026-06-04', 'T6B'),   // T6B streak 1
  ];
  const flags = computeSessionFlags(apts, []);

  check('T6A unaffected by T6B cancel: streak=3',
    flags.get(apts[4].id)?.completedStreak === 3);
  check('T6B streak reset to 1 after cancel',
    flags.get(apts[5].id)?.completedStreak === 1);
}

// ── Suite 7: 2-week clean star ────────────────────────────────────────────────

console.log('\ncalculation: 2-week clean star (per tech)');
{
  // Window 1: 2026-06-01 → 2026-06-14. All completed → star earned.
  // Window 2: 2026-06-15 → 2026-06-28. All completed → 2nd star.
  const apts: Appointment[] = [
    completed('2026-06-01', 'T7'),
    completed('2026-06-07', 'T7'),
    completed('2026-06-14', 'T7'),  // end of window 1 (clean) — star earned
    completed('2026-06-15', 'T7'),
    completed('2026-06-28', 'T7'),  // end of window 2 (clean) — 2nd star
    completed('2026-06-29', 'T7'),  // window 3 starts; star level visible = 2
  ];
  const flags = computeSessionFlags(apts, []);

  const starAtEnd1 = flags.get(apts[2].id)?.streakStarLevel;
  const starAtWindow2 = flags.get(apts[4].id)?.streakStarLevel;
  const starAfter2 = flags.get(apts[5].id)?.streakStarLevel;

  check('end of 1st clean window: streakStarLevel >= 1',
    (starAtEnd1 ?? 0) >= 1, String(starAtEnd1));
  check('end of 2nd clean window: streakStarLevel >= 2',
    (starAtWindow2 ?? 0) >= 2, String(starAtWindow2));
  check('session after 2nd window: still sees 2 stars',
    (starAfter2 ?? 0) >= 2, String(starAfter2));
}

// ── Suite 8: 2-week star — dirty window earns no star ────────────────────────

console.log('\ncalculation: 2-week star — dirty window earns no star');
{
  const apts: Appointment[] = [
    completed('2026-07-01', 'T8'),
    canceled('2026-07-10', 'bt', 'T8', 'C8'),  // cancels window 1 → no star
    completed('2026-07-14', 'T8'),
    completed('2026-07-15', 'T8'),  // window 2 starts
    completed('2026-07-28', 'T8'),  // end window 2 (clean) → 1 star
    completed('2026-07-29', 'T8'),
  ];
  const flags = computeSessionFlags(apts, []);

  check('end of dirty window 1: no star',
    (flags.get(apts[2].id)?.streakStarLevel ?? 0) === 0);
  check('end of clean window 2: 1 star',
    (flags.get(apts[4].id)?.streakStarLevel ?? 0) >= 1,
    String(flags.get(apts[4].id)?.streakStarLevel));
}

// ── Suite 9: Makeup marker ────────────────────────────────────────────────────

console.log('\ncalculation: makeup session flags');
{
  const originalId = `ap${seq + 1}`;
  const original = appt('2026-06-01', 'canceled', {
    technician: 'T9', client: 'C9',
    cancellation: { source: 'family', reason: 'other', unplanned: true },
  });
  seq++; // appt() already incremented; but we set id manually → re-sync
  original.id = originalId;

  const makeupApt = appt('2026-06-08', 'completed', {
    technician: 'T9', client: 'C9',
    isMakeUp: true,
    makeupForId: originalId,
  });

  const flags = computeSessionFlags([original, makeupApt], []);
  const mf = flags.get(makeupApt.id);

  check('makeup session: isMakeup=true', mf?.isMakeup === true, JSON.stringify(mf));
  check('makeup session: makeupDates includes original date',
    mf?.makeupDates?.includes('2026-06-01') === true, JSON.stringify(mf?.makeupDates));
  check('original (non-makeup) session: no isMakeup flag',
    flags.get(original.id)?.isMakeup !== true);
}

// ── Suite 10: Makeup without makeupForId ─────────────────────────────────────

console.log('\ncalculation: makeup without makeupForId (general makeup)');
{
  const generalMakeup = appt('2026-06-10', 'completed', {
    technician: 'T10', client: 'C10',
    isMakeUp: true,
    // no makeupForId
  });
  const flags = computeSessionFlags([generalMakeup], []);
  const mf = flags.get(generalMakeup.id);

  check('general makeup: isMakeup=true', mf?.isMakeup === true);
  check('general makeup: makeupDates absent (no target to resolve)',
    mf?.makeupDates === undefined || mf.makeupDates.length === 0);
}

// ── Suite 11: Holiday flag ────────────────────────────────────────────────────

console.log('\ncalculation: holiday flag');
{
  const holidays: CompanyHoliday[] = [
    { id: 'h1', date: '2026-07-04', name: 'Independence Day' },
    { id: 'h2', date: '2026-11-26', name: 'Thanksgiving' },
  ];
  const apts: Appointment[] = [
    completed('2026-07-04', 'T11', 'C11'),   // on holiday
    completed('2026-07-05', 'T11', 'C11'),   // not a holiday
  ];
  const flags = computeSessionFlags(apts, holidays);

  const hf = flags.get(apts[0].id);
  const nf = flags.get(apts[1].id);

  check('session on holiday: isHoliday=true', hf?.isHoliday === true, JSON.stringify(hf));
  check('session on holiday: holidayName set', hf?.holidayName === 'Independence Day', hf?.holidayName);
  check('session not on holiday: isHoliday not set', nf?.isHoliday !== true);
}

// ── Suite 12: Ghost sessions are ignored ─────────────────────────────────────

console.log('\ncalculation: ghost sessions excluded');
{
  const ghost = appt('2026-06-02', 'canceled', {
    technician: 'T12', client: 'C12',
    isGhost: true,
    cancellation: { source: 'family', reason: 'other', unplanned: true },
  });
  const real = completed('2026-06-02', 'T12', 'C12');
  const flags = computeSessionFlags([ghost, real], []);

  check('ghost session produces no flags', !flags.has(ghost.id));
  check('real session still produces flags', flags.has(real.id));
}

// ── Suite 13: Flags combined on a single session ─────────────────────────────

console.log('\ncalculation: multiple flags combined on one session');
{
  const holidays: CompanyHoliday[] = [
    { id: 'h3', date: '2026-09-07', name: 'Labor Day' },
  ];
  // A makeup session that also falls on a holiday.
  const originalApt = appt('2026-09-01', 'canceled', {
    technician: 'T13', client: 'C13',
    cancellation: { source: 'family', reason: 'other', unplanned: true },
  });
  const combo = appt('2026-09-07', 'completed', {
    technician: 'T13', client: 'C13',
    isMakeUp: true,
    makeupForId: originalApt.id,
  });
  const flags = computeSessionFlags([originalApt, combo], holidays);
  const cf = flags.get(combo.id);

  check('combined: isHoliday=true', cf?.isHoliday === true);
  check('combined: isMakeup=true', cf?.isMakeup === true);
  check('combined: makeupDates resolved', cf?.makeupDates?.includes('2026-09-01') === true);
}

// ── Suite 14: Client (family) cancel does NOT break tech streak ───────────────

console.log('\ncalculation: family cancel does not reset tech streak');
{
  const apts: Appointment[] = [
    completed('2026-08-01', 'T14', 'C14'),   // streak 1
    completed('2026-08-04', 'T14', 'C14'),   // streak 2
    canceled('2026-08-06', 'family', 'T14', 'C14'),  // client cancel — streak must NOT reset
    completed('2026-08-08', 'T14', 'C14'),   // should be streak 3, not 1
  ];
  const flags = computeSessionFlags(apts, []);

  check('family cancel: completed before still has streak=2',
    flags.get(apts[1].id)?.completedStreak === 2);
  check('family cancel: no streak on the canceled session itself',
    flags.get(apts[2].id)?.completedStreak === undefined);
  check('family cancel: completed after continues streak (=3, not 1)',
    flags.get(apts[3].id)?.completedStreak === 3);
}

// ── Suite 15: Family cancel does NOT dirty 2-week star window ────────────────

console.log('\ncalculation: family cancel does not dirty 2-week star window');
{
  const apts: Appointment[] = [
    completed('2026-08-01', 'T15', 'C15'),
    canceled('2026-08-07', 'family', 'T15', 'C15'),  // family cancel — should NOT dirty window
    completed('2026-08-14', 'T15', 'C15'),  // end of window 1 (still clean) → star earned
    completed('2026-08-15', 'T15', 'C15'),  // window 2; should see 1 star
  ];
  const flags = computeSessionFlags(apts, []);

  check('family cancel in window: window still earns a star',
    (flags.get(apts[3].id)?.streakStarLevel ?? 0) >= 1,
    String(flags.get(apts[3].id)?.streakStarLevel));
}

// ── Result ───────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
