export type EventCategory = 'antecedent' | 'behavior' | 'consequence';
export type FunctionHypothesis = 'social-positive' | 'social-negative' | 'tangible' | 'automatic';

export interface ObservationCode {
  id: string;
  label: string;
  abbr: string;           // 2–4 chars shown on tap button
  category: EventCategory;
  color: string;          // hex — used on button and chart bars
  functionHypothesis?: FunctionHypothesis; // consequence codes: which ABA function this consequence maps to
}

export interface CodeSet {
  id: string;
  name: string;
  description: string;
  citation?: string;
  codes: ObservationCode[];
}

export interface ObservationEvent {
  id: string;
  ts: number;    // ms elapsed since session start (0-based)
  codeId: string;
}

export interface CprSession {
  id: string;
  clientLabel: string;   // use initials or case ID for privacy
  observerName: string;
  date: string;          // YYYY-MM-DD
  durationMs: number;
  codeSetSnapshot: CodeSet;
  events: ObservationEvent[];
  lagEnabled: boolean;
  lagWindowMs: number;   // observation window in ms (e.g. 10000 = 10 s)
  lagCount: number;      // number of lag intervals to analyze (1–5)
  targetBehaviorId: string;
  notes: string;
  createdAt: number;     // epoch ms
}

// ---- analysis output -------------------------------------------------

export interface EventFreqRow {
  codeId: string;
  label: string;
  abbr: string;
  category: EventCategory;
  color: string;
  count: number;
  pct: number;
  ratePerHour: number;
}

export interface AntecedentResult {
  antecedentId: string;
  antecedentLabel: string;
  behaviorId: string;
  behaviorLabel: string;
  nA: number;            // antecedent occurrences
  nB: number;            // behavior occurrences
  hitBA: number;         // B events with A in preceding window
  pAgivenB: number;      // P(A | B) — primary metric for antecedent analysis
  pAuncond: number;      // P(A) base rate
  pBgivenA: number;      // P(B | A) — predictive direction
  yulesQ: number;
  z: number;
  significant: boolean;
}

export interface ConsequenceResult {
  consequenceId: string;
  consequenceLabel: string;
  behaviorId: string;
  behaviorLabel: string;
  functionHypothesis?: FunctionHypothesis;
  nB: number;
  hitCB: number;         // B events followed by C in window
  pCgivenB: number;      // P(C | B)
  pCuncond: number;      // P(C) base rate
  yulesQ: number;
  z: number;
  significant: boolean;
}

export interface LagPoint {
  lag: number;
  windowLabel: string;
  pConditional: number;
  pUncond: number;
  z: number;
  significant: boolean;
}

export interface LagResult {
  codeId: string;
  codeLabel: string;
  codeAbbr: string;
  codeCategory: EventCategory;
  color: string;
  lagPoints: LagPoint[];
  maxAbsZ: number;
}

export interface FunctionSummary {
  hypothesis: FunctionHypothesis;
  label: string;
  supported: boolean;
  evidence: string;
  pCgivenB: number;
  pCuncond: number;
  z: number;
  yulesQ: number;
}

export interface CprAnalysis {
  session: CprSession;
  totalIntervals: number;
  eventFreq: EventFreqRow[];
  behaviorCount: number;
  behaviorRatePerHour: number;
  antecedentResults: AntecedentResult[];
  consequenceResults: ConsequenceResult[];
  lagResults: LagResult[] | null;
  functionSummaries: FunctionSummary[];
}
