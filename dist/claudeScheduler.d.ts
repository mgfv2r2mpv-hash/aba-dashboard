import { ScheduleData, ScheduleSolution, Appointment } from './types';
export type ClaudeModel = 'claude-opus-4-7' | 'claude-sonnet-4-6' | 'claude-haiku-4-5';
export declare const DEFAULT_MODEL: ClaudeModel;
export declare class ClaudeScheduler {
    private client;
    private data;
    private model;
    private anonMap;
    constructor(apiKey: string, data: ScheduleData, model?: ClaudeModel);
    generateSolutions(changedAppointment: Appointment, currentConflicts: string[]): Promise<ScheduleSolution[]>;
    private buildPrompt;
    private containsRawNames;
    private parseSolutions;
    private getEndOfMonth;
}
//# sourceMappingURL=claudeScheduler.d.ts.map