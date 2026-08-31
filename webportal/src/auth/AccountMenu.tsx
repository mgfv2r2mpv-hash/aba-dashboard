import React, { useCallback, useEffect, useRef, useState } from 'react';
import { usePortalAuth } from './AuthSession';
import { ROLE_LABELS } from './portalAuth';

// Who you are signed in as, and the things you can do about it.
//
// This replaces the bare Access logout link the portal used to show, and it keeps
// that link: the two are different doors and conflating them is how somebody ends up
// signing out of the building when they meant to leave their desk. A PORTAL sign-out
// drops the account session and lands on the sign-in screen. An ACCESS sign-out ends
// the Cloudflare SSO session for the whole site.
//
// With no portal account in context - a deployment with no login store bound, or a
// component rendered outside AuthGate - it falls back to exactly the Access link the
// portal has always shown, so nothing about those builds changes.

/** Long addresses would push the header around, so the local part carries the name. */
function shortEmail(email: string): string {
  const at = email.indexOf('@');
  return at > 0 ? email.slice(0, at) : email;
}

const ACCESS_LOGOUT = '/cdn-cgi/access/logout';

export default function AccountMenu({ fixed = false }: { fixed?: boolean }) {
  const { account, openUserAdmin, changePassword, signOut } = usePortalAuth();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // A menu that will not close when you click the page is worse than no menu.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const choose = useCallback((action: () => void) => {
    setOpen(false);
    action();
  }, []);

  if (account === null) {
    const link = (
      <a className="btn-ghost" href={ACCESS_LOGOUT} aria-label="Log out of the portal">
        ⇥ Log out
      </a>
    );
    return fixed ? <div className="portal-logout-fixed">{link}</div> : link;
  }

  const menu = (
    <div className="account-menu" ref={wrapRef}>
      <button
        type="button"
        className="btn-ghost account-menu-trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => { setOpen((was) => !was); }}
      >
        <span className="account-menu-avatar" aria-hidden="true">
          {shortEmail(account.email).slice(0, 1).toUpperCase()}
        </span>
        <span className="account-menu-name">{shortEmail(account.email)}</span>
      </button>

      {open && (
        <div className="account-menu-panel" role="menu">
          <div className="account-menu-who">
            <div className="account-menu-email">{account.email}</div>
            <div className="account-menu-role">{ROLE_LABELS[account.role]}</div>
          </div>

          {account.role === 'admin' && (
            <button
              type="button"
              role="menuitem"
              className="account-menu-item"
              onClick={() => { choose(openUserAdmin); }}
            >
              Manage people
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            className="account-menu-item"
            onClick={() => { choose(changePassword); }}
          >
            Change password
          </button>
          <button
            type="button"
            role="menuitem"
            className="account-menu-item"
            onClick={() => { choose(signOut); }}
          >
            Sign out
          </button>

          <div className="account-menu-rule" />
          {/* A same-tab, full-page navigation so the browser reaches Cloudflare's
              edge endpoint, which clears the CF_Authorization cookie. */}
          <a role="menuitem" className="account-menu-item is-quiet" href={ACCESS_LOGOUT}>
            Log out of Access
          </a>
        </div>
      )}
    </div>
  );

  return fixed ? <div className="portal-logout-fixed">{menu}</div> : menu;
}
