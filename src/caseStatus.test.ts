import { describe, it, expect } from 'vitest';
import {
  deriveSupervisionLevels, getActualLevel, getProjectedLevel,
  actualSectionStatus, projectedSectionStatus, type SupervisionThresholds,
} from './caseStatus';

// deriveSupervisionLevels is the row model shared by the Cases table and the
// Compliance card — it must equal the hand-wired 4-call derivation it replaced.
const th: SupervisionThresholds = { targetPct: 5, preferredPct: 15, preferredMaxPct: 20, maxPct: 25 };

describe('deriveSupervisionLevels', () => {
  it('packages the same actual/projected levels + section statuses as the raw calls', () => {
    const actual = { directHours: 10, pct: 8 };      // above floor, below preferred → good / risky-ish
    const projected = { directHours: 10, pct: 16 };  // in the ideal band
    const expectedAct = getActualLevel(actual.directHours, actual.pct, th.targetPct, th.preferredPct, th.preferredMaxPct, th.maxPct);
    const expectedProj = getProjectedLevel(projected.directHours, projected.pct, th.targetPct, th.preferredPct, th.preferredMaxPct, th.maxPct);
    expect(deriveSupervisionLevels(actual, projected, th)).toEqual({
      actLevel: expectedAct,
      projLevel: expectedProj,
      actualStatus: actualSectionStatus(expectedAct),
      projStatus: projectedSectionStatus(expectedProj),
    });
  });

  it('maps a below-floor case to Behind on both sides', () => {
    const { actualStatus, projStatus, actLevel, projLevel } =
      deriveSupervisionLevels({ directHours: 10, pct: 2 }, { directHours: 10, pct: 3 }, th);
    expect(actLevel).toBe('behind');
    expect(projLevel).toBe('behind');
    expect(actualStatus.text).toBe('Behind');
    expect(projStatus.text).toBe('Behind');
  });

  it('flags no-direct as N/A actual, Behind projected', () => {
    const { actLevel, actualStatus, projLevel } =
      deriveSupervisionLevels({ directHours: 0, pct: 0 }, { directHours: 0, pct: 0 }, th);
    expect(actLevel).toBe('na');
    expect(actualStatus.text).toBe('N/A');
    expect(projLevel).toBe('behind');
  });
});
