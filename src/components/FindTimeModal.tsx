import React, { useMemo, useState } from 'react';
import { Appointment, ScheduleData } from '../types';
import { findMoveOptions, applyOption, applyManual, durationMinutesOf, MoveOption } from '../findTime';

interface FindTimeModalProps {
  appointment: Appointment;
  mode: 'move' | 'replace';
  scheduleData: ScheduleData;
  now?: Date;
  // AI escape hatch is only offered when a key is configured.
  aiAvailable: boolean;
  aiLoading?: boolean;
  onApply: (moved: Appointment) => void;
  onAskAi: () => void;
  onClose: () => void;
}

// HH:MM helpers (sessions never cross midnight) — mirrors AppointmentForm.
function clockToMin(clock: string): number {
  const [h, m] = clock.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
function minToClock(total: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(total)));
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const TYPE_LABEL: Record<Appointment['type'], string> = {
  'supervision': 'Supervision',
  'parent-training': 'Parent training',
  'case-planning': 'Case planning',
  'reassessment': 'Reassessment',
  'client-session': 'Direct session',
  'internal-task': 'Internal task',
  'other': 'Appointment',
};

export default function FindTimeModal({
  appointment, mode, scheduleData, now = new Date(), aiAvailable, aiLoading = false,
  onApply, onAskAi, onClose,
}: FindTimeModalProps) {
  const options = useMemo(
    () => findMoveOptions(scheduleData, appointment, now),
    [scheduleData, appointment, now],
  );
  const durationMin = durationMinutesOf(appointment);

  // Manual picker: default to this appointment's own day/time, but never a past
  // day — the whole point is to re-place it now-onward.
  const todayStr = ymd(now);
  const apptDay = appointment.startTime.slice(0, 10);
  const [date, setDate] = useState(apptDay < todayStr ? todayStr : apptDay);
  const [startClock, setStartClock] = useState(appointment.startTime.slice(11, 16));
  const [endClock, setEndClock] = useState(appointment.endTime.slice(11, 16));

  // Keep the duration fixed when the start moves (the end follows).
  const onStartChange = (next: string) => {
    setStartClock(next);
    setEndClock(minToClock(clockToMin(next) + durationMin));
  };

  const manualValid = !!date && clockToMin(endClock) > clockToMin(startClock);
  const heading = mode === 'replace' ? 'Replace appointment' : 'Move appointment';
  const who = appointment.client || appointment.title || '';

  const useOption = (o: MoveOption) => onApply(applyOption(appointment, o));
  const useManual = () => { if (manualValid) onApply(applyManual(appointment, date, startClock, endClock)); };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1400, padding: 16,
      }}
    >
      <div onClick={e => e.stopPropagation()} style={{
        background: 'white', borderRadius: 10, padding: 20, maxWidth: 440, width: '100%',
        boxShadow: '0 8px 32px rgba(0,0,0,0.25)', maxHeight: '85vh', overflowY: 'auto',
      }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 2 }}>{heading}</div>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 14 }}>
          {TYPE_LABEL[appointment.type]}{who ? ` · ${who}` : ''} — pick a new time this week, or set one manually.
        </div>

        {/* Suggested slots */}
        {options.length > 0 ? (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: '#9ca3af', marginBottom: 8 }}>
              Suggested this week
            </div>
            {options.map((o, i) => (
              <div key={`${o.date}-${o.start}-${o.techId ?? ''}-${i}`} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 12px', marginBottom: 8,
              }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{o.day} {o.date} · {o.start}–{o.end}</div>
                  {o.techId && (
                    <div style={{ fontSize: 11, color: '#5b21b6', marginTop: 2 }}>
                      with {o.techName || o.techId}
                      {o.improvesCompliance ? ' · improves supervision' : ''}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => useOption(o)}
                  style={{ padding: '5px 12px', border: 'none', borderRadius: 6, background: 'var(--brand-primary)', color: 'white', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                >Use this time</button>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
            No open slots fit this week.{' '}
            {aiAvailable
              ? 'Set a time manually below, or ask AI to search the rest of the month.'
              : 'Set a time manually below.'}
          </div>
        )}

        {/* Manual picker */}
        <div style={{ borderTop: '1px solid #f3f4f6', paddingTop: 14, marginBottom: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, color: '#9ca3af', marginBottom: 8 }}>
            Set a time manually
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label style={{ fontSize: 11, color: '#6b7280' }}>
              Date<br />
              <input type="date" value={date} min={todayStr} onChange={e => setDate(e.target.value)}
                style={{ padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }} />
            </label>
            <label style={{ fontSize: 11, color: '#6b7280' }}>
              Start<br />
              <input type="time" value={startClock} onChange={e => onStartChange(e.target.value)}
                style={{ padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }} />
            </label>
            <label style={{ fontSize: 11, color: '#6b7280' }}>
              End<br />
              <input type="time" value={endClock} onChange={e => setEndClock(e.target.value)}
                style={{ padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 }} />
            </label>
            <button
              onClick={useManual}
              disabled={!manualValid}
              style={{ padding: '6px 14px', border: 'none', borderRadius: 6, background: manualValid ? '#10b981' : '#d1d5db', color: 'white', cursor: manualValid ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 600 }}
            >Set time</button>
          </div>
        </div>

        {/* Footer: AI escape hatch + dismiss */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
          {aiAvailable ? (
            <button
              onClick={onAskAi}
              disabled={aiLoading}
              style={{ padding: '6px 12px', border: '1px solid #c4b5fd', borderRadius: 6, background: '#f5f3ff', color: '#5b21b6', cursor: aiLoading ? 'default' : 'pointer', fontSize: 12, fontWeight: 600, opacity: aiLoading ? 0.6 : 1 }}
            >{aiLoading ? 'Searching…' : 'Ask AI — search rest of month'}</button>
          ) : <span />}
          <button
            onClick={onClose}
            style={{ padding: '6px 14px', border: '1px solid #d1d5db', borderRadius: 6, background: 'white', cursor: 'pointer', fontSize: 13 }}
          >Cancel</button>
        </div>
      </div>
    </div>
  );
}
