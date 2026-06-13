export type ClaudeModel = 'claude-opus-4-7' | 'claude-sonnet-4-6' | 'claude-haiku-4-5';
export interface AISettings {
    apiKey: string;
    model: ClaudeModel;
    schedulePassword?: string;
}
interface SettingsProps {
    settings: AISettings;
    onSave: (settings: AISettings) => void;
    onClose: () => void;
    onClearKey: () => void;
}
export default function Settings({ settings, onSave, onClose, onClearKey }: SettingsProps): import("react/jsx-runtime").JSX.Element;
export {};
//# sourceMappingURL=Settings.d.ts.map