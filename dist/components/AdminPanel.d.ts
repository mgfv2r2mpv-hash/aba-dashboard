import { ScheduleData } from '../types';
interface AdminPanelProps {
    data: ScheduleData;
    onDataChange: (data: ScheduleData) => void;
    onImportFile?: () => void;
    onRerunWizard?: () => void;
    onDownload?: () => void;
    onClearData?: () => void;
    onOpenAISettings?: () => void;
}
export default function AdminPanel({ data, onDataChange, onImportFile, onRerunWizard, onDownload, onClearData, onOpenAISettings }: AdminPanelProps): any;
export {};
//# sourceMappingURL=AdminPanel.d.ts.map