import { ScheduleData, ScheduleSolution, Appointment } from './types';
export declare class ClaudeScheduler {
    private client;
    private data;
    constructor(apiKey: string, data: ScheduleData);
    generateSolutions(changedAppointment: Appointment, currentConflicts: string[]): Promise<ScheduleSolution[]>;
    private buildPrompt;
    private parseSolutions;
    private getTechnicianName;
    private getClientName;
    private getEndOfMonth;
}
//# sourceMappingURL=claudeScheduler.d.ts.map