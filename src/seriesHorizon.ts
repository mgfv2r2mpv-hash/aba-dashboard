// seriesHorizon — find recurring series about to run off their materialized end.
//
// Recurrence here is bounded dated rows (no live rule), so every series stops at
// whatever horizon it was created/extended with — and then silently ceases to
// exist. The user chose PROMPT over silent growth: the dock surfaces a one-tap
// "Series ending — extend?" card whose CTA stages an extension through the
// suggested date for review. Nothing is ever auto-committed.

import { ScheduleData } from './types';

export const DEFAULT_LOOKAHEAD_DAYS = 14;
// With no authorization to cap it, suggest ~8 more weeks of runway.
export const DEFAULT_EXTENSION_DAYS = 56;

export interface EndingSeries {
  seriesId: string;
  clientId?: string;
  clientName: string;
  title: string;            // the series' (most recent) session title
  lastOccurrence: string;   // YYYY-MM-DD of the final materialized occurrence
  pendingCount: number;     // pending members remaining
  suggestedThrough: string; // YYYY-MM-DD the CTA extends to (auth-capped)
}

const dayOf = (iso: string): string => iso.slice(0, 10);
const pad2 = (n: number): string => String(n).padStart(2, '0');
const dayString = (d: Date): string => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const addDays = (day: string, delta: number): string => {
  const [y, m, dd] = day.split('-').map(Number);
  const d = new Date(y, m - 1, dd, 12); // noon anchor — DST-safe day math
  d.setDate(d.getDate() + delta);
  return dayString(d);
};

export function findEndingSeries(
  data: ScheduleData,
  now: Date,
  lookaheadDays: number = DEFAULT_LOOKAHEAD_DAYS,
): EndingSeries[] {
  const horizonDay = addDays(dayString(now), lookaheadDays);

  const bySeries = new Map<string, ScheduleData['appointments']>();
  for (const a of data.appointments) {
    if (!a.seriesId || a.isGhost) continue;
    const arr = bySeries.get(a.seriesId);
    if (arr) arr.push(a); else bySeries.set(a.seriesId, [a]);
  }

  const out: EndingSeries[] = [];
  for (const [seriesId, members] of bySeries) {
    if (members.length < 2) continue; // a singleton isn't a series (trio invariant)
    const pending = members.filter(m => m.status !== 'completed' && m.status !== 'canceled');
    if (pending.length === 0) continue; // all facts — a finished chapter, not an ending series

    const sorted = [...members].sort((a, b) => a.startTime.localeCompare(b.startTime));
    const last = sorted[sorted.length - 1];
    const lastDay = dayOf(last.startTime);
    if (lastDay > horizonDay) continue; // plenty of runway — nothing to prompt

    // Archived case: never nudge to extend a series that's off the caseload.
    const client = data.clients.find(c => c.id === last.client || c.name === last.client);
    if (client?.archived) continue;

    // Suggested horizon: default runway, capped by the client's latest auth end.
    // Auth already exhausted at the last occurrence = nowhere to extend → skip.
    const authEnd = (data.authorizations ?? [])
      .filter(a => a.clientId === (client?.id ?? last.client))
      .map(a => a.endDate)
      .sort()
      .pop();
    let suggestedThrough = addDays(lastDay, DEFAULT_EXTENSION_DAYS);
    if (authEnd) {
      if (authEnd <= lastDay) continue;
      if (authEnd < suggestedThrough) suggestedThrough = authEnd;
    }

    out.push({
      seriesId,
      clientId: client?.id,
      clientName: client?.name ?? last.client ?? '—',
      title: last.title,
      lastOccurrence: lastDay,
      pendingCount: pending.length,
      suggestedThrough,
    });
  }
  // Soonest-ending first.
  return out.sort((a, b) => a.lastOccurrence.localeCompare(b.lastOccurrence));
}
