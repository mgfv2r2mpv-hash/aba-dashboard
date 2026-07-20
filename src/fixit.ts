// "Fix It" — AI-assisted compliance remediation, the pure parts.
//
// The live Anthropic call lives in claudeScheduler.ts; everything here is pure
// and unit-tested (scripts/verify-fixit.ts): turning a structured FixItOptions
// into a compact natural-language directive for the prompt. Parsing the model's
// reply reuses parseWishSolutions (both flows emit the same op shape), and
// applying a chosen solution reuses applyWishSolution / wishSolutionToDraft.

import { FixItOptions } from './types';

// The allowed-strategies clause, derived from the toggles. Kept terse on purpose
// — only the enabled tools are listed, so the model isn't tempted to reach for a
// strategy the BCBA turned off, and the prompt stays small.
export function allowedStrategies(o: FixItOptions): string[] {
  const out: string[] = [];
  if (o.includeBtSupervision)
    out.push('Add or extend supervision sessions that OVERLAP a BT\'s direct session (earns supervision credit for that BT and case).');
  if (o.includeNoBtSupervision)
    out.push('Add BCBA-solo supervision (no BT overlap) only when you also place a direct session for it to overlap; solo supervision alone earns no credit.');
  if (o.includeInSessionParentTraining)
    out.push('Add parent-training that runs concurrently with (overlaps) a direct session and names the observed BT, so the overlap counts.');
  if (o.includeOutSessionParentTraining)
    out.push('Add caregiver-only parent-training scheduled outside any direct session (counts toward the parent-training requirement, not BT supervision).');
  if (o.includeCasePlanning)
    out.push('Add case-planning / coordination-of-care sessions (count toward supervision only when they name a BT and overlap that BT\'s direct).');
  return out;
}
