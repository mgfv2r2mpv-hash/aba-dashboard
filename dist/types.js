export const SUPERVISION_CADENCES = [
    { value: 'W', label: 'Weekly', contactsPerMonth: 4 },
    { value: 'EOW', label: 'Every other week', contactsPerMonth: 2 },
    { value: '3o4', label: '3 of every 4 weeks', contactsPerMonth: 3 },
];
// BACB-mandated minimum supervision percentage for RBTs.
// This is set by the Behavior Analyst Certification Board, not the company.
export const BACB_RBT_SUPERVISION_MIN_PERCENT = 5;
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
//# sourceMappingURL=types.js.map