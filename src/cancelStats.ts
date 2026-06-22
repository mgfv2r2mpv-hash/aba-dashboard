/**
 * Cancel-statistics engine — pure, side-effect-free computation.
 *
 * Replaces the old "monthly cancel count" escalation with two richer ideas the
 * BCBA asked for, computed per appointment:
 *
 *   1. CONSECUTIVE run — how many times the *same participants* have canceled in
 *      a row (a completed/scheduled occurrence, or a cancel from a different
 *      source, breaks the run). This drives the tile darkening / badge / dot.
 *
 *   2. ROLLING-30 windows — four independent trailing-30-day cancel counts (BT,
 *      family, BCBA, admin) for the entities touching this appointment, surfaced
 *      in the appointment detail popup.
 *
 * Grouping for "same participants in a row" depends on the session type AND the
 * cancel source being measured (BCBA-confirmed):
 *
 *   - direct (client-session):        same TECH + CLIENT
 *   - supervision:                    same BT + CLIENT for bt/bcba cancels,
 *                                     same CLIENT for family/admin cancels
 *   - parent-training / case-planning: same CLIENT in a row
 *
 * ⇒ group key per source: bt/bcba → `client|tech`; family/admin → `client`.
 *
 * NOTE (reset rule, confirmable via scripts/verify-cancel-stats.ts): a source's
 * consecutive run is broken by any occurrence in the group that is NOT a cancel
 * of that same source — i.e. a completed/scheduled session, or a cancel from a
 * different source, resets the run to 0. Each source therefore tracks an
 * independent run, which is what the four-window popup breakdown reflects.
 */

import { Appointment, CancellationSource } from './types';

/** One source's pressure on an entity as of an anchor appointment. */
export interface SourceRun {
  /** Trailing consecutive cancels of this source in the participant group. */
  consecutive: number;
  /** Count of this source's cancels for the entity in the trailing window. */
  rolling30: number;
  /** The rolling window in days (30 for direct/sup, 60 for PT/CoC). */
  windowDays: number;
}

export interface CancelContext {
  /** This appointment's own cancellation source. */
  source: CancellationSource;
  /** Consecutive run for THIS appointment's source+group — drives the tile. */
  consecutiveForSource: number;
  /** BT pressure (only meaningful when a technician is present). */
  bt: {
    /** Consecutive bt cancels for this BT + client. */
    withClientConsecutive: number;
    /** bt cancels for this BT + client in the trailing 30 days. */
    perBtCaseRolling30: number;
    /** bt cancels for this BT across ALL clients in the trailing 30 days. */
    btRolling30: number;
  };
  family: SourceRun;
  bcba: SourceRun;
  admin: SourceRun;
}

/** Day string (YYYY-MM-DD) from an ISO start time. */
const dateOf = (apt: Appointment): string => apt.startTime.slice(0, 10);

/** Add `days` calendar days to a YYYY-MM-DD string. */
function offsetDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const isCancelOf = (a: Appointment, source: CancellationSource): boolean =>
  a.status === 'canceled' && a.cancellation?.source === source;

/** Type-class abbreviation for scoping cancel groups (P3b). */
function typeClass(a: Appointment): string {
  if (a.type === 'client-session') return 'd';
  if (a.type === 'supervision') return 's';
  return 'p'; // parent-training + case-planning share a 60-day window
}

/**
 * Participant group key for an appointment when measuring `source`. Returns
 * `null` when the appointment lacks the participants needed for that source's
 * grouping (e.g. a bt/bcba metric with no technician).
 *
 * Type-class (d/s/p) is now included so direct and PT/CoC cancels never
 * merge even when they share the same client + source (P3b).
 */
function groupKey(a: Appointment, source: CancellationSource): string | null {
  const client = a.client;
  if (!client) return null;
  const tc = typeClass(a);
  const techScoped = source === 'bt' || source === 'bcba';
  if (techScoped) {
    if (a.type === 'client-session' || a.type === 'supervision') {
      return a.technician ? `ct${tc}:${client}|${a.technician}` : null;
    }
    return `c${tc}:${client}`;
  }
  return `c${tc}:${client}`;
}

/**
 * Walk a group's occurrences (chronological) and return the trailing run of
 * `source` cancels ending exactly at the anchor appointment (P3a fix).
 *
 * Stops at `anchorId` inclusive, so a same-day-later completed session
 * never resets the anchor cancel's own run to 0.
 */
function runAsOf(
  occ: { id: string; match: boolean }[],
  anchorId: string,
): number {
  let run = 0;
  for (const o of occ) {
    run = o.match ? run + 1 : 0;
    if (o.id === anchorId) break;
  }
  return run;
}

/** Count dates falling in [asOf-(windowDays-1), asOf] inclusive (P3c). */
function countInWindow(dates: string[], asOf: string, windowDays = 30): number {
  const lo = offsetDays(asOf, -(windowDays - 1));
  let n = 0;
  for (const d of dates) if (d >= lo && d <= asOf) n++;
  return n;
}

export function computeCancelContext(
  appointments: Appointment[],
): Map<string, CancelContext> {
  const result = new Map<string, CancelContext>();

  // Ghosts are wished-for placeholders — never count.
  const active = appointments.filter(a => !a.isGhost);
  const sorted = [...active].sort((a, b) => a.startTime.localeCompare(b.startTime));

  // Per-source metric anchored at appointment X for a given participant group.
  const metric = (x: Appointment, source: CancellationSource): SourceRun => {
    const key = groupKey(x, source);
    const windowDays = (x.type === 'parent-training' || x.type === 'case-planning') ? 60 : 30;
    if (!key) return { consecutive: 0, rolling30: 0, windowDays };
    const occ: { id: string; match: boolean }[] = [];
    const matchDates: string[] = [];
    for (const a of sorted) {
      if (groupKey(a, source) !== key) continue;
      const match = isCancelOf(a, source);
      occ.push({ id: a.id, match });
      if (match) matchDates.push(dateOf(a));
    }
    return {
      consecutive: runAsOf(occ, x.id),
      rolling30: countInWindow(matchDates, dateOf(x), windowDays),
      windowDays,
    };
  };

  for (const x of sorted) {
    if (x.status !== 'canceled' || !x.cancellation) continue;
    const source = x.cancellation.source;

    const btRun = metric(x, 'bt');
    const family = metric(x, 'family');
    const bcba = metric(x, 'bcba');
    const admin = metric(x, 'admin');

    // BT-across-all-clients rolling-30 (different anchor group: tech only).
    const windowDays = (x.type === 'parent-training' || x.type === 'case-planning') ? 60 : 30;
    const btAllDates = x.technician
      ? sorted
          .filter(a => a.technician === x.technician && isCancelOf(a, 'bt'))
          .map(dateOf)
      : [];
    const btRolling30 = countInWindow(btAllDates, dateOf(x), windowDays);

    // The run that drives this tile = the run for this appointment's own source.
    const own =
      source === 'bt' ? btRun
      : source === 'family' ? family
      : source === 'bcba' ? bcba
      : admin;

    result.set(x.id, {
      source,
      consecutiveForSource: own.consecutive,
      bt: {
        withClientConsecutive: btRun.consecutive,
        perBtCaseRolling30: btRun.rolling30,
        btRolling30,
      },
      family,
      bcba,
      admin,
    });
  }

  return result;
}
