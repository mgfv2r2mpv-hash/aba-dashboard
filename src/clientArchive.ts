// clientArchive.ts — archive / unarchive a case (pure).
//
// Archiving takes a client off the active caseload (e.g. they moved to another
// BCBA for the summer). It DELETES the client's sessions dated on or after the
// as-of date — sessions before it stay for history — and stamps the client
// `archived` + `archivedAsOf`. Every downstream surface (builder, compliance,
// counts, Cases list, session picker) then skips archived clients, so the case
// simply disappears from active work until it's unarchived.
//
// Reversal is the explicit Unarchive (reactivates the client with an empty
// forward schedule — rebuild when they return). The deleted sessions are gone by
// design, so the caller gates the action behind a confirmation showing the count.

import type { ScheduleData, Appointment } from './types';

const matchesClient = (a: Appointment, clientId: string, clientName?: string): boolean =>
  a.client === clientId || (clientName !== undefined && a.client === clientName);

// Local midnight of the YYYY-MM-DD as-of date is the (inclusive) cut boundary.
function asOfBoundaryMs(asOf: string): number {
  const [y, m, d] = asOf.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

// Ids of the client's sessions that archiving on `asOf` would delete (dated
// on/after the boundary). Powers the confirmation dialog's live count.
export function sessionsCutByArchive(data: ScheduleData, clientId: string, asOf: string): string[] {
  const client = data.clients.find(c => c.id === clientId);
  const boundary = asOfBoundaryMs(asOf);
  const out: string[] = [];
  for (const a of data.appointments) {
    if (matchesClient(a, clientId, client?.name) && new Date(a.startTime).getTime() >= boundary) out.push(a.id);
  }
  return out;
}

export interface ArchivePlan {
  next: ScheduleData;
  removedCount: number;
}

// Produce the post-archive schedule: sessions on/after `asOf` removed, the client
// stamped archived. Returns the count removed for the caller's log label.
export function planArchive(data: ScheduleData, clientId: string, asOf: string): ArchivePlan {
  const doomed = new Set(sessionsCutByArchive(data, clientId, asOf));
  const next: ScheduleData = {
    ...data,
    appointments: data.appointments.filter(a => !doomed.has(a.id)),
    clients: data.clients.map(c => (c.id === clientId ? { ...c, archived: true, archivedAsOf: asOf } : c)),
  };
  return { next, removedCount: doomed.size };
}

// Reactivate a client. Leaves the schedule alone — deleted sessions are not
// resurrected; the case returns empty and is rebuilt from here.
export function unarchiveClient(data: ScheduleData, clientId: string): ScheduleData {
  return {
    ...data,
    clients: data.clients.map(c =>
      c.id === clientId ? { ...c, archived: false, archivedAsOf: undefined } : c,
    ),
  };
}
