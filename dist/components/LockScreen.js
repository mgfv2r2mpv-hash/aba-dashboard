import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useState, useEffect, useRef } from 'react';
const PIN_MIN = 4;
const PIN_MAX = 8;
const isDigits = (s) => /^[0-9]*$/.test(s);
export default function LockScreen({ mode, onCreate, onVerify, onBiometric, biometricAuto, biometryLabel = 'biometric unlock' }) {
    const [pin, setPin] = useState('');
    const [confirm, setConfirm] = useState('');
    const [stage, setStage] = useState('enter');
    const [error, setError] = useState(null);
    const [busy, setBusy] = useState(false);
    const inputRef = useRef(null);
    const triedBiometric = useRef(false);
    useEffect(() => { inputRef.current?.focus(); }, [stage]);
    // Auto-offer Face ID once on a cold unlock.
    useEffect(() => {
        if (mode === 'unlock' && biometricAuto && onBiometric && !triedBiometric.current) {
            triedBiometric.current = true;
            void runBiometric();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const runBiometric = async () => {
        if (!onBiometric || busy)
            return;
        setBusy(true);
        setError(null);
        try {
            const ok = await onBiometric();
            if (!ok)
                setError(`${biometryLabel} unavailable — enter your PIN.`);
        }
        finally {
            setBusy(false);
        }
    };
    const submitCreate = async () => {
        if (pin.length < PIN_MIN) {
            setError(`Use at least ${PIN_MIN} digits.`);
            return;
        }
        if (stage === 'enter') {
            setStage('confirm');
            return;
        }
        if (confirm !== pin) {
            setError("PINs didn't match — try again.");
            setPin('');
            setConfirm('');
            setStage('enter');
            return;
        }
        setBusy(true);
        try {
            await onCreate?.(pin);
        }
        finally {
            setBusy(false);
        }
    };
    const submitUnlock = async () => {
        if (pin.length < PIN_MIN) {
            setError('Enter your PIN.');
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const ok = await onVerify?.(pin);
            if (!ok) {
                setError('Wrong PIN.');
                setPin('');
            }
        }
        finally {
            setBusy(false);
        }
    };
    const onSubmit = (e) => {
        e.preventDefault();
        if (busy)
            return;
        if (mode === 'create')
            void submitCreate();
        else
            void submitUnlock();
    };
    const value = mode === 'create' && stage === 'confirm' ? confirm : pin;
    const setValue = (v) => {
        if (!isDigits(v) || v.length > PIN_MAX)
            return;
        setError(null);
        if (mode === 'create' && stage === 'confirm')
            setConfirm(v);
        else
            setPin(v);
    };
    const title = mode === 'create'
        ? (stage === 'enter' ? 'Create a PIN' : 'Confirm your PIN')
        : 'Enter your PIN';
    const subtitle = mode === 'create'
        ? 'This PIN unlocks the app and encrypts your schedule on this device. There is no recovery if you forget it.'
        : 'Locked on launch to keep your schedule private.';
    const cta = mode === 'create' ? (stage === 'enter' ? 'Continue' : 'Set PIN') : 'Unlock';
    return (_jsx("div", { style: {
            position: 'fixed', inset: 0, zIndex: 2000,
            backgroundColor: '#1f2937', color: 'white',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 'max(24px, env(safe-area-inset-top)) 24px max(24px, env(safe-area-inset-bottom))',
            boxSizing: 'border-box',
        }, children: _jsxs("form", { onSubmit: onSubmit, style: { width: '100%', maxWidth: 320, textAlign: 'center' }, children: [_jsx("div", { style: { fontSize: 40, marginBottom: 12 }, children: "\uD83D\uDD12" }), _jsx("h1", { style: { fontSize: 22, fontWeight: 700, margin: '0 0 8px' }, children: title }), _jsx("p", { style: { fontSize: 13, color: '#9ca3af', margin: '0 0 20px', lineHeight: 1.4 }, children: subtitle }), _jsx("input", { ref: inputRef, type: "password", inputMode: "numeric", autoComplete: "off", pattern: "[0-9]*", value: value, onChange: (e) => setValue(e.target.value), placeholder: "\u2022\u2022\u2022\u2022", "aria-label": title, style: {
                        width: '100%', boxSizing: 'border-box',
                        padding: '14px 16px', fontSize: 24, letterSpacing: 8,
                        textAlign: 'center', borderRadius: 10, border: 'none',
                        color: '#111827', fontFamily: 'monospace',
                    } }), error && (_jsx("div", { style: { color: '#fca5a5', fontSize: 13, marginTop: 12 }, children: error })), _jsx("button", { type: "submit", disabled: busy, style: {
                        width: '100%', marginTop: 18, padding: '13px',
                        backgroundColor: busy ? '#374151' : '#3b82f6', color: 'white',
                        border: 'none', borderRadius: 10, fontSize: 16, fontWeight: 600,
                        cursor: busy ? 'default' : 'pointer',
                    }, children: busy ? '…' : cta }), mode === 'unlock' && onBiometric && (_jsxs("button", { type: "button", onClick: () => void runBiometric(), disabled: busy, style: {
                        width: '100%', marginTop: 10, padding: '11px',
                        background: 'transparent', color: '#93c5fd',
                        border: '1px solid #374151', borderRadius: 10,
                        fontSize: 14, fontWeight: 600, cursor: 'pointer',
                    }, children: ["Use ", biometryLabel] }))] }) }));
}
//# sourceMappingURL=LockScreen.js.map