import { Appointment } from '../types';
export default function DayReview({ appointments, onComplete, onRequestCancel, onClose }: {
    appointments: Appointment[];
    onComplete: (a: Appointment) => void;
    onRequestCancel: (a: Appointment) => void;
    onClose: () => void;
}): import("react/jsx-runtime").JSX.Element;
//# sourceMappingURL=DayReview.d.ts.map