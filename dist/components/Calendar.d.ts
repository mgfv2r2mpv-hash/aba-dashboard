import { Appointment, Technician, Client } from '../types';
interface CalendarProps {
    appointments: Appointment[];
    technicians: Technician[];
    clients: Client[];
    onAppointmentChange: (appointment: Appointment) => void;
    onSelectAppointment: (appointment: Appointment | null) => void;
}
export default function Calendar({ appointments, technicians, clients, onAppointmentChange, onSelectAppointment, }: CalendarProps): import("react/jsx-runtime").JSX.Element;
export {};
//# sourceMappingURL=Calendar.d.ts.map