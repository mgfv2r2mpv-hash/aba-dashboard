import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import ClientCalendarView from './ClientCalendarView';
import type { Client, Appointment } from '../types';

// ── Fixtures mirroring sampleSchedule.json shapes ──────────────────────────────
const client: Client = {
  id: 'c1',
  name: 'Client 1',
  availabilityWindows: {
    Monday: [{ start: '16:00', end: '19:00' }],
    Tuesday: [{ start: '16:00', end: '19:00' }],
    Wednesday: [{ start: '16:00', end: '19:00' }],
    Thursday: [{ start: '16:00', end: '19:00' }],
  },
};

// 2026-06-01 is a Monday
const apptDirect: Appointment = {
  id: 'a1',
  title: 'Direct — Client 1',
  technician: 't1',
  client: 'c1',
  startTime: '2026-06-01T16:00:00',
  endTime: '2026-06-01T18:00:00',
  isFixed: false,
  isBillable: true,
  type: 'client-session',
  status: 'completed',
};

const anchor = new Date('2026-06-01T12:00:00');

describe('ClientCalendarView — Case lens', () => {
  // Defect 3: blank/white-screen on "Week" in the Case lens. Reproduces when a
  // client has no availabilityWindows (older-schema / persisted client) — the
  // day/week grid reads client.availabilityWindows[dow] unguarded.
  // (Month view never touches availabilityWindows, so it survives — matching the
  // reported "Month is fine, Week blanks" symptom.)
  it('renders the Week view without crashing when a client lacks availabilityWindows (defect 3)', () => {
    const legacyClient = { id: 'c1', name: 'Client 1' } as unknown as Client;
    expect(() =>
      render(
        <ClientCalendarView
          clients={[legacyClient]}
          appointments={[apptDirect]}
          blackouts={[]}
          view="week"
          date={anchor}
          onPickDay={() => {}}
        />,
      ),
    ).not.toThrow();
  });

  // Defect 2: company holidays do not show in the Case lens.
  it('shows a company-holiday marker on a holiday session (defect 2)', () => {
    const holidayDate = '2026-05-25'; // Memorial Day (Monday)
    const holidayAppt: Appointment = {
      ...apptDirect,
      id: 'a2',
      startTime: `${holidayDate}T16:00:00`,
      endTime: `${holidayDate}T18:00:00`,
    };
    const { container } = render(
      // companyHolidays is the intended-but-missing prop — cast keeps the RED
      // test compiling against the current (incomplete) Props type.
      <ClientCalendarView
        {...({
          clients: [client],
          appointments: [holidayAppt],
          blackouts: [],
          view: 'day',
          date: new Date(`${holidayDate}T12:00:00`),
          onPickDay: () => {},
          companyHolidays: [{ id: 'h1', date: holidayDate, name: 'Memorial Day' }],
        } as any)}
      />,
    );
    // Admin calendar marks holidays with a green star (✦) / "Holiday" title.
    const hasHolidayMarker =
      container.textContent?.includes('✦') ||
      container.querySelector('[title*="Holiday" i], [title*="Memorial Day"]') !== null;
    expect(hasHolidayMarker).toBe(true);
  });

  // Filter/focus redesign: the Clients ▾ visibility dropdown and a Clear-focus
  // control replace All/None, and tapping a client focus pill must not crash.
  it('renders the Clients dropdown + Clear focus and toggles a focus pill (week)', () => {
    const c2: Client = { ...client, id: 'c2', name: 'Client 2' };
    const { container, getByText } = render(
      <ClientCalendarView
        clients={[client, c2]}
        appointments={[apptDirect]}
        blackouts={[]}
        view="week"
        date={anchor}
        onPickDay={() => {}}
      />,
    );
    expect(container.textContent).toContain('2/2 clients');
    expect(getByText('Clear focus')).toBeTruthy();
    // Focus pills carry a "Tap to focus" title — tapping one shouldn't throw.
    const pill = container.querySelector('button[title="Tap to focus"]');
    expect(pill).toBeTruthy();
    expect(() => fireEvent.click(pill!)).not.toThrow();
  });

  // Defect 1: cancel-escalation severity / session badges do not show in Case lens.
  // (cancelEscalation lives only on canceled sessions, so full parity requires the
  // Case grid to render canceled sessions too.)
  it('shows a cancel-escalation severity badge on an escalated session (defect 1)', () => {
    // Two family cancellations in the same month → the 2nd carries escalation = 2.
    const mkCancel = (id: string, day: string): Appointment => ({
      ...apptDirect,
      id,
      startTime: `2026-06-${day}T16:00:00`,
      endTime: `2026-06-${day}T18:00:00`,
      status: 'canceled',
      cancellation: { source: 'family', reason: 'sick', unplanned: true },
    });
    const appts = [mkCancel('x1', '01'), mkCancel('x2', '03')];
    const { container } = render(
      <ClientCalendarView
        {...({
          clients: [client],
          appointments: appts,
          blackouts: [],
          view: 'day',
          date: new Date('2026-06-03T12:00:00'), // day of the escalated (2nd) cancel
          onPickDay: () => {},
          companyHolidays: [],
        } as any)}
      />,
    );
    // Escalation badges read "2?", "3!", … — assert any escalation glyph shows.
    const txt = container.textContent ?? '';
    const hasBadge = /[2-5][?!]|🛑/.test(txt);
    expect(hasBadge).toBe(true);
  });
});
