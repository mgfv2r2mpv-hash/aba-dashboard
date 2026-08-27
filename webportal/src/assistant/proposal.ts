// Turning sAssI's ops into something a BCBA can decide about.
//
// A chat turn hands back a complete proposal as ops. The app previews those on its
// calendar and in a draft tray; the portal has neither yet, so the proposal has to
// read as sentences before it is applied. Ops arrive de-anonymized (parseToolTurn
// maps the tokens back through the reverse map), so the ids here are real ids and
// the names come from the caller's own schedule - nothing in this module talks to
// anything outside the browser.
import { format } from 'date-fns';
import { applyWishSolution } from '@shared/wish';
import type { ScheduleData, WishOp } from '@shared/types';

export interface Proposal {
  readonly ops: WishOp[];
  /** The schedule as it would be if this proposal were applied. */
  readonly next: ScheduleData;
  /** One plain sentence per op, in the order the assistant proposed them. */
  readonly lines: string[];
  /** Sessions gained (or lost, when negative) if it is applied. */
  readonly netSessions: number;
}

const TYPE_LABEL: Record<string, string> = {
  'client-session': 'a direct session',
  'supervision': 'supervision',
  'parent-training': 'parent training',
  'case-planning': 'case planning',
  'reassessment': 'a reassessment',
  'other': 'a session',
};

const when = (iso: string): string => {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso : format(at, 'EEE MMM d, h:mm a');
};

const span = (startIso: string, endIso: string): string => {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return when(startIso);
  return `${format(start, 'EEE MMM d, h:mm a')} to ${format(end, 'h:mm a')}`;
};

export function describeOp(op: WishOp, data: ScheduleData): string {
  // An op's entity reference comes back through the reverse map, which holds NAMES
  // (buildAnonymizationMap registers each entity under both its id and its name, and
  // stores the name against the token). The builder writes names into appointments
  // too. Match on either, so a reference resolves whichever half of the pair it is.
  const clientName = (ref?: string) => data.clients.find(c => c.id === ref || c.name === ref)?.name ?? 'a case';
  const techName = (ref?: string) => data.technicians.find(t => t.id === ref || t.name === ref)?.name ?? 'a technician';
  const session = (id: string) => {
    const appt = data.appointments.find(a => a.id === id);
    if (!appt) return 'a session';
    return `${TYPE_LABEL[appt.type] ?? 'a session'} on ${when(appt.startTime)}`;
  };

  switch (op.op) {
    case 'add':
      return `Add ${TYPE_LABEL[op.type] ?? 'a session'} for ${clientName(op.client)}`
        + `${op.technician ? ` with ${techName(op.technician)}` : ''}, ${span(op.start, op.end)}.`;
    case 'move':
      return `Move ${session(op.appointmentId)} to ${span(op.start, op.end)}.`;
    case 'remove':
      return `Remove ${session(op.appointmentId)}.`;
    case 'setFixed':
      return `${op.isFixed ? 'Lock' : 'Unlock'} ${session(op.appointmentId)}.`;
    case 'complete':
      return `Mark ${session(op.appointmentId)} complete.`;
    case 'cancel':
      return `Cancel ${session(op.appointmentId)} (${op.reason}, ${op.unplanned ? 'unplanned' : 'planned'}).`;
    case 'blackout':
      return `Mark ${op.entityType === 'client' ? clientName(op.entity) : techName(op.entity)} away on ${op.date}.`;
    case 'setHint':
      return `Remember a scheduling preference for ${clientName(op.client)}.`;
    case 'regroup':
      return `Group ${op.appointmentIds.length} sessions into one series.`;
    default:
      return 'One change to the schedule.';
  }
}

/**
 * The schedule this proposal would produce, plus the sentences describing it.
 * Nothing is committed - the caller holds this until the BCBA applies or discards.
 */
export function buildProposal(data: ScheduleData, ops: WishOp[]): Proposal {
  const next = applyWishSolution(data, { id: 'sassi-proposal', summary: '', reasoning: '', ops });
  const live = (schedule: ScheduleData) => schedule.appointments.filter(a => a.status !== 'canceled').length;
  return {
    ops,
    next,
    lines: ops.map(op => describeOp(op, data)),
    netSessions: live(next) - live(data),
  };
}
