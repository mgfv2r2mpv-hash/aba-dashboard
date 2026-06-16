import { Appointment, ScheduleData, ScheduleConflict, WishSolution } from '../types';
import { ComplianceCache } from '../complianceCache';
import { AISettings } from './Settings';
interface Props {
    data: ScheduleData;
    cache?: ComplianceCache | null;
    conflicts?: ScheduleConflict[];
    aiSettings?: AISettings;
    mutedConflictKeys?: string[];
    onMuteConflict?: (key: string) => void;
    onUnmuteConflict?: (key: string) => void;
    onConfirmDismissConflict?: (key: string) => void;
    onMarkComplete: (a: Appointment) => void;
    onRequestCancel: (a: Appointment) => void;
    onSelectAppointment: (a: Appointment) => void;
    onAcceptFix?: (sol: WishSolution) => void | Promise<void>;
    onCustomizeFix?: (sol: WishSolution) => void;
}
export default function ComplianceDashboard({ data, cache, conflicts, aiSettings, mutedConflictKeys, onMuteConflict, onUnmuteConflict, onConfirmDismissConflict, onMarkComplete, onRequestCancel, onSelectAppointment, onAcceptFix, onCustomizeFix }: Props): import("react/jsx-runtime").JSX.Element;
export {};
//# sourceMappingURL=ComplianceDashboard.d.ts.map