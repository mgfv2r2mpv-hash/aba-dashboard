import { Appointment, Technician, Client, CompanySettings } from '../types';
import { DraftMark } from '../draft';
interface CalendarProps {
    appointments: Appointment[];
    technicians: Technician[];
    clients: Client[];
    settings?: CompanySettings;
    onAppointmentChange: (appointment: Appointment) => void;
    onSelectAppointment: (appointment: Appointment | null) => void;
    onViewDateChange?: (date: Date) => void;
    draftMarks?: Map<string, DraftMark>;
}
export default function Calendar({ appointments, technicians: _technicians, clients: _clients, settings, onAppointmentChange, onSelectAppointment, onViewDateChange, draftMarks, }: CalendarProps): import("react/jsx-runtime").JSX.Element;
export {};
//# sourceMappingURL=Calendar.d.ts.map