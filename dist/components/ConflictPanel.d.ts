import { ScheduleConflict, Appointment } from '../types';
interface ConflictPanelProps {
    conflicts: ScheduleConflict[];
    appointments?: Appointment[];
    onSelectAppointment?: (a: Appointment) => void;
}
export default function ConflictPanel({ conflicts, appointments, onSelectAppointment }: ConflictPanelProps): import("react/jsx-runtime").JSX.Element;
export {};
//# sourceMappingURL=ConflictPanel.d.ts.map