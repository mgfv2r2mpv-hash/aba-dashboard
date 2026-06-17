import React, { useEffect, useRef, useState } from 'react';

export default function PasswordForm({
  onSubmit,
  onCancel,
  error,
  isLoading,
}: {
  onSubmit: (pwd: string) => void;
  onCancel: () => void;
  error: string | null;
  isLoading: boolean;
}) {
  const [pwd, setPwd] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  return (
    <div className="portal centered-screen">
      <form
        className="password-card"
        onSubmit={e => { e.preventDefault(); if (pwd) onSubmit(pwd); }}
        noValidate
      >
        <h2>Enter Schedule Password</h2>
        <p>
          Enter the password you set when exporting this file from the ABA Dashboard app.
          It never leaves your device.
        </p>

        {/* Hidden username field for password manager AutoFill */}
        <input
          type="text" name="username" value="aba-schedule"
          autoComplete="username" readOnly tabIndex={-1}
          className="sr-only" aria-hidden="true"
        />

        <label htmlFor="pwd" className="form-label">Schedule password</label>
        <input
          ref={inputRef}
          id="pwd"
          type="password"
          name="schedule-password"
          autoComplete="current-password"
          value={pwd}
          onChange={e => { setPwd(e.target.value); }}
          placeholder="Password"
          className={`form-input${error ? ' has-error' : ''}`}
          aria-describedby={error ? 'pwd-error' : undefined}
          aria-invalid={!!error}
          disabled={isLoading}
        />

        <div id="pwd-error" className="form-error" role="alert" aria-live="polite">
          {error ?? ''}
        </div>

        <div className="form-actions">
          <button type="button" className="btn-ghost" onClick={onCancel} disabled={isLoading}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={!pwd || isLoading}>
            {isLoading ? 'Decrypting…' : 'Open'}
          </button>
        </div>
      </form>
    </div>
  );
}
