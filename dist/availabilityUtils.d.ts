import { DayOfWeek, TimeWindow } from './types';
export declare const WEEKDAYS: DayOfWeek[];
export declare const PRESET_WINDOWS: {
    readonly mornings: {
        readonly start: "08:00";
        readonly end: "12:00";
    };
    readonly midday: {
        readonly start: "10:00";
        readonly end: "14:00";
    };
    readonly evenings: {
        readonly start: "15:00";
        readonly end: "19:00";
    };
};
export type PresetKey = keyof typeof PRESET_WINDOWS;
export declare const PRESET_LABELS: Record<PresetKey, string>;
export type AvailabilityMap = {
    [key in DayOfWeek]?: TimeWindow[];
};
export declare function mergeWindows(windows: TimeWindow[]): TimeWindow[];
export declare function subtractWindow(windows: TimeWindow[], target: TimeWindow): TimeWindow[];
export declare function unionContains(windows: TimeWindow[], target: TimeWindow): boolean;
export declare function isPresetActive(av: AvailabilityMap, preset: TimeWindow): boolean;
export declare function togglePreset(av: AvailabilityMap, preset: TimeWindow, on: boolean): AvailabilityMap;
//# sourceMappingURL=availabilityUtils.d.ts.map