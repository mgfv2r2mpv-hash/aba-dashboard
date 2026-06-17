// Conditional Probability Recording (CPR) statistics engine.
//
// Methods follow:
//   Vollmer et al. (1993). JABA 26(2), 269–278.
//   Bakeman & Gottman (1997). Observing Interaction, 2nd ed. Cambridge UP.
//   Sackett (1979). Lag sequential analysis as a data reduction technique.
//
// Window approach: treat lagWindowMs as one "observation interval" — consistent
// with Vollmer's 10-second interval method applied to event-based recording.

import type {
  CprSession, CprAnalysis, AntecedentResult, ConsequenceResult,
  EventFreqRow, LagResult, LagPoint, FunctionSummary, ObservationEvent,
} from './types';
import { FUNCTION_LABELS } from './defaults';

// ---- helpers ---------------------------------------------------------------

function eventsOf(events: ObservationEvent[], codeId: string): ObservationEvent[] {
  return events.filter(e => e.codeId === codeId);
}

// Count events of targetId occurring within [ts_ref + fromMs, ts_ref + toMs].
function countInWindow(
  events: ObservationEvent[],
  targetId: string,
  refTs: number,
  fromMs: number,
  toMs: number,
): boolean {
  return events.some(e => e.codeId === targetId && e.ts > refTs + fromMs && e.ts <= refTs + toMs);
}

// Yule's Q from a 2×2 table (a=true-pos, b=false-pos, c=false-neg, d=true-neg).
// Q = (ad − bc) / (ad + bc). Returns 0 when table is degenerate.
function yulesQ(a: number, b: number, c: number, d: number): number {
  const num = a * d - b * c;
  const den = a * d + b * c;
  return den < 1e-9 ? 0 : num / den;
}

// Bakeman & Gottman (1997) z-score for conditional vs. unconditional probability.
// z = (p_cond − p_uncond) / sqrt(p_uncond × (1 − p_uncond) / n)
function zScore(pCond: number, pUncond: number, n: number): number {
  if (n <= 0) return 0;
  const se = Math.sqrt((pUncond * (1 - pUncond)) / n);
  return se < 1e-9 ? 0 : (pCond - pUncond) / se;
}

// ---- main analysis ---------------------------------------------------------

export function computeCprAnalysis(session: CprSession): CprAnalysis {
  const {
    events, codeSetSnapshot, lagEnabled, lagWindowMs, lagCount,
    targetBehaviorId, durationMs,
  } = session;

  const W = lagWindowMs;
  const totalIntervals = Math.max(Math.ceil(durationMs / W), 1);
  const durationHours = durationMs / 3_600_000;

  const antecedents = codeSetSnapshot.codes.filter(c => c.category === 'antecedent');
  const behaviors   = codeSetSnapshot.codes.filter(c => c.category === 'behavior');
  const consequences = codeSetSnapshot.codes.filter(c => c.category === 'consequence');
  const targetBehavior = codeSetSnapshot.codes.find(c => c.id === targetBehaviorId)
    ?? behaviors[0];

  // ---- event frequency table -----------------------------------------------
  const allCodes = codeSetSnapshot.codes;
  const eventFreq: EventFreqRow[] = allCodes
    .map(code => {
      const count = eventsOf(events, code.id).length;
      return {
        codeId: code.id,
        label: code.label,
        abbr: code.abbr,
        category: code.category,
        color: code.color,
        count,
        pct: events.length > 0 ? count / events.length : 0,
        ratePerHour: durationHours > 0 ? count / durationHours : 0,
      };
    })
    .filter(r => r.count > 0)
    .sort((a, b) => {
      const order = { antecedent: 0, behavior: 1, consequence: 2 };
      return order[a.category] - order[b.category] || b.count - a.count;
    });

  const bEvents = eventsOf(events, targetBehavior?.id ?? '');
  const nB = bEvents.length;
  const behaviorCount = nB;
  const behaviorRatePerHour = durationHours > 0 ? nB / durationHours : 0;

  // ---- antecedent analysis -------------------------------------------------
  // P(A | B): for each B event, was A present in the preceding W ms?
  // P(A) unconditional: nA / totalIntervals
  // z-score tests whether A occurs more often before B than expected by chance.
  const antecedentResults: AntecedentResult[] = antecedents.map(ant => {
    const aEvents = eventsOf(events, ant.id);
    const nA = aEvents.length;
    const pAuncond = Math.min(nA / totalIntervals, 1);

    // For each B, look backward W ms
    let hitBA = 0;
    for (const be of bEvents) {
      if (countInWindow(events, ant.id, be.ts - W, 0, W)) hitBA++;
    }
    const pAgivenB = nB > 0 ? hitBA / nB : 0;

    // P(B | A): for each A, look forward W ms
    let hitAB = 0;
    for (const ae of aEvents) {
      if (countInWindow(events, targetBehavior?.id ?? '', ae.ts, 0, W)) hitAB++;
    }
    const pBgivenA = nA > 0 ? hitAB / nA : 0;

    // 2×2 table: rows = A occurred/absent, cols = B occurred/absent
    const a = hitBA;                         // A before B
    const b = nA - hitAB;                   // A without B
    const c = nB - hitBA;                   // B without preceding A
    const d = Math.max(totalIntervals - nA - c, 0); // neither
    const q = yulesQ(a, d, b, c);

    const z = zScore(pAgivenB, pAuncond, nB);

    return {
      antecedentId: ant.id,
      antecedentLabel: ant.label,
      behaviorId: targetBehavior?.id ?? '',
      behaviorLabel: targetBehavior?.label ?? '',
      nA,
      nB,
      hitBA,
      pAgivenB,
      pAuncond,
      pBgivenA,
      yulesQ: q,
      z,
      significant: Math.abs(z) >= 1.96,
    };
  });

  // ---- consequence analysis ------------------------------------------------
  // P(C | B): for each B event, was C present in the following W ms?
  const consequenceResults: ConsequenceResult[] = consequences.map(con => {
    const cEvents = eventsOf(events, con.id);
    const nC = cEvents.length;
    const pCuncond = Math.min(nC / totalIntervals, 1);

    let hitCB = 0;
    for (const be of bEvents) {
      if (countInWindow(events, con.id, be.ts, 0, W)) hitCB++;
    }
    const pCgivenB = nB > 0 ? hitCB / nB : 0;

    // 2×2 table
    const a = hitCB;
    const b = nB - hitCB;
    const c = nC - hitCB;
    const d = Math.max(totalIntervals - nB - c, 0);
    const q = yulesQ(a, d, b, c);

    const z = zScore(pCgivenB, pCuncond, nB);

    return {
      consequenceId: con.id,
      consequenceLabel: con.label,
      behaviorId: targetBehavior?.id ?? '',
      behaviorLabel: targetBehavior?.label ?? '',
      functionHypothesis: con.functionHypothesis,
      nB,
      hitCB,
      pCgivenB,
      pCuncond,
      yulesQ: q,
      z,
      significant: Math.abs(z) >= 1.96,
    };
  });

  // ---- lag sequential analysis (Sackett, 1979; Bakeman & Gottman, 1997) ----
  let lagResults: LagResult[] | null = null;
  if (lagEnabled && nB > 0) {
    const nonBehaviorCodes = codeSetSnapshot.codes.filter(c => c.id !== targetBehaviorId);
    lagResults = nonBehaviorCodes.map(code => {
      const nCode = eventsOf(events, code.id).length;
      const pUncond = Math.min(nCode / totalIntervals, 1);

      const lagPoints: LagPoint[] = [];
      for (let k = 1; k <= lagCount; k++) {
        const fromMs = (k - 1) * W;
        const toMs = k * W;
        let hits = 0;
        for (const be of bEvents) {
          if (countInWindow(events, code.id, be.ts, fromMs, toMs)) hits++;
        }
        const pCond = nB > 0 ? hits / nB : 0;
        const z = zScore(pCond, pUncond, nB);
        const winSec = W / 1000;
        lagPoints.push({
          lag: k,
          windowLabel: `${(fromMs / 1000).toFixed(0)}–${(toMs / 1000).toFixed(0)}s`,
          pConditional: pCond,
          pUncond,
          z,
          significant: Math.abs(z) >= 1.96,
        });
      }

      return {
        codeId: code.id,
        codeLabel: code.label,
        codeAbbr: code.abbr,
        codeCategory: code.category,
        color: code.color,
        lagPoints,
        maxAbsZ: Math.max(...lagPoints.map(p => Math.abs(p.z))),
      };
    }).filter(r => r.maxAbsZ > 0 || eventsOf(events, r.codeId).length > 0)
      .sort((a, b) => b.maxAbsZ - a.maxAbsZ);
  }

  // ---- functional hypothesis -----------------------------------------------
  const FUNC_CONSEQUENCE_MAP: Record<string, { label: string; hypothesis: string }> = {
    'social-positive': { label: 'Social Positive (Attention)', hypothesis: 'social-positive' },
    'social-negative': { label: 'Social Negative (Escape/Avoidance)', hypothesis: 'social-negative' },
    'tangible': { label: 'Tangible / Access', hypothesis: 'tangible' },
    'automatic': { label: 'Automatic / Sensory', hypothesis: 'automatic' },
  };

  const functionSummaries: FunctionSummary[] = [];
  const seenHypotheses = new Set<string>();

  for (const cr of consequenceResults) {
    if (!cr.functionHypothesis || seenHypotheses.has(cr.functionHypothesis)) continue;
    seenHypotheses.add(cr.functionHypothesis);

    // Find the strongest (highest pCgivenB) result for this hypothesis category
    const group = consequenceResults.filter(r => r.functionHypothesis === cr.functionHypothesis);
    const best = group.reduce((a, b) => a.pCgivenB >= b.pCgivenB ? a : b);

    const supported = best.significant && best.pCgivenB > best.pCuncond;
    const hyp = cr.functionHypothesis;
    const qStr = best.yulesQ.toFixed(2);
    const zStr = Math.abs(best.z).toFixed(2);
    const sig = best.z >= 1.96 ? 'p < .05' : best.z >= 2.58 ? 'p < .01' : 'ns';

    let evidence: string;
    if (supported) {
      evidence = `P(${best.consequenceLabel}|${best.behaviorLabel}) = ${(best.pCgivenB * 100).toFixed(0)}% vs. base rate ${(best.pCuncond * 100).toFixed(0)}% (z = ${zStr}, ${sig}; Yule's Q = ${qStr}). Pattern consistent with ${FUNCTION_LABELS[hyp] ?? hyp} function.`;
    } else {
      evidence = `P(${best.consequenceLabel}|${best.behaviorLabel}) = ${(best.pCgivenB * 100).toFixed(0)}% (base rate ${(best.pCuncond * 100).toFixed(0)}%; z = ${zStr}, ${sig}; Q = ${qStr}). Conditional probability not elevated above base rate.`;
    }

    functionSummaries.push({
      hypothesis: hyp,
      label: FUNCTION_LABELS[hyp] ?? hyp,
      supported,
      evidence,
      pCgivenB: best.pCgivenB,
      pCuncond: best.pCuncond,
      z: best.z,
      yulesQ: best.yulesQ,
    });
  }

  // Ensure all four canonical functions are represented
  const allHypotheses: Array<FunctionSummary['hypothesis']> = ['social-positive', 'social-negative', 'tangible', 'automatic'];
  for (const h of allHypotheses) {
    if (!functionSummaries.find(s => s.hypothesis === h)) {
      functionSummaries.push({
        hypothesis: h,
        label: FUNCTION_LABELS[h] ?? h,
        supported: false,
        evidence: `No consequence code mapped to ${FUNCTION_LABELS[h] ?? h} function recorded in this session.`,
        pCgivenB: 0,
        pCuncond: 0,
        z: 0,
        yulesQ: 0,
      });
    }
  }

  // Order: supported first
  functionSummaries.sort((a, b) => Number(b.supported) - Number(a.supported) || b.pCgivenB - a.pCgivenB);

  return {
    session,
    totalIntervals,
    eventFreq,
    behaviorCount,
    behaviorRatePerHour,
    antecedentResults,
    consequenceResults,
    lagResults,
    functionSummaries,
  };
}
