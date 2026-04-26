import { DayOfWeek, TimeWindow } from '../types';
interface AvailabilityGridProps {
    availability: {
        [key in DayOfWeek]?: TimeWindow[];
    };
    onChange: (availability: {
        [key in DayOfWeek]?: TimeWindow[];
    }) => void;
}
export default function AvailabilityGrid({ availability, onChange }: AvailabilityGridProps): import("react/jsx-runtime").JSX.Element;
export {};
//# sourceMappingURL=AvailabilityGrid.d.ts.map