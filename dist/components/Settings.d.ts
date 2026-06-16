export type ClaudeModel = 'claude-opus-4-8' | 'claude-sonnet-4-6' | 'claude-haiku-4-5-20251001';
export interface AISettings {
    apiKey: string;
    model: ClaudeModel;
    schedulePassword?: string;
}
export interface LockControls {
    faceIdAvailable: boolean;
    faceIdEnabled: boolean;
    biometryLabel?: string;
    onChangePin: () => void;
    onToggleFaceId: (on: boolean) => void;
}
interface SettingsProps {
    settings: AISettings;
    onSave: (settings: AISettings) => void;
    onClose: () => void;
    onClearKey: () => void;
    onRequestUnlock?: () => Promise<boolean>;
    lock?: LockControls;
}
export default function Settings({ settings, onSave, onClose, onClearKey, onRequestUnlock, lock }: SettingsProps): import("react/jsx-runtime").JSX.Element;
export {};
//# sourceMappingURL=Settings.d.ts.map