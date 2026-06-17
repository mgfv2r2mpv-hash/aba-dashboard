import type { CodeSet } from './types';

// Vollmer et al. (1993) — the most widely replicated conditional probability
// recording code set in the ABA literature (JABA 26(2), 269–278).
// P(problem behavior | antecedent/consequence) computed over 10-second windows.
export const VOLLMER_1993: CodeSet = {
  id: 'vollmer-1993',
  name: 'Vollmer et al. (1993) Standard',
  description: 'Standard CPR code set for function-based hypothesis generation.',
  citation: 'Vollmer et al. (1993). JABA, 26(2), 269–278',
  codes: [
    // Antecedents
    { id: 'DEM',   label: 'Demand presented',          abbr: 'DEM',  category: 'antecedent', color: '#f59e0b' },
    { id: 'PIR',   label: 'Preferred item removed',    abbr: 'PIR',  category: 'antecedent', color: '#d97706' },
    { id: 'AWNL',  label: 'Attention withdrawn',       abbr: 'AWD',  category: 'antecedent', color: '#b45309' },
    { id: 'ALONE', label: 'Alone / unstructured',      abbr: 'ALN',  category: 'antecedent', color: '#92400e' },
    // Target behavior — BCBA renames to match the specific behavior
    { id: 'TB',    label: 'Target behavior',           abbr: 'TB',   category: 'behavior',   color: '#dc2626' },
    // Consequences
    { id: 'ATN',   label: 'Attention delivered',       abbr: 'ATN',  category: 'consequence', color: '#10b981', functionHypothesis: 'social-positive' },
    { id: 'ESC',   label: 'Task / demand removed',     abbr: 'ESC',  category: 'consequence', color: '#059669', functionHypothesis: 'social-negative' },
    { id: 'TANG',  label: 'Tangible item delivered',   abbr: 'TNG',  category: 'consequence', color: '#0d9488', functionHypothesis: 'tangible' },
    { id: 'NSR',   label: 'No social response',        abbr: 'NSR',  category: 'consequence', color: '#6b7280', functionHypothesis: 'automatic' },
  ],
};

// Extended set — broader naturalistic observation code set.
// Adds more antecedent conditions and consequence types commonly used in
// clinic and home settings (Cooper, Heron & Heward, 2020, 3rd ed.).
export const EXTENDED_ABC: CodeSet = {
  id: 'extended-abc',
  name: 'Extended Naturalistic ABC',
  description: 'More codes for comprehensive clinic/home observation.',
  citation: 'Cooper, Heron & Heward (2020). ABA, 3rd ed.',
  codes: [
    // Antecedents
    { id: 'DEM',   label: 'Demand / instruction given',  abbr: 'DEM',  category: 'antecedent', color: '#f59e0b' },
    { id: 'PIR',   label: 'Preferred item removed',      abbr: 'PIR',  category: 'antecedent', color: '#d97706' },
    { id: 'AWNL',  label: 'Attention withdrawn',         abbr: 'AWD',  category: 'antecedent', color: '#b45309' },
    { id: 'ALONE', label: 'Alone / unstructured',        abbr: 'ALN',  category: 'antecedent', color: '#92400e' },
    { id: 'TRANS', label: 'Transition / activity change',abbr: 'TRN',  category: 'antecedent', color: '#78350f' },
    { id: 'PEER',  label: 'Peer interaction / proximity',abbr: 'PER',  category: 'antecedent', color: '#a16207' },
    // Behaviors
    { id: 'SIB',   label: 'Self-injurious behavior',    abbr: 'SIB',  category: 'behavior',   color: '#dc2626' },
    { id: 'AGG',   label: 'Aggression (physical)',      abbr: 'AGG',  category: 'behavior',   color: '#b91c1c' },
    { id: 'PROP',  label: 'Property destruction',       abbr: 'PRD',  category: 'behavior',   color: '#991b1b' },
    { id: 'DISRP', label: 'Disruptive behavior',        abbr: 'DIS',  category: 'behavior',   color: '#7f1d1d' },
    // Consequences
    { id: 'ATN',   label: 'Attention (verbal / physical)',abbr: 'ATN', category: 'consequence', color: '#10b981', functionHypothesis: 'social-positive' },
    { id: 'ESC',   label: 'Escape / task removal',      abbr: 'ESC',  category: 'consequence', color: '#059669', functionHypothesis: 'social-negative' },
    { id: 'TANG',  label: 'Tangible / preferred item',  abbr: 'TNG',  category: 'consequence', color: '#0d9488', functionHypothesis: 'tangible' },
    { id: 'REDIR', label: 'Redirection (back to task)', abbr: 'RDR',  category: 'consequence', color: '#0891b2' },
    { id: 'NSR',   label: 'No social response',         abbr: 'NSR',  category: 'consequence', color: '#6b7280', functionHypothesis: 'automatic' },
    { id: 'PHYSP', label: 'Physical prompt / guidance', abbr: 'PHP',  category: 'consequence', color: '#4f46e5' },
  ],
};

export const CUSTOM_EMPTY: CodeSet = {
  id: 'custom',
  name: 'Custom',
  description: 'Build your own code set.',
  codes: [
    { id: 'A1', label: 'Antecedent 1', abbr: 'A1', category: 'antecedent', color: '#f59e0b' },
    { id: 'B1', label: 'Target behavior', abbr: 'B1', category: 'behavior', color: '#dc2626' },
    { id: 'C1', label: 'Consequence 1', abbr: 'C1', category: 'consequence', color: '#10b981' },
  ],
};

export const DEFAULT_CODE_SETS: CodeSet[] = [VOLLMER_1993, EXTENDED_ABC, CUSTOM_EMPTY];

export const FUNCTION_LABELS: Record<string, string> = {
  'social-positive': 'Social Positive (Attention)',
  'social-negative': 'Social Negative (Escape/Avoidance)',
  'tangible': 'Tangible / Access',
  'automatic': 'Automatic / Sensory',
};

export const DEFAULT_LAG_WINDOW_MS = 10_000; // 10 seconds — Vollmer et al. (1993)
export const DEFAULT_LAG_COUNT = 5;
