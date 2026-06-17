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
