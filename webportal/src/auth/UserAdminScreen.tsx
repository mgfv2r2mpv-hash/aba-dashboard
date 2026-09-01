import React, { useCallback, useEffect, useState } from 'react';
import {
  listUsers, createUser, setUserDisabled, sendTempPassword, isValidEmail, AuthError,
  ROLES, ROLE_LABELS,
  type Account, type ManagedUser, type UserRole,
} from './portalAuth';
import TempPasswordNotice from './TempPasswordNotice';

// The account list. Only an administrator ever reaches this.
//
// What it deliberately does NOT offer: changing somebody's role after the fact, and
// deleting an account. The server has no endpoint for either, and inventing one in the
// client would just produce a control that fails. Turning an account off is the
// supported way to end somebody's access, and it takes their live sessions with it.

/**
 * What has happened to this account so far, in four states rather than three.
 *
 * "Not invited yet" and "Turned off" are both disabled rows, and telling them apart
 * matters: one is an address somebody typed and has not acted on, the other is access
 * that was deliberately taken away. Read together, `disabledAt` plus a password the
 * person has never spent plus a sign-in that never happened can only be the first.
 */
function statusOf(user: ManagedUser): { readonly label: string; readonly tone: string } {
  if (user.disabledAt !== null) {
    return user.mustChangePassword && user.lastLoginAt === null
      ? { label: 'Not invited yet', tone: 'is-pending' }
      : { label: 'Turned off', tone: 'is-off' };
  }
  if (user.mustChangePassword) return { label: 'Temporary password', tone: 'is-pending' };
  return { label: 'Active', tone: 'is-active' };
}

/**
 * The one thing that just happened, held so the screen can say it.
 *
 * A password only ever appears here when it could NOT be emailed, and `reason` says
 * why. The ordinary path shows an address and no secret at all.
 */
type Notice =
  | { readonly kind: 'invited'; readonly user: ManagedUser }
  | { readonly kind: 'sent'; readonly user: ManagedUser; readonly sentTo: string }
  | { readonly kind: 'password'; readonly user: ManagedUser; readonly tempPassword: string; readonly reason: string | null };

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
  const [notice, setNotice] = useState<Notice | null>(null);

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
  const run = useCallback(async (work: () => Promise<Notice | null>, whenItFails: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await work();
      if (result) setNotice(result);
      await refresh();
    } catch (cause) {
      setError(cause instanceof AuthError ? cause.message : whenItFails);
    } finally {
      setBusy(false);
    }
  }, [busy, refresh]);

  const emailLooksRight = isValidEmail(newEmail);

  const addUser = useCallback((event: React.FormEvent) => {
    event.preventDefault();
    const email = newEmail.trim();
    // The server checks this too, and its check is the one that counts. Refusing here
    // only saves a round trip and puts the message next to the field it is about.
    if (!isValidEmail(email)) return;
    void run(async () => {
      const created = await createUser(email, newRole);
      setNewEmail('');
      setNewRole('bt');
      return created.kind === 'issued'
        ? { kind: 'password' as const, user: created.user, tempPassword: created.tempPassword, reason: null }
        : { kind: 'invited' as const, user: created.user };
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
          Everybody who can sign in to this portal. A new account starts turned off and
          holds no usable password. Send a temporary one when you are ready, and it goes
          to their address rather than onto this screen. The portal makes them choose
          their own the first time they use it.
        </p>

        {error && <div className="error-banner" role="alert">{error}</div>}

        {notice && (
          <div className="password-card auth-issued">
            <h2>{notice.user.email}</h2>

            {notice.kind === 'invited' && (
              <p>
                Added as {ROLE_LABELS[notice.user.role].toLowerCase()}, and turned off
                until you send them a password. Nobody can sign in to it before then, so
                a mistyped address costs nothing.
              </p>
            )}

            {notice.kind === 'sent' && (
              <p>
                A temporary password is on its way to {notice.sentTo}. It is not shown
                here, because it went to them and not to this screen. They will be asked
                to choose their own the first time they sign in.
              </p>
            )}

            {notice.kind === 'password' && (
              <>
                <p>
                  {notice.reason
                    ?? `Signs in as ${ROLE_LABELS[notice.user.role].toLowerCase()}. Hand them the password below, however you would hand over any other secret.`}
                </p>
                <TempPasswordNotice tempPassword={notice.tempPassword} />
              </>
            )}

            <div className="form-actions">
              <button type="button" className="btn-ghost" onClick={() => { setNotice(null); }}>
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
              aria-describedby="new-user-email-rule"
              aria-invalid={newEmail.trim().length > 0 && !emailLooksRight}
            />
            {/* Said only once they have typed something wrong. An address rule shown
                against an empty field is noise on every visit. */}
            <p
              id="new-user-email-rule"
              className={`auth-rule${newEmail.trim().length > 0 && !emailLooksRight ? ' is-unmet' : ''}`}
            >
              {newEmail.trim().length > 0 && !emailLooksRight
                ? 'That does not look like an email address, and the password has to be sent to one.'
                : 'The account signs in with this address, and the temporary password is sent to it.'}
            </p>
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
            disabled={busy || !emailLooksRight}
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
                          // Sending replaces the password and drops every session on
                          // the account, so an administrator doing it to themselves
                          // would be signed out mid-click. They change their own
                          // password on the account screen, which proves the current
                          // one first.
                          disabled={busy || isSelf}
                          title={isSelf ? 'Change your own password from your account instead.' : undefined}
                          onClick={() => {
                            void run(async () => {
                              const result = await sendTempPassword(user.id);
                              // The server turns the account on as part of sending, so
                              // this is the invite AND the "they lost it" button. It
                              // only ever shows a password when the mail did not go.
                              return result.kind === 'sent'
                                ? { kind: 'sent' as const, user: result.user, sentTo: result.sentTo }
                                : {
                                    kind: 'password' as const,
                                    user: result.user,
                                    tempPassword: result.tempPassword,
                                    reason: result.reason,
                                  };
                            }, 'That temporary password could not be sent.');
                          }}
                        >
                          {user.lastLoginAt === null && user.disabledAt !== null
                            ? 'Send temp password'
                            : 'New temp password'}
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
