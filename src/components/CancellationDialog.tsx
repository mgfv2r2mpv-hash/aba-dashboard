import React, { useState } from 'react';
import {
  Appointment,
  Cancellation,
  CancellationSource,
  CANCELLATION_REASONS,
  activeCancellationCodes,
  applicableSources,
  CompanySettings,
  DEFAULT_CANCELLATION_NOTICE,
} from '../types';

interface Props {
  appointment: Appointment;
  settings: CompanySettings;
  onConfirm: (cancellation: Cancellation) => void;
  onCancel: () => void;
}

export default function CancellationDialog({ appointment, settings, onConfirm, onCancel }: Props) {
  // Active reason codes for this company; fall back to the built-ins if every
  // code has been retired, so the cancel flow is never left with no options.
  const activeReasons = activeCancellationCodes(settings);
  const reasons = activeReasons.length ? activeReasons : CANCELLATION_REASONS;

  const [source, setSource] = useState<CancellationSource>('bt');
  const [reason, setReason] = useState<string>(() => reasons[0]?.value ?? '');
  const [unplanned, setUnplanned] = useState(true);
  const [noticeMet, setNoticeMet] = useState(false);
  const [notes, setNotes] = useState('');

  const notice = settings.cancellationNotice || DEFAULT_CANCELLATION_NOTICE;
  const sources = applicableSources(appointment.type);

  // Keep source valid if appointment type changes the available list.
  if (!sources.some(s => s.value === source)) {
    setSource(sources[0].value);
  }
  // Keep reason valid if the active set changes (e.g. selected code retired).
  if (reasons.length && !reasons.some(r => r.value === reason)) {
    setReason(reasons[0].value);
  }

  const noticeQuestion = unplanned
    ? `>${notice.unplannedHoursThreshold} hour notice given?`
    : `>${notice.plannedDaysThreshold} day notice given?`;

  const submit = () => {
    onConfirm({
      source,
      reason,
      unplanned,
      noticeMet,
      canceledAt: new Date().toISOString(),
      notes: notes.trim() || undefined,
    });
  };

  return (
    <div style={overlay}>
      <div style={modal}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Cancel appointment</h3>
          <button onClick={onCancel} style={closeBtn}>✕</button>
        </div>
        <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>{appointment.title}</p>

        <label style={label}>Source</label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {sources.map(s => (
            <button
              key={s.value}
              onClick={() => setSource(s.value)}
              style={{
                ...chip,
                backgroundColor: source === s.value ? 'var(--brand-primary)' : 'var(--surface-card)',
                color: source === s.value ? 'var(--brand-primary-text)' : 'var(--text-body)',
                borderColor: source === s.value ? 'var(--brand-primary)' : 'var(--border-strong)',
              }}
            >{s.label}</button>
          ))}
        </div>

        <label style={label}>Reason</label>
        <select value={reason} onChange={e => setReason(e.target.value)} style={input}>
          {reasons.map(r => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>

        <label style={{ ...checkbox, marginTop: 12 }}>
          <input type="checkbox" checked={unplanned} onChange={e => setUnplanned(e.target.checked)} />
          <span>Unplanned?</span>
        </label>

        <label style={checkbox}>
          <input type="checkbox" checked={noticeMet} onChange={e => setNoticeMet(e.target.checked)} />
          <span>{noticeQuestion}</span>
        </label>

        <label style={label}>Notes (optional)</label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          rows={2}
          style={{ ...input, fontFamily: 'inherit', resize: 'vertical' }}
        />

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onCancel} style={secondaryBtn}>Back</button>
          <button onClick={submit} style={dangerBtn}>Mark canceled</button>
        </div>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
  backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex',
  alignItems: 'center', justifyContent: 'center', zIndex: 1100,
  padding: 16,
};

const modal: React.CSSProperties = {
  backgroundColor: 'var(--surface-card)', borderRadius: 'var(--radius-lg)', padding: 20,
  width: '100%', maxWidth: 420, maxHeight: '90vh', overflowY: 'auto',
};

const label: React.CSSProperties = {
  display: 'block', fontSize: 13, fontWeight: 600, marginTop: 12, marginBottom: 6,
};

const input: React.CSSProperties = {
  width: '100%', padding: '8px 10px', border: 'var(--border-control)',
  borderRadius: 'var(--radius-md)', fontSize: 14, boxSizing: 'border-box',
};

const chip: React.CSSProperties = {
  padding: '6px 10px', border: 'var(--border-control)', borderRadius: 'var(--radius-sm)',
  fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap',
};

const checkbox: React.CSSProperties = {
  display: 'flex', gap: 8, alignItems: 'center', marginTop: 8,
  fontSize: 13, cursor: 'pointer',
};

const secondaryBtn: React.CSSProperties = {
  padding: '8px 14px', border: 'var(--border-control)', borderRadius: 'var(--radius-md)',
  background: 'var(--surface-card)', cursor: 'pointer', fontSize: 14,
};

const dangerBtn: React.CSSProperties = {
  padding: '8px 14px', border: 'none', borderRadius: 'var(--radius-md)',
  background: 'var(--red-700)', color: 'var(--white)', cursor: 'pointer', fontSize: 14, fontWeight: 600,
};

const closeBtn: React.CSSProperties = {
  background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', padding: 4,
};
