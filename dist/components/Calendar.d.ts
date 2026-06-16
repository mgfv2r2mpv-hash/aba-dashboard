import { Appointment, Technician, Client, CompanySettings, TimeOff } from '../types';
import { DraftMark } from '../draft';
interface CalendarProps {
    appointments: Appointment[];
    technicians: Technician[];
    clients: Client[];
    settings?: CompanySettings;
    timeOff?: TimeOff[];
    onAppointmentChange: (appointment: Appointment) => void;
    onSelectAppointment: (appointment: Appointment | null) => void;
    onViewDateChange?: (date: Date) => void;
    onLensChange?: (lens: 'bcba' | 'bt') => void;
    hideTotals?: boolean;
    draftMarks?: Map<string, DraftMark>;
    onAddAppointment?: () => void;
}
type Lens = 'bcba' | 'bt';
export default function Calendar({ appointments, technicians: _technicians, clients, settings, timeOff, onAppointmentChange, onSelectAppointment, onViewDateChange, onLensChange, hideTotals, draftMarks, onAddAppointment, }: CalendarProps): import("react/jsx-runtime").JSX.Element;
export declare function HoursSummary({ appointments, lens, settings, timeOff, currentDate }: {
    appointments: Appointment[];
    lens: Lens;
    settings?: CompanySettings;
    timeOff?: TimeOff[];
    currentDate: Date;
}): import("react/jsx-runtime").JSX.Element;
export {};
//# sourceMappingURL=Calendar.d.ts.map