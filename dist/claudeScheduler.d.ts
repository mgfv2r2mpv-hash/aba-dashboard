import { ScheduleData, ScheduleSolution, Appointment, WishRequest, WishSolution, FixItOptions } from './types';
export type ClaudeModel = 'claude-opus-4-8' | 'claude-sonnet-4-6' | 'claude-haiku-4-5-20251001';
export declare const DEFAULT_MODEL: ClaudeModel;
export declare class ClaudeScheduler {
    private client;
    private data;
    private model;
    private anonMap;
    constructor(apiKey: string, data: ScheduleData, model?: ClaudeModel);
    generateSolutions(changedAppointment: Appointment, currentConflicts: string[]): Promise<ScheduleSolution[]>;
    generateWishSolutions(wish: WishRequest): Promise<WishSolution[]>;
    generateFixSolutions(options: FixItOptions, conflicts: string[]): Promise<WishSolution[]>;
    buildFixItPrompt(options: FixItOptions, conflicts: string[]): string;
    private buildWishPrompt;
    private buildPrompt;
    private containsRawNames;
    private parseSolutions;
    private getEndOfMonth;
}
//# sourceMappingURL=claudeScheduler.d.ts.map