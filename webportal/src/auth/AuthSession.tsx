import React, { createContext, useContext } from 'react';
import type { Account } from './portalAuth';

// What the signed-in app is allowed to know about who is using it.
//
// AuthGate owns the real state; this is the window the rest of the portal looks
// through. It exists so AccountMenu can name who is signed in without WebApp or
// ReadyView having to thread a single prop down to it.

export interface PortalAuth {
  /** The signed-in account, or null when nobody is. */
  readonly account: Account | null;
  /**
   * Whether app login is running on this deployment at all. False means no login
   * store is bound and Cloudflare Access is still the only gate, which is the state
   * every build shipped before Phase 2 and the one the portal must keep working in.
   */
  readonly configured: boolean;
  /** Ends the portal session. Does not touch the Access SSO session. */
  readonly signOut: () => void;
  /** Opens the account list. Only ever offered to an administrator. */
  readonly openUserAdmin: () => void;
  /** Opens the change-password screen for the account already signed in. */
  readonly changePassword: () => void;
}

function ignore(): void {
  /* A portal rendered outside the gate has nothing to sign out of. */
}

const FALLBACK: PortalAuth = {
  account: null,
  configured: false,
  signOut: ignore,
  openUserAdmin: ignore,
  changePassword: ignore,
};

const AuthSessionContext = createContext<PortalAuth>(FALLBACK);

export function AuthSessionProvider({
  value,
  children,
}: {
  value: PortalAuth;
  children: React.ReactNode;
}) {
  return <AuthSessionContext.Provider value={value}>{children}</AuthSessionContext.Provider>;
}

/**
 * Reads the current account.
 *
 * Falls back to "no account, login not configured" rather than throwing when there is
 * no provider above it, because a component that only wants to draw a Log out link
 * should not be the thing that takes the screen down.
 */
export function usePortalAuth(): PortalAuth {
  return useContext(AuthSessionContext);
}
