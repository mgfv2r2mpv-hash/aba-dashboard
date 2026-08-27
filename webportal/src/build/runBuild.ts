// Running the deterministic builder from the portal.
//
// The engine itself is shared and pure - the portal adds no scheduling logic. What
// this module owns is the part the app spells out inline in its own build handlers:
// which passes to chase, which week the recurring template anchors on, and the four
// hard guards every proposal must clear before it may touch a calendar. A build that
// skipped them would produce a schedule the app would refuse, from the same data.
import {
  buildSchedule,
  defaultBuilderConfig,
  type BuilderConfig,
  type BuildResult,
} from '@shared/scheduleBuilder';
import {
  applyWishSolution,
  dropPastOps,
  dropInfeasibleTravelOps,
  dropDoubleBookedOps,
} from '@shared/wish';
import { consolidateAdjacentBcba } from '@shared/builderConsolidate';
import { startOfWeek, startOfDay, addWeeks } from 'date-fns';
import type { ScheduleData } from '@shared/types';

/** Which of the builder's three passes to run. */
export type BuildPasses = 'all' | 'direct' | 'supervision' | 'parent-training';

export interface BuildRequest {
  passes: BuildPasses;
  /** 'YYYY-MM-DD' - the Monday whose week becomes the recurring template. */
  weekStart: string;
}

export interface BuildPreview {
  /** What the engine placed and what it could not, straight from the builder. */
  readonly result: BuildResult;
  /** The schedule as it would be if this build were applied. */
  readonly next: ScheduleData;
  /** Sessions this build would add. Zero is a real answer, not a failure. */
  readonly added: number;
}

const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * The soonest Monday that is entirely in the future. The builder places across the
 * whole template week without guarding against `now`, so anchoring on the current
 * week would strand any case whose only window falls on a day already passed.
 */
export function nextTemplateWeek(now: Date): string {
  let week = startOfWeek(now, { weekStartsOn: 1 });
  if (week <= startOfDay(now)) week = addWeeks(week, 1);
  return isoOf(week);
}

export function configFor(data: ScheduleData, req: BuildRequest, now: Date): BuilderConfig {
  const base = defaultBuilderConfig(data, now);
  const passes = {
    all:                { chaseDirect: true,  chaseSupervision: true,  chasePT: true },
    direct:             { chaseDirect: true,  chaseSupervision: false, chasePT: false },
    supervision:        { chaseDirect: false, chaseSupervision: true,  chasePT: false },
    'parent-training':  { chaseDirect: false, chaseSupervision: false, chasePT: true },
  }[req.passes];
  return { ...base, ...passes, weekStart: req.weekStart };
}

/**
 * Builds a proposal and returns it beside the schedule it would produce. Nothing is
 * committed here - the caller shows the preview and decides.
 */
export function runBuild(data: ScheduleData, req: BuildRequest, now: Date = new Date()): BuildPreview {
  const result = buildSchedule(data, configFor(data, req, now), now);

  // The same guards the app applies before any proposal reaches a draft: never place
  // into the past, never double-book the single BCBA, never leave a BCBA no time to
  // drive between two sessions, and fuse adjacent BCBA fragments into one block.
  const safe = consolidateAdjacentBcba(
    dropDoubleBookedOps(dropInfeasibleTravelOps(dropPastOps(result.solution.ops, now), data), data),
    data,
  );

  const next = applyWishSolution(data, { ...result.solution, ops: safe });
  return { result, next, added: next.appointments.length - data.appointments.length };
}
