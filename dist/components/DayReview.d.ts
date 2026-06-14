import { Appointment } from '../types';
export default function DayReview({ appointments, onComplete, onRequestCancel, onClose }: {
    appointments: Appointment[];
    onComplete: (a: Appointment) => void;
    onRequestCancel: (a: Appointment) => void;
    onClose: () => void;
}): any;
//# sourceMappingURL=DayReview.d.ts.map