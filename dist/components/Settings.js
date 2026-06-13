import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
const MODEL_OPTIONS = [
    {
        value: 'claude-opus-4-7',
        label: 'Opus 4.7',
        description: 'Best for complex multi-week scheduling. Slower, more expensive.',
    },
    {
        value: 'claude-sonnet-4-6',
        label: 'Sonnet 4.6',
        description: 'Balanced quality, speed, and cost. Recommended for most cases.',
    },
    {
        value: 'claude-haiku-4-5',
        label: 'Haiku 4.5',
        description: 'Fastest and cheapest. Good for simple single-week conflicts.',
    },
];
export default function Settings({ settings, onSave, onClose, onClearKey }) {
    const [apiKey, setApiKey] = useState(settings.apiKey);
    const [model, setModel] = useState(settings.model);
    const [showKey, setShowKey] = useState(false);
    const [schedulePassword, setSchedulePassword] = useState(settings.schedulePassword || '');
    const [showSchedulePw, setShowSchedulePw] = useState(false);
    const handleSave = () => {
        onSave({ apiKey: apiKey.trim(), model, schedulePassword: schedulePassword.trim() || undefined });
        onClose();
    };
    return (_jsx("div", { style: {
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 'max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left))',
            boxSizing: 'border-box',
        }, children: _jsxs("div", { style: {
                backgroundColor: 'white',
                borderRadius: '8px',
                padding: '20px',
                width: '100%',
                maxWidth: 500,
                maxHeight: '100%',
                overflowY: 'auto',
                boxSizing: 'border-box',
            }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }, children: [_jsx("h2", { style: { fontSize: '20px', fontWeight: 'bold' }, children: "AI Settings" }), _jsx("button", { onClick: onClose, style: { background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }, children: "\u2715" })] }), _jsxs("div", { style: { marginBottom: '24px' }, children: [_jsx("label", { style: { display: 'block', fontWeight: '600', marginBottom: '8px' }, children: "Claude Model" }), _jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: '8px' }, children: MODEL_OPTIONS.map(opt => (_jsxs("label", { style: {
                                    display: 'flex',
                                    gap: '10px',
                                    padding: '10px',
                                    border: model === opt.value ? '2px solid #3b82f6' : '1px solid #e5e7eb',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    backgroundColor: model === opt.value ? '#eff6ff' : 'white',
                                }, children: [_jsx("input", { type: "radio", name: "model", value: opt.value, checked: model === opt.value, onChange: () => setModel(opt.value), style: { marginTop: '4px' } }), _jsxs("div", { children: [_jsx("div", { style: { fontWeight: '600' }, children: opt.label }), _jsx("div", { style: { fontSize: '12px', color: '#6b7280' }, children: opt.description })] })] }, opt.value))) })] }), _jsxs("div", { style: { marginBottom: '24px' }, children: [_jsx("label", { style: { display: 'block', fontWeight: '600', marginBottom: '8px' }, children: "Claude API Key" }), _jsxs("div", { style: { display: 'flex', gap: '8px' }, children: [_jsx("input", { type: showKey ? 'text' : 'password', value: apiKey, onChange: (e) => setApiKey(e.target.value), placeholder: "sk-ant-...", style: {
                                        flex: 1,
                                        padding: '8px 12px',
                                        border: '1px solid #d1d5db',
                                        borderRadius: '6px',
                                        fontSize: '14px',
                                        fontFamily: 'monospace',
                                    } }), _jsx("button", { onClick: () => setShowKey(!showKey), style: {
                                        padding: '8px 12px',
                                        border: '1px solid #d1d5db',
                                        borderRadius: '6px',
                                        background: 'white',
                                        cursor: 'pointer',
                                    }, children: showKey ? 'Hide' : 'Show' })] }), _jsx("p", { style: { fontSize: '12px', color: '#6b7280', marginTop: '6px' }, children: "Your key stays in this browser session. It is sent per-request via header and never stored on the server." }), settings.apiKey && (_jsx("button", { onClick: () => { onClearKey(); setApiKey(''); }, style: {
                                marginTop: '8px',
                                padding: '6px 12px',
                                background: '#fee2e2',
                                color: '#dc2626',
                                border: '1px solid #fca5a5',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '12px',
                            }, children: "Clear stored key" }))] }), _jsxs("div", { style: { marginBottom: '24px', padding: '12px', backgroundColor: '#f9fafb', borderRadius: '6px' }, children: [_jsx("label", { style: { display: 'block', fontWeight: '600', marginBottom: '8px' }, children: "Schedule Password (optional)" }), _jsx("p", { style: { fontSize: '12px', color: '#6b7280', marginBottom: '8px' }, children: "Encrypts your downloaded schedule file. Opening it anywhere \u2014 including in this app on another device \u2014 requires this password. Leave blank to download a normal, readable file." }), _jsxs("div", { style: { display: 'flex', gap: '8px' }, children: [_jsx("input", { type: showSchedulePw ? 'text' : 'password', placeholder: "Leave blank for no encryption", value: schedulePassword, onChange: (e) => setSchedulePassword(e.target.value), style: {
                                        flex: 1,
                                        padding: '8px 12px',
                                        border: '1px solid #d1d5db',
                                        borderRadius: '6px',
                                    } }), _jsx("button", { onClick: () => setShowSchedulePw(!showSchedulePw), style: {
                                        padding: '8px 12px',
                                        border: '1px solid #d1d5db',
                                        borderRadius: '6px',
                                        background: 'white',
                                        cursor: 'pointer',
                                    }, children: showSchedulePw ? 'Hide' : 'Show' })] })] }), _jsxs("div", { style: { display: 'flex', gap: '8px', justifyContent: 'flex-end' }, children: [_jsx("button", { onClick: onClose, style: {
                                padding: '8px 16px',
                                border: '1px solid #d1d5db',
                                borderRadius: '6px',
                                background: 'white',
                                cursor: 'pointer',
                            }, children: "Cancel" }), _jsx("button", { onClick: handleSave, style: {
                                padding: '8px 16px',
                                backgroundColor: '#3b82f6',
                                color: 'white',
                                border: 'none',
                                borderRadius: '6px',
                                cursor: 'pointer',
                            }, children: "Save" })] })] }) }));
}
//# sourceMappingURL=Settings.js.map