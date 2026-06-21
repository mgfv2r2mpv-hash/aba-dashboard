// Shared constants + helpers for the client-centric (Case) calendar surfaces:
// ClientCalendarView (Month/Week/Day) and AvailabilityHeatmap.

import { DayOfWeek } from '../types';

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
