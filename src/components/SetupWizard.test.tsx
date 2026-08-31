import { describe, it, expect, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach } from 'vitest';
import SetupWizard from './SetupWizard';
import { ScheduleData } from '../types';
import { findIdentityLeaks, isUuid } from '../identifierPolicy';

afterEach(cleanup);

// Drive setup the way a clinician would and read back what it produces. The
// point of these is the pair: the coaching is advisory and the entry always
// stands, but the identity boundary holds regardless of what was typed.

async function enterOneCaseAndOneTech(caseName: string, techName: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '+ Add case' }));
  await user.type(screen.getByLabelText('Case identifier'), caseName);
  await user.click(screen.getByRole('button', { name: '+ Add staff' }));
  await user.type(screen.getByLabelText('Staff identifier'), techName);
  return user;
}

describe('setup - one page, and the identity boundary it enforces', () => {
  it('renders every section at once, with no step navigation', () => {
    render(<SetupWizard onComplete={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('Practice')).toBeInTheDocument();
    expect(screen.getByText('Cases')).toBeInTheDocument();
    expect(screen.getByText('Staff')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create schedule' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Next$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Back$/ })).toBeNull();
  });

  it('mints a uuid for every case and technician the moment it is added', async () => {
    let out: ScheduleData | null = null;
    render(<SetupWizard onComplete={d => { out = d; }} onCancel={vi.fn()} />);
    const user = await enterOneCaseAndOneTech('SB-04', 'TT');
    await user.click(screen.getByRole('button', { name: 'Create schedule' }));

    expect(out).not.toBeNull();
    expect(isUuid(out!.clients[0]!.id)).toBe(true);
    expect(isUuid(out!.technicians[0]!.id)).toBe(true);
    expect(out!.clients[0]!.name).toBe('SB-04');
  });

  it('warns about a full legal name but LETS THE ENTRY STAND', async () => {
    let out: ScheduleData | null = null;
    render(<SetupWizard onComplete={d => { out = d; }} onCancel={vi.fn()} />);
    const user = await enterOneCaseAndOneTech('Samuel Brennan', 'TT');

    // The coaching fires...
    expect(screen.getByText(/looks like a full name/i)).toBeInTheDocument();
    expect(screen.getByText(/Consider “SB”/)).toBeInTheDocument();

    // ...and changes nothing about whether the entry can be saved.
    const create = screen.getByRole('button', { name: 'Create schedule' });
    expect(create).not.toBeDisabled();
    await user.click(create);
    expect(out).not.toBeNull();
    expect(out!.clients[0]!.name).toBe('Samuel Brennan');
  });

  it('produces a schedule with NO identity leaks even when every name is real', async () => {
    // The load-bearing assertion of the whole phase: a clinician who ignores
    // every warning still gets uuids on every link, so nothing identifying can
    // reach the network by reference.
    let out: ScheduleData | null = null;
    render(<SetupWizard onComplete={d => { out = d; }} onCancel={vi.fn()} />);
    const user = await enterOneCaseAndOneTech('Samuel Brennan', 'Theresa Toledo');

    await user.click(screen.getByRole('button', { name: '+ Assignment' }));
    const picker = screen.getByLabelText('Assigned case');
    await user.selectOptions(picker, screen.getByRole('option', { name: 'Samuel Brennan' }));
    await user.click(screen.getByRole('button', { name: 'Create schedule' }));

    expect(out).not.toBeNull();
    expect(findIdentityLeaks(out!)).toEqual([]);

    // And specifically: the assignment links the uuid, not the name the
    // clinician chose to display.
    const link = out!.technicians[0]!.assignments[0]!.clientId;
    expect(link).toBe(out!.clients[0]!.id);
    expect(isUuid(link)).toBe(true);
    expect(link).not.toBe('Samuel Brennan');
  });

  it('says nothing about an anonymised identifier', async () => {
    render(<SetupWizard onComplete={vi.fn()} onCancel={vi.fn()} />);
    await enterOneCaseAndOneTech('SB-04', 'TT');
    expect(screen.queryByText(/looks like a full name/i)).toBeNull();
  });

  it('carries an existing schedule\'s appointments through untouched', async () => {
    const existing: ScheduleData = {
      id: 'e2a2f0f4-2b53-4e2f-9d1c-0f4f6b6c1a11',
      version: 1,
      clients: [{ id: 'a1b2c3d4-1111-4222-8333-444455556666', name: 'SB-04', availabilityWindows: {} }],
      technicians: [],
      settings: {
        supervisionDirectHoursPercent: 5,
        supervisionRBTHoursPercent: 5,
        parentTraining: { minimumHours: 1.5, targetMinHours: 2, targetMaxHours: 4, periodUnit: 'month' },
      },
      appointments: [{
        id: 'f0f0f0f0-1111-4222-8333-444455556666',
        title: 'Session',
        type: 'client-session',
        startTime: '2026-09-01T14:00:00.000Z',
        endTime: '2026-09-01T16:00:00.000Z',
        isFixed: false,
        isBillable: true,
        client: 'a1b2c3d4-1111-4222-8333-444455556666',
      }],
      lastModified: '2026-08-01T00:00:00.000Z',
    };
    let out: ScheduleData | null = null;
    render(<SetupWizard onComplete={d => { out = d; }} onCancel={vi.fn()} initialData={existing} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Create schedule' }));

    expect(out!.id).toBe(existing.id);
    expect(out!.appointments).toHaveLength(1);
    expect(findIdentityLeaks(out!)).toEqual([]);
  });
});
