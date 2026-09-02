import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SignInScreen from './SignInScreen';
import * as portalAuth from './portalAuth';

// The sign-in screen, and the door it opens into a store with nothing in it.
//
// The first-run panel is the reason this screen has tests of its own. The server only
// lets an Access-authenticated caller create an account while NO accounts exist, and
// demands an administrator's session from then on. If this screen does not offer that
// creation, the first administrator can only be made by hand-writing an HTTP request,
// and the person who has to do that is the one person who is not in yet.

vi.mock('./portalAuth', async (importOriginal) => {
  const actual = await importOriginal<typeof portalAuth>();
  return {
    ...actual,
    signIn: vi.fn(),
    createUser: vi.fn(),
    isFirstRunOpen: vi.fn(),
  };
});

const isFirstRunOpen = vi.mocked(portalAuth.isFirstRunOpen);
const createUser = vi.mocked(portalAuth.createUser);
const signIn = vi.mocked(portalAuth.signIn);

const FIRST_ADMIN = {
  id: 'u0',
  email: 'boss@clinic.org',
  role: 'admin' as const,
  mustChangePassword: true,
  disabledAt: null,
  createdAt: '2026-08-31T06:00:00.000Z',
  passwordSetAt: '2026-08-31T06:00:00.000Z',
  lastLoginAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  isFirstRunOpen.mockResolvedValue(false);
});

function renderScreen(accessEmail: string | null = null) {
  const onSignedIn = vi.fn();
  const onNeedsNewPassword = vi.fn();
  render(
    <SignInScreen
      accessEmail={accessEmail}
      notice={null}
      onSignedIn={onSignedIn}
      onNeedsNewPassword={onNeedsNewPassword}
    />,
  );
  return { onSignedIn, onNeedsNewPassword };
}

describe('an empty store, reached through Access', () => {
  beforeEach(() => { isFirstRunOpen.mockResolvedValue(true); });

  it('offers to create the first administrator, naming who Access says you are', async () => {
    renderScreen('boss@clinic.org');
    expect(
      await screen.findByRole('heading', { name: 'Set up the first administrator' }),
    ).toBeInTheDocument();
    expect(screen.getByText('boss@clinic.org')).toBeInTheDocument();
  });

  it('says plainly that creating it closes the door behind them', async () => {
    renderScreen('boss@clinic.org');
    await screen.findByRole('heading', { name: 'Set up the first administrator' });
    expect(screen.getByText(/closes the setup door/)).toBeInTheDocument();
  });

  it('creates the account for the Access identity, not for anything typed', async () => {
    createUser.mockResolvedValue({ kind: 'issued', user: FIRST_ADMIN, tempPassword: 'first-temp-pass' });
    renderScreen('boss@clinic.org');
    fireEvent.click(await screen.findByRole('button', { name: 'Create administrator' }));
    await waitFor(() => { expect(createUser).toHaveBeenCalledWith('boss@clinic.org', 'admin'); });
  });

  it('shows the temporary password once, and says it is once', async () => {
    createUser.mockResolvedValue({ kind: 'issued', user: FIRST_ADMIN, tempPassword: 'first-temp-pass' });
    renderScreen('boss@clinic.org');
    fireEvent.click(await screen.findByRole('button', { name: 'Create administrator' }));

    expect(await screen.findByText('first-temp-pass')).toBeInTheDocument();
    expect(screen.getByText(/shown once and nothing can read it back/)).toBeInTheDocument();
  });

  it('hands on to the sign-in form with the new address already filled in', async () => {
    createUser.mockResolvedValue({ kind: 'issued', user: FIRST_ADMIN, tempPassword: 'first-temp-pass' });
    renderScreen('boss@clinic.org');
    fireEvent.click(await screen.findByRole('button', { name: 'Create administrator' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to sign in' }));

    expect(await screen.findByLabelText('Email')).toHaveValue('boss@clinic.org');
    expect(screen.queryByText('first-temp-pass')).not.toBeInTheDocument();
  });

  it('lets somebody who already has an account skip past it', async () => {
    renderScreen('boss@clinic.org');
    fireEvent.click(await screen.findByRole('button', { name: 'I already have an account' }));
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('shows the server\'s refusal rather than a temp password when creation fails', async () => {
    createUser.mockRejectedValue(new portalAuth.AuthError(409, 'That email is already in use.'));
    renderScreen('boss@clinic.org');
    fireEvent.click(await screen.findByRole('button', { name: 'Create administrator' }));
    expect(await screen.findByText('That email is already in use.')).toBeInTheDocument();
  });
});

describe('a store with accounts in it', () => {
  it('shows the sign-in form and never offers to create an administrator', async () => {
    isFirstRunOpen.mockResolvedValue(false);
    renderScreen('boss@clinic.org');
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create administrator' })).not.toBeInTheDocument();
  });

  it('does not ask about first-run at all without an Access identity', async () => {
    renderScreen(null);
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(isFirstRunOpen).not.toHaveBeenCalled();
  });
});

describe('signing in', () => {
  it('reports a temporary password as a password change, not as a session', async () => {
    signIn.mockResolvedValue({ kind: 'must-change-password', expiresAt: '2026-09-01T00:15:00Z' });
    const { onSignedIn, onNeedsNewPassword } = renderScreen(null);

    fireEvent.change(await screen.findByLabelText('Email'), {
      target: { value: 'sam@clinic.org' },
    });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'temp-one' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => { expect(onNeedsNewPassword).toHaveBeenCalledOnce(); });
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it('shows the server\'s own wording when the pair does not match', async () => {
    signIn.mockRejectedValue(
      new portalAuth.AuthError(401, 'That email and password do not match.'),
    );
    renderScreen(null);

    fireEvent.change(await screen.findByLabelText('Email'), {
      target: { value: 'sam@clinic.org' },
    });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('That email and password do not match.')).toBeInTheDocument();
  });
});

describe('where the cursor lands, and where it stays', () => {
  // THE BUG THESE EXIST FOR. The landing effect used to depend on `email.length`, so
  // every keystroke in an empty address box re-ran it, found a non-empty value, and
  // threw the cursor into the password field mid-word. Typing an address was not
  // possible: the first character went to Email and the second to Password.
  it('leaves the cursor in the address box while somebody is typing an address', async () => {
    renderScreen(null);
    const email = await screen.findByLabelText('Email');
    email.focus();

    fireEvent.change(email, { target: { value: 'a' } });
    expect(document.activeElement).toBe(email);

    fireEvent.change(email, { target: { value: 'ab' } });
    fireEvent.change(email, { target: { value: 'abc' } });
    expect(document.activeElement).toBe(email);
  });

  it('lands in the address box when Access has not filled one in', async () => {
    renderScreen(null);
    const email = await screen.findByLabelText('Email');
    await waitFor(() => expect(document.activeElement).toBe(email));
  });

  it('lands in the password box when Access already filled the address in', async () => {
    isFirstRunOpen.mockResolvedValue(false);
    renderScreen('boss@clinic.org');
    const password = await screen.findByLabelText('Password');
    await waitFor(() => expect(document.activeElement).toBe(password));
  });
});
