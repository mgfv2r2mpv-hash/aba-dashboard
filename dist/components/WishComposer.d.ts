import { ScheduleData, WishSolution } from '../types';
import { AISettings } from './Settings';
interface Props {
    data: ScheduleData;
    aiSettings: AISettings;
    onAccept: (sol: WishSolution) => void | Promise<void>;
    onCustomize: (sol: WishSolution) => void;
    onClose: () => void;
}
export default function WishComposer({ data, aiSettings, onAccept, onCustomize, onClose }: Props): import("react/jsx-runtime").JSX.Element;
export {};
//# sourceMappingURL=WishComposer.d.ts.map