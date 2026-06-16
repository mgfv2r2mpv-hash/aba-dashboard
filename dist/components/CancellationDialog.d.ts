import { Appointment, Cancellation, CompanySettings } from '../types';
interface Props {
    appointment: Appointment;
    settings: CompanySettings;
    onConfirm: (cancellation: Cancellation) => void;
    onCancel: () => void;
}
export default function CancellationDialog({ appointment, settings, onConfirm, onCancel }: Props): import("react/jsx-runtime").JSX.Element;
export {};
//# sourceMappingURL=CancellationDialog.d.ts.map