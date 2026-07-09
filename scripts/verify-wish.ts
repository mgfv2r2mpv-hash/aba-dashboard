/**
 * Verification for "Wish It" pure logic: JSON parsing (with de-anonymization)
 * and converting a chosen solution into draft ops + blackouts.
 * Run: npx tsx scripts/verify-wish.ts
 */
import { ScheduleData, WishSolution, WishOp } from '../src/types';
import { parseWishSolutions, parseOps, parseChatTurn, dropPastOps, dropDoubleBookedOps, wishSolutionToDraft, applyWishSolution, summarizeWish, computeSolutionImpact, computeOpsImpact } from '../src/wish';
import { monthPeriod } from '../src/compliance';
import { buildAnonymizationMap, deAnonymizeNarration, deAnonymizeText } from '../src/anonymizer';

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
  // The add path normalizes the op's client/tech ref to the entity's immutable id
  // (here 'Client One' → 'c1'), so the persisted appointment is always id-linked.
  check('add → add op with new id + billable derived + client normalized to id', d.ops.some(o => o.kind === 'add' && o.appt?.type === 'parent-training' && o.appt?.isBillable === true && o.appt?.client === 'c1'));
  check('blackout resolved name → entityId', d.blackouts.length === 1 && d.blackouts[0].entityId === 'c1' && d.blackouts[0].entityName === 'Client One');
  check('unknown appointment counted as unresolved', d.unresolved === 1);

  const applied = applyWishSolution(base, sol);
  check('applyWishSolution moves a1, removes a2, adds one, appends blackout',
    applied.appointments.find(a => a.id === 'a1')!.startTime === '2026-06-19T17:00:00'
    && !applied.appointments.some(a => a.id === 'a2')
    && applied.appointments.length === 2 // a1 (moved) + the new add; a2 removed
    && (applied.blackouts || []).length === 1);
}

console.log('parseOps (shared op parser)');
{
  const rev = (v: any) => { if (v === undefined || v === null || v === '') return undefined; const s = String(v); return reverseMap[s] ?? s; };
  const raw = [
    { op: 'move', apt: 'APT_1', start: '2026-06-19T17:00:00', end: '2026-06-19T18:00:00' },
    { op: 'add', title: 'Sup', type: 'supervision', client: 'CLIENT_1', tech: 'TECH_1', start: '2026-06-19T13:00:00', end: '2026-06-19T14:00:00' },
    { op: 'nonsense' },
    { op: 'move', apt: 'APT_1' /* missing times */ },
  ];
  const ops = parseOps(raw, rev);
  check('keeps valid move + add, drops junk/incomplete', ops.length === 2);
  check('reverses client + tech tokens on add', ops[1].op === 'add' && (ops[1] as any).client === 'Client One' && (ops[1] as any).technician === 'Tech One');
  check('non-array input → []', parseOps(undefined as any, rev).length === 0);
}

console.log('parseChatTurn');
{
  const proposal = JSON.stringify({
    reply: 'Added supervision inside Tech One’s Friday session.',
    ops: [{ op: 'add', type: 'supervision', client: 'CLIENT_1', tech: 'TECH_1', start: '2026-06-19T13:00:00', end: '2026-06-19T14:00:00' }],
  });
  const t1 = parseChatTurn(proposal, reverse);
  check('proposal: reply captured', t1.reply.startsWith('Added supervision'));
  check('proposal: ops parsed + de-anonymized', t1.ops.length === 1 && (t1.ops[0] as any).client === 'Client One');

  // An explanation turn returns empty ops — this is VALID, not a failure.
  const explain = JSON.stringify({ reply: 'I placed it there — it is the only slot inside a running direct session.', ops: [] });
  const t2 = parseChatTurn(explain, reverse);
  check('explanation: reply captured', t2.reply.includes('running direct'));
  check('explanation: empty ops is valid', Array.isArray(t2.ops) && t2.ops.length === 0);

  // Prose with no JSON envelope → treat the whole thing as the reply.
  const t3 = parseChatTurn('All your cases are already at their ideal supervision range.', reverse);
  check('prose without JSON → reply is the text, ops empty', t3.reply.startsWith('All your cases') && t3.ops.length === 0);

  // Fenced JSON is tolerated (mirrors parseWishSolutions).
  check('fenced chat JSON parsed', parseChatTurn('```json\n' + proposal + '\n```', reverse).ops.length === 1);
}

console.log('dropPastOps (real-world safety net)');
{
  const now = new Date('2026-07-05T12:00:00');
  const ops: WishOp[] = [
    { op: 'add', type: 'supervision', start: '2026-07-01T10:00:00', end: '2026-07-01T11:00:00' }, // past → drop
    { op: 'add', type: 'supervision', start: '2026-07-10T10:00:00', end: '2026-07-10T11:00:00' }, // future → keep
    { op: 'move', appointmentId: 'a1', start: '2026-07-02T09:00:00', end: '2026-07-02T10:00:00' }, // past → drop
    { op: 'move', appointmentId: 'a2', start: '2026-07-09T09:00:00', end: '2026-07-09T10:00:00' }, // future → keep
    { op: 'remove', appointmentId: 'a3' },                                                          // time-agnostic → keep
    { op: 'add', type: 'supervision', start: 'not-a-date', end: 'x' },                              // unparseable → drop
  ];
  const kept = dropPastOps(ops, now);
  check('past add dropped, future add kept', kept.filter(o => o.op === 'add').length === 1 && (kept.find(o => o.op === 'add') as any).start === '2026-07-10T10:00:00');
  check('past move dropped, future move kept', kept.filter(o => o.op === 'move').length === 1 && (kept.find(o => o.op === 'move') as any).appointmentId === 'a2');
  check('remove passes through', kept.some(o => o.op === 'remove'));
  check('unparseable start dropped', !kept.some(o => o.op === 'add' && (o as any).start === 'not-a-date'));
  check('total kept = 3', kept.length === 3);
}

console.log('dropDoubleBookedOps (single BCBA — one place at a time)');
{
  const data: ScheduleData = {
    id: 'db', version: 2,
    clients: [
      { id: 'c1', name: 'C One', availabilityWindows: {} },
      { id: 'c2', name: 'C Two', availabilityWindows: {} },
    ],
    technicians: [{ id: 't1', name: 'T One', isRBT: true, assignments: [], availability: {} }],
    settings: {} as ScheduleData['settings'],
    appointments: [
      // an existing committed supervision (a BCBA session) 10:00–11:00
      { id: 's0', title: 'Sup', client: 'C One', technician: 'T One', startTime: '2026-07-13T10:00:00', endTime: '2026-07-13T11:00:00', isFixed: false, isBillable: true, type: 'supervision' },
      // an existing committed DIRECT 13:00–15:00 (NOT BCBA-run — supervision may sit inside it)
      { id: 'd0', title: 'Direct', client: 'C Two', technician: 'T One', startTime: '2026-07-13T13:00:00', endTime: '2026-07-13T15:00:00', isFixed: false, isBillable: true, type: 'client-session' },
    ],
    lastModified: 'x',
  };

  // Exactly the device symptom: two overlapping supervisions on the single BCBA.
  const overlapPair: WishOp[] = [
    { op: 'add', type: 'supervision', client: 'C One', start: '2026-07-14T14:00:00', end: '2026-07-14T16:00:00' },
    { op: 'add', type: 'supervision', client: 'C Two', start: '2026-07-14T14:15:00', end: '2026-07-14T16:15:00' },
  ];
  check('two overlapping supervisions (diff clients) → one dropped', dropDoubleBookedOps(overlapPair, data).length === 1);

  const sameClient: WishOp[] = [
    { op: 'add', type: 'supervision', client: 'C One', start: '2026-07-14T14:00:00', end: '2026-07-14T15:00:00' },
    { op: 'add', type: 'supervision', client: 'C One', start: '2026-07-14T14:30:00', end: '2026-07-14T15:30:00' },
  ];
  check('same-client overlapping supervisions → one dropped', dropDoubleBookedOps(sameClient, data).length === 1);

  const insideDirect: WishOp[] = [
    { op: 'add', type: 'supervision', client: 'C Two', technician: 'T One', start: '2026-07-13T13:30:00', end: '2026-07-13T14:30:00' },
  ];
  check('supervision inside a client-session direct → kept', dropDoubleBookedOps(insideDirect, data).length === 1);

  const hitsCommitted: WishOp[] = [
    { op: 'add', type: 'supervision', client: 'C Two', start: '2026-07-13T10:30:00', end: '2026-07-13T11:30:00' },
  ];
  check('supervision overlapping an existing supervision → dropped', dropDoubleBookedOps(hitsCommitted, data).length === 0);

  const clear: WishOp[] = [
    { op: 'add', type: 'supervision', client: 'C One', start: '2026-07-15T09:00:00', end: '2026-07-15T10:00:00' },
  ];
  check('non-overlapping supervision → kept', dropDoubleBookedOps(clear, data).length === 1);

  // A move of s0 onto a slot that only overlaps its OWN old position is fine — the
  // moved session's old slot is excluded from the conflict context.
  const moveOntoSelf: WishOp[] = [
    { op: 'move', appointmentId: 's0', start: '2026-07-13T10:30:00', end: '2026-07-13T11:30:00' },
  ];
  check('move overlapping only its own old slot → kept', dropDoubleBookedOps(moveOntoSelf, data).length === 1);

  const direct: WishOp[] = [
    { op: 'add', type: 'client-session', client: 'C One', technician: 'T One', start: '2026-07-13T10:15:00', end: '2026-07-13T11:15:00' },
  ];
  check('non-BCBA (direct) op passes through', dropDoubleBookedOps(direct, data).length === 1);
}

console.log('deAnonymizeNarration (friendly appt labels; names restored)');
{
  const data: ScheduleData = {
    id: 'n', version: 2,
    clients: [{ id: 'c1', name: 'Julianna D', availabilityWindows: {} }],
    technicians: [{ id: 't1', name: 'Sam K', isRBT: true, assignments: [], availability: {} }],
    settings: {} as ScheduleData['settings'],
    appointments: [
      { id: 'apt-x', title: 'Direct', client: 'Julianna D', technician: 'Sam K', startTime: '2026-07-14T14:00:00', endTime: '2026-07-14T16:00:00', isFixed: false, isBillable: true, type: 'client-session' },
    ],
    lastModified: 'x',
  };
  const map = buildAnonymizationMap(data);
  const aptTok = map.appointments.get('apt-x')!;   // APT_1
  const cliTok = map.clients.get('c1')!;            // CLIENT_1
  const techTok = map.technicians.get('t1')!;       // TECH_1
  const out = deAnonymizeNarration(`place inside ${aptTok} (${cliTok}) with ${techTok}`, map, data);
  check('APT token → friendly label, never the raw id', !out.includes(aptTok) && !out.includes('apt-x') && out.includes('Jul 14'));
  check('client token → real name', out.includes('Julianna D'));
  check('tech token → real name', out.includes('Sam K'));
  // The op-field path (deAnonymizeText) still restores the raw id so move/cancel resolve.
  check('deAnonymizeText still restores the raw id', deAnonymizeText(`ref ${aptTok}`, map).includes('apt-x'));
}

console.log('setHint: parse → side-channel → apply (the taught-heuristic op)');
{
  // Parse: enum-validated, client token reversed, ≥1 field required.
  const rev = (v: any) => (v === 'CLIENT_1' ? 'Client Hint' : undefined);
  const parsed = parseOps([
    { op: 'setHint', client: 'CLIENT_1', supervisionStyle: 'split', preferredDaypart: 'midday' },
    { op: 'setHint', client: 'CLIENT_1', supervisionStyle: 'bogus' },          // no valid field → dropped
    { op: 'setHint', client: 'CLIENT_9', supervisionStyle: 'split' },          // unknown token → dropped
  ], rev as any);
  check('valid setHint parses with both enums', parsed.length === 1
    && parsed[0].op === 'setHint' && (parsed[0] as any).supervisionStyle === 'split' && (parsed[0] as any).preferredDaypart === 'midday');

  // Side-channel: wishSolutionToDraft emits hintChanges (not DraftOps).
  const base: ScheduleData = {
    id: 'h', version: 2,
    clients: [{ id: 'ch1', name: 'Client Hint', availabilityWindows: {} }],
    technicians: [], settings: {} as ScheduleData['settings'], appointments: [], lastModified: 'x',
  };
  const sol: WishSolution = { id: 'hs', summary: '', reasoning: '', ops: parsed };
  const draft = wishSolutionToDraft(sol, base);
  check('setHint yields no draft ops, one hintChange', draft.ops.length === 0 && draft.hintChanges.length === 1
    && draft.hintChanges[0].clientId === 'ch1' && draft.hintChanges[0].hints.supervisionStyle === 'split'
    && draft.hintChanges[0].hints.source === 'chat');

  // Both real-world guards pass it through untouched (no time, no location).
  check('dropPastOps passes setHint through', dropPastOps(parsed, new Date('2099-01-01')).length === 1);

  // Accept path: applyWishSolution merge-patches the client record.
  const applied = applyWishSolution(base, sol);
  check('applyWishSolution merges hints onto the client',
    applied.clients[0].schedulingHints?.supervisionStyle === 'split'
    && applied.clients[0].schedulingHints?.preferredDaypart === 'midday');
}

console.log('computeOpsImpact parity: raw DraftOps diff ≡ WishSolution diff');
{
  // The selective-undo preview computes impact from raw DraftOps; it must agree
  // with the WishSolution path when both describe the same change.
  const base: ScheduleData = {
    id: 'imp', version: 2,
    clients: [{ id: 'c1', name: 'Client Imp', availabilityWindows: {} }],
    technicians: [{ id: 't1', name: 'Tech Imp', isRBT: true, availability: {}, assignments: [{ clientId: 'c1', hoursPerWeek: 10, billable: true }] }],
    settings: {
      supervisionDirectHoursPercent: 5, supervisionRBTHoursPercent: 5,
      parentTraining: { minimumHours: 1, targetMinHours: 2, targetMaxHours: 4, periodUnit: 'month' },
    } as ScheduleData['settings'],
    appointments: [{
      id: 'd1', title: 'Direct', client: 'c1', technician: 't1', type: 'client-session',
      startTime: '2099-01-05T09:00:00', endTime: '2099-01-05T13:00:00', isFixed: false, isBillable: true, isRecurring: false, status: 'scheduled',
    }],
    lastModified: 'x',
  };
  const sol: WishSolution = {
    id: 's', summary: '', reasoning: '',
    ops: [{ op: 'add', type: 'supervision', client: 'Client Imp', technician: 'Tech Imp', start: '2099-01-05T10:00:00', end: '2099-01-05T11:00:00' }],
  };
  const period = monthPeriod(new Date('2099-01-10T00:00:00'));
  const viaSolution = computeSolutionImpact(base, sol, period);
  const { ops } = wishSolutionToDraft(sol, base);
  const viaOps = computeOpsImpact(base, ops, period);
  check('sessionsAdded agree', viaSolution.sessionsAdded === 1 && viaOps.sessionsAdded === 1);
  check('client impact deltas agree',
    viaSolution.clientImpacts.length === viaOps.clientImpacts.length
    && viaSolution.clientImpacts.every((c, i) =>
      Math.abs(c.deltaPct - viaOps.clientImpacts[i].deltaPct) < 1e-9
      && Math.abs(c.deltaSupHours - viaOps.clientImpacts[i].deltaSupHours) < 1e-9),
    JSON.stringify({ sol: viaSolution.clientImpacts, ops: viaOps.clientImpacts }));
  check('impact registers the supervision hour', viaOps.clientImpacts.some(c => c.deltaSupHours > 0.9));
}

console.log(`\n${failed === 0 ? 'ALL PASS' : 'FAILURES'} — ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
