// The teach loop's detector: when the user corrects a builder-placed
// supervision before Accepting, recognize the two patterns a hint can express
// and offer to remember them — the moment a proposal reveals a violated
// heuristic is exactly when the owner can name it.
//
//   (i) daypart move — the builder placed a client's weekly contact in one
//       daypart; every 1:1-matched week was accepted in a DIFFERENT, agreeing
//       daypart → suggest { preferredDaypart }.
//  (ii) split — the builder placed ONE contact; the accepted week holds TWO
//       supervision sessions totaling ≈ the same hours → suggest
//       { supervisionStyle: 'split' }.
// (iii) unsplit (reverse learning) — the builder split (hint active) but the
//       accepted week holds ONE merged contact → offer to clear the hint.
//
// Deterministic, conservative: only 1:1 / 1:2 matches count, disagreeing weeks
// veto, and a signal is suppressed when the client's hints already say it.
// Detection runs at acceptDraft when a build staged the draft — the builder's
// ORIGINAL ops (buildResult.solution.ops) are compared against the accepted
// schedule. Confirmation is always a human tap (never silent).

import { ScheduleData, WishOp, SchedulingHints, Daypart } from './types';
import { daypartOfMs } from './builderScoring';

export interface HintSignal {
  clientId: string;
  clientName: string;
  kind: 'daypart' | 'split' | 'unsplit';
  suggest: Partial<SchedulingHints>;
  /** Chip copy fragment, e.g. "prefer midday supervision". */
  detail: string;
}

const HR_MS = 3_600_000;

// Monday-anchored local week key.
const weekKey = (iso: string): string => {
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

const DAYPART_LABEL: Record<Daypart, string> = {
  morning: 'morning', midday: 'midday', afternoon: 'afternoon', evening: 'evening',
};

export function detectHintSignals(builderOps: WishOp[], accepted: ScheduleData): HintSignal[] {
  // Builder supervision adds, grouped by (client, week). Builder ops carry the
  // client NAME (display-space); resolve to the entity for id-space matching.
  const clientOf = (ref: string) => accepted.clients.find(c => c.id === ref || c.name === ref);
  const placed = new Map<string, { clientId: string; clientName: string; week: string; starts: number[]; hours: number }>();
  for (const o of builderOps) {
    if (o.op !== 'add' || o.type !== 'supervision' || !o.client) continue;
    const client = clientOf(o.client);
    if (!client) continue;
    const wk = weekKey(o.start);
    const key = `${client.id}|${wk}`;
    const cur = placed.get(key) ?? { clientId: client.id, clientName: client.name, week: wk, starts: [], hours: 0 };
    cur.starts.push(new Date(o.start).getTime());
    cur.hours += (new Date(o.end).getTime() - new Date(o.start).getTime()) / HR_MS;
    placed.set(key, cur);
  }
  if (placed.size === 0) return [];

  // Accepted supervision sessions per (client, week) — the post-correction truth.
  const acceptedBy = new Map<string, { starts: number[]; hours: number }>();
  for (const a of accepted.appointments) {
    if (a.type !== 'supervision' || a.status === 'canceled' || a.isGhost) continue;
    const client = clientOf(a.client ?? '');
    if (!client) continue;
    const key = `${client.id}|${weekKey(a.startTime)}`;
    if (!placed.has(key)) continue; // only weeks the builder touched
    const cur = acceptedBy.get(key) ?? { starts: [], hours: 0 };
    cur.starts.push(new Date(a.startTime).getTime());
    cur.hours += (new Date(a.endTime).getTime() - new Date(a.startTime).getTime()) / HR_MS;
    acceptedBy.set(key, cur);
  }

  // Per-client evidence.
  interface Evidence { clientName: string; daypartPairs: { from?: Daypart; to?: Daypart }[]; splitWeeks: number; unsplitWeeks: number }
  const byClient = new Map<string, Evidence>();
  for (const p of placed.values()) {
    const acc = acceptedBy.get(`${p.clientId}|${p.week}`);
    if (!acc || acc.starts.length === 0) continue; // removed outright — no placement signal
    const ev = byClient.get(p.clientId) ?? { clientName: p.clientName, daypartPairs: [], splitWeeks: 0, unsplitWeeks: 0 };
    if (p.starts.length === 1 && acc.starts.length === 1) {
      ev.daypartPairs.push({ from: daypartOfMs(p.starts[0]), to: daypartOfMs(acc.starts[0]) });
    } else if (p.starts.length === 1 && acc.starts.length === 2) {
      // Same total hours (tolerant) → the user split the contact, not re-sized it.
      if (Math.abs(acc.hours - p.hours) <= Math.max(0.25, p.hours * 0.25)) ev.splitWeeks++;
    } else if (p.starts.length >= 2 && acc.starts.length === 1) {
      ev.unsplitWeeks++;
    }
    byClient.set(p.clientId, ev);
  }

  const signals: HintSignal[] = [];
  for (const [clientId, ev] of byClient) {
    const hints = accepted.clients.find(c => c.id === clientId)?.schedulingHints;

    // (i) daypart move — every 1:1 week agrees on the same NEW daypart.
    const tos = new Set(ev.daypartPairs.map(p => p.to));
    if (ev.daypartPairs.length > 0 && tos.size === 1) {
      const to = [...tos][0];
      const moved = ev.daypartPairs.some(p => p.from !== undefined && p.to !== undefined && p.from !== p.to);
      if (to && moved && hints?.preferredDaypart !== to) {
        signals.push({
          clientId, clientName: ev.clientName, kind: 'daypart',
          suggest: { preferredDaypart: to },
          detail: `prefer ${DAYPART_LABEL[to]} supervision`,
        });
      }
    }

    // (ii) split — at least one 1→2 week, no merged (reverse) weeks vetoing.
    if (ev.splitWeeks > 0 && ev.unsplitWeeks === 0 && hints?.supervisionStyle !== 'split') {
      signals.push({
        clientId, clientName: ev.clientName, kind: 'split',
        suggest: { supervisionStyle: 'split' },
        detail: 'prefer two shorter supervision visits',
      });
    }

    // (iii) unsplit — the split hint is active but the user merged back to one.
    if (ev.unsplitWeeks > 0 && ev.splitWeeks === 0 && hints?.supervisionStyle === 'split') {
      signals.push({
        clientId, clientName: ev.clientName, kind: 'unsplit',
        suggest: { supervisionStyle: 'auto' },
        detail: 'drop the two-shorter-visits preference',
      });
    }
  }
  return signals;
}
