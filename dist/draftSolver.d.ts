import { ScheduleData, CompanySettings } from './types';
import { DraftOp } from './draft';
export type DraftGrade = 'green' | 'yellow' | 'red';
export interface PrioritizationChoice {
    kind: 'shorten' | 'move-family';
    appointmentId: string;
    label: string;
}
export interface DraftStatus {
    grade: DraftGrade;
    label: string;
    resolved?: ScheduleData;
    movedIds: string[];
    choices: PrioritizationChoice[];
    needsChoice: boolean;
    aiEligible: boolean;
}
export declare function solveDraft(base: ScheduleData, ops: DraftOp[], now: Date, settings: CompanySettings): DraftStatus;
//# sourceMappingURL=draftSolver.d.ts.map