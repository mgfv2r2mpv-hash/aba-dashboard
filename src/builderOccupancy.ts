// Live occupancy for the schedule builder — the fix for the staleness bug.
//
// feasibleDirectWindows (fillSchedule.ts) recomputes "who is free" from a STATIC
// data snapshot. That is safe for a single case, but a whole-caseload builder
// must place many sessions in one pass: the moment client A is placed on tech
// Bea, every other client's windows that also list Bea go stale → double-book.
//
// This module holds a MUTABLE occupancy structure. seedOccupancy() indexes the
// existing (preserved) sessions for the template week; feasibleWindowsLive()
// reads it instead of rescanning the schedule; reserve() grows it after every
// placement so the next client's windows already exclude the slot. Double-books
// are prevented at CONSTRUCTION time, not after the fact.

import { ScheduleData, Client, DayOfWeek } from './types';
import {
  Interval, DAYS,
  minToClock, normalize, windowsToIntervals, btCaseAvailability,
} from './intervals';
import { computeWindowSlots, TechFeasibility } from './kernel/windows';

// weekday → merged busy intervals (minutes-of-day) for one entity.
type DayBusy = Partial<Record<DayOfWeek, Interval[]>>;

export interface Occupancy {
  tech: Map<string, DayBusy>;    // techName (appointments store the name) → busy
  client: Map<string, DayBusy>;  // clientId → busy
}

// A placeable window on a specific template-week day: client availability ∩ a
// BT's case availability, minus everything already occupied, ≥ MIN_SLOT_MINS.
export interface LiveWindow {
  start: string;   // HH:MM
  end: string;     // HH:MM
  day: DayOfWeek;
  date: string;    // YYYY-MM-DD (this weekday's date in the template week)
  techs: { id: string; name: string }[];  // BTs free for the whole window
}

const isActive = (a: { status?: string; isGhost?: boolean }) => a.status !== 'canceled' && !a.isGhost;

// JS getDay() (0=Sun..6=Sat) → our Monday-first DayOfWeek.
export function dayOfWeekOf(d: Date): DayOfWeek {
  const js = d.getDay();
  return js === 0 ? DAYS[6] : DAYS[js - 1];
}

const minOfDay = (d: Date): number => d.getHours() * 60 + d.getMinutes();

function addBusy(map: Map<string, DayBusy>, key: string, day: DayOfWeek, iv: Interval): void {
  const rec = map.get(key) ?? {};
  rec[day] = normalize([...(rec[day] ?? []), iv]);
  map.set(key, rec);
}

// Seed occupancy from the active appointments already in the template week, so a
// preserve-and-fill build never overwrites what is there. For a blank slate this
// is empty and the builder fills freely.
export function seedOccupancy(data: ScheduleData, weekStart: Date): Occupancy {
  const occ: Occupancy = { tech: new Map(), client: new Map() };
  const startMs = weekStart.getTime();
  const endMs = startMs + 7 * 86_400_000;
  for (const a of data.appointments) {
    if (!isActive(a)) continue;
    const s = new Date(a.startTime);
    const ms = s.getTime();
    if (ms < startMs || ms >= endMs) continue;
    const day = dayOfWeekOf(s);
    const iv: Interval = { start: minOfDay(s), end: minOfDay(new Date(a.endTime)) };
    if (a.technician) addBusy(occ.tech, a.technician, day, iv);
    if (a.client) {
      const client = data.clients.find(c => c.id === a.client || c.name === a.client);
      addBusy(occ.client, client?.id ?? a.client, day, iv);
    }
  }
  return occ;
}

// Open direct-service windows for one client on one template-week day, reading
// live occupancy. Mirrors feasibleDirectWindows' interval math exactly, but the
// busy sets come from `occ` (which grows as the builder places) rather than a
// re-scan of data.
export function feasibleWindowsLive(
  data: ScheduleData,
  client: Client,
  day: DayOfWeek,
  date: string,
  occ: Occupancy,
): LiveWindow[] {
  const blackedOut = (data.blackouts || []).some(b =>
    b.date === date && b.entityType === 'client' &&
    (b.entityId === client.id || b.entityId === client.name || b.entityName === client.name));
  if (blackedOut) return [];

  const clientAvail = windowsToIntervals(client.availabilityWindows?.[day]);
  if (clientAvail.length === 0) return [];
  const clientBusy = occ.client.get(client.id)?.[day] ?? [];

  const assignedTechs = data.technicians.filter(t =>
    (t.assignments || []).some(a => a.clientId === client.id || a.clientId === client.name));

  // Busy comes from the LIVE occupancy, keyed by BT name (how appointments store
  // the tech) — this is what makes the builder anti-double-book as it places.
  const techs: TechFeasibility[] = assignedTechs.map(tech => {
    let caseAvail = btCaseAvailability(tech, client.id, day);
    if (caseAvail.length === 0) caseAvail = btCaseAvailability(tech, client.name, day);
    return {
      tech: { id: tech.id, name: tech.name },
      caseAvail,
      busy: occ.tech.get(tech.name)?.[day] ?? [],
    };
  });

  return computeWindowSlots(clientAvail, clientBusy, techs).map(s => ({
    start: minToClock(s.start), end: minToClock(s.end), day, date, techs: s.techs,
  }));
}

// Record a placement so the next feasibleWindowsLive excludes it — the
// anti-double-book mechanism. Reserves against BOTH the tech and the client.
export function reserve(occ: Occupancy, techName: string, clientId: string, day: DayOfWeek, iv: Interval): void {
  addBusy(occ.tech, techName, day, iv);
  addBusy(occ.client, clientId, day, iv);
}
