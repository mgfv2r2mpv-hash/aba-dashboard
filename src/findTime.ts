// Local "find a spot" engine for rescheduling (Move This / Replace This).
//
// Given an appointment that needs a new time, propose now-onward candidate slots
// THIS WEEK, ranked per appointment type, plus helpers to apply a chosen slot.
// Pure logic — no AI. (app.tsx offers an AI escape hatch when this comes up empty,
// expanding the search to the rest of the month.)
//
// Per-type rules (BCBA-confirmed):
//   case-planning / reassessment → any free time in the BCBA's availability.
//   supervision  → least-supervised assigned tech first, anchored to that tech's
//                  direct sessions so the supervision actually earns credit.
//   parent-training → overlap a client direct unless the parent is available
//                  outside sessions (then any free BCBA+client slot works).

import { Appointment, ScheduleData, Technician, countsAsSupervision } from './types';
import { overlapHours, monthPeriod } from './compliance';
import { findOpenSlots, SlotCandidate } from './corrections';

export interface MoveOption extends SlotCandidate {
  techId?: string;
  techName?: string;
  improvesCompliance?: boolean;
}

const MS_PER_HOUR = 3_600_000;

export function durationMinutesOf(apt: Appointment): number {
  return Math.round((new Date(apt.endTime).getTime() - new Date(apt.startTime).getTime()) / 60_000);
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Saturday ending the calendar week (Sun–Sat) that contains `now`.
export function endOfWeekYmd(now: Date): string {
  return ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + (6 - now.getDay())));
}

const sameClient = (a: Appointment, id: string, name?: string): boolean =>
  a.client === id || (name !== undefined && a.client === name);

const namesTech = (a: Appointment, tech: Technician): boolean =>
  a.technician === tech.id || a.technician === tech.name;

export function assignedTechsForClient(data: ScheduleData, clientId: string): Technician[] {
  return data.technicians.filter(t => t.assignments.some(a => a.clientId === clientId));
}

// Supervision hours credited to one tech for one case this month. Mirrors the
// compliance model: each supervision-counting session credits its time-overlap
// with that tech's direct (client-session) for the client, capped at the
// session's own length. A type==='supervision' session has no named BT (the BT
// is inferred from the overlap), so it can credit any assigned tech it overlaps.
export function techSupervisionForCase(
  data: ScheduleData, clientId: string, techId: string, now: Date = new Date(),
): number {
  const client = data.clients.find(c => c.id === clientId);
  const tech = data.technicians.find(t => t.id === techId);
  if (!client || !tech) return 0;

  const period = monthPeriod(now);
  const inMonth = (a: Appointment): boolean => {
    const t = new Date(a.startTime).getTime();
    return t >= period.start.getTime() && t < period.end.getTime();
  };
  const live = (a: Appointment): boolean => a.status !== 'canceled' && !a.isGhost;

  const techDirects = data.appointments.filter(a =>
    a.type === 'client-session' && live(a) && inMonth(a) &&
    sameClient(a, client.id, client.name) && namesTech(a, tech));

  const supSessions = data.appointments.filter(a =>
    countsAsSupervision(a) && live(a) && inMonth(a) &&
    sameClient(a, client.id, client.name) &&
    (a.type === 'supervision' || namesTech(a, tech)));

  let total = 0;
  for (const s of supSessions) {
    const dur = (new Date(s.endTime).getTime() - new Date(s.startTime).getTime()) / MS_PER_HOUR;
    let credited = 0;
    for (const d of techDirects) credited += overlapHours(s, d);
    total += Math.min(credited, dur);
  }
  return total;
}

// Assigned techs ordered least-supervised first (for the relevant case).
export function leastSupervisedTechs(
  data: ScheduleData, clientId: string, now: Date = new Date(),
): Technician[] {
  return assignedTechsForClient(data, clientId)
    .map(t => ({ t, hrs: techSupervisionForCase(data, clientId, t.id, now) }))
    .sort((a, b) => a.hrs - b.hrs)
    .map(x => x.t);
}

export function findMoveOptions(
  data: ScheduleData, apt: Appointment, now: Date = new Date(), limit = 8,
): MoveOption[] {
  const durationMinutes = durationMinutesOf(apt);
  const throughDate = endOfWeekYmd(now);
  // Moving frees the appointment's own slot — drop it so it never self-conflicts.
  const base: ScheduleData = { ...data, appointments: data.appointments.filter(a => a.id !== apt.id) };
  const client = apt.client ? data.clients.find(c => c.id === apt.client || c.name === apt.client) : undefined;

  if (apt.type === 'supervision') {
    if (!client) return [];
    const out: MoveOption[] = [];
    for (const t of leastSupervisedTechs(base, client.id, now)) {
      if (out.length >= limit) break;
      const slots = findOpenSlots(base, {
        durationMinutes, clientId: client.id, techId: t.id,
        useClinicianAvailability: true, clinicianBusy: true,
        mustOverlapDirect: true, anchorTechId: t.id,
        fromDate: now, throughDate,
      }, limit - out.length);
      for (const s of slots) out.push({ ...s, techId: t.id, techName: t.name, improvesCompliance: true });
    }
    return out;
  }

  if (apt.type === 'parent-training') {
    if (!client) return [];
    return findOpenSlots(base, {
      durationMinutes, clientId: client.id,
      useClinicianAvailability: true, clinicianBusy: true,
      mustOverlapDirect: client.parentAvailableOutsideSessions !== true,
      fromDate: now, throughDate,
    }, limit).map(s => ({ ...s }));
  }

  // case-planning, reassessment, and other BCBA-led work: free BCBA time.
  return findOpenSlots(base, {
    durationMinutes, useClinicianAvailability: true, clinicianBusy: true,
    fromDate: now, throughDate,
  }, limit).map(s => ({ ...s }));
}

export function applyOption(apt: Appointment, option: MoveOption): Appointment {
  const startTime = `${option.date}T${option.start}:00`;
  const endTime = `${option.date}T${option.end}:00`;
  return option.techId
    ? { ...apt, startTime, endTime, technician: option.techId }
    : { ...apt, startTime, endTime };
}

export function applyManual(apt: Appointment, date: string, start: string, end: string): Appointment {
  return { ...apt, startTime: `${date}T${start}:00`, endTime: `${date}T${end}:00` };
}
