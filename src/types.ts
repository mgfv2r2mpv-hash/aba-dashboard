export type DayOfWeek = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';

export interface TimeWindow {
  start: string; // HH:MM format
  end: string;   // HH:MM format
}

export interface Client {
  id: string;
  name: string; // anonymized
  availabilityWindows: {
    [key in DayOfWeek]?: TimeWindow[];
  };
  // Per-case parent-training cap (uses the company-wide periodUnit).
  // If set and lower than CompanySettings.parentTraining.targetMinHours,
  // the per-case max takes precedence — i.e. the client is capped below
  // the company target floor and is not flagged for being below target.
  parentTrainingMaxHours?: number;
  notes?: string;
}

export interface Technician {
  id: string;
  name: string;
  isRBT: boolean;
  assignments: {
    clientId: string;
    hoursPerWeek: number;
    billable: boolean;
  }[];
  availability: {
    [key in DayOfWeek]?: TimeWindow[];
  };
  notes?: string;
}

// BACB-mandated minimum supervision percentage for RBTs.
// This is set by the Behavior Analyst Certification Board, not the company.
export const BACB_RBT_SUPERVISION_MIN_PERCENT = 5;

export type TrainingPeriodUnit = 'week' | 'month' | 'sixMonths' | 'year';

export interface CompanySettings {
  supervisionDirectHoursPercent: number; // company target, defaults to BACB min
  supervisionRBTHoursPercent: number;    // fixed at BACB min (5%) but override allowed
  parentTraining: {
    minimumHours: number;
    targetMinHours: number;
    targetMaxHours: number;
    periodUnit: TrainingPeriodUnit;
  };
  // Legacy field kept for older Excel files; mirrors `parentTraining` when present.
  parentTrainingHoursPerMonth?: {
    minimum: number;
    target: { min: number; max: number };
  };
  billableRequirements?: {
    hoursPerCycle: number;
    cycleWeeks: number;
  } | undefined;
}

export interface Appointment {
  id: string;
  title: string;
  description?: string;
  technician?: string; // technician ID or name
  client?: string;     // client ID or name
  startTime: string;   // ISO 8601 format
  endTime: string;     // ISO 8601 format
  isFixed: boolean;    // cannot be moved
  isBillable: boolean;
  type: 'supervision' | 'parent-training' | 'internal-task' | 'client-session' | 'other';
  isRecurring?: boolean;
  recurringPattern?: 'weekly' | 'biweekly' | 'monthly';
}

export interface ScheduleData {
  id: string;
  version: number;
  clients: Client[];
  technicians: Technician[];
  settings: CompanySettings;
  appointments: Appointment[];
  lastModified: string; // ISO 8601
}

export interface ScheduleConflict {
  type: 'supervision-violation' | 'training-violation' | 'availability-conflict' | 'scheduling-impossible';
  severity: 'error' | 'warning' | 'info';
  message: string;
  affectedAppointments?: string[];
  affectedTechnicians?: string[];
}

export interface ScheduleSolution {
  id: string;
  description: string;
  affectedWeeks: number;
  weekSpan: { startDate: string; endDate: string };
  changes: {
    appointmentId: string;
    oldTime: { start: string; end: string };
    newTime: { start: string; end: string };
  }[];
  reasoning: string;
  violatesConstraints: boolean;
}
