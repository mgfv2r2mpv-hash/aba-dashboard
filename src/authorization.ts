import {
  Appointment,
  Authorization,
  AuthBucketKey,
  AUTH_BUCKETS,
  Client,
  CompanySettings,
  ManualUsage,
  ReportLead,
  ScheduleData,
} from './types';

// Which auth bucket an appointment consumes. Internal tasks / other consume none.
export function bucketOfAppointment(a: Appointment): AuthBucketKey | null {
  switch (a.type) {
    case 'client-session': return 'direct';
    case 'supervision': return 'supervision';
    case 'parent-training': return 'parentTraining';
    case 'reassessment': return 'reassessment';
    case 'case-planning': return 'casePlanning';
    default: return null;
  }
}

export interface BucketUsage {
  authorized: number;
  completed: number;   // finalized appointments in span
  scheduled: number;   // still on the books (not canceled/completed)
  manual: number;      // hours entered manually (outside-system delivery)
  used: number;        // completed + manual
  projected: number;   // used + scheduled
  remaining: number;   // authorized - projected (negative = over-auth)
}

export interface AuthUsage {
  auth: Authorization;
  client?: Client;
  daysLeft: number;    // calendar days from `now` to endDate (negative = expired)
  buckets: { key: AuthBucketKey; label: string; usage: BucketUsage }[];
}

function durationHours(a: Appointment): number {
  const ms = new Date(a.endTime).getTime() - new Date(a.startTime).getTime();
  return ms > 0 ? ms / 3_600_000 : 0;
}

function matchesClient(ref: string | undefined, client: Client | undefined, clientId: string): boolean {
  if (!ref) return false;
  if (ref === clientId) return true;
  return !!client && ref === client.name;
}

export function inAuthSpan(dateStr: string, auth: Authorization): boolean {
  // YYYY-MM-DD strings compare lexicographically; endDate is inclusive.
  return dateStr >= auth.startDate && dateStr <= auth.endDate;
}

// Internal report submission milestones, computed back from the auth end date
// using company policy. Both are internal back-office deadlines, not insurer
// dates. A stored per-auth value (reportDraftDue / reportFinalDue) overrides
// the computed date when present.
export interface ReportDates {
  initialDraftDue: string; // YYYY-MM-DD, the earlier milestone
  finalDraftDue: string;   // YYYY-MM-DD
}

const DEFAULT_DRAFT_LEAD: ReportLead = { value: 4, unit: 'weeks' };
const DEFAULT_FINAL_LEAD: ReportLead = { value: 2, unit: 'weeks' };

function leadToDays(lead: ReportLead | undefined, fallback: ReportLead): number {
  const l = lead ?? fallback;
  return l.unit === 'weeks' ? l.value * 7 : l.value;
}

function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function minusDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() - days);
  return ymdLocal(d);
}

export function computeReportDates(auth: Authorization, settings: CompanySettings): ReportDates {
  const draftDays = leadToDays(settings.reportDraftLead, DEFAULT_DRAFT_LEAD);
  const finalDays = leadToDays(settings.reportFinalLead, DEFAULT_FINAL_LEAD);
  return {
    initialDraftDue: auth.reportDraftDue || minusDays(auth.endDate, draftDays),
    finalDraftDue: auth.reportFinalDue || minusDays(auth.endDate, finalDays),
  };
}

export function computeAuthUsage(data: ScheduleData, auth: Authorization, now: Date = new Date()): AuthUsage {
  const client = data.clients.find(c => c.id === auth.clientId);
  const manual = (data.manualUsage || []).filter(
    m => m.clientId === auth.clientId && inAuthSpan(m.date, auth)
  );
  const appts = data.appointments.filter(a =>
    matchesClient(a.client, client, auth.clientId) && inAuthSpan(a.startTime.slice(0, 10), auth)
  );

  const buckets = AUTH_BUCKETS.map(({ key, label }) => {
    const authorized = auth.buckets[key] ?? 0;
    let completed = 0;
    let scheduled = 0;
    for (const a of appts) {
      if (bucketOfAppointment(a) !== key) continue;
      if (a.status === 'canceled') continue;
      if (a.status === 'completed') completed += durationHours(a);
      else scheduled += durationHours(a);
    }
    const manualH = manual.filter(m => m.bucket === key).reduce((s, m) => s + m.hours, 0);
    const used = completed + manualH;
    const projected = used + scheduled;
    return {
      key,
      label,
      usage: {
        authorized, completed, scheduled,
        manual: manualH, used, projected,
        remaining: authorized - projected,
      },
    };
  });

  const end = new Date(`${auth.endDate}T23:59:59`);
  const daysLeft = Math.floor((end.getTime() - now.getTime()) / 86_400_000);

  return { auth, client, daysLeft, buckets };
}

// The authorization (if any) covering a given client + date. When several
// overlap, the one ending soonest wins — that's the cliff that matters.
export function findAuthFor(data: ScheduleData, clientRef: string, dateStr: string): Authorization | undefined {
  const matches = (data.authorizations || []).filter(auth => {
    const client = data.clients.find(c => c.id === auth.clientId);
    return (auth.clientId === clientRef || client?.name === clientRef) && inAuthSpan(dateStr, auth);
  });
  return matches.sort((a, b) => a.endDate.localeCompare(b.endDate))[0];
}

export interface MakeupCandidate {
  appointment: Appointment;   // the canceled session
  hours: number;              // its full duration
  madeUpHours: number;        // hours of non-canceled make-ups pointing at it
  remainingHours: number;
}

// Canceled sessions for this client, within the auth covering `dateStr` (or the
// same calendar month when no auth covers it), that aren't fully made up yet.
export function makeupCandidates(
  data: ScheduleData,
  clientRef: string,
  dateStr: string,
  excludeId?: string,
): MakeupCandidate[] {
  const auth = findAuthFor(data, clientRef, dateStr);
  const inSpan = (d: string) => auth ? inAuthSpan(d, auth) : d.slice(0, 7) === dateStr.slice(0, 7);
  const client = data.clients.find(c => c.id === clientRef || c.name === clientRef);

  return data.appointments
    .filter(a =>
      a.status === 'canceled' &&
      matchesClient(a.client, client, clientRef) &&
      inSpan(a.startTime.slice(0, 10))
    )
    .map(canceled => {
      const hours = durationHours(canceled);
      const madeUpHours = data.appointments
        .filter(m => m.makeupForId === canceled.id && m.status !== 'canceled' && m.id !== excludeId)
        .reduce((s, m) => s + durationHours(m), 0);
      return { appointment: canceled, hours, madeUpHours, remainingHours: Math.max(0, hours - madeUpHours) };
    })
    .filter(c => c.remainingHours > 0.01)
    .sort((a, b) => a.appointment.startTime.localeCompare(b.appointment.startTime));
}
