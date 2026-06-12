import { Appointment, Technician, Client, Authorization } from '../types';
interface AppointmentFormProps {
    appointment?: Appointment;
    allAppointments?: Appointment[];
    authorizations?: Authorization[];
    technicians: Technician[];
    clients: Client[];
    onSave: (appointments: Appointment[]) => void;
    onDelete?: (ids: string[]) => void;
    onCancel: () => void;
}
export default function AppointmentForm({ appointment, allAppointments, authorizations, technicians, clients, onSave, onDelete, onCancel, }: AppointmentFormProps): import("react/jsx-runtime").JSX.Element;
export {};
//# sourceMappingURL=AppointmentForm.d.ts.map