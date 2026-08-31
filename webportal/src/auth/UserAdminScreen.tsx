import React, { useCallback, useEffect, useState } from 'react';
import {
  listUsers, createUser, setUserDisabled, reissueTempPassword, AuthError,
  ROLES, ROLE_LABELS,
  type Account, type ManagedUser, type UserRole, type Issued,
} from './portalAuth';
import TempPasswordNotice from './TempPasswordNotice';

// The account list. Only an administrator ever reaches this.
//
// What it deliberately does NOT offer: changing somebody's role after the fact, and
// deleting an account. The server has no endpoint for either, and inventing one in the
// client would just produce a control that fails. Turning an account off is the
// supported way to end somebody's access, and it takes their live sessions with it.

function statusOf(user: ManagedUser): { readonly label: string; readonly tone: string } {
  if (user.disabledAt !== null) return { label: 'Turned off', tone: 'is-off' };
  if (user.mustChangePassword) return { label: 'Temporary password', tone: 'is-pending' };
  return { label: 'Active', tone: 'is-active' };
}

function readableDate(iso: string | null): string {
  if (iso === null || iso.length === 0) return 'Never';
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? 'Unknown' : at.toLocaleDateString();
}

export default function UserAdminScreen({
  currentUser,
  onClose,
}: {
  currentUser: Account;
  onClose: () => void;
}) {
  const [users, setUsers] = useState<readonly ManagedUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<Issued | null>(null);

  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('bt');

  const refresh = useCallback(async () => {
    try {
      setUsers(await listUsers());
      setError(null);
    } catch (cause) {
      setError(cause instanceof AuthError ? cause.message : 'The account list would not load.');
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Every mutation ends the same way, so the wrapper owns the busy flag, the error
  // and the reload rather than each handler repeating them.
  const run = useCallback(async (work: () => Promise<Issued | null>, whenItFails: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await work();
      if (result) setIssued(result);
      await refresh();
    } catch (cause) {
      setError(cause instanceof AuthError ? cause.message : whenItFails);
    } finally {
      setBusy(false);
    }
  }, [busy, refresh]);

  const addUser = useCallback((event: React.FormEvent) => {
    event.preventDefault();
    const email = newEmail.trim();
    if (email.length === 0) return;
    void run(async () => {
      const result = await createUser(email, newRole);
      setNewEmail('');
      setNewRole('bt');
      return result;
    }, 'That account could not be made.');
  }, [newEmail, newRole, run]);

  return (
    <div className="portal auth-admin">
      <header className="portal-header">
        <span className="portal-wordmark">ABA <span>Portal</span></span>
        <button type="button" className="btn-ghost" onClick={onClose}>
          ⇤ Back to the portal
        </button>
      </header>

      <main className="auth-admin-body">
        <h1 className="auth-admin-title">People</h1>
        <p className="auth-admin-lede">
          Everybody who can sign in to this portal. A new account is issued a temporary
          password, shown once here, and the portal makes them choose their own the
          first time they use it.
        </p>

        {error && <div className="error-banner" role="alert">{error}</div>}

        {issued && (
          <div className="password-card auth-issued">
            <h2>{issued.user.email}</h2>
            <p>
              Signs in as {ROLE_LABELS[issued.user.role].toLowerCase()}. Hand them the
              password below, however you would hand over any other secret.
            </p>
            <TempPasswordNotice tempPassword={issued.tempPassword} />
            <div className="form-actions">
              <button type="button" className="btn-ghost" onClick={() => { setIssued(null); }}>
                Done
              </button>
            </div>
          </div>
        )}

        <form className="auth-add-row" onSubmit={addUser} noValidate>
          <div className="auth-add-field">
            <label htmlFor="new-user-email" className="form-label">Email</label>
            <input
              id="new-user-email"
              type="email"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={newEmail}
              onChange={(event) => { setNewEmail(event.target.value); }}
              placeholder="them@clinic.org"
              className="form-input"
              disabled={busy}
            />
          </div>
          <div className="auth-add-field auth-add-field--role">
            <label htmlFor="new-user-role" className="form-label">Role</label>
            <select
              id="new-user-role"
              className="form-input"
              value={newRole}
              onChange={(event) => { setNewRole(event.target.value as UserRole); }}
              disabled={busy}
            >
              {ROLES.map((role) => (
                <option key={role} value={role}>{ROLE_LABELS[role]}</option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="btn-primary auth-add-submit"
            disabled={busy || newEmail.trim().length === 0}
          >
            Add person
          </button>
        </form>

        {users === null ? (
          <div className="spinner-wrap">
            <div className="spinner" aria-hidden="true" />
            <p className="spinner-label">Loading people…</p>
          </div>
        ) : (
          <div className="auth-table-scroll">
            <table className="auth-table">
              <thead>
                <tr>
                  <th scope="col">Email</th>
                  <th scope="col">Role</th>
                  <th scope="col">Status</th>
                  <th scope="col">Last signed in</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const status = statusOf(user);
                  const isSelf = user.id === currentUser.id;
                  return (
                    <tr key={user.id} className={user.disabledAt ? 'is-off-row' : undefined}>
                      <th scope="row" className="auth-cell-email">
                        {user.email}
                        {isSelf && <span className="auth-you">you</span>}
                      </th>
                      <td>{ROLE_LABELS[user.role]}</td>
                      <td><span className={`auth-status ${status.tone}`}>{status.label}</span></td>
                      <td>{readableDate(user.lastLoginAt)}</td>
                      <td className="auth-cell-actions">
                        <button
                          type="button"
                          className="btn-ghost"
                          disabled={busy}
                          onClick={() => {
                            void run(
                              () => reissueTempPassword(user.id),
                              'That temporary password could not be issued.',
                            );
                          }}
                        >
                          New temp password
                        </button>
                        <button
                          type="button"
                          className={user.disabledAt ? 'btn-ghost' : 'btn-ghost danger'}
                          // The server does not stop an administrator turning their own
                          // account off, and doing it would end their session and could
                          // leave the portal with no administrator at all.
                          disabled={busy || isSelf}
                          title={isSelf ? 'You cannot turn off your own account.' : undefined}
                          onClick={() => {
                            void run(async () => {
                              await setUserDisabled(user.id, user.disabledAt === null);
                              return null;
                            }, 'That account could not be changed.');
                          }}
                        >
                          {user.disabledAt ? 'Turn back on' : 'Turn off'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
