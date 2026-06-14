import { Appointment, Client, ScheduleData, Technician, BACB_RBT_SUPERVISION_MIN_PERCENT, countsAsSupervision } from './types';

// Resolve a technician reference (id OR name, as stored on appointments) to a
// stable id so a supervision session and a direct session that name the same BT
// in different forms still match.
function makeTechResolver(data: ScheduleData): (ref?: string) => string | undefined {
  const byId = new Map(data.technicians.map(t => [t.id, t.id]));
  const byName = new Map(data.technicians.map(t => [t.name, t.id]));
  return (ref?: string) => (ref ? (byId.get(ref) ?? byName.get(ref) ?? ref) : undefined);
}

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

export interface TechComplianceMetrics {
  directHours: number;
  supervisionHours: number;
  pct: number;
  // BACB hard floor (5%) for RBTs only; undefined for non-RBT.
  bacbRequiredHours?: number;
  bacbHoursToGo?: number;
  // Company target. Always present.
  companyRequiredPct: number;
  companyRequiredHours: number;
  companyHoursToGo: number;
}

export interface TechCompliance {
  tech: Technician;
  actual: TechComplianceMetrics;
  projected: TechComplianceMetrics;
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
//   - Supervision-counting sessions are supervision, parent-training, and
//     case-planning (coordination). Each NAMES the BT being observed in its
//     technician field (the supervisee — these stay BCBA billable). Other types
//     never count toward supervision.
//   - A session only earns supervision credit when it names a BT AND that BT's
//     direct (client-session) overlaps it in time. Credit = the overlapping
//     hours (partial overlap → partial credit; e.g. the BT leaves and parent
//     training continues). No BT named, or no overlap → 0 credit.
//
// Per-client (case) compliance — implemented here:
//   denominator = direct hours for the client in period
//   numerator   = for each supervision-counting session tagged with this client,
//                 its overlap with the NAMED BT's directs FOR THIS CLIENT, capped
//                 at the session's own duration.
//
// Per-RBT compliance:
//   denominator = ALL of that RBT's direct hours in period (any client)
//   numerator   = overlap of the sessions that name THIS RBT with that RBT's
//                 own direct sessions.
export function computeClientCompliance(
  data: ScheduleData,
  period: CompliancePeriod,
  now: Date = new Date(),
): ClientCompliance[] {
  return data.clients.map(client => computeOneClientCompliance(data, client, period, now));
}

// Single-client compliance — the unit the incremental cache recomputes when an
// appointment touching this client changes. `computeClientCompliance` is just a
// map over this, so the two can never drift.
export function computeOneClientCompliance(
  data: ScheduleData,
  client: Client,
  period: CompliancePeriod,
  now: Date = new Date(),
): ClientCompliance {
  return {
    client,
    actual: computeMetrics(data, client, period, 'actual', now),
    projected: computeMetrics(data, client, period, 'projected', now),
  };
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
    if (a.status === 'canceled' || a.isGhost) return false;
    if (scope === 'projected') return true;
    return new Date(a.startTime).getTime() <= now.getTime();
  };
  const inPeriod = (a: Appointment) => {
    const t = new Date(a.startTime).getTime();
    return t >= startMs && t < endMs;
  };
  const matches = (a: Appointment) =>
    a.client === client.id || a.client === client.name;
  const resolveTech = makeTechResolver(data);

  const direct = data.appointments.filter(a =>
    matches(a) && a.type === 'client-session' && inPeriod(a) && inScope(a)
  );
  const supervision = data.appointments.filter(a =>
    matches(a) && countsAsSupervision(a) && inPeriod(a) && inScope(a)
  );

  const directHours = direct.reduce((s, a) => s + duration(a), 0);

  // For each supervision-counting session tagged with this client, credit its
  // overlap with the NAMED BT's direct sessions for this client (capped at the
  // session's own length so multiple overlapping directs can't double-count). A
  // session that names no BT — or whose BT isn't in a direct then — earns 0.
  const supervisionHours = supervision.reduce((s, sup) => {
    const supDur = duration(sup);
    const supTech = resolveTech(sup.technician);
    const ov = direct.reduce((acc, d) =>
      acc + (resolveTech(d.technician) === supTech ? overlapHours(sup, d) : 0), 0);
    return s + Math.min(ov, supDur);
  }, 0);

  const requiredHours = (directHours * targetPct) / 100;
  const pct = directHours > 0 ? (supervisionHours / directHours) * 100 : 0;
  const hoursToGo = Math.max(0, requiredHours - supervisionHours);

  return { directHours, supervisionHours, requiredHours, pct, hoursToGo };
}

// Per-tech supervision compliance.
//
// Denominator: ALL of this tech's direct hours in the period (any client).
// Numerator:   sum of supervision-vs-direct overlap hours where the direct
//              is delivered by THIS tech. The supervision's tagged client
//              and the tech's session client should typically match (BCBA
//              physically observing the tech-with-client) but we don't gate
//              on that — overlap is what determines presence.
//
// Two thresholds for RBTs (BACB hard 5% + company target). One for non-RBT
// techs (company target only). Cards fail if any applicable threshold misses.
export function computeTechCompliance(
  data: ScheduleData,
  period: CompliancePeriod,
  now: Date = new Date(),
): TechCompliance[] {
  return data.technicians.map(tech => computeOneTechCompliance(data, tech, period, now));
}

// Single-technician compliance — the per-entity unit the incremental cache
// recomputes. `computeTechCompliance` maps over this.
export function computeOneTechCompliance(
  data: ScheduleData,
  tech: Technician,
  period: CompliancePeriod,
  now: Date = new Date(),
): TechCompliance {
  return {
    tech,
    actual: computeTechMetrics(data, tech, period, 'actual', now),
    projected: computeTechMetrics(data, tech, period, 'projected', now),
  };
}

function computeTechMetrics(
  data: ScheduleData,
  tech: Technician,
  period: CompliancePeriod,
  scope: 'actual' | 'projected',
  now: Date,
): TechComplianceMetrics {
  const startMs = period.start.getTime();
  const endMs = period.end.getTime();
  const inScope = (a: Appointment) => {
    if (a.status === 'canceled' || a.isGhost) return false;
    if (scope === 'projected') return true;
    return new Date(a.startTime).getTime() <= now.getTime();
  };
  const inPeriod = (a: Appointment) => {
    const t = new Date(a.startTime).getTime();
    return t >= startMs && t < endMs;
  };
  const resolveTech = makeTechResolver(data);
  const techId = tech.id;
  const matchesTech = (a: Appointment) => resolveTech(a.technician) === techId;

  const direct = data.appointments.filter(a =>
    matchesTech(a) && a.type === 'client-session' && inPeriod(a) && inScope(a)
  );
  // Supervision-counting sessions that name THIS tech as the observee.
  const supervisions = data.appointments.filter(a =>
    countsAsSupervision(a) && matchesTech(a) && inPeriod(a) && inScope(a)
  );

  const directHours = direct.reduce((s, a) => s + duration(a), 0);

  const supervisionHours = supervisions.reduce((s, sup) => {
    const supDur = duration(sup);
    const ov = direct.reduce((acc, d) => acc + overlapHours(sup, d), 0);
    return s + Math.min(ov, supDur);
  }, 0);

  const pct = directHours > 0 ? (supervisionHours / directHours) * 100 : 0;

  const companyPct = tech.isRBT
    ? (data.settings.supervisionRBTHoursPercent ?? BACB_RBT_SUPERVISION_MIN_PERCENT)
    : (data.settings.supervisionTechHoursPercent ?? 0);
  const companyRequiredHours = (directHours * companyPct) / 100;
  const companyHoursToGo = Math.max(0, companyRequiredHours - supervisionHours);

  const result: TechComplianceMetrics = {
    directHours,
    supervisionHours,
    pct,
    companyRequiredPct: companyPct,
    companyRequiredHours,
    companyHoursToGo,
  };

  if (tech.isRBT) {
    const bacbRequired = (directHours * BACB_RBT_SUPERVISION_MIN_PERCENT) / 100;
    result.bacbRequiredHours = bacbRequired;
    result.bacbHoursToGo = Math.max(0, bacbRequired - supervisionHours);
  }

  return result;
}

// BACB cadence: distinct calendar days in the period where a supervision
// appointment overlaps one of this tech's direct sessions. Every counted
// contact is an observed overlap, satisfying the "at least one observation"
// requirement inherently.
export function computeTechContactDays(
  data: ScheduleData,
  tech: Technician,
  period: CompliancePeriod,
  scope: 'actual' | 'projected',
  now: Date = new Date(),
): number {
  const startMs = period.start.getTime();
  const endMs = period.end.getTime();
  const inScope = (a: Appointment) => {
    if (a.status === 'canceled' || a.isGhost) return false;
    if (scope === 'projected') return true;
    return new Date(a.startTime).getTime() <= now.getTime();
  };
  const inPeriod = (a: Appointment) => {
    const t = new Date(a.startTime).getTime();
    return t >= startMs && t < endMs;
  };
  const resolveTech = makeTechResolver(data);
  const techId = tech.id;
  const matchesTech = (a: Appointment) => resolveTech(a.technician) === techId;

  const direct = data.appointments.filter(a =>
    matchesTech(a) && a.type === 'client-session' && inPeriod(a) && inScope(a)
  );
  const supervisions = data.appointments.filter(a =>
    countsAsSupervision(a) && matchesTech(a) && inPeriod(a) && inScope(a)
  );

  const days = new Set<string>();
  for (const sup of supervisions) {
    if (direct.some(d => overlapHours(sup, d) > 0)) {
      days.add(sup.startTime.slice(0, 10));
    }
  }
  return days.size;
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
      !a.isGhost &&
      new Date(a.startTime).getTime() <= nowMs
    )
    .sort((a, b) =>
      new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    );
}

function duration(a: Appointment): number {
  return (new Date(a.endTime).getTime() - new Date(a.startTime).getTime()) / 3_600_000;
}

export function overlapHours(a: Appointment, b: Appointment): number {
  const aS = new Date(a.startTime).getTime();
  const aE = new Date(a.endTime).getTime();
  const bS = new Date(b.startTime).getTime();
  const bE = new Date(b.endTime).getTime();
  const start = Math.max(aS, bS);
  const end = Math.min(aE, bE);
  return Math.max(0, (end - start) / 3_600_000);
}
