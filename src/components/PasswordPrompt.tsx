import React, { useState, useEffect, useRef } from 'react';
import { validatePassword } from '../passwordPolicy';
import { loadPasswordDict } from '../passwordDictLoader';

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
  // Enforce the file-password policy: show a live rule checklist and block submit
  // until every rule passes. Used when CREATING/CHOOSING a password (a backup),
  // never for decrypt-entry (an existing file must open regardless).
  policy?: boolean;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}

// Modal replacement for window.prompt() on the schedule-decrypt path. Using a
// real <form> with a password <input> lets iOS surface the Passwords key above the
// keyboard, unlike prompt() which can't.
export default function PasswordPrompt({ title, message, username = 'aba-schedule', placeholder = 'Schedule password', submitLabel = 'Open', policy = false, onSubmit, onCancel }: PasswordPromptProps) {
  const [password, setPassword] = useState('');
  const [dict, setDict] = useState<ReadonlySet<string> | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    if (!policy) return;
    let live = true;
    loadPasswordDict().then((d) => { if (live) setDict(d); });
    return () => { live = false; };
  }, [policy]);

  const result = policy ? validatePassword(password, dict ?? undefined) : null;
  const canSubmit = policy ? !!result?.valid : !!password;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (canSubmit) onSubmit(password);
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
        width: '100%', maxWidth: 420, maxHeight: '90dvh', overflowY: 'auto', boxSizing: 'border-box',
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
          autoComplete={policy ? 'new-password' : 'current-password'}
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

        {policy && result && (
          <ul aria-live="polite" style={{ listStyle: 'none', padding: 0, margin: '12px 0 0', display: 'flex', flexDirection: 'column', gap: 5 }}>
            {result.rules.map((r) => (
              <li key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12.5, color: r.ok ? '#4b5563' : '#374151' }}>
                <span aria-hidden="true" style={{ fontWeight: 700, color: r.ok ? '#16a34a' : '#9ca3af' }}>{r.ok ? '✓' : '○'}</span>
                {r.label}
              </li>
            ))}
          </ul>
        )}

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
            disabled={!canSubmit}
            style={{
              padding: '8px 16px', backgroundColor: canSubmit ? 'var(--brand-primary)' : 'var(--sage-300)',
              color: 'white', border: 'none', borderRadius: 6,
              cursor: canSubmit ? 'pointer' : 'default',
            }}
          >
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
