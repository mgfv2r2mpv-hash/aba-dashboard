/**
 * Session flag engine — pure, side-effect-free computation.
 *
 * Given all appointments + company holidays, produces a
 * Map<appointmentId, SessionFlags> used by Calendar markers.
 *
 * Cancel escalation source→entity mapping:
 *   family  → client's monthly count
 *   bt      → tech's monthly count
 *   bcba    → not counted
 *   admin   → not counted
 *
 * Streak and star are per-technician only.
 */

import { Appointment, CompanyHoliday } from './types';

export interface SessionFlags {
  /** Per-tech consecutive completed-session count at this appointment. */
  completedStreak?: number;
  /** Cumulative clean 14-day windows earned by this tech as of this appointment. */
  streakStarLevel?: number;
  /** Running monthly cancel count for the responsible entity (1..5, capped). */
  cancelEscalation?: number;
  cancelEntity?: 'client' | 'tech';
  isMakeup?: boolean;
  /** Dates of the session(s) being made up, resolved from makeupForId. */
  makeupDates?: string[];
  isHoliday?: boolean;
  holidayName?: string;
}

/** Day string (YYYY-MM-DD) from an ISO start time. */
const dateOf = (apt: Appointment): string => apt.startTime.slice(0, 10);

/** Year-month string (YYYY-MM) for monthly bucketing. */
const monthOf = (apt: Appointment): string => apt.startTime.slice(0, 7);

/**
 * Compute cumulative clean 14-day window counts per tech, anchored to
 * each tech's first session date. Returns a map of techId → sorted history
 * entries { beforeDate, stars } where `stars` is the total number of clean
 * windows that have *fully elapsed* before `beforeDate`.
 */
function computeStarHistory(
  sessionsByTech: Map<string, Appointment[]>,
): Map<string, Array<{ beforeDate: string; stars: number }>> {
  const result = new Map<string, Array<{ beforeDate: string; stars: number }>>();

  for (const [tech, sessions] of sessionsByTech) {
    const sorted = [...sessions].sort((a, b) =>
      a.startTime.localeCompare(b.startTime),
    );

    const firstDay = dateOf(sorted[0]);
    const lastDay = dateOf(sorted[sorted.length - 1]);

    // Pre-index canceled dates for this tech — only bt (tech-initiated) cancellations
    // dirty a 2-week window. Family / bcba / admin cancellations don't count against
    // the technician's clean-window record.
    const canceledDates = new Set<string>(
      sorted
        .filter(a => a.status === 'canceled' && a.cancellation?.source === 'bt')
        .map(dateOf),
    );

    // Pre-index all session dates for presence check.
    const sessionDates = new Set<string>(sorted.map(dateOf));

    const history: Array<{ beforeDate: string; stars: number }> = [];
    let stars = 0;

    let winStart = firstDay;
    while (winStart <= lastDay) {
      const winEnd = offsetDays(winStart, 13); // 14 days inclusive

      // A window counts only when the tech had at least one session in it.
      let hasSessions = false;
      let hasCancel = false;

      for (const d of sessionDates) {
        if (d >= winStart && d <= winEnd) {
          hasSessions = true;
          if (canceledDates.has(d)) hasCancel = true;
        }
      }

      if (hasSessions && !hasCancel) stars++;

      const nextStart = offsetDays(winStart, 14);
      // Stars earned in windows up to (but not including) nextStart are
      // visible on sessions from nextStart onwards.
      history.push({ beforeDate: winEnd, stars });

      winStart = nextStart;
    }

    result.set(tech, history);
  }

  return result;
}

/** Add `days` calendar days to a YYYY-MM-DD string. */
function offsetDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Look up the cumulative star count for a tech on a given session date. */
function starsAtDate(
  history: Array<{ beforeDate: string; stars: number }>,
  sessionDate: string,
): number {
  // Stars are awarded at window end. A session on day D can see stars from
  // windows whose `beforeDate` <= D.
  let count = 0;
  for (const entry of history) {
    if (entry.beforeDate <= sessionDate) count = entry.stars;
  }
  return count;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function computeSessionFlags(
  appointments: Appointment[],
  companyHolidays: CompanyHoliday[],
): Map<string, SessionFlags> {
  const result = new Map<string, SessionFlags>();

  // Exclude ghost sessions — they're wished-for placeholders, not real events.
  const active = appointments.filter(a => !a.isGhost);

  // Fast lookups.
  const byId = new Map<string, Appointment>(active.map(a => [a.id, a]));
  const holidayMap = new Map<string, string>(
    companyHolidays.map(h => [h.date, h.name]),
  );

  // Group by tech for streak and star calculations.
  const sessionsByTech = new Map<string, Appointment[]>();
  for (const apt of active) {
    if (!apt.technician) continue;
    const list = sessionsByTech.get(apt.technician) ?? [];
    list.push(apt);
    sessionsByTech.set(apt.technician, list);
  }

  const starHistory = computeStarHistory(sessionsByTech);

  // Per-tech running streak counter (mutated as we walk in chronological order).
  const streakByTech = new Map<string, number>();

  // Per-(entity-key, month) cancel count — entity-key is `client:ID` or `tech:ID`.
  const cancelCounts = new Map<string, number>();

  // Walk in chronological order so counts accumulate correctly.
  const sorted = [...active].sort((a, b) =>
    a.startTime.localeCompare(b.startTime),
  );

  for (const apt of sorted) {
    const flags: SessionFlags = {};
    const d = dateOf(apt);

    // ── Holiday ──────────────────────────────────────────────────────────────
    const holidayName = holidayMap.get(d);
    if (holidayName !== undefined) {
      flags.isHoliday = true;
      flags.holidayName = holidayName;
    }

    // ── Makeup ───────────────────────────────────────────────────────────────
    if (apt.isMakeUp) {
      flags.isMakeup = true;
      if (apt.makeupForId) {
        const original = byId.get(apt.makeupForId);
        if (original) {
          flags.makeupDates = [dateOf(original)];
        }
      }
    }

    // ── Cancel escalation ────────────────────────────────────────────────────
    if (apt.status === 'canceled' && apt.cancellation) {
      const { source } = apt.cancellation;
      const ym = monthOf(apt);

      let entityKey: string | undefined;
      let cancelEntity: 'client' | 'tech' | undefined;

      if (source === 'family' && apt.client) {
        entityKey = `client:${apt.client}:${ym}`;
        cancelEntity = 'client';
      } else if (source === 'bt' && apt.technician) {
        entityKey = `tech:${apt.technician}:${ym}`;
        cancelEntity = 'tech';
      }
      // bcba and admin: intentionally excluded per business rules.

      if (entityKey && cancelEntity) {
        const count = (cancelCounts.get(entityKey) ?? 0) + 1;
        cancelCounts.set(entityKey, count);
        flags.cancelEscalation = Math.min(count, 5);
        flags.cancelEntity = cancelEntity;
      }
    }

    // ── Completed streak (per tech) ───────────────────────────────────────────
    if (apt.technician) {
      if (apt.status === 'completed') {
        const streak = (streakByTech.get(apt.technician) ?? 0) + 1;
        streakByTech.set(apt.technician, streak);
        flags.completedStreak = streak;
      } else if (apt.status === 'canceled' && apt.cancellation?.source === 'bt') {
        // Only tech-initiated cancellations break the streak.
        // Family / bcba / admin cancellations don't reflect on the tech.
        streakByTech.set(apt.technician, 0);
      }
      // 'scheduled' and non-bt cancellations neither advance nor reset the streak

      // ── 2-week clean star ─────────────────────────────────────────────────
      const history = starHistory.get(apt.technician);
      if (history) {
        const stars = starsAtDate(history, d);
        if (stars > 0) flags.streakStarLevel = stars;
      }
    }

    if (Object.keys(flags).length > 0) {
      result.set(apt.id, flags);
    }
  }

  return result;
}
