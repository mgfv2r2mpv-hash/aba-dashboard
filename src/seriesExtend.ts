import { Appointment, ScheduleData, WishOp } from './types';

// Extend a recurring series forward. Recurrence in this app is a set of dated rows
// materialized up to a fixed end date (AppointmentForm), NOT a live rule — the
// calendar draws only stored rows and never expands the flag (see appointmentsOn /
// scheduleBuilder "never expands a recurring flag"). So a series stops at whatever
// horizon it was created with. This re-materializes the missing occurrences of an
// EXISTING series up to a new end date, under the same seriesId, and folds in any
// stray lone-recurring rows that belong to it (so we relink instead of duplicating).
//
// Cadence + slots are inferred from the series' own members: for each distinct
// (weekday, start-clock) the most-recent member is the template (client/tech/type/
// duration/title). This handles a single-weekday weekly series AND a multi-weekday
// "custom" series uniformly (each weekday slot advances weekly). The emitted ops ride
// the normal add/regroup → wishSolutionToDraft → draft-tray pipeline for review.

export interface ExtendSeriesResult {
  ops: WishOp[];
  added: number;      // new occurrences materialized
  relinked: number;   // stray rows folded into the series
  through?: string;   // YYYY-MM-DD of the last occurrence added
  reason?: string;    // why nothing happened (for the UI)
}

type Pattern = 'weekly' | 'biweekly' | 'monthly';

const pad = (n: number): string => String(n).padStart(2, '0');
const localISO = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const dayOf = (iso: string): string => iso.slice(0, 10);
const clockOf = (iso: string): string => iso.slice(11, 16);         // "HH:MM"
const slotKey = (a: Appointment): string => `${new Date(a.startTime).getDay()}|${clockOf(a.startTime)}`;
const atClock = (day: string, hh: number, mm: number): Date => {
  const [y, mo, d] = day.split('-').map(Number);
  return new Date(y, mo - 1, d, hh, mm, 0, 0);
};
const stepForward = (d: Date, pat: Pattern): void => {
  if (pat === 'monthly') d.setMonth(d.getMonth() + 1);
  else d.setDate(d.getDate() + (pat === 'biweekly' ? 14 : 7));
};

export function extendSeries(
  data: ScheduleData,
  seriesId: string,
  endDateISO: string,
  now: Date,
): ExtendSeriesResult {
  const endDay = dayOf(endDateISO);
  const nowDay = dayOf(localISO(now));
  const members = data.appointments.filter(a => a.seriesId === seriesId);
  if (members.length === 0) return { ops: [], added: 0, relinked: 0, reason: 'No sessions found in this series.' };

  // Archived case: never extend a series forward for a client that's off the caseload.
  const seriesClient = data.clients.find(c => c.id === members[0].client || c.name === members[0].client);
  if (seriesClient?.archived) return { ops: [], added: 0, relinked: 0, reason: 'This client is archived — its series will not be extended.' };

  // Cadence: biweekly/monthly if the series says so, else weekly (covers 'weekly' and
  // 'custom' — custom weekday sets still repeat on a 7-day period).
  const pat: Pattern = (members.map(m => m.recurringPattern).find(p => p === 'biweekly' || p === 'monthly') as Pattern) ?? 'weekly';

  // One template per (weekday|clock) slot — the most-recent member wins.
  const slots = new Map<string, Appointment>();
  for (const m of [...members].sort((a, b) => a.startTime.localeCompare(b.startTime))) slots.set(slotKey(m), m);

  // occupiedDates: `${day}|${slotKey}` already covered (a member or an absorbed orphan).
  const occupied = new Set<string>();
  for (const m of members) occupied.add(`${dayOf(m.startTime)}|${slotKey(m)}`);

  // Absorb lone recurring rows that match a slot's identity but aren't in any series.
  const orphanIds: string[] = [];
  for (const a of data.appointments) {
    if (a.seriesId) continue;          // already in a series (this or another) — never poach
    if (!a.isRecurring) continue;      // only stray recurring rows are misplaced occurrences
    const tmpl = slots.get(slotKey(a));
    if (!tmpl || a.client !== tmpl.client || a.technician !== tmpl.technician || a.type !== tmpl.type) continue;
    orphanIds.push(a.id);
    occupied.add(`${dayOf(a.startTime)}|${slotKey(a)}`);
  }

  // Materialize forward per slot.
  const addOps: WishOp[] = [];
  let through = '';
  for (const [key, tmpl] of slots) {
    const durationMs = new Date(tmpl.endTime).getTime() - new Date(tmpl.startTime).getTime();
    const [hh, mm] = clockOf(tmpl.startTime).split(':').map(Number);
    // Anchor = latest date already covered for this slot (member OR absorbed orphan).
    let anchorDay = tmpl.startTime.slice(0, 10);
    for (const a of data.appointments) {
      if (slotKey(a) !== key) continue;
      const covered = a.seriesId === seriesId || orphanIds.includes(a.id);
      if (covered && dayOf(a.startTime) > anchorDay) anchorDay = dayOf(a.startTime);
    }
    const cur = atClock(anchorDay, hh, mm);
    stepForward(cur, pat);
    while (dayOf(localISO(cur)) <= endDay) {
      const day = dayOf(localISO(cur));
      const occKey = `${day}|${key}`;
      if (day >= nowDay && !occupied.has(occKey)) {
        addOps.push({
          op: 'add', type: tmpl.type, client: tmpl.client, technician: tmpl.technician,
          title: tmpl.title, start: localISO(cur), end: localISO(new Date(cur.getTime() + durationMs)),
          recurring: true, pattern: pat, seriesId,
        });
        occupied.add(occKey);
        if (day > through) through = day;
      }
      stepForward(cur, pat);
    }
  }

  const ops: WishOp[] = [];
  if (orphanIds.length) ops.push({ op: 'regroup', appointmentIds: orphanIds, seriesId, recurringPattern: pat });
  ops.push(...addOps);

  return {
    ops,
    added: addOps.length,
    relinked: orphanIds.length,
    through: through || undefined,
    reason: ops.length ? undefined : 'This series already runs through the chosen date.',
  };
}
