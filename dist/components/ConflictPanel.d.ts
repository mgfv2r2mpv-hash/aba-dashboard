import { ScheduleConflict, Appointment } from '../types';
export declare function conflictKey(c: ScheduleConflict): string;
export declare function conflictTitle(c: ScheduleConflict): string;
interface ConflictPanelProps {
    conflicts: ScheduleConflict[];
    appointments?: Appointment[];
    onSelectAppointment?: (a: Appointment) => void;
    fill?: boolean;
    mutedKeys?: string[];
    onMute?: (key: string) => void;
    onUnmute?: (key: string) => void;
    onConfirmDismiss?: (key: string) => void;
}
export default function ConflictPanel({ conflicts, appointments, onSelectAppointment, fill, mutedKeys, onMute, onUnmute, onConfirmDismiss }: ConflictPanelProps): any;
export {};
//# sourceMappingURL=ConflictPanel.d.ts.map