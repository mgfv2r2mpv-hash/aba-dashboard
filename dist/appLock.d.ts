import { ScheduleData } from './types';
export interface StoredAIConfig {
    apiKey: string;
    model: string;
    schedulePassword?: string;
}
export declare function hasPin(): Promise<boolean>;
export declare function setPin(pin: string): Promise<void>;
export declare function verifyPin(pin: string): Promise<boolean>;
export declare function changePin(newPin: string, currentSchedule: ScheduleData | null): Promise<void>;
export declare function clearLock(): Promise<void>;
export declare function saveSchedule(data: ScheduleData, pin: string): Promise<void>;
export declare function loadSchedule(pin: string): Promise<ScheduleData | null>;
export declare function saveAIConfig(config: StoredAIConfig, pin: string): Promise<void>;
export declare function loadAIConfig(pin: string): Promise<StoredAIConfig | null>;
export declare function clearAIConfig(): Promise<void>;
export declare function isFaceIdEnabled(): Promise<boolean>;
export declare function enableFaceId(verifiedPin: string): Promise<void>;
export declare function disableFaceId(): Promise<void>;
export declare function recoverPinViaBiometric(): Promise<string | null>;
//# sourceMappingURL=appLock.d.ts.map