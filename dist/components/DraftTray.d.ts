import { ScheduleData } from '../types';
import { DraftOp } from '../draft';
import { DraftStatus, PrioritizationChoice } from '../draftSolver';
interface DraftTrayProps {
    base: ScheduleData;
    ops: DraftOp[];
    status: DraftStatus;
    hasApiKey: boolean;
    onResetOp: (opId: string) => void;
    onResetAll: () => void;
    onCancel: () => void;
    onAccept: () => void;
    onSaveAnyway: () => void;
    onAI: () => void;
    onPickChoice: (choice: PrioritizationChoice) => void;
    onLogGhosts: () => void;
    aiLoading?: boolean;
}
export default function DraftTray({ base, ops, status, hasApiKey, onResetOp, onResetAll, onCancel, onAccept, onSaveAnyway, onAI, onPickChoice, onLogGhosts, aiLoading, }: DraftTrayProps): any;
export {};
//# sourceMappingURL=DraftTray.d.ts.map