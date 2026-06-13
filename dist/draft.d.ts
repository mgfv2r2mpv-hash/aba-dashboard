import { Appointment, ScheduleData } from './types';
export type DraftOpKind = 'add' | 'move' | 'shorten' | 'remove';
export interface DraftOp {
    id: string;
    kind: DraftOpKind;
    targetId?: string;
    appt?: Appointment;
}
export type DraftMark = DraftOpKind;
export declare function newAddOp(appt: Appointment): DraftOp;
export declare function newMoveOp(appt: Appointment): DraftOp;
export declare function newShortenOp(appt: Appointment): DraftOp;
export declare function newRemoveOp(targetId: string): DraftOp;
export declare function applyOps(base: ScheduleData, ops: DraftOp[]): ScheduleData;
export declare function draftMarks(ops: DraftOp[]): Map<string, DraftMark>;
export declare function renderList(base: ScheduleData, ops: DraftOp[]): {
    appointments: Appointment[];
    marks: Map<string, DraftMark>;
};
//# sourceMappingURL=draft.d.ts.map