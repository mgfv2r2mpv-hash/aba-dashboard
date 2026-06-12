import { Appointment, ScheduleData } from '../types';
interface Props {
    data: ScheduleData;
    onMarkComplete: (a: Appointment) => void;
    onRequestCancel: (a: Appointment) => void;
    onSelectAppointment: (a: Appointment) => void;
}
export default function ComplianceDashboard({ data, onMarkComplete, onRequestCancel, onSelectAppointment }: Props): import("react/jsx-runtime").JSX.Element;
export {};
//# sourceMappingURL=ComplianceDashboard.d.ts.map