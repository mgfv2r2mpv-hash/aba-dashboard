// A lightweight, human-readable diff between the schedule currently loaded and
// a candidate parsed from a newly-picked Excel file. Used by ImportPreview so
// the user can see what "Replace current data" would actually change before it
// overwrites their working schedule.

import { ScheduleData, Client, Technician } from './types';

export interface NameDelta {
  added: string[];
  removed: string[];
  changed: string[]; // same id, but some field differs
}

export interface ScheduleDiff {
  clients: NameDelta;
  technicians: NameDelta;
  appointments: { current: number; next: number; delta: number };
  settingsChanged: boolean;
}

function nameDelta<T extends { id: string; name: string }>(
  current: T[],
  next: T[],
  equal: (a: T, b: T) => boolean,
): NameDelta {
  const curById = new Map(current.map(x => [x.id, x]));
  const nextById = new Map(next.map(x => [x.id, x]));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const n of next) {
    const c = curById.get(n.id);
    if (!c) added.push(n.name);
    else if (!equal(c, n)) changed.push(n.name);
  }
  for (const c of current) {
    if (!nextById.has(c.id)) removed.push(c.name);
  }
  return { added, removed, changed };
}

function clientsEqual(a: Client, b: Client): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function techsEqual(a: Technician, b: Technician): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function diffSchedule(current: ScheduleData, next: ScheduleData): ScheduleDiff {
  return {
    clients: nameDelta(current.clients, next.clients, clientsEqual),
    technicians: nameDelta(current.technicians, next.technicians, techsEqual),
    appointments: {
      current: current.appointments.length,
      next: next.appointments.length,
      delta: next.appointments.length - current.appointments.length,
    },
    settingsChanged: JSON.stringify(current.settings) !== JSON.stringify(next.settings),
  };
}

// Whether the diff carries any change at all (used to soften the warning copy
// when the file is effectively identical to what's loaded).
export function isEmptyDiff(d: ScheduleDiff): boolean {
  const empty = (n: NameDelta) => n.added.length === 0 && n.removed.length === 0 && n.changed.length === 0;
  return empty(d.clients) && empty(d.technicians) && d.appointments.delta === 0 && !d.settingsChanged;
}
