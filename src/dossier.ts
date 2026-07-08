// dossier.ts — the "doctor my schedule with me" diagnostic.
//
// Given whatever the BCBA is looking at (a selected appointment, or a case),
// buildDossier assembles a plain-language, worst-first read of what's actually
// wrong: touching conflicts, the case's supervision / direct / PT / reassessment
// standing, cliff proximity, and recent cancellation pressure. It is 100% pure
// and local — no network, no AI — so the analysis is honest and free even
// without a Claude key (the key only buys narration + extra fix variants on top).
//
// The card that renders this hands off to the existing meet-pace flow for the
// actual fix, so the dossier's job is purely to name the problems and point at
// the case.

import type { ScheduleData, Appointment, Client, ScheduleConflict } from './types';
import { computeCaseState } from './caseModel';

export type DossierFocus =
  | { kind: 'appointment'; appointmentId: string }
  | { kind: 'case'; clientId: string };

export type DossierSeverity = 'red' | 'yellow' | 'info';

export interface DossierFinding {
  severity: DossierSeverity;
  title: string;
  detail: string;
}

export interface Dossier {
  focusKind: 'appointment' | 'case';
  /** Human label for what's under the lens (client + time, or case name). */
  focusLabel: string;
  /** The case this focus resolves to — drives the "Fix pace" hand-off. */
  clientId?: string;
  /** One-line summary shown as the card's headline. */
  headline: string;
  /** Worst-first. Empty when nothing is flagged. */
  findings: DossierFinding[];
}

const SEV_RANK: Record<DossierSeverity, number> = { red: 0, yellow: 1, info: 2 };
const CANCEL_WINDOW_DAYS = 30;
const AUTH_CLIFF_DAYS = 10; // flag an auth ending within ~a pay cycle

const round1 = (h: number): string => (Math.round(h * 10) / 10).toString();

function resolveClient(data: ScheduleData, ref?: string): Client | undefined {
  if (!ref) return undefined;
  return data.clients.find((c) => c.id === ref || c.name === ref);
}

const matchesClient = (a: Appointment, client: Client): boolean =>
  a.client === client.id || a.client === client.name;

// "Tue Jul 8, 3:00 – 5:00 PM" — compact, locale-formatted, deterministic.
function apptTimeLabel(a: Appointment): string {
  const start = new Date(a.startTime);
  const end = new Date(a.endTime);
  if (isNaN(start.getTime())) return a.title || 'appointment';
  const day = start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const t = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return isNaN(end.getTime()) ? `${day}, ${t(start)}` : `${day}, ${t(start)} – ${t(end)}`;
}

function severityOf(c: ScheduleConflict): DossierSeverity {
  return c.severity === 'error' ? 'red' : c.severity === 'warning' ? 'yellow' : 'info';
}

// Recent cancellations on this case, counted over the trailing window.
function recentCancelCount(data: ScheduleData, client: Client, now: Date): number {
  const cutoff = now.getTime() - CANCEL_WINDOW_DAYS * 86_400_000;
  return data.appointments.filter(
    (a) =>
      a.status === 'canceled' &&
      matchesClient(a, client) &&
      new Date(a.startTime).getTime() >= cutoff,
  ).length;
}

// Case-level findings shared by both the appointment and case lenses.
function caseFindings(data: ScheduleData, client: Client, now: Date): DossierFinding[] {
  const out: DossierFinding[] = [];
  const st = computeCaseState(data, client, now);
  const sup = st.supervision;

  if (sup.gapToFloor > 0.05) {
    out.push({
      severity: 'red',
      title: 'Supervision below floor',
      detail: `${round1(sup.supHoursMonth)}h of ${round1(sup.floorH)}h floor — ${round1(sup.gapToFloor)}h short this month (${Math.round(sup.pct)}% of direct).`,
    });
  } else if (sup.supHoursMonth + 0.05 < sup.preferredH) {
    out.push({
      severity: 'yellow',
      title: 'Supervision under preferred',
      detail: `${round1(sup.supHoursMonth)}h — ${round1(Math.max(0, sup.preferredH - sup.supHoursMonth))}h below the ${sup.preferredMinPct}% preferred band.`,
    });
  }
  if (sup.overCap) {
    out.push({
      severity: 'yellow',
      title: 'Over insurer cap',
      detail: `${round1(sup.supHoursMonth)}h exceeds the ${sup.preferredMaxPct}% cap (${round1(sup.capH)}h).`,
    });
  }
  if (
    sup.contactsRequiredByCadence !== undefined &&
    sup.contactsThisMonth < sup.contactsRequiredByCadence
  ) {
    const need = sup.contactsRequiredByCadence - sup.contactsThisMonth;
    out.push({
      severity: 'yellow',
      title: 'Cadence short',
      detail: `${sup.contactsThisMonth} of ${sup.contactsRequiredByCadence} supervision contact days — ${need} more needed.`,
    });
  }

  if (st.direct.belowTarget) {
    out.push({
      severity: 'yellow',
      title: 'Direct utilization low',
      detail: `${round1(st.direct.actualThisWk)}h scheduled vs ${round1(st.direct.authPerWk)}h authorized this week (${Math.round(st.direct.pctOfAuth)}%).`,
    });
  }

  if (st.parentTraining.gap > 0.05) {
    out.push({
      severity: 'yellow',
      title: 'Parent training short',
      detail: `${round1(st.parentTraining.deliveredMonth)}h of ${round1(st.parentTraining.goalMonth)}h — ${round1(st.parentTraining.gap)}h to go this month.`,
    });
  }

  if (st.reassessment.blockH > 0 && !st.reassessment.paceOk) {
    const due = st.reassessment.daysToInternalDue;
    const when = due === undefined ? 'a draft deadline is near' : due < 0 ? `draft due ${-due}d ago` : `draft due in ${due}d`;
    out.push({
      severity: 'red',
      title: 'Reassessment behind',
      detail: `${round1(st.reassessment.usedH)}h of ${round1(st.reassessment.blockH)}h done — ${when}.`,
    });
  }

  const dse = st.cliffs.daysToServiceEnd;
  if (dse !== undefined && dse >= 0 && dse <= AUTH_CLIFF_DAYS) {
    out.push({
      severity: 'yellow',
      title: 'Authorization ending',
      detail: `Auth ends in ${dse} day${dse === 1 ? '' : 's'} (${st.cliffs.serviceEnd}).`,
    });
  }

  const cancels = recentCancelCount(data, client, now);
  if (cancels >= 3) {
    out.push({
      severity: 'info',
      title: 'Cancellation pressure',
      detail: `${cancels} cancellations on this case in the last ${CANCEL_WINDOW_DAYS} days.`,
    });
  }

  return out;
}

export function buildDossier(
  data: ScheduleData,
  focus: DossierFocus,
  now: Date = new Date(),
  conflicts: ScheduleConflict[] = [],
): Dossier {
  const findings: DossierFinding[] = [];
  let client: Client | undefined;
  let focusLabel: string;
  const focusKind = focus.kind;

  if (focus.kind === 'appointment') {
    const appt = data.appointments.find((a) => a.id === focus.appointmentId);
    if (!appt) {
      return { focusKind, focusLabel: 'this appointment', headline: 'That appointment is no longer on the schedule.', findings: [] };
    }
    client = resolveClient(data, appt.client);
    focusLabel = client ? `${client.name} · ${apptTimeLabel(appt)}` : apptTimeLabel(appt);

    // Conflicts touching this exact appointment come first — they're the most
    // literal answer to "what's wrong here".
    for (const c of conflicts) {
      if (c.affectedAppointments?.includes(appt.id)) {
        findings.push({ severity: severityOf(c), title: conflictTitle(c.type), detail: c.message });
      }
    }
    if (appt.status === 'canceled') {
      findings.push({ severity: 'info', title: 'Session canceled', detail: 'This session is canceled and excluded from all totals.' });
    }
    if (appt.isGhost) {
      findings.push({ severity: 'info', title: 'Unplaced (ghost)', detail: 'Logged as a reminder but not counted — it never found a real slot.' });
    }
  } else {
    client = resolveClient(data, focus.clientId);
    focusLabel = client ? client.name : 'this case';
  }

  if (client) findings.push(...caseFindings(data, client, now));

  findings.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);

  const reds = findings.filter((f) => f.severity === 'red').length;
  const yellows = findings.filter((f) => f.severity === 'yellow').length;
  const headline =
    findings.length === 0
      ? 'Nothing flagged — this looks on track.'
      : reds > 0
        ? `${reds} thing${reds === 1 ? '' : 's'} to fix${yellows ? `, ${yellows} to watch` : ''}.`
        : `${yellows} thing${yellows === 1 ? '' : 's'} to watch.`;

  return { focusKind, focusLabel, clientId: client?.id, headline, findings };
}

function conflictTitle(type: ScheduleConflict['type']): string {
  switch (type) {
    case 'supervision-violation': return 'Supervision gap';
    case 'training-violation': return 'Training gap';
    case 'availability-conflict': return 'Availability conflict';
    case 'scheduling-impossible': return 'Unschedulable';
    default: return 'Conflict';
  }
}
