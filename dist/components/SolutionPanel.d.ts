import { ScheduleSolution } from '../types';
interface SolutionPanelProps {
    solutions: ScheduleSolution[];
    onAccept: (solution: ScheduleSolution) => void;
    onCustomize?: (solution: ScheduleSolution) => void;
    onReject?: () => void;
    heading?: string;
}
export default function SolutionPanel({ solutions, onAccept, onCustomize, onReject, heading }: SolutionPanelProps): any;
export {};
//# sourceMappingURL=SolutionPanel.d.ts.map