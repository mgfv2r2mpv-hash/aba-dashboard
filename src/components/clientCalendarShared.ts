// Shared constants + helpers for the client-centric (Case) calendar surfaces:
// ClientCalendarView's Month / Week / Day grids. The Week and Day grids overlap
// every selected client's availability + sessions as translucent z-layers
// (tierOf / TIER_COLOR / TIER_LAYOUT) and order clients with clusterByOverlap so
// clients with similar availability sit adjacent.

import { DayOfWeek, Client } from '../types';

export const DAY_S = 6;   // first visible hour
export const DAY_E = 22;  // last visible hour (exclusive)

export const WEEK_DAYS: DayOfWeek[] = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
];
export const SHORT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// "HH:MM" → minutes since midnight.
export const toMin = (t: string): number => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};

// Minutes since midnight → "10:45a" / "5p" / "12:45p". Used to print real
// window start/end times as text (no 30-min snapping).
export function fmtMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const ap = h >= 12 ? 'p' : 'a';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12}${ap}` : `${h12}:${String(m).padStart(2, '0')}${ap}`;
}

// "HH:MM" → "10:45a".
export const fmtHM = (t: string): string => fmtMin(toMin(t));

// A scheduled-session tier, back→front, matching the user's z-axis model:
// availability (backmost) → direct → supervision → parent-training (foremost).
export type SessionTier = 'direct' | 'supervision' | 'parentTraining' | 'other';

export function tierOf(type: string): SessionTier {
  if (type === 'client-session') return 'direct';
  if (type === 'supervision') return 'supervision';
  if (type === 'parent-training') return 'parentTraining';
  return 'other';
}

// Fixed type colors so direct / supervision / parent-training read the same way
// everywhere (mirrors the app's existing legend: supervision green, PT blue).
export const TIER_COLOR: Record<SessionTier, string> = {
  direct: '#7c3aed',          // violet — direct client session
  supervision: '#10b981',     // green — supervision
  parentTraining: '#3b82f6',  // blue — parent training
  other: '#94a3b8',           // slate — case-planning / other
};

export const TIER_LABEL: Record<SessionTier, string> = {
  direct: 'Direct',
  supervision: 'Supervision',
  parentTraining: 'Parent training',
  other: 'Other',
};

// Inset + z per tier so the overlapping stack reads as depth: availability is
// backmost (handled by the renderer), then direct → other → supervision →
// parent-training foremost, each inset a little further.
export const TIER_LAYOUT: Record<SessionTier, { inset: number; z: number }> = {
  direct:         { inset: 2, z: 12 },
  other:          { inset: 4, z: 13 },
  supervision:    { inset: 5, z: 14 },
  parentTraining: { inset: 8, z: 15 },
};

// Cancel-escalation badge text — mirrors the admin calendar's scheme so the
// Case lens reads the same way (2? → 3! → 4!! → 5🛑).
export function cancelBadgeText(level: number): string {
  if (level <= 1) return '';
  if (level === 2) return '2?';
  if (level === 3) return '3!';
  if (level === 4) return '4!!';
  return '5\u{1F6D1}'; // 🛑
}

// Cancellation source → coded bar color (theme CSS custom properties).
export function cancelBar(source?: string): string {
  switch (source) {
    case 'family': return 'var(--cancel-family)';
    case 'bcba':   return 'var(--cancel-bcba)';
    case 'admin':  return 'var(--cancel-admin)';
    default:       return 'var(--cancel-bt)';
  }
}

// Lay overlapping time intervals into side-by-side lanes so their labels never
// stack on top of each other. Items are ordered by start time, then by sortKey
// (alphabetical) for exact ties, and each is given a lane index plus the total
// lane count of its overlap cluster — so a renderer can size width = 1/lanes and
// offset left = lane/lanes. Non-overlapping items collapse back to a single lane.
export interface Laned { lane: number; lanes: number; }

export function assignLanes<T extends { startMin: number; endMin: number; sortKey: string }>(items: T[]): (T & Laned)[] {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || a.sortKey.localeCompare(b.sortKey));
  const out: (T & Laned)[] = [];
  let cluster: (T & Laned)[] = [];
  let colEnds: number[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    if (!cluster.length) return;
    const lanes = cluster.reduce((mx, it) => Math.max(mx, it.lane + 1), 0);
    cluster.forEach(it => { it.lanes = lanes; });
    out.push(...cluster);
    cluster = [];
    colEnds = [];
    clusterEnd = -Infinity;
  };

  for (const it of sorted) {
    if (cluster.length && it.startMin >= clusterEnd) flush();
    let lane = colEnds.findIndex(end => end <= it.startMin);
    if (lane === -1) { lane = colEnds.length; colEnds.push(it.endMin); }
    else colEnds[lane] = it.endMin;
    cluster.push({ ...it, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, it.endMin);
  }
  flush();
  return out;
}

// Greedy nearest-neighbour ordering on each client's weekly availability vector
// (30-min resolution), so clients whose windows overlap sit adjacent — keeps the
// overlapping translucent layers legible and groups similar caseloads together.
export function clusterByOverlap(clients: Client[]): Client[] {
  if (clients.length <= 1) return clients;
  const SPD = (DAY_E - DAY_S) * 2;
  const vecs = clients.map(client =>
    WEEK_DAYS.flatMap(dow => {
      const wins = client.availabilityWindows?.[dow] ?? [];
      return Array.from({ length: SPD }, (_, si) => {
        const s = DAY_S * 60 + si * 30, e = s + 30;
        return wins.some(w => toMin(w.start) < e && toMin(w.end) > s) ? 1 : 0;
      });
    }),
  );
  const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);
  const mag = (a: number[]) => Math.sqrt(a.reduce((s, v) => s + v * v, 0));
  const sim = (a: number[], b: number[]) => { const ma = mag(a), mb = mag(b); return ma && mb ? dot(a, b) / (ma * mb) : 0; };
  const total = (v: number[]) => v.reduce((s: number, x: number) => s + x, 0);

  const remaining = clients.map((_, i) => i).sort((a, b) => total(vecs[b]) - total(vecs[a]));
  const order: number[] = [remaining.shift()!];
  while (remaining.length) {
    const last = order[order.length - 1];
    let best = 0, bestSim = -1;
    for (let i = 0; i < remaining.length; i++) {
      const s = sim(vecs[last], vecs[remaining[i]]);
      if (s > bestSim) { bestSim = s; best = i; }
    }
    order.push(remaining.splice(best, 1)[0]);
  }
  return order.map(i => clients[i]);
}
