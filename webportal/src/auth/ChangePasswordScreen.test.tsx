import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ChangePasswordScreen from './ChangePasswordScreen';
import * as portalAuth from './portalAuth';
import { MIN_PASSWORD_LENGTH } from '../../functions/lib/authPolicy';

// Choosing a password, on a ticket and on a session.
//
// The rule itself is not restated here. The screen imports it from the server's own
// functions/lib/authPolicy.ts, so these tests are written against MIN_PASSWORD_LENGTH
// rather than against the number 12, and raising it on the server moves both.

vi.mock('./portalAuth', async (importOriginal) => {
  const actual = await importOriginal<typeof portalAuth>();
  return { ...actual, setPassword: vi.fn() };
});

const setPassword = vi.mocked(portalAuth.setPassword);

const LONG_ENOUGH = 'x'.repeat(MIN_PASSWORD_LENGTH + 4);
const TOO_SHORT = 'x'.repeat(MIN_PASSWORD_LENGTH - 1);

beforeEach(() => {
  vi.clearAllMocks();
  setPassword.mockResolvedValue(undefined);
});

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe('on a change ticket', () => {
  function renderTicket() {
    const onDone = vi.fn();
    render(<ChangePasswordScreen mode="ticket" email={null} onDone={onDone} />);
    return onDone;
  }

  it('never asks for the temporary password again, which they were handed', () => {
    renderTicket();
    expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument();
  });

  it('sends only the new password, and hands back so they sign in with it', async () => {
    const onDone = renderTicket();
    fill('New password', LONG_ENOUGH);
    fill('New password again', LONG_ENOUGH);
    fireEvent.click(screen.getByRole('button', { name: 'Set password' }));

    await waitFor(() => {
      expect(setPassword).toHaveBeenCalledWith({ newPassword: LONG_ENOUGH });
    });
    await waitFor(() => { expect(onDone).toHaveBeenCalledOnce(); });
  });

  it('warns that setting it signs them out everywhere, because the server does', () => {
    renderTicket();
    expect(screen.getByText(/signs you out everywhere/)).toBeInTheDocument();
  });
});

describe('on a session', () => {
  function renderSession() {
    const onDone = vi.fn();
    render(
      <ChangePasswordScreen
        mode="session"
        email="sam@clinic.org"
        onDone={onDone}
        onCancel={vi.fn()}
      />,
    );
    return onDone;
  }

  it('demands the current password, because the server does', () => {
    renderSession();
    expect(screen.getByLabelText('Current password')).toBeInTheDocument();
    fill('New password', LONG_ENOUGH);
    fill('New password again', LONG_ENOUGH);
    expect(screen.getByRole('button', { name: 'Set password' })).toBeDisabled();
  });

  it('sends both passwords once it has them', async () => {
    renderSession();
    fill('Current password', 'the-old-one');
    fill('New password', LONG_ENOUGH);
    fill('New password again', LONG_ENOUGH);
    fireEvent.click(screen.getByRole('button', { name: 'Set password' }));

    await waitFor(() => {
      expect(setPassword).toHaveBeenCalledWith({
        newPassword: LONG_ENOUGH,
        currentPassword: 'the-old-one',
      });
    });
  });
});

describe('the rules', () => {
  function renderTicket() {
    render(<ChangePasswordScreen mode="ticket" email={null} onDone={vi.fn()} />);
  }

  it('refuses a password shorter than the server would accept, before asking it', () => {
    renderTicket();
    fill('New password', TOO_SHORT);
    fill('New password again', TOO_SHORT);
    expect(screen.getByRole('button', { name: 'Set password' })).toBeDisabled();
    expect(screen.getByText(new RegExp(`at least ${MIN_PASSWORD_LENGTH} characters`))).toBeInTheDocument();
    expect(setPassword).not.toHaveBeenCalled();
  });

  it('refuses two that do not match, and says which problem it is', () => {
    renderTicket();
    fill('New password', LONG_ENOUGH);
    fill('New password again', `${LONG_ENOUGH}-nope`);
    expect(screen.getByText('Those two do not match.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set password' })).toBeDisabled();
  });

  it('shows the server\'s refusal when it rejects one this screen allowed', async () => {
    setPassword.mockRejectedValue(
      new portalAuth.AuthError(400, 'Pick a password you have not just been using.'),
    );
    renderTicket();
    fill('New password', LONG_ENOUGH);
    fill('New password again', LONG_ENOUGH);
    fireEvent.click(screen.getByRole('button', { name: 'Set password' }));

    expect(
      await screen.findByText('Pick a password you have not just been using.'),
    ).toBeInTheDocument();
  });
});
