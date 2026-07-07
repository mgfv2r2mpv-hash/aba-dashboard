import React from 'react';
import { Appointment } from '../types';
import { clientPastel } from '../calendarColors';
import { format, isSameDay } from 'date-fns';
import { useRoster } from '../rosterContext';

// Default content for the docked context pane on wide screens, shown when no
// appointment is selected and there's no draft/conflict to triage. Turns the
// otherwise-empty right rail into a useful "at a glance" view: the agenda for
// the day the calendar is focused on, plus the next few upcoming sessions.
export default function AgendaRail({ appointments, date, onSelect }: {
  appointments: Appointment[];
  date: Date;            // the calendar's currently-viewed day/anchor
  onSelect: (a: Appointment) => void;
}) {
  const now = new Date();
  const active = appointments.filter(a => !a.isGhost);
  const byStart = (a: Appointment, b: Appointment) =>
    new Date(a.startTime).getTime() - new Date(b.startTime).getTime();

  const dayAppts = active
    .filter(a => isSameDay(new Date(a.startTime), date))
    .sort(byStart);

  const upcoming = active
    .filter(a => new Date(a.startTime).getTime() >= now.getTime()
      && a.status !== 'canceled' && !isSameDay(new Date(a.startTime), date))
    .sort(byStart)
    .slice(0, 6);

  const dayLabel = isSameDay(date, now) ? `Today · ${format(date, 'EEE, MMM d')}` : format(date, 'EEEE, MMM d');

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto' }}>
      <Section title={dayLabel}>
        {dayAppts.length === 0
          ? <Empty>No sessions this day.</Empty>
          : dayAppts.map(a => <AgendaRow key={a.id} a={a} onSelect={onSelect} />)}
      </Section>

      {upcoming.length > 0 && (
        <Section title="Upcoming">
          {upcoming.map(a => <AgendaRow key={a.id} a={a} onSelect={onSelect} withDate />)}
        </Section>
      )}

      <p style={{ fontSize: 11, color: '#9ca3af', margin: 0 }}>
        Select a session to see details and actions here.
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#374151' }}>{title}</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic' }}>{children}</div>;
}

function AgendaRow({ a, onSelect, withDate }: { a: Appointment; onSelect: (a: Appointment) => void; withDate?: boolean }) {
  const { clientName, techName } = useRoster();
  const canceled = a.status === 'canceled';
  const completed = a.status === 'completed';
  const accent = a.client ? clientPastel(a.client) : '#e5e7eb';
  const who = [a.client && clientName(a.client), a.technician && techName(a.technician)].filter(Boolean).join(' · ');
  const start = new Date(a.startTime);
  const end = new Date(a.endTime);
  return (
    <button
      onClick={() => onSelect(a)}
      style={{
        display: 'flex', alignItems: 'stretch', gap: 8, textAlign: 'left', cursor: 'pointer',
        background: 'white', border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 10px',
        opacity: canceled ? 0.6 : 1,
      }}
    >
      <span style={{ width: 4, borderRadius: 3, background: accent, flexShrink: 0 }} />
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{
          display: 'block', fontSize: 13, fontWeight: 600, color: '#111827',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          textDecoration: canceled ? 'line-through' : 'none',
        }}>
          {completed ? '✓ ' : canceled ? '✕ ' : ''}{a.title}
        </span>
        <span style={{ display: 'block', fontSize: 11, color: '#6b7280', marginTop: 2 }}>
          {withDate ? `${format(start, 'EEE')} · ` : ''}{format(start, 'h:mm')}–{format(end, 'h:mm a')}
          {who ? ` · ${who}` : ''}
        </span>
      </span>
    </button>
  );
}
