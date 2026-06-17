/** Unit check for the Fill-my-Schedule local solver. Run: npx tsx scripts/verify-fill.ts */
import { startOfWeek } from 'date-fns';
import { ScheduleData } from '../src/types';
import { computeCaseUtilization, feasibleDirectWindows } from '../src/fillSchedule';

let passed = 0, failed = 0;
const check = (n: string, c: boolean, e?: string) => { c ? (passed++, console.log(`  ✓ ${n}`)) : (failed++, console.log(`  ✗ ${n}${e ? ` — ${e}` : ''}`)); };

const weekStart = startOfWeek(new Date(2026, 5, 17), { weekStartsOn: 1 }); // a Monday
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const monISO = iso(weekStart);

const data = {
  id: 't', version: 2,
  clients: [{ id: 'c-aa', name: 'AA', availabilityWindows: { Monday: [{ start: '09:00', end: '12:00' }] } }],
  technicians: [
    { id: 't-bea', name: 'Bea', isRBT: true, availability: { Monday: [{ start: '08:00', end: '12:00' }] },
      assignments: [{ clientId: 'c-aa', hoursPerWeek: 10, billable: true }] },
    { id: 't-cy', name: 'Cy', isRBT: true, availability: { Monday: [{ start: '08:00', end: '12:00' }] },
      assignments: [{ clientId: 'c-aa', hoursPerWeek: 5, billable: true, availability: { Monday: [{ start: '10:00', end: '11:00' }] } }] },
  ],
  appointments: [
    { id: 'a1', title: 'AA direct', type: 'client-session', client: 'c-aa', technician: 'Bea',
      startTime: `${monISO}T09:00:00`, endTime: `${monISO}T10:00:00`, isFixed: false, isBillable: true },
  ],
  authorizations: [{ id: 'au1', clientId: 'c-aa', startDate: '2026-01-01', endDate: '2026-12-31', buckets: {}, weekly: { direct: 4 } }],
  blackouts: [],
} as unknown as ScheduleData;

// Utilization: target 4, scheduled 1, gap 3.
const util = computeCaseUtilization(data, weekStart);
const aa = util.find(u => u.clientId === 'c-aa')!;
check('target = authorized weekly direct (4h)', aa.targetDirectHrs === 4, String(aa.targetDirectHrs));
check('scheduled direct = 1h', aa.scheduledDirectHrs === 1, String(aa.scheduledDirectHrs));
check('gap = 3h', aa.gapHrs === 3, String(aa.gapHrs));

const wins = feasibleDirectWindows(data, weekStart).filter(w => w.clientId === 'c-aa');
const bea = wins.find(w => w.techs.some(t => t.name === 'Bea'));
const cy = wins.find(w => w.techs.some(t => t.name === 'Cy'));

// Bea: general avail, free after the 9–10 session she's on → Mon 10:00–12:00.
check('Bea window is 10:00–12:00', !!bea && bea.start === '10:00' && bea.end === '12:00', bea && `${bea.start}-${bea.end}`);
// Cy: per-case availability restricts her to Mon 10–11 even though general is 8–12.
check('Cy window respects per-case avail (10:00–11:00)', !!cy && cy.start === '10:00' && cy.end === '11:00', cy && `${cy.start}-${cy.end}`);
// Client busy 9–10 must be excluded from every window.
check('no window starts before 10:00 (client busy 9–10 removed)', wins.every(w => w.start >= '10:00'), wins.map(w => w.start).join(','));

// Blackout suppresses all windows for that client/day.
const withBlackout = { ...data, blackouts: [{ id: 'b1', date: monISO, entityType: 'client', entityId: 'c-aa' }] } as unknown as ScheduleData;
check('blackout day yields no windows', feasibleDirectWindows(withBlackout, weekStart).filter(w => w.clientId === 'c-aa').length === 0);

console.log(`\n${failed === 0 ? 'ALL PASS' : 'FAILURES'} — ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
