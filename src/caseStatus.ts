// Shared supervision-band + case-risk logic. The five-level supervision band
// (behind / good / ideal / high / over) and its thresholds live here so the
// Compliance dashboard card and the Cases home-screen table read identical
// numbers. Presentation tokens (text/color) are colocated since both surfaces
// render the same labels.

import { Client, CompanySettings } from './types';
import { CaseState } from './caseModel';

// "Within 2 percentage-points of the minimum" → Risky (sub-level of Good).
export const RISKY_MARGIN = 2;

const CAP_OVER = 'var(--status-over)';

// Five-level supervision band:
//   behind → below company min
//   good   → above company min, below BCBA preferred min
//   ideal  → between BCBA preferred min and preferred max
//   high   → above BCBA preferred max, below insurer cap
//   over   → above insurer cap
export type ActualLevel = 'na' | 'behind' | 'good' | 'ideal' | 'high' | 'over';
export type ProjectedLevel = 'behind' | 'risky' | 'ok' | 'ideal' | 'high' | 'over';

export function getActualLevel(
  directHours: number, pct: number,
  targetPct: number, preferredPct: number, preferredMaxPct: number, maxPct?: number,
): ActualLevel {
  if (directHours === 0) return 'na';
  if (maxPct !== undefined && pct > maxPct) return 'over';
  if (pct > preferredMaxPct) return 'high';
  if (pct >= preferredPct) return 'ideal';
  if (pct >= targetPct) return 'good';
  return 'behind';
}

export function getProjectedLevel(
  directHours: number, pct: number,
  targetPct: number, preferredPct: number, preferredMaxPct: number, maxPct?: number,
): ProjectedLevel {
  if (directHours === 0) return 'behind';
  if (maxPct !== undefined && pct > maxPct) return 'over';
  if (pct > preferredMaxPct) return 'high';
  if (pct >= preferredPct) return 'ideal';
  if (pct >= targetPct + RISKY_MARGIN) return 'ok';
  if (pct >= targetPct) return 'risky';
  return 'behind';
}

// Status badge for the ACTUAL supervision section (Behind/Good/Ideal/High/Over).
export function actualSectionStatus(level: ActualLevel): { text: string; color: string } {
  switch (level) {
    case 'na':     return { text: 'N/A',    color: '#6b7280' };
    case 'over':   return { text: 'Over',   color: CAP_OVER };
    case 'high':   return { text: 'High',   color: 'var(--status-pace)' };
    case 'ideal':  return { text: 'Ideal',  color: 'var(--status-met)' };
    case 'good':   return { text: 'Good',   color: 'var(--status-met)' };
    case 'behind': return { text: 'Behind', color: 'var(--status-behind)' };
  }
}

export function projectedSectionStatus(level: ProjectedLevel): { text: string; color: string } {
  switch (level) {
    case 'over':   return { text: 'Over',   color: CAP_OVER };
    case 'high':   return { text: 'High',   color: 'var(--status-pace)' };
    case 'ideal':  return { text: 'Ideal',  color: 'var(--status-met)' };
    case 'ok':     return { text: 'OK',     color: 'var(--status-met)' };
    case 'risky':  return { text: 'Risky',  color: 'var(--status-behind)' };
    case 'behind': return { text: 'Behind', color: 'var(--status-behind)' };
  }
}

export interface SupervisionThresholds {
  targetPct: number;       // company minimum floor (legacy per-case target)
  preferredPct: number;    // BCBA preferred minimum (per-case override falls back to company)
  preferredMaxPct: number; // BCBA preferred maximum
  maxPct?: number;         // insurer cap (optional)
}

// Mirrors the per-client threshold resolution used by the Compliance dashboard
// so the table and the card agree on the band a case sits in.
export function resolveSupervisionThresholds(
  settings: CompanySettings, client: Pick<Client, 'supervisionIdealPct'>,
): SupervisionThresholds {
  const targetPct = settings.supervisionDirectHoursPercent || 5;
  const companyPreferredPct = settings.supervisionPreferredMinPercent ?? 15;
  const companyPreferredMaxPct = settings.supervisionPreferredMaxPercent ?? 20;
  return {
    targetPct,
    preferredPct: client.supervisionIdealPct ?? companyPreferredPct,
    preferredMaxPct: companyPreferredMaxPct,
    maxPct: settings.supervisionMaxHoursPercent,
  };
}

export interface SupervisionLevels {
  actLevel: ActualLevel;
  projLevel: ProjectedLevel;
  actualStatus: { text: string; color: string };
  projStatus: { text: string; color: string };
}

// One derivation of the displayed supervision band from a compliance report's
// actual/projected metrics — the row model shared by the Cases table and the
// Compliance dashboard card so they can never drift. Each caller supplies its
// own thresholds (the Cases table resolves them per-client; the dashboard passes
// its company-wide set), so this packaging is behavior-preserving.
export function deriveSupervisionLevels(
  actual: { directHours: number; pct: number },
  projected: { directHours: number; pct: number },
  th: SupervisionThresholds,
): SupervisionLevels {
  const actLevel = getActualLevel(actual.directHours, actual.pct, th.targetPct, th.preferredPct, th.preferredMaxPct, th.maxPct);
  const projLevel = getProjectedLevel(projected.directHours, projected.pct, th.targetPct, th.preferredPct, th.preferredMaxPct, th.maxPct);
  return {
    actLevel,
    projLevel,
    actualStatus: actualSectionStatus(actLevel),
    projStatus: projectedSectionStatus(projLevel),
  };
}

// ---------------------------------------------------------------------------
// Overall month projection risk for a case (the table's far-left column).
// ---------------------------------------------------------------------------

export type RiskLevel = 'none' | 'ok' | 'watch' | 'atrisk' | 'high';

export interface CaseRisk {
  level: RiskLevel;
  label: string;
  color: string;
  // Which projected shortfalls drive the flag (brief, for tooltip/aria).
  reasons: string[];
}

// "At risk" when supervision, PT, or contacts are projected short for the month
// (BCBA's rule). Supervision below the hard floor is the worst (High Risk);
// PT/contacts short is At Risk; below the preferred band is a Watch.
export function computeCaseRisk(cs: CaseState): CaseRisk {
  const active = cs.supervision.directHoursMonth > 0 || cs.direct.actualThisWk > 0;
  if (!active) return { level: 'none', label: '—', color: '#9ca3af', reasons: [] };

  const reasons: string[] = [];
  const supBelowFloor = cs.supervision.gapToFloor > 0.01;
  const ptShort = cs.parentTraining.gap > 0.01;
  const contactsShort = cs.supervision.contactsRequiredByCadence !== undefined &&
    cs.supervision.contactsThisMonth < cs.supervision.contactsRequiredByCadence;
  const supBelowPreferred = !supBelowFloor &&
    cs.supervision.supHoursMonth + 0.01 < cs.supervision.preferredH;
  const overCap = cs.supervision.overCap;

  if (supBelowFloor) reasons.push('Supervision below floor');
  if (ptShort) reasons.push('Parent training short');
  if (contactsShort) reasons.push('Supervision contacts short');
  if (supBelowPreferred) reasons.push('Below preferred band');
  if (overCap) reasons.push('Over insurer cap');

  if (supBelowFloor) return { level: 'high', label: 'High Risk', color: 'var(--status-behind)', reasons };
  if (ptShort || contactsShort) return { level: 'atrisk', label: 'At Risk', color: 'var(--status-over)', reasons };
  if (supBelowPreferred || overCap) return { level: 'watch', label: 'Watch', color: '#a16207', reasons };
  return { level: 'ok', label: 'On Track', color: 'var(--status-met)', reasons };
}
