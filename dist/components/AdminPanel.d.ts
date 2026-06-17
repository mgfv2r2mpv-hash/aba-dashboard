import { ScheduleData } from '../types';
import { AISettings } from './Settings';
interface AdminPanelProps {
    data: ScheduleData;
    onDataChange: (data: ScheduleData) => void;
    onImportFile?: () => void;
    onRerunWizard?: () => void;
    onDownload?: () => void;
    onClearData?: () => void;
    aiSettings?: AISettings;
    onSaveAISettings?: (settings: AISettings) => void | Promise<void>;
    onClearKey?: () => void;
    onRequestUnlock?: () => Promise<boolean>;
    faceIdAvailable?: boolean;
    faceIdEnabled?: boolean;
    biometryLabel?: string;
    onToggleFaceId?: (on: boolean) => void;
}
export default function AdminPanel({ data, onDataChange, onImportFile, onRerunWizard, onDownload, onClearData, aiSettings, onSaveAISettings, onClearKey, onRequestUnlock, faceIdAvailable, faceIdEnabled, biometryLabel, onToggleFaceId }: AdminPanelProps): import("react/jsx-runtime").JSX.Element;
export {};
//# sourceMappingURL=AdminPanel.d.ts.map