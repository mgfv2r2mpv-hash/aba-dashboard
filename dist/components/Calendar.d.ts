import { Appointment, Technician, Client, CompanySettings } from '../types';
interface CalendarProps {
    appointments: Appointment[];
    technicians: Technician[];
    clients: Client[];
    settings?: CompanySettings;
    onAppointmentChange: (appointment: Appointment) => void;
    onSelectAppointment: (appointment: Appointment | null) => void;
    onViewDateChange?: (date: Date) => void;
}
export default function Calendar({ appointments, technicians: _technicians, clients: _clients, settings, onAppointmentChange, onSelectAppointment, onViewDateChange, }: CalendarProps): import("react/jsx-runtime").JSX.Element;
export {};
//# sourceMappingURL=Calendar.d.ts.map