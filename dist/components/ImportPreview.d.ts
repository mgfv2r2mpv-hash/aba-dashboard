import { ScheduleData } from '../types';
interface Props {
    current: ScheduleData;
    next: ScheduleData;
    fileName?: string;
    onConfirm: () => void;
    onCancel: () => void;
}
export default function ImportPreview({ current, next, fileName, onConfirm, onCancel }: Props): any;
export {};
//# sourceMappingURL=ImportPreview.d.ts.map