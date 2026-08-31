import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AuthGate from './AuthGate';
import AccountMenu from './AccountMenu';
import * as portalAuth from './portalAuth';

// Which screen the gate puts in front of somebody, given what the server said.
//
// The transport is mocked; portalAuth.test.ts covers it. AuthError and the role
// labels stay real, because the screens read both.

vi.mock('./portalAuth', async (importOriginal) => {
  const actual = await importOriginal<typeof portalAuth>();
  return {
    ...actual,
    readSession: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
    isFirstRunOpen: vi.fn().mockResolvedValue(false),
  };
});

const readSession = vi.mocked(portalAuth.readSession);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(portalAuth.isFirstRunOpen).mockResolvedValue(false);
});

function renderGate() {
  return render(
    <AuthGate>
      <AccountMenu />
      <p>the schedule portal</p>
    </AuthGate>,
  );
}

describe('a deployment with no login store bound', () => {
  // This is the branch that makes shipping app login safe. Before Phase 2 every
  // deployment looked like this, Cloudflare Access was the only gate, and the portal
  // has to keep working exactly that way wherever PORTAL_DB is absent.
  it('hands straight through to the app', async () => {
    readSession.mockResolvedValue({ kind: 'unconfigured' });
    renderGate();
    expect(await screen.findByText('the schedule portal')).toBeInTheDocument();
  });

  it('still offers the Cloudflare Access logout, and no account menu', async () => {
    readSession.mockResolvedValue({ kind: 'unconfigured' });
    renderGate();
    const link = await screen.findByRole('link', { name: 'Log out of the portal' });
    expect(link).toHaveAttribute('href', '/cdn-cgi/access/logout');
    expect(screen.queryByRole('button', { name: /Manage people/ })).not.toBeInTheDocument();
  });
});

describe('nobody signed in', () => {
  it('shows the sign-in form instead of the app', async () => {
    readSession.mockResolvedValue({
      kind: 'signed-out', accessEmail: null, holdsChangeTicket: false,
    });
    renderGate();
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByText('the schedule portal')).not.toBeInTheDocument();
  });

  it('fills the email field with whoever Access says reached the origin', async () => {
    readSession.mockResolvedValue({
      kind: 'signed-out', accessEmail: 'boss@clinic.org', holdsChangeTicket: false,
    });
    renderGate();
    expect(await screen.findByLabelText('Email')).toHaveValue('boss@clinic.org');
  });
});

describe('a spent temporary password', () => {
  it('sends the person to choose one rather than into the app', async () => {
    readSession.mockResolvedValue({
      kind: 'signed-out', accessEmail: null, holdsChangeTicket: true,
    });
    renderGate();
    expect(await screen.findByRole('heading', { name: 'Choose your password' })).toBeInTheDocument();
    expect(screen.queryByText('the schedule portal')).not.toBeInTheDocument();
  });

  it('does not ask for a current password, which was never theirs to type', async () => {
    readSession.mockResolvedValue({
      kind: 'signed-out', accessEmail: null, holdsChangeTicket: true,
    });
    renderGate();
    await screen.findByRole('heading', { name: 'Choose your password' });
    expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument();
  });
});

describe('signed in', () => {
  const staff = { id: 'u1', email: 'sam@clinic.org', role: 'staff' as const };
  const admin = { id: 'u0', email: 'boss@clinic.org', role: 'admin' as const };

  it('renders the app and names who is using it', async () => {
    readSession.mockResolvedValue({ kind: 'signed-in', user: staff, mustChangePassword: false });
    renderGate();
    expect(await screen.findByText('the schedule portal')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sam/ })).toBeInTheDocument();
  });

  it('offers the people screen to an administrator and to nobody else', async () => {
    readSession.mockResolvedValue({ kind: 'signed-in', user: staff, mustChangePassword: false });
    const view = renderGate();
    fireEvent.click(await screen.findByRole('button', { name: /sam/ }));
    expect(screen.queryByRole('menuitem', { name: 'Manage people' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Change password' })).toBeInTheDocument();

    view.unmount();
    readSession.mockResolvedValue({ kind: 'signed-in', user: admin, mustChangePassword: false });
    renderGate();
    fireEvent.click(await screen.findByRole('button', { name: /boss/ }));
    expect(screen.getByRole('menuitem', { name: 'Manage people' })).toBeInTheDocument();
  });

  it('sends a session that somehow owes a password to the change screen, not the app', async () => {
    // Login mints a ticket rather than a session when a password must change, so this
    // should be unreachable. The gate refuses to walk somebody into the app anyway.
    readSession.mockResolvedValue({ kind: 'signed-in', user: staff, mustChangePassword: true });
    renderGate();
    expect(await screen.findByRole('heading', { name: 'Change your password' })).toBeInTheDocument();
    expect(screen.queryByText('the schedule portal')).not.toBeInTheDocument();
  });
});

describe('a server that cannot be reached', () => {
  it('says so and offers a retry rather than showing the app or a login form', async () => {
    readSession.mockRejectedValue(
      new portalAuth.AuthError(0, 'The server did not answer. Check your connection, then try again.'),
    );
    renderGate();
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByText(/did not answer/)).toBeInTheDocument();
    expect(screen.queryByText('the schedule portal')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('reads the session again when the retry is taken', async () => {
    readSession.mockRejectedValueOnce(new portalAuth.AuthError(0, 'no answer'));
    renderGate();
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));

    readSession.mockResolvedValue({ kind: 'unconfigured' });
    await waitFor(() => { expect(readSession).toHaveBeenCalledTimes(2); });
  });
});
