import React, { useState, useEffect, useRef } from 'react';

interface PasswordPromptProps {
  title: string;
  message: string;
  // A hidden username paired with the password field nudges iOS / password
  // managers to offer AutoFill and to save the entry. Defaults to the app name.
  username?: string;
  // Field placeholder + submit-button label. Default to the schedule-decrypt
  // wording; callers reusing this for other secrets (e.g. the app PIN) override.
  placeholder?: string;
  submitLabel?: string;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}

// Modal replacement for window.prompt() on the schedule-decrypt path. Using a
// real <form> with a password <input autocomplete="current-password"> lets iOS
// surface the Passwords key above the keyboard, unlike prompt() which can't.
export default function PasswordPrompt({ title, message, username = 'aba-schedule', placeholder = 'Schedule password', submitLabel = 'Open', onSubmit, onCancel }: PasswordPromptProps) {
  const [password, setPassword] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password) onSubmit(password);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1500,
      backgroundColor: 'rgba(0,0,0,0.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 'max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom))',
      boxSizing: 'border-box',
    }}>
      <form onSubmit={submit} style={{
        backgroundColor: 'white', borderRadius: 8, padding: 20,
        width: '100%', maxWidth: 420, boxSizing: 'border-box',
      }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 8px' }}>{title}</h2>
        <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 16px', lineHeight: 1.4 }}>{message}</p>

        {/* Off-screen username so the password field associates with a saved
            credential for AutoFill. Not editable by the user. */}
        <input
          type="text"
          name="username"
          value={username}
          autoComplete="username"
          readOnly
          tabIndex={-1}
          aria-hidden="true"
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
        />

        <input
          ref={inputRef}
          type="password"
          name="schedule-password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: '10px 12px', fontSize: 15,
            border: '1px solid #d1d5db', borderRadius: 6,
          }}
        />

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{ padding: '8px 16px', border: '1px solid #d1d5db', borderRadius: 6, background: 'white', cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!password}
            style={{
              padding: '8px 16px', backgroundColor: password ? 'var(--brand-primary)' : 'var(--sage-300)',
              color: 'white', border: 'none', borderRadius: 6,
              cursor: password ? 'pointer' : 'default',
            }}
          >
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
