import { Appointment, ScheduleData } from '../types';
import { ComplianceCache } from '../complianceCache';
interface Props {
    data: ScheduleData;
    cache?: ComplianceCache | null;
    onMarkComplete: (a: Appointment) => void;
    onRequestCancel: (a: Appointment) => void;
    onSelectAppointment: (a: Appointment) => void;
}
export default function ComplianceDashboard({ data, cache, onMarkComplete, onRequestCancel, onSelectAppointment }: Props): import("react/jsx-runtime").JSX.Element;
export {};
//# sourceMappingURL=ComplianceDashboard.d.ts.map