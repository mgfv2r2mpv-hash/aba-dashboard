import { Appointment, Technician, Client, Authorization, CompanySettings } from '../types';
interface AppointmentFormProps {
    appointment?: Appointment;
    allAppointments?: Appointment[];
    authorizations?: Authorization[];
    technicians: Technician[];
    clients: Client[];
    settings?: CompanySettings;
    initialType?: Appointment['type'];
    onSave: (appointments: Appointment[]) => void;
    onDelete?: (ids: string[]) => void;
    onCancel: () => void;
    variant?: 'modal' | 'inline';
}
export default function AppointmentForm({ appointment, allAppointments, authorizations, technicians, clients, settings, initialType, onSave, onDelete, onCancel, variant, }: AppointmentFormProps): any;
export {};
//# sourceMappingURL=AppointmentForm.d.ts.map