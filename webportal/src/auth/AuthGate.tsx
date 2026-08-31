import './auth.css';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { readSession, signOut, AuthError, type Account } from './portalAuth';
import { AuthSessionProvider, type PortalAuth } from './AuthSession';
import SignInScreen from './SignInScreen';
import ChangePasswordScreen from './ChangePasswordScreen';
import UserAdminScreen from './UserAdminScreen';

// Whether the portal shows the app or a login screen, and nothing else.
//
// THIS IS NOT THE SECURITY BOUNDARY AND MUST NOT BE MISTAKEN FOR ONE.
// functions/lib/gate.ts is: the middleware serves the page shell to anyone once a
// login store is bound, and answers 401 on every API path with no session behind it.
// A single-page app's login screen IS the shell, so the shell has to be reachable.
// What this component does is decide which screen a person sees, which is a courtesy
// to them and not a defence against anybody.
//
// THE UNCONFIGURED BRANCH IS WHY SHIPPING THIS CANNOT TAKE THE SITE DOWN. On a
// deployment with no PORTAL_DB bound, /api/auth/session answers 503, and this hands
// straight through to the app exactly as every build before Phase 2 did. Cloudflare
// Access is still in front of that deployment, so nothing is opened by passing through.

type Gate =
  | { readonly kind: 'checking' }
  /** The session could not be read at all. Distinct from being signed out. */
  | { readonly kind: 'unreachable'; readonly message: string }
  | { readonly kind: 'unconfigured' }
  | {
      readonly kind: 'signed-out';
      readonly accessEmail: string | null;
      readonly notice: string | null;
    }
  /** A temp password was spent and the change ticket is the only thing they hold. */
  | { readonly kind: 'must-change' }
  | { readonly kind: 'signed-in'; readonly user: Account };

/** Which screen a signed-in person is looking at. */
type View = 'app' | 'admin' | 'password';

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [gate, setGate] = useState<Gate>({ kind: 'checking' });
  const [view, setView] = useState<View>('app');

  const load = useCallback(async (notice: string | null) => {
    setGate({ kind: 'checking' });
    try {
      const state = await readSession();

      if (state.kind === 'unconfigured') {
        setGate({ kind: 'unconfigured' });
        return;
      }

      if (state.kind === 'signed-in') {
        // A session should never carry mustChangePassword, because login mints a
        // ticket instead of a session in that case. If one somehow does, the person
        // is sent to set a password on the session path rather than into the app.
        setView(state.mustChangePassword ? 'password' : 'app');
        setGate({ kind: 'signed-in', user: state.user });
        return;
      }

      setGate(
        state.holdsChangeTicket
          ? { kind: 'must-change' }
          : { kind: 'signed-out', accessEmail: state.accessEmail, notice },
      );
    } catch (cause) {
      setGate({
        kind: 'unreachable',
        message: cause instanceof AuthError
          ? cause.message
          : 'The portal could not work out whether you are signed in.',
      });
    }
  }, []);

  useEffect(() => { void load(null); }, [load]);

  const handleSignOut = useCallback(async () => {
    try {
      await signOut();
    } catch {
      // A sign-out that fails on the wire still ends here: re-reading the session is
      // what decides the next screen, and it will find whatever is actually true.
    }
    await load(null);
  }, [load]);

  const auth: PortalAuth = useMemo(() => ({
    account: gate.kind === 'signed-in' ? gate.user : null,
    configured: gate.kind !== 'unconfigured',
    signOut: () => { void handleSignOut(); },
    openUserAdmin: () => { setView('admin'); },
    changePassword: () => { setView('password'); },
  }), [gate, handleSignOut]);

  if (gate.kind === 'checking') {
    return (
      <div className="portal centered-screen">
        <div className="spinner-wrap">
          <div className="spinner" aria-hidden="true" />
          <p className="spinner-label">Checking your sign-in…</p>
        </div>
      </div>
    );
  }

  if (gate.kind === 'unreachable') {
    return (
      <div className="portal centered-screen">
        <div className="password-card">
          <h2>The portal could not reach the server</h2>
          <p>{gate.message}</p>
          <div className="form-actions">
            <button type="button" className="btn-primary" onClick={() => { void load(null); }}>
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (gate.kind === 'signed-out') {
    return (
      <SignInScreen
        accessEmail={gate.accessEmail}
        notice={gate.notice}
        onSignedIn={(user) => { setView('app'); setGate({ kind: 'signed-in', user }); }}
        onNeedsNewPassword={() => { setGate({ kind: 'must-change' }); }}
      />
    );
  }

  if (gate.kind === 'must-change') {
    return (
      <ChangePasswordScreen
        mode="ticket"
        email={null}
        onDone={(message) => { void load(message); }}
      />
    );
  }

  if (gate.kind === 'signed-in' && view === 'password') {
    return (
      <ChangePasswordScreen
        mode="session"
        email={gate.user.email}
        onDone={(message) => { void load(message); }}
        onCancel={() => { setView('app'); }}
      />
    );
  }

  if (gate.kind === 'signed-in' && view === 'admin' && gate.user.role === 'admin') {
    return <UserAdminScreen currentUser={gate.user} onClose={() => { setView('app'); }} />;
  }

  return <AuthSessionProvider value={auth}>{children}</AuthSessionProvider>;
}
