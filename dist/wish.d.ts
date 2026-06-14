import { WishRequest, WishSolution, ScheduleData, Blackout } from './types';
import { DraftOp } from './draft';
export declare function summarizeWish(w: WishRequest): string;
export declare function parseWishSolutions(text: string, reverse: (token: string) => string | undefined): WishSolution[];
export interface WishDraft {
    ops: DraftOp[];
    blackouts: Blackout[];
    unresolved: number;
}
export declare function wishSolutionToDraft(sol: WishSolution, base: ScheduleData): WishDraft;
export declare function applyWishSolution(base: ScheduleData, sol: WishSolution): ScheduleData;
//# sourceMappingURL=wish.d.ts.map