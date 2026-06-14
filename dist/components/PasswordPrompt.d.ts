interface PasswordPromptProps {
    title: string;
    message: string;
    username?: string;
    placeholder?: string;
    submitLabel?: string;
    onSubmit: (password: string) => void;
    onCancel: () => void;
}
export default function PasswordPrompt({ title, message, username, placeholder, submitLabel, onSubmit, onCancel }: PasswordPromptProps): any;
export {};
//# sourceMappingURL=PasswordPrompt.d.ts.map