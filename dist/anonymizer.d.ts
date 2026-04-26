import { ScheduleData, Appointment } from './types';
export interface AnonymizationMap {
    clients: Map<string, string>;
    technicians: Map<string, string>;
    appointments: Map<string, string>;
    reverse: Map<string, string>;
}
export declare function buildAnonymizationMap(data: ScheduleData): AnonymizationMap;
export interface AnonymizedSchedule {
    technicians: any[];
    clients: any[];
    appointments: any[];
    settings: any;
}
export declare function anonymizeSchedule(data: ScheduleData, map: AnonymizationMap): AnonymizedSchedule;
export declare function anonymizeAppointment(a: Appointment, map: AnonymizationMap): any;
export declare function scrubText(text: string, data: ScheduleData, map: AnonymizationMap): string;
export declare function deAnonymizeText(text: string, map: AnonymizationMap): string;
//# sourceMappingURL=anonymizer.d.ts.map