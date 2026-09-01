import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import UserAdminScreen from './UserAdminScreen';
import * as portalAuth from './portalAuth';

vi.mock('./portalAuth', async (importOriginal) => {
  const actual = await importOriginal<typeof portalAuth>();
  return {
    ...actual,
    listUsers: vi.fn(),
    createUser: vi.fn(),
    setUserDisabled: vi.fn(),
    sendTempPassword: vi.fn(),
  };
});

const listUsers = vi.mocked(portalAuth.listUsers);
const createUser = vi.mocked(portalAuth.createUser);
const setUserDisabled = vi.mocked(portalAuth.setUserDisabled);
const sendTempPassword = vi.mocked(portalAuth.sendTempPassword);

const ADMIN = {
  id: 'u0', email: 'boss@clinic.org', role: 'admin' as const,
  mustChangePassword: false, disabledAt: null,
  createdAt: '2026-08-01T00:00:00.000Z', passwordSetAt: '2026-08-01T00:00:00.000Z',
  lastLoginAt: '2026-08-30T12:00:00.000Z',
};
const PENDING_BT = {
  id: 'u1', email: 'bt@clinic.org', role: 'bt' as const,
  mustChangePassword: true, disabledAt: null,
  createdAt: '2026-08-30T00:00:00.000Z', passwordSetAt: '2026-08-30T00:00:00.000Z',
  lastLoginAt: null,
};
// The state every ordinary account is created in now: turned off, holding a password
// nobody was ever shown, never signed in. Distinct from TURNED_OFF, which is access
// somebody deliberately took away.
const NOT_INVITED = {
  id: 'u3', email: 'new@clinic.org', role: 'staff' as const,
  mustChangePassword: true, disabledAt: '2026-08-31T00:00:00.000Z',
  createdAt: '2026-08-31T00:00:00.000Z', passwordSetAt: '2026-08-31T00:00:00.000Z',
  lastLoginAt: null,
};
const TURNED_OFF = {
  id: 'u2', email: 'gone@clinic.org', role: 'staff' as const,
  mustChangePassword: false, disabledAt: '2026-08-29T00:00:00.000Z',
  createdAt: '2026-08-01T00:00:00.000Z', passwordSetAt: '2026-08-01T00:00:00.000Z',
  lastLoginAt: '2026-08-28T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  listUsers.mockResolvedValue([ADMIN, PENDING_BT, TURNED_OFF, NOT_INVITED]);
});

function renderAdmin() {
  const onClose = vi.fn();
  render(<UserAdminScreen currentUser={ADMIN} onClose={onClose} />);
  return onClose;
}

/** The row a given address sits in, so an assertion cannot match the wrong person. */
async function rowFor(email: string): Promise<HTMLElement> {
  const cell = await screen.findByRole('rowheader', { name: new RegExp(email) });
  return cell.closest('tr') as HTMLElement;
}

describe('the list', () => {
  it('names everybody, with the role spelled out rather than slugged', async () => {
    renderAdmin();
    expect(await screen.findByText('boss@clinic.org')).toBeInTheDocument();
    expect(within(await rowFor('bt@clinic.org')).getByText('Behavior technician')).toBeInTheDocument();
    expect(within(await rowFor('gone@clinic.org')).getByText('Staff')).toBeInTheDocument();
  });

  it('separates an account still on a temporary password from a working one', async () => {
    renderAdmin();
    expect(within(await rowFor('bt@clinic.org')).getByText('Temporary password')).toBeInTheDocument();
    expect(within(await rowFor('boss@clinic.org')).getByText('Active')).toBeInTheDocument();
    expect(within(await rowFor('gone@clinic.org')).getByText('Turned off')).toBeInTheDocument();
  });

  it('says "never" rather than a blank where somebody has not signed in yet', async () => {
    renderAdmin();
    expect(within(await rowFor('bt@clinic.org')).getByText('Never')).toBeInTheDocument();
  });

  it('shows the server\'s message when the list will not load', async () => {
    listUsers.mockRejectedValue(new portalAuth.AuthError(403, 'That account is not an administrator.'));
    renderAdmin();
    expect(await screen.findByText('That account is not an administrator.')).toBeInTheDocument();
  });
});

describe('adding somebody', () => {
  it('sends the address and the chosen role, and shows NO password', async () => {
    // The change that matters: adding somebody no longer produces a secret on screen.
    // The account is turned off until somebody sends a password to the address.
    createUser.mockResolvedValue({ kind: 'invited', user: NOT_INVITED });
    renderAdmin();
    await screen.findByText('boss@clinic.org');

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@clinic.org' } });
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'staff' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add person' }));

    await waitFor(() => { expect(createUser).toHaveBeenCalledWith('new@clinic.org', 'staff'); });
    expect(await screen.findByText(/turned off until you send them a password/)).toBeInTheDocument();
    expect(screen.queryByText(/shown once and nothing can read it back/)).not.toBeInTheDocument();
  });

  it('refuses an address that is not one, without asking the server', async () => {
    renderAdmin();
    await screen.findByText('boss@clinic.org');

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'not-an-address' } });
    expect(screen.getByRole('button', { name: 'Add person' })).toBeDisabled();
    expect(screen.getByText(/does not look like an email address/)).toBeInTheDocument();
    expect(createUser).not.toHaveBeenCalled();
  });

  it('accepts one that is', async () => {
    renderAdmin();
    await screen.findByText('boss@clinic.org');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'someone@clinic.org' } });
    expect(screen.getByRole('button', { name: 'Add person' })).toBeEnabled();
    expect(screen.queryByText(/does not look like an email address/)).not.toBeInTheDocument();
  });

  it('reloads the list afterwards, so the new person is on it', async () => {
    createUser.mockResolvedValue({ kind: 'invited', user: NOT_INVITED });
    renderAdmin();
    await screen.findByText('boss@clinic.org');
    expect(listUsers).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@clinic.org' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add person' }));

    await waitFor(() => { expect(listUsers).toHaveBeenCalledTimes(2); });
  });

  it('shows a duplicate refusal instead of a password', async () => {
    createUser.mockRejectedValue(new portalAuth.AuthError(409, 'That email already has an account.'));
    renderAdmin();
    await screen.findByText('boss@clinic.org');

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'boss@clinic.org' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add person' }));

    expect(await screen.findByText('That email already has an account.')).toBeInTheDocument();
    // The once-only warning is unique to the temp-password box; the words
    // "Temporary password" are not, because they are also a row's status.
    expect(screen.queryByText(/shown once and nothing can read it back/)).not.toBeInTheDocument();
  });
});

describe('turning an account off', () => {
  it('turns off somebody else', async () => {
    setUserDisabled.mockResolvedValue(undefined);
    renderAdmin();
    fireEvent.click(within(await rowFor('bt@clinic.org')).getByRole('button', { name: 'Turn off' }));
    await waitFor(() => { expect(setUserDisabled).toHaveBeenCalledWith('u1', true); });
  });

  it('turns one back on', async () => {
    setUserDisabled.mockResolvedValue(undefined);
    renderAdmin();
    fireEvent.click(
      within(await rowFor('gone@clinic.org')).getByRole('button', { name: 'Turn back on' }),
    );
    await waitFor(() => { expect(setUserDisabled).toHaveBeenCalledWith('u2', false); });
  });

  it('will not let an administrator turn their own account off', async () => {
    // The server does not stop this. Doing it would end their session and could leave
    // the portal with no administrator able to sign in and undo it.
    renderAdmin();
    const own = within(await rowFor('boss@clinic.org')).getByRole('button', { name: 'Turn off' });
    expect(own).toBeDisabled();
    fireEvent.click(own);
    expect(setUserDisabled).not.toHaveBeenCalled();
  });

  it('marks which row is you', async () => {
    renderAdmin();
    expect(within(await rowFor('boss@clinic.org')).getByText('you')).toBeInTheDocument();
  });
});

describe('sending a temporary password', () => {
  it('calls it sending on an account nobody has invited yet', async () => {
    // The label follows the state, because "New temp password" on an account that
    // never had one reads as though something is being replaced.
    renderAdmin();
    expect(
      within(await rowFor('new@clinic.org')).getByRole('button', { name: 'Send temp password' }),
    ).toBeInTheDocument();
  });

  it('still calls it a new one for somebody already holding one', async () => {
    renderAdmin();
    expect(
      within(await rowFor('bt@clinic.org')).getByRole('button', { name: 'New temp password' }),
    ).toBeInTheDocument();
  });

  it('will not let an admin send one to themselves and sign themselves out', async () => {
    // ADMIN is the signed-in account in these tests. Sending replaces the password and
    // drops every session on the account, so the button that does it has to be shut
    // on their own row the same way the turn-off button is.
    renderAdmin();
    expect(
      within(await rowFor('boss@clinic.org')).getByRole('button', { name: /temp password/ }),
    ).toBeDisabled();
  });

  it('says where it went and shows no password', async () => {
    sendTempPassword.mockResolvedValue({ kind: 'sent', user: NOT_INVITED, sentTo: 'new@clinic.org' });
    renderAdmin();
    fireEvent.click(
      within(await rowFor('new@clinic.org')).getByRole('button', { name: 'Send temp password' }),
    );

    await waitFor(() => { expect(sendTempPassword).toHaveBeenCalledWith('u3'); });
    expect(await screen.findByText(/on its way to new@clinic.org/)).toBeInTheDocument();
    expect(screen.queryByText(/shown once and nothing can read it back/)).not.toBeInTheDocument();
  });

  it('falls back to showing it when the mail did not go, and says why', async () => {
    // The account has a new password by this point whatever happened to the email, so
    // losing the password here would strand it. This is the path that must not regress.
    sendTempPassword.mockResolvedValue({
      kind: 'show', user: NOT_INVITED, tempPassword: 'hand-this-over',
      reason: 'Email is not configured on this server, so the password was not sent.',
    });
    renderAdmin();
    fireEvent.click(
      within(await rowFor('new@clinic.org')).getByRole('button', { name: 'Send temp password' }),
    );

    expect(await screen.findByText('hand-this-over')).toBeInTheDocument();
    expect(screen.getByText(/Email is not configured on this server/)).toBeInTheDocument();
  });
});

describe('what a row says has happened to an account', () => {
  it('tells an uninvited account apart from one that was turned off', async () => {
    renderAdmin();
    expect(within(await rowFor('new@clinic.org')).getByText('Not invited yet')).toBeInTheDocument();
    expect(within(await rowFor('gone@clinic.org')).getByText('Turned off')).toBeInTheDocument();
  });
});
