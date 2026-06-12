import { ConstraintValidator } from './constraintValidator';
import { analyzeCorrections } from './corrections';
// Re-validate a proposed schedule against the full constraint + compliance
// model. A candidate is acceptable when it introduces no NEW violations
// relative to the baseline it was derived from — pre-existing violations the
// proposal doesn't address are reported as residuals, not failures (a single
// move isn't expected to cure the whole month at once).
export function qcSchedule(proposed, baseline, now = new Date()) {
    const proposedConflicts = new ConstraintValidator(proposed, now).validateSchedule();
    const baselineConflicts = new ConstraintValidator(baseline, now).validateSchedule();
    const baselineErrors = new Set(baselineConflicts.filter(c => c.severity === 'error').map(c => c.message));
    const baselineWarnings = new Set(baselineConflicts.filter(c => c.severity === 'warning').map(c => c.message));
    const hardViolations = proposedConflicts.filter(c => c.severity === 'error' && !baselineErrors.has(c.message));
    const newSoftViolations = proposedConflicts.filter(c => c.severity === 'warning' && !baselineWarnings.has(c.message));
    // Residuals = hard correction needs still outstanding in the proposed schedule.
    const residuals = analyzeCorrections(proposed, now).needs
        .filter(n => n.hard)
        .map(n => n.detail);
    return {
        pass: hardViolations.length === 0 && newSoftViolations.length === 0,
        hardViolations,
        newSoftViolations,
        residuals,
    };
}
//# sourceMappingURL=qc.js.map