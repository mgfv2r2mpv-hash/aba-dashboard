import { ScheduleData } from '../types';
interface AdminPanelProps {
    data: ScheduleData;
    onDataChange: (data: ScheduleData) => void;
    onImportFile?: () => void;
    onRerunWizard?: () => void;
}
export default function AdminPanel({ data, onDataChange, onImportFile, onRerunWizard }: AdminPanelProps): import("react/jsx-runtime").JSX.Element;
export {};
//# sourceMappingURL=AdminPanel.d.ts.map