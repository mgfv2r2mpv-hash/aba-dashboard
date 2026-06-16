import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useRef } from 'react';
const MODEL_OPTIONS = [
    {
        value: 'claude-opus-4-8',
        label: 'Opus 4.8',
        description: 'Best for complex multi-week scheduling. Slower, more expensive.',
    },
    {
        value: 'claude-sonnet-4-6',
        label: 'Sonnet 4.6',
        description: 'Balanced quality, speed, and cost. Recommended for most cases.',
    },
    {
        value: 'claude-haiku-4-5-20251001',
        label: 'Haiku 4.5',
        description: 'Fastest and cheapest. Good for simple single-week conflicts.',
    },
];
export default function Settings({ settings, onSave, onClose, onClearKey, onRequestUnlock, lock }) {
    const [model, setModel] = useState(settings.model);
    const [showKey, setShowKey] = useState(false);
    const scrollRef = useRef(null);
    const [atBottom, setAtBottom] = useState(false);
    const handleScroll = () => {
        const el = scrollRef.current;
        if (!el)
            return;
        setAtBottom(el.scrollTop + el.clientHeight >= el.scrollHeight - 40);
    };
    // The API key mirrors the schedule-password UX: once set it is never shown
    // again (it is sealed under the app PIN at rest). Replacing it requires
    // re-auth, after which the input opens empty for a fresh key. Until then the
    // editable field is blank — we never seed it with the stored plaintext.
    const hasExistingKey = !!settings.apiKey;
    const [replacingKey, setReplacingKey] = useState(!hasExistingKey);
    const [apiKey, setApiKey] = useState('');
    const [unlockError, setUnlockError] = useState(null);
    const handleReplaceKey = async () => {
        setUnlockError(null);
        if (onRequestUnlock && !(await onRequestUnlock())) {
            setUnlockError('Could not verify — key unchanged.');
            return;
        }
        setApiKey('');
        setShowKey(false);
        setReplacingKey(true);
    };
    // Schedule (file) password. Once set it is never shown again — changing it
    // requires the current password, since it's the only key to already-exported
    // encrypted files. A wrong "current" would orphan that data, so we gate it.
    const hasExistingPw = !!settings.schedulePassword;
    const [changingPw, setChangingPw] = useState(!hasExistingPw);
    const [currentPw, setCurrentPw] = useState('');
    const [newPw, setNewPw] = useState('');
    const [showPw, setShowPw] = useState(false);
    const [pwError, setPwError] = useState(null);
    const handleSave = () => {
        let schedulePassword = settings.schedulePassword;
        if (changingPw) {
            if (hasExistingPw && currentPw !== settings.schedulePassword) {
                setPwError('Current password is incorrect.');
                return;
            }
            schedulePassword = newPw.trim() || undefined;
        }
        // When the key is sealed and untouched, keep it. While replacing, a blank
        // field is treated as "leave it" too — use the explicit Clear button to
        // remove a key, so a stray Save never wipes it.
        const apiKeyOut = replacingKey ? (apiKey.trim() || settings.apiKey) : settings.apiKey;
        onSave({ apiKey: apiKeyOut, model, schedulePassword });
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
                width: '100%',
                maxWidth: 500,
                maxHeight: '100%',
                display: 'flex',
                flexDirection: 'column',
                boxSizing: 'border-box',
                position: 'relative',
            }, children: [_jsx("div", { style: { padding: '20px 20px 0', flexShrink: 0 }, children: _jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }, children: [_jsx("h2", { style: { fontSize: '20px', fontWeight: 'bold' }, children: "Settings" }), _jsx("button", { onClick: onClose, style: { background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer' }, children: "\u2715" })] }) }), _jsxs("div", { ref: scrollRef, onScroll: handleScroll, style: { padding: '0 20px 80px', overflowY: 'auto', flex: 1 }, children: [lock && (_jsxs("div", { style: { marginBottom: '24px', padding: '12px', backgroundColor: '#f9fafb', borderRadius: '6px' }, children: [_jsx("label", { style: { display: 'block', fontWeight: '600', marginBottom: '8px' }, children: "App Lock" }), _jsx("p", { style: { fontSize: '12px', color: '#6b7280', marginBottom: '12px' }, children: "A PIN locks the app on launch and encrypts your schedule on this device. There is no recovery if you forget it." }), _jsx("button", { onClick: lock.onChangePin, style: {
                                        padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px',
                                        background: 'white', cursor: 'pointer', fontSize: '13px',
                                    }, children: "Change PIN" }), lock.faceIdAvailable && (_jsxs("label", { style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px', cursor: 'pointer' }, children: [_jsx("input", { type: "checkbox", checked: lock.faceIdEnabled, onChange: (e) => lock.onToggleFaceId(e.target.checked) }), _jsxs("span", { style: { fontSize: '13px' }, children: ["Unlock with ", lock.biometryLabel || 'Face ID'] })] }))] })), _jsxs("div", { style: { marginBottom: '24px', padding: '12px', backgroundColor: '#f9fafb', borderRadius: '6px' }, children: [_jsx("label", { style: { display: 'block', fontWeight: '600', marginBottom: '8px' }, children: "Schedule Password (optional)" }), _jsx("p", { style: { fontSize: '12px', color: '#6b7280', marginBottom: '8px' }, children: "Encrypts your downloaded schedule file. Opening it anywhere \u2014 including in this app on another device \u2014 requires this password. Leave blank to download a normal, readable file." }), hasExistingPw && !changingPw ? (_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: '10px' }, children: [_jsx("span", { style: { fontSize: '13px', color: '#374151' }, children: "\uD83D\uDD12 Password is set." }), _jsx("button", { onClick: () => { setChangingPw(true); setPwError(null); }, style: {
                                                padding: '6px 12px', border: '1px solid #d1d5db', borderRadius: '6px',
                                                background: 'white', cursor: 'pointer', fontSize: '13px',
                                            }, children: "Change\u2026" })] })) : (_jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: '8px' }, children: [hasExistingPw && (_jsx("input", { type: showPw ? 'text' : 'password', placeholder: "Current password", value: currentPw, onChange: (e) => { setCurrentPw(e.target.value); setPwError(null); }, autoComplete: "off", style: { padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px' } })), _jsxs("div", { style: { display: 'flex', gap: '8px' }, children: [_jsx("input", { type: showPw ? 'text' : 'password', placeholder: hasExistingPw ? 'New password (blank to remove)' : 'Leave blank for no encryption', value: newPw, onChange: (e) => { setNewPw(e.target.value); setPwError(null); }, autoComplete: "off", style: { flex: 1, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px' } }), _jsx("button", { onClick: () => setShowPw(!showPw), style: {
                                                        padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px',
                                                        background: 'white', cursor: 'pointer',
                                                    }, children: showPw ? 'Hide' : 'Show' })] }), hasExistingPw && (_jsx("p", { style: { fontSize: '11px', color: '#b45309', margin: 0 }, children: "Changing this won't re-encrypt files already exported with the old password \u2014 keep the old one to open those." })), pwError && _jsx("p", { style: { fontSize: '12px', color: '#dc2626', margin: 0 }, children: pwError })] }))] }), _jsx("div", { style: { marginBottom: '8px', borderTop: '1px solid #e5e7eb', paddingTop: '20px' }, children: _jsx("label", { style: { display: 'block', fontWeight: '700', fontSize: '13px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '16px' }, children: "AI Integration" }) }), _jsxs("div", { style: { marginBottom: '24px' }, children: [_jsx("label", { style: { display: 'block', fontWeight: '600', marginBottom: '8px' }, children: "Claude Model" }), _jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: '8px' }, children: MODEL_OPTIONS.map(opt => (_jsxs("label", { style: {
                                            display: 'flex',
                                            gap: '10px',
                                            padding: '10px',
                                            border: model === opt.value ? '2px solid #3b82f6' : '1px solid #e5e7eb',
                                            borderRadius: '6px',
                                            cursor: 'pointer',
                                            backgroundColor: model === opt.value ? '#eff6ff' : 'white',
                                        }, children: [_jsx("input", { type: "radio", name: "model", value: opt.value, checked: model === opt.value, onChange: () => setModel(opt.value), style: { marginTop: '4px' } }), _jsxs("div", { children: [_jsx("div", { style: { fontWeight: '600' }, children: opt.label }), _jsx("div", { style: { fontSize: '12px', color: '#6b7280' }, children: opt.description })] })] }, opt.value))) })] }), _jsxs("div", { style: { marginBottom: '24px' }, children: [_jsx("label", { style: { display: 'block', fontWeight: '600', marginBottom: '8px' }, children: "Claude API Key" }), hasExistingKey && !replacingKey ? (_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }, children: [_jsx("span", { style: { fontSize: '13px', color: '#374151' }, children: "\uD83D\uDD12 API key is set." }), _jsx("button", { onClick: handleReplaceKey, style: {
                                                padding: '6px 12px', border: '1px solid #d1d5db', borderRadius: '6px',
                                                background: 'white', cursor: 'pointer', fontSize: '13px',
                                            }, children: "Replace\u2026" }), _jsx("button", { onClick: () => { onClearKey(); setApiKey(''); }, style: {
                                                padding: '6px 12px',
                                                background: '#fee2e2',
                                                color: '#dc2626',
                                                border: '1px solid #fca5a5',
                                                borderRadius: '6px',
                                                cursor: 'pointer',
                                                fontSize: '13px',
                                            }, children: "Clear stored key" })] })) : (_jsxs("div", { style: { display: 'flex', gap: '8px' }, children: [_jsx("input", { type: showKey ? 'text' : 'password', value: apiKey, onChange: (e) => setApiKey(e.target.value), placeholder: hasExistingKey ? 'Enter a new key' : 'sk-ant-...', autoComplete: "off", style: {
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
                                            }, children: showKey ? 'Hide' : 'Show' })] })), unlockError && (_jsx("p", { style: { fontSize: '12px', color: '#dc2626', marginTop: '6px' }, children: unlockError })), _jsxs("p", { style: { fontSize: '12px', color: '#6b7280', marginTop: '6px' }, children: [lock
                                            ? 'Your key is encrypted at rest under your app PIN and rides inside your downloaded schedule, so it follows the file. '
                                            : 'Your key rides inside your downloaded schedule (lightly obfuscated), so it follows the file, and stays in this browser session. ', "It is sent per-request via header and never stored on the server."] })] })] }), _jsx("button", { onClick: handleSave, style: {
                        position: 'absolute',
                        right: 16,
                        top: atBottom ? 16 : undefined,
                        bottom: atBottom ? undefined : 16,
                        padding: '10px 20px',
                        backgroundColor: '#3b82f6',
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        fontWeight: 600,
                        fontSize: 14,
                        boxShadow: '0 2px 8px rgba(59,130,246,0.4)',
                        transition: 'top 0.3s ease, bottom 0.3s ease',
                        zIndex: 10,
                    }, children: "Save" })] }) }));
}
//# sourceMappingURL=Settings.js.map