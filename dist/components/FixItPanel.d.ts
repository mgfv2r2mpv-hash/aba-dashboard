import { ScheduleData, ScheduleConflict, WishSolution } from '../types';
import { AISettings } from './Settings';
interface Props {
    data: ScheduleData;
    aiSettings: AISettings;
    conflicts: ScheduleConflict[];
    onAccept: (sol: WishSolution) => void | Promise<void>;
    onCustomize: (sol: WishSolution) => void;
}
export default function FixItPanel({ data, aiSettings, conflicts, onAccept, onCustomize }: Props): any;
export {};
//# sourceMappingURL=FixItPanel.d.ts.map