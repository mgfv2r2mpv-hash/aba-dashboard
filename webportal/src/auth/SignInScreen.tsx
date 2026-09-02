import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  signIn, createUser, isFirstRunOpen, AuthError,
  type Account, type Issued,
} from './portalAuth';
import TempPasswordNotice from './TempPasswordNotice';

// The portal's sign-in screen, and the only door into an empty store.
//
// THE EMPTY-STORE CASE IS THE WHOLE POINT OF THE FIRST-RUN PANEL. The server lets an
// Access-authenticated caller make an account only while no accounts exist, and it
// demands an admin SESSION from then on. Without an offer on this screen the first
// administrator can only be created by hand-writing a request, and the person who
// needs to do that is the one person who has not got in yet.

type Mode =
  /** Asking the server whether the store is empty. Only ever a moment. */
  | { readonly kind: 'probing' }
  | { readonly kind: 'sign-in' }
  | { readonly kind: 'first-run' }
  /** The first account was made and its temp password is on screen, once. */
  | { readonly kind: 'issued'; readonly issued: Issued };

export default function SignInScreen({
  accessEmail,
  notice,
  onSignedIn,
  onNeedsNewPassword,
}: {
  accessEmail: string | null;
  /** Something that just happened elsewhere and explains why they are here. */
  notice: string | null;
  onSignedIn: (user: Account) => void;
  onNeedsNewPassword: () => void;
}) {
  // Access already knows who reached the origin, so the field starts filled in.
  const [email, setEmail] = useState(accessEmail ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Nobody without an Access identity can pass the first-run check, so the probe is
  // skipped entirely for them and the form shows immediately.
  const [mode, setMode] = useState<Mode>(
    accessEmail === null ? { kind: 'sign-in' } : { kind: 'probing' },
  );

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode.kind !== 'probing') return;
    let live = true;
    isFirstRunOpen().then((open) => {
      if (live) setMode({ kind: open ? 'first-run' : 'sign-in' });
    });
    return () => { live = false; };
  }, [mode.kind]);

  // Land the cursor where the person still has typing to do, once, as the form
  // appears. Access prefills the address, so a box that already holds one means the
  // password is the only thing left.
  //
  // THIS MUST NOT DEPEND ON WHAT THEY TYPE. It used to depend on `email.length`, and
  // so every keystroke in an empty address box re-ran it, found a non-empty value,
  // and threw the cursor into the password field mid-word. Typing an address was not
  // possible: the first character landed in Email and the second in Password. Where
  // the cursor LANDS is a question about the form appearing, not about typing, which
  // is why the value is read off the field here rather than tracked as a dependency.
  useEffect(() => {
    if (mode.kind !== 'sign-in') return;
    const field = emailRef.current?.value ? passwordRef.current : emailRef.current;
    field?.focus();
  }, [mode.kind]);

  const handleSignIn = useCallback(async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || email.trim().length === 0 || password.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const outcome = await signIn(email.trim(), password);
      // Clear it either way: on the ticket path the next screen must not be able to
      // read the temp password out of this component's state.
      setPassword('');
      if (outcome.kind === 'signed-in') onSignedIn(outcome.user);
      else onNeedsNewPassword();
    } catch (cause) {
      setError(cause instanceof AuthError ? cause.message : 'Sign in did not work. Try again.');
      setBusy(false);
      passwordRef.current?.focus();
    }
  }, [busy, email, password, onSignedIn, onNeedsNewPassword]);

  const handleCreateFirst = useCallback(async () => {
    if (busy || accessEmail === null) return;
    setBusy(true);
    setError(null);
    try {
      // The role asked for is a formality here: the server forces 'admin' on an empty
      // store whatever it is sent. Asking for 'admin' just keeps the request honest.
      const created = await createUser(accessEmail, 'admin');
      // First-run is the one creation that hands the password straight back, because
      // there is nobody to email it to and nobody who could turn the account on. If a
      // server ever answered this screen with an invitation instead, the person would
      // be left looking at a first-run panel for an account they cannot reach, so this
      // says so rather than rendering an empty notice.
      if (created.kind !== 'issued') {
        throw new AuthError(500, 'The account was made but no password came back. Ask for a temporary password.');
      }
      setMode({ kind: 'issued', issued: created });
    } catch (cause) {
      setError(cause instanceof AuthError ? cause.message : 'That account could not be made.');
    } finally {
      setBusy(false);
    }
  }, [busy, accessEmail]);

  const continueToSignIn = useCallback((issued: Issued) => {
    setEmail(issued.user.email);
    setPassword('');
    setError(null);
    setMode({ kind: 'sign-in' });
  }, []);

  if (mode.kind === 'probing') {
    return (
      <div className="portal centered-screen">
        <div className="spinner-wrap">
          <div className="spinner" aria-hidden="true" />
          <p className="spinner-label">Checking the portal…</p>
        </div>
      </div>
    );
  }

  if (mode.kind === 'issued') {
    return (
      <div className="portal centered-screen">
        <div className="password-card">
          <h2>Administrator created</h2>
          <p>
            {mode.issued.user.email} is now the portal administrator. Sign in with the
            temporary password below and the portal will ask you to choose your own.
          </p>
          <TempPasswordNotice tempPassword={mode.issued.tempPassword} />
          <div className="form-actions">
            <button
              type="button"
              className="btn-primary"
              onClick={() => { continueToSignIn(mode.issued); }}
            >
              Continue to sign in
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (mode.kind === 'first-run') {
    return (
      <div className="portal centered-screen">
        <div className="password-card">
          <h2>Set up the first administrator</h2>
          <p>
            This portal has no accounts yet. Cloudflare Access has signed you in as{' '}
            <strong>{accessEmail}</strong>, so you can create the first one. Everybody
            after you gets their account from inside the portal.
          </p>
          <div className="auth-note">
            Creating this account closes the setup door. From then on only an
            administrator signed into the portal can add people.
          </div>

          {error && <div className="form-error" role="alert">{error}</div>}

          <div className="form-actions">
            <button
              type="button"
              className="btn-ghost"
              onClick={() => { setMode({ kind: 'sign-in' }); }}
              disabled={busy}
            >
              I already have an account
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={handleCreateFirst}
              disabled={busy}
            >
              {busy ? 'Creating…' : 'Create administrator'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="portal centered-screen">
      <form className="password-card" onSubmit={handleSignIn} noValidate>
        <h2>Sign in to the ABA Portal</h2>
        {notice && <div className="auth-notice" role="status">{notice}</div>}
        <p>
          Use your portal account. This is not the password on a schedule file, which
          the portal asks for separately once you open one.
        </p>

        <label htmlFor="portal-email" className="form-label">Email</label>
        <input
          ref={emailRef}
          id="portal-email"
          type="email"
          name="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={email}
          onChange={(event) => { setEmail(event.target.value); }}
          placeholder="you@clinic.org"
          className="form-input"
          disabled={busy}
        />

        <div className="auth-field-gap" />

        <label htmlFor="portal-password" className="form-label">Password</label>
        <input
          ref={passwordRef}
          id="portal-password"
          type="password"
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => { setPassword(event.target.value); }}
          placeholder="Password"
          className={`form-input${error ? ' has-error' : ''}`}
          aria-describedby={error ? 'portal-signin-error' : undefined}
          aria-invalid={error !== null}
          disabled={busy}
        />

        <div id="portal-signin-error" className="form-error" role="alert" aria-live="polite">
          {error ?? ''}
        </div>

        <div className="form-actions">
          <button
            type="submit"
            className="btn-primary"
            disabled={busy || email.trim().length === 0 || password.length === 0}
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </div>

        <p className="auth-footnote">
          Forgotten your password? An administrator can issue you a new temporary one.
        </p>
      </form>
    </div>
  );
}
