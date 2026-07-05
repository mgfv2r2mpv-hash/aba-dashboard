/**
 * Verification for the sAssI agentic command layer (Phase 1):
 *  - tool-use parse (parseToolTurn) of the new setFixed / complete / cancel ops
 *  - wishSolutionToDraft → a single `edit` DraftOp per command, applyOps patching
 *  - dropPastOps leaves the (start-less) command ops intact, even on a past session
 *  - cancel source/reason gating (applicableSources + activeCancellationCodes)
 *  - local pre-scrub entity resolution (alias / initials / ambiguity)
 * Run: npx tsx scripts/verify-command.ts
 */
import { ScheduleData, WishSolution, WishOp } from '../src/types';
import { parseToolTurn, wishSolutionToDraft, dropPastOps } from '../src/wish';
import { applyOps } from '../src/draft';
import { resolveClientReferences, buildAnonymizationMap, scrubText, containsEntityName } from '../src/anonymizer';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}

// Reverse map mirrors the anonymizer: APT_n → real appointment id.
const reverseMap: Record<string, string> = { APT_1: 'a1', APT_2: 'a2' };
const reverse = (t: string) => reverseMap[t];

const settings: any = { supervisionDirectHoursPercent: 5, supervisionRBTHoursPercent: 5, parentTraining: { minimumHours: 1, targetMinHours: 2, targetMaxHours: 4, periodUnit: 'month' } };

const base: ScheduleData = {
  id: 'd', version: 2,
  clients: [{ id: 'c1', name: 'Sam Brown', availabilityWindows: {} }],
  technicians: [{ id: 't1', name: 'Tech One', isRBT: true, assignments: [], availability: {} }],
  settings,
  appointments: [
    // a1 is in the PAST relative to the tests' NOW — the command ops must still apply.
    { id: 'a1', title: 'Session A', client: 'Sam Brown', technician: 'Tech One', startTime: '2026-06-19T13:00:00', endTime: '2026-06-19T15:00:00', isFixed: false, isBillable: true, type: 'client-session' },
    { id: 'a2', title: 'Supervision', client: 'Sam Brown', technician: 'Tech One', startTime: '2026-07-20T13:00:00', endTime: '2026-07-20T14:00:00', isFixed: false, isBillable: true, type: 'supervision' },
  ],
  lastModified: '2026-06-14T00:00:00.000Z',
};

console.log('parseToolTurn — command ops');
{
  const input = {
    reply: 'Locking A, completing it, and canceling supervision.',
    ops: [
      { op: 'setFixed', apt: 'APT_1', isFixed: true },
      { op: 'complete', apt: 'APT_1' },
      { op: 'cancel', apt: 'APT_2', source: 'bt', reason: 'sick', unplanned: true, noticeMet: false, notes: 'called out' },
    ],
  };
  const turn = parseToolTurn(input, reverse);
  check('reply passes through', turn.reply.startsWith('Locking'));
  check('three ops parsed', turn.ops.length === 3);
  check('setFixed → real appt id + boolean', turn.ops[0].op === 'setFixed' && (turn.ops[0] as any).appointmentId === 'a1' && (turn.ops[0] as any).isFixed === true);
  check('complete → real appt id', turn.ops[1].op === 'complete' && (turn.ops[1] as any).appointmentId === 'a1');
  check('cancel carries source/reason/unplanned/notes', turn.ops[2].op === 'cancel' && (turn.ops[2] as any).appointmentId === 'a2' && (turn.ops[2] as any).source === 'bt' && (turn.ops[2] as any).notes === 'called out');
}

console.log('parseToolTurn — defensive');
{
  const bad = parseToolTurn({ reply: '', ops: [
    { op: 'setFixed', apt: 'APT_1' },              // no isFixed boolean
    { op: 'cancel', apt: 'APT_1', source: 'nope', reason: 'sick', unplanned: true }, // bad source
    { op: 'complete', apt: 'APT_missing' },        // unknown token still reverses to itself (string) → kept
    { op: 'frobnicate', apt: 'APT_1' },            // unknown op
  ] }, reverse);
  check('setFixed without boolean dropped', !bad.ops.some(o => o.op === 'setFixed'));
  check('cancel with invalid source dropped', !bad.ops.some(o => o.op === 'cancel'));
  check('unknown op dropped', bad.ops.every(o => (o as any).op !== 'frobnicate'));
  check('cancel default unplanned = true', (() => {
    const t = parseToolTurn({ reply: '', ops: [{ op: 'cancel', apt: 'APT_1', source: 'bt', reason: 'sick' }] }, reverse);
    return t.ops[0]?.op === 'cancel' && (t.ops[0] as any).unplanned === true;
  })());
}

console.log('wishSolutionToDraft + applyOps — edit ops');
{
  const sol: WishSolution = { id: 's', summary: '', reasoning: '', ops: [
    { op: 'setFixed', appointmentId: 'a1', isFixed: true },
  ] };
  const { ops } = wishSolutionToDraft(sol, base);
  check('setFixed → one edit op with targetId=appt.id', ops.length === 1 && ops[0].kind === 'edit' && ops[0].targetId === 'a1' && ops[0].appt?.id === 'a1');
  const preview = applyOps(base, ops);
  check('applyOps locks a1 (isFixed true)', preview.appointments.find(a => a.id === 'a1')?.isFixed === true);
  check('applyOps does not mutate the base appointment', base.appointments.find(a => a.id === 'a1')?.isFixed === false);
}

console.log('complete → status completed');
{
  const { ops } = wishSolutionToDraft({ id: 's', summary: '', reasoning: '', ops: [{ op: 'complete', appointmentId: 'a1' }] }, base);
  const preview = applyOps(base, ops);
  check('a1 marked completed', preview.appointments.find(a => a.id === 'a1')?.status === 'completed');
}

console.log('cancel → status canceled + Cancellation gated');
{
  // BCBA is not a valid source for a client-session → coerced to a valid one (bt).
  // Unknown reason → coerced to the first active code (sick).
  const { ops } = wishSolutionToDraft({ id: 's', summary: '', reasoning: '', ops: [
    { op: 'cancel', appointmentId: 'a1', source: 'bcba', reason: 'not-a-code', unplanned: true, noticeMet: true, notes: 'n' },
  ] }, base);
  const a = applyOps(base, ops).appointments.find(x => x.id === 'a1');
  check('a1 marked canceled', a?.status === 'canceled');
  check('invalid BCBA source coerced off client-session', a?.cancellation?.source !== 'bcba' && a?.cancellation?.source === 'bt');
  check('unknown reason coerced to an active code', a?.cancellation?.reason === 'sick');
  check('cancellation stamps canceledAt + keeps notes', !!a?.cancellation?.canceledAt && a?.cancellation?.notes === 'n');
  // A valid non-BCBA source survives on the supervision (a2) appt.
  const sup = applyOps(base, wishSolutionToDraft({ id: 's', summary: '', reasoning: '', ops: [
    { op: 'cancel', appointmentId: 'a2', source: 'family', reason: 'holiday', unplanned: false },
  ] }, base).ops).appointments.find(x => x.id === 'a2');
  check('valid source/reason preserved', sup?.cancellation?.source === 'family' && sup?.cancellation?.reason === 'holiday');
}

console.log('dropPastOps — command ops survive on a past session');
{
  const ops: WishOp[] = [
    { op: 'setFixed', appointmentId: 'a1', isFixed: true },
    { op: 'complete', appointmentId: 'a1' },
    { op: 'cancel', appointmentId: 'a1', source: 'bt', reason: 'sick', unplanned: true },
    { op: 'move', appointmentId: 'a1', start: '2020-01-01T10:00:00', end: '2020-01-01T11:00:00' }, // past → dropped
  ];
  const kept = dropPastOps(ops, new Date('2026-07-05T00:00:00'));
  check('setFixed/complete/cancel all pass through', kept.filter(o => o.op === 'setFixed' || o.op === 'complete' || o.op === 'cancel').length === 3);
  check('a past move is still dropped', !kept.some(o => o.op === 'move'));
}

console.log('resolveClientReferences — local entity resolution');
{
  const roster: ScheduleData = { ...base, clients: [
    { id: 'c1', name: 'Sam Brown', availabilityWindows: {}, aliases: ['Sammy'] },
    { id: 'c2', name: 'Emma Watson', availabilityWindows: {} },
  ] };
  const r1 = resolveClientReferences('Add a parent training for SB next Thursday', roster);
  check('initials SB → full name', r1.text.includes('Sam Brown') && r1.ambiguities.length === 0);
  const r2 = resolveClientReferences('supervise Sammy this week', roster);
  check('alias Sammy → full name', r2.text.includes('Sam Brown'));
  const r3 = resolveClientReferences('who is EW', roster);
  check('initials EW → Emma Watson', r3.text.includes('Emma Watson'));
  const r4 = resolveClientReferences('book a meeting on Thursday', roster);
  check('unrelated text untouched', r4.text === 'book a meeting on Thursday' && r4.ambiguities.length === 0);
  const r5 = resolveClientReferences('add PT for sb', roster);
  check('lowercase sb is NOT treated as initials', r5.text === 'add PT for sb' && r5.ambiguities.length === 0);

  // Ambiguity: a second client whose initials also spell SB.
  const collide: ScheduleData = { ...base, clients: [
    { id: 'c1', name: 'Sam Brown', availabilityWindows: {} },
    { id: 'c3', name: 'Sarah Bell', availabilityWindows: {} },
  ] };
  const r6 = resolveClientReferences('cancel SB Thursday', collide);
  check('ambiguous SB → not rewritten', r6.text === 'cancel SB Thursday');
  check('ambiguous SB → two candidates reported', r6.ambiguities.length === 1 && r6.ambiguities[0].candidates.length === 2 && r6.ambiguities[0].ref === 'SB');
}

console.log('compound same-appointment ops accumulate (move + lock)');
{
  // move a1 to a new time AND lock it in one proposal — neither must clobber the other.
  const { ops } = wishSolutionToDraft({ id: 's', summary: '', reasoning: '', ops: [
    { op: 'move', appointmentId: 'a2', start: '2026-07-20T15:00:00', end: '2026-07-20T16:00:00' },
    { op: 'setFixed', appointmentId: 'a2', isFixed: true },
  ] }, base);
  const a = applyOps(base, ops).appointments.find(x => x.id === 'a2');
  check('moved time is preserved after the lock', a?.startTime === '2026-07-20T15:00:00');
  check('locked flag is preserved after the move', a?.isFixed === true);
}

console.log('complete clears a prior cancellation (working-map accumulation)');
{
  // cancel then complete the same appt in one proposal → completed, cancellation gone.
  const { ops } = wishSolutionToDraft({ id: 's', summary: '', reasoning: '', ops: [
    { op: 'cancel', appointmentId: 'a1', source: 'bt', reason: 'sick', unplanned: true },
    { op: 'complete', appointmentId: 'a1' },
  ] }, base);
  const a = applyOps(base, ops).appointments.find(x => x.id === 'a1');
  check('final status is completed', a?.status === 'completed');
  check('stale cancellation is cleared', a?.cancellation === undefined);
}

console.log('resolveClientReferences — initials stoplist (ABA terms)');
{
  const roster: ScheduleData = { ...base, clients: [
    { id: 'c1', name: 'Pat Thomas', availabilityWindows: {} }, // initials "PT"
  ] };
  const r = resolveClientReferences('add PT inside the Tuesday session', roster);
  check('domain term PT is NOT resolved to a client', r.text === 'add PT inside the Tuesday session' && r.ambiguities.length === 0);
  // But an explicit alias still wins over the stoplist.
  const aliased: ScheduleData = { ...base, clients: [
    { id: 'c1', name: 'Pat Thomas', availabilityWindows: {}, aliases: ['PT'] },
  ] };
  check('an explicit PT alias still resolves', resolveClientReferences('supervise PT', aliased).text.includes('Pat Thomas'));
}

console.log('scrub tokenizes bare name components + fail-closed guard');
{
  const roster: ScheduleData = { ...base, clients: [
    { id: 'c1', name: 'Ethan Carter', availabilityWindows: {} },
  ], technicians: [
    { id: 't1', name: 'Bailey Nguyen', isRBT: true, assignments: [], availability: {} },
  ] };
  const map = buildAnonymizationMap(roster);
  const scrubbed = scrubText('add supervision for Ethan with Bailey', roster, map);
  check('bare first name Ethan is tokenized', !/\bEthan\b/i.test(scrubbed) && /CLIENT_1/.test(scrubbed));
  check('bare tech first name Bailey is tokenized', !/\bBailey\b/i.test(scrubbed) && /TECH_1/.test(scrubbed));
  check('a short component "Sam" cannot corrupt "Samantha"', (() => {
    const r2: ScheduleData = { ...base, clients: [{ id: 'c1', name: 'Sam Brown', availabilityWindows: {} }] };
    return scrubText('meet Samantha', r2, buildAnonymizationMap(r2)) === 'meet Samantha';
  })());
  check('containsEntityName flags a bare name', containsEntityName('note about Ethan', roster) === true);
  check('containsEntityName passes once scrubbed', containsEntityName(scrubbed, roster) === false);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
