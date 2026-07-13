import React, { useState } from 'react';
import { validatePassword } from '@shared/passwordPolicy';

// Shown on Save when the current session password does not meet the file-password
// policy. Pre-filled with that password so a compliant one is one edit away; the
// live checklist mirrors validatePassword and the download stays disabled until every
// rule passes. Submitting re-encrypts the backup with the chosen password.
interface Props {
  initialPassword: string;
  dict: ReadonlySet<string> | null;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}

export default function BackupPasswordDialog({ initialPassword, dict, onSubmit, onCancel }: Props) {
  const [pw, setPw] = useState(initialPassword);
  const [show, setShow] = useState(false);
  const { valid, rules } = validatePassword(pw, dict ?? undefined);

  return (
    <div className="pw-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="pw-dialog-title">
      <form
        className="pw-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSubmit(pw);
        }}
      >
        <h2 id="pw-dialog-title" className="pw-dialog-title">Set a backup password</h2>
        <p className="pw-dialog-desc">
          This encrypts your downloaded backup. You'll need the same password to open it again — here or in the
          ABA Dashboard app. Choose a strong one:
        </p>

        <div className="pw-input-row">
          <input
            type={show ? 'text' : 'password'}
            className="form-input"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            autoComplete="new-password"
            aria-label="Backup password"
            autoFocus
          />
          <button type="button" className="btn-ghost" onClick={() => setShow((s) => !s)}>
            {show ? 'Hide' : 'Show'}
          </button>
        </div>

        <ul className="pw-checklist" aria-live="polite">
          {rules.map((r) => (
            <li key={r.id} className={r.ok ? 'pw-rule-ok' : 'pw-rule-no'}>
              <span aria-hidden="true">{r.ok ? '✓' : '○'}</span> {r.label}
            </li>
          ))}
        </ul>

        <div className="pw-dialog-actions">
          <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={!valid}>↓ Encrypt &amp; download</button>
        </div>
      </form>
    </div>
  );
}
