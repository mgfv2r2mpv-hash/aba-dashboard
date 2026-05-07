import { Appointment, Client, ScheduleData } from './types';

export interface ClientComplianceMetrics {
  directHours: number;
  supervisionHours: number;
  requiredHours: number;
  pct: number;
  hoursToGo: number;
}

export interface ClientCompliance {
  client: Client;
  actual: ClientComplianceMetrics;
  projected: ClientComplianceMetrics;
}

export interface CompliancePeriod {
  start: Date;
  end: Date;
  label: string;
}

// Returns [start, end) for the calendar month containing `ref`.
export function monthPeriod(ref: Date): CompliancePeriod {
  const start = new Date(ref.getFullYear(), ref.getMonth(), 1);
  const end = new Date(ref.getFullYear(), ref.getMonth() + 1, 1);
  const label = start.toLocaleString(undefined, { month: 'long', year: 'numeric' });
  return { start, end, label };
}

// Per-client supervision compliance, computed two ways per the QA spec:
//   actual    = sessions whose startTime <= now and !canceled (presumed happened)
//   projected = actual + future scheduled sessions (everything !canceled)
//
// Compliance counting rule (per client):
//   A supervision counts toward Client X's supervision compliance iff
//     1. it is tagged with Client X,
//     2. it has a technician assigned (any tech — the BCBA is observing
//        someone delivering service), and
//     3. it time-overlaps any direct (client-session) appointment for
//        Client X (any tech, since case supervision is about the case).
//
// A supervision tagged with the client but with no tech ("BCBA solo with
// the client") consumes BCBA hours but doesn't count toward compliance,
// because there's no tech-during-session to observe.
//
// (Per-RBT BACB 5% compliance, when added later, applies a different rule:
// any supervision with THAT specific tech, any client. Deferred.)
//
// Overlap is summed in hours and capped at the supervision's own duration
// so multiple overlapping directs can't push it over 100% of itself.
export function computeClientCompliance(
  data: ScheduleData,
  period: CompliancePeriod,
  now: Date = new Date(),
): ClientCompliance[] {
  return data.clients.map(client => ({
    client,
    actual: computeMetrics(data, client, period, 'actual', now),
    projected: computeMetrics(data, client, period, 'projected', now),
  }));
}

function computeMetrics(
  data: ScheduleData,
  client: Client,
  period: CompliancePeriod,
  scope: 'actual' | 'projected',
  now: Date,
): ClientComplianceMetrics {
  const targetPct = data.settings.supervisionDirectHoursPercent || 5;
  const startMs = period.start.getTime();
  const endMs = period.end.getTime();

  const inScope = (a: Appointment) => {
    if (a.status === 'canceled') return false;
    if (scope === 'projected') return true;
    return new Date(a.startTime).getTime() <= now.getTime();
  };
  const inPeriod = (a: Appointment) => {
    const t = new Date(a.startTime).getTime();
    return t >= startMs && t < endMs;
  };
  const matches = (a: Appointment) =>
    a.client === client.id || a.client === client.name;

  const direct = data.appointments.filter(a =>
    matches(a) && a.type === 'client-session' && inPeriod(a) && inScope(a)
  );
  const supervision = data.appointments.filter(a =>
    matches(a) && a.type === 'supervision' && inPeriod(a) && inScope(a)
  );

  const directHours = direct.reduce((s, a) => s + duration(a), 0);

  const supervisionHours = supervision.reduce((s, sup) => {
    if (!sup.technician) return s; // BCBA solo with client → 0 compliance
    // For case compliance, any direct session for this client by any tech
    // counts as the observation target — no need for the supervision's tech
    // and the direct's tech to match.
    const supDur = duration(sup);
    const ov = direct.reduce((acc, d) => acc + overlapHours(sup, d), 0);
    return s + Math.min(ov, supDur);
  }, 0);

  const requiredHours = (directHours * targetPct) / 100;
  const pct = directHours > 0 ? (supervisionHours / directHours) * 100 : 0;
  const hoursToGo = Math.max(0, requiredHours - supervisionHours);

  return { directHours, supervisionHours, requiredHours, pct, hoursToGo };
}

// Past-dated, non-canceled, not-yet-completed appointments. Surfaced in the
// dashboard so the BCBA can finalize them into the actual roll.
export function pastIncompleteAppointments(
  data: ScheduleData,
  now: Date = new Date(),
): Appointment[] {
  const nowMs = now.getTime();
  return data.appointments
    .filter(a =>
      a.status !== 'canceled' &&
      a.status !== 'completed' &&
      new Date(a.startTime).getTime() <= nowMs
    )
    .sort((a, b) =>
      new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    );
}

function duration(a: Appointment): number {
  return (new Date(a.endTime).getTime() - new Date(a.startTime).getTime()) / 3_600_000;
}

function overlapHours(a: Appointment, b: Appointment): number {
  const aS = new Date(a.startTime).getTime();
  const aE = new Date(a.endTime).getTime();
  const bS = new Date(b.startTime).getTime();
  const bE = new Date(b.endTime).getTime();
  const start = Math.max(aS, bS);
  const end = Math.min(aE, bE);
  return Math.max(0, (end - start) / 3_600_000);
}
