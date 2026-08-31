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
    reissueTempPassword: vi.fn(),
  };
});

const listUsers = vi.mocked(portalAuth.listUsers);
const createUser = vi.mocked(portalAuth.createUser);
const setUserDisabled = vi.mocked(portalAuth.setUserDisabled);
const reissueTempPassword = vi.mocked(portalAuth.reissueTempPassword);

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
const TURNED_OFF = {
  id: 'u2', email: 'gone@clinic.org', role: 'staff' as const,
  mustChangePassword: false, disabledAt: '2026-08-29T00:00:00.000Z',
  createdAt: '2026-08-01T00:00:00.000Z', passwordSetAt: '2026-08-01T00:00:00.000Z',
  lastLoginAt: '2026-08-28T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  listUsers.mockResolvedValue([ADMIN, PENDING_BT, TURNED_OFF]);
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
  it('sends the address and the chosen role, then shows the password once', async () => {
    createUser.mockResolvedValue({ user: PENDING_BT, tempPassword: 'issued-once-only' });
    renderAdmin();
    await screen.findByText('boss@clinic.org');

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'bt@clinic.org' } });
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'staff' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add person' }));

    await waitFor(() => { expect(createUser).toHaveBeenCalledWith('bt@clinic.org', 'staff'); });
    expect(await screen.findByText('issued-once-only')).toBeInTheDocument();
    expect(screen.getByText(/shown once and nothing can read it back/)).toBeInTheDocument();
  });

  it('reloads the list afterwards, so the new person is on it', async () => {
    createUser.mockResolvedValue({ user: PENDING_BT, tempPassword: 'x' });
    renderAdmin();
    await screen.findByText('boss@clinic.org');
    expect(listUsers).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'bt@clinic.org' } });
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

describe('reissuing a temporary password', () => {
  it('asks for a new one and shows it once', async () => {
    reissueTempPassword.mockResolvedValue({ user: PENDING_BT, tempPassword: 'the-second-one' });
    renderAdmin();
    fireEvent.click(
      within(await rowFor('bt@clinic.org')).getByRole('button', { name: 'New temp password' }),
    );

    await waitFor(() => { expect(reissueTempPassword).toHaveBeenCalledWith('u1'); });
    expect(await screen.findByText('the-second-one')).toBeInTheDocument();
  });
});
