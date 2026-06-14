/**
 * Verification for "Wish It" pure logic: JSON parsing (with de-anonymization)
 * and converting a chosen solution into draft ops + blackouts.
 * Run: npx tsx scripts/verify-wish.ts
 */
import { ScheduleData, WishSolution } from '../src/types';
import { parseWishSolutions, wishSolutionToDraft, applyWishSolution, summarizeWish } from '../src/wish';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}

// Reverse map mirrors anonymizer: APT_n → real id, CLIENT_n/TECH_n → real name.
const reverseMap: Record<string, string> = {
  APT_1: 'a1', APT_2: 'a2', CLIENT_1: 'Client One', TECH_1: 'Tech One',
};
const reverse = (t: string) => reverseMap[t];

const base: ScheduleData = {
  id: 'd', version: 2,
  clients: [{ id: 'c1', name: 'Client One', availabilityWindows: {} }],
  technicians: [{ id: 't1', name: 'Tech One', isRBT: true, assignments: [], availability: {} }],
  settings: { supervisionDirectHoursPercent: 5, supervisionRBTHoursPercent: 5, parentTraining: { minimumHours: 1, targetMinHours: 2, targetMaxHours: 4, periodUnit: 'month' } },
  appointments: [
    { id: 'a1', title: 'PT', client: 'Client One', startTime: '2026-06-19T10:00:00', endTime: '2026-06-19T11:00:00', isFixed: false, isBillable: true, type: 'parent-training' },
    { id: 'a2', title: 'Session', client: 'Client One', technician: 'Tech One', startTime: '2026-06-19T13:00:00', endTime: '2026-06-19T15:00:00', isFixed: false, isBillable: true, type: 'client-session' },
  ],
  lastModified: '2026-06-14T00:00:00.000Z',
};

console.log('summarizeWish');
{
  check('vacation summary mentions the range', summarizeWish({ kind: 'vacation', dateStart: '2026-07-06', dateEnd: '2026-07-10' }).includes('2026-07-06'));
  check('freeform falls back to the note', summarizeWish({ kind: 'freeform', note: 'do the thing' }) === 'do the thing');
}

console.log('parseWishSolutions');
{
  const reply = JSON.stringify({ solutions: [{
    summary: 'Move PT to Friday evening',
    reasoning: 'Frees the morning.',
    ops: [
      { op: 'move', apt: 'APT_1', start: '2026-06-19T17:00:00', end: '2026-06-19T18:00:00' },
      { op: 'remove', apt: 'APT_2' },
      { op: 'add', title: 'Eval', type: 'reassessment', client: 'CLIENT_1', start: '2026-06-26T09:00:00', end: '2026-06-26T11:00:00', recurring: true, pattern: 'biweekly' },
      { op: 'blackout', entityType: 'client', entity: 'CLIENT_1', date: '2026-07-04', reason: 'holiday' },
    ],
  }] });
  const sols = parseWishSolutions(reply, reverse);
  check('one solution parsed', sols.length === 1);
  const ops = sols[0].ops;
  check('move de-anonymized to real appt id', ops[0].op === 'move' && (ops[0] as any).appointmentId === 'a1');
  check('add client token → real name; pattern kept', ops[2].op === 'add' && (ops[2] as any).client === 'Client One' && (ops[2] as any).pattern === 'biweekly');
  check('blackout entity token → real name', ops[3].op === 'blackout' && (ops[3] as any).entity === 'Client One');
}

console.log('parse is defensive');
{
  const fenced = '```json\n' + JSON.stringify({ solutions: [{ summary: 's', ops: [{ op: 'move', apt: 'APT_1', start: 'x', end: 'y' }] }] }) + '\n```';
  check('parses fenced JSON', parseWishSolutions(fenced, reverse).length === 1);
  check('prose preface is tolerated', parseWishSolutions('Sure! Here you go: ' + JSON.stringify({ solutions: [{ summary: 's', ops: [{ op: 'remove', apt: 'APT_1' }] }] }), reverse).length === 1);
  check('garbage → no solutions', parseWishSolutions('not json at all', reverse).length === 0);
  const badOps = JSON.stringify({ solutions: [{ summary: 's', ops: [{ op: 'move', apt: 'APT_1' /* no times */ }, { op: 'frobnicate' }] }] });
  check('malformed ops dropped → solution with no ops is dropped', parseWishSolutions(badOps, reverse).length === 0);
  const four = JSON.stringify({ solutions: [1, 2, 3, 4].map(n => ({ summary: `s${n}`, ops: [{ op: 'remove', apt: 'APT_1' }] })) });
  check('caps at 3 solutions', parseWishSolutions(four, reverse).length === 3);
}

console.log('wishSolutionToDraft');
{
  const sol: WishSolution = {
    id: 'w', summary: 's', reasoning: '',
    ops: [
      { op: 'move', appointmentId: 'a1', start: '2026-06-19T17:00:00', end: '2026-06-19T18:00:00' },
      { op: 'remove', appointmentId: 'a2' },
      { op: 'add', type: 'parent-training', client: 'Client One', start: '2026-06-26T10:00:00', end: '2026-06-26T11:00:00' },
      { op: 'blackout', entityType: 'client', entity: 'Client One', date: '2026-07-04' },
      { op: 'remove', appointmentId: 'ghost-id' }, // unresolved
    ],
  };
  const d = wishSolutionToDraft(sol, base);
  check('move → move op carrying preserved fields', d.ops.some(o => o.kind === 'move' && o.appt?.id === 'a1' && o.appt?.startTime === '2026-06-19T17:00:00'));
  check('remove → remove op', d.ops.some(o => o.kind === 'remove' && o.targetId === 'a2'));
  check('add → add op with new id + billable derived', d.ops.some(o => o.kind === 'add' && o.appt?.type === 'parent-training' && o.appt?.isBillable === true && o.appt?.client === 'Client One'));
  check('blackout resolved name → entityId', d.blackouts.length === 1 && d.blackouts[0].entityId === 'c1' && d.blackouts[0].entityName === 'Client One');
  check('unknown appointment counted as unresolved', d.unresolved === 1);

  const applied = applyWishSolution(base, sol);
  check('applyWishSolution moves a1, removes a2, adds one, appends blackout',
    applied.appointments.find(a => a.id === 'a1')!.startTime === '2026-06-19T17:00:00'
    && !applied.appointments.some(a => a.id === 'a2')
    && applied.appointments.length === 2 // a1 (moved) + the new add; a2 removed
    && (applied.blackouts || []).length === 1);
}

console.log(`\n${failed === 0 ? 'ALL PASS' : 'FAILURES'} — ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
