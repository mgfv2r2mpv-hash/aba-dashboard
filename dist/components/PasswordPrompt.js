import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useState, useEffect, useRef } from 'react';
// Modal replacement for window.prompt() on the schedule-decrypt path. Using a
// real <form> with a password <input autocomplete="current-password"> lets iOS
// surface the Passwords key above the keyboard, unlike prompt() which can't.
export default function PasswordPrompt({ title, message, username = 'aba-schedule', placeholder = 'Schedule password', submitLabel = 'Open', onSubmit, onCancel }) {
    const [password, setPassword] = useState('');
    const inputRef = useRef(null);
    useEffect(() => { inputRef.current?.focus(); }, []);
    const submit = (e) => {
        e.preventDefault();
        if (password)
            onSubmit(password);
    };
    return (_jsx("div", { style: {
            position: 'fixed', inset: 0, zIndex: 1500,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 'max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom))',
            boxSizing: 'border-box',
        }, children: _jsxs("form", { onSubmit: submit, style: {
                backgroundColor: 'white', borderRadius: 8, padding: 20,
                width: '100%', maxWidth: 420, boxSizing: 'border-box',
            }, children: [_jsx("h2", { style: { fontSize: 18, fontWeight: 700, margin: '0 0 8px' }, children: title }), _jsx("p", { style: { fontSize: 13, color: '#6b7280', margin: '0 0 16px', lineHeight: 1.4 }, children: message }), _jsx("input", { type: "text", name: "username", value: username, autoComplete: "username", readOnly: true, tabIndex: -1, "aria-hidden": "true", style: { position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' } }), _jsx("input", { ref: inputRef, type: "password", name: "schedule-password", autoComplete: "current-password", value: password, onChange: (e) => setPassword(e.target.value), placeholder: placeholder, "aria-label": placeholder, style: {
                        width: '100%', boxSizing: 'border-box',
                        padding: '10px 12px', fontSize: 15,
                        border: '1px solid #d1d5db', borderRadius: 6,
                    } }), _jsxs("div", { style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }, children: [_jsx("button", { type: "button", onClick: onCancel, style: { padding: '8px 16px', border: '1px solid #d1d5db', borderRadius: 6, background: 'white', cursor: 'pointer' }, children: "Cancel" }), _jsx("button", { type: "submit", disabled: !password, style: {
                                padding: '8px 16px', backgroundColor: password ? '#3b82f6' : '#93c5fd',
                                color: 'white', border: 'none', borderRadius: 6,
                                cursor: password ? 'pointer' : 'default',
                            }, children: submitLabel })] })] }) }));
}
//# sourceMappingURL=PasswordPrompt.js.map