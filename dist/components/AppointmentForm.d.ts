import { Appointment, Technician, Client } from '../types';
interface AppointmentFormProps {
    appointment?: Appointment;
    technicians: Technician[];
    clients: Client[];
    onSave: (appointment: Appointment) => void;
    onCancel: () => void;
}
export default function AppointmentForm({ appointment, technicians, clients, onSave, onCancel, }: AppointmentFormProps): import("react/jsx-runtime").JSX.Element;
export {};
//# sourceMappingURL=AppointmentForm.d.ts.map