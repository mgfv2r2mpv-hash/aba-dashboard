import React, { useCallback, useEffect, useRef, useState } from 'react';
import { setPassword, AuthError } from './portalAuth';
// The server owns this rule and this screen reads it rather than restating it, so the
// two can never drift. functions/lib/authPolicy.ts is pure, imports nothing, and is
// already inside the program webportal/tsconfig.json compiles, so reaching across
// costs the client bundle a length check and nothing else.
import {
  checkNewPassword, describeRejection, MIN_PASSWORD_LENGTH,
} from '../../functions/lib/authPolicy';

// Choosing a password, reached two ways that are not the same thing.
//
// On a TICKET: a temporary password was spent to get here, the server already checked
// it, and it bought fifteen minutes to pick a real one. Asking for it again would be
// asking the person to retype something they were handed.
//
// On a SESSION: somebody with a working password is replacing it, and the server
// demands they prove they own the one they are replacing.
//
// Either way the server drops EVERY session that person holds and clears both
// cookies, so this screen always hands back to sign-in. That is not a rough edge: the
// sign-in that follows is the first proof the new password took.

export default function ChangePasswordScreen({
  mode,
  email,
  onDone,
  onCancel,
}: {
  mode: 'ticket' | 'session';
  email: string | null;
  onDone: (message: string) => void;
  onCancel?: () => void;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const firstFieldRef = useRef<HTMLInputElement>(null);
  useEffect(() => { firstFieldRef.current?.focus(); }, []);

  const rejection = next.length > 0 ? checkNewPassword(next) : null;
  const mismatch = confirm.length > 0 && next !== confirm;
  const ready =
    rejection === null &&
    next.length > 0 &&
    next === confirm &&
    (mode === 'ticket' || current.length > 0);

  const submit = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !ready) return;
    setBusy(true);
    setError(null);
    try {
      await setPassword({
        newPassword: next,
        ...(mode === 'session' ? { currentPassword: current } : {}),
      });
      // Nothing about the old password survives this component.
      setCurrent('');
      setNext('');
      setConfirm('');
      onDone('Your password is set. Sign in with it.');
    } catch (cause) {
      setError(
        cause instanceof AuthError ? cause.message : 'That password could not be set.',
      );
      setBusy(false);
    }
  }, [busy, ready, next, current, mode, onDone]);

  const heading = mode === 'ticket' ? 'Choose your password' : 'Change your password';

  return (
    <div className="portal centered-screen">
      <form className="password-card" onSubmit={submit} noValidate>
        <h2>{heading}</h2>
        <p>
          {mode === 'ticket'
            ? 'The password you signed in with was a temporary one. Pick your own to finish setting up the account'
            : 'Pick a new password for your portal account'}
          {email === null ? '.' : <> for <strong>{email}</strong>.</>}
        </p>

        {/* Named for password managers, which offer to save the pair on submit. */}
        <input
          type="text" name="username" value={email ?? ''}
          autoComplete="username" readOnly tabIndex={-1}
          className="sr-only" aria-hidden="true"
        />

        {mode === 'session' && (
          <>
            <label htmlFor="pw-current" className="form-label">Current password</label>
            <input
              ref={firstFieldRef}
              id="pw-current"
              type="password"
              name="current-password"
              autoComplete="current-password"
              value={current}
              onChange={(event) => { setCurrent(event.target.value); }}
              className="form-input"
              disabled={busy}
            />
            <div className="auth-field-gap" />
          </>
        )}

        <label htmlFor="pw-new" className="form-label">New password</label>
        <input
          ref={mode === 'ticket' ? firstFieldRef : undefined}
          id="pw-new"
          type="password"
          name="new-password"
          autoComplete="new-password"
          value={next}
          onChange={(event) => { setNext(event.target.value); }}
          className={`form-input${rejection ? ' has-error' : ''}`}
          aria-describedby="pw-rule"
          aria-invalid={rejection !== null}
          disabled={busy}
        />
        <p id="pw-rule" className={rejection ? 'auth-rule is-unmet' : 'auth-rule'}>
          {rejection
            ? describeRejection(rejection)
            : `At least ${MIN_PASSWORD_LENGTH} characters. A passphrase you can remember beats a short one you cannot.`}
        </p>

        <div className="auth-field-gap" />

        <label htmlFor="pw-confirm" className="form-label">New password again</label>
        <input
          id="pw-confirm"
          type="password"
          name="confirm-password"
          autoComplete="new-password"
          value={confirm}
          onChange={(event) => { setConfirm(event.target.value); }}
          className={`form-input${mismatch ? ' has-error' : ''}`}
          aria-invalid={mismatch}
          disabled={busy}
        />

        <div className="form-error" role="alert" aria-live="polite">
          {error ?? (mismatch ? 'Those two do not match.' : '')}
        </div>

        <div className="form-actions">
          {onCancel && (
            <button type="button" className="btn-ghost" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
          )}
          <button type="submit" className="btn-primary" disabled={busy || !ready}>
            {busy ? 'Saving…' : 'Set password'}
          </button>
        </div>

        <p className="auth-footnote">
          Setting it signs you out everywhere, including here. Sign in again with the
          new one.
        </p>
      </form>
    </div>
  );
}
