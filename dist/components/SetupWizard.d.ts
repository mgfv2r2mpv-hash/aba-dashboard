import { ScheduleData } from '../types';
interface SetupWizardProps {
    onComplete: (data: ScheduleData) => void;
    onCancel: () => void;
    initialData?: ScheduleData;
}
export default function SetupWizard({ onComplete, onCancel, initialData }: SetupWizardProps): import("react/jsx-runtime").JSX.Element;
export {};
//# sourceMappingURL=SetupWizard.d.ts.map