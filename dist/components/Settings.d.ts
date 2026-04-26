export type ClaudeModel = 'claude-opus-4-7' | 'claude-sonnet-4-6' | 'claude-haiku-4-5';
export interface AISettings {
    apiKey: string;
    model: ClaudeModel;
}
interface SettingsProps {
    settings: AISettings;
    onSave: (settings: AISettings) => void;
    onClose: () => void;
    onEmbedInExcel: (password: string) => Promise<void>;
    onClearKey: () => void;
}
export default function Settings({ settings, onSave, onClose, onEmbedInExcel, onClearKey }: SettingsProps): import("react/jsx-runtime").JSX.Element;
export {};
//# sourceMappingURL=Settings.d.ts.map