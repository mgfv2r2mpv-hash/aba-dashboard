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
// Data model (BCBA-confirmed):
//   - Supervision appointments carry CLIENT only — no technician field.
//   - Who is being supervised is inferred from whichever direct
//     (client-session) appointments for that client overlap the
//     supervision's time window.
//   - "BCBA solo with the client" = supervision with no overlapping direct
//     for that client. Consumes BCBA hours; counts as 0 toward compliance.
//
// Per-client (case) compliance — implemented here:
//   denominator = direct hours for the client in period
//   numerator   = sum of supervision-vs-direct overlap hours for that
//                 client, capped at each supervision's own duration so
//                 multiple overlapping directs can't double-count.
//
// Per-RBT (BACB 5%) compliance — DEFERRED, but the rule is locked in:
//   denominator = ALL of that RBT's direct hours in period (any client)
//   numerator   = supervision time overlapping any of THIS RBT's direct
//                 sessions (the supervision's tagged client may differ
//                 from the direct's client; that's a data-quality
//                 question we'll surface separately when we add this).
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

  // For each supervision tagged with this client, sum overlap with this
  // client's directs. Cap at the supervision's own length. If the
  // supervision overlaps no directs (BCBA solo with client), it contributes
  // nothing — which falls out of the math without an explicit guard since
  // ov === 0 in that case.
  const supervisionHours = supervision.reduce((s, sup) => {
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
