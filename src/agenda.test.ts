import { describe, it, expect } from 'vitest';
import type { Client, Technician, CompanySettings, ScheduleData } from './types';
import type {
  ClientCompliance, ClientComplianceMetrics, TechCompliance, TechComplianceMetrics,
} from './compliance';
import type { ComplianceCache } from './complianceCache';
import { computeAgenda, agendaFromReports, EMPTY_AGENDA, type AgendaGap } from './agenda';

// ── fixtures ─────────────────────────────────────────────────────────────────
// clientStatus / techStatus only read the metric fields exercised below, and
// agendaFromReports only reads client.id/name, tech.id/name/isRBT — so these
// partial literals stand in for the full roster shapes.
const client = (id: string, name = `Client ${id}`): Client =>
  ({ id, name, availabilityWindows: {} }) as Client;
const tech = (id: string, isRBT: boolean, name = `Tech ${id}`): Technician =>
  ({ id, name, isRBT, assignments: [], availability: {} }) as Technician;

const cm = (pct: number, hoursToGo: number, directHours = 10): ClientComplianceMetrics =>
  ({ directHours, supervisionHours: 0, requiredHours: 0, pct, hoursToGo });

const clientReport = (
  id: string,
  actual: { pct: number; hoursToGo: number },
  projected: { pct: number; hoursToGo: number },
  directHours = 10,
): ClientCompliance => ({
  client: client(id),
  actual: cm(actual.pct, actual.hoursToGo, directHours),
  projected: cm(projected.pct, projected.hoursToGo, directHours),
});

const tm = (companyHoursToGo: number, bacbHoursToGo?: number, directHours = 10): TechComplianceMetrics => ({
  directHours, supervisionHours: 0, pct: 0,
  companyRequiredPct: 5, companyRequiredHours: 0, companyHoursToGo,
  bacbRequiredHours: bacbHoursToGo != null ? 0 : undefined,
  bacbHoursToGo,
});

const techReport = (
  id: string, isRBT: boolean,
  actual: { company: number; bacb?: number },
  projected: { company: number; bacb?: number },
  directHours = 10,
): TechCompliance => ({
  tech: tech(id, isRBT),
  actual: tm(actual.company, actual.bacb, directHours),
  projected: tm(projected.company, projected.bacb, directHours),
});

const settings = (maxPct?: number): CompanySettings =>
  ({ supervisionDirectHoursPercent: 5, supervisionPreferredMinPercent: 15, supervisionMaxHoursPercent: maxPct }) as CompanySettings;

// Behind client: below floor now AND by projection → red.
const behindClient = (id: string, toGo = 1.2) => clientReport(id, { pct: 2, hoursToGo: toGo }, { pct: 3, hoursToGo: toGo });
// Over-served client: above the insurer cap, still projected past the floor → yellow.
const overClient = (id: string) => clientReport(id, { pct: 25, hoursToGo: 0 }, { pct: 25, hoursToGo: 0 });
// Off-pace tech: passes by projection but not yet in actuals → yellow.
const offPaceTech = (id: string) => techReport(id, false, { company: 1 }, { company: 0 });
// Behind tech (RBT): misses both thresholds by projection → red.
const behindTech = (id: string, toGo = 1) => techReport(id, true, { company: 2, bacb: 1 }, { company: toGo, bacb: 0.5 });

describe('agendaFromReports — typed gaps', () => {
  it('produces an empty agenda when nothing is off pace', () => {
    const ok = clientReport('c1', { pct: 30, hoursToGo: 0 }, { pct: 30, hoursToGo: 0 });
    expect(agendaFromReports([ok], [], settings())).toEqual(EMPTY_AGENDA);
  });

  it('labels a below-floor client as a "behind" red gap with the floor detail', () => {
    const { gaps, targetProgress } = agendaFromReports([behindClient('c1', 1.2)], [], settings());
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ entity: 'client', id: 'c1', kind: 'behind', status: 'red', hoursToGo: 1.2 });
    expect(gaps[0].detail).toBe('Projected 3.0% vs 5% floor — 1.2h to go this month.');
    expect(targetProgress).toEqual({ red: 1, yellow: 0, attentionCount: 1 });
  });

  it('labels an over-cap client as an "over-served" yellow gap with the cap detail', () => {
    const { gaps, targetProgress } = agendaFromReports([overClient('c1')], [], settings(20));
    expect(gaps[0]).toMatchObject({ entity: 'client', kind: 'over-served', status: 'yellow' });
    expect(gaps[0].detail).toBe('Supervision at 25.0% — over the 20% insurer cap.');
    expect(targetProgress).toEqual({ red: 0, yellow: 1, attentionCount: 1 });
  });

  it('labels an on-track-but-not-met tech as an "off-pace" yellow gap', () => {
    const { gaps } = agendaFromReports([], [offPaceTech('t1')], settings());
    expect(gaps[0]).toMatchObject({ entity: 'tech', id: 't1', kind: 'off-pace', status: 'yellow' });
    expect(gaps[0].detail).toBe('0.0h of supervision to go for the company target.');
  });

  it('labels a missing-both-thresholds RBT as a "behind" red gap with the RBT detail', () => {
    const { gaps } = agendaFromReports([], [behindTech('t1', 1)], settings());
    expect(gaps[0]).toMatchObject({ entity: 'tech', kind: 'behind', status: 'red', hoursToGo: 1 });
    expect(gaps[0].detail).toBe('1.0h of supervision to go for the BACB floor / company target.');
  });

  it('skips gray (no-hours) and green (met) entities', () => {
    const gray = clientReport('c1', { pct: 0, hoursToGo: 0 }, { pct: 0, hoursToGo: 0 }, 0);
    const green = clientReport('c2', { pct: 30, hoursToGo: 0 }, { pct: 30, hoursToGo: 0 });
    expect(agendaFromReports([gray, green], [], settings()).gaps).toEqual([]);
  });

  it('orders worst-first: red before yellow, client before tech, bigger deficit first', () => {
    const gaps = agendaFromReports(
      [behindClient('cRedSmall', 1), behindClient('cRedBig', 3), overClient('cYellow')],
      [behindTech('tRed', 2), offPaceTech('tYellow')],
      settings(20),
    ).gaps;
    expect(gaps.map(g => g.id)).toEqual(['cRedBig', 'cRedSmall', 'tRed', 'cYellow', 'tYellow']);
  });

  it('keeps attentionCount equal to red + yellow and to gaps.length', () => {
    const { gaps, targetProgress } = agendaFromReports(
      [behindClient('c1'), overClient('c2')],
      [behindTech('t1'), offPaceTech('t2')],
      settings(20),
    );
    expect(targetProgress.attentionCount).toBe(gaps.length);
    expect(targetProgress.attentionCount).toBe(targetProgress.red + targetProgress.yellow);
    expect(targetProgress).toEqual({ red: 2, yellow: 2, attentionCount: 4 });
  });
});

describe('computeAgenda — cache wrapper', () => {
  const data = { settings: settings(20) } as ScheduleData;

  it('returns the empty agenda for a null cache', () => {
    expect(computeAgenda(null, data)).toEqual(EMPTY_AGENDA);
  });

  it('delegates to agendaFromReports over the cache report values', () => {
    const cache = {
      period: { start: new Date(0), end: new Date(0), label: '' },
      now: new Date(0),
      clients: new Map([['c1', behindClient('c1')]]),
      techs: new Map([['t1', offPaceTech('t1')]]),
    } as ComplianceCache;
    expect(computeAgenda(cache, data)).toEqual(
      agendaFromReports([behindClient('c1')], [offPaceTech('t1')], data.settings),
    );
  });
});
