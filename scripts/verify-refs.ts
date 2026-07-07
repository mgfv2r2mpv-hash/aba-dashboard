/**
 * Verification for immutable-ID entity linking: resolveRefToId's heal logic and the
 * v2→v3 migration that normalizes stored name refs to ids (and preserves the ones it
 * can't heal). Run: npx tsx scripts/verify-refs.ts
 */
import { ScheduleData, Appointment } from '../src/types';
import { resolveRefToId } from '../src/entityRefs';
import { migrateScheduleData, collectUnresolvedRefs, CURRENT_SCHEMA_VERSION } from '../src/scheduleMigrations';

let passed = 0, failed = 0;
function check(name: string, cond: boolean, extra?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}

const techs = [{ id: 't1', name: 'Toniel T' }, { id: 't2', name: 'Sam K' }];

console.log('resolveRefToId — heal precedence');
{
  check('exact id resolves to itself', resolveRefToId('t1', techs).id === 't1');
  check('exact name resolves to id', resolveRefToId('Toniel T', techs).id === 't1');
  check('stale name → unique prefix heal ("Toniel" → Toniel T)', resolveRefToId('Toniel', techs).id === 't1');
  check('another unique prefix ("Sam" → Sam K)', resolveRefToId('Sam', techs).id === 't2');
  const ghost = resolveRefToId('Ghost', techs);
  check('unmatched → no id, not ambiguous', !ghost.id && !ghost.ambiguous);
  check('empty ref → no id', !resolveRefToId('', techs).id);

  // Ambiguous: "Sam" prefixes both "Sam K" and "Samantha" → do NOT auto-heal.
  const amb = resolveRefToId('Sam', [{ id: 'a', name: 'Sam K' }, { id: 'b', name: 'Samantha' }]);
  check('ambiguous prefix → flagged, no id', amb.ambiguous === true && !amb.id);

  // Duplicate exact names → ambiguous.
  const dup = resolveRefToId('Dup', [{ id: 'x', name: 'Dup' }, { id: 'y', name: 'Dup' }]);
  check('duplicate exact names → ambiguous', dup.ambiguous === true && !dup.id);
}

console.log('v2→v3 migration — normalize refs to ids');
{
  const appt = (p: Partial<Appointment> & { id: string; type: Appointment['type'] }): Appointment => ({
    title: p.type, startTime: '2026-07-10T10:00:00', endTime: '2026-07-10T11:00:00',
    isFixed: false, isBillable: true, ...p,
  });
  const raw: ScheduleData = {
    id: 'd', version: 2,
    clients: [{ id: 'c1', name: 'JO', availabilityWindows: {} }],
    technicians: [
      { id: 't1', name: 'Toniel T', isRBT: true, assignments: [{ clientId: 'JO', hoursPerWeek: 0, billable: true }], availability: {} },
      { id: 't2', name: 'Sam K', isRBT: true, assignments: [], availability: {} },
    ],
    settings: {},
    appointments: [
      appt({ id: 'a1', type: 'client-session', client: 'JO', technician: 'Toniel' }),      // name + stale name
      appt({ id: 'a2', type: 'client-session', client: 'c1', technician: 't1' }),          // already ids
      appt({ id: 'a3', type: 'client-session', client: 'JO', technician: 'Sam' }),          // stale prefix
      appt({ id: 'a4', type: 'client-session', client: 'JO', technician: 'Ghost' }),        // unresolvable
      appt({ id: 'a5', type: 'supervision', client: 'JO', technician: '' }),                // empty stays empty
    ],
    lastModified: '2026-07-01T00:00:00',
  };

  const out = migrateScheduleData(raw);
  const byId = Object.fromEntries(out.appointments.map(a => [a.id, a]));
  check('CURRENT_SCHEMA_VERSION is 3', CURRENT_SCHEMA_VERSION === 3);
  check('a1 client name → id', byId.a1.client === 'c1');
  check('a1 stale tech name → id (prefix heal)', byId.a1.technician === 't1');
  check('a2 ids untouched', byId.a2.client === 'c1' && byId.a2.technician === 't1');
  check('a3 stale prefix → id', byId.a3.technician === 't2');
  check('a4 unresolvable tech PRESERVED verbatim (no data loss)', byId.a4.technician === 'Ghost');
  check('a5 empty supervision technician stays empty', byId.a5.technician === '');
  check('assignment clientId name → id', out.technicians[0].assignments![0].clientId === 'c1');

  const unresolved = collectUnresolvedRefs(out);
  check('report lists exactly the Ghost orphan', unresolved.length === 1 && unresolved[0].kind === 'technician' && unresolved[0].ref === 'Ghost' && unresolved[0].count === 1);

  // Idempotency: migrating already-id data changes nothing.
  const twice = migrateScheduleData(out);
  check('re-migrating is a no-op (ids stay ids)', twice.appointments.every(a => a.client === byId[a.id].client && a.technician === byId[a.id].technician));
}

console.log(`\n${failed === 0 ? 'ALL PASS' : 'FAILURES'} — ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
