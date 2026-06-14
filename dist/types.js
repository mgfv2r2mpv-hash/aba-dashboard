export const SUPERVISION_CADENCES = [
    { value: 'W', label: 'Weekly', contactsPerMonth: 4 },
    { value: 'EOW', label: 'Every other week', contactsPerMonth: 2 },
    { value: '3o4', label: '3 of every 4 weeks', contactsPerMonth: 3 },
];
// BACB-mandated minimum supervision percentage for RBTs.
// This is set by the Behavior Analyst Certification Board, not the company.
export const BACB_RBT_SUPERVISION_MIN_PERCENT = 5;
export const DEFAULT_PTO_DEDUCTION_RATIO = 1;
export const DEFAULT_BCBA_SESSION_DEFAULTS = {
    supervisionPercentOfWeeklyDirect: 20,
    reassessmentHours: 2,
    casePlanningHours: 1,
    parentTrainingHours: 1,
    otherHours: 1,
};
export const DEFAULT_CANCELLATION_NOTICE = {
    unplannedHoursThreshold: 24,
    plannedDaysThreshold: 30,
};
export const AUTH_BUCKETS = [
    { key: 'supervision', label: 'Supervision / Protocol Revision' },
    { key: 'direct', label: 'Direct Service' },
    { key: 'parentTraining', label: 'Parent Training / Coord. of Care' },
    { key: 'reassessment', label: 'Reassessment' },
    { key: 'casePlanning', label: 'Case Planning' },
];
export const CANCELLATION_SOURCES = [
    { value: 'bt', label: 'Cancel-BT' },
    { value: 'bcba', label: 'Cancel-BCBA' },
    { value: 'admin', label: 'Cancel-Admin' },
    { value: 'family', label: 'Cancel-Family' },
];
export const CANCELLATION_REASONS = [
    { value: 'sick', label: 'Sick' },
    { value: 'pto', label: 'PTO/Vacation' },
    { value: 'training', label: 'Training' },
    { value: 'holiday', label: 'Holiday' },
    { value: 'weather', label: 'Weather' },
    { value: 'auth_issues', label: 'Auth Issues' },
];
// Effective reason codes for a company: their customized list when set (and
// non-empty), otherwise the built-in defaults.
export function resolveCancellationCodes(settings) {
    const custom = settings?.cancellationReasons;
    return custom && custom.length ? custom : CANCELLATION_REASONS;
}
// Active (non-retired) codes — what the cancel picker offers for new records.
export function activeCancellationCodes(settings) {
    return resolveCancellationCodes(settings).filter(c => !c.retired);
}
// Human label for a stored reason value. Falls back to a de-slugged version of
// the raw value so historical / unknown codes still read cleanly.
export function cancellationReasonLabel(value, settings) {
    const found = resolveCancellationCodes(settings).find(c => c.value === value);
    return found?.label || value.replace(/_/g, ' ');
}
// Turn a free-text label into a stable code value: lowercase, non-alphanumerics
// to underscores, collapsed and trimmed (e.g. "Auth Issues" -> "auth_issues").
export function slugifyCancellationCode(label) {
    return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}
// Session types that can count toward BT supervision — supervision, parent
// training, and coordination-of-care (case planning) — but ONLY when they
// overlap the supervised BT's direct (client-session) in time. Other types
// never count.
//   - A SUPERVISION session implies the client is present, so the BT is inferred
//     from whichever of that client's directs it overlaps — no BT need be named.
//   - PARENT-TRAINING / CASE-PLANNING can be caregiver-only (client/BT not in the
//     room), so they count only when they NAME the observed BT (technician field)
//     and overlap that BT's direct.
// Either way these stay BCBA billable (the technician on a parent-training /
// case-planning session is the observee, not a provider — see bucketOf).
export const SUPERVISION_COUNTING_TYPES = ['supervision', 'parent-training', 'case-planning'];
// True for a session eligible for supervision credit. Supervision always
// qualifies (credit is decided by overlap); parent-training / case-planning
// qualify only when they name a BT. The credited hours are the time-overlap with
// the relevant BT's direct session(s) — partial overlap → partial credit.
export function countsAsSupervision(a) {
    if (a.type === 'supervision')
        return true;
    if (a.type === 'parent-training' || a.type === 'case-planning')
        return !!a.technician;
    return false;
}
export const DATE_BASED_ACCRUALS = ['semimonthly', 'everyNWeeks'];
export const DEFAULT_PTO_CONFIG = { mode: 'unlimited', buckets: 'combined' };
export const DEFAULT_FIXIT_OPTIONS = {
    includeBtSupervision: true,
    includeNoBtSupervision: false,
    includeInSessionParentTraining: true,
    includeOutSessionParentTraining: false,
    includeCasePlanning: true,
    softenBillableMinimum: false,
    excludedClientIds: [],
    horizonWeeks: 4,
};
//# sourceMappingURL=types.js.map